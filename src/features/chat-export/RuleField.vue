<script setup lang="ts">
/**
 * One rule destination — a labelled add-row (TextField + 添加) with its chips listed
 * **below** the input. Used three times on ② 规则 (正文 / 标题 / 排除), so the layout
 * stays identical across destinations. Pure presentation: the parent owns the rule
 * arrays + validation and decides what a "rule" means; this just collects + lists them.
 */
import Button from '@/ui/Button.vue';
import TextField from '@/ui/TextField.vue';
import IconButton from '@/ui/IconButton.vue';

defineProps<{
  /** Inline label before the input (e.g. 正文 / 标题). Omit for a full-width row. */
  label?: string;
  /** The draft text (v-model). */
  modelValue: string;
  /** Committed rules, rendered as removable chips under the input. */
  rules: string[];
  /** Validation message; non-empty marks the draft invalid and disables 添加. */
  error?: string;
  placeholder?: string;
}>();

defineEmits<{
  'update:modelValue': [value: string];
  add: [];
  remove: [index: number];
}>();
</script>

<template>
  <div class="cex-rule">
    <div class="cex-rule__row">
      <span v-if="label" class="cex-rule__label">{{ label }}</span>
      <TextField
        :model-value="modelValue"
        mono
        :invalid="!!error"
        spellcheck="false"
        :placeholder="placeholder"
        @update:model-value="$emit('update:modelValue', String($event))"
        @keyup.enter="$emit('add')"
      />
      <Button variant="secondary" size="sm" :disabled="!modelValue.trim() || !!error" @click="$emit('add')">添加</Button>
    </div>
    <p v-if="error" class="cex-rule__error">正则错误：{{ error }}</p>
    <div v-if="rules.length" class="cex-rule__chips">
      <span v-for="(r, i) in rules" :key="r" class="cex-rule__chip">
        {{ r }}<IconButton name="close" title="移除" danger class="cex-rule__chip-x" @click="$emit('remove', i)" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.cex-rule {
  margin-top: var(--pet-space-sm);
}
.cex-rule__row {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
}
.cex-rule__label {
  flex: none;
  min-width: 2.4em;
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text-muted);
}
.cex-rule__row :deep(.pet-field) {
  flex: 1;
}
.cex-rule__error {
  margin: var(--pet-space-sm) 0 0;
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-accent-text);
  background: var(--pet-color-danger);
  padding: var(--pet-space-sm) var(--pet-space-md);
  border-radius: var(--pet-radius-sm);
}
/* Chips list below the input — committed rules. */
.cex-rule__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--pet-space-sm);
  margin-top: var(--pet-space-sm);
}
.cex-rule__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--pet-space-xs);
  padding: 2px 2px 2px var(--pet-space-sm);
  font-family: var(--pet-font-mono);
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text);
  background: var(--pet-color-surface-raised);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-pill);
}
/* Shrink the shared IconButton to chip scale (default is 24px). */
.cex-rule__chip .cex-rule__chip-x {
  width: 18px;
  height: 18px;
}
</style>
