# Preset Easy Toggle — design spec

> **Status / handoff (read first)** A Tavern Helper _script_ project (TS, bundled by this repo's webpack). All work
> lives in this folder: `src/preset-easy-toggle/`.
>
> **Files**
>
> - `DESIGN.md` — this spec (locked decisions, parsing rules, data model). Source of truth.
> - `tokens.ts` — design-token SSOT → `--pet-*` CSS vars via `emitCssVars()`. Visuals deferred.
> - `types.ts` — parser + resolved-view types.
> - `parser.ts` — **done.** Pure: `prompts[] → sections[] + allEntries[]` (region slice, full-preset selectable catalog,
>   entry flags, rule guess).
> - `config.ts` — **done.** Pure: read/validate the `[⚙️CONSOLE-CONFIG]` JSON (zod) and `resolveView(parse, config)` →
>   one merged structure the UI renders.
> - `preset-io.ts` — **done.** The one impure layer, all ST calls behind `PresetGateway` (`tavernGateway()` real impl).
>   `loadView` (read→parse→resolve), `setEntriesEnabled`, `setEntryContent`, `saveConfig` (upserts the config entry
>   before START), `createAutoSaver` (debounced disk persist via `replacePreset(getLoadedPresetName(), …)`).
> - `store.ts` — **done.** Pinia `useConsoleStore` holds both `ResolvedView` _and_ the raw `Config`; in-use mutations
>   (`toggleEntry`, `toggleFolder`, `setInputValue`) and edit mutations (`setGroupRule`, `setGroupRequired`,
>   `nudgeGroup`/`outdentGroup`/`placeGroup`, `toggleGroupPinned/Hidden`, `toggleEntryHidden/Input/AlwaysOn`, batch
>   assignment/hide/input/alwaysOn, and Modes/Snapshots — `saveScenario`/`saveModeSnapshot`/`updateModeSnapshot`/
>   `applyModeSnapshot`/`renameModeSnapshot`/`deleteModeSnapshot`/`addGroupsToMode`/`removeGroupsFromMode`/
>   `removeGroupFromMode`/`nudgeModeGroup`/`setModeGroupParent`/`renameScenario`/`deleteScenario`) all route
>   through preset-io → re-read → autosave. In-use rendering + toggle semantics read `inUseSections()` (the active mode's
>   tree via `modeSections`, else the global one); `必开` groups are auto-filled on load via `enforceRequired`. Edit ops
>   `commitConfig` via `saveConfig`; `ensureHeaderGroup` materializes header overrides only when needed. `useUiStore`
>   (open, mode, theme, `activeModeId`, `editContextId`); pure helpers `affordanceOf` / `inputValueOf` /
>   `folderState` / `buildOnSelections` / `immediateUnits` exported here.
> - `index.ts` — **done.** Script entry: mounts the Vue app into an isolated, resizing `srcdoc` iframe. Closed trigger
>   is draggable and persists its viewport position in global variables; open panel clamps to the viewport. Injects
>   `emitCssVars()` + `teleportStyle`, re-reads on `OAI_PRESET_CHANGED_AFTER` / `SETTINGS_UPDATED`. Lifecycle in
>   `$(()=>…)` / `pagehide`.
> - `App.vue` + `components/{Trigger,InUseView,SectionCard,EntryRow,ModeBar}.vue` — **done.** In-use view:
>   readability-first **tile grid** of entries under flat (boxless) group headers; rule-aware affordances
>   (radio/checkbox/locked/input textarea); a master toggle per group; a `ModeBar` chooser (全部 + mode chips) that
>   scopes/arranges the view to the active mode. See the dated logs for the current visual language (it intentionally
>   diverges from edit mode).
> - `components/{EditView,EditContextBar,EditGroupCard,EditFolderNav,ModeArrange,PetIcon}.vue` — **done.** Edit view is
>   **one surface contextualized by a chip strip** (`EditContextBar`: 结构 + a chip per mode + ＋; `ui.editContextId`,
>   null = 结构). 结构 = custom grouping with a full-preset catalog, an edit-only `未整理` group, group rename, rule
>   (`单选/多选`), requiredness (`必开/可选`), pin, hide-group, delete, per-entry 常驻/hide toggles, always-visible entry
>   checkboxes, the side-nav (`EditFolderNav`) for reorder/nest/outdent, and a floating batch toolbar (select all/count,
>   add group, 常驻/hide/input toggles, move to group). A mode chip = `ModeArrange`, a **read-only mirror of 结构**: the
>   same `EditFolderNav` side-nav (mode-aware via a `modeId` prop → per-mode reorder/nest/drag) and the same
>   `EditGroupCard` `mode` variant (group header + **read-only entry list**, no entry/group editing, just a 移出此模式
>   action); groups join via a 可添加分组 staging card styled like 未整理. Snapshot save/apply/update/rename/delete lives
>   only in in-use. Buttons use local SVG icons rather than emoji glyphs. Mode tabs + sync button in the panel bar.
> - `__fixtures__/preset.json` — trimmed real preset, TavernHelper `getPreset` shape.
> - `*.check.ts` — assertion scripts (no test runner), one per pure/impure module. Run:
>   `npx ts-node --transpile-only -P tsconfig.novelizer.json src/preset-easy-toggle/<file>.check.ts` (counts change as
>   assertions are added). Build one entry with `BUILD_ENTRY=preset-easy-toggle pnpm build:dev` →
>   `dist/preset-easy-toggle/index.js` (the unrelated `pyq-creater` entry is pre-broken; ignore it).
>
> **Build order** (see end of file): 1 parser ✓ · 2 config ✓ · 3 preset I/O ✓ · 4 mount shell + trigger ✓ · 5 in-use
> view ✓ · 6 edit view ✓ · 7 custom grouping ✓ (virtual overlay).
>
> **Mode snapshots refactor (2026-06-15):** Modes are now **scope/layout only**. Clicking a mode chip changes which
> groups are shown/arranged but no longer mutates prompt switches. Saved ON/OFF combinations are explicit **Snapshots**
> inside each mode (`snapshots[]`); applying a snapshot is the only mode-related action that calls
> `setEntriesEnabled`. Old configs with `scenario.selections` and no `snapshots` surface a compatibility `默认` snapshot
> until the user creates explicit snapshots. In-use keeps snapshot **save** as a disk icon beside the page power button;
> retrieval lives in a left side-nav toggled by the same menu icon pattern as edit mode. Snapshot nav rows apply on
> click and show rename/update/delete icon buttons on hover; rename is entered via the edit icon so applying and naming
> do not compete for the same click target. Mode edit (`ModeArrange`) does not show snapshot controls; it remains layout
> and group membership only.
> Auto-applying a default/last-used snapshot on mode click is intentionally deferred.
>
> **Snapshot capture + reload guard fix (2026-06-15):** Snapshot capture now records every entry controlled by scoped
> groups, including child entries when a parent/nested group is in the mode scope. This prevents collapsed group summaries
> from reading as `未选择` while the opened child group contains selected entries. Snapshot update is a true overwrite of
> current scoped switches; mode membership edits still preserve prior saved values for already-captured entries. Snapshot
> apply filters out entries that are already in the desired state, so re-applying the active snapshot does not perform a
> redundant ST preset write. `OAI_PRESET_CHANGED_AFTER` now routes through the same debounced `externalReload()` guard as
> `SETTINGS_UPDATED`, so our own snapshot/preset writes do not trigger an immediate unguarded full reload/enforcement
> pass after the panel closes.
>
> **Config entries hidden from ST's prompt manager — stored as `prompts_unused` (2026-06-15):** The
> `[⚙️CONSOLE-CONFIG]` + `[⚙️CONSOLE-CONFIG-BACKUP]` entries were being written into the preset's **placed** prompt list
> (`prompts`), so they showed up as (disabled) rows in SillyTavern's own prompt manager — confusing clutter. A preset
> actually carries two lists: `prompts` (placed → shown in the manager) and **`prompts_unused`** (exists in the preset,
> travels with export/import, but is **not placed and not shown**). Config is pure storage that never injects, so it now
> lives in `prompts_unused`. Changes: `PresetGateway.read()` returns `{ prompts, promptsUnused }` and `mutate` edits both;
> `saveConfig` writes config+backup into `promptsUnused` and strips any stale copies from `prompts`; the config readers
> search both lists (`configSearchList`, unplaced preferred) so old presets still load. **Migration:** `store.load()` calls
> `needsConfigMigration(gateway)` and, if a config/backup entry is still in the placed list, runs `commitConfig()` once to
> move it — so existing presets clean up on next open without needing an edit (skipped when config is `corrupt`, reusing
> `commitConfig`'s guard). The check harnesses model the two-list shape (`getPreset` returns `prompts_unused`,
> `updatePresetWith` preserves it) and cover both the new storage location and the placed→unplaced migration. (This also
> sets up the native-extension port nicely — ST can store arbitrary JSON in a preset's settings, an even cleaner home than
> a fake prompt, but `prompts_unused` already removes the visible-clutter problem under Tavern Helper.)
>
> **Config durability — backup entry + corruption guard (2026-06-15):** The entire overlay (groups, modes, snapshots)
> lives in one `[⚙️CONSOLE-CONFIG]` JSON blob, so a corrupt/truncated entry was previously unrecoverable *and*
> self-destructive: `readConfig` fell back to `defaultConfig()`, then the next edit overwrote the only copy with defaults.
> Now: (1) every successful `saveConfig` mirrors the JSON into a second disabled entry `[⚙️CONSOLE-CONFIG-BACKUP]`
> (written first so the primary stays adjacent to the region start; both excluded by the parser). (2) `readConfigSafe`
> returns `{config, status}` where status ∈ `fresh|ok|recovered|corrupt`: a missing/corrupt primary transparently
> recovers from the backup (`recovered`); only if both are unusable does it report `corrupt`. (3) The store tracks
> `configStatus`; when `corrupt` it **refuses `commitConfig`** (so an edit can't overwrite the recoverable raw JSON),
> shows a persistent red banner in `App.vue`, and toasts once. `recovered` toasts once and the next save self-heals the
> primary. Note this also makes an *older* script version safely refuse to overwrite a *newer* (unparseable) config
> rather than clobbering it — schema bumps are fail-safe by construction. Switching presets is unaffected and fully
> reversible: the config rides inside each preset, so switching away shows the other preset's config (or none) and
> switching back restores the overlay; only an id-regenerating preset *rebuild* breaks the binding.
>
> **Mobile responsiveness (2026-06-15):** `openSize()` caps the panel width to `viewport − 8px` (was a hardcoded
> 385px), so on phones the fixed iframe no longer spills past the screen edge and forces the host page to scroll
> horizontally. A session-only `useUiStore.compact` flag is driven from the **host** viewport in `index.ts`
> (`< COMPACT_MAX_WIDTH` = 480, set on init + debounced resize) — the iframe itself only sees the panel width, so the
> store needs the real screen width. In compact mode the two side navs (snapshot nav in `InUseView`, structure nav
> `EditFolderNav` in `EditView`/`ModeArrange`) render as **floating drawers over a scrim** (`.pet-navscrim`, tap to
> dismiss) instead of a fixed 132px split that would starve the content column; `EditFolderNav` gained a `floating` prop
> for this. Desktop is unchanged. The closed trigger drag already works on touch (Pointer Events + `touch-action:none` +
> pointer capture in `Trigger.vue`).
>
> **Snapshot status is state-derived, not remembered (2026-06-15):** The in-use "当前快照" readout used to read
> `ui.activeSnapshotId`, a **session-only** ref — so toggling the script off/on or refreshing reset it to null and the bar
> showed "未应用快照" even though the entries were still ON. Persisting the id would have been worse: a remembered id can
> *lie* if the user changed entries while the script was off. Fix: new store getter `matchingSnapshotId(modeId)` finds the
> snapshot whose recorded ON/OFF state matches the **live preset right now** (reads `view.value`, prefers the most specific
> match; reuses the same equality `changedSelections` uses for apply). `InUseView` shows
> `effectiveSnapshotId = ui.activeSnapshotId ?? matchedSnapshotId` — so after a refresh the matching snapshot's name
> reappears on its own, and if the user has drifted off every snapshot it honestly shows "未应用". A `snapshotModified`
> computed (`a target exists but live no longer matches it`) renders a "· 已修改" hint; the update button re-captures live
> into that snapshot to clear it. Within a session, applying a snapshot still sets `ui.activeSnapshotId` so update/rename
> have a stable target even after a tweak. The frosted sticky header also lost its `surface-glass` *fill* (kept only the
> backdrop blur + bottom border) so it no longer paints a visible box over the panel; the snapshot action cluster
> (refresh/edit/trash) now sits flush-right via `margin-left:auto`, matching the group-header layout rule. Covered by two
> new `store.check.ts` assertions.
>
> **Smart scroll — final model: pinned chip row + collapse-in-flow tools, unified across surfaces (2026-06-15):**
> _Supersedes both the original flex-collapse auto-hide and the interim sticky-overlap experiment._ The sticky-overlap
> approach was abandoned because a header that overlaps scrolling content **must** paint a masking background (otherwise
> content bleeds through it at rest-scrolled) — and that masking box is exactly the "block/backdrop" the user kept seeing
> whenever a scrollbar was present. Gating it on a `scrolled` flag only hid it at the very top, not while scrolled.
>
> Final design (shared composable `useHideOnScroll.ts` → `{ hidden, onScroll, reveal }`):
> - **Chip rows are pinned and never hide**, mirroring the always-visible app `使用 / 编辑` tabs: in-use `ModeBar`
>   (`pet-modes`) and edit `EditContextBar` (`pet-command` chip strip) sit **above** the scroll container and stay put.
> - **Only the tools collapse on scroll-down** — in-use: the snapshot status bar + search/actions row (`.pet-inuse__top`);
>   结构: the command row (`menu/search/add/collapse/批量`, `.pet-command__row`); ModeArrange: the head (`menu/name/
>   collapse/trash`, `.pet-marr__head`). They are normal flow elements **above** their scroll container that collapse via
>   `max-height/opacity` — so the freed space is reclaimed for the list and the tools **never overlap content**, which
>   means **no masking background/backdrop is ever needed** (the block is gone for good).
> - The two classic failure modes are handled in the composable: a **`SUPPRESS_MS` (320ms) window** after every toggle
>   ignores the synthetic scroll event the collapse/expand produces (kills the feedback-loop blink, incl. the near-bottom
>   clamp), and a **`MIN_RANGE` (96px) guard** skips hiding on near-empty lists so a collapse can never strand the tools
>   off-screen (short lists simply keep the tools shown). Direction logic ignores sub-6px deltas; under 8px from the top
>   always reveals. `reveal()` re-shows after actions (e.g. saving a snapshot).
> - The collapse CSS (`max-height/opacity/transform`) is mirrored in each component's scoped block (Vue scoped styles
>   can't be shared); the *logic* is the shared composable. Layout is unchanged otherwise — edit keeps its full-width
>   command row above the nav+groups workspace.
>
> **Hidden-selection honesty + self-write echo guard (2026-06-15, follow-up):** The above snapshot-capture change fixed the
> stored data but not the reported display bug, which was pure *live state*: a 单选 group whose chosen option was flagged
> `隐藏` read as `未选择` when collapsed and the whole group vanished with reveal off. Root cause: the collapsed summary and
> group-visibility filter obeyed the *curated-list* rule (`enabled && !hidden`), but a summary is a **status readout** and
> must always reflect what is actually ON. Fixes: (1) `SectionCard` summary counts every `enabled` entry regardless of
> `hidden`; (2) `InUseView.hasVisibleContent` keeps a group visible when its active selection is entirely hidden; (3) such a
> group, when expanded with reveal off, shows a "当前选择已隐藏 · 点击显示" affordance instead of a blank body. `隐藏` keeps
> its meaning (edit-time rule to declutter ON entries from the list, esp. multi-select; in-use reveal is the override) — it
> just can no longer make a group lie or disappear. The post-apply **lag** had a real cause the debounce only masked: our
> own writes echo back as `OAI_PRESET_CHANGED_AFTER`/`SETTINGS_UPDATED` *after* the synchronous `apply()` window, so the
> `writing` flag was already false and each write triggered a full reload cascade (mutate echo + debounced-persist echo).
> Added a `suppressEventsUntil` window (`markSelfWrite()` after each `apply`/`enforceRequired`) that outlasts the autosaver
> debounce; `externalReload()` ignores events inside it. Real ST-side edits after the window still reload; manual 同步 calls
> `load()` directly and bypasses the guard.
>
> **Selection-control standardization + group-header rule + page master switch (2026-06-14):**
>
> - **One selection-mark visual.** New `SelectMark.vue` (`type: radio|checkbox`, `state: on|off|partial`) is the single
>   radio/checkbox look for in-use — used by both `EntryRow`'s per-entry tile marks and `SectionCard`'s per-group master
>   toggle (and the ✍️ input tile's enable toggle, now a `SelectMark` button instead of a native checkbox). Checkbox =
>   square + accent fill + tick when on, accent dash when partial; radio = accent ring. Replaces the three divergent
>   hand-rolled marks (`pet-tile__mark--radio/--check`, `pet-section__master--radio/checkbox/on/partial`) so every in-use
>   selector reads the same. (The 📍 locked dot `pet-tile__mark--lock` stays — it's a status indicator, not a control.)
> - **Group-header layout rule** (applied across all three surfaces): `[disclosure] [master*] title …flex… [count† +
>   rule badge + required badge] [action‡]`. Count and badges are **one right-side cluster** (`pet-egroup__metas` /
>   `pet-section__badges`), never split. \*master = in-use only; †count = edit only; ‡action = edit only (结构 gear /
>   模式 移出). In-use also folds the 置顶 pin into that cluster. 结构 previously grouped the count with the name (in a
>   `name-wrap`); that's gone — count now lives with the badges, matching 模式.
> - **In-use page master switch.** `power` icon in the in-use bar → `store.setAllEnabled(enable)`: enables every visible
>   group rule-aware (`buildOnSelections`) or disables all except 必开 groups (new `buildOffSelections`, which keeps
>   required groups satisfied rather than emptied). Operates on `inUseSections()`, so it respects the active mode's scope.
>   Active (accent) when every visible group is fully on.
> - **可添加分组 全选.** The mode staging card got a 本组全选 row (mirrors 结构's `本组全选`). And `addGroupsToMode` now
>   pulls a parent's global sub-folders in with it (see below).
> - **Superseded by 2026-06-15 snapshots refactor:** in-use toggles apply + autosave instantly; mode chips now scope
>   only. ON/OFF combinations live as explicit snapshots in the in-use snapshot side-nav, not as a mode-header `⟳`.
>
> **Mode page = read-only mirror of 结构 + unified scroll (2026-06-14):** the 模式 edit surface no longer has its own
> control language — it now reuses the 结构 layout wholesale. (a) **Side nav in modes:** `EditFolderNav` gained an
> optional `modeId` prop; with it set, its reorder/nest/drag route to per-mode store methods. New `store.placeModeGroup`
> is the per-mode mirror of `placeGroup` (reparent + position-before, depth-2/cycle guarded, then a DFS `renumber` so
> sibling order stays dense). So reordering a mode's groups is the **same nav UX** as 结构 — and reorder left the card
> entirely (the per-card nest `<select>` + ▲▼ are gone), matching 结构 where ordering lives only in the nav.
> (b) **Mode cards show entries read-only:** `EditGroupCard`'s `mode` prop shrank to `{id}`; the variant now renders the
> group's entries as the **in-use tile grid** via `EntryRow` (new `readonly` prop — non-interactive, but keeps the tile +
> on/off visual for readability) and nested sub-groups recursively, collapsible via the shared `toggleGroupCollapsed`. You
> can _see_ everything but only edit entries/settings in 结构. (c) **可添加分组**
> is a dashed staging card matching 结构's `未整理` (header + note + checkbox rows + 加入所选), replacing the old
> `<details>`; group removal is the per-card 移出此模式 ×, so the group-select/batch-remove path is dropped.
> `ModeArrange` mirrors `EditView`'s workspace (fixed head row with nav-toggle · name · collapse-all · 🗑, then a
> bounded `workspace` = nav + scrolling group list). `EditGroupCard` sections now carry `id="pet-egroup-<id>"` so the
> nav's click-to-scroll works in both contexts. (d) **Scroll unified (fixes tab-switch jump):** `.pet-panel__body` is
> now `overflow:hidden` + flex column; each view owns one internal scroll container (`InUseView` got a fixed
> top + `.pet-inuse__scroll`), so in-use and edit scroll at the same inset and switching tabs no longer shifts content
> sideways. `setAllCollapsed(collapsed, ids?)` gained an optional scope so a mode's collapse-all only touches its groups.
> Follow-ups: `ModeBar`'s `pet-modes` lost its padding to align its left edge with the edit page's `pet-ctx` (kills the
> residual tab-switch jump); the mode head's nav-toggle moved to the **left** of the name input (mirrors 结构 where the
> menu is leftmost before search); and `addGroupsToMode` now **pulls a parent's global sub-folders in with it**
> (preserving nesting) — a mode shouldn't show a parent without the children it organizes.
>
> **Build/runtime fix (2026-06-14):** production webpack exposed two TDZ crashes in SillyTavern
> (`Cannot access 'x/o' before initialization`, then undefined `__vccOpts`). Root causes were Vue SFC module ordering:
> first an eager dynamic `import('./App.vue')` inside `init()`, then a production `ts-loader` full-typecheck re-export
> for `<script setup>` that routed `App.vue -> index.ts -> App.vue`. Current fix: `index.ts` uses a static `App.vue`
> import; `webpack.config.ts` forces `ts-loader.transpileOnly` and disables module concatenation **only** for
> `preset-easy-toggle`. Keep this scoped unless the repo-wide Vue loader chain is fixed. Verify with
> `BUILD_ENTRY=preset-easy-toggle pnpm build`; it should compile with no Vue SFC warning and one boot call.
>
> **UIUX pass (2026-06-13):** shared `Segmented.vue` + `IconButton.vue` now back every toggle/icon-button (replaced the
> three divergent seg styles and three `.pet-ico` copies); `PetIcon` exports `IconName` and gained
> `sun`/`moon`/`fold`/`unfold`. Group **collapse** is wired in both views (chevron per card + 全部收起/展开; `collapsed`
> was already in the model; `toggleGroupCollapsed`/`setAllCollapsed` in the store; in-use collapsed cards show a
> one-line selection summary; the synthetic `未整理` group collapses view-locally). **Batch bar** no longer sticks: an
> explicit `批量` latch is separate from selection — the bar auto-hides when selection hits 0 unless latched, hides its
> action cluster when nothing is selected, and has a close button. **快照** reworked: separate inputs for group-name vs
> snapshot, unified terminology to 快照 (incl. the rename dialog), a scope hint ("记录当前所有条目的开关状态"),
> per-snapshot entry count, and **apply moved to in-use** as a chip row with active-state detection
> (`activeScenarioId`). **In-use inputs** are now discoverable (自填 badge + labelled, accent-bordered textarea using
> the `ruleInput` token). **Light theme** added (`themes.light`, `themeByName`); a sun/moon toggle in the panel bar
> flips `useUiStore.theme`, persisted per-device in global vars (`THEME_KEY`) and re-emitted into `#pet-tokens` at
> runtime by `index.ts` — no preset write.
>
> **UIUX pass 2 (2026-06-13):** collapse-all is now a single state-aware toggle icon in the command row / in-use bar
> (not a full row). `未整理` kept as the full-preset staging catalog (user choice) but is now labelled as such — its
> entries never reach in-use and aren't captured by snapshots; the snapshot hint clarifies it records the _in-use page_
> state only. **In-use curation (live + reveal):** in-use shows only _active_ entries (`isEntryActive` =
> `enabled && !hidden`) by default; an eye toggle in the in-use bar (`useUiStore.showHidden`, session-only) reveals
> disabled/hidden entries so you can re-check them without leaving in-use, and an empty curated view shows a hint
> pointing at it. This is pure derivation — **no config write** for the default, and `entry.hidden` keeps its single
> meaning ("explicit user hide"). Unchecking an entry simply removes it from the curated view (the "curated active set"
> model); single-select switching needs the reveal toggle. _Supersedes the earlier one-shot
> `hideDisabledEntries`/`maybeScaffold` scaffold, now removed._
>
> **Edit card density (2026-06-13):** group config (rule / required / move / pin / hide / delete) is tucked behind a
> per-card ⚙️ gear (`showSettings`); the resting header is chevron · name · **单选/多选 badge** · **必开/可选 badge** ·
> count · gear (badges are read-only state, the segmented controls live in the gear panel sans label). `IconButton`
> resets UA `padding:0` + `line-height:0` and `PetIcon` is `display:block` — together they centre the glyph in active
> (filled) buttons (the residual off-centre was the browser's default button padding).
>
> **Per-entry group override (2026-06-13):** every edit-mode entry row now has a compact **move-to-group `<select>`**
> (`pet-erow__move`) → `assignEntry`, so overriding the preset's `[NN-]` grouping (e.g. pulling `general` out of
> `[08-SCENE]`) is a discoverable per-row action, not just the batch path. The override mechanism itself
> (`entryMeta[id].groupId` winning over `nativeGroupId` in `resolveView.route`) already existed; this just surfaces it
> per entry. _Revises the earlier "moving is batch-only, no per-row dropdowns" rule._
>
> **Folders / 2-level nesting prototype (2026-06-14):** implemented the data/UI foundation from the **"Folders / nesting
> — implementation handoff"** section. Groups now support optional `parentId` (depth ≤ 2 guarded in `resolveView`),
> `ResolvedSection` is a tree (`children[]`), edit mode can assign a group to a top-level parent, nested groups render
> recursively, move targets include sub-folders, and the in-use folder master-toggle enables/disables all plain
> descendants. The single-select parent case (`tail`→{gpt,ds,…}) is handled for folder toggles: enabling one child
> folder disables sibling folders' plain descendants. Deferred edge cases below remain deferred.
>
> **Search-first edit + toast quieting (2026-06-13):** `commitConfig` is now **silent on success**
> (collapse/rename/rule/pin… fired a toast each; only write _failures_ surface). Edit `pet-command` is now search +
> collapse-all + 批量 (no name input); **group creation moved to the batch toolbar's ➕** with a default name, and
> `addGroup` sorts the new group to the **top** (未整理 staging bucket moved to the bottom). Batch toolbar is one row:
> select-all + count + actions (search removed — it lives in `pet-command` and filters always). **In-use** gained a
> search box in its bar; in-use entry visibility (`inUseEntries`) + display-name (`entryDisplayName`) are shared store
> helpers so the section list and cards agree. Group settings forced onto one row (`nowrap`, compact `sm` segmented).
> Convention: icon buttons sit to the **left** of text buttons (e.g. collapse-icon before 批量).
>
> **Visual pass + snapshot archive (2026-06-13):** in-use groups are now contained **cards** (`surface-raised`,
> bordered, rounded) with inset entry tiles (`surface`), and edit entry rows lost their hard row borders for a hover
> wash — both to kill the "spreadsheet" look. **Snapshots (快照) archived:** all snapshot UI removed from edit + in-use;
> the `scenarios` config schema and the store methods (`saveScenario`/`applyScenario`/…) stay so existing data survives
> and the feature can be revived. In-use bar is now just the reveal + collapse-all tools.
>
> **Visual consistency pass (2026-06-14):** supersedes the 2026-06-13 in-use card treatment. In-use now matches edit
> mode's quieter structure: transparent group sections, bottom dividers, simple list rows, subtle accent hover/active
> wash, and token-driven input fields. `SectionCard.vue` no longer frames each group as a raised card, and
> `EntryRow.vue` no longer renders each option as a boxed tile. Edit folder nav also lost its inline collapse button
> (`pet-fnav__collapse`); the existing toolbar menu icon remains the single show/hide control. The edit workspace
> stretches children so the folder-nav vertical divider uses the full available height.
>
> **Modes — scoped partial scenarios (2026-06-14):** un-archives `scenarios` and reframes them as **Modes** for the
> cross-cutting mode×model case (e.g. 写作 needs functionals on + a model COT + tail; 总结 needs functionals off). A Mode
> is a named, **partial** cross-group state: `ScenarioSchema` gains `groupIds` (the top-level groups it controls) and
> captures the on/off state of only those groups' entries — so applying 总结 (scope `功能`) leaves the model choice in
> another group untouched. Store: `currentSelectionsFor(groupIds)`, `saveScenario(name, groupIds)`, `updateScenario(id)`
> (re-capture from live within scope); `applyScenario`/`activeScenarioId`/`rename`/`delete` reused unchanged (apply is a
> partial `setEntriesEnabled`). UI: `ModeBar.vue` at the top of in-use — one-click chips plus a manager (rename ·
> update-from-current · delete · new mode = name + group checkboxes). **The current mode is an explicit, sticky
> selection** (`useUiStore.activeModeId`, session-only), not derived from state-matching: clicking a chip both applies
> the saved switches *and* sets the current mode; a 全部 chip clears it. While a mode is active the in-use view (cards
> **and** the reveal toggle) is **scoped to that mode's groups**, so switching is visible and reveal no longer floods
> every group. Modes apply *absolute per-entry state over their scope* and never auto-disable another mode, so shared
> entries across modes / overlapping scopes just work. `activeScenarioId` (state-match detection) stays exported but no
> longer drives the chip highlight. This is the chosen path over the mirror/multi-group-membership model, which is
> deferred: mirror shares *where an entry displays*, but the need was *applying a cross-group state*, which Modes do
> directly.
>
> **Usability pass 2 (2026-06-14):** (a) **Master toggle on every group** — `SectionCard.showMasterToggle` is now
> `plainDescendants > 0 || children > 0` (was children/parent only), so any group with togglable content gets a
> whole-group on/off; only all-locked groups skip it. Title is generic (开启整组/关闭整组). (b) **In-use badges moved to
> the right** of the header (`pet-section__badges`, name is `flex:1`), mirroring edit-mode cards. (c) In-use accordion
> header divider aligned to edit's (55% border). (d) **Mode scope is editable after creation** —
> `store.setScenarioScope(id, groupIds)` (keeps captured states for groups that stay, captures live for added, drops
> removed); `ModeManager` rows expand to group checkboxes. (e) New-mode default name is `模式N`. (f) Removed the *nested*
> nav grip (the top-level one went earlier; whole rows still drag).
>
> **Edit-mode unification (2026-06-14):** _supersedes the 分组/模式 segmented + `ModeConfig`._ Edit is now **one surface
> contextualized by a chip strip** (`EditContextBar` → `ui.editContextId`, null = 结构, else a mode id). 结构 keeps the
> group editing; a mode chip shows `ModeArrange`, which **reuses `EditGroupCard` via a `mode` prop variant** — the same
> `pet-egroup__head` (chevron-less: select checkbox · name · rule/必开 badges · nest `<select>` · ▲▼ · 移出), no entry
> rows — plus **batch group-select** (移出所选) and a 可添加 list (加入所选). Store gained
> `addGroupsToMode`/`removeGroupsFromMode` (batch); `setModeGroupParent`/`nudgeModeGroup` drive the per-row nest/reorder.
> The in-use group divider now sits **between groups** (section bottom-border) rather than under the header. Dropped the
> `分组/模式` segmented, `editSubview`/`selectedModeId`, and `ModeConfig.vue`.
>
> **Per-mode group arrangement + edit sub-nav (2026-06-14):** modes are now first-class. Edit splits into a
> **分组 | 模式** segmented sub-view (`useUiStore.editSubview`). Each mode owns its **own group membership, order, and
> nesting** — `ScenarioSchema.layout: {groupId, order, parentId?}[]` (authoritative when set; else derived from the
> global structure filtered to `groupIds`). Store: `modeSections(scenario)` rebuilds a mode's tree (depth ≤ 2), and
> **`inUseSections()` returns the active mode's tree or the global one** — used for both rendering *and* toggle
> parent-lookups (`inUseSectionById`), so per-mode nesting governs single-select exclusion too; **edit always uses the
> global structure**. Mutations: `setModeLayout` (syncs `groupIds` and preserves stored values via the current
> capture/sync helpers), `addGroupToMode`/`removeGroupFromMode`/`nudgeModeGroup`/`setModeGroupParent`. UI:
> `ModeConfig.vue` (edit 模式 view) = left mode subnav + per-mode arrangement editor (reorder ▲▼ · parent `<select>` ·
> remove · add-group picker · rename/update/delete); `ModeBar.vue` stays the in-use chooser; `ModeManager.vue` removed.
> Removed now-dead `currentSelections`/`activeScenarioId`/`scenarioSize`/`setScenarioScope`.
>
> **Modes/edit usability pass (2026-06-14):** (1) **Mode editing moved to edit mode** — `ModeManager.vue` (collapsible,
> at the top of `pet-edit__groups`) does create/rename/update/delete + scope checkboxes; `ModeBar.vue` in in-use is now
> a pure chooser (全部 + mode chips). This unblocks group editing that the in-use manager made awkward. InUseView gates
> the bar/ModeBar on the *unscoped* `allManagedSections` so an active mode whose groups are empty/hidden can't trap the
> user (with an escape hint pointing at 全部). (2) **Edit add-group `+`** in `pet-command__row` (`addEmptyGroup`),
> separate from the batch toolbar's "new group from selection". (3) **Per-entry edit-row actions** are now 常驻 (pin) +
> 隐藏 (eye); the 输入框 toggle is **batch-only**. (4) **Side-nav** dropped the per-item grip glyph (the whole row is
> still draggable; the header hint covers discoverability) and trimmed to `132px`. (5) **In-use groups are flat again**
> — `SectionCard` has no card box (transparent, header rule only); only the entry tiles are boxed, killing the
> "boxes-in-a-box" look.
>
> **Nested rule logic + 必开 + 常驻 override (2026-06-14):** resolves the deferred "single-internal sub-folder" and
> "mixed single parent" edges and makes two suggestion-flags user-owned.
>
> - **Folder toggles honour the folder's own rule.** New pure helpers in `store.ts`: `immediateUnits(section)` (each
>   direct plain entry _and_ each child folder is one "unit") and `buildOnSelections(section)` (recursive: `multi`
>   enables all plain descendants, `single` enables exactly one unit — the active one if any, else the first). `toggleFolder`
>   uses it, so a single-select group's master now **single-selects one child** instead of enabling everything (the
>   reported bug). `folderState` is rule-aware (single = "one unit active ⇒ on"; multi = all/none/partial).
> - **Mixed single parent.** `toggleEntry`'s radio branch now clears sibling **sub-folders** too (not just sibling direct
>   radio entries), so a `single` group mixing direct options and folders enforces mutual exclusion across both unit kinds.
> - **常驻 (📍) is overridable.** `📍` is a suggestion; `entryMeta[id].alwaysOn` overrides it (`false` un-locks a 📍
>   entry → normal rule-governed toggle; `true` pins a plain one), pruned when it matches the name. `resolveEntry` applies
>   it; `store.toggleEntryAlwaysOn`; edit rows gained a pin button beside hide/input.
> - **必开 (required) is enforced + surfaced.** In-use group headers show a 必开 badge. A new `enforceRequired()` runs on
>   **load/sync only** (`store.load()` = `reload()` + enforce; wired to mount, the sync button, and
>   `OAI_PRESET_CHANGED_AFTER`/`SETTINGS_UPDATED`) — never after an internal write, so it can't loop. When a 必开 group is
>   found fully off it auto-enables via `buildOnSelections` (multi → all, single → first) and fires a `toastr.info`.
> - **Deferred edge still open:** a `required` group nested under a `single` parent can momentarily produce two active
>   units (enforcement enables the child without clearing the parent's other unit). Rare config; revisit if hit.
>
> **Side-nav is the home for group structure (2026-06-14):** the folder-nav (`EditFolderNav.vue`) is now the single
> place to reorder + (un)nest groups. Each nav row gets hover action buttons: **▲/▼ reorder within its own sibling list**
> (works at top level _and_ inside a folder) and, for sub-folders, a clear **移出 (outdent)** button. This replaces the
> ambiguous "顶" text button — which read as "top" but actually appended the group to the _bottom_ of the top level.
> New store actions: `nudgeGroup(id, ±1)` (sibling-aware reorder via `placeGroup`) and `outdentGroup(id)` (un-nest,
> dropping the group **right after its former parent** so it stays where the eye expects). The old top-level-only
> `moveGroup` is removed (superseded by `nudgeGroup`), and the **up/down arrows are gone from the per-card settings
> gear** (gear is now rule/required · pin · hide · delete) — ordering lives only in the nav, which is open by default
> (`editNavOpen = true`). Drag still works for both reorder (thin drop strips) and nesting (drop _onto_ a top-level
> item, now with an accent `--nest` highlight on dragover); grip uses the `grip` glyph, and `EditGroupCard`'s now-unused
> `isFirst`/`isLast` props + `EditView`'s `realSections`/`*Movable` helpers were pruned.
>
> **Mode-divergent visual language (2026-06-14):** _intentionally reverses_ the consistency pass above for in-use only.
> The two modes now optimize for different jobs: **edit** stays quiet/dense (functionality-first); **in-use** is
> readability-first. `SectionCard.vue` again frames each group as a contained card (surface, border, `radius-lg`,
> larger `lg` header) and lays its entries out as a responsive **tile grid**
> (`grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))`). `EntryRow.vue` renders each option as a big
> ≥46px button-tile with a clear on-state (accent-tinted fill + accent border + medium weight + a `check`/radio-dot
> mark); 📍-locked tiles use the always-on token, ✍️-input tiles span the full grid row with a labelled textarea.
> Edit-mode markup (`EditGroupCard`/`EditView`) is untouched — `SectionCard`/`EntryRow` are in-use-only. Added a `check`
> glyph to `PetIcon`. **Nav divider fix:** the folder-nav divider previously cut off mid-scroll because the panel
> _body_ was the scroll container while the nav was `position: sticky`. Scrolling now lives in `.pet-edit__groups`
> (`overflow-y:auto`); `.pet-edit__workspace` is `overflow:hidden`; the nav is `height:100%` (no longer sticky), so its
> `border-right` spans the full workspace height regardless of scroll.
>
> **Recent fixes (2026-06-13):** trigger flicker — replaced `createScriptIdIframe` with a bare controlled iframe (its
> srcdoc's `adjust_iframe_height` was fighting fixed sizes); trigger UX — draggable closed trigger, smaller idle bubble,
> hover growth/opacity; edit UX — full-preset selection, batch toolbar, `未整理` group, required/optional group axis,
> compact in-use tiles; silent write failures — all store mutations now `try/catch` → `toastr` error + success; panel
> scroll — `height` chain on iframe `html,body`.
>
> **Next — polish / deferred:** (a) **drag-to-reorder** for _entries_ (groups now drag in the side-nav and have
> ↑/↓/outdent in **both** 结构 and 模式 — the mode nav reuses `EditFolderNav` via `modeId`; entry-level drag still TODO).
> (b) **per-entry
> order within a group** (today: preset position). (c) optional "write grouping back to real `[NN-]` headers" action
> (overlay→preset). (d) the _mirror / multi-group membership_ model (one entry shown in several groups) — deferred in
> favour of Modes; `entryMeta` is the extension point. (e) a store-level `*.check.ts` (esp. for Modes + nested
> single/multi logic) if it grows. (f) deferred edge: a `必开` group nested under a `single` parent can momentarily show
> two active units.
>
> **Resolved decisions:**
>
> - _Config entry placement_ — matched by **name** (`[⚙️CONSOLE-CONFIG]`); created **just before
>   `⚙️CUSTOMIZATION_START`**; parser defensively **skips** it if found inside the region.
> - _Grouping model (2026-06-13)_ — **virtual overlay** in config; the preset is never reordered. Region entries keep
>   their `[NN-]` suggestion until reassigned. Outside-region and unassigned entries appear in edit mode under `未整理`,
>   sorted by SillyTavern prompt order. (Supersedes the original "physically relocate".)
>
> APIs: see `@types/function/preset.d.ts` (`getPreset`/`updatePresetWith`). Script conventions: `.cursor/rules/脚本.mdc`
> and `项目基本概念.mdc` at repo root.

A Tavern Helper script that gives **one specific preset** a clean console for toggling its prompt entries. Born from the
`客制化预设条目控制台` reference, but deliberately narrower: it's for _your_ preset, so it can be far simpler than a
general-purpose tool.

## Locked decisions

| #                           | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modes                       | **in-use** (operate, 80% of the time, must be glanceable) and **edit** (configure, must be fast to leave). Both always sync live from the preset; they differ only in what they _write_.                                                                                                                                                                                                                                                                                                                                                                                            |
| Source of truth — structure | **Scaffolded from the customization region, selectable from the full preset, overridable in config.** SillyTavern presets are flat; the user fakes sections with header entries like `[03-POV]`. The parser decodes those headers into a _suggested_ grouping and also exposes a full-preset selectable catalog for edit mode.                                                                                                                                                                                                                                                      |
| Source of truth — behaviour | Stored in **one disabled `[⚙️CONSOLE-CONFIG]` entry inside the preset**, as JSON keyed by entry `identifier`. Travels with the preset (the script is bound to it), survives ST edits, never injects.                                                                                                                                                                                                                                                                                                                                                                                |
| Grouping                    | **Virtual overlay (revised 2026-06-13).** The `[NN-]` headers are only a _suggestion_. In edit mode the user creates custom groups, renames groups, and moves entries between groups — all stored in config (`customGroups`, `entryMeta[id].groupId`). **The preset is never reordered** (prompt order can affect generation). Region entries keep their `[NN-]` suggestion until reassigned; outside-region and otherwise unassigned entries appear in an edit-only `未整理` group sorted by ST prompt order. _Supersedes the original "physically relocate the prompt" decision._ |
| Nesting                     | **Max depth 2**: top-level folder → sub-folder → entries. No unlimited nesting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Modes (was Scenarios)       | An **orthogonal** layer, not nesting: a named **scope/layout** (`scenarios[]`). Each mode scopes a set of groups (`groupIds`) with its **own order + nesting** (`layout`); clicking a mode chip only changes the in-use view scope. ON/OFF combinations live as explicit `snapshots[]` inside a mode, and applying a snapshot only touches entries captured by that snapshot. Legacy `selections` remains only as a compatibility `默认` snapshot for old configs. In-use has a `ModeBar` chooser (全部 + chips) plus the snapshot side-nav; editing lives in edit mode, reached via the `EditContextBar` chip strip (结构 + a chip per mode) which swaps the surface to `ModeArrange` (layout/membership only). _See the 2026-06-15 Modes logs for specifics._ |
| Batch editing               | Edit mode always shows per-entry selection checkboxes and per-group select-all/count/action rows. The top `多选` button or any selected checkbox reveals a bottom-floating batch toolbar with select all, selected count, add group, hide/unhide, input/no-input, move-to-group, and search.                                                                                                                                                                                                                                                                                        |
| Persistence                 | **Auto-save** (debounced): each toggle writes to live `in_use` _and_ the bound preset file on disk, so selections survive leaving/returning. (The reference only auto-applied to `in_use`; disk save was manual — we go one step further.)                                                                                                                                                                                                                                                                                                                                          |
| Lifetime                    | Script is bound to its preset and disappears on preset switch. No cross-preset machinery.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Build                       | Lives at `src/preset-easy-toggle/` in the template repo (TS + webpack + `@types`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Group behaviour: three orthogonal axes

Confirmed against the real preset (`[00-USER INPUT]` … `[08-SCENE]`). There are **two independent** dimensions from the
original preset — a per-group _rule_ and a per-entry _kind_. Edit mode adds a third config-only axis: _requiredness_.

**Group requiredness** (whether the group may have no plain entry selected):

| Requiredness               | Meaning                                                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `required: true` / `必开`  | At least one plain entry in the group must stay enabled. For single-select, clicking the active option does nothing; for multi-select, the last enabled checkbox cannot be turned off. |
| `required: false` / `可选` | The group may have no plain entries enabled. Single-select and multi-select can both be cleared.                                                                                       |

**Group rule** (governs the group's _plain_ entries):

| Rule                | Example                                           | Affordance |
| ------------------- | ------------------------------------------------- | ---------- |
| `single` (pick one) | `[03-POV]`, `[01-PERSONA]`, `[07-STYLES]`         | radio      |
| `multi` (pick any)  | `[04-PLOTS]`, `[05-CHAR_BUILDING]`, `[06-OTHERS]` | checkboxes |

**Entry flags** (per-entry, two _independent_ booleans from the name — an entry can be both, and either overrides the
section rule):

| Flag       | Marker            | Example                         | Affordance        |
| ---------- | ----------------- | ------------------------------- | ----------------- |
| `alwaysOn` | `📍`              | `📍General` inside `[08-SCENE]` | shown, locked on  |
| `input`    | `✍️` / `（自填）` | `✍️剧情偏好（自填）`            | editable text box |

An entry with neither flag is **plain** and governed by the group rule. An entry can carry both: `📍✍️正文语言（自填）`
is an always-on input. A section can therefore be **mixed**: `[08-SCENE]` holds a `📍`-locked `General` entry _and_ a
single-select set of `*-scene_architecture` variants. The group rule only decides how the plain entries behave;
`📍`/`✍️` entries are self-describing and need no per-section config — the scaffolder reads them straight from the name.

## Config data model (`[⚙️CONSOLE-CONFIG]` JSON)

```ts
type Config = {
  version: 1;
  region: { startId: string; endId: string }; // ⚙️CUSTOMIZATION_START / _END identifiers
  // Overrides for scaffolded (header-derived) groups, keyed by header id.
  groups: Array<{
    headerId: string; // header entry id == scaffolded group identity
    name?: string; // virtual rename (header prompt untouched)
    parentId?: string; // top-level parent for 2-level nesting (depth ≤ 2, guarded in resolveView)
    rule: 'single' | 'multi'; // governs *plain* entries; 📍/✍️ stay per-entry
    order: number;
    pinned: boolean; // float to top of in-use
    hidden: boolean; // never shown in in-use
    required: boolean; // true = must keep at least one plain entry enabled
    collapsed: boolean;
  }>;
  // User-created virtual groups (no backing header prompt).
  customGroups: Array<{
    id: string;
    name: string;
    parentId?: string; // same nesting field as scaffolded groups
    rule: 'single' | 'multi';
    order: number;
    pinned: boolean;
    hidden: boolean;
    required: boolean;
    collapsed: boolean;
  }>;
  // Per-entry overrides. `groupId` reassigns the entry; `alwaysOn` overrides the name's 📍 lock.
  entryMeta: Record<string, { kind?: 'input'; alwaysOn?: boolean; hidden?: boolean; groupId?: string }>;
  // "Modes": named scope/layout records. ON/OFF states are explicit snapshots.
  scenarios: Array<{
    id: string;
    name: string;
    groupIds: string[]; // top-level groups the mode controls (scope)
    layout: Array<{ groupId: string; order: number; parentId?: string }>; // per-mode order + nesting (else derived)
    selections: Record<string, boolean>; // legacy compatibility snapshot
    snapshots: Array<{
      id: string;
      name: string;
      selections: Record<string, boolean>; // entry id -> enabled, within scope
    }>;
  }>;
  ui: { theme: string };
};
```

`resolveView(parse, config)` merges these into the rendered groups: scaffolded groups + custom groups, with each region
entry routed to `entryMeta[id].groupId` (if that group still exists) else its native `[NN-]` group; a dangling `groupId`
falls back to native. Outside-region entries never render by default, but if assigned to a group via
`entryMeta[id].groupId`, they render there. Resolved entries carry `nativeGroupId` + current `groupId`, plus `position`
and `inManagedRegion`.

`ResolvedView.allEntries` is the full-preset selectable catalog used by edit mode. It excludes headers, the console
config entry, and region markers. Edit mode builds the synthetic `未整理` group from entries in `allEntries` that are
not currently in any resolved group.

Everything keyed by **`identifier` (UUID)**, never by name — that's what makes ST-side renames and reorders
non-destructive.

## Parsing rules (verified against the real preset)

- **Region**: manage only entries strictly between the entries named `⚙️CUSTOMIZATION_START` and `⚙️CUSTOMIZATION_END`
  (match by name, not id — ids change if the preset is rebuilt). Everything before START (`📍VARS`) and after END
  (`main`, `💠BEGIN`, `📍HEAD STRUCTURE`, COT/jailbreak tails…) is the prompt scaffold and is never touched.
- **Header**: name matches `^\[\d+-.*\]$` _and_ `content` is empty → starts a group.
- **Entry kind** (per entry, by name): starts with `📍` → `always-on`; contains `✍️` or `（自填）` → `input`; otherwise
  `plain`.
- **Full-preset catalog**: edit mode can select from the whole preset, not just the managed region. The catalog excludes
  `[NN-]` headers, `⚙️CUSTOMIZATION_*` boundaries, and `[⚙️CONSOLE-CONFIG]`.
- **Scaffolding**: on first setup, propose groups from headers and _guess_ each section's rule from its plain entries
  (exactly one enabled → `single`; several enabled → `multi`). Entry kinds are detected, not guessed. User accepts or
  tweaks the rules.

## Edit UI rules

- The top command row is search-first: side-nav menu icon, entry search input, collapse-all icon, and `批量`.
- Group sections use a quiet edit-mode layout: transparent surface, bottom divider, header badges, optional settings
  gear panel, and simple hover-wash entry rows.
- Group cards always show entry checkboxes, a per-group `本组全选` row, entry count, and group action icons. The
  floating batch toolbar is the only extra surface when batch mode is active.
- Selecting any entry checkbox automatically reveals the floating batch toolbar. Clicking `批量` also reveals it with
  zero selected. Closing/turning off `批量` clears selection.
- The batch toolbar floats at the panel bottom. The edit view adds bottom padding while it is visible so lower rows are
  not obscured.
- Batch toolbar actions:
  - select all / unselect all for the currently filtered result set
  - show selected count
  - create a new custom group with a default name (`分组 N`) and move selected entries into it
  - toggle selected entries hidden / not hidden
  - toggle selected entries input / not input
  - move selected entries to an existing group via the group selector
  - exit batch mode
- Per-entry edit actions include hide/show, input/no-input, and a compact move-to-group selector. Batch assignment is
  still the faster path for bulk moves.
- Edit side-nav (`EditFolderNav.vue`) is toggled only by the command-row menu icon. It has no inline collapse button;
  its right divider is expected to stretch for the full available workspace height.
- Buttons use local SVG icons (`PetIcon.vue`) rather than emoji glyphs.

## Styling

`tokens.ts` is the single source of truth for color / type / spacing / motion. Components reference `--pet-*` CSS
variables only. Visual direction (editorial, glass) is deferred — we lock structure and function first. The trigger is
non-intrusive (faint + small at rest, opaque + larger on hover), draggable while closed, and modelled on the reference.
Icon and muted text contrast are explicit token concerns (`--pet-color-icon`, `--pet-color-text-muted`,
`--pet-color-text-faint`) because edit mode relies heavily on icon-only controls.

## Folders / nesting — implementation notes

> **Status:** prototype built 2026-06-14. This section is kept as implementation notes and remaining edge-case guidance.

### Why (the two real use cases)

1. **`tail` — single-select folder of folders.** `tail` (rule `single`) contains sibling sub-folders
   `gpt / ds / gemini / claude`, each holding entries. Picking one sub-folder turns its whole batch **on** and turns the
   sibling sub-folders **off** — a scoped, visible "profile switch" (a better, non-hidden replacement for the archived
   snapshots). The user never opens the folders.
2. **`功能` — organizational container.** `功能` (rule `multi`) holds loose entries _and_ a nested single-select folder
   `总`→{大总结, 剧情大纲}. Nesting here is a human reminder that 总's two children are mutually exclusive.

### Confirmed decisions

- **Folder master-toggle enables ALL plain descendants** (not a remembered set, not a flagged subset). "plain" = not
  `alwaysOn` (📍) and not `input` (✍️) — i.e. the rule-governed entries only.
- **Max depth 2** (folder → sub-folder → entries). Revises the locked "Nesting: one group level only" decision to its
  own stated escape hatch ("max depth 2, never unlimited").
- A parent's `rule` governs its **immediate children uniformly** — a direct plain entry and a whole sub-folder are both
  one "unit". `single` parent ⇒ exactly one unit active; `multi` ⇒ independent.

### Data model — `config.ts`

- Add `parentId: z.string().optional()` to **both** `GroupSchema` and `CustomGroupSchema`. Value = the id of the parent
  group (`headerId` or custom `id`); absent = top-level. Optional ⇒ old configs load unchanged (flat), no migration
  needed.
- `entryMeta[id].groupId` may already point at a sub-folder id — no change needed there.
- **Depth/cycle guard** lives in `resolveView` (don't trust stored data): when nesting, only honour a `parentId` if the
  referenced parent exists **and is itself top-level** (its own `parentId` is empty). Otherwise treat the group as
  top-level. This caps depth at 2 and prevents cycles.

### `resolveView` — `config.ts` (flat list → tree)

- Build all groups (header + custom) into resolved nodes as today, each with `children: []`.
- Entry routing (`route()`) is **unchanged**: `entryMeta[id].groupId` still wins over `nativeGroupId`; a `groupId`
  pointing at a sub-folder lands the entry in that sub-folder's bucket.
- After buckets are filled: for each group, if its guarded `parentId` resolves, push it into that parent's `children`;
  else it's top-level. Sort top-level and each `children[]` by the existing comparator (pinned, then `order`, then
  stable index). Entries within each node sort by `position`.
- `ResolvedView.sections` = **top-level nodes only**; each node carries `.children` (sub-folders) and `.entries` (direct
  entries). A node may have both (the `功能` case).

### Types — `types.ts`

- `ResolvedSection`: add `parentId: string | null` and `children: ResolvedSection[]`.

### Store — `store.ts`

- `setGroupParent(id, parentId | null)`: write `parentId` via `groupRecord(id)` (creates a header override through
  `ensureHeaderGroup` when needed); reject if it would exceed depth 2 or form a cycle (parent must be a top-level group,
  target ≠ self, target not a descendant); `commitConfig()`.
- `plainDescendants(section): ResolvedEntry[]` — recursive: this node's plain entries + each child's plain entries.
  (plain = `!alwaysOn && !input`.)
- `folderState(section): 'on' | 'off' | 'partial'` — by count of enabled plain descendants (all → on, none → off, else
  partial). Drives the folder toggle's checked/indeterminate UI.
- `toggleFolder(section)`: target = `folderState !== 'on'` (turning on unless already fully on). Build a
  `Record<id, boolean>`: every plain descendant of `section` → target. **If the section's parent is `single`**, also set
  every plain descendant of the parent's _other_ children (and the parent's other direct plain entries) → `false`. Apply
  atomically via `apply(() => setEntriesEnabled(gateway, selections))`. (No config write — this is in-use state.)
- Export the new actions/helpers; `isEntryActive` / `entryDisplayName` / `inUseEntries` already exist.

### In-use UI — `SectionCard.vue` / `InUseView.vue`

- `SectionCard` renders **recursively**: a folder shows its `children` as nested `SectionCard`s (one level of
  indentation) plus its own direct `entries`.
- Folder header gets a **master toggle** whose affordance follows the **parent's** rule: radio when the parent is
  `single` (the `tail` profile case), checkbox/switch when `multi` or top-level. Reflect `folderState` (indeterminate
  when `partial`); click → `store.toggleFolder(section)`.
- **Folders stay visible as selectable units even when their entries are curated out.** Curation (`inUseEntries` /
  `showHidden`) and the search apply to leaf entries; a single-select parent must still show _all_ its child folders so
  you can switch profiles. Keep folder headers always rendered; curate only the entries inside.

### Edit UI — `EditView.vue` / `EditGroupCard.vue`

- `EditGroupCard` renders `children` recursively (indented) under its own rows.
- Add a **parent picker** per group (mirror the new per-entry move `<select>`): options = "顶层（无上级）"
  - every eligible top-level group (exclude self and any group that already has children or a parent). Change →
    `store.setGroupParent(id, value || null)`.
- `editableSections` builds 未整理 from `allEntries` minus _grouped_ ids — make sure the "grouped" set is computed over
  the **whole tree** (top-level + all descendants' entries), or nested entries will wrongly reappear in 未整理.
- The per-entry move `<select>` (`moveTargets`) and the batch "move to group" (`groupOptions`) currently list
  `view.sections` (top-level only) — flatten the tree so **sub-folders are valid move targets** (indent child names for
  clarity, e.g. `　gpt`).

### Deferred in the prototype (document behaviour, don't fully build)

- **single-internal sub-folder edge:** a sub-folder that is itself `single` — "enable all plain descendants" conflicts
  with its own single rule. Interim: master-toggle enables only one (its first, or last-active) plain entry. Flag when
  hit.
- **mixed single parent** (direct plain entries _and_ sub-folders under one `single` parent): needs unified
  mutual-exclusion across entry-units _and_ folder-units, and `toggleEntry`'s radio logic must become parent-aware.
  `tail` has folders only, so the prototype can ignore this; the `功能`/general case needs it.
- **container rule:** `功能` is a pure organiser; `multi` works, but consider a `rule: 'none'` later.
- Drag-to-reorder/nest; writing nesting back to preset `[NN-]` headers (never — virtual overlay only).

### Files to touch (checklist)

`config.ts` (schema + `resolveView` tree/guard) · `types.ts` (`parentId`, `children`) · `store.ts` (`setGroupParent`,
`toggleFolder`, `plainDescendants`, `folderState`, parent-aware exclusion) · `SectionCard.vue` + `InUseView.vue`
(recursive render, folder master-toggle, folders-always-visible) · `EditGroupCard.vue` + `EditView.vue` (recursive
render, parent picker, tree-aware 未整理 + move targets) · `DESIGN.md` (flip the Nesting locked decision once built).
Verify: `BUILD_ENTRY=preset-easy-toggle pnpm build` (current prod bundle is larger because this entry forces
`ts-loader.transpileOnly` to avoid the Vue SFC production re-export bug) plus the three focused checks:
`parser.check.ts`, `config.check.ts`, `preset-io.check.ts`. No `*.check.ts` covers store/UI yet.

## Native SillyTavern extension port — notes

> **Status:** first native pass started in `/Users/susie/preset_control` (2026-06-15). Captured from the feasibility discussion. The goal is to ship this as a standalone
> ST **UI extension**, leaving the Tavern Helper scaffold behind. The codebase is well-positioned because every impure ST
> call already goes through one seam — `PresetGateway` (`tavernGateway()` in `preset-io.ts`). Verified against the official
> docs: [Writing UI Extensions](https://docs.sillytavern.app/for-contributors/writing-extensions/),
> [Prompt Manager](https://docs.sillytavern.app/usage/prompts/prompt-manager/).
>
> **Local verification correction:** the local ST checkout exposes `SillyTavern.getContext().getPresetManager`, loads
> extension JS as `type="module"`, and stores OpenAI enabled/order state in the global prompt order
> (`character_id: 100001`). It does **not** expose `prompts_unused` in native OpenAI preset data. Native config storage is
> therefore `preset.extensions.presetEasyToggle` (read/written through the current preset object), while the existing
> config reader still sees virtual `[⚙️CONSOLE-CONFIG]` entries supplied by `presetGatewayNative()`.
>
> **Manual transfer decision:** instead of automatic one-time migration from Tavern Helper storage, the panel exposes
> explicit import/export buttons. Export downloads only the console config JSON (groups, modes, snapshots, entry metadata,
> UI config). Import accepts either that raw config JSON or a full SillyTavern preset export containing
> `[⚙️CONSOLE-CONFIG]` in `prompts_unused`/`prompts`, validates the extracted config through `ConfigSchema`, and overwrites
> the current preset's native console config. Prompt definitions and live enabled switches are not exported except where
> snapshots already record them.

### Plans

- **Ship as a native UI extension**, not a Tavern Helper script. An extension is a folder in
  `data/<user-handle>/extensions/<name>/` (served at `/scripts/extensions/third-party/...`) with a `manifest.json` + a JS
  entry point **loaded as an ES module**, running directly in the ST page (no sandbox iframe, no injected TH globals).
- **Keep the architecture; swap only the edges.** `parser` / `config` / `types` / `store` / all `.vue` are untouched —
  they only ever see `ResolvedView`. The port is concentrated in: (1) a new gateway implementation, (2) the mount, (3) the
  build, (4) a `manifest.json`.
- **Gateway → ST-native API.** Replace the TH globals (`getPreset` / `updatePresetWith` / `getLoadedPresetName` /
  `replacePreset`, events `OAI_PRESET_CHANGED_AFTER` / `SETTINGS_UPDATED`) with `SillyTavern.getContext()`:
  `getContext().eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER / SETTINGS_UPDATED, …)` (these are ST's own event
  names that TH merely re-exposed, so they map ~1:1), `getContext().getPresetManager('openai')` to read/write the
  chat-completion preset, and the global `toastr` (works unchanged). The `PresetGateway` interface stays the same shape.
  Current implementation: `preset-io-native.ts` builds `presetGatewayNative()` alongside `tavernGateway()`.
- **Mount via Shadow DOM.** Drop the `srcdoc` iframe shell in `index.ts`; mount the Vue app into a shadow root appended to
  the ST page, injecting `emitCssVars()` + the teleport styles into that root. Our `--pet-*` token + scoped-styles
  architecture makes this near-drop-in and isolates us from ST's global CSS (and vice versa).
- **Build → single ES module.** Emit one self-executing ESM file (e.g. `index.js`; `output.module` /
  `experiments.outputModule`) bundling Vue + Pinia (ST won't provide them), referenced by `manifest.json`'s `js`. Most of
  the current webpack config carries over.
- **`manifest.json`** (required: `js`, `author`; `display_name` shows in Manage Extensions). Local loader note: JS is
  always inserted as `type="module"`; keep `css` as a single string or inline styles. Starter:
  `{ "display_name": "预设控制台", "author": "…", "js": "index.js", "css": "style.css", "loading_order": 100,
  "auto_update": true, "minimum_client_version": "…" }`.

### TODO

1. Scaffold `manifest.json` (+ `style.css` if not inlined) and an extension entry that mounts the app. **Done in first
   pass:** `src/preset-easy-toggle-extension/manifest.json` + `native.ts`.
2. Implement `presetGatewayNative()` against `getContext()` / `getPresetManager('openai')`, matching the existing
   `PresetGateway` contract (`read → { prompts, promptsUnused }`, `mutate(edit)`, `persist`). **Confirm the exact calls
   against a real ST checkout** (`public/scripts/openai.js`: `oai_settings`, `promptManager`, `getPresetManager`).
   **First pass done** using `chatCompletionSettings`, `prompt_order`, and `savePreset`.
3. Map the enabled-state read/write to `prompt_order` (see pitfalls) — the highest-risk item; cover it with a focused check.
   **First pass done** for OpenAI global prompt order (`character_id: 100001`); still needs a focused native-gateway check.
4. Map events: `eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER / SETTINGS_UPDATED, externalReload)` and unsubscribe
   on teardown.
5. Convert the mount in `index.ts` to a Shadow-DOM root; route `emitCssVars()` + teleport styles into it; keep the
   draggable trigger + open/close lifecycle.
6. Add a build entry (or separate config) that outputs the ESM bundle + copies `manifest.json` into `dist/`.
7. Decide config storage. **Decision for native:** use `preset.extensions.presetEasyToggle`; keep fake prompt-entry
   config only as an adapter/back-compat surface for shared code.
8. Smoke-test install: drop the folder into `data/<user>/extensions/`, verify it loads, opens, toggles, autosaves,
   reloads on external preset edits, and survives a preset switch.

### Possible pitfalls / things needing attention

- **`prompt_order` is the real gotcha.** TH's `getPreset().prompts[i].enabled` is a *flattened convenience*. Natively, a
  prompt's **definition** lives in `oai_settings.prompts` (identifier/name/content) but its **enabled state + order are
  per-character in `oai_settings.prompt_order`** (`{ character_id, order: [{ identifier, enabled }] }`), managed by the
  prompt manager. So `setEntriesEnabled` becomes "find the *active character's* `prompt_order` and flip `enabled` there,"
  not a flat field write. This is where the port can silently break; isolate it in the gateway and test it.
- **Live `in_use` vs saved preset on disk.** TH split "mutate the live preset" from "save back to disk" (`persist`). Native
  ST has the same distinction (editing settings vs saving the preset); make sure `persist()` actually writes the preset
  the way ST's save button does, or selections won't survive a preset switch.
- **CSS isolation.** Without the iframe, ST's global styles bleed into our components unless we use Shadow DOM (preferred)
  or aggressive class prefixing. Watch for `:deep()` selectors, teleported popovers (the `Dropdown` menu is `position:
  absolute`, not teleported — fine in shadow root), and that backdrop-filter/glass still render inside a shadow root.
- **Event echo / self-write guard.** The store's `suppressEventsUntil` window assumes our own writes echo back as
  `OAI_PRESET_CHANGED_AFTER` / `SETTINGS_UPDATED`. Confirm native ST still emits those after a programmatic preset write so
  the guard keeps working (otherwise we either miss external reloads or loop).
- **`prompts_unused` does not apply natively.** Tavern Helper's `prompts_unused` storage remains correct for the script
  target, but native OpenAI presets in the local checkout do not expose that list. Use `preset.extensions` for native
  per-preset JSON and let the gateway provide virtual config entries to shared code.
- **No TH helpers.** `getLoadedPresetName`, `replacePreset`, `updatePresetWith` don't exist natively — every one needs a
  `getContext()`/preset-manager equivalent. Don't assume a 1:1 method exists; some become multi-step.
- **Compact/mobile flag.** `useUiStore.compact` is driven from the *host* viewport in `index.ts`. In an extension we read
  the real window directly (no iframe indirection) — simpler, but rewire it.
- **Versioning / fail-safe.** Keep the config corruption guard + backup behavior; an extension auto-update shouldn't be
  able to clobber a newer (unparseable) config (the schema-bump fail-safe still applies).

### Defer / future plans

- **Native per-preset config storage.** ST can store arbitrary JSON in a preset's `extensions` object (exported/imported
  with the preset). This is now the native target's storage path. Follow-up: add explicit migration from legacy
  `[⚙️CONSOLE-CONFIG]` prompt entries if a user brings a Tavern Helper-managed preset into the native extension.
- **Publish / distribution.** Extension repo + install-by-URL, `auto_update`, `i18n` JSONs, `minimum_client_version`.
  Out of scope for the first working build.
- **Dual-target maintenance.** Decide whether to keep the Tavern Helper entry alongside the extension (shared core, two
  thin edges) or retire it once the extension is stable. Leaning: keep both during transition since only the gateway +
  mount diverge.
- **Generalize beyond one preset.** Still explicitly out of scope (see top-level decisions) — the extension stays bound to
  its preset; no cross-preset machinery.
