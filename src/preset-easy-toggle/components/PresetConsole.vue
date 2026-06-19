<script setup lang="ts">
/**
 * The preset console tool (使用 / 编辑). Extracted verbatim from the old `App.vue`
 * panel body when the panel became a toolbox shell — the shell now owns the title /
 * theme / close / back-to-toolbox controls; this component owns the preset-specific
 * gear menu (导入/导出/同步 config), the tab strip, and the in-use/edit body.
 */
import { ref } from 'vue';
import { useConsoleStore, useUiStore } from '../store';
import Dropdown, { type DropdownOption } from './Dropdown.vue';
import EditView from './EditView.vue';
import InUseView from './InUseView.vue';

const ui = useUiStore();
const consoleStore = useConsoleStore();
const importInput = ref<HTMLInputElement | null>(null);
const MENU_OPTIONS: DropdownOption[] = [
  { value: 'import', label: '导入', icon: 'upload' },
  { value: 'export', label: '导出', icon: 'download' },
  { value: 'sync', label: '同步', icon: 'refresh' },
];

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
  <div class="pet-console">
    <nav class="pet-console__tabs" aria-label="控制台页面">
      <button
        type="button"
        class="pet-console__tab"
        :class="{ 'pet-console__tab--on': ui.mode === 'in-use' }"
        @click="ui.mode = 'in-use'"
      >
        使用
      </button>
      <button
        type="button"
        class="pet-console__tab"
        :class="{ 'pet-console__tab--on': ui.mode === 'edit' }"
        @click="ui.mode = 'edit'"
      >
        编辑
      </button>
      <Dropdown
        class="pet-console__menu"
        model-value=""
        :options="MENU_OPTIONS"
        variant="icon"
        align="right"
        trigger-icon="settings"
        title="更多"
        @update:model-value="runMenuAction"
      />
      <input ref="importInput" class="pet-console__import" type="file" accept="application/json,.json" @change="importConfig" />
    </nav>

    <div class="pet-console__body">
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
  </div>
</template>

<style scoped>
.pet-console {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.pet-console__tabs {
  display: flex;
  align-items: center;
  gap: var(--pet-space-md);
  padding: 0 var(--pet-space-md);
  border-bottom: 1px solid var(--pet-color-border);
  background: transparent;
  /* The gear dropdown overflows below this row; lift the strip so the open menu
     is not covered by the search box / tab content underneath. */
  position: relative;
  z-index: 30;
}
.pet-console__tab {
  position: relative;
  padding: var(--pet-space-sm) 0;
  font-size: var(--pet-font-size-sm);
  font-weight: var(--pet-font-weight-medium);
  color: var(--pet-color-text-muted);
  background: transparent;
  border: 0;
  cursor: pointer;
}
.pet-console__tab:hover {
  color: var(--pet-color-text);
}
.pet-console__tab--on {
  color: var(--pet-color-text);
}
.pet-console__tab--on::after {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  content: '';
  background: var(--pet-color-accent);
  border-radius: var(--pet-radius-pill);
}
.pet-console__menu {
  margin-left: auto;
}
.pet-console__import {
  display: none;
}
.pet-console__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
