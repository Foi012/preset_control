<script setup lang="ts">
import { computed, ref } from 'vue';
import { flattenSectionEntries, flattenSections, folderState, inUseEntries, useConsoleStore, useUiStore } from '../store';
import type { ResolvedSection } from '../types';
import { useHideOnScroll } from '../useHideOnScroll';
import IconButton from '@/ui/IconButton.vue';
import SearchField from '@/ui/SearchField.vue';
import SectionCard from './SectionCard.vue';

const consoleStore = useConsoleStore();
const ui = useUiStore();
const search = ref('');
const { hidden: controlsHidden, onScroll } = useHideOnScroll();

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
</script>

<template>
  <div class="pet-inuse" :class="{ 'pet-inuse--controls-hidden': controlsHidden }">
    <div class="pet-inuse__top">
      <div class="pet-inuse__bar">
        <SearchField v-model="search" placeholder="搜索条目" />
        <IconButton
          name="power"
          :active="allEnabled"
          :title="allEnabled ? '全部关闭' : '全部开启'"
          @click="consoleStore.setAllEnabled(!allEnabled)"
        />
        <IconButton
          :name="ui.showHidden ? 'eye' : 'eye-off'"
          :active="ui.showHidden"
          :title="ui.showHidden ? '只看开启且未隐藏的条目' : '显示全部条目（含关闭和隐藏项）'"
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
      <p v-if="!sections.length" class="pet-inuse__empty">
        <template v-if="search.trim()">没有匹配的条目。</template>
        <template v-else>当前没有可显示的已开启条目。点击眼睛图标可查看关闭或隐藏的条目。</template>
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
/* Search controls collapse on scroll to leave room for entries. */
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
/* Search input now uses the shared SearchField (same look). */
.pet-inuse__empty {
  margin: 0;
  padding: var(--pet-space-md) var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text-faint);
  line-height: var(--pet-font-leading-normal);
  text-align: center;
}
</style>
