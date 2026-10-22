<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import type { Config } from '../config';
import { expandDocument, relatedEntries, type TextFragment, type ExpansionContext, type ExpandedEntry } from '../workbench-preview';
import { documentDiagnostics, type PresetDocument } from '../workbench-model';
import SearchField from '@/ui/SearchField.vue';
import Button from '@/ui/Button.vue';
import Segmented from '@/ui/Segmented.vue';
import IconButton from '@/ui/IconButton.vue';
import PetIcon from '@/ui/PetIcon.vue';
import TextField from '@/ui/TextField.vue';
import Textarea from '@/ui/Textarea.vue';
import Section from '@/ui/Section.vue';
import TextPreview from '@/ui/TextPreview.vue';
import { useMobileWorkbench } from '../useMobileWorkbench';
import EntryText from './EntryText.vue';
import { markerLabel, sendingLayout } from '../workbench-layout';

const props = defineProps<{
  document: PresetDocument; config: Config; context: ExpansionContext;
  selected: string[]; readonly?: boolean; label: string;
  insertion?: boolean; pasteCount?: number; copying?: boolean; dirty?: boolean; copyWarnings?: string[]; busy?: boolean;
}>();
const emit = defineEmits<{
  selection: [ids: string[]]; toggle: [id: string, enabled: boolean];
  edit: [id: string, name: string, content: string];
  paste: [anchor: string | null, side: 'before' | 'after', ids?: string[]];
  panelOpen: []; panelState: [open: boolean]; insertionPoint: [point: { anchor: string | null; side: 'before' | 'after'; label: string } | null];
}>();
const mobile = useMobileWorkbench();
const selecting = ref(false);
const pendingInsertion = ref<{ anchor: string | null; side: 'before' | 'after'; label: string } | null>(null);
const root = ref<HTMLElement>();
const paper = ref<HTMLElement>();
const sideContent = ref<HTMLElement>();
const search = ref('');
const sending = ref(false);
const searching = ref(false);
const searchIndex = ref(0);
const inspecting = ref('');
const focusedVariable = ref('');
const sidebarTab = ref<'entry' | 'groups' | 'copy' | 'plans' | 'view' | 'selection'>('entry');
const compact = ref(!!props.copying);
const expandedEntries = ref<string[]>([]);
const hovered = ref('');
const hoveredDefinition = ref('');
const dragTarget = ref('');
let selectedText = false;
const expansion = computed(() => expandDocument(props.document, props.context));
const layout = computed(() => sendingLayout(expansion.value, props.context));
const diagnostics = computed(() => [...new Set([...documentDiagnostics(props.document), ...expansion.value.entries.flatMap(e => e.diagnostics.map(d => `${e.entry.prompt.name || '未命名'}：${d}`)), ...(sending.value ? layout.value.diagnostics : [])])]);
const entries = computed(() => expansion.value.entries.filter(e => !e.entry.configuration
  && !['⚙️CUSTOMIZATION_START', '⚙️CUSTOMIZATION_END'].includes(e.entry.prompt.name ?? '')));
const placed = computed(() => (sending.value ? layout.value.entries.filter(e => e.entry.prompt.marker || e.text.trim()) : entries.value.filter(e => e.entry.placed)).filter(e => !e.entry.configuration && !['⚙️CUSTOMIZATION_START', '⚙️CUSTOMIZATION_END'].includes(e.entry.prompt.name ?? '') && (!props.copying || !search.value.trim() || !!matchKinds(e))));
const unplaced = computed(() => entries.value.filter(e => !e.entry.placed && (!props.copying || !search.value.trim() || !!matchKinds(e))));
const active = computed(() => expansion.value.entries.find(e => e.entry.prompt.identifier === inspecting.value));
const related = computed(() => relatedEntries(expansion.value, inspecting.value));
const pasteWarnings = computed(() => (props.copyWarnings ?? []).filter(w => !w.startsWith('可选关联条目：') && !w.startsWith('此前贡献：')).map(w => mobile.value ? w.replaceAll('右侧预览', '目标预设预览').replaceAll('右侧结果', '目标预设中的结果') : w));
const entryName = (id?: string) => id ? entries.value.find(e => e.entry.prompt.identifier === id)?.entry.prompt.name || id : '已有变量值';
const variableViews = computed(() => {
  const views = [...(active.value?.reads ?? []).filter(r => r.chain).map(r => ({ key: r.key, global: r.global, value: r.value ?? '', chain: r.chain!, reading: true })),
    ...(active.value?.writes ?? []).filter(w => w.chain).map(w => ({ key: w.key, global: w.global, value: w.step?.after ?? '', chain: w.chain!, reading: false }))];
  return views.filter((v, i) => views.findIndex(x => x.key === v.key && x.global === v.global && x.value === v.value && x.chain.at(-1)?.id === v.chain.at(-1)?.id) === i).sort((a, b) => Number(`${b.global}:${b.key}` === focusedVariable.value) - Number(`${a.global}:${a.key}` === focusedVariable.value));
});
const valuesTitle = computed(() => variableViews.value.some(v => v.reading) ? variableViews.value.some(v => !v.reading) ? '当前读取与写入的值' : '当前读取的值' : variableViews.value.length ? '当前写入的值' : '当前读取的值');
const affected = computed(() => expansion.value.entries.filter(e => e.participating && e.entry.prompt.identifier !== inspecting.value && e.reads.some(r => r.chain?.some(s => s.entryId === inspecting.value))));
const chainIds = computed(() => new Set(variableViews.value.flatMap(v => v.chain.flatMap(s => s.entryId ? [s.entryId] : []))));
const linkedEntries = computed(() => {
  const seen = new Set<string>([inspecting.value, ...chainIds.value]);
  return [...affected.value, ...related.value].filter(e => {
    const id = e.entry.prompt.identifier; if (seen.has(id)) return false; seen.add(id); return true;
  });
});
function relationReason(entry: ExpandedEntry): string {
  if (affected.value.includes(entry)) return '使用了这个条目设置或追加的值';
  const variables = [...new Set([...entry.writes, ...entry.reads].map(r => `${r.global ? '全局 · ' : ''}${r.key}`))];
  return `也使用变量 ${variables.join('、')}，但不是当前值的来源${!entry.entry.placed ? ' · 未加入发送顺序' : !entry.entry.enabled ? ' · 未开启' : ''}`;
}
function sources(chain: import('../workbench-preview').VariableStep[]): { id: string; name: string; operations: string[] }[] {
  const rows: { id: string; name: string; operations: string[] }[] = [];
  for (const step of chain) {
    const id = step.entryId || step.id;
    const name = step.entryId ? entryName(step.entryId) : step.id.startsWith('default:') ? '默认值（未计算角色卡等内容中的变量操作）' : step.global ? '全局变量中已有的值' : '聊天中已有的值';
    const operation = ({ context: '初值', set: '设置', append: '追加文本', sum: '数值相加', push: '加入数组' })[step.kind];
    const row = rows.find(r => r.id === id);
    if (row) { if (!row.operations.includes(operation)) row.operations.push(operation); }
    else rows.push({ id, name, operations: [operation] });
  }
  return rows;
}
function matchKinds(e?: ExpandedEntry): string {
  if (!e || !search.value.trim()) return '';
  const q = search.value.trim().toLocaleLowerCase();
  return [[e.entry.prompt.name, '名称'], [e.entry.prompt.content, '原文'], [[...e.reads, ...e.writes].map(x => x.key).join(' '), '变量'], [e.text, '计算后的文本']].filter(([text]) => text?.toLocaleLowerCase().includes(q)).map(([, label]) => label).join(' / ');
}
const selection = computed(() => expansion.value.entries.filter(e => props.selected.includes(e.entry.prompt.identifier)));
const single = computed(() => selection.value.length === 1 ? selection.value[0] : null);
const matches = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return !query ? [] : entries.value.filter(e => [e.entry.prompt.name, e.entry.prompt.content, e.text,
    ...e.writes.map(w => w.key), ...e.reads.map(r => r.key)].some(s => s?.toLocaleLowerCase().includes(query)));
});
const currentMatch = computed(() => matches.value[searchIndex.value % Math.max(1, matches.value.length)]?.entry.prompt.identifier);
const hoverLabel = computed(() => {
  const entry = entries.value.find(e => e.entry.prompt.identifier === hovered.value);
  const definition = entries.value.find(e => e.entry.prompt.identifier === hoveredDefinition.value);
  if (!entry) return '';
  return `${entry.entry.prompt.name || '未命名条目'}${definition ? ` · 文字来源：${definition.entry.prompt.name || definition.entry.prompt.identifier}` : ''}`;
});
function isHeading(e: ExpandedEntry): boolean {
  return /^\s*\[\d+-.*\]\s*$/.test(e.entry.prompt.name ?? '') && !(e.entry.prompt.content ?? '').trim();
}
function markerNotSending(e: ExpandedEntry): string {
  return !e.entry.enabled ? '未开启，不发送' : e.entry.prompt.injection_trigger?.length && !e.entry.prompt.injection_trigger.includes('normal') ? '不用于本次发送' : '';
}
function selectable(e: ExpandedEntry): boolean { return !e.entry.prompt.marker && !e.entry.configuration && !isHeading(e); }
function groupLabel(id: string): string {
  const group = props.config.entryMeta[id]?.groupId;
  return props.config.customGroups.find(g => g.id === group)?.name
    || props.config.groups.find(g => g.headerId === group)?.name || '';
}
function choose(id: string, event?: MouseEvent, definitionId?: string): void {
  if (selectedText) { selectedText = false; return; }
  const selectedId = definitionId || id;
  const e = expansion.value.entries.find(e => e.entry.prompt.identifier === selectedId);
  if (!e || !selectable(e)) return;
  if (mobile.value && (selecting.value || props.readonly && props.copying) || event?.metaKey || event?.ctrlKey || event?.shiftKey) {
    emit('selection', props.selected.includes(selectedId) ? props.selected.filter(x => x !== selectedId) : [...props.selected, selectedId]);
  } else emit('selection', [selectedId]);
  inspecting.value = selectedId;
  if (!props.readonly && !mobile.value) showSelectedEditor();
}
function chooseFragment(entry: ExpandedEntry, fragment: TextFragment, event: MouseEvent): void {
  if (mobile.value) { choose(entry.entry.prompt.identifier, event); return; }
  if (fragment.variable && !fragment.definitionId) { choose(entry.entry.prompt.identifier, event); focusedVariable.value = `${fragment.global ?? false}:${fragment.variable}`; sidebarTab.value = 'entry'; inspectorOpen.value = true; }
  else choose(entry.entry.prompt.identifier, event, fragment.definitionId);
}
function showSelectedEditor(): void { focusedVariable.value = ''; sidebarTab.value = 'entry'; inspectorOpen.value = true; void nextTick(() => sideContent.value?.scrollTo({ top: 0 })); }
function editContributor(id: string): void { inspecting.value = id; showSelectedEditor(); emit('selection', [id]); }
function openInspector(): void {
  focusedVariable.value = '';
  inspecting.value = single.value?.entry.prompt.identifier || props.selected[0] || '';
  sidebarTab.value = 'entry';
}
const inspectorOpen = ref(false);
const unplacedOpen = ref(false);
function togglePanel(): void {
  if (inspectorOpen.value) { closePanel(); return; }
  if (mobile.value && ['view', 'selection'].includes(sidebarTab.value)) sidebarTab.value = props.selected.length ? 'entry' : 'groups';
  if (!inspecting.value && sidebarTab.value === 'entry') {
    if (props.selected.length) openInspector();
    else sidebarTab.value = 'groups';
  }
  inspectorOpen.value = true;
}
function openPanel(tab: 'entry' | 'groups' | 'copy' | 'plans' | 'view' | 'selection' = 'entry'): void { if (tab === 'entry') openInspector(); sidebarTab.value = tab; inspectorOpen.value = true; }
function closePanel(): void { inspectorOpen.value = false; }
onMounted(() => emit('panelState', inspectorOpen.value));
watch(inspectorOpen, value => { emit('panelState', value); if (value) emit('panelOpen'); });
async function revealEntries(ids: string[]): Promise<void> {
  pendingInsertion.value = null; emit('insertionPoint', null); expandedEntries.value = [...new Set([...expandedEntries.value, ...ids])];
  await nextTick(); if (ids[0]) jump(ids[0]);
}
let readerScrollTop = 0;
watch(inspectorOpen, async value => {
  if (!mobile.value || !paper.value?.parentElement) return;
  if (value) readerScrollTop = paper.value.parentElement.scrollTop;
  else { await nextTick(); if (paper.value?.parentElement) paper.value.parentElement.scrollTop = readerScrollTop; }
});
function cancelInsertion(): void { pendingInsertion.value = null; emit('insertionPoint', null); }
function requestPaste(anchor: string | null, side: 'before' | 'after'): void {
  if (!mobile.value) { emit('paste', anchor, side); return; }
  const label = anchor ? `在「${entryName(anchor)}」${side === 'before' ? '之前' : '之后'}粘贴` : '在文档末尾粘贴';
  pendingInsertion.value = { anchor, side, label }; emit('insertionPoint', pendingInsertion.value);
}
watch(() => props.insertion, () => { pendingInsertion.value = null; emit('insertionPoint', null); });
function toggleSearch(): void { searching.value = !searching.value; }
defineExpose({ openPanel, closePanel, revealEntries, toggleSearch });
function selectCheckbox(id: string): void { emit('selection', props.selected.includes(id) ? props.selected.filter(x => x !== id) : [...props.selected, id]); inspecting.value = id; }
async function setReadingMode(value: string): Promise<void> {
  const nextCompact = value === 'summary';
  if (nextCompact === compact.value) return;
  const scroller = paper.value?.parentElement;
  const anchor = scroller && Array.from(paper.value!.querySelectorAll<HTMLElement>('[data-entry-id]')).find(el => el.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top);
  const previousTop = anchor?.getBoundingClientRect().top;
  compact.value = nextCompact;
  await nextTick();
  if (scroller && anchor && previousTop !== undefined) scroller.scrollTop += anchor.getBoundingClientRect().top - previousTop;
  if (mobile.value && inspectorOpen.value && scroller) readerScrollTop = scroller.scrollTop;
}
function excerpt(e: ExpandedEntry): string { const text = [e.text, ...(!sending.value ? e.writes.map(w => `${w.key}：${w.value}`) : [])].filter(Boolean).join(' · '); return text.length > 240 ? `${text.slice(0, 240)}…` : text || '空条目'; }
function longEntry(e: ExpandedEntry): boolean { const text = [e.text, ...(!sending.value ? e.writes.map(w => `${w.key}：${w.value}`) : [])].join(' · '); return text.length > 240 || text.split('\n').length > 4; }
function editField(field: 'name' | 'content', value: string): void {
  if (!active.value || props.readonly) return;
  emit('edit', inspecting.value, field === 'name' ? value : active.value.entry.prompt.name ?? '', field === 'content' ? value : active.value.entry.prompt.content ?? '');
}
async function chooseRelated(id: string): Promise<void> { inspecting.value = id; sidebarTab.value = 'entry'; sending.value = false; if (unplaced.value.some(e => e.entry.prompt.identifier === id)) unplacedOpen.value = true; await nextTick(); jump(id); }
function addRelated(id: string): void { emit('selection', [...new Set([...props.selected, id])]); }
function jump(id: string): void {
  const el = Array.from(paper.value?.querySelectorAll<HTMLElement>('[data-entry-id]') ?? []).find(el => el.dataset.entryId === id);
  if (el && paper.value) {
    const scroller = paper.value.parentElement!;
    scroller.scrollTo({ top: scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 32, behavior: 'smooth' });
  }
}
function revealMatch(): void {
  if (currentMatch.value && !placed.value.some(e => e.entry.prompt.identifier === currentMatch.value) && !layout.value.unresolved.some(e => e.entry.prompt.identifier === currentMatch.value)) { sending.value = false; unplacedOpen.value = true; }
}
async function moveMatch(delta: number): Promise<void> {
  if (!matches.value.length) return;
  searchIndex.value = (searchIndex.value + delta + matches.value.length) % matches.value.length;
  revealMatch(); if (currentMatch.value && !expandedEntries.value.includes(currentMatch.value)) expandedEntries.value.push(currentMatch.value); await nextTick(); jump(currentMatch.value!);
}
watch(search, async () => { searchIndex.value = 0; revealMatch(); if (currentMatch.value && !expandedEntries.value.includes(currentMatch.value)) expandedEntries.value.push(currentMatch.value); await nextTick(); if (currentMatch.value) jump(currentMatch.value); });
function selectionRange(): void {
  const shadow = root.value?.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null };
  const selection = shadow?.getSelection?.() ?? window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim() || !selection.rangeCount) { selectedText = false; return; }
  const range = selection.getRangeAt(0);
  if (!paper.value?.contains(range.startContainer) || !paper.value.contains(range.endContainer)) return;
  if (mobile.value) { selectedText = true; return; }
  const ids = new Set<string>();
  for (const element of paper.value.querySelectorAll<HTMLElement>('[data-text-source]')) {
    if (range.intersectsNode(element)) ids.add(element.dataset.textSource!);
  }
  const valid = [...ids].filter(id => entries.value.some(e => e.entry.prompt.identifier === id && selectable(e)));
  if (valid.length) { selectedText = true; emit('selection', valid); inspecting.value = valid[0]; if (!props.readonly && !mobile.value) showSelectedEditor(); }
}
function dragStart(event: DragEvent, id: string): void {
  event.stopPropagation();
  const ids = props.selected.includes(id) ? props.selected : [id];
  emit('selection', ids);
  event.dataTransfer?.setData('application/x-pet-prompt-ids', JSON.stringify(ids));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}
function dragText(event: DragEvent): void {
  if (!props.readonly || !props.copying) return;
  const element = event.target instanceof Element ? event.target : null;
  const id = props.selected[0] || element?.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId;
  if (id) dragStart(event, id);
}
function drop(event: DragEvent, anchor: string | null, side: 'before' | 'after'): void {
  event.preventDefault(); dragTarget.value = '';
  try {
    const ids: unknown = JSON.parse(event.dataTransfer?.getData('application/x-pet-prompt-ids') || 'null');
    if (Array.isArray(ids) && ids.length && ids.every(id => typeof id === 'string')) emit('paste', anchor, side, ids);
  } catch { /* Ignore unrelated drags. */ }
}
function allowDrop(event: DragEvent, id: string): void {
  if (!props.insertion || !event.dataTransfer?.types.includes('application/x-pet-prompt-ids')) return;
  event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; dragTarget.value = id;
}
function clearSelection(): void { emit('selection', []); inspecting.value = ''; focusedVariable.value = ''; }
</script>

<template>
  <section ref="root" class="pet-document" :class="{ 'pet-document--copy': copying, 'pet-document--compact': compact, 'pet-document--mobile': mobile, 'pet-document--inspecting': inspectorOpen && mobile }" :aria-label="label" @keydown.esc="clearSelection">
    <header v-show="!mobile || !inspectorOpen && !copying" class="pet-document__bar">
      <div class="pet-document__context">
        <strong :title="label">{{ label }}</strong>
        <span v-if="selection.length" class="pet-document__selection-name" :title="single?.entry.prompt.name">{{ single ? single.entry.prompt.name || '未命名条目' : `已选 ${selection.length} 个条目` }}</span>
        <span v-if="dirty" class="pet-document__hint">未保存</span>
      </div>
      <div class="pet-document__utilities" role="group" aria-label="文档辅助操作">
        <IconButton name="search" title="查找" :active="searching" :aria-expanded="searching" @click="searching = !searching" />
        <IconButton v-if="mobile && !(readonly && copying)" name="select" :title="selecting ? '结束多选' : '选择多个条目'" :active="selecting" @click="selecting = !selecting" />
        <IconButton v-if="selection.length" name="clear-selection" title="取消选择" @click="clearSelection" />
      </div>
    </header>
    <div v-show="!mobile || !inspectorOpen" v-if="searching" class="pet-document__search">
      <SearchField v-model="search" placeholder="在文中查找…" @keydown.enter.prevent="moveMatch(1)" />
      <span>{{ matches.length ? searchIndex + 1 : 0 }}/{{ matches.length }} 段<span v-if="currentMatch" class="pet-document__hint"> · {{ matchKinds(entries.find(e => e.entry.prompt.identifier === currentMatch)) }}</span></span>
      <IconButton name="chevron-up" title="上一个结果" :disabled="!matches.length" @click="moveMatch(-1)" />
      <IconButton name="chevron-down" title="下一个结果" :disabled="!matches.length" @click="moveMatch(1)" />
      <IconButton name="close" title="结束查找" @click="searching = false; search = ''" />
    </div>
    <div class="pet-document__body">
      <div class="pet-document__scroll">
        <div ref="paper" class="pet-document__paper" @mouseup="selectionRange" @dragstart="dragText">
          <p v-if="sending && layout.unresolved.length" role="status" class="pet-document__intro">有 {{ layout.unresolved.length }} 个已开启条目未能放入发送位置。<Button size="sm" variant="text" @click="jump(layout.unresolved[0].entry.prompt.identifier)">查看条目和原因</Button></p>
          <p v-if="insertion" class="pet-document__intro">{{ mobile ? (pasteCount ? `已选 ${pasteCount} 项。点击两段之间选择位置，再点底部「粘贴」。` : '先切换到来源预设勾选条目，再回到这里选择粘贴位置。') : !pasteCount ? '先在左侧勾选条目，再拖到这里，或点击两段之间粘贴。' : '' }}</p>
          <template v-for="e in placed" :key="e.entry.prompt.identifier">
            <button v-if="insertion" type="button" class="pet-document__drop" :class="{ 'pet-document__drop--ready': pasteCount, 'pet-document__drop--over': dragTarget === e.entry.prompt.identifier || pendingInsertion?.anchor === e.entry.prompt.identifier }" :disabled="!pasteCount" :aria-label="`在「${e.entry.prompt.name || '未命名条目'}」之前粘贴`" @click="requestPaste(e.entry.prompt.identifier, 'before')" @dragover="allowDrop($event, e.entry.prompt.identifier)" @dragleave="dragTarget = ''" @drop="drop($event, e.entry.prompt.identifier, 'before')"><span>在这里粘贴 {{ pasteCount || '' }} 个条目</span></button>
            <article :data-entry-id="e.entry.prompt.identifier" class="pet-document__passage" :class="{ 'pet-document__passage--selected': selected.includes(e.entry.prompt.identifier), 'pet-document__passage--off': !e.entry.enabled, 'pet-document__passage--match': currentMatch === e.entry.prompt.identifier }" @mouseenter="hovered = e.entry.prompt.identifier; hoveredDefinition = ''" @mouseleave="hovered = ''; hoveredDefinition = ''">
              <div v-if="selectable(e)" class="pet-document__identity">
                <input v-if="(copying && readonly || mobile && selecting) && selectable(e)" type="checkbox" :checked="selected.includes(e.entry.prompt.identifier)" :aria-label="`勾选条目 ${e.entry.prompt.name || '未命名'}`" @change="selectCheckbox(e.entry.prompt.identifier)" />
                <button type="button" class="pet-document__identity-button" :aria-label="`选择条目 ${e.entry.prompt.name || '未命名'}`" @click="choose(e.entry.prompt.identifier, $event)">{{ e.entry.prompt.name || '未命名' }}<span v-if="groupLabel(e.entry.prompt.identifier)"> · {{ groupLabel(e.entry.prompt.identifier) }}</span><span v-if="!e.entry.enabled"> · 未开启</span></button>
                <button v-if="readonly && copying && !mobile" type="button" class="pet-document__grip" draggable="true" title="拖动条目到右侧文档" aria-label="拖动条目" @dragstart="dragStart($event, e.entry.prompt.identifier)"><PetIcon name="grip" /></button>
              </div>
              <h3 v-if="isHeading(e)" class="pet-document__heading">{{ e.entry.prompt.name?.replace(/^\s*\[\d+-|\]\s*$/g, '') }}</h3>
              <div v-else-if="e.entry.prompt.marker" class="pet-document__placeholder" :class="{ 'pet-document__placeholder--inactive': markerNotSending(e) }"><span>[{{ markerLabel(e) }}]</span><span v-if="markerNotSending(e)" class="pet-document__hint">{{ markerNotSending(e) }}</span><Button v-if="!e.entry.enabled && !readonly" size="sm" variant="text" :disabled="busy" :aria-label="`开启占位条目 ${markerLabel(e)}`" @click="emit('toggle', e.entry.prompt.identifier, true)">开启</Button></div>
              <div v-else class="pet-document__content" @click="choose(e.entry.prompt.identifier, $event)">
                <p v-if="compact && !expandedEntries.includes(e.entry.prompt.identifier)" class="pet-document__excerpt" :data-text-source="e.entry.prompt.identifier">{{ excerpt(e) }}</p>
                <EntryText v-else :entry="e" :search="search" :sending="sending" @fragment="(fragment, event) => chooseFragment(e, fragment, event)" @hover="hoveredDefinition = $event" />
              </div>
              <Button v-if="compact && longEntry(e)" size="sm" variant="text" @click="expandedEntries = expandedEntries.includes(e.entry.prompt.identifier) ? expandedEntries.filter(id => id !== e.entry.prompt.identifier) : [...expandedEntries, e.entry.prompt.identifier]">{{ expandedEntries.includes(e.entry.prompt.identifier) ? '收起全文' : '展开此条' }}</Button>
              <span v-if="hovered === e.entry.prompt.identifier && hoveredDefinition && selectable(e)" class="pet-document__tooltip" role="tooltip">{{ hoverLabel }}</span>
            </article>
          </template>
          <button v-if="insertion" type="button" class="pet-document__drop pet-document__drop--end" :class="{ 'pet-document__drop--ready': pasteCount, 'pet-document__drop--over': dragTarget === '__end__' || pendingInsertion && pendingInsertion.anchor === null }" :disabled="!pasteCount" aria-label="在文档末尾粘贴" @click="requestPaste(null, 'after')" @dragover="allowDrop($event, '__end__')" @dragleave="dragTarget = ''" @drop="drop($event, null, 'after')"><span>{{ entries.some(e => e.entry.placed) ? '在文档末尾粘贴' : '在空白文档中粘贴' }} {{ pasteCount || '' }} 个条目</span></button>
          <p v-if="!entries.length" class="pet-document__empty">这份预设还没有文本。</p>
          <section v-if="sending && layout.unresolved.length" class="pet-document__unresolved" aria-label="已开启但未能放入发送位置的条目">
            <h3 class="pet-document__heading">已开启，但未能放入发送位置 · {{ layout.unresolved.length }}</h3>
            <p class="pet-document__hint">{{ layout.unresolvedReason }}</p>
            <article v-for="e in layout.unresolved" :key="e.entry.prompt.identifier" :data-entry-id="e.entry.prompt.identifier" class="pet-document__passage" :class="{ 'pet-document__passage--selected': selected.includes(e.entry.prompt.identifier) }">
              <div class="pet-document__identity pet-document__identity--unplaced"><button type="button" class="pet-document__identity-button" @click="choose(e.entry.prompt.identifier, $event)">{{ e.entry.prompt.name || '未命名' }} · 已开启</button></div>
              <div class="pet-document__content" @click="choose(e.entry.prompt.identifier, $event)"><p v-if="compact && !expandedEntries.includes(e.entry.prompt.identifier)" class="pet-document__excerpt" :data-text-source="e.entry.prompt.identifier">{{ excerpt(e) }}</p><EntryText v-else :entry="e" :search="search" sending @fragment="(fragment, event) => chooseFragment(e, fragment, event)" /></div>
              <Button v-if="compact && longEntry(e)" size="sm" variant="text" @click="expandedEntries = expandedEntries.includes(e.entry.prompt.identifier) ? expandedEntries.filter(id => id !== e.entry.prompt.identifier) : [...expandedEntries, e.entry.prompt.identifier]">{{ expandedEntries.includes(e.entry.prompt.identifier) ? '收起全文' : '展开此条' }}</Button>
            </article>
          </section>
          <Section v-if="unplaced.length && !sending" :title="`未加入发送顺序 · ${unplaced.length}`" v-model:open="unplacedOpen" size="sm">
            <p class="pet-document__hint">这些条目保存在预设中，但没有加入发送顺序，因此不会发送。</p>
            <article v-for="e in unplaced" :key="e.entry.prompt.identifier" :data-entry-id="e.entry.prompt.identifier" class="pet-document__passage" :class="{ 'pet-document__passage--selected': selected.includes(e.entry.prompt.identifier) }">
              <div class="pet-document__identity pet-document__identity--unplaced"><input v-if="(copying && readonly || mobile && selecting) && selectable(e)" type="checkbox" :checked="selected.includes(e.entry.prompt.identifier)" :aria-label="`勾选条目 ${e.entry.prompt.name || '未命名'}`" @change="selectCheckbox(e.entry.prompt.identifier)" /><button type="button" class="pet-document__identity-button" @click="choose(e.entry.prompt.identifier, $event)">{{ e.entry.prompt.name || '未命名' }}</button></div>
              <div class="pet-document__content" @click="choose(e.entry.prompt.identifier, $event)"><p v-if="compact && !expandedEntries.includes(e.entry.prompt.identifier)" class="pet-document__excerpt" :data-text-source="e.entry.prompt.identifier">{{ excerpt(e) }}</p><EntryText v-else :entry="e" :search="search" @fragment="(fragment, event) => chooseFragment(e, fragment, event)" /></div>
              <Button v-if="compact && longEntry(e)" size="sm" variant="text" @click="expandedEntries = expandedEntries.includes(e.entry.prompt.identifier) ? expandedEntries.filter(id => id !== e.entry.prompt.identifier) : [...expandedEntries, e.entry.prompt.identifier]">{{ expandedEntries.includes(e.entry.prompt.identifier) ? '收起全文' : '展开此条' }}</Button>
            </article>
          </Section>
        </div>
      </div>
      <aside v-if="inspectorOpen" class="pet-document__inspector" aria-label="预设侧栏">
        <header class="pet-document__inspector-head"><strong>{{ mobile ? ({ entry: active?.entry.prompt.name || '条目', groups: '分组', plans: '方案', copy: '选择目标预设', view: '阅读视图', selection: `已选 ${selected.length} 个条目` })[sidebarTab] : '预设侧栏' }}</strong><IconButton v-if="!mobile" name="close" title="关闭侧栏" @click="closePanel" /></header>
        <nav v-if="!mobile || !['view', 'selection'].includes(sidebarTab)" class="pet-document__side-tabs" aria-label="侧栏页面"><Button size="sm" :variant="sidebarTab === 'entry' ? 'secondary' : 'text'" @click="openPanel('entry')">条目</Button><Button size="sm" :variant="sidebarTab === 'groups' ? 'secondary' : 'text'" @click="openPanel('groups')">分组</Button><Button v-if="$slots.plans && !copying" size="sm" :variant="sidebarTab === 'plans' ? 'secondary' : 'text'" @click="openPanel('plans')">方案</Button><Button v-if="$slots.copy" size="sm" :variant="sidebarTab === 'copy' ? 'secondary' : 'text'" @click="openPanel('copy')">复制</Button></nav>
        <div ref="sideContent" class="pet-document__side-content" :class="{ 'pet-document__side-content--copy': sidebarTab === 'copy' }">
        <template v-if="sidebarTab === 'view'">
          <span class="pet-document__hint">预览范围</span><Segmented v-if="!copying" aria-label="预览范围" :model-value="sending ? 'sending' : 'all'" :options="[{ value: 'all', label: '全部条目' }, { value: 'sending', label: '发送文本' }]" @update:model-value="sending = $event === 'sending'" />
          <span class="pet-document__hint">内容显示</span><Segmented aria-label="内容显示" :model-value="compact ? 'summary' : 'full'" :options="[{ value: 'full', label: '完整内容' }, { value: 'summary', label: '摘要' }]" @update:model-value="setReadingMode" />
          <p class="pet-document__hint">{{ expansion.requestUnavailable }}</p>
        </template>
        <template v-else-if="sidebarTab === 'selection'">
          <p class="pet-document__hint">翻页不会清空选择。取消勾选即可移除；查看关联可检查是否需要一起复制其他条目。</p>
          <article v-for="e in selection" :key="e.entry.prompt.identifier" class="pet-document__selected-review"><label><input type="checkbox" checked :aria-label="`移除所选条目 ${e.entry.prompt.name || '未命名'}`" @change="selectCheckbox(e.entry.prompt.identifier)" /><strong>{{ e.entry.prompt.name || '未命名' }}</strong></label><TextPreview :text="[e.text, ...e.writes.map(w => `${w.key}：${w.value}`)].filter(Boolean).join('\n') || e.entry.prompt.content || '（空条目）'" /><Button size="sm" variant="text" @click="chooseRelated(e.entry.prompt.identifier)">查看关联与原文</Button></article>
          <p v-if="!selection.length" class="pet-document__hint">尚未选择条目，请返回正文勾选。</p>
          <div v-if="pasteWarnings.length" class="pet-document__copy-notes"><strong>复制提醒</strong><ul><li v-for="warning in pasteWarnings" :key="warning">{{ warning }}</li></ul></div>
        </template>
        <template v-else-if="sidebarTab === 'groups'"><slot name="groups" :inspect="chooseRelated" /></template>
        <template v-else-if="sidebarTab === 'plans' && !copying"><slot name="plans" /></template>
        <template v-else-if="sidebarTab === 'copy'"><slot name="copy" /></template>
        <template v-else-if="active">
          <Section :title="readonly ? '条目原文' : '编辑'" :collapsible="false" size="sm" class="pet-document__entry-block">
            <div class="pet-document__edit-fields">
              <template v-if="!readonly">
                <TextField :model-value="active.entry.prompt.name || ''" aria-label="条目名称" @update:model-value="editField('name', String($event))" />
                <Textarea :model-value="active.entry.prompt.content || ''" commit-on-input rows="6" aria-label="条目原文" @update:model-value="editField('content', $event)" />
                <label v-if="selectable(active)" class="pet-document__hint pet-document__entry-toggle"><input type="checkbox" :checked="active.entry.enabled" @change="emit('toggle', active.entry.prompt.identifier, ($event.target as HTMLInputElement).checked)" /><span>开启条目</span></label>
                <p class="pet-document__hint">修改仅用于当前预览，保存后生效。</p>
              </template>
              <template v-else><strong class="pet-document__relation-name">{{ active.entry.prompt.name || '未命名' }}</strong><TextPreview :text="active.entry.prompt.content || ''" /></template>
              <p v-if="!active.entry.placed" class="pet-document__hint">尚未加入发送顺序，不会发送。{{ readonly ? '' : '开启条目后，会加入发送顺序末尾，保存后生效。' }}</p>
              <p class="pet-document__hint">{{ active.entry.enabled ? '已开启' : active.entry.placed ? '未开启' : '未加入发送顺序' }} · {{ active.entry.prompt.role || 'system' }}</p>
              <p v-if="active.diagnostics.length" class="pet-document__hint">{{ active.diagnostics.join('；') }}</p>
              <div v-if="copying && readonly && pasteWarnings.length" class="pet-document__copy-notes" role="note"><strong>粘贴提醒</strong><p class="pet-document__hint">复制前，请检查这些条目能否在目标预设中正常使用。</p><ul><li v-for="warning in pasteWarnings" :key="warning">{{ warning }}</li></ul></div>
            </div>
          </Section>
          <Section :title="valuesTitle" :collapsible="false" size="sm" class="pet-document__entry-block">
            <ul v-if="variableViews.length" class="pet-document__value-list">
              <li v-for="(v, i) in variableViews" :key="`${v.global}:${v.key}:${i}`" class="pet-document__value-item">
                <div class="pet-document__value-name"><strong>{{ v.global ? '全局 · ' : '' }}{{ v.key }}</strong><span class="pet-document__hint">{{ v.reading ? '读取值' : '这次设置／追加后的值' }}</span></div>
                <div v-for="source in sources(v.chain)" :key="source.id" class="pet-document__source">
                  <span class="pet-document__hint">来源：{{ source.name }} · {{ source.operations.join('、') }}</span>
                  <Button v-if="entries.some(e => e.entry.prompt.identifier === source.id) && source.id !== inspecting" size="sm" variant="text" :aria-label="`查看来源 ${source.name}`" @click="readonly ? chooseRelated(source.id) : editContributor(source.id)">查看原文</Button>
                  <span v-else-if="source.id === inspecting" class="pet-document__hint">当前条目</span>
                  <Button v-if="readonly && copying && !selected.includes(source.id) && entries.some(e => e.entry.prompt.identifier === source.id && selectable(e))" size="sm" variant="text" :aria-label="`加入来源 ${source.name}`" @click="addRelated(source.id)">加入选择</Button>
                </div>
                <TextPreview :text="v.value || '（空值）'" />
              </li>
            </ul>
            <p v-else class="pet-document__hint">这个条目没有读取变量，或暂时无法算出变量值。</p>
          </Section>
          <Section title="其他关联" :collapsible="false" size="sm" class="pet-document__entry-block">
            <p class="pet-document__hint">{{ linkedEntries.length ? '这些条目也使用相同变量，但不是上方值的来源。' : '没有其他使用相同变量的条目。' }}</p>
            <ul v-if="linkedEntries.length" class="pet-document__linked-list">
              <li v-for="r in linkedEntries" :key="r.entry.prompt.identifier" class="pet-document__relation">
                <strong class="pet-document__relation-name">{{ r.entry.prompt.name || '未命名' }}</strong>
                <span class="pet-document__hint">{{ relationReason(r) }}</span>
                <div class="pet-document__relation-actions"><Button size="sm" variant="text" :aria-label="`查看条目 ${r.entry.prompt.name || '未命名'}`" @click="readonly ? chooseRelated(r.entry.prompt.identifier) : editContributor(r.entry.prompt.identifier)">查看原文</Button><Button v-if="readonly && copying && !selected.includes(r.entry.prompt.identifier) && selectable(r)" size="sm" variant="text" :aria-label="`加入选择 ${r.entry.prompt.name || '未命名'}`" @click="addRelated(r.entry.prompt.identifier)">加入选择</Button></div>
              </li>
            </ul>
          </Section>
        </template>
        <p v-else class="pet-document__hint">点击或选中正文，查看并编辑对应条目。</p>
        </div>
      </aside>
    </div>
    <footer v-show="!mobile || !inspectorOpen" class="pet-document__status">
      <div v-if="!mobile" class="pet-document__views" role="group" aria-label="阅读视图">
        <Segmented v-if="!copying" aria-label="预览范围" :title="expansion.requestUnavailable" :model-value="sending ? 'sending' : 'all'" :options="[{ value: 'all', label: '全部条目' }, { value: 'sending', label: '发送文本' }]" @update:model-value="sending = $event === 'sending'" />
        <Segmented aria-label="内容显示" :model-value="compact ? 'summary' : 'full'" :options="[{ value: 'full', label: '完整内容' }, { value: 'summary', label: '摘要' }]" @update:model-value="setReadingMode" />
        <IconButton name="panel-right" :title="inspectorOpen ? '收起侧栏' : '展开侧栏'" :active="inspectorOpen" :aria-expanded="inspectorOpen" @click="togglePanel" />
      </div>
      <template v-else><div class="pet-document__mobile-views"><IconButton name="sliders" title="阅读视图" @click="openPanel('view')" /><IconButton name="panel-right" :title="selection.length ? '查看条目详情' : '分组与方案'" @click="togglePanel" /></div><div class="pet-document__mobile-actions"><span v-if="pendingInsertion && insertion" class="pet-document__hint">{{ pendingInsertion.label }}</span><IconButton v-if="pendingInsertion && insertion" name="clear-selection" title="取消粘贴位置" @click="cancelInsertion" /><slot name="mobile-actions" /></div></template>
      <span v-if="!mobile" class="pet-document__status-hint">{{ dirty ? '含未保存修改 · ' : '' }}{{ selected.length ? (readonly && copying ? `已选 ${selected.length} 个条目 · 拖到右侧，或点击两段之间粘贴` : `已选 ${selected.length} 个条目 · ⌘/Ctrl 点击可多选`) : '悬停查看来源 · 点击选择条目' }}</span>
      <details v-if="diagnostics.length && !mobile"><summary>{{ diagnostics.length }} 条提示</summary><div class="pet-document__status-messages"><p v-for="message in diagnostics" :key="message">{{ message }}</p></div></details>
    </footer>
  </section>
</template>

<style scoped>
.pet-document{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;overflow:hidden}
.pet-document__bar,.pet-document__search{display:flex;align-items:center;gap:var(--pet-space-sm);padding:var(--pet-space-sm) var(--pet-space-lg);flex:none;border-bottom:1px solid var(--pet-color-border)}
.pet-document__bar{min-height:46px;box-sizing:border-box;white-space:nowrap;overflow-x:auto}
.pet-document__context{display:flex;align-items:center;gap:var(--pet-space-sm);flex:1;min-width:96px;overflow:hidden}
.pet-document__context strong{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;font-weight:var(--pet-font-weight-medium);font-size:var(--pet-font-size-sm)}
.pet-document__utilities{display:flex;align-items:center;gap:var(--pet-space-xs);flex:none}
.pet-document__search{font-size:var(--pet-font-size-xs)}.pet-document__search :deep(.pet-search){flex:1}
.pet-document__selection-name{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--pet-font-size-sm);border-left:1px solid var(--pet-color-border);padding-left:var(--pet-space-sm)}
.pet-document__side-tabs{display:flex;gap:var(--pet-space-xs);border-bottom:1px solid var(--pet-color-border);padding-bottom:var(--pet-space-sm)}
.pet-document .pet-document__identity--unplaced{height:auto;top:auto;opacity:1;margin-bottom:var(--pet-space-xs)}.pet-document--copy .pet-document__identity,.pet-document--compact .pet-document__identity{height:auto;top:auto;opacity:1;margin-bottom:var(--pet-space-xs)}.pet-document--copy .pet-document__identity-button{flex:1}.pet-document__excerpt{margin:0;font-size:var(--pet-font-size-sm);line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.pet-document__value{max-height:144px;overflow:auto;font:inherit;font-size:var(--pet-font-size-xs);line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;margin:var(--pet-space-xs) 0;padding:var(--pet-space-sm);background:var(--pet-color-surface-raised);border-radius:var(--pet-radius-sm)}
.pet-document__relation-name{font-size:var(--pet-font-size-sm);font-weight:var(--pet-font-weight-medium);overflow-wrap:anywhere}.pet-document__relation-actions{display:flex;align-items:center;gap:var(--pet-space-sm)}
.pet-document__body{display:flex;flex:1;min-height:0;overflow:hidden}
.pet-document__scroll{flex:1;min-width:0;overflow:auto;background:var(--pet-color-workspace);padding:var(--pet-space-xl)}
.pet-document__paper{max-width:780px;min-height:100%;margin:0 auto;padding:48px 52px 80px;background:var(--pet-color-surface);box-shadow:var(--pet-effect-shadow-sm);border:1px solid var(--pet-color-border);border-radius:var(--pet-radius-sm)}
.pet-document__passage{position:relative;margin:0;padding:var(--pet-space-md) 0;border-left:2px solid transparent;outline:none;scroll-margin-top:var(--pet-space-xl)}
.pet-document__passage--selected{background:color-mix(in srgb,var(--pet-color-accent),transparent 92%);border-left-color:var(--pet-color-accent)}
.pet-document__passage--match{outline:1px solid var(--pet-color-border-strong)}
.pet-document__identity{height:0;position:relative;display:flex;align-items:center;justify-content:space-between;top:-14px;opacity:0;transition:opacity var(--pet-motion-fast) var(--pet-motion-ease);z-index:2}
.pet-document__passage:hover>.pet-document__identity,.pet-document__passage:focus-within>.pet-document__identity,.pet-document__passage--selected>.pet-document__identity{opacity:1}
.pet-document__identity-button{font:inherit;font-size:var(--pet-font-size-xs);color:var(--pet-color-text-muted);background:var(--pet-color-surface);border:0;padding:var(--pet-space-xxs) var(--pet-space-xs);border-radius:var(--pet-radius-sm);text-align:left;cursor:pointer;max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pet-document__grip{display:flex;align-items:center;background:var(--pet-color-surface);color:var(--pet-color-icon);border:0;cursor:grab;padding:var(--pet-space-xxs)}
.pet-document__grip :deep(svg){width:16px;height:16px}
.pet-document__text{font:inherit;font-size:var(--pet-font-size-base);line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.pet-document__text+.pet-document__text{margin-top:var(--pet-space-md)}
.pet-document__content{cursor:text;padding:0 var(--pet-space-sm)}
.pet-document__variable:hover{background:color-mix(in srgb,var(--pet-color-accent),transparent 88%)}
.pet-document__heading{font-size:var(--pet-font-size-lg);font-weight:var(--pet-font-weight-medium);margin:var(--pet-space-lg) var(--pet-space-sm) var(--pet-space-xs)}
.pet-document__empty,.pet-document__intro{font-size:var(--pet-font-size-xs);color:var(--pet-color-text-faint);margin:var(--pet-space-xs) var(--pet-space-sm);line-height:var(--pet-font-leading-normal)}
.pet-document__unresolved{margin-top:var(--pet-space-xl);padding:var(--pet-space-lg);border:1px solid var(--pet-color-border-strong);border-radius:var(--pet-radius-sm)}
.pet-document__placeholder{display:flex;align-items:center;justify-content:center;gap:var(--pet-space-sm);flex-wrap:wrap;font-size:var(--pet-font-size-sm);color:var(--pet-color-text-muted);padding:var(--pet-space-md);margin:var(--pet-space-md) var(--pet-space-sm);text-align:center;border:1px dashed var(--pet-color-border-strong);border-radius:var(--pet-radius-sm)}
.pet-document__passage--off{border-left-style:dotted;border-left-color:var(--pet-color-border-strong)}
.pet-document__passage--off .pet-document__text{color:var(--pet-color-text-muted)}
.pet-document__passage--off.pet-document__passage--selected{border-left-style:solid;border-left-color:var(--pet-color-accent)}
.pet-document__tooltip{position:absolute;right:0;bottom:100%;z-index:4;pointer-events:none;background:var(--pet-color-surface-raised);border:1px solid var(--pet-color-border-strong);border-radius:var(--pet-radius-sm);padding:var(--pet-space-xs) var(--pet-space-sm);font-size:var(--pet-font-size-xs);max-width:100%;overflow-wrap:anywhere;box-shadow:var(--pet-effect-shadow-sm)}
.pet-document__drop{display:block;position:relative;width:100%;height:18px;padding:0;border:0;background:transparent;cursor:text;color:var(--pet-color-accent);font:inherit;font-size:var(--pet-font-size-xs)}
.pet-document__drop::before{content:'';position:absolute;left:0;right:0;top:50%;height:2px;background:var(--pet-color-accent);opacity:0}
.pet-document__drop span{position:relative;background:var(--pet-color-surface);padding:var(--pet-space-xxs) var(--pet-space-sm);opacity:0;pointer-events:none}
.pet-document__drop--ready:hover::before,.pet-document__drop--ready:focus-visible::before,.pet-document__drop--over::before,.pet-document__drop--ready:hover span,.pet-document__drop--ready:focus-visible span,.pet-document__drop--over span{opacity:1}
.pet-document__drop--ready{border-left:2px solid var(--pet-color-accent)}
.pet-document__drop--end{height:48px;margin-bottom:var(--pet-space-xl)}
.pet-document__drop--end.pet-document__drop--ready span{opacity:1;color:var(--pet-color-text-muted)}
.pet-document__inspector{width:310px;min-height:0;flex:none;overflow:hidden;display:flex;flex-direction:column;gap:var(--pet-space-md);padding:var(--pet-space-lg);border-left:1px solid var(--pet-color-border);background:var(--pet-color-surface)}
.pet-document__side-content{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:var(--pet-space-md)}.pet-document__side-content>*{flex-shrink:0}.pet-document__side-content--copy{overflow:hidden}.pet-document__inspector-head,.pet-document__side-tabs{flex:none}
.pet-document__inspector-head{display:flex;align-items:center;justify-content:space-between}
.pet-document__inspector :deep(textarea){min-height:144px;resize:vertical}
.pet-document__hint{font-size:var(--pet-font-size-xs);color:var(--pet-color-text-muted);line-height:var(--pet-font-leading-normal);margin:0}
.pet-document__edit-fields{display:flex;flex-direction:column;gap:var(--pet-space-sm)}.pet-document__entry-toggle{display:inline-flex;align-items:center;align-self:flex-start;gap:var(--pet-space-xs)}.pet-document__entry-toggle>input{margin:0;width:14px;height:14px;flex:none;accent-color:var(--pet-color-accent)}.pet-document__entry-toggle>span{display:block}
.pet-document__value-list,.pet-document__linked-list{list-style:none;margin:0;padding:0}.pet-document__value-item+.pet-document__value-item{margin-top:var(--pet-space-lg)}.pet-document__value-name{display:flex;align-items:baseline;gap:var(--pet-space-sm);font-size:var(--pet-font-size-sm)}.pet-document__value-name strong{font-weight:var(--pet-font-weight-medium);overflow-wrap:anywhere}.pet-document__source{display:flex;align-items:center;flex-wrap:wrap;gap:var(--pet-space-xs);padding:var(--pet-space-xxs) 0}.pet-document__source>.pet-document__hint:first-child{flex:1;min-width:100px;overflow-wrap:anywhere}
.pet-document__copy-notes{font-size:var(--pet-font-size-xs);padding:var(--pet-space-sm);border:1px solid var(--pet-color-border);border-radius:var(--pet-radius-sm)}.pet-document__copy-notes ul{padding-left:var(--pet-space-lg);margin-bottom:0}.pet-document__copy-notes li+li{margin-top:var(--pet-space-xs)}
.pet-document__relation{display:flex;flex-direction:column;align-items:flex-start;gap:var(--pet-space-xs);padding:var(--pet-space-sm) 0}
.pet-document__status{display:flex;align-items:center;justify-content:space-between;gap:var(--pet-space-sm);font-size:var(--pet-font-size-xs);color:var(--pet-color-text-faint);padding:var(--pet-space-xs) var(--pet-space-lg);border-top:1px solid var(--pet-color-border);flex:none}
.pet-document__views{display:flex;align-items:center;gap:var(--pet-space-sm);flex:none}.pet-document__status-hint{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
.pet-document__status details{position:relative;flex:none}.pet-document__status summary{cursor:pointer;white-space:nowrap}.pet-document__status-messages{position:absolute;bottom:calc(100% + var(--pet-space-sm));right:0;z-index:40;width:340px;max-width:70vw;max-height:240px;overflow:auto;padding:var(--pet-space-md);background:var(--pet-color-surface);color:var(--pet-color-text-muted);border:1px solid var(--pet-color-border-strong);border-radius:var(--pet-radius-sm);box-shadow:var(--pet-effect-shadow-md)}.pet-document__status-messages p{margin:0;line-height:1.6}.pet-document__status-messages p+p{margin-top:var(--pet-space-sm)}
.pet-document mark{background:color-mix(in srgb,var(--pet-color-rule-always-on),transparent 66%);color:inherit}
@media(max-width:767px), (max-width:1023px) and (pointer:coarse){
.pet-document__bar{min-height:48px;padding:4px 10px;overflow:hidden}.pet-document__context{min-width:0}.pet-document__context strong{max-width:50%}.pet-document__selection-name{max-width:45%;font-size:var(--pet-font-size-xs)}.pet-document__utilities :deep(.pet-ico){width:40px;height:40px}.pet-document__scroll{padding:0;overscroll-behavior:contain}.pet-document__paper{max-width:none;padding:20px 14px 40px;min-height:100%;border:0;border-radius:0;box-shadow:none}.pet-document__content :deep(.pet-entry-text){font-size:15px;line-height:1.8}.pet-document__identity{height:auto;top:auto;opacity:1;margin-bottom:4px}.pet-document__identity input{width:20px;height:20px;margin:0 6px 0 0;flex:none;accent-color:var(--pet-color-accent)}.pet-document__identity-button{max-width:100%;white-space:normal;line-height:1.5}.pet-document__drop{height:44px;border-top:1px dashed var(--pet-color-border)}.pet-document__drop--ready span{opacity:1}.pet-document__drop--over::before{opacity:1}.pet-document__drop--over span{color:var(--pet-color-accent);font-weight:var(--pet-font-weight-semibold)}.pet-document__body{position:relative}.pet-document--inspecting .pet-document__scroll{position:absolute;inset:0;visibility:hidden;pointer-events:none}.pet-document__inspector{position:relative;inset:auto;width:100%;flex:1;min-width:0;padding:12px;border:0;gap:12px}.pet-document__inspector-head{justify-content:flex-start;min-height:40px}.pet-document__inspector-head strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pet-document__inspector-head :deep(.pet-ico){width:40px;height:40px}.pet-document__side-tabs{gap:4px}.pet-document__side-tabs :deep(.pet-btn){min-height:40px;flex:1;padding:6px}.pet-document__side-content{overscroll-behavior:contain;padding-bottom:env(safe-area-inset-bottom,0px)}.pet-document__inspector :deep(input[type=text]),.pet-document__inspector :deep(textarea),.pet-document__search :deep(input){font-size:16px}.pet-document__inspector :deep(.pet-dd__option){min-height:40px}.pet-document__inspector :deep(.pet-btn){min-height:40px}.pet-document__inspector :deep(.pet-ico){min-width:40px;min-height:40px}.pet-document__inspector :deep(textarea){min-height:200px;max-width:100%;resize:vertical}.pet-document__status{padding:4px 8px calc(4px + env(safe-area-inset-bottom,0px));gap:6px;min-height:56px;align-items:center}.pet-document__mobile-views{display:flex;flex:none}.pet-document__mobile-views :deep(.pet-ico){width:40px;height:40px}.pet-document__mobile-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex:1;min-width:0}.pet-document__mobile-actions :deep(.pet-btn){min-height:40px;max-width:100%}.pet-document__mobile-actions>.pet-document__hint{font-size:11px;overflow:hidden;max-height:36px;text-overflow:ellipsis}.pet-document__selected-review{padding-bottom:12px;border-bottom:1px solid var(--pet-color-border)}.pet-document__selected-review label{display:flex;align-items:center;gap:8px;font-size:var(--pet-font-size-sm)}.pet-document__selected-review input{width:20px;height:20px;flex:none}.pet-document__search{padding:8px;gap:4px;flex-wrap:wrap}.pet-document__search :deep(.pet-search){min-width:120px}.pet-document__search :deep(.pet-ico){width:36px;height:36px}.pet-document__side-content :deep(.pet-seg){align-self:flex-start}.pet-document__side-content :deep(.pet-seg__btn){min-height:36px;padding:8px 14px}.pet-document__placeholder{margin:12px 0;padding:12px}.pet-document__placeholder :deep(.pet-btn){min-height:36px}
}
</style>
