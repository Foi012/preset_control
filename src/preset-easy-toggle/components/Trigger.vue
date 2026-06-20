<script setup lang="ts">
import PetIcon from '@/ui/PetIcon.vue';

const emit = defineEmits<{
  open: [];
  dragStart: [event: PointerEvent];
  dragMove: [event: PointerEvent];
  dragEnd: [event: PointerEvent];
}>();

let pointerId: number | null = null;
let startX = 0;
let startY = 0;
let moved = false;

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  pointerId = event.pointerId;
  startX = event.screenX;
  startY = event.screenY;
  moved = false;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  emit('dragStart', event);
}

function onPointerMove(event: PointerEvent): void {
  if (pointerId !== event.pointerId) return;
  if (Math.abs(event.screenX - startX) > 3 || Math.abs(event.screenY - startY) > 3) moved = true;
  emit('dragMove', event);
}

function onPointerUp(event: PointerEvent): void {
  if (pointerId !== event.pointerId) return;
  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  pointerId = null;
  emit('dragEnd', event);
  if (!moved) emit('open');
}

function onPointerCancel(event: PointerEvent): void {
  if (pointerId !== event.pointerId) return;
  pointerId = null;
  emit('dragEnd', event);
}
</script>

<template>
  <button
    class="pet-trigger"
    title="预设控制台"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
>
    <span class="pet-trigger__icon"><PetIcon name="sliders" /></span>
  </button>
</template>

<style scoped>
.pet-trigger {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  padding: 0;
  color: var(--pet-color-text);
  background: var(--pet-color-surface);
  border: 1px solid var(--pet-color-border);
  border-radius: var(--pet-radius-pill);
  box-shadow: var(--pet-effect-shadow-trigger);
  cursor: grab;
  opacity: var(--pet-trigger-idle-opacity);
  transform: scale(var(--pet-trigger-idle-scale));
  transform-origin: center;
  touch-action: none;
  user-select: none;
  transition:
    background var(--pet-motion-base) var(--pet-motion-ease-out),
    box-shadow var(--pet-motion-base) var(--pet-motion-ease-out),
    opacity var(--pet-motion-base) var(--pet-motion-ease-out),
    transform var(--pet-motion-base) var(--pet-motion-ease-out);
}
.pet-trigger:hover {
  opacity: var(--pet-trigger-hover-opacity);
  transform: scale(var(--pet-trigger-hover-scale));
  background: var(--pet-color-surface-raised);
}
.pet-trigger:active {
  cursor: grabbing;
  opacity: var(--pet-trigger-hover-opacity);
  transform: scale(var(--pet-trigger-active-scale));
}
.pet-trigger__icon {
  display: grid;
  place-items: center;
  width: var(--pet-trigger-icon-size);
  height: var(--pet-trigger-icon-size);
  line-height: 1;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.28));
}
.pet-trigger__icon :deep(.pet-icon) {
  width: 100%;
  height: 100%;
}
</style>
