# Chat Export (聊天导出 · EPUB) — design spec

> **Status / handoff (read first)** A second feature in the `preset_control` repo, shipped as a **toolbox**:
> the same floating trigger now opens a **launcher** from which the user picks a tool — the existing
> 预设控制台 (preset console) or this **聊天导出** (chat → EPUB) exporter. The exporter is a self-contained
> module under `src/features/chat-export/`; nothing in `src/features/preset-console/` depends on it.
>
> Sibling spec: `src/features/preset-console/DESIGN.md` (preset console — source of truth for that tool).
>
> **UI uses the shared design library (`@/ui/*`), 2026-06-19.** The exporter is still self-contained for its *logic*,
> but its **UI composes the shared primitives** in `src/shared/ui/` — `Button`, `IconButton`, `Segmented`, `TextField`,
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
> - **② 规则.** A collapsible **扫描** scanner on top, then **包含内容** and **排除内容** `Section`s.
>   **包含内容** = message inclusion (用户/隐藏楼层), optional role-change divider, optional floor range (start/end) for large chats, and two destination rule rows — **标题** then **正文** — each a
>   reusable `RuleField.vue` (labelled add-row + chips below). **排除内容** = strip presets (think/OOC/HTML 注释) + custom
>   exclude rules (one `RuleField`). The scanner lists chat tags (capped, scrollable, multi-select; batch bar reuses the
>   row's `Segmented`) and routes each to **不处理 / 排除 / 包含**. A rule lives in **one destination only** (排除 /
>   正文 / 标题), enforced by `pinRule` (cross-clears the other two) and `setTagBucket`. Rows + a **全选** master use the
>   shared `SelectMark` (on/off/partial), mirroring the preset console; the header swaps the **全选** row for the batch
>   `Segmented` once tags are selected (no layout shift). A footer **清除规则** text action wipes every routed tag/rule on the page
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
>   taking the place of 下一步. ④ book info supports an optional uploaded cover; the image is resized through canvas and embedded as `OEBPS/cover.jpg` to avoid unbounded EPUB size. ③ shows **清理后 above 原文** (result first); the 原文 pane header is card name (+ 隐藏
>   badge) left, a **bot / user role icon** right, and a number field in the nav jumps straight to any message.
>   ③ also surfaces **health flags** (`previewFlags`, derived from a single `messageDiags` scan): how many messages go
>   **empty** after the rules (silently dropped from the book) and how many assistant turns **未匹配** the 正文/标题
>   rules (fell back to whole text). The two kinds are **separate by severity** — empty (silent data loss) is the
>   serious one (danger glyph + left rule), 未匹配 is informational (muted). Each banner row has a **→ arrow** that
>   scopes the nav to *just* that kind. The nav scope is a **`Dropdown`** (reused from the design library) — 全部 / 仅 AI
>   / 清理后为空 (N) / 未匹配 (N), the two flag scopes appearing only when they have instances — so the existing prev/next
>   walk covers all instances of one kind without round-trips. Clearing a scope's instances via rule edits auto-falls
>   back to 全部. The focused 清理后 pane shows a per-message **空** / **未匹配** badge.
> - **Jump-to-ST (2026-06-20).** Some flags can't be fixed by a rule (a one-off garbled message) — so a ghost **在 ST
>   中定位** footer button on ③ (active-chat source only; a `.jsonl` import has no live message) locates the focused
>   message in SillyTavern for hand-editing. `NormMessage.srcIndex` carries the **source array position** (== ST `mesid`
>   for the active source) through normalize, surviving the range slice. `jumpToStMessage` resolves ST's document
>   (native = our own `document`; iframe = `parent.document`) and scrolls/flashes `.mes[mesid=N]`. **ST collapses older
>   messages behind a "Show more messages" button**, so a target above it isn't in the DOM; auto-expanding proved
>   unreliable (rapid clicks ignored mid-load; the wait loop hung), so we **don't auto-expand** — jump if rendered, else
>   show a `jumpError` asking the user to expand earlier messages first. The 清理后 header shows the message's **floor
>   number** (`#srcIndex`) so they know how far to expand.
> - **Rule scope.** 排除 applies to **every** message; 正文/标题 apply to **assistant** turns only (`extractMessage`).
>   Body tags (`正文`/`body`/`content`/`text`) and unnamed matches become the chapter **body**; other tags / named
>   regex groups (e.g. `(?<title>…)`) become labelled **fields** (chapter metadata like title).
>
> **排版样式 — typography presets + advanced CSS/regex (2026-06-20).** ④ 导出 gains a **排版样式** `Section` that
> styles the EPUB/HTML body. Tiered by audience (the toolbox's users mostly don't code):
> - **Tier 1 — presets (surfaced first).** A short list of one-click toggles, each carrying built-in regex→`<span class>`
>   rules and/or a block transform **plus** its CSS, wired under the hood so the user never writes either. Shipped
>   presets (`STYLE_PRESETS` in `style.ts`): **加粗对话** (`"…"`/`「…」`/`“…”`/`«…»` → `.st-dialogue` bold); **Markdown
>   标记** — a single toggle rendering `**粗**`→`.st-b`, `*斜*`/`_斜_`→`.st-i`, `***粗斜***`→`.st-bi`, `~~删~~`→`.st-del`
>   (markers dropped) and block-level `>`/`>>` **blockquotes** (clean left-rule, not the heavy gray box), folding in the
>   old 星号转倾斜; **段首下沉首字** (CSS-only `::first-letter` drop cap, no rule). A preset can carry multiple ordered
>   rules; presets resolve in **registry order** (not toggle order) so `***`→`**`→`*` nest correctly regardless of which
>   the user enabled first. (The `_…_` rule uses lookbehind; on a browser lacking it `parseRegex` returns null and that
>   one rule is silently skipped — the rest still apply.)
> - **Tier 2 — advanced (collapsed `高级` disclosure).** The raw escape hatch: custom **匹配 → 类名** rule rows (a
>   two-field add-row; pattern is a tag or `/regex/flags`, class name is sanitized to `[A-Za-z0-9_-]`) + a free **自定义
>   CSS** textarea appended to the stylesheet. So a power user can ship a class we didn't, but everyone else just checks
>   boxes.
> - **Engine (`style.ts`, pure + `style.check.ts`).** `StyleConfig { presets[]; rules[]; css }`. `resolveStyleRules`
>   compiles enabled presets' rules + custom rules into `ResolvedRule { re, className }` (skips invalid regex, never
>   throws); `styleRenderOptions` reports block transforms (`{ blockquote }`); `buildStyleCss` concatenates
>   enabled-preset CSS + custom CSS (appended to `BOOK_CSS`). The **decoration** lives in `render.ts`
>   (`bodyToParagraphs(body, rules, opts)` → per-paragraph `decorateInline`, plus `renderBlockquote` for `>`/`>>` blocks)
>   to avoid a render↔style cycle: a **tokenizer** escapes unmatched text and wraps each match's group-1 (else whole
>   match) in `<span class="cls">`, never re-matching inside an already-wrapped span (non-overlapping, rule-order
>   priority). The only HTML ever emitted is our own `<span class>`/`<blockquote>`/`<hr>` around **escaped** content — no
>   user HTML injection — so output stays valid XHTML (the `xmllint`/缺层 guard the reference script lacks). `txt.ts`
>   ignores styling (plain text).
> - **Dark-mode caveat.** Presets default to `font-weight`/`font-style` (theme-safe); hardcoded `color` can vanish in a
>   reader's night theme, so colored styling is left to the advanced CSS field, not a default preset.
> - **Divider markers → `<hr>`.** A standalone paragraph that is only a divider marker (`---` / `***` / `- - -` /
>   `* * *`) now renders as `<hr class="cex-divider">` (theme-safe CSS: `border-top` + `opacity`, so it follows the
>   reader's text color in light/dark). This fixes the 角色分隔线 toggle, which previously emitted a literal `<p>---</p>`,
>   and also catches hand-typed scene breaks (closes the earlier deferred block-level scene-break item). TXT keeps the
>   literal marker.
> - **Rendered preview (④).** The selected-chapter preview is a **WYSIWYG `<iframe srcdoc sandbox>`** that ships the
>   exact EPUB XHTML + stylesheet (`BOOK_CSS` + `buildStyleCss`), so the book's bare-element CSS (`body`/`p`/`.chapter`)
>   is fully isolated from the panel and users see dialogue/italics/drop cap/dividers as they'll export. It's a browser
>   approximation of a reader (a one-line hint says so), but the real markup + CSS. `sandbox=""` blocks scripts (our
>   content has none). ③ keeps its plain before/after text comparison.
> - **Deferred:** Markdown rendering — a separate, larger follow-up (needs a conservative MD parser).

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
| Extraction (two buckets) | Two operations, each fed by a **tag shorthand** (`正文`, `<think>`) or a **regex** (`/pat/flags`): **排除** removes matched spans from *every* message (built-in `<think>` / OOC / HTML-comment `<!-- -->` presets + custom rules); **提取正文** keeps only matched content as the body, on **assistant** turns only (user turns come through raw). Tag `正文`/`body` → body; other tags or named groups → fields (`title`, …). No include rule ⇒ whole message is the body. Order is **exclude → include**. A **扫描标签** button lists every *balanced* tag in the chat (CJK + attribute-tolerant, sorted by frequency) → click 排除/提取 to add it to a bucket. |
| Chapter split | A **chapter-trigger** marker/regex starts a new chapter; the title is built from the mapped capture(s). Auto chapter numbering (`第N章`) as a fallback/option. |
| Book metadata | User edits **title** (default = card/chat name), **author** (default = character name), **language** (default `zh`). `identifier` (UUID) is auto. Cover / date / description **deferred to v2**. |
| Preview | **Before/after** pane on the first N messages — the heart of the UX, and the one thing the reference script lacks. A bad regex must **block export** (no broken file), not silently produce empty chapters. |
| Output | **EPUB** via a **dependency-free store-method ZIP writer** (`epub.ts` — no JSZip; `mimetype` stored first, then `META-INF/container.xml`, `OEBPS/content.opf`, `toc.ncx`, `nav.xhtml`, `style.css`, per-chapter XHTML). **TXT** as a cheap second target. Validated end-to-end with `unzip`/`xmllint`; open in Apple Books + Calibre. |
| Config store | Rule set (strip toggles, exclude/include rules, chapter rule) persists to **localStorage** under one `cexRules` key (last-used). Per-card/chat keying + book-meta persistence is a refinement. |
| Bundling | **Single `index.js`** — no extra deps (the store-ZIP writer kept JSZip out). Module boundary stays clean for a future lazy-split. |
| Typography | **Tiered styling on ④** (see 2026-06-20 log): a shortlist of one-click **presets** (each a built-in regex→`<span class>` + CSS) surfaced first; a collapsed **高级** disclosure holds custom 匹配→类名 rules + a free CSS textarea. Engine in `style.ts` (pure); decoration in `render.ts` only emits our own `<span class>` around escaped text (no user HTML), so output stays valid XHTML. TXT is unstyled. |

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

## Module layout (`src/features/chat-export/`)

```
DESIGN.md           — this spec
chat-source.ts      — the impure edge: read active chat / parse dropped .jsonl → RawMessage[]
                      (one gateway, mirrors preset-io's pattern; active-swipe only)
normalize.ts        — RawMessage[] → NormMessage { index, role, name, content }  (pure)
extract.ts          — strip toggles + named-group regex → mapped fields; regex validation (pure)
chapters.ts         — chapter-trigger split → Chapter { title, meta, html }      (pure)
epub.ts             — Chapter[] + BookMeta → Blob (JSZip)        ;  txt.ts — Chapter[] → string
style.ts            — typography model: StyleConfig, STYLE_PRESETS, resolveStyleRules, buildStyleCss (pure)
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
