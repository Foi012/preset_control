/**
 * Config layer: the stored behaviour for the console.
 *
 * Structure is *derived* from the preset (see {@link ./parser}); behaviour is
 * *stored* in one disabled `[⚙️CONSOLE-CONFIG]` entry whose `content` is the JSON
 * below. This module reads/validates that JSON and merges it onto the parsed
 * structure into a single {@link ResolvedView} the UI renders. Stored rules,
 * order, pins, and entry overrides win over the parser's guesses.
 *
 * Pure and side-effect free (apart from a `console.warn` on malformed JSON):
 * no TavernHelper calls. Preset I/O — finding/writing the entry into the live
 * preset — is step 3 and lives elsewhere. See {@link ./DESIGN.md}.
 *
 * Everything is keyed by entry `id` (UUID), never by name, so ST-side renames
 * and reorders stay non-destructive.
 *
 * Divergence from the DESIGN sketch: the sketch's `groups.rule` enum was
 * `single|multi|always-on|input`, which conflated the two verified orthogonal
 * axes. Here a group `rule` is only `single|multi` (it governs the section's
 * *plain* entries); `📍` always-on and `✍️` input remain per-entry and are read
 * straight from the name by the parser, overridable via `entryMeta`.
 */

import { z } from 'zod';
import type {
  ParsedEntry,
  ParseResult,
  PresetPromptLike,
  ResolvedEntry,
  ResolvedScenario,
  ResolvedSection,
  ResolvedView,
} from './types';

/** Name of the disabled entry that stores the config JSON. Matched by name, never id. */
export const CONFIG_ENTRY_NAME = '[⚙️CONSOLE-CONFIG]';

/**
 * Mirror of the last successfully-written config, in a second disabled entry. The
 * whole overlay (groups, modes, snapshots) lives in one JSON blob, so a corrupted or
 * truncated primary entry would otherwise be unrecoverable. {@link readConfigSafe}
 * falls back to this backup, and {@link ./preset-io.saveConfig} keeps it in sync.
 */
export const CONFIG_BACKUP_ENTRY_NAME = '[⚙️CONSOLE-CONFIG-BACKUP]';

/**
 * Override for a *scaffolded* group — one the parser derived from a `[NN-]`
 * header. `headerId` is the header prompt's id. Only carries what differs from
 * the scaffold (incl. an optional virtual `name` rename that never touches the
 * header prompt itself).
 */
const GroupSchema = z.object({
  headerId: z.string(),
  name: z.string().optional(),
  parentId: z.string().optional(),
  rule: z.enum(['single', 'multi']),
  /** Display order; pinned groups still sort ahead of unpinned. */
  order: z.number(),
  pinned: z.boolean().default(false),
  hidden: z.boolean().default(false),
  required: z.boolean().default(false),
  collapsed: z.boolean().default(false),
});

/**
 * A user-created group with no backing header prompt (virtual overlay). Entries
 * land here only via `entryMeta[id].groupId`; the preset is never reordered.
 */
const CustomGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().optional(),
  rule: z.enum(['single', 'multi']).default('multi'),
  order: z.number(),
  pinned: z.boolean().default(false),
  hidden: z.boolean().default(false),
  required: z.boolean().default(false),
  collapsed: z.boolean().default(false),
});

/** Per-entry override. Only carries what differs from the parser's name-derived view. */
const EntryMetaSchema = z.object({
  /** Force an entry to behave as an input box even if the name lacks `✍️`/`（自填）`. */
  kind: z.literal('input').optional(),
  /**
   * Override the name-derived `📍` always-on lock. ST's `📍` is only a suggestion;
   * edit mode is where the user decides. `false` un-locks a `📍` entry (it becomes a
   * normal rule-governed toggle); `true` pins an entry that has no `📍`. Absent =
   * use the name. Pruned back to absent when it matches the name-derived value.
   */
  alwaysOn: z.boolean().optional(),
  hidden: z.boolean().optional(),
  /** Reassign the entry to another group (header id or custom group id). */
  groupId: z.string().optional(),
});

/**
 * A **Mode**: a named group scope/layout. Saved ON/OFF combinations live in
 * `snapshots[]`; legacy `selections` is retained so old configs surface as a
 * default snapshot until the user creates explicit ones.
 */
/** A group's placement *within a mode*: its own order + optional parent (depth ≤ 2). */
const ModeGroupSchema = z.object({
  groupId: z.string(),
  order: z.number(),
  parentId: z.string().optional(),
});

const ModeSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  selections: z.record(z.string(), z.boolean()),
});

const ScenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Top-level group ids this mode controls; empty = legacy full snapshot. */
  groupIds: z.array(z.string()).default([]),
  /**
   * Per-mode group arrangement (membership + order + nesting). Authoritative when
   * non-empty; when empty the mode falls back to the global order/nesting filtered to
   * `groupIds`. Kept in sync with `groupIds` on edit.
   */
  layout: z.array(ModeGroupSchema).default([]),
  /** Legacy single snapshot; kept for backward compatibility. */
  selections: z.record(z.string(), z.boolean()).default({}),
  snapshots: z.array(ModeSnapshotSchema).default([]),
});

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  /** Cached ids of the region boundary entries (the writer targets these). */
  region: z.object({ startId: z.string().default(''), endId: z.string().default('') }).prefault({}),
  /** Overrides for scaffolded (header-derived) groups, keyed by header id. */
  groups: z.array(GroupSchema).default([]),
  /** User-created virtual groups. */
  customGroups: z.array(CustomGroupSchema).default([]),
  entryMeta: z.record(z.string(), EntryMetaSchema).default({}),
  scenarios: z.array(ScenarioSchema).default([]),
  ui: z.object({ theme: z.string().default('dark') }).prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type GroupConfig = z.infer<typeof GroupSchema>;
export type CustomGroupConfig = z.infer<typeof CustomGroupSchema>;

/** A fresh config with every field defaulted. */
export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}

/** Find the stored config entry in a prompt list (by name), or `null` if absent. */
export function findConfigPrompt(prompts: PresetPromptLike[]): PresetPromptLike | null {
  return prompts.find(p => p.name === CONFIG_ENTRY_NAME) ?? null;
}

/** Outcome of reading the stored config, so callers can react to corruption. */
export type ConfigStatus =
  | 'fresh' // no config entry yet (first run) — safe to write defaults
  | 'ok' // primary entry parsed cleanly
  | 'recovered' // primary entry was missing/corrupt; loaded from the backup entry
  | 'corrupt'; // primary entry present but unreadable, and no usable backup

export interface ConfigReadResult {
  config: Config;
  status: ConfigStatus;
}

/** Parse + schema-validate one entry's content, or null if absent/malformed. */
function tryParseConfig(content: string | undefined | null): Config | null {
  const trimmed = content?.trim();
  if (!trimmed) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const result = ConfigSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Read the stored config, recovering from the backup entry when the primary one is
 * missing or corrupt, and reporting which happened. The console must never fail to
 * open — but it must also never silently treat a *corrupt* entry as `fresh`, because
 * the caller would then overwrite the user's only (recoverable) copy with defaults.
 */
export function readConfigSafe(prompts: PresetPromptLike[]): ConfigReadResult {
  const content = findConfigPrompt(prompts)?.content;
  const main = tryParseConfig(content);
  if (main) return { config: main, status: 'ok' };

  // Primary is missing or unreadable — fall back to the backup before giving up.
  const backupContent = prompts.find(p => p.name === CONFIG_BACKUP_ENTRY_NAME)?.content;
  const backup = tryParseConfig(backupContent);
  if (backup) {
    console.warn(`[preset-easy-toggle] ${CONFIG_ENTRY_NAME} unreadable; recovered from ${CONFIG_BACKUP_ENTRY_NAME}.`);
    return { config: backup, status: 'recovered' };
  }

  if (!content?.trim()) return { config: defaultConfig(), status: 'fresh' };
  console.warn(`[preset-easy-toggle] ${CONFIG_ENTRY_NAME} corrupt and no usable backup; refusing to overwrite.`);
  return { config: defaultConfig(), status: 'corrupt' };
}

/** Convenience: just the config (back-compat). Use {@link readConfigSafe} when health matters. */
export function readConfig(prompts: PresetPromptLike[]): Config {
  return readConfigSafe(prompts).config;
}

/** Serialize a config to the JSON string stored in the entry's `content`. */
export function serializeConfig(config: Config): string {
  return JSON.stringify(config, null, 2);
}

/** `[03-POV]` → `POV`; falls back to the raw name. */
export function cleanHeaderName(name: string): string {
  const match = name.match(/^\s*\[\d+-(.*)\]\s*$/);
  return (match ? match[1] : name).trim();
}

/**
 * Merge the parsed structure with stored config into the single view the UI
 * renders. Two layers of override:
 *
 *  1. **Grouping** — virtual overlay. Groups come from the parser's `[NN-]`
 *     scaffold *plus* any user-created `customGroups`. Each entry lands in
 *     `entryMeta[id].groupId` if set (and that group still exists), otherwise its
 *     scaffolded native group. The preset is never reordered.
 *  2. **Behaviour** — stored rule/order/pin/hide/name win over the scaffold's
 *     guesses; `entryMeta` forces input / hides entries.
 *
 * Groups sort pinned-first, then by `order`, then by a stable index (header
 * groups in preset order, custom groups after, in creation order).
 */
export function resolveView(parse: ParseResult, config: Config): ResolvedView {
  const override = new Map(config.groups.map(g => [g.headerId, g]));
  const headerIds = new Set(parse.sections.map(s => s.headerId));
  const customIds = new Set(config.customGroups.map(g => g.id));
  const isGroup = (id: string | null | undefined): id is string => !!id && (headerIds.has(id) || customIds.has(id));

  const nativeGroupById = new Map<string, string | null>();
  for (const section of parse.sections) {
    for (const entry of section.entries) nativeGroupById.set(entry.id, section.headerId);
  }
  for (const entry of parse.looseEntries) nativeGroupById.set(entry.id, null);

  // Resolve every entry once, route it to its target group, collect into buckets.
  const buckets = new Map<string, ResolvedEntry[]>();
  const loose: ResolvedEntry[] = [];
  const route = (raw: ParsedEntry, nativeGroupId: string | null) => {
    const assigned = config.entryMeta[raw.id]?.groupId;
    const target = isGroup(assigned) ? assigned : nativeGroupId;
    const entry = resolveEntry(raw, config, nativeGroupId, isGroup(target) ? target : null);
    if (isGroup(target)) {
      const bucket = buckets.get(target) ?? buckets.set(target, []).get(target)!;
      bucket.push(entry);
    } else {
      loose.push(entry);
    }
  };
  for (const section of parse.sections) for (const entry of section.entries) route(entry, section.headerId);
  for (const entry of parse.looseEntries) route(entry, null);

  // Outside-region entries never appear by default, but edit mode can assign
  // them into a virtual group via entryMeta[id].groupId.
  for (const entry of parse.allEntries) {
    if (entry.inManagedRegion) continue;
    const assigned = config.entryMeta[entry.id]?.groupId;
    if (isGroup(assigned)) route(entry, null);
  }

  const byPosition = (a: ResolvedEntry, b: ResolvedEntry) => a.position - b.position;
  for (const bucket of buckets.values()) bucket.sort(byPosition);
  loose.sort(byPosition);

  const allEntries = parse.allEntries
    .map(entry => {
      const nativeGroupId = nativeGroupById.get(entry.id) ?? null;
      const assigned = config.entryMeta[entry.id]?.groupId;
      const groupId = isGroup(assigned) ? assigned : entry.inManagedRegion ? nativeGroupId : null;
      return resolveEntry(entry, config, nativeGroupId, groupId);
    })
    .sort(byPosition);

  type WorkingSection = Omit<ResolvedSection, 'children'> & {
    children: WorkingSection[];
    _index: number;
    _parentId: string | undefined;
  };
  // Assemble groups: scaffolded (header) first, then custom.
  const sections: WorkingSection[] = [];
  parse.sections.forEach((section, index) => {
    const o = override.get(section.headerId);
    sections.push({
      id: section.headerId,
      source: 'header',
      parentId: null,
      name: o?.name ?? cleanHeaderName(section.headerName),
      rule: o?.rule ?? section.guessedRule,
      order: o?.order ?? index,
      pinned: o?.pinned ?? false,
      hidden: o?.hidden ?? false,
      required: o?.required ?? false,
      collapsed: o?.collapsed ?? false,
      entries: buckets.get(section.headerId) ?? [],
      children: [],
      _index: index,
      _parentId: o?.parentId,
    });
  });
  const base = parse.sections.length;
  config.customGroups.forEach((group, ci) => {
    sections.push({
      id: group.id,
      source: 'custom',
      parentId: null,
      name: group.name,
      rule: group.rule,
      order: group.order,
      pinned: group.pinned,
      hidden: group.hidden,
      required: group.required,
      collapsed: group.collapsed,
      entries: buckets.get(group.id) ?? [],
      children: [],
      _index: base + ci,
      _parentId: group.parentId,
    });
  });

  const byGroupOrder = (a: WorkingSection, b: WorkingSection) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return a._index - b._index;
  };

  const byId = new Map(sections.map(section => [section.id, section]));
  const topLevel: WorkingSection[] = [];
  for (const section of sections) {
    const parent = section._parentId ? byId.get(section._parentId) : undefined;
    // Only honour parentId when the referenced parent exists and is itself top-level.
    // This caps nesting at two levels and breaks cycles/corrupt stored values.
    if (parent && parent.id !== section.id && !parent._parentId) {
      section.parentId = parent.id;
      parent.children.push(section);
    } else {
      topLevel.push(section);
    }
  }

  topLevel.sort(byGroupOrder);
  for (const section of topLevel) section.children.sort(byGroupOrder);

  const stripInternal = ({ _index, _parentId, ...section }: WorkingSection): ResolvedSection => ({
    ...section,
    children: section.children.map(stripInternal),
  });

  return {
    regionFound: parse.regionFound,
    sections: topLevel.map(stripInternal),
    looseEntries: loose,
    allEntries,
    scenarios: config.scenarios as ResolvedScenario[],
    ui: { theme: config.ui.theme },
  };
}

function resolveEntry(
  entry: ParsedEntry,
  config: Config,
  nativeGroupId: string | null,
  groupId: string | null,
): ResolvedEntry {
  const meta = config.entryMeta[entry.id];
  return {
    ...entry,
    // entryMeta can force an input box; it never removes a name-derived flag.
    input: entry.input || meta?.kind === 'input',
    // The 📍 lock, on the other hand, is fully overridable in edit mode.
    alwaysOn: meta?.alwaysOn ?? entry.alwaysOn,
    hidden: meta?.hidden ?? false,
    nativeGroupId,
    groupId,
  };
}
