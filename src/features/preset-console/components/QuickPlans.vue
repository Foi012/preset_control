<script setup lang="ts">
import { computed, ref } from 'vue';
import { flushAutosave, useConsoleStore } from '../store';
import { migratePlans } from '../workbench-model';
import { useWorkbenchStore } from '../workbench-store';
import Dropdown from '@/ui/Dropdown.vue';
const store = useConsoleStore();
const selected = ref('');
const plans = computed(() => {
  const config = JSON.parse(JSON.stringify(store.config));
  migratePlans(config);
  return config.plans as typeof store.config.plans;
});
const options = computed(() => [{ value: '', label: '选择方案' }, ...plans.value.map(p => ({ value: p.id, label: p.name })), { value: '__pet_workbench__', label: '打开文本工作台…' }]);
const active = computed(() => {
  const explicit = plans.value.find(p => p.id === selected.value);
  if (explicit) return explicit;
  const states = new Map(store.view.allEntries.map(e => [e.id, e.enabled]));
  return plans.value.filter(p => Object.keys(p.selections).length && Object.entries(p.selections).every(([id, on]) => states.get(id) === on))
    .sort((a, b) => Object.keys(b.selections).length - Object.keys(a.selections).length)[0];
});
const modified = computed(() => {
  if (!active.value) return false;
  const states = new Map(store.view.allEntries.map(e => [e.id, e.enabled]));
  return Object.entries(active.value.selections).some(([id, on]) => states.get(id) !== on);
});
async function apply(id: string): Promise<void> {
  if (id === '__pet_workbench__') { await flushAutosave(); const wb = useWorkbenchStore(); wb.invalidateClean(); wb.enter('plans'); return; }
  const plan = plans.value.find(p => p.id === id);
  if (!plan) { selected.value = ''; return; }
  await store.applyPlanSelections(plan.selections);
  selected.value = id;
}
</script>
<template>
  <div class="pet-plans">
    <span>方案</span>
    <Dropdown :model-value="active?.id || ''" :options="options" @update:model-value="apply" />
    <span v-if="modified" class="pet-plans__modified">开关已调整</span>
    <span v-if="!plans.length" class="pet-plans__hint">在文本工作台的「方案」侧栏保存开关组合</span>
  </div>
</template>
<style scoped>
.pet-plans{display:flex;flex-wrap:wrap;align-items:center;gap:var(--pet-space-sm);padding:var(--pet-space-sm) var(--pet-space-md);border-bottom:1px solid var(--pet-color-border);font-size:var(--pet-font-size-xs);position:relative;z-index:25}
.pet-plans :deep(.pet-dd){flex:1;min-width:0}.pet-plans__hint,.pet-plans__modified{color:var(--pet-color-text-muted)}
</style>
