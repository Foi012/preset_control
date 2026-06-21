/**
 * Lightweight check for the ST regex → ReplaceRule mapping (the pure half of st-regex).
 * Run: npx ts-node --transpile-only -P tsconfig.check.json src/features/chat-export/st-regex.check.ts
 */
import { toReplaceRule, previewRule, placementRoles, scriptHasMacro, type StRegexScript } from './st-regex';
import { applyReplacements } from './extract';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

// Real exported scripts from the user's ST (删除dashes / 删除accept).
const dashes: StRegexScript = { scriptName: '删除dashes', findRegex: '/——/g', replaceString: '，', disabled: false };
const accept: StRegexScript = { scriptName: '删除accept', findRegex: '\\[(?:Dramatron|Hugo) ACCEPT\\]', replaceString: '', disabled: false };

check('maps findRegex/replaceString', toReplaceRule(dashes), { find: '/——/g', replace: '，' });
check('empty replaceString → delete rule', toReplaceRule(accept), { find: '\\[(?:Dramatron|Hugo) ACCEPT\\]', replace: '' });
check('imported dashes rule applies', applyReplacements('甲——乙', [toReplaceRule(dashes)]), '甲，乙');
check('imported accept rule applies', applyReplacements('[Dramatron ACCEPT]文', [toReplaceRule(accept)]), '文');
check('missing fields → empty rule', toReplaceRule({}), { find: '', replace: '' });

check('preview shows find → replace', previewRule(dashes), '/——/g  →  ，');
check('preview marks deletion', previewRule(accept).endsWith('〔删除〕'), true);

// --- placement → roles ---
check('AI-output placement → assistant', placementRoles([2]), ['assistant']);
check('user-input placement → user', placementRoles([1]), ['user']);
check('both placements → both roles', placementRoles([1, 2]), ['user', 'assistant']);
check('no placement → undefined (all roles)', placementRoles([]), undefined);
check('non-text placement (WI) → undefined', placementRoles([5]), undefined);
check('toReplaceRule carries roles from placement', toReplaceRule({ findRegex: '/x/', replaceString: '', placement: [2] }).roles, ['assistant']);

// --- macro detection ---
check('macro find flagged', scriptHasMacro({ findRegex: '{{char}} said' }), true);
check('plain find not flagged', scriptHasMacro({ findRegex: '/——/g' }), false);
check('user samples carry no macros', scriptHasMacro(dashes) || scriptHasMacro(accept), false);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
