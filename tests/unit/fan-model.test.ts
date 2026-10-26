import { describe, expect, it } from "vitest";
import { NOTE_CHOICES, SPEEDS, TEMPLATES, amplitudes, fitDisc, keyPick, light, motorStep, noteHz, ringWave, ringsOf, scaleOf, targetRpm, tune } from "../../src/instruments/fan-harp/model";

const blade = TEMPLATES[0];

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

describe("notes to a disc", () => {
  it("offers A2 to C6", () => {
    expect(NOTE_CHOICES[0]).toBe("A2");
    expect(NOTE_CHOICES[NOTE_CHOICES.length - 1]).toBe("C6");
    expect(NOTE_CHOICES).toContain("G3");
  });
  it("knows each note's pitch", () => {
    expect(noteHz("A4")).toBeCloseTo(440, 6);
    expect(noteHz("C4")).toBeCloseTo(261.63, 2);
    expect(noteHz("B♭3")).toBeCloseTo(233.08, 2);
  });
  it("finds whole hole counts and a speed that land near every chosen note", () => {
    for (const notes of [["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"], ["A2", "G3", "C4"], ["C6"]]) {
      const fit = fitDisc(notes);
      expect(fit.slots).toHaveLength(notes.length);
      fit.slots.forEach((n) => { expect(Number.isInteger(n)).toBe(true); expect(n).toBeGreaterThanOrEqual(4); expect(n).toBeLessThanOrEqual(120); });
      expect(Math.max(...fit.cents.map(Math.abs))).toBeLessThan(10);
    }
  });
});

describe("scaleOf", () => {
  it("reads the C blade as just intonation on its 24-hole ring", () => {
    const sc = scaleOf(TEMPLATES[0].slots, 654);
    expect(sc.ref).toBe(24);
    expect(sc.just).toBe(true);
    expect(sc.rings.map((r) => r.ratio)).toEqual(["3/4", "1/1", "9/8", "5/4", "4/3", "3/2", "5/3", "2/1"]);
    expect(sc.rings.map((r) => r.name + r.oct)).toEqual(["G3", "C4", "D4", "E4", "F4", "G4", "A4", "C5"]);
  });
  it("reads C4–C5 as the just C major scale", () => {
    const sc = scaleOf(TEMPLATES[1].slots, TEMPLATES[1].rpm);
    expect(sc.just).toBe(true);
    expect(sc.rings.map((r) => r.ratio)).toEqual(["1/1", "9/8", "5/4", "4/3", "3/2", "5/3", "15/8", "2/1"]);
    expect(sc.rings.map((r) => r.name + r.oct)).toEqual(["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"]);
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
