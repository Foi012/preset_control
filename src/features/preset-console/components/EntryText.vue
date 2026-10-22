<script setup lang="ts">
import { stepLabel, type ExpandedEntry, type TextFragment } from '../workbench-preview';
defineProps<{ entry: ExpandedEntry; search: string; sending?: boolean }>();
const emit = defineEmits<{ fragment: [fragment: TextFragment, event: MouseEvent]; hover: [id: string] }>();
function highlight(text: string, search: string): { text: string; match: boolean }[] {
  if (!search.trim()) return [{ text, match: false }];
  const query = search.trim().toLocaleLowerCase(), lower = text.toLocaleLowerCase(), parts: { text: string; match: boolean }[] = [];
  let at = 0, found = lower.indexOf(query);
  while (found >= 0) { parts.push({ text: text.slice(at, found), match: false }, { text: text.slice(found, found + query.length), match: true }); at = found + query.length; found = lower.indexOf(query, at); }
  parts.push({ text: text.slice(at), match: false }); return parts;
}
</script>
<template>
  <div v-if="entry.text.trim()" class="pet-entry-text"><span v-for="(fragment, i) in entry.fragments" :key="i" :data-text-source="fragment.definitionId || fragment.sourceId" :class="{ 'pet-entry-text__variable': fragment.variable }" :title="fragment.variable ? `${fragment.global ? '全局 · ' : ''}${fragment.variable} · ${fragment.contributors.length > 1 ? '这个值来自多个条目，点击查看来源' : fragment.definitionId ? '点击查看来源条目' : '点击查看变量来源'}` : undefined" @mouseenter="emit('hover', fragment.definitionId || '')" @mouseleave="emit('hover', '')" @click.stop="emit('fragment', fragment, $event)"><template v-for="(part, j) in highlight(fragment.text, search)" :key="j"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span></div>
  <template v-if="!sending">
    <div v-for="(write, i) in entry.writes" :key="i" class="pet-entry-text__contribution" :data-text-source="entry.entry.prompt.identifier">
      <div class="pet-entry-text__label">{{ write.step ? stepLabel(write.step) : `${write.operation === 'add' ? '追加到' : '设置'} ${write.key}` }}<span v-if="!entry.participating"> · 不用于发送文本</span></div>
      <div class="pet-entry-text"><template v-for="(part, j) in highlight(write.value, search)" :key="j"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template><span v-if="!write.value" class="pet-entry-text__label">（空值）</span></div>
    </div>
    <p v-if="!entry.text.trim() && !entry.writes.length" class="pet-entry-text__label">{{ entry.reads.length ? '这里读取到的变量值为空' : '空条目' }}</p>
  </template>
</template>
<style scoped>
.pet-entry-text{font:inherit;font-size:var(--pet-font-size-base);line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.pet-entry-text__label{font-size:var(--pet-font-size-xs);line-height:var(--pet-font-leading-normal);color:var(--pet-color-text-muted);margin:var(--pet-space-xs) 0}
.pet-entry-text__contribution+.pet-entry-text__contribution{margin-top:var(--pet-space-md)}
.pet-entry-text__variable:hover{background:color-mix(in srgb,var(--pet-color-accent),transparent 88%)}
mark{background:color-mix(in srgb,var(--pet-color-rule-always-on),transparent 66%);color:inherit}
</style>
