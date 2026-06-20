/**
 * Lightweight check for the XHTML templates + TXT output.
 * Run: npx ts-node --transpile-only -P tsconfig.check.json src/features/chat-export/render.check.ts
 */
import { bodyToParagraphs, metaLine, chapterXhtml, navXhtml, escapeXml, type BookMeta } from './render';
import { chaptersToTxt } from './txt';
import type { Chapter } from './chapters';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

// --- escaping + paragraphs -------------------------------------------------
check('escapeXml escapes the five entities', escapeXml(`<a>&"'`), '&lt;a&gt;&amp;&quot;&#39;');
check('blank lines split paragraphs', bodyToParagraphs('一段\n\n二段'), '<p>一段</p>\n<p>二段</p>');
check('single newline → <br/>', bodyToParagraphs('上\n下'), '<p>上<br/>下</p>');
check('content is escaped in paragraphs', bodyToParagraphs('<x>&'), '<p>&lt;x&gt;&amp;</p>');
check('empty body → no paragraphs', bodyToParagraphs('   '), '');
check('role divider --- → <hr>', bodyToParagraphs('上\n\n---\n\n下'), '<p>上</p>\n<hr class="cex-divider"/>\n<p>下</p>');
check('*** / spaced markers → <hr>', bodyToParagraphs('***\n\n* * *'), '<hr class="cex-divider"/>\n<hr class="cex-divider"/>');
check('dashes inside a line are not a divider', bodyToParagraphs('a---b'), '<p>a---b</p>');
check('meta line joins fields', metaLine({ time: '夜', loc: '松林' }), '<p class="meta">夜 · 松林</p>');
check('empty meta → no line', metaLine({}), '');

// --- chapter / nav documents ----------------------------------------------
const meta: BookMeta = { title: '月下', author: 'Hugo', language: 'zh' };
const ch: Chapter = { index: 1, title: '序章 <月>', body: '正文一段。', meta: { time: '夜' } };
const xhtml = chapterXhtml(ch, meta);
check('chapter title is escaped in <title>', xhtml.includes('<title>序章 &lt;月&gt;</title>'), true);
check('chapter has h1', xhtml.includes('<h1>序章 &lt;月&gt;</h1>'), true);
check('chapter links the stylesheet', xhtml.includes('href="style.css"'), true);
check('chapter carries lang', xhtml.includes('lang="zh"'), true);
check('chapter renders meta line', xhtml.includes('<p class="meta">夜</p>'), true);

const chapters: Chapter[] = [ch, { index: 2, title: '第二章', body: 'x', meta: {} }];
const nav = navXhtml(chapters, meta, c => `chap-${String(c.index).padStart(4, '0')}.xhtml`);
check('nav lists chapter titles', nav.includes('>第二章</a>'), true);
check('nav links chapter hrefs', nav.includes('href="chap-0002.xhtml"'), true);
check('nav escapes titles', nav.includes('序章 &lt;月&gt;'), true);

// --- txt -------------------------------------------------------------------
const txt = chaptersToTxt(chapters, meta);
check('txt includes book title', txt.includes('月下'), true);
check('txt includes chapter heading + body', txt.includes('序章 <月>\n夜\n\n正文一段。'), true);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
