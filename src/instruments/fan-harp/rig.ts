// The running fan: motor, disc, bulb, the one Light-Pick, and a voice per ring into a small amp.
// Everything per-frame lives here, outside React. The view hands in settings and gets tuner readings back.

import { ensureAudio } from "../../engine/audio";
import { onFrame } from "../../engine/loop";
import { BULB, DISC, DUTY, amplitudes, keyPick, light, ringWave, ringsOf, targetRpm, tune, type Pos, type Reading, type Ring } from "./model";

export interface FanSettings { slots: number[]; base: number; speed: number; bend: number; bulb: boolean }
export interface TunerState { rpm: number; reading: Reading | null }

const REPORT_EVERY = 0.08;   // the readout follows a spinning-up motor at ~12 Hz, not every frame

export class FanRig {
  private s: FanSettings;
  private rings: Ring[];
  private rpm: number;
  private angle = 0;
  private pick: Pos = { x: 0.95, y: 0.92 };
  private finger: number | null = null;
  private keys: number[] = [];
  private hub: HTMLImageElement | null = null;
  private ctx: CanvasRenderingContext2D;
  private off = document.createElement("canvas");
  private octx = this.off.getContext("2d")!;
  private dpr = 1;
  private S = 0;
  private ac: AudioContext | null = null;
  private bus: AudioNode | null = null;
  private chain: AudioNode[] = [];
  private voices: { osc: OscillatorNode; g: GainNode }[] = [];
  private lastKey = "";
  private sinceReport = 0;
  private cleanup: (() => void)[] = [];

  constructor(private cv: HTMLCanvasElement, settings: FanSettings, private onTuner: (t: TunerState) => void) {
    this.s = { ...settings, slots: settings.slots.slice() };
    this.rings = ringsOf(this.s.slots);
    this.rpm = targetRpm(this.s.base, this.s.speed, 0);
    this.ctx = cv.getContext("2d")!;
    this.bindInput();
    this.cleanup.push(onFrame(this.frame));
  }

  update(next: FanSettings) {
    const slotsChanged = next.slots.join() !== this.s.slots.join();
    this.s = { ...next, slots: next.slots.slice() };
    if (slotsChanged) {
      this.rings = ringsOf(this.s.slots);
      this.keys = [];
      this.buildVoices();
    }
  }
  setHub(img: HTMLImageElement | null) { this.hub = img; }

  /** call inside a gesture: starts audio the first time */
  wake() {
    const ac = ensureAudio();
    if (!ac || this.bus) return;
    this.ac = ac;
    // the photocell output is AC-coupled into a small amp
    const hp = new BiquadFilterNode(ac, { type: "highpass", frequency: 28 });
    const lp = new BiquadFilterNode(ac, { type: "lowpass", frequency: 5000, Q: 0.5 });
    const c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(1.7 * x) / Math.tanh(1.7); }
    const sh = new WaveShaperNode(ac, { curve: c });
    const out = new GainNode(ac, { gain: 0.8 });
    hp.connect(lp).connect(sh).connect(out).connect(ac.destination);
    this.bus = hp;
    this.chain = [hp, lp, sh, out];
    this.buildVoices();
  }

  private stopVoices() {
    for (const v of this.voices) { try { v.osc.stop(); } catch { /* already stopped */ } v.osc.disconnect(); v.g.disconnect(); }
    this.voices = [];
  }
  private buildVoices() {
    const ac = this.ac, bus = this.bus;
    if (!ac || !bus) return;
    this.stopVoices();
    this.voices = this.rings.map((g) => {
      const w = ringWave(g);
      const osc = new OscillatorNode(ac, { frequency: g.N * this.rpm / 60 });
      osc.setPeriodicWave(ac.createPeriodicWave(w.re, w.im));
      const gn = new GainNode(ac, { gain: 0 });
      osc.connect(gn).connect(bus); osc.start();
      return { osc, g: gn };
    });
  }

  // ---------- the pick ----------
  keyDown(i: number) { if (i < this.rings.length) { this.wake(); this.keyUp(i); this.keys.push(i); } }
  keyUp(i: number) { this.keys = this.keys.filter((k) => k !== i); }
  releaseAll() { this.keys = []; this.finger = null; this.cv.classList.remove("down"); }

  /** the pick touches the disc while a finger or the mouse holds it, or while a ring key is held (last key wins) */
  private contacts(): Pos[] {
    if (this.finger !== null) return [this.pick];
    const k = this.keys[this.keys.length - 1];
    if (k !== undefined && this.rings[k]) { this.pick = keyPick(this.rings[k]); return [this.pick]; }
    return [];
  }

  private bindInput() {
    const cv = this.cv;
    const toDisc = (e: PointerEvent): Pos => {
      const b = cv.getBoundingClientRect(), R = b.width / 2 * DISC;
      const x = (e.clientX - b.left - b.width / 2) / R, y = (e.clientY - b.top - b.height / 2) / R;
      return { x: Math.max(-1.2, Math.min(1.2, x)), y: Math.max(-1.2, Math.min(1.2, y)) };
    };
    // one Light-Pick: the first finger (or the mouse) holds it, extra fingers are ignored
    const down = (e: PointerEvent) => {
      e.preventDefault();
      if (this.finger !== null) return;
      this.wake();
      try { cv.setPointerCapture(e.pointerId); } catch { /* fine without capture */ }
      this.finger = e.pointerId; this.pick = toDisc(e); cv.classList.add("down");
    };
    const move = (e: PointerEvent) => { if (e.pointerId === this.finger) { this.pick = toDisc(e); e.preventDefault(); } };
    const up = (e: PointerEvent) => { if (e.pointerId === this.finger) { this.finger = null; cv.classList.remove("down"); } };
    const menu = (e: Event) => e.preventDefault();
    const blur = () => this.releaseAll();
    const hidden = () => { if (document.hidden) this.releaseAll(); };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    for (const n of ["pointerup", "pointercancel", "lostpointercapture"] as const) cv.addEventListener(n, up);
    cv.addEventListener("contextmenu", menu);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", hidden);
    this.cleanup.push(() => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      for (const n of ["pointerup", "pointercancel", "lostpointercapture"] as const) cv.removeEventListener(n, up);
      cv.removeEventListener("contextmenu", menu);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", hidden);
    });
  }

  // ---------- loop ----------
  private frame = (dt: number) => {
    const tgt = targetRpm(this.s.base, this.s.speed, this.s.bend), tau = tgt > this.rpm ? 1.1 : 2.4;   // spins up faster than it coasts down
    this.rpm += (tgt - this.rpm) * (1 - Math.exp(-dt / tau));
    if (this.rpm < 0.3 && tgt === 0) this.rpm = 0;
    this.angle = (this.angle + this.rpm / 60 * Math.PI * 2 * dt) % (Math.PI * 2);
    const amps = amplitudes(this.rings, this.contacts(), this.s.bulb);
    if (this.ac && this.voices.length) {
      const t = this.ac.currentTime;
      this.voices.forEach((v, i) => {
        v.osc.frequency.setTargetAtTime(this.rings[i].N * this.rpm / 60, t, 0.02);
        v.g.gain.setTargetAtTime(amps[i] * 0.3, t, 0.012);
      });
    }
    if (Math.round(this.cv.clientWidth * this.dpr) !== this.S) this.resize();   // follow layout changes (rotation, split view)
    if (this.S >= 40) this.draw();
    this.report(amps, dt);
  };

  private report(amps: number[], dt: number) {
    const reading = this.s.bulb && this.rpm >= 3 ? tune(this.rings, amps, this.rpm) : null, rpm = Math.round(this.rpm);
    const shape = reading ? `${reading.best}|${reading.name}${reading.oct}|${reading.also.join()}` : "-";
    const key = `${shape}|${rpm}|${reading ? Math.round(reading.hz * 10) : ""}`;
    this.sinceReport += dt;
    if (key === this.lastKey) return;
    // a new note or ring goes out at once; a drifting rpm or Hz waits its turn
    if (!this.lastKey.startsWith(shape + "|") || this.sinceReport >= REPORT_EVERY) {
      this.lastKey = key; this.sinceReport = 0;
      this.onTuner({ rpm, reading });
    }
  }

  // ---------- drawing ----------
  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.S = Math.round(this.cv.clientWidth * this.dpr);
    this.cv.width = this.cv.height = this.off.width = this.off.height = this.S;
  }

  private slotPath(c: CanvasRenderingContext2D, g: Ring, i: number, R: number, back: number) {
    const step = Math.PI * 2 / g.N, open = step * DUTY, ph = this.angle - back + (i % 2 ? step / 2 : 0);
    c.beginPath();
    for (let j = 0; j < g.N; j++) {
      const a0 = ph + j * step, a1 = a0 + open;
      c.moveTo(Math.cos(a0) * g.r1 * R, Math.sin(a0) * g.r1 * R);
      c.arc(0, 0, g.r1 * R, a0, a1); c.arc(0, 0, g.r0 * R, a1, a0, true); c.closePath();
    }
  }

  private draw() {
    const { ctx, octx, S, dpr } = this, R = S / 2 * DISC, cx = S / 2, cy = S / 2, rps = this.rpm / 60, bulb = this.s.bulb;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, S, S);
    ctx.translate(cx, cy);
    // fan housing behind everything
    ctx.fillStyle = "#0a100f"; ctx.beginPath(); ctx.arc(0, 0, R * 1.1, 0, Math.PI * 2); ctx.fill();
    // the bulb: big warm light behind the disc, spilling past its rim
    const bx = BULB.x * R, by = BULB.y * R;
    if (bulb) {
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R * 1.1, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = "rgba(150,80,20,0.4)"; ctx.fillRect(-R * 1.2, -R * 1.2, R * 2.4, R * 2.4);
      const gl = ctx.createRadialGradient(bx, by, 0, bx, by, R * 1.25);
      gl.addColorStop(0, "rgba(255,255,248,1)"); gl.addColorStop(0.07, "rgba(255,246,214,1)");
      gl.addColorStop(0.22, "rgba(255,196,105,0.95)"); gl.addColorStop(0.55, "rgba(230,130,45,0.55)"); gl.addColorStop(1, "rgba(200,100,30,0)");
      ctx.fillStyle = gl; ctx.fillRect(-R * 1.2, -R * 1.2, R * 2.4, R * 2.4);
      ctx.restore();
    }
    // the disc: dark, with holes cut so the bulb shows through
    octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, S, S); octx.translate(cx, cy);
    octx.globalCompositeOperation = "source-over";
    const dg = octx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.05, 0, 0, R);
    dg.addColorStop(0, "#2b3634"); dg.addColorStop(1, "#141b1a");
    octx.fillStyle = dg; octx.beginPath(); octx.arc(0, 0, R, 0, Math.PI * 2); octx.fill();
    // camera-style motion blur: smeared over the angle the disc turns during a 1/60 s exposure
    const travel = rps * Math.PI * 2 / 60;
    octx.globalCompositeOperation = "destination-out";
    this.rings.forEach((g, i) => {
      const step = Math.PI * 2 / g.N;
      if (travel >= step * 1.2) {
        // fully blurred: the ring reads as a steady band lit at the open fraction
        octx.fillStyle = "rgba(0,0,0," + DUTY + ")";
        octx.beginPath(); octx.arc(0, 0, g.r1 * R, 0, Math.PI * 2); octx.arc(0, 0, g.r0 * R, 0, Math.PI * 2, true); octx.fill();
      } else {
        const K = Math.max(1, Math.min(10, Math.ceil(travel / (step * DUTY * 0.25))));
        octx.fillStyle = "rgba(0,0,0," + (K === 1 ? 1 : Math.min(1, 1.6 / K)) + ")";
        for (let k = 0; k < K; k++) { this.slotPath(octx, g, i, R, travel * k / K); octx.fill(); }
      }
    });
    octx.globalCompositeOperation = "source-over";
    octx.strokeStyle = "rgba(255,255,255,0.08)"; octx.lineWidth = 2 * dpr; octx.beginPath(); octx.arc(0, 0, R - dpr, 0, Math.PI * 2); octx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.off, 0, 0); ctx.translate(cx, cy);
    // bloom: the bulb's core glares through the spinning disc
    if (bulb) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      const bl = ctx.createRadialGradient(bx, by, 0, bx, by, R * 0.5);
      bl.addColorStop(0, "rgba(255,252,240,1)"); bl.addColorStop(0.18, "rgba(255,228,170,0.6)"); bl.addColorStop(1, "rgba(255,170,80,0)");
      ctx.fillStyle = bl; ctx.beginPath(); ctx.arc(bx, by, R * 0.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    // housing rim and hub cap (or the player's own picture)
    ctx.lineWidth = 5 * dpr; ctx.strokeStyle = "#b9c9c2"; ctx.beginPath(); ctx.arc(0, 0, R * 1.08, 0, Math.PI * 2); ctx.stroke();
    const hub = this.hub, hr = hub ? R * 0.235 : R * 0.19;
    const bg = ctx.createRadialGradient(-R * 0.05, -R * 0.06, 0, 0, 0, hr);
    bg.addColorStop(0, "#eef6f1"); bg.addColorStop(1, "#b4cdc2");
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(0, 0, hr, 0, Math.PI * 2); ctx.fill();
    if (hub) {
      const iw = hub.naturalWidth, ih = hub.naturalHeight, sc = (2 * hr) / Math.min(iw, ih);
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, hr, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(hub, -iw * sc / 2, -ih * sc / 2, iw * sc, ih * sc); ctx.restore();
      ctx.lineWidth = 3 * dpr; ctx.strokeStyle = "#b9c9c2"; ctx.beginPath(); ctx.arc(0, 0, hr, 0, Math.PI * 2); ctx.stroke();
    }
    this.drawPick(R, this.contacts().length > 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawPick(R: number, on: boolean) {
    const { ctx, dpr, pick: p } = this;
    const X = p.x * R, Y = p.y * R, s = Math.max(11 * dpr, Math.min(17 * dpr, R * 0.085)), lift = on ? 0 : s * 0.35;
    ctx.save(); ctx.translate(X - lift, Y - lift);
    if (!on) { ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.ellipse(lift * 1.6, lift * 1.6, s * 0.9, s * 0.8, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.rotate(-0.5);
    ctx.beginPath(); ctx.moveTo(0, -s * 1.05);
    ctx.bezierCurveTo(s * 0.95, -s * 1.05, s * 1.05, -s * 0.2, 0, s * 1.1);
    ctx.bezierCurveTo(-s * 1.05, -s * 0.2, -s * 0.95, -s * 1.05, 0, -s * 1.05); ctx.closePath();
    ctx.shadowColor = "#ff4f9a"; ctx.shadowBlur = on ? 18 * dpr : 0;
    ctx.fillStyle = on ? "#ff4f9a" : "rgba(255,79,154,0.75)"; ctx.fill(); ctx.shadowBlur = 0;
    ctx.restore();
    // the photocell window glows with whatever light reaches it
    const lum = on ? light(p, this.s.bulb) : 0;
    ctx.fillStyle = on && lum > 0 && Math.hypot(p.x, p.y) < 1 ? "rgba(255,236,190," + (0.5 + 0.5 * lum) + ")" : "#3a1426";
    ctx.beginPath(); ctx.arc(X - lift, Y - lift, 4.5 * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
  }

  dispose() {
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.stopVoices();
    for (const n of this.chain) n.disconnect();
    this.chain = []; this.bus = null;
    this.releaseAll();
  }
}
