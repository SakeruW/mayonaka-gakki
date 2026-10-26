import { describe, expect, it } from "vitest";
import { readTape, recordSample, runHead, wowFlutter, wrap } from "../../src/engine/tape";
import {
  LEVER, SUPPLY_R, TAPE_SECONDS, demoLoop, handSpeed, hissLevel, leverAngle, leverPoint, leverSpeed, reelOmega, tapeOut, tapeUnitsPerSecond, 
  speedText, tapeState, tapeStep, timeText, toneHz,
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

describe("the head", () => {
  const tape = Float32Array.from({ length: 100 }, (_, i) => i / 100);
  const run = (rate: number, rec?: Float32Array) => {
    const t = tape.slice(), out = new Float32Array(10), st = { pos: 20, t: 0 };
    runHead(st, t, 1, out, rec, () => rate, () => 1, 0, !!rec, 44100);
    return { out, st, t };
  };
  it("reads the tape forwards at 1×", () => {
    const { out, st } = run(1);
    expect(out[0]).toBeCloseTo(0.2, 5); expect(out[9]).toBeCloseTo(0.29, 5); expect(st.pos).toBe(30);
  });
  it("reads it backwards at −1×", () => {
    const { out, st } = run(-1);
    expect(out[1]).toBeCloseTo(0.19, 5); expect(st.pos).toBe(10);
  });
  it("records onto the tape just as it passes", () => {
    const { t } = run(1, new Float32Array(10).fill(0.5));
    expect(t[25]).toBeCloseTo(recordSample(0.5), 6);
    expect(t[35]).toBeCloseTo(0.35, 6);
  });
});

describe("the tape on its own", () => {
  const run = (s: number, secs: number) => { for (let i = 0; i < secs * 60; i++) s = tapeStep(s, 1 / 60); return s; };
  it("stops dead within a third of a second once nothing moves it, either way", () => {
    expect(run(1, 0.1)).toBeLessThan(0.6);
    expect(run(1, 0.1)).toBeGreaterThan(0.1);
    expect(run(1, 0.4)).toBe(0);
    expect(run(-2, 0.6)).toBe(0);
  });
});

describe("the lever", () => {
  it("is hinged outside the box and swings within its travel", () => {
    expect(leverPoint(0.5, 0).x).toBe(LEVER.hingeX);
    expect(LEVER.hingeX).toBeGreaterThan(6.6);                                 // outside the box's right side
    expect(leverAngle(LEVER.hingeX + 5, LEVER.hingeY - 5)).toBe(LEVER.min);    // as far up as it goes
    expect(leverAngle(LEVER.hingeX + 0.1, LEVER.hingeY + 5)).toBe(LEVER.max);  // as far down
  });
  it("draws tape out of the box as it swings up, and lets it back in as it swings down", () => {
    for (let p = LEVER.min; p < LEVER.max - 0.05; p += 0.05) expect(tapeOut(p)).toBeGreaterThan(tapeOut(p + 0.05));
    expect(leverSpeed(1)).toBeGreaterThan(0);
    expect(leverSpeed(-1)).toBeCloseTo(-leverSpeed(1), 9);
  });
  it("a full swing runs most of a second of tape past the head", () => {
    const seconds = LEVER.gain * (tapeOut(LEVER.min) - tapeOut(LEVER.max)) / tapeUnitsPerSecond();
    expect(seconds).toBeGreaterThan(0.5);
    expect(seconds).toBeLessThan(1.2);
  });
});

describe("the reel", () => {
  it("a hand on the reel and the tape agree on speed", () => {
    expect(handSpeed(reelOmega(1.3, SUPPLY_R), SUPPLY_R)).toBeCloseTo(1.3, 9);
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
  it("says what the tape is doing in words, and how fast as a multiple", () => {
    expect(tapeState(0, false)).toBe("停止");
    expect(tapeState(0.5, false)).toBe("再生");
    expect(tapeState(-0.5, false)).toBe("逆再生");
    expect(tapeState(0.5, true)).toBe("録音");
    expect(speedText(1)).toBe("1.0倍");
    expect(speedText(-0.5)).toBe("0.5倍");
    expect(timeText(3.24)).toBe("0:03.2");
  });
});

describe("the built-in tape", () => {
  const sr = 8000, tape = demoLoop(sr);
  it("holds 48 seconds: twenty bars at 100 bpm", () => {
    expect(TAPE_SECONDS).toBe(48);
    expect(tape.length).toBe(48 * sr);
  });
  it("is normalised and never silent for long", () => {
    let peak = 0;
    for (const v of tape) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeCloseTo(0.7, 3);
    const win = sr / 4;   // 250 ms windows
    for (let i = 0; i + win <= tape.length; i += win) {
      let e = 0;
      for (let j = i; j < i + win; j++) e += tape[j] * tape[j];
      expect(Math.sqrt(e / win), `window at ${(i / sr).toFixed(2)} s`).toBeGreaterThan(0.002);
    }
  });
  it("changes as it goes: hats, snare and singing make A brighter than the intro, and B differs from A", () => {
    // brightness: the level of the sample-to-sample change, which the high, busy parts dominate
    const bright = (from: number, to: number) => { let e = 0; for (let i = from * sr + 1; i < to * sr; i++) e += (tape[i] - tape[i - 1]) ** 2; return Math.sqrt(e / ((to - from) * sr)); };
    const intro = bright(0, 4.8), a = bright(9.6, 14.4), b = bright(28.8, 33.6);
    expect(a).toBeGreaterThan(intro * 2);
    expect(Math.abs(b - a) / a).toBeGreaterThan(0.1);
  });
});
