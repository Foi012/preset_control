import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { expandDocument, macroReferences } from './workbench-preview';
import { sendingLayout, markerLabel } from './workbench-layout';
import { defaultConfig } from './config';
import { cloneDocument, fingerprint, toggleDraftEntry, type NativeEntry, type PresetDocument } from './workbench-model';
import { scanMacros, writeBinding, readValue } from './variable-engine';
function document(contents: string[]): PresetDocument {
  return { prompts: contents.map((content, i) => ({ identifier: String(i), name: `条目 ${i}`, content, role: 'system' })), prompt_order: [{ character_id: 100001, order: contents.map((_, i) => ({ identifier: String(i), enabled: true })) }] };
}
const evaluate = (contents: string[], modern = false) => expandDocument(document(contents), { macroEngine: modern ? 'modern' : 'legacy' });
const text = (contents: string[], modern = false) => evaluate(contents, modern).entries.at(-1)!.text;
let checked = 0;
function check(name: string, run: () => void): void { run(); checked++; console.log(`✓ ${name}`); }
check('numeric addition, negatives and numeric strings', () => {
  assert.equal(text(['{{setvar::n::001}}', '{{addvar::n::2}}', '{{addvar::n::-1}}', '{{getvar::n}}']), '2');
});
check('string appends do not invent separators', () => assert.equal(text(['{{setvar::rules::保持简洁。}}', '{{addvar::rules::避免重复。}}', '{{getvar::rules}}']), '保持简洁。避免重复。'));
check('multiple appends preserve per-fragment origins', () => {
  const last = evaluate(['{{setvar::r::A}}', '{{addvar::r::B}}', '{{addvar::r::C}}', '{{getvar::r}}']).entries[3];
  assert.deepEqual(last.fragments.map(p => [p.text, p.definitionId]), [['A', '0'], ['B', '1'], ['C', '2']]);
  assert.deepEqual(last.reads[0].chain?.map(s => s.kind), ['set', 'append', 'append']);
});
check('numbers retain all contributors instead of a fictitious last-writer source', () => {
  const read = evaluate(['{{setvar::n::10}}', '{{addvar::n::2}}', '{{getvar::n}}']).entries[2];
  assert.equal(read.text, '12'); assert.equal(read.fragments[0].definitionId, undefined);
  assert.deepEqual(read.fragments[0].contributors, ['0', '1']);
});
check('array append preserves native JSON and element attribution', () => {
  const read = evaluate(['{{setvar::a::["A"]}}', '{{addvar::a::2}}', '{{getvar::a}}']).entries[2];
  assert.equal(read.text, '["A","2"]');
  assert.deepEqual(read.fragments.filter(p => p.definitionId).map(p => [p.text, p.definitionId]), [['"A"', '0'], ['"2"', '1']]);
});
check('set resets current contributors and does not mutate earlier read snapshots', () => {
  const result = evaluate(['{{setvar::r::A}}', '{{addvar::r::B}}', '{{getvar::r}}', '{{setvar::r::C}}', '{{getvar::r}}']);
  assert.equal(result.entries[2].text, 'AB'); assert.equal(result.entries[4].text, 'C');
  assert.deepEqual(result.entries[4].reads[0].contributors, ['3']);
});
check('typed chat snapshots follow native getter coercion', () => {
  assert.equal(readValue(false), '0'); assert.equal(readValue(true), '1'); assert.equal(readValue(null), '0'); assert.equal(readValue(undefined), ''); assert.equal(readValue(' '), ' ');
});
check('local and global namespaces remain separate', () => assert.equal(text(['{{setvar::x::L}}{{setglobalvar::x::G}}', '{{addvar::x::a}}{{addglobalvar::x::b}}', '{{getvar::x}}|{{getglobalvar::x}}']), 'La|Gb'));
check('default numeric/string/array behavior matches native defaults', () => {
  assert.equal(text(['{{addvar::x::2}}', '{{getvar::x}}']), '2');
  assert.equal(text(['{{addvar::x::hello}}', '{{getvar::x}}']), 'hello');
  assert.equal(text(['{{setvar::x::0}}', '{{addvar::x::hello}}', '{{getvar::x}}']), 'hello');
});
check('chat snapshot stays unchanged and repeat previews never accumulate', () => {
  const context = { local: { n: '10' }, global: { g: 'X' } }, d = document(['{{addvar::n::2}}', '{{getvar::n}}']);
  const baseline = fingerprint({ d, context });
  assert.equal(expandDocument(d, context).entries[1].text, '12'); assert.equal(expandDocument(d, context).entries[1].text, '12');
  assert.equal(fingerprint({ d, context }), baseline);
});
check('OFF and unplaced adds never affect downstream reads', () => {
  const d = document(['{{setvar::x::A}}', '{{addvar::x::B}}', '{{getvar::x}}']);
  d.prompt_order![0].order[1].enabled = false; d.prompts!.push({ identifier: 'unplaced', content: '{{addvar::x::C}}' });
  const result = expandDocument(d); assert.equal(result.entries[2].text, 'A'); assert.equal(result.entries[1].writes[0].value, 'B');
});
check('non-normal triggers cannot contribute to ordinary output', () => {
  const d = document(['{{setvar::x::A}}', '{{addvar::x::B}}', '{{getvar::x}}']); d.prompts![1].injection_trigger = ['quiet'];
  assert.equal(expandDocument(d).entries[2].text, 'A');
});
check('legacy and modern replacement order are explicitly different', () => {
  const content = '{{setvar::n::1}}{{getvar::n}}|{{addvar::n::2}}{{getvar::n}}';
  assert.equal(text([content]), '3|3'); assert.equal(text([content], true), '1|3');
});
check('balanced values retain char/user placeholders and literal Chinese braces', () => {
  assert.equal(text(['{{setvar::r::{{char}} 对 {{user}} 说：{{正文内容}}}}', '{{addvar::r::，继续。}}', '{{getvar::r}}']), '{{char}} 对 {{user}} 说：{{正文内容}}，继续。');
  assert.equal(text(['{{char}} {{user}} {{正文内容}}']), '{{char}} {{user}} {{正文内容}}');
  assert.equal(scanMacros('{{setvar::r::{{char}}!}}')[0].value, '{{char}}!');
});
check('comments cannot write variables or appear in output', () => { const result = evaluate(['{{setvar::x::A}}', '{{// {{addvar::x::B}} }}', '{{getvar::x}}']); assert.equal(result.entries[1].text, ''); assert.equal(result.entries[2].text, 'A'); });
check('unsupported nested variables poison uncertain values instead of pretending success', () => {
  const result = evaluate(['{{setvar::x::old}}', '{{setvar::x::{{getvar::other}}}}', '{{addvar::x::B}}', '{{getvar::x}}']);
  assert.equal(result.entries[3].text, '{{getvar::x}}'); assert.ok(result.entries[1].diagnostics.length); assert.ok(result.entries[2].diagnostics.length);
});
check('unsupported control blocks and shorthand cannot silently mutate or retain a known value', () => {
  assert.equal(text(['{{setvar::x::old}}', '{{if false}}{{setvar::x::A}}{{/if}}', '{{getvar::x}}']), '{{getvar::x}}');
  assert.equal(text(['{{setvar::x::10}}', '{{.x += 2}}', '{{getvar::x}}']), '{{getvar::x}}');
  assert.equal(text(['{{setvar::x::old}}', '{{setvar::x::broken', '{{getvar::x}}']), '{{getvar::x}}');
});
check('unknown read stays visible with a diagnostic', () => {
  const entry = evaluate(['{{getvar::missing}}']).entries[0]; assert.equal(entry.text, '{{getvar::missing}}'); assert.ok(entry.diagnostics.length);
});
check('add references are recognized and comment bodies are excluded', () => {
  assert.equal(macroReferences('{{addglobalvar::r::B}}').writes[0].operation, 'add');
  assert.equal(macroReferences('{{// {{setvar::hidden::X}} }}').writes.length, 0);
});
check('sending layout inserts depth prompts between history placeholders', () => {
  const d = document(['first', 'depth0', 'depth2', 'last']);
  d.prompts!.splice(1, 0, { identifier: 'chatHistory', marker: true, name: 'Renamed' });
  d.prompt_order![0].order.splice(1, 0, { identifier: 'chatHistory', enabled: true });
  Object.assign(d.prompts!.find(p => p.identifier === '1')!, { injection_position: 1, injection_depth: 0 });
  Object.assign(d.prompts!.find(p => p.identifier === '2')!, { injection_position: 1, injection_depth: 2 });
  const layout = sendingLayout(expandDocument(d), { chatMessageCount: 3 });
  assert.deepEqual(layout.entries.map(e => e.entry.prompt.marker ? markerLabel(e) : e.text), ['first', '聊天记录 · 1 条', 'depth2', '聊天记录 · 2 条', 'depth0', 'last']);
  assert.equal(fingerprint(d), fingerprint(cloneDocument(d)));
});
check('native marker identity is independent of display name', () => {
  const d = document(['']); Object.assign(d.prompts![0], { identifier: 'worldInfoBefore', name: '↑Char', marker: true }); d.prompt_order![0].order[0].identifier = 'worldInfoBefore';
  assert.equal(markerLabel(expandDocument(d).entries[0]), '世界书 · 前置');
});
check('injection order and role priority match native reverse-history grouping', () => {
  const d = document(['A', 'B', 'C', 'D']);
  for (const [i, p] of d.prompts!.entries()) Object.assign(p, { injection_position: 1, injection_depth: 1, injection_order: i === 3 ? 50 : 100, role: ['system', 'user', 'assistant', 'system'][i] });
  d.prompts!.unshift({ identifier: 'chatHistory', marker: true }); d.prompt_order![0].order.unshift({ identifier: 'chatHistory', enabled: true });
  assert.deepEqual(sendingLayout(expandDocument(d), { chatMessageCount: 1 }).entries.filter(e => !e.entry.prompt.marker).map(e => e.text), ['D', 'C', 'B', 'A']);
});
check('missing chat context is diagnosed rather than guessed', () => {
  const d = document(['depth']); d.prompts![0].injection_position = 1;
  assert.ok(sendingLayout(expandDocument(d), {}).diagnostics.length);
});
check('disabled native placeholders remain at their document positions', () => {
  const d = document(['before', '', 'plain A', 'plain B', 'plain C', '', 'after']);
  Object.assign(d.prompts![1], { identifier: 'charDescription', name: 'Role', marker: true });
  Object.assign(d.prompts![5], { identifier: 'chatHistory', name: 'History', marker: true });
  d.prompt_order![0].order[1] = { identifier: 'charDescription', enabled: false };
  d.prompt_order![0].order[5] = { identifier: 'chatHistory', enabled: false };
  for (const i of [2, 3, 4]) Object.assign(d.prompts![i], { injection_position: 1, injection_depth: 6, injection_order: 99 });
  const preview = sendingLayout(expandDocument(d), { chatMessageCount: 4 });
  assert.deepEqual(preview.entries.map(e => e.entry.prompt.identifier), ['0', 'charDescription', 'chatHistory', '6']);
  assert.deepEqual(preview.unresolved.map(e => e.text), ['plain A', 'plain B', 'plain C']);
  assert.ok(preview.unresolvedReason.includes('未开启'));
  assert.equal(preview.entries.find(e => e.entry.prompt.identifier === 'chatHistory')!.entry.enabled, false);
  const before = fingerprint(d);
  sendingLayout(expandDocument(d), { chatMessageCount: 4 });
  assert.equal(fingerprint(d), before);
  const config = defaultConfig();
  toggleDraftEntry(d, config, 'chatHistory', true);
  const fixed = sendingLayout(expandDocument(d), { chatMessageCount: 4 });
  assert.equal(fixed.unresolved.length, 0);
  assert.deepEqual(fixed.entries.filter(e => !e.entry.prompt.marker).map(e => e.text), ['before', 'plain A', 'plain B', 'plain C', 'after']);
  assert.equal(d.prompt_order![0].order[1].enabled, false);
});
check('unavailable chat length preserves depth texts without claiming an order', () => {
  const d = document(['depth', '']); d.prompts![0].injection_position = 1;
  Object.assign(d.prompts![1], { identifier: 'chatHistory', marker: true });
  d.prompt_order![0].order[1].identifier = 'chatHistory';
  const layout = sendingLayout(expandDocument(d), {});
  assert.deepEqual(layout.unresolved.map(e => e.text), ['depth']);
  assert.ok(layout.entries.some(e => e.entry.prompt.identifier === 'chatHistory'));
  assert.ok(layout.unresolvedReason.includes('长度'));
});
check('missing history marker never silently drops enabled depth entries', () => {
  const d = document(['depth']); d.prompts![0].injection_position = 1;
  const layout = sendingLayout(expandDocument(d), { chatMessageCount: 3 });
  assert.deepEqual(layout.unresolved.map(e => e.entry.prompt.identifier), ['0']);
});
check('zero-message history remains visible beside depth entries', () => {
  const d = document(['', 'depth']);
  Object.assign(d.prompts![0], { identifier: 'chatHistory', marker: true }); d.prompt_order![0].order[0].identifier = 'chatHistory';
  d.prompts![1].injection_position = 1;
  const layout = sendingLayout(expandDocument(d), { chatMessageCount: 0 });
  assert.equal(layout.entries.filter(e => e.entry.prompt.marker).length, 1);
  assert.ok(layout.entries.some(e => e.text === 'depth'));
});
// Optional, read-only differential check against this machine's installed ST pure variable functions.
const source = process.env.ST_VARIABLES_SOURCE;
if (source) check('native ST differential: edge cases, scopes and return coercion', () => {
  let code = fs.readFileSync(source, 'utf8'); code = code.slice(0, code.indexOf('async function listVariablesCallback')).replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
  const sandbox: any = { chat_metadata: { variables: {} }, extension_settings: { variables: { global: {} } }, saveMetadataDebounced() {}, saveSettingsDebounced() {} };
  vm.createContext(sandbox); vm.runInContext(code, sandbox);
  for (const initial of [undefined, '', ' ', '0', '001', '-2', '10', 'abc', '[]', '["A"]']) for (const operand of ['0', '2', '-1', '', ' ', 'X', '\nB']) for (const global of [false, true]) {
    sandbox.chat_metadata.variables = {}; sandbox.extension_settings.variables.global = {};
    const values = global ? sandbox.extension_settings.variables.global : sandbox.chat_metadata.variables;
    if (initial !== undefined) values.x = initial;
    (global ? sandbox.addGlobalVariable : sandbox.addLocalVariable)('x', operand);
    const before = initial === undefined ? undefined : writeBinding('x', global, initial, 'set', 's').binding;
    const actual = writeBinding('x', global, operand, 'add', 'a', before, true).binding;
    assert.equal(String(actual.value), String(values.x), `${global}:${JSON.stringify([initial, operand])}`);
  }
});
console.log(`ALL ${checked} VARIABLE/LAYOUT CHECKS PASS`);
