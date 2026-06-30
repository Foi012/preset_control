<script setup lang="ts">
/**
 * The per-rig overlay editor — capture-from-ST + common sampling params + 附加参数. Used by both
 * a **saved** variant (inline) and the **draft** when adding a new rig (edit-then-add), so the
 * editor lives in one place. Emits intents; the parent owns where the values are stored.
 */
import { paramDef, type ParamId } from './params';
import type { ParamSetting } from './policy';
import type { ExtraParams } from './favorites';
import TextField from '@/ui/TextField.vue';
import Section from '@/ui/Section.vue';
import PetIcon from '@/ui/PetIcon.vue';

const props = defineProps<{ params?: Partial<Record<ParamId, ParamSetting>>; extra?: ExtraParams }>();
const emit = defineEmits<{ param: [ParamId, number | null]; extra: [keyof ExtraParams, string]; capture: [] }>();

const COMMON_PARAMS: ParamId[] = ['temp_openai', 'top_p_openai', 'freq_pen_openai', 'pres_pen_openai', 'openai_max_tokens'];
const commonDefs = COMMON_PARAMS.map(id => paramDef(id)!).filter(Boolean);
const EXTRA_FIELDS: { key: keyof ExtraParams; label: string }[] = [
  { key: 'includeBody', label: '包含主体参数' },
  { key: 'excludeBody', label: '排除主体参数' },
  { key: 'headers', label: '包含请求标头' },
];

function paramValue(id: ParamId): string {
  const v = props.params?.[id]?.value;
  return v === undefined ? '' : String(v);
}
function onParam(id: ParamId, raw: string | number): void {
  const text = String(raw).trim();
  if (text === '') return emit('param', id, null);
  const n = Number(text);
  if (Number.isFinite(n)) emit('param', id, n);
}
const extraValue = (key: keyof ExtraParams): string => props.extra?.[key] ?? '';
</script>

<template>
  <div class="rig">
    <button type="button" class="rig__capture" @click="emit('capture')">
      <PetIcon name="download" />从当前 ST 捕获参数
    </button>
    <label v-for="def in commonDefs" :key="def.id" class="rig__param">
      <span class="rig__label">{{ def.label }}</span>
      <TextField size="sm" lazy :model-value="paramValue(def.id)" placeholder="默认"
        @update:model-value="onParam(def.id, $event)" />
    </label>
    <Section title="附加参数" size="sm" :default-open="false">
      <label v-for="ex in EXTRA_FIELDS" :key="ex.key" class="rig__extra">
        <span class="rig__extralabel">{{ ex.label }}</span>
        <textarea class="pet-field pet-field--sm rig__extrain" rows="2" :value="extraValue(ex.key)"
          @change="emit('extra', ex.key, ($event.target as HTMLTextAreaElement).value)"></textarea>
      </label>
    </Section>
    <p class="rig__hint">留空＝沿用档案默认。切换时写入，补上 ST 切换时不带的采样参数与附加参数。</p>
  </div>
</template>

<style scoped>
.rig {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--pet-space-xs);
  border-radius: var(--pet-radius-sm);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 94%);
  border-left: 2px solid color-mix(in srgb, var(--pet-color-accent), transparent 70%);
}
.rig__capture {
  align-self: flex-end;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-accent);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 88%);
  border: 1px solid color-mix(in srgb, var(--pet-color-accent), transparent 70%);
  border-radius: var(--pet-radius-sm);
  cursor: pointer;
}
.rig__capture :deep(.pet-icon) { width: 13px; height: 13px; }
.rig__param { display: flex; align-items: center; gap: var(--pet-space-xs); }
.rig__label {
  flex: 1;
  min-width: 0;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text);
}
.rig__param :deep(.pet-field) { width: 88px; flex: none; }
/* 附加参数: label above a full-width field that matches the standard sm input. */
.rig__extra {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rig__extra + .rig__extra { margin-top: var(--pet-space-xs); }
.rig__extralabel {
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text);
}
.rig__extrain {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
}
.rig__hint {
  margin: 2px 0 0;
  font-size: var(--pet-font-size-xxs);
  color: var(--pet-color-text-muted);
}
</style>
