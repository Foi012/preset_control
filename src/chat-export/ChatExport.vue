<script setup lang="ts">
/**
 * Chat Export tool root.
 *
 * Phase 1: pick a source (active chat / `.jsonl`) → normalize to active-swipe messages.
 * Phase 2 (two-bucket rules): **排除** removes spans from every message (presets +
 * tag/regex rules); **提取正文** keeps only matched content as the body on assistant
 * turns (tag/regex; named groups → fields like title). Tag scanner is a follow-up.
 * Richer before/after preview, chapters and EPUB are Phases 3–5. See `DESIGN.md`.
 */
import { computed, onMounted, ref, watch } from 'vue';
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
function stepEnabled(id: Step): boolean {
  if (id === 'source') return true;
  return hasData.value;
}
function goStep(id: Step): void {
  if (stepEnabled(id)) step.value = id;
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
const excludeDraft = ref('');
const includeDraft = ref('');

const config = computed<ExtractConfig>(() => ({
  strip: { reasoning: stripReasoning.value, ooc: stripOOC.value },
  exclude: excludeRules.value,
  include: includeRules.value,
}));

const excludeDraftError = computed(() => ruleError(excludeDraft.value));
const includeDraftError = computed(() => ruleError(includeDraft.value));

function addExclude(): void {
  const v = excludeDraft.value.trim();
  if (!v || excludeDraftError.value) return;
  if (!excludeRules.value.includes(v)) excludeRules.value.push(v);
  excludeDraft.value = '';
}
function removeExclude(i: number): void {
  excludeRules.value.splice(i, 1);
}
function addInclude(): void {
  const v = includeDraft.value.trim();
  if (!v || includeDraftError.value) return;
  if (!includeRules.value.includes(v)) includeRules.value.push(v);
  includeDraft.value = '';
}
function removeInclude(i: number): void {
  includeRules.value.splice(i, 1);
}

// Tag scanner — list every balanced tag in the chat so the user can click it into a
// bucket. Gated on `showScan` so a big chat isn't re-scanned while the panel is shut.
const showScan = ref(false);
const scannedTags = computed(() => (showScan.value ? scanTags(messages.value.map(m => m.content)) : []));

function sendTagTo(tag: string, bucket: 'exclude' | 'include'): void {
  const list = bucket === 'exclude' ? excludeRules : includeRules;
  if (!list.value.includes(tag)) list.value.push(tag);
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
const chapterRuleKind = ref<'per-assistant' | 'per-message' | 'title' | 'every'>('per-assistant');
const everyN = ref(5);

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
    if (['per-assistant', 'per-message', 'title', 'every'].includes(d.chapterRuleKind)) chapterRuleKind.value = d.chapterRuleKind;
    if (Number.isFinite(d.everyN)) everyN.value = d.everyN;
  } catch {
    /* ignore malformed */
  }
}
onMounted(loadRules);
watch([stripReasoning, stripOOC, excludeRules, includeRules, chapterRuleKind, everyN], saveRules, { deep: true });

/** Assistant turns whose include rules matched nothing (the 缺层 warning). */
const unmatchedCount = computed(() => {
  if (includeRules.value.length === 0) return 0;
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
  try {
    rawMessages.value = await loadRawMessages({ kind: 'active' });
    applyFilters();
    sourceLabel.value = '当前聊天';
    if (messages.value.length === 0) error.value = '未读取到聊天消息（确认 SillyTavern 已打开一段对话）。';
  } catch {
    error.value = '读取当前聊天失败。';
  }
}

async function readJsonlText(text: string, label: string): Promise<void> {
  error.value = '';
  rawMessages.value = await loadRawMessages({ kind: 'jsonl', text });
  applyFilters();
  sourceLabel.value = label;
  if (messages.value.length === 0) error.value = '该文件未解析出任何消息。';
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
            'cex__step--done': s.id === 'source' && hasData && step !== 'source',
            'cex__step--disabled': !stepEnabled(s.id),
          }"
          :disabled="!stepEnabled(s.id)"
          @click="goStep(s.id)"
        >
          <span class="cex__stepnum">{{ i + 1 }}</span>
          <span class="cex__steplabel">{{ s.label }}</span>
        </button>
      </li>
    </ol>

    <section v-show="step === 'source'" class="cex__panel">
      <!-- Source picker -->
      <div class="cex__sources">
        <button type="button" class="cex__btn" @click="readActiveChat">读取当前聊天</button>
        <button type="button" class="cex__btn" @click="fileInput?.click()">导入 .jsonl</button>
        <input ref="fileInput" class="cex__file" type="file" accept=".jsonl,application/json" @change="onFile" />
      </div>

    <!-- `.stop` keeps the drop from bubbling to SillyTavern's body-level importer,
         which would otherwise reject a .jsonl with "Unsupported file type". -->
    <div
      class="cex__drop"
      :class="{ 'cex__drop--over': dragging }"
      @dragover.prevent.stop="dragging = true"
      @dragleave.prevent.stop="dragging = false"
      @drop.prevent.stop="onDrop"
    >
      把 <code>.jsonl</code> 拖到这里
    </div>

      <div class="cex__opts">
        <label class="cex__opt"><input type="checkbox" v-model="includeUser" @change="applyFilters" /> 包含用户发言</label>
        <label class="cex__opt" title="被 /hide 隐藏的真实楼层（常为省 token 而隐藏，通常仍要收进书里）">
          <input type="checkbox" v-model="includeHidden" @change="applyFilters" /> 包含隐藏楼层
        </label>
      </div>

      <p v-if="error" class="cex__error">{{ error }}</p>
      <template v-if="hasData">
        <p class="cex__count">来源：{{ sourceLabel }} · 共 {{ messages.length }} 条消息</p>
        <button type="button" class="cex__btn cex__next" @click="goStep('rules')">下一步：规则 ›</button>
      </template>
    </section>

    <section v-show="step === 'rules'" class="cex__panel">
      <!-- Phase 2: two-bucket rules — exclude (all msgs) + extract 正文 (assistant) -->
      <div class="cex__rules">
        <div class="cex__scanbar">
          <button type="button" class="cex__addbtn" @click="showScan = !showScan">
            {{ showScan ? '收起标签' : '扫描标签' }}
          </button>
          <span class="cex__hint">扫描聊天中的标签，点 排除 / 提取 直接加入规则。</span>
        </div>
        <div v-if="showScan" class="cex__scan">
          <p v-if="!scannedTags.length" class="cex__hint">未发现成对标签。</p>
          <div v-for="t in scannedTags" :key="t.tag" class="cex__scanrow">
            <code class="cex__scantag">&lt;{{ t.tag }}&gt;</code>
            <span class="cex__scancount">×{{ t.count }}</span>
            <button
              type="button"
              class="cex__scanbtn"
              :class="{ 'cex__scanbtn--on': excludeRules.includes(t.tag) }"
              @click="sendTagTo(t.tag, 'exclude')"
            >
              排除
            </button>
            <button
              type="button"
              class="cex__scanbtn"
              :class="{ 'cex__scanbtn--on': includeRules.includes(t.tag) }"
              @click="sendTagTo(t.tag, 'include')"
            >
              提取
            </button>
          </div>
        </div>

        <p class="cex__rules-title cex__rules-title--mt2">排除（从全部消息中删除）</p>
        <div class="cex__opts">
          <label class="cex__opt"><input type="checkbox" v-model="stripReasoning" /> 去除推理块 &lt;think&gt;</label>
          <label class="cex__opt" title="去除 (OOC: …) / （OOC：…） 等剧情外旁注">
            <input type="checkbox" v-model="stripOOC" /> 去除 OOC 旁注
          </label>
        </div>
        <div v-if="excludeRules.length" class="cex__chips">
          <span v-for="(r, i) in excludeRules" :key="r" class="cex__chip">
            {{ r }}<button type="button" class="cex__chip-x" title="移除" @click="removeExclude(i)">×</button>
          </span>
        </div>
        <div class="cex__add">
          <input
            v-model="excludeDraft"
            class="cex__regex"
            :class="{ 'cex__regex--bad': excludeDraftError }"
            type="text"
            spellcheck="false"
            placeholder="标签名 think，或正则 /pat/flags — 回车添加"
            @keyup.enter="addExclude"
          />
          <button type="button" class="cex__addbtn" :disabled="!excludeDraft.trim() || !!excludeDraftError" @click="addExclude">添加</button>
        </div>
        <p v-if="excludeDraftError" class="cex__error">正则错误：{{ excludeDraftError }}</p>

        <p class="cex__rules-title cex__rules-title--mt">提取正文（仅 AI 楼层）</p>
        <div v-if="includeRules.length" class="cex__chips">
          <span v-for="(r, i) in includeRules" :key="r" class="cex__chip">
            {{ r }}<button type="button" class="cex__chip-x" title="移除" @click="removeInclude(i)">×</button>
          </span>
        </div>
        <div class="cex__add">
          <input
            v-model="includeDraft"
            class="cex__regex"
            :class="{ 'cex__regex--bad': includeDraftError }"
            type="text"
            spellcheck="false"
            placeholder="标签名 正文 / 标题，或正则 (?<title>…) — 回车添加"
            @keyup.enter="addInclude"
          />
          <button type="button" class="cex__addbtn" :disabled="!includeDraft.trim() || !!includeDraftError" @click="addInclude">添加</button>
        </div>
        <p v-if="includeDraftError" class="cex__error">正则错误：{{ includeDraftError }}</p>
        <p v-else-if="unmatchedCount" class="cex__warn">⚠ {{ unmatchedCount }} 条 AI 楼层未匹配正文规则（回退为整段）。</p>
        <p class="cex__hint">未设规则时整段即正文。标签 <code>正文</code>/<code>body</code> 作正文，其它标签或命名分组作字段（如 <code>title</code>）。</p>
      </div>
      <button type="button" class="cex__btn cex__next" @click="goStep('preview')">下一步：预览 ›</button>
    </section>

    <section v-show="step === 'preview'" class="cex__panel">
      <!-- Phase 3: before / after preview -->
      <div v-if="focused && focusedExtract" class="cex__preview">
        <div class="cex__pvnav">
          <button type="button" class="cex__navbtn" :disabled="focusIndex <= 0" @click="focusPrev">‹</button>
          <span class="cex__pvpos">第 {{ focusIndex + 1 }} / {{ navMessages.length }} 条</span>
          <button type="button" class="cex__navbtn" :disabled="focusIndex >= navMessages.length - 1" @click="focusNext">›</button>
          <label class="cex__opt cex__pvfilter">
            <input type="checkbox" v-model="assistantOnlyNav" @change="resetNav" /> 只看 AI 楼层
          </label>
        </div>
        <div class="cex__meta">
          <span class="cex__role" :class="`cex__role--${focused.role}`">{{ focused.role }}</span>
          <span v-if="focused.hidden" class="cex__hidden" title="被 /hide 隐藏的楼层">隐藏</span>
          <span class="cex__name">{{ focused.name }}</span>
          <span v-for="(val, key) in focusedExtract.fields" :key="key" class="cex__field">{{ key }}: {{ val }}</span>
          <span
            v-if="includeRules.length && focused.role === 'assistant' && !focusedExtract.matched"
            class="cex__nomatch"
            title="未匹配正文规则，已回退为整段"
          >未匹配</span>
        </div>
        <div class="cex__diff">
          <div class="cex__pane">
            <p class="cex__panelabel">原文</p>
            <div class="cex__panebody">{{ focused.content }}</div>
          </div>
          <div class="cex__pane">
            <p class="cex__panelabel">清理后</p>
            <div class="cex__panebody cex__panebody--after">{{ focusedExtract.body }}</div>
          </div>
        </div>
      </div>
    </section>

    <section v-show="step === 'export'" class="cex__panel">
      <p class="cex__rules-title">书籍信息</p>
      <label class="cex__metafield">标题<input v-model="bookTitle" class="cex__input" type="text" /></label>
      <label class="cex__metafield">作者<input v-model="bookAuthor" class="cex__input" type="text" placeholder="可留空" /></label>
      <label class="cex__metafield">语言
        <select v-model="bookLang" class="cex__input">
          <option value="zh">中文 (zh)</option>
          <option value="en">English (en)</option>
          <option value="ja">日本語 (ja)</option>
        </select>
      </label>

      <p class="cex__rules-title cex__rules-title--mt">章节切分</p>
      <select v-model="chapterRuleKind" class="cex__input">
        <option value="per-assistant">每条 AI 回复一章</option>
        <option value="per-message">每条消息一章</option>
        <option value="title">按 title 标记分章</option>
        <option value="every">每 N 条消息一章</option>
      </select>
      <label v-if="chapterRuleKind === 'every'" class="cex__metafield cex__metafield--mt">
        每章条数<input v-model.number="everyN" class="cex__input cex__input--num" type="number" min="1" />
      </label>

      <p class="cex__count">共 {{ chapters.length }} 章</p>
      <ol class="cex__chaplist">
        <li v-for="ch in chaptersPreview" :key="ch.index" class="cex__chap">
          <span class="cex__chaptitle">{{ ch.index }}. {{ ch.title }}</span>
          <span class="cex__chapbody">{{ snippet(ch.body) }}</span>
        </li>
      </ol>
      <p v-if="chapters.length > chaptersPreview.length" class="cex__more">…其余 {{ chapters.length - chaptersPreview.length }} 章</p>

      <div class="cex__exportbtns">
        <button type="button" class="cex__btn" :disabled="!chapters.length" @click="exportEpub">导出 EPUB</button>
        <button type="button" class="cex__btn cex__btn--ghost" :disabled="!chapters.length" @click="exportTxt">导出 TXT</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cex {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--pet-space-md);
}
.cex__steps {
  display: flex;
  list-style: none;
  margin: 0 0 var(--pet-space-md);
  padding: 0 0 var(--pet-space-md);
  border-bottom: 1px solid var(--pet-color-border);
}
.cex__stepli {
  display: flex;
  flex: 1;
  align-items: center;
}
.cex__stepli:not(:last-child)::after {
  content: '';
  flex: 1;
  height: 1px;
  margin: 0 4px;
  background: var(--pet-color-border);
}
.cex__step {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 4px;
  background: transparent;
  border: 0;
  border-radius: var(--pet-radius-sm);
  color: var(--pet-color-text-muted);
  cursor: pointer;
}
.cex__stepnum {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: none;
  font-size: 10px;
  border-radius: var(--pet-radius-pill);
  color: var(--pet-color-text-muted);
  background: var(--pet-color-surface-raised);
}
.cex__steplabel {
  font-size: var(--pet-font-size-xs);
}
.cex__step--active {
  color: var(--pet-color-text);
}
.cex__step--active .cex__stepnum {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-accent);
}
.cex__step--done .cex__stepnum {
  color: var(--pet-color-accent-text);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 35%);
}
.cex__step--disabled {
  opacity: 0.4;
  cursor: default;
}
.cex__panel {
  display: flex;
  flex-direction: column;
}
.cex__next {
  align-self: flex-start;
  margin-top: var(--pet-space-md);
}
.cex__sources {
  display: flex;
  gap: var(--pet-space-sm);
  flex-wrap: wrap;
}
.cex__btn {
  padding: var(--pet-space-sm) var(--pet-space-md);
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-accent-text);
  background: var(--pet-color-accent);
  border: 1px solid var(--pet-color-accent);
  border-radius: var(--pet-radius-md);
  cursor: pointer;
}
.cex__btn:hover {
  filter: brightness(1.05);
}
.cex__file {
  display: none;
}
.cex__drop {
  margin-top: var(--pet-space-sm);
  padding: var(--pet-space-md);
  text-align: center;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-muted);
  border: 1px dashed var(--pet-color-border-strong);
  border-radius: var(--pet-radius-md);
  transition: border-color var(--pet-motion-fast) var(--pet-motion-ease), background var(--pet-motion-fast) var(--pet-motion-ease);
}
.cex__drop--over {
  border-color: var(--pet-color-accent);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 90%);
}
.cex__drop code {
  font-family: var(--pet-font-mono);
  color: var(--pet-color-text);
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
.cex__error {
  margin: var(--pet-space-md) 0 0;
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-accent-text);
  background: var(--pet-color-danger);
  padding: var(--pet-space-sm) var(--pet-space-md);
  border-radius: var(--pet-radius-sm);
}
.cex__count {
  margin: var(--pet-space-md) 0 var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  font-weight: var(--pet-font-weight-medium);
  color: var(--pet-color-text);
}
.cex__rules {
  margin: var(--pet-space-sm) 0 var(--pet-space-md);
  padding: var(--pet-space-md);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-md);
}
.cex__rules-title {
  margin: 0 0 var(--pet-space-sm);
  font-size: var(--pet-font-size-xs);
  font-weight: var(--pet-font-weight-semibold);
  color: var(--pet-color-text-muted);
}
.cex__rules-title--mt {
  margin-top: var(--pet-space-md);
  padding-top: var(--pet-space-md);
  border-top: 1px solid var(--pet-color-border);
}
.cex__rules-title--mt2 {
  margin-top: var(--pet-space-md);
}
.cex__scanbar {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  flex-wrap: wrap;
}
.cex__scanbar .cex__hint {
  margin: 0;
}
.cex__scan {
  margin-top: var(--pet-space-sm);
  padding: var(--pet-space-sm);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-sm);
  background: var(--pet-color-surface);
}
.cex__scanrow {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  padding: 3px 0;
}
.cex__scantag {
  font-family: var(--pet-font-mono);
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text);
}
.cex__scancount {
  flex: 1;
  font-size: 10px;
  color: var(--pet-color-text-faint);
}
.cex__scanbtn {
  flex: none;
  padding: 2px 8px;
  font-size: 11px;
  color: var(--pet-color-text-muted);
  background: var(--pet-color-surface-raised);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-pill);
  cursor: pointer;
}
.cex__scanbtn:hover {
  color: var(--pet-color-text);
  border-color: var(--pet-color-border-strong);
}
.cex__scanbtn--on {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-accent);
  border-color: var(--pet-color-accent);
}
.cex__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--pet-space-sm);
  margin-top: var(--pet-space-sm);
}
.cex__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 8px;
  font-family: var(--pet-font-mono);
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text);
  background: var(--pet-color-surface-raised);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-pill);
}
.cex__chip-x {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  font-size: 13px;
  line-height: 1;
  color: var(--pet-color-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--pet-radius-pill);
  cursor: pointer;
}
.cex__chip-x:hover {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-danger);
}
.cex__add {
  display: flex;
  gap: var(--pet-space-sm);
  margin-top: var(--pet-space-sm);
}
.cex__add .cex__regex {
  flex: 1;
  margin-top: 0;
}
.cex__addbtn {
  flex: none;
  padding: var(--pet-space-sm) var(--pet-space-md);
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text);
  background: var(--pet-color-surface-raised);
  border: 1px solid var(--pet-color-border-strong);
  border-radius: var(--pet-radius-sm);
  cursor: pointer;
}
.cex__addbtn:disabled {
  opacity: 0.4;
  cursor: default;
}
.cex__hint {
  margin: var(--pet-space-sm) 0 0;
  font-size: 11px;
  line-height: var(--pet-font-leading-normal);
  color: var(--pet-color-text-faint);
}
.cex__hint code {
  font-family: var(--pet-font-mono);
  color: var(--pet-color-text-muted);
}
.cex__regex {
  width: 100%;
  margin-top: var(--pet-space-sm);
  padding: var(--pet-space-sm);
  font-family: var(--pet-font-mono);
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text);
  background: var(--pet-color-surface);
  border: 1px solid var(--pet-color-border-strong);
  border-radius: var(--pet-radius-sm);
}
.cex__regex:focus {
  outline: none;
  border-color: var(--pet-color-accent);
}
.cex__regex--bad {
  border-color: var(--pet-color-danger);
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
  font-size: 10px;
  color: var(--pet-color-accent-text);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 25%);
}
.cex__nomatch {
  flex: none;
  padding: 1px 5px;
  border-radius: var(--pet-radius-pill);
  font-size: 10px;
  color: var(--pet-color-accent-text);
  background: var(--pet-color-danger);
}
.cex__preview {
  margin-top: var(--pet-space-md);
}
.cex__pvnav {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  margin-bottom: var(--pet-space-sm);
}
.cex__navbtn {
  flex: none;
  width: 28px;
  height: 24px;
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text);
  background: var(--pet-color-surface-raised);
  border: 1px solid var(--pet-color-border-strong);
  border-radius: var(--pet-radius-sm);
  cursor: pointer;
}
.cex__navbtn:disabled {
  opacity: 0.4;
  cursor: default;
}
.cex__pvpos {
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-muted);
}
.cex__pvfilter {
  margin-left: auto;
  font-size: var(--pet-font-size-xs);
}
.cex__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pet-space-sm);
}
.cex__role {
  flex: none;
  min-width: 64px;
  text-align: center;
  padding: 1px 6px;
  border-radius: var(--pet-radius-pill);
  font-size: 10px;
  text-transform: uppercase;
  color: var(--pet-color-text-muted);
  background: var(--pet-color-surface-raised);
}
.cex__role--assistant {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-accent);
}
.cex__hidden {
  flex: none;
  padding: 1px 5px;
  border-radius: var(--pet-radius-pill);
  font-size: 10px;
  color: var(--pet-color-text-muted);
  border: 1px solid var(--pet-color-border-strong);
}
.cex__name {
  flex: none;
  color: var(--pet-color-text);
  font-weight: var(--pet-font-weight-medium);
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
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--pet-color-text-faint);
}
.cex__panebody {
  max-height: 180px;
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
.cex__soon {
  margin: var(--pet-space-md) 0 0;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-faint);
}
.cex__metafield {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  margin-top: var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text-muted);
}
.cex__metafield--mt {
  margin-top: var(--pet-space-sm);
}
.cex__input {
  flex: 1;
  min-width: 0;
  padding: var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text);
  background: var(--pet-color-surface);
  border: 1px solid var(--pet-color-border-strong);
  border-radius: var(--pet-radius-sm);
}
.cex__input:focus {
  outline: none;
  border-color: var(--pet-color-accent);
}
.cex__input--num {
  flex: none;
  width: 72px;
}
select.cex__input {
  margin-top: var(--pet-space-sm);
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
.cex__exportbtns {
  display: flex;
  flex-wrap: wrap;
  gap: var(--pet-space-sm);
  margin-top: var(--pet-space-md);
}
.cex__btn--ghost {
  color: var(--pet-color-text-muted);
  background: transparent;
  border-color: var(--pet-color-border-strong);
}
.cex__btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
