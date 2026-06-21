<script setup lang="ts">
/**
 * Chat Export tool root.
 *
 * Phase 1: pick a source (active chat / `.jsonl`) → normalize to active-swipe messages.
 * Phase 2 (rules): **排除** removes spans from every message (presets + tag/regex rules);
 * **正文** keeps only matched content as the body on assistant turns; **标题** pins a
 * matched span to the chapter title (`config.title`). A 扫描标签 scanner feeds 排除/正文.
 * Richer before/after preview, chapters and EPUB are Phases 3–5. See `DESIGN.md`.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import Button from '@/ui/Button.vue';
import Segmented from '@/ui/Segmented.vue';
import IconButton from '@/ui/IconButton.vue';
import TextField from '@/ui/TextField.vue';
import Dropdown from '@/ui/Dropdown.vue';
import Section from '@/ui/Section.vue';
import PetIcon, { type IconName } from '@/ui/PetIcon.vue';
import RuleField from './RuleField.vue';
import SelectMark from '@/ui/SelectMark.vue';
import { loadRawMessages } from './chat-source';
import { normalizeMessages, type NormMessage, type RawMessage } from './normalize';
import { extractMessage, ruleError, asTagName, parseRegex, type ExtractConfig, type ReplaceRule } from './extract';
import { scanTags, scanUnclosed } from './scan';
import { loadStRegexGroups, toReplaceRule, previewRule, type StRegexGroup, type RegexScope } from './st-regex';
import { buildChapters, type ChapterRule } from './chapters';
import { chaptersToTxt } from './txt';
import { buildEpub } from './epub';
import { BOOK_CSS, bodyToParagraphs, escapeXml, metaLine, type BookMeta } from './render';
import { STYLE_PRESETS, buildStyleCss, resolveStyleRules, styleRenderOptions, type StyleConfig, type StyleRule } from './style';

const messages = ref<NormMessage[]>([]);
const sourceLabel = ref('');
const error = ref('');
const loading = ref(false);
const dragging = ref(false);
const includeUser = ref(true);
const includeHidden = ref(true);
const insertRoleDivider = ref(false);
const limitRange = ref(false);
const rangeStart = ref(1);
const rangeEnd = ref(1);
const availableMessageCount = ref(0);
const fileInput = ref<HTMLInputElement | null>(null);
const coverInput = ref<HTMLInputElement | null>(null);

// Phase 3 (UX) — split the dense page into steps with a top stepper. Free nav with
// gating: 规则/预览 unlock once a chat is loaded; 导出 lands in Phase 4/5.
type Step = 'source' | 'rules' | 'preview' | 'export';
const step = ref<Step>('source');
const STEPS: { id: Step; label: string }[] = [
  { id: 'source', label: '来源' },
  { id: 'rules', label: '规则' },
  { id: 'preview', label: '预览' },
  { id: 'export', label: '导出' },
];
const hasData = computed(() => messages.value.length > 0);

// Source step state machine — drives the drop-zone icon/treatment and status line.
type SourceState = 'idle' | 'loading' | 'success' | 'error';
const sourceState = computed<SourceState>(() => {
  if (loading.value) return 'loading';
  if (error.value) return 'error';
  if (hasData.value) return 'success';
  return 'idle';
});
const DROP_ICON: Record<SourceState, IconName> = {
  idle: 'upload',
  loading: 'refresh',
  success: 'check',
  error: 'alert',
};
const dropIcon = computed<IconName>(() => DROP_ICON[sourceState.value]);

const activeStepIndex = computed(() => STEPS.findIndex(s => s.id === step.value));
function stepEnabled(id: Step): boolean {
  if (id === 'source') return true;
  return hasData.value;
}
/** A step is "done" (✓) once it's reachable and sits before the active step. */
function stepDone(id: Step, i: number): boolean {
  return stepEnabled(id) && i < activeStepIndex.value;
}
function goStep(id: Step): void {
  if (stepEnabled(id)) step.value = id;
}
// Consistent prev/next navigation shown in the footer, so every step has the same
// Back / Next affordance (steps are also clickable directly).
const canGoBack = computed(() => activeStepIndex.value > 0);
const nextStep = computed<{ id: Step; label: string } | null>(() => STEPS[activeStepIndex.value + 1] ?? null);
function goPrevStep(): void {
  const prev = STEPS[activeStepIndex.value - 1];
  if (prev) goStep(prev.id);
}
function goNextStep(): void {
  if (nextStep.value) goStep(nextStep.value.id);
}
// If a filter change empties the result, fall back to 来源 so a gated step isn't stranded.
watch(hasData, now => {
  if (!now && step.value !== 'source') step.value = 'source';
});

// Phase 2 — strip + extract config (local for now; localStorage persistence is Phase 5).
const stripReasoning = ref(false);
const stripOOC = ref(false);
const stripComments = ref(false);
const stripUnclosed = ref(false);
const excludeRules = ref<string[]>([]);
const includeRules = ref<string[]>([]);
const titleRules = ref<string[]>([]);
const excludeDraft = ref('');
const includeDraft = ref('');
const titleDraft = ref('');

// Tag names the 清理未闭合标签 cleanup is allowed to touch: the chat's balanced structural
// tags + the think presets + any tag the user routed to 排除. Restricting to these keeps a
// stray `<` in prose from being mistaken for an unclosed tag.
const knownTagNames = computed(() => {
  const names = new Set<string>(['think', 'thinking']);
  for (const t of scanTags(messages.value.map(m => m.content))) names.add(t.tag);
  for (const rule of excludeRules.value) {
    const n = asTagName(rule);
    if (n) names.add(n);
  }
  return names;
});
// Unclosed (open/close-unpaired) tags in the chat — surfaced in the scanner so the user
// can see what 清理未闭合标签 will remove, and its live count.
const unclosedTags = computed(() => scanUnclosed(messages.value.map(m => m.content), knownTagNames.value));
const unclosedCount = computed(() => unclosedTags.value.reduce((n, u) => n + u.opens + u.closes, 0));

// 查找替换 — find→replace rules (manual, or imported from ST's regex scripts). Applied
// first, before strip/extract. ST display/prompt regexes aren't in the stored message, so
// re-running them here is the only way to reflect them in the export (see st-regex.ts).
const replaceRules = ref<ReplaceRule[]>([]);
const replaceFindDraft = ref('');
const replaceReplDraft = ref('');
const replaceFindError = computed(() => parseRegex(replaceFindDraft.value).error);

function addReplaceRule(): void {
  const find = replaceFindDraft.value.trim();
  if (!find || replaceFindError.value) return;
  replaceRules.value.push({ find, replace: replaceReplDraft.value });
  replaceFindDraft.value = '';
  replaceReplDraft.value = '';
}
function removeReplaceRule(i: number): void {
  replaceRules.value.splice(i, 1);
}

// ST regex import — an always-visible list inside 查找替换 (like the 扫描 list), loaded
// when the section opens. Each row is one ST regex script; selecting + 导入 turns the
// chosen ones into replace rules below. Keys are `${scope}:${index}`.
const regexGroups = ref<StRegexGroup[]>([]);
const selectedImports = ref<Set<string>>(new Set());
const regexScopeFilter = ref<'all' | RegexScope>('all');
const importableGroups = computed(() => regexGroups.value.filter(g => g.scripts.length));
// 全部 + a tab per non-empty scope, so the filter only offers scopes that actually exist.
const regexScopeOptions = computed(() => [
  { value: 'all', label: '全部' },
  ...importableGroups.value.map(g => ({ value: g.scope, label: g.label })),
]);
const visibleGroups = computed(() =>
  regexScopeFilter.value === 'all' ? importableGroups.value : importableGroups.value.filter(g => g.scope === regexScopeFilter.value),
);

function loadRegexList(): void {
  regexGroups.value = loadStRegexGroups();
  if (!importableGroups.value.some(g => g.scope === regexScopeFilter.value)) regexScopeFilter.value = 'all';
  selectedImports.value = new Set();
}

function toggleImport(key: string): void {
  const next = new Set(selectedImports.value);
  next.has(key) ? next.delete(key) : next.add(key);
  selectedImports.value = next;
}
// Master select-all over the *visible* rows — on / off / partial, mirroring the 扫描 list.
const visibleImportKeys = computed(() => {
  const keys: string[] = [];
  for (const g of visibleGroups.value) g.scripts.forEach((_, i) => keys.push(`${g.scope}:${i}`));
  return keys;
});
const importSelectAllState = computed<'on' | 'off' | 'partial'>(() => {
  const visible = visibleImportKeys.value;
  const sel = visible.filter(k => selectedImports.value.has(k)).length;
  if (!sel) return 'off';
  return sel >= visible.length ? 'on' : 'partial';
});
function toggleImportSelectAll(): void {
  const next = new Set(selectedImports.value);
  if (importSelectAllState.value === 'on') visibleImportKeys.value.forEach(k => next.delete(k));
  else visibleImportKeys.value.forEach(k => next.add(k));
  selectedImports.value = next;
}
function confirmRegexImport(): void {
  for (const g of regexGroups.value) {
    g.scripts.forEach((s, i) => {
      if (!selectedImports.value.has(`${g.scope}:${i}`)) return;
      const rule = toReplaceRule(s);
      if (rule.find.trim()) replaceRules.value.push(rule);
    });
  }
  selectedImports.value = new Set();
}

const config = computed<ExtractConfig>(() => ({
  replace: replaceRules.value,
  strip: { reasoning: stripReasoning.value, ooc: stripOOC.value, comments: stripComments.value, unclosed: stripUnclosed.value },
  unclosedNames: [...knownTagNames.value],
  exclude: excludeRules.value,
  include: includeRules.value,
  title: titleRules.value,
}));

const excludeDraftError = computed(() => ruleError(excludeDraft.value));
const includeDraftError = computed(() => ruleError(includeDraft.value));
const titleDraftError = computed(() => ruleError(titleDraft.value));

// A rule lives in exactly one destination — 排除 / 正文 / 标题 — so adding it to one
// clears it from the other two (a span can't be both stripped and kept, etc.).
function pinRule(target: 'exclude' | 'include' | 'title', v: string): void {
  excludeRules.value = excludeRules.value.filter(r => r !== v);
  includeRules.value = includeRules.value.filter(r => r !== v);
  titleRules.value = titleRules.value.filter(r => r !== v);
  const bucket = { exclude: excludeRules, include: includeRules, title: titleRules }[target];
  bucket.value.push(v);
}
function addExclude(): void {
  const v = excludeDraft.value.trim();
  if (!v || excludeDraftError.value) return;
  pinRule('exclude', v);
  excludeDraft.value = '';
}
function removeExclude(i: number): void {
  excludeRules.value.splice(i, 1);
}
function addInclude(): void {
  const v = includeDraft.value.trim();
  if (!v || includeDraftError.value) return;
  pinRule('include', v);
  includeDraft.value = '';
}
function removeInclude(i: number): void {
  includeRules.value.splice(i, 1);
}
function addTitle(): void {
  const v = titleDraft.value.trim();
  if (!v || titleDraftError.value) return;
  pinRule('title', v);
  titleDraft.value = '';
}
function removeTitle(i: number): void {
  titleRules.value.splice(i, 1);
}

// Tag scanner — list every balanced tag in the chat so the user can click it into a
// bucket. Gated on the scan section disclosure so a big chat isn't re-scanned while
// the section is shut.
const showScan = ref(true);
const showInclude = ref(false);
const showExclude = ref(false);
const showReplace = ref(false);
const scannedTags = computed(() => (showScan.value ? scanTags(messages.value.map(m => m.content)) : []));

// A scanned tag is routed to at most ONE bucket — 不处理 / 排除 / 正文 — so a tag can
// never be both excluded and extracted (which would contradict). Single-select handles it.
type TagBucket = 'none' | 'exclude' | 'include';
const SCAN_BUCKETS: { value: TagBucket; label: string }[] = [
  { value: 'none', label: '不处理' },
  { value: 'exclude', label: '排除' },
  { value: 'include', label: '包含' },
];
function tagBucket(tag: string): TagBucket {
  if (excludeRules.value.includes(tag)) return 'exclude';
  if (includeRules.value.includes(tag)) return 'include';
  return 'none';
}
function setTagBucket(tag: string, bucket: string): void {
  // Routing a scanned tag also clears it from the 标题 set, preserving the single-
  // destination invariant (the scanner itself only offers 不处理 / 排除 / 正文).
  titleRules.value = titleRules.value.filter(t => t !== tag);
  if (bucket === 'exclude' || bucket === 'include') pinRule(bucket, tag);
  else {
    excludeRules.value = excludeRules.value.filter(t => t !== tag);
    includeRules.value = includeRules.value.filter(t => t !== tag);
  }
}

// Multi-select on the scan list so a long tag list can be routed in bulk.
const selectedTags = ref<string[]>([]);
function toggleTagSelect(tag: string): void {
  selectedTags.value = selectedTags.value.includes(tag)
    ? selectedTags.value.filter(t => t !== tag)
    : [...selectedTags.value, tag];
}
function applyBucketToSelected(bucket: TagBucket): void {
  for (const tag of selectedTags.value) setTagBucket(tag, bucket);
  selectedTags.value = [];
}

// Master select-all for the scan list — on / off / partial, mirroring the preset
// console's group master (`SelectMark`).
const selectAllState = computed<'on' | 'off' | 'partial'>(() => {
  const total = scannedTags.value.length;
  const picked = selectedTags.value.length;
  if (total === 0 || picked === 0) return 'off';
  return picked >= total ? 'on' : 'partial';
});
function toggleSelectAll(): void {
  selectedTags.value = selectAllState.value === 'on' ? [] : scannedTags.value.map(t => t.tag);
}

// 清除 — wipe every routed tag/rule on the page (排除 / 正文 / 标题) plus the selection,
// so the user can start the rule set over without re-scanning.
const hasAnyRule = computed(
  () => excludeRules.value.length + includeRules.value.length + titleRules.value.length > 0,
);
function clearAllRules(): void {
  excludeRules.value = [];
  includeRules.value = [];
  titleRules.value = [];
  selectedTags.value = [];
}

// Keep the raw read so toggles can re-filter without re-reading the source.
const rawMessages = ref<RawMessage[]>([]);
const sourceKind = ref<'active' | 'jsonl' | null>(null);

// Phase 3 — before/after preview navigator. Step through messages and compare the
// raw content against the cleaned/extracted body. `navScope` narrows the walk to AI
// turns or to just the flagged messages (empty / unmatched) for focused review.
const focusIndex = ref(0);
// The two flag kinds are separate scopes (different severity), not lumped into one.
type NavScope = 'all' | 'assistant' | 'empty' | 'unmatched';
const navScope = ref<NavScope>('all');

// Per-message diagnostics over the export set (parallel to `messages`): empty after the
// rules (silently dropped) and assistant turns that didn't match 正文/标题 (fell back to
// whole text). One scan, reused by the flag banner *and* the 仅标记 nav filter.
const messageDiags = computed(() => {
  const hasRules = includeRules.value.length > 0 || titleRules.value.length > 0;
  return messages.value.map(m => {
    const ex = extractMessage(m.content, m.role, config.value);
    const empty = !ex.body.trim();
    const unmatched = hasRules && m.role === 'assistant' && !ex.matched;
    return { empty, unmatched, flagged: empty || unmatched };
  });
});
const previewFlags = computed(() => {
  let empty = 0;
  let unmatched = 0;
  let flaggedTotal = 0;
  for (const d of messageDiags.value) {
    if (d.empty) empty++;
    if (d.unmatched) unmatched++;
    if (d.flagged) flaggedTotal++;
  }
  return { empty, unmatched, flaggedTotal };
});

const navMessages = computed(() => {
  if (navScope.value === 'assistant') return messages.value.filter(m => m.role === 'assistant');
  if (navScope.value === 'empty') return messages.value.filter((_, i) => messageDiags.value[i]?.empty);
  if (navScope.value === 'unmatched') return messages.value.filter((_, i) => messageDiags.value[i]?.unmatched);
  return messages.value;
});
// Each flag kind is its own scope option, shown only when it has instances.
const navScopeOptions = computed(() => {
  const opts = [
    { value: 'all', label: '全部' },
    { value: 'assistant', label: '仅 AI' },
  ];
  if (previewFlags.value.empty > 0) opts.push({ value: 'empty', label: `清理后为空 (${previewFlags.value.empty})` });
  if (previewFlags.value.unmatched > 0) opts.push({ value: 'unmatched', label: `未匹配 (${previewFlags.value.unmatched})` });
  return opts;
});
const focused = computed<NormMessage | null>(() => navMessages.value[Math.min(focusIndex.value, navMessages.value.length - 1)] ?? null);
const focusedExtract = computed(() => (focused.value ? extractMessage(focused.value.content, focused.value.role, config.value) : null));

// 1-based position bound to the editable jump field — clamps so typing 999 lands on
// the last message rather than off the end.
const focusPos = computed<number>({
  get: () => Math.min(focusIndex.value + 1, navMessages.value.length),
  set: v => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return;
    focusIndex.value = Math.min(Math.max(1, n), navMessages.value.length) - 1;
  },
});

function focusPrev(): void {
  if (focusIndex.value > 0) focusIndex.value -= 1;
}
function focusNext(): void {
  if (focusIndex.value < navMessages.value.length - 1) focusIndex.value += 1;
}
function resetNav(): void {
  focusIndex.value = 0;
}
function setNavScope(scope: string): void {
  navScope.value = scope as NavScope;
  resetNav();
}

// Jump-to-ST: locate the focused message in SillyTavern's own chat so the user can edit
// the source (only meaningful for the active-chat source). ST lazy-renders recent
// messages; older ones sit behind a #show_more_messages button, so we click it (with a
// tick between each) until the target mesid renders, then scroll + flash it.
const jumpError = ref('');
function stDocument(): Document | null {
  const w = window as unknown as { SillyTavern?: unknown; parent?: { SillyTavern?: unknown; document?: Document } };
  if (w.SillyTavern) return document; // native mount — we're in ST's page
  if (w.parent?.SillyTavern) return w.parent.document ?? null; // iframe mount — ST is the parent
  return null;
}

/**
 * Scroll ST to a message and flash it. ST collapses older messages behind a
 * "Show more messages" button, so a target above it isn't in the DOM. Auto-expanding
 * proved unreliable; instead we jump if it's rendered, else ask the user to expand
 * (the 清理后 header shows the floor number so they know how far to go).
 */
function jumpToStMessage(srcIndex: number): void {
  jumpError.value = '';
  const doc = stDocument();
  if (!doc) {
    jumpError.value = '未能连接到 SillyTavern。';
    return;
  }
  const el = doc.querySelector(`.mes[mesid="${srcIndex}"]`) as HTMLElement | null;
  if (!el) {
    jumpError.value = `第 ${srcIndex} 层未在 ST 中显示，可能被「Show more messages」折叠——请在 ST 里点开较早的消息后再试。`;
    return;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const prev = el.style.backgroundColor;
  el.style.transition = 'background-color 0.4s';
  el.style.backgroundColor = 'rgba(255, 196, 0, 0.28)';
  setTimeout(() => {
    el.style.backgroundColor = prev;
  }, 1400);
}
// If rule edits make the current scope vanish (e.g. all empties fixed), fall back to 全部.
watch(navScopeOptions, opts => {
  if (!opts.some(o => o.value === navScope.value)) setNavScope('all');
});

// Phase 4 — book metadata, chapter splitting, export.
const bookTitle = ref('');
const bookAuthor = ref('');
const bookLang = ref('zh');
const includeCover = ref(false);
const coverName = ref('');
const coverPreviewUrl = ref('');
const coverData = ref<Uint8Array | null>(null);
const coverError = ref('');
const coverDragging = ref(false);
type ChapterRuleKind = 'per-assistant' | 'per-message' | 'title' | 'every';
const chapterRuleKind = ref<ChapterRuleKind>('per-assistant');
const everyN = ref(5);

// Typography (排版样式) — tiered: one-click presets first, advanced custom rules + CSS behind a disclosure.
const stylePresets = ref<string[]>([]);
const styleRules = ref<StyleRule[]>([]);
const stylePatternDraft = ref('');
const styleClassDraft = ref('');
const styleCss = ref('');
const styleConfig = computed<StyleConfig>(() => ({
  presets: stylePresets.value,
  rules: styleRules.value,
  css: styleCss.value,
}));
const stylePatternError = computed(() => ruleError(stylePatternDraft.value));

function togglePreset(id: string): void {
  const i = stylePresets.value.indexOf(id);
  if (i >= 0) stylePresets.value.splice(i, 1);
  else stylePresets.value.push(id);
}
function addStyleRule(): void {
  const pattern = stylePatternDraft.value.trim();
  if (!pattern || stylePatternError.value) return;
  styleRules.value.push({ pattern, className: styleClassDraft.value.trim() || 'st-custom' });
  stylePatternDraft.value = '';
  styleClassDraft.value = '';
}
function removeStyleRule(i: number): void {
  styleRules.value.splice(i, 1);
}

const CHAPTER_RULE_OPTIONS: { value: ChapterRuleKind; label: string; hint: string }[] = [
  { value: 'per-assistant', label: '每条 AI 回复一章', hint: '每遇到一条 AI 回复就开新的一章；中间的用户楼层会并入上一章的正文。' },
  { value: 'per-message', label: '每条消息各自一章', hint: '每条消息单独成一章，用户与 AI 楼层各占一章。' },
  { value: 'title', label: '按「标题」分章', hint: '每捕获到一个「标题」规则的匹配就开新章（需在上一步设置标题规则）。' },
  { value: 'every', label: '每 N 条消息一章', hint: '按固定条数把连续消息合并成一章。' },
];
const chapterRuleHint = computed(() => CHAPTER_RULE_OPTIONS.find(o => o.value === chapterRuleKind.value)?.hint ?? '');
const LANG_OPTIONS = [
  { value: 'zh', label: '中文 (zh)' },
  { value: 'en', label: 'English (en)' },
  { value: 'ja', label: '日本語 (ja)' },
];

const chapterRule = computed<ChapterRule>(() =>
  chapterRuleKind.value === 'every' ? { kind: 'every', n: everyN.value } : { kind: chapterRuleKind.value },
);
const chapters = computed(() =>
  buildChapters(messages.value, config.value, chapterRule.value, {
    roleDivider: insertRoleDivider.value ? '---' : undefined,
  }),
);
// The chapter-list preview shows a window of PREVIEW_WINDOW chapters from `previewStart`,
// so big books can be previewed past chapter 5. clampedStart keeps it in range.
const PREVIEW_WINDOW = 5;
const previewStart = ref(1);
const clampedStart = computed(() => Math.min(Math.max(1, Math.floor(previewStart.value) || 1), Math.max(1, chapters.value.length)));
const chaptersPreview = computed(() => chapters.value.slice(clampedStart.value - 1, clampedStart.value - 1 + PREVIEW_WINDOW));
const previewEnd = computed(() => Math.min(chapters.value.length, clampedStart.value + PREVIEW_WINDOW - 1));
const selectedChapterIndex = ref(1);
const selectedChapter = computed(() => chapters.value.find(ch => ch.index === selectedChapterIndex.value) ?? chapters.value[0] ?? null);
// Moving the window jumps the rendered preview to its first chapter.
watch(clampedStart, s => {
  selectedChapterIndex.value = s;
});

/**
 * A WYSIWYG render of the selected chapter for the ④ preview: the exact EPUB XHTML +
 * stylesheet (BOOK_CSS + the enabled styles) inside a sandboxed iframe, so the book's
 * bare-element CSS is isolated from the panel and users see dialogue/italics/drop cap/
 * dividers as they'll ship. An approximation of a reader, but the real markup + CSS.
 */
const previewDoc = computed(() => {
  const ch = selectedChapter.value;
  if (!ch) return '';
  const extra = buildStyleCss(styleConfig.value);
  const css = extra ? `${BOOK_CSS}\n${extra}` : BOOK_CSS;
  const lang = escapeXml(bookLang.value || 'zh');
  const body = bodyToParagraphs(ch.body, resolveStyleRules(styleConfig.value), styleRenderOptions(styleConfig.value));
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"/><style>${css}</style></head><body><section class="chapter"><h1>${escapeXml(ch.title)}</h1>${metaLine(ch.meta)}${body}</section></body></html>`;
});
const rangeSummary = computed(() =>
  limitRange.value && availableMessageCount.value
    ? `导出第 ${rangeStart.value}-${rangeEnd.value} 条，共 ${messages.value.length} 条`
    : `当前共 ${availableMessageCount.value} 条`,
);

const bookMeta = computed<BookMeta>(() => ({
  title: bookTitle.value.trim() || '未命名',
  author: bookAuthor.value.trim(),
  language: bookLang.value,
  cover: includeCover.value && coverData.value
    ? {
        data: coverData.value,
        mediaType: 'image/jpeg',
        href: 'cover.jpg',
      }
    : null,
}));

/** Default the book title to the character (assistant) name once a chat is read. */
function seedBookMeta(): void {
  if (bookTitle.value) return;
  const asst = messages.value.find(m => m.role === 'assistant');
  bookTitle.value = asst?.name || messages.value[0]?.name || '';
}

function snippet(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 50 ? `${clean.slice(0, 50)}…` : clean;
}

function download(filename: string, data: BlobPart, mime: string): void {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportTxt(): void {
  download(`${bookMeta.value.title}.txt`, chaptersToTxt(chapters.value, bookMeta.value), 'text/plain;charset=utf-8');
}

function exportEpub(): void {
  download(`${bookMeta.value.title}.epub`, buildEpub(chapters.value, bookMeta.value, styleConfig.value), 'application/epub+zip');
}

function revokeCoverPreview(): void {
  if (coverPreviewUrl.value) URL.revokeObjectURL(coverPreviewUrl.value);
  coverPreviewUrl.value = '';
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

async function processCover(file: File): Promise<void> {
  coverError.value = '';
  if (!file.type.startsWith('image/')) {
    coverError.value = '请选择图片文件。';
    return;
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image load failed'));
    });
    img.src = url;
    await loaded;

    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error('cover encode failed');
    coverData.value = await blobToUint8Array(blob);
    coverName.value = file.name;
    revokeCoverPreview();
    coverPreviewUrl.value = URL.createObjectURL(blob);
  } catch {
    coverError.value = '封面处理失败。';
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function onCoverFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await processCover(file);
  input.value = '';
}

async function onCoverDrop(event: DragEvent): Promise<void> {
  coverDragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) await processCover(file);
}

function clearCover(): void {
  coverName.value = '';
  coverData.value = null;
  coverError.value = '';
  revokeCoverPreview();
}
watch(chapters, now => {
  if (!now.some(ch => ch.index === selectedChapterIndex.value)) selectedChapterIndex.value = now[0]?.index ?? 1;
});

// Remember the rule set across sessions (best-effort; opaque-origin storage is fine to fail).
const RULES_KEY = 'cexRules';
function saveRules(): void {
  try {
    window.localStorage?.setItem(
      RULES_KEY,
      JSON.stringify({
        stripReasoning: stripReasoning.value,
        stripOOC: stripOOC.value,
        stripComments: stripComments.value,
        stripUnclosed: stripUnclosed.value,
        replace: replaceRules.value,
        exclude: excludeRules.value,
        include: includeRules.value,
        title: titleRules.value,
        insertRoleDivider: insertRoleDivider.value,
        limitRange: limitRange.value,
        rangeStart: rangeStart.value,
        rangeEnd: rangeEnd.value,
        chapterRuleKind: chapterRuleKind.value,
        everyN: everyN.value,
        stylePresets: stylePresets.value,
        styleRules: styleRules.value,
        styleCss: styleCss.value,
      }),
    );
  } catch {
    /* ignore */
  }
}
function loadRules(): void {
  try {
    const raw = window.localStorage?.getItem(RULES_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (typeof d.stripReasoning === 'boolean') stripReasoning.value = d.stripReasoning;
    if (typeof d.stripOOC === 'boolean') stripOOC.value = d.stripOOC;
    if (typeof d.stripComments === 'boolean') stripComments.value = d.stripComments;
    if (typeof d.stripUnclosed === 'boolean') stripUnclosed.value = d.stripUnclosed;
    if (Array.isArray(d.replace))
      replaceRules.value = d.replace
        .filter((x: unknown): x is ReplaceRule => !!x && typeof (x as ReplaceRule).find === 'string' && typeof (x as ReplaceRule).replace === 'string')
        .map((x: ReplaceRule) => ({ find: x.find, replace: x.replace }));
    if (Array.isArray(d.exclude)) excludeRules.value = d.exclude.filter((x: unknown) => typeof x === 'string');
    if (Array.isArray(d.include)) includeRules.value = d.include.filter((x: unknown) => typeof x === 'string');
    if (Array.isArray(d.title)) titleRules.value = d.title.filter((x: unknown) => typeof x === 'string');
    if (typeof d.insertRoleDivider === 'boolean') insertRoleDivider.value = d.insertRoleDivider;
    if (typeof d.limitRange === 'boolean') limitRange.value = d.limitRange;
    if (Number.isFinite(d.rangeStart)) rangeStart.value = d.rangeStart;
    if (Number.isFinite(d.rangeEnd)) rangeEnd.value = d.rangeEnd;
    if (['per-assistant', 'per-message', 'title', 'every'].includes(d.chapterRuleKind)) chapterRuleKind.value = d.chapterRuleKind;
    if (Number.isFinite(d.everyN)) everyN.value = d.everyN;
    if (Array.isArray(d.stylePresets)) stylePresets.value = d.stylePresets.filter((x: unknown) => typeof x === 'string');
    if (Array.isArray(d.styleRules))
      styleRules.value = d.styleRules
        .filter((x: unknown): x is StyleRule => !!x && typeof (x as StyleRule).pattern === 'string' && typeof (x as StyleRule).className === 'string')
        .map((x: StyleRule) => ({ pattern: x.pattern, className: x.className }));
    if (typeof d.styleCss === 'string') styleCss.value = d.styleCss;
  } catch {
    /* ignore malformed */
  }
}
onMounted(loadRules);
onUnmounted(revokeCoverPreview);
watch(
  [stripReasoning, stripOOC, stripComments, stripUnclosed, replaceRules, excludeRules, includeRules, titleRules, insertRoleDivider, limitRange, rangeStart, rangeEnd, chapterRuleKind, everyN, stylePresets, styleRules, styleCss],
  saveRules,
  { deep: true },
);
watch([limitRange, rangeStart, rangeEnd], () => {
  if (rawMessages.value.length) applyFilters();
});
// (Re)read ST's regex scripts whenever 查找替换 opens — picks up a preset/character switch.
watch(showReplace, open => open && loadRegexList());

/** Assistant turns whose 正文/标题 rules matched nothing (the 缺层 warning). */
const unmatchedCount = computed(() => {
  if (includeRules.value.length === 0 && titleRules.value.length === 0) return 0;
  return messages.value.reduce(
    (n, m) => (m.role === 'assistant' && !extractMessage(m.content, m.role, config.value).matched ? n + 1 : n),
    0,
  );
});

function applyFilters(): void {
  // System / narrator messages (/sys, /comment) are never wanted in an e-book, so
  // they stay excluded (normalize defaults includeSystem to false) — no UI toggle.
  const normalized = normalizeMessages(rawMessages.value, {
    includeUser: includeUser.value,
    includeHidden: includeHidden.value,
  });
  availableMessageCount.value = normalized.length;
  if (rangeEnd.value < 1 || rangeEnd.value > availableMessageCount.value) rangeEnd.value = availableMessageCount.value || 1;
  rangeStart.value = Math.min(Math.max(1, Math.floor(Number(rangeStart.value) || 1)), Math.max(availableMessageCount.value, 1));
  rangeEnd.value = Math.min(Math.max(rangeStart.value, Math.floor(Number(rangeEnd.value) || rangeStart.value)), Math.max(availableMessageCount.value, 1));
  messages.value = limitRange.value ? normalized.slice(rangeStart.value - 1, rangeEnd.value) : normalized;
  resetNav();
  seedBookMeta();
}

async function readActiveChat(): Promise<void> {
  error.value = '';
  loading.value = true;
  try {
    rawMessages.value = await loadRawMessages({ kind: 'active' });
    sourceKind.value = 'active';
    applyFilters();
    sourceLabel.value = '当前聊天';
    if (messages.value.length === 0) error.value = '未读取到聊天消息（确认 SillyTavern 已打开一段对话）。';
    else step.value = 'rules';
  } catch {
    error.value = '读取当前聊天失败。';
  } finally {
    loading.value = false;
  }
}

async function readJsonlText(text: string, label: string): Promise<void> {
  error.value = '';
  loading.value = true;
  try {
    rawMessages.value = await loadRawMessages({ kind: 'jsonl', text });
    sourceKind.value = 'jsonl';
    applyFilters();
    sourceLabel.value = label;
    if (messages.value.length === 0) error.value = '该文件未解析出任何消息。';
    else step.value = 'rules';
  } finally {
    loading.value = false;
  }
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    await readJsonlText(await file.text(), file.name);
  } catch {
    error.value = '读取文件失败。';
  } finally {
    input.value = '';
  }
}

async function onDrop(event: DragEvent): Promise<void> {
  dragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  try {
    await readJsonlText(await file.text(), file.name);
  } catch {
    error.value = '读取文件失败。';
  }
}
</script>

<template>
  <div class="cex">
    <ol class="cex__steps">
      <li v-for="(s, i) in STEPS" :key="s.id" class="cex__stepli">
        <button
          type="button"
          class="cex__step"
          :class="{
            'cex__step--active': step === s.id,
            'cex__step--done': stepDone(s.id, i),
            'cex__step--disabled': !stepEnabled(s.id),
          }"
          :disabled="!stepEnabled(s.id)"
          @click="goStep(s.id)"
        >
          <span class="cex__stepbar" aria-hidden="true" />
          <span class="cex__steprow">
            <span class="cex__stepnum">
              <PetIcon v-if="stepDone(s.id, i)" name="check" />
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span class="cex__steplabel">{{ s.label }}</span>
          </span>
        </button>
      </li>
    </ol>

    <div class="cex__scroll">
    <section v-show="step === 'source'" class="cex__panel">
      <h2 class="cex__title">聊天来源</h2>
      <p class="cex__lead">选择要导出的聊天，作为电子书的内容来源。</p>

      <!-- Hero load zone: one place to pick a source — drag a .jsonl, or use the
           buttons. The icon + border reflect idle / loading / success / error.
           `.stop` keeps the drop from bubbling to SillyTavern's body-level importer,
           which would otherwise reject a .jsonl with "Unsupported file type". -->
      <div
        class="cex__drop"
        :class="[`cex__drop--${sourceState}`, { 'cex__drop--over': dragging }]"
        @dragover.prevent.stop="dragging = true"
        @dragleave.prevent.stop="dragging = false"
        @drop.prevent.stop="onDrop"
      >
        <span class="cex__dropicon" :class="{ 'cex__dropicon--spin': sourceState === 'loading' }">
          <PetIcon :name="dropIcon" />
        </span>
        <p class="cex__drophint">把 <code>.jsonl</code> 文件拖到这里</p>
        <div class="cex__dropbtns">
          <span class="cex__dropor">或</span>
          <Button size="sm" icon="refresh" :disabled="loading" @click="readActiveChat">读取当前聊天</Button>
          <Button size="sm" variant="secondary" icon="upload" :disabled="loading" @click="fileInput?.click()">导入 .jsonl</Button>
        </div>
        <input ref="fileInput" class="cex__file" type="file" accept=".jsonl,application/json" @change="onFile" />
      </div>

      <!-- Status line, mirroring the zone state -->
      <p v-if="sourceState === 'loading'" class="cex__status">
        <PetIcon name="refresh" class="cex__status-spin" /> 读取中…
      </p>
      <p v-else-if="sourceState === 'error'" class="cex__status cex__status--error">
        <PetIcon name="alert" /> {{ error }}
      </p>
      <p v-else-if="sourceState === 'success'" class="cex__status cex__status--ok">
        <PetIcon name="check" /> 已载入「{{ sourceLabel }}」· 共 {{ messages.length }} 条消息
      </p>
    </section>

    <section v-show="step === 'rules'" class="cex__panel">
      <h2 class="cex__title">整理规则</h2>
      <p class="cex__lead">挑出要进书的内容，去掉不想要的部分。</p>

      <!-- Scanner on top: quick scan routes tags into 包含 / 排除 below. -->
      <Section v-model:open="showScan" title="扫描" :default-open="true" size="sm">
        <p v-if="!scannedTags.length && !unclosedTags.length" class="cex__hint">未发现成对标签。</p>
        <template v-if="scannedTags.length">
          <!-- Header row: keep the batch control mounted so selecting rows never
               changes the toolbar height. -->
          <div class="cex__scanhead">
            <button type="button" class="cex__scanpick cex__scanall" @click="toggleSelectAll">
              <SelectMark type="checkbox" :state="selectAllState" size="sm" />
              <span class="cex__scanall-label">全选</span>
            </button>
            <div class="cex__scanbatch" :class="{ 'cex__scanbatch--idle': !selectedTags.length }" :aria-hidden="!selectedTags.length">
              <span class="cex__scanbatch-count">{{ selectedTags.length ? `已选 ${selectedTags.length} 项` : '未选择' }}</span>
              <Segmented
                size="sm"
                :model-value="''"
                :options="SCAN_BUCKETS"
                :disabled="!selectedTags.length"
                @update:model-value="applyBucketToSelected($event as TagBucket)"
              />
            </div>
          </div>
          <div class="cex__scanlist">
            <div v-for="t in scannedTags" :key="t.tag" class="cex__scanrow">
              <button type="button" class="cex__scanpick" @click="toggleTagSelect(t.tag)">
                <SelectMark type="checkbox" :state="selectedTags.includes(t.tag) ? 'on' : 'off'" size="sm" />
                <code class="cex__scantag">&lt;{{ t.tag }}&gt;</code>
                <span class="cex__scancount">×{{ t.count }}</span>
              </button>
              <Segmented
                size="sm"
                :model-value="tagBucket(t.tag)"
                :options="SCAN_BUCKETS"
                @update:model-value="setTagBucket(t.tag, $event)"
              />
            </div>
          </div>
        </template>
        <!-- 未闭合 — orphan/dangling tags the balanced list can't show; one toggle cleans them
             (mirrors the 排除内容 checkbox so it's actionable right where it's surfaced). -->
        <div v-if="unclosedTags.length" class="cex__unclosed">
          <div class="cex__unclosed-head">
            <span class="cex__unclosed-title">未闭合标签</span>
            <span class="cex__scancount">{{ unclosedCount }}</span>
          </div>
          <div class="cex__unclosed-tags">
            <code v-for="u in unclosedTags" :key="u.tag" class="cex__scantag" :title="`残缺开 ${u.opens} · 残缺闭 ${u.closes}`">&lt;{{ u.tag }}&gt;</code>
          </div>
          <label class="cex__opt cex__unclosed-opt" title="截断的 <tag> 删到段末，多余的 </tag> 删到段首（会丢弃残段，请在预览确认）">
            <input type="checkbox" v-model="stripUnclosed" /> 清理未闭合标签
          </label>
        </div>
      </Section>

      <!-- INCLUDE — which messages go in, and which spans become body / title. -->
      <Section v-model:open="showInclude" title="包含内容" :default-open="false" size="sm">
        <p class="cex__desc">选择哪些楼层进书，以及每段保留哪些内容作为标题 / 正文。</p>
        <div class="cex__opts cex__opts--inline">
          <label class="cex__opt"><input type="checkbox" v-model="includeUser" @change="applyFilters" /> 包含用户发言</label>
          <label class="cex__opt" title="被 /hide 隐藏的真实楼层（常为省 token 而隐藏，通常仍要收进书里）">
            <input type="checkbox" v-model="includeHidden" @change="applyFilters" /> 包含隐藏楼层
          </label>
          <label class="cex__opt" title="导出时在用户与 AI 楼层切换处插入分隔线">
            <input type="checkbox" v-model="insertRoleDivider" /> 角色分隔线
          </label>
        </div>
        <div class="cex__range">
          <label class="cex__opt"><input type="checkbox" v-model="limitRange" /> 限制楼层范围</label>
          <div class="cex__range-fields" :class="{ 'cex__range-fields--off': !limitRange }">
            <TextField v-model="rangeStart" class="cex__range-input cex__numfield" type="number" compact min="1" :max="availableMessageCount" :disabled="!limitRange" />
            <span class="cex__range-sep">-</span>
            <TextField v-model="rangeEnd" class="cex__range-input cex__numfield" type="number" compact min="1" :max="availableMessageCount" :disabled="!limitRange" />
          </div>
          <span class="cex__range-count" :title="rangeSummary">{{ rangeSummary }}</span>
        </div>
        <RuleField
          label="标题"
          v-model="titleDraft"
          :rules="titleRules"
          :error="titleDraftError"
          placeholder="标签名 title，或正则 (?<title>…) — 回车添加"
          @add="addTitle"
          @remove="removeTitle"
        />
        <RuleField
          label="正文"
          v-model="includeDraft"
          :rules="includeRules"
          :error="includeDraftError"
          placeholder="标签名 正文 / body，或正则 — 回车添加"
          @add="addInclude"
          @remove="removeInclude"
        />
        <p v-if="unmatchedCount" class="cex__warn">⚠ {{ unmatchedCount }} 条 AI 楼层未匹配规则（正文回退为整段）。</p>
      </Section>

      <!-- EXCLUDE — strip spans out of every message (presets + custom rules). -->
      <Section v-model:open="showExclude" title="排除内容" :default-open="false" size="sm">
        <p class="cex__desc">从每条消息中删除以下内容，不写进书里。</p>
        <div class="cex__opts">
          <label class="cex__opt"><input type="checkbox" v-model="stripReasoning" /> 去除 &lt;think&gt;</label>
          <label class="cex__opt" title="去除 (OOC: …) / （OOC：…） 等剧情外旁注">
            <input type="checkbox" v-model="stripOOC" /> 去除 OOC 旁注
          </label>
          <label class="cex__opt" title="去除 HTML 注释 &lt;!-- … --&gt;">
            <input type="checkbox" v-model="stripComments" /> 去除注释
          </label>
          <label class="cex__opt" title="删除未成对的标签：截断的 <tag> 删到段末，多余的 </tag> 删到段首（会丢弃残段，请在预览确认）">
            <input type="checkbox" v-model="stripUnclosed" /> 清理未闭合标签<template v-if="unclosedCount"> ({{ unclosedCount }})</template>
          </label>
        </div>
        <RuleField
          v-model="excludeDraft"
          :rules="excludeRules"
          :error="excludeDraftError"
          placeholder="标签名 think，或正则 /pat/flags — 回车添加"
          @add="addExclude"
          @remove="removeExclude"
        />
      </Section>

      <!-- REPLACE — find→replace cleanup; import existing ST regexes or add manually. -->
      <Section v-model:open="showReplace" title="查找替换" :default-open="false" size="sm">
        <p class="cex__desc">导入 ST 现有正则，或自定义查找→替换（留空即删除）。</p>

        <!-- ST regex list — same shape as 扫描: scope filter, then a 全选 master that swaps
             for a batch 导入 bar once rows are selected. Auto-loaded when the section opens. -->
        <template v-if="importableGroups.length">
          <Segmented
            v-if="regexScopeOptions.length > 2"
            size="sm"
            :model-value="regexScopeFilter"
            :options="regexScopeOptions"
            class="cex__scopefilter"
            @update:model-value="regexScopeFilter = $event as 'all' | RegexScope"
          />
          <div class="cex__scanhead">
            <button type="button" class="cex__scanpick cex__scanall" @click="toggleImportSelectAll">
              <SelectMark type="checkbox" :state="importSelectAllState" size="sm" />
              <span class="cex__scanall-label">全选</span>
            </button>
            <div class="cex__scanbatch" :class="{ 'cex__scanbatch--idle': !selectedImports.size }" :aria-hidden="!selectedImports.size">
              <span class="cex__scanbatch-count">{{ selectedImports.size ? `已选 ${selectedImports.size} 项` : '未选择' }}</span>
              <Button variant="primary" size="sm" :disabled="!selectedImports.size" @click="confirmRegexImport">导入</Button>
            </div>
          </div>
          <div class="cex__scanlist cex__importlist">
            <div v-for="g in visibleGroups" :key="g.scope" class="cex__import-group">
              <div v-if="regexScopeFilter === 'all'" class="cex__import-scope">{{ g.label }}</div>
              <div v-for="(s, i) in g.scripts" :key="i" class="cex__scanrow">
                <button type="button" class="cex__scanpick" @click="toggleImport(`${g.scope}:${i}`)">
                  <SelectMark type="checkbox" :state="selectedImports.has(`${g.scope}:${i}`) ? 'on' : 'off'" size="sm" />
                  <span class="cex__import-info">
                    <span class="cex__import-name">{{ s.scriptName || '未命名' }}<span v-if="s.disabled" class="cex__import-off"> · 已停用</span></span>
                    <code class="cex__import-rule">{{ previewRule(s) }}</code>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </template>
        <p v-else class="cex__hint">未发现可导入的 ST 正则。</p>

        <div class="cex-rule">
          <div class="cex-rule__row cex__stylerule">
            <TextField v-model="replaceFindDraft" mono :invalid="!!replaceFindError" spellcheck="false" placeholder="查找，如 /——/g" @keyup.enter="addReplaceRule" />
            <TextField v-model="replaceReplDraft" mono spellcheck="false" placeholder="替换为（留空 = 删除）" class="cex__styleclass" @keyup.enter="addReplaceRule" />
            <Button variant="secondary" size="sm" :disabled="!replaceFindDraft.trim() || !!replaceFindError" @click="addReplaceRule">添加</Button>
          </div>
          <p v-if="replaceFindError" class="cex-rule__error">正则错误：{{ replaceFindError }}</p>
          <div v-if="replaceRules.length" class="cex-rule__chips">
            <span v-for="(r, i) in replaceRules" :key="i" class="cex-rule__chip">
              <code>{{ r.find }}</code> → <code>{{ r.replace || '〔删除〕' }}</code>
              <IconButton name="close" title="移除" danger class="cex-rule__chip-x" @click="removeReplaceRule(i)" />
            </span>
          </div>
        </div>
      </Section>
    </section>

    <section v-show="step === 'preview'" class="cex__panel">
      <h2 class="cex__title">预览效果</h2>
      <p class="cex__lead">逐条对比原文与整理后的正文，确认规则符合预期。</p>

      <!-- Health flags: each whole row is a button that scopes the nav to just those messages. -->
      <div v-if="previewFlags.empty || previewFlags.unmatched" class="cex__flags">
        <button v-if="previewFlags.empty" type="button" class="cex__flag cex__flag--high" title="筛选查看这些消息" @click="setNavScope('empty')">
          <PetIcon name="alert" />
          <span>{{ previewFlags.empty }} 条消息清理后为空，不会写入电子书。</span>
          <PetIcon name="chevron-right" class="cex__flag-go" />
        </button>
        <button v-if="previewFlags.unmatched" type="button" class="cex__flag" title="筛选查看这些消息" @click="setNavScope('unmatched')">
          <PetIcon name="alert" />
          <span>{{ previewFlags.unmatched }} 条 AI 消息未匹配正文 / 标题规则，已回退为整段原文。</span>
          <PetIcon name="chevron-right" class="cex__flag-go" />
        </button>
      </div>

      <!-- Phase 3: after / before preview -->
      <div v-if="focused && focusedExtract" class="cex__preview">
        <div class="cex__pvnav">
          <IconButton name="chevron-left" title="上一条" :disabled="focusIndex <= 0" @click="focusPrev" />
          <span class="cex__pvpos">
            第
            <TextField
              class="cex__numfield"
              type="number"
              :model-value="focusPos"
              min="1"
              :max="navMessages.length"
              @update:model-value="focusPos = Number($event)"
            />
            / {{ navMessages.length }} 条
          </span>
          <IconButton name="chevron-right" title="下一条" :disabled="focusIndex >= navMessages.length - 1" @click="focusNext" />
          <Dropdown class="cex__pvscope" variant="inline" align="right" :model-value="navScope" :options="navScopeOptions" @update:model-value="setNavScope" />
        </div>
        <p v-if="jumpError" class="cex__warn cex__jumperror">{{ jumpError }}</p>
        <div class="cex__diff">
          <!-- After first — the result the user is verifying. -->
          <div class="cex__pane">
            <div class="cex__pvhead">
              <span class="cex__panelabel">清理后<span class="cex__floor" title="该消息在原聊天中的楼层号">#{{ focused.srcIndex }}</span></span>
              <span class="cex__pvhead-tags">
                <span v-for="(val, key) in focusedExtract.fields" :key="key" class="cex__field">{{ key }}: {{ val }}</span>
                <span v-if="!focusedExtract.body.trim()" class="cex__nomatch" title="清理后为空，不会写入电子书">空</span>
                <span
                  v-else-if="(includeRules.length || titleRules.length) && focused.role === 'assistant' && !focusedExtract.matched"
                  class="cex__nomatch"
                  title="未匹配正文 / 标题规则，已回退为整段"
                >未匹配</span>
              </span>
            </div>
            <div class="cex__panebody cex__panebody--after">{{ focusedExtract.body }}</div>
          </div>
          <!-- Before — the raw message: card name (+ hidden) left, role icon right. -->
          <div class="cex__pane">
            <div class="cex__pvhead">
              <span class="cex__pvhead-name">
                <span class="cex__name">{{ focused.name }}</span>
                <span v-if="focused.hidden" class="cex__hidden" title="被 /hide 隐藏的楼层">隐藏</span>
              </span>
              <span
                class="cex__role"
                :class="`cex__role--${focused.role}`"
                :title="focused.role === 'assistant' ? 'AI 楼层' : '用户楼层'"
              >
                <PetIcon :name="focused.role === 'assistant' ? 'bot' : 'user'" />
              </span>
            </div>
            <div class="cex__panebody">{{ focused.content }}</div>
          </div>
        </div>
      </div>
    </section>

    <section v-show="step === 'export'" class="cex__panel">
      <h2 class="cex__title">生成电子书</h2>
      <p class="cex__lead">填好书籍信息与分章方式，导出 EPUB 或 TXT。</p>

      <Section title="书籍信息" :collapsible="false" size="sm">
        <label class="cex__metafield">标题<TextField v-model="bookTitle" class="cex__field-grow" /></label>
        <label class="cex__metafield">作者<TextField v-model="bookAuthor" class="cex__field-grow" placeholder="可留空" /></label>
        <label class="cex__metafield">语言
          <Dropdown v-model="bookLang" class="cex__field-grow" :options="LANG_OPTIONS" />
        </label>
        <div class="cex__coverfield">
          <label class="cex__opt"><input type="checkbox" v-model="includeCover" /> 添加封面</label>
          <div
            v-if="includeCover"
            class="cex__coverdrop"
            :class="{ 'cex__coverdrop--over': coverDragging }"
            @click="coverInput?.click()"
            @dragover.prevent.stop="coverDragging = true"
            @dragleave.prevent.stop="coverDragging = false"
            @drop.prevent.stop="onCoverDrop"
          >
            <button type="button" class="cex__cover-thumb" :class="{ 'cex__cover-thumb--empty': !coverPreviewUrl }">
                <img v-if="coverPreviewUrl" :src="coverPreviewUrl" alt="" />
                <PetIcon v-else name="upload" />
            </button>
            <div class="cex__cover-main">
              <p class="cex__cover-name">{{ coverData ? `${coverName}（已压缩）` : '把图片拖到这里' }}</p>
              <div class="cex__cover-actions" @click.stop>
                <Button size="sm" variant="secondary" icon="upload" @click="coverInput?.click()">{{ coverData ? '更换封面' : '上传封面' }}</Button>
                <Button v-if="coverData" size="sm" variant="ghost" @click="clearCover">移除封面</Button>
              </div>
              <p v-if="coverError" class="cex__warn">{{ coverError }}</p>
            </div>
          </div>
          <input ref="coverInput" class="cex__file" type="file" accept="image/*" @change="onCoverFile" />
        </div>
      </Section>

      <Section title="章节切分" :collapsible="false" size="sm">
        <Dropdown
          class="cex__chaprule"
          :model-value="chapterRuleKind"
          :options="CHAPTER_RULE_OPTIONS"
          @update:model-value="chapterRuleKind = $event as ChapterRuleKind"
        />
        <p class="cex__hint">{{ chapterRuleHint }}</p>
        <label v-if="chapterRuleKind === 'every'" class="cex__metafield">
          每章条数<TextField v-model="everyN" type="number" compact min="1" />
        </label>

        <div class="cex__chaphead">
          <p class="cex__count">共 {{ chapters.length }} 章<span v-if="limitRange"> · 第 {{ rangeStart }}-{{ rangeEnd }} 条</span></p>
          <label v-if="chapters.length > PREVIEW_WINDOW" class="cex__metafield cex__chapstart">
            预览起始章
            <TextField class="cex__numfield" :model-value="String(clampedStart)" type="number" compact min="1" :max="chapters.length" @update:model-value="previewStart = Math.floor(Number($event)) || 1" />
          </label>
        </div>
        <ol class="cex__chaplist">
          <li v-for="ch in chaptersPreview" :key="ch.index">
            <button type="button" class="cex__chap" :class="{ 'cex__chap--active': selectedChapter?.index === ch.index }" @click="selectedChapterIndex = ch.index">
              <span class="cex__chaptitle">{{ ch.index }}. {{ ch.title }}</span>
            </button>
          </li>
        </ol>
        <p v-if="chapters.length > PREVIEW_WINDOW" class="cex__more">显示第 {{ clampedStart }}–{{ previewEnd }} 章（共 {{ chapters.length }} 章）</p>
        <div v-if="selectedChapter" class="cex__chappreview">
          <div class="cex__pvhead">
            <span class="cex__panelabel">{{ selectedChapter.title }}</span>
            <span class="cex__field">第 {{ selectedChapter.index }} 章</span>
          </div>
          <iframe class="cex__chappreview-frame" :srcdoc="previewDoc" sandbox="" title="EPUB 预览"></iframe>
          <p class="cex__hint">近似渲染，实际显示因阅读器而异。</p>
        </div>
      </Section>

      <Section title="排版样式" :collapsible="false" size="sm">
        <p class="cex__hint">为 EPUB 正文添加排版样式（TXT 导出不受影响）。</p>
        <ul class="cex__styles">
          <li v-for="p in STYLE_PRESETS" :key="p.id" class="cex__style">
            <label class="cex__opt">
              <input type="checkbox" :checked="stylePresets.includes(p.id)" @change="togglePreset(p.id)" /> {{ p.label }}
            </label>
            <p class="cex__stylehint">{{ p.hint }}</p>
          </li>
        </ul>

        <Section title="高级：自定义规则与 CSS" size="sm" :default-open="false">
          <p class="cex__hint">「匹配」填标签名或 <code>/正则/修饰符</code>；命中文本会套上你填的类名，再由下方 CSS 控制外观。</p>
          <div class="cex-rule">
            <div class="cex-rule__row cex__stylerule">
              <TextField v-model="stylePatternDraft" mono :invalid="!!stylePatternError" spellcheck="false" placeholder="匹配，如 /「.*?」/ 或 voice" @keyup.enter="addStyleRule" />
              <TextField v-model="styleClassDraft" mono spellcheck="false" placeholder="类名，如 st-voice" class="cex__styleclass" @keyup.enter="addStyleRule" />
              <Button variant="secondary" size="sm" :disabled="!stylePatternDraft.trim() || !!stylePatternError" @click="addStyleRule">添加</Button>
            </div>
            <p v-if="stylePatternError" class="cex-rule__error">正则错误：{{ stylePatternError }}</p>
            <div v-if="styleRules.length" class="cex-rule__chips">
              <span v-for="(r, i) in styleRules" :key="i" class="cex-rule__chip">
                {{ r.pattern }} → .{{ r.className }}<IconButton name="close" title="移除" danger class="cex-rule__chip-x" @click="removeStyleRule(i)" />
              </span>
            </div>
          </div>
          <label class="cex__csslabel">自定义 CSS
            <textarea v-model="styleCss" class="cex__css" spellcheck="false" rows="4" placeholder=".st-voice { color: #2c3e50; }"></textarea>
          </label>
        </Section>
      </Section>
    </section>
    </div>

    <!-- Shared footer nav: fixed at the panel bottom, consistent Back / Next on every
         step (Next gated by the same rule as the stepper; the final step has no Next). -->
    <div class="cex__nav">
      <Button v-if="canGoBack" variant="ghost" icon="chevron-left" @click="goPrevStep">上一步</Button>
      <span class="cex__navgap" />
      <!-- Last step: the export actions take the Next slot (there's no next step). -->
      <template v-if="step === 'export'">
        <Button variant="ghost" :disabled="!chapters.length" @click="exportTxt">导出 TXT</Button>
        <Button icon="download" :disabled="!chapters.length" @click="exportEpub">导出 EPUB</Button>
      </template>
      <Button v-if="step === 'rules'" variant="ghost" :disabled="!hasAnyRule" @click="clearAllRules">清除规则</Button>
      <Button
        v-if="step === 'preview' && sourceKind === 'active'"
        variant="ghost"
        :disabled="!focused"
        @click="focused && jumpToStMessage(focused.srcIndex)"
      >在 ST 中定位</Button>
      <Button
        v-if="nextStep"
        icon-right="chevron-right"
        :disabled="!stepEnabled(nextStep.id)"
        @click="goNextStep"
      >
        下一步
      </Button>
    </div>
  </div>
</template>

<style scoped>
/* App frame: fixed stepper on top, scrolling content in the middle, fixed nav at the
   bottom — so Back / Next stay put regardless of content length (no sticky hacks). */
.cex {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.cex__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--pet-space-md) var(--pet-space-md);
}
.cex__steps {
  flex: none;
  display: flex;
  gap: var(--pet-space-sm);
  list-style: none;
  margin: 0;
  padding: var(--pet-space-md) var(--pet-space-md) var(--pet-space-lg);
}
.cex__stepli {
  display: flex;
  flex: 1;
  min-width: 0;
}
/* Each step is a vertical stack: a progress bar on top, then circle + label below.
   The row of bars forms the rail. Three states: default / active / done (finished). */
.cex__step {
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-sm);
  width: 100%;
  min-width: 0;
  padding: 0;
  background: transparent;
  border: 0;
  text-align: left;
  cursor: pointer;
}
.cex__stepbar {
  height: 3px;
  border-radius: var(--pet-radius-pill);
  background: var(--pet-color-border);
}
.cex__steprow {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  min-width: 0;
}
.cex__stepnum {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex: none;
  font-size: var(--pet-font-size-xxs);
  border-radius: var(--pet-radius-pill);
  color: var(--pet-color-text-faint);
  background: var(--pet-color-surface-raised);
  border: 1px solid var(--pet-color-border-strong);
}
.cex__stepnum :deep(.pet-icon) {
  width: 10px;
  height: 10px;
}
.cex__steplabel {
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Active — accent bar + accent circle + emphasised label. */
.cex__step--active .cex__stepbar {
  background: var(--pet-color-accent);
}
.cex__step--active .cex__stepnum {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-accent);
  border-color: var(--pet-color-accent);
}
.cex__step--active .cex__steplabel {
  color: var(--pet-color-text);
}
/* Done (finished) — strong bar + ✓ circle, label back to full strength. */
.cex__step--done .cex__stepbar {
  background: var(--pet-color-text-faint);
}
.cex__step--done .cex__stepnum {
  color: var(--pet-color-text-muted);
}
.cex__step--done .cex__steplabel {
  color: var(--pet-color-text);
}
.cex__step--disabled {
  cursor: default;
}
.cex__step--disabled .cex__stepnum,
.cex__step--disabled .cex__steplabel {
  opacity: 0.55;
}
.cex__panel {
  display: flex;
  flex-direction: column;
}
/* Step title — same type as the preset console's section name (pet-section__name). */
.cex__title {
  margin: 0 0 var(--pet-space-xs);
  font-size: var(--pet-font-size-lg);
  font-weight: var(--pet-font-weight-semibold);
  line-height: var(--pet-font-leading-tight);
  color: var(--pet-color-text);
}
/* One-line step intro under the title. */
.cex__lead {
  margin: 0 0 var(--pet-space-lg);
  font-size: var(--pet-font-size-sm);
  line-height: var(--pet-font-leading-normal);
  color: var(--pet-color-text-muted);
}
/* Footer step nav — a fixed bar at the panel bottom (flex child, never scrolls). */
.cex__nav {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  padding: var(--pet-space-md);
  border-top: 1px solid var(--pet-color-border);
}
.cex__navgap {
  flex: 1;
}
.cex__file {
  display: none;
}
/* Hero load zone — drag target + buttons + state icon, centered. */
.cex__drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--pet-space-md);
  padding: var(--pet-space-xl) var(--pet-space-lg);
  text-align: center;
  border: 1.5px dashed var(--pet-color-border-strong);
  border-radius: var(--pet-radius-lg);
  transition:
    border-color var(--pet-motion-fast) var(--pet-motion-ease),
    background var(--pet-motion-fast) var(--pet-motion-ease);
}
.cex__dropicon {
  color: var(--pet-color-text-faint);
  line-height: 0;
}
.cex__dropicon :deep(.pet-icon) {
  width: 32px;
  height: 32px;
  stroke-width: 1.5;
}
.cex__dropicon--spin :deep(.pet-icon) {
  animation: cex-spin 0.9s linear infinite;
  transform-box: fill-box;
  transform-origin: center;
}
.cex__drophint {
  margin: 0;
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text-muted);
}
.cex__drophint code {
  font-family: var(--pet-font-mono);
  color: var(--pet-color-text);
}
.cex__dropbtns {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--pet-space-sm);
}
.cex__dropor {
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-faint);
}
/* Zone state treatments */
.cex__drop--over,
.cex__drop--loading {
  border-color: var(--pet-color-accent);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 92%);
}
.cex__drop--success {
  border-style: solid;
  border-color: color-mix(in srgb, var(--pet-color-accent), transparent 50%);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 94%);
}
.cex__drop--success .cex__dropicon {
  color: var(--pet-color-accent);
}
.cex__drop--error {
  border-color: var(--pet-color-danger);
  background: color-mix(in srgb, var(--pet-color-danger), transparent 92%);
}
.cex__drop--error .cex__dropicon {
  color: var(--pet-color-danger);
}
/* Status line under the zone, mirroring the state. */
.cex__status {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  margin: var(--pet-space-md) 0 0;
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text-muted);
}
.cex__status :deep(.pet-icon) {
  flex: none;
  width: 15px;
  height: 15px;
}
.cex__status--ok {
  color: var(--pet-color-text);
}
.cex__status--ok :deep(.pet-icon) {
  color: var(--pet-color-accent);
}
.cex__status--error {
  color: var(--pet-color-danger);
}
.cex__status-spin {
  animation: cex-spin 0.9s linear infinite;
  transform-box: fill-box;
  transform-origin: center;
}
@keyframes cex-spin {
  to {
    transform: rotate(360deg);
  }
}
.cex__opts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--pet-space-sm) var(--pet-space-md);
  margin-top: var(--pet-space-md);
}
.cex__opts--inline {
  flex-wrap: nowrap;
  gap: var(--pet-space-sm);
}
.cex__opt {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text-muted);
  cursor: pointer;
}
.cex__opts--inline .cex__opt {
  gap: var(--pet-space-xs);
  font-size: var(--pet-font-size-xs);
  white-space: nowrap;
}
.cex__range {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: var(--pet-space-sm);
  margin-top: var(--pet-space-sm);
  padding-bottom: var(--pet-space-sm);
  border-bottom: 1px solid color-mix(in srgb, var(--pet-color-border), transparent 55%);
}
.cex__range > .cex__opt {
  flex: none;
}
.cex__range-fields {
  display: inline-flex;
  align-items: center;
  gap: var(--pet-space-xs);
  width: 98px;
  flex: none;
  transition: opacity var(--pet-motion-fast) var(--pet-motion-ease);
}
.cex__range-fields--off {
  opacity: 0.38;
}
/* Shared small number input — floor range (②), message jump (③), 预览起始章 (④). */
.cex :deep(.cex__numfield) {
  width: 44px;
  padding: 2px var(--pet-space-xs);
  text-align: center;
}
.cex__range-fields :deep(.cex__range-input:disabled) {
  color: var(--pet-color-text-muted);
  cursor: default;
}
.cex__range-sep,
.cex__range-count {
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-faint);
}
.cex__range-count {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cex__count {
  margin: var(--pet-space-md) 0 var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  font-weight: var(--pet-font-weight-medium);
  color: var(--pet-color-text);
}
/* Chapter-list head: 共 N 章 on the left, 预览起始章 input on the right. */
.cex__chaphead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--pet-space-sm);
}
.cex__chaphead .cex__count {
  margin: var(--pet-space-md) 0 var(--pet-space-sm);
}
.cex__chapstart {
  flex: none;
  gap: var(--pet-space-xs);
  margin-top: 0;
}
/* Section description — one calm line under a Section header, above its controls. */
.cex__desc {
  margin: 0 0 var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  line-height: var(--pet-font-leading-normal);
  color: var(--pet-color-text-muted);
}
/* Scan results — flat rows, matching preset-edit's edit list treatment. */
.cex__scanlist {
  margin-top: var(--pet-space-xs);
  max-height: 220px;
  overflow-y: auto;
}
.cex__scanrow {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  padding: var(--pet-space-xs) 0;
}
/* Clickable select area — mark + tag + count toggle row selection; takes the row width
   so the Segmented sits at the right. `min-width: 0` lets a long tag truncate (mobile). */
.cex__scanpick {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  padding: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
  text-align: left;
}
.cex__scantag {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--pet-font-mono);
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text);
}
.cex__scancount {
  flex: none;
  font-size: var(--pet-font-size-xxs);
  color: var(--pet-color-text-faint);
}
/* 未闭合 group — informational, set off from the balanced list by a top rule. */
.cex__unclosed {
  margin-top: var(--pet-space-sm);
  padding-top: var(--pet-space-sm);
  border-top: 1px solid var(--pet-color-border);
}
.cex__unclosed-head {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
}
.cex__unclosed-title {
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text);
}
.cex__unclosed-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--pet-space-xs) var(--pet-space-sm);
  margin-top: var(--pet-space-xs);
}
.cex__unclosed-opt {
  margin-top: var(--pet-space-xs);
}
.cex__scanall {
  flex: none;
}
.cex__scanall-label {
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text);
}
.cex__scanbatch {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--pet-space-sm);
  flex: 1;
  min-width: 0;
  min-height: 28px;
}
.cex__scanbatch--idle {
  visibility: hidden;
  pointer-events: none;
}
/* Scanner header row — same left alignment as rows; the only divider is between
   this batch toolbar and the tag content. */
.cex__scanhead {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  min-height: 36px;
  padding: var(--pet-space-xs) 0;
  border-bottom: 1px solid color-mix(in srgb, var(--pet-color-border), transparent 55%);
}
.cex__scanhead .cex__desc {
  margin: 0;
}
.cex__scanbatch-count {
  flex: none;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-muted);
  white-space: nowrap;
}
.cex__hint {
  margin: var(--pet-space-sm) 0 0;
  font-size: var(--pet-font-size-xs);
  line-height: var(--pet-font-leading-normal);
  color: var(--pet-color-text-faint);
}
.cex__hint code {
  font-family: var(--pet-font-mono);
  color: var(--pet-color-text-muted);
}
.cex__warn {
  margin: var(--pet-space-sm) 0 0;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-muted);
}
.cex__field {
  flex: none;
  padding: 1px 6px;
  border-radius: var(--pet-radius-pill);
  font-size: var(--pet-font-size-xxs);
  color: var(--pet-color-accent-text);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 25%);
}
.cex__nomatch {
  flex: none;
  padding: 1px 5px;
  border-radius: var(--pet-radius-pill);
  font-size: var(--pet-font-size-xxs);
  color: var(--pet-color-accent-text);
  background: var(--pet-color-danger);
}
/* Health-flag banner — one row per flag kind; severity differentiates empty vs unmatched. */
.cex__flags {
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-xs);
  margin-bottom: var(--pet-space-md);
}
/* Whole row is the button that scopes the nav to this flag's messages. */
.cex__flag {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
  width: 100%;
  margin: 0;
  padding: var(--pet-space-xs) var(--pet-space-sm) var(--pet-space-xs) var(--pet-space-md);
  text-align: left;
  font: inherit;
  font-size: var(--pet-font-size-xs);
  line-height: var(--pet-font-leading-normal);
  color: var(--pet-color-text);
  background: var(--pet-color-surface-raised);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-sm);
  cursor: pointer;
  transition: border-color var(--pet-motion-fast) var(--pet-motion-ease);
}
.cex__flag:hover {
  border-color: var(--pet-color-accent);
}
.cex__flag span {
  flex: 1;
  min-width: 0;
}
.cex__flag > :deep(.pet-icon) {
  flex: none;
  width: 14px;
  height: 14px;
}
/* Leading status glyph: unmatched = informational (muted). */
.cex__flag > :deep(.pet-icon):first-child {
  color: var(--pet-color-text-muted);
}
/* Empty = serious (silent data loss): danger glyph + danger left rule. */
.cex__flag--high {
  border-left: 3px solid var(--pet-color-danger);
}
.cex__flag--high > :deep(.pet-icon):first-child {
  color: var(--pet-color-danger);
}
/* Trailing chevron — affordance only, always muted. */
.cex__flag :deep(.cex__flag-go) {
  color: var(--pet-color-text-faint);
}
/* No extra top margin — the step lead's bottom margin already sets the gap, matching
   the other steps (was double-spaced). */
.cex__preview {
  margin-top: 0;
}
.cex__pvnav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pet-space-sm);
  margin-bottom: var(--pet-space-md);
}
.cex__pvpos {
  display: inline-flex;
  align-items: center;
  gap: var(--pet-space-xs);
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-muted);
}
.cex__pvscope {
  margin-left: auto;
}
.cex__jumperror {
  margin-bottom: var(--pet-space-sm);
  color: var(--pet-color-danger);
}
/* Floor number beside 清理后 — tells the user which ST message this is. */
.cex__floor {
  margin-left: var(--pet-space-xs);
  font-size: var(--pet-font-size-xxs);
  font-weight: var(--pet-font-weight-normal);
  color: var(--pet-color-text-muted);
}
/* Pane header — label on the left, badges/role on the right. */
.cex__pvhead {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  margin-bottom: 4px;
}
.cex__pvhead-tags,
.cex__pvhead-name {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pet-space-xs);
  min-width: 0;
}
.cex__pvhead-tags {
  margin-left: auto;
}
/* Role badge — an icon chip (bot / user) at the right of the 原文 pane header. */
.cex__role {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  margin-left: auto;
  border-radius: var(--pet-radius-pill);
  color: var(--pet-color-text-muted);
  background: var(--pet-color-surface-raised);
}
.cex__role :deep(.pet-icon) {
  width: 14px;
  height: 14px;
}
.cex__role--assistant {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-accent);
}
.cex__hidden {
  flex: none;
  padding: 1px 5px;
  border-radius: var(--pet-radius-pill);
  font-size: var(--pet-font-size-xxs);
  color: var(--pet-color-text-muted);
  border: 1px solid var(--pet-color-border-strong);
}
.cex__name {
  flex: none;
  color: var(--pet-color-text);
  font-size: var(--pet-font-size-xs);
  font-weight: var(--pet-font-weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cex__diff {
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-sm);
  margin-top: var(--pet-space-sm);
}
.cex__pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.cex__panelabel {
  margin: 0 0 4px;
  font-size: var(--pet-font-size-xxs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--pet-color-text-faint);
}
/* Fixed height (not max-height) so the two panes stay put as you flip between a short
   user turn and a long AI turn — no jumpy resizing. Content scrolls inside. */
.cex__panebody {
  height: 160px;
  overflow-y: auto;
  padding: var(--pet-space-sm);
  font-size: var(--pet-font-size-xs);
  line-height: var(--pet-font-leading-normal);
  color: var(--pet-color-text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--pet-color-surface);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-sm);
}
.cex__panebody--after {
  color: var(--pet-color-text);
  border-color: var(--pet-color-accent);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 94%);
}
.cex__metafield {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  margin-top: var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text-muted);
}
.cex__coverfield {
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-sm);
  margin-top: var(--pet-space-sm);
}
.cex__coverdrop {
  display: flex;
  align-items: center;
  gap: var(--pet-space-md);
  min-height: 104px;
  padding: var(--pet-space-sm);
  border: 1.5px dashed var(--pet-color-border-strong);
  border-radius: var(--pet-radius-sm);
  cursor: pointer;
  transition:
    border-color var(--pet-motion-fast) var(--pet-motion-ease),
    background var(--pet-motion-fast) var(--pet-motion-ease);
}
.cex__coverdrop--over {
  border-color: var(--pet-color-accent);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 92%);
}
.cex__cover-thumb {
  display: grid;
  place-items: center;
  width: 64px;
  height: 88px;
  flex: none;
  padding: 0;
  overflow: hidden;
  color: var(--pet-color-text-faint);
  background: var(--pet-color-surface);
  border: 1px solid var(--pet-color-border-strong);
  border-radius: var(--pet-radius-sm);
  cursor: pointer;
}
.cex__cover-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cex__cover-thumb--empty {
  border-style: dashed;
}
.cex__cover-main {
  flex: 1;
  min-width: 0;
}
.cex__cover-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--pet-space-sm);
}
.cex__cover-name {
  margin: 0 0 var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Field that fills the rest of a 书籍信息 row after its inline label. */
.cex__field-grow {
  flex: 1;
  min-width: 0;
}
/* Chapter-rule dropdown — full-width inside its section (block flow, no flex hack needed). */
.cex__chaprule {
  display: block;
  width: 100%;
}
.cex__chaplist {
  list-style: none;
  margin: var(--pet-space-sm) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cex__chap {
  display: flex;
  width: 100%;
  padding: var(--pet-space-xs) 0;
  color: var(--pet-color-text-muted);
  background: transparent;
  border: 0;
  cursor: pointer;
  text-align: left;
}
.cex__chap--active .cex__chaptitle,
.cex__chap:hover .cex__chaptitle {
  color: var(--pet-color-text);
}
.cex__chaptitle {
  font-size: var(--pet-font-size-xs);
  font-weight: var(--pet-font-weight-medium);
  color: inherit;
}
.cex__chapbody {
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cex__more {
  margin: var(--pet-space-sm) 0 0;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-faint);
}
.cex__chappreview {
  margin-top: var(--pet-space-sm);
}
.cex__chappreview-frame {
  display: block;
  width: 100%;
  height: 240px;
  margin-top: var(--pet-space-sm);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-sm);
  background: #fff;
}

/* 排版样式 — preset toggle list. */
.cex__styles {
  list-style: none;
  margin: var(--pet-space-sm) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-sm);
}
.cex__stylehint {
  margin: 2px 0 0 calc(var(--pet-space-sm) + 14px);
  font-size: var(--pet-font-size-xs);
  line-height: var(--pet-font-leading-normal);
  color: var(--pet-color-text-faint);
}
/* Advanced: two-field custom rule row (匹配 + 类名). Pattern grows, class is fixed-ish. */
.cex__stylerule :deep(.pet-field) {
  flex: 1;
  min-width: 0;
}
.cex__styleclass {
  flex: 0 1 8em;
}
/* ST regex import — reuses the 扫描 list (.cex__scanhead/.cex__scanrow/.cex__scanpick).
   These classes only style the import-specific bits: scope filter + two-line rows. */
.cex__scopefilter {
  margin-bottom: var(--pet-space-sm);
}
.cex__import-group + .cex__import-group {
  margin-top: var(--pet-space-sm);
}
.cex__import-scope {
  font-size: var(--pet-font-size-xxs);
  color: var(--pet-color-text-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: var(--pet-space-xs);
}
/* Import rows carry a two-line info block, so top-align the checkbox to the name. */
.cex__importlist .cex__scanpick {
  align-items: flex-start;
}
.cex__import-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cex__import-name {
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text);
}
.cex__import-off {
  color: var(--pet-color-text-faint);
}
.cex__import-rule {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--pet-font-mono);
  font-size: var(--pet-font-size-xxs);
  color: var(--pet-color-text-faint);
}
.cex__csslabel {
  display: block;
  margin-top: var(--pet-space-md);
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-muted);
}
.cex__css {
  display: block;
  width: 100%;
  margin-top: var(--pet-space-xs);
  padding: var(--pet-space-sm);
  box-sizing: border-box;
  resize: vertical;
  font-family: var(--pet-font-mono);
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text);
  background: var(--pet-color-surface);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-sm);
}
.cex__css:focus {
  outline: none;
  border-color: var(--pet-color-accent);
}

/* Mirror of RuleField's row/error/chip styles (scoped styles can't be shared). */
.cex-rule {
  margin-top: var(--pet-space-sm);
}
.cex-rule__row {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
}
.cex-rule__error {
  margin: var(--pet-space-sm) 0 0;
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-accent-text);
  background: var(--pet-color-danger);
  padding: var(--pet-space-sm) var(--pet-space-md);
  border-radius: var(--pet-radius-sm);
}
.cex-rule__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--pet-space-sm);
  margin-top: var(--pet-space-sm);
}
.cex-rule__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--pet-space-xs);
  padding: 2px 2px 2px var(--pet-space-sm);
  font-family: var(--pet-font-mono);
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text);
  background: var(--pet-color-surface-raised);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-pill);
}
.cex-rule__chip .cex-rule__chip-x {
  width: 18px;
  height: 18px;
}
</style>
