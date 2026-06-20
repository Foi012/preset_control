<script setup lang="ts">
import { computed } from 'vue';
import {
  entryDisplayName,
  flattenSectionEntries,
  folderState,
  inUseEntries,
  plainDescendants,
  useConsoleStore,
  useUiStore,
} from '../store';
import type { ResolvedSection, SectionRule } from '../types';
import EntryRow from './EntryRow.vue';
import IconButton from '@/ui/IconButton.vue';
import PetIcon from '@/ui/PetIcon.vue';
import SelectMark from './SelectMark.vue';

const props = withDefaults(
  defineProps<{ section: ResolvedSection; search?: string; parentRule?: SectionRule; nested?: boolean }>(),
  {
    search: '',
    parentRule: undefined,
    nested: false,
  },
);
const store = useConsoleStore();
const ui = useUiStore();

const ruleLabel = computed(() => (props.section.rule === 'single' ? '单选' : '多选'));
// Curated by default; the reveal toggle shows disabled/hidden entries, the search narrows them.
const visibleEntries = computed(() => inUseEntries(props.section, ui.showHidden, props.search));
const visibleChildren = computed(() => props.section.children.filter(child => !child.hidden));
// Every group with something togglable gets a master (whole-group on/off), not just
// folders/children — only all-locked groups (no plain entries, no children) skip it.
const showMasterToggle = computed(
  () => plainDescendants(props.section).length > 0 || props.section.children.length > 0,
);
const masterState = computed(() => folderState(props.section));
const masterAffordance = computed(() => (props.parentRule === 'single' ? 'radio' : 'checkbox'));

/**
 * One-line summary of what's on, shown when the group is collapsed so it stays
 * glanceable. This is a *status readout*, not the curated list, so it always tells
 * the truth: every enabled entry counts, even one the edit-mode 隐藏 rule keeps out
 * of the list. Otherwise a group whose active selection is hidden (e.g. the chosen
 * 单选 option) would read `未选择` while it is, in fact, selected.
 */
const summary = computed(() => {
  const on = flattenSectionEntries(props.section)
    .filter(e => e.enabled)
    .map(e => entryDisplayName(e.name));
  return on.length ? on.join('、') : '未选择';
});

/**
 * The group has an active selection that the 隐藏 rule keeps out of the curated
 * list, and reveal is off — so an expanded group would otherwise look empty while
 * its summary names a selection. Surfaces a reveal affordance instead of a blank.
 */
const hasHiddenSelection = computed(() =>
  flattenSectionEntries(props.section).some(e => e.enabled && e.hidden),
);
const revealNeeded = computed(
  () => !ui.showHidden && hasHiddenSelection.value && !visibleEntries.value.length && !visibleChildren.value.length,
);

function toggleMaster(): void {
  store.toggleFolder(props.section);
}
</script>

<template>
  <section class="pet-section" :class="{ 'pet-section--collapsed': section.collapsed, 'pet-section--nested': nested }">
    <header class="pet-section__head" @click="store.toggleGroupCollapsed(section.id)">
      <IconButton
        class="pet-section__disclosure"
        :class="{ 'pet-section__disclosure--collapsed': section.collapsed }"
        name="chevron-down"
        :title="section.collapsed ? '展开' : '收起'"
        @click.stop="store.toggleGroupCollapsed(section.id)"
      />
      <button
        v-if="showMasterToggle"
        type="button"
        class="pet-section__master"
        :title="masterState === 'on' ? '关闭整组' : '开启整组'"
        @click.stop="toggleMaster"
      >
        <SelectMark :type="masterAffordance" :state="masterState" />
      </button>
      <span class="pet-section__name">{{ section.name }}</span>
      <!-- Right cluster: pin + badges grouped together (group-header rule). -->
      <span class="pet-section__badges">
        <span v-if="section.pinned" class="pet-section__pin" title="已置顶"><PetIcon name="pin" /></span>
        <span :class="['pet-rule', `pet-rule--${section.rule}`]">{{ ruleLabel }}</span>
        <span v-if="section.required" class="pet-rule pet-rule--required" title="必开">必开</span>
      </span>
    </header>
    <p v-if="section.collapsed" class="pet-section__summary" @click="store.toggleGroupCollapsed(section.id)">
      {{ summary }}
    </p>
    <div v-else class="pet-section__body">
      <button v-if="revealNeeded" type="button" class="pet-section__reveal" @click="ui.showHidden = true">
        当前选择已隐藏 · 点击显示
      </button>
      <div v-if="visibleEntries.length" class="pet-section__grid">
        <EntryRow v-for="entry in visibleEntries" :key="entry.id" :section="section" :entry="entry" />
      </div>
      <div v-if="visibleChildren.length" class="pet-section__children">
        <SectionCard
          v-for="child in visibleChildren"
          :key="child.id"
          :section="child"
          :search="search"
          :parent-rule="section.rule"
          nested
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.pet-section {
  /* No card box — the entry tiles are the only boxes, so groups stay flat. A
     bottom rule divides one group from the next (mirrors edit-mode group cards). */
  background: transparent;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--pet-color-border), transparent 35%);
  border-radius: 0;
  overflow: visible;
}
.pet-section--nested {
  border-bottom: 0;
  border-left: 2px solid color-mix(in srgb, var(--pet-color-border-strong), transparent 30%);
  margin-left: var(--pet-space-xs);
  padding-left: var(--pet-space-md);
}
.pet-section__head {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  padding: var(--pet-space-sm) 0;
  cursor: pointer;
}
.pet-section--nested .pet-section__head {
  padding: var(--pet-space-xs) 0;
}
.pet-section__disclosure {
  transition: transform var(--pet-motion-fast) var(--pet-motion-ease);
}
.pet-section__disclosure--collapsed {
  transform: rotate(-90deg);
}
.pet-section__name {
  flex: 1;
  min-width: 0;
  font-weight: var(--pet-font-weight-semibold);
  font-size: var(--pet-font-size-lg);
  line-height: var(--pet-font-leading-tight);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pet-section__pin {
  display: inline-flex;
  flex: none;
  color: var(--pet-color-text-faint);
}
/* Badges sit at the right of the header, mirroring edit-mode group cards. */
.pet-section__badges {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--pet-space-xs);
}
.pet-rule {
  padding: 1px var(--pet-space-xs);
  font-size: var(--pet-font-size-xs);
  border-radius: var(--pet-radius-sm);
  color: var(--pet-color-accent-text);
}
.pet-rule--single {
  background: var(--pet-color-rule-single);
}
.pet-rule--multi {
  background: var(--pet-color-rule-multi);
}
.pet-rule--required {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-rule-always-on);
}
.pet-section__summary {
  margin: 0;
  padding: 0 0 var(--pet-space-sm) 42px;
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.pet-section__body {
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-md);
  padding: 0 0 var(--pet-space-sm);
}
.pet-section__reveal {
  align-self: flex-start;
  padding: var(--pet-space-xs) var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text-faint);
  background: transparent;
  border: 1px dashed var(--pet-color-border);
  border-radius: var(--pet-radius-sm);
  cursor: pointer;
}
.pet-section__reveal:hover {
  color: var(--pet-color-text);
  border-color: var(--pet-color-border-strong);
}
.pet-section--nested .pet-section__body {
  padding: 0 0 var(--pet-space-sm);
}
.pet-section__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--pet-space-sm);
}
.pet-section__children {
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-sm);
}
.pet-section__master {
  flex: none;
  display: grid;
  place-items: center;
  padding: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.pet-section--nested .pet-section__name {
  font-size: var(--pet-font-size-base);
}
</style>
