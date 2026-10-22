<script setup lang="ts">
import { computed, ref } from 'vue';
import { useConsoleStore, useUiStore } from '../store';
import type { ResolvedEntry, ResolvedSection } from '../types';
import EntryRow from './EntryRow.vue';
import IconButton from '@/ui/IconButton.vue';
import Segmented from '@/ui/Segmented.vue';

const props = defineProps<{
  section: ResolvedSection;
  selectedEntryIds?: string[];
  nested?: boolean;
}>();
const emit = defineEmits<{
  toggleEntrySelected: [entryId: string, checked: boolean];
}>();
const store = useConsoleStore();
const ui = useUiStore();

const isUnorganized = computed(() => props.section.id === '__unorganized__');
const REQUIRED_OPTIONS = [
  { value: 'required', label: '至少开启一项' },
  { value: 'optional', label: '允许全部关闭' },
];
const RULE_OPTIONS = [
  { value: 'single', label: '单选' },
  { value: 'multi', label: '多选' },
];

// 未整理 has no config record, so its collapse state lives in the UI store; real groups persist it.
const isCollapsed = computed(() => (isUnorganized.value ? ui.unorganizedCollapsed : props.section.collapsed));
// Less common group settings stay behind the gear; deletion is visible in the header.
// so the default card is just chevron · name · count — far less to scan per group.
const showSettings = ref(false);

function toggleCollapsed() {
  if (isUnorganized.value) ui.unorganizedCollapsed = !ui.unorganizedCollapsed;
  else store.toggleGroupCollapsed(props.section.id);
}

function entryLabel(entry: ResolvedEntry): string {
  return entry.name.replace(/📍|✍️|（自填）/gu, '').trim();
}

function onRename(event: Event) {
  if (isUnorganized.value) return;
  store.renameGroup(props.section.id, (event.target as HTMLInputElement).value);
}

function isSelected(entryId: string): boolean {
  return (props.selectedEntryIds ?? []).includes(entryId);
}

function setAllSelected(checked: boolean): void {
  for (const entry of props.section.entries) emit('toggleEntrySelected', entry.id, checked);
}
</script>

<template>
  <section
    :id="`pet-egroup-${section.id}`"
    class="pet-egroup"
    :class="{
      'pet-egroup--hidden': section.hidden,
      'pet-egroup--unorganized': isUnorganized,
      'pet-egroup--collapsed': isCollapsed,
      'pet-egroup--nested': nested,
    }"
  >
    <header class="pet-egroup__head">
      <div class="pet-egroup__line pet-egroup__line--title">
        <IconButton
          class="pet-egroup__disclosure"
          :class="{ 'pet-egroup__disclosure--collapsed': isCollapsed }"
          name="chevron-down"
          :title="isCollapsed ? '展开' : '收起'"
          @click="toggleCollapsed"
        />
        <input class="pet-egroup__name" :readonly="isUnorganized" :value="section.name" @change="onRename" />
        <span class="pet-egroup__metas">
          <span class="pet-egroup__meta">{{ section.entries.length }} 项</span>
          <template v-if="!isUnorganized">
            <span :class="['pet-badge', `pet-badge--${section.rule}`]">{{
              section.rule === 'single' ? '单选' : '多选'
            }}</span>
            <span :class="['pet-badge', section.required ? 'pet-badge--req-on' : 'pet-badge--req-off']">{{
              section.required ? '至少开启一项' : '允许全部关闭'
            }}</span>
          </template>
        </span>
        <IconButton
          v-if="!isUnorganized"
          name="settings"
          title="设置"
          :active="showSettings"
          @click="showSettings = !showSettings"
        />
        <IconButton v-if="!isUnorganized && section.source === 'custom'" name="trash" :title="`删除分组 ${section.name}`" danger @click="store.deleteGroup(section.id)" />
      </div>

      <p v-if="isUnorganized" class="pet-egroup__note">
        这些条目还没有分组。勾选后选择「移动到分组」，即可在快速面板中使用。
      </p>
      <div v-else-if="showSettings" class="pet-egroup__settings">
        <Segmented
          :model-value="section.rule === 'folder' ? 'multi' : section.rule"
          :options="RULE_OPTIONS"
          @update:model-value="store.setGroupRule(section.id, $event as 'single' | 'multi' | 'folder')"
        />
        <Segmented
          :model-value="section.required ? 'required' : 'optional'"
          :options="REQUIRED_OPTIONS"
          @update:model-value="store.setGroupRequired(section.id, $event === 'required')"
        />
        <div class="pet-egroup__actions">
          <IconButton
            name="pin"
            :title="section.pinned ? '取消置顶' : '置顶'"
            :active="section.pinned"
            @click="store.toggleGroupPinned(section.id)"
          />
          <IconButton
            :name="section.hidden ? 'eye-off' : 'eye'"
            :title="section.hidden ? '取消隐藏' : '隐藏'"
            :active="section.hidden"
            @click="store.toggleGroupHidden(section.id)"
          />

        </div>
      </div>
    </header>

    <div v-show="!isCollapsed" class="pet-egroup__body">
      <div class="pet-egroup__rows">
        <div class="pet-egroup__bulk">
          <label class="pet-check">
            <input
              type="checkbox"
              :checked="section.entries.length > 0 && section.entries.every(e => isSelected(e.id))"
              :disabled="!section.entries.length"
              @change="setAllSelected(($event.target as HTMLInputElement).checked)"
            />
            选择本组全部条目
          </label>
        </div>

        <div v-for="entry in section.entries" :key="entry.id" class="pet-erow">
          <input
            class="pet-erow__select"
            type="checkbox"
            :checked="isSelected(entry.id)"
            title="选择条目"
            @change="emit('toggleEntrySelected', entry.id, ($event.target as HTMLInputElement).checked)"
          />
          <span class="pet-erow__label">{{ entryLabel(entry) }}</span>
          <IconButton
            name="lock"
            :active="entry.alwaysOn"
            :title="entry.alwaysOn ? '允许关闭' : '锁定开启'"
            @click="store.toggleEntryAlwaysOn(entry.id)"
          />
          <IconButton
            :name="entry.hidden ? 'eye-off' : 'eye'"
            :active="entry.hidden"
            :title="entry.hidden ? '取消隐藏' : '隐藏'"
            @click="store.toggleEntryHidden(entry.id)"
          />
        </div>
        <p v-if="!section.entries.length" class="pet-egroup__empty">这个分组还是空的。点击「批量选择」，勾选条目后移动到这里。</p>
      </div>

      <div v-if="section.children.length" class="pet-egroup__children">
        <EditGroupCard
          v-for="child in section.children"
          :key="child.id"
          :section="child"
          :selected-entry-ids="selectedEntryIds"
          nested
          @toggle-entry-selected="(entryId, checked) => emit('toggleEntrySelected', entryId, checked)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.pet-egroup {
  container: pet-group-card / inline-size;
  background: transparent;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--pet-color-border), transparent 35%);
  border-radius: 0;
  box-shadow: none;
  overflow: visible;
}
.pet-egroup--hidden {
  opacity: 0.6;
}
.pet-egroup--unorganized {
  border-bottom-style: dashed;
}
.pet-egroup--nested {
  margin-left: var(--pet-space-md);
  padding-left: var(--pet-space-sm);
  border-left: 1px solid color-mix(in srgb, var(--pet-color-border), transparent 25%);
  background: transparent;
}
.pet-egroup__head {
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-sm);
  padding: var(--pet-space-md) 0;
}
.pet-egroup:not(.pet-egroup--collapsed) .pet-egroup__head {
  border-bottom: 1px solid color-mix(in srgb, var(--pet-color-border), transparent 55%);
}
.pet-egroup__line {
  display: flex;
  align-items: center;
  min-width: 0;
}
.pet-egroup__line--title {
  gap: var(--pet-space-xs);
}
.pet-badge {
  flex: none;
  padding: 1px var(--pet-space-xs);
  font-size: var(--pet-font-size-xs);
  line-height: 1.4;
  border-radius: var(--pet-radius-sm);
}
.pet-badge--single {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-rule-single);
}
.pet-badge--multi {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-rule-multi);
}
.pet-badge--req-on {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-rule-always-on);
}
.pet-badge--req-off {
  color: var(--pet-color-text-muted);
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--pet-color-border-strong);
}
.pet-egroup__settings {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
  flex-wrap: wrap;
  overflow: visible;
  padding: var(--pet-space-xs) 0 0;
  border-radius: var(--pet-radius-sm);
  background: transparent;
}
.pet-egroup__disclosure {
  transition: transform var(--pet-motion-fast) var(--pet-motion-ease);
}
.pet-egroup__disclosure--collapsed {
  transform: rotate(-90deg);
}
/* Right-side cluster: entry count + rule/required badges grouped together, so every
   group header (quick switches / quick grouping) reads title …flex… [count + badges] [action]. */
.pet-egroup__metas {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--pet-space-xs);
}
.pet-egroup__name {
  flex: 1 1 auto;
  min-width: 3ch;
  padding: var(--pet-space-xxs) var(--pet-space-xs);
  font-weight: var(--pet-font-weight-semibold);
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--pet-radius-sm);
}
.pet-egroup__name:hover:not([readonly]) {
  border-color: var(--pet-color-border);
}
.pet-egroup__name:focus {
  outline: none;
  border-color: var(--pet-color-accent);
  background: var(--pet-color-surface);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pet-color-accent), transparent 65%);
}
.pet-egroup__meta {
  flex: none;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-faint);
}
.pet-egroup__note {
  margin: 0;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-faint);
  line-height: var(--pet-font-leading-normal);
}
.pet-egroup__actions {
  display: flex;
  flex: none;
  gap: var(--pet-space-xxs);
  margin-left: auto;
}
.pet-egroup__body {
  display: flex;
  flex-direction: column;
}
.pet-egroup__rows {
  display: flex;
  flex-direction: column;
}
.pet-egroup__children {
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-sm);
  padding: var(--pet-space-sm) 0 var(--pet-space-md);
}
.pet-egroup__bulk {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
  padding: var(--pet-space-xs) 0;
  border-bottom: 1px solid color-mix(in srgb, var(--pet-color-border), transparent 55%);
}
.pet-check {
  display: inline-flex;
  align-items: center;
  gap: var(--pet-space-xs);
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text);
}
.pet-check input,
.pet-erow__select {
  accent-color: var(--pet-color-accent);
}
.pet-erow {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  padding: var(--pet-space-xs) 0;
  font-size: var(--pet-font-size-sm);
}
.pet-erow:hover {
  background: color-mix(in srgb, var(--pet-color-accent), transparent 94%);
}
.pet-erow__select {
  flex: none;
}
.pet-erow__label {
  flex: 1;
  min-width: 0;
  color: var(--pet-color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pet-egroup__empty {
  margin: 0;
  padding: var(--pet-space-sm) 0;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-faint);
}
/* Keep names and actions visible when clearer rule labels need a second line. */
@container pet-group-card (max-width: 300px) {
  .pet-egroup__line--title { flex-wrap: wrap; }
  .pet-egroup__metas { order: 1; flex-basis: 100%; flex-wrap: wrap; padding-left: 28px; box-sizing: border-box; }
  .pet-egroup__name { min-width: 8ch; }
}
</style>
