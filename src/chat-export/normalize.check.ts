/**
 * Lightweight check for the chat normalizer against the trimmed `.jsonl` fixture.
 * Mirrors `src/preset-easy-toggle/parser.check.ts`; no test runner is configured.
 * Run: npx ts-node --transpile-only -P tsconfig.check.json src/chat-export/normalize.check.ts
 */
import { parseJsonl, normalizeMessages, activeSwipeText, isGenuineSystem } from './normalize';
import { sampleJsonl } from './__fixtures__/chat-jsonl';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const raw = parseJsonl(sampleJsonl);

// parse: 5 valid objects (header + user + assistant + hidden-assistant + comment).
check('parseJsonl skips malformed + blank', raw.length, 5);
check('parseJsonl keeps the header object', typeof raw[0].mes, 'undefined');

// genuine system = has extra.type; a /hide-d turn (is_system, no type) is NOT system.
check('comment is genuine system', isGenuineSystem(raw[4]), true);
check('hidden assistant turn is NOT genuine system', isGenuineSystem(raw[3]), false);

const msgs = normalizeMessages(raw);

// default: keep user + assistant + hidden assistant; drop the genuine system msg.
check('default keeps user + assistant + hidden turn', msgs.length, 3);
check('roles: hidden turn is still assistant', msgs.map(m => m.role), ['user', 'assistant', 'assistant']);
check('hidden flags', msgs.map(m => m.hidden), [false, false, true]);
check('indices dense 0-based', msgs.map(m => m.index), [0, 1, 2]);

// active swipe = the message's `mes` (== swipes[swipe_id]), never a merge.
check('assistant content is the active swipe', msgs[1].content, '月光落在黄石公园的松林上。');
check('hidden turn keeps its real content', msgs[2].content, '被隐藏的旧章节，仍是正文。');
check('activeSwipeText falls back to swipes when mes missing', activeSwipeText({ swipe_id: 0, swipes: ['A', 'B'] }), 'A');
check('reasoning captured', msgs[1].reasoning, '先确定 POV 与节奏。');

// includeUser:false → assistant turns only (incl. the hidden one).
const noUser = normalizeMessages(raw, { includeUser: false });
check('includeUser:false → assistants only', noUser.map(m => m.role), ['assistant', 'assistant']);

// includeHidden:false → drop the /hide-d turn, keep the rest.
const noHidden = normalizeMessages(raw, { includeHidden: false });
check('includeHidden:false drops the hidden turn', noHidden.map(m => m.hidden), [false, false]);
check('includeHidden:false → user + visible assistant', noHidden.map(m => m.role), ['user', 'assistant']);

// includeSystem:true → pull in the genuine system message.
const withSys = normalizeMessages(raw, { includeSystem: true });
check('includeSystem:true adds the system msg', withSys.map(m => m.role), ['user', 'assistant', 'assistant', 'system']);
check('the system msg is not flagged hidden', withSys[3].hidden, false);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
