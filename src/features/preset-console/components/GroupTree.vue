<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ResolvedSection } from '../types';
import { canPlaceGroup } from '../group-tree';
import { useMobileWorkbench } from '../useMobileWorkbench';
import Dropdown from '@/ui/Dropdown.vue';
import IconButton from '@/ui/IconButton.vue';
const props = defineProps<{ sections: ResolvedSection[]; selected?: string; readonly?: boolean }>();
const mobile = useMobileWorkbench();
const emit = defineEmits<{ select: [id: string]; move: [id: string, parentId: string | null, beforeId: string | null]; nudge: [id: string, delta: -1 | 1] }>();
const collapsed = ref<string[]>([]), error = ref(''), dragging = ref(''), over = ref('');
const all = computed(() => {
  const visit = (sections: ResolvedSection[], depth = 0): { node: ResolvedSection; depth: number }[] => sections.flatMap(node => [{ node, depth }, ...visit(node.children, depth + 1)]);
  return visit(props.sections);
});
const visible = computed(() => all.value.filter(row => {
  let parent = row.node.parentId;
  while (parent) { if (collapsed.value.includes(parent)) return false; parent = all.value.find(r => r.node.id === parent)?.node.parentId ?? null; }
  return true;
}));
function count(node: ResolvedSection): number { return node.entries.length + node.children.reduce((sum, child) => sum + count(child), 0); }
function start(event: DragEvent, id: string): void { if (props.readonly) return; dragging.value = id; event.dataTransfer?.setData('application/x-pet-group', id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }
function allow(event: DragEvent, parentId: string | null): void {
  if (props.readonly || !dragging.value || !canPlaceGroup(all.value.map(r => r.node), dragging.value, parentId)) return;
  event.preventDefault(); over.value = parentId || '__root__'; if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}
function drop(event: DragEvent, parentId: string | null, beforeId: string | null): void {
  event.preventDefault(); event.stopPropagation();
  const id = event.dataTransfer?.getData('application/x-pet-group') || dragging.value;
  if (!props.readonly && id && canPlaceGroup(all.value.map(r => r.node), id, parentId)) { emit('move', id, parentId, beforeId); collapsed.value = collapsed.value.filter(x => x !== parentId); error.value = ''; }
  else error.value = '分组最多三层，不能放进自己或自己的子组。';
  over.value = ''; dragging.value = '';
}
function outdent(id: string): void {
  const node = all.value.find(r => r.node.id === id)?.node;
  const parent = all.value.find(r => r.node.id === node?.parentId)?.node;
  if (parent) emit('move', id, parent.parentId, null);
}
</script>
<template>
  <div class="pet-group-tree" role="tree" aria-label="分组结构">
    <template v-for="{ node, depth } in visible" :key="node.id">
      <div v-if="!readonly" class="pet-group-tree__drop" :style="{ marginLeft: `${depth * 14}px` }" @dragover="allow($event, node.parentId)" @drop="drop($event, node.parentId, node.id)" />
      <div class="pet-group-tree__row" :class="{ 'pet-group-tree__row--selected': selected === node.id, 'pet-group-tree__row--over': over === node.id }" role="treeitem" :aria-level="depth + 1" :aria-selected="selected === node.id" :aria-expanded="node.children.length ? !collapsed.includes(node.id) : undefined" tabindex="0" :draggable="!readonly && !mobile" :style="{ paddingLeft: `${depth * 14 + 4}px` }" :title="node.name" @click="emit('select', node.id)" @keydown.enter.self.stop="emit('select', node.id)" @keydown.space.self.prevent.stop="emit('select', node.id)" @dragstart="start($event, node.id)" @dragend="dragging = ''; over = ''" @dragover="allow($event, node.id)" @dragleave="over = ''" @drop="drop($event, node.id, null)">
        <IconButton v-if="node.children.length" :name="collapsed.includes(node.id) ? 'chevron-right' : 'chevron-down'" :title="collapsed.includes(node.id) ? '展开子组' : '收起子组'" @click.stop="collapsed = collapsed.includes(node.id) ? collapsed.filter(x => x !== node.id) : [...collapsed, node.id]" />
        <span v-else class="pet-group-tree__spacer" />
        <span class="pet-group-tree__name">{{ node.name }}</span><span class="pet-group-tree__count">{{ count(node) }}</span>
        <span v-if="!readonly && selected === node.id" class="pet-group-tree__actions">
          <IconButton v-if="node.parentId" name="outdent" title="移到上一级" @click.stop="outdent(node.id)" />
          <IconButton name="chevron-up" title="上移分组" @click.stop="emit('nudge', node.id, -1)" /><IconButton name="chevron-down" title="下移分组" @click.stop="emit('nudge', node.id, 1)" />
        </span>
      </div>
    </template>
    <div v-if="mobile && !readonly && selected" class="pet-group-tree__move"><span>移动「{{ all.find(r => r.node.id === selected)?.node.name }}」到</span><Dropdown :model-value="all.find(r => r.node.id === selected)?.node.parentId || '__root__'" title="移动分组到" :options="[{ value: '__root__', label: '最外层' }, ...all.filter(r => canPlaceGroup(all.map(x => x.node), selected!, r.node.id)).map(r => ({ value: r.node.id, label: `${'　'.repeat(r.depth)}${r.node.name}` }))]" @update:model-value="emit('move', selected!, $event === '__root__' ? null : $event, null)" /></div>
    <div v-if="!readonly && !mobile" class="pet-group-tree__root" :class="{ 'pet-group-tree__row--over': over === '__root__' }" @dragover="allow($event, null)" @drop="drop($event, null, null)">拖到这里，移出所有父组</div>
    <p v-if="error" role="status" class="pet-group-tree__error">{{ error }}</p>
  </div>
</template>
<style scoped>
.pet-group-tree{font-size:var(--pet-font-size-xs);min-width:0}.pet-group-tree__row{display:flex;align-items:center;gap:var(--pet-space-xxs);min-height:30px;border-radius:var(--pet-radius-sm);cursor:pointer;outline:none}
.pet-group-tree__row:hover,.pet-group-tree__row:focus-visible,.pet-group-tree__row--selected{background:color-mix(in srgb,var(--pet-color-accent),transparent 90%)}.pet-group-tree__row--over{outline:1px solid var(--pet-color-accent);background:color-mix(in srgb,var(--pet-color-accent),transparent 84%)}
.pet-group-tree__name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pet-group-tree__count{color:var(--pet-color-text-faint)}.pet-group-tree__actions{display:flex;flex:none}.pet-group-tree__spacer{width:24px;flex:none}
.pet-group-tree__drop{height:5px}.pet-group-tree__drop:hover{background:var(--pet-color-accent)}.pet-group-tree__root{margin-top:var(--pet-space-sm);padding:var(--pet-space-sm);text-align:center;color:var(--pet-color-text-faint);border:1px dashed var(--pet-color-border)}.pet-group-tree__error{color:var(--pet-color-danger)}
@media(max-width:767px), (max-width:1023px) and (pointer:coarse){.pet-group-tree__row{min-height:44px}.pet-group-tree__actions :deep(.pet-ico){width:36px;height:40px}.pet-group-tree__drop{display:none}.pet-group-tree__move{display:flex;flex-direction:column;gap:8px;padding:12px 0;color:var(--pet-color-text-muted)}.pet-group-tree__move :deep(.pet-dd){width:100%}.pet-group-tree__move :deep(.pet-dd__button){height:44px}}
</style>
