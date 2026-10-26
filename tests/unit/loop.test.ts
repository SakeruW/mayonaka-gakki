import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let queued: FrameRequestCallback[] = [];
let now = 0;

beforeEach(() => {
  queued = []; now = 0;
  vi.resetModules();
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { queued.push(cb); return queued.length; });
  vi.stubGlobal("cancelAnimationFrame", () => { queued = []; });
});
afterEach(() => vi.unstubAllGlobals());

function step(ms: number) { now += ms; const q = queued; queued = []; q.forEach((cb) => cb(now)); }

describe("onFrame", () => {
  it("passes dt in seconds and clamps long gaps", async () => {
    const { onFrame } = await import("../../src/engine/loop");
    const dts: number[] = [];
    const stop = onFrame((dt) => dts.push(dt));
    step(16); step(1000);
    expect(dts[0]).toBeCloseTo(0.016, 6);
    expect(dts[1]).toBe(0.05);
    stop();
  });

  it("stops requesting frames once nobody listens", async () => {
    const { onFrame } = await import("../../src/engine/loop");
    const a = onFrame(() => {}), b = onFrame(() => {});
    a(); step(16);
    expect(queued.length).toBe(1);
    b();
    expect(queued.length).toBe(0);
  });
});
