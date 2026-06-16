<script setup lang="ts">
import { computed, ref } from 'vue';
import { flattenSectionEntries, flattenSections, folderState, inUseEntries, useConsoleStore, useUiStore } from '../store';
import type { ModeSnapshot, ResolvedSection } from '../types';
import { useHideOnScroll } from '../useHideOnScroll';
import Dropdown from './Dropdown.vue';
import IconButton from './IconButton.vue';
import ModeBar from './ModeBar.vue';
import SectionCard from './SectionCard.vue';

const consoleStore = useConsoleStore();
const ui = useUiStore();
const search = ref('');
const { hidden: controlsHidden, onScroll, reveal } = useHideOnScroll();

function hasAnyEntries(section: ResolvedSection): boolean {
  return section.entries.length > 0 || section.children.some(hasAnyEntries);
}

function hasVisibleContent(section: ResolvedSection): boolean {
  if (inUseEntries(section, ui.showHidden, search.value).length > 0) return true;
  // A group whose active selection is entirely hidden (e.g. a 单选 group whose
  // chosen option is hidden) must not vanish — keep it visible so its honest
  // summary shows and the reveal affordance is reachable. Skip while searching.
  if (!search.value.trim() && flattenSectionEntries(section).some(e => e.enabled && e.hidden)) return true;
  // Folder headers stay available so users can switch profiles even when their
  // leaf entries are currently curated/search-filtered out.
  return section.children.some(child => !child.hidden && hasAnyEntries(child));
}

/** True while a mode is active (the in-use tree is scoped/arranged to it). */
const inMode = computed(() => ui.activeModeId !== null);

/** Whether the preset has any usable groups — gates the bar/ModeBar so an active mode
 *  with no visible groups can't trap the user (they can still hit 全部). */
const hasGroups = computed(() => consoleStore.view.sections.some(s => !s.hidden && hasAnyEntries(s)));

/**
 * What in-use renders: the active mode's tree (scoped + arranged) or the global
 * structure for 全部 — `store.inUseSections()` decides, and that same source drives
 * the toggle semantics so per-mode nesting is honoured.
 */
const managedSections = computed(() => consoleStore.inUseSections().filter(s => !s.hidden && hasAnyEntries(s)));
/** Curated to active direct entries; folder headers remain visible. */
const sections = computed(() => managedSections.value.filter(hasVisibleContent));
const allCollapsed = computed(
  () => sections.value.length > 0 && flattenSections(sections.value).every(s => s.collapsed),
);
/** Whether every visible group is fully on — drives the enable-all toggle's state/label. */
const allEnabled = computed(
  () => managedSections.value.length > 0 && managedSections.value.every(s => folderState(s) === 'on'),
);
const activeMode = computed(() => consoleStore.config.scenarios.find(mode => mode.id === ui.activeModeId) ?? null);
const snapshots = computed(() => (activeMode.value ? consoleStore.modeSnapshots(activeMode.value.id) : []));
const snapshotOptions = computed(() => snapshots.value.map(snapshot => ({ value: snapshot.id, label: snapshot.name })));
/** The snapshot whose saved ON/OFF state matches the live preset right now (state-derived,
 *  survives refresh/script-toggle, never stale). Null when the user has drifted off all snapshots. */
const matchedSnapshotId = computed(() => (activeMode.value ? consoleStore.matchingSnapshotId(activeMode.value.id) : null));
/** What the bar shows as "current": the session selection if any, else the live match —
 *  so after a refresh the matching snapshot's name reappears on its own. */
const effectiveSnapshotId = computed(() => ui.activeSnapshotId ?? matchedSnapshotId.value);
const activeSnapshot = computed(() => snapshots.value.find(snapshot => snapshot.id === effectiveSnapshotId.value) ?? null);
/** A snapshot is targeted but the live switches no longer match it (the user tweaked entries). */
const snapshotModified = computed(
  () => activeSnapshot.value !== null && matchedSnapshotId.value !== activeSnapshot.value.id,
);
const editingSnapshotId = ref<string | null>(null);

async function saveSnapshot(): Promise<void> {
  if (!activeMode.value) return;
  const id = await consoleStore.saveModeSnapshot(activeMode.value.id);
  if (id) {
    ui.activeSnapshotId = id;
    ui.activeSnapshotByMode[activeMode.value.id] = id;
    reveal();
  }
}

function applySnapshot(snapshot: ModeSnapshot): void {
  if (!activeMode.value) return;
  consoleStore.applyModeSnapshot(activeMode.value.id, snapshot.id);
}

function applySnapshotById(id: string): void {
  const snapshot = snapshots.value.find(item => item.id === id);
  if (snapshot) applySnapshot(snapshot);
}

function updateActiveSnapshot(): void {
  if (!activeMode.value || !activeSnapshot.value) return;
  consoleStore.updateModeSnapshot(activeMode.value.id, activeSnapshot.value.id);
}

function renameActiveSnapshot(event: Event): void {
  if (!activeMode.value || !activeSnapshot.value || activeSnapshot.value.legacy) return;
  consoleStore.renameModeSnapshot(activeMode.value.id, activeSnapshot.value.id, (event.target as HTMLInputElement).value);
  editingSnapshotId.value = null;
}

function deleteActiveSnapshot(): void {
  if (!activeMode.value || !activeSnapshot.value || activeSnapshot.value.legacy) return;
  consoleStore.deleteModeSnapshot(activeMode.value.id, activeSnapshot.value.id);
}
</script>

<template>
  <div class="pet-inuse" :class="{ 'pet-inuse--controls-hidden': controlsHidden }">
    <!-- Mode chip row: pinned, never hides (mirrors the always-visible app tabs). -->
    <ModeBar v-if="hasGroups" />

    <!-- Tools: collapse in flow on scroll-down to reclaim space. No overlap, so no
         masking background is needed. -->
    <div v-if="hasGroups" class="pet-inuse__top">
      <div v-if="activeMode" class="pet-snapshotbar">
        <span class="pet-snapshotbar__label">当前快照</span>
        <input
          v-if="activeSnapshot && editingSnapshotId === activeSnapshot.id"
          class="pet-snapshotbar__input"
          :value="activeSnapshot.name"
          title="快照名称"
          @keyup.enter="renameActiveSnapshot"
          @keyup.esc="editingSnapshotId = null"
          @blur="renameActiveSnapshot"
        />
        <Dropdown
          v-else-if="snapshots.length"
          variant="inline"
          :model-value="effectiveSnapshotId ?? ''"
          :options="snapshotOptions"
          placeholder="未应用快照"
          title="切换快照"
          @update:model-value="applySnapshotById"
        />
        <span v-else class="pet-snapshotbar__empty">暂无快照</span>
        <span
          v-if="snapshotModified && editingSnapshotId === null"
          class="pet-snapshotbar__modified"
          title="当前开关与该快照不一致，点更新可保存"
          >· 已修改</span
        >
        <span class="pet-snapshotbar__actions">
          <IconButton
            name="refresh"
            title="更新当前快照"
            :disabled="!activeSnapshot"
            @click="updateActiveSnapshot"
          />
          <IconButton
            name="edit"
            title="重命名当前快照"
            :disabled="!activeSnapshot || activeSnapshot.legacy"
            @click="editingSnapshotId = activeSnapshot?.id ?? null"
          />
          <IconButton
            name="trash"
            danger
            title="删除当前快照"
            :disabled="!activeSnapshot || activeSnapshot.legacy"
            @click="deleteActiveSnapshot"
          />
        </span>
      </div>
      <div class="pet-inuse__bar">
        <input v-model="search" class="pet-inuse__search" placeholder="搜索条目" />
        <IconButton
          name="power"
          :active="allEnabled"
          :title="allEnabled ? '全部关闭' : '全部开启'"
          @click="consoleStore.setAllEnabled(!allEnabled)"
        />
        <IconButton
          v-if="activeMode"
          name="bookmark-plus"
          title="收藏当前为快照"
          @click="saveSnapshot"
        />
        <IconButton
          :name="ui.showHidden ? 'eye' : 'eye-off'"
          :active="ui.showHidden"
          :title="ui.showHidden ? '隐藏未启用' : '显示全部'"
          @click="ui.showHidden = !ui.showHidden"
        />
        <IconButton
          :name="allCollapsed ? 'unfold' : 'fold'"
          :title="allCollapsed ? '全部展开' : '全部收起'"
          @click="consoleStore.setAllCollapsed(!allCollapsed)"
        />
      </div>
    </div>

    <div class="pet-inuse__scroll" @scroll="onScroll">
      <SectionCard v-for="section in sections" :key="section.id" :section="section" :search="search" />
      <p v-if="hasGroups && !sections.length" class="pet-inuse__empty">
        <template v-if="inMode && !managedSections.length">此模式还没有分组。在「编辑 · 模式」里添加分组，或点上方「全部」。</template>
        <template v-else-if="search.trim()">没有匹配的条目。</template>
        <template v-else>当前没有已启用的条目。点击右上角的眼睛图标显示全部条目。</template>
      </p>
    </div>
  </div>
</template>

<style scoped>
.pet-inuse {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: var(--pet-space-sm);
}
/* Tools (snapshot status + search/actions). A normal flow element above the scroll —
   it collapses on scroll-down to reclaim space for the list, so it never overlaps the
   cards and needs no masking background. The mode chip row (ModeBar) sits above this
   and stays pinned. */
.pet-inuse__top {
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-sm);
  max-height: 120px;
  opacity: 1;
  overflow: visible;
  transform: translateY(0);
  transition:
    max-height var(--pet-motion-base) var(--pet-motion-ease),
    opacity var(--pet-motion-fast) var(--pet-motion-ease),
    transform var(--pet-motion-base) var(--pet-motion-ease);
}
.pet-inuse--controls-hidden .pet-inuse__top {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
  transform: translateY(-8px);
}
/* Snapshot status — a subordinate control under the mode chips. It is intentionally
   not another chip strip, so mode selection and snapshot swapping don't compete. */
.pet-snapshotbar {
  position: relative;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
  flex: none;
  min-width: 0;
}
.pet-snapshotbar__label {
  flex: none;
  font-size: var(--pet-font-size-xs);
  font-weight: var(--pet-font-weight-semibold);
  color: var(--pet-color-text-faint);
}
.pet-snapshotbar__input {
  width: 112px;
  min-width: 0;
  height: 28px;
  box-sizing: border-box;
  padding: 0 var(--pet-space-xs);
  font-size: var(--pet-font-size-sm);
  font-weight: var(--pet-font-weight-semibold);
  line-height: var(--pet-font-leading-tight);
  color: var(--pet-color-text);
  background: var(--pet-color-surface-raised);
  border: 1px solid var(--pet-color-accent);
  border-radius: var(--pet-radius-sm);
}
.pet-snapshotbar__input:focus {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pet-color-accent), transparent 65%);
}
.pet-snapshotbar__actions {
  display: inline-flex;
  align-items: center;
  flex: none;
  /* Push the action cluster to the right edge, matching the group-header layout rule
     (title …flex… right-side cluster) used across the other surfaces. */
  margin-left: auto;
  gap: var(--pet-space-xs);
}
.pet-snapshotbar__empty {
  flex: none;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-faint);
}
.pet-snapshotbar__modified {
  flex: none;
  font-size: var(--pet-font-size-xs);
  font-weight: var(--pet-font-weight-medium);
  color: var(--pet-color-text-muted);
  white-space: nowrap;
}
.pet-inuse__scroll {
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-md);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.pet-inuse__bar {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
}
.pet-inuse__search {
  flex: 1;
  min-width: 0;
  height: 32px;
  box-sizing: border-box;
  padding: 0 var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  line-height: var(--pet-font-leading-tight);
  color: var(--pet-color-text);
  background: var(--pet-color-surface-raised);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-sm);
}
.pet-inuse__search:focus {
  outline: none;
  border-color: var(--pet-color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pet-color-accent), transparent 65%);
}
.pet-inuse__empty {
  margin: 0;
  padding: var(--pet-space-md) var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text-faint);
  line-height: var(--pet-font-leading-normal);
  text-align: center;
}
</style>
