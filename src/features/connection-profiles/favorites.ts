/**
 * 连接档案 — the favorites model (pure).
 *
 * A **favorite is a saved "rig variant"**, not a 1:1 mirror of an ST connection profile. It has
 * its own id and points at an ST profile by `profileId` — and **several favorites may share one
 * `profileId`** (e.g. "Claude热" temp 1.1 and "Claude冷" temp 0.6 over the same Claude
 * connection). So everything keys by the favorite's `id`, not `profileId`.
 *
 * Each favorite carries the overlay ST's own profile drops on switch: a per-param override
 * (`params`) and the three 附加参数 text fields (`extra`). The live profile name/model/preset are
 * merged from the gateway at read time, so a favorite whose ST profile was deleted surfaces as
 * `missing` instead of misfiring. All functions are pure, total, and never throw.
 */
import type { ParamId, ParamSetting } from './policy';

/** The three ST "Additional Parameters" text blobs (custom_include_body / _exclude_body / headers). */
export interface ExtraParams {
  includeBody?: string;
  excludeBody?: string;
  headers?: string;
}

/** A saved rig variant. Identity = `id`; `profileId` (the ST profile it switches to) may be shared. */
export interface Favorite {
  /** Our own unique id (a favorite, not a profile). */
  id: string;
  /** ST connection profile id this variant switches to (stable; may be shared by sibling variants). */
  profileId: string;
  /** Short display label — ST names are long, and sibling variants need distinguishing. */
  label?: string;
  /** Optional preset-console snapshot id to apply after the switch. */
  snapshotId?: string;
  /** Per-param numeric override applied after the switch (ST profiles don't carry these). */
  params?: Partial<Record<ParamId, ParamSetting>>;
  /** 附加参数 text override applied after the switch (ST profiles don't carry these either). */
  extra?: ExtraParams;
}

/** The subset of an ST connection profile the switcher reads (from the gateway). */
export interface ConnProfileLite {
  id: string;
  name: string;
  model?: string;
  preset?: string;
}

/** A favorite merged with its live ST profile — what the UI renders and the apply path uses. */
export interface ResolvedFavorite {
  id: string;
  profileId: string;
  /** Live profile name — used for `/profile <name>` and as the fallback display. */
  name: string;
  /** Chip text: explicit label, else the live name, else a deleted marker. */
  label: string;
  model?: string;
  preset?: string;
  snapshotId?: string;
  params?: Partial<Record<ParamId, ParamSetting>>;
  extra?: ExtraParams;
  /** The pinned profile no longer exists in ST — show broken, never apply. */
  missing: boolean;
}

const DELETED_LABEL = '(已删除)';

/** Merge favorites with the live profile list; dangling ones become `missing` (kept, not dropped). */
export function reconcileFavorites(favorites: Favorite[], profiles: ConnProfileLite[]): ResolvedFavorite[] {
  const byId = new Map(profiles.map(p => [p.id, p]));
  return favorites.map(fav => {
    const p = byId.get(fav.profileId);
    return {
      id: fav.id,
      profileId: fav.profileId,
      name: p?.name ?? '',
      label: fav.label?.trim() || p?.name || DELETED_LABEL,
      model: p?.model,
      preset: p?.preset,
      snapshotId: fav.snapshotId,
      params: fav.params,
      extra: fav.extra,
      missing: !p,
    };
  });
}

/** Resolve one favorite (by its id) for applying — `null` if its profile is missing (caller blocks). */
export function resolveForApply(favorites: Favorite[], profiles: ConnProfileLite[], id: string): ResolvedFavorite | null {
  const found = reconcileFavorites(favorites, profiles).find(f => f.id === id);
  return found && !found.missing ? found : null;
}

/** Create a new variant for `profileId` with a caller-supplied id (kept pure/testable). */
export function createFavorite(favorites: Favorite[], profileId: string, id: string, label?: string): Favorite[] {
  const fav: Favorite = { id, profileId, ...(label ? { label } : {}) };
  return [...favorites, fav];
}

/** Duplicate a variant under a new id (the "hot/cold over one connection" path). */
export function duplicateFavorite(favorites: Favorite[], sourceId: string, newId: string): Favorite[] {
  const src = favorites.find(f => f.id === sourceId);
  if (!src) return favorites;
  const copy: Favorite = { ...src, id: newId, label: `${src.label ?? ''}${src.label ? ' 副本' : ''}` || undefined };
  const at = favorites.findIndex(f => f.id === sourceId) + 1;
  return [...favorites.slice(0, at), copy, ...favorites.slice(at)];
}

/** Drop a variant by id. */
export function removeFavorite(favorites: Favorite[], id: string): Favorite[] {
  return favorites.filter(f => f.id !== id);
}

/** Patch a variant's label / snapshot. Empty string clears the optional field. */
export function updateFavorite(favorites: Favorite[], id: string, patch: Partial<Pick<Favorite, 'label' | 'snapshotId'>>): Favorite[] {
  return favorites.map(f => {
    if (f.id !== id) return f;
    const next: Favorite = { ...f };
    if ('label' in patch) (patch.label ? (next.label = patch.label) : delete next.label);
    if ('snapshotId' in patch) (patch.snapshotId ? (next.snapshotId = patch.snapshotId) : delete next.snapshotId);
    return next;
  });
}

/**
 * Set or clear one param override on a variant. `value === null` removes it (rig default); a
 * number stores a `send` setting. Prunes an emptied `params` map so the favorite serializes clean.
 */
export function setParamValue(favorites: Favorite[], id: string, paramId: ParamId, value: number | null): Favorite[] {
  return favorites.map(f => {
    if (f.id !== id) return f;
    const params: Partial<Record<ParamId, ParamSetting>> = { ...f.params };
    if (value === null || !Number.isFinite(value)) delete params[paramId];
    else params[paramId] = { mode: 'send', value };
    const next: Favorite = { ...f };
    if (Object.keys(params).length) next.params = params;
    else delete next.params;
    return next;
  });
}

/** Replace a variant's whole param + 附加参数 overlay at once (used by 捕获当前). */
export function setOverlay(favorites: Favorite[], id: string, params: Partial<Record<ParamId, ParamSetting>>, extra: ExtraParams): Favorite[] {
  return favorites.map(f => {
    if (f.id !== id) return f;
    const next: Favorite = { ...f };
    if (Object.keys(params).length) next.params = params;
    else delete next.params;
    const trimmedExtra: ExtraParams = {};
    if (extra.includeBody?.trim()) trimmedExtra.includeBody = extra.includeBody;
    if (extra.excludeBody?.trim()) trimmedExtra.excludeBody = extra.excludeBody;
    if (extra.headers?.trim()) trimmedExtra.headers = extra.headers;
    if (Object.keys(trimmedExtra).length) next.extra = trimmedExtra;
    else delete next.extra;
    return next;
  });
}

/** Set or clear one 附加参数 text field on a variant (blank clears; prunes an emptied `extra`). */
export function setExtraField(favorites: Favorite[], id: string, key: keyof ExtraParams, value: string): Favorite[] {
  return favorites.map(f => {
    if (f.id !== id) return f;
    const extra: ExtraParams = { ...f.extra };
    if (value.trim()) extra[key] = value;
    else delete extra[key];
    const next: Favorite = { ...f };
    if (Object.keys(extra).length) next.extra = extra;
    else delete next.extra;
    return next;
  });
}

/** Move a variant one slot (`-1` up / `+1` down), clamped — chip order is user-controlled. */
export function moveFavorite(favorites: Favorite[], id: string, dir: -1 | 1): Favorite[] {
  const i = favorites.findIndex(f => f.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= favorites.length) return favorites;
  const next = [...favorites];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Profile ids that already have ≥1 saved variant — drives the 已保存/未保存 split. */
export function savedProfileIds(favorites: Favorite[]): Set<string> {
  return new Set(favorites.map(f => f.profileId));
}
