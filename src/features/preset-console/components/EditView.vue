<script setup lang="ts">
import { computed, ref } from 'vue';
import { flattenSectionEntries, flattenSections, useConsoleStore, useUiStore } from '../store';
import Dropdown from '@/ui/Dropdown.vue';
import EditContextBar from './EditContextBar.vue';
import EditFolderNav from './EditFolderNav.vue';
import EditGroupCard from './EditGroupCard.vue';
import IconButton from '@/ui/IconButton.vue';
import ModeArrange from './ModeArrange.vue';
import type { ResolvedSection } from '../types';
import { useHideOnScroll } from '../useHideOnScroll';

const store = useConsoleStore();
const ui = useUiStore();
const { hidden: commandHidden, onScroll } = useHideOnScroll();
/** True only when the user explicitly pressed 批量; selection alone no longer latches it. */
const batchLatched = ref(false);
const selectedEntryIds = ref<string[]>([]);
const batchTargetGroupId = ref('');
const searchText = ref('');

const groupOptions = computed(() =>
  flattenSections(store.view.sections).map(s => ({ value: s.id, label: `${s.parentId ? '　' : ''}${s.name}` })),
);
const selectedCount = computed(() => selectedEntryIds.value.length);
/** The bar shows while 批量 is latched OR while anything is selected — and hides the moment both are false. */
const batchVisible = computed(() => batchLatched.value || selectedCount.value > 0);
const editableSections = computed<ResolvedSection[]>(() => {
  const sections = store.orderedSections();
  const grouped = new Set(sections.flatMap(section => flattenSectionEntries(section).map(entry => entry.id)));
  const unorganized = store.view.allEntries.filter(entry => !grouped.has(entry.id));
  if (!unorganized.length) return sections;
  // 未整理 is the leftover staging bucket — keep it at the bottom so freshly created
  // groups (which sort to the top) are clearly on top of the panel.
  return [
    ...sections,
    {
      id: '__unorganized__',
      source: 'custom',
      parentId: null,
      name: '未整理',
      rule: 'multi',
      order: Number.MAX_SAFE_INTEGER,
      pinned: false,
      hidden: false,
      required: false,
      collapsed: false,
      entries: unorganized,
      children: [],
    },
  ];
});
const hasUnorganized = computed(() => editableSections.value.some(section => section.id === '__unorganized__'));
/** Collapse-all reflects real (config) groups *and* the session-local 未整理 group. */
const allCollapsed = computed(() => {
  const anyGroup = store.view.sections.length > 0 || hasUnorganized.value;
  const realCollapsed = flattenSections(store.view.sections).every(s => s.collapsed);
  const unorgCollapsed = !hasUnorganized.value || ui.unorganizedCollapsed;
  return anyGroup && realCollapsed && unorgCollapsed;
});
function toggleCollapseAll() {
  const next = !allCollapsed.value;
  store.setAllCollapsed(next);
  if (hasUnorganized.value) ui.unorganizedCollapsed = next;
}
const filteredSections = computed<ResolvedSection[]>(() => {
  const needle = searchText.value.trim().toLowerCase();
  if (!needle) return editableSections.value;
  return editableSections.value
    .map(section => filterSection(section, needle))
    .filter((section): section is ResolvedSection => !!section);
});
const filteredEntryIds = computed(() =>
  filteredSections.value.flatMap(section => flattenSectionEntries(section).map(entry => entry.id)),
);
const allFilteredSelected = computed(
  () => filteredEntryIds.value.length > 0 && filteredEntryIds.value.every(id => selectedEntryIds.value.includes(id)),
);

function entryLabel(name: string): string {
  return name.replace(/📍|✍️|（自填）/gu, '').trim();
}

function filterSection(section: ResolvedSection, needle: string): ResolvedSection | null {
  const entries = section.entries.filter(entry => entryLabel(entry.name).toLowerCase().includes(needle));
  const children = section.children
    .map(child => filterSection(child, needle))
    .filter((child): child is ResolvedSection => !!child);
  return entries.length || children.length ? { ...section, entries, children } : null;
}

function toggleSelected(entryId: string, checked: boolean) {
  selectedEntryIds.value = checked
    ? [...new Set([...selectedEntryIds.value, entryId])]
    : selectedEntryIds.value.filter(id => id !== entryId);
}

function clearSelection() {
  selectedEntryIds.value = [];
}

function setBatchLatched(enabled: boolean) {
  batchLatched.value = enabled;
  if (!enabled) clearSelection();
}

function selectAllFiltered(checked: boolean) {
  selectedEntryIds.value = checked ? [...filteredEntryIds.value] : [];
}

function selectedEntries() {
  const selected = new Set(selectedEntryIds.value);
  return store.view.allEntries.filter(entry => selected.has(entry.id));
}
const selectedAllHidden = computed(() => {
  const entries = selectedEntries();
  return entries.length > 0 && entries.every(entry => entry.hidden);
});
const selectedAllAlwaysOn = computed(() => {
  const entries = selectedEntries();
  return entries.length > 0 && entries.every(entry => entry.alwaysOn);
});

function addBatchGroup() {
  const nextIndex = store.config.customGroups.length + 1;
  store.addGroup(`分组 ${nextIndex}`, selectedEntryIds.value);
  clearSelection();
}

function addEmptyGroup() {
  const nextIndex = store.config.customGroups.length + 1;
  store.addGroup(`分组 ${nextIndex}`, []);
}

function toggleSelectedHidden() {
  const entries = selectedEntries();
  if (!entries.length) return;
  store.setEntriesHidden(selectedEntryIds.value, !entries.every(entry => entry.hidden));
  clearSelection();
}

function toggleSelectedInput() {
  const entries = selectedEntries();
  if (!entries.length) return;
  store.setEntriesInput(selectedEntryIds.value, !entries.every(entry => entry.input));
  clearSelection();
}

function toggleSelectedAlwaysOn() {
  const entries = selectedEntries();
  if (!entries.length) return;
  store.setEntriesAlwaysOn(selectedEntryIds.value, !entries.every(entry => entry.alwaysOn));
  clearSelection();
}

function moveSelected(targetGroupId: string) {
  if (!targetGroupId || !selectedEntryIds.value.length) return;
  batchTargetGroupId.value = targetGroupId;
  store.assignEntries(selectedEntryIds.value, targetGroupId);
  batchTargetGroupId.value = '';
  clearSelection();
}

</script>

<template>
  <div class="pet-edit" :class="{ 'pet-edit--batch-visible': batchVisible && !ui.editContextId }">
    <section class="pet-command">
      <!-- Context chip strip (结构 + mode chips): pinned, never hides. -->
      <EditContextBar />
      <!-- Tools row: collapses on scroll-down to reclaim space (no overlap). -->
      <div
        v-if="!ui.editContextId"
        class="pet-command__row"
        :class="{ 'pet-command__row--hidden': commandHidden }"
      >
        <IconButton
          name="menu"
          :active="ui.editNavOpen"
          :title="ui.editNavOpen ? '隐藏结构' : '显示结构'"
          @click="ui.editNavOpen = !ui.editNavOpen"
        />
        <input v-model="searchText" class="pet-input" placeholder="搜索条目" />
        <IconButton name="add" title="新建分组" @click="addEmptyGroup" />
        <IconButton
          :name="allCollapsed ? 'unfold' : 'fold'"
          :title="allCollapsed ? '全部展开' : '全部收起'"
          @click="toggleCollapseAll"
        />
        <button
          :class="['pet-toggle', { 'pet-toggle--on': batchLatched }]"
          title="批量"
          @click="setBatchLatched(!batchLatched)"
        >
          批量
        </button>
      </div>
    </section>

    <div
      v-if="!ui.editContextId"
      class="pet-edit__workspace"
      :class="{ 'pet-edit__workspace--nav-open': ui.editNavOpen }"
    >
      <EditFolderNav v-if="ui.editNavOpen" :sections="store.view.sections" :floating="ui.compact" />
      <div v-if="ui.compact && ui.editNavOpen" class="pet-navscrim" @click="ui.editNavOpen = false" />
      <section class="pet-edit__groups" @scroll="onScroll">
        <EditGroupCard
          v-for="section in filteredSections"
          :key="section.id"
          :section="section"
          :selected-entry-ids="selectedEntryIds"
          @toggle-entry-selected="toggleSelected"
        />
      </section>
    </div>
    <ModeArrange v-else :mode-id="ui.editContextId" />

    <div v-show="batchVisible && !ui.editContextId" class="pet-batch" :class="{ 'pet-batch--active': selectedCount > 0 }">
      <label class="pet-batch__all">
        <input
          type="checkbox"
          :checked="allFilteredSelected"
          title="全选/全不选"
          @change="selectAllFiltered(($event.target as HTMLInputElement).checked)"
        />
        <span class="pet-batch__count">已选 {{ selectedCount }} 项</span>
      </label>
      <div class="pet-batch__actions">
        <IconButton name="add" title="新建分组" @click="addBatchGroup" />
        <template v-if="selectedCount > 0">
          <IconButton
            name="lock"
            :active="selectedAllAlwaysOn"
            :title="selectedAllAlwaysOn ? '取消常驻' : '设为常驻'"
            @click="toggleSelectedAlwaysOn"
          />
          <IconButton
            :name="selectedAllHidden ? 'eye-off' : 'eye'"
            :active="selectedAllHidden"
            :title="selectedAllHidden ? '取消隐藏' : '隐藏'"
            @click="toggleSelectedHidden"
          />
          <IconButton name="type" title="输入框" @click="toggleSelectedInput" />
          <Dropdown
            v-model="batchTargetGroupId"
            :options="groupOptions"
            placeholder="移动到分组..."
            placement="top"
            @update:model-value="moveSelected"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pet-edit {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: var(--pet-space-sm);
}
.pet-edit--batch-visible .pet-edit__groups {
  padding-bottom: 64px;
}
.pet-command {
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-sm);
  padding: 0;
}
/* Tools row: collapses on scroll-down to reclaim space (flow, no overlap → no masking
   background). EditContextBar above it stays pinned. Shared behaviour with in-use /
   ModeArrange via useHideOnScroll; see useHideOnScroll.ts. */
.pet-command__row {
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
.pet-command__row--hidden {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
  transform: translateY(-8px);
}
.pet-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  box-sizing: border-box;
  padding: 0 var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  line-height: var(--pet-font-leading-tight);
  color: var(--pet-color-text);
  background: color-mix(in srgb, var(--pet-color-surface), transparent 12%);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-sm);
}
.pet-input:focus {
  outline: none;
  border-color: var(--pet-color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pet-color-accent), transparent 65%);
}
.pet-toggle {
  padding: var(--pet-space-xs) var(--pet-space-md);
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--pet-radius-sm);
  cursor: pointer;
  white-space: nowrap;
}
.pet-toggle:hover {
  color: var(--pet-color-text);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 92%);
}
.pet-toggle--on {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-accent);
}
.pet-edit__groups {
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-md);
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}
.pet-edit__workspace {
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
</style>
