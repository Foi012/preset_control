/**
 * Lightweight check for the two-bucket strip/extract engine.
 * Run: npx ts-node --transpile-only -P tsconfig.check.json src/features/chat-export/extract.check.ts
 */
import { parseRegex, asTagName, ruleError, stripExcludes, extractMessage } from './extract';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

// --- parseRegex / tag detection -------------------------------------------
check('empty pattern → null, no error', parseRegex('').re, null);
check('/pattern/flags parsed', parseRegex('/a.c/i').re?.flags, 'i');
check('invalid regex reports error', parseRegex('(').error.length > 0, true);
check('bare CJK tag detected', asTagName('正文'), '正文');
check('<think> tag detected', asTagName('<think>'), 'think');
check('</正文> closing tag detected', asTagName('</正文>'), '正文');
check('regex is not a tag', asTagName('/<x>(.*)/'), null);
check('ruleError ok for a tag', ruleError('正文'), '');
check('ruleError flags bad regex', ruleError('(').length > 0, true);

// --- excludes (apply to all messages) -------------------------------------
check('preset strips <think>', stripExcludes('前<think>x</think>后', { strip: { reasoning: true } }), '前后');
check('preset strips （OOC：…）', stripExcludes('正文（OOC：注）尾', { strip: { ooc: true } }), '正文尾');
check('exclude tag removes block', stripExcludes('a<aside>x</aside>b', { exclude: ['aside'] }), 'ab');
check('exclude regex removes matches', stripExcludes('a-b-c', { exclude: ['/-/g'] }), 'abc');
check('bad exclude regex is ignored', stripExcludes('abc', { exclude: ['('] }), 'abc');

// --- include / 正文 (assistant only) --------------------------------------
const cfg = { include: ['正文'] };
check('no include rule → whole text is body', extractMessage('整段', 'assistant', {}), { body: '整段', fields: {}, matched: true });
check('user turn is never extracted (raw)', extractMessage('<正文>x</正文>', 'user', cfg), { body: '<正文>x</正文>', fields: {}, matched: true });

const a1 = extractMessage('引言<正文>月光落在松林上。</正文>尾注', 'assistant', cfg);
check('正文 tag → body only', a1.body, '月光落在松林上。');
check('正文 matched', a1.matched, true);

const a2 = extractMessage('<标题>第一章</标题><正文>章节内容</正文>', 'assistant', { include: ['正文', '标题'] });
check('multiple include tags: body from 正文', a2.body, '章节内容');
check('non-body tag → field', a2.fields['标题'], '第一章');

const a3 = extractMessage('<正文>段一</正文>…<正文>段二</正文>', 'assistant', cfg);
check('repeated 正文 tags joined', a3.body, '段一\n\n段二');

const attr = extractMessage('<正文 class="x">带属性</正文>', 'assistant', cfg);
check('tag with attributes still extracts', attr.body, '带属性');

const a4 = extractMessage('<title>第二章</title><正文>正文体</正文>', 'assistant', {
  include: ['/<title>(?<title>.*?)<\\/title>/', '正文'],
});
check('regex named group → title field', a4.fields.title, '第二章');
check('regex + tag compose for body', a4.body, '正文体');

const miss = extractMessage('没有正文标签的回复', 'assistant', cfg);
check('include set but no match → matched false', miss.matched, false);
check('no match → body falls back to full stripped text', miss.body, '没有正文标签的回复');

// --- 标题 destination (title rules pin fields.title) -----------------------
const t1 = extractMessage('<title>第一章 启程</title><正文>正文体</正文>', 'assistant', {
  include: ['正文'],
  title: ['title'],
});
check('title tag → title field', t1.fields.title, '第一章 启程');
check('title rule + body rule compose', t1.body, '正文体');

const t2 = extractMessage('# 月下独行\n正文若干', 'assistant', { title: ['/^#\\s*(?<title>.+)$/m'] });
check('title regex named group → title field', t2.fields.title, '月下独行');
check('title-only match counts as matched', t2.matched, true);
check('title-only → body falls back to full text', t2.body, '# 月下独行\n正文若干');

// --- compose: exclude runs before include ---------------------------------
const comp = extractMessage('<think>略</think><正文>纯正文</正文>', 'assistant', {
  strip: { reasoning: true },
  include: ['正文'],
});
check('exclude before include', comp.body, '纯正文');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
