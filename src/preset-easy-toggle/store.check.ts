/**
 * Lightweight check for mode snapshot store behavior.
 * Run: npx ts-node --transpile-only -P tsconfig.novelizer.json src/preset-easy-toggle/store.check.ts
 */
import { createPinia, setActivePinia } from 'pinia';
import { CONFIG_ENTRY_NAME, defaultConfig, readConfig, serializeConfig } from './config';
import type { Config } from './config';
import type { PresetPromptLike } from './types';
import fixture from './__fixtures__/preset.json';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function installGlobals(initial: PresetPromptLike[], initialUnused: PresetPromptLike[] = []) {
  let prompts: PresetPromptLike[] = clone(initial);
  let promptsUnused: PresetPromptLike[] = clone(initialUnused);
  let mutateCount = 0;
  (globalThis as any).getPreset = () => ({ prompts, prompts_unused: promptsUnused });
  (globalThis as any).updatePresetWith = async (
    _target: string,
    edit: (preset: { prompts: PresetPromptLike[]; prompts_unused: PresetPromptLike[] }) => {
      prompts: PresetPromptLike[];
      prompts_unused: PresetPromptLike[];
    },
  ) => {
    const res = edit({ prompts: clone(prompts), prompts_unused: clone(promptsUnused) });
    prompts = res.prompts;
    promptsUnused = res.prompts_unused ?? [];
    mutateCount += 1;
  };
  (globalThis as any).getLoadedPresetName = () => 'fixture';
  (globalThis as any).replacePreset = async () => {};
  (globalThis as any).toastr = { info: () => {}, success: () => {}, error: () => {}, warning: () => {} };
  return {
    dump: () => prompts,
    dumpUnused: () => promptsUnused,
    dumpAll: () => [...promptsUnused, ...prompts],
    mutateCount: () => mutateCount,
  };
}

/** New layout: config lives in the unplaced list (hidden from ST's prompt manager). */
function withConfig(base: PresetPromptLike[], config: Config): { prompts: PresetPromptLike[]; promptsUnused: PresetPromptLike[] } {
  const entry = { id: 'cfg', name: CONFIG_ENTRY_NAME, enabled: false, content: serializeConfig(config) };
  return { prompts: clone(base), promptsUnused: [entry] };
}

async function main() {
  const base = fixture.prompts as PresetPromptLike[];
  const POV = '8cb532f5-h03';
  const POV2 = '2b6313b3-pov2';
  const POV1U = 'a411becb-pov1u';
  const SCENE_GPT = 'de1a5ffc-gpt';
  const parentGroupId = 'custom-parent';
  const childGroupId = 'custom-child';
  const modeId = 'm1';
  const snapshotId = 'snap1';

  const config = defaultConfig();
  config.scenarios = [
    {
      id: modeId,
      name: '写作',
      groupIds: [POV],
      layout: [{ groupId: POV, order: 0 }],
      selections: { [POV2]: true },
      snapshots: [],
    },
  ];

  const initialPreset = withConfig(base, config);
  const runtime = installGlobals(initialPreset.prompts, initialPreset.promptsUnused);
  const { useConsoleStore, useUiStore, snapshotsOfMode } = await import('./store');
  setActivePinia(createPinia());
  const store = useConsoleStore();
  const ui = useUiStore();
  await store.load();

  check('legacy selections appear as 默认 snapshot', store.modeSnapshots(modeId), [
    { id: '__legacy_default__', name: '默认', selections: { [POV2]: true }, legacy: true },
  ]);
  check('pure legacy snapshot helper', snapshotsOfMode(config.scenarios[0]), [
    { id: '__legacy_default__', name: '默认', selections: { [POV2]: true }, legacy: true },
  ]);

  ui.activeModeId = modeId;
  check('selecting a mode scope does not mutate preset switches', runtime.mutateCount(), 0);

  await store.applyModeSnapshot(modeId, '__legacy_default__');
  check('legacy snapshot can be explicitly applied', ui.activeSnapshotId, '__legacy_default__');

  const savedId = await store.saveModeSnapshot(modeId, '当前');
  const savedConfig = readConfig(runtime.dumpAll());
  check('saving snapshot creates explicit snapshot', savedConfig.scenarios[0].snapshots.length, 1);
  check('saved snapshot uses requested name', savedConfig.scenarios[0].snapshots[0].name, '当前');
  check('saving snapshot captures scoped live state', savedConfig.scenarios[0].snapshots[0].selections[POV2], true);

  await store.renameModeSnapshot(modeId, String(savedId), '轻量');
  check('rename snapshot persists', readConfig(runtime.dumpAll()).scenarios[0].snapshots[0].name, '轻量');

  await store.applyModeSnapshot(modeId, String(savedId));
  check('applying snapshot marks active snapshot', ui.activeSnapshotId, savedId);
  check('applying snapshot remembers it for the mode', ui.activeSnapshotByMode[modeId], savedId);
  check('applying snapshot leaves outside entry untouched', runtime.dump().find(p => p.id === SCENE_GPT)?.enabled, false);
  const mutateCountAfterApply = runtime.mutateCount();
  await store.applyModeSnapshot(modeId, String(savedId));
  check('re-applying unchanged snapshot skips preset write', runtime.mutateCount(), mutateCountAfterApply);

  await store.updateModeSnapshot(modeId, String(savedId));
  check('update snapshot keeps scoped entry state', readConfig(runtime.dumpAll()).scenarios[0].snapshots[0].selections[POV2], true);

  const cfg = readConfig(runtime.dumpAll());
  cfg.scenarios[0].snapshots = [{ id: snapshotId, name: '关闭POV2', selections: { [POV2]: false, [POV1U]: true } }];
  runtime.dumpUnused().find(p => p.name === CONFIG_ENTRY_NAME)!.content = serializeConfig(cfg);
  await store.load();
  await store.applyModeSnapshot(modeId, snapshotId);
  check('apply snapshot toggles off selected entry', runtime.dump().find(p => p.id === POV2)?.enabled, false);
  check('apply snapshot toggles on selected entry', runtime.dump().find(p => p.id === POV1U)?.enabled, true);

  // State-derived "current snapshot": live now matches snap1 exactly, so it resolves
  // to snap1 with no remembered session id — this is what survives refresh/toggle.
  check('matchingSnapshotId resolves the snapshot matching live state', store.matchingSnapshotId(modeId), snapshotId);
  // Drift one entry off → nothing matches → honestly null (no stale name).
  runtime.dump().find(p => p.id === POV1U)!.enabled = false;
  await store.load();
  check('matchingSnapshotId is null when live drifts off all snapshots', store.matchingSnapshotId(modeId), null);
  // Restore so the live state matches snap1 again for the following delete checks.
  runtime.dump().find(p => p.id === POV1U)!.enabled = true;
  await store.load();

  await store.deleteModeSnapshot(modeId, snapshotId);
  check('delete snapshot persists', readConfig(runtime.dumpAll()).scenarios[0].snapshots.length, 0);
  check('delete active snapshot clears highlight', ui.activeSnapshotId, null);
  check('delete active snapshot clears mode memory', ui.activeSnapshotByMode[modeId], undefined);

  const nestedConfig = readConfig(runtime.dumpAll());
  nestedConfig.customGroups.push(
    { id: parentGroupId, name: '父分组', rule: 'multi', order: 100, pinned: false, hidden: false, required: false, collapsed: false },
    { id: childGroupId, name: '子分组', parentId: parentGroupId, rule: 'multi', order: 101, pinned: false, hidden: false, required: false, collapsed: false },
  );
  nestedConfig.entryMeta[POV1U] = { groupId: childGroupId };
  nestedConfig.scenarios = [
    {
      id: modeId,
      name: '嵌套模式',
      groupIds: [parentGroupId],
      layout: [{ groupId: parentGroupId, order: 0 }],
      selections: {},
      snapshots: [],
    },
  ];
  runtime.dumpUnused().find(p => p.name === CONFIG_ENTRY_NAME)!.content = serializeConfig(nestedConfig);
  await store.load();
  const nestedSavedId = await store.saveModeSnapshot(modeId, '嵌套当前');
  const nestedSaved = readConfig(runtime.dumpAll()).scenarios[0].snapshots.find(s => s.id === nestedSavedId);
  check('parent-scoped snapshot captures nested child entry', nestedSaved?.selections[POV1U], runtime.dump().find(p => p.id === POV1U)?.enabled);

  // Adding a group to a mode must not let existing snapshots inherit the live ON
  // state of the new group's entries. PLOTS (96a91780-h04) has entries that are ON
  // in the fixture (PUSH); an existing snapshot scoped to POV should keep them OFF.
  const PLOTS = '96a91780-h04';
  const PUSH = '3ab041ca-push';
  const addCfg = readConfig(runtime.dumpAll());
  addCfg.customGroups = [];
  addCfg.entryMeta = {};
  addCfg.scenarios = [
    {
      id: modeId,
      name: '加组模式',
      groupIds: [POV],
      layout: [{ groupId: POV, order: 0 }],
      selections: {},
      snapshots: [{ id: 'snapAdd', name: '仅POV', selections: { [POV2]: true } }],
    },
  ];
  runtime.dumpUnused().find(p => p.name === CONFIG_ENTRY_NAME)!.content = serializeConfig(addCfg);
  await store.load();
  check('PUSH is ON in live before adding its group', runtime.dump().find(p => p.id === PUSH)?.enabled, true);
  await store.addGroupsToMode(modeId, [PLOTS]);
  const afterAdd = readConfig(runtime.dumpAll()).scenarios[0].snapshots.find(s => s.id === 'snapAdd');
  check('adding a group keeps prior snapshot selection', afterAdd?.selections[POV2], true);
  check('adding a group defaults new entries OFF in existing snapshot (not live ON)', afterAdd?.selections[PUSH], false);

  // --- config corruption / backup recovery ---------------------------------
  // Config + backup live in the unplaced list now, so corruption is injected there.
  // A valid save mirrors the config into the backup entry.
  await store.renameScenario(modeId, '健康配置');
  const dumpWithBackup = runtime.dumpUnused();
  check('save mirrors config into backup entry', dumpWithBackup.some(p => p.name === '[⚙️CONSOLE-CONFIG-BACKUP]'), true);

  // Corrupt the primary entry; the backup should transparently recover it.
  dumpWithBackup.find(p => p.name === CONFIG_ENTRY_NAME)!.content = '{ this is not json';
  await store.load();
  check('recovers config name from backup when primary is corrupt', store.config.scenarios[0]?.name, '健康配置');
  check('status flags recovery', store.configStatus, 'recovered');

  // Corrupt BOTH entries: refuse to write so the raw data is preserved.
  const corruptDump = runtime.dumpUnused();
  corruptDump.find(p => p.name === CONFIG_ENTRY_NAME)!.content = '{ broken';
  corruptDump.find(p => p.name === '[⚙️CONSOLE-CONFIG-BACKUP]')!.content = '{ also broken';
  await store.load();
  check('status flags corruption when no backup', store.configStatus, 'corrupt');
  const beforeBlocked = corruptDump.find(p => p.name === CONFIG_ENTRY_NAME)!.content;
  await store.addGroup('不应写入'); // always reaches commitConfig — must be blocked
  check('commit blocked while corrupt — primary entry untouched', runtime.dumpUnused().find(p => p.name === CONFIG_ENTRY_NAME)!.content, beforeBlocked);

  // --- migration: an older preset stored config in the placed (visible) list -------
  {
    const migCfg = defaultConfig();
    migCfg.scenarios = [{ id: 'mm', name: '迁移', groupIds: [], layout: [], selections: {}, snapshots: [] }];
    const legacyPlaced: PresetPromptLike[] = [
      { id: 'cfgP', name: CONFIG_ENTRY_NAME, enabled: false, content: serializeConfig(migCfg) },
      { id: 'bakP', name: '[⚙️CONSOLE-CONFIG-BACKUP]', enabled: false, content: serializeConfig(migCfg) },
      ...clone(base),
    ];
    const legacy = installGlobals(legacyPlaced, []);
    setActivePinia(createPinia());
    const migStore = useConsoleStore();
    check('legacy: config visible in placed list before load', legacy.dump().some(p => p.name === CONFIG_ENTRY_NAME), true);
    await migStore.load();
    check('migration: config removed from placed list', legacy.dump().some(p => p.name === CONFIG_ENTRY_NAME), false);
    check('migration: backup removed from placed list', legacy.dump().some(p => p.name === '[⚙️CONSOLE-CONFIG-BACKUP]'), false);
    check('migration: config moved to unplaced list', legacy.dumpUnused().some(p => p.name === CONFIG_ENTRY_NAME), true);
    check('migration: config still loads', migStore.config.scenarios[0]?.name, '迁移');
  }
}

main().then(() => {
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
});
