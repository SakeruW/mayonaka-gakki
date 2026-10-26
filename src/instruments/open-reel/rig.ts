// The running deck: transport, reels, the tape across the heads, the playback head on the audio thread, the VU needle.
// Everything per-frame lives here, outside React. The view hands in the transport and switches and gets readouts back.

import { ensureAudio } from "../../engine/audio";
import { onFrame } from "../../engine/loop";
import { createTapeHead, type TapeHead } from "../../engine/tape";
import workletUrl from "./tape-worklet.ts?worker&url";
import {
  HUB_R, SUPPLY_R, TAKEUP_R, TAPE_RATE, V0, counter, demoLoop, handSpeed, headContact, hissLevel, motorTarget, reelOmega, tapeStep, toneHz,
  type Transport,
} from "./model";

export interface DeckSettings { transport: Transport; fast: boolean; pitch: number; rec: boolean }
export interface Readout { s: number; pos: number; counter: string; recording: boolean }
export type MicState = "off" | "on" | "denied";

type Pt = { x: number; y: number };
interface Reel { c: Pt; pack: number; angle: number }
interface Grab { reel: number; last: number; offset: number; omega: number; at: number }
/** a finger holding the tape itself and pulling it across the head */
interface Pull { id: number; last: number; vx: number; at: number; f: Pt }

const ASPECT = 1.6;
const REPORT_EVERY = 0.08;

export class TapeRig {
  private s: DeckSettings;
  private speed = 0;                 // tape speed, × recorded speed
  private reels: Reel[] = [{ c: { x: 0, y: 0 }, pack: SUPPLY_R, angle: 0 }, { c: { x: 0, y: 0 }, pack: TAKEUP_R, angle: 0.7 }];
  private grabs = new Map<number, Grab>();
  private pull: Pull | null = null;
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
    const armed = next.rec && !this.s.rec;
    this.s = { ...next };
    if (armed) void this.openMic();
  }

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
    }, () => { /* no audio at all: the deck still turns */ });
  }

  private async openMic() {
    this.wake();
    if (this.mic || !navigator.mediaDevices?.getUserMedia) { this.onMic(this.mic ? "on" : "denied"); return; }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (!this.alive || !this.ac) { mic.getTracks().forEach((t) => t.stop()); return; }
      this.mic = mic;
      this.micNode = this.ac.createMediaStreamSource(mic);
      if (this.head) this.micNode.connect(this.head.node);
      this.onMic("on");
    } catch {
      this.onMic("denied");
    }
  }

  /** a finger knocks the tape against the head: a jolt of tape past it and a moment of hard contact */
  tap(x?: number) {
    this.wake();
    this.dip = { x: x ?? 0.5, amount: 1 };
    if (!this.grabs.size && !this.pull) this.speed += 1.8;
    this.head?.knock(2.4, this.contact());
  }

  private contact() {
    if (this.recording) return 0;   // tape monitor off while recording, so the speakers can't feed back into the mic
    return this.grabs.size || this.pull ? 1 : headContact(this.s.transport);
  }

  // ---------- hands on the reels and the tape ----------
  private bindInput() {
    const cv = this.cv;
    const local = (e: PointerEvent): Pt => { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) * this.dpr, y: (e.clientY - b.top) * this.dpr }; };
    const reelAt = (p: Pt) => this.reels.findIndex((r) => Math.hypot(p.x - r.c.x, p.y - r.c.y) < 3.6 * this.U);
    const angleOn = (i: number, p: Pt) => Math.atan2(p.y - this.reels[i].c.y, p.x - this.reels[i].c.x);
    const down = (e: PointerEvent) => {
      e.preventDefault();
      this.wake();
      const p = local(e), i = reelAt(p);
      if (i >= 0) {
        try { cv.setPointerCapture(e.pointerId); } catch { /* fine without capture */ }
        const a = angleOn(i, p);
        this.grabs.set(e.pointerId, { reel: i, last: a, offset: this.reels[i].angle - a, omega: 0, at: performance.now() });
        cv.classList.add("down");
      } else if (!this.pull && Math.abs(p.y - this.tapeY()) < 0.9 * this.U && p.x > 1.6 * this.U && p.x < 14.4 * this.U) {
        // touching the tape knocks it onto the head; keep hold and drag to pull it across the head
        this.tap(p.x / this.W);
        try { cv.setPointerCapture(e.pointerId); } catch { /* fine without capture */ }
        this.pull = { id: e.pointerId, last: p.x, vx: 0, at: performance.now(), f: p };
      }
    };
    const move = (e: PointerEvent) => {
      const pl = this.pull;
      if (pl && pl.id === e.pointerId) {
        const now = performance.now(), p = local(e), dt = Math.max(0.004, (now - pl.at) / 1000);
        pl.vx = pl.vx * 0.4 + ((p.x - pl.last) / dt) * 0.6;
        pl.last = p.x; pl.at = now; pl.f = p;
        return;
      }
      const g = this.grabs.get(e.pointerId);
      if (!g) return;
      const now = performance.now(), a = angleOn(g.reel, local(e));
      let d = a - g.last;
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      const dt = Math.max(0.004, (now - g.at) / 1000);
      g.omega = g.omega * 0.4 + (d / dt) * 0.6;
      g.last = a; g.at = now;
      this.reels[g.reel].angle = a + g.offset;   // the reel stays under the finger
    };
    const up = (e: PointerEvent) => {
      if (this.pull?.id === e.pointerId) this.pull = null;
      if (this.grabs.delete(e.pointerId) && !this.grabs.size) cv.classList.remove("down");
    };
    const menu = (e: Event) => e.preventDefault();
    const release = () => { this.grabs.clear(); this.pull = null; cv.classList.remove("down"); };
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
    const { transport, fast, pitch } = this.s;
    const g = [...this.grabs.values()].sort((a, b) => b.at - a.at)[0], pl = this.pull;
    if (pl && (!g || pl.at >= g.at)) {
      // a hand pulling the tape moves it across the head at the hand's speed: rightward is forward
      const vx = now - pl.at > 60 ? 0 : pl.vx;
      this.speed += (vx / (V0 * 3.6 * this.U) - this.speed) * (1 - Math.exp(-dt / 0.025));
    } else if (g) {
      // the latest hand on a reel drives the tape; a hand held still holds the tape still
      const omega = now - g.at > 60 ? 0 : g.omega;
      const want = handSpeed(-omega, this.reels[g.reel].pack);   // turning a reel anticlockwise pulls the tape forward
      this.speed += (want - this.speed) * (1 - Math.exp(-dt / 0.03));
    } else {
      this.speed = tapeStep(this.speed, motorTarget(transport, fast, pitch), transport, dt);
    }
    // both reels turn anticlockwise as the tape runs forward; a held reel follows the finger instead
    const held = new Set([...this.grabs.values()].map((g) => g.reel));
    this.reels.forEach((r, i) => { if (!held.has(i)) r.angle -= reelOmega(this.speed, r.pack) * dt; });
    this.revs += reelOmega(this.speed, SUPPLY_R) * dt / (2 * Math.PI);
    this.dip.amount *= Math.exp(-dt / 0.08);

    this.recording = this.s.rec && !!this.mic && transport === "play" && this.speed > 0.05;
    const ac = this.ac, head = this.head;
    if (ac && head) {
      const t = ac.currentTime;
      head.setRate(this.speed);
      if (this.dip.amount < 0.3) head.setContact(this.contact());
      head.setFlutter(transport === "play" && !this.grabs.size && !this.pull);
      head.setRecording(this.recording);
      this.tone?.frequency.setTargetAtTime(toneHz(this.speed), t, 0.02);
      this.hiss?.gain.setTargetAtTime(this.recording ? 0 : hissLevel(this.speed, this.contact()), t, 0.03);
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
    this.reels[0].c = { x: 4.05 * this.U, y: 4.1 * this.U };
    this.reels[1].c = { x: 11.95 * this.U, y: 4.1 * this.U };
    this.plate = null;
  }
  private tapeY() { return 8.95 * this.U; }

  /** the faceplate: black brushed aluminium, drawn once per size */
  private faceplate() {
    if (this.plate) return this.plate;
    const p = document.createElement("canvas"), { W, H, U } = this;
    p.width = W; p.height = H;
    const c = p.getContext("2d")!;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2b2f30"); g.addColorStop(1, "#16191a");
    c.fillStyle = g; c.beginPath(); c.roundRect(0, 0, W, H, 0.45 * U); c.fill();
    let seed = 3;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let y = 0; y < H; y += 1) { c.fillStyle = `rgba(255,255,255,${(rnd() * 0.035).toFixed(3)})`; c.fillRect(0, y, W, 1); }
    // reel tables and the head cover's recess
    for (const r of this.reels) { c.fillStyle = "rgba(0,0,0,0.35)"; c.beginPath(); c.arc(r.c.x, r.c.y, 3.75 * U, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = "#101213"; c.beginPath(); c.roundRect(4.7 * U, 7.55 * U, 6.6 * U, 1.75 * U, 0.3 * U); c.fill();
    c.strokeStyle = "rgba(255,255,255,0.08)"; c.lineWidth = this.dpr; c.stroke();
    this.plate = p;
    return p;
  }

  private draw() {
    const { ctx: c, W, H, U } = this, ty = this.tapeY();
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
    c.drawImage(this.faceplate(), 0, 0);
    const [L, R] = this.reels;
    const g1 = { x: 1.95 * U, y: ty - 0.32 * U }, g2 = { x: 14.05 * U, y: ty - 0.32 * U }, gr = 0.32 * U;

    // the tape: off the left pack, round the left guide, across the heads, past the capstan, round the right guide, onto the right pack
    const a = tangent(L.c, L.pack * 3.6 * U, g1, gr, -1), b = tangent(R.c, R.pack * 3.6 * U, g2, gr, 1);
    const dip = this.dip.amount * 0.35 * U, dx = this.dip.x * W;
    c.strokeStyle = "#5a3a22"; c.lineWidth = 0.13 * U; c.lineCap = "round";
    c.beginPath(); c.moveTo(a.p1.x, a.p1.y); c.lineTo(a.p2.x, a.p2.y);
    c.arc(g1.x, g1.y, gr, Math.atan2(a.p2.y - g1.y, a.p2.x - g1.x), Math.PI / 2, true);
    const f = this.pull?.f;
    if (f && Math.abs(f.y - ty) > 2 * this.dpr) {
      // pinched and pulled: the tape runs straight from each guide to the finger
      c.lineTo(Math.max(g1.x + U, Math.min(g2.x - U, f.x)), ty + Math.max(-1.1 * U, Math.min(1.1 * U, f.y - ty)));
    } else if (dip > 0.5) { c.lineTo(Math.max(g1.x, dx - 1.4 * U), ty); c.quadraticCurveTo(dx, ty + dip * 2, Math.min(g2.x, dx + 1.4 * U), ty); }
    c.lineTo(g2.x, ty);
    c.arc(g2.x, g2.y, gr, Math.PI / 2, Math.atan2(b.p2.y - g2.y, b.p2.x - g2.x), true);
    c.lineTo(b.p1.x, b.p1.y);
    c.stroke();

    // guides
    for (const g of [g1, g2]) { c.fillStyle = "#c9ced0"; c.beginPath(); c.arc(g.x, g.y, gr * 0.8, 0, Math.PI * 2); c.fill(); }
    // heads: erase, record, playback — chrome blocks the tape runs across
    [6.0, 7.6, 9.2].forEach((hx, i) => {
      const x = hx * U, w = 0.95 * U, top = ty - 1.05 * U;
      const hg = c.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      hg.addColorStop(0, "#7d8487"); hg.addColorStop(0.5, "#e4e8ea"); hg.addColorStop(1, "#6c7275");
      c.fillStyle = hg; c.beginPath(); c.roundRect(x - w / 2, top, w, 1.05 * U + 0.06 * U, [0.12 * U, 0.12 * U, 0.4 * U, 0.4 * U]); c.fill();
      c.fillStyle = i === 1 && this.recording ? "#ff4f9a" : "#202426"; c.fillRect(x - 0.03 * U, ty - 0.18 * U, 0.06 * U, 0.2 * U);   // the gap
    });
    // capstan and pinch roller: the roller presses the tape to the capstan while playing
    const cx = 10.75 * U, playing = this.s.transport === "play" && !this.grabs.size && !this.pull;
    c.fillStyle = "#d9dee0"; c.beginPath(); c.arc(cx, ty - 0.16 * U, 0.16 * U, 0, Math.PI * 2); c.fill();
    const py = ty + (playing ? 0.47 : 0.75) * U;
    c.fillStyle = "#0b0c0d"; c.beginPath(); c.arc(cx, py, 0.42 * U, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(255,255,255,0.12)"; c.lineWidth = this.dpr; c.stroke();

    this.reels.forEach((r) => this.drawReel(r));
  }

  /** a 7-inch metal reel: brown tape pack, a silver flange with three windows, the hub keys */
  private drawReel(r: Reel) {
    const { ctx: c, U, dpr } = this, F = 3.6 * U, pack = r.pack * F;
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
    // hub and its three keys
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
    this.micNode?.disconnect();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null; this.micNode = null;
  }
}

/**
 * The outer tangent between two circles, on the side `sign` (−1 = the left/lower side as the tape leaves the left reel,
 * +1 = the right side onto the right reel). p1 is on the first circle, p2 on the second.
 */
function tangent(c1: Pt, r1: number, c2: Pt, r2: number, sign: 1 | -1) {
  const dx = c2.x - c1.x, dy = c2.y - c1.y, d = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
  const al = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
  // of the two outer tangents, take the one further out to the side the tape runs on
  const cands = [th + al, th - al].map((a) => ({ p1: { x: c1.x + r1 * Math.cos(a), y: c1.y + r1 * Math.sin(a) }, p2: { x: c2.x + r2 * Math.cos(a), y: c2.y + r2 * Math.sin(a) } }));
  return sign < 0 ? (cands[0].p1.x < cands[1].p1.x ? cands[0] : cands[1]) : (cands[0].p1.x > cands[1].p1.x ? cands[0] : cands[1]);
}
