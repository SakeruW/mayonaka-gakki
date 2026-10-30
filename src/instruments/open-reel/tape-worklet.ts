// The playback head, on the audio thread: the tape goes wherever the hand puts it, sample by sample, so a hand on the
// lever scrubs smoothly in both directions. When armed it records its input onto the tape.

import { Head, type HeadMessage } from "../../engine/tape";

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor { readonly port: MessagePort; constructor(options?: unknown); }

interface Options { processorOptions: { tape: Float32Array; tapeRate: number; start: number; lever: number } }

const REPORT_EVERY = 256;   // samples: often enough that the reel and the display move smoothly

class TapeHeadProcessor extends AudioWorkletProcessor {
  private head: Head;
  private tapeRate: number;
  private sinceReport = 0;

  constructor(options: Options) {
    super();
    const { tape, tapeRate, start, lever } = options.processorOptions;
    this.head = new Head(tape, tapeRate, sampleRate, start, lever);
    this.tapeRate = tapeRate;
    this.port.onmessage = (e: MessageEvent<HeadMessage>) => {
      if ("lever" in e.data) this.head.lever(...e.data.lever);
      else this.head.armed = e.data.armed;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0][0], h = this.head;
    h.run(out, inputs[0]?.[0]);
    this.sinceReport += out.length;
    if (this.sinceReport >= REPORT_EVERY) { this.sinceReport = 0; this.port.postMessage({ pos: h.pos / this.tapeRate, travel: h.travel, speed: h.speed }); }
    return true;
  }
}

registerProcessor("tape-head", TapeHeadProcessor);
