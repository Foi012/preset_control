import { cloneDocument, fingerprint, type PresetDocument } from './workbench-model';
import type { ExpansionContext } from './workbench-preview';

interface PresetManager {
  getSelectedPresetName(): string;
  getCompletionPresetByName(name: string): PresetDocument | undefined;
  getPresetList(): { presets: PresetDocument[]; preset_names: string[] | Record<string, number> };
  savePreset(name: string, settings: PresetDocument, options: { skipUpdate: boolean }): Promise<void>;
}
interface Context {
  getPresetManager(api: string): PresetManager | null;
  chatCompletionSettings: PresetDocument;
  chatMetadata?: { variables?: Record<string, unknown> };
  extensionSettings?: { variables?: { global?: Record<string, unknown> } };
  name1?: string; name2?: string;
  powerUserSettings?: { experimental_macro_engine?: boolean };
  chat?: { is_system?: boolean }[];
  eventTypes?: Record<string, string>;
  eventSource?: { emit(event: string): unknown };
  saveSettingsDebounced?: () => void;
}
export interface PresetSnapshot { name: string; document: PresetDocument; baseline: string; diskBaseline: string }
export interface PresetRepository {
  list(): string[];
  current(): string;
  read(name: string): PresetSnapshot;
  save(snapshot: PresetSnapshot, document: PresetDocument): Promise<PresetSnapshot>;
  expansionContext(): ExpansionContext;
}
export function nativePresetRepository(getContext: () => Context = () => {
  const ctx = globalThis.SillyTavern?.getContext?.();
  if (!ctx) throw new Error('无法连接 SillyTavern，请刷新页面后再试。');
  return ctx as Context;
}): PresetRepository {
  const manager = () => {
    const m = getContext().getPresetManager('openai');
    if (!m) throw new Error('无法读取 SillyTavern 的预设列表，请刷新页面后再试。');
    return m;
  };
  function read(name: string): PresetSnapshot {
    const m = manager();
    const saved = m.getCompletionPresetByName(name);
    if (!saved) throw new Error(`找不到预设：${name}`);
    const document = cloneDocument(saved);
    if (m.getSelectedPresetName() === name) {
      const live = getContext().chatCompletionSettings;
      document.prompts = cloneDocument(live.prompts ?? []);
      document.prompt_order = cloneDocument(live.prompt_order ?? []);
      document.extensions = cloneDocument(live.extensions ?? {});
    }
    return { name, document, baseline: fingerprint(document), diskBaseline: fingerprint(saved) };
  }
  return {
    list: () => {
      const names = manager().getPresetList().preset_names;
      return Array.isArray(names) ? [...names] : Object.keys(names);
    },
    current: () => manager().getSelectedPresetName(),
    read,
    expansionContext: () => {
      const ctx = getContext();
      return { user: ctx.name1, char: ctx.name2, local: cloneDocument(ctx.chatMetadata?.variables ?? {}), global: cloneDocument(ctx.extensionSettings?.variables?.global ?? {}), macroEngine: ctx.powerUserSettings?.experimental_macro_engine ? 'modern' : 'legacy', chatMessageCount: ctx.chat?.filter(m => !m.is_system).length };
    },
    save: async (snapshot, document) => {
      const latest = read(snapshot.name);
      if (latest.baseline !== snapshot.baseline || latest.diskBaseline !== snapshot.diskBaseline) throw new Error('预设已在别处修改。为避免覆盖，已停止保存。你的编辑仍保留在工作台，请先核对外部修改。');
      const m = manager();
      const output = cloneDocument(document);
      // Never use updateList: ST selects that preset and triggers a preset switch.
      await m.savePreset(snapshot.name, output, { skipUpdate: true });
      const stillUnchanged = read(snapshot.name).baseline === snapshot.baseline;
      const { presets, preset_names } = m.getPresetList();
      const index = Array.isArray(preset_names) ? preset_names.indexOf(snapshot.name) : preset_names[snapshot.name];
      if (index === undefined || index < 0) throw new Error('预设文件已保存，但预设列表发生变化，工作台未能更新。请核对已保存版本；你的编辑仍保留在工作台。');
      presets[index] = cloneDocument(output);
      if (m.getSelectedPresetName() === snapshot.name) {
        if (!stillUnchanged) throw new Error('预设文件已保存，但保存过程中，正在使用的预设又被修改。本次没有替换正在使用的内容，请核对已保存版本和工作台中的修改。');
        const ctx = getContext();
        ctx.chatCompletionSettings.prompts = cloneDocument(output.prompts ?? []);
        ctx.chatCompletionSettings.prompt_order = cloneDocument(output.prompt_order ?? []);
        ctx.chatCompletionSettings.extensions = cloneDocument(output.extensions ?? {});
        ctx.saveSettingsDebounced?.();
        for (const key of ['SETTINGS_UPDATED', 'OAI_PRESET_CHANGED_AFTER']) {
          const event = ctx.eventTypes?.[key];
          if (event) void ctx.eventSource?.emit(event);
        }
      }
      return read(snapshot.name);
    },
  };
}
