// Tape under a playback head: a loop of samples read at any speed, forwards or backwards, with an erase/record head
// writing ahead of it when armed. The maths lives here as plain functions; tape-worklet.ts runs them on the audio thread,
// and TapeHead drives that worklet from the main thread.

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

export interface TapeHeadOptions { tape: Float32Array; tapeRate: number }
export interface TapeHead {
  node: AudioWorkletNode;
  /** tape speed: 1 = recorded speed, negative = backwards */
  rate: AudioParam;
  /** how hard the tape presses on the head, 0 = lifted off */
  contact: AudioParam;
  /** capstan wobble, 0..1: on while the motor drives the tape */
  flutter: AudioParam;
  /** write whatever arrives at the node's input onto the tape */
  setRecording(on: boolean): void;
  /** where the head is on the tape, in tape seconds, updated a few dozen times a second */
  position(): number;
  dispose(): void;
}

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/** load the worklet once per AudioContext; StrictMode remounts and page changes reuse it */
export function loadTapeWorklet(ac: BaseAudioContext, url: string): Promise<void> {
  let p = loaded.get(ac);
  if (!p) { p = ac.audioWorklet.addModule(url); loaded.set(ac, p); }
  return p;
}

export function createTapeHead(ac: BaseAudioContext, { tape, tapeRate }: TapeHeadOptions): TapeHead {
  const node = new AudioWorkletNode(ac, "tape-head", {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    processorOptions: { tape, tapeRate },
  });
  let pos = 0;
  node.port.onmessage = (e: MessageEvent<{ pos: number }>) => { pos = e.data.pos; };
  const p = (name: string) => node.parameters.get(name)!;
  return {
    node, rate: p("rate"), contact: p("contact"), flutter: p("flutter"),
    setRecording(on) { node.port.postMessage({ record: on }); },
    position: () => pos,
    dispose() { node.port.onmessage = null; node.disconnect(); },
  };
}
