import { ConfigSchema, defaultConfig, type Config } from './config';
import { guessRule } from './parser';

/** Native properties stay intact: this model must never flatten away injection metadata. */
export interface NativeEntry {
  identifier: string;
  name?: string;
  content?: string;
  role?: string;
  marker?: boolean;
  injection_position?: number;
  injection_trigger?: string[];
  [key: string]: unknown;
}
export interface OrderEntry { identifier: string; enabled?: boolean; [key: string]: unknown }
export interface PresetDocument {
  prompts?: NativeEntry[];
  prompt_order?: { character_id: number | string; order: OrderEntry[] }[];
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface CatalogEntry {
  prompt: NativeEntry;
  placed: boolean;
  enabled: boolean;
  index: number;
  configuration: boolean;
}
export const cloneDocument = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const fingerprint = (value: unknown): string => {
  const normalize = (x: any): any => Array.isArray(x) ? x.map(normalize)
    : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, normalize(x[k])])) : x;
  return JSON.stringify(normalize(value));
};
export function orderOf(document: PresetDocument): OrderEntry[] {
  return document.prompt_order?.find(x => String(x.character_id) === '100001')?.order ?? [];
}
export function mutableOrder(document: PresetDocument): OrderEntry[] {
  document.prompt_order ??= [];
  let group = document.prompt_order.find(x => String(x.character_id) === '100001');
  if (!group) document.prompt_order.push(group = { character_id: 100001, order: [] });
  return group.order;
}
export function isConfiguration(prompt: NativeEntry): boolean {
  return ['SPresetSettings', 'presetEasyToggle:config', 'presetEasyToggle:backup'].includes(prompt.identifier)
    || /^\[⚙️CONSOLE-CONFIG(?:-BACKUP)?\]$/.test(prompt.name ?? '');
}
export function catalog(document: PresetDocument): CatalogEntry[] {
  const byId = new Map((document.prompts ?? []).map(p => [p.identifier, p]));
  const seen = new Set<string>();
  const result: CatalogEntry[] = [];
  for (const [index, entry] of orderOf(document).entries()) {
    const prompt = byId.get(entry.identifier);
    if (!prompt || seen.has(entry.identifier)) continue;
    seen.add(entry.identifier);
    result.push({ prompt, placed: true, enabled: entry.enabled ?? true, index, configuration: isConfiguration(prompt) });
  }
  for (const prompt of document.prompts ?? []) if (!seen.has(prompt.identifier)) {
    result.push({ prompt, placed: false, enabled: false, index: -1, configuration: isConfiguration(prompt) });
  }
  return result;
}
export function documentDiagnostics(document: PresetDocument): string[] {
  const ids = new Set((document.prompts ?? []).map(p => p.identifier));
  const result = orderOf(document).filter(e => !ids.has(e.identifier)).map(e => `发送顺序中找不到这个条目：${e.identifier}`);
  const duplicates = new Set<string>();
  for (const p of document.prompts ?? []) {
    if (duplicates.has(p.identifier)) result.push(`多个条目使用了相同编号：${p.identifier}`);
    duplicates.add(p.identifier);
  }
  return result;
}
export function readDocumentConfig(document: PresetDocument): { config: Config; corrupt: boolean } {
  const storage = document.extensions?.presetEasyToggle as { config?: string; backup?: string } | undefined;
  const legacy = document.prompts?.filter(p => /^\[⚙️CONSOLE-CONFIG(?:-BACKUP)?\]$/.test(p.name ?? '')).map(p => p.content) ?? [];
  const candidates = [storage?.config, storage?.backup, ...legacy].filter(raw => raw !== undefined);
  if (!candidates.length) return { config: defaultConfig(), corrupt: false };
  for (const raw of candidates) {
    try { if (raw) return { config: ConfigSchema.parse(JSON.parse(raw)), corrupt: false }; } catch { /* try backup */ }
  }
  return { config: defaultConfig(), corrupt: true };
}
export function writeDocumentConfig(document: PresetDocument, config: Config): void {
  const checked = ConfigSchema.parse(config);
  document.extensions ??= {};
  const storage = document.extensions.presetEasyToggle as Record<string, unknown> | undefined;
  document.extensions.presetEasyToggle = { ...storage, config: JSON.stringify(checked), backup: JSON.stringify(checked) };
}
export function migratePlans(config: Config): void {
  if (config.plansMigrated) return;
  for (const mode of config.scenarios) {
    const snapshots = mode.snapshots.length ? mode.snapshots
      : Object.keys(mode.selections).length ? [{ id: '__legacy_default__', name: '默认', selections: mode.selections }] : [];
    for (const snapshot of snapshots) config.plans.push({
      id: `legacy:${mode.id}:${snapshot.id}`, name: `${mode.name} / ${snapshot.name}`,
      scope: 'partial', selections: { ...snapshot.selections },
    });
  }
  config.plansMigrated = true;
}
export function toggleDraftEntry(document: PresetDocument, config: Config, id: string, enabled: boolean): void {
  const entry = catalog(document).find(e => e.prompt.identifier === id);
  if (!entry || entry.configuration) return;
  // Native placeholders have their own switch, independent of virtual grouping rules.
  if (entry.prompt.marker) {
    const order = mutableOrder(document);
    const existing = order.find(e => e.identifier === id);
    if (existing) existing.enabled = enabled;
    else if (enabled) order.push({ identifier: id, enabled: true });
    return;
  }
  const meta = config.entryMeta[id];
  const alwaysOn = meta?.alwaysOn ?? (entry.prompt.name ?? '').includes('📍');
  if (alwaysOn && !enabled) throw new Error('这个条目已锁定为开启。请先在「快速分组」中点击「允许关闭」，再关闭它。');
  const groupId = meta?.groupId;
  const custom = config.customGroups.find(g => g.id === groupId);
  // Header membership is resolved without reordering native prompts.
  let nativeGroup: string | undefined;
  const nativeMembership = new Map<string, string>();
  for (const e of catalog(document)) {
    if (!e.placed) continue;
    if (e.prompt.name === '⚙️CUSTOMIZATION_END') { nativeGroup = undefined; continue; }
    if (/^\s*\[\d+-.*\]\s*$/.test(e.prompt.name ?? '') && !(e.prompt.content ?? '').trim()) nativeGroup = e.prompt.identifier;
    else if (nativeGroup) nativeMembership.set(e.prompt.identifier, nativeGroup);
  }
  const effectiveGroupId = groupId ?? nativeMembership.get(id);
  const members = catalog(document).filter(e => (config.entryMeta[e.prompt.identifier]?.groupId ?? nativeMembership.get(e.prompt.identifier)) === effectiveGroupId);
  const group = custom ?? config.groups.find(g => g.headerId === effectiveGroupId)
    ?? (effectiveGroupId ? { rule: guessRule(members.map(e => ({
      id: e.prompt.identifier, name: e.prompt.name ?? '', content: e.prompt.content ?? '', enabled: e.enabled,
      position: e.index, inManagedRegion: true,
      alwaysOn: config.entryMeta[e.prompt.identifier]?.alwaysOn ?? (e.prompt.name ?? '').includes('📍'),
      input: config.entryMeta[e.prompt.identifier]?.kind === 'input' || (e.prompt.name ?? '').includes('✍️'),
    }))), required: false } : undefined);
  const plain = members.filter(e => !(config.entryMeta[e.prompt.identifier]?.alwaysOn ?? (e.prompt.name ?? '').includes('📍'))
    && config.entryMeta[e.prompt.identifier]?.kind !== 'input' && !(e.prompt.name ?? '').includes('✍️'));
  const isPlain = plain.some(e => e.prompt.identifier === id);
  if (!enabled && isPlain && group?.rule !== 'folder' && group?.required && !plain.some(e => e.prompt.identifier !== id && e.enabled)) throw new Error('这个分组要求至少开启一项，不能关闭最后一项。');
  const order = mutableOrder(document);
  if (enabled && isPlain && group?.rule === 'single') for (const e of order) {
    if (plain.some(p => p.prompt.identifier === e.identifier)) e.enabled = false;
  }
  let position = order.find(e => e.identifier === id);
  if (!position) order.push(position = { identifier: id, enabled });
  position.enabled = enabled;
}
export function applyPlan(document: PresetDocument, selections: Record<string, boolean>): void {
  for (const e of mutableOrder(document)) if (Object.hasOwn(selections, e.identifier)) e.enabled = selections[e.identifier];
}
export function planMatches(document: PresetDocument, selections: Record<string, boolean>): boolean {
  const states = new Map(orderOf(document).map(e => [e.identifier, e.enabled ?? true]));
  return Object.keys(selections).length > 0 && Object.entries(selections).every(([id, enabled]) => states.get(id) === enabled);
}
export function capturePlan(document: PresetDocument, ids?: string[]): Record<string, boolean> {
  const selected = ids ? new Set(ids) : null;
  return Object.fromEntries(catalog(document).filter(e => e.placed && !e.prompt.marker && !e.configuration
    && !['⚙️CUSTOMIZATION_START', '⚙️CUSTOMIZATION_END'].includes(e.prompt.name ?? '')
    && !(/^\s*\[\d+-.*\]\s*$/.test(e.prompt.name ?? '') && !(e.prompt.content ?? '').trim())
    && (!selected || selected.has(e.prompt.identifier)))
    .map(e => [e.prompt.identifier, e.enabled]));
}
export interface Insertion { anchor: string | null; side: 'before' | 'after' }
export function copyEntries(source: PresetDocument, target: PresetDocument, ids: string[], insertion: Insertion, uuid: () => string): string[] {
  const selected = new Set(ids);
  const entries = catalog(source).filter(e => selected.has(e.prompt.identifier) && !e.prompt.marker && !e.configuration);
  if (!entries.length) throw new Error('请先在来源预设中勾选要复制的文本条目。');
  const targetOrder = orderOf(target);
  let at = insertion.anchor === null ? (insertion.side === 'before' ? 0 : targetOrder.length) : targetOrder.findIndex(e => e.identifier === insertion.anchor);
  if (at < 0) throw new Error('原来的粘贴位置已不存在，请重新点击目标预设中的粘贴位置。');
  if (insertion.anchor !== null && insertion.side === 'after') at++;
  const used = new Set((target.prompts ?? []).map(p => p.identifier));
  const copied = entries.map(e => {
    const id = uuid();
    if (used.has(id)) throw new Error('新条目的编号与已有条目重复，本次没有复制。请重试。');
    used.add(id);
    return { ...cloneDocument(e.prompt), identifier: id };
  });
  target.prompts ??= [];
  target.prompts.push(...copied);
  mutableOrder(target).splice(at, 0, ...copied.map((p, i) => ({ identifier: p.identifier, enabled: entries[i].enabled })));
  return copied.map(p => p.identifier);
}
/** Undo only the fresh IDs from one paste; keep all other draft edits intact. */
export function removeCopiedEntries(document: PresetDocument, config: Config, copiedIds: string[]): void {
  const ids = new Set(copiedIds);
  document.prompts = (document.prompts ?? []).filter(p => !ids.has(p.identifier));
  for (const group of document.prompt_order ?? []) group.order = group.order.filter(e => !ids.has(e.identifier));
  for (const id of ids) delete config.entryMeta[id];
  for (const plan of config.plans) for (const id of ids) delete plan.selections[id];
  for (const mode of config.scenarios) {
    for (const id of ids) delete mode.selections[id];
    for (const snapshot of mode.snapshots) for (const id of ids) delete snapshot.selections[id];
  }
}
export function changeSummary(before: PresetDocument, after: PresetDocument): string[] {
  const result: string[] = [];
  const previous = new Map(catalog(before).map(e => [e.prompt.identifier, e]));
  for (const e of catalog(after)) {
    const old = previous.get(e.prompt.identifier);
    const name = e.prompt.name || e.prompt.identifier;
    if (!old) result.push(`新增：${name}`);
    else {
      if (old.enabled !== e.enabled || old.placed !== e.placed) result.push(`${e.enabled ? '开启' : '关闭'}：${name}`);
      if (fingerprint(old.prompt) !== fingerprint(e.prompt)) result.push(`编辑：${name}`);
    }
  }
  if (fingerprint(before.extensions?.presetEasyToggle) !== fingerprint(after.extensions?.presetEasyToggle)) result.push('修改控制台设置');
  return result;
}
