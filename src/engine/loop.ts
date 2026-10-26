// One requestAnimationFrame loop that every instrument hooks into.
// Per-frame work (disc spin, CRT frames, tape motion, audio params) runs here and never goes through React state.

export type FrameFn = (dt: number, now: number) => void;

const MAX_DT = 0.05;   // a dropped frame or a background tab shouldn't make anything jump
const subs = new Set<FrameFn>();
let raf = 0, last = 0;

function frame(now: number) {
  const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000));
  last = now;
  subs.forEach((fn) => fn(dt, now));
  raf = subs.size ? requestAnimationFrame(frame) : 0;
}

/** Run `fn` every frame until the returned function is called. Safe to call from a React effect. */
export function onFrame(fn: FrameFn): () => void {
  subs.add(fn);
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  return () => {
    subs.delete(fn);
    if (!subs.size && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
}
