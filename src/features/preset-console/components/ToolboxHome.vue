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
  { id: 'connection', icon: 'power', title: '连接档案', desc: '一键切换端点 · 模型 · 预设' },
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
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--pet-space-xs);
}
.pet-home__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
}
.pet-home__card {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  width: 100%;
  padding: var(--pet-space-xs);
  text-align: left;
  color: var(--pet-color-text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--pet-radius-sm);
  cursor: pointer;
  transition:
    border-color var(--pet-motion-fast) var(--pet-motion-ease),
    background var(--pet-motion-fast) var(--pet-motion-ease);
}
.pet-home__card:hover {
  border-color: var(--pet-color-accent);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 92%);
}
.pet-home__icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: none;
  color: var(--pet-color-accent);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 88%);
  border-radius: var(--pet-radius-sm);
}
.pet-home__icon :deep(.pet-icon) {
  width: 16px;
  height: 16px;
}
.pet-home__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.pet-home__title {
  font-size: var(--pet-font-size-sm);
  font-weight: var(--pet-font-weight-semibold);
}
.pet-home__desc {
  display: none;
}
</style>
