// The running rack: pictures, tubes, the hand on the glass and one voice per set into a small guitar amp.
// Everything per-frame lives here, outside React. The view hands in settings and hears back when a set starts or stops sounding.

import { createAmp, ensureAudio, type Amp } from "../../engine/audio";
import { onFrame } from "../../engine/loop";
import { STANDARDS, fieldHz, noteOf, stripeHz, type Harmonics, type StandardId } from "../../engine/pattern-wave";
import { PH, PW, SETS, charFor, handLevel, oscHz, paintPicture, profileOf, rgb, waveOf, type Mode, type Pos, type RGB } from "./model";
import { createTube, type Tube } from "./tube";

export interface RigSettings { mode: Mode; text: string; std: StandardId; bend: number; drive: number; stripes: number[] }

interface Tv {
  i: number; n: number; hue: RGB; hi: RGB;
  root: HTMLElement; screen: HTMLElement; osd: HTMLElement; tube: Tube;
  pic: HTMLCanvasElement; pctx: CanvasRenderingContext2D;
  touches: Map<string, Pos>; hand: Pos; profX: number; coef: Harmonics | null;
  voice: { osc: OscillatorNode; g: GainNode } | null;
  glow: number; zap: number; osdT: number; power: number; snow: number; crawl: number; crawlV: number;
}

function hold(p: AudioParam, t: number) { if ("cancelAndHoldAtTime" in p) p.cancelAndHoldAtTime(t); else (p as AudioParam).cancelScheduledValues(t); }

export class CrtRig {
  private tvs: Tv[];
  private s: RigSettings;
  private amp: Amp | null = null;
  private ac: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private roll = 0;
  private kick = 0;
  private pointers = new Map<number, number>();   // pointerId -> set
  private cleanup: (() => void)[] = [];
  private reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  private alive = true;

  constructor(rack: HTMLElement, settings: RigSettings, private onSound: (set: number, sounding: boolean) => void) {
    this.s = { ...settings, stripes: settings.stripes.slice() };
    this.tvs = Array.from(rack.querySelectorAll<HTMLElement>(".tv"), (root, i) => {
      const pic = document.createElement("canvas");
      pic.width = PW; pic.height = PH;
      const s = SETS[i];
      return {
        i, n: this.s.stripes[i], hue: rgb(s.hue), hi: rgb(s.hi),
        root, screen: root.querySelector<HTMLElement>(".screen")!, osd: root.querySelector<HTMLElement>(".osd")!,
        tube: createTube(root.querySelector("canvas")!),
        pic, pctx: pic.getContext("2d", { willReadFrequently: true })!,
        touches: new Map(), hand: { x: 0.5, y: 0.5 }, profX: 0.5, coef: null, voice: null,
        glow: 0, zap: 0, osdT: 0, power: -0.3 - i * 0.14, snow: 0, crawl: Math.random(), crawlV: (i % 2 ? -1 : 1) * (0.02 + 0.01 * (i % 3)),
      };
    });
    this.tvs.forEach((tv) => this.refresh(tv));
    if (this.s.mode === "text") this.afterFonts();
    this.bindInput(rack);
    this.cleanup.push(onFrame(this.frame));
  }

  // ---------- settings from the view ----------
  update(next: RigSettings) {
    const prev = this.s;
    this.s = { ...next, stripes: next.stripes.slice() };
    if (next.mode !== prev.mode) {
      this.tvs.forEach((tv) => { tv.profX = 0.5; tv.snow = 1; });
      this.refreshAll(); this.retuneAll();
      if (next.mode === "text") this.afterFonts();
    } else if (next.text !== prev.text && next.mode === "text") {
      this.refreshAll(); this.afterFonts();
    }
    if (next.std !== prev.std) {
      this.kick = 1; this.tvs.forEach((tv) => { tv.snow = 0.7; });
      this.refreshAll(); this.retuneAll();
    }
    if (next.bend !== prev.bend) this.retuneAll();
    if (next.drive !== prev.drive) this.amp?.setDrive(next.drive);
    next.stripes.forEach((n, i) => { if (n !== prev.stripes[i]) this.stripesChanged(this.tvs[i], n); });
  }

  private stripesChanged(tv: Tv, n: number) {
    tv.n = n;
    if (this.s.mode === "stripes") { tv.snow = 1; this.refresh(tv); tv.osd.textContent = n + "本"; }
    else { this.retuneAll(); this.reprofile(tv); const nn = noteOf(stripeHz(n, STANDARDS[this.s.std], this.s.bend)); tv.osd.textContent = nn.name + nn.oct; }
    tv.osd.classList.add("show"); tv.osdT = 1.4;
  }

  // ---------- picture -> sound ----------
  private refresh(tv: Tv) {
    paintPicture(tv.pctx, tv, this.s.mode, charFor(this.s.text, tv.i));
    tv.tube.upload(tv.pic);
    this.reprofile(tv);
  }
  private reprofile(tv: Tv) {
    const data = tv.pctx.getImageData(0, 0, PW, PH).data;
    const std = STANDARDS[this.s.std];
    tv.coef = waveOf(profileOf(data, std, this.s.mode, tv.profX), oscHz(this.s.mode, tv.n, std, 0));
    this.applyWave(tv);
  }
  private refreshAll() { this.tvs.forEach((tv) => this.refresh(tv)); }
  private afterFonts() {
    const redo = () => { if (this.alive) this.refreshAll(); };
    if (document.fonts?.load) document.fonts.load("40px 'Dela Gothic One'", this.s.text || "強").then(redo, redo);
  }

  // ---------- audio ----------
  private ensureVoices() {
    const ac = ensureAudio();
    if (!ac || this.amp) return;
    this.ac = ac;
    this.amp = createAmp(ac, this.s.drive);
    this.noise = ac.createBuffer(1, Math.round(ac.sampleRate * 0.12), ac.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    for (const tv of this.tvs) {
      const osc = new OscillatorNode(ac, { frequency: this.oscHz(tv) }), g = new GainNode(ac, { gain: 0 });
      osc.connect(g).connect(this.amp.input); osc.start();
      tv.voice = { osc, g };
      this.applyWave(tv);
    }
  }
  private oscHz(tv: Tv) { return oscHz(this.s.mode, tv.n, STANDARDS[this.s.std], this.s.bend); }
  private applyWave(tv: Tv) {
    if (!this.ac || !tv.voice) return;
    // levelled in waveOf already, so the browser mustn't normalise it again
    if (tv.coef) tv.voice.osc.setPeriodicWave(this.ac.createPeriodicWave(tv.coef.re, tv.coef.im, { disableNormalization: true }));
    if (tv.touches.size) this.setLevel(tv, 0.01);
  }
  private setLevel(tv: Tv, tau: number) {
    if (!this.ac || !tv.voice) return;
    const t = this.ac.currentTime, level = tv.coef && tv.touches.size ? handLevel(tv.hand) : 0;
    hold(tv.voice.g.gain, t); tv.voice.g.gain.setTargetAtTime(level, t, tau);
  }
  private retuneAll() {
    const ac = this.ac;
    if (ac) this.tvs.forEach((tv) => tv.voice?.osc.frequency.setTargetAtTime(this.oscHz(tv), ac.currentTime, 0.02));
  }
  /** the static crack as a hand lands */
  private zap() {
    const ac = this.ac;
    if (!ac || !this.noise || !this.amp) return;
    const t = ac.currentTime, src = new AudioBufferSourceNode(ac, { buffer: this.noise });
    const f = new BiquadFilterNode(ac, { type: "highpass", frequency: 1500 }), g = new GainNode(ac, { gain: 0.0001 });
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(f).connect(g).connect(this.amp.input); src.start(t); src.stop(t + 0.1);
  }

  // ---------- touching the glass ----------
  /** a hand (or key) on set i; call from inside the gesture so audio can start */
  press(i: number, id: string, pos: Pos) { this.ensureVoices(); this.touch(this.tvs[i], id, pos); }
  release(i: number, id: string) { this.lift(this.tvs[i], id); }

  private touch(tv: Tv, id: string, pos: Pos) {
    const first = tv.touches.size === 0;
    tv.touches.set(id, pos); tv.hand = pos;
    if (this.s.mode === "text" && Math.abs(pos.x - tv.profX) > 0.04) { tv.profX = pos.x; this.reprofile(tv); }
    if (first) { tv.zap = 1; this.zap(); this.setLevel(tv, 0.004); tv.root.classList.add("lit"); this.onSound(tv.i, true); }
  }
  private lift(tv: Tv, id: string) {
    if (!tv.touches.delete(id)) return;
    if (!tv.touches.size) { this.setLevel(tv, 0.025); tv.root.classList.remove("lit"); this.onSound(tv.i, false); }
  }
  releaseAll() {
    this.tvs.forEach((tv) => Array.from(tv.touches.keys()).forEach((id) => this.lift(tv, id)));
    this.pointers.clear();
  }

  private bindInput(rack: HTMLElement) {
    const posIn = (tv: Tv, e: PointerEvent): Pos => {
      const b = tv.screen.getBoundingClientRect();
      return { x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)), y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)) };
    };
    const screenAt = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".screen");
      return el && rack.contains(el) ? this.tvs[Number(el.dataset.i)] : null;
    };
    const down = (e: PointerEvent) => {
      const sc = (e.target as Element).closest?.<HTMLElement>(".screen");
      if (!sc) return;
      e.preventDefault(); this.ensureVoices();
      try { sc.releasePointerCapture(e.pointerId); } catch { /* let a finger slide onto the next set */ }
      const tv = this.tvs[Number(sc.dataset.i)];
      this.pointers.set(e.pointerId, tv.i); this.touch(tv, "p" + e.pointerId, posIn(tv, e));
    };
    const move = (e: PointerEvent) => {
      const at = this.pointers.get(e.pointerId);
      if (at === undefined) return;
      const cur = this.tvs[at], tv = screenAt(e), id = "p" + e.pointerId;
      if (tv === cur) { this.touch(cur, id, posIn(cur, e)); return; }
      this.lift(cur, id);
      if (tv) { this.pointers.set(e.pointerId, tv.i); this.touch(tv, id, posIn(tv, e)); } else this.pointers.delete(e.pointerId);
    };
    const end = (e: PointerEvent) => {
      const at = this.pointers.get(e.pointerId);
      if (at === undefined) return;
      this.lift(this.tvs[at], "p" + e.pointerId); this.pointers.delete(e.pointerId);
    };
    const menu = (e: Event) => { if ((e.target as Element).closest?.(".screen")) e.preventDefault(); };
    const hidden = () => { if (document.hidden) this.releaseAll(); };
    const blur = () => this.releaseAll();
    rack.addEventListener("pointerdown", down);
    rack.addEventListener("contextmenu", menu);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", hidden);
    this.cleanup.push(() => {
      rack.removeEventListener("pointerdown", down);
      rack.removeEventListener("contextmenu", menu);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", hidden);
    });
  }

  // ---------- drawing ----------
  private frame = (dt: number, now: number) => {
    const sd = STANDARDS[this.s.std], period = sd.lines / sd.vis, text = this.s.mode === "text";
    // rolls at half the real rate so it stays readable
    if (!this.reduce) this.roll += (fieldHz(sd, this.s.bend) - sd.field) * dt * 0.5 + this.kick * 5 * dt;
    this.kick *= Math.exp(-dt / 0.3);
    for (const tv of this.tvs) {
      const lit = tv.touches.size > 0;
      tv.glow += ((lit ? 1 : 0) - tv.glow) * (1 - Math.exp(-dt / (lit ? 0.015 : 0.14)));
      tv.tube.draw({
        now, roll: this.roll, period, text, glow: tv.glow, zap: this.reduce ? 0 : tv.zap, crawl: tv.crawl, power: tv.power,
        snow: this.reduce ? 0 : tv.snow, seed: tv.i * 17, hand: tv.hand, touches: tv.touches.values(),
      });
      tv.zap *= Math.exp(-dt / 0.05); tv.snow *= Math.exp(-dt / 0.06);
      tv.power = Math.min(1, tv.power + dt / (this.reduce ? 0.01 : 0.45));
      if (!this.reduce) tv.crawl += tv.crawlV * dt;
      if (tv.osdT > 0) { tv.osdT -= dt; if (tv.osdT <= 0) tv.osd.classList.remove("show"); }
    }
  };

  dispose() {
    this.alive = false;
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    // fade out before taking the voices apart, so leaving mid-hit doesn't click
    const voices = this.tvs.map((tv) => tv.voice);
    for (const tv of this.tvs) {
      tv.voice = null;
      tv.root.classList.remove("lit");
      tv.tube.dispose();
    }
    this.amp?.dispose(() => {
      for (const v of voices) if (v) { try { v.osc.stop(); } catch { /* already stopped */ } v.osc.disconnect(); v.g.disconnect(); }
    });
    this.amp = null;
  }
}
