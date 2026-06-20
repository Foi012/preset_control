/**
 * HTML templates — Phase 4. Turns chapters into conservative, semantic XHTML for the
 * EPUB (Phase 5 zips these up) and provides the shared stylesheet + nav document.
 * Everything is escaped and uses a deliberately small CSS subset so quirky e-readers
 * don't choke.
 */
import type { Chapter } from './chapters';
import type { ResolvedRule } from './style';

export interface BookMeta {
  title: string;
  author: string;
  /** BCP-47-ish language code, e.g. `zh`, `en`. */
  language: string;
  cover?: {
    data: Uint8Array;
    mediaType: string;
    href: string;
  } | null;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape, then turn single newlines into `<br/>` — the leaf transform for plain text. */
function escapeBr(s: string): string {
  return escapeXml(s).replace(/\n/g, '<br/>');
}

/**
 * Apply styling rules to one paragraph, returning XHTML-safe inner HTML.
 *
 * Tokenizer: start with the whole paragraph as one text token; each rule splits text
 * tokens into escaped text + `<span class>`-wrapped matches (group 1 if present, else
 * the whole match), leaving already-wrapped tokens untouched so we never re-match inside
 * a span. Non-overlapping, rule-order priority. The only HTML emitted is our own span
 * around escaped content — never user HTML.
 */
export function decorateInline(text: string, rules: ResolvedRule[]): string {
  type Tok = { html: false; s: string } | { html: true; s: string };
  let toks: Tok[] = [{ html: false, s: text }];
  for (const rule of rules) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : `${rule.re.flags}g`);
    const next: Tok[] = [];
    for (const tok of toks) {
      if (tok.html) {
        next.push(tok);
        continue;
      }
      const s = tok.s;
      let last = 0;
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(s))) {
        if (m[0] === '') {
          re.lastIndex++;
          continue;
        }
        if (m.index > last) next.push({ html: false, s: s.slice(last, m.index) });
        const inner = m[1] ?? m[0];
        next.push({ html: true, s: `<span class="${rule.className}">${escapeBr(inner)}</span>` });
        last = m.index + m[0].length;
      }
      if (last < s.length) next.push({ html: false, s: s.slice(last) });
    }
    toks = next;
  }
  return toks.map(tok => (tok.html ? tok.s : escapeBr(tok.s))).join('');
}

/**
 * Body text → escaped `<p>` blocks (split on blank lines; single newlines → `<br/>`).
 * With styling `rules`, each paragraph's inner text is decorated with `<span class>`s.
 */
export function bodyToParagraphs(body: string, rules: ResolvedRule[] = []): string {
  return body
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${rules.length ? decorateInline(p, rules) : escapeBr(p)}</p>`)
    .join('\n');
}

/** A meta line (time · location · …) from a chapter's captured fields, or ''. */
export function metaLine(meta: Record<string, string>): string {
  const parts = Object.values(meta).filter(Boolean);
  return parts.length ? `<p class="meta">${parts.map(escapeXml).join(' · ')}</p>` : '';
}

/** One chapter → a full XHTML document. `rules` style the body inline (default: none). */
export function chapterXhtml(ch: Chapter, meta: BookMeta, rules: ResolvedRule[] = []): string {
  const lang = escapeXml(meta.language || 'zh');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}" lang="${lang}">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(ch.title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<section class="chapter">
<h1>${escapeXml(ch.title)}</h1>
${metaLine(ch.meta)}
${bodyToParagraphs(ch.body, rules)}
</section>
</body>
</html>`;
}

/** EPUB3 navigation document listing the chapters. */
export function navXhtml(chapters: Chapter[], meta: BookMeta, href: (ch: Chapter) => string): string {
  const lang = escapeXml(meta.language || 'zh');
  const items = chapters
    .map(ch => `<li><a href="${escapeXml(href(ch))}">${escapeXml(ch.title)}</a></li>`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>目录</title></head>
<body>
<nav epub:type="toc" id="toc">
<h1>目录</h1>
<ol>
${items}
</ol>
</nav>
</body>
</html>`;
}

/** Conservative stylesheet shared by every chapter. */
export const BOOK_CSS = `body { margin: 5% 6%; line-height: 1.6; font-family: serif; }
h1 { font-size: 1.4em; margin: 0 0 0.8em; text-align: center; }
p { margin: 0 0 0.9em; text-indent: 2em; }
p.meta { text-align: center; text-indent: 0; color: #666; font-size: 0.9em; }
`;
