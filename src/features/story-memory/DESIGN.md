# 故事记忆 (Story Memory) — design spec

> **Status (read first).** The planned **fourth toolbox tool**, beside 预设控制台 / 聊天导出 / 连接档案.
> **Not built yet — this is the plan.** For long-form novelists who co-write inside ST and hit
> context decay: the model loses story hooks, character beats, and continuity once the chat passes
> ~50k tokens, and a single hand-maintained "story state" block can't scale past a few hundred
> messages without dropping detail.
>
> **The decision (mirrors 连接档案's "thin orchestrator" rule): do NOT rebuild a memory engine.**
> ST already has the primitives — World Info **constant (🔵) / selective (🟢) / vectorized (🔗)**
> entries, `@Depth` injection, Vector Storage, `/hide`. Two mature community engines
> (`ST-Bionic-Memory-Ecology`, `SillyTavern-Horae`) already automate extraction + recall *beyond*
> what a from-scratch tool could — but they take editorial control away (auto-extraction decides and
> paraphrases your canon). A novelist who **generates a story bible by command and hand-tunes it**
> does not want their canon rewritten each turn. So this tool is the **thin layer those engines
> don't provide**: it **compiles** the author's tuned bible into ST's blue/green tiers and (optionally)
> runs a **bookkeeper** pass that scaffolds generation — authorship stays with the user.
>
> Sibling specs: `src/features/preset-console/DESIGN.md`, `src/features/chat-export/DESIGN.md`,
> `src/features/connection-profiles/DESIGN.md`.

## The problem

- Story quality (hooks, detail, voice) decays past ~50k tokens (the user keeps chats ≤45k for this
  reason). A growing novel can't keep everything in the window.
- The current manual rig: full text for the last ~5 AI turns → lean per-message summaries back to the
  hide line → **one monolithic regenerated `<story_state>` block** (canon facts, event threads, hooks,
  character + relationship state). At ~600 messages the monolith already drops detail, and the
  always-on token cost grows with history — the math only gets worse.
- Two distinct decays, only one of which trimming addresses: **length** (total tokens) *and*
  **position** ("lost in the middle" — a fact buried mid-prompt is attended to less than the same fact
  near the end). A 10k monolith placed high in the prompt is *under-used* canon you already paid for.

## The decision: blue/green over ST World Info, author-curated

Decompose the monolith into ST's native tiering, keep the author's generate-and-tune control, and let
ST's engine do the injection:

- 🔵 **Spine (constant / always-on, bounded ≤ ~1k tokens).** The anti-drift floor: **invariants**
  (facts that break every scene if forgotten) + **the present** (current scene/arc, who's on stage and
  what they want now, immediate tension, what just happened) + **live hooks** (the 3–5 open threads in
  play *this arc*) + **co-author guardrails / voice**. It is *not* a summary of everything —离场角色 and
  inactive threads stay out (their green entry fires when relevant). It is **derived from green's active
  subset**, so it can't drift from the deep canon. Injected at **low `@Depth`** (near the latest turn)
  to fight position decay.
- 🟢 **Green (selective / depth).** The complete, deep store — **one addressable entry per**
  character / thread / location / relationship / load-bearing fact. Grows freely; loaded only when
  relevant. `character`/`location`/`relationship` fire by **keyword** (name + aliases); `thread`/`fact`
  fire by **vector** (semantic — solves "this beat is *causally* about the unsaid-words thread but
  shares no keywords with it").

This keeps "without cueing it knows what's going on" — but defines that as the **present**, which is
both smaller and more useful than a digest of the whole bible.

## Architecture

```
archivist prompt ── one message ──▶ compiler ──▶ managed ST World Info (🔵 spine + 🟢 entries)
 (author runs + tunes)                  │                       ▲
                                        │                       │ keywords emitted → ST green fires
                                        ▼                       │
                                   thread menu ──▶ bookkeeper (2nd API, optional) ──▶ OOC scaffold (preview, editable)
```

1. **Archivist (generation, author-owned).** The author's existing "story bible" command, revised to a
   **two-tier output contract** (below). Produces one message: a GREEN region of tagged entries + a
   BLUE digest. The tool does **not** auto-extract — the author still generates and tunes.
2. **Compiler (the foundation).** Splits that message into ST World Info entries: spine → constant,
   each tagged unit → a selective entry, keys/positions/budget applied. Re-runs **merge** (don't
   clobber author overrides) — see lifecycle.
3. **Bookkeeper (optional, second API).** A reasoning pass over the current beat that (a) **selects**
   which thread/character entries to surface and (b) **drafts the OOC co-author scaffold** — one call,
   same inputs. It **emits keywords** into a hidden injected line; ST's WI scanner picks them up and
   fires the matching 🟢 entries through the *native* mechanism. Reasoning bridges *causal* relevance
   that vectors (associative) and keywords (literal) miss — the author's #1 pain ("the model doesn't
   connect the dots across threads").
4. **Preview / control.** Parsed entries, activated threads, and the OOC draft render for review +
   edit **before** anything commits — the author stays the author (and malformed generations are
   caught, never silently dropped).

## The split contract — don't parse prose, emit splittable units

Regex-scraping freeform CJK prose + nested bullets is the brittlest possible split target (silent data
loss — the exact failure 聊天导出's preview guards against). Instead the archivist emits **self-delimiting
tagged entries**, so splitting is deterministic parsing:

```
@@ENTRY id=thread-ivy-family type=thread keys=Ivy家庭|母亲|0917|上海
<prose body — the author's tuned format>
@@END
...
@@BLUE
[不变量] … [此刻] … [活跃伏笔]（每条标注 thread id）… [守则]
@@END
```

**Division of labor:** the **LLM owns the semantic tags** (`id`, `type`, `keys` — judgment it's good
at); the **tool owns the WI mechanics** (tier, position, `@Depth`, scan, token budget — deterministic,
the model should never guess). `id` is a **stable slug** — it is the join key for the whole lifecycle.

## Defaults + override (the `type → WI-settings` table)

The model tags `type`; the tool maps each type to default World Info settings, the author overrides:

| type | tier | trigger | default keys |
| --- | --- | --- | --- |
| `character` | green | keyword | name + aliases |
| `relationship` | green | keyword | both names |
| `location` | green | keyword | place name |
| `thread` | green | **vector** | optional boost |
| `fact` | green | vector | optional |
| (BLUE digest) | **constant** | always-on | `@Depth` low, budget ≤ ~1k |

- **Global override:** retune the table (e.g. make all `fact` keyword).
- **Per-entry override:** pin a green entry to constant, edit keys, change depth, exclude. Mirrors the
  preset console's "sane defaults + surgical overrides".
- **Fallback:** if a `type`/`tier` tag is missing, infer from the section the entry came from
  (graceful degradation for un-migrated output).

## Regeneration is a **merge**, not a replace

Splitting runs on every regen; overrides and hand-edits **must survive** or the tool is worthless.
Overrides live in a **layer keyed by `id`**, separate from generated content:

- parse new output → diff against existing entries **by `id`**,
- update generated *content*, **re-apply stored overrides** on top,
- **flag conflicts** where a hand-edit and the new generation disagree (never silently pick one),
- entries absent from new output (resolved threads) → **archived**, not deleted; new ones → added.

## The bookkeeper — constrained, or it becomes a black box

A second-API router is right *here* (causal relevance is a reasoning task), but only with guardrails —
the difference between "smart bookkeeper" and "BME-style opaque brain":

1. **Closed menu.** It selects from existing entry ids/keys; it never invents canon. Output is a
   *selection* (+ the OOC draft), bounded by what the author wrote.
2. **Force scarcity.** Hard-cap "select at most N threads, ranked by relevance to *this* beat" — LLM
   routers default to "include everything", which evaporates the token savings.
3. **Spine is never router-gated.** 🔵 is always-on; the bookkeeper only decides 🟢/depth.
4. **Graceful fallback.** Bookkeeper times out / errors → native keyword + vector scanning still fires.
   It is an *enhancement layer*, never a single point of failure (the 连接档案 resilience instinct).
5. **Visible.** The emitted keyword line + activated entries render in the preview — debuggable, unlike
   a vector black box.

**Costs (accepted, but named):** two sequential LLM calls per turn (use a fast model; consider running
only on user turns, not swipes); the thread **menu** (ids + one-line summaries) rides each bookkeeper
call (cheap per line, but the archivist's thread summaries must stay tight).

## The archivist prompt contract (two-tier)

The author's bible command, revised so its output drops straight into the compiler. Preserves the
原则 (failure-of-memory framing, completeness > brevity in green, belief ≠ fact, non-linear by
thread, no editorializing) and the `<think>` pre-write checklist. Output = **GREEN region** (one
`@@ENTRY … @@END` per unit, with `id` / `type` / `keys`; per-type bodies: character = 渴望 / 回避·隐瞒 /
相信 / 认知, thread = 简述 + 当前悬而未决的点, fact = 承载重量的事实 + 关键台词, …) then **BLUE digest**
(`@@BLUE … @@END`, bounded, derived from the *active* green subset, 活跃伏笔 each carrying its thread
`id`). Resolved threads collapse into a `type=fact` and the thread entry is removed.

## Boundaries

- **Reuse ST, don't rebuild.** World Info (constant/selective/vectorized), `@Depth`, Vector Storage and
  `/hide` are the engine. We compile + steer; ST injects. (Same call as 连接档案.)
- **Author owns canon.** No per-turn auto-extraction. Generate + tune stays the author's; the tool
  splits, wires, and (optionally) steers — and always previews before committing.
- **Spine is the floor.** The bookkeeper never drops 🔵.
- **Never store the API secret.** The optional bookkeeper endpoint is referenced like 连接档案's rigs —
  key by reference, never the value. (See `never-store-api-keys`.)
- **Tools never import each other.** Any cross-tool need (e.g. reusing a snapshot) is shell-orchestrated.
- **Pure core + `*.check.ts` first.** The splitter/parser, the `type→settings` mapper, the merge/diff,
  and the keyword-emit formatter are pure and checkable with no ST/DOM — same risk-first discipline as
  the other tools.

## Module layout (planned, `src/features/story-memory/`)

```
DESIGN.md          — this spec
archivist.ts       — the two-tier prompt template + the GREEN/BLUE output contract (string builder, pure)
parse.ts           — split one archivist message → Entry[] (lenient; reports unparseable, never drops) (pure)
compile.ts         — Entry[] + type→settings defaults + overrides → planned WI entries (pure)
merge.ts           — diff new Entry[] vs existing by id; apply overrides; flag conflicts; archive resolved (pure)
bookkeeper.ts      — build the menu + 2nd-API call → { keys[], ooc }; keyword-emit formatter (pure builder + impure call)
worldinfo.ts       — the impure edge: read/write ST World Info entries + inject the keyword line (dual-mount)
store.ts           — Pinia: entries, overrides, settings table, bookkeeper config; persistence
StoryMemory.vue    — tool root: compile / preview / per-entry override / OOC panel
*.check.ts         — assertions per pure module (repo's no-test-runner convention)
```

## Build order (risk front-loaded)

0. **Archivist contract.** Finalize the two-tier prompt + `@@ENTRY`/`@@BLUE` format. Buildable/checkable
   with no UI (it's a string + a parser). Ships value immediately (better bible output even by hand).
1. **Compiler + preview.** Split → managed World Info (spine constant + green selective) + the
   parse/preview surface (lenient parse, flag unparseable). The foundation; nothing works without entries.
2. **OOC drafter (standalone).** Read the thread menu + spine + recent beat → draft the co-author block.
   High value, low risk, no auto-activation — the author copies/edits. ~80% of the benefit alone.
3. **Merge lifecycle.** Regen → diff-by-id → preserve overrides → flag conflicts → archive resolved.
4. **Bookkeeper auto-activation.** The keyword-emit → green-fire loop + the visible preview. Last and
   optional — only if native keyword+vector recall demonstrably misses.

## Open questions

- `relationship` as its own entry vs folded into both `character` dossiers (default: separate — cleaner
  for the bookkeeper to cite, but doubles entry count).
- BLUE as one atomic always-on entry (regenerated wholesale; simplest) vs per-line ids (hand-pinnable;
  more bookkeeping). Default: atomic.
- Whether the OOC drafter and bookkeeper share one endpoint config or are independently switchable.
- Per-card vs global memory keying (a multi-novel author) — likely per-card from the start, unlike the
  other tools' global last-used.

## Reference (extensions reviewed, 2026-06)

- **ST-Bionic-Memory-Ecology** — an LLM-extraction **memory graph** (typed nodes + vectors, 多层混合召回
  with graph diffusion + DPP + rerank, POV layering, 总结折叠, rollback safety). Genuinely strongest at
  "connecting the dots" (graph diffusion), but a black box that paraphrases canon and wrests editorial
  control — overkill for an author who curates. Rejected as the base; its *graph-diffusion* idea informs
  why we add a reasoning bookkeeper rather than rely on vectors alone.
- **SillyTavern-Horae** — structured timeline + agenda (auto plot-promise tracking) + change-driven
  output + local Web-Worker vectors + RPG modules. Closer fit (agenda ≈ our live hooks, change-driven ≈
  lean output), and more legible — but its auto-authoring still replaces the tune step the author values.
  Borrowed conceptually (agenda → hooks), not adopted.
