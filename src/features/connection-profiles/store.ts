/**
 * 连接档案 — the tool's Pinia store.
 *
 * Holds the user's saved **rig variants** (favorites, persisted in our own localStorage — never
 * the key, never inside a preset) and the **live ST profile list** (read fresh from the gateway).
 * Structural logic is the pure `favorites.ts` model; this store wires it to persistence, the
 * impure gateway, and Vue reactivity.
 *
 * Apply = `/profile <name>` (ST swaps url+key+model+preset) → `writeOverlay` re-applies the
 * variant's param + 附加参数 override (the bits ST drops). Snapshot binding is shell-orchestrated.
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { applyOverlayResilient, applyProfile, captureCurrent, listProfiles, selectedProfileId } from './profiles';
import {
  createFavorite, duplicateFavorite, moveFavorite, reconcileFavorites, removeFavorite, resolveForApply,
  savedProfileIds, setExtraField, setOverlay, setParamValue, updateFavorite,
  type ExtraParams, type Favorite,
} from './favorites';
import { resolveParamApply } from './policy';
import type { ParamId, ParamSetting } from './params';

const FAVORITES_KEY = 'connectionProfilesFavorites';

/** A unique id for a new variant (crypto where available; cheap fallback otherwise). */
function genId(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  } catch {
    return `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** Best-effort read (the srcdoc iframe may have opaque-origin storage). Drops malformed rows. */
function readFavorites(): Favorite[] {
  try {
    const raw = window.localStorage?.getItem(FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f): f is Favorite => !!f && typeof f.profileId === 'string')
      // Migrate v1 favorites (keyed by profileId, no own id) → give them an id.
      .map(f => ({ ...f, id: typeof f.id === 'string' ? f.id : genId() }));
  } catch {
    return [];
  }
}

function writeFavorites(favorites: Favorite[]): void {
  try {
    window.localStorage?.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch {
    /* persistence is best-effort; session state still works */
  }
}

const toSettings = (params: Partial<Record<ParamId, number>>): Partial<Record<ParamId, ParamSetting>> =>
  Object.fromEntries(Object.entries(params).map(([k, v]) => [k, { mode: 'send', value: v }]));

export const useConnectionStore = defineStore('cp-connection', () => {
  const favorites = ref<Favorite[]>(readFavorites());
  const profiles = ref(listProfiles());
  const currentId = ref<string | null>(selectedProfileId());
  /** The specific variant last applied this session — drives the 档案 dropdown selection. */
  const appliedId = ref<string | null>(null);
  const applyingId = ref<string | null>(null);
  const error = ref<string | null>(null);
  /** Management filters (mirror the console's in-use bar): a search box + a saved-only eye toggle. */
  const search = ref('');
  const savedOnly = ref(true);

  function refresh(): void {
    profiles.value = listProfiles();
    currentId.value = selectedProfileId();
  }

  /** Saved variants merged with live profiles (dangling → `missing`). */
  const resolved = computed(() => reconcileFavorites(favorites.value, profiles.value));
  const saved = computed(() => savedProfileIds(favorites.value));
  /** ST profiles with no variant yet — the 未保存 accordion / "add a rig" source. */
  const unsaved = computed(() => profiles.value.filter(p => !saved.value.has(p.id)));

  function commit(next: Favorite[]): void {
    favorites.value = next;
    writeFavorites(next);
  }
  /** Create a variant and return its id (so the UI can open its editor immediately — edit-on-add). */
  function createVariant(profileId: string): string {
    const id = genId();
    commit(createFavorite(favorites.value, profileId, id));
    return id;
  }
  const duplicate = (id: string): void => commit(duplicateFavorite(favorites.value, id, genId()));
  const remove = (id: string): void => commit(removeFavorite(favorites.value, id));
  const relabel = (id: string, label: string): void => commit(updateFavorite(favorites.value, id, { label }));
  const bindSnapshot = (id: string, snapshotId: string): void => commit(updateFavorite(favorites.value, id, { snapshotId }));
  const setParam = (id: string, paramId: ParamId, value: number | null): void => commit(setParamValue(favorites.value, id, paramId, value));
  const setExtra = (id: string, key: keyof ExtraParams, value: string): void => commit(setExtraField(favorites.value, id, key, value));
  const move = (id: string, dir: -1 | 1): void => commit(moveFavorite(favorites.value, id, dir));

  /** 捕获当前: snapshot ST's live params + 附加参数 into the variant (no typing). */
  function capture(id: string): void {
    const { params, extra } = captureCurrent();
    commit(setOverlay(favorites.value, id, toSettings(params), extra));
  }

  /** Read ST's live params + 附加参数 as a ready overlay — for the draft's 捕获 (not yet a favorite). */
  function captureValues(): { params: Partial<Record<ParamId, ParamSetting>>; extra: ExtraParams } {
    const { params, extra } = captureCurrent();
    return { params: toSettings(params), extra };
  }

  /** Commit a configured draft as a new saved variant (edit-then-add). */
  function addDraft(profileId: string, label: string, params: Partial<Record<ParamId, ParamSetting>>, extra: ExtraParams): void {
    const id = genId();
    commit(setOverlay(createFavorite(favorites.value, profileId, id, label || undefined), id, params, extra));
  }

  /**
   * Switch to a saved rig: `/profile` (url+key+model+preset) → re-apply the variant's param +
   * 附加参数 overlay (the parts ST drops). Blocks with a message if the profile was deleted.
   */
  async function apply(id: string): Promise<void> {
    const target = resolveForApply(favorites.value, profiles.value, id);
    if (!target) {
      error.value = '该连接档案在 ST 中已不存在，请移除后重新添加。';
      return;
    }
    error.value = null;
    applyingId.value = id;
    try {
      const ok = await applyProfile(target.name);
      if (!ok) {
        error.value = '切换失败：无法连接 SillyTavern。';
        return;
      }
      appliedId.value = id;
      currentId.value = selectedProfileId();

      // Always apply: even an empty overlay must clear the previous rig's 附加参数 (each rig is a
      // complete config). `applyOverlayResilient` re-writes after /profile's trailing reload settles.
      const { settings } = resolveParamApply({ profileId: target.profileId, params: target.params });
      applyOverlayResilient(settings, target.extra ?? {});
    } finally {
      applyingId.value = null;
    }
  }

  return {
    favorites, profiles, currentId, appliedId, applyingId, error, search, savedOnly,
    resolved, unsaved,
    refresh, createVariant, duplicate, remove, relabel, bindSnapshot, setParam, setExtra, capture, captureValues, addDraft, move, apply,
  };
});
