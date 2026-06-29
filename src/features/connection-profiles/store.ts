/**
 * 连接档案 — the tool's Pinia store.
 *
 * Holds the user's curated **favorites** (persisted in our own localStorage, never the key,
 * never inside a preset) and the **live ST profile list** (read fresh from the gateway). All
 * structural logic is the pure `favorites.ts` model; this store just wires it to persistence,
 * the impure gateway, and Vue reactivity.
 *
 * Apply = `/profile <name>` via the gateway (ST swaps url+key+model+preset). Snapshot binding
 * (applying a preset-console snapshot after the switch) is orchestrated at the toolbox shell,
 * not here, to keep the "tools never import each other" boundary — so this store carries the
 * bound `snapshotId` but does not reach into the console.
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { applyProfile, listProfiles, selectedProfileId, writeParams } from './profiles';
import {
  addFavorite, moveFavorite, reconcileFavorites, removeFavorite, resolveForApply, setParamValue, updateFavorite,
  type Favorite,
} from './favorites';
import { resolveParamApply } from './policy';
import type { ParamId } from './params';

const FAVORITES_KEY = 'connectionProfilesFavorites';

/** Best-effort read (the srcdoc iframe may have opaque-origin storage). Drops malformed rows. */
function readFavorites(): Favorite[] {
  try {
    const raw = window.localStorage?.getItem(FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f): f is Favorite => !!f && typeof f.profileId === 'string')
      .map(f => ({
        profileId: f.profileId,
        ...(typeof f.label === 'string' ? { label: f.label } : {}),
        ...(typeof f.snapshotId === 'string' ? { snapshotId: f.snapshotId } : {}),
      }));
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

export const useConnectionStore = defineStore('cp-connection', () => {
  const favorites = ref<Favorite[]>(readFavorites());
  const profiles = ref(listProfiles());
  const currentId = ref<string | null>(selectedProfileId());
  const applyingId = ref<string | null>(null);
  const error = ref<string | null>(null);

  /** Re-read ST's profiles + active selection — called on open and after applying. */
  function refresh(): void {
    profiles.value = listProfiles();
    currentId.value = selectedProfileId();
  }

  /** Pinned favorites merged with live profiles (dangling ones flagged `missing`). */
  const resolved = computed(() => reconcileFavorites(favorites.value, profiles.value));
  const pinnedIds = computed(() => new Set(favorites.value.map(f => f.profileId)));
  /** ST profiles not yet pinned — the "add a rig" candidates. */
  const available = computed(() => profiles.value.filter(p => !pinnedIds.value.has(p.id)));

  function commit(next: Favorite[]): void {
    favorites.value = next;
    writeFavorites(next);
  }
  const pin = (id: string): void => commit(addFavorite(favorites.value, id));
  const unpin = (id: string): void => commit(removeFavorite(favorites.value, id));
  const relabel = (id: string, label: string): void => commit(updateFavorite(favorites.value, id, { label }));
  const bindSnapshot = (id: string, snapshotId: string): void => commit(updateFavorite(favorites.value, id, { snapshotId }));
  const move = (id: string, dir: -1 | 1): void => commit(moveFavorite(favorites.value, id, dir));
  /** Set (number) or clear (null) one param override on a favorite. */
  const setParam = (id: string, paramId: ParamId, value: number | null): void =>
    commit(setParamValue(favorites.value, id, paramId, value));

  /**
   * Switch ST to a pinned rig: `/profile` (url+key+model+preset) → then re-apply the favorite's
   * param override (the part ST drops). Blocks with a message if the profile was deleted in ST.
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
      const { settings } = resolveParamApply({ profileId: id, params: target.params });
      if (Object.keys(settings).length) writeParams(settings);
      currentId.value = selectedProfileId();
    } finally {
      applyingId.value = null;
    }
  }

  return {
    favorites, profiles, currentId, applyingId, error,
    resolved, available,
    refresh, pin, unpin, relabel, bindSnapshot, setParam, move, apply,
  };
});
