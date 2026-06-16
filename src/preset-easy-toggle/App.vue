<script setup lang="ts">
import { ref } from 'vue';
import { useConsoleStore, useUiStore } from './store';
import Dropdown, { type DropdownOption } from './components/Dropdown.vue';
import EditView from './components/EditView.vue';
import IconButton from './components/IconButton.vue';
import InUseView from './components/InUseView.vue';
import Trigger from './components/Trigger.vue';

const ui = useUiStore();
const consoleStore = useConsoleStore();
const importInput = ref<HTMLInputElement | null>(null);
const MENU_OPTIONS: DropdownOption[] = [
  { value: 'import', label: '导入', icon: 'upload' },
  { value: 'export', label: '导出', icon: 'download' },
  { value: 'sync', label: '同步', icon: 'refresh' },
];

function emitDragEvent(name: string, event: PointerEvent): void {
  window.dispatchEvent(
    new CustomEvent(name, {
      detail: { clientX: event.clientX, clientY: event.clientY },
    }),
  );
}

function exportConfig(): void {
  const blob = new Blob([consoleStore.exportConfigJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  link.href = url;
  link.download = `preset-console-config-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importConfig(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    await consoleStore.importConfigJson(await file.text());
  } finally {
    input.value = '';
  }
}

function syncConfig(): void {
  void consoleStore.load();
}

function runMenuAction(action: string): void {
  if (action === 'import') importInput.value?.click();
  else if (action === 'export') exportConfig();
  else if (action === 'sync') syncConfig();
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

  <!-- Open: the console panel. -->
  <section v-else class="pet-panel">
    <header class="pet-panel__bar">
      <span class="pet-panel__title">预设控制台</span>
      <Dropdown
        model-value=""
        :options="MENU_OPTIONS"
        variant="icon"
        align="right"
        trigger-icon="settings"
        title="更多"
        @update:model-value="runMenuAction"
      />
      <IconButton
        :name="ui.theme === 'dark' ? 'sun' : 'moon'"
        :title="ui.theme === 'dark' ? '亮色' : '暗色'"
        @click="ui.toggleTheme()"
      />
      <input ref="importInput" class="pet-panel__import" type="file" accept="application/json,.json" @change="importConfig" />
      <IconButton name="close" title="收起" @click="ui.open = false" />
    </header>
    <nav class="pet-panel__tabs" aria-label="控制台页面">
      <button
        type="button"
        class="pet-panel__tab"
        :class="{ 'pet-panel__tab--on': ui.mode === 'in-use' }"
        @click="ui.mode = 'in-use'"
      >
        使用
      </button>
      <button
        type="button"
        class="pet-panel__tab"
        :class="{ 'pet-panel__tab--on': ui.mode === 'edit' }"
        @click="ui.mode = 'edit'"
      >
        编辑
      </button>
    </nav>

    <div class="pet-panel__body">
      <p v-if="consoleStore.configStatus === 'corrupt'" class="pet-corrupt">
        配置条目损坏且无可用备份，已暂停保存以免覆盖原数据。<br />
        请检查预设中的 <code>[⚙️CONSOLE-CONFIG]</code>，修复后点顶部「同步」。
      </p>
      <p v-if="!consoleStore.view.regionFound" class="pet-empty">
        未找到 <code>⚙️CUSTOMIZATION_START / _END</code> 区域。<br />
        请确认当前预设包含可管理区间。
      </p>
      <InUseView v-else-if="ui.mode === 'in-use'" />
      <EditView v-else />
    </div>
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
.pet-panel__import {
  display: none;
}
.pet-panel__tabs {
  display: flex;
  align-items: center;
  gap: var(--pet-space-md);
  padding: 0 var(--pet-space-md);
  border-bottom: 1px solid var(--pet-color-border);
  background: transparent;
}
.pet-panel__tab {
  position: relative;
  padding: var(--pet-space-sm) 0;
  font-size: var(--pet-font-size-sm);
  font-weight: var(--pet-font-weight-medium);
  color: var(--pet-color-text-muted);
  background: transparent;
  border: 0;
  cursor: pointer;
}
.pet-panel__tab:hover {
  color: var(--pet-color-text);
}
.pet-panel__tab--on {
  color: var(--pet-color-text);
}
.pet-panel__tab--on::after {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  content: '';
  background: var(--pet-color-accent);
  border-radius: var(--pet-radius-pill);
}
.pet-panel__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* The active view (in-use / edit) owns its own scroll container so both tabs
     scroll at the same inset — switching tabs no longer shifts content sideways. */
  overflow: hidden;
  padding: var(--pet-space-md);
}
.pet-corrupt {
  margin: 0;
  padding: var(--pet-space-sm) var(--pet-space-md);
  font-size: var(--pet-font-size-sm);
  line-height: var(--pet-font-leading-normal);
  color: var(--pet-color-accent-text);
  background: var(--pet-color-danger);
  border-bottom: 1px solid var(--pet-color-border-strong);
}
.pet-corrupt code {
  font-family: var(--pet-font-mono);
  font-size: var(--pet-font-size-xs);
}
.pet-empty {
  margin: 0;
  padding: var(--pet-space-lg) var(--pet-space-sm);
  color: var(--pet-color-text-muted);
  font-size: var(--pet-font-size-sm);
  line-height: var(--pet-font-leading-normal);
  text-align: center;
}
.pet-empty code {
  font-family: var(--pet-font-mono);
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text);
}
</style>
