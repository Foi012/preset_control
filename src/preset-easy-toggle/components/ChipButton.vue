<script setup lang="ts">
withDefaults(
  defineProps<{
    active?: boolean;
    title?: string;
    icon?: boolean;
  }>(),
  {
    active: false,
    title: undefined,
    icon: false,
  },
);

defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <button
    type="button"
    class="pet-chip"
    :class="{ 'pet-chip--on': active, 'pet-chip--icon': icon }"
    :title="title"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<style scoped>
.pet-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 28px;
  padding: 0 var(--pet-space-md);
  font-size: var(--pet-font-size-sm);
  font-weight: var(--pet-font-weight-medium);
  line-height: var(--pet-font-leading-tight);
  color: var(--pet-color-text-muted);
  background: var(--pet-color-surface-raised);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-pill);
  cursor: pointer;
  white-space: nowrap;
  transition:
    color var(--pet-motion-fast) var(--pet-motion-ease),
    background var(--pet-motion-fast) var(--pet-motion-ease),
    border-color var(--pet-motion-fast) var(--pet-motion-ease);
}
.pet-chip:hover {
  color: var(--pet-color-text);
  border-color: var(--pet-color-border-strong);
}
.pet-chip--on {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-accent);
  border-color: var(--pet-color-accent);
}
.pet-chip--icon {
  width: 28px;
  padding: 0;
  color: var(--pet-color-icon);
  background: transparent;
  border-style: dashed;
  border-color: var(--pet-color-border-strong);
}
.pet-chip--icon:hover {
  color: var(--pet-color-text);
  border-color: var(--pet-color-accent);
}
.pet-chip--icon :deep(.pet-icon) {
  width: 13px;
  height: 13px;
}
</style>
