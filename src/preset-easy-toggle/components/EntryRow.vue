<script setup lang="ts">
import { computed } from 'vue';
import { affordanceOf, inputValueOf, useConsoleStore } from '../store';
import type { ResolvedEntry, ResolvedSection } from '../types';
import SelectMark from './SelectMark.vue';

const props = defineProps<{ section: ResolvedSection; entry: ResolvedEntry; readonly?: boolean }>();
const consoleStore = useConsoleStore();

const affordance = computed(() => affordanceOf(props.section, props.entry));

/** Strip the 📍/✍️/（自填） noise from the name for display. */
const label = computed(() => props.entry.name.replace(/📍|✍️|（自填）/gu, '').trim());

function onToggle() {
  if (props.readonly) return;
  consoleStore.toggleEntry(props.section, props.entry);
}

function onInput(event: Event) {
  if (props.readonly) return;
  consoleStore.setInputValue(props.entry, (event.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <!-- Input (✍️): full-width labelled field so the textarea has room to breathe. -->
  <div
    v-if="affordance === 'input'"
    class="pet-tile pet-tile--input"
    :class="{ 'pet-tile--on': entry.enabled, 'pet-tile--ro': readonly }"
  >
    <div class="pet-tile__inputhead">
      <button
        type="button"
        class="pet-tile__toggle"
        :disabled="entry.alwaysOn || readonly"
        :title="entry.alwaysOn ? '常驻开启' : entry.enabled ? '关闭' : '开启'"
        @click="onToggle"
      >
        <SelectMark type="checkbox" :state="entry.enabled ? 'on' : 'off'" />
      </button>
      <span class="pet-tile__label">{{ label }}</span>
      <span class="pet-tile__badge">自填</span>
    </div>
    <textarea
      class="pet-tile__textarea"
      rows="2"
      :value="inputValueOf(entry)"
      placeholder="点此输入…"
      :readonly="readonly"
      @change="onInput"
    />
  </div>

  <!-- Always-on (📍): shown, locked on, non-interactive. -->
  <div v-else-if="affordance === 'locked'" class="pet-tile pet-tile--on pet-tile--locked" :title="`${label}（常驻开启）`">
    <span class="pet-tile__mark pet-tile__mark--lock" />
    <span class="pet-tile__label">{{ label }}</span>
    <span class="pet-tile__pin">常驻</span>
  </div>

  <!-- Plain entries: a big toggle button. The whole tile is the hit target. -->
  <button
    v-else
    type="button"
    class="pet-tile"
    :class="{ 'pet-tile--on': entry.enabled, 'pet-tile--ro': readonly }"
    :disabled="readonly"
    :title="label"
    @click="onToggle"
  >
    <SelectMark :type="affordance === 'radio' ? 'radio' : 'checkbox'" :state="entry.enabled ? 'on' : 'off'" />
    <span class="pet-tile__label">{{ label }}</span>
  </button>
</template>

<style scoped>
.pet-tile {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  width: 100%;
  min-height: 46px;
  padding: var(--pet-space-sm) var(--pet-space-md);
  font-size: var(--pet-font-size-base);
  color: var(--pet-color-text-muted);
  background: var(--pet-color-surface-raised);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-md);
  cursor: pointer;
  text-align: left;
  transition:
    color var(--pet-motion-fast) var(--pet-motion-ease),
    background var(--pet-motion-fast) var(--pet-motion-ease),
    border-color var(--pet-motion-fast) var(--pet-motion-ease);
}
.pet-tile:hover {
  color: var(--pet-color-text);
  border-color: var(--pet-color-border-strong);
}
.pet-tile--on {
  color: var(--pet-color-text);
  font-weight: var(--pet-font-weight-medium);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 84%);
  border-color: color-mix(in srgb, var(--pet-color-accent), transparent 35%);
}
.pet-tile--on:hover {
  border-color: var(--pet-color-accent);
}
/* Read-only (mode page): show the tile + its on/off state, but no interaction. */
.pet-tile--ro {
  cursor: default;
  opacity: 1;
}
.pet-tile--ro:hover {
  color: var(--pet-color-text-muted);
  border-color: var(--pet-color-border);
}
.pet-tile--ro.pet-tile--on {
  color: var(--pet-color-text);
}
.pet-tile--ro.pet-tile--on:hover {
  border-color: color-mix(in srgb, var(--pet-color-accent), transparent 35%);
}
.pet-tile__label {
  flex: 1;
  min-width: 0;
  line-height: var(--pet-font-leading-tight);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* selection marks */
.pet-tile__mark--lock {
  width: 10px;
  height: 10px;
  border-radius: var(--pet-radius-pill);
  background: var(--pet-color-rule-always-on);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--pet-color-rule-always-on), transparent 72%);
}
.pet-tile--locked {
  cursor: default;
  background: color-mix(in srgb, var(--pet-color-rule-always-on), transparent 88%);
  border-color: color-mix(in srgb, var(--pet-color-rule-always-on), transparent 55%);
}
.pet-tile__pin {
  flex: none;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-rule-always-on);
}

/* input tile */
.pet-tile--input {
  flex-direction: column;
  align-items: stretch;
  gap: var(--pet-space-xs);
  grid-column: 1 / -1;
  cursor: default;
}
.pet-tile__inputhead {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
}
.pet-tile__toggle {
  flex: none;
  display: grid;
  place-items: center;
  padding: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.pet-tile__toggle:disabled {
  cursor: default;
}
.pet-tile__badge {
  flex: none;
  margin-left: auto;
  padding: 1px var(--pet-space-xs);
  font-size: var(--pet-font-size-xs);
  font-weight: var(--pet-font-weight-regular);
  color: var(--pet-color-accent-text);
  background: var(--pet-color-rule-input);
  border-radius: var(--pet-radius-sm);
}
.pet-tile__textarea {
  width: 100%;
  resize: vertical;
  padding: var(--pet-space-xs) var(--pet-space-sm);
  font-family: var(--pet-font-sans);
  font-size: var(--pet-font-size-sm);
  color: var(--pet-color-text);
  background: var(--pet-color-surface);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-sm);
}
.pet-tile__textarea:focus {
  outline: none;
  border-color: var(--pet-color-rule-input);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pet-color-rule-input), transparent 65%);
}
</style>
