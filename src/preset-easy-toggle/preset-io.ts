/**
 * Preset I/O — the one impure layer.
 *
 * Everything else (parser, config) is pure. This wraps the live preset:
 *   read:  getPreset('in_use') → parsePreset + readConfig → resolveView
 *   write: updatePresetWith('in_use', …) for entry toggles / input text,
 *          and an upsert of the `[⚙️CONSOLE-CONFIG]` entry for edit-mode changes.
 *
 * Auto-save has two targets (DESIGN "Persistence"): every mutation lands in the
 * live `in_use` preset immediately, and a debounced `persist()` copies `in_use`
 * back to its source preset on disk (`getLoadedPresetName()`), the equivalent of
 * clicking ST's save button — so selections survive leaving/returning.
 *
 * All SillyTavern calls go through {@link PresetGateway} so the logic is testable
 * without ST. {@link tavernGateway} is the real implementation; tests inject a
 * mock. See {@link ./DESIGN.md} step 3.
 */

import { debounce } from 'lodash';
import {
  CONFIG_BACKUP_ENTRY_NAME,
  CONFIG_ENTRY_NAME,
  readConfig,
  readConfigSafe,
  resolveView,
  serializeConfig,
} from './config';
import type { Config, ConfigReadResult } from './config';
import { parsePreset, REGION_START } from './parser';
import type { PresetPromptLike, ResolvedView } from './types';

/** The two prompt lists a preset carries. `promptsUnused` holds entries that exist in
 *  the preset but are NOT placed in the prompt list — ST's prompt manager doesn't show
 *  them, yet they still travel with the preset. That's where our config blobs live. */
export interface PresetLists {
  prompts: PresetPromptLike[];
  promptsUnused: PresetPromptLike[];
}

/**
 * The narrow surface this layer needs from SillyTavern. `mutate` receives both live
 * prompt lists to edit in place; `persist` writes `in_use` to disk.
 */
export interface PresetGateway {
  /** Current `in_use` prompt lists (placed `prompts` + unplaced `prompts_unused`). */
  read(): PresetLists;
  /** Apply an in-place edit to the `in_use` prompt lists and re-render. */
  mutate(edit: (lists: PresetLists) => void): Promise<void>;
  /** Copy `in_use` back to its source preset on disk. */
  persist(): Promise<void>;
}

/** Real gateway over TavernHelper globals. Not exercised by the check scripts. */
export function tavernGateway(): PresetGateway {
  return {
    read: () => {
      const preset = getPreset('in_use');
      return { prompts: preset.prompts, promptsUnused: preset.prompts_unused ?? [] };
    },
    mutate: async edit => {
      await updatePresetWith('in_use', preset => {
        preset.prompts_unused ??= [];
        edit({ prompts: preset.prompts, promptsUnused: preset.prompts_unused });
        return preset;
      });
    },
    persist: async () => {
      const source = getLoadedPresetName();
      // Source-of-truth save; 'none' because in_use already re-rendered on mutate.
      await replacePreset(source, getPreset('in_use'), { render: 'none' });
    },
  };
}

/** All prompts that may hold the config entry, config first preferred from the unplaced
 *  list (the canonical location) then the placed list (older layout / pre-migration). */
function configSearchList(lists: PresetLists): PresetPromptLike[] {
  return [...lists.promptsUnused, ...lists.prompts];
}

/** Read the live preset and resolve it into the structure the UI renders. */
export function loadView(gateway: PresetGateway): ResolvedView {
  const lists = gateway.read();
  // The region/catalog is parsed from the placed prompts only; config can sit in either
  // list, so the config read searches both.
  return resolveView(parsePreset(lists.prompts), readConfig(configSearchList(lists)));
}

/** Read the live preset's stored config (for edit-mode reads). */
export function loadConfig(gateway: PresetGateway): Config {
  return readConfig(configSearchList(gateway.read()));
}

/** Read the stored config plus its health (corrupt/recovered/…) — see {@link readConfigSafe}. */
export function loadConfigSafe(gateway: PresetGateway): ConfigReadResult {
  return readConfigSafe(configSearchList(gateway.read()));
}

/**
 * Enable/disable entries in one write. Keyed by entry id → enabled. This is the
 * primitive behind toggles, single-select radios (enable one, disable siblings),
 * and applying a scenario — the caller computes the map, we apply it atomically.
 * Unknown ids are ignored.
 */
export async function setEntriesEnabled(gateway: PresetGateway, selections: Record<string, boolean>): Promise<void> {
  await gateway.mutate(({ prompts }) => {
    for (const prompt of prompts) {
      if (prompt.id in selections) prompt.enabled = selections[prompt.id];
    }
  });
}

/** Set the text of an `✍️` input entry. No-op if the id is absent. */
export async function setEntryContent(gateway: PresetGateway, id: string, content: string): Promise<void> {
  await gateway.mutate(({ prompts }) => {
    const prompt = prompts.find(p => p.id === id);
    if (prompt) prompt.content = content;
  });
}

/**
 * Write the edit-mode config back into the `[⚙️CONSOLE-CONFIG]` entry. The config +
 * its backup are stored as **unplaced** prompts (`promptsUnused`), so they travel with
 * the preset and stay recoverable but never show in ST's prompt manager and never
 * inject. Any stale copies left in the placed list by an older version are removed
 * (migration), so they stop appearing in the manager.
 */
export async function saveConfig(gateway: PresetGateway, config: Config): Promise<void> {
  const json = serializeConfig(config);
  await gateway.mutate(({ prompts, promptsUnused }) => {
    removeManagedEntries(prompts);
    // Mirror the just-written (valid) config into the backup so an external
    // corruption/truncation of the primary entry stays recoverable.
    upsertManagedEntry(promptsUnused, CONFIG_BACKUP_ENTRY_NAME, json);
    upsertManagedEntry(promptsUnused, CONFIG_ENTRY_NAME, json);
  });
}

/** True if a config/backup entry still sits in the *placed* prompt list (older layout).
 *  The store migrates these into `promptsUnused` on load so the manager stops showing them. */
export function needsConfigMigration(gateway: PresetGateway): boolean {
  return gateway.read().prompts.some(p => p.name === CONFIG_ENTRY_NAME || p.name === CONFIG_BACKUP_ENTRY_NAME);
}

/** Remove every config/backup entry from a prompt list, in place. */
function removeManagedEntries(prompts: PresetPromptLike[]): void {
  for (let i = prompts.length - 1; i >= 0; i--) {
    if (prompts[i].name === CONFIG_ENTRY_NAME || prompts[i].name === CONFIG_BACKUP_ENTRY_NAME) prompts.splice(i, 1);
  }
}

/**
 * Upsert the config entry into a prompt list (pure, in-place — exported for the
 * check). Updates the existing entry's content if present, otherwise inserts a
 * disabled entry immediately before the region start (or at the front if the
 * region marker is missing).
 */
export function upsertConfigPrompt(prompts: PresetPromptLike[], config: Config): void {
  upsertManagedEntry(prompts, CONFIG_ENTRY_NAME, serializeConfig(config));
}

/** Upsert a disabled, behaviour-only entry by name (config or its backup). */
function upsertManagedEntry(prompts: PresetPromptLike[], name: string, json: string): void {
  const existing = prompts.find(p => p.name === name);
  if (existing) {
    existing.content = json;
    existing.enabled = false;
    return;
  }
  // `role`/`position` are required by ST's PresetPrompt for a fresh normal prompt.
  const entry = {
    id: newPromptId(),
    name,
    enabled: false,
    content: json,
    role: 'system',
    position: { type: 'relative' },
  } as PresetPromptLike;

  // In the unplaced list there is no region marker, so this falls through to unshift.
  const startIdx = prompts.findIndex(p => p.name === REGION_START);
  if (startIdx === -1) prompts.unshift(entry);
  else prompts.splice(startIdx, 0, entry);
}

function newPromptId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `cfg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Wrap a gateway so its `persist()` is debounced — call after every mutation and
 * the disk write coalesces. Returns the debounced persist plus `flush`/`cancel`
 * (flush on `pagehide` so a pending save isn't lost).
 */
export function createAutoSaver(gateway: PresetGateway, wait = 800) {
  const persist = debounce(() => {
    gateway.persist().catch(error => console.warn('[preset-easy-toggle] 磁盘保存失败', error));
  }, wait);
  return {
    schedule: () => persist(),
    flush: () => persist.flush(),
    cancel: () => persist.cancel(),
  };
}
