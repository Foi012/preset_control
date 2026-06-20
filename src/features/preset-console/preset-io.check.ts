/**
 * Lightweight check for the preset I/O wrapper, driven by an in-memory mock
 * gateway (no SillyTavern). Mirrors the other `*.check.ts` scripts.
 * Run: npx ts-node --transpile-only -P tsconfig.check.json src/features/preset-console/preset-io.check.ts
 */
import { CONFIG_BACKUP_ENTRY_NAME, CONFIG_ENTRY_NAME, defaultConfig, readConfig } from './config';
import {
  loadView,
  needsConfigMigration,
  saveConfig,
  setEntriesEnabled,
  setEntryContent,
  upsertConfigPrompt,
  type PresetGateway,
} from './preset-io';
import type { PresetPromptLike } from './types';
import fixture from './__fixtures__/preset.json';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** In-memory gateway over deep-cloned placed + unplaced prompt lists; counts disk saves. */
function mockGateway(initial: PresetPromptLike[], initialUnused: PresetPromptLike[] = []) {
  let prompts: PresetPromptLike[] = clone(initial);
  let promptsUnused: PresetPromptLike[] = clone(initialUnused);
  let persists = 0;
  const gateway: PresetGateway = {
    read: () => ({ prompts, promptsUnused }),
    mutate: async edit => {
      // Clone-on-write to mimic ST handing back fresh lists each update.
      const nextP = clone(prompts);
      const nextU = clone(promptsUnused);
      edit({ prompts: nextP, promptsUnused: nextU });
      prompts = nextP;
      promptsUnused = nextU;
    },
    persist: async () => {
      persists += 1;
    },
  };
  return {
    gateway,
    dump: () => prompts,
    dumpUnused: () => promptsUnused,
    dumpAll: () => [...promptsUnused, ...prompts],
    persists: () => persists,
  };
}

const base = fixture.prompts as PresetPromptLike[];

async function main() {
// --- loadView round-trips the parse+resolve over the gateway ---------------
{
  const { gateway } = mockGateway(base);
  const view = loadView(gateway);
  check('loadView: region found', view.regionFound, true);
  check('loadView: 9 sections', view.sections.length, 9);
}

// --- setEntriesEnabled toggles in place ------------------------------------
{
  const { gateway, dump } = mockGateway(base);
  const POV2 = '2b6313b3-pov2'; // enabled in fixture
  const POV1U = 'a411becb-pov1u'; // disabled in fixture
  await setEntriesEnabled(gateway, { [POV2]: false, [POV1U]: true });
  const after = dump();
  check('toggle off', after.find(p => p.id === POV2)?.enabled, false);
  check('toggle on', after.find(p => p.id === POV1U)?.enabled, true);
  check('unrelated entry untouched', after.find(p => p.id === '3ab041ca-push')?.enabled, true);
}

// --- setEntryContent edits the ✍️ input text -------------------------------
{
  const { gateway, dump } = mockGateway(base);
  const LANG = '6a0e1556-lang';
  await setEntryContent(gateway, LANG, '{{setvar::language::英语}}');
  check('input content updated', dump().find(p => p.id === LANG)?.content, '{{setvar::language::英语}}');
}

// --- saveConfig stores config + backup as unplaced (hidden) prompts --------
{
  const { gateway, dump, dumpUnused, dumpAll } = mockGateway(base);
  const cfg = defaultConfig();
  cfg.ui.theme = 'editorial';
  await saveConfig(gateway, cfg);
  check('config entry NOT in the placed (manager-visible) list', dump().some(p => p.name === CONFIG_ENTRY_NAME), false);
  check('config entry stored in the unplaced list', dumpUnused().some(p => p.name === CONFIG_ENTRY_NAME), true);
  check('backup entry stored in the unplaced list', dumpUnused().some(p => p.name === CONFIG_BACKUP_ENTRY_NAME), true);
  check('config entry disabled', dumpUnused().find(p => p.name === CONFIG_ENTRY_NAME)?.enabled, false);
  check('config round-trips via readConfig', readConfig(dumpAll()).ui.theme, 'editorial');
  check('view still shows 9 sections (config not placed)', loadView(gateway).sections.length, 9);

  // Second save updates in place — no duplicate entry.
  cfg.ui.theme = 'glass';
  await saveConfig(gateway, cfg);
  check('no duplicate config entry', dumpUnused().filter(p => p.name === CONFIG_ENTRY_NAME).length, 1);
  check('config updated in place', readConfig(dumpAll()).ui.theme, 'glass');
}

// --- migration: config left in the placed list moves to unplaced -----------
{
  const cfg = defaultConfig();
  cfg.ui.theme = 'editorial';
  // Simulate an older preset: config + backup sit in the placed list.
  const legacyPlaced: PresetPromptLike[] = [
    { id: 'cfg', name: CONFIG_ENTRY_NAME, enabled: false, content: JSON.stringify(cfg) },
    { id: 'bak', name: CONFIG_BACKUP_ENTRY_NAME, enabled: false, content: JSON.stringify(cfg) },
    ...base,
  ];
  const { gateway, dump, dumpUnused, dumpAll } = mockGateway(legacyPlaced);
  check('migration needed when config is in the placed list', needsConfigMigration(gateway), true);
  check('config still readable before migration', readConfig(dumpAll()).ui.theme, 'editorial');
  // saveConfig is the migration: strip from placed, write to unplaced.
  await saveConfig(gateway, readConfig(dumpAll()));
  check('after migration: config gone from the placed list', dump().some(p => p.name === CONFIG_ENTRY_NAME), false);
  check('after migration: backup gone from the placed list', dump().some(p => p.name === CONFIG_BACKUP_ENTRY_NAME), false);
  check('after migration: config in the unplaced list', dumpUnused().some(p => p.name === CONFIG_ENTRY_NAME), true);
  check('after migration: no longer flagged for migration', needsConfigMigration(gateway), false);
}

// --- upsertConfigPrompt falls back to front when region marker absent ------
{
  const noRegion: PresetPromptLike[] = [
    { id: 'a', name: 'foo', enabled: true, content: '' },
    { id: 'b', name: 'bar', enabled: true, content: '' },
  ];
  upsertConfigPrompt(noRegion, defaultConfig());
  check('no region: config inserted at front', noRegion[0].name, CONFIG_ENTRY_NAME);
}
}

main().then(() => {
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
});
