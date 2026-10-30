// The running deck: an upright box with one reel on top, the tape down past the heads and out of a slot to the lever
// hinged outside the box; the playback head and the VU needle. Everything per-frame lives here, outside React.
// The view hands in the REC switch and gets readouts back.

import { ensureAudio, setAudioSession } from "../../engine/audio";
import { onFrame } from "../../engine/loop";
import { createTapeHead, type TapeHead } from "../../engine/tape";
import workletUrl from "./tape-worklet.ts?worker&url";
import {
  DECK, HUB_R, LEVER, SLOT, SUPPLY_R, TAPE_RATE, TAPE_SECONDS, demoLoop, headOutput, hissLevel, leverAngle, leverPoint, leverSpeed, reelOmega,
  tapeOut, tapeStep, toneHz,
} from "./model";

export interface DeckSettings { rec: boolean }
export interface Readout { s: number; pos: number; recording: boolean }
export type MicState = "off" | "on" | "denied";

type Pt = { x: number; y: number };
/** a hand on the lever: the only thing that moves the tape */
interface LeverHand { id: number; at: number; v: number; offset: number; lastOut: number }

const ASPECT = DECK.width / DECK.height;

/** the built-in tape takes a moment to synthesise: made once, just after the page opens, and kept for every visit */
let builtIn: Float32Array | null = null;
const builtInTape = () => (builtIn ??= demoLoop(TAPE_RATE));
const REPORT_EVERY = 0.08;
const STALE_MS = 60;          // a hand that hasn't moved for this long is holding still

export class TapeRig {
  private s: DeckSettings;
  private speed = 0;                   // tape speed, × recorded speed
  private pos = 0;                     // where the head is on the tape, in tape seconds: kept here so the display moves with the reel, audio or not
  private reelAngle = 0;
  private phi: number = LEVER.rest;    // the lever's swing below the horizontal
  private keyDir = 0;                  // ↑ ↓ (or ← →) swing the lever from the keyboard
  private lever: LeverHand | null = null;
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
    // make the tape after the first frames are up, so the first touch of the lever doesn't wait for it
    const t = setTimeout(() => { if (this.alive) builtInTape(); }, 120);
    this.cleanup.push(() => clearTimeout(t));
  }

  update(next: DeckSettings) {
    const armed = next.rec && !this.s.rec, disarmed = !next.rec && this.s.rec;
    this.s = { ...next };
    if (armed) void this.openMic();
    if (disarmed) this.closeMic();
  }

  /** hold a key to swing the lever: +1 up (tape forward), −1 down (back), 0 let go */
  rock(dir: number) { if (dir) this.wake(); this.keyDir = dir; }

  // ---------- audio ----------
  /** call inside a gesture: starts audio and threads the tape the first time */
  wake() {
    const ac = ensureAudio();
    if (!ac || this.ac) return;
    this.ac = ac;
    createTapeHead(ac, { tape: builtInTape(), tapeRate: TAPE_RATE, workletUrl }).then((head) => {
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
    // no mic API at all on plain-http pages: browsers only allow microphones on secure (https) pages
    if (this.mic || !navigator.mediaDevices?.getUserMedia) { this.onMic(this.mic ? "on" : "denied"); return; }
    // on iPhones a playback-only audio session may not record: ask for play-and-record while the mic is open
    setAudioSession("play-and-record");
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      // REC may have been switched off, or the page left, while the browser was asking
      if (!this.alive || !this.ac || !this.s.rec) { mic.getTracks().forEach((t) => t.stop()); return; }
      this.mic = mic;
      this.micNode = this.ac.createMediaStreamSource(mic);
      if (this.head) this.micNode.connect(this.head.node);
      this.onMic("on");
    } catch {
      setAudioSession("playback");
      this.onMic("denied");
    }
  }

  /** the mic is only open while REC is armed: switching REC off hands it back to the browser */
  private closeMic() {
    this.micNode?.disconnect();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null; this.micNode = null;
    this.head?.setRecording(false);
    setAudioSession("playback");
  }

  /**
   * What the playback head passes on. It only hears the tape while the tape moves past it, so a stopped tape is silent;
   * and the monitor is off while recording, so the speakers can't feed back into the mic.
   */
  private contact() { return this.recording ? 0 : headOutput(this.speed); }

  // ---------- a hand on the lever ----------
  private bindInput() {
    const cv = this.cv;
    // pointer positions in deck units
    const local = (e: PointerEvent): Pt => { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) / b.width * DECK.width, y: (e.clientY - b.top) / b.width * DECK.width }; };
    const onLever = (p: Pt) => {
      const a = leverPoint(this.phi, 0), b = leverPoint(this.phi), dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1.08, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
      return t > 0.15 && Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) < 0.75;
    };
    const down = (e: PointerEvent) => {
      e.preventDefault();
      this.wake();
      const p = local(e);
      if (!onLever(p)) return;
      try { cv.setPointerCapture(e.pointerId); } catch { /* fine without capture */ }
      this.lever = { id: e.pointerId, at: performance.now(), v: 0, offset: this.phi - leverAngle(p.x, p.y), lastOut: tapeOut(this.phi) };
      cv.classList.add("down");
    };
    const move = (e: PointerEvent) => {
      const lv = this.lever;
      if (!lv || lv.id !== e.pointerId) return;
      const now = performance.now(), p = local(e);
      this.phi = Math.max(LEVER.min, Math.min(LEVER.max, leverAngle(p.x, p.y) + lv.offset));
      const out = tapeOut(this.phi), dt = Math.max(0.004, (now - lv.at) / 1000);
      lv.v = lv.v * 0.4 + ((out - lv.lastOut) / dt) * 0.6;
      lv.lastOut = out; lv.at = now;
    };
    const up = (e: PointerEvent) => { if (this.lever?.id === e.pointerId) { this.lever = null; cv.classList.remove("down"); } };
    const menu = (e: Event) => e.preventDefault();
    const release = () => { this.lever = null; this.keyDir = 0; cv.classList.remove("down"); };
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
    if (this.keyDir && !this.lever) {
      // the keyboard swings the lever at a steady pace, about a full swing in half a second
      const before = tapeOut(this.phi);
      this.phi = Math.max(LEVER.min, Math.min(LEVER.max, this.phi - this.keyDir * 2.2 * dt));
      this.speed = leverSpeed((tapeOut(this.phi) - before) / dt);
    } else if (this.lever) {
      // the tape follows the lever, a little gently so a wobbling finger doesn't jerk it; a lever held still holds it still
      const lv = this.lever, v = now - lv.at > STALE_MS ? 0 : lv.v;
      this.speed += (leverSpeed(v) - this.speed) * (1 - Math.exp(-dt / 0.06));
    } else {
      this.speed = tapeStep(this.speed, dt);
    }
    this.reelAngle += reelOmega(this.speed, SUPPLY_R) * dt;
    this.pos = (((this.pos + this.speed * dt) % TAPE_SECONDS) + TAPE_SECONDS) % TAPE_SECONDS;

    this.recording = this.s.rec && !!this.mic && this.speed > 0.05;
    const head = this.head;
    if (this.ac && head) {
      const t = this.ac.currentTime;
      head.setRate(this.speed);
      head.setContact(this.contact());
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
    const pos = this.pos;
    const key = `${this.speed.toFixed(2)}|${pos.toFixed(1)}|${this.recording}`;
    this.sinceReport += dt;
    if (key === this.lastKey || this.sinceReport < REPORT_EVERY) return;
    this.lastKey = key; this.sinceReport = 0;
    this.onReadout({ s: this.speed, pos, recording: this.recording });
  }

  // ---------- drawing ----------
  private fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = Math.round(this.cv.clientWidth * dpr), H = Math.round(W / ASPECT);
    if (W === this.W && dpr === this.dpr) return;
    this.dpr = dpr; this.W = W; this.H = H; this.U = W / DECK.width;
    this.cv.width = W; this.cv.height = H;
    this.plate = null;
  }

  /** the box: silver brushed aluminium standing on end, its side in shadow, the reel table, the head block, the slot */
  private faceplate() {
    if (this.plate) return this.plate;
    const p = document.createElement("canvas"), { W, H, U, dpr } = this, B = DECK.box;
    p.width = W; p.height = H;
    const c = p.getContext("2d")!;
    const bx = B.x * U, by = B.y * U, bw = B.w * U, bh = B.h * U, depth = 0.28 * U;
    // the floor shadow and the box's right side, seen a little from the left
    c.fillStyle = "rgba(0,0,0,0.45)"; c.beginPath(); c.ellipse(bx + bw * 0.55, by + bh + 0.05 * U, bw * 0.62, 0.22 * U, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#6e7477"; c.beginPath(); c.moveTo(bx + bw, by + 0.15 * U); c.lineTo(bx + bw + depth, by + 0.35 * U);
    c.lineTo(bx + bw + depth, by + bh - 0.05 * U); c.lineTo(bx + bw, by + bh); c.closePath(); c.fill();
    // the front: brushed silver
    const g = c.createLinearGradient(bx, by, bx + bw, by + bh);
    g.addColorStop(0, "#dfe3e5"); g.addColorStop(0.55, "#b9bfc2"); g.addColorStop(1, "#9aa1a4");
    c.fillStyle = g; c.beginPath(); c.roundRect(bx, by, bw, bh, 0.28 * U); c.fill();
    c.save(); c.beginPath(); c.roundRect(bx, by, bw, bh, 0.28 * U); c.clip();
    let seed = 5;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let y = by; y < by + bh; y += 1) { c.fillStyle = `rgba(${rnd() > 0.5 ? "255,255,255" : "0,0,0"},${(rnd() * 0.05).toFixed(3)})`; c.fillRect(bx, y, bw, 1); }
    c.restore();
    c.strokeStyle = "rgba(255,255,255,0.6)"; c.lineWidth = dpr; c.beginPath(); c.roundRect(bx + dpr, by + dpr, bw - 2 * dpr, bh - 2 * dpr, 0.27 * U); c.stroke();
    // corner screws
    c.fillStyle = "#7c8386";
    for (const [sx, sy] of [[0.35, 0.35], [B.w - 0.35, 0.35], [0.35, B.h - 0.35], [B.w - 0.35, B.h - 0.35]]) { c.beginPath(); c.arc(bx + sx * U, by + sy * U, 0.09 * U, 0, Math.PI * 2); c.fill(); }
    // the reel table under the reel
    const R = DECK.reel;
    c.fillStyle = "rgba(40,46,48,0.28)"; c.beginPath(); c.arc(R.x * U, R.y * U, (R.r + 0.15) * U, 0, Math.PI * 2); c.fill();
    // the head block: a dark plate the heads stand on, down the right side
    c.fillStyle = "#2a2f31"; c.beginPath(); c.roundRect(4.75 * U, 5.95 * U, 1.25 * U, 3.3 * U, 0.2 * U); c.fill();
    c.strokeStyle = "rgba(255,255,255,0.12)"; c.lineWidth = dpr; c.stroke();
    // a vent grille in the lower half, and the slot the tape leaves by
    c.fillStyle = "rgba(30,34,36,0.55)";
    for (let k = 0; k < 7; k++) c.beginPath(), c.roundRect(1.0 * U, (7.0 + k * 0.42) * U, 2.9 * U, 0.16 * U, 0.08 * U), c.fill();
    c.fillStyle = "#151819"; c.fillRect((SLOT.x - 0.08) * U, (SLOT.y - 0.28) * U, 0.16 * U, 0.56 * U);
    // the lever's hinge bracket, bolted to the outside of the box
    c.fillStyle = "#8a9194"; c.beginPath(); c.roundRect((LEVER.hingeX - 0.5) * U, (LEVER.hingeY - 0.42) * U, 0.75 * U, 0.84 * U, 0.12 * U); c.fill();
    c.fillStyle = "#5d6467"; c.beginPath(); c.arc((LEVER.hingeX - 0.28) * U, (LEVER.hingeY - 0.22) * U, 0.06 * U, 0, Math.PI * 2); c.arc((LEVER.hingeX - 0.28) * U, (LEVER.hingeY + 0.22) * U, 0.06 * U, 0, Math.PI * 2); c.fill();
    this.plate = p;
    return p;
  }

  private draw() {
    const { ctx: c, W, H, U, dpr } = this, R = DECK.reel, G1 = DECK.guideTop, G2 = DECK.guideLow, TX = DECK.tapeX;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
    c.drawImage(this.faceplate(), 0, 0);
    const tie = leverPoint(this.phi, LEVER.tieAt);

    // the tape: off the reel, round the top guide, down past the heads, round the low guide, out of the slot to the lever
    const a = rightTangent({ x: R.x, y: R.y }, SUPPLY_R * R.r, { x: G1.x, y: G1.y }, G1.r);
    c.strokeStyle = "#5a3a22"; c.lineWidth = 0.13 * U; c.lineCap = "round"; c.lineJoin = "round";
    c.beginPath(); c.moveTo(a.p1.x * U, a.p1.y * U); c.lineTo(a.p2.x * U, a.p2.y * U);
    c.arc(G1.x * U, G1.y * U, G1.r * U, Math.atan2(a.p2.y - G1.y, a.p2.x - G1.x), 0);
    c.lineTo(TX * U, G2.y * U);
    c.arc(G2.x * U, G2.y * U, G2.r * U, 0, Math.atan2(SLOT.y - G2.y, SLOT.x - G2.x) * 0.5);
    c.lineTo(SLOT.x * U, SLOT.y * U);
    c.lineTo(tie.x * U, tie.y * U);
    c.stroke();

    for (const g of [G1, G2]) { c.fillStyle = "#eef1f2"; c.beginPath(); c.arc(g.x * U, g.y * U, g.r * 0.8 * U, 0, Math.PI * 2); c.fill(); c.strokeStyle = "#7c8386"; c.lineWidth = dpr; c.stroke(); }
    // heads: erase, record, playback, chrome blocks with their faces to the tape
    DECK.heads.forEach((hy, i) => {
      const x0 = 5.0 * U, x1 = (TX - 0.02) * U, h = 0.72 * U, y = hy * U - h / 2;
      const hg = c.createLinearGradient(0, y, 0, y + h);
      hg.addColorStop(0, "#7d8487"); hg.addColorStop(0.5, "#eef1f2"); hg.addColorStop(1, "#6c7275");
      c.fillStyle = hg; c.beginPath(); c.roundRect(x0, y, x1 - x0, h, [0.1 * U, 0.34 * U, 0.34 * U, 0.1 * U]); c.fill();
      c.fillStyle = i === 1 && this.recording ? "#ff4f9a" : "#202426"; c.fillRect(x1 - 0.2 * U, hy * U - 0.03 * U, 0.2 * U, 0.06 * U);   // the gap
    });

    this.drawLever(tie);
    this.drawReel();
  }

  /** the lever: a long pale rod on its hinge outside the box, a dark grip at the handle end, the tape clipped partway along */
  private drawLever(tie: Pt) {
    const { ctx: c, U, dpr } = this, hx = LEVER.hingeX * U, hy = LEVER.hingeY * U, L = LEVER.length * U;
    c.save(); c.translate(hx, hy); c.rotate(this.phi);
    c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.roundRect(0.05 * U, 0.12 * U, L, 0.32 * U, 0.16 * U); c.fill();   // its shadow
    const w = 0.32 * U, rg = c.createLinearGradient(0, -w / 2, 0, w / 2);
    rg.addColorStop(0, "#fbf7ee"); rg.addColorStop(0.45, "#e6dfcf"); rg.addColorStop(1, "#b9b09c");
    c.fillStyle = rg; c.beginPath(); c.roundRect(-0.15 * U, -w / 2, L + 0.15 * U, w, w / 2); c.fill();
    c.fillStyle = "#1d2022"; c.beginPath(); c.roundRect(L - 1.0 * U, -w / 2 - dpr, 0.95 * U, w + 2 * dpr, w / 2); c.fill();   // the grip
    c.restore();
    c.fillStyle = "#d9dee0"; c.beginPath(); c.arc(hx, hy, 0.12 * U, 0, Math.PI * 2); c.fill();   // the hinge pin
    c.fillStyle = "#eef1f2"; c.beginPath(); c.arc(tie.x * U, tie.y * U, 0.11 * U, 0, Math.PI * 2); c.fill();   // where the tape is tied
    c.strokeStyle = "#7c8386"; c.lineWidth = dpr; c.stroke();
  }

  /** a 7-inch reel, pale metal: brown tape pack, the flange with three windows, the hub keys */
  private drawReel() {
    const { ctx: c, U, dpr } = this, R = DECK.reel, F = R.r * U, pack = SUPPLY_R * F;
    c.save(); c.translate(R.x * U, R.y * U); c.rotate(this.reelAngle);
    const pg = c.createRadialGradient(0, 0, HUB_R * F, 0, 0, pack);
    pg.addColorStop(0, "#3a2414"); pg.addColorStop(1, "#6b4529");
    c.fillStyle = pg; c.beginPath(); c.arc(0, 0, pack, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(0,0,0,0.18)"; c.lineWidth = dpr;
    for (let k = HUB_R * F + 3 * dpr; k < pack; k += 4 * dpr) { c.beginPath(); c.arc(0, 0, k, 0, Math.PI * 2); c.stroke(); }
    c.beginPath(); c.arc(0, 0, F, 0, Math.PI * 2);
    for (let w = 0; w < 3; w++) {
      const a0 = w * 2 * Math.PI / 3 + 0.32, a1 = a0 + 1.45, ri = 0.38 * F, ro = 0.88 * F;
      c.moveTo(Math.cos(a0) * ro, Math.sin(a0) * ro); c.arc(0, 0, ro, a0, a1); c.arc(0, 0, ri, a1, a0, true); c.closePath();
    }
    const fg = c.createLinearGradient(-F, -F, F, F);
    fg.addColorStop(0, "#ffffff"); fg.addColorStop(0.45, "#c7ccce"); fg.addColorStop(0.55, "#dde1e3"); fg.addColorStop(1, "#8f979a");
    c.shadowColor = "rgba(0,0,0,0.35)"; c.shadowBlur = 6 * dpr; c.shadowOffsetY = 2 * dpr;
    c.fillStyle = fg; c.fill("evenodd");
    c.shadowColor = "transparent";
    c.strokeStyle = "rgba(255,255,255,0.6)"; c.lineWidth = 1.2 * dpr; c.beginPath(); c.arc(0, 0, F - dpr, 0, Math.PI * 2); c.stroke();
    c.fillStyle = "#2a2e30"; c.beginPath(); c.arc(0, 0, 0.26 * F, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#e4e8ea";
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

/** the outer tangent on the right side from the reel's pack down to the guide: p1 on the pack, p2 on the guide */
function rightTangent(c1: Pt, r1: number, c2: Pt, r2: number) {
  const dx = c2.x - c1.x, dy = c2.y - c1.y, d = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
  const al = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
  const cands = [th + al, th - al].map((a) => ({ p1: { x: c1.x + r1 * Math.cos(a), y: c1.y + r1 * Math.sin(a) }, p2: { x: c2.x + r2 * Math.cos(a), y: c2.y + r2 * Math.sin(a) } }));
  return cands[0].p1.x > cands[1].p1.x ? cands[0] : cands[1];
}
