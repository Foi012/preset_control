# Chat Export (聊天导出 · EPUB) — design spec

> **Status / handoff (read first)** A second feature in the `preset_control` repo, shipped as a **toolbox**:
> the same floating trigger now opens a **launcher** from which the user picks a tool — the existing
> 预设控制台 (preset console) or this **聊天导出** (chat → EPUB) exporter. The exporter is a self-contained
> module under `src/chat-export/`; nothing in `src/preset-easy-toggle/` depends on it.
>
> Sibling spec: `src/preset-easy-toggle/DESIGN.md` (preset console — source of truth for that tool).
>
> **UI uses the shared design library (`@/ui/*`), 2026-06-19.** The exporter is still self-contained for its *logic*,
> but its **UI composes the shared primitives** in `src/ui/` — `Button`, `IconButton`, `Segmented`, `TextField`,
> `Dropdown`, `Section`, `PetIcon` — and the `--pet-*` tokens, so it matches the preset console (the canonical UI
> reference). No bespoke buttons/inputs/selects live in `ChatExport.vue`; the remaining `.cex__*` classes are layout +
> feature-specific bits (stepper, drop zone, diff panes, chips, scan list) only. When adding UI, reach for `@/ui/*` first.
>
> **Wizard frame + step UX (2026-06-19).** The tool is a 4-step wizard: **来源 → 规则 → 预览 → 导出**.
> - **Frame.** `.cex` is a flex column: a fixed **stepper** on top, a scrolling middle (`.cex__scroll`), and a fixed
>   **Back / Next** footer (`.cex__nav`) — so navigation stays put regardless of content length. Steps are also
>   clickable directly. 规则/预览/导出 are gated on a chat being loaded; emptying the result snaps back to 来源.
> - **Stepper.** Each step stacks a **progress bar on top** of a `circle + label`; the bars form the rail. Three
>   states: **default** (light bar, muted circle + number), **active** (accent bar + accent circle), **done** (strong
>   bar + ✓). "Done" = a reachable step before the active one (`stepDone()`).
> - **① 来源.** A hero drop zone (drag `.jsonl`, or 读取当前聊天 / 导入 buttons) with a `sourceState` machine —
>   **idle / loading / success / error** — driving the zone icon, border tint, and a status line.
> - **② 规则.** A non-collapsible **扫描标签** scanner on top, then **包含内容** and **排除内容** `Section`s.
>   **包含内容** = message inclusion (用户/隐藏楼层) + two destination rule rows — **正文** and **标题** — each a
>   reusable `RuleField.vue` (labelled add-row + chips below). **排除内容** = strip presets (think/OOC) + custom
>   exclude rules (one `RuleField`). The scanner lists chat tags (capped, scrollable, multi-select; batch bar reuses the
>   row's `Segmented`) and routes each to **不处理 / 排除 / 包含**. A rule lives in **one destination only** (排除 /
>   正文 / 标题), enforced by `pinRule` (cross-clears the other two) and `setTagBucket`. Rows + a **全选** master use the
>   shared `SelectMark` (on/off/partial), mirroring the preset console; the header swaps the **全选** row for the batch
>   `Segmented` once tags are selected (no layout shift). A **清除** badge button wipes every routed tag/rule on the page
>   (`clearAllRules`). `SelectMark` was promoted from `preset-easy-toggle/components` to **`@/ui`** so chat-export reuses
>   it without depending on the preset module (keeps the boundary clean).
>   **Vocabulary** (drops the old 提取 collision): **正文** (body) · **标题** (title) · **排除** (exclude) · **不处理**.
>   To repurpose a span as the chapter title the user adds its tag/regex to the **标题** row → `config.title` →
>   `fields.title` (`extract.ts`); the title-only match still counts as `matched`.
> - **Preview height.** ③'s two panes use a **fixed height** (`.cex__panebody`, 160px) so flipping between a short user
>   turn and a long AI turn doesn't resize the page; overflow scrolls inside each pane.
> - **Width.** The panel is fixed-narrow (`min(385px, viewport−8)`, `native.ts`) — effectively always mobile width —
>   so layout relies on the fluid `@/ui` primitives + `min-width:0`/truncation rather than `@media` breakpoints.
> - **Step chrome.** ②③④ open with the same `.cex__title` + `.cex__lead` header as ①; their `Section`s use
>   `size="sm"` (Section's nested variant — `sm` title) so they sit clearly **under** the step title, not competing.
>   ④ groups 书籍信息 / 章节切分 in `Section`s; each 章节切分 option carries a one-line `hint` (e.g. per-assistant folds
>   user turns into the AI chapter). The **导出 EPUB / TXT** actions live in the fixed footer (`.cex__nav`) on ④,
>   taking the place of 下一步. ③ shows **清理后 above 原文** (result first); the 原文 pane header is card name (+ 隐藏
>   badge) left, a **bot / user role icon** right, and a number field in the nav jumps straight to any message.
> - **Rule scope.** 排除 applies to **every** message; 正文/标题 apply to **assistant** turns only (`extractMessage`).
>   Body tags (`正文`/`body`/`content`/`text`) and unnamed matches become the chapter **body**; other tags / named
>   regex groups (e.g. `(?<title>…)`) become labelled **fields** (chapter metadata like title).

## Why this lives here (toolbox decision)

The exporter could have been a standalone local web page (the original plan) or a separate ST extension.
We chose **one install, one trigger, pick-a-feature** so users don't download/manage two things. Accepted
tradeoffs: shared release cadence and a single bundle. We neutralise the bundle concern by keeping the
exporter a **self-contained module** behind a clean boundary so it can be lazy-split later if the bundle
grows; for now it ships in the single `index.js` (see _Bundling_).

## Locked decisions

| # | Decision |
| --- | --- |
| Runtime | **Inside ST**, in the same floating panel as the preset console. Not a standalone page. |
| Toolbox | One trigger → **launcher** (`ToolboxHome`) → tool. `useUiStore.activeTool` ∈ `home \| preset \| export`, **persisted** so a refresh reopens the last tool. |
| Input — swipe | **Active swipe only.** Each message contributes its active/selected swipe; we never walk the full swipe array or merge alternatives. |
| Hidden vs system | ST overloads `is_system`: it's `true` for both `/hide`-d **real turns** *and* genuine system messages (`/sys` narrator, `/comment`). They're split by **`extra.type`** (set only on app-generated system messages). Three independent filters: include user (default **on**), include **hidden** turns (default **on** — usually hidden for token cost, still wanted in the book), include **system/narrator** (default **off** — noise). A hidden assistant turn keeps role `assistant` + a `hidden` flag. |
| Export range | Planned control (Phase 2/3): let the user pick a floor range (e.g. 2–40) so big chats aren't all-or-nothing — also the answer to "600 messages without overwhelming": count + capped preview now, range selector later. |
| Input — source | A **source chooser**: (1) **active chat** (in-ST, zero-friction — v1 primary), (2) **drop a `.jsonl`** (v1). (3) **browse locally saved chats** — *deferred* (needs ST's chat-file-list API; more surface). All sources feed one normalizer. |
| Extraction (two buckets) | Two operations, each fed by a **tag shorthand** (`正文`, `<think>`) or a **regex** (`/pat/flags`): **排除** removes matched spans from *every* message (built-in `<think>`/OOC presets + custom rules); **提取正文** keeps only matched content as the body, on **assistant** turns only (user turns come through raw). Tag `正文`/`body` → body; other tags or named groups → fields (`title`, …). No include rule ⇒ whole message is the body. Order is **exclude → include**. A **扫描标签** button lists every *balanced* tag in the chat (CJK + attribute-tolerant, sorted by frequency) → click 排除/提取 to add it to a bucket. |
| Chapter split | A **chapter-trigger** marker/regex starts a new chapter; the title is built from the mapped capture(s). Auto chapter numbering (`第N章`) as a fallback/option. |
| Book metadata | User edits **title** (default = card/chat name), **author** (default = character name), **language** (default `zh`). `identifier` (UUID) is auto. Cover / date / description **deferred to v2**. |
| Preview | **Before/after** pane on the first N messages — the heart of the UX, and the one thing the reference script lacks. A bad regex must **block export** (no broken file), not silently produce empty chapters. |
| Output | **EPUB** via a **dependency-free store-method ZIP writer** (`epub.ts` — no JSZip; `mimetype` stored first, then `META-INF/container.xml`, `OEBPS/content.opf`, `toc.ncx`, `nav.xhtml`, `style.css`, per-chapter XHTML). **TXT** as a cheap second target. Validated end-to-end with `unzip`/`xmllint`; open in Apple Books + Calibre. |
| Config store | Rule set (strip toggles, exclude/include rules, chapter rule) persists to **localStorage** under one `cexRules` key (last-used). Per-card/chat keying + book-meta persistence is a refinement. |
| Bundling | **Single `index.js`** — no extra deps (the store-ZIP writer kept JSZip out). Module boundary stays clean for a future lazy-split. |

## EPUB anatomy (what an EPUB actually needs)

Minimum viable EPUB the exporter assembles:

```
mimetype                         (stored, uncompressed, first entry: "application/epub+zip")
META-INF/container.xml           (points at content.opf)
OEBPS/content.opf                (metadata + manifest + spine)
OEBPS/toc.ncx                    (EPUB2 nav; chapter list)
OEBPS/nav.xhtml                  (EPUB3 nav — optional but cheap)
OEBPS/style.css                  (conservative subset)
OEBPS/chap-0001.xhtml ...        (one XHTML per chapter: <h1>title</h1> + body)
```

Required OPF metadata: `dc:title`, `dc:identifier` (UUID), `dc:language`. Recommended: `dc:creator`
(author). Everything else (cover, date, description) is optional and deferred. **User-facing knobs are only
title / author / language + the per-chapter regex mapping**; the rest is generated.

## Module layout (`src/chat-export/`)

```
DESIGN.md           — this spec
chat-source.ts      — the impure edge: read active chat / parse dropped .jsonl → RawMessage[]
                      (one gateway, mirrors preset-io's pattern; active-swipe only)
normalize.ts        — RawMessage[] → NormMessage { index, role, name, content }  (pure)
extract.ts          — strip toggles + named-group regex → mapped fields; regex validation (pure)
chapters.ts         — chapter-trigger split → Chapter { title, meta, html }      (pure)
epub.ts             — Chapter[] + BookMeta → Blob (JSZip)        ;  txt.ts — Chapter[] → string
store.ts            — Pinia store for export config + derived preview (per-card localStorage)
ChatExport.vue      — the tool root (source → config → preview → export), mounted by the shell
components/         — source picker, regex/mapping form, preview pane, export bar
*.check.ts          — assertion scripts per pure module (matches the repo's no-test-runner convention)
```

The pure core (`normalize` / `extract` / `chapters` / `epub` / `txt`) is buildable and checkable with no
ST or DOM, so Phase 1–2 risk is validated before any UI — same risk-first ordering as the preset console.

## Build order (risk front-loaded)

0. **Toolbox shell.** `App.vue` becomes a shell: trigger → panel with header `[⌂/back · tool title · theme · close]`
   and a swappable body (`ToolboxHome` / `PresetConsole` / `ChatExport`). Today's panel content moves verbatim into
   `PresetConsole.vue`; the preset-specific gear menu (导入/导出/同步 config) goes with it. `useUiStore.activeTool`
   persisted. **Ships on its own, verifiable before any exporter code.**
1. **Source + normalize.** Read active chat (active swipe) + `.jsonl` drop → `NormMessage[]`. Validate on real chats.
2. **Strip + extract/map.** Strip toggles (reasoning / OOC / think-tags), named-group regex → fields, regex validation.
3. **Preview pane.** Before/after on first N messages. Block export on bad regex.
4. **Chapters + HTML (done).** `chapters.ts` boundary rules (每条 AI 回复 / 每条消息 / 按 title 标记 / 每 N 条), auto `第N章` titles, captured fields → chapter meta. `render.ts` semantic XHTML + conservative CSS + EPUB3 nav. Book metadata (title/author/language). **TXT export shipped here** (`txt.ts`). The ④ 导出 step shows book setup + chapter rule + chapter-list preview.
5. **EPUB packaging (done).** `epub.ts` — dependency-free store-method ZIP (CRC32 + OCF layout), `buildEpub(chapters, meta)` → `.epub`; `unzip`/`xmllint`-validated. 导出 EPUB + 导出 TXT buttons wired. Rule set persisted to localStorage (`cexRules`). **All phases 0–5 complete.**

## Reference (attribution)

Modelled on the community 酒馆助手 script **聊天记录导出 v6.0.9** (chain: Yellows → 429639 → Lune), which proves
the in-ST JSONL → tag/regex extract → JSZip-EPUB pipeline works. We re-implement; if any of its regex/EPUB code is
lifted verbatim, sort out attribution/licensing first. It runs as a TavernHelper jQuery script and lacks a real
before/after preview — the two main places we diverge.

## Pitfalls being watched

- **Dual mount paths.** The chat read must work in both the iframe (`index.ts`, TavernHelper APIs) and native
  (`native.ts`, `SillyTavern.getContext()`) entries — abstract it behind one gateway like `preset-io`.
- **localStorage in the srcdoc iframe** may be opaque-origin; persistence falls back to in-memory (and/or the
  same global-var mechanism the theme uses) with a try/catch.
- **Regex UX.** Users paste patterns that don't quite work; give explicit before/after feedback and block export
  rather than emit empty chapters.
- **Reader CSS variance.** Keep CSS to a conservative subset; one reader will ignore something — validate in ≥2.
