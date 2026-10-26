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

/** a playback head hears the change in the tape's field, so its output fades away as the tape comes to a stop */
export function headOutput(s: number) { return Math.min(1, Math.abs(s) / 0.04); }

/** tape loses its top end as it slows: the head gap only resolves short wavelengths at speed */
export function toneHz(s: number) { return Math.max(180, Math.min(16000, 16000 * Math.pow(Math.abs(s), 0.9))); }

/** tape hiss rises with speed across the head */
export function hissLevel(s: number, contact: number) { return 0.006 * Math.min(1.5, Math.abs(s)) * Math.min(1, contact); }

// ---------- readouts ----------

/** what the tape is doing, in words */
export function tapeState(s: number, recording: boolean) { return recording ? "録音" : Math.abs(s) < 0.01 ? "停止" : s > 0 ? "再生" : "逆再生"; }
/** how fast, as a multiple of the speed it was recorded at; the direction is in tapeState */
export function speedText(s: number) { return Math.abs(s).toFixed(1) + "倍"; }
export function timeText(sec: number) { const m = Math.floor(sec / 60), r = sec - m * 60; return `${m}:${r.toFixed(1).padStart(4, "0")}`; }

// ---------- what is on the tape when the deck is switched on ----------

/** 20 bars at 100 bpm: 48 s of tape before it comes round again. Stored at 32 kHz; the head plays it at any rate. */
export const TAPE_RATE = 32000, TAPE_BPM = 100, TAPE_BARS = 20;
export const TAPE_SECONDS = TAPE_BARS * 4 * 60 / TAPE_BPM;

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * A short piece in four parts, synthesised so nothing borrowed is on the tape: kick, snare, hats, a soft-edged bass, and
 * sung "ah" lines (harmonics shaped by the formants of /a/), the kind of material that scratches well.
 *   bars 1-4   intro: the beat comes in a piece at a time over the bass
 *   bars 5-12  A: the full groove with the "ah" phrase
 *   bars 13-16 B: new chords, a longer sung line, busier hats
 *   bars 17-20 A': the groove again, the phrase answered higher, a snare fill to finish
 */
export function demoLoop(sr = TAPE_RATE): Float32Array {
  const beat = 60 / TAPE_BPM, n = Math.round(sr * TAPE_SECONDS), out = new Float32Array(n);
  let seed = 7;
  const noise = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const at = (bar: number, b: number) => Math.round(((bar - 1) * 4 + b) * beat * sr);
  const add = (start: number, dur: number, f: (t: number) => number) => {
    const len = Math.round(dur * sr);
    for (let i = 0; i < len; i++) out[(start + i) % n] += f(i / sr);
  };
  const kick = (bar: number, b: number, v = 0.9) => add(at(bar, b), 0.45, (t) => v * Math.exp(-7 * t) * Math.sin(2 * Math.PI * (48 * t + (110 / 30) * (1 - Math.exp(-30 * t)))));
  const snare = (bar: number, b: number, v = 1) => {
    let last = 0;
    add(at(bar, b), 0.3, (t) => { const w = noise(), hp = w - last; last = w; return v * Math.exp(-16 * t) * (0.38 * hp + 0.25 * Math.sin(2 * Math.PI * 185 * t) * Math.exp(-20 * t)); });
  };
  const hat = (bar: number, b: number, v = 0.12) => {
    let last = 0;
    add(at(bar, b), 0.06, (t) => { const w = noise(), hp = w - last; last = w; return v * Math.exp(-70 * t) * hp; });
  };
  const bass = (bar: number, b: number, m: number, beats: number) => {
    const f = midiHz(m), dur = beats * beat * 0.9;
    let y = 0;
    add(at(bar, b), dur, (t) => { const saw = 2 * ((f * t) % 1) - 1; y += 0.08 * (saw - y); return 0.5 * y * Math.min(1, t * 200) * Math.min(1, (dur - t) * 30); });
  };
  // "ah": harmonics of the sung note, each weighted by how close it sits to the /a/ formants
  const formant = (h: number) => Math.exp(-(((h - 730) / 120) ** 2)) + 0.7 * Math.exp(-(((h - 1090) / 140) ** 2)) + 0.25 * Math.exp(-(((h - 2440) / 220) ** 2));
  const ah = (bar: number, b: number, m: number, dur: number) => {
    const f0 = midiHz(m), parts: [number, number][] = [];
    for (let k = 1; k * f0 < 5000; k++) parts.push([k, (0.15 + formant(k * f0)) / k ** 0.6]);
    add(at(bar, b), dur, (t) => {
      const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t * 3), env = Math.min(1, t * 40) * Math.min(1, (dur - t) * 12);
      let x = 0;
      for (const [k, a] of parts) x += a * Math.sin(2 * Math.PI * k * f0 * vib * t);
      return 0.22 * env * x;
    });
  };

  // the groove, two bars at a time, as in the original loop
  const groove = (bar: number, { snares = true, hats = true, fill = false } = {}) => {
    for (const b of [0, 2, 3.5]) kick(bar, b);
    for (const b of [0, 2]) kick(bar + 1, b);
    if (!fill) kick(bar + 1, 3.5);
    if (snares) { for (const b of [1, 3]) { snare(bar, b); snare(bar + 1, b); } if (!fill) snare(bar + 1, 3.75); }
    if (hats) for (let b = 0; b < 8; b += 0.5) hat(bar + Math.floor(b / 4), b % 4);
    if (fill) for (const b of [3, 3.25, 3.5, 3.75]) snare(bar + 1, b, 0.6 + 0.15 * (b - 3) * 4);
  };
  // bass lines, one note a beat: C C E♭ F | G G B♭ C, and for B: A♭ A♭ B♭ B♭ | C C G G
  const lineA = [36, 36, 39, 41, 31, 31, 34, 36], lineB = [32, 32, 34, 34, 36, 36, 31, 31];
  const bassLine = (bar: number, line: number[]) => line.forEach((m, i) => bass(bar + Math.floor(i / 4), i % 4, m, 1));
  // the "ah" phrase: G4 on the and of 1, E♭4, F4, then C4 held; and its answer an octave-ish higher
  const phrase = (bar: number, up = 0) => {
    for (const [b, m, d] of [[0.5, 67, 0.4], [2.5, 63, 0.4], [4.5, 65, 0.4], [6.5, 60, 0.75]] as const) ah(bar + Math.floor(b / 4), b % 4, m + up, d);
  };

  // intro: bass and kick, then hats, then the full beat
  for (const bar of [1, 3]) bassLine(bar, lineA);
  for (const b of [0, 2]) { kick(1, b); kick(2, b); }
  for (let b = 0; b < 8; b += 0.5) hat(3 + Math.floor(b / 4), b % 4, 0.08);
  for (const b of [0, 2, 3.5]) kick(3, b);
  for (const b of [0, 2]) kick(4, b);
  snare(4, 3); snare(4, 3.5, 0.7);
  // A
  for (const bar of [5, 7, 9, 11]) { groove(bar); bassLine(bar, lineA); }
  for (const bar of [5, 9]) phrase(bar);
  phrase(7, 0); ah(12, 2, 72, 0.4);
  // B: the beat thins to kick and hats while a longer line sings over new chords
  for (const bar of [13, 15]) { groove(bar, { snares: bar === 15 }); bassLine(bar, lineB); }
  for (let b = 0; b < 16; b += 0.25) hat(13 + Math.floor(b / 4), b % 4, 0.05);
  for (const [bar, b, m, d] of [[13, 0, 68, 1.1], [13, 2, 67, 1.1], [14, 0, 65, 1.6], [15, 0, 63, 1.1], [15, 2, 65, 1.1], [16, 0, 67, 1.7]] as const) ah(bar, b, m, d);
  // A': the groove back, the phrase and then its answer up a fourth, a fill into the top of the tape
  for (const bar of [17, 19]) { groove(bar, { fill: bar === 19 }); bassLine(bar, lineA); }
  phrase(17); phrase(19, 5);

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
export const LEVER = { hingeX: 6.85, hingeY: 9.1, length: 2.95, tieAt: 1.35, rest: 0.87, min: 0.3, max: 1.42, gain: 3.2 } as const;
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
