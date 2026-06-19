/**
 * Lightweight check for chapter splitting.
 * Run: npx ts-node --transpile-only -P tsconfig.check.json src/chat-export/chapters.check.ts
 */
import { buildChapters } from './chapters';
import type { NormMessage, Role } from './normalize';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

let idx = 0;
const m = (role: Role, content: string): NormMessage => ({ index: idx++, role, name: role, content, reasoning: '', hidden: false });

const plain = [m('user', 'u1'), m('assistant', 'a1'), m('user', 'u2'), m('assistant', 'a2')];

// per-message: every message is its own chapter, auto-numbered.
const perMsg = buildChapters(plain, {}, { kind: 'per-message' });
check('per-message → 4 chapters', perMsg.length, 4);
check('per-message auto titles', perMsg.map(c => c.title), ['第1章', '第2章', '第3章', '第4章']);
check('per-message bodies', perMsg.map(c => c.body), ['u1', 'a1', 'u2', 'a2']);

// per-assistant: each AI reply opens a chapter; preceding/leading turns fold in.
const perAsst = buildChapters(plain, {}, { kind: 'per-assistant' });
check('per-assistant → 3 chapters', perAsst.length, 3);
check('per-assistant groups user into following chapter', perAsst.map(c => c.body), ['u1', 'a1\n\nu2', 'a2']);

// every N: fixed-size groups.
const every2 = buildChapters(plain, {}, { kind: 'every', n: 2 });
check('every 2 → 2 chapters', every2.length, 2);
check('every 2 bodies', every2.map(c => c.body), ['u1\n\na1', 'u2\n\na2']);

// title rule: new chapter wherever a `title` field is captured.
idx = 0;
const tagged = [
  m('assistant', '<title>序章</title><正文>开头</正文>'),
  m('assistant', '<正文>续写</正文>'),
  m('assistant', '<title>第二章</title><正文>新章</正文>'),
];
const cfg = { include: ['/<title>(?<title>.*?)<\\/title>/', '正文'] };
const byTitle = buildChapters(tagged, cfg, { kind: 'title' });
check('title rule → 2 chapters', byTitle.length, 2);
check('title rule uses captured titles', byTitle.map(c => c.title), ['序章', '第二章']);
check('untitled turn folds into current chapter', byTitle[0].body, '开头\n\n续写');
check('second chapter body', byTitle[1].body, '新章');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
