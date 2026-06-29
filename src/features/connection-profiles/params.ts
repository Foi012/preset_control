/**
 * Managed sampling parameters — the SSOT registry for the 连接档案 tool.
 *
 * Each entry maps the **`oai_settings` field name** (what we read/write in
 * `chatCompletionSettings`, confirmed via the getContext spike 2026-06-25 — ST suffixes
 * most of them `_openai`) to the **request-body key** (what an OpenAI-compatible endpoint
 * actually receives, and therefore what ST's `custom_exclude_body` strips by name).
 *
 * Why both names: a "lock"/"send" policy writes the *settings field* (`temp_openai`); a
 * "drop" policy names the *body key* (`temperature`) for `custom_exclude_body`. They differ
 * (`freq_pen_openai` → `frequency_penalty`), so the mapping has to be explicit.
 *
 * The `min/max/step` bounds drive the UI controls and the clamp in `policy.ts`; they are
 * deliberately generous so a legitimate value is never silently rejected.
 */

/** An `oai_settings` field this tool manages. */
export type ParamId =
  | 'temp_openai'
  | 'top_p_openai'
  | 'top_k_openai'
  | 'top_a_openai'
  | 'min_p_openai'
  | 'freq_pen_openai'
  | 'pres_pen_openai'
  | 'repetition_penalty_openai'
  | 'openai_max_tokens'
  | 'seed';

export interface ParamDef {
  /** `oai_settings` / `chatCompletionSettings` field name. */
  id: ParamId;
  /** Request-body key — what `custom_exclude_body` names to drop the param. */
  body: string;
  /** UI label. */
  label: string;
  min: number;
  max: number;
  step: number;
}

export const PARAMS: ParamDef[] = [
  { id: 'temp_openai', body: 'temperature', label: '温度', min: 0, max: 2, step: 0.01 },
  { id: 'top_p_openai', body: 'top_p', label: 'Top P', min: 0, max: 1, step: 0.01 },
  { id: 'top_k_openai', body: 'top_k', label: 'Top K', min: 0, max: 500, step: 1 },
  { id: 'top_a_openai', body: 'top_a', label: 'Top A', min: 0, max: 1, step: 0.01 },
  { id: 'min_p_openai', body: 'min_p', label: 'Min P', min: 0, max: 1, step: 0.01 },
  { id: 'freq_pen_openai', body: 'frequency_penalty', label: '频率惩罚', min: -2, max: 2, step: 0.01 },
  { id: 'pres_pen_openai', body: 'presence_penalty', label: '存在惩罚', min: -2, max: 2, step: 0.01 },
  { id: 'repetition_penalty_openai', body: 'repetition_penalty', label: '重复惩罚', min: 1, max: 2, step: 0.01 },
  { id: 'openai_max_tokens', body: 'max_tokens', label: '最大回复长度', min: 1, max: 200000, step: 1 },
  { id: 'seed', body: 'seed', label: '随机种子', min: -1, max: 4294967295, step: 1 },
];

const BY_ID = new Map<ParamId, ParamDef>(PARAMS.map(p => [p.id, p]));

/** Lookup a managed param def, or `undefined` for an unknown id (so callers stay total). */
export function paramDef(id: string): ParamDef | undefined {
  return BY_ID.get(id as ParamId);
}
