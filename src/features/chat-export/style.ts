/**
 * Typography styling — the pure model behind ④'s 排版样式 Section.
 *
 * Two tiers (see DESIGN.md, 2026-06-20):
 *  - **Presets** — one-click toggles, each a built-in regex→`<span class>` rule *plus*
 *    its CSS, wired here so the user writes neither.
 *  - **Advanced** — custom 匹配→类名 rules + a free CSS string for power users.
 *
 * This module owns the *model*: the preset registry, rule compilation, and the CSS
 * builder. The actual span-wrapping (decoration) lives in `render.ts` so `render` and
 * `style` don't import each other in a cycle — `render` only consumes `ResolvedRule`.
 *
 * Safety: a custom rule only ever yields a sanitized class name; the renderer wraps
 * **escaped** content in our own `<span class>`. No user-authored HTML is ever emitted,
 * so the EPUB stays valid XHTML.
 */
import { asTagName, parseRegex } from './extract';

/** A styling rule: match a span (tag name or `/regex/flags`) → wrap it in a CSS class. */
export interface StyleRule {
  /** Tag name (`voice`) or regex (`/pat/flags` or bare). Group 1 (if any) is the wrapped span. */
  pattern: string;
  /** Target CSS class (sanitized to `[A-Za-z0-9_-]`). */
  className: string;
}

export interface StyleConfig {
  /** Enabled preset ids (see STYLE_PRESETS). */
  presets: string[];
  /** Advanced custom rules. */
  rules: StyleRule[];
  /** Advanced custom CSS, appended verbatim to the stylesheet. */
  css: string;
}

export const emptyStyleConfig = (): StyleConfig => ({ presets: [], rules: [], css: '' });

/** A preset = a labelled toggle carrying inline rules, an optional block transform, and CSS. */
export interface StylePreset {
  id: string;
  label: string;
  hint: string;
  /** Inline span rules, applied in array order (e.g. *** before ** before *). CSS-only presets omit it. */
  rules?: StyleRule[];
  /** Enable block-level `>` / `>>` blockquote parsing in the renderer. */
  blockquote?: boolean;
  css: string;
}

/** A rule compiled for the renderer: a global RegExp + the class to wrap matches in. */
export interface ResolvedRule {
  re: RegExp;
  className: string;
}

/** What the renderer needs beyond inline rules — block-level transforms toggled by presets. */
export interface StyleRenderOptions {
  blockquote: boolean;
}

/**
 * Shipped presets. Defaults avoid `color` (a reader's night theme can hide hardcoded
 * colors) — colored styling is left to the advanced CSS field.
 */
export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'dialogue',
    label: '加粗对话',
    hint: '把成对引号内的台词加粗（支持 " "、「」、“”、«»）。',
    rules: [{ pattern: '"[^"\\n]*"|“[^”\\n]*”|「[^」\\n]*」|『[^』\\n]*』|«[^»\\n]*»', className: 'st-dialogue' }],
    css: '.st-dialogue { font-weight: bold; }',
  },
  {
    id: 'markdown',
    label: 'Markdown 标记',
    hint: '渲染 **粗体**、*斜体* / _斜体_、***粗斜体***、~~删除线~~ 与 > 引用（>> 嵌套），并去掉标记符号。',
    // Order matters: *** before ** before *, so the tokenizer can't nest wrongly.
    rules: [
      { pattern: '\\*\\*\\*([^*\\n]+)\\*\\*\\*', className: 'st-bi' },
      { pattern: '\\*\\*([^*\\n]+)\\*\\*', className: 'st-b' },
      { pattern: '~~([^~\\n]+)~~', className: 'st-del' },
      { pattern: '\\*([^*\\n]+)\\*', className: 'st-i' },
      { pattern: '(?<![\\w*])_([^_\\n]+)_(?![\\w*])', className: 'st-i' },
    ],
    blockquote: true,
    css: [
      '.st-b { font-weight: bold; }',
      '.st-i { font-style: italic; }',
      '.st-bi { font-weight: bold; font-style: italic; }',
      '.st-del { text-decoration: line-through; }',
      'blockquote { margin: 1em 0; padding-left: 0.9em; border-left: 3px solid; opacity: 0.85; font-style: italic; }',
      'blockquote blockquote { margin: 0.5em 0; }',
    ].join('\n'),
  },
  {
    id: 'dropcap',
    label: '段首下沉首字',
    hint: '每章第一段的首字放大下沉。',
    css: '.chapter p.cex-lead { text-indent: 0; }\n.chapter p.cex-lead::first-letter { float: left; font-size: 3em; line-height: 0.8; margin: 0.02em 0.12em 0 0; font-weight: 600; }',
  },
];

/** Keep only `[A-Za-z0-9_-]`; empty input falls back to a safe generic class. */
export function sanitizeClassName(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned || 'st-custom';
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compile one rule's pattern (tag or regex) to a global RegExp, or null if unusable. */
function compileRulePattern(pattern: string): RegExp | null {
  const raw = pattern.trim();
  if (!raw) return null;
  const tag = asTagName(raw);
  if (tag) {
    // A tag rule wraps the tag's *inner* content (group 1), dropping the tags themselves.
    const t = escapeRe(tag);
    return new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}\\s*>`, 'gu');
  }
  const { re } = parseRegex(raw, 'g');
  return re;
}

/**
 * Enabled presets' rules + custom rules → compiled `ResolvedRule[]`. Presets resolve in
 * **registry order** (not toggle order) so cross-rule nesting is deterministic — e.g.
 * `***` is registered before `**` before `*`. Custom rules come last. Invalid regex /
 * empty patterns are skipped — never throws.
 */
export function resolveStyleRules(style: StyleConfig): ResolvedRule[] {
  const out: ResolvedRule[] = [];
  const push = (rule: StyleRule): void => {
    const re = compileRulePattern(rule.pattern);
    if (re) out.push({ re, className: sanitizeClassName(rule.className) });
  };
  for (const preset of STYLE_PRESETS) {
    if (!style.presets.includes(preset.id)) continue;
    for (const rule of preset.rules ?? []) push(rule);
  }
  for (const rule of style.rules) push(rule);
  return out;
}

/** Block-level render transforms toggled on by the enabled presets. */
export function styleRenderOptions(style: StyleConfig): StyleRenderOptions {
  return { blockquote: STYLE_PRESETS.some(p => p.blockquote && style.presets.includes(p.id)) };
}

/** Enabled-preset CSS (registry order) + custom CSS, appended after BOOK_CSS by the packager. */
export function buildStyleCss(style: StyleConfig): string {
  const parts: string[] = [];
  for (const preset of STYLE_PRESETS) {
    if (preset.css && style.presets.includes(preset.id)) parts.push(preset.css);
  }
  const custom = style.css.trim();
  if (custom) parts.push(custom);
  return parts.join('\n');
}
