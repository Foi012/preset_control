/**
 * 连接档案 — the pure param-policy core.
 *
 * A 连接档案 (connection profile) is a thin layer *over* an existing ST connection profile
 * (which already bundles endpoint url + model + key-by-reference + preset — see
 * `connection-profiles-feature` memory / the getContext spike). This module owns the **one
 * thing ST profiles can't express**: a per-param policy answering the user's two endpoint
 * realities —
 *   - #1 "this endpoint rejects param X"      → **drop** (strip from the request body)
 *   - #2 "this endpoint only accepts temp=1"  → **lock** (force a fixed value)
 *   - otherwise                               → **send** (apply a chosen value, else leave ST's)
 *
 * `resolveParamApply` turns a profile's intent into a concrete, side-effect-free plan:
 *   - `settings` — `{ oai_settings field → number }` to write into `chatCompletionSettings`
 *     (for **send** with a value, and **lock**).
 *   - `excludeBody` — request-body param names to add to ST's `custom_exclude_body` (for **drop**).
 *
 * Serializing `excludeBody` into ST's actual `custom_exclude_body` string, and writing
 * `settings`, are the impure gateway's job (confirmed against live ST) — kept out of here so
 * this stays testable with no ST/DOM. The function **never throws**: unknown ids, missing
 * values, and non-finite numbers are skipped; in-range clamping guards bad input.
 */
import { PARAMS, paramDef, type ParamId } from './params';

/** How a profile treats one managed param. */
export type ParamMode = 'send' | 'drop' | 'lock';

export interface ParamSetting {
  mode: ParamMode;
  /** Desired value for `send`, forced value for `lock`. Ignored for `drop`. */
  value?: number;
}

/** Our per-profile overlay, keyed to an ST connection profile by id. Never holds the key/secret. */
export interface ProfileExtras {
  /** The ST connection profile id this overlay augments. */
  profileId: string;
  /** Optional preset-console snapshot to apply after the profile switch. */
  snapshotId?: string;
  /** Per-param policy. Params absent from this map are left untouched (ST/preset wins). */
  params?: Partial<Record<ParamId, ParamSetting>>;
}

/** A concrete, side-effect-free plan for the impure apply layer. */
export interface ParamApply {
  /** Values to write into `chatCompletionSettings` (send-with-value + lock). */
  settings: Partial<Record<ParamId, number>>;
  /** Request-body param names to add to `custom_exclude_body` (drop), registry order, de-duped. */
  excludeBody: string[];
}

/** Clamp into the def's range; round when the param is integer-stepped. Non-finite → null (skip). */
function clamp(id: ParamId, raw: number | undefined): number | null {
  if (raw === undefined || !Number.isFinite(raw)) return null;
  const def = paramDef(id);
  if (!def) return null;
  let v = Math.min(def.max, Math.max(def.min, raw));
  if (def.step >= 1) v = Math.round(v);
  return v;
}

/**
 * Resolve a profile's param intent into an apply plan. Iterates the **registry** (not the
 * user map) so output is deterministic and ignores stray/unknown param ids.
 */
export function resolveParamApply(extras: ProfileExtras): ParamApply {
  const settings: Partial<Record<ParamId, number>> = {};
  const excludeBody: string[] = [];

  for (const def of PARAMS) {
    const setting = extras.params?.[def.id];
    if (!setting) continue;
    switch (setting.mode) {
      case 'drop':
        excludeBody.push(def.body);
        break;
      case 'lock':
      case 'send': {
        const v = clamp(def.id, setting.value);
        if (v !== null) settings[def.id] = v;
        break;
      }
    }
  }
  return { settings, excludeBody };
}
