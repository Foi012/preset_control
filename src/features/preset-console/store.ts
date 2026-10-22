import { canPlaceGroup, removeCustomGroup } from './group-tree';
/**
 * Pinia stores for the console (step 4 vertical slice).
 *
 * `useConsoleStore` owns the live {@link ResolvedView} and routes every mutation
 * through {@link ./preset-io}: write to `in_use`, re-read, then schedule the
 * debounced disk save. `useUiStore` holds view-local state (open, mode).
 *
 * The gateway/autosaver are module singletons — there is exactly one bound
 * preset per script lifetime (DESIGN "Lifetime").
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Config, CustomGroupConfig, GroupConfig } from './config';
import {
  createAutoSaver,
  loadConfigSafe,
  loadView,
  needsConfigMigration,
  saveConfig,
  setEntriesEnabled,
  setEntryContent,
  tavernGateway,
  type PresetGateway,
} from './preset-io';
import { CONFIG_BACKUP_ENTRY_NAME, CONFIG_ENTRY_NAME, ConfigSchema, defaultConfig, serializeConfig, type ConfigStatus } from './config';
import type { ResolvedEntry, ResolvedSection, ResolvedView } from './types';

let gateway: PresetGateway = tavernGateway();
let autosaver = createAutoSaver(gateway);

/** Swap the impure preset edge while keeping the parser/config/store/UI shared. */
export function configurePresetGateway(nextGateway: PresetGateway): void {
  gateway = nextGateway;
  autosaver = createAutoSaver(gateway);
}

/** Flush any pending disk save (call on unload). */
export function flushAutosave(): Promise<void> | undefined {
  return autosaver.flush();
}

const EMPTY_VIEW: ResolvedView = {
  regionFound: false,
  sections: [],
  looseEntries: [],
  allEntries: [],
  scenarios: [],
  ui: { theme: 'dark' },
};

/**
 * Whether an entry belongs in the *curated* in-use view (reveal toggle off):
 * it's on in SillyTavern and not explicitly hidden. Disabled entries fall out of
 * the curated view live — no config write — and come back via the reveal toggle.
 */
export function isEntryActive(entry: ResolvedEntry): boolean {
  return entry.enabled && !entry.hidden;
}

/** The clean display label for an entry — markers (📍/✍️/（自填）) stripped. */
export function entryDisplayName(name: string): string {
  return name.replace(/📍|✍️|（自填）/gu, '').trim();
}

/**
 * Entries of a section to show in in-use: curated to active ones unless `showHidden`,
 * then narrowed by a name search. The single source both the section list (for
 * visibility) and the card (for rendering) read, so they never disagree.
 */
export function inUseEntries(section: ResolvedSection, showHidden: boolean, search: string): ResolvedEntry[] {
  const needle = search.trim().toLowerCase();
  return section.entries.filter(entry => {
    if (!showHidden && !isEntryActive(entry)) return false;
    if (needle && !entryDisplayName(entry.name).toLowerCase().includes(needle)) return false;
    return true;
  });
}

export function flattenSections(sections: ResolvedSection[]): ResolvedSection[] {
  return sections.flatMap(section => [section, ...flattenSections(section.children)]);
}

export function flattenSectionEntries(section: ResolvedSection): ResolvedEntry[] {
  return [...section.entries, ...section.children.flatMap(flattenSectionEntries)];
}

export function plainDescendants(section: ResolvedSection): ResolvedEntry[] {
  return flattenSectionEntries(section).filter(entry => !entry.alwaysOn && !entry.input);
}

/**
 * The immediate "units" a section's rule governs: each direct plain entry is one
 * unit, and each child folder is one unit (controlling all its plain descendants).
 * A `single` section keeps exactly one unit active; a `multi` section toggles them
 * independently. This is what lets a single-select parent treat a whole sub-folder
 * as one selectable option (the `tail` profile-switch case).
 */
export interface SectionUnit {
  /** Set when the unit is a single direct plain entry. */
  entryId?: string;
  /** Set when the unit is a child folder. */
  folder?: ResolvedSection;
  /** The rule-governed (plain) entries this unit controls. */
  plain: ResolvedEntry[];
}

export function immediateUnits(section: ResolvedSection): SectionUnit[] {
  const units: SectionUnit[] = [];
  for (const entry of section.entries) {
    if (!entry.alwaysOn && !entry.input) units.push({ entryId: entry.id, plain: [entry] });
  }
  for (const child of section.children) units.push({ folder: child, plain: plainDescendants(child) });
  return units;
}

/**
 * Build the enable/disable map for turning `section` **on**, honouring its own rule
 * recursively: `multi` enables every plain descendant; `single` enables exactly one
 * immediate unit (the already-active one if there is one, otherwise the first) and
 * clears the rest. A folder unit recurses, so a single sub-folder picks one of its
 * own options rather than enabling all of them.
 */
export function buildOnSelections(
  section: ResolvedSection,
  selections: Record<string, boolean> = {},
): Record<string, boolean> {
  const units = immediateUnits(section);
  if (section.rule === 'single') {
    const activeIndex = units.findIndex(unit => unit.plain.some(entry => entry.enabled));
    const keep = activeIndex >= 0 ? activeIndex : 0;
    units.forEach((unit, i) => {
      if (i === keep) enableUnit(unit, selections);
      else for (const entry of unit.plain) selections[entry.id] = false;
    });
  } else {
    for (const unit of units) enableUnit(unit, selections);
  }
  return selections;
}

function enableUnit(unit: SectionUnit, selections: Record<string, boolean>): void {
  if (unit.folder) buildOnSelections(unit.folder, selections);
  else if (unit.entryId) selections[unit.entryId] = true;
}

/**
 * The inverse of {@link buildOnSelections} for a "turn everything off" sweep: disable a
 * section's plain descendants, but keep `必开` (required) groups satisfied — a required
 * group is re-enabled rule-aware (multi → all, single → one) rather than emptied, so the
 * whole-page toggle never violates the requiredness invariant.
 */
export function buildOffSelections(
  section: ResolvedSection,
  selections: Record<string, boolean> = {},
): Record<string, boolean> {
  if (section.required) return buildOnSelections(section, selections);
  for (const entry of section.entries) {
    if (!entry.alwaysOn && !entry.input) selections[entry.id] = false;
  }
  for (const child of section.children) buildOffSelections(child, selections);
  return selections;
}

export type FolderState = 'on' | 'off' | 'partial';

export function folderState(section: ResolvedSection): FolderState {
  // single: it's "on" as soon as one unit is active — that's the satisfied state.
  if (section.rule === 'single') {
    const units = immediateUnits(section);
    if (!units.length) return 'off';
    return units.some(unit => unit.plain.some(entry => entry.enabled)) ? 'on' : 'off';
  }
  // multi: on only when every rule-governed descendant is enabled.
  const plain = plainDescendants(section);
  if (!plain.length || plain.every(entry => !entry.enabled)) return 'off';
  if (plain.every(entry => entry.enabled)) return 'on';
  return 'partial';
}

/** What affordance an entry should render as, given its section's rule + flags. */
export type Affordance = 'locked' | 'input' | 'radio' | 'checkbox';

export function affordanceOf(section: ResolvedSection, entry: ResolvedEntry): Affordance {
  if (entry.input) return 'input'; // ✍️ wins — it carries text (📍✍️ is an always-on input box)
  if (entry.alwaysOn) return 'locked';
  return section.rule === 'single' ? 'radio' : 'checkbox';
}

/** `{{setvar::NAME::VALUE}}` — we let the user edit VALUE and keep the wrapper. */
const SETVAR_RE = /(\{\{setvar::[^:]+::)([\s\S]*?)(\}\})/;

/** The editable value of an input entry (inner setvar value, or raw content). */
export function inputValueOf(entry: ResolvedEntry): string {
  const match = entry.content.match(SETVAR_RE);
  return match ? match[2] : entry.content;
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Strip Vue proxies before writing config into the preset (per project rule). */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const useConsoleStore = defineStore('pet-console', () => {
  const view = ref<ResolvedView>(EMPTY_VIEW);
  /** Raw stored config — the edit view's source of truth (mirrors the preset). */
  const config = ref<Config>(defaultConfig());
  /**
   * Health of the last config read. `corrupt` means the primary entry is present but
   * unreadable and no backup recovered it — we then *refuse to write*, so an edit can't
   * overwrite the user's only (recoverable) copy with defaults. Surfaced to the UI.
   */
  const configStatus = ref<ConfigStatus>('fresh');
  let lastNotifiedStatus: ConfigStatus | null = null;
  let writing = false;
  /**
   * Ignore ST-side change events until this timestamp. Our own writes echo back as
   * `OAI_PRESET_CHANGED_AFTER`/`SETTINGS_UPDATED`, but they arrive *after* the
   * synchronous `apply()` window — both the live-preset mutate (immediate) and the
   * debounced disk `persist()` (~800ms later). The plain `writing` flag is already
   * false by then, so without this window each toggle/snapshot apply would trigger a
   * cascade of redundant full reloads (the post-apply lag). The window outlasts the
   * autosaver debounce + persist echo; a real ST-side edit after it still reloads,
   * and the manual 同步 button calls `load()` directly, bypassing it entirely.
   */
  let suppressEventsUntil = 0;
  const SELF_WRITE_ECHO_MS = 2500;

  /** Mark that we just wrote the preset, so the resulting event echoes are ignored. */
  function markSelfWrite(): void {
    suppressEventsUntil = Date.now() + SELF_WRITE_ECHO_MS;
  }

  /** Pure re-read of the live preset into the view + config. */
  function reload(): void {
    view.value = loadView(gateway);
    const result = loadConfigSafe(gateway);
    config.value = result.config;
    configStatus.value = result.status;
  }

  /** Toast once when config health changes to a state the user must know about. */
  function notifyConfigHealth(): void {
    if (configStatus.value === lastNotifiedStatus) return;
    lastNotifiedStatus = configStatus.value;
    if (configStatus.value === 'corrupt') {
      toastr.error('控制台设置和备份都无法读取，已停止保存，避免覆盖原设置。请从设置菜单导入有效的控制台设置。', '无法读取控制台设置');
    } else if (configStatus.value === 'recovered') {
      toastr.warning('控制台设置已从备份恢复。下次保存时会修复原设置。');
    }
  }

  /**
   * Load entry point for initial mount, the manual sync button, and ST-side change
   * events: re-read, then enforce 必开 groups. Enforcement only ever runs here —
   * never after an internal mutation's reload — so it can't loop.
   */
  async function load(): Promise<void> {
    reload();
    notifyConfigHealth();
    // One-time cleanup: older versions stored the config/backup entries in the placed
    // prompt list, where ST's prompt manager shows them. Move them into the unplaced
    // list once (only writes when a stale copy is actually present, and never when the
    // config is corrupt — see commitConfig's guard).
    if (configStatus.value !== 'corrupt' && needsConfigMigration(gateway)) {
      await commitConfig();
      // commitConfig only *schedules* a debounced disk write. Flush it now so the
      // migration's cleanup (the placed [⚙️CONSOLE-CONFIG]/-BACKUP entries are already
      // stripped from the live preset) reaches disk immediately — otherwise the old
      // placed copies linger on disk, duplicated alongside extensions.presetEasyToggle,
      // until some later (and possibly cancelled) save.
      autosaver.flush();
    }
    await enforceRequired();
  }

  /** Re-read after an external (ST-side) change, unless we're mid-write or still
   *  inside the echo window of one of our own writes. */
  function externalReload(): void {
    if (writing || Date.now() < suppressEventsUntil) return;
    void load();
  }

  /**
   * A 必开 group must never sit fully empty. When one is found with no plain entry
   * enabled, auto-enable it (multi → all plain; single → its first option) and tell
   * the user via a toast. Runs on load/sync only.
   */
  async function enforceRequired(): Promise<void> {
    if (writing) return;
    const selections: Record<string, boolean> = {};
    const fixed: string[] = [];
    for (const section of flattenSections(view.value.sections)) {
      if (!section.required || folderState(section) !== 'off') continue;
      if (!plainDescendants(section).length) continue; // nothing rule-governed to enable
      buildOnSelections(section, selections);
      fixed.push(section.name);
    }
    if (!fixed.length) return;

    writing = true;
    try {
      await setEntriesEnabled(gateway, selections);
      reload();
      markSelfWrite();
      autosaver.schedule();
      toastr.info(`已为以下分组开启条目，以满足至少开启一项的要求：${fixed.join('、')}`);
    } catch (error) {
      console.error('[preset-easy-toggle] 必开自动开启失败', error);
    } finally {
      writing = false;
    }
  }

  async function apply(mutate: () => Promise<void>, successMsg?: string): Promise<void> {
    writing = true;
    try {
      await mutate();
      reload();
      markSelfWrite();
      autosaver.schedule();
      if (successMsg) toastr.success(successMsg);
    } catch (error) {
      // Surface write failures instead of silently swallowing them — a silent
      // throw here is what makes edits/text-saves look like they do nothing.
      console.error('[preset-easy-toggle] 写入预设失败', error);
      toastr.error((error as Error)?.message ?? String(error), '保存失败');
    } finally {
      writing = false;
    }
  }

  /**
   * Persist the in-memory config edits back into the `[⚙️CONSOLE-CONFIG]` entry.
   * Silent on success — these fire on every small edit (rename, rule, pin, collapse…)
   * and a toast per edit is noise; only write *failures* surface (via `apply`).
   */
  function commitConfig(): Promise<void> {
    // Never overwrite a corrupt-but-recoverable primary entry with the in-memory
    // defaults we fell back to — that would destroy the user's only copy.
    if (configStatus.value === 'corrupt') {
      toastr.error('控制台设置无法读取，暂时不能保存，以免覆盖原设置。');
      return Promise.resolve();
    }
    return apply(() => saveConfig(gateway, plain(config.value)));
  }

  function exportConfigJson(): string {
    return serializeConfig(plain(config.value));
  }

  function parseImportConfig(raw: unknown): Config | null {
    if (!raw || typeof raw !== 'object') return null;

    const object = raw as Record<string, unknown>;
    const looksLikeConfig = ['version', 'region', 'groups', 'customGroups', 'entryMeta', 'scenarios', 'ui'].some(key =>
      Object.hasOwn(object, key),
    );
    if (looksLikeConfig) {
      const direct = ConfigSchema.safeParse(raw);
      if (direct.success) return direct.data;
    }

    const preset = object as {
      extensions?: { presetEasyToggle?: { config?: unknown; backup?: unknown } };
      prompts_unused?: Array<{ name?: unknown; content?: unknown }>;
      prompts?: Array<{ name?: unknown; content?: unknown }>;
    };

    const candidates: unknown[] = [
      preset.extensions?.presetEasyToggle?.config,
      preset.extensions?.presetEasyToggle?.backup,
      ...(preset.prompts_unused ?? [])
        .filter(prompt => prompt.name === CONFIG_ENTRY_NAME || prompt.name === CONFIG_BACKUP_ENTRY_NAME)
        .map(prompt => prompt.content),
      ...(preset.prompts ?? [])
        .filter(prompt => prompt.name === CONFIG_ENTRY_NAME || prompt.name === CONFIG_BACKUP_ENTRY_NAME)
        .map(prompt => prompt.content),
    ];

    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      try {
        const parsed = ConfigSchema.safeParse(JSON.parse(candidate));
        if (parsed.success) return parsed.data;
      } catch {
        // Try the next candidate; imports can contain a corrupt primary plus valid backup.
      }
    }
    return null;
  }

  async function importConfigJson(json: string): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      toastr.error('无法读取这个文件。请选择导出的控制台设置 JSON 文件。', '导入失败');
      return;
    }

    const imported = parseImportConfig(raw);
    if (!imported) {
      toastr.error('这个文件没有可用的控制台设置。请选择导出的设置文件，或包含控制台设置的预设文件。', '导入失败');
      return;
    }

    config.value = imported;
    configStatus.value = 'ok';
    await apply(() => saveConfig(gateway, plain(config.value)), '已导入控制台设置');
    await enforceRequired();
  }

  // --- edit mode: groups ----------------------------------------------------

  /** Sections sorted by raw `order` (ignoring pin float) — the edit-view order. */
  function orderedSections(): ResolvedSection[] {
    return [...view.value.sections].sort((a, b) => a.order - b.order);
  }

  function sectionById(id: string): ResolvedSection | undefined {
    return flattenSections(view.value.sections).find(s => s.id === id);
  }

  /** Ensure a header-group override exists, seeded from its resolved state. */
  function ensureHeaderGroup(headerId: string): GroupConfig {
    let group = config.value.groups.find(g => g.headerId === headerId);
    if (!group) {
      const section = sectionById(headerId);
      group = {
        headerId,
        rule: section?.rule ?? 'multi',
        order: section?.order ?? config.value.groups.length,
        pinned: section?.pinned ?? false,
        hidden: section?.hidden ?? false,
        required: section?.required ?? false,
        collapsed: section?.collapsed ?? false,
        parentId: section?.parentId ?? undefined,
      };
      config.value.groups.push(group);
    }
    return group;
  }

  /**
   * A mutable config handle for a group of either source: the custom-group
   * record, or a (created-on-demand) header override. Common fields
   * (rule/order/pinned/hidden/collapsed/name) can be set on the returned object.
   */
  function groupRecord(id: string): GroupConfig | CustomGroupConfig | undefined {
    const custom = config.value.customGroups.find(g => g.id === id);
    if (custom) return custom;
    if (sectionById(id)?.source === 'header') return ensureHeaderGroup(id);
    return undefined;
  }

  function setGroupRule(id: string, rule: 'single' | 'multi' | 'folder'): Promise<void> | void {
    const group = groupRecord(id);
    if (!group) return;
    group.rule = rule;
    if (rule === 'folder') group.required = false;
    return commitConfig();
  }

  function toggleGroupPinned(id: string): Promise<void> | void {
    const group = groupRecord(id);
    if (!group) return;
    group.pinned = !group.pinned;
    return commitConfig();
  }

  function toggleGroupHidden(id: string): Promise<void> | void {
    const group = groupRecord(id);
    if (!group) return;
    group.hidden = !group.hidden;
    return commitConfig();
  }

  function setGroupRequired(id: string, required: boolean): Promise<void> | void {
    const group = groupRecord(id);
    if (!group) return;
    group.required = required;
    return commitConfig();
  }

  function toggleGroupCollapsed(id: string): Promise<void> | void {
    const group = groupRecord(id);
    if (!group) return;
    group.collapsed = !group.collapsed;
    return commitConfig();
  }

  /**
   * Collapse or expand groups in one write (the panel-level control). Pass `ids` to
   * scope it to a subset of groups; omit for every real group.
   */
  function setAllCollapsed(collapsed: boolean, ids?: string[]): Promise<void> | void {
    const scope = ids ? new Set(ids) : null;
    let changed = false;
    for (const section of flattenSections(view.value.sections)) {
      if (scope && !scope.has(section.id)) continue;
      const group = groupRecord(section.id);
      if (group && group.collapsed !== collapsed) {
        group.collapsed = collapsed;
        changed = true;
      }
    }
    if (!changed) return;
    return commitConfig();
  }

  /** Rename a group. Header groups get a *virtual* name (the prompt is untouched). */
  function renameGroup(id: string, name: string): Promise<void> | void {
    const group = groupRecord(id);
    if (!group) return;
    const trimmed = name.trim();
    if ('headerId' in group)
      group.name = trimmed || undefined; // empty → back to cleaned header
    else group.name = trimmed || group.name;
    return commitConfig();
  }

  /**
   * Move a group up/down **within its own sibling list** (top-level or a folder's
   * children), so the side-nav reorder works at either depth. Delegates ordering
   * to `placeGroup` so dense orders + persistence stay in one place.
   */
  function nudgeGroup(id: string, delta: -1 | 1): Promise<void> | void {
    const section = sectionById(id);
    if (!section) return;
    const parentId = section.parentId ?? null;
    const parent = parentId ? sectionById(parentId) : undefined;
    const siblings = (parent ? parent.children : orderedSections()).filter(s => parent || s.parentId === null);
    const ids = siblings.map(s => s.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= ids.length) return;
    // delta −1: insert before the item currently above; +1: before the item two slots down (or append).
    const beforeId = delta < 0 ? ids[j] : (ids[i + 2] ?? null);
    return placeGroup(id, parentId, beforeId);
  }

  /**
   * Pull a sub-folder out to the top level, dropping it **right after its former
   * parent** so it stays where the eye expects (rather than being banished to the
   * bottom, which the old "顶" button did). No-op for groups already at top level.
   */
  function outdentGroup(id: string): Promise<void> | void {
    const section = sectionById(id);
    if (!section || section.parentId === null) return;
    const parent = sectionById(section.parentId);
    const grandparent = parent?.parentId ? sectionById(parent.parentId) : undefined;
    const siblings = grandparent ? grandparent.children : orderedSections().filter(s => s.parentId === null);
    const parentIndex = siblings.findIndex(s => s.id === section.parentId);
    return placeGroup(id, parent?.parentId ?? null, siblings[parentIndex + 1]?.id ?? null);
  }

  function setGroupParent(id: string, parentId: string | null): Promise<void> | void {
    const section = sectionById(id);
    const group = groupRecord(id);
    if (!section || !group) return;
    const parent = parentId ? sectionById(parentId) : undefined;
    if (!canPlaceGroup(flattenSections(view.value.sections), id, parentId)) return;
    group.parentId = parent?.id;
    return commitConfig();
  }

  function placeGroup(id: string, parentId: string | null, beforeId: string | null = null): Promise<void> | void {
    const section = sectionById(id);
    const group = groupRecord(id);
    if (!section || !group) return;
    const parent = parentId ? sectionById(parentId) : undefined;
    if (!canPlaceGroup(flattenSections(view.value.sections), id, parentId)) return;

    group.parentId = parent?.id;
    const siblings = (parent ? parent.children : view.value.sections)
      .filter(sibling => sibling.id !== id)
      .map(sibling => sibling.id);
    const targetIndex = beforeId ? siblings.indexOf(beforeId) : siblings.length;
    siblings.splice(targetIndex < 0 ? siblings.length : targetIndex, 0, id);
    siblings.forEach((gid, order) => {
      const sibling = groupRecord(gid);
      if (sibling) sibling.order = order;
    });
    return commitConfig();
  }

  /** Create a new custom group at the top of the list, optionally assigning entries into it. */
  function addGroup(name: string, entryIds: string[] = []): Promise<void> {
    const id = uid();
    // Float above every existing group so a freshly created group lands at the top.
    const topOrder = view.value.sections.reduce((min, s) => Math.min(min, s.order), 0) - 1;
    config.value.customGroups.push({
      id,
      name: name.trim() || '新分组',
      rule: 'multi',
      order: topOrder,
      pinned: false,
      hidden: false,
      required: false,
      collapsed: false,
    });
    for (const entryId of entryIds) {
      entryMeta(entryId).groupId = id;
    }
    return commitConfig();
  }

  /** Delete a custom group; its entries fall back to their native scaffold group. */
  function deleteGroup(id: string): Promise<void> | void {
    if (!removeCustomGroup(config.value, id)) return;
    return commitConfig();
  }

  // --- edit mode: per-entry overrides --------------------------------------

  function entryMeta(id: string): NonNullable<Config['entryMeta'][string]> {
    return (config.value.entryMeta[id] ??= {});
  }

  /** Drop an entryMeta record once it carries no overrides, to keep config lean. */
  function pruneEntryMeta(id: string): void {
    const meta = config.value.entryMeta[id];
    if (
      meta &&
      meta.hidden === undefined &&
      meta.kind === undefined &&
      meta.groupId === undefined &&
      meta.alwaysOn === undefined
    ) {
      delete config.value.entryMeta[id];
    }
  }

  function findEntry(id: string): ResolvedEntry | undefined {
    for (const section of flattenSections(view.value.sections)) {
      const entry = section.entries.find(e => e.id === id);
      if (entry) return entry;
    }
    return view.value.looseEntries.find(e => e.id === id) ?? view.value.allEntries.find(e => e.id === id);
  }

  /** Reassign an entry to a group; assigning to its native scaffold group clears the override. */
  function assignEntry(entryId: string, targetGroupId: string): Promise<void> | void {
    const native = findEntry(entryId)?.nativeGroupId ?? null;
    const meta = entryMeta(entryId);
    meta.groupId = !targetGroupId || targetGroupId === native ? undefined : targetGroupId;
    pruneEntryMeta(entryId);
    return commitConfig();
  }

  function assignEntries(entryIds: string[], targetGroupId: string): Promise<void> | void {
    for (const entryId of entryIds) {
      const native = findEntry(entryId)?.nativeGroupId ?? null;
      const meta = entryMeta(entryId);
      meta.groupId = !targetGroupId || targetGroupId === native ? undefined : targetGroupId;
      pruneEntryMeta(entryId);
    }
    return commitConfig();
  }

  function toggleEntryHidden(id: string): Promise<void> {
    const meta = entryMeta(id);
    meta.hidden = meta.hidden ? undefined : true;
    pruneEntryMeta(id);
    return commitConfig();
  }

  function setEntriesHidden(entryIds: string[], hidden: boolean): Promise<void> {
    for (const id of entryIds) {
      const meta = entryMeta(id);
      meta.hidden = hidden ? true : undefined;
      pruneEntryMeta(id);
    }
    return commitConfig();
  }

  /** Force / unforce an entry to render as an input box (only meaningful for non-✍️ entries). */
  function toggleEntryInput(id: string): Promise<void> {
    const meta = entryMeta(id);
    meta.kind = meta.kind === 'input' ? undefined : 'input';
    pruneEntryMeta(id);
    return commitConfig();
  }

  /**
   * Override ST's `📍` always-on lock. `📍` is a suggestion; edit mode decides.
   * Un-pins a `📍` entry (→ normal rule-governed toggle) or pins a plain one;
   * pruned back to absent when the override equals the name-derived value.
   */
  function toggleEntryAlwaysOn(id: string): Promise<void> {
    const entry = findEntry(id);
    const nameDerived = entry?.name.includes('📍') ?? false;
    const next = !(entry?.alwaysOn ?? nameDerived);
    const meta = entryMeta(id);
    meta.alwaysOn = next === nameDerived ? undefined : next;
    pruneEntryMeta(id);
    return commitConfig();
  }

  /** Batch form of {@link toggleEntryAlwaysOn}: force the same 📍 override across a set. */
  function setEntriesAlwaysOn(entryIds: string[], alwaysOn: boolean): Promise<void> {
    for (const id of entryIds) {
      const entry = findEntry(id);
      const nameDerived = entry?.name.includes('📍') ?? false;
      const meta = entryMeta(id);
      meta.alwaysOn = alwaysOn === nameDerived ? undefined : alwaysOn;
      pruneEntryMeta(id);
    }
    return commitConfig();
  }

  function setEntriesInput(entryIds: string[], input: boolean): Promise<void> {
    for (const id of entryIds) {
      const entry = findEntry(id);
      if (input) {
        entryMeta(id).kind = 'input';
      } else if (!entry?.name.includes('✍️') && !entry?.name.includes('（自填）')) {
        const meta = entryMeta(id);
        meta.kind = undefined;
        pruneEntryMeta(id);
      }
    }
    return commitConfig();
  }

  // --- quick switches -------------------------------------------------

  function inUseSections(): ResolvedSection[] {
    if (view.value.sections.length) return view.value.sections;
    return [{ id: '__all_entries__', source: 'custom', parentId: null, name: '全部条目', rule: 'multi', order: 0,
      pinned: false, hidden: false, required: false, collapsed: false, entries: view.value.allEntries, children: [] }];
  }

  function inUseSectionById(id: string): ResolvedSection | undefined {
    return flattenSections(inUseSections()).find(s => s.id === id);
  }

  function setAllEnabled(enable: boolean): Promise<void> | void {
    const selections: Record<string, boolean> = {};
    for (const section of inUseSections()) {
      if (enable) buildOnSelections(section, selections);
      else buildOffSelections(section, selections);
    }
    if (!Object.keys(selections).length) return;
    return apply(() => setEntriesEnabled(gateway, selections));
  }

  function toggleFolder(section: ResolvedSection): Promise<void> | void {
    const turningOn = folderState(section) !== 'on';
    const selections: Record<string, boolean> = {};
    if (turningOn) {
      // Honour the folder's own rule: multi enables all, single picks one unit.
      buildOnSelections(section, selections);
    } else {
      if (section.required) return; // a 必开 folder can't be emptied
      for (const entry of plainDescendants(section)) selections[entry.id] = false;
    }

    // When this folder lives under a single-select parent, activating it is a
    // profile switch: clear the parent's other units (sibling folders + its own
    // direct plain entries).
    if (turningOn && section.parentId) {
      // Resolve the parent in the shared group tree.
      const parent = inUseSectionById(section.parentId);
      if (parent?.rule === 'single') {
        for (const sibling of parent.children) {
          if (sibling.id === section.id) continue;
          for (const entry of plainDescendants(sibling)) selections[entry.id] = false;
        }
        for (const entry of parent.entries) {
          if (!entry.alwaysOn && !entry.input) selections[entry.id] = false;
        }
      }
    }

    return apply(() => setEntriesEnabled(gateway, selections));
  }

  /** Toggle/select an entry, honouring its section rule. Always-on entries are locked. */
  function toggleEntry(section: ResolvedSection, entry: ResolvedEntry): Promise<void> | void {
    if (entry.alwaysOn && !entry.input) return; // locked on, nothing to do
    const affordance = affordanceOf(section, entry);

    if (affordance === 'radio') {
      if (section.required && entry.enabled) return; // can't clear the active option in a 必开 group
      const turningOn = !entry.enabled;
      const selections: Record<string, boolean> = {};
      // Clear every sibling unit in this single-select section: other direct radio
      // entries *and* whole sub-folders (the mixed single-parent case).
      for (const sibling of section.entries) {
        if (affordanceOf(section, sibling) === 'radio') selections[sibling.id] = false;
      }
      for (const child of section.children) {
        for (const descendant of plainDescendants(child)) selections[descendant.id] = false;
      }
      if (turningOn) selections[entry.id] = true;
      return apply(() => setEntriesEnabled(gateway, selections));
    }

    if (affordance === 'checkbox' && section.required && entry.enabled) {
      const enabledPlainCount = section.entries.filter(
        sibling => affordanceOf(section, sibling) === 'checkbox' && sibling.enabled,
      ).length;
      if (enabledPlainCount <= 1) return;
    }

    // Checkbox / input enable: flip just this entry.
    return apply(() => setEntriesEnabled(gateway, { [entry.id]: !entry.enabled }));
  }

  /** Set the inner value of an `✍️` input entry, preserving the setvar wrapper. */
  function setInputValue(entry: ResolvedEntry, value: string): Promise<void> {
    const match = entry.content.match(SETVAR_RE);
    const content = match ? entry.content.replace(SETVAR_RE, `$1${value}$3`) : value;
    return apply(() => setEntryContent(gateway, entry.id, content), '已保存');
  }

  return {
    view,
    config,
    configStatus,
    reload,
    load,
    externalReload,
    exportConfigJson,
    importConfigJson,
    // in-use
    toggleEntry,
    toggleFolder,
    setAllEnabled,
    setInputValue,
    applyPlanSelections: (selections: Record<string, boolean>) => apply(() => setEntriesEnabled(gateway, selections)),
    // edit: groups
    orderedSections,
    setGroupRule,
    toggleGroupPinned,
    toggleGroupHidden,
    setGroupRequired,
    setGroupParent,
    placeGroup,
    toggleGroupCollapsed,
    setAllCollapsed,
    renameGroup,
    nudgeGroup,
    outdentGroup,
    addGroup,
    deleteGroup,
    // edit: entries
    assignEntry,
    toggleEntryHidden,
    toggleEntryInput,
    toggleEntryAlwaysOn,
    assignEntries,
    setEntriesHidden,
    setEntriesInput,
    setEntriesAlwaysOn,
    inUseSections,
  };
});

export type ThemePref = 'dark' | 'light';

/** Toolbox tools the floating panel can host. `home` = the launcher/feature picker. */
export type ToolId = 'home' | 'preset' | 'export' | 'connection';

const ACTIVE_TOOL_KEY = 'presetConsoleActiveTool';

/** Best-effort persistence: the srcdoc iframe can have an opaque-origin localStorage. */
function readActiveTool(): ToolId {
  try {
    const raw = window.localStorage?.getItem(ACTIVE_TOOL_KEY);
    if (raw === 'home' || raw === 'preset' || raw === 'export' || raw === 'connection') return raw;
  } catch {
    /* opaque origin / disabled storage — fall back to the launcher */
  }
  return 'home';
}

function writeActiveTool(tool: ToolId): void {
  try {
    window.localStorage?.setItem(ACTIVE_TOOL_KEY, tool);
  } catch {
    /* ignore — persistence is best-effort, session state still works */
  }
}

export const useUiStore = defineStore('pet-ui', () => {
  const open = ref(false);
  /** Which toolbox feature the panel shows when open. Persisted so a refresh reopens it. */
  const activeTool = ref<ToolId>(readActiveTool());
  const mode = ref<'in-use' | 'edit'>('in-use');
  const theme = ref<ThemePref>('dark');
  /**
   * Compact (mobile-width) layout: the panel is near full-screen, so the side navs
   * (snapshot nav / structure nav) become floating drawers over a scrim instead of a
   * fixed-width split that would starve the content column. Driven from the host
   * viewport in `index.ts` (it knows the real screen width; the iframe only sees the
   * panel width). Session-only.
   */
  const compact = ref(false);
  /** Reveal hidden/disabled entries in in-use. Session-only; resets to curated each open. */
  const showHidden = ref(false);
  /** Edit-mode structure nav is useful but should not permanently consume width. */
  const editNavOpen = ref(true);
  /** Collapse state of the synthetic 未整理 group — it has no config record, so it lives here. */
  const unorganizedCollapsed = ref(false);
  function setTheme(next: ThemePref): void {
    theme.value = next;
  }
  function toggleTheme(): void {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
  }
  /** Switch the active toolbox tool and persist the choice. */
  function setActiveTool(tool: ToolId): void {
    activeTool.value = tool;
    writeActiveTool(tool);
  }

  return {
    open,
    activeTool,
    mode,
    theme,
    compact,
    showHidden,
    editNavOpen,
    unorganizedCollapsed,
    setTheme,
    toggleTheme,
    setActiveTool,
  };
});
