import { CONFIG_BACKUP_ENTRY_NAME, CONFIG_ENTRY_NAME } from './config';
import type { PresetGateway, PresetLists } from './preset-io';
import type { PresetPromptLike } from './types';

const EXTENSION_FIELD = 'presetEasyToggle';
const OPENAI_GLOBAL_PROMPT_ORDER_ID = 100001;

type NativePrompt = {
  identifier: string;
  name?: string;
  content?: string;
  role?: string;
  position?: unknown;
  [key: string]: unknown;
};

type NativePromptOrderEntry = {
  identifier: string;
  enabled?: boolean;
  [key: string]: unknown;
};

type NativePromptOrder = {
  character_id: string | number;
  order: NativePromptOrderEntry[];
};

type NativeSettings = {
  prompts?: NativePrompt[];
  prompt_order?: NativePromptOrder[];
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
};

type NativeContext = {
  chatCompletionSettings: NativeSettings;
  eventSource?: { emit?: (event: string, data?: unknown) => unknown };
  eventTypes?: Record<string, string>;
  saveSettingsDebounced?: () => void;
  getPresetManager: (apiId?: string) => NativePresetManager | null;
};

type NativePresetManager = {
  getSelectedPresetName: () => string;
  getCompletionPresetByName: (name: string) => NativeSettings | undefined;
  savePreset: (name: string, settings: NativeSettings, options?: { skipUpdate?: boolean }) => Promise<void>;
};

type ExtensionConfigStorage = {
  config?: string;
  backup?: string;
};

function context(): NativeContext {
  const getContext = globalThis.SillyTavern?.getContext;
  if (!getContext) throw new Error('SillyTavern.getContext() is unavailable.');
  return getContext() as NativeContext;
}

function clone<T>(value: T): T {
  return structuredClone ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}

function settings(): NativeSettings {
  const current = context().chatCompletionSettings;
  current.prompts ??= [];
  current.prompt_order ??= [];
  current.extensions ??= {};
  return current;
}

function orderList(current: NativeSettings): NativePromptOrder {
  current.prompt_order ??= [];
  let list = current.prompt_order.find(item => String(item.character_id) === String(OPENAI_GLOBAL_PROMPT_ORDER_ID));
  if (!list) {
    list = {
      character_id: OPENAI_GLOBAL_PROMPT_ORDER_ID,
      order: (current.prompts ?? []).map(prompt => ({ identifier: prompt.identifier, enabled: true })),
    };
    current.prompt_order.push(list);
  }
  return list;
}

function promptToLike(prompt: NativePrompt, enabled: boolean, index: number): PresetPromptLike {
  return {
    id: prompt.identifier,
    name: prompt.name ?? prompt.identifier,
    enabled,
    content: prompt.content ?? '',
    role: prompt.role ?? 'system',
    position: prompt.position ?? { type: 'relative' },
  } as PresetPromptLike;
}

function readPrompts(current: NativeSettings): PresetPromptLike[] {
  const prompts = current.prompts ?? [];
  const byId = new Map(prompts.map(prompt => [prompt.identifier, prompt]));
  const seen = new Set<string>();
  const ordered = orderList(current).order.flatMap((entry, index) => {
    const prompt = byId.get(entry.identifier);
    if (!prompt) return [];
    seen.add(entry.identifier);
    return [promptToLike(prompt, entry.enabled ?? true, index)];
  });

  const unordered = prompts
    .filter(prompt => !seen.has(prompt.identifier))
    .map((prompt, offset) => promptToLike(prompt, false, ordered.length + offset));
  return [...ordered, ...unordered];
}

function readExtensionConfig(current: NativeSettings): PresetPromptLike[] {
  const storage = (current.extensions?.[EXTENSION_FIELD] ?? {}) as ExtensionConfigStorage;
  const entries: PresetPromptLike[] = [];
  if (typeof storage.backup === 'string') {
    entries.push({ id: `${EXTENSION_FIELD}:backup`, name: CONFIG_BACKUP_ENTRY_NAME, enabled: false, content: storage.backup });
  }
  if (typeof storage.config === 'string') {
    entries.push({ id: `${EXTENSION_FIELD}:config`, name: CONFIG_ENTRY_NAME, enabled: false, content: storage.config });
  }
  return entries;
}

function writePrompts(current: NativeSettings, prompts: PresetPromptLike[]): void {
  const managedNames = new Set([CONFIG_ENTRY_NAME, CONFIG_BACKUP_ENTRY_NAME]);
  const byId = new Map((current.prompts ?? []).map(prompt => [prompt.identifier, prompt]));
  const nextPrompts: NativePrompt[] = [];
  const nextOrder: NativePromptOrderEntry[] = [];

  for (const prompt of prompts) {
    if (managedNames.has(prompt.name)) continue;
    const existing = byId.get(prompt.id);
    const native: NativePrompt = existing ? { ...existing } : { identifier: prompt.id, role: 'system', position: { type: 'relative' } };
    native.identifier = prompt.id;
    native.name = prompt.name;
    native.content = prompt.content ?? '';
    nextPrompts.push(native);
    nextOrder.push({ identifier: prompt.id, enabled: prompt.enabled });
  }

  current.prompts = nextPrompts;
  orderList(current).order = nextOrder;
}

function writeExtensionConfig(current: NativeSettings, promptsUnused: PresetPromptLike[]): void {
  current.extensions ??= {};
  const storage: ExtensionConfigStorage = {};
  const main = promptsUnused.find(prompt => prompt.name === CONFIG_ENTRY_NAME);
  const backup = promptsUnused.find(prompt => prompt.name === CONFIG_BACKUP_ENTRY_NAME);
  if (typeof main?.content === 'string') storage.config = main.content;
  if (typeof backup?.content === 'string') storage.backup = backup.content;
  if (storage.config || storage.backup) current.extensions[EXTENSION_FIELD] = storage;
  else delete current.extensions[EXTENSION_FIELD];
}

function notifySettingsChanged(ctx: NativeContext): void {
  ctx.saveSettingsDebounced?.();
  // SETTINGS_UPDATED keeps general listeners in sync, but ST's PromptManager only
  // re-renders its prompt list (the ON/OFF checkboxes) on OAI_PRESET_CHANGED_AFTER.
  // We mutate oai_settings in place, so emitting it makes ST's own UI reflect our
  // toggles / snapshot applies instead of showing stale state.
  const settingsUpdated = ctx.eventTypes?.SETTINGS_UPDATED;
  if (settingsUpdated) void ctx.eventSource?.emit?.(settingsUpdated);
  const presetChangedAfter = ctx.eventTypes?.OAI_PRESET_CHANGED_AFTER;
  if (presetChangedAfter) void ctx.eventSource?.emit?.(presetChangedAfter);
}

export function presetGatewayNative(): PresetGateway {
  return {
    read: () => {
      const current = settings();
      return { prompts: readPrompts(current), promptsUnused: readExtensionConfig(current) };
    },
    mutate: async edit => {
      const ctx = context();
      const current = settings();
      const lists: PresetLists = {
        prompts: clone(readPrompts(current)),
        promptsUnused: clone(readExtensionConfig(current)),
      };
      edit(lists);
      writePrompts(current, lists.prompts);
      writeExtensionConfig(current, lists.promptsUnused);
      notifySettingsChanged(ctx);
    },
    persist: async () => {
      const ctx = context();
      const manager = ctx.getPresetManager('openai');
      if (!manager) throw new Error('OpenAI preset manager is unavailable.');
      const name = manager.getSelectedPresetName();
      const current = settings();
      const preset = clone(manager.getCompletionPresetByName(name) ?? {});
      preset.prompts = clone(current.prompts ?? []);
      preset.prompt_order = clone(current.prompt_order ?? []);
      preset.extensions = clone(current.extensions ?? {});
      await manager.savePreset(name, preset, { skipUpdate: true });
    },
  };
}
