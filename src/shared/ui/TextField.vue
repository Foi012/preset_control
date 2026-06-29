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
const props = withDefaults(
  defineProps<{
    modelValue: string | number;
    type?: 'text' | 'number';
    mono?: boolean;
    invalid?: boolean;
    /** Width: narrow fixed (numeric) vs the default full-width. Orthogonal to `size`. */
    compact?: boolean;
    /** Height: `md` (default) for normal fields, `sm` for dense/numeric rows. The two standard heights. */
    size?: 'sm' | 'md';
    /** Commit on `change` (blur/enter) instead of every keystroke — lets decimals like `1.1` type cleanly. */
    lazy?: boolean;
    /** Reads as plain text until hover/focus — the inline-rename look (matches the console's group name). */
    inline?: boolean;
  }>(),
  {
    type: 'text',
    mono: false,
    invalid: false,
    compact: false,
    size: 'md',
    lazy: false,
    inline: false,
  },
);

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>();

function commit(event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  emit('update:modelValue', props.type === 'number' ? Number(raw) : raw);
}
</script>

<template>
  <input
    class="pet-field"
    :class="{ 'pet-field--mono': mono, 'pet-field--invalid': invalid, 'pet-field--compact': compact, 'pet-field--sm': size === 'sm', 'pet-field--inline': inline }"
    :type="type"
    :value="modelValue"
    @input="!lazy && commit($event)"
    @change="lazy && commit($event)"
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
/* The dense/short height — consolidates the per-feature numeric overrides (e.g. chat-export's
   .cex__numfield padding). Pair with `compact` for narrow numeric inputs. */
.pet-field--sm {
  padding: 2px var(--pet-space-sm);
  font-size: var(--pet-font-size-xs);
}
/* Inline-rename: transparent until hover/focus, so the value reads as a label you can click to edit. */
.pet-field--inline {
  background: transparent;
  border-color: transparent;
}
.pet-field--inline:hover {
  border-color: var(--pet-color-border);
}
.pet-field--inline:focus {
  background: var(--pet-color-surface);
}
</style>
