<script setup lang="ts">
/**
 * The single text button for the whole toolbox. Consolidates the divergent
 * primary / secondary / ghost buttons that used to be re-declared per feature
 * (chat-export's `.cex__btn*` / `.cex__addbtn`, the preset console's
 * `.pet-batch__primary`). One radius, one disabled treatment, all from tokens.
 *
 * Variants: `primary` (accent fill), `secondary` (raised surface), `ghost`
 * (transparent outline). Sizes: `md` (default) / `sm`. An optional leading
 * `icon` (PetIcon name) renders before the slot label.
 */
import PetIcon from './PetIcon.vue';
import type { IconName } from './PetIcon.vue';

withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: 'sm' | 'md';
    icon?: IconName;
    iconRight?: IconName;
    disabled?: boolean;
    title?: string;
  }>(),
  {
    variant: 'primary',
    size: 'md',
    icon: undefined,
    iconRight: undefined,
    disabled: false,
    title: undefined,
  },
);

defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <button
    type="button"
    class="pet-btn"
    :class="[`pet-btn--${variant}`, `pet-btn--${size}`]"
    :title="title"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <PetIcon v-if="icon" :name="icon" class="pet-btn__icon" />
    <slot />
    <PetIcon v-if="iconRight" :name="iconRight" class="pet-btn__icon" />
  </button>
</template>

<style scoped>
.pet-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--pet-space-xs);
  flex: none;
  font-weight: var(--pet-font-weight-medium);
  line-height: var(--pet-font-leading-tight);
  border: 1px solid transparent;
  border-radius: var(--pet-radius-sm);
  cursor: pointer;
  white-space: nowrap;
  transition:
    color var(--pet-motion-fast) var(--pet-motion-ease),
    background var(--pet-motion-fast) var(--pet-motion-ease),
    border-color var(--pet-motion-fast) var(--pet-motion-ease),
    filter var(--pet-motion-fast) var(--pet-motion-ease);
}
.pet-btn--md {
  padding: var(--pet-space-sm) var(--pet-space-md);
  font-size: var(--pet-font-size-sm);
}
.pet-btn--sm {
  padding: var(--pet-space-xs) var(--pet-space-md);
  font-size: var(--pet-font-size-xs);
}
.pet-btn__icon {
  flex: none;
}
.pet-btn--sm .pet-btn__icon {
  width: 13px;
  height: 13px;
}

.pet-btn--primary {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-accent);
  border-color: var(--pet-color-accent);
}
.pet-btn--primary:hover:not(:disabled) {
  filter: brightness(1.05);
}

.pet-btn--secondary {
  color: var(--pet-color-text);
  background: var(--pet-color-surface-raised);
  border-color: var(--pet-color-border-strong);
}
.pet-btn--secondary:hover:not(:disabled) {
  border-color: var(--pet-color-accent);
}

.pet-btn--ghost {
  color: var(--pet-color-text-muted);
  background: transparent;
  border-color: var(--pet-color-border-strong);
}
.pet-btn--ghost:hover:not(:disabled) {
  color: var(--pet-color-text);
  border-color: var(--pet-color-accent);
}

.pet-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
