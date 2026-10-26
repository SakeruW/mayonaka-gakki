// The playback head, on the audio thread: moves along the tape loop at the rate it is given, sample by sample,
// so a hand on the reel scrubs smoothly in both directions. When armed it records its input onto the tape.

import { readTape, wowFlutter, wrap } from "../../engine/tape";

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
  private pos = 0;            // in tape samples
  private t = 0;              // seconds, for the wobble
  private recording = false;
  private sinceReport = 0;

  constructor(options: Options) {
    super();
    this.tape = options.processorOptions.tape;
    this.step = options.processorOptions.tapeRate / sampleRate;
    this.port.onmessage = (e: MessageEvent<{ record?: boolean }>) => { if (typeof e.data.record === "boolean") this.recording = e.data.record; };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>) {
    const out = outputs[0][0], input = inputs[0]?.[0], tape = this.tape, n = tape.length;
    const rate = params.rate, contact = params.contact, wobble = params.flutter[0];
    for (let i = 0; i < out.length; i++) {
      const r = (rate.length > 1 ? rate[i] : rate[0]) * (wobble ? wowFlutter(this.t, wobble) : 1);
      const c = contact.length > 1 ? contact[i] : contact[0];
      // the record head sits just before the playback head: what it writes is heard a moment later
      if (this.recording && input && r > 0.05) tape[Math.floor(wrap(this.pos, n))] = Math.tanh(1.4 * input[i]) * 0.8;
      out[i] = c ? readTape(tape, this.pos) * c : 0;
      this.pos = wrap(this.pos + r * this.step, n);
      this.t += 1 / sampleRate;
    }
    this.sinceReport += out.length;
    if (this.sinceReport >= 1024) { this.sinceReport = 0; this.port.postMessage({ pos: this.pos / (this.step * sampleRate) }); }
    return true;
  }
}

registerProcessor("tape-head", TapeHeadProcessor);
