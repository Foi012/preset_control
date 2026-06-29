<script setup lang="ts">
/**
 * 连接档案 — the curated rig quick-switcher.
 *
 * A short row of one-tap chips (the user's pinned 2–3 writing rigs) sits on top: tapping one
 * runs `/profile <name>`, which makes ST swap url+key+model+preset in one go — the fast path
 * for A/B-comparing GPT vs Claude. A collapsible 管理档案 section below pins/removes/reorders
 * rigs from ST's full profile list and gives each a short label (ST's own names are long).
 *
 * This tool only *references* ST's profiles — it never holds the endpoint, key, or model. See
 * DESIGN.md for the "orchestrate ST, don't rebuild it" decision.
 */
import { onMounted, ref } from 'vue';
import { useConnectionStore } from './store';
import { paramDef, type ParamId } from './params';
import type { ResolvedFavorite } from './favorites';
import ChipButton from '@/ui/ChipButton.vue';
import IconButton from '@/ui/IconButton.vue';
import Section from '@/ui/Section.vue';
import TextField from '@/ui/TextField.vue';
import PetIcon from '@/ui/PetIcon.vue';

const cp = useConnectionStore();

/** Which favorite's param panel is expanded (one at a time). */
const paramOpen = ref<string | null>(null);

/** The sampling params surfaced per rig — the common ones; the rest can come later behind 高级. */
const COMMON_PARAMS: ParamId[] = ['temp_openai', 'top_p_openai', 'freq_pen_openai', 'pres_pen_openai', 'openai_max_tokens'];
const commonDefs = COMMON_PARAMS.map(id => paramDef(id)!).filter(Boolean);

/** Display string for a param override input — empty when there's no override (rig default). */
function paramValue(fav: ResolvedFavorite, id: ParamId): string {
  const v = fav.params?.[id]?.value;
  return v === undefined ? '' : String(v);
}

/** Blank clears the override (back to default); a finite number stores it. */
function onParam(profileId: string, id: ParamId, raw: string | number): void {
  const text = String(raw).trim();
  if (text === '') return cp.setParam(profileId, id, null);
  const n = Number(text);
  if (Number.isFinite(n)) cp.setParam(profileId, id, n);
}

const hasParams = (fav: ResolvedFavorite): boolean => !!fav.params && Object.keys(fav.params).length > 0;

onMounted(() => cp.refresh());
</script>

<template>
  <div class="cp">
    <!-- Quick switch: one tap = apply the rig. Missing favorites live in 管理 below, not here. -->
    <section class="cp__switch">
      <p class="cp__lead">点按切换连接档案（端点 · 密钥 · 模型 · 预设一并切换）。</p>
      <div v-if="cp.resolved.some(f => !f.missing)" class="cp__chips">
        <template v-for="fav in cp.resolved" :key="fav.profileId">
          <ChipButton
            v-if="!fav.missing"
            :active="fav.profileId === cp.currentId"
            :title="`${fav.name}${fav.preset ? ' · ' + fav.preset : ''}`"
            @click="cp.apply(fav.profileId)"
          >
            <span class="cp__chiplabel">{{ fav.label }}</span>
            <small v-if="fav.model" class="cp__chipmodel">{{ fav.model }}</small>
          </ChipButton>
        </template>
      </div>
      <p v-else class="cp__empty">还没有收藏的连接档案。在下面从 ST 的连接配置里添加常用的。</p>
      <p v-if="cp.error" class="cp__error"><PetIcon name="alert" />{{ cp.error }}</p>
    </section>

    <!-- Manage: pin/remove/reorder/relabel, and add from ST's full profile list. -->
    <Section title="管理档案" :default-open="cp.resolved.length === 0" size="sm">
      <ul v-if="cp.resolved.length" class="cp__list">
        <li v-for="(fav, i) in cp.resolved" :key="fav.profileId" class="cp__row" :class="{ 'cp__row--missing': fav.missing }">
          <div class="cp__rowtop">
            <div class="cp__rowmain">
              <TextField
                :model-value="fav.label"
                :placeholder="fav.name || '已删除的档案'"
                compact
                @update:model-value="cp.relabel(fav.profileId, String($event))"
              />
              <span v-if="fav.missing" class="cp__tag">已删除</span>
              <span v-else-if="fav.model" class="cp__meta">{{ fav.model }}<template v-if="fav.preset"> · {{ fav.preset }}</template></span>
            </div>
            <div class="cp__rowactions">
              <IconButton v-if="!fav.missing" name="sliders" title="参数覆盖" :active="paramOpen === fav.profileId || hasParams(fav)"
                @click="paramOpen = paramOpen === fav.profileId ? null : fav.profileId" />
              <IconButton name="chevron-up" title="上移" :disabled="i === 0" @click="cp.move(fav.profileId, -1)" />
              <IconButton name="chevron-down" title="下移" :disabled="i === cp.resolved.length - 1" @click="cp.move(fav.profileId, 1)" />
              <IconButton name="trash" title="移除收藏" danger @click="cp.unpin(fav.profileId)" />
            </div>
          </div>
          <!-- Per-rig param override — the temp/penalties ST's profile switch doesn't carry. -->
          <div v-if="paramOpen === fav.profileId" class="cp__params">
            <label v-for="def in commonDefs" :key="def.id" class="cp__param">
              <span class="cp__paramlabel">{{ def.label }}</span>
              <TextField :model-value="paramValue(fav, def.id)" placeholder="默认" compact
                @update:model-value="onParam(fav.profileId, def.id, $event)" />
            </label>
            <p class="cp__paramhint">留空＝沿用该档案预设的默认值。切换时写入，补上 ST 切档案时不带的采样参数。</p>
          </div>
        </li>
      </ul>

      <p class="cp__sublead">从 ST 连接配置添加：</p>
      <ul v-if="cp.available.length" class="cp__add">
        <li v-for="p in cp.available" :key="p.id" class="cp__addrow">
          <span class="cp__addname" :title="p.name">{{ p.name }}</span>
          <IconButton name="add" title="收藏" @click="cp.pin(p.id)" />
        </li>
      </ul>
      <p v-else class="cp__empty">没有更多可添加的连接配置（或 ST 不可用）。</p>
      <button type="button" class="cp__refresh" @click="cp.refresh()"><PetIcon name="refresh" />刷新列表</button>
    </Section>
  </div>
</template>

<style scoped>
.cp {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-sm);
  padding: var(--pet-space-sm);
}
.cp__switch {
  display: flex;
  flex-direction: column;
  gap: var(--pet-space-xs);
}
.cp__lead,
.cp__sublead {
  margin: 0;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-muted);
}
.cp__sublead {
  margin-top: var(--pet-space-xs);
}
.cp__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--pet-space-xs);
}
/* Chips carry a label + a smaller model line, stacked. */
.cp__chiplabel {
  display: block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp__chipmodel {
  display: block;
  font-size: var(--pet-font-size-xxs);
  font-weight: var(--pet-font-weight-normal);
  opacity: 0.7;
}
.cp__empty {
  margin: 0;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text-muted);
}
.cp__error {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-danger, #d66);
}
.cp__error :deep(.pet-icon) {
  width: 13px;
  height: 13px;
  flex: none;
}
.cp__list,
.cp__add {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cp__row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 0;
}
.cp__rowtop {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
}
.cp__row--missing {
  opacity: 0.65;
}
.cp__params {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--pet-space-xs);
  margin-left: var(--pet-space-sm);
  border-left: 2px solid color-mix(in srgb, var(--pet-color-accent), transparent 70%);
  background: color-mix(in srgb, var(--pet-color-accent), transparent 94%);
  border-radius: var(--pet-radius-sm);
}
.cp__param {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
}
.cp__paramlabel {
  flex: 1;
  min-width: 0;
  font-size: var(--pet-font-size-xs);
  color: var(--pet-color-text);
}
.cp__param :deep(.pet-field) {
  width: 88px;
  flex: none;
}
.cp__paramhint {
  margin: 2px 0 0;
  font-size: var(--pet-font-size-xxs);
  color: var(--pet-color-text-muted);
}
.cp__rowmain {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
}
.cp__rowmain :deep(.pet-field) {
  flex: 1;
  min-width: 0;
}
.cp__meta {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--pet-font-size-xxs);
  color: var(--pet-color-text-muted);
}
.cp__tag {
  flex: none;
  font-size: var(--pet-font-size-xxs);
  color: var(--pet-color-danger, #d66);
}
.cp__rowactions {
  display: flex;
  gap: 1px;
  flex: none;
}
.cp__addrow {
  display: flex;
  align-items: center;
  gap: var(--pet-space-xs);
  padding: 1px 0;
}
.cp__addname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--pet-font-size-sm);
}
.cp__refresh {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: var(--pet-space-xs);
  padding: 0;
  background: none;
  border: none;
  color: var(--pet-color-accent);
  font-size: var(--pet-font-size-xs);
  cursor: pointer;
}
.cp__refresh :deep(.pet-icon) {
  width: 13px;
  height: 13px;
}
</style>
