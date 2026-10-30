// One shared AudioContext for the whole site, created on the first gesture.
// Instruments build their voices on it and tear them down on unmount; the context itself lives on,
// so React StrictMode's double effects never leave a second context playing.

let ctx: AudioContext | null = null;
let unlockBound = false;
let keepAwake: HTMLAudioElement | null = null;
/** the browser took the audio session we asked for, so the silent audio element isn't needed */
let hasSession = false;

/** Call from inside a user gesture. Creates the context the first time and resumes it after that. */
export function ensureAudio(): AudioContext | null {
  if (!ctx) {
    // no webkitAudioContext fallback: the instruments build their nodes with constructors (new GainNode(ac, …)),
    // which arrived in Safari together with the unprefixed AudioContext
    if (!window.AudioContext) return null;
    // these are instruments: on iPhones, play like a music app does, even with the ringer on silent (Safari 16.4+)
    hasSession = setAudioSession("playback");
    ctx = new AudioContext();
    bindUnlock();
  }
  if (ctx.state !== "running") void ctx.resume();
  playThroughSilentMode();
  return ctx;
}

export function audioContext(): AudioContext | null { return ctx; }

/**
 * Safari's audio session (16.4+): "playback" plays like a music app, through the ringer switch, but may not record;
 * "play-and-record" is needed while the mic is open. Elsewhere this does nothing. Says whether the browser took it.
 */
export function setAudioSession(type: "playback" | "play-and-record"): boolean {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (!session) return false;
  try { session.type = type; return true; } catch { return false; /* older Safari: the silent audio element below covers playback */ }
}

/**
 * iPhones mute Web Audio when the ringer switch is on silent, but not media elements. A silent looping audio element
 * moves the whole page into media playback, which also carries the Web Audio. It covers iPhones older than Safari 16.4
 * and in-app browsers where the audio session can't be asked for, and only those: where the session worked it would
 * just be a silent track in Now Playing. It has to start inside a gesture; it pauses while the page is hidden.
 */
function playThroughSilentMode() {
  if (hasSession) return;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  if (!ios) return;
  if (!keepAwake) {
    const rate = 8000, n = rate / 2, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);   // half a second of silence, as a WAV
    const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 2, true);
    keepAwake = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/wav" })));
    keepAwake.loop = true;
    keepAwake.setAttribute("playsinline", "");
    document.addEventListener("visibilitychange", () => { if (document.hidden) keepAwake?.pause(); });
  }
  if (keepAwake.paused && !document.hidden) keepAwake.play().catch(() => { /* not inside a gesture yet: the next touch tries again */ });
}

// Phones only unlock audio inside certain gestures, and for a finger that is the lift (pointerup, touchend), not the
// touch. Try on each of them; this also wakes a context iOS "interrupted" when the app went to the background.
function bindUnlock() {
  if (unlockBound) return;
  unlockBound = true;
  const resume = () => { if (ctx && ctx.state !== "running") void ctx.resume(); playThroughSilentMode(); };
  for (const n of ["pointerup", "touchend", "click", "keydown"]) window.addEventListener(n, resume, { passive: true });
}

// ---------- the way out ----------

let limiter: DynamicsCompressorNode | null = null;
const FADE = 0.03;   // s: an instrument fades out over this when it closes

/** in front of the speakers, shared by every instrument: a hard limiter, so nothing clips whichever is playing */
function masterBus(ac: AudioContext) {
  if (!limiter) {
    limiter = new DynamicsCompressorNode(ac, { threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.1 });
    limiter.connect(ac.destination);
  }
  return limiter;
}

export interface Output {
  /** connect the instrument's last stage here */
  node: GainNode;
  /** fade out, then call `then` to take the instrument's nodes apart: closing mid-note doesn't click */
  dispose(then?: () => void): void;
}

/** an instrument's way out to the speakers, at `gain` */
export function createOutput(ac: AudioContext, gain = 1): Output {
  const node = new GainNode(ac, { gain });
  node.connect(masterBus(ac));
  return {
    node,
    dispose(then) {
      const t = ac.currentTime, g = node.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + FADE);
      setTimeout(() => { node.disconnect(); then?.(); }, FADE * 1000 + 50);
    },
  };
}

// ---------- the amp ----------

/** a tanh soft-clip curve for a WaveShaperNode: k = 1 is nearly clean, higher drives harder; ±1 stays ±1 */
export function tanhCurve(k: number, size = 1024): Float32Array<ArrayBuffer> {
  const c = new Float32Array(size);
  for (let i = 0; i < size; i++) { const x = i / (size - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}

/** tanh soft clip, 0 = nearly clean, 1 = heavily driven. */
export function driveCurve(drive: number, size = 1024) { return tanhCurve(1 + drive * 7, size); }

export interface Amp { input: GainNode; setDrive(drive: number): void; dispose(then?: () => void): void }

/** A small guitar amp: high-pass 40 Hz → tanh drive → low-pass 5.2 kHz → gain → compressor → speakers. */
export function createAmp(ac: AudioContext, drive = 0.45): Amp {
  const input = ac.createGain();
  const hp = new BiquadFilterNode(ac, { type: "highpass", frequency: 40 });
  // oversampled, so the drive's new harmonics above Nyquist don't fold back down
  const shaper = new WaveShaperNode(ac, { curve: driveCurve(drive), oversample: "2x" });
  const lp = new BiquadFilterNode(ac, { type: "lowpass", frequency: 5200, Q: 0.5 });
  const level = new GainNode(ac, { gain: 0.7 });
  const comp = new DynamicsCompressorNode(ac, { threshold: -14, ratio: 4, attack: 0.003, release: 0.15 });
  const out = createOutput(ac);
  input.connect(hp).connect(shaper).connect(lp).connect(level).connect(comp).connect(out.node);
  return {
    input,
    setDrive(d) { shaper.curve = driveCurve(d); },
    dispose(then) { out.dispose(() => { for (const n of [input, hp, shaper, lp, level, comp]) n.disconnect(); then?.(); }); },
  };
}
