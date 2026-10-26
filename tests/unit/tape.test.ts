import { describe, expect, it } from "vitest";
import { readTape, wowFlutter, wrap } from "../../src/engine/tape";
import {
  LOOP_BEATS, LOOP_BPM, SUPPLY_R, TAKEUP_R, counter, demoLoop, handSpeed, headContact, hissLevel, motorTarget, reelOmega, shiftCents,
  speedText, tapeStep, timeText, toneHz,
} from "../../src/instruments/open-reel/model";

describe("tape head maths", () => {
  it("wraps positions round the loop both ways", () => {
    expect(wrap(5, 4)).toBe(1);
    expect(wrap(-1, 4)).toBe(3);
  });
  it("reads samples exactly on the sample and smoothly between them", () => {
    const tape = Float32Array.from({ length: 64 }, (_, i) => Math.sin(i / 4));
    expect(readTape(tape, 10)).toBeCloseTo(tape[10], 6);
    expect(readTape(tape, 10.5)).toBeCloseTo(Math.sin(10.5 / 4), 2);
    expect(readTape(tape, -54)).toBeCloseTo(tape[10], 6);   // backwards past the splice
  });
  it("wobbles the speed by a fraction of a percent", () => {
    for (let t = 0; t < 2; t += 0.01) expect(Math.abs(wowFlutter(t, 1) - 1)).toBeLessThan(0.003);
    expect(wowFlutter(0.3, 0)).toBe(1);
  });
});

describe("transport", () => {
  const run = (s: number, t: Parameters<typeof tapeStep>[2], target: number, secs: number) => {
    for (let i = 0; i < secs * 60; i++) s = tapeStep(s, target, t, 1 / 60);
    return s;
  };
  it("plays at 19 or 38 cm/s, bent by the pitch knob", () => {
    expect(motorTarget("play", false, 0)).toBe(1);
    expect(motorTarget("play", true, 0)).toBe(2);
    expect(motorTarget("play", false, 1200)).toBeCloseTo(2, 6);
    expect(motorTarget("ff", false, 0)).toBeGreaterThan(4);
    expect(motorTarget("rew", false, 0)).toBeLessThan(-4);
    expect(motorTarget("stop", true, 300)).toBe(0);
  });
  it("brakes to a dead stop in about a third of a second, with the pitch diving on the way", () => {
    expect(run(1, "stop", 0, 0.1)).toBeLessThan(0.6);
    expect(run(1, "stop", 0, 0.1)).toBeGreaterThan(0.1);
    expect(run(1, "stop", 0, 0.4)).toBe(0);
  });
  it("comes up to play speed quickly and spools up to fast wind slowly", () => {
    expect(run(0, "play", 1, 0.4)).toBeGreaterThan(0.95);
    expect(run(0, "ff", 8, 0.4)).toBeLessThan(5);
  });
  it("lifts the tape off the heads in fast wind", () => {
    expect(headContact("ff")).toBeLessThan(0.2);
    expect(headContact("play")).toBe(1);
    expect(headContact("stop")).toBe(1);
  });
});

describe("reels", () => {
  it("a hand on a reel and the tape agree on speed", () => {
    for (const r of [SUPPLY_R, TAKEUP_R]) expect(handSpeed(reelOmega(1.3, r), r)).toBeCloseTo(1.3, 9);
  });
  it("the emptier reel spins faster for the same tape", () => {
    expect(reelOmega(1, TAKEUP_R)).toBeGreaterThan(reelOmega(1, SUPPLY_R));
  });
});

describe("tape sound", () => {
  it("loses its top end as it slows and hisses more as it speeds up", () => {
    expect(toneHz(0.2)).toBeLessThan(toneHz(1));
    expect(toneHz(0)).toBeGreaterThan(100);
    expect(hissLevel(2, 1)).toBeGreaterThan(hissLevel(0.5, 1));
    expect(hissLevel(1, 0)).toBe(0);
  });
});

describe("readouts", () => {
  it("formats speed, time, counter and pitch shift", () => {
    expect(speedText(1)).toBe("1.00×");
    expect(speedText(-0.5)).toBe("−0.50×");
    expect(timeText(3.24)).toBe("0:03.2");
    expect(counter(0)).toBe("0000");
    expect(counter(4)).toBe("0012");
    expect(counter(-1)).toBe("9997");
    expect(shiftCents(2)).toBe(1200);
    expect(shiftCents(0)).toBeNull();
  });
});

describe("the built-in loop", () => {
  const loop = demoLoop(22050);
  it("is two bars at 100 bpm", () => { expect(loop.length).toBe(Math.round(22050 * 60 / LOOP_BPM * LOOP_BEATS)); });
  it("is normalised and never silent for long", () => {
    let peak = 0;
    for (const v of loop) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeCloseTo(0.7, 3);
    const win = 2205;   // 100 ms windows
    for (let i = 0; i + win <= loop.length; i += win) {
      let e = 0;
      for (let j = i; j < i + win; j++) e += loop[j] * loop[j];
      expect(Math.sqrt(e / win), `window at ${(i / 22050).toFixed(1)} s`).toBeGreaterThan(0.003);
    }
  });
});
