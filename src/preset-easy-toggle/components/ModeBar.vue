<script setup lang="ts">
/**
 * In-use mode chooser: pick which mode to operate in. Creating/editing modes lives
 * in edit mode (EditContextBar + ModeArrange). Mode chips scope the page only;
 * snapshots are the explicit ON/OFF state apply action.
 */
import { computed } from 'vue';
import { useConsoleStore, useUiStore } from '../store';
import ChipButton from './ChipButton.vue';

const ui = useUiStore();

const store = useConsoleStore();
const modes = computed(() => store.config.scenarios);
function selectMode(id: string): void {
  ui.activeModeId = id;
  ui.activeSnapshotId = ui.activeSnapshotByMode[id] ?? null;
  // Snapshot names now show inline as chips, so no need to force the management
  // drawer open on every mode switch.
}
</script>

<template>
  <div v-if="modes.length" class="pet-modes">
    <span class="pet-modes__label">模式</span>
    <div class="pet-modes__chips">
      <ChipButton
        :active="!ui.activeModeId"
        title="全部"
        @click="ui.activeModeId = null; ui.activeSnapshotId = null"
      >
        全部
      </ChipButton>
      <ChipButton
        v-for="mode in modes"
        :key="mode.id"
        :active="ui.activeModeId === mode.id"
        :title="mode.name"
        @click="selectMode(mode.id)"
      >
        {{ mode.name }}
      </ChipButton>
    </div>
  </div>
</template>

<style scoped>
.pet-modes {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  /* No padding: aligns the chip strip's left edge with the edit page's EditContextBar
     (pet-ctx, also unpadded) and the search bar below, so switching tabs doesn't jump. */
  min-width: 0;
}
.pet-modes__label {
  flex: none;
  font-size: var(--pet-font-size-xs);
  font-weight: var(--pet-font-weight-semibold);
  color: var(--pet-color-text-faint);
}
.pet-modes__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--pet-space-xs);
  flex: 1;
  min-width: 0;
}
</style>
