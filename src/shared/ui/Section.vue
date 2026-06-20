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
  defineProps<{
    title: string;
    open?: boolean | null;
    defaultOpen?: boolean;
    collapsible?: boolean;
    /** `md` (default) = `lg` title for a top-level group; `sm` for sections nested
     *  under a larger page/step title, so the two don't compete (matches egroup__name). */
    size?: 'md' | 'sm';
  }>(),
  { open: null, defaultOpen: true, collapsible: true, size: 'md' },
);
const emit = defineEmits<{ 'update:open': [open: boolean] }>();
const localOpen = ref(props.defaultOpen);
const currentOpen = computed(() => props.open ?? localOpen.value);
// A non-collapsible section is always shown (no chevron, header not clickable).
const shown = computed(() => !props.collapsible || currentOpen.value);
function toggle(): void {
  if (!props.collapsible) return;
  const next = !currentOpen.value;
  if (props.open === null) localOpen.value = next;
  emit('update:open', next);
}
</script>

<template>
  <section class="ui-section" :class="[`ui-section--${size}`, { 'ui-section--collapsed': !shown }]">
    <header class="ui-section__head" :class="{ 'ui-section__head--static': !collapsible }" @click="toggle">
      <IconButton
        v-if="collapsible"
        class="ui-section__disclosure"
        :class="{ 'ui-section__disclosure--collapsed': !currentOpen }"
        name="chevron-down"
        :title="currentOpen ? '收起' : '展开'"
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
/* Nested under a larger page/step title — smaller name so hierarchy reads clearly. */
.ui-section--sm .ui-section__name {
  font-size: var(--pet-font-size-sm);
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
