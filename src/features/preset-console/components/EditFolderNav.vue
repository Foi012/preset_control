<script setup lang="ts">
import { ref } from 'vue';
import type { ResolvedSection } from '../types';
import { useConsoleStore } from '../store';
import GroupTree from './GroupTree.vue';
const props = defineProps<{ sections: ResolvedSection[]; floating?: boolean }>();
const store = useConsoleStore();
const selected = ref('');
const root = ref<HTMLElement>();
function place(id: string, parentId: string | null, beforeId: string | null): void {
  store.placeGroup(id, parentId, beforeId);
}
function nudge(id: string, delta: -1 | 1): void { store.nudgeGroup(id, delta); }
function focusGroup(id: string): void {
  selected.value = id;
  (root.value?.getRootNode() as Document | ShadowRoot)?.querySelector(`#${CSS.escape(`pet-egroup-${id}`)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
</script>
<template>
  <aside ref="root" class="pet-fnav" :class="{ 'pet-fnav--floating': floating }">
    <div class="pet-fnav__head"><span>分组结构</span><span class="pet-fnav__hint">拖进另一个分组成为子组 · 最多三层</span></div>
    <GroupTree :sections="sections" :selected="selected" @select="focusGroup" @move="place" @nudge="nudge" />
  </aside>
</template>
<style scoped>
.pet-fnav {
  display: flex;
  flex: 0 0 132px;
  height: 100%;
  flex-direction: column;
  gap: var(--pet-space-xs);
  align-self: stretch;
  padding: var(--pet-space-sm) var(--pet-space-md) var(--pet-space-sm) var(--pet-space-xs);
  margin-right: var(--pet-space-xs);
  overflow-y: auto;
  border-right: 1px solid var(--pet-color-border);
}
/* Compact (mobile): float over the content as a drawer instead of a fixed split. */
.pet-fnav--floating {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 3;
  flex: none;
  width: min(260px, 82%);
  margin-right: 0;
  padding-right: var(--pet-space-sm);
  background: var(--pet-color-surface);
  box-shadow: var(--pet-effect-shadow-md);
}
.pet-fnav__head {
  display: flex;
  flex-direction: column;
  font-size: var(--pet-font-size-xs);
  font-weight: var(--pet-font-weight-semibold);
  color: var(--pet-color-text-faint);
}
.pet-fnav__hint {
  font-weight: var(--pet-font-weight-regular);
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-faint);
  opacity: 0.8;
}
.pet-fnav__list {
  min-height: 24px;
}
.pet-fnav__item {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xxs);
  width: 100%;
  min-width: 0;
  padding: var(--pet-space-xs) var(--pet-space-xxs);
  font-size: var(--pet-font-size-xs);
  text-align: left;
  color: var(--pet-color-text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--pet-radius-sm);
  cursor: grab;
}
.pet-fnav__item:hover {
  color: var(--pet-color-text);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 90%);
}
.pet-fnav__item:focus-visible {
  outline: none;
  border-color: var(--pet-color-accent);
}
.pet-fnav__item--hidden {
  opacity: 0.5;
}
.pet-fnav__item--nest {
  border-color: var(--pet-color-accent);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 82%);
}
.pet-fnav__item--child {
  width: calc(100% - var(--pet-space-sm));
  margin-left: var(--pet-space-md);
}
.pet-fnav__children {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--pet-color-border);
  margin-left: var(--pet-space-xs);
}
.pet-fnav__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pet-fnav__acts {
  display: inline-flex;
  /* Kept in layout (not display:none) so the row reserves their height/width at
     rest — toggling display made the row grow on hover and the nav felt jumpy. */
  visibility: hidden;
  flex: none;
  gap: 1px;
  margin-left: auto;
}
.pet-fnav__item:hover .pet-fnav__acts,
.pet-fnav__item:focus-within .pet-fnav__acts {
  visibility: visible;
}
.pet-fnav__act {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  color: var(--pet-color-icon);
  background: transparent;
  border: 0;
  border-radius: var(--pet-radius-sm);
  cursor: pointer;
}
.pet-fnav__act:hover {
  color: var(--pet-color-text);
  background: var(--pet-color-surface-raised);
}
.pet-fnav__act--out {
  color: var(--pet-color-accent);
}
.pet-fnav__act :deep(.pet-icon) {
  width: 13px;
  height: 13px;
}
.pet-fnav__drop {
  height: 6px;
  margin: 1px 0;
  border-radius: var(--pet-radius-pill);
}
.pet-fnav__drop:hover {
  background: var(--pet-color-accent);
}
.pet-fnav__drop--child {
  margin-left: var(--pet-space-md);
}
.pet-fnav__drop--tail {
  height: 18px;
}
</style>
