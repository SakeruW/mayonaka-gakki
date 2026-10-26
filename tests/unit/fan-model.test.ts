import { describe, expect, it } from "vitest";
import { PRESETS, SPEEDS, amplitudes, keyPick, light, parseRpm, parseSlots, motorStep, ringWave, ringsOf, scaleOf, targetRpm, tune } from "../../src/instruments/fan-harp/model";

const blade = PRESETS[0];

describe("rings", () => {
  it("fit between the hub and the rim without overlapping", () => {
    const rs = ringsOf(blade.slots);
    expect(rs).toHaveLength(8);
    expect(rs[0].r0).toBeGreaterThan(0.27);
    expect(rs[7].r1).toBeLessThan(0.95);
    for (let i = 1; i < rs.length; i++) expect(rs[i].r0).toBeGreaterThan(rs[i - 1].r1);
  });
});

describe("speed switch", () => {
  it("強 is the base rpm, 中 is two semitones down, 切 stops", () => {
    expect(targetRpm(654, 3, 0)).toBe(654);
    expect(targetRpm(654, 2, 0)).toBeCloseTo(654 * Math.pow(2, -2 / 12), 6);
    expect(targetRpm(654, 0, 0)).toBe(0);
    expect(SPEEDS).toHaveLength(4);
  });
  it("the dimmer bends by cents", () => {
    expect(targetRpm(654, 3, 1200)).toBeCloseTo(1308, 6);
  });
});

describe("the pick", () => {
  const rs = ringsOf(blade.slots);
  it("on a ring key, sounds only that ring", () => {
    const a = amplitudes(rs, [keyPick(rs[2])], true);
    expect(a[2]).toBeGreaterThan(0.1);
    expect(a.filter((v, i) => i !== 2 && v > 0)).toEqual([]);
  });
  it("hears nothing with the bulb off or off the disc", () => {
    expect(amplitudes(rs, [keyPick(rs[2])], false).every((v) => v === 0)).toBe(true);
    expect(amplitudes(rs, [{ x: 0, y: 0 }], true).every((v) => v === 0)).toBe(true);
    expect(amplitudes(rs, [], true).every((v) => v === 0)).toBe(true);
  });
  it("hears more light near the bulb", () => {
    expect(light({ x: 0, y: 0.45 }, true)).toBeCloseTo(1, 6);
    expect(light({ x: 0, y: -0.9 }, true)).toBeLessThan(0.3);
  });
});

describe("tuner", () => {
  const rs = ringsOf(blade.slots);
  it("18 holes at 654 rpm reads G3", () => {
    const amps = rs.map((_, i) => (i === 0 ? 1 : 0));
    expect(tune(rs, amps, 654)).toMatchObject({ best: 0, N: 18, name: "G", oct: 3 });
  });
  it("lists a second ring sounding with the first", () => {
    const amps = rs.map((_, i) => (i === 0 ? 1 : i === 1 ? 0.5 : 0));
    expect(tune(rs, amps, 654)!.also).toEqual(["C4"]);   // 24 holes = 261.6 Hz
  });
  it("stays quiet below hearing", () => {
    expect(tune(rs, rs.map(() => 1), 30)).toBeNull();
  });
});

describe("ring waveform", () => {
  it("has only odd harmonics", () => {
    const w = ringWave(ringsOf(blade.slots)[0]);
    expect(w.im[1]).toBeGreaterThan(0);
    expect(w.im[2]).toBe(0);
    expect(w.im[3]).toBeGreaterThan(0);
  });
});

describe("disc settings", () => {
  it("parses hole counts, inner ring first", () => {
    expect(parseSlots("18, 24 27、30")).toEqual([18, 24, 27, 30]);
    expect(parseSlots("")).toBeNull();
    expect(parseSlots("1 2 3 4 5 6 7 8 9 10")).toBeNull();
    expect(parseSlots("18, 2.5")).toBeNull();
    expect(parseSlots("0")).toBeNull();
  });
  it("accepts 30–3000 rpm", () => {
    expect(parseRpm("654")).toBe(654);
    expect(parseRpm("29")).toBeNull();
    expect(parseRpm("abc")).toBeNull();
  });
});

describe("scaleOf", () => {
  it("reads the C blade as just intonation on its 24-hole ring", () => {
    const sc = scaleOf(PRESETS[0].slots, 654 * 24 / 24);
    expect(sc.ref).toBe(24);
    expect(sc.just).toBe(true);
    expect(sc.rings.map((r) => r.ratio)).toEqual(["3/4", "1/1", "9/8", "5/4", "4/3", "3/2", "5/3", "2/1"]);
    expect(sc.rings.map((r) => r.name + r.oct)).toEqual(["G3", "C4", "D4", "E4", "F4", "G4", "A4", "C5"]);
  });
  it("reads the pentatonic disc as just too", () => {
    const sc = scaleOf(PRESETS[2].slots, 654);
    expect(sc.just).toBe(true);
    expect(sc.rings.map((r) => r.ratio)).toEqual(["1/1", "9/8", "5/4", "3/2", "5/3"]);
  });
  it("is not just when a ring falls outside the scale", () => {
    expect(scaleOf([24, 25], 654).just).toBe(false);
  });
});

describe("motor", () => {
  const run = (from: number, to: number, seconds: number) => {
    const trace = [from];
    for (let t = 0; t < seconds; t += 1 / 60) trace.push(motorStep(trace[trace.length - 1], to, 1 / 60));
    return trace;
  };
  const at = (trace: number[], s: number) => trace[Math.round(s * 60)];

  it("creeps from a standstill, builds up, then settles on 中", () => {
    const target = 654 * SPEEDS[2], tr = run(0, target, 6);
    expect(at(tr, 0.5)).toBeLessThan(target * 0.06);                   // barely turning at first
    expect(at(tr, 1.5) - at(tr, 1)).toBeGreaterThan(at(tr, 0.5) - at(tr, 0));   // speeding up
    expect(at(tr, 1.5)).toBeLessThan(target * 0.5);
    expect(at(tr, 4.5)).toBeGreaterThan(target * 0.97);                 // there in a few seconds
    expect(Math.max(...tr)).toBeLessThanOrEqual(target);                // no overshoot
  });
  it("coasts down and stops at 切", () => {
    const tr = run(600, 0, 30);
    expect(at(tr, 1)).toBeGreaterThan(300);
    expect(tr[tr.length - 1]).toBe(0);
  });
});
