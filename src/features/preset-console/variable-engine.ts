/** Pure variable evaluation. Never call ST's variable helpers: those persist chat/settings. */
export type MacroEngine = 'legacy' | 'modern';
export interface VariablePart { text: string; definitionId?: string; contributors: string[] }
export interface VariableStep {
  id: string; key: string; global: boolean; entryId?: string;
  kind: 'context' | 'set' | 'append' | 'sum' | 'push';
  operand: string; before: string; after: string;
}
export interface VariableBinding { value: unknown; parts: VariablePart[]; chain: VariableStep[]; arrayOwners?: string[][]; uncertain?: boolean }
export interface VariableToken { raw: string; name: string; key?: string; value?: string; start: number; end: number; nested: boolean }
export const variableKey = (key: string, global: boolean) => `${global ? 'global' : 'local'}:${key}`;
export const variableNames = ['setvar', 'addvar', 'getvar', 'setglobalvar', 'addglobalvar', 'getglobalvar'];
/** Balanced outer macros; literal {{char}} inside a value must not truncate its enclosing set/add. */
export function scanMacros(text: string): VariableToken[] {
  const tokens: VariableToken[] = [];
  for (let start = text.indexOf('{{'); start >= 0;) {
    let at = start + 2, depth = 1, nested = false;
    while (at < text.length && depth) {
      if (text.slice(at, at + 2) === '{{') { depth++; nested = true; at += 2; }
      else if (text.slice(at, at + 2) === '}}') { depth--; at += 2; }
      else at++;
    }
    if (depth) { tokens.push({ raw: text.slice(start), name: 'unclosed', start, end: text.length, nested }); break; }
    const raw = text.slice(start, at), inner = raw.slice(2, -2);
    const split = inner.indexOf('::');
    const name = (split < 0 ? inner : inner.slice(0, split)).trim().toLowerCase();
    const rest = split < 0 ? undefined : inner.slice(split + 2);
    const valueAt = rest?.indexOf('::') ?? -1;
    tokens.push({ raw, name, start, end: at, nested, key: rest === undefined ? undefined : (valueAt < 0 ? rest : rest.slice(0, valueAt)).trim(), value: valueAt < 0 ? undefined : rest!.slice(valueAt + 2) });
    start = text.indexOf('{{', at);
  }
  return tokens;
}
export function readValue(value: unknown): string {
  // Native getLocalVariable checks the original value before numeric coercion (false/null become 0).
  const blank = typeof value === 'string' && value.trim() === '';
  return blank || Number.isNaN(Number(value)) ? String(value || '') : String(Number(value));
}

const owners = (chain: VariableStep[]) => [...new Set(chain.flatMap(s => s.entryId ? [s.entryId] : []))];
const part = (text: string, contributors: string[]): VariablePart => ({ text, contributors, definitionId: contributors.length === 1 ? contributors[0] : undefined });
export function seedBinding(key: string, global: boolean, value: unknown): VariableBinding {
  const text = readValue(value);
  return { value, parts: [part(text, [])], chain: [{ id: `context:${variableKey(key, global)}`, key, global, kind: 'context', operand: '', before: '', after: text }] };
}
export function writeBinding(key: string, global: boolean, operand: string, entryId: string, id: string, previous?: VariableBinding, add = false): { binding: VariableBinding; step: VariableStep } {
  const before = previous ? readValue(previous.value) : '';
  let value: unknown = operand, kind: VariableStep['kind'] = 'set';
  let arrayOwners: string[][] | undefined;
  let parts = [part(operand, [entryId])];
  const chain = add ? [...(previous?.chain ?? [{ ...seedBinding(key, global, 0).chain[0], id: `default:${variableKey(key, global)}` }])] : [];
  if (add) {
    // Matches ST addLocalVariable/addGlobalVariable, including falsy and numeric coercion.
    const current = (before.trim() === '' || Number.isNaN(Number(before)) ? before : Number(before)) || 0;
    let array: unknown;
    try { array = JSON.parse(String(current)); } catch { /* not an array */ }
    if (Array.isArray(array)) {
      kind = 'push';
      arrayOwners = previous?.arrayOwners ?? array.map(() => owners(previous?.chain ?? []));
      arrayOwners = [...arrayOwners, [entryId]];
      const values = [...array, operand];
      value = JSON.stringify(values);
      parts = [part('[', [])];
      values.forEach((item, i) => { if (i) parts.push(part(',', [])); parts.push(part(JSON.stringify(item), arrayOwners![i])); });
      parts.push(part(']', []));
    } else if (Number.isNaN(Number(operand)) || Number.isNaN(Number(current))) {
      kind = 'append';
      const prefix = String(current || '');
      value = prefix + operand;
      const previousParts = previous?.parts.map(p => ({ ...p, contributors: [...p.contributors] })) ?? [];
      parts = [...(previousParts.map(p => p.text).join('') === prefix ? previousParts : [part(prefix, owners(chain))]), part(operand, [entryId])];
    } else { kind = 'sum'; value = Number(current) + Number(operand); parts = [part(String(value), [...new Set([...owners(chain), entryId])])]; }
  }
  if (kind === 'sum' && chain.some(s => s.kind === 'context' && !s.id.startsWith('default:'))) parts = parts.map(p => ({ ...p, definitionId: undefined }));
  const step: VariableStep = { id, key, global, entryId, kind, operand, before, after: readValue(value) };
  chain.push(step);
  // set/get converts numeric strings. Preserve source attribution even if coercion changes text length.
  if (parts.map(p => p.text).join('') !== readValue(value)) parts = [part(readValue(value), owners(chain))];
  return { step, binding: { value, parts, chain, arrayOwners } };
}
export function stepLabel(step: VariableStep): string {
  const scope = step.global ? '全局 · ' : '';
  if (step.kind === 'context') return `${scope}${step.key} · 初值 ${step.after || '空'}`;
  if (step.kind === 'set') return `${scope}设置 ${step.key}`;
  return `${scope}${step.kind === 'append' ? '追加到' : step.kind === 'push' ? '加入数组' : '增加'} ${step.key}`;
}
