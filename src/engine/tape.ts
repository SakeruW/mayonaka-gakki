// Tape under a playback head: a loop of samples, and a head that goes wherever the hand puts the tape. The hand gives
// a place on the tape, not a speed, so rocking back and forth comes back to the same sound every time; the speed is
// whatever it takes to get there, worked out sample by sample on the audio thread. The maths lives here as a plain
// class. It runs on the audio thread in an AudioWorklet (tape-worklet.ts); where worklets aren't allowed (plain-http
// pages, older browsers) the same head runs on the main thread in a ScriptProcessor instead, so the tape always sounds.

/** fold a position into [0, len) */
export function wrap(pos: number, len: number) { const p = pos % len; return p < 0 ? p + len : p; }

/** 4-point Hermite read between samples, so slow scrubs stay smooth instead of stepping */
export function readTape(tape: Float32Array, pos: number): number {
  const n = tape.length, p = wrap(pos, n), i = Math.floor(p), t = p - i;
  const y0 = tape[(i - 1 + n) % n], y1 = tape[i], y2 = tape[(i + 1) % n], y3 = tape[(i + 2) % n];
  const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + y1;
}

/** what the record head writes: driven into tape saturation */
export function recordSample(x: number) { return Math.tanh(1.4 * x) * 0.8; }

/** a playback head hears the change in the tape's field, so its output fades away as the tape comes to a stop */
export function headOutput(s: number) { return Math.min(1, Math.abs(s) / 0.04); }

/** tape loses its top end as it slows: the head gap only resolves short wavelengths at speed */
export function toneHz(s: number) { return Math.max(180, Math.min(16000, 16000 * Math.pow(Math.abs(s), 0.9))); }

/** tape hiss rises with speed across the head */
export function hissLevel(s: number) { return 0.006 * Math.min(1.5, Math.abs(s)); }

const FOLLOW = 0.004;      // s: the tape takes up the lever's movement this softly, rounding off each hand movement
const MONITOR = 0.02;      // s: the monitor fades this fast as recording starts and stops
const RECORD_MIN = 0.05;   // × recorded speed: slower than this the record head writes nothing
/** two one-pole filters in a row are 3 dB down at this fraction of each one's own cutoff */
const CASCADE = 0.6436;

/**
 * The head and the tape under it. `lever()` says where the hand has put the tape; `run()` moves the tape there and
 * plays (or records) one block.
 */
export class Head {
  /** where the head is on the loop, in tape samples */
  pos: number;
  /** tape seconds moved in all, forwards minus backwards: what turns the reel */
  travel = 0;
  /** × recorded speed, negative backwards */
  speed = 0;
  /** records what reaches it while the tape runs forward */
  armed = false;

  private x: number; private to: number; private slope = 0; private left = 0;   // where the hand has the tape, ramping toward `to`
  private y: number;                                                             // the tape at the head, following x
  private monitor = 1;
  private lp1 = 0; private lp2 = 0;     // the playback tone
  private rc1 = 0; private rc2 = 0;     // the record path's top end
  private lastIn = 0;
  private seed = 22222; private lastNoise = 0;
  private readonly kFollow: number; private readonly kMonitor: number;

  /** `start` is where on the tape the head sits and `lever` where the hand has the tape, both in tape seconds */
  constructor(readonly tape: Float32Array, private readonly tapeRate: number, private readonly sampleRate: number, start = 0, lever = 0) {
    this.pos = wrap(start * tapeRate, tape.length);
    this.x = this.to = this.y = lever;
    this.kFollow = 1 - Math.exp(-1 / (sampleRate * FOLLOW));
    this.kMonitor = 1 - Math.exp(-1 / (sampleRate * MONITOR));
  }

  /** the hand now has the tape at `to` tape seconds: get there in a straight line over `seconds` */
  lever(to: number, seconds: number) {
    const n = Math.max(1, Math.round(seconds * this.sampleRate));
    this.to = to; this.left = n; this.slope = (to - this.x) / n;
  }

  /** one block: `out` gets what the head hears, and while armed and running forward `input` goes onto the tape */
  run(out: Float32Array, input?: Float32Array) {
    const { tape, tapeRate, sampleRate: sr } = this, n = tape.length, w = 2 * Math.PI / sr;
    for (let i = 0; i < out.length; i++) {
      if (this.left > 0) { this.x += this.slope; if (--this.left === 0) this.x = this.to; }
      const y0 = this.y;
      this.y += (this.x - this.y) * this.kFollow;
      const d = this.y - y0, s = d * sr, p0 = this.pos, p1 = p0 + d * tapeRate;
      this.speed = s; this.travel += d;

      const writing = this.armed && !!input && s > RECORD_MIN;
      if (this.armed && input) {
        // what the tape can hold at this speed: its samples go by at tapeRate × s, so keep below that Nyquist
        const k = 1 - Math.exp(-w * Math.min(0.45 * sr, 0.4 * tapeRate * Math.max(s, RECORD_MIN)) / CASCADE);
        this.rc1 += (input[i] - this.rc1) * k; this.rc2 += (this.rc1 - this.rc2) * k;
        // the head wipes and writes every tape sample it crosses, so nothing old is left between the new ones
        if (writing) {
          for (let j = Math.floor(p0) + 1; j <= p1; j++) {
            const f = (j - p0) / (p1 - p0);
            tape[((j % n) + n) % n] = recordSample(this.lastIn + (this.rc2 - this.lastIn) * f);
          }
        }
        this.lastIn = this.rc2;
      }
      this.pos = wrap(p1, n);

      // playback: the head's output, the tape's top end at this speed, and hiss; muted while recording, so the
      // speakers can't feed back into the mic
      const kt = 1 - Math.exp(-w * toneHz(s) / CASCADE);
      this.lp1 += (readTape(tape, this.pos) * headOutput(s) - this.lp1) * kt; this.lp2 += (this.lp1 - this.lp2) * kt;
      const noise = (this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0) / 2147483648 - 1;
      const hiss = (noise - this.lastNoise) * 0.5 * hissLevel(s);   // differenced: tilted up, as tape hiss is
      this.lastNoise = noise;
      this.monitor += ((writing ? 0 : 1) - this.monitor) * this.kMonitor;
      out[i] = (this.lp2 + hiss) * this.monitor;
    }
  }
}

export interface Readout { pos: number; travel: number; speed: number }
export interface TapeHeadOptions {
  tape: Float32Array; tapeRate: number; workletUrl: string;
  /** asked once the head is about to start: where it sits on the tape and where the hand has it, in tape seconds */
  at: () => { start: number; lever: number };
}
export interface TapeHead {
  /** the head's output; whatever is connected to its input is what it records */
  node: AudioNode;
  /** the hand now has the tape at `to` tape seconds: the tape gets there in a straight line over `seconds` */
  lever(to: number, seconds: number): void;
  setArmed(on: boolean): void;
  /**
   * where the tape is (pos, in tape seconds on the loop), how far it has gone since the head started, and how fast;
   * null until the audio has actually started running the head
   */
  readout(): Readout | null;
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

export type HeadMessage = { lever: [number, number] } | { armed: boolean };

function workletHead(ac: AudioContext, { tape, tapeRate, at }: TapeHeadOptions): TapeHead {
  const { start, lever } = at();
  const node = new AudioWorkletNode(ac, "tape-head", {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    processorOptions: { tape, tapeRate, start, lever },
  });
  let last: Readout | null = null;
  node.port.onmessage = (e: MessageEvent<Readout>) => { last = e.data; };
  const send = (m: HeadMessage) => node.port.postMessage(m);
  return {
    node, kind: "worklet",
    lever(to, seconds) { send({ lever: [to, seconds] }); },
    setArmed(on) { send({ armed: on }); },
    readout: () => last,
    dispose() { node.port.onmessage = null; node.disconnect(); },
  };
}

/** the same head on the main thread: a little more latency, but it works on any page */
function mainThreadHead(ac: AudioContext, { tape, tapeRate, at }: TapeHeadOptions): TapeHead {
  const BLOCK = 1024, node = ac.createScriptProcessor(BLOCK, 1, 1), { start, lever } = at();
  const head = new Head(tape.slice(), tapeRate, ac.sampleRate, start, lever);
  let ran = false;
  node.onaudioprocess = (e) => { head.run(e.outputBuffer.getChannelData(0), e.inputBuffer.getChannelData(0)); ran = true; };
  return {
    node, kind: "main",
    // a block runs at once, so a ramp shorter than a block would arrive as a jump and a wait
    lever(to, seconds) { head.lever(to, Math.max(seconds, BLOCK / ac.sampleRate)); },
    setArmed(on) { head.armed = on; },
    readout: () => (ran ? { pos: head.pos / tapeRate, travel: head.travel, speed: head.speed } : null),
    dispose() { node.onaudioprocess = null; node.disconnect(); },
  };
}
