<script setup lang="ts">
/**
 * Mode editing surface (shown in edit when a mode chip is active). A **read-only mirror
 * of 结构**: the same side nav (EditFolderNav) reorders/nests the mode's groups, and the
 * same group cards (EditGroupCard's `mode` variant) show each group's entries — you just
 * can't edit entries or group settings here. Groups join via the 可添加分组 staging card
 * (styled like 未整理). ON/OFF snapshots are managed in 使用 mode.
 */
import { computed, ref } from 'vue';
import { flattenSections, useConsoleStore, useUiStore } from '../store';
import type { ResolvedSection } from '../types';
import { useHideOnScroll } from '../useHideOnScroll';
import Dropdown from './Dropdown.vue';
import EditFolderNav from './EditFolderNav.vue';
import EditGroupCard from './EditGroupCard.vue';
import IconButton from './IconButton.vue';

const props = defineProps<{ modeId: string }>();
const store = useConsoleStore();
const ui = useUiStore();
const { hidden: headHidden, onScroll } = useHideOnScroll();

const mode = computed(() => store.config.scenarios.find(s => s.id === props.modeId) ?? null);
const tree = computed<ResolvedSection[]>(() => (mode.value ? store.modeSections(mode.value) : []));
const modeProp = computed(() => ({ id: props.modeId }));
const addableCollapsed = ref(false);

const inModeIds = computed(() => new Set(flattenSections(tree.value).map(s => s.id)));
const addable = computed(() =>
  flattenSections(store.view.sections)
    .filter(s => !inModeIds.value.has(s.id))
    .map(s => ({ id: s.id, name: `${s.parentId ? '　' : ''}${s.name}` })),
);
const toAdd = ref<string[]>([]);
const nestTargetId = ref('');
const allAddableSelected = computed(() => addable.value.length > 0 && addable.value.every(g => toAdd.value.includes(g.id)));
const topLevelModeGroups = computed(() => tree.value.map(s => ({ value: s.id, label: s.name })));
const addBatchVisible = computed(() => toAdd.value.length > 0);

function selectAllAddable(checked: boolean): void {
  toAdd.value = checked ? addable.value.map(g => g.id) : [];
}

const allCollapsed = computed(() => {
  const all = flattenSections(tree.value);
  return all.length > 0 && all.every(s => s.collapsed);
});

function toggleCollapseAll(): void {
  store.setAllCollapsed(!allCollapsed.value, flattenSections(tree.value).map(s => s.id));
}

async function addSelected(): Promise<void> {
  if (!toAdd.value.length) return;
  const ids = [...toAdd.value];
  const parentId = nestTargetId.value || null;
  await store.addGroupsToMode(props.modeId, ids);
  if (parentId) {
    for (const id of ids) await store.setModeGroupParent(props.modeId, id, parentId);
  }
  toAdd.value = [];
  nestTargetId.value = '';
}

function rename(event: Event): void {
  store.renameScenario(props.modeId, (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div v-if="mode" class="pet-marr" :class="{ 'pet-marr--batch-visible': addBatchVisible }">
    <!-- Mode head (name + tools): collapses on scroll-down to reclaim space (no overlap). -->
    <div class="pet-marr__head" :class="{ 'pet-marr__head--hidden': headHidden }">
      <IconButton
        name="menu"
        :active="ui.editNavOpen"
        :title="ui.editNavOpen ? '隐藏结构' : '显示结构'"
        @click="ui.editNavOpen = !ui.editNavOpen"
      />
      <input class="pet-marr__name" :value="mode.name" @change="rename" />
      <IconButton
        :name="allCollapsed ? 'unfold' : 'fold'"
        :title="allCollapsed ? '全部展开' : '全部收起'"
        @click="toggleCollapseAll"
      />
      <IconButton name="trash" danger title="删除模式" @click="store.deleteScenario(modeId)" />
    </div>

    <div class="pet-marr__workspace" :class="{ 'pet-marr__workspace--nav-open': ui.editNavOpen }">
      <EditFolderNav v-if="ui.editNavOpen && tree.length" :sections="tree" :mode-id="modeId" :floating="ui.compact" />
      <div v-if="ui.compact && ui.editNavOpen && tree.length" class="pet-navscrim" @click="ui.editNavOpen = false" />
      <section class="pet-marr__groups" @scroll="onScroll">
        <EditGroupCard v-for="section in tree" :key="section.id" :section="section" :mode="modeProp" />

        <!-- 可添加分组 — the mode's staging bucket, styled like 结构's 未整理. -->
        <section v-if="addable.length" class="pet-add" :class="{ 'pet-add--collapsed': addableCollapsed }">
          <header class="pet-add__head">
            <div class="pet-add__line">
              <IconButton
                class="pet-add__disclosure"
                :class="{ 'pet-add__disclosure--collapsed': addableCollapsed }"
                name="chevron-down"
                :title="addableCollapsed ? '展开' : '收起'"
                @click="addableCollapsed = !addableCollapsed"
              />
              <span class="pet-add__name">可添加分组</span>
              <span class="pet-add__meta">{{ addable.length }} 个</span>
            </div>
            <p class="pet-add__note">这些分组还没有加入此模式，勾选后加入即可在此排序、查看条目。加入父分组会一并带上其子分组。</p>
          </header>
          <div v-show="!addableCollapsed" class="pet-add__rows">
            <label class="pet-add__row pet-add__row--all">
              <input
                class="pet-add__check"
                type="checkbox"
                :checked="allAddableSelected"
                @change="selectAllAddable(($event.target as HTMLInputElement).checked)"
              />
              <span class="pet-add__label">本组全选</span>
            </label>
            <label v-for="g in addable" :key="g.id" class="pet-add__row">
              <input v-model="toAdd" class="pet-add__check" type="checkbox" :value="g.id" />
              <span class="pet-add__label">{{ g.name }}</span>
            </label>
          </div>
        </section>

        <p v-else-if="!tree.length" class="pet-marr__empty">
          此模式还没有分组，且没有可添加的分组。先到「结构」里创建分组。
        </p>
      </section>
    </div>

    <div v-show="addBatchVisible" class="pet-batch pet-batch--active">
      <label class="pet-batch__all">
        <input
          type="checkbox"
          :checked="allAddableSelected"
          title="全选/全不选"
          @change="selectAllAddable(($event.target as HTMLInputElement).checked)"
        />
        <span class="pet-batch__count">已选 {{ toAdd.length }} 组</span>
      </label>
      <div class="pet-batch__actions">
        <button type="button" class="pet-batch__primary" @click="addSelected">加入</button>
        <Dropdown
          v-model="nestTargetId"
          :options="topLevelModeGroups"
          placeholder="嵌套至分组..."
          :disabled="!topLevelModeGroups.length"
          placement="top"
        />
        <IconButton name="close" title="清除选择" @click="toAdd = []; nestTargetId = ''" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.pet-marr {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--pet-space-sm);
  min-height: 0;
}
/* Mode head: collapses on scroll-down to reclaim space (flow, no overlap → no masking
   background). Shared behaviour with EditView + in-use; logic in useHideOnScroll.ts. */
.pet-marr__head {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
  max-height: 60px;
  opacity: 1;
  overflow: visible;
  transform: translateY(0);
  transition:
    max-height var(--pet-motion-base) var(--pet-motion-ease),
    opacity var(--pet-motion-fast) var(--pet-motion-ease),
    transform var(--pet-motion-base) var(--pet-motion-ease);
}
.pet-marr__head--hidden {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
  transform: translateY(-8px);
}
.pet-marr__name {
  flex: 1;
  min-width: 0;
  height: 32px;
  box-sizing: border-box;
  padding: 0 var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  font-weight: var(--pet-font-weight-semibold);
  line-height: var(--pet-font-leading-tight);
  color: var(--pet-color-text);
  background: var(--pet-color-surface);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-sm);
}
.pet-marr__name:focus {
  outline: none;
  border-color: var(--pet-color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pet-color-accent), transparent 65%);
}
/* Mirror EditView's workspace: bounded box, nav full-height, groups scroll inside. */
.pet-marr__workspace {
  position: relative;
  display: flex;
  flex: 1;
  align-items: stretch;
  gap: var(--pet-space-sm);
  min-height: 0;
  overflow: hidden;
}
/* Dim layer behind a floating nav drawer (compact); tap to dismiss. */
.pet-navscrim {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: color-mix(in srgb, #000, transparent 55%);
}
.pet-marr__groups {
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-md);
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}
.pet-marr--batch-visible .pet-marr__groups {
  padding-bottom: 64px;
}
.pet-marr__empty {
  margin: 0;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-faint);
  line-height: var(--pet-font-leading-normal);
}

/* Staging card — matches 结构's 未整理 (dashed divider, note, checkbox rows). */
.pet-add {
  border-bottom: 1px dashed color-mix(in srgb, var(--pet-color-border), transparent 35%);
}
.pet-add__head {
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-sm);
  padding: var(--pet-space-md) 0;
}
.pet-add:not(.pet-add--collapsed) .pet-add__head {
  border-bottom: 1px solid color-mix(in srgb, var(--pet-color-border), transparent 55%);
}
.pet-add__line {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
  min-width: 0;
}
.pet-add__disclosure {
  transition: transform var(--pet-motion-fast) var(--pet-motion-ease);
}
.pet-add__disclosure--collapsed {
  transform: rotate(-90deg);
}
.pet-add__name {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: var(--pet-font-weight-semibold);
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pet-add__meta {
  flex: none;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-faint);
}
.pet-add__note {
  margin: 0;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-faint);
  line-height: var(--pet-font-leading-normal);
}
.pet-add__rows {
  display: flex;
  flex-direction: column;
}
.pet-add__row {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  padding: var(--pet-space-xs) 0;
  font-size: var(--pet-font-size-sm);
  cursor: pointer;
}
.pet-add__row:hover {
  background: color-mix(in srgb, var(--pet-color-accent), transparent 94%);
}
.pet-add__row--all {
  border-bottom: 1px solid color-mix(in srgb, var(--pet-color-border), transparent 55%);
  font-size: var(--pet-font-size-xs);
}
.pet-add__row--all .pet-add__label {
  color: var(--pet-color-text);
}
.pet-add__check {
  flex: none;
  accent-color: var(--pet-color-accent);
}
.pet-add__label {
  flex: 1;
  min-width: 0;
  color: var(--pet-color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pet-batch {
  position: fixed;
  left: var(--pet-space-md);
  right: var(--pet-space-md);
  bottom: var(--pet-space-md);
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  padding: var(--pet-space-sm) var(--pet-space-md);
  border: 1px solid var(--pet-color-border-strong);
  border-radius: var(--pet-radius-md);
  background: var(--pet-color-surface);
  box-shadow: var(--pet-effect-shadow-md);
}
.pet-batch input[type='checkbox'] {
  accent-color: var(--pet-color-accent);
}
.pet-batch--active {
  border-color: var(--pet-color-accent);
}
.pet-batch__all {
  display: inline-flex;
  align-items: center;
  gap: var(--pet-space-xs);
  cursor: pointer;
}
.pet-batch__count {
  flex: none;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-muted);
}
.pet-batch__actions {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
  margin-left: auto;
}
.pet-batch__primary {
  flex: none;
  padding: var(--pet-space-xs) var(--pet-space-md);
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-accent-text);
  background: var(--pet-color-accent);
  border: 1px solid var(--pet-color-accent);
  border-radius: var(--pet-radius-sm);
  cursor: pointer;
}
</style>
