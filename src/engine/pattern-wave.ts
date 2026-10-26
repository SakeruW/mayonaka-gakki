// Light/dark patterns turned into sound, shared by the fan harp (holes in a disc) and the CRT drums (stripes in a field).
// No React and no Web Audio in here, so it can be unit-tested.

export const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"] as const;

export interface Note { name: string; oct: number; cents: number }

export function noteOf(hz: number): Note {
  const m = 69 + 12 * Math.log2(hz / 440), r = Math.round(m);
  return { name: NOTE_NAMES[((r % 12) + 12) % 12], oct: Math.floor(r / 12) - 1, cents: Math.round((m - r) * 100) };
}

export function centsToRatio(cents: number): number { return Math.pow(2, cents / 1200); }

// ---------- fan harp ----------

/** Pitch of one ring: holes pass the pick holes × rpm / 60 times a second. */
export function fanHarpHz(holes: number, rpm: number): number { return holes * rpm / 60; }

// ---------- CRT ----------

/** Field timing. Lines per field include the blanking interval, where the screen is dark. */
export interface FieldStandard { label: string; field: number; lines: number; vis: number }

export const STANDARDS = {
  ntsc: { label: "60i", field: 60000 / 1001, lines: 262.5, vis: 240 },
  pal: { label: "50i", field: 50, lines: 312.5, vis: 288 },
} as const satisfies Record<string, FieldStandard>;

export type StandardId = keyof typeof STANDARDS;

/** Field rate after the V-HOLD bend. */
export function fieldHz(std: FieldStandard, bendCents = 0): number { return std.field * centsToRatio(bendCents); }

/** What the ear hears from n stripes: n cycles per visible part of the field, scaled up to the whole field. */
export function stripeHz(n: number, std: FieldStandard, bendCents = 0): number {
  return n * fieldHz(std, bendCents) * std.lines / std.vis;
}

// ---------- pattern → harmonics ----------

export interface Harmonics { re: Float32Array; im: Float32Array }

/**
 * DFT of one period of a brightness pattern, ready for `createPeriodicWave(re, im)`.
 * `gain(k)` shapes partial k (pickup roll-off etc.). Returns null for a flat pattern, which is silent.
 */
export function harmonics(pattern: ArrayLike<number>, count: number, gain: (k: number) => number = () => 1): Harmonics | null {
  const S = pattern.length;
  let mean = 0;
  for (let j = 0; j < S; j++) mean += pattern[j];
  mean /= S;
  const re = new Float32Array(count + 1), im = new Float32Array(count + 1);
  let energy = 0;
  for (let k = 1; k <= count; k++) {
    const wk = 2 * Math.PI * k / S;
    let c = 0, s = 0;
    for (let j = 0; j < S; j++) {
      const v = pattern[j] - mean;
      if (v) { c += v * Math.cos(wk * j); s += v * Math.sin(wk * j); }
    }
    const g = (2 / S) * gain(k);
    re[k] = c * g; im[k] = s * g;
    energy += re[k] * re[k] + im[k] * im[k];
  }
  return energy > 1e-7 ? { re, im } : null;
}

/**
 * The CRT pickup: the hand spans a few lines, which rounds the stripe edges,
 * and the glass couples like a small capacitor, which thins the lowest partials.
 */
export function crtPickupGain(k: number): number { return Math.exp(-Math.pow(k / 60, 2)) * Math.sqrt(k / (k + 6)); }
