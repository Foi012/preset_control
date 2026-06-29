/**
 * Lightweight check for the 连接档案 favorites model (no ST, no DOM).
 * Run: npx ts-node --transpile-only -P tsconfig.check.json src/features/connection-profiles/favorites.check.ts
 */
import {
  reconcileFavorites, resolveForApply, createFavorite, duplicateFavorite, removeFavorite, updateFavorite,
  setParamValue, setExtraField, setOverlay, moveFavorite, savedProfileIds,
  type Favorite, type ConnProfileLite,
} from './favorites';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const profiles: ConnProfileLite[] = [
  { id: 'g1', name: '【gpt】 - 写作', model: 'gpt-x', preset: 'Hugo' },
  { id: 'c1', name: '【claude】 - 写作', model: 'claude-x', preset: 'Klaude' },
];

// --- create / multi-variant (the "2 temps on 1 connection" case) -----------
check('createFavorite adds a variant with its own id', createFavorite([], 'c1', 'v1', 'Claude热').map(f => [f.id, f.profileId, f.label]), [['v1', 'c1', 'Claude热']]);
const twoVariants = createFavorite(createFavorite([], 'c1', 'hot', '热'), 'c1', 'cold', '冷');
check('two variants can share one profileId', twoVariants.map(f => f.id), ['hot', 'cold']);
check('savedProfileIds dedups shared profiles', [...savedProfileIds(twoVariants)], ['c1']);

// --- duplicate -------------------------------------------------------------
const dup = duplicateFavorite([{ id: 'hot', profileId: 'c1', label: '热', params: { temp_openai: { mode: 'send', value: 1.1 } } }], 'hot', 'hot2');
check('duplicate clones overlay under a new id, inserted after source', dup.map(f => f.id), ['hot', 'hot2']);
check('duplicate carries params + suffixes label', [dup[1].params, dup[1].label], [{ temp_openai: { mode: 'send', value: 1.1 } }, '热 副本']);

// --- reconcile -------------------------------------------------------------
check('reconcile fills live fields + carries params/extra', reconcileFavorites([{ id: 'v', profileId: 'g1', params: { temp_openai: { mode: 'send', value: 1 } } }], profiles)[0], {
  id: 'v', profileId: 'g1', name: '【gpt】 - 写作', label: '【gpt】 - 写作', model: 'gpt-x', preset: 'Hugo',
  snapshotId: undefined, params: { temp_openai: { mode: 'send', value: 1 } }, extra: undefined, missing: false,
});
const missing = reconcileFavorites([{ id: 'x', profileId: 'gone' }], profiles)[0];
check('deleted profile is missing, not dropped', [missing.missing, missing.label], [true, '(已删除)']);

// --- resolveForApply (by favorite id; blocks missing) ----------------------
check('resolveForApply finds by favorite id', resolveForApply([{ id: 'v', profileId: 'g1' }], profiles, 'v')?.name, '【gpt】 - 写作');
check('resolveForApply blocks a missing profile', resolveForApply([{ id: 'x', profileId: 'gone' }], profiles, 'x'), null);

// --- params / extra / overlay ----------------------------------------------
const one: Favorite[] = [{ id: 'v', profileId: 'g1' }];
check('setParamValue stores send setting by favorite id', setParamValue(one, 'v', 'temp_openai', 1.1)[0].params, { temp_openai: { mode: 'send', value: 1.1 } });
check('setParamValue null clears + prunes', setParamValue([{ id: 'v', profileId: 'g1', params: { temp_openai: { mode: 'send', value: 1.1 } } }], 'v', 'temp_openai', null)[0], { id: 'v', profileId: 'g1' });
check('setExtraField stores a 附加参数 blob', setExtraField(one, 'v', 'includeBody', '{"x":1}')[0].extra, { includeBody: '{"x":1}' });
check('setExtraField blank clears + prunes', setExtraField([{ id: 'v', profileId: 'g1', extra: { headers: 'a' } }], 'v', 'headers', '  ')[0], { id: 'v', profileId: 'g1' });
check('setOverlay replaces params + trims empty extra', setOverlay(one, 'v', { top_p_openai: { mode: 'send', value: 0.9 } }, { includeBody: ' ', excludeBody: 'keep' })[0], { id: 'v', profileId: 'g1', params: { top_p_openai: { mode: 'send', value: 0.9 } }, extra: { excludeBody: 'keep' } });

// --- list ops --------------------------------------------------------------
check('removeFavorite drops by favorite id (keeps sibling variant)', removeFavorite(twoVariants, 'hot').map(f => f.id), ['cold']);
check('updateFavorite relabels by id', updateFavorite(one, 'v', { label: 'X' })[0].label, 'X');
check('moveFavorite swaps', moveFavorite(twoVariants, 'hot', 1).map(f => f.id), ['cold', 'hot']);
check('moveFavorite at edge is a no-op (same ref)', moveFavorite(twoVariants, 'hot', -1) === twoVariants, true);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
