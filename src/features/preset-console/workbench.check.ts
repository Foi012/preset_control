import { defaultConfig } from './config';
import { applyPlan, capturePlan, catalog, cloneDocument, copyEntries, fingerprint, migratePlans, orderOf, planMatches, readDocumentConfig, removeCopiedEntries, toggleDraftEntry, writeDocumentConfig, type PresetDocument } from './workbench-model';
import { copyDiagnostics, expandDocument, relatedEntries } from './workbench-preview';
import { nativePresetRepository } from './preset-repository';
import { draftDirty, draftDocument, newDraft, savePlanRecord, deletePlanRecord } from './workbench-store';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = fingerprint(actual) === fingerprint(expected);
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) { failures++; console.log('expected', expected, 'received', actual); }
}
function throws(name: string, action: () => unknown): void {
  try { action(); check(name, false, true); } catch { check(name, true, true); }
}
function fixture(): PresetDocument {
  return {
    temperature: 0.7,
    prompts: [
      { identifier: 'init', name: 'VARS', content: '{{setvar::POV:: }}{{setvar::guard:: }}', role: 'system' },
      { identifier: 'second', name: '第二人称', content: '{{setvar::POV::第二人称 {{user}}}}', injection_position: 0, injection_depth: 4, injection_order: 17, injection_trigger: ['normal'], forbid_overrides: true, attach_side: 'before' },
      { identifier: 'third', name: '第三人称', content: '{{setvar::POV::第三人称}}' },
      { identifier: 'guards', name: '防支配', content: '{{setvar::guard::G}}{{setvar::guard_desc::D}}' },
      { identifier: 'head', name: 'HEAD', content: '{{getvar::guard}}' },
      { identifier: 'tail', name: 'TAIL', content: '{{getvar::POV}} {{getvar::guard_desc}} {{正文内容}}' },
      { identifier: 'history', name: '聊天记录', marker: true, content: '' },
      { identifier: 'unplaced', name: '未放置', content: '{{setvar::POV::不应生效}}' },
    ],
    prompt_order: [{ character_id: 100001, order: [
      { identifier: 'init', enabled: true }, { identifier: 'second', enabled: true },
      { identifier: 'third', enabled: false }, { identifier: 'guards', enabled: true },
      { identifier: 'head', enabled: true }, { identifier: 'tail', enabled: true },
      { identifier: 'history', enabled: true }, { identifier: 'missing', enabled: false, preserved: true },
    ] }],
    extensions: { otherExtension: { keep: true } },
  };
}
async function main(): Promise<void> {
  const d = fixture();
  // Deliberately use a plain setter in the tested subset. Nested macros must be diagnosed, never approximated.
  d.prompts![1].content = '{{setvar::POV::第二人称}}';
  const original = fingerprint(d);
  const locals = { retained: 'value' };
  const expanded = expandDocument(d, { user: '读者', local: locals });
  const tail = expanded.entries.find(e => e.entry.prompt.identifier === 'tail')!;
  check('OFF and unplaced writes never leak into enabled TAIL', tail.text, '第二人称 D {{正文内容}}');
  check('expansion does not mutate native document', fingerprint(d), original);
  check('expansion does not mutate chat variables', locals, { retained: 'value' });
  check('TAIL provenance identifies setter', tail.fragments.find(f => f.variable === 'POV')?.definitionId, 'second');
  check('one setter can feed multiple output entries', relatedEntries(expanded, 'guards').map(e => e.entry.prompt.identifier).sort(), ['head', 'init', 'tail']);
  check('disabled option definition stays readable', expanded.entries.find(e => e.entry.prompt.identifier === 'third')?.writes[0].value, '第三人称');
  check('unplaced is separate from OFF', catalog(d).find(e => e.prompt.identifier === 'unplaced')?.placed, false);
  check('literal Chinese brace text stays intact', tail.text.includes('{{正文内容}}'), true);
  const nested = fixture();
  check('literal context macro survives balanced setter', expandDocument(nested).entries[1].writes[0].value, '第二人称 {{user}}');
  const unknown = cloneDocument(d); unknown.prompts![5].content = '{{incvar::x}} {{getvar::undefined}}';
  const diagnostics = expandDocument(unknown).entries.find(e => e.entry.prompt.identifier === 'tail')!.diagnostics;
  check('unsupported operations are retained and diagnosed', diagnostics.length > 0, true);
  check('preview boundaries are explicitly stated', expanded.requestUnavailable.includes('不计算这些占位内容中的变量操作'), true);

  const config = defaultConfig();
  config.scenarios.push({ id: 'mode', name: 'all-in-one', groupIds: [], layout: [], selections: {}, snapshots: [
    { id: 's', name: 'claude', selections: { second: true, third: false } },
  ] });
  migratePlans(config); migratePlans(config);
  check('migration is idempotent', config.plans.length, 1);
  check('legacy scope is preserved exactly', config.plans[0].selections, { second: true, third: false });
  check('legacy plans are partial', config.plans[0].scope, 'partial');
  check('layout-only mode creates no fake plan', (() => { const c = defaultConfig(); c.scenarios = [{ ...config.scenarios[0], snapshots: [] }]; migratePlans(c); return c.plans.length; })(), 0);
  const before = cloneDocument(d);
  applyPlan(d, { second: false, third: true, deleted: false });
  check('partial application leaves unrelated switches unchanged', orderOf(d).find(e => e.identifier === 'guards')?.enabled, true);
  check('applied plan matches', planMatches(d, { second: false, third: true }), true);
  check('new entries are outside old plan scope', capturePlan(d, ['second', 'third']), { second: false, third: true });
  config.customGroups.push({ id: 'pov', name: '视角', rule: 'single', order: 0, required: true, hidden: false, pinned: false, collapsed: false });
  config.entryMeta.second = { groupId: 'pov' }; config.entryMeta.third = { groupId: 'pov' };
  toggleDraftEntry(d, config, 'second', true);
  check('single group disables peer', orderOf(d).find(e => e.identifier === 'third')?.enabled, false);
  throws('required group cannot be emptied', () => toggleDraftEntry(d, config, 'second', false));
  config.customGroups[0].rule = 'multi'; toggleDraftEntry(d, config, 'third', true);
  check('multi group permits both', capturePlan(d, ['second', 'third']), { second: true, third: true });
  config.customGroups[0].rule = 'folder';
  toggleDraftEntry(d, config, 'second', false); toggleDraftEntry(d, config, 'third', false);
  check('organization-only folder ignores stale required rule', capturePlan(d, ['second', 'third']), { second: false, third: false });
  const folder = defaultConfig(); folder.customGroups.push({ ...config.customGroups[0], rule: 'folder', required: false });
  check('folder config round-trips', (() => { const c = cloneDocument(d); writeDocumentConfig(c, folder); return readDocumentConfig(c).config.customGroups[0].rule; })(), 'folder');

  const target: PresetDocument = { prompts: [{ identifier: 'target-tail', name: 'TAIL', content: '{{getvar::POV}}' }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'ghost', enabled: false }, { identifier: 'target-tail', enabled: true }] }] };
  let sequence = 0;
  const ids = copyEntries(before, target, ['third', 'second', 'history'], { anchor: 'target-tail', side: 'before' }, () => `copy-${++sequence}`);
  check('copy keeps source order, not selection order; excludes markers', ids, ['copy-1', 'copy-2']);
  check('copy anchors against full order including stale refs', orderOf(target).map(e => e.identifier), ['ghost', 'copy-1', 'copy-2', 'target-tail']);
  check('copy preserves all native metadata', target.prompts![1].attach_side, 'before');
  check('copy preserves triggers and role metadata', target.prompts![1].injection_trigger, ['normal']);
  const undoTarget = cloneDocument(target);
  undoTarget.prompts![0].content = 'user edit after paste';
  const undoConfig = defaultConfig();
  undoConfig.entryMeta[ids[0]] = { groupId: 'test' };
  undoConfig.plans.push({ id: 'test-plan', name: 'test', scope: 'partial', selections: { [ids[0]]: true, 'target-tail': true } });
  removeCopiedEntries(undoTarget, undoConfig, ids);
  check('undo paste removes only new entries and keeps other edits', [undoTarget.prompts!.length, undoTarget.prompts![0].content, orderOf(undoTarget).map(e => e.identifier)], [1, 'user edit after paste', ['ghost', 'target-tail']]);
  check('undo paste clears new references without affecting other selections', [undoConfig.entryMeta, undoConfig.plans[0].selections], [{}, { 'target-tail': true }]);
  check('copy does not change source', fingerprint(before), original);
  throws('stale insertion anchor is rejected', () => copyEntries(before, target, ['second'], { anchor: 'gone', side: 'after' }, () => 'other'));
  check('missing consumers are disclosed', copyDiagnostics(expanded, expandDocument({}), ['second']).some(s => s.includes('没有使用变量')), true);

  let selected = 'A';
  const presets = [cloneDocument(before), cloneDocument(target)];
  const live = cloneDocument(before);
  let saves = 0; let fail = false;
  const ctx = {
    chatCompletionSettings: live,
    getPresetManager: () => ({
      getSelectedPresetName: () => selected,
      getPresetList: () => ({ presets, preset_names: ['A', 'B'] }),
      getCompletionPresetByName: (name: string) => presets[['A', 'B'].indexOf(name)],
      savePreset: async (_name: string, _settings: PresetDocument, options: { skipUpdate: boolean }) => {
        check('repository saves without selecting preset', options.skipUpdate, true);
        if (fail) throw new Error('network'); saves++;
      },
    }),
  };
  const repo = nativePresetRepository(() => ctx);
  const snapshot = repo.read('B');
  const draft = newDraft(snapshot); draft.document.prompts![0].content = 'changed';
  check('draft mutations leave saved target unchanged', presets[1].prompts![0].content, '{{getvar::POV}}');
  check('draft dirty detection', draftDirty(draft), true);
  fail = true;
  try { await repo.save(snapshot, draftDocument(draft)); } catch { /* expected */ }
  check('save failure preserves draft and live state', [draft.document.prompts![0].content, fingerprint(live)], ['changed', original]);
  fail = false;
  await repo.save(snapshot, draftDocument(draft));
  check('noncurrent save keeps selected preset', selected, 'A');
  check('noncurrent save leaves live state unchanged', fingerprint(live), original);
  check('cache is refreshed after successful noncurrent save', repo.read('B').document.prompts![0].content, 'changed');
  const stale = repo.read('A'); live.prompts![0].content = 'external edit';
  try { await repo.save(stale, stale.document); check('stale write rejected', false, true); } catch { check('stale write rejected', true, true); }
  check('conflict is rejected before disk write', saves, 1);
  const current = repo.read('A'); const edited = cloneDocument(current.document); edited.prompts![0].content = 'saved current';
  await repo.save(current, edited);
  check('current save updates live and cache', [live.prompts![0].content, presets[0].prompts![0].content], ['saved current', 'saved current']);
  const corrupt = cloneDocument(before); corrupt.extensions!.presetEasyToggle = { config: '{bad', backup: '{bad' };
  check('corrupt config is marked', readDocumentConfig(corrupt).corrupt, true);
  const corruptDraft = newDraft({ name: 'bad', document: corrupt, baseline: fingerprint(corrupt), diskBaseline: fingerprint(corrupt) });
  corruptDraft.config.ui.theme = 'light';
  throws('corrupt draft config cannot overwrite storage', () => draftDocument(corruptDraft));
  // Saving a switch combination is an isolated commit, not a second editor draft.
  let planDisk = fixture();
  const snapshotOf = () => ({ name: 'P', document: cloneDocument(planDisk), baseline: fingerprint(planDisk), diskBaseline: fingerprint(planDisk) });
  let planFail = false, planWrites = 0;
  const planRepo = {
    list: () => ['P'], current: () => 'P', read: snapshotOf, expansionContext: () => ({}),
    save: async (base: ReturnType<typeof snapshotOf>, document: PresetDocument) => {
      if (planFail) throw new Error('save failure');
      if (base.baseline !== fingerprint(planDisk)) throw new Error('external conflict');
      planWrites++; planDisk = cloneDocument(document); return snapshotOf();
    },
  };
  const planDraft = newDraft(snapshotOf());
  planDraft.document.prompts![1].content = 'unsaved text';
  toggleDraftEntry(planDraft.document, planDraft.config, 'third', true);
  planDraft.config.customGroups.push({ id: 'unsaved-group', name: 'unsaved group', rule: 'multi', order: 0, required: false, pinned: false, hidden: false, collapsed: false });
  const combination = { id: 'new-plan', name: 'Switches', scope: 'partial' as const, selections: capturePlan(planDraft.document, ['second', 'third']) };
  await savePlanRecord(planDraft, planRepo, combination);
  check('plan is immediately present in saved preset', readDocumentConfig(planDisk).config.plans[0], combination);
  check('saving plan does not save editor text', planDisk.prompts![1].content, fixture().prompts![1].content);
  check('saving plan does not apply trial switches to runtime baseline', orderOf(planDisk).find(e => e.identifier === 'third')?.enabled, false);
  check('saving plan does not save draft groups', readDocumentConfig(planDisk).config.customGroups.length, 0);
  check('isolated plan save retains editor text and groups', [planDraft.document.prompts![1].content, planDraft.config.customGroups.length], ['unsaved text', 1]);
  check('other edits remain unsaved after plan save', draftDirty(planDraft), true);
  check('plan save rebases the next full-editor save', planDraft.snapshot.baseline, fingerprint(planDisk));
  const discarded = newDraft(snapshotOf());
  check('discarding editor edits keeps saved plan', discarded.config.plans[0], combination);
  const cleanPlan = { id: 'clean-plan', name: 'Clean', scope: 'all' as const, selections: capturePlan(discarded.document) };
  await savePlanRecord(discarded, planRepo, cleanPlan);
  check('saving plan from clean editor leaves no second save step', draftDirty(discarded), false);
  const inferred = newDraft(snapshotOf());
  check('editor remembers initially matching plan', inferred.activePlan, 'clean-plan');
  applyPlan(inferred.document, { third: true });
  check('trial switching keeps selected plan for restoration', inferred.activePlan, 'clean-plan');
  const retainedText = inferred.document.prompts![1].content = 'retained on restore';
  applyPlan(inferred.document, inferred.config.plans.find(p => p.id === inferred.activePlan)!.selections);
  check('restoring plan keeps text edits', inferred.document.prompts![1].content, retainedText);
  const deleteDraft = newDraft(snapshotOf());
  deleteDraft.document.prompts![1].content = 'pending text before delete';
  deleteDraft.config.customGroups.push({ id: 'pending-delete-group', name: '未保存分组', rule: 'multi', order: 0, pinned: false, hidden: false, required: false, collapsed: false });
  const switchesBeforeDelete = fingerprint(orderOf(deleteDraft.document));
  await deletePlanRecord(deleteDraft, planRepo, cleanPlan.id);
  check('delete plan persists immediately', readDocumentConfig(planDisk).config.plans.some(p => p.id === cleanPlan.id), false);
  check('delete plan preserves pending text', deleteDraft.document.prompts![1].content, 'pending text before delete');
  check('delete plan does not save pending text', planDisk.prompts![1].content, fixture().prompts![1].content);
  check('delete plan preserves current switches', fingerprint(orderOf(deleteDraft.document)), switchesBeforeDelete);
  check('delete plan preserves pending grouping', deleteDraft.config.customGroups.some(g => g.id === 'pending-delete-group'), true);
  check('deleted plan does not reappear after migration', newDraft(snapshotOf()).config.plans.some(p => p.id === cleanPlan.id), false);
  // Rebase this separate editor to continue failure and conflict checks.
  discarded.snapshot = snapshotOf();
  planFail = true;
  const deleteFailureBefore = fingerprint(deleteDraft);
  try { await deletePlanRecord(deleteDraft, planRepo, combination.id); check('delete failure rejected', false, true); } catch { check('delete failure rejected', true, true); }
  check('delete failure preserves editor', fingerprint(deleteDraft), deleteFailureBefore);
  planFail = false;
  planFail = true;
  const failureBefore = fingerprint(discarded), diskBefore = fingerprint(planDisk);
  try { await savePlanRecord(discarded, planRepo, { ...cleanPlan, id: 'failure' }); check('plan save failure rejected', false, true); } catch { check('plan save failure rejected', true, true); }
  check('failed plan save leaves editor and baseline intact', [fingerprint(discarded), fingerprint(planDisk)], [failureBefore, diskBefore]);
  planFail = false;
  const writesBefore = planWrites;
  try { await savePlanRecord(discarded, planRepo, { ...cleanPlan, id: 'new-entry', selections: { unplaced: true } }); check('uncommitted order entry cannot be silently saved with a plan', false, true); } catch { check('uncommitted order entry cannot be silently saved with a plan', true, true); }
  check('invalid new-entry plan does not write anything', planWrites, writesBefore);
  planDisk.prompts![0].content = 'external change';
  const deleteConflictBefore = fingerprint(deleteDraft);
  try { await deletePlanRecord(deleteDraft, planRepo, combination.id); check('external modification rejects plan deletion', false, true); } catch { check('external modification rejects plan deletion', true, true); }
  check('deletion conflict preserves editor and baseline', fingerprint(deleteDraft), deleteConflictBefore);
  const conflictBefore = fingerprint(discarded);
  try { await savePlanRecord(discarded, planRepo, { ...cleanPlan, id: 'conflict' }); check('external modification rejects isolated plan save', false, true); } catch { check('external modification rejects isolated plan save', true, true); }
  check('plan conflict retains editor', fingerprint(discarded), conflictBefore);
  if (failures) throw new Error(`${failures} failure(s)`);
  console.log('\nALL WORKBENCH CHECKS PASS');
}
main().catch(error => { console.error(error); throw error; });
