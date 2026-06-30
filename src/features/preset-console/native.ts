import { createPinia } from 'pinia';
import { createApp, watch } from 'vue';
import App from './App.vue';
import { presetGatewayNative } from './preset-io-native';
import { configurePresetGateway, flushAutosave, useConsoleStore, useUiStore, type ThemePref } from './store';
import { emitCssVars, themeByName } from '@/ui/tokens';

const POSITION_KEY = 'presetEasyTogglePosition';
const THEME_KEY = 'presetEasyToggleTheme';
const HOST_ID = 'preset-easy-toggle-native';
const CLOSED_SIZE = 36;
const OPEN_WIDTH = 385;
const OPEN_MAX_HEIGHT = 660;
const OPEN_HEIGHT_RATIO = 0.78;
const HOME_WIDTH = 224;
// Hugs the launcher card list — bump when adding a toolbox tool (currently 3 ≈ 48px each + padding).
const HOME_HEIGHT = 168;
const EDGE_PADDING = 4;
const COMPACT_MAX_WIDTH = 480;

type Point = { x: number; y: number };
type DragDetail = { clientX: number; clientY: number };
type NativeContext = {
  eventSource?: {
    on?: (event: string, listener: () => void) => void;
    removeListener?: (event: string, listener: () => void) => void;
  };
  eventTypes?: Record<string, string>;
};

function context(): NativeContext {
  return (globalThis.SillyTavern?.getContext?.() ?? {}) as NativeContext;
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function openSize(home = false) {
  const { width, height } = viewport();
  if (home) {
    return {
      width: Math.min(HOME_WIDTH, width - EDGE_PADDING * 2),
      height: Math.min(HOME_HEIGHT, height - EDGE_PADDING * 2),
    };
  }
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

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('[preset-easy-toggle] 保存本地偏好失败', error);
  }
}

function loadPosition(): Point {
  const saved = loadJson<Partial<Point> | null>(POSITION_KEY, null);
  if (!saved) return defaultPosition();
  return clampPoint({ x: Number(saved.x) || 0, y: Number(saved.y) || 0 }, CLOSED_SIZE, CLOSED_SIZE);
}

function loadTheme(): ThemePref {
  const raw = localStorage.getItem(THEME_KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'dark';
}

function saveTheme(theme: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (error) {
    console.warn('[preset-easy-toggle] 保存主题失败', error);
  }
}

function copyComponentStyles(shadow: ShadowRoot): MutationObserver {
  const copied = new WeakSet<HTMLStyleElement>();
  const copy = () => {
    for (const style of Array.from(document.head.querySelectorAll('style'))) {
      if (copied.has(style)) continue;
      const text = style.textContent ?? '';
      if (!text.includes('.pet-') && !text.includes('--pet-')) continue;
      copied.add(style);
      shadow.appendChild(style.cloneNode(true));
    }
  };
  copy();
  const observer = new MutationObserver(copy);
  observer.observe(document.head, { childList: true });
  return observer;
}

function debounce(fn: () => void, wait: number): () => void {
  let timer = 0;
  return () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(fn, wait);
  };
}

function init(): void {
  if (!globalThis.SillyTavern?.getContext) {
    console.warn('[preset-easy-toggle] SillyTavern context is unavailable; extension did not mount.');
    return;
  }

  document.getElementById(HOST_ID)?.remove();
  configurePresetGateway(presetGatewayNative());

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.position = 'fixed';
  host.style.zIndex = '2147483000';
  host.style.border = '0';
  host.style.background = 'transparent';
  host.style.transition = 'none';
  host.style.transformOrigin = '0 0';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const reset = document.createElement('style');
  reset.textContent = [
    '*,*::before,*::after{box-sizing:border-box}',
    ':host{all:initial;color-scheme:normal}',
    '#app{height:100%;width:100%;font-family:var(--pet-font-sans)}',
    'button,input,textarea,select{font:inherit}',
  ].join('\n');
  const tokenStyle = document.createElement('style');
  shadow.append(reset, tokenStyle);
  const appRoot = document.createElement('div');
  appRoot.id = 'app';
  shadow.appendChild(appRoot);

  const pinia = createPinia();
  const app = createApp(App).use(pinia);
  const ui = useUiStore(pinia);
  const store = useConsoleStore(pinia);
  ui.setTheme(loadTheme());
  ui.compact = viewport().width < COMPACT_MAX_WIDTH;
  tokenStyle.textContent = `:host {\n${emitCssVars(themeByName(ui.theme))}\n}`;

  let triggerPosition = loadPosition();
  let dragging = false;
  let dragMoved = false;
  let dragOffset: Point = { x: 0, y: 0 };

  type Box = { x: number; y: number; width: number; height: number };
  function frameBox(open: boolean): Box {
    if (open) {
      const size = openSize(ui.activeTool === 'home');
      const point = clampPoint(triggerPosition, size.width, size.height);
      return { x: point.x, y: point.y, width: size.width, height: size.height };
    }
    triggerPosition = clampPoint(triggerPosition, CLOSED_SIZE, CLOSED_SIZE);
    return { x: triggerPosition.x, y: triggerPosition.y, width: CLOSED_SIZE, height: CLOSED_SIZE };
  }

  function applyLayout(open: boolean): void {
    const box = frameBox(open);
    Object.assign(host.style, {
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
  }

  let animToken = 0;
  function animateFrame(open: boolean): void {
    const first = host.getBoundingClientRect();
    host.style.transition = 'none';
    host.style.transform = 'none';
    applyLayout(open);
    const last = host.getBoundingClientRect();
    host.style.willChange = 'transform, opacity';
    host.style.transform = `translate(${first.left - last.left}px, ${first.top - last.top}px) scale(${first.width / last.width}, ${first.height / last.height})`;
    host.style.opacity = '0';
    void host.offsetWidth;
    host.style.transition = 'transform 220ms cubic-bezier(0.16,1,0.3,1), opacity 180ms ease-out';
    host.style.transform = 'none';
    host.style.opacity = '1';
    const token = (animToken += 1);
    window.setTimeout(() => {
      if (token !== animToken) return;
      host.style.transition = 'none';
      host.style.willChange = 'auto';
    }, 260);
  }

  app.mount(appRoot);
  const styleObserver = copyComponentStyles(shadow);
  void store.load();

  function onOutsidePointerDown(event: PointerEvent): void {
    if (!ui.open) return;
    if (host.contains(event.target as Node)) return;
    ui.open = false;
  }
  document.addEventListener('pointerdown', onOutsidePointerDown);

  const stopTheme = watch(
    () => ui.theme,
    theme => {
      tokenStyle.textContent = `:host {\n${emitCssVars(themeByName(theme))}\n}`;
      saveTheme(theme);
    },
  );

  let layoutPrimed = false;
  const stopLayout = watch(
    () => [ui.open, ui.activeTool] as const,
    ([open]) => {
      if (!layoutPrimed) {
        layoutPrimed = true;
        applyLayout(open);
        return;
      }
      animateFrame(open);
    },
    { immediate: true },
  );

  function onDragStart(event: Event): void {
    if (ui.open) return;
    const point = (event as CustomEvent<DragDetail>).detail;
    dragging = true;
    dragMoved = false;
    dragOffset = { x: point.clientX - triggerPosition.x, y: point.clientY - triggerPosition.y };
    animToken += 1;
    Object.assign(host.style, { transition: 'none', transform: 'none', opacity: '1', willChange: 'auto' });
  }

  function onDragMove(event: Event): void {
    if (!dragging || ui.open) return;
    const point = (event as CustomEvent<DragDetail>).detail;
    const next = clampPoint({ x: point.clientX - dragOffset.x, y: point.clientY - dragOffset.y }, CLOSED_SIZE, CLOSED_SIZE);
    if (Math.abs(next.x - triggerPosition.x) > 3 || Math.abs(next.y - triggerPosition.y) > 3) dragMoved = true;
    triggerPosition = next;
    applyLayout(false);
  }

  function onDragEnd(): void {
    if (!dragging) return;
    dragging = false;
    host.style.transition = 'none';
    if (dragMoved) saveJson(POSITION_KEY, triggerPosition);
  }

  window.addEventListener('pet-trigger-drag-start', onDragStart);
  window.addEventListener('pet-trigger-drag-move', onDragMove);
  window.addEventListener('pet-trigger-drag-end', onDragEnd);

  const onResize = debounce(() => {
    ui.compact = viewport().width < COMPACT_MAX_WIDTH;
    triggerPosition = clampPoint(triggerPosition, CLOSED_SIZE, CLOSED_SIZE);
    applyLayout(ui.open);
    saveJson(POSITION_KEY, triggerPosition);
  }, 150);
  window.addEventListener('resize', onResize);

  const refresh = debounce(() => store.externalReload(), 350);
  const ctx = context();
  const presetEvent = ctx.eventTypes?.OAI_PRESET_CHANGED_AFTER;
  const settingsEvent = ctx.eventTypes?.SETTINGS_UPDATED;
  if (presetEvent) ctx.eventSource?.on?.(presetEvent, refresh);
  if (settingsEvent) ctx.eventSource?.on?.(settingsEvent, refresh);

  window.addEventListener('pagehide', () => {
    stopTheme();
    stopLayout();
    styleObserver.disconnect();
    document.removeEventListener('pointerdown', onOutsidePointerDown);
    window.removeEventListener('pet-trigger-drag-start', onDragStart);
    window.removeEventListener('pet-trigger-drag-move', onDragMove);
    window.removeEventListener('pet-trigger-drag-end', onDragEnd);
    window.removeEventListener('resize', onResize);
    if (presetEvent) ctx.eventSource?.removeListener?.(presetEvent, refresh);
    if (settingsEvent) ctx.eventSource?.removeListener?.(settingsEvent, refresh);
    flushAutosave();
    app.unmount();
    host.remove();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  window.setTimeout(init, 0);
}
