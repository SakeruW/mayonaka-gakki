// One shared AudioContext for the whole site, created on the first gesture.
// Instruments build their voices on it and tear them down on unmount; the context itself lives on,
// so React StrictMode's double effects never leave a second context playing.

let ctx: AudioContext | null = null;
let unlockBound = false;

/** Call from inside a user gesture. Creates the context the first time and resumes it after that. */
export function ensureAudio(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    bindUnlock();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function audioContext(): AudioContext | null { return ctx; }

// phones only unlock audio inside certain gestures; try on each of them
function bindUnlock() {
  if (unlockBound) return;
  unlockBound = true;
  const resume = () => { if (ctx && ctx.state === "suspended") void ctx.resume(); };
  for (const n of ["touchend", "click", "keydown"]) window.addEventListener(n, resume, { passive: true });
}

/** tanh soft clip, 0 = nearly clean, 1 = heavily driven. */
export function driveCurve(drive: number, size = 1024): Float32Array<ArrayBuffer> {
  const k = 1 + drive * 7, c = new Float32Array(size);
  for (let i = 0; i < size; i++) { const x = i / (size - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}

export interface Amp { input: GainNode; setDrive(drive: number): void; dispose(): void }

/** A small guitar amp: high-pass 40 Hz → tanh drive → low-pass 5.2 kHz → gain → compressor → speakers. */
export function createAmp(ac: AudioContext, drive = 0.45): Amp {
  const input = ac.createGain();
  const hp = new BiquadFilterNode(ac, { type: "highpass", frequency: 40 });
  const shaper = new WaveShaperNode(ac, { curve: driveCurve(drive) });
  const lp = new BiquadFilterNode(ac, { type: "lowpass", frequency: 5200, Q: 0.5 });
  const out = new GainNode(ac, { gain: 0.7 });
  const comp = new DynamicsCompressorNode(ac, { threshold: -14, ratio: 4, attack: 0.003, release: 0.15 });
  input.connect(hp).connect(shaper).connect(lp).connect(out).connect(comp).connect(ac.destination);
  return {
    input,
    setDrive(d) { shaper.curve = driveCurve(d); },
    dispose() { for (const n of [input, hp, shaper, lp, out, comp]) n.disconnect(); },
  };
}
