/**
 * HTML templates — Phase 4. Turns chapters into conservative, semantic XHTML for the
 * EPUB (Phase 5 zips these up) and provides the shared stylesheet + nav document.
 * Everything is escaped and uses a deliberately small CSS subset so quirky e-readers
 * don't choke.
 */
import type { Chapter } from './chapters';

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

/** Body text → escaped `<p>` blocks (split on blank lines; single newlines → `<br/>`). */
export function bodyToParagraphs(body: string): string {
  return body
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${escapeXml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

/** A meta line (time · location · …) from a chapter's captured fields, or ''. */
export function metaLine(meta: Record<string, string>): string {
  const parts = Object.values(meta).filter(Boolean);
  return parts.length ? `<p class="meta">${parts.map(escapeXml).join(' · ')}</p>` : '';
}

/** One chapter → a full XHTML document. */
export function chapterXhtml(ch: Chapter, meta: BookMeta): string {
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
${bodyToParagraphs(ch.body)}
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
