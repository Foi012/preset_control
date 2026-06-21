/**
 * Strip + extract — the pure core of Phase 2 (two-bucket model).
 *
 * Per message we run two operations, each fed by either a **tag shorthand** (`正文`,
 * `<think>`) or a **regex** (`/pattern/flags`):
 *
 *  - **Exclude** — remove matched spans (built-in `<think>` / OOC presets + custom
 *    rules). Applied to *every* message.
 *  - **Include / 正文** — keep only matched content as the chapter body, with named
 *    groups (or specific tags) becoming fields like `title`. Applied to **assistant**
 *    messages only; user messages come through as raw text (minus excludes). With no
 *    include rule, the body is the whole stripped message.
 *
 * Order is fixed: **exclude → include**, so `<think>` is gone before we look for `<正文>`.
 * Regexes are user-authored, so `parseRegex` validates them and surfaces syntax errors
 * for the UI to block on (the 缺层 failure the reference 酒馆助手 script guards against).
 */
import type { Role } from './normalize';
import { unbalancedTags } from './scan';

/** Tag names whose inner content is the chapter body rather than a labelled field. */
const BODY_KEYS = new Set(['正文', 'body', 'content', 'text']);

const THINK_RE = /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi;
const OOC_RES = [
  /[(（]\s*ooc[\s\S]*?[)）]/gi, // (OOC: …) / （OOC：…）
  /\[\s*ooc[\s\S]*?\]/gi, //       [OOC: …]
];
const COMMENT_RE = /<!--[\s\S]*?-->/g; // HTML comments <!-- … -->

/** A find→replace rule (typically imported from an ST regex script). */
export interface ReplaceRule {
  /** Find pattern — `/pat/flags` or bare. */
  find: string;
  /** Replacement string (`''` deletes; `$1`/`{{match}}` reference the match). */
  replace: string;
  /**
   * Message roles this rule applies to (from ST's `placement`: user-input → user,
   * AI-output → assistant). Omitted/empty = apply to **all** roles (manual rules, or
   * imports with no message-text placement).
   */
  roles?: Role[];
}

export interface ExtractConfig {
  /**
   * Find→replace rules, applied **first** (before any strip/extract) to every message.
   * Mirrors ST's display/prompt regexes, which aren't baked into the stored `mes` and so
   * must be re-run here. Order within the array is preserved.
   */
  replace?: ReplaceRule[];
  /** Built-in exclude presets. `unclosed` cleans orphan/dangling tag markers (lossy, opt-in). */
  strip?: { reasoning?: boolean; ooc?: boolean; comments?: boolean; unclosed?: boolean };
  /** Custom exclude rules — each a tag name or `/regex/flags`. Removed from all messages. */
  exclude?: string[];
  /**
   * Tag names treated as structural for the `strip.unclosed` cleanup — only these get
   * orphan/dangling removal, so a stray `<` in prose is never mistaken for a tag. The UI
   * fills this from the chat's balanced tags + think presets + excluded-rule tag names.
   */
  unclosedNames?: string[];
  /** 正文 rules — tag or regex. Their matches become the chapter body (assistant turns). */
  include?: string[];
  /** 标题 rules — tag or regex. Their matches become the chapter title field. */
  title?: string[];
}

export interface Extracted {
  /** Chapter text: joined include matches, else the whole stripped message. */
  body: string;
  /** Named captures other than body — e.g. `{ title, time }`, trimmed, first-wins. */
  fields: Record<string, string>;
  /**
   * Whether include rules produced content. `true` when there are no include rules /
   * the message isn't an assistant turn (nothing to fail); `false` is the 缺层 case —
   * include rules were set but matched nothing, so body fell back to the full text.
   */
  matched: boolean;
}

/**
 * Parse a user regex written as `/pattern/flags` or as a bare pattern.
 * Returns `{ re, error }`: on success `re` is a RegExp; on a syntax error `re` is null
 * and `error` describes it. Empty input → `{ re: null, error: '' }` (no rule, not an error).
 */
export function parseRegex(input: string, extraFlags = ''): { re: RegExp | null; error: string } {
  const raw = input.trim();
  if (!raw) return { re: null, error: '' };
  let body = raw;
  let flags = extraFlags;
  const slash = raw.match(/^\/(.*)\/([a-z]*)$/is);
  if (slash) {
    body = slash[1];
    flags = `${slash[2]}${extraFlags}`;
  }
  flags = [...new Set(flags.split(''))].join('');
  try {
    return { re: new RegExp(body, flags), error: '' };
  } catch (e) {
    return { re: null, error: e instanceof Error ? e.message : String(e) };
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A bare/bracketed tag name (`正文`, `<think>`, `</正文>`) → its name, else null (regex). */
export function asTagName(rule: string): string | null {
  const t = rule.trim().replace(/^<\/?|>$/g, '');
  return /^[\p{L}\p{N}_-]+$/u.test(t) ? t : null;
}

/** Validate a rule (tag or regex). `error` is empty when usable. */
export function ruleError(rule: string): string {
  if (!rule.trim() || asTagName(rule)) return '';
  return parseRegex(rule).error;
}

/**
 * Remove orphan / dangling tag markers left after the balanced excludes ran. A truncated
 * open (`<think>…<EOF>`) drops from the tag to end-of-message; a truncated close
 * (`…</think>`) drops from start-of-message through the tag — so the broken span and its
 * stray marker both go. Scoped to `names` (known structural tags) so prose `<` is safe.
 * Lossy by design, hence opt-in (`strip.unclosed`).
 */
export function cleanUnclosedTags(content: string, names: Set<string>): string {
  if (!names.size) return content;
  let front = 0; //         remove [0, front)        — past the latest orphan close
  let back = content.length; // remove [back, len)   — from the earliest orphan open
  for (const u of unbalancedTags(content, names).values()) {
    for (const c of u.orphanCloses) front = Math.max(front, c.end);
    for (const o of u.orphanOpens) back = Math.min(back, o.start);
  }
  return front >= back ? '' : content.slice(front, back);
}

/**
 * Apply find→replace rules to one message. Each `find` is a tag-less pattern
 * (`/pat/flags` or bare); we force a global flag (ST replaces every occurrence) and map
 * ST's `{{match}}` macro to JS `$&`. Invalid patterns are skipped — never throws.
 */
export function applyReplacements(content: string, rules: ReplaceRule[] | undefined, role?: Role): string {
  let out = content;
  for (const rule of rules ?? []) {
    if (!rule.find.trim()) continue;
    // Respect the rule's target roles when a role is known (skip when role-agnostic).
    if (rule.roles?.length && role && !rule.roles.includes(role)) continue;
    const { re } = parseRegex(rule.find, 'g');
    if (!re) continue;
    out = out.replace(re, rule.replace.replace(/\{\{match\}\}/gi, '$$&'));
  }
  return out;
}

/** Remove built-in presets + custom exclude rules from one message. */
export function stripExcludes(content: string, config: ExtractConfig, role?: Role): string {
  let out = applyReplacements(content, config.replace, role);
  if (config.strip?.reasoning) out = out.replace(THINK_RE, '');
  if (config.strip?.ooc) for (const re of OOC_RES) out = out.replace(re, '');
  if (config.strip?.comments) out = out.replace(COMMENT_RE, '');
  for (const rule of config.exclude ?? []) {
    if (!rule.trim()) continue;
    const tag = asTagName(rule);
    if (tag) {
      const t = escapeRe(tag);
      out = out.replace(new RegExp(`<${t}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${t}\\s*>`, 'gu'), '');
    } else {
      const { re } = parseRegex(rule, 'g');
      if (re) out = out.replace(re, '');
    }
  }
  // Last: after balanced spans are gone, sweep any orphan/dangling markers that remain.
  if (config.strip?.unclosed) out = cleanUnclosedTags(out, new Set(config.unclosedNames ?? []));
  return out;
}

/** Push every global match without looping forever on zero-width matches. */
function eachMatch(re: RegExp, text: string, fn: (m: RegExpExecArray) => void): void {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    fn(m);
    if (m.index === g.lastIndex) g.lastIndex++;
  }
}

/**
 * Strip excludes, then (for assistant turns with include rules) extract the body +
 * fields. User turns and rule-less messages return the whole stripped text as body.
 */
export function extractMessage(content: string, role: Role, config: ExtractConfig): Extracted {
  const text = stripExcludes(content, config, role).trim();
  const includes = (config.include ?? []).filter(r => r.trim());
  const titles = (config.title ?? []).filter(r => r.trim());
  if (role !== 'assistant' || (includes.length === 0 && titles.length === 0)) {
    return { body: text, fields: {}, matched: true };
  }

  const bodyParts: string[] = [];
  const fields: Record<string, string> = {};
  let anyMatch = false;

  // 标题 rules — their first match is pinned to the `title` field (becomes the chapter
  // title). Routed by the input box the user chose, not by tag/group name.
  for (const rule of titles) {
    if ('title' in fields) break;
    const tag = asTagName(rule);
    if (tag) {
      const t = escapeRe(tag);
      const re = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}\\s*>`, 'gu');
      eachMatch(re, text, m => {
        if ('title' in fields) return;
        anyMatch = true;
        fields.title = m[1].trim();
      });
    } else {
      const { re } = parseRegex(rule, 'g');
      if (!re) continue;
      eachMatch(re, text, m => {
        if ('title' in fields) return;
        anyMatch = true;
        const groups = m.groups ?? {};
        const named = Object.values(groups).find(v => v != null);
        fields.title = (named ?? m[1] ?? m[0]).trim();
      });
    }
  }

  for (const rule of includes) {
    const tag = asTagName(rule);
    if (tag) {
      const t = escapeRe(tag);
      const re = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}\\s*>`, 'gu');
      eachMatch(re, text, m => {
        anyMatch = true;
        const val = m[1].trim();
        if (BODY_KEYS.has(tag)) bodyParts.push(val);
        else if (!(tag in fields)) fields[tag] = val;
      });
    } else {
      const { re } = parseRegex(rule, 'g');
      if (!re) continue;
      eachMatch(re, text, m => {
        anyMatch = true;
        const groups = m.groups ?? {};
        const keys = Object.keys(groups);
        if (keys.length === 0) {
          bodyParts.push((m[1] ?? m[0]).trim()); // no named groups → group 1 / whole match
          return;
        }
        for (const [k, v] of Object.entries(groups)) {
          if (v == null) continue;
          if (BODY_KEYS.has(k)) bodyParts.push(v.trim());
          else if (!(k in fields)) fields[k] = v.trim();
        }
      });
    }
  }

  if (!anyMatch) return { body: text, fields: {}, matched: false };
  return { body: bodyParts.length ? bodyParts.join('\n\n') : text, fields, matched: true };
}
