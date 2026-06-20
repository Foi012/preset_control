<script setup lang="ts">
/**
 * The single text input for the toolbox. Consolidates the per-feature input
 * styles (chat-export's `.cex__input` / `.cex__regex`). `mono` switches to the
 * monospace face for regex / code entry; `invalid` flags a bad value (red
 * border). `compact` is the narrow numeric variant. All from `--pet-*` tokens.
 *
 * Non-declared attrs (placeholder, spellcheck, min, @keyup.enter…) fall through
 * to the native input, so callers keep using it like a plain `<input>`.
 */
withDefaults(
  defineProps<{
    modelValue: string | number;
    type?: 'text' | 'number';
    mono?: boolean;
    invalid?: boolean;
    compact?: boolean;
  }>(),
  {
    type: 'text',
    mono: false,
    invalid: false,
    compact: false,
  },
);

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>();

function onInput(event: Event, isNumber: boolean): void {
  const raw = (event.target as HTMLInputElement).value;
  emit('update:modelValue', isNumber ? Number(raw) : raw);
}
</script>

<template>
  <input
    class="pet-field"
    :class="{ 'pet-field--mono': mono, 'pet-field--invalid': invalid, 'pet-field--compact': compact }"
    :type="type"
    :value="modelValue"
    @input="onInput($event, type === 'number')"
  />
</template>

<style scoped>
.pet-field {
  width: 100%;
  min-width: 0;
  padding: var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text);
  background: var(--pet-color-surface);
  border: 1px solid var(--pet-color-border-strong);
  border-radius: var(--pet-radius-sm);
}
.pet-field:focus {
  outline: none;
  border-color: var(--pet-color-accent);
}
.pet-field--mono {
  font-family: var(--pet-font-mono);
  font-size: var(--pet-font-size-xs);
}
.pet-field--invalid {
  border-color: var(--pet-color-danger);
}
.pet-field--compact {
  width: 72px;
}
</style>
