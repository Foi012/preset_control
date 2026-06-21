/**
 * ST regex import — read SillyTavern's existing regex scripts so the user can pull them
 * into the exporter's find→replace rules instead of hand-copying patterns out of ST.
 *
 * Why we re-run them rather than read "already-cleaned" text: ST regexes are mostly
 * **display-only** (`markdownOnly`) or **prompt-only** (`promptOnly`) — those are applied
 * at render/prompt time and are *not* written back to the stored `chat[i].mes` we read.
 * So importing the pattern + replacement and applying it ourselves (`applyReplacements`)
 * is the only way to reflect them in the export. Only `runOnEdit` regexes are baked into
 * the stored message, and re-running those is idempotent for our cleanup purposes.
 *
 * The mapping is pure + checkable; the context read is the one impure edge (best-effort,
 * mirrors `chat-source.ts` — returns empty groups if ST is unreachable).
 */
import type { ReplaceRule } from './extract';

/** One ST regex script (the fields we use; ST carries more we ignore). */
export interface StRegexScript {
  id?: string;
  scriptName?: string;
  findRegex?: string;
  replaceString?: string;
  disabled?: boolean;
  /** 1 = user input · 2 = AI output · others. We apply imports to every message regardless. */
  placement?: number[];
  markdownOnly?: boolean;
  promptOnly?: boolean;
  runOnEdit?: boolean;
}

export type RegexScope = 'global' | 'character' | 'chat' | 'preset';

export interface StRegexGroup {
  scope: RegexScope;
  label: string;
  scripts: StRegexScript[];
}

const SCOPE_LABEL: Record<RegexScope, string> = {
  global: '全局',
  character: '角色',
  chat: '聊天',
  preset: '预设',
};

/** A script → our find→replace rule. Empty `findRegex` yields an empty (skipped) rule. */
export function toReplaceRule(script: StRegexScript): ReplaceRule {
  return { find: script.findRegex ?? '', replace: script.replaceString ?? '' };
}

/** Human-readable `find → replace` preview for the import list (replacement shown as 〔删除〕 when empty). */
export function previewRule(script: StRegexScript): string {
  const find = (script.findRegex ?? '').trim() || '∅';
  const repl = (script.replaceString ?? '').trim();
  return `${find}  →  ${repl || '〔删除〕'}`;
}

function asScripts(v: unknown): StRegexScript[] {
  return Array.isArray(v) ? (v.filter(s => s && typeof s === 'object') as StRegexScript[]) : [];
}

type StCharacter = { data?: { extensions?: { regex_scripts?: unknown } } };
type StContext = {
  extensionSettings?: { regex?: unknown };
  characters?: StCharacter[];
  // ST's selected-character id — a numeric index, but sometimes a string ("0"); coerce.
  characterId?: number | string;
  chatMetadata?: { regex_scripts?: unknown; regex?: unknown };
};

function stContext(): StContext | null {
  const w = window as unknown as {
    SillyTavern?: { getContext?: () => unknown };
    parent?: { SillyTavern?: { getContext?: () => unknown } };
  };
  const st = w.SillyTavern ?? w.parent?.SillyTavern;
  const ctx = st?.getContext?.();
  return ctx && typeof ctx === 'object' ? (ctx as StContext) : null;
}

/**
 * Read ST's regex scripts grouped by scope, most-relevant first. Best-effort: any scope
 * ST doesn't expose comes back as an empty group (the UI hides empties). "Preset"-scoped
 * regex isn't a core ST concept — it stays empty unless an extension populates the card's
 * regex list; we surface the scope so it's there if present, not faked.
 */
export function loadStRegexGroups(): StRegexGroup[] {
  const ctx = stContext();
  const group = (scope: RegexScope, scripts: StRegexScript[]): StRegexGroup => ({
    scope,
    label: SCOPE_LABEL[scope],
    scripts,
  });
  if (!ctx) return [group('global', []), group('character', []), group('preset', [])];

  const global = asScripts(ctx.extensionSettings?.regex);
  // Character-scoped scripts live on the selected card; characterId may be a string index.
  const cid = ctx.characterId;
  const char =
    cid != null && cid !== '' && Number.isFinite(Number(cid))
      ? asScripts(ctx.characters?.[Number(cid)]?.data?.extensions?.regex_scripts)
      : [];
  // Chat-scoped scripts (newer ST) ride on chat metadata, if present.
  const chat = asScripts(ctx.chatMetadata?.regex_scripts ?? ctx.chatMetadata?.regex);
  return [group('global', global), group('character', char), group('chat', chat), group('preset', [])];
}
