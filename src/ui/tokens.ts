/**
 * Design tokens — single source of truth for color, typography, spacing, and motion.
 *
 * Why TS and not SCSS: this script mounts at runtime, and we want (a) runtime
 * theme-swapping (editorial / glass / …) and (b) JS-driven UI behaviour such as
 * the trigger's opacity + scale. Keeping tokens in TS lets both the stylesheet
 * and the imperative logic read from one source. `emitCssVars()` flattens the
 * active theme into `--pet-*` CSS custom properties; every component references
 * those variables and never a raw value.
 *
 * Visuals are intentionally placeholder right now — we're locking *structure*,
 * not look. Editorial / glassmorphism themes slot in later by adding entries to
 * `themes` without touching any component.
 */

const PREFIX = '--pet'; // preset-easy-toggle

/** Primitive scales — raw values, theme-agnostic. Referenced by themes below. */
export const scale = {
  /** 4px base spacing scale */
  space: {
    none: '0',
    xxs: '2px',
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    xxl: '32px',
  },
  radius: {
    sm: '4px',
    md: '6px',
    lg: '8px',
    pill: '999px',
  },
  font: {
    sans: `system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`,
    mono: `'SF Mono', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace`,
    size: {
      xxs: '10px',
      xs: '11px',
      sm: '12px',
      base: '13px',
      lg: '15px',
      xl: '18px',
    },
    weight: {
      regular: '400',
      medium: '500',
      semibold: '600',
    },
    leading: {
      tight: '1.25',
      normal: '1.5',
    },
  },
  /** Motion — durations + easings, so every transition feels coherent. */
  motion: {
    fast: '120ms',
    base: '200ms',
    slow: '320ms',
    ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  },
  /** Stacking order — kept central so layers never fight. */
  z: {
    panel: '10000',
    trigger: '10001',
    overlay: '10002',
    popover: '10003',
  },
} as const;

/**
 * Semantic theme — maps meaning → value. Components only ever speak in semantic
 * names (`surface`, `accent`, `ruleSingle`…), never primitives, so re-skinning
 * is a matter of swapping a theme object.
 */
export type Theme = {
  color: {
    /** Opaque panel background */
    surface: string;
    /** Translucent panel background (glass-ready) */
    surfaceGlass: string;
    /** Raised row / hovered surface */
    surfaceRaised: string;
    /** Scrim behind modals */
    overlay: string;

    text: string;
    textMuted: string;
    textFaint: string;
    icon: string;

    border: string;
    borderStrong: string;
    /** Border for unchecked selection controls (radio/checkbox/master) — held ≥3:1 vs surface */
    markBorder: string;

    accent: string;
    accentText: string;

    /** Toggle states */
    on: string;
    off: string;
    danger: string;

    /** Per-rule badge colours (single / multi / always-on / input) */
    ruleSingle: string;
    ruleMulti: string;
    ruleAlwaysOn: string;
    ruleInput: string;
  };
  effect: {
    /** Backdrop blur amount for glass surfaces */
    glassBlur: string;
    shadowTrigger: string;
    shadowSm: string;
    shadowMd: string;
    shadowLg: string;
  };
  /**
   * The non-intrusive trigger, modelled on the reference: faint + small at rest,
   * opaque + larger on hover/active. These drive both CSS and JS.
   */
  trigger: {
    size: string;
    iconSize: string;
    idleOpacity: string;
    hoverOpacity: string;
    idleScale: string;
    hoverScale: string;
    activeScale: string;
  };
};

const dark: Theme = {
  color: {
    surface: '#1b1d22',
    surfaceGlass: 'rgba(27, 29, 34, 0.78)',
    surfaceRaised: 'rgba(36, 39, 46, 0.72)',
    overlay: 'rgba(0, 0, 0, 0.45)',

    text: '#e8e9ed',
    textMuted: '#b7bbc6',
    textFaint: '#858a96',
    icon: '#aeb3c0',

    border: 'rgba(255, 255, 255, 0.12)',
    borderStrong: 'rgba(255, 255, 255, 0.24)',
    markBorder: '#6f7480', // 3.6:1 vs surface

    accent: '#7c9cff',
    accentText: '#0e1330',

    on: '#5ec98a',
    off: '#4a4d57',
    danger: '#e06c75',

    ruleSingle: '#7c9cff', // pick one
    ruleMulti: '#5ec98a', // pick any
    ruleAlwaysOn: '#c0a36b', // locked on
    ruleInput: '#c98ad1', // editable text
  },
  effect: {
    glassBlur: '18px',
    shadowTrigger: '0 2px 6px rgba(0, 0, 0, 0.2)',
    shadowSm: '0 1px 2px rgba(0, 0, 0, 0.3)',
    shadowMd: '0 4px 14px rgba(0, 0, 0, 0.35)',
    shadowLg: '0 12px 40px rgba(0, 0, 0, 0.45)',
  },
  trigger: {
    size: '36px',
    iconSize: '18px',
    idleOpacity: '0.42',
    hoverOpacity: '1',
    idleScale: '0.67',
    hoverScale: '1',
    activeScale: '0.94',
  },
};

const light: Theme = {
  color: {
    surface: '#ffffff',
    surfaceGlass: 'rgba(255, 255, 255, 0.82)',
    surfaceRaised: 'rgba(243, 244, 247, 0.74)',
    overlay: 'rgba(20, 22, 28, 0.32)',

    text: '#1c1e24',
    textMuted: '#565b66',
    textFaint: '#6c717c', // 4.9:1 vs white — was #8a8f9b (3.2:1, failed AA)
    icon: '#5a6070',

    border: 'rgba(20, 22, 28, 0.12)',
    borderStrong: 'rgba(20, 22, 28, 0.24)',
    markBorder: '#8b91a0', // 3.15:1 vs white

    accent: '#4663d6',
    accentText: '#ffffff',

    on: '#2e9e63',
    off: '#c3c7d0',
    danger: '#cf5560',

    ruleSingle: '#4663d6', // pick one
    ruleMulti: '#2e9e63', // pick any
    ruleAlwaysOn: '#a87f2e', // locked on
    ruleInput: '#a455b0', // editable text
  },
  effect: {
    glassBlur: '18px',
    shadowTrigger: '0 2px 6px rgba(20, 22, 28, 0.18)',
    shadowSm: '0 1px 2px rgba(20, 22, 28, 0.12)',
    shadowMd: '0 4px 14px rgba(20, 22, 28, 0.14)',
    shadowLg: '0 12px 40px rgba(20, 22, 28, 0.18)',
  },
  trigger: dark.trigger,
};

export const themes = { dark, light } as const;
export type ThemeName = keyof typeof themes;

/** Resolve a theme by name, falling back to dark for unknown values. */
export function themeByName(name: string): Theme {
  return (themes as Record<string, Theme>)[name] ?? dark;
}

/** Flatten primitives + a theme into a `:root`-style CSS custom-property block. */
export function emitCssVars(theme: Theme = dark): string {
  const lines: string[] = [];
  const push = (path: string, value: string) => lines.push(`  ${PREFIX}-${path}: ${value};`);

  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(obj)) {
      const kebab = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      const name = prefix ? `${prefix}-${kebab}` : kebab;
      if (value && typeof value === 'object') walk(value as Record<string, unknown>, name);
      else push(name, String(value));
    }
  };

  walk(scale as unknown as Record<string, unknown>, '');
  walk(theme as unknown as Record<string, unknown>, '');
  return lines.join('\n');
}

/** Convenience accessor for a single CSS variable reference, e.g. cssVar('color-accent'). */
export function cssVar(path: string): string {
  return `var(${PREFIX}-${path})`;
}
