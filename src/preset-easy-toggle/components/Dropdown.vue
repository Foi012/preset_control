<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import PetIcon from './PetIcon.vue';
import type { IconName } from './PetIcon.vue';

export interface DropdownOption {
  value: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: DropdownOption[];
    placeholder?: string;
    disabled?: boolean;
    variant?: 'field' | 'inline' | 'icon';
    placement?: 'bottom' | 'top';
    align?: 'left' | 'right';
    title?: string;
    triggerIcon?: IconName;
  }>(),
  {
    placeholder: '选择...',
    disabled: false,
    variant: 'field',
    placement: 'bottom',
    align: 'left',
    title: undefined,
    triggerIcon: undefined,
  },
);

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const root = ref<HTMLElement | null>(null);
const open = ref(false);

const selected = computed(() => props.options.find(option => option.value === props.modelValue));
const displayLabel = computed(() => selected.value?.label ?? props.placeholder);

function toggle(): void {
  if (props.disabled || !props.options.length) return;
  open.value = !open.value;
}

function choose(option: DropdownOption): void {
  if (option.disabled) return;
  emit('update:modelValue', option.value);
  open.value = false;
}

function onDocumentPointerDown(event: PointerEvent): void {
  // composedPath() so a click inside the dropdown is recognised across the Shadow
  // DOM boundary (event.target is retargeted to the host there). Capture phase so
  // an upstream stopPropagation() can't keep the menu stuck open.
  if (root.value && !event.composedPath().includes(root.value)) open.value = false;
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown, true));
</script>

<template>
  <div
    ref="root"
    class="pet-dd"
    :class="[
      `pet-dd--${variant}`,
      `pet-dd--${placement}`,
      `pet-dd--align-${align}`,
      { 'pet-dd--open': open, 'pet-dd--empty': !selected, 'pet-dd--disabled': disabled },
    ]"
  >
    <button
      type="button"
      class="pet-dd__button"
      :title="title ?? displayLabel"
      :disabled="disabled || !options.length"
      :aria-expanded="open"
      @click="toggle"
    >
      <PetIcon v-if="triggerIcon" :name="triggerIcon" />
      <span v-else class="pet-dd__label">{{ displayLabel }}</span>
      <PetIcon v-if="!triggerIcon" name="chevron-down" />
    </button>
    <div v-if="open" class="pet-dd__menu">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        class="pet-dd__option"
        :class="{ 'pet-dd__option--on': modelValue === option.value }"
        :disabled="option.disabled"
        :title="option.label"
        @click="choose(option)"
      >
        <span v-if="option.icon" class="pet-dd__option-icon">
          <PetIcon :name="option.icon" />
        </span>
        <span class="pet-dd__option-label">{{ option.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.pet-dd {
  position: relative;
  min-width: 0;
}
.pet-dd__button {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
  width: 100%;
  min-width: 0;
  font-size: var(--pet-font-size-xs);
  line-height: var(--pet-font-leading-tight);
  color: var(--pet-color-text);
  cursor: pointer;
}
.pet-dd__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pet-dd__button :deep(.pet-icon) {
  flex: none;
  transition: transform var(--pet-motion-fast) var(--pet-motion-ease);
}
.pet-dd--open .pet-dd__button :deep(.pet-icon) {
  transform: rotate(180deg);
}
.pet-dd--field {
  flex: 0 1 180px;
  min-width: 144px;
}
.pet-dd--field .pet-dd__button {
  justify-content: space-between;
  height: 32px;
  padding: var(--pet-space-xs) var(--pet-space-sm);
  background: var(--pet-color-surface);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-sm);
}
.pet-dd--field .pet-dd__button:hover:not(:disabled),
.pet-dd--field.pet-dd--open .pet-dd__button {
  border-color: var(--pet-color-accent);
}
.pet-dd--inline {
  flex: 0 1 auto;
}
.pet-dd--inline .pet-dd__button {
  width: auto;
  padding: 0;
  font-size: var(--pet-font-size-sm);
  font-weight: var(--pet-font-weight-semibold);
  line-height: var(--pet-font-leading-tight);
  background: transparent;
  border: 0;
}
.pet-dd--inline.pet-dd--empty .pet-dd__button {
  color: var(--pet-color-text-muted);
}
.pet-dd--inline .pet-dd__button:hover:not(:disabled),
.pet-dd--inline.pet-dd--open .pet-dd__button {
  color: var(--pet-color-text);
}
.pet-dd--inline .pet-dd__button :deep(.pet-icon) {
  width: 16px;
  height: 16px;
  margin-top: 1px;
}
.pet-dd--icon {
  flex: none;
}
.pet-dd--icon .pet-dd__button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  line-height: 0;
  color: var(--pet-color-icon);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--pet-radius-sm);
  transition:
    color var(--pet-motion-fast) var(--pet-motion-ease),
    background var(--pet-motion-fast) var(--pet-motion-ease),
    border-color var(--pet-motion-fast) var(--pet-motion-ease);
}
.pet-dd--icon .pet-dd__button:hover:not(:disabled) {
  color: var(--pet-color-text);
  background: var(--pet-color-surface-raised);
}
.pet-dd--icon.pet-dd--open .pet-dd__button {
  color: var(--pet-color-accent-text);
  background: var(--pet-color-accent);
  border-color: var(--pet-color-accent);
}
.pet-dd--icon.pet-dd--open .pet-dd__button :deep(.pet-icon) {
  transform: none;
}
.pet-dd__button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pet-color-accent), transparent 65%);
}
.pet-dd__button:disabled {
  opacity: 0.45;
  cursor: default;
}
.pet-dd__menu {
  position: absolute;
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  width: max-content;
  min-width: 100%;
  max-width: 260px;
  max-height: min(260px, 54vh);
  padding: var(--pet-space-xxs);
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--pet-color-surface);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-sm);
  box-shadow: var(--pet-effect-shadow-md);
}
.pet-dd--bottom .pet-dd__menu {
  top: calc(100% + var(--pet-space-xs));
}
.pet-dd--top .pet-dd__menu {
  bottom: calc(100% + var(--pet-space-xs));
}
.pet-dd--align-right .pet-dd__menu {
  right: 0;
  left: auto;
}
.pet-dd--inline .pet-dd__menu {
  min-width: 148px;
}
.pet-dd__option {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  flex: none;
  width: 100%;
  min-width: 0;
  padding: var(--pet-space-xs) var(--pet-space-sm);
  font-size: var(--pet-font-size-xs);
  line-height: var(--pet-font-leading-tight);
  color: var(--pet-color-text-muted);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--pet-radius-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.pet-dd__option-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--pet-color-icon);
  pointer-events: none;
}
.pet-dd__option-icon :deep(.pet-icon) {
  width: 14px;
  height: 14px;
}
.pet-dd__option-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pet-dd__option:hover:not(:disabled),
.pet-dd__option--on {
  color: var(--pet-color-text);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 90%);
}
.pet-dd__option:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
