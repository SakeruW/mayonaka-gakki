import { useEffect, useRef, useState } from "react";
import { fanHarpHz } from "../../engine/pattern-wave";
import { Knob, pitchRing } from "../../ui/Knob";
import { Vfd, signed } from "../../ui/Vfd";
import { Keys, Rocker } from "../../ui/controls";
import { useCompact } from "../../ui/useCompact";
import { DUTY, MAX_RINGS, NOTE_CHOICES, SPEED_KEYS, TEMPLATES, fitDisc, noteHz, ringsOf, scaleOf, type Disc } from "./model";
import { FanRig, type TunerState } from "./rig";
import "./fan-harp.css";

const HUB_KEY = "fanharp-hub", DISCS_KEY = "fanharp-discs", MAX_CUSTOM = 6;
const NEW_DISC_NOTES = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];

function loadHub() { try { return localStorage.getItem(HUB_KEY); } catch { return null; } }
/** discs the player made, rebuilt from their notes; kept only in this browser */
function loadCustom(): Disc[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DISCS_KEY) ?? "[]") as { id: string; notes: string[] }[];
    return raw.filter((d) => Array.isArray(d.notes) && d.notes.length && d.notes.every((n) => NOTE_CHOICES.includes(n)))
              .slice(0, MAX_CUSTOM).map((d, i) => makeDisc(d.id, i, d.notes));
  } catch { return []; }
}
function saveCustom(discs: Disc[]) {
  try { localStorage.setItem(DISCS_KEY, JSON.stringify(discs.map((d) => ({ id: d.id, notes: d.notes })))); } catch { /* not kept after a reload */ }
}
function makeDisc(id: string, i: number, notes: string[]): Disc {
  const fit = fitDisc(notes);
  return { id, label: `自作${i + 1}`, notes, slots: fit.slots, rpm: fit.rpm };
}

/** a disc drawn small: each ring's holes as a dashed band */
function DiscThumb({ slots }: { slots: readonly number[] }) {
  const R = 20;
  return (
    <svg viewBox="-24 -24 48 48" aria-hidden="true">
      <circle r={R} className="plate" />
      {ringsOf(slots).map((g, i) => {
        const r = g.rc * R, c = 2 * Math.PI * r;
        return <circle key={i} r={r} className="holes" strokeWidth={g.w * R} strokeDasharray={`${c * DUTY / g.N} ${c * (1 - DUTY) / g.N}`} />;
      })}
      <circle r={R * 0.19} className="hub" />
    </svg>
  );
}

// A Showa electric fan at midnight: bulb behind the spinning slotted disc, chrome guard, pink Light-Pick.
// Its mint base holds the VFD, the speed keys, the dimmer, the bulb's I/O rocker and the disc tray.
export default function FanHarp({ title }: { title: string }) {
  const stageRef = useRef<HTMLCanvasElement>(null);
  const rigRef = useRef<FanRig | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const partsRef = useRef<HTMLElement>(null);
  const trayBtnRef = useRef<HTMLButtonElement>(null);
  const compact = useCompact();
  const [custom, setCustom] = useState<Disc[]>(loadCustom);
  const [discId, setDiscId] = useState(TEMPLATES[0].id);
  const [speed, setSpeed] = useState(2);
  const [bend, setBend] = useState(0);
  const [bulb, setBulb] = useState(true);
  const [hub, setHub] = useState<string | null>(loadHub);
  const [hubBad, setHubBad] = useState(false);
  const [tray, setTray] = useState(false);
  const [tuner, setTuner] = useState<TunerState>({ rpm: 0, reading: null });

  const disc = [...TEMPLATES, ...custom].find((d) => d.id === discId) ?? TEMPLATES[0];
  const slots = disc.slots, base = disc.rpm;
  const settings = { slots, base, speed, bend, bulb };
  const settingsRef = useRef(settings);
  const ringsRef = useRef(slots.length);
  useEffect(() => { settingsRef.current = settings; ringsRef.current = slots.length; });

  useEffect(() => {
    const rig = new FanRig(stageRef.current!, settingsRef.current, setTuner);
    rigRef.current = rig;
    return () => { rig.dispose(); rigRef.current = null; };
  }, []);
  useEffect(() => { rigRef.current?.update({ slots, base, speed, bend, bulb }); }, [slots, base, speed, bend, bulb]);

  // the hub picture is read locally and kept only in this browser
  useEffect(() => {
    if (!hub) { rigRef.current?.setHub(null); return; }
    const im = new Image();
    let live = true;
    im.onload = () => { if (live) { rigRef.current?.setHub(im); setHubBad(false); } };
    im.onerror = () => { if (live) setHubBad(true); };
    im.src = hub;
    return () => { live = false; };
  }, [hub]);

  // the tray closes on a tap anywhere else
  useEffect(() => {
    if (!tray) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!partsRef.current?.contains(t) && !trayBtnRef.current?.contains(t)) setTray(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [tray]);

  // keyboard: 1–9 put the pick on a ring, Z X C V speed keys, ←→ dimmer
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
      const d = parseInt(e.key, 10);
      if (d >= 1 && d <= 9) { if (!e.repeat && d <= ringsRef.current) rigRef.current?.keyDown(d - 1); e.preventDefault(); return; }
      const k = "zxcv".indexOf(e.key.toLowerCase());
      if (k >= 0 && e.key.length === 1) { rigRef.current?.wake(); setSpeed(k); return; }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { setBend((b) => Math.max(-200, Math.min(200, b + (e.key === "ArrowRight" ? 10 : -10)))); e.preventDefault(); }
      if (e.key === "Escape") setTray(false);
    };
    const up = (e: KeyboardEvent) => { const d = parseInt(e.key, 10); if (d >= 1 && d <= 9) rigRef.current?.keyUp(d - 1); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // ---------- custom discs: pick a note per ring; holes and the 強 speed follow ----------
  const keep = (next: Disc[]) => { const named = next.map((d, i) => ({ ...d, label: `自作${i + 1}` })); setCustom(named); saveCustom(named); };
  const newDisc = () => {
    if (custom.length >= MAX_CUSTOM) return;
    const d = makeDisc("my-" + Date.now().toString(36), custom.length, NEW_DISC_NOTES);
    keep([...custom, d]); setDiscId(d.id);
  };
  const editNotes = (notes: string[]) => keep(custom.map((d, i) => (d.id === disc.id ? makeDisc(d.id, i, notes) : d)));
  const setNote = (i: number, note: string) => editNotes(disc.notes!.map((n, k) => (k === i ? note : n)));
  const addRing = () => {
    const notes = disc.notes!, last = NOTE_CHOICES.indexOf(notes[notes.length - 1]);
    if (notes.length < MAX_RINGS) editNotes([...notes, NOTE_CHOICES[Math.min(NOTE_CHOICES.length - 1, last + 2)]]);
  };
  const removeRing = (i: number) => { if (disc.notes!.length > 1) editNotes(disc.notes!.filter((_, k) => k !== i)); };
  const deleteDisc = () => { keep(custom.filter((d) => d.id !== disc.id)); setDiscId(TEMPLATES[0].id); };

  const pickHub = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\//.test(f.type)) { setHubBad(true); return; }
    const rd = new FileReader();
    rd.onload = () => {
      const url = String(rd.result);
      setHub(url);
      try { localStorage.setItem(HUB_KEY, url); } catch { /* too big to keep after a reload; it still shows now */ }
    };
    rd.readAsDataURL(f);
  };
  const clearHub = () => {
    setHub(null); setHubBad(false);
    if (fileRef.current) fileRef.current.value = "";
    try { localStorage.removeItem(HUB_KEY); } catch { /* nothing kept */ }
  };

  const r = tuner.reading;
  // the tray describes the disc itself, at its 強 speed; the main VFD shows what is sounding now
  const scale = scaleOf(slots, base);
  const wake = () => rigRef.current?.wake();

  return (
    <main className="instrument fan-harp" aria-label={title}>
      <div className="fan">
        <canvas ref={stageRef} className="stage" role="img" aria-label="扇風琴" />
      </div>
      <div className="base" onPointerDownCapture={wake}>
        <Vfd topRight={r ? `${r.best + 1}輪目　${r.N}穴` : ""} note={r ? { name: r.name, oct: r.oct } : "--"} rest={!r}
             cents={r ? r.cents : null}
             bottom={[r ? r.hz.toFixed(1) + "Hz" : "", `${tuner.rpm}rpm`, r ? (r.also.length ? "+ " + r.also.join(" ") : signed(r.cents, "¢")) : ""]} />
        <div className="ctrl">
          <Keys<number> label="風量" value={speed} onChange={setSpeed}
                        options={SPEED_KEYS.map((k, i) => ({ value: i, label: k, content: k, className: "k" + i }))} />
          <div className="under">
            <Knob className="dimmer" label="ディマー" value={bend} min={-200} max={200} step={2} rest={0} onChange={setBend}
                  size={compact ? 44 : 62} ring={pitchRing} ringFrom={0.5} />
            <div className="switches">
              <Rocker className="power" label="電球" on={bulb} onClick={() => setBulb((b) => !b)}>
                <i className="mark-on" /><i className="mark-off" />
              </Rocker>
              <button ref={trayBtnRef} type="button" className="tray-btn" aria-label="円盤を替える" aria-expanded={tray}
                      onClick={() => setTray((o) => !o)}><DiscThumb slots={slots} /></button>
            </div>
          </div>
        </div>

        <section ref={partsRef} className="parts" aria-label="円盤" hidden={!tray}>
          <div className="parts-top">
            <div className="discs" role="group" aria-label="円盤の種類">
              {[...TEMPLATES, ...custom].map((d) => (
                <button key={d.id} type="button" className={"disc" + (d.notes ? " mine" : "")} aria-pressed={disc.id === d.id} aria-label={d.label}
                        onClick={() => setDiscId(d.id)}>
                  <DiscThumb slots={d.slots} />
                </button>
              ))}
              {custom.length < MAX_CUSTOM && <button type="button" className="disc new" aria-label="円盤を作る" onClick={newDisc} />}
            </div>
            <div className="hubs">
              <button type="button" className="hubpick" aria-label="ハブの写真を選ぶ" aria-invalid={hubBad}
                      style={hub ? { backgroundImage: `url(${JSON.stringify(hub)})` } : undefined} onClick={() => fileRef.current?.click()} />
              {hub && <button type="button" className="hubclear" aria-label="ハブの写真を外す" onClick={clearHub} />}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickHub(e.target.files?.[0])} />
            </div>
          </div>
          <div className="vfd scale" aria-label="円盤の音階">
            <div className="top">
              <span>{scale.just ? "純正律" : ""}</span>
              <span>{`強 ${base}rpm`}{disc.notes && <button type="button" className="x" aria-label="この円盤を消す" onClick={deleteDisc} />}</span>
            </div>
            <ol>
              {scale.rings.map((g, i) => {
                const want = disc.notes?.[i];
                const off = want ? Math.round(1200 * Math.log2(fanHarpHz(g.holes, base) / noteHz(want))) : g.cents;
                return (
                  <li key={i} className={r?.best === i ? "on" : undefined}>
                    <span>{i + 1}</span><span>{g.holes}穴</span><span>{g.ratio}</span>
                    {want
                      ? <select value={want} aria-label={`${i + 1}輪目の音`} onChange={(e) => setNote(i, e.target.value)}>
                          {NOTE_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      : <span>{g.name}{g.oct}</span>}
                    <span>{signed(off, "¢")}</span>
                    <span>{g.hz.toFixed(1)}Hz</span>
                    {want && <button type="button" className="x" aria-label={`${i + 1}輪目を外す`} disabled={slots.length <= 1} onClick={() => removeRing(i)} />}
                  </li>
                );
              })}
            </ol>
            {disc.notes && slots.length < MAX_RINGS && <button type="button" className="plus" aria-label="輪を足す" onClick={addRing} />}
          </div>
        </section>
      </div>
    </main>
  );
}
