/**
 * Chat normalize — the pure core of Phase 1.
 *
 * Turns a list of raw SillyTavern messages (from a dropped `.jsonl` *or* ST's
 * in-memory `chat` array — same object shape) into a clean `NormMessage[]` the
 * later phases (strip / extract / chapters) operate on.
 *
 * Two decisions are baked in here:
 *  - **Active swipe only.** Each message contributes `mes` (which ST keeps synced
 *    to the active/selected swipe). We never walk or merge the `swipes` array.
 *  - **Tolerant input.** A real ST `.jsonl` starts with a *header* line (chat
 *    metadata, no `mes`) and may contain malformed lines; nothing here throws.
 */

/** The subset of an ST message we read. JSONL lines and `chat[]` entries share it. */
export interface RawMessage {
  name?: string;
  is_user?: boolean;
  /**
   * Overloaded in ST: `true` for both a genuine system message *and* a real turn
   * hidden via `/hide` (`hideChatMessageRange` just flips this flag). We split the
   * two apart using `extra.type` — see {@link isGenuineSystem}.
   */
  is_system?: boolean;
  mes?: string;
  swipes?: string[];
  swipe_id?: number;
  /** `extra.type` is set only on app-generated system messages (narrator/comment/…). */
  extra?: { reasoning?: string; type?: string } & Record<string, unknown>;
  send_date?: string;
}

export type Role = 'user' | 'assistant' | 'system';

export interface NormMessage {
  /** 0-based, dense over the *surviving* messages (post-filter). */
  index: number;
  role: Role;
  name: string;
  /** Active-swipe text. */
  content: string;
  /** `extra.reasoning` if present — kept so a later strip toggle can drop it. */
  reasoning: string;
  /** A real user/assistant turn hidden via `/hide` (`is_system` on a non-system msg). */
  hidden: boolean;
}

export interface NormalizeOptions {
  /** Keep the user's own messages. Default true. */
  includeUser?: boolean;
  /** Keep `/hide`-d real turns (hidden for token cost, usually still wanted). Default true. */
  includeHidden?: boolean;
  /** Keep genuine system messages — `/sys` narrator, `/comment`, … Default false. */
  includeSystem?: boolean;
}

/**
 * A genuine, app-generated system message — narrator (`/sys`), comment (`/comment`),
 * welcome notes, etc. They carry a non-empty `extra.type`; normal turns never do
 * (a generated reply sets `type: null`). This is what lets us tell a real hidden
 * turn apart from an actual "系统消息".
 */
export function isGenuineSystem(m: RawMessage): boolean {
  return typeof m.extra?.type === 'string' && m.extra.type.length > 0;
}

/**
 * Tolerant JSONL parse: one JSON object per line. Blank lines and lines that don't
 * parse are skipped, never thrown on. The chat *header* line survives here (it's a
 * valid object); it is dropped later in {@link normalizeMessages} because it has no
 * string `mes`.
 */
export function parseJsonl(text: string): RawMessage[] {
  const out: RawMessage[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (obj && typeof obj === 'object') out.push(obj as RawMessage);
  }
  return out;
}

/**
 * The active-swipe text for a message. ST keeps `mes` equal to the selected swipe,
 * so `mes` *is* the active swipe; the `swipes[swipe_id]` path is only a fallback for
 * odd files where `mes` is missing. We never merge alternative swipes.
 */
export function activeSwipeText(m: RawMessage): string {
  if (typeof m.mes === 'string') return m.mes;
  if (Array.isArray(m.swipes) && typeof m.swipe_id === 'number') {
    const s = m.swipes[m.swipe_id];
    if (typeof s === 'string') return s;
  }
  return '';
}

function roleOf(m: RawMessage): Role {
  if (m.is_user) return 'user';
  if (isGenuineSystem(m)) return 'system';
  return 'assistant';
}

/**
 * `RawMessage[]` → clean `NormMessage[]`. Drops header / non-message lines (no string
 * `mes`); then filters by three independent axes — the user's own turns, `/hide`-d
 * real turns, and genuine system messages — and re-indexes 0-based over the survivors.
 *
 * `hidden` (a real turn flagged `is_system` but with no system `type`) is orthogonal
 * to role: a hidden *assistant* turn is still assistant content, just hidden — so it's
 * kept by default and only dropped when `includeHidden` is off.
 */
export function normalizeMessages(raw: RawMessage[], opts: NormalizeOptions = {}): NormMessage[] {
  const includeUser = opts.includeUser ?? true;
  const includeHidden = opts.includeHidden ?? true;
  const includeSystem = opts.includeSystem ?? false;
  const out: NormMessage[] = [];
  for (const m of raw) {
    if (typeof m.mes !== 'string') continue; // header / non-message line
    const role = roleOf(m);
    const hidden = m.is_system === true && role !== 'system';
    if (role === 'user' && !includeUser) continue;
    if (role === 'system' && !includeSystem) continue;
    if (hidden && !includeHidden) continue;
    out.push({
      index: out.length,
      role,
      name: typeof m.name === 'string' ? m.name : '',
      content: activeSwipeText(m),
      reasoning: typeof m.extra?.reasoning === 'string' ? m.extra.reasoning : '',
      hidden,
    });
  }
  return out;
}
