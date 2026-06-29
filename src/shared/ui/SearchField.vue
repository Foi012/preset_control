<script setup lang="ts">
/**
 * The shared search input — one look across tools (was diverging: the preset console used a
 * `surface-raised` field, chat-export/连接档案 a plain `TextField`). Matches the console's in-use
 * search: 32px tall, raised surface, accent focus ring. `v-model` + a leading 🔍 affordance.
 */
defineProps<{ modelValue: string; placeholder?: string }>();
defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<template>
  <input
    class="pet-search"
    type="search"
    :value="modelValue"
    :placeholder="placeholder ?? '搜索'"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>

<style scoped>
.pet-search {
  flex: 1;
  min-width: 0;
  height: 32px;
  box-sizing: border-box;
  padding: 0 var(--pet-space-sm);
  font-size: var(--pet-font-size-sm);
  line-height: var(--pet-font-leading-tight);
  color: var(--pet-color-text);
  background: var(--pet-color-surface-raised);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-sm);
}
.pet-search:focus {
  outline: none;
  border-color: var(--pet-color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pet-color-accent), transparent 65%);
}
</style>
