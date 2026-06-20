<script setup lang="ts">
/**
 * Toolbox launcher — the panel's home screen. Picks which tool fills the panel.
 * Each card calls `ui.setActiveTool`, which also persists the choice so a refresh
 * reopens the last-used tool.
 */
import { useUiStore, type ToolId } from '../store';
import PetIcon, { type IconName } from '@/ui/PetIcon.vue';

const ui = useUiStore();

type ToolCard = { id: ToolId; icon: IconName; title: string; desc: string };
const TOOLS: ToolCard[] = [
  { id: 'preset', icon: 'sliders', title: '预设控制台', desc: '切换与编排预设条目' },
  { id: 'export', icon: 'download', title: '聊天导出 · EPUB', desc: '把聊天记录导出为电子书' },
];
</script>

<template>
  <div class="pet-home">
    <ul class="pet-home__grid">
      <li v-for="tool in TOOLS" :key="tool.id">
        <button type="button" class="pet-home__card" @click="ui.setActiveTool(tool.id)">
          <span class="pet-home__icon"><PetIcon :name="tool.icon" /></span>
          <span class="pet-home__text">
            <span class="pet-home__title">{{ tool.title }}</span>
            <span class="pet-home__desc">{{ tool.desc }}</span>
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.pet-home {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--pet-space-md);
}
.pet-home__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-sm);
}
.pet-home__card {
  display: flex;
  align-items: center;
  gap: var(--pet-space-md);
  width: 100%;
  padding: var(--pet-space-md);
  text-align: left;
  color: var(--pet-color-text);
  background: var(--pet-color-surface-raised);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-lg);
  cursor: pointer;
  transition:
    border-color var(--pet-motion-fast) var(--pet-motion-ease),
    background var(--pet-motion-fast) var(--pet-motion-ease);
}
.pet-home__card:hover {
  border-color: var(--pet-color-accent);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 90%);
}
.pet-home__icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: none;
  color: var(--pet-color-accent-text);
  background: var(--pet-color-accent);
  border-radius: var(--pet-radius-md);
}
.pet-home__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.pet-home__title {
  font-size: var(--pet-font-size-sm);
  font-weight: var(--pet-font-weight-semibold);
}
.pet-home__desc {
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-muted);
}
</style>
