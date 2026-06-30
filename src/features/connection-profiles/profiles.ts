/**
 * 连接档案 — the impure edge (mirrors `chat-source.ts` / `preset-io`'s role).
 *
 * Reads ST's existing connection profiles and switches between them via the confirmed
 * `/profile <name>` slash command (verified live 2026-06-25). Holds **no** connection data of
 * its own — the url+key+model+preset all live in ST's profile; we only name which one to load.
 *
 * Dual-mount: ST lives on `window.SillyTavern` (native extension) or `parent.SillyTavern`
 * (srcdoc iframe). Reads are best-effort — return empty / false rather than throwing, so the
 * switcher shows an empty state instead of crashing.
 */
import type { ConnProfileLite, ExtraParams } from './favorites';
import { PARAMS, type ParamId } from './params';

/** The three ST `chatCompletionSettings` fields behind 附加参数 (主体参数包含/排除/请求标头). */
const EXTRA_FIELDS: Record<keyof ExtraParams, string> = {
  includeBody: 'custom_include_body',
  excludeBody: 'custom_exclude_body',
  headers: 'custom_include_headers',
};

/** One ST regex script — the few fields we touch for the keep-enabled guard. */
interface RegexScriptLite {
  id?: string;
  scriptName?: string;
  disabled?: boolean;
}
/** ST's PresetManager (typed `any` upstream); the accessors we probe for preset-scoped regex. */
interface StPresetManager {
  getSelectedPresetName?: () => string;
  getSelectedPreset?: () => unknown;
  getCompletionPresetByName?: (name: string) => { extensions?: { regex_scripts?: unknown } } | undefined;
}
interface StContext {
  extensionSettings?: {
    connectionManager?: { profiles?: RawProfile[]; selectedProfile?: string };
    /** ST's global regex scripts (the "Scripts" list); a profile switch can flip `disabled`. */
    regex?: RegexScriptLite[];
  };
  /** Character-scoped regex lives on the selected card; `characterId` may be a string index. */
  characters?: { data?: { extensions?: { regex_scripts?: RegexScriptLite[] } } }[];
  characterId?: number | string;
  /** Preset-scoped regex lives on the current completion preset, reached via PresetManager. */
  getPresetManager?: (apiId?: string) => StPresetManager | undefined;
  executeSlashCommandsWithOptions?: (text: string) => Promise<{ pipe?: unknown }>;
  chatCompletionSettings?: Record<string, unknown>;
  saveSettingsDebounced?: () => void;
  eventSource?: { once?: (event: string, cb: () => void) => void; emit?: (event: string, ...args: unknown[]) => unknown };
  eventTypes?: Record<string, string>;
}
interface RawProfile {
  id?: string;
  name?: string;
  model?: string;
  preset?: string;
  [key: string]: unknown;
}

function stContext(): StContext | null {
  const w = window as unknown as {
    SillyTavern?: { getContext?: () => StContext };
    parent?: { SillyTavern?: { getContext?: () => StContext } };
  };
  const st = w.SillyTavern ?? w.parent?.SillyTavern;
  try {
    return st?.getContext?.() ?? null;
  } catch {
    return null;
  }
}

/** Read ST's saved connection profiles (id + name + model + preset). Best-effort → `[]`. */
export function listProfiles(): ConnProfileLite[] {
  const profiles = stContext()?.extensionSettings?.connectionManager?.profiles ?? [];
  return profiles
    .filter((p): p is RawProfile & { id: string; name: string } => typeof p.id === 'string' && typeof p.name === 'string')
    .map(p => ({ id: p.id, name: p.name, model: typeof p.model === 'string' ? p.model : undefined, preset: typeof p.preset === 'string' ? p.preset : undefined }));
}

/** The id of ST's currently-selected profile, or `null`. (Live settings may have drifted from it.) */
export function selectedProfileId(): string | null {
  return stContext()?.extensionSettings?.connectionManager?.selectedProfile ?? null;
}

/**
 * Switch ST to the named profile via `/profile <name>` — ST applies url+key+model+preset.
 * Resolves `true` on success, `false` if ST is unreachable or the command throws. The name is
 * passed as the unnamed argument (ST takes the remainder of the line); see DESIGN "Open" for
 * the quoting caveat to confirm against names containing STscript-special chars.
 */
export async function applyProfile(name: string): Promise<boolean> {
  const ctx = stContext();
  const run = ctx?.executeSlashCommandsWithOptions;
  if (!run) return false;
  try {
    await run(`/profile ${name}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the **current** live values from ST — the basis for 捕获当前, so the user sets their
 * sampler in ST and we snapshot it rather than making them type numbers. Returns the managed
 * params (only fields ST actually has) + the three 附加参数 strings. Best-effort → empty.
 */
export function captureCurrent(): { params: Partial<Record<ParamId, number>>; extra: ExtraParams } {
  const s = stContext()?.chatCompletionSettings;
  const params: Partial<Record<ParamId, number>> = {};
  const extra: ExtraParams = {};
  if (!s) return { params, extra };
  for (const def of PARAMS) {
    const v = s[def.id];
    if (typeof v === 'number' && Number.isFinite(v)) params[def.id] = v;
  }
  for (const [key, field] of Object.entries(EXTRA_FIELDS)) {
    const v = s[field];
    if (typeof v === 'string' && v.trim()) extra[key as keyof ExtraParams] = v;
  }
  return { params, extra };
}

/**
 * Write the favorite's overlay into `chatCompletionSettings` — the bits ST's profile switch
 * drops (temp/penalties under `_openai` fields + the three 附加参数 text fields). Applied
 * **after** `applyProfile` so it wins over the preset the profile loaded. Best-effort → `false`.
 *
 * The three 附加参数 fields are written **unconditionally** (an unset one → `''`): a rig's overlay
 * is its *complete* state, so switching to a variant that doesn't set 包含主体参数 must **clear** it,
 * not leave the previous rig's value (the "what-to-include stays the same" bug). Params are only
 * written when the variant sets them — an unset param legitimately falls back to the preset's value
 * that `/profile` just loaded.
 *
 * Persists via `saveSettingsDebounced`. Generation reads these live values; the resilient re-apply
 * below handles the trailing reload that would otherwise clobber them.
 */
export function writeOverlay(settings: Partial<Record<ParamId, number>>, extra: ExtraParams): boolean {
  const ctx = stContext();
  const s = ctx?.chatCompletionSettings;
  if (!s) return false;
  try {
    for (const [field, value] of Object.entries(settings)) {
      if (typeof value === 'number' && Number.isFinite(value)) s[field] = value;
    }
    for (const [key, field] of Object.entries(EXTRA_FIELDS)) {
      s[field] = extra[key as keyof ExtraParams] ?? '';
    }
    ctx.saveSettingsDebounced?.();
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `fn` now and **again** once `/profile`'s **trailing async chat-reload** settles, so a
 * write isn't clobbered by the freshly-loaded preset re-applying *after* our first call (the
 * "temp doesn't change" bug). Fires on ST's `CHAT_CHANGED`, with an 800ms timeout fallback if
 * that event never comes; the `done` guard makes the second run happen exactly once.
 */
function runAfterProfileSettle(fn: () => void): void {
  fn();
  const ctx = stContext();
  let done = false;
  const again = (): void => {
    if (done) return;
    done = true;
    fn();
  };
  const evt = ctx?.eventTypes?.CHAT_CHANGED;
  if (evt && ctx?.eventSource?.once) {
    try { ctx.eventSource.once(evt, again); } catch { /* fall through to the timeout */ }
  }
  setTimeout(again, 800);
}

/** Re-apply the param + 附加参数 overlay resiliently (see `runAfterProfileSettle`). */
export function applyOverlayResilient(settings: Partial<Record<ParamId, number>>, extra: ExtraParams): void {
  runAfterProfileSettle(() => writeOverlay(settings, extra));
}

/** A stable key for a regex script across the snapshot/restore pair: id, else its name. */
function regexKey(s: RegexScriptLite): string | null {
  if (typeof s.id === 'string' && s.id) return s.id;
  if (typeof s.scriptName === 'string' && s.scriptName) return `name:${s.scriptName}`;
  return null;
}

/**
 * The **live, mutable** regex-script arrays across ST's three scopes — 全局 (`extensionSettings.regex`),
 * 角色 (the selected card's `data.extensions.regex_scripts`) and 预设 (the current completion preset's),
 * mirroring `st-regex.ts`'s read but returning the arrays by reference so we can flip `disabled` on
 * them. A profile switch can disable scripts in **any** of these; preset access is best-effort
 * (PresetManager is loosely typed upstream).
 */
function regexArrays(ctx: StContext): RegexScriptLite[][] {
  const arrays: RegexScriptLite[][] = [];
  const push = (v: unknown): void => {
    if (Array.isArray(v)) arrays.push(v as RegexScriptLite[]);
  };
  push(ctx.extensionSettings?.regex);
  const cid = ctx.characterId;
  if (cid != null && cid !== '' && Number.isFinite(Number(cid))) {
    push(ctx.characters?.[Number(cid)]?.data?.extensions?.regex_scripts);
  }
  try {
    const pm = ctx.getPresetManager?.();
    if (pm) {
      const name = pm.getSelectedPresetName?.();
      let preset: { extensions?: { regex_scripts?: unknown } } | undefined;
      if (name && pm.getCompletionPresetByName) preset = pm.getCompletionPresetByName(name);
      if (!preset) {
        const sel = pm.getSelectedPreset?.();
        if (sel && typeof sel === 'object') preset = sel as { extensions?: { regex_scripts?: unknown } };
      }
      push(preset?.extensions?.regex_scripts);
    }
  } catch { /* preset-scoped regex is best-effort */ }
  return arrays;
}

/**
 * Snapshot which regex scripts are **enabled** right now (across 全局/角色/预设), keyed by id/name.
 * Taken *before* a profile switch so `restoreEnabledRegex` can undo ST's habit of flipping some off
 * when the profile carries a regex-preset association. Best-effort → empty set.
 */
export function snapshotEnabledRegex(): Set<string> {
  const ctx = stContext();
  const enabled = new Set<string>();
  if (!ctx) return enabled;
  for (const arr of regexArrays(ctx)) {
    for (const s of arr) {
      const key = regexKey(s);
      if (key && !s.disabled) enabled.add(key);
    }
  }
  return enabled;
}

/**
 * Re-enable any regex script that was enabled in `wasEnabled` but is now `disabled` — the
 * workaround for ST switching regex off on a profile change, covering **all three scopes**.
 * **One-directional**: only turns scripts back *on*, never off, so a script the user enabled
 * mid-switch is left alone. Returns how many it restored. Persists via `saveSettingsDebounced`.
 */
export function restoreEnabledRegex(wasEnabled: Set<string>): number {
  const ctx = stContext();
  if (!ctx || !wasEnabled.size) return 0;
  let restored = 0;
  for (const arr of regexArrays(ctx)) {
    for (const s of arr) {
      const key = regexKey(s);
      if (key && wasEnabled.has(key) && s.disabled) {
        s.disabled = false;
        restored += 1;
      }
    }
  }
  if (restored) ctx.saveSettingsDebounced?.();
  return restored;
}

/** Restore the pre-switch enabled regex set resiliently against `/profile`'s trailing reload. */
export function restoreRegexResilient(wasEnabled: Set<string>): void {
  if (!wasEnabled.size) return;
  runAfterProfileSettle(() => { restoreEnabledRegex(wasEnabled); });
}
