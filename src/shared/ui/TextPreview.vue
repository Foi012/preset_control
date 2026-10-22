<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from './Button.vue';
const props = withDefaults(defineProps<{ text: string; limit?: number }>(), { limit: 180 });
const expanded = ref(false);
const long = computed(() => props.text.length > props.limit || props.text.split('\n').length > 5);
const preview = computed(() => props.text.slice(0, props.limit).split('\n').slice(0, 5).join('\n'));
watch(() => props.text, () => { expanded.value = false; });
</script>
<template><div class="pet-text-preview"><pre>{{ long && !expanded ? `${preview}…` : text }}</pre><Button v-if="long" size="sm" variant="text" @click="expanded = !expanded">{{ expanded ? '收起内容' : '展开内容' }}</Button></div></template>
<style scoped>
.pet-text-preview{min-width:0;margin:var(--pet-space-xs) 0}pre{font:inherit;font-size:var(--pet-font-size-xs);line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:var(--pet-space-sm);max-height:240px;overflow:auto;background:var(--pet-color-surface-raised);border-radius:var(--pet-radius-sm)}
</style>
