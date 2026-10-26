// Tape under a playback head: a loop of samples read at any speed, forwards or backwards, with a record head writing
// just before it when armed. The maths lives here as plain functions. The head runs them on the audio thread in an
// AudioWorklet (tape-worklet.ts); where worklets aren't allowed (plain-http pages, older browsers) the same head runs
// on the main thread in a ScriptProcessor instead, so the tape always sounds.

/** fold a position into [0, len) */
export function wrap(pos: number, len: number) { const p = pos % len; return p < 0 ? p + len : p; }

/** 4-point Hermite read between samples, so slow scrubs stay smooth instead of stepping */
export function readTape(tape: Float32Array, pos: number): number {
  const n = tape.length, p = wrap(pos, n), i = Math.floor(p), t = p - i;
  const y0 = tape[(i - 1 + n) % n], y1 = tape[i], y2 = tape[(i + 1) % n], y3 = tape[(i + 2) % n];
  const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + y1;
}

/** wow (slow) and flutter (fast) of a capstan-driven tape: a small speed wobble, as a multiplier near 1 */
export function wowFlutter(t: number, depth: number) {
  return 1 + depth * (0.0016 * Math.sin(2 * Math.PI * 0.55 * t) + 0.0006 * Math.sin(2 * Math.PI * 6.8 * t + 1.3));
}

/** what the record head writes: driven into tape saturation */
export function recordSample(x: number) { return Math.tanh(1.4 * x) * 0.8; }

/**
 * One head moving along a tape for one block of samples. Shared by both heads so they sound the same.
 * `rate`/`contact` give the value at each sample; `step` is tape samples per output sample at rate 1.
 */
export function runHead(state: { pos: number; t: number }, tape: Float32Array, step: number, out: Float32Array, input: Float32Array | undefined,
                        rate: (i: number) => number, contact: (i: number) => number, wobble: number, recording: boolean, sampleRate: number) {
  const n = tape.length;
  for (let i = 0; i < out.length; i++) {
    const r = rate(i) * (wobble ? wowFlutter(state.t, wobble) : 1), c = contact(i);
    if (recording && input && r > 0.05) tape[Math.floor(wrap(state.pos, n))] = recordSample(input[i]);
    out[i] = c ? readTape(tape, state.pos) * c : 0;
    state.pos = wrap(state.pos + r * step, n);
    state.t += 1 / sampleRate;
  }
}

export interface TapeHeadOptions { tape: Float32Array; tapeRate: number; workletUrl: string }
export interface TapeHead {
  /** the head's output; whatever is connected to its input is what it records */
  node: AudioNode;
  /** tape speed: 1 = recorded speed, negative = backwards; follows within a few ms */
  setRate(s: number): void;
  /** how hard the tape presses on the head, 0 = lifted off */
  setContact(c: number): void;
  /** a finger knocks the tape onto the head: a moment of hard contact, then back to `rest` */
  knock(peak: number, rest: number): void;
  /** capstan wobble: on while the motor drives the tape */
  setFlutter(on: boolean): void;
  setRecording(on: boolean): void;
  /** where the head is on the tape, in tape seconds */
  position(): number;
  /** "worklet" on the audio thread, "main" on the main thread */
  kind: "worklet" | "main";
  dispose(): void;
}

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/** the worklet head where the page may use one, else the main-thread head */
export async function createTapeHead(ac: AudioContext, opts: TapeHeadOptions): Promise<TapeHead> {
  if (ac.audioWorklet) {
    try {
      let p = loaded.get(ac);
      if (!p) { p = ac.audioWorklet.addModule(opts.workletUrl); loaded.set(ac, p); }
      await p;
      return workletHead(ac, opts);
    } catch { /* fall through to the main thread */ }
  }
  return mainThreadHead(ac, opts);
}

function workletHead(ac: AudioContext, { tape, tapeRate }: TapeHeadOptions): TapeHead {
  const node = new AudioWorkletNode(ac, "tape-head", {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    processorOptions: { tape, tapeRate },
  });
  let pos = 0;
  node.port.onmessage = (e: MessageEvent<{ pos: number }>) => { pos = e.data.pos; };
  const rate = node.parameters.get("rate")!, contact = node.parameters.get("contact")!, flutter = node.parameters.get("flutter")!;
  return {
    node, kind: "worklet",
    setRate(s) { rate.setTargetAtTime(s, ac.currentTime, 0.006); },
    setContact(c) { contact.setTargetAtTime(c, ac.currentTime, 0.02); },
    knock(peak, rest) { const t = ac.currentTime; contact.cancelScheduledValues(t); contact.setValueAtTime(peak, t); contact.setTargetAtTime(rest, t + 0.006, 0.035); },
    setFlutter(on) { flutter.setValueAtTime(on ? 1 : 0, ac.currentTime); },
    setRecording(on) { node.port.postMessage({ record: on }); },
    position: () => pos,
    dispose() { node.port.onmessage = null; node.disconnect(); },
  };
}

/** the same head on the main thread: a little more latency, but it works on any page */
function mainThreadHead(ac: AudioContext, { tape: source, tapeRate }: TapeHeadOptions): TapeHead {
  const tape = source.slice(), node = ac.createScriptProcessor(1024, 1, 1), sr = ac.sampleRate, step = tapeRate / sr;
  const state = { pos: 0, t: 0 };
  let rate = 0, rateTo = 0, contact = 1, contactTo = 1, contactTau = 0.02, wobble = 0, recording = false;
  const kRate = 1 - Math.exp(-1 / (sr * 0.006));
  node.onaudioprocess = (e) => {
    const kc = 1 - Math.exp(-1 / (sr * contactTau));
    runHead(state, tape, step, e.outputBuffer.getChannelData(0), e.inputBuffer.getChannelData(0),
      () => (rate += (rateTo - rate) * kRate), () => (contact += (contactTo - contact) * kc), wobble, recording, sr);
  };
  return {
    node, kind: "main",
    setRate(s) { rateTo = s; },
    setContact(c) { contactTo = c; contactTau = 0.02; },
    knock(peak, rest) { contact = peak; contactTo = rest; contactTau = 0.035; },
    setFlutter(on) { wobble = on ? 1 : 0; },
    setRecording(on) { recording = on; },
    position: () => state.pos / tapeRate,
    dispose() { node.onaudioprocess = null; node.disconnect(); },
  };
}
