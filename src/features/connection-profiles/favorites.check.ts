/**
 * Lightweight check for the 连接档案 favorites model (no ST, no DOM).
 * Run: npx ts-node --transpile-only -P tsconfig.check.json src/features/connection-profiles/favorites.check.ts
 */
import {
  reconcileFavorites, resolveForApply, addFavorite, removeFavorite, updateFavorite, moveFavorite, setParamValue,
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

// --- reconcile --------------------------------------------------------------
check('reconcile fills live name/model/preset', reconcileFavorites([{ profileId: 'g1' }], profiles)[0], {
  profileId: 'g1', name: '【gpt】 - 写作', label: '【gpt】 - 写作', model: 'gpt-x', preset: 'Hugo', snapshotId: undefined, missing: false,
});
check('explicit label overrides the long name', reconcileFavorites([{ profileId: 'c1', label: 'C' }], profiles)[0].label, 'C');
check('blank label falls back to live name', reconcileFavorites([{ profileId: 'c1', label: '  ' }], profiles)[0].label, '【claude】 - 写作');
const missing = reconcileFavorites([{ profileId: 'gone' }], profiles)[0];
check('deleted profile is missing, not dropped', [missing.missing, missing.label], [true, '(已删除)']);
check('reconcile preserves favorite order', reconcileFavorites([{ profileId: 'c1' }, { profileId: 'g1' }], profiles).map(f => f.profileId), ['c1', 'g1']);

// --- resolveForApply (blocks a missing rig) --------------------------------
check('resolveForApply returns the live profile for a good id', resolveForApply([{ profileId: 'g1' }], profiles, 'g1')?.name, '【gpt】 - 写作');
check('resolveForApply blocks a missing id (null)', resolveForApply([{ profileId: 'gone' }], profiles, 'gone'), null);
check('resolveForApply threads the bound snapshot', resolveForApply([{ profileId: 'g1', snapshotId: 's9' }], profiles, 'g1')?.snapshotId, 's9');

// --- list ops (pure, immutable) --------------------------------------------
const favs: Favorite[] = [{ profileId: 'g1' }];
check('addFavorite appends', addFavorite(favs, 'c1').map(f => f.profileId), ['g1', 'c1']);
check('addFavorite dedups (returns same ref)', addFavorite(favs, 'g1') === favs, true);
check('removeFavorite drops by id', removeFavorite([{ profileId: 'g1' }, { profileId: 'c1' }], 'g1').map(f => f.profileId), ['c1']);

// --- updateFavorite (set + clear) ------------------------------------------
check('updateFavorite sets label', updateFavorite(favs, 'g1', { label: 'GPT' })[0].label, 'GPT');
check('updateFavorite binds snapshot', updateFavorite(favs, 'g1', { snapshotId: 's1' })[0].snapshotId, 's1');
check('updateFavorite clears snapshot with empty string', updateFavorite([{ profileId: 'g1', snapshotId: 's1' }], 'g1', { snapshotId: '' })[0], { profileId: 'g1' });
check('updateFavorite ignores other ids', updateFavorite([{ profileId: 'g1' }, { profileId: 'c1' }], 'c1', { label: 'X' })[0], { profileId: 'g1' });

// --- setParamValue (the temp/param override ST drops) ----------------------
check('setParamValue stores a send setting', setParamValue(favs, 'g1', 'temp_openai', 1.1)[0].params, { temp_openai: { mode: 'send', value: 1.1 } });
check('setParamValue null clears the override + prunes params', setParamValue([{ profileId: 'g1', params: { temp_openai: { mode: 'send', value: 1.1 } } }], 'g1', 'temp_openai', null)[0], { profileId: 'g1' });
check('setParamValue keeps other params when clearing one', setParamValue([{ profileId: 'g1', params: { temp_openai: { mode: 'send', value: 1.1 }, top_p_openai: { mode: 'send', value: 0.9 } } }], 'g1', 'temp_openai', null)[0].params, { top_p_openai: { mode: 'send', value: 0.9 } });
check('setParamValue ignores non-finite', setParamValue(favs, 'g1', 'temp_openai', NaN)[0].params, undefined);
check('reconcile carries params through', reconcileFavorites([{ profileId: 'g1', params: { temp_openai: { mode: 'send', value: 1.2 } } }], profiles)[0].params, { temp_openai: { mode: 'send', value: 1.2 } });

// --- moveFavorite (reorder, clamped) ---------------------------------------
const two: Favorite[] = [{ profileId: 'g1' }, { profileId: 'c1' }];
check('moveFavorite down swaps', moveFavorite(two, 'g1', 1).map(f => f.profileId), ['c1', 'g1']);
check('moveFavorite up at top is a no-op (same ref)', moveFavorite(two, 'g1', -1) === two, true);
check('moveFavorite down at bottom is a no-op', moveFavorite(two, 'c1', 1) === two, true);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
