<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useWorkbenchStore, draftDirty } from '../workbench-store';
import { applyPlan, capturePlan, copyEntries, removeCopiedEntries, toggleDraftEntry } from '../workbench-model';
import { copyDiagnostics, expandDocument } from '../workbench-preview';
import { flushAutosave, useConsoleStore, useUiStore } from '../store';
import Button from '@/ui/Button.vue';
import IconButton from '@/ui/IconButton.vue';
import Dropdown from '@/ui/Dropdown.vue';
import TextField from '@/ui/TextField.vue';
import SearchField from '@/ui/SearchField.vue';
import TextBrowser from './TextBrowser.vue';
import { useMobileWorkbench } from '../useMobileWorkbench';
import PlanManager from './PlanManager.vue';
import GroupTreeEditor from './GroupTreeEditor.vue';

const mobile = useMobileWorkbench();
const mobilePage = ref<'source' | 'target'>('source');
const sourcePanelOpen = ref(false), targetPanelOpen = ref(false);
const insertionPoint = ref<{ anchor: string | null; side: 'before' | 'after'; label: string } | null>(null);
const wb = useWorkbenchStore();
const consoleStore = useConsoleStore();
const ui = useUiStore();
const dialog = ref<'' | 'plan' | 'changes' | 'leave'>('');
const targetBrowser = ref<{ openPanel: (tab: 'entry' | 'groups' | 'copy' | 'plans' | 'view' | 'selection') => void; closePanel: () => void; revealEntries: (ids: string[]) => void; toggleSearch: () => void }>();
const sourceBrowser = ref<{ openPanel: (tab: 'entry' | 'groups' | 'copy' | 'plans' | 'view' | 'selection') => void; closePanel: () => void; revealEntries: (ids: string[]) => void; toggleSearch: () => void }>();
const activeBrowser = computed(() => wb.copying && mobilePage.value === 'source' ? sourceBrowser.value : targetBrowser.value);
const activePanelOpen = computed(() => wb.copying && mobilePage.value === 'source' ? sourcePanelOpen.value : targetPanelOpen.value);
function headerBack(): void {
  if (mobile.value && activePanelOpen.value) { activeBrowser.value?.closePanel(); return; }
  if (wb.copying) endCopy(); else requestLeave();
}
onMounted(() => { if (wb.initialPanel) targetBrowser.value?.openPanel(wb.initialPanel); wb.initialPanel = ''; });
function focusPane(source: boolean): void { if (mobile.value) return; if (source) targetBrowser.value?.closePanel(); else sourceBrowser.value?.closePanel(); }
watch(mobile, isMobile => {
  if (!wb.copying) return;
  if (isMobile) { if (targetPanelOpen.value) mobilePage.value = 'target'; else if (sourcePanelOpen.value) mobilePage.value = 'source'; }
  else focusPane(mobilePage.value === 'source');
});
const copyOrigin = computed(() => wb.copying ? wb.sourceName : wb.targetName);
const destinationSearch = ref('');
const planName = ref('');
const planScope = ref('all');
const lastInsertion = ref<{ name: string; ids: string[] } | null>(null);
const names = computed(() => wb.names.map(name => ({ value: name, label: name })));
const destinations = computed(() => wb.names.filter(name => name !== copyOrigin.value && name.toLocaleLowerCase().includes(destinationSearch.value.toLocaleLowerCase())));
const plans = computed(() => (wb.target?.config.plans ?? []).map(p => ({ value: p.id, label: p.name })));
const activePlan = computed(() => {
  if (!wb.target) return undefined;
  return wb.target.config.plans.find(p => p.id === wb.target.activePlan);
});
const sourceExpansion = computed(() => wb.source ? expandDocument(wb.source.document, wb.context) : null);
const warnings = computed(() => sourceExpansion.value && wb.targetExpansion && wb.source ? copyDiagnostics(sourceExpansion.value, wb.targetExpansion, wb.source.selected) : []);
const dirtyNames = computed(() => Object.keys(wb.drafts).filter(name => draftDirty(wb.drafts[name])));
const menu = computed(() => [
  { value: 'changes', label: '查看未保存修改…' },
  ...dirtyNames.value.filter(name => name !== wb.targetName && (!wb.copying || name !== wb.sourceName)).map(name => ({ value: `draft:${name}`, label: `继续编辑：${name}` })),
  { value: 'reload', label: wb.copying ? `撤销「${wb.targetName}」全部未保存修改…` : '撤销全部未保存修改…' },
]);
function run(action: () => void): void { try { wb.error = ''; wb.notice = ''; action(); } catch (e) { wb.error = e instanceof Error ? e.message : String(e); } }
function toggle(id: string, enabled: boolean): void { run(() => { if (wb.target) toggleDraftEntry(wb.target.document, wb.target.config, id, enabled); }); }
function edit(id: string, name: string, content: string): void {
  run(() => { const p = wb.target?.document.prompts?.find(p => p.identifier === id); if (p) { p.name = name; p.content = content; } });
}
function selectPlan(id: string): void {
  if (!wb.target) return;
  wb.target.activePlan = id;
  const p = wb.target.config.plans.find(p => p.id === id);
  if (p) { applyPlan(wb.target.document, p.selections); if (mobile.value) targetBrowser.value?.closePanel(); }
}
function openPlanDialog(): void { if (!wb.copying && !wb.busy) { wb.error = ''; planName.value = ''; planScope.value = 'all'; dialog.value = 'plan'; } }
async function createPlan(): Promise<void> {
  if (!wb.target || wb.busy || wb.copying) return;
  const name = planName.value.trim();
  if (!name) { wb.error = '请输入方案名称。'; return; }
  const selections = capturePlan(wb.target.document, planScope.value === 'partial' ? wb.target.selected : undefined);
  if (!Object.keys(selections).length) { wb.error = '请选择至少一个条目，再保存开关方案。'; return; }
  await flushAutosave();
  if (await wb.savePlan({ id: crypto.randomUUID(), name, scope: planScope.value as 'all' | 'partial', selections })) {
    dialog.value = ''; planName.value = ''; await consoleStore.load();
  }
}
async function deletePlan(id: string): Promise<void> { await flushAutosave(); if (await wb.deletePlan(id)) await consoleStore.load(); }
function chooseDocument(name: string): void { const previous = wb.targetName; wb.chooseTarget(name); if (wb.targetName !== previous) { targetBrowser.value?.closePanel(); targetPanelOpen.value = false; } lastInsertion.value = null; }
function startCopy(): void {
  wb.notice = '';
  destinationSearch.value = ''; mobilePage.value = 'target'; targetBrowser.value?.openPanel('copy');
}
function chooseDestination(name: string): void {
  sourceBrowser.value?.closePanel(); targetBrowser.value?.closePanel();
  wb.chooseSource(copyOrigin.value);
  if (wb.sourceName !== copyOrigin.value || !wb.source) return;
  wb.chooseTarget(name);
  if (wb.targetName !== name) return;
  wb.copying = true; targetPanelOpen.value = false; sourcePanelOpen.value = false; mobilePage.value = 'source'; insertionPoint.value = null; targetBrowser.value?.closePanel(); lastInsertion.value = null; dialog.value = ''; wb.notice = '';
}
function endCopy(): void {
  sourceBrowser.value?.closePanel(); targetBrowser.value?.closePanel();
  sourcePanelOpen.value = false; targetPanelOpen.value = false;
  const source = wb.sourceName;
  wb.copying = false; wb.chooseTarget(source); insertionPoint.value = null; lastInsertion.value = null;
}
function insertAt(anchor: string | null, side: 'before' | 'after', draggedIds?: string[]): void {
  run(() => {
    if (!wb.source || !wb.target || !wb.copying) return;
    if (wb.sourceName === wb.targetName) throw new Error('来源和目标预设不能相同。');
    const selected = draggedIds ?? wb.source.selected;
    const ids = copyEntries(wb.source.document, wb.target.document, selected, { anchor, side }, () => crypto.randomUUID());
    wb.target.selected = ids;
    wb.notice = `已复制 ${ids.length} 个条目到「${wb.targetName}」。点击「${mobile.value ? '保存目标' : `保存 ${wb.targetName}`}」后生效。`;
    lastInsertion.value = { name: wb.targetName, ids };
    insertionPoint.value = null;
    if (mobile.value) void nextTick(() => targetBrowser.value?.revealEntries(ids));
  });
}
function confirmMobilePaste(): void {
  if (!insertionPoint.value) return;
  insertAt(insertionPoint.value.anchor, insertionPoint.value.side);
}
function reviewSelection(): void { mobilePage.value = 'source'; sourceBrowser.value?.openPanel('selection'); }
function undoPaste(): void {
  if (!wb.target || lastInsertion.value?.name !== wb.targetName) return;
  removeCopiedEntries(wb.target.document, wb.target.config, lastInsertion.value.ids);
  wb.target.selected = wb.target.selected.filter(id => !lastInsertion.value!.ids.includes(id));
  lastInsertion.value = null; wb.notice = '已撤销这次粘贴，其他修改保留。';
}
async function save(): Promise<void> {
  await flushAutosave();
  if (await wb.save()) { insertionPoint.value = null; lastInsertion.value = null; if (dialog.value === 'changes') dialog.value = ''; await consoleStore.load(); }
}
function requestLeave(): void {
  if (dirtyNames.value.length) dialog.value = 'leave';
  else { wb.open = false; wb.invalidateClean(); }
}
function discardAll(): void { wb.drafts = {}; wb.open = false; dialog.value = ''; }
async function saveAndLeave(): Promise<void> {
  for (const name of [...dirtyNames.value]) { wb.chooseTarget(name); await flushAutosave(); if (!await wb.save()) return; }
  dialog.value = ''; wb.open = false; wb.invalidateClean(); await consoleStore.load();
}
function action(value: string): void {
  if (value === 'reload') { if (window.confirm(`撤销「${wb.targetName}」的全部未保存修改？正文、条目开关、分组和新复制的条目将恢复到最近保存的状态。已保存的方案会保留。${wb.copying ? `来源预设「${wb.sourceName}」不会改变。` : ''}`)) { wb.discard(); if (!wb.error) { lastInsertion.value = null; wb.notice = ''; } } }
  else if (value.startsWith('draft:')) { wb.copying = false; chooseDocument(value.slice(6)); }
  else dialog.value = value as typeof dialog.value;
}
</script>

<template>
  <div class="pet-workbench" :class="{ 'pet-workbench--mobile': mobile }">
    <header class="pet-workbench__bar">
      <IconButton name="arrow-left" :title="mobile && activePanelOpen ? '返回正文' : wb.copying ? `返回 ${wb.sourceName}` : '返回快速面板'" :disabled="wb.busy" @click="headerBack" />
      <strong v-if="wb.copying" class="pet-workbench__title">{{ wb.sourceName }} <span>→</span> {{ wb.targetName }}</strong>
      <Dropdown v-else class="pet-workbench__preset" :model-value="wb.targetName" :options="names" variant="inline" title="当前预设" :disabled="wb.busy" @update:model-value="chooseDocument" />
      <Dropdown v-if="!mobile && !wb.copying && plans.length" :model-value="activePlan?.id || ''" :options="plans" variant="inline" placeholder="方案" title="使用方案" :disabled="wb.busy" @update:model-value="selectPlan" />
      <span class="pet-workbench__space" />
      <div class="pet-workbench__commands" role="group" aria-label="文档操作">
      <Dropdown model-value="" :options="menu" variant="icon" trigger-icon="more" align="right" title="更多操作" :disabled="wb.busy" @update:model-value="action" />
      <Button v-if="!mobile" size="sm" variant="primary" icon="copy" :disabled="wb.busy" @click="startCopy">{{ wb.copying ? '更换目标预设' : '跨预设复制' }}</Button>
      <Button v-if="!mobile" size="sm" variant="primary" :disabled="wb.busy || wb.target?.corrupt || !wb.target || !draftDirty(wb.target)" @click="save">{{ wb.busy ? '保存中…' : wb.copying ? `保存 ${wb.targetName}` : '保存' }}</Button>
      </div>
      <div class="pet-workbench__utilities" role="group" aria-label="窗口操作">
      <IconButton :name="ui.theme === 'dark' ? 'sun' : 'moon'" :title="ui.theme === 'dark' ? '亮色' : '暗色'" @click="ui.toggleTheme()" />
      <IconButton name="close" title="收起" @click="ui.open = false" />
      </div>
    </header>
    <nav v-if="mobile && wb.copying && !activePanelOpen" class="pet-workbench__carousel" aria-label="复制预设翻页">
      <IconButton name="chevron-left" title="查看来源预设" :disabled="mobilePage === 'source'" @click="mobilePage = 'source'" />
      <div><strong>{{ mobilePage === 'source' ? `来源 · ${wb.sourceName}` : `目标 · ${wb.targetName}` }}</strong><Button size="sm" variant="text" :disabled="!wb.source?.selected.length" @click="reviewSelection">已选 {{ wb.source?.selected.length || 0 }} 项 · 查看</Button></div>
      <IconButton name="search" title="查找当前预设" @click="activeBrowser?.toggleSearch()" />
      <IconButton name="chevron-right" title="查看目标预设" :disabled="mobilePage === 'target'" @click="mobilePage = 'target'" />
    </nav>
    <div v-if="(wb.error && !dialog) || wb.notice" :role="wb.error ? 'alert' : 'status'" class="pet-workbench__notice" :class="{ 'pet-workbench__notice--error': wb.error }"><span>{{ wb.error || wb.notice }}</span><Button v-if="!wb.error && lastInsertion?.name === wb.targetName" size="sm" variant="ghost" @click="undoPaste">撤销这次粘贴</Button><IconButton name="close" title="关闭提示" @click="wb.notice = ''; wb.error = ''" /></div>
    <fieldset v-if="wb.target" :disabled="wb.busy" class="pet-workbench__panes" :class="{ 'pet-workbench__panes--copy': wb.copying }">
      <TextBrowser v-show="!mobile || mobilePage === 'source'" v-if="wb.copying && wb.source" :key="`source:${wb.sourceName}`" ref="sourceBrowser" class="pet-workbench__source" :document="wb.source.document" :config="wb.source.config" :context="wb.context" :selected="wb.source.selected" :dirty="draftDirty(wb.source)" :copy-warnings="warnings" @panel-state="sourcePanelOpen = $event" @panel-open="focusPane(true)" readonly copying :label="`来源 · ${wb.sourceName}`" @selection="wb.source.selected = $event">
        <template #groups="{ inspect }"><GroupTreeEditor :document="wb.source.document" :config="wb.source.config" :selected="wb.source.selected" readonly @inspect="inspect" /></template>
        <template #mobile-actions><Button size="sm" :disabled="!wb.source.selected.length" @click="mobilePage = 'target'">前往目标 · {{ wb.source.selected.length }} 项</Button></template>
      </TextBrowser>
      <TextBrowser v-show="!mobile || !wb.copying || mobilePage === 'target'" :busy="wb.busy || wb.target.corrupt" ref="targetBrowser" :key="`target:${wb.targetName}`" :document="wb.target.document" :config="wb.target.config" :context="wb.context" :selected="wb.target.selected" :dirty="draftDirty(wb.target)" :insertion="wb.copying" :copying="wb.copying" :paste-count="wb.copying ? wb.source?.selected.length || 0 : 0" :label="wb.copying ? `目标 · ${wb.targetName}` : '预设文本'" @selection="wb.target.selected = $event" @toggle="toggle" @edit="edit" @paste="insertAt" @insertion-point="insertionPoint = $event" @panel-state="targetPanelOpen = $event" @panel-open="focusPane(false)">
        <template #mobile-actions>
          <Button v-if="wb.copying && insertionPoint" size="sm" :disabled="wb.busy || !wb.source?.selected.length" @click="confirmMobilePaste">粘贴 {{ wb.source?.selected.length || 0 }} 项</Button>
          <template v-else><Button size="sm" variant="secondary" :disabled="wb.busy" @click="startCopy">{{ wb.copying ? '换目标' : '复制到…' }}</Button><Button size="sm" :disabled="wb.busy || wb.target.corrupt || !draftDirty(wb.target)" :title="`保存 ${wb.targetName}`" @click="save">{{ wb.busy ? '保存中…' : wb.copying ? '保存目标' : '保存' }}</Button></template>
        </template>
        <template #groups="{ inspect }"><GroupTreeEditor :document="wb.target.document" :config="wb.target.config" :selected="wb.target.selected" @inspect="inspect" /></template>
        <template v-if="!wb.copying" #plans><PlanManager @save="openPlanDialog" :document="wb.target.document" :config="wb.target.config" :context="wb.context" :active-id="wb.target.activePlan" :busy="wb.busy || wb.target.corrupt" @apply="selectPlan" @delete="deletePlan" /></template>
        <template #copy>
          <strong>复制到另一个预设</strong>
          <p class="pet-workbench__hint">{{ mobile ? `从「${copyOrigin}」复制。选择目标预设后，勾选来源条目，前往目标正文选择粘贴位置。` : `从「${copyOrigin}」复制。选择目标预设后，在左侧勾选条目，再拖到右侧或点击两段之间粘贴。` }}</p>
          <SearchField v-model="destinationSearch" placeholder="查找目标预设…" />
          <div class="pet-workbench__destinations"><div v-for="name in destinations" :key="name" class="pet-workbench__destination"><div><strong>{{ name }}</strong><span v-if="wb.drafts[name] && draftDirty(wb.drafts[name])" class="pet-workbench__hint"> · 有未保存修改</span></div><Button size="sm" variant="secondary" :aria-label="`打开目标 ${name}`" @click="chooseDestination(name)">选为目标</Button></div><p v-if="!destinations.length" class="pet-workbench__hint">没有找到其他预设。</p></div>
        </template>
      </TextBrowser>
    </fieldset>
    <div v-if="dialog" class="pet-workbench__scrim" @keydown.esc="dialog = ''">
      <section class="pet-workbench__dialog" role="dialog" aria-modal="true" :aria-label="({ plan: '另存开关方案', changes: '查看未保存修改', leave: '返回前保存修改吗？' })[dialog]">
        <header class="pet-workbench__dialog-head"><strong>{{ ({ plan: '另存开关方案', changes: '未保存修改', leave: '返回前保存修改吗？' })[dialog] }}</strong><IconButton name="close" title="关闭对话框" :disabled="wb.busy" @click="dialog = ''" /></header>
        <template v-if="dialog === 'plan'">
          <p class="pet-workbench__hint">将当前开启／关闭组合保存到「{{ wb.targetName }}」，保存后可在快速面板使用。不会一并保存尚未确认的文本、分组或复制修改。</p>
          <TextField v-model="planName" autofocus placeholder="例如：日常聊天" :disabled="wb.busy" aria-label="方案名称" @keydown.enter="createPlan" />
          <label><input v-model="planScope" type="radio" value="all" :disabled="wb.busy" />保存全部条目的开关状态（含关闭项）</label>
          <label><input v-model="planScope" type="radio" value="partial" :disabled="wb.busy || !wb.target?.selected.length" />只保存选中的 {{ wb.target?.selected.length || 0 }} 个条目的开关</label>
          <Button size="sm" :disabled="wb.busy || !planName.trim()" @click="createPlan">{{ wb.busy ? '保存中…' : '保存方案' }}</Button>
        </template>
        <template v-else-if="dialog === 'changes'"><p v-if="!wb.changes.length" class="pet-workbench__hint">没有未保存的修改。</p><ul><li v-for="(change, index) in wb.changes" :key="index">{{ change }}</li></ul><Button size="sm" :variant="wb.target && draftDirty(wb.target) ? 'primary' : 'text'" :disabled="wb.busy || wb.target?.corrupt" @click="save">保存</Button></template>
        <template v-else-if="dialog === 'leave'"><p>以下预设有未保存修改：{{ dirtyNames.join('、') }}。已保存的方案不会被撤销。</p><div class="pet-workbench__dialog-actions"><Button size="sm" variant="ghost" :disabled="wb.busy" @click="dialog = ''">继续编辑</Button><Button size="sm" variant="ghost" :disabled="wb.busy" @click="discardAll">全部撤销并返回</Button><Button size="sm" :disabled="wb.busy" @click="saveAndLeave">全部保存并返回</Button></div></template>
        <p v-if="wb.error" role="alert" class="pet-workbench__error">{{ wb.error }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.pet-workbench{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;position:relative}
.pet-workbench__bar{display:flex;align-items:center;gap:var(--pet-space-md);padding:var(--pet-space-sm) var(--pet-space-lg);border-bottom:1px solid var(--pet-color-border);flex:none;position:relative;z-index:20}
.pet-workbench__bar :deep(.pet-dd){max-width:300px}.pet-workbench__bar :deep(.pet-dd--inline){min-width:0}
.pet-workbench__commands,.pet-workbench__utilities{display:flex;align-items:center;gap:var(--pet-space-sm);flex:none}.pet-workbench__utilities{border-left:1px solid var(--pet-color-border);padding-left:var(--pet-space-sm)}
.pet-workbench__commands :deep(.pet-dd__menu){min-width:180px}.pet-workbench__commands :deep(.pet-dd__option-label){white-space:normal;overflow-wrap:anywhere}
.pet-workbench__commands :deep(.pet-dd__option){white-space:normal;overflow-wrap:anywhere}
.pet-workbench__space{flex:1}.pet-workbench__title{font-size:var(--pet-font-size-sm);font-weight:var(--pet-font-weight-medium);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pet-workbench__title span{color:var(--pet-color-text-faint);margin:0 var(--pet-space-sm)}
.pet-workbench__hint{color:var(--pet-color-text-muted);font-size:var(--pet-font-size-xs);line-height:var(--pet-font-leading-normal);margin:0}
.pet-workbench__panes{margin:0;padding:0;border:0;display:flex;flex:1;min-width:0;min-height:0;overflow:hidden}
.pet-workbench__carousel{display:flex;align-items:center;gap:var(--pet-space-sm);padding:var(--pet-space-xs) var(--pet-space-sm);border-bottom:1px solid var(--pet-color-border);flex:none}.pet-workbench__carousel>div{display:flex;align-items:center;justify-content:space-between;gap:var(--pet-space-xs);flex:1;min-width:0}.pet-workbench__carousel strong{font-size:var(--pet-font-size-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pet-workbench__carousel :deep(.pet-btn){flex:none}
.pet-workbench__source{border-right:1px solid var(--pet-color-border-strong)}
.pet-workbench__panes--copy :deep(.pet-document__scroll){padding:var(--pet-space-lg)}
.pet-workbench__panes--copy :deep(.pet-document__paper){padding:32px 28px 64px}
.pet-workbench__panes--copy :deep(.pet-document__inspector){width:300px}
.pet-workbench__panes--copy :deep(.pet-document__status){flex-wrap:wrap}
.pet-workbench__notice{position:absolute;bottom:48px;right:24px;z-index:60;max-width:min(520px,calc(100% - 48px));display:flex;align-items:center;gap:var(--pet-space-sm);padding:var(--pet-space-sm) var(--pet-space-md);font-size:var(--pet-font-size-sm);background:var(--pet-color-surface);border:1px solid var(--pet-color-border-strong);border-radius:var(--pet-radius-md);box-shadow:var(--pet-effect-shadow-lg)}
.pet-workbench__notice span{flex:1;overflow-wrap:anywhere}.pet-workbench__notice--error,.pet-workbench__error{color:var(--pet-color-danger)}.pet-workbench__error{margin:0;font-size:var(--pet-font-size-sm);overflow-wrap:anywhere}
.pet-workbench__scrim{position:absolute;inset:0;background:var(--pet-color-overlay);z-index:100;display:flex;align-items:center;justify-content:center;padding:var(--pet-space-xl)}
.pet-workbench__dialog{width:min(480px,90%);max-height:85%;overflow:auto;display:flex;flex-direction:column;gap:var(--pet-space-lg);background:var(--pet-color-surface);border:1px solid var(--pet-color-border-strong);border-radius:var(--pet-radius-lg);padding:var(--pet-space-xl);box-shadow:var(--pet-effect-shadow-lg)}
.pet-workbench__dialog :deep(.pet-search){flex:none;width:100%}.pet-workbench__dialog-head{display:flex;align-items:center;justify-content:space-between;gap:var(--pet-space-md)}
.pet-workbench__dialog-actions{display:flex;gap:var(--pet-space-sm);justify-content:flex-end}
.pet-workbench :deep(.pet-document__inspector .pet-search){flex:none;width:100%;height:32px}
.pet-workbench__destinations{display:flex;flex-direction:column;gap:var(--pet-space-xs);flex:1;min-height:0;overflow:auto}.pet-workbench__destination{display:flex;align-items:center;justify-content:space-between;gap:var(--pet-space-md);padding:var(--pet-space-sm) 0;border-bottom:1px solid var(--pet-color-border)}.pet-workbench__destination{flex:none}.pet-workbench__destination>div{min-width:0;overflow-wrap:anywhere}.pet-workbench__destination strong{font-size:var(--pet-font-size-sm);font-weight:var(--pet-font-weight-medium)}
.pet-workbench__group{display:flex;flex-direction:column;gap:var(--pet-space-sm);padding:var(--pet-space-md) 0;border-bottom:1px solid var(--pet-color-border)}
@media(max-width:767px), (max-width:1023px) and (pointer:coarse){
.pet-workbench__bar{gap:var(--pet-space-xs);padding:var(--pet-space-xs) var(--pet-space-sm)}.pet-workbench__bar :deep(.pet-dd__option){min-height:40px}.pet-workbench__bar :deep(.pet-dd__option-label){white-space:normal;line-height:1.5}.pet-workbench__preset{flex:1;min-width:0;max-width:none!important}.pet-workbench__bar :deep(.pet-ico),.pet-workbench__bar :deep(.pet-dd--icon .pet-dd__button),.pet-workbench__carousel :deep(.pet-ico){width:40px;height:40px}.pet-workbench__space{display:none}.pet-workbench__commands,.pet-workbench__utilities{gap:0}.pet-workbench__utilities{padding-left:0;border-left:0}.pet-workbench__title{flex:1}.pet-workbench__panes{display:block;position:relative}.pet-workbench__panes>.pet-document{height:100%;width:100%;border:0}.pet-workbench__panes--copy :deep(.pet-document__paper){padding:20px 14px 40px}.pet-workbench__panes--copy :deep(.pet-document__scroll){padding:0}.pet-workbench__panes--copy :deep(.pet-document__inspector){width:100%}.pet-workbench__notice{bottom:76px;left:12px;right:12px;max-width:none;font-size:var(--pet-font-size-xs);flex-wrap:wrap}.pet-workbench__notice span{min-width:180px}.pet-workbench__scrim{padding:12px}.pet-workbench__dialog{width:100%;max-height:100%;padding:var(--pet-space-lg)}.pet-workbench__dialog-actions{flex-wrap:wrap}.pet-workbench__dialog :deep(input[type=text]){font-size:16px}
}
</style>
