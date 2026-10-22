/**
 * Checks for quick grouping, scoped plans and configuration protection.
 * Run: npx ts-node --transpile-only -P tsconfig.check.json src/features/preset-console/store.check.ts
 */
import { createPinia, setActivePinia } from 'pinia';
import { CONFIG_ENTRY_NAME, defaultConfig, readConfig, serializeConfig } from './config';
import type { Config } from './config';
import type { PresetPromptLike } from './types';
import { migratePlans } from './workbench-model';
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
  const { useConsoleStore } = await import('./store');
  setActivePinia(createPinia());
  const store = useConsoleStore();
  await store.load();

  const migrated = clone(config);
  migratePlans(migrated);
  check('legacy selection becomes a scoped plan', migrated.plans[0].selections, { [POV2]: true });
  const outsideBefore = runtime.dump().find(p => p.id === SCENE_GPT)?.enabled;
  await store.applyPlanSelections({ [POV2]: false, [POV1U]: true });
  check('plan preserves explicit OFF', runtime.dump().find(p => p.id === POV2)?.enabled, false);
  check('plan applies explicit ON', runtime.dump().find(p => p.id === POV1U)?.enabled, true);
  check('plan leaves unrecorded entries unchanged', runtime.dump().find(p => p.id === SCENE_GPT)?.enabled, outsideBefore);
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
  await store.addGroup('第三级');
  const thirdId = store.config.customGroups.find(g => g.name === '第三级')!.id;
  await store.setGroupParent(thirdId, childGroupId);
  check('quick grouping persists third-level parent', readConfig(runtime.dumpAll()).customGroups.find(g => g.id === thirdId)?.parentId, childGroupId);
  await store.setGroupParent(parentGroupId, thirdId);
  check('quick grouping rejects ancestor cycle', readConfig(runtime.dumpAll()).customGroups.find(g => g.id === parentGroupId)?.parentId, undefined);
  await store.outdentGroup(thirdId);
  check('outdent moves one level rather than to root', readConfig(runtime.dumpAll()).customGroups.find(g => g.id === thirdId)?.parentId, parentGroupId);
  await store.setGroupParent(thirdId, childGroupId);
  // --- config corruption / backup recovery ---------------------------------
  // Config + backup live in the unplaced list now, so corruption is injected there.
  // A valid save mirrors the config into the backup entry.
  await store.renameGroup(parentGroupId, '健康分组');
  const dumpWithBackup = runtime.dumpUnused();
  check('save mirrors config into backup entry', dumpWithBackup.some(p => p.name === '[⚙️CONSOLE-CONFIG-BACKUP]'), true);

  // Corrupt the primary entry; the backup should transparently recover it.
  dumpWithBackup.find(p => p.name === CONFIG_ENTRY_NAME)!.content = '{ this is not json';
  await store.load();
  check('recovers config name from backup when primary is corrupt', store.config.customGroups.find(g => g.id === parentGroupId)?.name, '健康分组');
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

  // Manual import/export should move only the console config JSON and validate it
  // through the same schema as the preset reader.
  const exported = store.exportConfigJson();
  const importCfg = defaultConfig();
  importCfg.scenarios = [{ id: 'imp', name: '导入配置', groupIds: [], layout: [], selections: {}, snapshots: [] }];
  await store.importConfigJson(serializeConfig(importCfg));
  check('manual import persists config', readConfig(runtime.dumpAll()).scenarios[0]?.name, '导入配置');
  check('manual export returns valid config JSON', readConfig([{ id: 'tmp', name: CONFIG_ENTRY_NAME, enabled: false, content: exported }]).version, 1);
  const presetExportCfg = defaultConfig();
  presetExportCfg.scenarios = [{ id: 'imp2', name: '预设导入', groupIds: [], layout: [], selections: {}, snapshots: [] }];
  await store.importConfigJson(
    JSON.stringify({
      prompts_unused: [{ id: 'cfg-export', name: CONFIG_ENTRY_NAME, enabled: false, content: serializeConfig(presetExportCfg) }],
    }),
  );
  check('manual import extracts config from full preset export', readConfig(runtime.dumpAll()).scenarios[0]?.name, '预设导入');

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
