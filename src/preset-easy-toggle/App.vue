<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from './store';
import ChatExport from '../chat-export/ChatExport.vue';
import IconButton from '@/ui/IconButton.vue';
import PresetConsole from './components/PresetConsole.vue';
import ToolboxHome from './components/ToolboxHome.vue';
import Trigger from './components/Trigger.vue';

const ui = useUiStore();

const TOOL_TITLE: Record<string, string> = {
  home: '工具箱',
  preset: '预设控制台',
  export: '聊天导出',
};
const title = computed(() => TOOL_TITLE[ui.activeTool] ?? '工具箱');

function emitDragEvent(name: string, event: PointerEvent): void {
  window.dispatchEvent(
    new CustomEvent(name, {
      detail: { clientX: event.clientX, clientY: event.clientY },
    }),
  );
}
</script>

<template>
  <!-- Closed: just the trigger fills the (small) iframe. -->
  <Trigger
    v-if="!ui.open"
    @open="ui.open = true"
    @drag-start="emitDragEvent('pet-trigger-drag-start', $event)"
    @drag-move="emitDragEvent('pet-trigger-drag-move', $event)"
    @drag-end="emitDragEvent('pet-trigger-drag-end', $event)"
  />

  <!-- Open: the toolbox shell — header + the active tool fills the body. -->
  <section v-else class="pet-panel">
    <header class="pet-panel__bar">
      <IconButton
        v-if="ui.activeTool !== 'home'"
        name="arrow-left"
        title="返回工具箱"
        @click="ui.setActiveTool('home')"
      />
      <span class="pet-panel__title">{{ title }}</span>
      <IconButton
        :name="ui.theme === 'dark' ? 'sun' : 'moon'"
        :title="ui.theme === 'dark' ? '亮色' : '暗色'"
        @click="ui.toggleTheme()"
      />
      <IconButton name="close" title="收起" @click="ui.open = false" />
    </header>

    <ToolboxHome v-if="ui.activeTool === 'home'" />
    <PresetConsole v-else-if="ui.activeTool === 'preset'" />
    <ChatExport v-else-if="ui.activeTool === 'export'" />
  </section>
</template>

<style scoped>
.pet-panel {
  display: flex;
  flex-direction: column;
  position: relative;
  isolation: isolate;
  width: 100%;
  height: 100%;
  font-family: var(--pet-font-sans);
  font-size: var(--pet-font-size-base);
  color: var(--pet-color-text);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--pet-color-accent), transparent 92%), transparent 42%),
    var(--pet-color-surface-glass);
  border: 1px solid var(--pet-color-border-strong);
  border-radius: var(--pet-radius-lg);
  box-shadow: none;
  backdrop-filter: blur(var(--pet-effect-glass-blur)) saturate(1.25);
  overflow: hidden;
  background-clip: padding-box;
}
.pet-panel__bar {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  padding: var(--pet-space-sm) var(--pet-space-md);
  border-bottom: 1px solid var(--pet-color-border);
  background: transparent;
  backdrop-filter: blur(var(--pet-effect-glass-blur));
}
.pet-panel__title {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: var(--pet-font-weight-semibold);
  font-size: var(--pet-font-size-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
