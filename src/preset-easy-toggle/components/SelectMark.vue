<script setup lang="ts">
/**
 * The single radio/checkbox visual for the in-use page — used by both the per-entry
 * tile marks (EntryRow) and the per-group master toggle (SectionCard) so every
 * selection control reads the same. `checkbox` shows a tick when on and a dash when
 * partial (indeterminate); `radio` is on/off only. Purely presentational — the parent
 * owns the click + state.
 */
import PetIcon from './PetIcon.vue';

defineProps<{ type: 'radio' | 'checkbox'; state: 'on' | 'off' | 'partial' }>();
</script>

<template>
  <span class="pet-mark" :class="[`pet-mark--${type}`, `pet-mark--${state}`]">
    <PetIcon v-if="type === 'checkbox' && state === 'on'" name="check" />
  </span>
</template>

<style scoped>
.pet-mark {
  position: relative;
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  box-sizing: border-box;
  color: var(--pet-color-accent-text);
  background: transparent;
  border: 2px solid var(--pet-color-mark-border);
  transition:
    background var(--pet-motion-fast) var(--pet-motion-ease),
    border-color var(--pet-motion-fast) var(--pet-motion-ease),
    box-shadow var(--pet-motion-fast) var(--pet-motion-ease);
}
.pet-mark--radio {
  border-radius: var(--pet-radius-pill);
}
.pet-mark--checkbox {
  border-radius: var(--pet-radius-sm);
}
.pet-mark--radio.pet-mark--on {
  border-color: var(--pet-color-accent);
  box-shadow: inset 0 0 0 4px var(--pet-color-accent);
}
.pet-mark--checkbox.pet-mark--on {
  background: var(--pet-color-accent);
  border-color: var(--pet-color-accent);
}
.pet-mark--checkbox.pet-mark--partial {
  border-color: var(--pet-color-accent);
}
.pet-mark--checkbox.pet-mark--partial::after {
  content: '';
  width: 8px;
  height: 2px;
  border-radius: 1px;
  background: var(--pet-color-accent);
}
.pet-mark :deep(.pet-icon) {
  width: 12px;
  height: 12px;
  stroke-width: 3;
}
</style>
