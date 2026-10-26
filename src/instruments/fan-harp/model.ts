// Light through the spinning disc: each ring of holes chops the bulb's light at holes × rpm / 60,
// and the Light-Pick's photocell hears every ring it overlaps, as loud as the light where it sits.

import { NOTE_NAMES, centsToRatio, fanHarpHz, noteOf, type Harmonics } from "../../engine/pattern-wave";

export interface Pos { x: number; y: number }
export interface Ring { N: number; r0: number; r1: number; rc: number; pitch: number; w: number }

/** a disc: hole counts per ring, inner first, and its 強 speed. Custom discs also keep the notes they were made from. */
export interface Disc { id: string; label: string; slots: number[]; rpm: number; notes?: string[] }

/** the two discs that come with the fan, both just-intoned on 654 rpm (24 holes = C4) */
export const TEMPLATES: readonly Disc[] = [
  { id: "blade", label: "ハ調8輪", slots: [18, 24, 27, 30, 32, 36, 40, 48], rpm: 654 },
  { id: "c4c5", label: "C4〜C5", slots: [24, 27, 30, 32, 36, 40, 45, 48], rpm: 654 },
];

/** 切 弱 中 強: the speed switch, in semitones 0 (off), −5, −2, ±0 */
export const SPEEDS = [0, Math.pow(2, -5 / 12), Math.pow(2, -2 / 12), 1];
export const SPEED_KEYS = ["切", "弱", "中", "強"] as const;

/** disc geometry, as fractions of the disc radius */
export const INNER = 0.27, OUTER = 0.95, DUTY = 0.5;
/** disc radius as a fraction of half the canvas */
export const DISC = 0.8;
/** where a ring key puts the pick */
export const KEY_ANGLE = -Math.PI * 0.22;
/** the bulb sits low behind the disc */
export const BULB: Pos = { x: 0, y: 0.45 };

export const MAX_RINGS = 9;

export function ringsOf(slots: readonly number[]): Ring[] {
  const pitch = (OUTER - INNER) / slots.length, w = pitch * 0.82;
  return slots.map((N, i) => { const r0 = INNER + i * pitch + (pitch - w) / 2; return { N, r0, r1: r0 + w, rc: r0 + w / 2, pitch, w }; });
}

export function targetRpm(base: number, speed: number, bendCents: number) { return base * SPEEDS[speed] * centsToRatio(bendCents); }

/** a hot core, dimmer toward the far side */
export function light(p: Pos, bulb: boolean) {
  if (!bulb) return 0;
  const d = Math.hypot(p.x - BULB.x, p.y - BULB.y);
  return 0.2 + 0.8 * Math.exp(-Math.pow(d / 0.45, 2));
}

export function keyPick(ring: Ring): Pos { return { x: Math.cos(KEY_ANGLE) * ring.rc, y: Math.sin(KEY_ANGLE) * ring.rc }; }

/** how loud each ring is: how much of the pick's window overlaps it × the light there */
export function amplitudes(rings: Ring[], contacts: Pos[], bulb: boolean): number[] {
  const out = rings.map(() => 0);
  if (!rings.length) return out;
  const half = rings[0].pitch * 0.38;
  for (const p of contacts) {
    const r = Math.hypot(p.x, p.y), lum = light(p, bulb);
    rings.forEach((g, i) => {
      const ov = Math.min(r + half, g.r1) - Math.max(r - half, g.r0);
      if (ov > 0) out[i] = Math.min(1, out[i] + (ov / Math.min(2 * half, g.w)) * lum);
    });
  }
  return out;
}

/** square-ish light pulses: odd harmonics, rounded off by the pick's window over the hole */
export function ringWave(g: Ring, count = 64): Harmonics {
  const re = new Float32Array(count), im = new Float32Array(count);
  const win = Math.min(0.45, (g.pitch * 0.25) / (2 * Math.PI * g.rc / g.N));
  for (let k = 1; k < count; k += 2) { const s = Math.PI * k * win; im[k] = (4 / (Math.PI * k)) * (s ? Math.sin(s) / s : 1); }
  return { re, im };
}

export interface Reading { best: number; N: number; hz: number; name: string; oct: number; cents: number; also: string[] }

/** what the tuner shows: the loudest ring, plus any other ring sounding at least 30% as loud */
export function tune(rings: Ring[], amps: number[], rpm: number): Reading | null {
  let best = -1, bv = 0.03;
  amps.forEach((v, i) => { if (v > bv) { bv = v; best = i; } });
  if (best < 0) return null;
  const hz = fanHarpHz(rings[best].N, rpm);
  if (hz < 20) return null;   // too slow to hear, only clicks
  const nn = noteOf(hz), also: string[] = [];
  amps.forEach((v, i) => { if (i !== best && v > bv * 0.3) { const o = noteOf(fanHarpHz(rings[i].N, rpm)); also.push(o.name + o.oct); } });
  return { best, N: rings[best].N, hz, ...nn, also };
}

// ---------- discs made from notes ----------

/** the notes a ring can be set to, A2 to C6 */
export const NOTE_CHOICES: string[] = Array.from({ length: 84 - 45 + 1 }, (_, i) => { const m = 45 + i; return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1); });

export function noteHz(note: string): number {
  const m = /^(.+?)(-?\d+)$/.exec(note);
  const k = m ? NOTE_NAMES.indexOf(m[1] as (typeof NOTE_NAMES)[number]) : -1;
  if (!m || k < 0) return NaN;
  return 440 * Math.pow(2, ((Number(m[2]) + 1) * 12 + k - 69) / 12);
}

const FIT_RPM = [240, 1800] as const, FIT_HOLES = [4, 120] as const, HOME_RPM = 654;

/**
 * Hole counts are whole numbers, so most notes can only be hit closely, not exactly. Try every 強 speed in range,
 * round each ring to the nearest hole count, and keep the speed whose worst ring is closest to its note
 * (a little preference for the fan's usual 654 rpm breaks near-ties).
 */
export function fitDisc(notes: readonly string[]): { slots: number[]; rpm: number; cents: number[] } {
  const hz = notes.map(noteHz);
  let best = { slots: [] as number[], rpm: HOME_RPM, cents: [] as number[] }, score = Infinity;
  for (let rpm = FIT_RPM[0]; rpm <= FIT_RPM[1]; rpm++) {
    const slots = hz.map((f) => Math.round(f * 60 / rpm));
    if (slots.some((n) => n < FIT_HOLES[0] || n > FIT_HOLES[1])) continue;
    const cents = slots.map((n, i) => 1200 * Math.log2(fanHarpHz(n, rpm) / hz[i]));
    const s = Math.max(...cents.map(Math.abs)) + 0.002 * Math.abs(rpm - HOME_RPM);
    if (s < score) { score = s; best = { slots, rpm, cents }; }
  }
  return best;
}

// ---------- what the disc is tuned to ----------

/** just intonation within one octave: do re mi fa sol la ti, plus the flat seventh */
const JUST = new Set(["1/1", "9/8", "5/4", "4/3", "3/2", "5/3", "15/8", "16/9", "2/1"]);

function gcd(a: number, b: number): number { while (b) [a, b] = [b, a % b]; return a; }
function fraction(n: number, d: number) { const g = gcd(n, d); return [n / g, d / g] as const; }
/** fold a ratio into one octave, [1, 2) */
function folded(n: number, d: number) { while (n >= 2 * d) d *= 2; while (n < d) n *= 2; return fraction(n, d); }

export interface RingInfo { holes: number; ratio: string; name: string; oct: number; cents: number; hz: number }
export interface DiscScale { ref: number; just: boolean; rings: RingInfo[] }

/**
 * Each ring as a ratio to the disc's home ring, the one that makes the simplest ratios. Hole counts are the ratios:
 * a ring with 3/2 the holes of another sounds a fifth above it, at any speed. A disc is "just" when every ring
 * folds into the just scale.
 */
export function scaleOf(slots: readonly number[], rpm: number): DiscScale {
  let ref = slots[0], best = Infinity;
  for (const cand of slots) {
    const cost = slots.reduce((sum, h) => { const [n, d] = fraction(h, cand); return sum + n + d; }, 0);
    if (cost < best) { best = cost; ref = cand; }
  }
  const rings = slots.map((holes) => {
    const [n, d] = fraction(holes, ref), hz = fanHarpHz(holes, rpm), nn = noteOf(hz);
    return { holes, ratio: `${n}/${d}`, name: nn.name, oct: nn.oct, cents: nn.cents, hz };
  });
  const just = slots.every((h) => { const [n, d] = folded(h, ref); return JUST.has(`${n}/${d}`); });
  return { ref, just, rings };
}

// ---------- the motor ----------

/** spin-up: the motor gives little torque from standstill and more as it turns, so it creeps, then builds, then settles */
const SPIN_KICK = 30;      // rpm/s it can add from a standstill
const SPIN_GAIN = 1.6;     // how fast that grows with speed, per second
const SETTLE = 0.55;       // s, the last approach to the set speed
const COAST = 2.4;         // s, slowing down on its own

/** one step of the fan motor toward the set speed */
export function motorStep(rpm: number, target: number, dt: number): number {
  if (target > rpm) {
    const settle = (target - rpm) * (1 - Math.exp(-dt / SETTLE));
    const torque = (SPIN_KICK + SPIN_GAIN * rpm) * dt;
    return rpm + Math.min(settle, torque);
  }
  const next = rpm + (target - rpm) * (1 - Math.exp(-dt / COAST));
  return next < 0.3 && target === 0 ? 0 : next;
}
