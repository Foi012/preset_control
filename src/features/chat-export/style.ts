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

/** A preset = a labelled toggle carrying an optional inline rule + the CSS it needs. */
export interface StylePreset {
  id: string;
  label: string;
  hint: string;
  /** Inline span rule. Omitted for CSS-only presets (e.g. the drop cap). */
  rule?: StyleRule;
  css: string;
}

/** A rule compiled for the renderer: a global RegExp + the class to wrap matches in. */
export interface ResolvedRule {
  re: RegExp;
  className: string;
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
    rule: { pattern: '"[^"\\n]*"|“[^”\\n]*”|「[^」\\n]*」|『[^』\\n]*』|«[^»\\n]*»', className: 'st-dialogue' },
    css: '.st-dialogue { font-weight: bold; }',
  },
  {
    id: 'emphasis',
    label: '星号转倾斜',
    hint: '把 *…* 包裹的文字转为斜体，并去掉星号。',
    rule: { pattern: '\\*([^*\\n]+)\\*', className: 'st-emphasis' },
    css: '.st-emphasis { font-style: italic; }',
  },
  {
    id: 'dropcap',
    label: '段首下沉首字',
    hint: '每章第一段的首字放大下沉。',
    css: '.chapter p.cex-lead { text-indent: 0; }\n.chapter p.cex-lead::first-letter { float: left; font-size: 3em; line-height: 0.8; margin: 0.02em 0.12em 0 0; font-weight: 600; }',
  },
];

const presetById = (id: string): StylePreset | undefined => STYLE_PRESETS.find(p => p.id === id);

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
 * Enabled presets' rules + custom rules → compiled `ResolvedRule[]`, in priority order
 * (presets first, then custom). Invalid regex / empty patterns are skipped — never throws.
 */
export function resolveStyleRules(style: StyleConfig): ResolvedRule[] {
  const out: ResolvedRule[] = [];
  const push = (rule: StyleRule): void => {
    const re = compileRulePattern(rule.pattern);
    if (re) out.push({ re, className: sanitizeClassName(rule.className) });
  };
  for (const id of style.presets) {
    const preset = presetById(id);
    if (preset?.rule) push(preset.rule);
  }
  for (const rule of style.rules) push(rule);
  return out;
}

/** Enabled-preset CSS + custom CSS, appended after the base BOOK_CSS by the packager. */
export function buildStyleCss(style: StyleConfig): string {
  const parts: string[] = [];
  for (const id of style.presets) {
    const preset = presetById(id);
    if (preset?.css) parts.push(preset.css);
  }
  const custom = style.css.trim();
  if (custom) parts.push(custom);
  return parts.join('\n');
}
