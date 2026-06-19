<script lang="ts">
export type IconName =
  | 'add'
  | 'arrow-left'
  | 'bookmark-plus'
  | 'check'
  | 'chevron-down'
  | 'chevron-up'
  | 'close'
  | 'edit'
  | 'download'
  | 'eye'
  | 'eye-off'
  | 'fold'
  | 'grip'
  | 'lock'
  | 'menu'
  | 'moon'
  | 'outdent'
  | 'pin'
  | 'play'
  | 'power'
  | 'refresh'
  | 'settings'
  | 'sliders'
  | 'sun'
  | 'trash'
  | 'type'
  | 'unfold'
  | 'upload';
</script>

<script setup lang="ts">
defineProps<{ name: IconName }>();
</script>

<template>
  <svg class="pet-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path v-if="name === 'add'" d="M12 5v14M5 12h14" />
    <path v-else-if="name === 'arrow-left'" d="M19 12H5M11 6l-6 6 6 6" />
    <template v-else-if="name === 'bookmark-plus'">
      <path d="M6 3h12v18l-6-4-6 4V3Z" />
      <path d="M12 7v5M9.5 9.5h5" />
    </template>
    <path v-else-if="name === 'check'" d="m5 12 5 5L20 7" />
    <path v-else-if="name === 'chevron-down'" d="m6 9 6 6 6-6" />
    <path v-else-if="name === 'chevron-up'" d="m18 15-6-6-6 6" />
    <path v-else-if="name === 'close'" d="M6 6l12 12M18 6 6 18" />
    <path v-else-if="name === 'download'" d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    <path v-else-if="name === 'edit'" d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <template v-else-if="name === 'eye'">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    </template>
    <path
      v-else-if="name === 'eye-off'"
      d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M7.5 7.8C4.4 9.4 2.5 12 2.5 12s3.5 6 9.5 6c1.5 0 2.8-.4 4-1M14 6.2c4.6.9 7.5 5.8 7.5 5.8a17 17 0 0 1-2.2 2.8"
    />
    <path v-else-if="name === 'fold'" d="M7 9l5-5 5 5M7 15l5 5 5-5" />
    <path v-else-if="name === 'grip'" d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
    <path v-else-if="name === 'lock'" d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v10H6V11ZM12 15v2" />
    <path v-else-if="name === 'menu'" d="M4 7h16M4 12h16M4 17h16" />
    <template v-else-if="name === 'moon'">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </template>
    <path v-else-if="name === 'outdent'" d="m10 8-4 4 4 4M6 12h9M19 5v14" />
    <path
      v-else-if="name === 'pin'"
      d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z"
    />
    <path v-else-if="name === 'play'" d="M8 5v14l11-7-11-7Z" />
    <path v-else-if="name === 'power'" d="M12 3v8M8.4 7.5a6 6 0 1 0 7.2 0" />
    <path v-else-if="name === 'refresh'" d="M20 12a8 8 0 0 1-14 5M4 12a8 8 0 0 1 14-5M18 3v4h-4M6 21v-4h4" />
    <template v-else-if="name === 'settings'">
      <path
        d="M10.32 4.32c.43-1.76 2.93-1.76 3.36 0a1.72 1.72 0 0 0 2.57 1.06c1.54-.94 3.3.82 2.37 2.37a1.72 1.72 0 0 0 1.06 2.57c1.76.43 1.76 2.93 0 3.36a1.72 1.72 0 0 0-1.06 2.57c.93 1.54-.83 3.3-2.37 2.37a1.72 1.72 0 0 0-2.57 1.06c-.43 1.76-2.93 1.76-3.36 0a1.72 1.72 0 0 0-2.57-1.06c-1.54.93-3.3-.83-2.37-2.37a1.72 1.72 0 0 0-1.06-2.57c-1.76-.43-1.76-2.93 0-3.36a1.72 1.72 0 0 0 1.06-2.57c-.93-1.55.83-3.31 2.37-2.37a1.72 1.72 0 0 0 2.57-1.06Z"
      />
      <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    </template>
    <path
      v-else-if="name === 'sliders'"
      d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"
    />
    <template v-else-if="name === 'sun'">
      <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
    </template>
    <path v-else-if="name === 'trash'" d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />
    <path v-else-if="name === 'type'" d="M4 7V4h16v3M12 4v16M8 20h8" />
    <path v-else-if="name === 'unfold'" d="M7 5l5 5 5-5M7 19l5-5 5 5" />
    <path v-else-if="name === 'upload'" d="M12 15V3M7 8l5-5 5 5M5 21h14" />
  </svg>
</template>

<style scoped>
.pet-icon {
  display: block;
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
