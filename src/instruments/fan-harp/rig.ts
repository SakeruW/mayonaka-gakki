// The running fan: motor, disc, bulb, the one Light-Pick, and a voice per ring into a small amp.
// Everything per-frame lives here, outside React. The view hands in settings and gets tuner readings back.
// What the pick hears is set the moment the pick or a key moves, not on the next frame, so a hand let go is silent
// even when frames stop (a hidden tab); frames only carry the motor's speed.

import { createOutput, ensureAudio, tanhCurve, type Output } from "../../engine/audio";
import { onFrame } from "../../engine/loop";
import { BULB, DISC, DUTY, amplitudes, motorStep, keyPick, light, ringWave, ringsOf, targetRpm, tune, type Pos, type Reading, type Ring } from "./model";

export interface FanSettings { slots: number[]; base: number; speed: number; bend: number; bulb: boolean }
export interface TunerState { rpm: number; reading: Reading | null }

const REPORT_EVERY = 0.08;   // the readout follows a spinning-up motor at ~12 Hz, not every frame
const HUB_BLUR = 1 / 20;      // s: how long the eye blends a spinning hub together

export class FanRig {
  private s: FanSettings;
  private rings: Ring[];
  private rpm: number;
  private angle = 0;
  private pick: Pos = { x: 0.95, y: 0.92 };
  private finger: number | null = null;
  private keys: number[] = [];
  private ctx: CanvasRenderingContext2D;
  private off = document.createElement("canvas");
  private octx = this.off.getContext("2d")!;
  private dpr = 1;
  private S = 0;
  private ac: AudioContext | null = null;
  private bus: AudioNode | null = null;
  private out: Output | null = null;
  private chain: AudioNode[] = [];
  /** the disc's turns per second, which every ring's pitch is a multiple of, so the rings stay locked together */
  private rps: ConstantSourceNode | null = null;
  private voices: { osc: OscillatorNode; holes: GainNode; g: GainNode }[] = [];
  private lastKey = "";
  private sinceReport = 0;
  private cleanup: (() => void)[] = [];

  constructor(private cv: HTMLCanvasElement, settings: FanSettings, private onTuner: (t: TunerState) => void) {
    this.s = { ...settings, slots: settings.slots.slice() };
    this.rings = ringsOf(this.s.slots);
    // the fan starts from a standstill and winds up to the set speed; reduced motion skips the wind-up
    this.rpm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? targetRpm(this.s.base, this.s.speed, this.s.bend) : 0;
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
    this.sound();   // the bulb may have gone off
  }

  /** call inside a gesture: starts audio the first time */
  wake() {
    const ac = ensureAudio();
    if (!ac || this.bus) return;
    this.ac = ac;
    // the photocell output is AC-coupled into a small amp
    const hp = new BiquadFilterNode(ac, { type: "highpass", frequency: 28 });
    const lp = new BiquadFilterNode(ac, { type: "lowpass", frequency: 5000, Q: 0.5 });
    const sh = new WaveShaperNode(ac, { curve: tanhCurve(1.7), oversample: "2x" });
    this.out = createOutput(ac, 0.8);
    hp.connect(lp).connect(sh).connect(this.out.node);
    this.bus = hp;
    this.chain = [hp, lp, sh];
    this.rps = new ConstantSourceNode(ac, { offset: this.rpm / 60 });
    this.rps.start();
    this.buildVoices();
  }

  private stopVoices() {
    for (const v of this.voices) { try { v.osc.stop(); } catch { /* already stopped */ } v.osc.disconnect(); v.holes.disconnect(); v.g.disconnect(); }
    this.voices = [];
  }
  private buildVoices() {
    const ac = this.ac, bus = this.bus, rps = this.rps;
    if (!ac || !bus || !rps) return;
    this.stopVoices();
    this.voices = this.rings.map((g) => {
      const w = ringWave(g);
      // each ring plays its holes × the disc's turns per second
      const osc = new OscillatorNode(ac, { frequency: 0 }), holes = new GainNode(ac, { gain: g.N });
      rps.connect(holes).connect(osc.frequency);
      osc.setPeriodicWave(ac.createPeriodicWave(w.re, w.im));
      const gn = new GainNode(ac, { gain: 0 });
      osc.connect(gn).connect(bus); osc.start();
      return { osc, holes, g: gn };
    });
    this.sound();
  }

  /** what the photocell hears: called whenever the pick, a key or the bulb changes */
  private sound() {
    if (!this.ac || !this.voices.length) return;
    const t = this.ac.currentTime, amps = amplitudes(this.rings, this.contacts(), this.s.bulb);
    this.voices.forEach((v, i) => v.g.gain.setTargetAtTime(amps[i] * 0.3, t, 0.012));
  }

  // ---------- the pick ----------
  keyDown(i: number) { if (i < this.rings.length) { this.wake(); this.keys = this.keys.filter((k) => k !== i); this.keys.push(i); this.sound(); } }
  keyUp(i: number) { this.keys = this.keys.filter((k) => k !== i); this.sound(); }
  releaseAll() { this.keys = []; this.finger = null; this.cv.classList.remove("down"); this.sound(); }

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
      this.sound();
    };
    const move = (e: PointerEvent) => { if (e.pointerId === this.finger) { this.pick = toDisc(e); e.preventDefault(); this.sound(); } };
    const up = (e: PointerEvent) => { if (e.pointerId === this.finger) { this.finger = null; cv.classList.remove("down"); this.sound(); } };
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
    this.rpm = motorStep(this.rpm, targetRpm(this.s.base, this.s.speed, this.s.bend), dt);
    this.angle = (this.angle + this.rpm / 60 * Math.PI * 2 * dt) % (Math.PI * 2);
    const amps = amplitudes(this.rings, this.contacts(), this.s.bulb);
    if (this.ac && this.rps) this.rps.offset.setTargetAtTime(this.rpm / 60, this.ac.currentTime, 0.02);
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
    // housing rim and the hub
    ctx.lineWidth = 5 * dpr; ctx.strokeStyle = "#b9c9c2"; ctx.beginPath(); ctx.arc(0, 0, R * 1.08, 0, Math.PI * 2); ctx.stroke();
    this.drawHub(R, rps);
    this.drawPick(R, this.contacts().length > 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /**
   * The middle of the fan, turning with the disc: a dark washer clamping the disc with three screws, a domed mint spinner
   * cap with six petal ribs, and a chrome nut. At speed each part smears over the angle it turns in a 1/60 s exposure,
   * like the holes do; the glint on the dome stays put.
   */
  private drawHub(R: number, rps: number) {
    const { ctx, dpr } = this, TAU = Math.PI * 2;
    // The eye blends about 1/20 s together, so the hub is smeared over the angle it turns in that long, not one frame:
    // smeared over one frame, a screw's arc would land somewhere new every frame and the hub would flicker.
    const travel = rps * TAU * HUB_BLUR;
    // draw a pattern repeating every `period` radians, smeared over that travel
    const smeared = (period: number, paint: () => void) => {
      // once the smear covers a whole repeat, spread the copies over exactly one repeat: it looks the same every frame
      const span = Math.min(travel, period);
      // enough copies that neighbours overlap, so a part smears into an arc instead of strobing
      const K = Math.max(1, Math.min(28, Math.ceil(span / (period * 0.04))));
      ctx.save(); ctx.globalAlpha = K === 1 ? 1 : Math.min(1, 2.4 / K);
      for (let k = 0; k < K; k++) { ctx.save(); ctx.rotate(this.angle - span * k / K); paint(); ctx.restore(); }
      ctx.restore();
    };
    const washer = R * 0.245, cap = R * 0.165, nut = R * 0.042;

    // washer: dark brushed steel ring clamping the disc
    const wg = ctx.createLinearGradient(-washer, -washer, washer, washer);
    wg.addColorStop(0, "#4a5553"); wg.addColorStop(0.5, "#252d2c"); wg.addColorStop(1, "#3a4442");
    ctx.fillStyle = wg; ctx.beginPath(); ctx.arc(0, 0, washer, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = dpr; ctx.beginPath(); ctx.arc(0, 0, washer - dpr, 0, TAU); ctx.stroke();
    smeared(TAU / 3, () => {
      for (let k = 0; k < 3; k++) {
        const a = k * TAU / 3, x = Math.cos(a) * R * 0.205, y = Math.sin(a) * R * 0.205, sr = R * 0.021;
        const sg = ctx.createRadialGradient(x - sr * 0.3, y - sr * 0.3, 0, x, y, sr);
        sg.addColorStop(0, "#f2f5f4"); sg.addColorStop(1, "#7b8583");
        ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(x, y, sr, 0, TAU); ctx.fill();
        ctx.strokeStyle = "rgba(20,26,25,0.7)"; ctx.lineWidth = Math.max(1, sr * 0.28);
        ctx.beginPath(); ctx.moveTo(x - Math.cos(a + 1) * sr * 0.7, y - Math.sin(a + 1) * sr * 0.7); ctx.lineTo(x + Math.cos(a + 1) * sr * 0.7, y + Math.sin(a + 1) * sr * 0.7); ctx.stroke();
      }
    });

    // the spinner cap: a mint plastic dome, its shadow on the washer, six petal ribs
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.arc(cap * 0.08, cap * 0.12, cap * 1.02, 0, TAU); ctx.fill();
    const dome = ctx.createRadialGradient(-cap * 0.35, -cap * 0.4, cap * 0.05, 0, 0, cap);
    dome.addColorStop(0, "#f6fbf8"); dome.addColorStop(0.55, "#cfe2d9"); dome.addColorStop(1, "#93b2a5");
    ctx.fillStyle = dome; ctx.beginPath(); ctx.arc(0, 0, cap, 0, TAU); ctx.fill();
    smeared(TAU / 6, () => {
      for (let k = 0; k < 6; k++) {
        const a = k * TAU / 6, w = 0.36;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * nut * 1.4, Math.sin(a) * nut * 1.4);
        ctx.quadraticCurveTo(Math.cos(a - w) * cap * 0.72, Math.sin(a - w) * cap * 0.72, Math.cos(a) * cap * 0.93, Math.sin(a) * cap * 0.93);
        ctx.quadraticCurveTo(Math.cos(a + w) * cap * 0.72, Math.sin(a + w) * cap * 0.72, Math.cos(a) * nut * 1.4, Math.sin(a) * nut * 1.4);
        ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fill();
        ctx.strokeStyle = "rgba(29,56,50,0.22)"; ctx.lineWidth = dpr; ctx.stroke();
      }
    });
    ctx.strokeStyle = "#e9efec"; ctx.lineWidth = 1.6 * dpr; ctx.beginPath(); ctx.arc(0, 0, cap, 0, TAU); ctx.stroke();

    // chrome nut, hexagonal
    smeared(TAU / 6, () => {
      ctx.beginPath();
      for (let k = 0; k < 6; k++) { const a = k * TAU / 6; ctx[k ? "lineTo" : "moveTo"](Math.cos(a) * nut, Math.sin(a) * nut); }
      ctx.closePath();
      const ng = ctx.createLinearGradient(-nut, -nut, nut, nut);
      ng.addColorStop(0, "#ffffff"); ng.addColorStop(0.5, "#9aa3a1"); ng.addColorStop(1, "#dfe5e3");
      ctx.fillStyle = ng; ctx.fill();
    });
    ctx.fillStyle = "#56605e"; ctx.beginPath(); ctx.arc(0, 0, nut * 0.35, 0, TAU); ctx.fill();

    // the room's light on the dome, which doesn't turn
    const gl = ctx.createRadialGradient(-cap * 0.38, -cap * 0.42, 0, -cap * 0.38, -cap * 0.42, cap * 0.55);
    gl.addColorStop(0, "rgba(255,255,255,0.7)"); gl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, cap, 0, TAU); ctx.fill();
  }

  /**
   * The Light-Pick as the real one is built: a guitar-pick-shaped body held in the fingers, a photodiode window just behind
   * the tip (that window is the point that hears the disc), and a cable out of the wide end to the amp.
   * It is held from the lower right, so the tip points up-left.
   */
  private drawPick(R: number, on: boolean) {
    const { ctx, dpr, pick: p, S } = this;
    const s = Math.max(10 * dpr, Math.min(16 * dpr, R * 0.08));   // half the pick's width
    const L = 2.3 * s, eye = 0.42 * s;                              // length tip→wide end; tip→window
    const lift = on ? 0 : s * 0.4, a = -Math.PI / 4;               // lifted off the disc when not touching; body toward lower right
    const X = p.x * R - lift, Y = p.y * R - lift;
    const ca = Math.cos(a), sa = Math.sin(a);
    const world = (x: number, y: number) => [X + x * ca - y * sa, Y + x * sa + y * ca] as const;   // pick-local → disc space

    // the cable leaves the wide end and runs off toward the amp, lower right
    const [ex, ey] = world(0, L - eye + s * 0.25), [kx, ky] = world(0, L - eye + s * 1.6);
    ctx.lineCap = "round";
    ctx.strokeStyle = "#16161b"; ctx.lineWidth = 3.2 * dpr;
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.bezierCurveTo(kx, ky, S * 0.28, S * 0.36, S * 0.46, S * 0.52); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.bezierCurveTo(kx, ky, S * 0.28, S * 0.36, S * 0.46, S * 0.52); ctx.stroke();

    ctx.save(); ctx.translate(X, Y); ctx.rotate(a);
    // shadow on the disc while it hovers
    if (!on) {
      ctx.save(); ctx.translate(0, lift * 1.4); ctx.fillStyle = "rgba(0,0,0,0.4)";
      this.pickOutline(s, L, eye); ctx.fill(); ctx.restore();
    }
    // strain relief where the cable enters
    ctx.fillStyle = "#1d1d23"; ctx.beginPath(); ctx.roundRect(-s * 0.18, L - eye - s * 0.05, s * 0.36, s * 0.42, s * 0.08); ctx.fill();
    // body: neon pink plastic with a thin darker edge for its thickness
    this.pickOutline(s, L, eye);
    const body = ctx.createLinearGradient(-s, -eye, s, L - eye);
    body.addColorStop(0, "#ff7cb6"); body.addColorStop(0.55, "#ff4f9a"); body.addColorStop(1, "#d9367c");
    ctx.shadowColor = "#ff4f9a"; ctx.shadowBlur = on ? 16 * dpr : 0;
    ctx.fillStyle = body; ctx.fill(); ctx.shadowBlur = 0;
    ctx.lineWidth = 1.4 * dpr; ctx.strokeStyle = "rgba(120,10,60,0.75)"; ctx.stroke();
    // grip: a few raised ridges across the wide end
    ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1 * dpr;
    for (let k = 0; k < 3; k++) { const y = L - eye - s * (0.55 + k * 0.28), w = s * (0.55 - k * 0.07); ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(w, y); ctx.stroke(); }
    // the photodiode window: dark glass in a metal ring, glowing with whatever light reaches it
    const lum = on && Math.hypot(p.x, p.y) < 1 ? light(p, this.s.bulb) : 0, rw = s * 0.26;
    ctx.fillStyle = "#c9cfd0"; ctx.beginPath(); ctx.arc(0, 0, rw + 1.4 * dpr, 0, Math.PI * 2); ctx.fill();
    const glass = ctx.createRadialGradient(-rw * 0.3, -rw * 0.3, 0, 0, 0, rw);
    glass.addColorStop(0, lum ? `rgba(255,244,214,${0.6 + 0.4 * lum})` : "#3a3550");
    glass.addColorStop(1, lum ? `rgba(255,170,80,${0.4 + 0.5 * lum})` : "#0c0b14");
    ctx.fillStyle = glass; ctx.beginPath(); ctx.arc(0, 0, rw, 0, Math.PI * 2); ctx.fill();
    if (lum) { ctx.shadowColor = "rgba(255,200,120,0.9)"; ctx.shadowBlur = 10 * dpr * lum; ctx.fill(); ctx.shadowBlur = 0; }
    ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.beginPath(); ctx.arc(-rw * 0.35, -rw * 0.35, rw * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /** a standard guitar-pick outline, tip up, centred on the photodiode window */
  private pickOutline(s: number, L: number, eye: number) {
    const c = this.ctx, t = -eye, b = L - eye;
    c.beginPath();
    c.moveTo(0, t);
    c.bezierCurveTo(s * 0.32, t, s * 0.98, t + L * 0.5, s * 0.97, t + L * 0.78);
    c.bezierCurveTo(s * 0.95, b + s * 0.12, -s * 0.95, b + s * 0.12, -s * 0.97, t + L * 0.78);
    c.bezierCurveTo(-s * 0.98, t + L * 0.5, -s * 0.32, t, 0, t);
    c.closePath();
  }

  dispose() {
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.releaseAll();
    // fade out before taking the voices apart, so leaving mid-note doesn't click
    const voices = this.voices, chain = this.chain, rps = this.rps;
    this.out?.dispose(() => {
      this.voices = voices; this.stopVoices();
      for (const n of chain) n.disconnect();
      if (rps) { rps.stop(); rps.disconnect(); }
    });
    this.voices = []; this.chain = []; this.bus = null; this.rps = null; this.out = null;
  }
}
