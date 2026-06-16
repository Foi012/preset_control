import { ref } from 'vue';

/**
 * Shared "smart scroll" behaviour for the console's scrolling surfaces (in-use card
 * list, 结构 group list, ModeArrange group list).
 *
 * The header it drives is a normal **flex element above the scroll container** that
 * hides by collapsing in flow (so the freed space is reclaimed for content) — it does
 * NOT overlap the list, so no masking background/backdrop is ever needed. The two
 * classic failure modes are handled explicitly:
 *
 * - **Feedback loop / blink:** collapsing the header changes the scroll container's
 *   height, which fires a synthetic scroll event (often a clamp near the bottom).
 *   After every toggle we ignore scroll events for `SUPPRESS_MS`, so that synthetic
 *   event can't immediately toggle the header back.
 * - **Stuck-hidden on short lists:** we only hide when there is comfortably more to
 *   scroll than the header is tall (`MIN_RANGE`), so collapsing always leaves room to
 *   scroll back up and reveal it. Genuinely short lists simply never hide.
 *
 * `hidden` → bind to a class that collapses the header (max-height/opacity).
 * `onScroll` → attach to the scroll container's `@scroll`.
 * `reveal` → force the header back (e.g. after an action that should re-show it).
 */
const DIRECTION_THRESHOLD = 6; // ignore sub-threshold momentum/end-stop jitter
const TOP_REVEAL = 8; // always show within this many px of the top
const MIN_RANGE = 96; // don't hide unless there's comfortably more than the header to scroll
const SUPPRESS_MS = 320; // ignore scroll events this long after a toggle (outlasts the transition)

export function useHideOnScroll() {
  const hidden = ref(false);
  let lastScrollTop = 0;
  let suppressUntil = 0;

  function onScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const scrollTop = Math.max(el.scrollTop, 0);

    // Always reveal at the very top so the controls are there when you arrive.
    if (scrollTop < TOP_REVEAL) {
      hidden.value = false;
      lastScrollTop = scrollTop;
      suppressUntil = 0;
      return;
    }
    // Ignore the synthetic scroll event our own collapse/expand just produced.
    if (Date.now() < suppressUntil) {
      lastScrollTop = scrollTop;
      return;
    }
    // Near-empty lists: keep the header stable rather than risk a stuck/janky hide.
    const maxScroll = Math.max(el.scrollHeight - el.clientHeight, 0);
    if (maxScroll < MIN_RANGE) {
      lastScrollTop = scrollTop;
      return;
    }
    const delta = scrollTop - lastScrollTop;
    lastScrollTop = scrollTop;
    if (Math.abs(delta) < DIRECTION_THRESHOLD) return;
    const next = delta > 0; // hide on scroll-down, reveal on scroll-up
    if (next !== hidden.value) {
      hidden.value = next;
      suppressUntil = Date.now() + SUPPRESS_MS;
    }
  }

  function reveal(): void {
    hidden.value = false;
  }

  return { hidden, onScroll, reveal };
}
