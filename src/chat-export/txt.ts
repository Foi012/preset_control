/**
 * Plain-text output — the cheap second export target. Each chapter as a heading +
 * optional meta line + body, separated by blank lines.
 */
import type { Chapter } from './chapters';
import type { BookMeta } from './render';

export function chaptersToTxt(chapters: Chapter[], meta?: BookMeta): string {
  const head = meta ? [meta.title, meta.author].filter(Boolean).join('\n') : '';
  const blocks = chapters.map(ch => {
    const metaLine = Object.values(ch.meta).filter(Boolean).join(' · ');
    return [ch.title, metaLine, '', ch.body].filter((line, i) => line !== '' || i === 2).join('\n');
  });
  return [head, ...blocks].filter(Boolean).join('\n\n\n');
}
