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
// One token = an opening `<tag …>` or closing `</tag>`. Group 1 is `/` for a close.
const TOKEN_SRC = `<(\\/)?(${NAME})(?:\\s[^>]*)?>`;

export interface ScannedTag {
  tag: string;
  /** Balanced occurrences (== opens == closes). */
  count: number;
}

/** One tag occurrence in a message, with its slice bounds (for surgical removal). */
export interface TagToken {
  name: string;
  kind: 'open' | 'close';
  /** Start index of `<` in the source text. */
  start: number;
  /** Index just past `>`. */
  end: number;
}

/** Tags with leftover unmatched markers in one message — the 未闭合 case. */
export interface Unbalanced {
  /** Opens with no later matching close (truncated open — `<think>…<EOF>`). */
  orphanOpens: TagToken[];
  /** Closes with no earlier matching open (truncated close — `…</think>`). */
  orphanCloses: TagToken[];
}

/** Per-chat summary of one tag name's unclosed markers, for the scanner's 未闭合 group. */
export interface UnclosedTag {
  tag: string;
  /** Total orphan opens across messages. */
  opens: number;
  /** Total orphan closes across messages. */
  closes: number;
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Every opening/closing tag token in one message, in document order. */
export function tagTokens(text: string): TagToken[] {
  const out: TagToken[] = [];
  for (const m of text.matchAll(new RegExp(TOKEN_SRC, 'gu'))) {
    out.push({
      name: m[2],
      kind: m[1] ? 'close' : 'open',
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/**
 * Pair opens with closes per tag name within one message (stack-based, document order).
 * Returns only the names left with orphan markers. `names`, when given, restricts the
 * scan to known structural tags so a stray `<` in prose can't be mistaken for a tag.
 */
export function unbalancedTags(text: string, names?: Set<string>): Map<string, Unbalanced> {
  const byName = new Map<string, TagToken[]>();
  for (const t of tagTokens(text)) {
    if (names && !names.has(t.name)) continue;
    const list = byName.get(t.name);
    if (list) list.push(t);
    else byName.set(t.name, [t]);
  }
  const result = new Map<string, Unbalanced>();
  for (const [name, toks] of byName) {
    const stack: TagToken[] = [];
    const orphanCloses: TagToken[] = [];
    for (const t of toks) {
      if (t.kind === 'open') stack.push(t);
      else if (stack.length) stack.pop();
      else orphanCloses.push(t);
    }
    if (stack.length || orphanCloses.length) result.set(name, { orphanOpens: stack, orphanCloses });
  }
  return result;
}

/** Per-chat unclosed-tag summary, most-affected first (for the scanner's 未闭合 group). */
export function scanUnclosed(texts: string[], names?: Set<string>): UnclosedTag[] {
  const opens = new Map<string, number>();
  const closes = new Map<string, number>();
  for (const text of texts) {
    for (const [name, u] of unbalancedTags(text, names)) {
      if (u.orphanOpens.length) opens.set(name, (opens.get(name) ?? 0) + u.orphanOpens.length);
      if (u.orphanCloses.length) closes.set(name, (closes.get(name) ?? 0) + u.orphanCloses.length);
    }
  }
  const out: UnclosedTag[] = [];
  for (const tag of new Set([...opens.keys(), ...closes.keys()])) {
    out.push({ tag, opens: opens.get(tag) ?? 0, closes: closes.get(tag) ?? 0 });
  }
  out.sort((a, b) => b.opens + b.closes - (a.opens + a.closes) || a.tag.localeCompare(b.tag));
  return out;
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
