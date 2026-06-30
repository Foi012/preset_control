<script setup lang="ts">
/**
 * The shared multi-line text input for the toolbox — the textarea counterpart to
 * `TextField`. Consolidates the per-feature copies (the preset console's in-use
 * `.pet-tile__textarea` and 连接档案's 附加参数 field), so the look (border, focus ring,
 * vertical resize) lives in one place instead of drifting.
 *
 * Commits on `change` (blur/enter-out) like both original call sites. Non-declared attrs
 * (rows, placeholder, readonly, spellcheck…) fall through to the native textarea.
 */
withDefaults(defineProps<{ modelValue: string; invalid?: boolean }>(), { invalid: false });
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

function commit(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <textarea
    class="pet-textarea"
    :class="{ 'pet-textarea--invalid': invalid }"
    :value="modelValue"
    @change="commit"
  />
</template>

<style scoped>
.pet-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: var(--pet-space-xs) var(--pet-space-sm);
  font-family: var(--pet-font-sans);
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text);
  background: var(--pet-color-surface);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-sm);
}
.pet-textarea:focus {
  outline: none;
  border-color: var(--pet-color-rule-input);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pet-color-rule-input), transparent 65%);
}
.pet-textarea--invalid {
  border-color: var(--pet-color-danger);
}
</style>
