// An open-reel deck played the Open Reel Ensemble way: the box stands upright with one reel on top; the tape runs down
// past the heads, out through a slot in the side, and is tied to the tip of a lever planted outside the box.
// Rocking the lever drags the tape across the head and back; a finger can also pull the tape or knock it against the head.
// Tape speed s: 1 = the speed it was recorded at (19 cm/s), negative = backwards.

/** reel geometry, as fractions of the reel's flange radius: the hub, and how full the reel is */
export const HUB_R = 0.3, SUPPLY_R = 0.8;

/**
 * The deck drawing, in deck units: 10 across, 12.5 down. The box stands on the left with the reel on top and the heads
 * stacked down its right side; the lever stands outside the box on the right.
 */
export const DECK = {
  width: 10, height: 12.5,
  box: { x: 0.35, y: 0.3, w: 6.25, h: 11.9 },
  reel: { x: 3.4, y: 3.05, r: 2.6 },          // r: the flange
  tapeX: 6.08,                                // the tape's run down past the heads
  guideTop: { x: 5.83, y: 5.55, r: 0.25 },
  guideLow: { x: 5.83, y: 9.75, r: 0.25 },
  heads: [6.55, 7.55, 8.55],                  // erase, record, playback, top to bottom
} as const;
/** at s = 1 a pack of radius 0.68 turns half a revolution a second, about what a 7-inch reel does at 19 cm/s */
export const V0 = 2 * Math.PI * 0.5 * 0.68;

/**
 * Nothing drives the tape: once the hands stop, the reel's brake and the tape's own tension stop it.
 * Friction takes a steady bite as well as a proportional one, so it stops dead within a third of a second.
 */
export function tapeStep(s: number, dt: number): number {
  let next = s * Math.exp(-dt / 0.16);
  next -= Math.sign(next) * Math.min(Math.abs(next), 1.6 * dt);
  return Math.abs(next) < 0.002 ? 0 : next;
}

/** a reel turned by hand at ω rad/s drags the tape at this speed */
export function handSpeed(omega: number, packR: number) { return omega * packR / V0; }
/** and the tape turns a reel at this many rad/s */
export function reelOmega(s: number, packR: number) { return s * V0 / packR; }

/** tape loses its top end as it slows: the head gap only resolves short wavelengths at speed */
export function toneHz(s: number) { return Math.max(180, Math.min(16000, 16000 * Math.pow(Math.abs(s), 0.9))); }

/** tape hiss rises with speed across the head */
export function hissLevel(s: number, contact: number) { return 0.006 * Math.min(1.5, Math.abs(s)) * Math.min(1, contact); }

// ---------- readouts ----------

/** the four-digit counter, geared to the supply reel: three counts a turn */
export const COUNTER_GEAR = 3;
export function counter(revs: number) { const n = Math.floor(revs * COUNTER_GEAR); return String(((n % 10000) + 10000) % 10000).padStart(4, "0"); }
export function speedText(s: number) { return (s < -0.005 ? "−" : "") + Math.abs(s).toFixed(2) + "×"; }
export function timeText(sec: number) { const m = Math.floor(sec / 60), r = sec - m * 60; return `${m}:${r.toFixed(1).padStart(4, "0")}`; }
/** pitch of the tape against how it was recorded, in cents (null when it isn't moving) */
export function shiftCents(s: number) { return Math.abs(s) < 0.01 ? null : Math.round(1200 * Math.log2(Math.abs(s))); }

// ---------- what is on the tape when the deck is switched on ----------

export const TAPE_RATE = 44100, LOOP_BPM = 100, LOOP_BEATS = 8;

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Two bars at 100 bpm, synthesised so nothing borrowed is on the tape: kick, snare, hats, a bass line and sung "ah" stabs
 * (harmonics shaped by the formants of /a/), the kind of material that scratches well.
 */
export function demoLoop(sr = TAPE_RATE): Float32Array {
  const beat = 60 / LOOP_BPM, n = Math.round(sr * beat * LOOP_BEATS), out = new Float32Array(n);
  let seed = 7;
  const noise = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const at = (b: number) => Math.round(b * beat * sr);
  const add = (start: number, dur: number, f: (t: number) => number) => {
    const len = Math.round(dur * sr);
    for (let i = 0; i < len; i++) out[(start + i) % n] += f(i / sr);
  };

  for (const b of [0, 2, 3.5, 4, 6, 7.5]) add(at(b), 0.45, (t) =>
    0.9 * Math.exp(-7 * t) * Math.sin(2 * Math.PI * (48 * t + (110 / 30) * (1 - Math.exp(-30 * t)))));
  for (const b of [1, 3, 5, 7, 7.75]) {
    let last = 0;
    add(at(b), 0.3, (t) => { const w = noise(), hp = w - last; last = w; return Math.exp(-16 * t) * (0.38 * hp + 0.25 * Math.sin(2 * Math.PI * 185 * t) * Math.exp(-20 * t)); });
  }
  for (let b = 0; b < LOOP_BEATS; b += 0.5) {
    let last = 0;
    add(at(b), 0.06, (t) => { const w = noise(), hp = w - last; last = w; return 0.12 * Math.exp(-70 * t) * hp; });
  }
  // bass: C2 C2 E♭2 F2 | G1 G1 B♭1 C2, a soft-edged saw
  [36, 36, 39, 41, 31, 31, 34, 36].forEach((m, b) => {
    const f = midiHz(m);
    let y = 0;
    add(at(b), beat * 0.9, (t) => { const saw = 2 * ((f * t) % 1) - 1; y += 0.08 * (saw - y); return 0.5 * y * Math.min(1, t * 200) * Math.exp(-2.2 * t); });
  });
  // "ah": harmonics of the sung note, each weighted by how close it sits to the /a/ formants
  const formant = (h: number) => Math.exp(-(((h - 730) / 120) ** 2)) + 0.7 * Math.exp(-(((h - 1090) / 140) ** 2)) + 0.25 * Math.exp(-(((h - 2440) / 220) ** 2));
  for (const [b, m, dur] of [[0.5, 67, 0.4], [2.5, 63, 0.4], [4.5, 65, 0.4], [6.5, 60, 0.75]] as const) {
    const f0 = midiHz(m), parts: [number, number][] = [];
    for (let k = 1; k * f0 < 5000; k++) parts.push([k, (0.15 + formant(k * f0)) / k ** 0.6]);
    add(at(b), dur, (t) => {
      const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t), env = Math.min(1, t * 40) * Math.min(1, (dur - t) * 12);
      let s = 0;
      for (const [k, a] of parts) s += a * Math.sin(2 * Math.PI * k * f0 * vib * t);
      return 0.22 * env * s;
    });
  }

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < n; i++) out[i] *= 0.7 / peak;
  return out;
}

// ---------- the lever ----------

/**
 * A long pale arm hinged on the outside of the box's right side, pointing down and out. The tape comes out of a slot in
 * the box and is tied partway along the arm. Swinging the arm up draws more tape out of the box, so the tape runs
 * forward past the heads; swinging it down lets the tape back in, and it runs backwards. Like any lever, a big swing of
 * the handle moves the tape a little, which makes it easy to control. Angles are below the horizontal, in radians.
 */
export const LEVER = { hingeX: 6.85, hingeY: 9.1, length: 2.95, tieAt: 1.35, rest: 0.87, min: 0.3, max: 1.42, gain: 5 } as const;
/** where the tape leaves the box */
export const SLOT = { x: DECK.box.x + DECK.box.w, y: 9.95 } as const;

/** a point `dist` along the arm at swing `phi` */
export function leverPoint(phi: number, dist: number = LEVER.length) {
  return { x: LEVER.hingeX + dist * Math.cos(phi), y: LEVER.hingeY + dist * Math.sin(phi) };
}

/** the swing for a hand at (x, y), held within the arm's travel */
export function leverAngle(x: number, y: number) {
  return Math.max(LEVER.min, Math.min(LEVER.max, Math.atan2(y - LEVER.hingeY, x - LEVER.hingeX)));
}

/** how much tape is out of the box, slot to tie, for a swing */
export function tapeOut(phi: number) { const t = leverPoint(phi, LEVER.tieAt); return Math.hypot(t.x - SLOT.x, t.y - SLOT.y); }

/** tape speed from the tape out of the box changing at v deck units/s: more tape out is forward */
export function leverSpeed(v: number) { return LEVER.gain * v / tapeUnitsPerSecond(); }

/** how far the tape travels, in deck units, each second at s = 1 */
export function tapeUnitsPerSecond() { return V0 * DECK.reel.r; }
