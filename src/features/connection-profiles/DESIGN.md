# 连接档案 (Connection Profiles) — design spec

> **Status (read first).** The planned **third toolbox tool**, beside 预设控制台 and 聊天导出.
> **Scope narrowed 2026-06-25** after confirming live that ST already does the rig swap (the
> user has 15 working profiles; `/profile <name>` switches url+key+model+preset in one command).
> So this tool is **NOT** a connection/param manager — it is a **curated quick-switcher** over
> ST's own profiles, plus an optional **snapshot binding** (the only delta ST can't express).
>
> **Built end-to-end (compiles; `/profile` apply confirmed safe live 2026-06-25):** a working
> third tool. `favorites.ts` (pure model: pin/reconcile/reorder/relabel + **per-rig param
> override**, dangling detection) + `favorites.check.ts` (23 pass); `profiles.ts` (gateway:
> `listProfiles`, `applyProfile` via `/profile`, `writeParams`); `policy.ts`/`params.ts` (param
> apply plan, **now wired** — 20 checks); `store.ts` (Pinia); `ConnectionProfiles.vue` (chip
> switcher + 管理档案 + per-rig param editor); shell wired (`ToolId += 'connection'`, launcher card,
> `App.vue`).
>
> **Why params are wired (not parked):** confirmed live that **ST profiles do NOT carry sampling
> params** (switching applies the preset but not temp/penalties; it can also flip regex off — an
> ST bug). So binding temp/params per rig and re-applying them after `/profile` is the tool's
> real value over plain ST. **Still TODO:** snapshot binding (shell-orchestrated), `drop`/`lock`
> param UI + `custom_exclude_body` format, the regex-stays-on guard, UI polish after live render.
>
> Sibling specs: `src/features/preset-console/DESIGN.md`, `src/features/chat-export/DESIGN.md`.

## The decision: orchestrate ST's profiles, don't rebuild them

A getContext spike (2026-06-25) established that **ST connection profiles already bundle the
user's whole "rig"** and are programmatically reachable. A profile
(`extensionSettings.connectionManager.profiles[]`) carries: `api`, `api-url`, `model`,
`preset`, **`secret-id` (the key by reference — never the value)**, `proxy`,
`reasoning-template`, `prompt-post-processing`, `regex-preset`, stop-strings, `name`. The
user has 15 of them. Switching one swaps endpoint+key+model+preset in one action.

So the user's original pain #3 ("endpoints aren't bound to keys") is **already solved by a
feature they under-use** — we must not re-implement connection/key management (it would
duplicate ST, leak keys, and own a brittle surface). This tool is a **thin orchestrator**:

1. **List** the user's existing ST profiles as a one-click switcher (tuned for the GPT↔Claude
   A/B writing loop — their high-frequency action).
2. **Apply** via ST's own `/profile <name>` slash command (or `ConnectionManagerRequestService`)
   — the secure url+key+model+preset swap stays ST's job.
3. **Attach our two deltas** per profile id (stored in *our* cross-preset config, **never the
   key**) — the only things ST profiles can't express:
   - an optional **preset-console snapshot** to apply after the switch;
   - a **per-param policy** (drop / lock / send).

## Quick-switcher + snapshot binding — the shipped scope

The user A/B-compares 2–3 writing rigs constantly but ST's 连接配置 dropdown lists **all 15**
with long `【model】 - preset` names. So the tool surfaces a short, **curated** row of one-tap
chips (their pinned rigs) in the floating toolbox they already use. Tapping a chip:

1. `applyProfile(name)` → `/profile <name>` — ST applies url+key+model+preset (its job, secure).
2. if the favorite has a bound `snapshotId` → apply the preset-console snapshot (prompt toggles)
   — orchestrated at the **toolbox shell**, the one place allowed to know both tools (keeps the
   "tools never import each other" boundary intact). Uses the console store's `applyModeSnapshot`.

`favorites.ts` is the pure model: a `Favorite { profileId, label?, snapshotId? }` references an
ST profile by **id** (stable across renames); `reconcileFavorites` merges in live names/models
so a deleted profile shows `missing` (broken chip) instead of silently applying the wrong rig.
Favorites persist in **our own** cross-preset storage (never the key, never bound to one preset).

## Param override — the differentiator (`policy.ts` + `params.ts`, pure; wired)

ST profiles drop sampling params, so each favorite carries an optional `params` override that
`apply` re-applies **after** `/profile` (via `writeParams` → `chatCompletionSettings`). v1 UI
sets plain values (`mode: 'send'`) for the common params (温度/Top P/惩罚/最大长度); the model
already supports `drop`/`lock` for #1/#2 (endpoint rejects a param / forces temp=1) — a 高级 UI
+ confirming ST's `custom_exclude_body` string format is the follow-up.

### Apply-plan modes (model; UI exposes `send` for now)

Answers the user's two endpoint realities:

| Mode   | Use                                   | Apply effect |
| ------ | ------------------------------------- | ------------ |
| `drop` | #1 endpoint **rejects** a param       | add the param's **request-body** name to ST `custom_exclude_body` |
| `lock` | #2 endpoint **only accepts** temp=1   | force a fixed value into the `oai_settings` field |
| `send` | normal override                       | write a chosen value (absent value ⇒ leave ST/preset's) |

`resolveParamApply(extras)` → `{ settings: {oaiField→number}, excludeBody: string[] }`, a
side-effect-free plan. Pure, **never throws** (unknown ids / missing values / non-finite
skipped; values clamped to range, integer params rounded). Iterates the **registry** so output
is deterministic regardless of map order.

`params.ts` is the SSOT registry mapping the **`oai_settings` field** (`temp_openai`,
`freq_pen_openai`, …) to the **request-body key** (`temperature`, `frequency_penalty`, …) —
they differ, and `lock`/`send` need the former while `drop` needs the latter.

## Boundaries

- **Never store the API secret** — only reference ST's profile by id. Our config (the curated
  favorites: profile-id → label + bound snapshot) lives in our own cross-preset storage, so it
  is not bound to one preset and never travels inside a shared preset. (See the
  `never-store-api-keys` decision.)
- **Preset Console stays the snapshot _author_**; this tool only *references* a snapshot by id
  and *binds + switches*. It does not duplicate snapshot editing, and respects the console's
  locked "one preset, disappears on switch" identity by living as a separate, cross-preset tool.
- **Pure core, no ST/DOM** — `params.ts` / `policy.ts` build and check with no browser, same
  risk-first discipline as the other tools. Serializing `excludeBody` into ST's actual
  `custom_exclude_body` string and writing `settings` are the impure gateway's job, confirmed
  against live ST.

## Module layout (`src/features/connection-profiles/`)

```
DESIGN.md         — this spec
favorites.ts      — pure favorites model: Favorite{profileId,label?,snapshotId?} + reconcile/add/
                    remove/update/move; dangling-profile detection (`npm run check:conn-favorites`) ✓
favorites.check.ts— assertions (18 pass)
profiles.ts       — impure edge: listProfiles() + applyProfile(name) via /profile (dual-mount, best-effort) ✓
params.ts         — PARKED: managed-param registry (oai field ↔ request-body key) — unwired
policy.ts         — PARKED: resolveParamApply → drop/lock/send plan (`npm run check:conn-policy`, 20 pass) — unwired
policy.check.ts   — PARKED
                    ── still to come ──
store.ts          — Pinia store: favorites persistence (own cross-preset storage) + apply orchestration
ConnectionProfiles.vue — tool root: curated chip switcher + add/manage (pick from listProfiles), bind snapshot
```

## Open / next

1. **Confirm `/profile <name>` with real names (live):** the names carry spaces, 【】 and even `/`
   (`【claude/gemini】 - …`) — verify the unnamed-arg form switches correctly, else `applyProfile`
   must quote. This is the one fragile bit gating the gateway.
2. **Store + UI + shell:** favorites store (persist in own storage); `ConnectionProfiles.vue` chip
   switcher; add 连接档案 to `ToolId` / `App.vue` / `ToolboxHome`.
3. **Snapshot binding:** apply the bound snapshot after the switch via the console store's
   `applyModeSnapshot` — orchestrated at the **toolbox shell** (the only place that may know both
   tools), preserving the "tools never import each other" boundary.
4. **Param policy decision:** verify whether ST's per-profile preset + `exclude` field already
   cover #1/#2. If yes → delete the parked `params/policy`; if no → wire them as a per-favorite
   override applied *after* `/profile`.
