import { describe, expect, it } from "vitest";
import { STANDARDS } from "../../src/engine/pattern-wave";
import { PH, PW, charFor, handLevel, profileOf, waveOf } from "../../src/instruments/crt-drums/model";

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
    for (const n of [2, 3, 5, 8]) expect(peak(waveOf(profileOf(stripes(n), STANDARDS.ntsc, "text", 0.5))!)).toBe(n);
  });
  it("in stripe mode the strongest partial sits by n × lines / visible of the field rate", () => {
    const n = 8, k = peak(waveOf(profileOf(stripes(n), STANDARDS.ntsc, "stripes", 0.5))!);
    expect(Math.abs(k - n * 262.5 / 240)).toBeLessThan(1);
  });
  it("is silent for a blank screen", () => {
    expect(waveOf(profileOf(new Uint8ClampedArray(PW * PH * 4), STANDARDS.ntsc, "stripes", 0.5))).toBeNull();
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
