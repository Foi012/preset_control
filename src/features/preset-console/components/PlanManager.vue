<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Config } from '../config';
import { applyPlan, cloneDocument, type PresetDocument } from '../workbench-model';
import { expandDocument, type ExpansionContext } from '../workbench-preview';
import Button from '@/ui/Button.vue';
import IconButton from '@/ui/IconButton.vue';
import TextPreview from '@/ui/TextPreview.vue';
const props = defineProps<{ document: PresetDocument; config: Config; context: ExpansionContext; activeId: string; busy?: boolean }>();
const emit = defineEmits<{ save: []; apply: [id: string]; delete: [id: string] }>();
const selected = ref(props.activeId || props.config.plans[0]?.id || '');
const confirming = ref('');
watch(() => props.activeId, id => { if (id) selected.value = id; });
watch(() => props.config.plans.map(p => p.id), ids => { if (!ids.includes(selected.value)) selected.value = ids[0] || ''; confirming.value = ''; });
const plan = computed(() => props.config.plans.find(p => p.id === selected.value));
const count = (values: Record<string, boolean>, on: boolean) => Object.values(values).filter(v => v === on).length;
const entries = computed(() => {
  if (!plan.value) return [];
  const document = cloneDocument(props.document);
  applyPlan(document, plan.value.selections);
  const expanded = expandDocument(document, props.context);
  const ids = Object.keys(plan.value.selections);
  const ordered = expanded.entries.filter(e => ids.includes(e.entry.prompt.identifier));
  return [...ordered.map(e => ({ id: e.entry.prompt.identifier, name: e.entry.prompt.name || '未命名条目', enabled: plan.value!.selections[e.entry.prompt.identifier], text: [e.text, ...e.writes.map(w => `${w.key}：${w.step?.after ?? w.value}`)].filter(Boolean).join('\n') || e.entry.prompt.content || '（空条目）', diagnostic: e.diagnostics.join('；') })),
    ...ids.filter(id => !ordered.some(e => e.entry.prompt.identifier === id)).map(id => ({ id, name: '条目已不存在', enabled: plan.value!.selections[id], text: id, diagnostic: '' }))];
});
</script>
<template>
  <div class="pet-plan-manager">
    <div class="pet-plan-manager__toolbar" role="toolbar" aria-label="方案操作">
      <Button size="sm" variant="secondary" :disabled="busy" @click="emit('save')">另存当前开关为方案</Button>
      <span class="pet-plan-manager__spacer" />
      <IconButton name="trash" :title="plan ? `删除方案 ${plan.name}` : '删除方案'" :disabled="busy || !plan" danger @click="confirming = confirming ? '' : plan!.id" />
    </div>
    <div v-if="plan && confirming === plan.id" role="alert" class="pet-plan-manager__confirm"><p>删除方案「{{ plan.name }}」？只删除这套开关记录，条目和当前开关不会改变。</p><div><Button size="sm" variant="secondary" :disabled="busy" @click="emit('delete', plan.id)">删除方案</Button><Button size="sm" variant="text" :disabled="busy" @click="confirming = ''">取消</Button></div></div>
    <p class="pet-plan-manager__hint">方案只记录条目的开启／关闭组合。</p>
    <div v-if="config.plans.length" class="pet-plan-manager__list" aria-label="已保存方案">
      <button v-for="item in config.plans" :key="item.id" type="button" class="pet-plan-manager__row" :aria-pressed="selected === item.id" :disabled="busy" @click="selected = item.id; confirming = ''"><strong>{{ item.name }}</strong><span>开启 {{ count(item.selections, true) }} · 关闭 {{ count(item.selections, false) }}</span></button>
    </div>
    <p v-else class="pet-plan-manager__hint">还没有方案。调整条目开关后，点击上方「另存当前开关为方案」保存组合。</p>
    <template v-if="plan">
      <header class="pet-plan-manager__heading"><strong>{{ plan.name }}</strong></header>
      <p class="pet-plan-manager__hint">以下是这个方案记录的条目。没有列出的条目保持当前开关；文本取自当前预设，方案不保存正文。</p>
      <Button size="sm" variant="secondary" :disabled="busy" @click="emit('apply', plan.id)">在正文预览此方案</Button>
      <p class="pet-plan-manager__hint">预览会调整工作台的开关，保留正文修改；点击「保存」后才会用于实际发送。</p>
      <article v-for="entry in entries" :key="entry.id" class="pet-plan-manager__entry"><header><strong>{{ entry.name }}</strong><span>{{ entry.enabled ? '开启' : '关闭' }}</span></header><TextPreview :text="entry.text" /><p v-if="entry.diagnostic" class="pet-plan-manager__hint">{{ entry.diagnostic }}</p></article>
    </template>
  </div>
</template>
<style scoped>
.pet-plan-manager__toolbar{display:flex;align-items:center;gap:var(--pet-space-sm)}.pet-plan-manager__spacer{flex:1}
.pet-plan-manager{display:flex;flex-direction:column;gap:var(--pet-space-md);min-width:0}.pet-plan-manager__hint{margin:0;color:var(--pet-color-text-muted);font-size:var(--pet-font-size-xs);line-height:1.6}.pet-plan-manager__list{display:flex;flex-direction:column;gap:var(--pet-space-xs)}.pet-plan-manager__row{font:inherit;text-align:left;display:flex;flex-direction:column;gap:4px;padding:var(--pet-space-sm) var(--pet-space-md);color:var(--pet-color-text);background:transparent;border:1px solid var(--pet-color-border);border-radius:var(--pet-radius-sm);cursor:pointer}.pet-plan-manager__row[aria-pressed=true]{background:var(--pet-color-surface-raised);border-color:var(--pet-color-accent)}.pet-plan-manager__row span,.pet-plan-manager__entry header span{font-size:var(--pet-font-size-xs);color:var(--pet-color-text-muted)}.pet-plan-manager__heading,.pet-plan-manager__entry header{display:flex;align-items:center;justify-content:space-between;gap:var(--pet-space-sm)}.pet-plan-manager__heading strong,.pet-plan-manager__entry strong{overflow-wrap:anywhere;font-size:var(--pet-font-size-sm)}.pet-plan-manager__entry{border-top:1px solid var(--pet-color-border);padding-top:var(--pet-space-md)}.pet-plan-manager__confirm{padding:var(--pet-space-md);background:var(--pet-color-surface-raised);border:1px solid var(--pet-color-border);border-radius:var(--pet-radius-sm);font-size:var(--pet-font-size-sm)}.pet-plan-manager__confirm p{margin:0 0 var(--pet-space-sm)}.pet-plan-manager__confirm>div{display:flex;gap:var(--pet-space-sm)}
</style>
