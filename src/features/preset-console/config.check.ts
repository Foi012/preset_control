import { canPlaceGroup, validGroupAncestry, removeCustomGroup } from './group-tree';
/**
 * Lightweight check for the config layer (read / validate / merge) against the
 * trimmed fixture. Mirrors {@link ./parser.check.ts}; no test runner is configured.
 * Run: npx ts-node --transpile-only -P tsconfig.check.json src/features/preset-console/config.check.ts
 */
import { CONFIG_ENTRY_NAME, defaultConfig, readConfig, resolveView, serializeConfig } from './config';
import type { Config } from './config';
import { parsePreset } from './parser';
import type { PresetPromptLike } from './types';
import fixture from './__fixtures__/preset.json';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? '✓' : '✗'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  );
}

const prompts = fixture.prompts as PresetPromptLike[];
const parse = parsePreset(prompts);

// Header ids we'll target in merge tests.
const POV = '8cb532f5-h03';
const PLOTS = '96a91780-h04';
const SCENE = '5b2316c4-h08';

// --- defaults --------------------------------------------------------------
const dflt = defaultConfig();
check('default version', dflt.version, 1);
check('default theme', dflt.ui.theme, 'dark');
check('default groups empty', dflt.groups.length, 0);
check('default region blank', dflt.region, { startId: '', endId: '' });

// --- readConfig ------------------------------------------------------------
check('readConfig: no entry → defaults', readConfig(prompts), dflt);

const stored: Config = {
  version: 1,
  region: { startId: '3bc68d3b-start', endId: '746e94db-end' },
  groups: [{ headerId: POV, rule: 'multi', order: 0, pinned: true, hidden: false, required: false, collapsed: false }],
  customGroups: [],
  entryMeta: { 'de1a5ffc-gpt': { hidden: true }, '2b6313b3-pov2': { kind: 'input' } },
  scenarios: [
    { id: 's1', name: 'NSFW', groupIds: [], layout: [], selections: { 'de1a5ffc-gpt': true }, snapshots: [] },
  ],
  plans: [],
  plansMigrated: false,
  ui: { theme: 'dark' },
};
const withConfig: PresetPromptLike[] = [
  { id: 'cfg', name: CONFIG_ENTRY_NAME, enabled: false, content: serializeConfig(stored) },
  ...prompts,
];
check('readConfig: round-trips stored JSON', readConfig(withConfig), stored);
check(
  'readConfig: old mode without snapshots defaults snapshots',
  readConfig([
    {
      id: 'cfg',
      name: CONFIG_ENTRY_NAME,
      enabled: false,
      content: JSON.stringify({
        version: 1,
        scenarios: [{ id: 'old', name: '旧模式', groupIds: [], layout: [], selections: { [POV]: true } }],
      }),
    },
  ]).scenarios[0].snapshots,
  [],
);
check(
  'readConfig: garbage JSON → defaults',
  readConfig([{ id: 'cfg', name: CONFIG_ENTRY_NAME, enabled: false, content: '{not json' }]),
  dflt,
);
check(
  'readConfig: schema violation → defaults',
  readConfig([{ id: 'cfg', name: CONFIG_ENTRY_NAME, enabled: false, content: '{"version":2}' }]),
  dflt,
);

// --- parser ignores the config entry inside the region ---------------------
const insideRegion = [...prompts];
insideRegion.splice(2, 0, { id: 'cfg', name: CONFIG_ENTRY_NAME, enabled: false, content: '{}' });
const parseInside = parsePreset(insideRegion as PresetPromptLike[]);
check('config entry inside region is skipped (still 9 sections)', parseInside.sections.length, 9);
check('config entry not surfaced as loose', parseInside.looseEntries.length, 0);

// --- resolveView: empty config is a pass-through ---------------------------
const plain = resolveView(parse, dflt);
const povGuess = parse.sections.find(s => s.headerId === POV)!.guessedRule;
check(
  'empty config: section order preserved',
  plain.sections.map(s => s.id),
  parse.sections.map(s => s.headerId),
);
check('empty config: header name cleaned', plain.sections.find(s => s.id === POV)?.name, 'POV');
check(
  'empty config: all sections source=header',
  plain.sections.every(s => s.source === 'header'),
  true,
);
check('empty config: rule falls back to guess', plain.sections.find(s => s.id === POV)?.rule, povGuess);
check(
  'empty config: nothing pinned/hidden',
  plain.sections.every(s => !s.pinned && !s.hidden),
  true,
);
check(
  'empty config: no entries hidden',
  plain.sections.flatMap(s => s.entries).every(e => !e.hidden),
  true,
);
check('empty config: entry nativeGroupId set', plain.sections.find(s => s.id === POV)?.entries[0]?.nativeGroupId, POV);
check(
  'empty config: outside entries are in catalog',
  plain.allEntries.some(e => e.id === 'd07b0943-head'),
  true,
);
check(
  'empty config: outside entries are not rendered by default',
  plain.sections.some(s => s.entries.some(e => e.id === 'd07b0943-head')),
  false,
);

// --- resolveView: stored config wins ---------------------------------------
const resolved = resolveView(parse, stored);
check('stored rule overrides guess (POV → multi)', resolved.sections.find(s => s.id === POV)?.rule, 'multi');
check('pinned section floats to top', resolved.sections[0].id, POV);
check(
  'unpinned sections keep original order after the pin',
  resolved.sections.slice(1).map(s => s.id)[0],
  parse.sections[0].headerId,
);

const scene = resolved.sections.find(s => s.id === SCENE)!;
check('entryMeta hides an entry', scene.entries.find(e => e.id === 'de1a5ffc-gpt')?.hidden, true);
const pov2 = resolved.sections.find(s => s.id === POV)!.entries.find(e => e.id === '2b6313b3-pov2')!;
check('entryMeta forces input kind', pov2.input, true);
check('entryMeta input does not touch alwaysOn', pov2.alwaysOn, false);
check('scenarios pass through', resolved.scenarios, stored.scenarios);
check('ui theme passes through', resolved.ui.theme, 'dark');

// PLOTS untouched by config → guess preserved.
check(
  'unconfigured section keeps its guess',
  resolved.sections.find(s => s.id === PLOTS)?.rule,
  parse.sections.find(s => s.headerId === PLOTS)?.guessedRule,
);

// --- custom grouping (virtual overlay) ------------------------------------
const CUSTOM = 'grp-custom-1';
const POV2 = '2b6313b3-pov2'; // native to POV
const HEAD = 'd07b0943-head'; // outside customization region
const custom: Config = {
  ...dflt,
  customGroups: [
    {
      id: CUSTOM,
      name: '我的分组',
      rule: 'single',
      order: 99,
      pinned: false,
      hidden: false,
      required: false,
      collapsed: false,
    },
  ],
  entryMeta: { [POV2]: { groupId: CUSTOM }, [HEAD]: { groupId: CUSTOM } },
};
const cview = resolveView(parse, custom);
const customSection = cview.sections.find(s => s.id === CUSTOM)!;
check('custom group appears', customSection?.source, 'custom');
check('custom group named', customSection?.name, '我的分组');
check(
  'reassigned entry lands in custom group',
  customSection.entries.some(e => e.id === POV2),
  true,
);
check(
  'reassigned entry left its native group',
  cview.sections.find(s => s.id === POV)!.entries.some(e => e.id === POV2),
  false,
);
check('reassigned entry records groupId', customSection.entries.find(e => e.id === POV2)?.groupId, CUSTOM);
check('reassigned entry still knows nativeGroupId', customSection.entries.find(e => e.id === POV2)?.nativeGroupId, POV);
check(
  'outside entry can land in custom group',
  customSection.entries.some(e => e.id === HEAD),
  true,
);
check('outside entry has no native group', customSection.entries.find(e => e.id === HEAD)?.nativeGroupId, null);

// --- nested groups ---------------------------------------------------------
const CHILD = 'grp-child';
const nested: Config = {
  ...dflt,
  customGroups: [
    {
      id: CHILD,
      name: 'gpt',
      parentId: POV,
      rule: 'multi',
      order: 1,
      pinned: false,
      hidden: false,
      required: false,
      collapsed: false,
    },
  ],
  entryMeta: { [HEAD]: { groupId: CHILD } },
};
const nview = resolveView(parse, nested);
const nestedParent = nview.sections.find(s => s.id === POV)!;
check(
  'nested child does not appear top-level',
  nview.sections.some(s => s.id === CHILD),
  false,
);
check(
  'nested child appears under parent',
  nestedParent.children.some(s => s.id === CHILD),
  true,
);
check('nested child records parentId', nestedParent.children.find(s => s.id === CHILD)?.parentId, POV);
check(
  'entry can route into nested child',
  nestedParent.children.find(s => s.id === CHILD)?.entries.some(e => e.id === HEAD),
  true,
);

const GRAND = 'grp-grand';
const tooDeep: Config = {
  ...dflt,
  customGroups: [
    {
      id: CHILD,
      name: 'child',
      parentId: POV,
      rule: 'multi',
      order: 1,
      pinned: false,
      hidden: false,
      required: false,
      collapsed: false,
    },
    {
      id: GRAND,
      name: 'grand',
      parentId: CHILD,
      rule: 'multi',
      order: 2,
      pinned: false,
      hidden: false,
      required: false,
      collapsed: false,
    },
  ],
};
const tview = resolveView(parse, tooDeep);
check(
  'three-level tree keeps grandchild under child',
  tview.sections.find(s => s.id === POV)?.children.find(s => s.id === CHILD)?.children.some(s => s.id === GRAND),
  true,
);

const links = [{ id: 'a', parentId: null }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }, { id: 'd', parentId: null }];
check('three-level guard rejects fourth level', canPlaceGroup(links, 'd', 'c'), false);
check('tree guard rejects cycles', canPlaceGroup(links, 'a', 'c'), false);
check('subtree movement preserves total depth', canPlaceGroup(links, 'a', 'd'), false);
check('two-level subtree can move under a root', canPlaceGroup(links, 'b', 'd'), true);
check('grandchild can move out', canPlaceGroup(links, 'c', null), true);
check('corrupt cycle has no valid ancestry', validGroupAncestry('a', new Map([['a', 'b'], ['b', 'a']])), false);
const fourth = resolveView(parse, { ...tooDeep, customGroups: [...tooDeep.customGroups, { ...tooDeep.customGroups[0], id: 'fourth', parentId: GRAND }] });
check('stored fourth level falls back to root without losing it', fourth.sections.some(s => s.id === 'fourth'), true);

// Dangling assignment (group deleted) falls back to native group.
const dangling: Config = { ...dflt, entryMeta: { [POV2]: { groupId: 'ghost' } } };
const dview = resolveView(parse, dangling);
check(
  'dangling groupId falls back to native',
  dview.sections.find(s => s.id === POV)!.entries.some(e => e.id === POV2),
  true,
);

// Deleting a virtual container preserves children, text states and historical scopes.
const deleted = defaultConfig();
const makeGroup = (id: string, parentId?: string) => ({ id, name: id, parentId, rule: 'multi' as const, order: 0, pinned: false, hidden: false, required: false, collapsed: false });
deleted.customGroups = [makeGroup('parent'), makeGroup('middle', 'parent'), makeGroup('leaf', 'middle')];
deleted.entryMeta = { e: { groupId: 'middle', alwaysOn: true } };
deleted.scenarios = [{ id: 'mode', name: 'mode', groupIds: ['parent', 'middle', 'leaf'], layout: [{ groupId: 'middle', order: 0 }, { groupId: 'leaf', parentId: 'middle', order: 1 }], snapshots: [{ id: 'snap', name: 'scope', selections: { e: false } }] }];
check('custom group deletes', removeCustomGroup(deleted, 'middle'), true);
check('child reparents to grandparent', deleted.customGroups.find(g => g.id === 'leaf')?.parentId, 'parent');
check('entry keeps overrides and moves to parent', deleted.entryMeta.e, { groupId: 'parent', alwaysOn: true });
check('mode drops deleted membership', deleted.scenarios[0].groupIds, ['parent', 'leaf']);
check('mode child moves to deleted group layout parent', deleted.scenarios[0].layout[0].parentId, undefined);
check('deletion preserves snapshot exact scope and OFF value', deleted.scenarios[0].snapshots[0].selections, { e: false });
removeCustomGroup(deleted, 'parent');
check('top-level deletion clears assignment, keeps override', deleted.entryMeta.e, { alwaysOn: true });
check('native group cannot be deleted as a virtual group', removeCustomGroup(deleted, POV), false);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
