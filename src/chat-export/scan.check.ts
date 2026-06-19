/**
 * Lightweight check for the tag scanner.
 * Run: npx ts-node --transpile-only -P tsconfig.check.json src/chat-export/scan.check.ts
 */
import { scanTags } from './scan';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const texts = [
  '<正文>段一</正文><think>略</think>',
  '<正文>段二</正文><正文>段三</正文>',
  '<think>x</think><br>未闭合 <stray>',
];

const tags = scanTags(texts);

check('finds balanced tags only (no <br>/<stray>)', tags.map(t => t.tag).sort(), ['think', '正文']);
check('counts balanced occurrences', tags.find(t => t.tag === '正文')?.count, 3);
check('counts think', tags.find(t => t.tag === 'think')?.count, 2);
check('sorted by frequency desc', tags[0].tag, '正文');
check('CJK tag names supported', tags.some(t => t.tag === '正文'), true);
check('attributes on opening tag still match', scanTags(['<div class="a">x</div>']).map(t => t.tag), ['div']);
check('unbalanced tag excluded', scanTags(['<a>1</a><a>2']).length, 0);
check('empty input → no tags', scanTags([]), []);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
