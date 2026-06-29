/**
 * 连接档案 — the favorites model (pure).
 *
 * Scope (locked 2026-06-25): ST already owns connection profiles — each bundles
 * url+key+model+preset and switches via the `/profile <name>` slash command. This tool does
 * NOT rebuild that. It is a **curated quick-switcher**: the user pins their 2–3 writing rigs
 * as one-tap chips in the toolbox (vs scrolling ST's 15-entry dropdown), and optionally binds
 * a **preset-console snapshot** to a chip — the one thing an ST profile can't capture, since
 * snapshots are our own concept.
 *
 * A favorite references an ST profile by **id** (stable across renames). The live names/models
 * are read fresh from the gateway and merged here, so a favorite whose profile was deleted in
 * ST surfaces as `missing` instead of silently applying the wrong rig. All functions are pure,
 * total, and never throw.
 *
 * A favorite also carries an optional **param override** (`params`) — temperature/penalties the
 * rig should use. This is the thing ST's own profiles drop on the floor (confirmed 2026-06-25):
 * switching an ST profile applies the preset but **not** the sampling params, so we re-apply
 * them after the switch. The model reuses `policy.ts`'s `ParamSetting` so a future `lock`/`drop`
 * UI needs no model change.
 */
import type { ParamId, ParamSetting } from './policy';

/** A pinned rig. Identity = `profileId` (one favorite per ST profile). */
export interface Favorite {
  /** ST connection profile id this pins (stable; names can change). */
  profileId: string;
  /** Optional short display override — ST profile names are long (`【claude】 - …`). */
  label?: string;
  /** Optional preset-console snapshot id to apply after the profile switch. */
  snapshotId?: string;
  /** Optional per-param override applied after the switch (ST profiles don't carry these). */
  params?: Partial<Record<ParamId, ParamSetting>>;
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
  profileId: string;
  /** Live profile name — used for `/profile <name>` and as the fallback display. */
  name: string;
  /** What to show on the chip: explicit label, else the live name, else a deleted marker. */
  label: string;
  model?: string;
  preset?: string;
  snapshotId?: string;
  /** Per-param override carried from the favorite (applied after the switch). */
  params?: Partial<Record<ParamId, ParamSetting>>;
  /** The pinned profile no longer exists in ST — show broken, never apply. */
  missing: boolean;
}

const DELETED_LABEL = '(已删除)';

/** Merge favorites with the live profile list; dangling ids become `missing` (kept, not dropped). */
export function reconcileFavorites(favorites: Favorite[], profiles: ConnProfileLite[]): ResolvedFavorite[] {
  const byId = new Map(profiles.map(p => [p.id, p]));
  return favorites.map(fav => {
    const p = byId.get(fav.profileId);
    return {
      profileId: fav.profileId,
      name: p?.name ?? '',
      label: fav.label?.trim() || p?.name || DELETED_LABEL,
      model: p?.model,
      preset: p?.preset,
      snapshotId: fav.snapshotId,
      params: fav.params,
      missing: !p,
    };
  });
}

/** Resolve one favorite for applying — returns `null` if it's missing (so the caller blocks). */
export function resolveForApply(favorites: Favorite[], profiles: ConnProfileLite[], profileId: string): ResolvedFavorite | null {
  const found = reconcileFavorites(favorites, profiles).find(f => f.profileId === profileId);
  return found && !found.missing ? found : null;
}

/** Append a favorite for `profileId`; a no-op if already pinned (dedup by id). */
export function addFavorite(favorites: Favorite[], profileId: string): Favorite[] {
  if (favorites.some(f => f.profileId === profileId)) return favorites;
  return [...favorites, { profileId }];
}

/** Drop the favorite for `profileId` (and its bound snapshot/label with it). */
export function removeFavorite(favorites: Favorite[], profileId: string): Favorite[] {
  return favorites.filter(f => f.profileId !== profileId);
}

/** Patch one favorite's fields (label / snapshot). Empty string clears the field. */
export function updateFavorite(favorites: Favorite[], profileId: string, patch: Partial<Omit<Favorite, 'profileId'>>): Favorite[] {
  return favorites.map(f => {
    if (f.profileId !== profileId) return f;
    const next: Favorite = { ...f };
    if ('label' in patch) (patch.label ? (next.label = patch.label) : delete next.label);
    if ('snapshotId' in patch) (patch.snapshotId ? (next.snapshotId = patch.snapshotId) : delete next.snapshotId);
    return next;
  });
}

/**
 * Set or clear one param override on a favorite. `value === null` removes the override (back to
 * the rig's own default); a number stores a `send` setting (the v1 UI; `lock`/`drop` come later).
 * Prunes an emptied `params` map so a favorite with no overrides serializes clean.
 */
export function setParamValue(favorites: Favorite[], profileId: string, paramId: ParamId, value: number | null): Favorite[] {
  return favorites.map(f => {
    if (f.profileId !== profileId) return f;
    const params: Partial<Record<ParamId, ParamSetting>> = { ...f.params };
    if (value === null || !Number.isFinite(value)) delete params[paramId];
    else params[paramId] = { mode: 'send', value };
    const next: Favorite = { ...f };
    if (Object.keys(params).length) next.params = params;
    else delete next.params;
    return next;
  });
}

/** Move a favorite one slot (`-1` up / `+1` down), clamped — chip order is user-controlled. */
export function moveFavorite(favorites: Favorite[], profileId: string, dir: -1 | 1): Favorite[] {
  const i = favorites.findIndex(f => f.profileId === profileId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= favorites.length) return favorites;
  const next = [...favorites];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
