// The running deck: one reel, the tape across the heads tied to the lever, the playback head, the VU needle.
// Everything per-frame lives here, outside React. The view hands in the REC switch and gets readouts back.

import { ensureAudio } from "../../engine/audio";
import { onFrame } from "../../engine/loop";
import { createTapeHead, type TapeHead } from "../../engine/tape";
import workletUrl from "./tape-worklet.ts?worker&url";
import {
  HUB_R, LEVER, SUPPLY_R, TAPE_RATE, V0, counter, demoLoop, handSpeed, hissLevel, leverAngle, leverSpeed, leverTip, reelOmega, tapeStep, toneHz,
} from "./model";

export interface DeckSettings { rec: boolean }
export interface Readout { s: number; pos: number; counter: string; recording: boolean }
export type MicState = "off" | "on" | "denied";

type Pt = { x: number; y: number };
/** a hand on something that moves the tape: the lever, the reel, or the tape itself */
interface Hand { id: number; at: number; v: number }
interface LeverHand extends Hand { offset: number; lastTip: number }
interface ReelHand extends Hand { last: number; offset: number }
interface TapeHand extends Hand { last: number; f: Pt }

const ASPECT = 1.35;          // 16 deck units wide, 11.85 tall: room for the lever's pivot under the tape
const REPORT_EVERY = 0.08;
const STALE_MS = 60;          // a hand that hasn't moved for this long is holding still

export class TapeRig {
  private s: DeckSettings;
  private speed = 0;                   // tape speed, × recorded speed
  private reel = { c: { x: 0, y: 0 }, angle: 0 };
  private theta = 0;                   // the lever's swing, 0 = upright
  private keyDir = 0;                  // ← → rock the lever from the keyboard
  private lever: LeverHand | null = null;
  private reelHand: ReelHand | null = null;
  private tapeHand: TapeHand | null = null;
  private dip = { x: 0, amount: 0 };   // where a finger last knocked the tape
  private revs = 0;
  private ctx: CanvasRenderingContext2D;
  private plate: HTMLCanvasElement | null = null;
  private W = 0; private H = 0; private U = 0; private dpr = 1;
  private ac: AudioContext | null = null;
  private head: TapeHead | null = null;
  private nodes: AudioNode[] = [];
  private tone: BiquadFilterNode | null = null;
  private hiss: GainNode | null = null;
  private meter: AnalyserNode | null = null;
  private meterBuf = new Float32Array(1024);
  private vu = -30;
  private mic: MediaStream | null = null;
  private micNode: MediaStreamAudioSourceNode | null = null;
  private recording = false;
  private lastKey = "";
  private sinceReport = 0;
  private cleanup: (() => void)[] = [];
  private alive = true;

  constructor(private cv: HTMLCanvasElement, private needle: HTMLElement, settings: DeckSettings,
              private onReadout: (r: Readout) => void, private onMic: (m: MicState) => void) {
    this.s = { ...settings };
    this.ctx = cv.getContext("2d")!;
    this.bindInput();
    this.cleanup.push(onFrame(this.frame));
  }

  update(next: DeckSettings) {
    const armed = next.rec && !this.s.rec, disarmed = !next.rec && this.s.rec;
    this.s = { ...next };
    if (armed) void this.openMic();
    if (disarmed) this.closeMic();
  }

  /** hold ← or → to rock the lever from the keyboard (−1, 0, +1) */
  rock(dir: number) { if (dir) this.wake(); this.keyDir = dir; }

  // ---------- audio ----------
  /** call inside a gesture: starts audio and threads the tape the first time */
  wake() {
    const ac = ensureAudio();
    if (!ac || this.ac) return;
    this.ac = ac;
    createTapeHead(ac, { tape: demoLoop(TAPE_RATE), tapeRate: TAPE_RATE, workletUrl }).then((head) => {
      if (!this.alive) { head.dispose(); return; }
      // the playback amp: a little head saturation, the tape's speed-dependent top end, hiss, then the line out
      const c = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(1.5 * x) / Math.tanh(1.5); }
      const sat = new WaveShaperNode(ac, { curve: c, oversample: "2x" });
      const tone = new BiquadFilterNode(ac, { type: "lowpass", frequency: 16000, Q: 0.6 });
      const mix = new GainNode(ac, { gain: 0.9 });
      const comp = new DynamicsCompressorNode(ac, { threshold: -10, ratio: 3, attack: 0.004, release: 0.2 });
      const noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), nd = noise.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const hissSrc = new AudioBufferSourceNode(ac, { buffer: noise, loop: true });
      const hissHp = new BiquadFilterNode(ac, { type: "highpass", frequency: 3000 });
      const hiss = new GainNode(ac, { gain: 0 });
      const meter = new AnalyserNode(ac, { fftSize: 1024 });
      head.node.connect(sat).connect(tone).connect(mix);
      hissSrc.connect(hissHp).connect(hiss).connect(mix);
      mix.connect(comp).connect(ac.destination);
      mix.connect(meter);
      hissSrc.start();
      this.head = head; this.tone = tone; this.hiss = hiss; this.meter = meter;
      this.nodes = [sat, tone, mix, comp, hissSrc, hissHp, hiss, meter];
      if (this.micNode) this.micNode.connect(head.node);
    }, () => { /* no audio at all: the deck still moves */ });
  }

  private async openMic() {
    this.wake();
    if (this.mic || !navigator.mediaDevices?.getUserMedia) { this.onMic(this.mic ? "on" : "denied"); return; }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      // REC may have been switched off, or the page left, while the browser was asking
      if (!this.alive || !this.ac || !this.s.rec) { mic.getTracks().forEach((t) => t.stop()); return; }
      this.mic = mic;
      this.micNode = this.ac.createMediaStreamSource(mic);
      if (this.head) this.micNode.connect(this.head.node);
      this.onMic("on");
    } catch {
      this.onMic("denied");
    }
  }

  /** the mic is only open while REC is armed: switching REC off hands it back to the browser */
  private closeMic() {
    this.micNode?.disconnect();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null; this.micNode = null;
    this.head?.setRecording(false);
  }

  /** a finger knocks the tape against the head: a jolt of tape past it and a moment of hard contact */
  tap(x?: number) {
    this.wake();
    this.dip = { x: x ?? 0.4, amount: 1 };
    if (!this.lever && !this.reelHand && !this.tapeHand) this.speed += 1.8;
    this.head?.knock(2.4, this.contact());
  }

  /** the tape presses on the heads, except while recording: the monitor is off so the speakers can't feed back */
  private contact() { return this.recording ? 0 : 1; }

  // ---------- hands on the lever, the reel and the tape ----------
  private bindInput() {
    const cv = this.cv;
    const local = (e: PointerEvent): Pt => { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) * this.dpr, y: (e.clientY - b.top) * this.dpr }; };
    const onLever = (p: Pt) => {
      // anywhere along the rod, or in the arc it sweeps
      const tip = leverTip(this.theta), U = this.U, px = p.x / U, py = p.y / U;
      const ax = LEVER.pivotX, ay = LEVER.pivotY, dx = tip.x - ax, dy = tip.y - ay;
      const t = Math.max(0, Math.min(1.12, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) < 0.75;
    };
    const down = (e: PointerEvent) => {
      e.preventDefault();
      this.wake();
      const p = local(e), now = performance.now(), U = this.U;
      const capture = () => { try { cv.setPointerCapture(e.pointerId); } catch { /* fine without capture */ } };
      if (onLever(p)) {
        capture();
        this.lever = { id: e.pointerId, at: now, v: 0, offset: this.theta - leverAngle(p.x / U, p.y / U), lastTip: leverTip(this.theta).x };
        cv.classList.add("down");
      } else if (Math.hypot(p.x - this.reel.c.x, p.y - this.reel.c.y) < 3.6 * U) {
        capture();
        const a = Math.atan2(p.y - this.reel.c.y, p.x - this.reel.c.x);
        this.reelHand = { id: e.pointerId, at: now, v: 0, last: a, offset: this.reel.angle - a };
        cv.classList.add("down");
      } else if (!this.tapeHand && Math.abs(p.y - this.tapeY()) < 0.9 * U && p.x > 1.6 * U && p.x < 10 * U) {
        // touching the tape knocks it onto the head; keep hold and drag to pull it across the head
        this.tap(p.x / this.W);
        capture();
        this.tapeHand = { id: e.pointerId, at: now, v: 0, last: p.x, f: p };
      }
    };
    const move = (e: PointerEvent) => {
      const now = performance.now(), p = local(e), U = this.U;
      const blend = (h: Hand, v: number) => { const dt = Math.max(0.004, (now - h.at) / 1000); h.v = h.v * 0.4 + (v / dt) * 0.6; h.at = now; };
      const lv = this.lever;
      if (lv && lv.id === e.pointerId) {
        this.theta = Math.max(-LEVER.maxSwing, Math.min(LEVER.maxSwing, leverAngle(p.x / U, p.y / U) + lv.offset));
        const tip = leverTip(this.theta).x;
        blend(lv, tip - lv.lastTip); lv.lastTip = tip;
        return;
      }
      const th = this.tapeHand;
      if (th && th.id === e.pointerId) { blend(th, p.x - th.last); th.last = p.x; th.f = p; return; }
      const rh = this.reelHand;
      if (rh && rh.id === e.pointerId) {
        const a = Math.atan2(p.y - this.reel.c.y, p.x - this.reel.c.x);
        let d = a - rh.last;
        if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
        blend(rh, d); rh.last = a;
        this.reel.angle = a + rh.offset;   // the reel stays under the finger
      }
    };
    const up = (e: PointerEvent) => {
      if (this.lever?.id === e.pointerId) this.lever = null;
      if (this.reelHand?.id === e.pointerId) this.reelHand = null;
      if (this.tapeHand?.id === e.pointerId) this.tapeHand = null;
      if (!this.lever && !this.reelHand) cv.classList.remove("down");
    };
    const menu = (e: Event) => e.preventDefault();
    const release = () => { this.lever = this.reelHand = this.tapeHand = null; this.keyDir = 0; cv.classList.remove("down"); };
    const hidden = () => { if (document.hidden) release(); };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    for (const n of ["pointerup", "pointercancel", "lostpointercapture"] as const) cv.addEventListener(n, up);
    cv.addEventListener("contextmenu", menu);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", hidden);
    this.cleanup.push(() => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      for (const n of ["pointerup", "pointercancel", "lostpointercapture"] as const) cv.removeEventListener(n, up);
      cv.removeEventListener("contextmenu", menu);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", hidden);
    });
  }

  // ---------- loop ----------
  private frame = (dt: number, now: number) => {
    // the keyboard rocks the lever at a steady pace, about a full swing in a third of a second
    if (this.keyDir && !this.lever) {
      const before = leverTip(this.theta).x;
      this.theta = Math.max(-LEVER.maxSwing, Math.min(LEVER.maxSwing, this.theta + this.keyDir * 3.2 * dt));
      this.speed = leverSpeed((leverTip(this.theta).x - before) / dt);
    } else {
      // the hand that moved last drives the tape; a hand held still holds the tape still
      const hands: Hand[] = [this.lever, this.reelHand, this.tapeHand].filter((h) => h !== null);
      hands.sort((a, b) => b.at - a.at);
      const h = hands[0];
      if (h) {
        const v = now - h.at > STALE_MS ? 0 : h.v;
        const want = h === this.lever ? leverSpeed(v)
                   : h === this.reelHand ? handSpeed(-v, SUPPLY_R)         // turning the reel anticlockwise feeds tape forward
                   : v / (V0 * 3.6 * this.U);                             // the tape pulled rightward is forward
        this.speed += (want - this.speed) * (1 - Math.exp(-dt / 0.025));
      } else {
        this.speed = tapeStep(this.speed, dt);
      }
    }
    if (!this.reelHand) this.reel.angle -= reelOmega(this.speed, SUPPLY_R) * dt;
    this.revs += reelOmega(this.speed, SUPPLY_R) * dt / (2 * Math.PI);
    this.dip.amount *= Math.exp(-dt / 0.08);

    this.recording = this.s.rec && !!this.mic && this.speed > 0.05;
    const head = this.head;
    if (this.ac && head) {
      const t = this.ac.currentTime;
      head.setRate(this.speed);
      if (this.dip.amount < 0.3) head.setContact(this.contact());
      head.setFlutter(false);
      head.setRecording(this.recording);
      this.tone?.frequency.setTargetAtTime(toneHz(this.speed), t, 0.02);
      this.hiss?.gain.setTargetAtTime(this.recording ? 0 : hissLevel(this.speed, 1), t, 0.03);
    }
    this.drawVu(dt);
    this.fit();
    if (this.W > 40) this.draw();
    this.report(dt);
  };

  private drawVu(dt: number) {
    let db = -40;
    if (this.meter) {
      this.meter.getFloatTimeDomainData(this.meterBuf);
      let sum = 0;
      for (const v of this.meterBuf) sum += v * v;
      db = 20 * Math.log10(Math.sqrt(sum / this.meterBuf.length) + 1e-6) + 8;   // 0 VU sits a little under full level
    }
    // VU ballistics: about 300 ms to rise, a little slower to fall
    this.vu += (Math.max(-30, db) - this.vu) * (1 - Math.exp(-dt / (db > this.vu ? 0.3 : 0.45)));
    const deg = -48 + 96 * Math.min(1, Math.max(0, (this.vu + 20) / 23));
    this.needle.style.transform = `rotate(${deg.toFixed(1)}deg)`;
  }

  private report(dt: number) {
    const pos = this.head?.position() ?? 0, c = counter(this.revs);
    const key = `${this.speed.toFixed(2)}|${c}|${pos.toFixed(1)}|${this.recording}`;
    this.sinceReport += dt;
    if (key === this.lastKey || this.sinceReport < REPORT_EVERY) return;
    this.lastKey = key; this.sinceReport = 0;
    this.onReadout({ s: this.speed, pos, counter: c, recording: this.recording });
  }

  // ---------- drawing ----------
  private fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = Math.round(this.cv.clientWidth * dpr), H = Math.round(W / ASPECT);
    if (W === this.W && dpr === this.dpr) return;
    this.dpr = dpr; this.W = W; this.H = H; this.U = W / 16;
    this.cv.width = W; this.cv.height = H;
    this.reel.c = { x: 4.05 * this.U, y: 4.1 * this.U };
    this.plate = null;
  }
  private tapeY() { return 8.95 * this.U; }

  /** the faceplate: black brushed aluminium, the empty take-up spindle and the lever's bracket, drawn once per size */
  private faceplate() {
    if (this.plate) return this.plate;
    const p = document.createElement("canvas"), { W, H, U, dpr } = this;
    p.width = W; p.height = H;
    const c = p.getContext("2d")!;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2b2f30"); g.addColorStop(1, "#16191a");
    c.fillStyle = g; c.beginPath(); c.roundRect(0, 0, W, H, 0.45 * U); c.fill();
    let seed = 3;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let y = 0; y < H; y += 1) { c.fillStyle = `rgba(255,255,255,${(rnd() * 0.035).toFixed(3)})`; c.fillRect(0, y, W, 1); }
    // reel tables: the left one carries the reel; the right one stands empty, its spindle bare
    for (const x of [4.05, 11.95]) { c.fillStyle = "rgba(0,0,0,0.35)"; c.beginPath(); c.arc(x * U, 4.1 * U, 3.75 * U, 0, Math.PI * 2); c.fill(); }
    const sx = 11.95 * U, sy = 4.1 * U;
    const tg = c.createRadialGradient(sx - 0.3 * U, sy - 0.3 * U, 0, sx, sy, 1.2 * U);
    tg.addColorStop(0, "#4a5052"); tg.addColorStop(1, "#1c1f20");
    c.fillStyle = tg; c.beginPath(); c.arc(sx, sy, 1.2 * U, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(255,255,255,0.1)"; c.lineWidth = dpr; c.stroke();
    c.fillStyle = "#d7dcde";
    for (let k = 0; k < 3; k++) { const a = k * 2 * Math.PI / 3 - Math.PI / 2; c.save(); c.translate(sx, sy); c.rotate(a); c.fillRect(-0.06 * U, 0.12 * U, 0.12 * U, 0.26 * U); c.restore(); }
    c.beginPath(); c.arc(sx, sy, 0.14 * U, 0, Math.PI * 2); c.fill();
    // the head cover's recess
    c.fillStyle = "#101213"; c.beginPath(); c.roundRect(4.7 * U, 7.55 * U, 6.6 * U, 1.75 * U, 0.3 * U); c.fill();
    c.strokeStyle = "rgba(255,255,255,0.08)"; c.lineWidth = dpr; c.stroke();
    // the lever's bracket: a steel plate bolted to the deck
    const px = LEVER.pivotX * U, py = LEVER.pivotY * U;
    c.fillStyle = "#3d4345"; c.beginPath(); c.roundRect(px - 0.7 * U, py - 0.35 * U, 1.4 * U, 0.7 * U, 0.12 * U); c.fill();
    c.fillStyle = "#8b9396";
    for (const bx of [-0.5, 0.5]) { c.beginPath(); c.arc(px + bx * U, py, 0.08 * U, 0, Math.PI * 2); c.fill(); }
    this.plate = p;
    return p;
  }

  private draw() {
    const { ctx: c, W, H, U } = this, ty = this.tapeY();
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
    c.drawImage(this.faceplate(), 0, 0);
    const g1 = { x: 1.95 * U, y: ty - 0.32 * U }, gr = 0.32 * U;
    const tip = leverTip(this.theta), tx = tip.x * U, tyTip = tip.y * U;

    // the tape: off the reel, round the guide, across the heads, and on to the lever's tip where its end is tied
    const a = tangent(this.reel.c, SUPPLY_R * 3.6 * U, g1, gr);
    const dip = this.dip.amount * 0.35 * U, dx = this.dip.x * W, f = this.tapeHand?.f;
    c.strokeStyle = "#5a3a22"; c.lineWidth = 0.13 * U; c.lineCap = "round"; c.lineJoin = "round";
    c.beginPath(); c.moveTo(a.p1.x, a.p1.y); c.lineTo(a.p2.x, a.p2.y);
    c.arc(g1.x, g1.y, gr, Math.atan2(a.p2.y - g1.y, a.p2.x - g1.x), Math.PI / 2, true);
    if (f && Math.abs(f.y - ty) > 2 * this.dpr) {
      // pinched and pulled: the tape runs straight from the guide to the finger
      c.lineTo(Math.max(g1.x + U, Math.min(5.3 * U, f.x)), ty + Math.max(-1.1 * U, Math.min(1.1 * U, f.y - ty)));
    } else if (dip > 0.5) { c.lineTo(Math.max(g1.x, dx - 1.4 * U), ty); c.quadraticCurveTo(dx, ty + dip * 2, Math.min(5.4 * U, dx + 1.4 * U), ty); }
    c.lineTo(9.9 * U, ty);
    c.lineTo(tx, tyTip);
    c.stroke();

    c.fillStyle = "#c9ced0"; c.beginPath(); c.arc(g1.x, g1.y, gr * 0.8, 0, Math.PI * 2); c.fill();
    // heads: erase, record, playback, chrome blocks the tape runs across
    [6.0, 7.6, 9.2].forEach((hx, i) => {
      const x = hx * U, w = 0.95 * U, top = ty - 1.05 * U;
      const hg = c.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      hg.addColorStop(0, "#7d8487"); hg.addColorStop(0.5, "#e4e8ea"); hg.addColorStop(1, "#6c7275");
      c.fillStyle = hg; c.beginPath(); c.roundRect(x - w / 2, top, w, 1.05 * U + 0.06 * U, [0.12 * U, 0.12 * U, 0.4 * U, 0.4 * U]); c.fill();
      c.fillStyle = i === 1 && this.recording ? "#ff4f9a" : "#202426"; c.fillRect(x - 0.03 * U, ty - 0.18 * U, 0.06 * U, 0.2 * U);   // the gap
    });
    // capstan, with the pinch roller swung away: nothing runs the tape but your hands
    const cx = 10.75 * U;
    c.fillStyle = "#d9dee0"; c.beginPath(); c.arc(cx, ty - 0.16 * U, 0.16 * U, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#0b0c0d"; c.beginPath(); c.arc(cx, ty + 0.85 * U, 0.42 * U, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(255,255,255,0.12)"; c.lineWidth = this.dpr; c.stroke();

    this.drawLever(tx, tyTip);
    this.drawReel();
  }

  /** the rod: pale bamboo with its nodes, a cloth grip near the bottom, the tape's end clipped to the tip */
  private drawLever(tx: number, ty: number) {
    const { ctx: c, U, dpr } = this, px = LEVER.pivotX * U, py = LEVER.pivotY * U;
    const ang = Math.atan2(tx - px, py - ty), len = Math.hypot(tx - px, ty - py) + 0.35 * U;
    c.save(); c.translate(px, py); c.rotate(ang);
    const w = 0.34 * U, bg = c.createLinearGradient(-w / 2, 0, w / 2, 0);
    bg.addColorStop(0, "#a88c5c"); bg.addColorStop(0.4, "#ecdcb4"); bg.addColorStop(1, "#9b7f50");
    c.fillStyle = bg; c.beginPath(); c.roundRect(-w / 2, -len, w, len + 0.15 * U, w / 2); c.fill();
    c.strokeStyle = "rgba(90,66,30,0.55)"; c.lineWidth = 1.4 * dpr;
    for (let y = -0.85 * U; y > -len + 0.2 * U; y -= 0.75 * U) { c.beginPath(); c.moveTo(-w / 2, y); c.lineTo(w / 2, y); c.stroke(); }
    c.fillStyle = "#1d2022"; c.fillRect(-w / 2 - dpr, -0.75 * U, w + 2 * dpr, 0.5 * U);   // the grip
    c.restore();
    // the pivot bolt and the clip at the tip
    c.fillStyle = "#c9ced0"; c.beginPath(); c.arc(px, py, 0.13 * U, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#d9dee0"; c.beginPath(); c.roundRect(tx - 0.16 * U, ty - 0.12 * U, 0.32 * U, 0.24 * U, 0.05 * U); c.fill();
  }

  /** a 7-inch metal reel: brown tape pack, a silver flange with three windows, the hub keys */
  private drawReel() {
    const { ctx: c, U, dpr } = this, F = 3.6 * U, pack = SUPPLY_R * F, r = this.reel;
    c.save(); c.translate(r.c.x, r.c.y); c.rotate(r.angle);
    const pg = c.createRadialGradient(0, 0, HUB_R * F, 0, 0, pack);
    pg.addColorStop(0, "#3a2414"); pg.addColorStop(1, "#6b4529");
    c.fillStyle = pg; c.beginPath(); c.arc(0, 0, pack, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(0,0,0,0.18)"; c.lineWidth = dpr;
    for (let k = HUB_R * F + 3 * dpr; k < pack; k += 4 * dpr) { c.beginPath(); c.arc(0, 0, k, 0, Math.PI * 2); c.stroke(); }
    // flange with three windows, cut out with even-odd so the pack shows through
    c.beginPath(); c.arc(0, 0, F, 0, Math.PI * 2);
    for (let w = 0; w < 3; w++) {
      const a0 = w * 2 * Math.PI / 3 + 0.32, a1 = a0 + 1.45, ri = 0.38 * F, ro = 0.88 * F;
      c.moveTo(Math.cos(a0) * ro, Math.sin(a0) * ro); c.arc(0, 0, ro, a0, a1); c.arc(0, 0, ri, a1, a0, true); c.closePath();
    }
    const fg = c.createLinearGradient(-F, -F, F, F);
    fg.addColorStop(0, "#f1f4f5"); fg.addColorStop(0.45, "#9aa2a6"); fg.addColorStop(0.55, "#c3c9cc"); fg.addColorStop(1, "#6f777b");
    c.fillStyle = fg; c.fill("evenodd");
    c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 1.2 * dpr; c.beginPath(); c.arc(0, 0, F - dpr, 0, Math.PI * 2); c.stroke();
    c.fillStyle = "#2a2e30"; c.beginPath(); c.arc(0, 0, 0.26 * F, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#d7dcde";
    for (let k = 0; k < 3; k++) { c.rotate(2 * Math.PI / 3); c.fillRect(-0.035 * F, 0.08 * F, 0.07 * F, 0.12 * F); }
    c.beginPath(); c.arc(0, 0, 0.07 * F, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  dispose() {
    this.alive = false;
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.head?.dispose();
    for (const n of this.nodes) { if (n instanceof AudioBufferSourceNode) { try { n.stop(); } catch { /* stopped */ } } n.disconnect(); }
    this.nodes = []; this.head = null;
    this.closeMic();
  }
}

/** the outer tangent on the left side from a reel to the guide below it: p1 on the reel, p2 on the guide */
function tangent(c1: Pt, r1: number, c2: Pt, r2: number) {
  const dx = c2.x - c1.x, dy = c2.y - c1.y, d = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
  const al = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
  const cands = [th + al, th - al].map((a) => ({ p1: { x: c1.x + r1 * Math.cos(a), y: c1.y + r1 * Math.sin(a) }, p2: { x: c2.x + r2 * Math.cos(a), y: c2.y + r2 * Math.sin(a) } }));
  return cands[0].p1.x < cands[1].p1.x ? cands[0] : cands[1];
}
