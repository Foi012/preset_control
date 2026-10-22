import { onBeforeUnmount, ref } from 'vue';
export const MOBILE_WORKBENCH_QUERY = '(max-width: 767px), (max-width: 1023px) and (pointer: coarse)';
/** Shared breakpoint for the workbench only; quick-panel sizing remains independent. */
export function useMobileWorkbench() {
  const query = window.matchMedia(MOBILE_WORKBENCH_QUERY);
  const mobile = ref(query.matches);
  const update = () => { mobile.value = query.matches; };
  query.addEventListener('change', update);
  onBeforeUnmount(() => query.removeEventListener('change', update));
  return mobile;
}
