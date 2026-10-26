import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 480px)";

/** phone-width layout; for sizes CSS can't reach, such as a knob's drawn ring */
export function useCompact(): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(QUERY); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
