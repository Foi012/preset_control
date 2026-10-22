<script setup lang="ts">
import { computed, ref } from 'vue';
import { resolveView, type Config, type GroupConfig, type CustomGroupConfig } from '../config';
import { catalog, type PresetDocument } from '../workbench-model';
import { parsePreset } from '../parser';
import { canPlaceGroup, removeCustomGroup } from '../group-tree';
import type { ResolvedSection, SectionRule } from '../types';
import GroupTree from './GroupTree.vue';
import TextField from '@/ui/TextField.vue';
import Dropdown from '@/ui/Dropdown.vue';
import Button from '@/ui/Button.vue';
import IconButton from '@/ui/IconButton.vue';
import Section from '@/ui/Section.vue';
const props = defineProps<{ document: PresetDocument; config: Config; selected: string[]; readonly?: boolean }>();
const emit = defineEmits<{ inspect: [id: string]; selection: [ids: string[]] }>();
const activeId = ref(''), error = ref(''), newName = ref('');
const confirmingDelete = ref(false);
const creating = ref(false), createParent = ref<string | null>(null);
const tree = computed(() => resolveView(parsePreset(catalog(props.document).map(e => ({ id: e.prompt.identifier, name: e.prompt.name ?? '', content: e.prompt.content ?? '', enabled: e.enabled }))), props.config).sections);
const all = computed(() => { const flatten = (nodes: ResolvedSection[]): ResolvedSection[] => nodes.flatMap(n => [n, ...flatten(n.children)]); return flatten(tree.value); });
const deletable = computed(() => props.config.customGroups.some(g => g.id === activeId.value));
const ruleHelp = computed(() => active.value?.rule === 'single' ? '组内只能开启一项，开启另一项会关闭原来的选项。' : '组内条目可以分别开启或关闭。');
const active = computed(() => all.value.find(g => g.id === activeId.value));
function record(id: string): GroupConfig | CustomGroupConfig {
  let r = props.config.customGroups.find(g => g.id === id) ?? props.config.groups.find(g => g.headerId === id);
  if (!r) { const g = all.value.find(g => g.id === id)!; r = { headerId: id, rule: g.rule, order: g.order, pinned: g.pinned, hidden: g.hidden, required: g.required, collapsed: g.collapsed, parentId: g.parentId || undefined }; props.config.groups.push(r); }
  return r;
}
function move(id: string, parentId: string | null, beforeId: string | null): void {
  if (props.readonly) return;
  if (!canPlaceGroup(all.value, id, parentId)) { error.value = '分组最多三层，不能放进自己或自己的子组。'; return; }
  error.value = ''; record(id).parentId = parentId || undefined;
  const siblings = all.value.filter(g => g.id !== id && g.parentId === parentId).sort((a, b) => a.order - b.order).map(g => g.id);
  const at = beforeId ? siblings.indexOf(beforeId) : siblings.length; siblings.splice(at < 0 ? siblings.length : at, 0, id);
  siblings.forEach((gid, order) => { record(gid).order = order; }); activeId.value = id;
}
function nudge(id: string, delta: -1 | 1): void {
  const node = all.value.find(g => g.id === id); if (!node) return;
  const siblings = all.value.filter(g => g.parentId === node.parentId).sort((a, b) => a.order - b.order);
  const at = siblings.findIndex(g => g.id === id), next = at + delta;
  if (next >= 0 && next < siblings.length) move(id, node.parentId, delta < 0 ? siblings[next].id : siblings[at + 2]?.id || null);
}
function assign(id: string): void {
  if (props.readonly) return;
  for (const entryId of props.selected) props.config.entryMeta[entryId] = { ...props.config.entryMeta[entryId], groupId: id };
}
function start(parent: string | null): void { createParent.value = parent; newName.value = ''; creating.value = true; error.value = ''; }
function create(): void {
  if (props.readonly || !newName.value.trim()) return;
  const id = crypto.randomUUID();
  if (!canPlaceGroup([...all.value, { id, parentId: null }], id, createParent.value)) { error.value = '分组最多三层，请在更上一级新建。'; return; }
  props.config.customGroups.push({ id, name: newName.value.trim(), parentId: createParent.value || undefined, rule: 'multi', order: all.value.length, pinned: false, hidden: false, required: false, collapsed: false });
  activeId.value = id; creating.value = false; assign(id);
}
function deleteActive(): void {
  if (props.readonly || !active.value) return;
  const parent = active.value.parentId || '';
  if (removeCustomGroup(props.config, active.value.id)) { activeId.value = parent; confirmingDelete.value = false; }
}
function selectGroup(id: string): void { activeId.value = id; confirmingDelete.value = false; }
function update(key: 'name' | 'rule' | 'required', value: string | boolean): void {
  if (props.readonly || !active.value) return;
  const r = record(active.value.id);
  if (key === 'rule') { r.rule = value as SectionRule; if (value === 'folder') r.required = false; }
  else if (key === 'name') r.name = String(value);
  else r.required = Boolean(value);
}
</script>
<template>
  <div class="pet-group-editor">
    <p class="pet-group-editor__hint">{{ readonly ? '来源预设的分组（仅查看）' : '最多三层。可拖动分组，手机上可选中后选择移动位置。修改后点击「保存」生效。' }}</p>
    <div v-if="!readonly" class="pet-group-editor__actions"><Button size="sm" variant="secondary" @click="start(null)">新建分组</Button><Button v-if="active" size="sm" variant="text" :disabled="!canPlaceGroup([...all, { id: '__new_group__' }], '__new_group__', active.id)" title="最多三层" @click="start(active.id)">新建子组</Button><span class="pet-group-editor__spacer" /><IconButton name="trash" :title="active ? `删除分组 ${active.name}` : '删除分组'" :disabled="!deletable" danger @click="confirmingDelete = !confirmingDelete" /></div>
    <div v-if="confirmingDelete && active" class="pet-group-editor__confirmation"><p class="pet-group-editor__hint">删除分组「{{ active.name }}」？条目和开关状态会保留。子组移到上一级；没有上级的条目回到原来的分组，没有原分组的则回到「未分组」。</p><div class="pet-group-editor__actions"><Button size="sm" variant="secondary" @click="deleteActive">确认删除分组</Button><Button size="sm" variant="text" @click="confirmingDelete = false">取消</Button></div></div>
    <div v-if="creating" class="pet-group-editor__form"><span class="pet-group-editor__hint">{{ createParent ? `在「${all.find(g => g.id === createParent)?.name}」中新建` : '新建顶层分组' }}</span><TextField v-model="newName" autofocus aria-label="新分组名称" placeholder="分组名称" @keydown.enter.prevent="create" /><div class="pet-group-editor__actions"><Button size="sm" :disabled="!newName.trim()" @click="create">创建{{ selected.length ? `并放入 ${selected.length} 个条目` : '' }}</Button><Button size="sm" variant="text" @click="creating = false">取消</Button></div></div>
    <GroupTree :sections="tree" :selected="activeId" :readonly="readonly" @select="selectGroup" @move="move" @nudge="nudge" />
    <p v-if="!tree.length" class="pet-group-editor__hint">尚无分组。可以先在正文中选择条目，再建立分组。</p>
    <p v-if="error" role="alert" class="pet-group-editor__error">{{ error }}</p>
    <template v-if="active">
      <div class="pet-group-editor__form">
        <template v-if="!readonly"><label>分组名称<TextField :model-value="active.name" aria-label="分组名称" @update:model-value="update('name', String($event))" /></label><div class="pet-group-editor__field"><span>开关规则</span><Dropdown :model-value="active.rule === 'folder' ? 'multi' : active.rule" :options="[{ value: 'single', label: '单选' }, { value: 'multi', label: '多选' }]" title="开关规则" @update:model-value="update('rule', $event)" /></div><p class="pet-group-editor__hint">{{ ruleHelp }}</p><label v-if="active.rule !== 'folder'"><input type="checkbox" :checked="active.required" @change="update('required', ($event.target as HTMLInputElement).checked)" />至少开启一项</label><Button v-if="selected.length" size="sm" variant="secondary" @click="assign(active.id)">将 {{ selected.length }} 个所选条目放入此组</Button></template>
        <strong v-else>{{ active.name }}</strong>
        <p v-if="!readonly && !deletable" class="pet-group-editor__hint">这个分组来自预设中的标题，不能在这里删除。若不想显示它，可到「快速分组」中隐藏。</p>
        <Section :title="`组内条目 · ${active.entries.length}`" size="sm"><div v-for="entry in active.entries" :key="entry.id" class="pet-group-editor__member"><span>{{ entry.name }}</span><Button size="sm" variant="text" @click="emit('inspect', entry.id)">查看条目</Button></div></Section>
      </div>
    </template>
  </div>
</template>
<style scoped>
.pet-group-editor{display:flex;flex-direction:column;gap:var(--pet-space-md);min-width:0}.pet-group-editor__hint{margin:0;font-size:var(--pet-font-size-xs);color:var(--pet-color-text-muted);line-height:1.6}.pet-group-editor__spacer{flex:1}.pet-group-editor__actions{display:flex;align-items:center;gap:var(--pet-space-sm);flex-wrap:wrap}.pet-group-editor__form{display:flex;flex-direction:column;gap:var(--pet-space-md);padding:var(--pet-space-md) 0;border-top:1px solid var(--pet-color-border)}.pet-group-editor__field{display:flex;flex-direction:column;gap:var(--pet-space-xs);font-size:var(--pet-font-size-xs)}.pet-group-editor__field :deep(.pet-dd){width:100%}.pet-group-editor label{display:flex;flex-wrap:wrap;align-items:center;gap:var(--pet-space-xs);font-size:var(--pet-font-size-xs)}.pet-group-editor label :deep(.pet-dd),.pet-group-editor label :deep(.pet-field){width:100%}.pet-group-editor__error{color:var(--pet-color-danger);font-size:var(--pet-font-size-xs)}.pet-group-editor__delete{align-self:flex-start;color:var(--pet-color-danger)}.pet-group-editor__confirmation{display:flex;flex-direction:column;gap:var(--pet-space-sm)}.pet-group-editor__member{display:flex;align-items:center;justify-content:space-between;gap:var(--pet-space-sm);font-size:var(--pet-font-size-xs)}
</style>
