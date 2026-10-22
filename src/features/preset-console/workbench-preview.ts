import { catalog, type CatalogEntry, type PresetDocument } from './workbench-model';
import { readValue, scanMacros, seedBinding, variableKey, variableNames, writeBinding, type MacroEngine, type VariableBinding, type VariablePart, type VariableStep } from './variable-engine';
export { stepLabel } from './variable-engine';
export type { VariableStep } from './variable-engine';
export interface MacroWrite { key: string; value: string; global: boolean; operation: 'set' | 'add'; step?: VariableStep; chain?: VariableStep[] }
export interface MacroRead { key: string; global: boolean; value?: string; chain?: VariableStep[]; contributors?: string[] }
export interface TextFragment extends VariablePart { sourceId: string; variable?: string; global?: boolean; chain?: VariableStep[] }
export interface ExpandedEntry {
  entry: CatalogEntry; text: string; fragments: TextFragment[]; writes: MacroWrite[]; reads: MacroRead[]; diagnostics: string[]; participating: boolean;
}
export interface ExpansionContext {
  user?: string; char?: string; input?: string; local?: Record<string, unknown>; global?: Record<string, unknown>;
  macroEngine?: MacroEngine; chatMessageCount?: number;
}
export interface ExpansionResult {
  entries: ExpandedEntry[]; kind: 'isolated-entry-expansion'; requestUnavailable: string;
}
export function macroReferences(content: string): { writes: MacroWrite[]; reads: MacroRead[] } {
  const writes: MacroWrite[] = [], reads: MacroRead[] = [];
  for (const t of scanMacros(content)) {
    if (t.name.startsWith('//')) continue;
    if (variableNames.includes(t.name) && t.key) {
      const global = t.name.includes('global');
      if (t.name.startsWith('get')) reads.push({ key: t.key, global });
      else if (t.value !== undefined) writes.push({ key: t.key, value: t.value, global, operation: t.name.startsWith('add') ? 'add' : 'set' });
    }
  }
  return { writes, reads };
}
const literal = (text: string, sourceId: string): TextFragment => ({ text, sourceId, contributors: [sourceId] });
function expand(entry: CatalogEntry, bindings: Map<string, VariableBinding>, context: ExpansionContext, participating: boolean): ExpandedEntry {
  const id = entry.prompt.identifier, raw = entry.prompt.content ?? '';
  const refs = macroReferences(raw), diagnostics: string[] = [], reads: MacroRead[] = [], writes: MacroWrite[] = [];
  let sequence = 0;
  const tokens = scanMacros(raw);
  const supported = (t: ReturnType<typeof scanMacros>[number]): boolean => variableNames.includes(t.name) && !!t.key && !t.key.includes('{{') && (t.name.startsWith('get') ? t.value === undefined : t.value !== undefined);
  const liveTokens = tokens.filter(t => !t.name.startsWith('//'));
  const unsafe = raw.includes('<%') || liveTokens.some(t => /^(?:\/?(?:if|else|elseif|each|while|for|when|unless|switch))(?:\s|$)/.test(t.name) || /^[.$]/.test(t.name)) || liveTokens.some(t => t.name === 'unclosed') || liveTokens.some(t => t.nested && (!variableNames.includes(t.name) || scanMacros(t.value ?? '').some(n => !['char', 'user', 'input', 'newline', 'noop'].includes(n.name) && !/[^\x00-\x7F]/.test(n.name))))
    || liveTokens.some(t => /^(?:add|inc|dec|set|delete|flush)(?:global)?var/.test(t.name) && !supported(t));
  if (unsafe) {
    diagnostics.push('这个条目包含暂不支持的嵌套宏或变量操作。预览会显示原文，不计算它对变量的修改。');
    // Refuse to fabricate downstream values derived from a write we could not evaluate.
    for (const token of liveTokens) {
      const guessed = [...token.raw.matchAll(/\{\{(?:set|add|inc|dec|delete|flush)(global)?var::([^:}]+)(?:::|\}\}|$)/gi)].map(m => ({ key: m[2].trim(), global: !!m[1] }));
      const shorthand = token.name.match(/^([.$])([\w-]+)/);
      if (shorthand) guessed.push({ key: shorthand[2], global: shorthand[1] === '$' });
      for (const write of guessed) bindings.set(variableKey(write.key, write.global), { ...seedBinding(write.key, write.global, ''), uncertain: true });
    }
    return { entry, text: raw, fragments: [literal(raw, id)], ...refs, diagnostics, participating };
  }
  const execute = (t: ReturnType<typeof scanMacros>[number]): TextFragment[] | null => {
    if (t.name.startsWith('//')) return [];
    if (!supported(t)) return null;
    const key = t.key!, global = t.name.includes('global'), binding = bindings.get(variableKey(key, global));
    if (t.name.startsWith('get')) {
      if (!binding || binding.uncertain) {
        diagnostics.push(`无法确定${global ? '全局' : ''}变量「${key}」的值，预览中保留原来的宏。`);
        reads.push({ key, global });
        return [{ ...literal(t.raw, id), variable: key, global }];
      }
      const contributors = [...new Set(binding.chain.flatMap(s => s.entryId ? [s.entryId] : []))];
      reads.push({ key, global, value: readValue(binding.value), chain: binding.chain, contributors });
      return binding.parts.map(p => ({ ...p, sourceId: id, variable: key, global, chain: binding.chain }));
    }
    if (binding?.uncertain && t.name.startsWith('add')) { diagnostics.push(`无法确定追加前「${key}」的值，预览中保留原来的追加宏。`); writes.push({ key, global, value: t.value!, operation: 'add' }); return [literal(t.raw, id)]; }
    const operand = context.macroEngine === 'modern' ? t.value!.trim().replace(/\{\{noop\}\}/gi, '').replace(/\{\{newline\}\}/gi, '\n') : t.value!; // Context placeholders deliberately stay literal, including inside set/add values.
    const { binding: next, step } = writeBinding(key, global, operand, id, `${id}:${sequence++}`, binding, t.name.startsWith('add'));
    if (t.name.startsWith('add') && !binding) diagnostics.push(`追加前没有找到「${key}」的值，暂按默认值计算。角色卡等其他内容中的变量操作没有计入。`);
    bindings.set(variableKey(key, global), next);
    writes.push({ key, value: operand, global, operation: t.name.startsWith('add') ? 'add' : 'set', step, chain: next.chain });
    return [];
  };
  let fragments: TextFragment[];
  if (context.macroEngine === 'modern') {
    fragments = []; let at = 0;
    for (const t of tokens) { fragments.push(literal(raw.slice(at, t.start), id)); fragments.push(...(execute(t) ?? [literal(t.raw, id)])); at = t.end; }
    fragments.push(literal(raw.slice(at), id));
  } else {
    fragments = [literal(raw, id)];
    // ST legacy variable pass order: set, add, get, then the global counterparts.
    for (const name of variableNames) {
      const next: TextFragment[] = [];
      for (const f of fragments) {
        // Do not execute a variable expression introduced by an already-expanded read.
        if (f.variable) { next.push(f); continue; }
        let at = 0;
        for (const t of scanMacros(f.text)) {
          if (t.name !== name && !t.name.startsWith('//')) continue;
          next.push({ ...f, text: f.text.slice(at, t.start) });
          next.push(...(execute(t) ?? [{ ...f, text: t.raw }])); at = t.end;
        }
        next.push({ ...f, text: f.text.slice(at) });
      }
      fragments = next;
    }
  }
  fragments = fragments.map(f => ({ ...f, text: f.text.replace(/\{\{noop\}\}/gi, '').replace(/\{\{newline\}\}/gi, '\n') }));
  for (const t of tokens) {
    if (variableNames.includes(t.name) && !supported(t)) diagnostics.push(`暂时无法计算这个变量宏，预览中保留原文：${t.raw}`);
    if (!variableNames.includes(t.name) && !['char', 'user', 'input', 'newline', 'noop', 'trim'].includes(t.name) && !t.name.startsWith('//') && /^[a-z_]/i.test(t.name)) diagnostics.push(`暂时无法计算这个宏，预览中保留原文：${t.raw}`);
  }
  if (entry.prompt.marker) return { entry, text: '', fragments: [], writes: [], reads: [], diagnostics: [], participating };
  if (entry.prompt.injection_trigger?.length && !entry.prompt.injection_trigger.includes('normal')) diagnostics.push('此条目不会用于普通聊天生成。');
  return { entry, text: fragments.map(f => f.text).join(''), fragments: fragments.filter(f => f.text), writes, reads, diagnostics: [...new Set(diagnostics)], participating };
}
export function expandDocument(document: PresetDocument, context: ExpansionContext = {}): ExpansionResult {
  const bindings = new Map<string, VariableBinding>();
  for (const [global, values] of [[false, context.local], [true, context.global]] as const) for (const [key, value] of Object.entries(values ?? {})) bindings.set(variableKey(key, global), seedBinding(key, global, value));
  const entries = catalog(document).map(entry => {
    const participating = entry.placed && entry.enabled && !entry.configuration && !entry.prompt.marker && (!entry.prompt.injection_trigger?.length || entry.prompt.injection_trigger.includes('normal'));
    // Values/chains are immutable; OFF entries receive a disposable map at their position.
    return expand(entry, participating ? bindings : new Map(bindings), context, participating);
  });
  return { kind: 'isolated-entry-expansion', entries, requestUnavailable: '这里只预览预设文本和变量结果。{{char}}、{{user}} 等宏保留原样，角色卡、世界书和聊天记录用占位块表示。不计算这些占位内容中的变量操作，也不模拟超长内容裁剪或其他扩展对请求的修改。' };
}
export function relatedEntries(result: ExpansionResult, id: string): ExpandedEntry[] {
  const entry = result.entries.find(e => e.entry.prompt.identifier === id);
  if (!entry) return [];
  const keys = new Set([...entry.reads, ...entry.writes].map(r => variableKey(r.key, r.global)));
  return result.entries.filter(e => e.entry.prompt.identifier !== id && [...e.reads, ...e.writes].some(r => keys.has(variableKey(r.key, r.global))));
}
export function copyDiagnostics(source: ExpansionResult, target: ExpansionResult, ids: string[]): string[] {
  const selected = source.entries.filter(e => ids.includes(e.entry.prompt.identifier)), selectedIds = new Set(ids), result = new Set<string>();
  const keyOf = (r: MacroRead) => variableKey(r.key, r.global);
  for (const entry of selected) {
    for (const read of entry.reads) {
      const available = [...selected, ...target.entries.filter(e => e.participating)].some(e => e.writes.some(w => keyOf(w) === keyOf(read)));
      if (!available) result.add(`所选条目和目标预设中，都没有设置变量「${read.key}」的条目。`);
    }
    for (const write of entry.writes) {
      if (write.operation === 'add') {
        result.add(`「${write.key}」的结果取决于粘贴位置前的变量值，请检查右侧预览。`);
        for (const step of write.chain ?? []) if (step.entryId && !selectedIds.has(step.entryId)) result.add(`此前贡献：${source.entries.find(e => e.entry.prompt.identifier === step.entryId)?.entry.prompt.name || step.entryId}`);
      }
      if (!target.entries.some(e => e.reads.some(r => keyOf(r) === keyOf(write))) && !selected.some(e => e.reads.some(r => keyOf(r) === keyOf(write)))) result.add(`目标预设没有使用变量「${write.key}」的条目。`);
      for (const e of target.entries) if (e.writes.some(w => keyOf(w) === keyOf(write))) result.add(`目标条目「${e.entry.prompt.name || e.entry.prompt.identifier}」也会修改变量「${write.key}」，请检查执行顺序和右侧结果。`);
    }
    if (target.entries.some(e => e.entry.prompt.name === entry.entry.prompt.name)) result.add(`目标预设已有同名条目「${entry.entry.prompt.name}」。复制会新增一条，不会覆盖原条目。`);
    for (const e of relatedEntries(source, entry.entry.prompt.identifier)) if (!selectedIds.has(e.entry.prompt.identifier)) result.add(`可选关联条目：${e.entry.prompt.name || e.entry.prompt.identifier}`);
  }
  return [...result];
}
