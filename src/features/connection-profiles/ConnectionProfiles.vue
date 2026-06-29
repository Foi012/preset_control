<script setup lang="ts">
/**
 * 连接档案 — curated rig quick-switcher (console-style layout).
 *
 * Row 1 (档案): one-tap chips for saved rig variants — tapping runs `/profile <name>` then
 * re-applies the variant's param + 附加参数 overlay (the bits ST drops). Row 2: a search box + an
 * eye toggle (on = saved only, off = also show ST profiles you haven't saved). Below, two
 * accordions: 已保存 (edit/capture/duplicate/remove variants) and 未保存 (ST profiles → add a rig).
 *
 * One ST profile can back several variants (Claude热 / Claude冷) — duplicate a saved rig and
 * recapture. The tool only references ST's profiles; it never holds the endpoint, key, or model.
 */
import { computed, onMounted, ref } from 'vue';
import { useConnectionStore } from './store';
import { paramDef, type ParamId } from './params';
import type { ExtraParams, ResolvedFavorite } from './favorites';
import Dropdown, { type DropdownOption } from '@/ui/Dropdown.vue';
import IconButton from '@/ui/IconButton.vue';
import Section from '@/ui/Section.vue';
import TextField from '@/ui/TextField.vue';
import PetIcon from '@/ui/PetIcon.vue';

const cp = useConnectionStore();

/** Which variant's editor is expanded (one at a time). */
const editId = ref<string | null>(null);

const COMMON_PARAMS: ParamId[] = ['temp_openai', 'top_p_openai', 'freq_pen_openai', 'pres_pen_openai', 'openai_max_tokens'];
const commonDefs = COMMON_PARAMS.map(id => paramDef(id)!).filter(Boolean);
const EXTRA_FIELDS: { key: keyof ExtraParams; label: string }[] = [
  { key: 'includeBody', label: '包含主体参数' },
  { key: 'excludeBody', label: '排除主体参数' },
  { key: 'headers', label: '包含请求标头' },
];

const matches = (text: string, q: string): boolean => text.toLowerCase().includes(q.trim().toLowerCase());

/** Saved variants (filtered by search) — the 档案 dropdown and the 已保存 list. */
const savedList = computed(() => cp.resolved.filter(f => matches(`${f.label} ${f.name}`, cp.search)));
/** 档案 dropdown options — every applicable saved rig (missing ones can't switch). */
const rigOptions = computed<DropdownOption[]>(() =>
  cp.resolved.filter(f => !f.missing).map(f => ({ value: f.id, label: f.model ? `${f.label} · ${f.model}` : f.label })));
/** ST profiles with no variant yet (filtered) — only shown when the eye is off. */
const unsavedList = computed(() => (cp.savedOnly ? [] : cp.unsaved.filter(p => matches(p.name, cp.search))));

/** Add a rig and jump straight into its editor (edit-on-add — no empty-then-hunt). */
function addRig(profileId: string): void {
  editId.value = cp.createVariant(profileId);
}

function paramValue(fav: ResolvedFavorite, id: ParamId): string {
  const v = fav.params?.[id]?.value;
  return v === undefined ? '' : String(v);
}
/** Commit on change (not每keystroke) so decimals like "1.1" type cleanly. Blank clears the override. */
function onParam(id: string, paramId: ParamId, e: Event): void {
  const raw = (e.target as HTMLInputElement).value.trim();
  if (raw === '') return cp.setParam(id, paramId, null);
  const n = Number(raw);
  if (Number.isFinite(n)) cp.setParam(id, paramId, n);
}
function extraValue(fav: ResolvedFavorite, key: keyof ExtraParams): string {
  return fav.extra?.[key] ?? '';
}
function onExtra(id: string, key: keyof ExtraParams, e: Event): void {
  cp.setExtra(id, key, (e.target as HTMLTextAreaElement).value);
}
const hasOverlay = (fav: ResolvedFavorite): boolean =>
  (!!fav.params && Object.keys(fav.params).length > 0) || (!!fav.extra && Object.keys(fav.extra).length > 0);

onMounted(() => cp.refresh());
</script>

<template>
  <div class="cp">
    <!-- Row 1 — 档案 dropdown: pick a rig to switch the whole connection. -->
    <div class="cp__bar">
      <span class="cp__barlabel">档案</span>
      <Dropdown
        v-if="rigOptions.length"
        class="cp__rig"
        :model-value="cp.appliedId ?? ''"
        :options="rigOptions"
        placeholder="选择并切换连接档案"
        @update:model-value="cp.apply($event)"
      />
      <span v-else class="cp__empty">还没有保存的档案 —— 在下面添加</span>
    </div>

    <!-- Row 2 — search + eye (saved-only) + refresh, mirroring the console's in-use bar. -->
    <div class="cp__tools">
      <TextField v-model="cp.search" placeholder="搜索档案" compact class="cp__search" />
      <IconButton :name="cp.savedOnly ? 'eye' : 'eye-off'" :active="cp.savedOnly"
        title="仅看已保存 / 显示全部连接配置" @click="cp.savedOnly = !cp.savedOnly" />
      <IconButton name="refresh" title="刷新连接配置" @click="cp.refresh()" />
    </div>
    <p v-if="cp.error" class="cp__error"><PetIcon name="alert" />{{ cp.error }}</p>

    <!-- 已保存 — edit / capture / duplicate / remove variants. -->
    <Section title="已保存" size="sm" :default-open="true">
      <ul v-if="savedList.length" class="cp__list">
        <li v-for="fav in savedList" :key="fav.id" class="cp__row" :class="{ 'cp__row--missing': fav.missing }">
          <div class="cp__rowtop">
            <TextField :model-value="fav.label" :placeholder="fav.name || '已删除'" compact
              @update:model-value="cp.relabel(fav.id, String($event))" />
            <span v-if="fav.missing" class="cp__tag">已删除</span>
            <span v-else class="cp__meta">{{ fav.model }}<template v-if="fav.preset"> · {{ fav.preset }}</template></span>
            <div class="cp__rowactions">
              <IconButton v-if="!fav.missing" name="sliders" title="参数覆盖" :active="editId === fav.id || hasOverlay(fav)"
                @click="editId = editId === fav.id ? null : fav.id" />
              <IconButton name="add" title="复制为新变体" @click="cp.duplicate(fav.id)" />
              <IconButton name="trash" title="移除" danger @click="cp.remove(fav.id)" />
            </div>
          </div>

          <!-- Per-rig overlay: capture from ST, tweak params, edit 附加参数. -->
          <div v-if="editId === fav.id && !fav.missing" class="cp__edit">
            <button type="button" class="cp__capture" @click="cp.capture(fav.id)">
              <PetIcon name="download" />从当前 ST 捕获参数
            </button>
            <label v-for="def in commonDefs" :key="def.id" class="cp__param">
              <span class="cp__paramlabel">{{ def.label }}</span>
              <input class="pet-field pet-field--compact cp__paraminput" type="text"
                :value="paramValue(fav, def.id)" placeholder="默认" @change="onParam(fav.id, def.id, $event)" />
            </label>
            <Section title="附加参数" size="sm" :default-open="false">
              <label v-for="ex in EXTRA_FIELDS" :key="ex.key" class="cp__extra">
                <span class="cp__paramlabel">{{ ex.label }}</span>
                <textarea class="pet-field cp__extrainput" rows="2" :value="extraValue(fav, ex.key)"
                  @change="onExtra(fav.id, ex.key, $event)"></textarea>
              </label>
            </Section>
            <p class="cp__hint">留空＝沿用档案默认。切换时写入，补上 ST 切换时不带的采样参数与附加参数。</p>
          </div>
        </li>
      </ul>
      <p v-else class="cp__empty">没有匹配的已保存档案。</p>
    </Section>

    <!-- 未保存 — ST profiles without a variant yet; add one. Only when the eye is off. -->
    <Section v-if="!cp.savedOnly" title="未保存" size="sm" :default-open="true">
      <ul v-if="unsavedList.length" class="cp__list">
        <li v-for="p in unsavedList" :key="p.id" class="cp__addrow">
          <span class="cp__addname" :title="p.name">{{ p.name }}</span>
          <span v-if="p.model" class="cp__meta">{{ p.model }}</span>
          <IconButton name="add" title="保存为档案" @click="addRig(p.id)" />
        </li>
      </ul>
      <p v-else class="cp__empty">没有更多可添加的连接配置（或 ST 不可用）。</p>
    </Section>
  </div>
</template>

<style scoped>
.cp {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-sm);
  padding: var(--pet-space-sm);
}
/* Row 1 — chip bar (mirrors the console's 模式 row). */
.cp__bar {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  min-width: 0;
}
.cp__barlabel {
  flex: none;
  font-size: var(--pet-font-size-sm);
  font-weight: var(--pet-font-weight-semibold);
  color: var(--pet-color-text-muted);
}
.cp__rig {
  flex: 1;
  min-width: 0;
}
/* Row 2 — search + tools. */
.cp__tools {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
}
.cp__search {
  flex: 1;
  min-width: 0;
}
.cp__empty {
  margin: 0;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-muted);
}
.cp__error {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-danger, #d66);
}
.cp__error :deep(.pet-icon) { width: 13px; height: 13px; flex: none; }
.cp__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cp__row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 0;
}
.cp__row--missing { opacity: 0.65; }
.cp__rowtop {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
}
.cp__rowtop :deep(.pet-field) { flex: 1; min-width: 0; }
.cp__meta {
  flex: none;
  max-width: 38%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--pet-font-size-xxs);
  color: var(--pet-color-text-muted);
}
.cp__tag { flex: none; font-size: var(--pet-font-size-xxs); color: var(--pet-color-danger, #d66); }
.cp__rowactions { display: flex; gap: 1px; flex: none; }
/* Overlay editor. */
.cp__edit {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--pet-space-xs);
  margin-left: var(--pet-space-sm);
  border-left: 2px solid color-mix(in srgb, var(--pet-color-accent), transparent 70%);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 94%);
  border-radius: var(--pet-radius-sm);
}
.cp__capture {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-accent);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 88%);
  border: 1px solid color-mix(in srgb, var(--pet-color-accent), transparent 70%);
  border-radius: var(--pet-radius-sm);
  cursor: pointer;
}
.cp__capture :deep(.pet-icon) { width: 13px; height: 13px; }
.cp__param,
.cp__extra { display: flex; align-items: center; gap: var(--pet-space-xs); }
.cp__extra { align-items: flex-start; }
.cp__paramlabel {
  flex: 1;
  min-width: 0;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text);
}
.cp__paraminput { width: 88px; flex: none; }
.cp__extrainput {
  width: 60%;
  flex: none;
  resize: vertical;
  font-family: var(--pet-font-mono, monospace);
  font-size: var(--pet-font-size-xxs);
}
.cp__hint {
  margin: 2px 0 0;
  font-size: var(--pet-font-size-xxs);
  color: var(--pet-color-text-muted);
}
.cp__addrow {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
  padding: 1px 0;
}
.cp__addname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--pet-font-size-sm);
}
</style>
