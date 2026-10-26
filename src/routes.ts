import { useSyncExternalStore } from "react";

// plain hash routes, so the same build also runs inside a claude.ai artifact
export const ROUTES = ["fan-harp", "crt-drums", "open-reel"] as const;
export type Route = (typeof ROUTES)[number] | "lobby";

export function parseRoute(hash: string): Route {
  const id = hash.replace(/^#\/?/, "");
  return (ROUTES as readonly string[]).includes(id) ? (id as Route) : "lobby";
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => parseRoute(window.location.hash), () => "lobby");
}
