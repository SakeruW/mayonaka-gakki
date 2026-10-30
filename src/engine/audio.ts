// One shared AudioContext for the whole site, created on the first gesture.
// Instruments build their voices on it and tear them down on unmount; the context itself lives on,
// so React StrictMode's double effects never leave a second context playing.

let ctx: AudioContext | null = null;
let unlockBound = false;
let keepAwake: HTMLAudioElement | null = null;

/** Call from inside a user gesture. Creates the context the first time and resumes it after that. */
export function ensureAudio(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    // these are instruments: on iPhones, play like a music app does, even with the ringer on silent (Safari 16.4+)
    setAudioSession("playback");
    ctx = new AC();
    bindUnlock();
  }
  if (ctx.state !== "running") void ctx.resume();
  playThroughSilentMode();
  return ctx;
}

export function audioContext(): AudioContext | null { return ctx; }

/**
 * Safari's audio session (16.4+): "playback" plays like a music app, through the ringer switch, but may not record;
 * "play-and-record" is needed while the mic is open. Elsewhere this does nothing.
 */
export function setAudioSession(type: "playback" | "play-and-record") {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) { try { session.type = type; } catch { /* older Safari: the silent audio element below covers playback */ } }
}

/**
 * iPhones mute Web Audio when the ringer switch is on silent, but not media elements. A silent looping audio element
 * moves the whole page into media playback, which also carries the Web Audio. It covers iPhones older than Safari 16.4
 * and in-app browsers where the audio session can't be asked for. It has to start inside a gesture; it pauses while
 * the page is hidden.
 */
function playThroughSilentMode() {
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
