// The playback head, on the audio thread: moves along the tape loop at the rate it is given, sample by sample,
// so a hand on the reel scrubs smoothly in both directions. When armed it records its input onto the tape.

import { runHead } from "../../engine/tape";

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor { readonly port: MessagePort; constructor(options?: unknown); }

interface Options { processorOptions: { tape: Float32Array; tapeRate: number } }

class TapeHeadProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "rate", defaultValue: 0, minValue: -64, maxValue: 64, automationRate: "a-rate" },
      { name: "contact", defaultValue: 1, minValue: 0, maxValue: 4, automationRate: "a-rate" },
      { name: "flutter", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  private tape: Float32Array;
  private step: number;       // tape samples per output sample at rate 1
  private state = { pos: 0, t: 0 };
  private recording = false;
  private sinceReport = 0;

  constructor(options: Options) {
    super();
    this.tape = options.processorOptions.tape;
    this.step = options.processorOptions.tapeRate / sampleRate;
    this.port.onmessage = (e: MessageEvent<{ record?: boolean }>) => { if (typeof e.data.record === "boolean") this.recording = e.data.record; };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>) {
    const out = outputs[0][0], rate = params.rate, contact = params.contact;
    runHead(this.state, this.tape, this.step, out, inputs[0]?.[0],
      (i) => (rate.length > 1 ? rate[i] : rate[0]), (i) => (contact.length > 1 ? contact[i] : contact[0]),
      params.flutter[0], this.recording, sampleRate);
    this.sinceReport += out.length;
    if (this.sinceReport >= 1024) { this.sinceReport = 0; this.port.postMessage({ pos: this.state.pos / (this.step * sampleRate) }); }
    return true;
  }
}

registerProcessor("tape-head", TapeHeadProcessor);
