import { describe, expect, it } from "vitest";
import { STANDARDS, aWeight, noteOf, stripeHz } from "../../src/engine/pattern-wave";
import { LOUDNESS, MAX_STRIPES, PH, PW, SETS, charFor, handLevel, oscHz, profileOf, waveOf } from "../../src/instruments/crt-drums/model";

/** a PW×PH RGBA picture of n white stripes on black */
function stripes(n: number) {
  const d = new Uint8ClampedArray(PW * PH * 4);
  for (let r = 0; r < PH; r++) {
    const on = Math.floor(r * 2 * n / PH) % 2 === 0 ? 255 : 0;
    for (let c = 0; c < PW; c++) d.set([on, on, on, 255], (r * PW + c) * 4);
  }
  return d;
}
const peak = (h: { re: Float32Array; im: Float32Array }) => {
  const p = Array.from(h.re, (r, k) => r * r + h.im[k] * h.im[k]);
  return p.indexOf(Math.max(...p));
};

describe("the sets", () => {
  it("play six different notes, none an octave of another, each within 10¢ on 60i", () => {
    const notes = SETS.map((s) => noteOf(stripeHz(s.n, STANDARDS.ntsc)));
    expect(new Set(notes.map((n) => n.name)).size).toBe(6);
    for (const n of notes) expect(Math.abs(n.cents)).toBeLessThanOrEqual(10);
    expect(notes.map((n) => n.name + n.oct)).toEqual(["D5", "B5", "A6", "C4", "E4", "G4"]);
    for (const s of SETS) expect(s.n).toBeLessThanOrEqual(MAX_STRIPES);
  });
});

describe("profileOf", () => {
  it("covers the whole field with blanking in stripe mode, only the visible lines in text mode", () => {
    expect(profileOf(stripes(4), STANDARDS.ntsc, "stripes", 0.5).length).toBe(525);
    expect(profileOf(stripes(4), STANDARDS.ntsc, "text", 0.5).length).toBe(480);
    expect(profileOf(stripes(4), STANDARDS.pal, "stripes", 0.5).length).toBe(625);
  });
  it("leaves the blanking lines dark", () => {
    const p = profileOf(stripes(4), STANDARDS.ntsc, "stripes", 0.5);
    expect(Math.max(...p.subarray(480))).toBe(0);
  });
});

describe("waveOf", () => {
  it("puts n stripes on harmonic n of one visible field", () => {
    for (const n of [2, 3, 5, 8]) expect(peak(waveOf(profileOf(stripes(n), STANDARDS.ntsc, "text", 0.5), 60)!)).toBe(n);
  });
  it("in stripe mode the strongest partial sits by n × lines / visible of the field rate", () => {
    const n = 8, k = peak(waveOf(profileOf(stripes(n), STANDARDS.ntsc, "stripes", 0.5), STANDARDS.ntsc.field)!);
    expect(Math.abs(k - n * 262.5 / 240)).toBeLessThan(1);
  });
  it("is silent for a blank screen", () => {
    expect(waveOf(profileOf(new Uint8ClampedArray(PW * PH * 4), STANDARDS.ntsc, "stripes", 0.5), STANDARDS.ntsc.field)).toBeNull();
  });
});

describe("loudness", () => {
  const aLoud = (h: { re: Float32Array; im: Float32Array }, f0: number) => {
    let p = 0;
    for (let k = 1; k < h.re.length; k++) p += (h.re[k] ** 2 + h.im[k] ** 2) * aWeight(k * f0) ** 2;
    return Math.sqrt(p / 2);
  };
  it("every picture sounds equally loud, in both modes and at any stripe count", () => {
    for (const mode of ["stripes", "text"] as const) for (const n of [2, 5, 13]) {
      const f0 = oscHz(mode, n, STANDARDS.ntsc, 0);
      expect(aLoud(waveOf(profileOf(stripes(n), STANDARDS.ntsc, mode, 0.5), f0)!, f0)).toBeCloseTo(LOUDNESS, 6);
    }
  });
});

describe("helpers", () => {
  it("charFor cycles through the typed text", () => {
    expect(charFor("真夜中", 4)).toBe("夜");
    expect(charFor("  ", 0)).toBe("");
  });
  it("the hand couples best at the centre", () => {
    expect(handLevel({ x: 0.5, y: 0.5 })).toBeGreaterThan(handLevel({ x: 0.05, y: 0.9 }));
  });
});
