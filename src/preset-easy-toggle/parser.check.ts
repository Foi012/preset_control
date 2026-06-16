/**
 * Lightweight check for the parser against the trimmed fixture.
 * Run: npx ts-node --transpile-only -P tsconfig.novelizer.json src/preset-easy-toggle/parser.check.ts
 * (no test runner is configured in this repo; this is a plain assertion script)
 */
import { parsePreset } from './parser';
import fixture from './__fixtures__/preset.json';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const result = parsePreset(fixture.prompts as any);

check('region found', result.regionFound, true);
check('no loose entries', result.looseEntries.length, 0);
check('9 sections', result.sections.length, 9);
check('full-preset catalog includes outside scaffold entries', result.allEntries.some(e => e.id === '0322500e-vars'), true);
check('full-preset catalog excludes region markers', result.allEntries.some(e => e.name === '⚙️CUSTOMIZATION_START'), false);
check('managed entries marked in catalog', result.allEntries.find(e => e.id === '2b6313b3-pov2')?.inManagedRegion, true);
check('outside entries marked in catalog', result.allEntries.find(e => e.id === 'd07b0943-head')?.inManagedRegion, false);

const byHeader = Object.fromEntries(result.sections.map(s => [s.headerName, s]));

// Section presence + counts
check('[03-POV] has 5 entries', byHeader['[03-POV]']?.entries.length, 5);
check('[00-USER INPUT] has 8 entries', byHeader['[00-USER INPUT]']?.entries.length, 8);

// Rule guessing (the hard cases)
check('POV → single (same setvar)', byHeader['[03-POV]']?.guessedRule, 'single');
check('PERSONA → single', byHeader['[01-PERSONA]']?.guessedRule, 'single');
check('STYLES → single (all off, same setvar)', byHeader['[07-STYLES]']?.guessedRule, 'single');
check('DIALOGUE → multi (1 on, distinct setvars)', byHeader['[02-DIALOGUE]']?.guessedRule, 'multi');
check('PLOTS → multi', byHeader['[04-PLOTS]']?.guessedRule, 'multi');
check('CHAR_BUILDING → multi', byHeader['[05-CHAR_BUILDING]']?.guessedRule, 'multi');
check('OTHERS → multi', byHeader['[06-OTHERS]']?.guessedRule, 'multi');

// Entry flags (📍 and ✍️ are independent — an entry can be both)
const userInput = byHeader['[00-USER INPUT]'];
check('USER INPUT all input', userInput?.entries.every(e => e.input), true);
check('USER INPUT 正文语言 is always-on + input', (() => {
  const e = userInput?.entries.find(x => x.name.includes('正文语言'));
  return e ? { alwaysOn: e.alwaysOn, input: e.input } : null;
})(), { alwaysOn: true, input: true });
const scene = byHeader['[08-SCENE]'];
check('SCENE General is always-on, not input', (() => {
  const e = scene?.entries.find(x => x.name === '📍General');
  return e ? { alwaysOn: e.alwaysOn, input: e.input } : null;
})(), { alwaysOn: true, input: false });
check('SCENE GPT-* is plain', (() => {
  const e = scene?.entries.find(x => x.name.startsWith('GPT'));
  return e ? { alwaysOn: e.alwaysOn, input: e.input } : null;
})(), { alwaysOn: false, input: false });

// Out-of-region scaffold excluded
const allNames = result.sections.flatMap(s => s.entries.map(e => e.name)).concat(result.sections.map(s => s.headerName));
check('📍VARS excluded (pre-region)', allNames.includes('📍VARS'), false);
check('💠GENERAL/CLEAR excluded (post-region)', allNames.includes('💠GENERAL/CLEAR'), false);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
