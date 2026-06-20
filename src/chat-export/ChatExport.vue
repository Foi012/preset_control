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
import { computed, onMounted, ref, watch } from 'vue';
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
import { extractMessage, ruleError, type ExtractConfig } from './extract';
import { scanTags } from './scan';
import { buildChapters, type ChapterRule } from './chapters';
import { chaptersToTxt } from './txt';
import { buildEpub } from './epub';
import type { BookMeta } from './render';

const messages = ref<NormMessage[]>([]);
const sourceLabel = ref('');
const error = ref('');
const loading = ref(false);
const dragging = ref(false);
const includeUser = ref(true);
const includeHidden = ref(true);
const fileInput = ref<HTMLInputElement | null>(null);

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
const excludeRules = ref<string[]>([]);
const includeRules = ref<string[]>([]);
const titleRules = ref<string[]>([]);
const excludeDraft = ref('');
const includeDraft = ref('');
const titleDraft = ref('');

const config = computed<ExtractConfig>(() => ({
  strip: { reasoning: stripReasoning.value, ooc: stripOOC.value },
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
// bucket. Gated on `showScan` so a big chat isn't re-scanned while the panel is shut.
const showScan = ref(false);
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

// Phase 3 — before/after preview navigator. Step through messages and compare the
// raw content against the cleaned/extracted body. `assistantOnlyNav` narrows the walk
// to AI turns, where extraction actually does something.
const focusIndex = ref(0);
const assistantOnlyNav = ref(false);

const navMessages = computed(() =>
  assistantOnlyNav.value ? messages.value.filter(m => m.role === 'assistant') : messages.value,
);
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

// Phase 4 — book metadata, chapter splitting, export.
const bookTitle = ref('');
const bookAuthor = ref('');
const bookLang = ref('zh');
type ChapterRuleKind = 'per-assistant' | 'per-message' | 'title' | 'every';
const chapterRuleKind = ref<ChapterRuleKind>('per-assistant');
const everyN = ref(5);

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
const chapters = computed(() => buildChapters(messages.value, config.value, chapterRule.value));
const chaptersPreview = computed(() => chapters.value.slice(0, 30));

const bookMeta = computed<BookMeta>(() => ({
  title: bookTitle.value.trim() || '未命名',
  author: bookAuthor.value.trim(),
  language: bookLang.value,
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
  download(`${bookMeta.value.title}.epub`, buildEpub(chapters.value, bookMeta.value), 'application/epub+zip');
}

// Remember the rule set across sessions (best-effort; opaque-origin storage is fine to fail).
const RULES_KEY = 'cexRules';
function saveRules(): void {
  try {
    window.localStorage?.setItem(
      RULES_KEY,
      JSON.stringify({
        stripReasoning: stripReasoning.value,
        stripOOC: stripOOC.value,
        exclude: excludeRules.value,
        include: includeRules.value,
        title: titleRules.value,
        chapterRuleKind: chapterRuleKind.value,
        everyN: everyN.value,
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
    if (Array.isArray(d.exclude)) excludeRules.value = d.exclude.filter((x: unknown) => typeof x === 'string');
    if (Array.isArray(d.include)) includeRules.value = d.include.filter((x: unknown) => typeof x === 'string');
    if (Array.isArray(d.title)) titleRules.value = d.title.filter((x: unknown) => typeof x === 'string');
    if (['per-assistant', 'per-message', 'title', 'every'].includes(d.chapterRuleKind)) chapterRuleKind.value = d.chapterRuleKind;
    if (Number.isFinite(d.everyN)) everyN.value = d.everyN;
  } catch {
    /* ignore malformed */
  }
}
onMounted(loadRules);
watch([stripReasoning, stripOOC, excludeRules, includeRules, titleRules, chapterRuleKind, everyN], saveRules, { deep: true });

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
  messages.value = normalizeMessages(rawMessages.value, {
    includeUser: includeUser.value,
    includeHidden: includeHidden.value,
  });
  resetNav();
  seedBookMeta();
}

async function readActiveChat(): Promise<void> {
  error.value = '';
  loading.value = true;
  try {
    rawMessages.value = await loadRawMessages({ kind: 'active' });
    applyFilters();
    sourceLabel.value = '当前聊天';
    if (messages.value.length === 0) error.value = '未读取到聊天消息（确认 SillyTavern 已打开一段对话）。';
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
    applyFilters();
    sourceLabel.value = label;
    if (messages.value.length === 0) error.value = '该文件未解析出任何消息。';
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

      <!-- Scanner on top (always shown): its results route into 包含 / 排除 below. -->
      <Section title="扫描标签" :collapsible="false" size="sm">
        <template #badges>
          <Button variant="ghost" size="sm" icon="trash" :disabled="!hasAnyRule" @click="clearAllRules">清除</Button>
          <Button variant="secondary" size="sm" icon="refresh" @click="showScan = !showScan">
            {{ showScan ? '收起结果' : '扫描标签' }}
          </Button>
        </template>
        <p v-if="!showScan" class="cex__desc">列出聊天里成对出现的标签，逐个标记成 排除 或 包含。</p>
        <template v-else>
          <p v-if="!scannedTags.length" class="cex__hint">未发现成对标签。</p>
          <template v-else>
            <!-- Header row: select-all master, swapped in-place for the batch control
                 once tags are selected (so it never pushes the list down). -->
            <div class="cex__scanhead">
              <button type="button" class="cex__scanpick cex__scanall" @click="toggleSelectAll">
                <SelectMark type="checkbox" :state="selectAllState" />
                <span class="cex__scanall-label">全选</span>
              </button>
              <template v-if="selectedTags.length">
                <span class="cex__scanbatch-count">已选 {{ selectedTags.length }} 项</span>
                <Segmented
                  size="sm"
                  :model-value="''"
                  :options="SCAN_BUCKETS"
                  @update:model-value="applyBucketToSelected($event as TagBucket)"
                />
              </template>
            </div>
            <div class="cex__scanlist">
              <div v-for="t in scannedTags" :key="t.tag" class="cex__scanrow">
                <button type="button" class="cex__scanpick" @click="toggleTagSelect(t.tag)">
                  <SelectMark type="checkbox" :state="selectedTags.includes(t.tag) ? 'on' : 'off'" />
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
        </template>
      </Section>

      <!-- INCLUDE — which messages go in, and which spans become body / title. -->
      <Section title="包含内容" size="sm">
        <p class="cex__desc">选择哪些楼层进书，以及每段保留哪些内容作为正文 / 标题。</p>
        <div class="cex__opts">
          <label class="cex__opt"><input type="checkbox" v-model="includeUser" @change="applyFilters" /> 包含用户发言</label>
          <label class="cex__opt" title="被 /hide 隐藏的真实楼层（常为省 token 而隐藏，通常仍要收进书里）">
            <input type="checkbox" v-model="includeHidden" @change="applyFilters" /> 包含隐藏楼层
          </label>
        </div>
        <RuleField
          label="正文"
          v-model="includeDraft"
          :rules="includeRules"
          :error="includeDraftError"
          placeholder="标签名 正文 / body，或正则 — 回车添加"
          @add="addInclude"
          @remove="removeInclude"
        />
        <RuleField
          label="标题"
          v-model="titleDraft"
          :rules="titleRules"
          :error="titleDraftError"
          placeholder="标签名 title，或正则 (?<title>…) — 回车添加"
          @add="addTitle"
          @remove="removeTitle"
        />
        <p v-if="unmatchedCount" class="cex__warn">⚠ {{ unmatchedCount }} 条 AI 楼层未匹配规则（正文回退为整段）。</p>
      </Section>

      <!-- EXCLUDE — strip spans out of every message (presets + custom rules). -->
      <Section title="排除内容" size="sm">
        <p class="cex__desc">从每条消息中删除以下内容，不写进书里。</p>
        <div class="cex__opts">
          <label class="cex__opt"><input type="checkbox" v-model="stripReasoning" /> 去除推理块 &lt;think&gt;</label>
          <label class="cex__opt" title="去除 (OOC: …) / （OOC：…） 等剧情外旁注">
            <input type="checkbox" v-model="stripOOC" /> 去除 OOC 旁注
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
    </section>

    <section v-show="step === 'preview'" class="cex__panel">
      <h2 class="cex__title">预览效果</h2>
      <p class="cex__lead">逐条对比原文与整理后的正文，确认规则符合预期。</p>

      <!-- Phase 3: after / before preview -->
      <div v-if="focused && focusedExtract" class="cex__preview">
        <div class="cex__pvnav">
          <IconButton name="chevron-left" title="上一条" :disabled="focusIndex <= 0" @click="focusPrev" />
          <span class="cex__pvpos">
            第
            <TextField
              class="cex__pvinput"
              type="number"
              :model-value="focusPos"
              min="1"
              :max="navMessages.length"
              @update:model-value="focusPos = Number($event)"
            />
            / {{ navMessages.length }} 条
          </span>
          <IconButton name="chevron-right" title="下一条" :disabled="focusIndex >= navMessages.length - 1" @click="focusNext" />
          <label class="cex__opt cex__pvfilter">
            <input type="checkbox" v-model="assistantOnlyNav" @change="resetNav" /> 只看 AI 楼层
          </label>
        </div>
        <div class="cex__diff">
          <!-- After first — the result the user is verifying. -->
          <div class="cex__pane">
            <div class="cex__pvhead">
              <span class="cex__panelabel">清理后</span>
              <span class="cex__pvhead-tags">
                <span v-for="(val, key) in focusedExtract.fields" :key="key" class="cex__field">{{ key }}: {{ val }}</span>
                <span
                  v-if="(includeRules.length || titleRules.length) && focused.role === 'assistant' && !focusedExtract.matched"
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

        <p class="cex__count">共 {{ chapters.length }} 章</p>
        <ol class="cex__chaplist">
          <li v-for="ch in chaptersPreview" :key="ch.index" class="cex__chap">
            <span class="cex__chaptitle">{{ ch.index }}. {{ ch.title }}</span>
            <span class="cex__chapbody">{{ snippet(ch.body) }}</span>
          </li>
        </ol>
        <p v-if="chapters.length > chaptersPreview.length" class="cex__more">…其余 {{ chapters.length - chaptersPreview.length }} 章</p>
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
      <Button
        v-else-if="nextStep"
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
.cex__opt {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text-muted);
  cursor: pointer;
}
.cex__count {
  margin: var(--pet-space-md) 0 var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  font-weight: var(--pet-font-weight-medium);
  color: var(--pet-color-text);
}
/* Section description — one calm line under a Section header, above its controls. */
.cex__desc {
  margin: 0 0 var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  line-height: var(--pet-font-leading-normal);
  color: var(--pet-color-text-muted);
}
/* Scan results — capped height so a long tag list stays scannable, not endless. */
.cex__scanlist {
  margin-top: var(--pet-space-sm);
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-sm);
  background: var(--pet-color-surface);
}
.cex__scanrow {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  padding: var(--pet-space-xs) var(--pet-space-sm);
}
.cex__scanrow:not(:last-child) {
  border-bottom: 1px solid var(--pet-color-border);
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
.cex__scanall {
  flex: none;
}
.cex__scanall-label {
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-muted);
}
/* Scanner header row — holds the description, swapped in-place for the batch control
   once tags are selected. Fixed min-height so the swap never shifts the list below. */
.cex__scanhead {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  min-height: 26px;
}
.cex__scanhead .cex__desc {
  margin: 0;
}
.cex__scanbatch-count {
  flex: 1;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-muted);
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
/* Jump-to field inside the position label — narrow, centered (overrides .pet-field width). */
.cex__pvpos :deep(.cex__pvinput) {
  width: 44px;
  padding: 2px var(--pet-space-xs);
  text-align: center;
}
.cex__pvfilter {
  margin-left: auto;
  font-size: var(--pet-font-size-xs);
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
  flex-direction: column;
  gap: 2px;
  padding: var(--pet-space-sm);
  border-bottom: 1px solid var(--pet-color-border);
}
.cex__chaptitle {
  font-size: var(--pet-font-size-xs);
  font-weight: var(--pet-font-weight-medium);
  color: var(--pet-color-text);
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
</style>
