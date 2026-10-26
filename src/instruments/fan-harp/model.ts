// Light through the spinning disc: each ring of holes chops the bulb's light at holes × rpm / 60,
// and the Light-Pick's photocell hears every ring it overlaps, as loud as the light where it sits.

import { centsToRatio, fanHarpHz, noteOf, type Harmonics } from "../../engine/pattern-wave";

export interface Pos { x: number; y: number }
export interface Ring { N: number; r0: number; r1: number; rc: number; pitch: number; w: number }

export const PRESETS = [
  { id: "blade", label: "ハ調8輪", slots: [18, 24, 27, 30, 32, 36, 40, 48], rpm: 654 },
  { id: "kira", label: "Kira Killer", slots: [30, 36, 40, 45, 48, 53, 60, 64], rpm: 1762 },
  { id: "penta", label: "五音5輪", slots: [24, 27, 30, 36, 40], rpm: 654 },
] as const;

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

export const MAX_RINGS = 9, MAX_HOLES = 200, MIN_RPM = 30, MAX_RPM = 3000;

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

/** "18, 24 27" → [18, 24, 27]; null unless 1–9 whole numbers from 1 to 200 */
export function parseSlots(text: string): number[] | null {
  const parts = text.split(/[\s,、，]+/).filter(Boolean).map(Number);
  if (!parts.length || parts.length > MAX_RINGS || parts.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_HOLES)) return null;
  return parts;
}

export function parseRpm(text: string): number | null {
  const v = Math.round(Number(text));
  return v >= MIN_RPM && v <= MAX_RPM ? v : null;
}
