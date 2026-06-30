/**
 * Preset Easy Toggle — script entry (step 4 vertical slice).
 *
 * Mounts the Vue console into an isolated, self-contained iframe (per
 * `.cursor/rules/脚本.mdc`, the "independent floating window" path) so our
 * tailwind + scoped styles never leak into the SillyTavern page. The iframe is
 * fixed bottom-right: trigger-sized when closed, panel-sized when open, driven
 * by the UI store so only the trigger is interactive at rest.
 *
 * Lifecycle is anchored in `$(() => …)` / `'pagehide'` (never DOMContentLoaded).
 * See {@link ./DESIGN.md}.
 */

import { createPinia } from 'pinia';
import { createApp, watch } from 'vue';
import { teleportStyle } from '@util/script';
import App from '@/features/preset-console/App.vue';
import { flushAutosave, useConsoleStore, useUiStore, type ThemePref } from '@/features/preset-console/store';
import { emitCssVars, themeByName } from '@/ui/tokens';

const POSITION_KEY = 'presetEasyTogglePosition';
const THEME_KEY = 'presetEasyToggleTheme';
const PANEL_MARKER = 'preset-easy-toggle-panel';
const BOOT_KEY = '__presetEasyToggleBooted';
const BOOT_DEDUP_MS = 1500;
const CLOSED_SIZE = 36;
const OPEN_WIDTH = 385;
const OPEN_MAX_HEIGHT = 660;
const OPEN_HEIGHT_RATIO = 0.78;
const HOME_WIDTH = 224;
const HOME_HEIGHT = 168;
const EDGE_PADDING = 4;
/** Below this host width the panel goes near-full-width; side navs become drawers. */
const COMPACT_MAX_WIDTH = 480;

/**
 * Minimal self-contained document for the panel iframe. We deliberately do *not*
 * use `createScriptIdIframe` here: its srcdoc loads ST's `adjust_iframe_height`
 * script, which auto-resizes the iframe to its content and fights the fixed
 * trigger/panel sizes (the circle→rectangle flicker). Our components use scoped
 * CSS + injected tokens only — no in-iframe tailwind/jQuery — so a bare document
 * with a layout reset is all we need, and the iframe size stays fully ours.
 */
const PANEL_SRCDOC = [
  '<!DOCTYPE html><html><head><meta charset="utf-8">',
  '<style>',
  '*,*::before,*::after{box-sizing:border-box}',
  'html,body{height:100%;width:100%;margin:0;padding:0;overflow:hidden;background:transparent}',
  '</style></head><body></body></html>',
].join('');

type Point = { x: number; y: number };
type DragDetail = { clientX: number; clientY: number };

function viewport() {
  const win = window.parent ?? window;
  return { width: win.innerWidth, height: win.innerHeight };
}

function openSize(home = false) {
  const { width, height } = viewport();
  if (home) {
    return {
      width: Math.min(HOME_WIDTH, width - EDGE_PADDING * 2),
      height: Math.min(HOME_HEIGHT, height - EDGE_PADDING * 2),
    };
  }
  // Never exceed the viewport, or the fixed iframe spills past the edge and forces
  // the whole host page to scroll horizontally (the mobile-overflow bug). On phones
  // this makes the panel near-full-width; on desktop it stays at OPEN_WIDTH.
  return {
    width: Math.min(OPEN_WIDTH, width - EDGE_PADDING * 2),
    height: Math.min(height * OPEN_HEIGHT_RATIO, OPEN_MAX_HEIGHT),
  };
}

function clampPoint(point: Point, width: number, height: number): Point {
  const size = viewport();
  return {
    x: Math.max(EDGE_PADDING, Math.min(point.x, size.width - width - EDGE_PADDING)),
    y: Math.max(EDGE_PADDING, Math.min(point.y, size.height - height - EDGE_PADDING)),
  };
}

function defaultPosition(): Point {
  const size = viewport();
  return clampPoint({ x: size.width - CLOSED_SIZE - 16, y: size.height - CLOSED_SIZE - 96 }, CLOSED_SIZE, CLOSED_SIZE);
}

function loadPosition(): Point {
  try {
    const raw = getVariables({ type: 'global' })?.[POSITION_KEY];
    if (typeof raw === 'string' && raw.trim()) {
      const saved = JSON.parse(raw) as Partial<Point>;
      return clampPoint({ x: Number(saved.x) || 0, y: Number(saved.y) || 0 }, CLOSED_SIZE, CLOSED_SIZE);
    }
  } catch (error) {
    console.warn('[preset-easy-toggle] 读取触发器位置失败', error);
  }
  return defaultPosition();
}

function savePosition(position: Point): void {
  try {
    insertOrAssignVariables({ [POSITION_KEY]: JSON.stringify(position) }, { type: 'global' });
  } catch (error) {
    console.warn('[preset-easy-toggle] 保存触发器位置失败', error);
  }
}

/**
 * Theme is a per-device display preference, so it lives in global variables (like
 * the trigger position) rather than the preset config — toggling it must not
 * trigger a preset write.
 */
function loadTheme(): ThemePref {
  try {
    const raw = getVariables({ type: 'global' })?.[THEME_KEY];
    if (raw === 'light' || raw === 'dark') return raw;
  } catch (error) {
    console.warn('[preset-easy-toggle] 读取主题失败', error);
  }
  return 'dark';
}

function saveTheme(theme: ThemePref): void {
  try {
    insertOrAssignVariables({ [THEME_KEY]: theme }, { type: 'global' });
  } catch (error) {
    console.warn('[preset-easy-toggle] 保存主题失败', error);
  }
}

async function init(): Promise<void> {
  const hostWindow = window.parent ?? window;
  const hostDocument = hostWindow.document;
  const bootState = hostWindow as Window & { [BOOT_KEY]?: number };
  const existingPanels = hostDocument.querySelectorAll<HTMLIFrameElement>(`iframe[data-pet-panel="${PANEL_MARKER}"]`);
  const bootedAt = bootState[BOOT_KEY] ?? 0;
  const now = Date.now();
  if (existingPanels.length && now - bootedAt < BOOT_DEDUP_MS) return;
  existingPanels.forEach(frame => frame.remove());
  bootState[BOOT_KEY] = now;

  const pinia = createPinia();
  const app = createApp(App).use(pinia);
  let triggerPosition = loadPosition();
  let dragging = false;
  let dragMoved = false;
  let dragOffset: Point = { x: 0, y: 0 };

  const ui = useUiStore(pinia);
  ui.setTheme(loadTheme());
  ui.compact = viewport().width < COMPACT_MAX_WIDTH;
  let tokenStyle: HTMLStyleElement | null = null;

  const $frame = $<HTMLIFrameElement>('<iframe>')
    .attr({ script_id: getScriptId(), 'data-pet-panel': PANEL_MARKER, frameborder: '0', srcdoc: PANEL_SRCDOC })
    .css({
      position: 'fixed',
      left: `${triggerPosition.x}px`,
      top: `${triggerPosition.y}px`,
      'z-index': '2147483000',
      border: 'none',
      background: 'transparent',
      'color-scheme': 'normal',
      // The open/close morph animates transform/opacity (compositor), not the box —
      // see `animateFrame`. No box transition here.
      transition: 'none',
      'transform-origin': '0 0',
      width: `${CLOSED_SIZE}px`,
      height: `${CLOSED_SIZE}px`,
    })
    .appendTo('body')
    .on('load', () => {
      const doc = $frame[0].contentDocument!;
      // Design tokens → CSS vars, available to every component in the iframe.
      tokenStyle = $<HTMLStyleElement>('<style>')
        .attr('id', 'pet-tokens')
        .text(`:root {\n${emitCssVars(themeByName(ui.theme))}\n}`)
        .appendTo(doc.head)[0];
      // Copy the script iframe's bundled <style> (Vue scoped styles) into ours.
      teleportStyle(doc.head);
      app.mount(doc.body);
    });

  // Re-emit the token block whenever the user flips the theme, and persist it.
  const stopTheme = watch(
    () => ui.theme,
    theme => {
      if (tokenStyle) tokenStyle.textContent = `:root {\n${emitCssVars(themeByName(theme))}\n}`;
      saveTheme(theme);
    },
  );

  const consoleStore = useConsoleStore(pinia);
  void consoleStore.load();

  function onOutsidePointerDown(event: PointerEvent): void {
    if (!ui.open) return;
    if ($frame[0].contains(event.target as Node)) return;
    ui.open = false;
  }
  (window.parent ?? window).document.addEventListener('pointerdown', onOutsidePointerDown);

  const framePoint = (detail: DragDetail): Point => {
    const rect = $frame[0].getBoundingClientRect();
    return { x: rect.left + detail.clientX, y: rect.top + detail.clientY };
  };

  type Box = { x: number; y: number; width: number; height: number };

  /** Target geometry for the open panel / closed trigger. Closed re-clamps the
   *  trigger position so it stays on-screen. */
  function frameBox(open: boolean): Box {
    if (open) {
      const size = openSize(ui.activeTool === 'home');
      const point = clampPoint(triggerPosition, size.width, size.height);
      return { x: point.x, y: point.y, width: size.width, height: size.height };
    }
    triggerPosition = clampPoint(triggerPosition, CLOSED_SIZE, CLOSED_SIZE);
    return { x: triggerPosition.x, y: triggerPosition.y, width: CLOSED_SIZE, height: CLOSED_SIZE };
  }

  /** Set the iframe box instantly (no animation) — used by drag + viewport resize. */
  function applyFrameLayout(open: boolean): void {
    const box = frameBox(open);
    $frame.css({ left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
  }

  /**
   * Open/close morph via **FLIP**: snap the iframe to its final box, then animate a
   * `transform` (+ fade) from the previous box back to identity. Only transform/
   * opacity animate — never width/height/left/top — so the morph runs on the
   * compositor and stays smooth even when the main thread is busy (debounced disk
   * save, preset reparse, panel teardown). The fade masks the scaled-content
   * artifact (a 36px trigger blown up on close, a full panel shrunk on open) while
   * the box is far from its final size. Reading the live rect as the FLIP "first"
   * makes a mid-animation reversal pick up smoothly from where it is.
   */
  let animToken = 0;
  function animateFrame(open: boolean): void {
    const el = $frame[0];
    const first = el.getBoundingClientRect();
    el.style.transition = 'none';
    el.style.transform = 'none';
    applyFrameLayout(open); // snap to final box, then measure it
    const last = el.getBoundingClientRect();

    const sx = last.width ? first.width / last.width : 1;
    const sy = last.height ? first.height / last.height : 1;
    el.style.willChange = 'transform, opacity';
    el.style.transform = `translate(${first.left - last.left}px, ${first.top - last.top}px) scale(${sx}, ${sy})`;
    el.style.opacity = '0';
    void el.offsetWidth; // flush so the next change animates from here

    el.style.transition = 'transform 220ms cubic-bezier(0.16,1,0.3,1), opacity 180ms ease-out';
    el.style.transform = 'none';
    el.style.opacity = '1';

    const token = (animToken = animToken + 1);
    window.setTimeout(() => {
      if (token !== animToken) return; // superseded by a newer open/close
      el.style.transition = 'none';
      el.style.willChange = 'auto';
    }, 260);
  }

  // First run (mount) snaps the box instantly; later open/close changes animate.
  let layoutPrimed = false;
  const stopResize = watch(
    () => [ui.open, ui.activeTool] as const,
    ([open]) => {
      if (!layoutPrimed) {
        layoutPrimed = true;
        applyFrameLayout(open);
        return;
      }
      animateFrame(open);
    },
    { immediate: true },
  );

  function onDragStart(event: Event): void {
    if (ui.open) return;
    const point = framePoint((event as CustomEvent<DragDetail>).detail);
    dragging = true;
    dragMoved = false;
    dragOffset = { x: point.x - triggerPosition.x, y: point.y - triggerPosition.y };
    // Cancel any in-flight open/close morph so dragging starts from a clean box.
    animToken = animToken + 1;
    $frame.css({ transition: 'none', transform: 'none', opacity: '1', 'will-change': 'auto' });
  }

  function onDragMove(event: Event): void {
    if (!dragging || ui.open) return;
    const point = framePoint((event as CustomEvent<DragDetail>).detail);
    const next = clampPoint({ x: point.x - dragOffset.x, y: point.y - dragOffset.y }, CLOSED_SIZE, CLOSED_SIZE);
    if (Math.abs(next.x - triggerPosition.x) > 3 || Math.abs(next.y - triggerPosition.y) > 3) dragMoved = true;
    triggerPosition = next;
    applyFrameLayout(false);
  }

  function onDragEnd(): void {
    if (!dragging) return;
    dragging = false;
    // Box moves are instant (no transition); the open/close morph manages its own.
    $frame.css('transition', 'none');
    if (dragMoved) savePosition(triggerPosition);
  }

  window.addEventListener('pet-trigger-drag-start', onDragStart);
  window.addEventListener('pet-trigger-drag-move', onDragMove);
  window.addEventListener('pet-trigger-drag-end', onDragEnd);

  const onHostResize = _.debounce(() => {
    ui.compact = viewport().width < COMPACT_MAX_WIDTH;
    triggerPosition = clampPoint(triggerPosition, CLOSED_SIZE, CLOSED_SIZE);
    applyFrameLayout(ui.open);
    savePosition(triggerPosition);
  }, 150);
  (window.parent ?? window).addEventListener('resize', onHostResize);

  // Re-read on external (ST-side) preset edits; our own writes guard themselves.
  // (Listeners auto-unload on script close, so no manual removal is needed.)
  const refresh = _.debounce(() => consoleStore.externalReload(), 350);
  eventOn(tavern_events.OAI_PRESET_CHANGED_AFTER, refresh);
  eventOn(tavern_events.SETTINGS_UPDATED, refresh);

  $(window).on('pagehide', () => {
    stopResize();
    stopTheme();
    (window.parent ?? window).document.removeEventListener('pointerdown', onOutsidePointerDown);
    window.removeEventListener('pet-trigger-drag-start', onDragStart);
    window.removeEventListener('pet-trigger-drag-move', onDragMove);
    window.removeEventListener('pet-trigger-drag-end', onDragEnd);
    (window.parent ?? window).removeEventListener('resize', onHostResize);
    onHostResize.cancel();
    flushAutosave();
    app.unmount();
    $frame.remove();
    delete bootState[BOOT_KEY];
  });
}

$(() => {
  window.setTimeout(() => errorCatched(init)(), 0);
});
