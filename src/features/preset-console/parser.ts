/**
 * Parser: flat prompt list → sections.
 *
 * Pure and side-effect free — it takes the `prompts` array from
 * `getPreset('in_use')` and returns the decoded structure. No TavernHelper calls,
 * no UI. See {@link ./DESIGN.md} for the verified parsing rules.
 */

import { CONFIG_BACKUP_ENTRY_NAME, CONFIG_ENTRY_NAME } from './config';

/** Behaviour entries (config + its backup) are never surfaced as structure. */
function isManagedConfigEntry(name: string): boolean {
  return name === CONFIG_ENTRY_NAME || name === CONFIG_BACKUP_ENTRY_NAME;
}
import type { ParseResult, ParsedEntry, ParsedSection, PresetPromptLike, SectionRule } from './types';

export const REGION_START = '⚙️CUSTOMIZATION_START';
export const REGION_END = '⚙️CUSTOMIZATION_END';

/** Header convention: `[NN-NAME]` with empty content. */
const HEADER_NAME_RE = /^\s*\[\d+-.*\]\s*$/;

/** First `{{setvar::VAR::` target in a content string, if any. */
const SETVAR_RE = /\{\{setvar::([^:]+)::/;

export function isHeader(prompt: Pick<PresetPromptLike, 'name' | 'content'>): boolean {
  return HEADER_NAME_RE.test(prompt.name) && (prompt.content ?? '').trim() === '';
}

/** Detect the two independent entry flags from the name (see {@link ParsedEntry}). */
export function detectFlags(name: string): { alwaysOn: boolean; input: boolean } {
  return {
    alwaysOn: name.includes('📍'),
    input: name.includes('✍️') || name.includes('（自填）'),
  };
}

/** True when an entry is governed by the section rule (neither locked-on nor input). */
export function isPlain(entry: Pick<ParsedEntry, 'alwaysOn' | 'input'>): boolean {
  return !entry.alwaysOn && !entry.input;
}

function toEntry(prompt: PresetPromptLike, position: number, inManagedRegion: boolean): ParsedEntry {
  return {
    id: prompt.id,
    name: prompt.name,
    enabled: prompt.enabled,
    content: prompt.content ?? '',
    position,
    inManagedRegion,
    ...detectFlags(prompt.name),
  };
}

/**
 * Guess a section's rule from its plain entries.
 *
 * Primary signal: which tavern variable each plain entry writes via `{{setvar::VAR::}}`.
 * Single-select sections have every entry writing the *same* variable (e.g. `[03-POV]`
 * all set `POV`); multi-select sections write *different* variables. This is far more
 * reliable than counting enabled entries — it correctly handles all-off single sections
 * (`[07-STYLES]`) and single-enabled multi sections (`[02-DIALOGUE]`).
 *
 * Fallback (no setvars found): one enabled → `single`, otherwise `multi`.
 * It's only a suggestion; the user can flip it in edit mode.
 */
export function guessRule(entries: ParsedEntry[]): SectionRule {
  const plain = entries.filter(isPlain);
  if (plain.length <= 1) return 'multi';

  const vars = new Set<string>();
  let sawSetvar = false;
  for (const entry of plain) {
    const match = entry.content.match(SETVAR_RE);
    if (match) {
      sawSetvar = true;
      vars.add(match[1].trim());
    }
  }

  if (sawSetvar) return vars.size === 1 ? 'single' : 'multi';
  return plain.filter(e => e.enabled).length === 1 ? 'single' : 'multi';
}

/**
 * Slice the managed region (entries strictly between `⚙️CUSTOMIZATION_START` and
 * `⚙️CUSTOMIZATION_END`, matched by name). Returns `null` if the region is absent.
 */
export function sliceRegion(prompts: PresetPromptLike[]): PresetPromptLike[] | null {
  const start = prompts.findIndex(p => p.name === REGION_START);
  const end = prompts.findIndex(p => p.name === REGION_END);
  if (start === -1 || end === -1 || end <= start) return null;
  return prompts.slice(start + 1, end);
}

/** Parse a full prompt list into the managed-region structure. */
export function parsePreset(prompts: PresetPromptLike[]): ParseResult {
  const allEntries = prompts.flatMap((prompt, position) => {
    if (isManagedConfigEntry(prompt.name) || prompt.name === REGION_START || prompt.name === REGION_END || isHeader(prompt)) {
      return [];
    }
    return [toEntry(prompt, position, false)];
  });

  const region = sliceRegion(prompts);
  if (region === null) {
    return { regionFound: false, sections: [], looseEntries: [], allEntries };
  }

  const sections: ParsedSection[] = [];
  const looseEntries: ParsedEntry[] = [];
  let current: ParsedSection | null = null;

  const regionStart = prompts.findIndex(p => p.name === REGION_START);
  for (const [offset, prompt] of region.entries()) {
    // The stored config entry is behaviour, not structure — never surface it as
    // a section or loose entry, even if the user parks it inside the region.
    if (isManagedConfigEntry(prompt.name)) continue;
    if (isHeader(prompt)) {
      current = { headerId: prompt.id, headerName: prompt.name, entries: [], guessedRule: 'multi' };
      sections.push(current);
      continue;
    }
    const entry = toEntry(prompt, regionStart + 1 + offset, true);
    if (current) current.entries.push(entry);
    else looseEntries.push(entry);
  }

  for (const section of sections) {
    section.guessedRule = guessRule(section.entries);
  }

  const managedIds = new Set([...sections.flatMap(s => s.entries), ...looseEntries].map(e => e.id));
  return {
    regionFound: true,
    sections,
    looseEntries,
    allEntries: allEntries.map(entry => (managedIds.has(entry.id) ? { ...entry, inManagedRegion: true } : entry)),
  };
}
