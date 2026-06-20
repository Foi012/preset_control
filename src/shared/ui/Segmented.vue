<script setup lang="ts">
/**
 * The single segmented control for the whole console. Replaces the three
 * divergent toggle styles that used to live in App.vue (mode tabs),
 * EditGroupCard.vue (必开/可选, 单选/多选) and EditView.vue (多选). Driven entirely
 * by `--pet-*` tokens so it re-themes for free.
 */
type Option = { value: string; label: string };

defineProps<{
  modelValue: string;
  options: Option[];
  disabled?: boolean;
  /** `sm` for the compact in-card controls, `md` for the panel mode tabs. */
  size?: 'sm' | 'md';
}>();

defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<template>
  <div class="pet-seg" :class="[`pet-seg--${size ?? 'sm'}`, { 'pet-seg--disabled': disabled }]" role="tablist">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="tab"
      :aria-selected="modelValue === option.value"
      :disabled="disabled"
      :class="['pet-seg__btn', { 'pet-seg__btn--on': modelValue === option.value }]"
      @click="$emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.pet-seg {
  display: inline-flex;
  flex: 0 0 auto;
  padding: 2px;
  gap: 2px;
  background: var(--pet-color-surface);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-md);
}
.pet-seg--disabled {
  opacity: 0.45;
}
.pet-seg__btn {
  padding: var(--pet-space-xxs) var(--pet-space-md);
  font-size: var(--pet-font-size-xs);
  line-height: 1.3;
  color: var(--pet-color-text-muted);
  background: transparent;
  border: none;
  border-radius: var(--pet-radius-sm);
  cursor: pointer;
  white-space: nowrap;
  word-break: keep-all;
  transition:
    color var(--pet-motion-fast) var(--pet-motion-ease),
    background var(--pet-motion-fast) var(--pet-motion-ease);
}
.pet-seg--sm .pet-seg__btn {
  min-width: 0;
  padding: var(--pet-space-xxs) var(--pet-space-xs);
}
.pet-seg--md .pet-seg__btn {
  padding: var(--pet-space-xs) var(--pet-space-md);
}
.pet-seg__btn:hover:not(:disabled):not(.pet-seg__btn--on) {
  color: var(--pet-color-text);
}
.pet-seg__btn:disabled {
  cursor: default;
}
.pet-seg__btn--on {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-accent);
}
</style>
