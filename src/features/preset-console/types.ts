/**
 * Shared types for the preset-easy-toggle console.
 *
 * The parser ({@link ./parser}) turns the flat prompt list into these structures.
 * Everything is keyed by the prompt's stable `id` (UUID) — never by name — so
 * SillyTavern-side renames and reorders stay non-destructive.
 */

/** A single prompt entry as exposed by TavernHelper's `getPreset('in_use')`. */
export interface PresetPromptLike {
  id: string;
  name: string;
  enabled: boolean;
  content?: string;
}

/** How a section operates on its *plain* entries. */
export type SectionRule = 'single' | 'multi';

export interface ParsedEntry {
  id: string;
  name: string;
  enabled: boolean;
  content: string;
  /** Original prompt-list position, used for stable sorting across the full preset. */
  position: number;
  /** Whether this entry sits inside the managed customization region. */
  inManagedRegion: boolean;
  /**
   * Two independent flags detected from the name — an entry can be both (e.g.
   * `📍✍️正文语言（自填）` is an always-on input):
   * - `alwaysOn` — `📍`-prefixed, shown locked-on, ignores the section rule
   * - `input`    — `✍️` / `（自填）`, gets an editable text box
   * An entry that is neither is "plain" and is governed by the section rule.
   */
  alwaysOn: boolean;
  input: boolean;
}

export interface ParsedSection {
  /** `id` of the header entry — the stable identity of the section. */
  headerId: string;
  /** Raw header name, e.g. `[03-POV]`. */
  headerName: string;
  entries: ParsedEntry[];
  /**
   * Rule inferred from the entries (a suggestion for scaffolding, not authoritative —
   * the stored config in `[⚙️CONSOLE-CONFIG]` wins once the user has set it).
   */
  guessedRule: SectionRule;
}

export interface ParseResult {
  /** Whether the `⚙️CUSTOMIZATION_START`/`_END` region was found. */
  regionFound: boolean;
  sections: ParsedSection[];
  /**
   * In-region entries that appear before the first header (loose entries with no
   * section). Usually empty; surfaced so nothing is silently dropped.
   */
  looseEntries: ParsedEntry[];
  /**
   * Every selectable non-header prompt in the preset, excluding console config
   * and region boundary markers. Edit mode uses this to let custom groups pull
   * from outside the managed customization scaffold.
   */
  allEntries: ParsedEntry[];
}

/**
 * The structures below are produced by {@link ../config.resolveView} — the parsed
 * structure with the stored `[⚙️CONSOLE-CONFIG]` overrides merged on top. This is
 * what the UI renders; it never reads the raw parse or the raw config separately.
 */

/** A parsed entry with config overrides applied. */
export interface ResolvedEntry extends ParsedEntry {
  /** Hidden from in-use view (config `entryMeta[id].hidden`). */
  hidden: boolean;
  /** The scaffolded group this entry came from (`[NN-]` header id), or null if loose. */
  nativeGroupId: string | null;
  /** The group this entry currently resolves into, or null if ungrouped. */
  groupId: string | null;
}

/**
 * A resolved group the UI renders. Identity is `id`: a `[NN-]` header prompt id
 * for scaffolded groups, or a generated id for user-created `custom` groups.
 */
export interface ResolvedSection {
  id: string;
  source: 'header' | 'custom';
  /** Parent group id when this is a second-level folder; null for top-level groups. */
  parentId: string | null;
  /** Display name (cleaned header label / virtual rename / custom name). */
  name: string;
  /** Stored rule if the user set one, otherwise the parser's guess. */
  rule: SectionRule;
  /** Final position after applying stored order (pinned sections sort first). */
  order: number;
  pinned: boolean;
  hidden: boolean;
  /** Required groups keep at least one plain entry selected. Optional groups can be empty. */
  required: boolean;
  collapsed: boolean;
  entries: ResolvedEntry[];
  /** Second-level folders. Max depth is guarded by resolveView/config writes. */
  children: ResolvedSection[];
}

/** A group's placement within a mode: its own order + optional parent (depth ≤ 2). */
export interface ModeGroupLayout {
  groupId: string;
  order: number;
  parentId?: string;
}

/** A saved ON/OFF combination inside a mode. */
export interface ModeSnapshot {
  id: string;
  name: string;
  selections: Record<string, boolean>;
  /** True only for the compatibility view over legacy `scenario.selections`. */
  legacy?: boolean;
}

/** A named mode: group scope/layout plus optional saved ON/OFF snapshots. */
export interface ResolvedScenario {
  id: string;
  name: string;
  /** Top-level group ids this mode controls; empty = legacy full snapshot. */
  groupIds: string[];
  /** Per-mode group arrangement; empty = fall back to global order/nesting. */
  layout: ModeGroupLayout[];
  /** Legacy single saved state; retained for old configs and surfaced as 默认 when snapshots is empty. */
  selections: Record<string, boolean>;
  snapshots: ModeSnapshot[];
}

export interface ResolvedView {
  regionFound: boolean;
  /** Sorted: pinned first, then by stored `order`, then by original position. */
  sections: ResolvedSection[];
  looseEntries: ResolvedEntry[];
  /** Full-preset selectable catalog, with config entry overrides applied. */
  allEntries: ResolvedEntry[];
  scenarios: ResolvedScenario[];
  ui: { theme: string };
}
