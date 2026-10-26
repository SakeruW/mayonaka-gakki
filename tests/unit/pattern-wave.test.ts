import { describe, expect, it } from "vitest";
import { STANDARDS, aWeight, crtPickupGain, fanHarpHz, harmonics, loudnessMatch, noteOf, stripeHz } from "../../src/engine/pattern-wave";

const named = (hz: number) => { const n = noteOf(hz); return n.name + n.oct; };

describe("noteOf", () => {
  it("names A4 and C4", () => {
    expect(noteOf(440)).toEqual({ name: "A", oct: 4, cents: 0 });
    expect(named(261.63)).toBe("C4");
  });
  it("reports cents off the nearest note", () => {
    expect(noteOf(440 * Math.pow(2, 30 / 1200)).cents).toBe(30);
  });
});

describe("CRT stripe pitch (NTSC)", () => {
  const ntsc = STANDARDS.ntsc;
  it("2 stripes ≈ 131.1 Hz (C3), 4 stripes ≈ 262.2 Hz (C4)", () => {
    expect(stripeHz(2, ntsc)).toBeCloseTo(131.1, 1);
    expect(stripeHz(4, ntsc)).toBeCloseTo(262.2, 1);
  });
  it.each([[2, "C3"], [3, "G3"], [4, "C4"], [5, "E4"], [6, "G4"], [8, "C5"]])("%i stripes = %s", (n, note) => {
    expect(named(stripeHz(n, ntsc))).toBe(note);
  });
  it("V-HOLD bends by cents", () => {
    expect(stripeHz(4, ntsc, 100) / stripeHz(4, ntsc)).toBeCloseTo(Math.pow(2, 1 / 12), 6);
  });
});

describe("fan harp pitch", () => {
  it("is holes × rpm / 60", () => {
    expect(fanHarpHz(18, 654)).toBeCloseTo(196.2, 6);
    expect(named(fanHarpHz(18, 654))).toBe("G3");
  });
});

describe("harmonics", () => {
  const stripes = (n: number, len: number) => Float32Array.from({ length: len }, (_, j) => (Math.floor(j * 2 * n / len) % 2 ? 0 : 1));

  it("puts n stripes on harmonic n", () => {
    for (const n of [1, 3, 5]) {
      const h = harmonics(stripes(n, 480), 32)!;
      const power = Array.from(h.re, (r, k) => r * r + h.im[k] * h.im[k]);
      expect(power.indexOf(Math.max(...power))).toBe(n);
    }
  });
  it("is silent for a flat picture", () => {
    expect(harmonics(new Float32Array(240).fill(0.5), 16)).toBeNull();
  });
  it("CRT pickup thins the lowest and highest frequencies", () => {
    expect(crtPickupGain(60)).toBeLessThan(crtPickupGain(600));
    expect(crtPickupGain(7200)).toBeLessThan(crtPickupGain(600));
  });
});

describe("loudness", () => {
  it("A-weighting is 1 at 1 kHz and much less in the bass", () => {
    expect(aWeight(1000)).toBeCloseTo(1, 2);
    expect(aWeight(100)).toBeLessThan(0.15);
  });
  it("loudnessMatch sets the A-weighted level", () => {
    const h = { re: new Float32Array(4), im: Float32Array.from([0, 1, 0, 0.5]) };
    const m = loudnessMatch(h, 1000, 0.3);
    expect(Math.sqrt(((m.im[1] * aWeight(1000)) ** 2 + (m.im[3] * aWeight(3000)) ** 2) / 2)).toBeCloseTo(0.3, 6);
  });
});
