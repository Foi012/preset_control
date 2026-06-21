/**
 * Lightweight check for the typography engine + inline decoration.
 * Run: npx ts-node --transpile-only -P tsconfig.check.json src/features/chat-export/style.check.ts
 */
import { resolveStyleRules, buildStyleCss, sanitizeClassName, sanitizeColor, styleRenderOptions, emptyStyleConfig, DIALOGUE_COLORS, type StyleConfig } from './style';
import { bodyToParagraphs, decorateInline } from './render';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

// --- class sanitizing ------------------------------------------------------
check('sanitizeClassName strips junk', sanitizeClassName(' my .cls<x>! '), 'myclsx');
check('sanitizeClassName keeps hyphen/underscore', sanitizeClassName('st-my_cls'), 'st-my_cls');
check('sanitizeClassName empty → fallback', sanitizeClassName('  «»  '), 'st-custom');

// --- resolveStyleRules -----------------------------------------------------
check('no config → no rules', resolveStyleRules(emptyStyleConfig()).length, 0);
const dialogueOnly: StyleConfig = { presets: ['dialogue'], rules: [], css: '' };
check('dialogue preset resolves to one rule', resolveStyleRules(dialogueOnly).length, 1);
check('dialogue rule class', resolveStyleRules(dialogueOnly)[0].className, 'st-dialogue');
check('css-only preset (dropcap) yields no rule', resolveStyleRules({ presets: ['dropcap'], rules: [], css: '' }).length, 0);
check('invalid custom regex is skipped, never throws', resolveStyleRules({ presets: [], rules: [{ pattern: '/(/', className: 'x' }], css: '' }).length, 0);
check(
  'preset + custom rule order (presets first)',
  resolveStyleRules({ presets: ['dialogue'], rules: [{ pattern: '/foo/', className: 'bar' }], css: '' }).map(r => r.className),
  ['st-dialogue', 'bar'],
);

// --- buildStyleCss ---------------------------------------------------------
check('enabled preset css included', buildStyleCss(dialogueOnly).includes('.st-dialogue'), true);
check('disabled preset css excluded', buildStyleCss(emptyStyleConfig()).includes('.st-dialogue'), false);
check('dropcap css included when on', buildStyleCss({ presets: ['dropcap'], rules: [], css: '' }).includes('::first-letter'), true);
check('custom css appended', buildStyleCss({ presets: [], rules: [], css: '.x{color:red}' }).includes('.x{color:red}'), true);

// --- decorateInline --------------------------------------------------------
check('no rules → plain escape parity', decorateInline('<a>&"', []), '&lt;a&gt;&amp;&quot;');
const dRules = resolveStyleRules(dialogueOnly);
check(
  'dialogue wraps quoted span incl. quotes',
  decorateInline('他说"你好"。', dRules),
  '他说<span class="st-dialogue">&quot;你好&quot;</span>。',
);
check('plain text outside a match is escaped', decorateInline('<x> "hi"', dRules), '&lt;x&gt; <span class="st-dialogue">&quot;hi&quot;</span>');
const mdRules = resolveStyleRules({ presets: ['markdown'], rules: [], css: '' });
check('markdown italic wraps group 1 and drops markers', decorateInline('看 *重点* 哦', mdRules), '看 <span class="st-i">重点</span> 哦');
check('markdown bold', decorateInline('**很重要**', mdRules), '<span class="st-b">很重要</span>');
check('markdown bold-italic before bold/italic', decorateInline('***超***', mdRules), '<span class="st-bi">超</span>');
check('markdown strikethrough', decorateInline('~~划掉~~', mdRules), '<span class="st-del">划掉</span>');
check('markdown underscore italic', decorateInline('a _it_ b', mdRules), 'a <span class="st-i">it</span> b');
check(
  'dialogue + markdown do not re-match inside an existing span',
  decorateInline('"*x*"', resolveStyleRules({ presets: ['dialogue', 'markdown'], rules: [], css: '' })),
  '<span class="st-dialogue">&quot;*x*&quot;</span>',
);

// --- blockquote (block-level) ---------------------------------------------
check('blockquote off → no transform', bodyToParagraphs('> 引用', mdRules, {}), '<p class="cex-lead">&gt; 引用</p>');
check('blockquote on → <blockquote>', bodyToParagraphs('> 引用', mdRules, styleRenderOptions({ presets: ['markdown'], rules: [], css: '' })), '<blockquote><p>引用</p></blockquote>');
check(
  'nested >> blockquote',
  bodyToParagraphs('> 外\n>> 内', mdRules, styleRenderOptions({ presets: ['markdown'], rules: [], css: '' })),
  '<blockquote><p>外</p><blockquote><p>内</p></blockquote></blockquote>',
);
check('styleRenderOptions.blockquote true with markdown', styleRenderOptions({ presets: ['markdown'], rules: [], css: '' }).blockquote, true);
check('styleRenderOptions.blockquote false otherwise', styleRenderOptions(dialogueOnly).blockquote, false);

// --- bodyToParagraphs threading rules --------------------------------------
check(
  'bodyToParagraphs decorates each paragraph',
  bodyToParagraphs('他说"嗨"\n\n下一段', dRules),
  '<p class="cex-lead">他说<span class="st-dialogue">&quot;嗨&quot;</span></p>\n<p>下一段</p>',
);
check('bodyToParagraphs with no rules unchanged', bodyToParagraphs('上\n下', []), '<p class="cex-lead">上<br/>下</p>');

// --- dialogue color (independent of the bold preset) -----------------------
const colorOnly: StyleConfig = { presets: [], rules: [], css: '', dialogueColor: '#5b7fa6' };
check('color alone wraps dialogue (rule added without bold preset)', resolveStyleRules(colorOnly).length, 1);
check('color alone emits color css, no bold', buildStyleCss(colorOnly), '.st-dialogue { color: #5b7fa6; }');
const both: StyleConfig = { presets: ['dialogue'], rules: [], css: '', dialogueColor: '#b05566' };
check('bold + color: rule not double-added', resolveStyleRules(both).length, 1);
check('bold + color emits both declarations', buildStyleCss(both), '.st-dialogue { font-weight: bold; }\n.st-dialogue { color: #b05566; }');
check('bold alone emits only bold', buildStyleCss({ presets: ['dialogue'], rules: [], css: '' }), '.st-dialogue { font-weight: bold; }');
check('bad color is dropped (no css)', buildStyleCss({ presets: [], rules: [], css: '', dialogueColor: 'red); }body{x' }), '');
check('sanitizeColor accepts #rrggbb', sanitizeColor('#5b7fa6'), '#5b7fa6');
check('sanitizeColor rejects junk', sanitizeColor('javascript:1'), '');
check('all swatches are valid colors', DIALOGUE_COLORS.every(c => sanitizeColor(c.value) === c.value), true);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
