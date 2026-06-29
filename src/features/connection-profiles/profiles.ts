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

interface StContext {
  extensionSettings?: { connectionManager?: { profiles?: RawProfile[]; selectedProfile?: string } };
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
 * Apply the overlay resiliently against `/profile`'s **trailing async chat-reload**, which
 * re-applies the freshly-loaded preset's params *after* our first write and otherwise clobbers
 * it (the "temp doesn't change" bug). Strategy: write now, then write **again** once ST fires
 * `CHAT_CHANGED` (reload finished) — with a timeout fallback if that event never comes. The
 * `done` guard makes the re-apply fire exactly once.
 */
export function applyOverlayResilient(settings: Partial<Record<ParamId, number>>, extra: ExtraParams): void {
  writeOverlay(settings, extra);
  const ctx = stContext();
  let done = false;
  const reapply = (): void => {
    if (done) return;
    done = true;
    writeOverlay(settings, extra);
  };
  const evt = ctx?.eventTypes?.CHAT_CHANGED;
  if (evt && ctx?.eventSource?.once) {
    try { ctx.eventSource.once(evt, reapply); } catch { /* fall through to the timeout */ }
  }
  setTimeout(reapply, 800);
}
