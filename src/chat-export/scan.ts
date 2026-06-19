/**
 * Tag scanner — finds the structural tags in a chat so the user can click each one
 * into the 排除 / 提取 buckets instead of typing it.
 *
 * We count opening `<tag …>` and closing `</tag>` occurrences across every message
 * and report only **balanced** tags (opens === closes, opens > 0) — the lesson the
 * reference 酒馆助手 script learned: unbalanced/stray tags are noise. Tag names may be
 * CJK (`<正文>`), and opening tags may carry attributes. Results are sorted by
 * frequency (then name) so the meaningful structural tags surface first.
 */

const NAME = '[\\p{L}\\p{N}_-]+';
const OPEN_SRC = `<(${NAME})(?:\\s[^>]*)?>`;
const CLOSE_SRC = `<\\/(${NAME})\\s*>`;

export interface ScannedTag {
  tag: string;
  /** Balanced occurrences (== opens == closes). */
  count: number;
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Scan message contents for balanced `<tag>…</tag>` pairs, most frequent first. */
export function scanTags(texts: string[]): ScannedTag[] {
  const open = new Map<string, number>();
  const close = new Map<string, number>();
  for (const text of texts) {
    for (const m of text.matchAll(new RegExp(OPEN_SRC, 'gu'))) bump(open, m[1]);
    for (const m of text.matchAll(new RegExp(CLOSE_SRC, 'gu'))) bump(close, m[1]);
  }
  const out: ScannedTag[] = [];
  for (const [tag, opens] of open) {
    if (opens > 0 && opens === (close.get(tag) ?? 0)) out.push({ tag, count: opens });
  }
  out.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return out;
}
