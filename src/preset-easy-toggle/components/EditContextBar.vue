<script setup lang="ts">
/**
 * Edit context chooser: one strip of chips — 结构 (global group structure) + each
 * mode + ＋. Selecting a chip sets `ui.editContextId` (null = 结构), contextualizing
 * the single edit surface below. Replaces the old 分组/模式 segmented + ModeConfig
 * subnav, and mirrors the in-use ModeBar so both pages feel like one app.
 */
import { computed } from 'vue';
import { useConsoleStore, useUiStore } from '../store';
import ChipButton from './ChipButton.vue';
import PetIcon from './PetIcon.vue';

const store = useConsoleStore();
const ui = useUiStore();

const modes = computed(() => store.config.scenarios);

function createMode(): void {
  const name = `模式${modes.value.length + 1}`;
  store.saveScenario(name, []);
  ui.editContextId = modes.value[modes.value.length - 1]?.id ?? null;
}
</script>

<template>
  <div class="pet-ctx">
    <span class="pet-ctx__label">编辑</span>
    <div class="pet-ctx__chips">
      <ChipButton :active="!ui.editContextId" title="结构" @click="ui.editContextId = null">
        结构
      </ChipButton>
      <ChipButton
        v-for="m in modes"
        :key="m.id"
        :active="ui.editContextId === m.id"
        :title="m.name"
        @click="ui.editContextId = m.id"
      >
        {{ m.name }}
      </ChipButton>
      <ChipButton icon title="新建模式" @click="createMode"><PetIcon name="add" /></ChipButton>
    </div>
  </div>
</template>

<style scoped>
.pet-ctx {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  min-width: 0;
}
.pet-ctx__label {
  flex: none;
  font-size: var(--pet-font-size-xs);
  font-weight: var(--pet-font-weight-semibold);
  color: var(--pet-color-text-faint);
}
.pet-ctx__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pet-space-xs);
  flex: 1;
  min-width: 0;
}
</style>
