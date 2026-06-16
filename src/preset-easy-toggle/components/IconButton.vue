<script setup lang="ts">
/**
 * The single icon button for the whole console. Replaces the three near-identical
 * `.pet-ico` / `.pet-panel__icon` definitions (App.vue header, EditView batch bar,
 * EditGroupCard rows). One size, one hover, one active/danger treatment, all from
 * tokens.
 */
import PetIcon from './PetIcon.vue';
import type { IconName } from './PetIcon.vue';

defineProps<{
  name: IconName;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
}>();

defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <button
    type="button"
    class="pet-ico"
    :class="{ 'pet-ico--on': active, 'pet-ico--danger': danger }"
    :title="title"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <PetIcon :name="name" />
  </button>
</template>

<style scoped>
.pet-ico {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  flex: none;
  line-height: 0;
  color: var(--pet-color-icon);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--pet-radius-sm);
  cursor: pointer;
  transition:
    color var(--pet-motion-fast) var(--pet-motion-ease),
    background var(--pet-motion-fast) var(--pet-motion-ease),
    border-color var(--pet-motion-fast) var(--pet-motion-ease);
}
.pet-ico:hover:not(:disabled) {
  color: var(--pet-color-text);
  background: var(--pet-color-surface-raised);
}
.pet-ico:disabled {
  opacity: 0.4;
  cursor: default;
}
.pet-ico--on {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-accent);
  border-color: var(--pet-color-accent);
}
.pet-ico--on:hover:not(:disabled) {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-accent);
}
.pet-ico--danger:hover:not(:disabled) {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-danger);
  border-color: var(--pet-color-danger);
}
</style>
