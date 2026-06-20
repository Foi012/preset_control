<script setup lang="ts">
import { ref } from 'vue';
import type { ResolvedSection } from '../types';
import { useConsoleStore } from '../store';
import PetIcon from '@/ui/PetIcon.vue';

/**
 * The same structure nav serves both edit contexts. With no `modeId` it reorders the
 * **global** group structure; given a `modeId` it reorders that mode's arrangement —
 * actions route to the per-mode store methods so the markup/UX stays identical.
 */
const props = defineProps<{ sections: ResolvedSection[]; modeId?: string; floating?: boolean }>();

const store = useConsoleStore();
let dragId = '';
/** Item currently hovered as a *nesting* drop target — drives the highlight. */
const nestTargetId = ref('');

/** Route reorder/nest to the global structure or the active mode's arrangement. */
function place(id: string, parentId: string | null, beforeId: string | null): void {
  if (props.modeId) store.placeModeGroup(props.modeId, id, parentId, beforeId);
  else store.placeGroup(id, parentId, beforeId);
}
function nudge(id: string, delta: -1 | 1): void {
  if (props.modeId) store.nudgeModeGroup(props.modeId, id, delta);
  else store.nudgeGroup(id, delta);
}
function outdent(id: string): void {
  if (props.modeId) store.setModeGroupParent(props.modeId, id, null);
  else store.outdentGroup(id);
}

function onDragStart(section: ResolvedSection, event: DragEvent): void {
  dragId = section.id;
  event.dataTransfer?.setData('text/plain', section.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function onDragEnd(): void {
  dragId = '';
  nestTargetId.value = '';
}

function draggedId(event: DragEvent): string {
  return event.dataTransfer?.getData('text/plain') || dragId;
}

function allowDrop(event: DragEvent): void {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

/** A top-level item can accept a nest only if it isn't the dragged item itself. */
function onNestOver(parent: ResolvedSection, event: DragEvent): void {
  allowDrop(event);
  if (dragId && dragId !== parent.id) nestTargetId.value = parent.id;
}

function dropBefore(parentId: string | null, beforeId: string | null, event: DragEvent): void {
  event.preventDefault();
  nestTargetId.value = '';
  const id = draggedId(event);
  if (id && id !== beforeId) place(id, parentId, beforeId);
}

function dropInto(parent: ResolvedSection, event: DragEvent): void {
  event.preventDefault();
  nestTargetId.value = '';
  const id = draggedId(event);
  if (id && id !== parent.id) place(id, parent.id, null);
}

function focusGroup(id: string): void {
  document.getElementById(`pet-egroup-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
</script>

<template>
  <aside class="pet-fnav" :class="{ 'pet-fnav--floating': floating }">
    <div class="pet-fnav__head">
      <span>分组结构</span>
      <span class="pet-fnav__hint">拖动 / 箭头排序</span>
    </div>
    <div class="pet-fnav__list">
      <template v-for="section in sections" :key="section.id">
        <div
          class="pet-fnav__drop"
          title="调整顺序"
          @dragover="allowDrop"
          @drop="dropBefore(null, section.id, $event)"
        />
        <div
          class="pet-fnav__item"
          role="button"
          tabindex="0"
          draggable="true"
          :class="{
            'pet-fnav__item--hidden': section.hidden,
            'pet-fnav__item--nest': nestTargetId === section.id,
          }"
          :title="section.name"
          @click="focusGroup(section.id)"
          @dragstart="onDragStart(section, $event)"
          @dragend="onDragEnd"
          @dragover="onNestOver(section, $event)"
          @dragleave="nestTargetId = ''"
          @drop="dropInto(section, $event)"
        >
          <span class="pet-fnav__name">{{ section.name }}</span>
          <span class="pet-fnav__acts">
            <button class="pet-fnav__act" type="button" title="上移" @click.stop="nudge(section.id, -1)">
              <PetIcon name="chevron-up" />
            </button>
            <button class="pet-fnav__act" type="button" title="下移" @click.stop="nudge(section.id, 1)">
              <PetIcon name="chevron-down" />
            </button>
          </span>
        </div>
        <div v-if="section.children.length" class="pet-fnav__children">
          <template v-for="child in section.children" :key="child.id">
            <div
              class="pet-fnav__drop pet-fnav__drop--child"
              title="调整顺序"
              @dragover="allowDrop"
              @drop="dropBefore(section.id, child.id, $event)"
            />
            <div
              class="pet-fnav__item pet-fnav__item--child"
              role="button"
              tabindex="0"
              draggable="true"
              :class="{ 'pet-fnav__item--hidden': child.hidden }"
              :title="child.name"
              @click="focusGroup(child.id)"
              @dragstart="onDragStart(child, $event)"
              @dragend="onDragEnd"
            >
              <span class="pet-fnav__name">{{ child.name }}</span>
              <span class="pet-fnav__acts">
                <button
                  class="pet-fnav__act pet-fnav__act--out"
                  type="button"
                  title="移出"
                  @click.stop="outdent(child.id)"
                >
                  <PetIcon name="outdent" />
                </button>
                <button class="pet-fnav__act" type="button" title="上移" @click.stop="nudge(child.id, -1)">
                  <PetIcon name="chevron-up" />
                </button>
                <button class="pet-fnav__act" type="button" title="下移" @click.stop="nudge(child.id, 1)">
                  <PetIcon name="chevron-down" />
                </button>
              </span>
            </div>
          </template>
          <div
            class="pet-fnav__drop pet-fnav__drop--child"
            title="放到末尾"
            @dragover="allowDrop"
            @drop="dropBefore(section.id, null, $event)"
          />
        </div>
      </template>
      <div
        class="pet-fnav__drop pet-fnav__drop--tail"
        title="放到末尾"
        @dragover="allowDrop"
        @drop="dropBefore(null, null, $event)"
      />
    </div>
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
