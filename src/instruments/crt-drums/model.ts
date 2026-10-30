// The picture is the sound: each set paints a picture, and the hand's pickup reads it one field at a time,
// line by line, including the dark blanking lines. That brightness profile, repeated every field, is the waveform.

import { crtPickupGain, fieldHz, harmonics, loudnessMatch, stripeHz, type FieldStandard, type Harmonics } from "../../engine/pattern-wave";

export type Mode = "stripes" | "text";
export type RGB = [number, number, number];
export interface Pos { x: number; y: number }

/**
 * The sets, top row first; colours from the reference photo. Stripe counts are whole numbers, so every note is a
 * harmonic of the field (≈ 65.6 Hz on 60i): these six are the harmonics that land within 10¢ of a note, each a
 * different one, bottom shelf C4 E4 G4 and top shelf D5 B5 A6.
 */
export const SETS = [
  { n: 9, hue: "#2d5cff", hi: "#a8d8ff", key: "q" },
  { n: 15, hue: "#ff3d14", hi: "#ffd86b", key: "w" },
  { n: 27, hue: "#1fc4ec", hi: "#d6f7ff", key: "e" },
  { n: 4, hue: "#1fc4ec", hi: "#d6f7ff", key: "a" },
  { n: 5, hue: "#ff3d14", hi: "#ffd86b", key: "s" },
  { n: 6, hue: "#2d5cff", hi: "#a8d8ff", key: "d" },
] as const;

/** offscreen picture size */
export const PW = 320, PH = 240;
export const MAX_STRIPES = 32;
export const HARMONICS = 128;
/** how wide the pickup listens across a line, as a fraction of the screen */
const PICKUP_SIGMA = 0.2;

export function clampStripes(n: number) { return Math.max(1, Math.min(MAX_STRIPES, n)); }

export function rgb(hex: string): RGB { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function mix(a: RGB, b: RGB, t: number) { return "rgb(" + a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(",") + ")"; }

/** what every set shows in text mode */
export const SCREEN_TEXT = "強";

export function charsOf(text: string) { return Array.from(text.trim()); }
export function charFor(text: string, i: number) { const c = charsOf(text); return c.length ? c[i % c.length] : ""; }

export interface Picture { i: number; n: number; hue: RGB; hi: RGB }

/** stripes with soft bright cores and tinted gaps, or one big letter */
export function paintPicture(c: CanvasRenderingContext2D, tv: Picture, mode: Mode, ch: string) {
  const { hue, hi } = tv, black: RGB = [0, 0, 0];
  c.fillStyle = mix([16, 18, 20], hue, 0.13); c.fillRect(0, 0, PW, PH);
  if (mode === "stripes") {
    const band = PH / (2 * tv.n);
    for (let b = 0; b < tv.n; b++) {
      const y0 = 2 * b * band, y1 = y0 + band * 1.1;
      const r = Math.sin((b + 1) * 12.9898 + tv.i * 78.233) * 43758.5453, k = 0.82 + 0.18 * (r - Math.floor(r));
      const g = c.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, mix(hue, black, 1 - 0.7 * k)); g.addColorStop(0.5, mix(hue, hi, 0.6 * k)); g.addColorStop(1, mix(hue, black, 1 - 0.7 * k));
      c.fillStyle = g; c.fillRect(0, Math.round(y0), PW, Math.round(y1) - Math.round(y0));
    }
  } else if (ch) {
    const face = "px 'Dela Gothic One', 'Hiragino Sans', 'Yu Gothic', sans-serif";
    let size = PH * 0.8;
    c.textAlign = "center"; c.textBaseline = "middle"; c.font = size + face;
    const m = c.measureText(ch).width;
    if (m > PW * 0.86) { size *= PW * 0.86 / m; c.font = size + face; }
    const gt = c.createLinearGradient(0, PH * 0.1, 0, PH * 0.9);
    gt.addColorStop(0, mix(hue, black, 0.15)); gt.addColorStop(0.5, mix(hue, hi, 0.6)); gt.addColorStop(1, mix(hue, black, 0.15));
    c.fillStyle = gt; c.fillText(ch, PW / 2, PH / 2 + size * 0.04);
  }
}

/**
 * One field as the pickup hears it: each line's brightness, weighted toward the hand's horizontal position,
 * then the dark blanking lines. In text mode only the visible lines count: the letter is one cycle of the wave.
 * `rgba` is the PW×PH picture.
 */
export function profileOf(rgba: ArrayLike<number>, std: FieldStandard, mode: Mode, profX: number): Float32Array {
  const S = Math.round(std.lines * 2), V = std.vis * 2, p = new Float32Array(S);
  const w = new Float32Array(PW), rows = new Float32Array(PH);
  let ws = 0;
  for (let c = 0; c < PW; c++) { const dx = (c + 0.5) / PW - profX; w[c] = Math.exp(-dx * dx / (2 * PICKUP_SIGMA * PICKUP_SIGMA)); ws += w[c]; }
  for (let r = 0; r < PH; r++) {
    let s = 0;
    const o = r * PW * 4;
    for (let c = 0; c < PW; c++) s += w[c] * (0.3 * rgba[o + c * 4] + 0.59 * rgba[o + c * 4 + 1] + 0.11 * rgba[o + c * 4 + 2]);
    rows[r] = s / (ws * 255);
  }
  for (let j = 0; j < V; j++) p[j] = rows[Math.min(PH - 1, Math.floor(j * PH / V))];
  return mode === "text" ? p.subarray(0, V) : p;
}

/** how loud every set sounds, A-weighted RMS, whatever its picture: stripes and letters, few stripes or many */
export const LOUDNESS = 0.22;

/**
 * The wave the pickup hears from one profile played at f0 Hz: its harmonics shaped by the pickup (by frequency, so both
 * modes are treated alike), then levelled so every picture sounds equally loud. Null for a flat picture.
 */
export function waveOf(profile: Float32Array, f0: number): Harmonics | null {
  const h = harmonics(profile, HARMONICS, (k) => crtPickupGain(k * f0));
  return h && loudnessMatch(h, f0, LOUDNESS);
}

/**
 * The oscillator rate. In stripe mode it runs at the field rate and the stripes carry the pitch;
 * in text mode the letter is one cycle, played at the set's stripe note.
 */
export function oscHz(mode: Mode, n: number, std: FieldStandard, bend: number) {
  return mode === "text" ? stripeHz(n, std, bend) : fieldHz(std, bend);
}

/** a hand near the middle of the glass couples a little better */
export function handLevel(hand: Pos) {
  const dx = hand.x - 0.5, dy = hand.y - 0.5;
  return 0.24 * (0.75 + 0.25 * Math.max(0, 1 - 2 * Math.hypot(dx, dy)));
}
