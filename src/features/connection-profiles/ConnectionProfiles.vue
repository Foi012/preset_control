<script setup lang="ts">
/**
 * 连接档案 — curated rig quick-switcher (console-style).
 *
 * Row 1 (档案): a Dropdown to switch the whole rig (`/profile` + re-apply the variant's param +
 * 附加参数 overlay — the bits ST drops). Row 2: a shared SearchField + eye toggle (saved-only) +
 * refresh. Below: the always-visible **已保存** list (each a 2-row card: editable name / model;
 * actions on the right), then the **未保存** accordion (ST profiles you can configure-then-add via
 * a draft — edit-then-add). One ST profile can back several variants (Claude热/Claude冷).
 */
import { computed, onMounted, ref } from 'vue';
import { useConnectionStore } from './store';
import type { ParamId } from './params';
import type { ParamSetting } from './policy';
import type { ConnProfileLite, ExtraParams, ResolvedFavorite } from './favorites';
import Dropdown, { type DropdownOption } from '@/ui/Dropdown.vue';
import SearchField from '@/ui/SearchField.vue';
import IconButton from '@/ui/IconButton.vue';
import Section from '@/ui/Section.vue';
import TextField from '@/ui/TextField.vue';
import Button from '@/ui/Button.vue';
import PetIcon from '@/ui/PetIcon.vue';
import RigEditor from './RigEditor.vue';

const cp = useConnectionStore();

/** Which saved variant's editor is expanded (one at a time). */
const editId = ref<string | null>(null);

/** A pending new rig — configured before it's saved (edit-then-add). One at a time. */
interface Draft { profileId: string; label: string; params: Partial<Record<ParamId, ParamSetting>>; extra: ExtraParams }
const draft = ref<Draft | null>(null);

const matches = (text: string, q: string): boolean => text.toLowerCase().includes(q.trim().toLowerCase());

const savedList = computed(() => cp.resolved.filter(f => matches(`${f.label} ${f.name}`, cp.search)));
const rigOptions = computed<DropdownOption[]>(() =>
  cp.resolved.filter(f => !f.missing).map(f => ({ value: f.id, label: f.model ? `${f.label} · ${f.model}` : f.label })));
const unsavedList = computed(() => (cp.savedOnly ? [] : cp.unsaved.filter(p => matches(p.name, cp.search))));

const hasOverlay = (fav: ResolvedFavorite): boolean =>
  (!!fav.params && Object.keys(fav.params).length > 0) || (!!fav.extra && Object.keys(fav.extra).length > 0);

// --- draft (edit-then-add) -------------------------------------------------
function startDraft(p: ConnProfileLite): void {
  draft.value = { profileId: p.id, label: p.name, params: {}, extra: {} };
}
function draftParam(id: ParamId, value: number | null): void {
  if (!draft.value) return;
  if (value === null) delete draft.value.params[id];
  else draft.value.params[id] = { mode: 'send', value };
}
function draftExtra(key: keyof ExtraParams, value: string): void {
  if (!draft.value) return;
  if (value.trim()) draft.value.extra[key] = value;
  else delete draft.value.extra[key];
}
function draftCapture(): void {
  if (!draft.value) return;
  const { params, extra } = cp.captureValues();
  draft.value.params = params;
  draft.value.extra = extra;
}
function confirmDraft(): void {
  if (!draft.value) return;
  cp.addDraft(draft.value.profileId, draft.value.label.trim(), draft.value.params, draft.value.extra);
  draft.value = null;
}

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

    <!-- Row 2 — shared search + eye (saved-only) + refresh. -->
    <div class="cp__tools">
      <SearchField v-model="cp.search" placeholder="搜索档案" />
      <IconButton :name="cp.savedOnly ? 'eye' : 'eye-off'" :active="cp.savedOnly"
        title="仅看已保存 / 显示全部连接配置" @click="cp.savedOnly = !cp.savedOnly" />
      <IconButton name="refresh" title="刷新连接配置" @click="cp.refresh()" />
    </div>
    <p v-if="cp.error" class="cp__error"><PetIcon name="alert" />{{ cp.error }}</p>

    <!-- 已保存 — always visible (not an accordion). 2-row cards. -->
    <div class="cp__saved">
      <span class="cp__heading">已保存</span>
      <ul v-if="savedList.length" class="cp__list">
        <li v-for="fav in savedList" :key="fav.id" class="cp__row" :class="{ 'cp__row--missing': fav.missing }">
          <div class="cp__rowmain">
            <div class="cp__rowinfo">
              <TextField inline size="sm" :model-value="fav.label" :placeholder="fav.name || '已删除'"
                @update:model-value="cp.relabel(fav.id, String($event))" />
              <span v-if="fav.missing" class="cp__tag">已删除</span>
              <span v-else class="cp__model">{{ fav.model }}<template v-if="fav.preset"> · {{ fav.preset }}</template></span>
            </div>
            <div class="cp__rowactions">
              <IconButton v-if="!fav.missing" name="sliders" title="参数覆盖" :active="editId === fav.id || hasOverlay(fav)"
                @click="editId = editId === fav.id ? null : fav.id" />
              <IconButton v-if="!fav.missing" name="add" title="复制为新变体" @click="cp.duplicate(fav.id)" />
              <IconButton name="trash" title="移除" danger @click="cp.remove(fav.id)" />
            </div>
          </div>
          <RigEditor v-if="editId === fav.id && !fav.missing" :params="fav.params" :extra="fav.extra"
            @param="(p: ParamId, v: number | null) => cp.setParam(fav.id, p, v)"
            @extra="(k: keyof ExtraParams, v: string) => cp.setExtra(fav.id, k, v)"
            @capture="cp.capture(fav.id)" />
        </li>
      </ul>
      <p v-else class="cp__empty">没有匹配的已保存档案。</p>
    </div>

    <!-- 未保存 — ST profiles without a variant; configure a draft, then add. Only when the eye is off. -->
    <Section v-if="!cp.savedOnly" title="未保存" size="sm" :default-open="true">
      <ul v-if="unsavedList.length" class="cp__list">
        <li v-for="p in unsavedList" :key="p.id" class="cp__row">
          <div class="cp__rowmain">
            <div class="cp__rowinfo">
              <span class="cp__addname" :title="p.name">{{ p.name }}</span>
              <span v-if="p.model" class="cp__model">{{ p.model }}</span>
            </div>
            <IconButton name="add" title="配置并添加" :active="draft?.profileId === p.id"
              @click="draft?.profileId === p.id ? (draft = null) : startDraft(p)" />
          </div>
          <!-- Draft editor: configure label + params + 附加参数, then 添加. -->
          <div v-if="draft && draft.profileId === p.id" class="cp__draft">
            <TextField size="sm" :model-value="draft.label" placeholder="档案名称（可改）"
              @update:model-value="draft && (draft.label = String($event))" />
            <RigEditor :params="draft.params" :extra="draft.extra"
              @param="draftParam" @extra="draftExtra" @capture="draftCapture" />
            <div class="cp__draftactions">
              <Button size="sm" @click="confirmDraft">添加档案</Button>
              <Button size="sm" variant="ghost" @click="draft = null">取消</Button>
            </div>
          </div>
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
.cp__rig { flex: 1; min-width: 0; }
.cp__tools {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
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
.cp__heading {
  display: block;
  font-size: var(--pet-font-size-xs);
  font-weight: var(--pet-font-weight-semibold);
  color: var(--pet-color-text-muted);
  margin-bottom: 2px;
}
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
  padding: 3px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--pet-color-border), transparent 40%);
}
.cp__row--missing { opacity: 0.65; }
/* 2-row card: name / model stacked on the left, actions vertically centered on the right. */
.cp__rowmain {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
}
.cp__rowinfo {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cp__rowinfo :deep(.pet-field) { width: 100%; }
.cp__model {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 var(--pet-space-xs);
  font-size: var(--pet-font-size-xxs);
  color: var(--pet-color-text-muted);
}
.cp__addname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px var(--pet-space-xs);
  font-size: var(--pet-font-size-sm);
}
.cp__tag { padding: 0 var(--pet-space-xs); font-size: var(--pet-font-size-xxs); color: var(--pet-color-danger, #d66); }
.cp__rowactions { display: flex; gap: 1px; flex: none; }
.cp__draft {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cp__draftactions {
  display: flex;
  gap: var(--pet-space-xs);
}
</style>
