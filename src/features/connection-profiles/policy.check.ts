/**
 * Lightweight check for the 连接档案 param-policy core (no ST, no DOM).
 * Run: npx ts-node --transpile-only -P tsconfig.check.json src/features/connection-profiles/policy.check.ts
 */
import { resolveParamApply, type ProfileExtras } from './policy';
import { PARAMS, paramDef } from './params';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const base = (params: ProfileExtras['params']): ProfileExtras => ({ profileId: 'p1', params });

// --- registry integrity ----------------------------------------------------
check('param ids and body keys are all unique', new Set(PARAMS.map(p => p.id)).size + new Set(PARAMS.map(p => p.body)).size, PARAMS.length * 2);
check('every param has a sane range (min < max)', PARAMS.every(p => p.min < p.max), true);
check('paramDef finds a known id', paramDef('temp_openai')?.body, 'temperature');
check('paramDef on unknown id is undefined', paramDef('nope'), undefined);

// --- send -------------------------------------------------------------------
check('send writes the value to the oai field', resolveParamApply(base({ temp_openai: { mode: 'send', value: 1.05 } })).settings, { temp_openai: 1.05 });
check('send never adds to excludeBody', resolveParamApply(base({ temp_openai: { mode: 'send', value: 1.05 } })).excludeBody, []);
check('send without a value is a no-op (ST/preset wins)', resolveParamApply(base({ temp_openai: { mode: 'send' } })).settings, {});

// --- lock (#2: "only temp=1") ----------------------------------------------
check('lock forces the value', resolveParamApply(base({ temp_openai: { mode: 'lock', value: 1 } })).settings, { temp_openai: 1 });
check('lock without a value is skipped, never throws', resolveParamApply(base({ temp_openai: { mode: 'lock' } })).settings, {});

// --- drop (#1: "endpoint rejects top_k") -----------------------------------
check('drop names the request-body key, not the oai field', resolveParamApply(base({ top_k_openai: { mode: 'drop' } })).excludeBody, ['top_k']);
check('drop writes nothing into settings', resolveParamApply(base({ top_k_openai: { mode: 'drop' } })).settings, {});
check('freq_pen drop maps to frequency_penalty', resolveParamApply(base({ freq_pen_openai: { mode: 'drop' } })).excludeBody, ['frequency_penalty']);

// --- clamping & sanitization -----------------------------------------------
check('over-max value is clamped', resolveParamApply(base({ temp_openai: { mode: 'lock', value: 9 } })).settings, { temp_openai: 2 });
check('below-min value is clamped', resolveParamApply(base({ freq_pen_openai: { mode: 'send', value: -9 } })).settings, { freq_pen_openai: -2 });
check('integer-stepped param is rounded', resolveParamApply(base({ top_k_openai: { mode: 'send', value: 40.7 } })).settings, { top_k_openai: 41 });
check('NaN is skipped, never throws', resolveParamApply(base({ temp_openai: { mode: 'send', value: NaN } })).settings, {});

// --- determinism & unknown ids ---------------------------------------------
check('unknown param id is ignored', resolveParamApply({ profileId: 'p1', params: { bogus: { mode: 'send', value: 1 } } as never }).settings, {});
check(
  'excludeBody follows registry order regardless of map insertion order',
  resolveParamApply(base({ pres_pen_openai: { mode: 'drop' }, top_k_openai: { mode: 'drop' } })).excludeBody,
  ['top_k', 'presence_penalty'],
);

// --- a realistic mixed profile (a GPT endpoint that bans top_k, caps temp) --
const gptRig = resolveParamApply(base({
  temp_openai: { mode: 'lock', value: 1 },
  top_k_openai: { mode: 'drop' },
  freq_pen_openai: { mode: 'send', value: 0.3 },
}));
check('mixed rig settings', gptRig.settings, { temp_openai: 1, freq_pen_openai: 0.3 });
check('mixed rig excludeBody', gptRig.excludeBody, ['top_k']);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
