import { describe, expect, it } from "vitest";
import { Head, hissLevel, readTape, recordSample, toneHz, wrap } from "../../src/engine/tape";
import {
  LEVER, SUPPLY_R, TAPE_SECONDS, demoLoop, handSpeed, leverAngle, leverPoint, leverTape, reelAngle, reelOmega, tapeOut,
  speedText, tapeState, timeText,
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
});

describe("the head", () => {
  const SR = 48000, RATE = 32000, BLOCK = 128;
  /** a head over a second of rising tape, at 0.25 s */
  const make = (tape = Float32Array.from({ length: RATE }, (_, i) => i / RATE)) => new Head(tape, RATE, SR, 0.25, 0);
  /** run `secs` of audio, returning every sample the head put out */
  const play = (h: Head, secs: number, input?: (i: number) => number) => {
    const n = Math.round(secs * SR / BLOCK), all: number[] = [];
    for (let b = 0; b < n; b++) {
      const out = new Float32Array(BLOCK), inp = input ? Float32Array.from({ length: BLOCK }, (_, i) => input(b * BLOCK + i)) : undefined;
      h.run(out, inp); all.push(...out);
    }
    return all;
  };

  it("runs the tape at the speed the hand moves it: 0.2 s of tape over 0.2 s is 1×, forwards or back", () => {
    const h = make();
    h.lever(0.2, 0.2); play(h, 0.1);
    expect(h.speed).toBeCloseTo(1, 3);
    play(h, 0.2);
    expect(h.speed).toBeCloseTo(0, 6);
    expect(h.pos / RATE).toBeCloseTo(0.45, 6);
    h.lever(0, 0.1); play(h, 0.05);
    expect(h.speed).toBeCloseTo(-2, 3);
  });

  it("comes back to the same place on the tape however the hand rocks it", () => {
    const h = make();
    // irregular moves, as pointer events come, there and back a few times
    let at = 0;
    for (let k = 0; k < 40; k++) {
      at = k % 10 < 5 ? at + 0.03 + 0.02 * Math.sin(k) : at - 0.03 - 0.02 * Math.sin(k);
      h.lever(at, 0.004 + 0.012 * ((k * 7) % 5) / 4); play(h, 0.005 + 0.003 * (k % 3));
    }
    h.lever(0, 0.02); play(h, 0.2);
    expect(h.pos / RATE).toBeCloseTo(0.25, 6);
    expect(h.travel).toBeCloseTo(0, 6);
  });

  it("is silent while the tape stands still, and plays while it moves", () => {
    const h = make(Float32Array.from({ length: RATE }, (_, i) => Math.sin(i / 5)));
    const peak = (xs: number[]) => Math.max(...xs.map(Math.abs));
    expect(peak(play(h, 0.05))).toBe(0);
    h.lever(0.3, 0.3);
    expect(peak(play(h, 0.2))).toBeGreaterThan(0.1);
  });

  it("records over every tape sample it crosses, even fast, so nothing old shows through", () => {
    const tape = new Float32Array(RATE).fill(0.9), h = make(tape);
    h.armed = true;
    h.lever(0.34, 0.2);                                  // 1.7×: more than one tape sample per output sample
    play(h, 0.3, () => 0.5);
    const from = Math.round(0.30 * RATE), to = Math.round(0.55 * RATE);   // past the start, where the filter has settled
    for (let j = from; j < to; j++) expect(tape[j]).toBeCloseTo(recordSample(0.5), 3);
    expect(tape[Math.round(0.7 * RATE)]).toBeCloseTo(0.9, 6);   // beyond where the tape went
  });

  it("keeps the monitor off while recording and writes nothing running backwards", () => {
    const tape = new Float32Array(RATE).fill(0.3), h = make(tape);
    h.armed = true;
    h.lever(0.2, 0.2);
    const out = play(h, 0.2, () => 0.5);
    expect(Math.max(...out.slice(out.length / 2).map(Math.abs))).toBeLessThan(0.01);
    play(h, 0.05, () => 0.5);                             // the tape comes to a stop
    const before = tape.slice();
    h.lever(0, 0.2); play(h, 0.25, () => -0.5);
    expect(tape).toEqual(before);
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
    for (let p = LEVER.min; p < LEVER.max - 0.05; p += 0.05) {
      expect(tapeOut(p)).toBeGreaterThan(tapeOut(p + 0.05));
      expect(leverTape(p)).toBeGreaterThan(leverTape(p + 0.05));   // up is further forward on the tape
    }
  });
  it("a full swing runs most of a second of tape past the head", () => {
    const seconds = leverTape(LEVER.min) - leverTape(LEVER.max);
    expect(seconds).toBeGreaterThan(0.5);
    expect(seconds).toBeLessThan(1.2);
  });
});

describe("the reel", () => {
  it("a hand on the reel and the tape agree on speed", () => {
    expect(handSpeed(reelOmega(1.3, SUPPLY_R), SUPPLY_R)).toBeCloseTo(1.3, 9);
  });
  it("turns as far as the tape has gone", () => {
    expect(reelAngle(2, SUPPLY_R)).toBeCloseTo(reelOmega(1, SUPPLY_R) * 2, 9);
  });
});

describe("tape sound", () => {
  it("loses its top end as it slows and hisses more as it speeds up", () => {
    expect(toneHz(0.2)).toBeLessThan(toneHz(1));
    expect(toneHz(0)).toBeGreaterThan(100);
    expect(hissLevel(2)).toBeGreaterThan(hissLevel(0.5));
    expect(hissLevel(0)).toBe(0);
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
