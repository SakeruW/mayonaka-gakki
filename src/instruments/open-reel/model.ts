// An open-reel deck played the Open Reel Ensemble way, with a rod: the tape runs off a single reel, round a guide,
// across the heads, and is tied to the tip of a rod standing where the take-up reel would be. Rocking the rod drags
// the tape across the head and back; a finger can also pull the tape or knock it against the head.
// Tape speed s: 1 = the speed it was recorded at (19 cm/s), negative = backwards.

/** reel geometry, as fractions of the reel's flange radius: the hub, and how full the reel is */
export const HUB_R = 0.3, SUPPLY_R = 0.8;
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

// ---------- the lever (Open Reel Ensemble's rod) ----------

/**
 * A rod on a pivot at the bottom right of the deck, where the take-up reel would be, the tape's end tied to its tip.
 * Rocking it drags the tape across the head and back. Positions are in deck units (the deck is 16 wide).
 */
export const LEVER = { pivotX: 13, pivotY: 11.25, length: 2.3, maxSwing: 0.55, gain: 2.4 } as const;

/** where the rod's tip is for a swing angle (0 = upright, positive = leaning right) */
export function leverTip(theta: number) {
  return { x: LEVER.pivotX + LEVER.length * Math.sin(theta), y: LEVER.pivotY - LEVER.length * Math.cos(theta) };
}

/** the swing angle for a hand at (x, y), held within the rod's travel */
export function leverAngle(x: number, y: number) {
  const a = Math.atan2(x - LEVER.pivotX, LEVER.pivotY - y);
  return Math.max(-LEVER.maxSwing, Math.min(LEVER.maxSwing, a));
}

/** tape speed from the tip moving sideways at v deck units/s: the tape tied to it is dragged across the head */
export function leverSpeed(v: number) { return LEVER.gain * v / (V0 * 3.6); }
