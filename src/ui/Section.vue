<script setup lang="ts">
/**
 * Generic collapsible section — the reusable disclosure behind the preset console's
 * `pet-section` look (chevron + `lg`/semibold title + bottom-rule divider), with none
 * of that component's store/data coupling. Expanded by default. A `badges` slot holds
 * right-aligned header content.
 */
import { computed, ref } from 'vue';
import IconButton from './IconButton.vue';

const props = withDefaults(
  defineProps<{ title: string; defaultOpen?: boolean; collapsible?: boolean }>(),
  { defaultOpen: true, collapsible: true },
);
const open = ref(props.defaultOpen);
// A non-collapsible section is always shown (no chevron, header not clickable).
const shown = computed(() => !props.collapsible || open.value);
function toggle(): void {
  if (props.collapsible) open.value = !open.value;
}
</script>

<template>
  <section class="ui-section" :class="{ 'ui-section--collapsed': !shown }">
    <header class="ui-section__head" :class="{ 'ui-section__head--static': !collapsible }" @click="toggle">
      <IconButton
        v-if="collapsible"
        class="ui-section__disclosure"
        :class="{ 'ui-section__disclosure--collapsed': !open }"
        name="chevron-down"
        :title="open ? '收起' : '展开'"
        @click.stop="toggle"
      />
      <span class="ui-section__name">{{ title }}</span>
      <span class="ui-section__badges"><slot name="badges" /></span>
    </header>
    <div v-show="shown" class="ui-section__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.ui-section {
  border-bottom: 1px solid color-mix(in srgb, var(--pet-color-border), transparent 35%);
}
.ui-section__head {
  display: flex;
  align-items: center;
  gap: var(--pet-space-sm);
  padding: var(--pet-space-sm) 0;
  cursor: pointer;
}
.ui-section__head--static {
  cursor: default;
}
.ui-section__disclosure {
  transition: transform var(--pet-motion-fast) var(--pet-motion-ease);
}
.ui-section__disclosure--collapsed {
  transform: rotate(-90deg);
}
.ui-section__name {
  flex: 1;
  min-width: 0;
  font-size: var(--pet-font-size-lg);
  font-weight: var(--pet-font-weight-semibold);
  line-height: var(--pet-font-leading-tight);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ui-section__badges {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--pet-space-xs);
}
.ui-section__body {
  padding: 0 0 var(--pet-space-md);
}
</style>
