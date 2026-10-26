import { useEffect, useRef, useState } from "react";
import { Knob, pitchRing } from "../../ui/Knob";
import { Vfd, signed } from "../../ui/Vfd";
import { Keys, Rocker } from "../../ui/controls";
import { DUTY, PRESETS, SPEED_KEYS, parseRpm, parseSlots, ringsOf } from "./model";
import { FanRig, type TunerState } from "./rig";
import "./fan-harp.css";

const HUB_KEY = "fanharp-hub";
function loadHub() { try { return localStorage.getItem(HUB_KEY); } catch { return null; } }

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
// Its mint base holds the VFD, the speed keys, the dimmer and the bulb switch; the disc parts sit below.
export default function FanHarp({ title }: { title: string }) {
  const stageRef = useRef<HTMLCanvasElement>(null);
  const rigRef = useRef<FanRig | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [slots, setSlots] = useState<number[]>(() => PRESETS[0].slots.slice());
  const [base, setBase] = useState<number>(PRESETS[0].rpm);
  const [speed, setSpeed] = useState(2);
  const [bend, setBend] = useState(0);
  const [bulb, setBulb] = useState(true);
  const [preset, setPreset] = useState<string>(PRESETS[0].id);
  const [slotsText, setSlotsText] = useState(PRESETS[0].slots.join(", "));
  const [rpmText, setRpmText] = useState(String(PRESETS[0].rpm));
  const [hub, setHub] = useState<string | null>(loadHub);
  const [hubBad, setHubBad] = useState(false);
  const [tuner, setTuner] = useState<TunerState>({ rpm: 0, reading: null });

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

  // keyboard: 1–9 put the pick on a ring, Z X C V speed keys, ←→ dimmer
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
      const d = parseInt(e.key, 10);
      if (d >= 1 && d <= 9) { if (!e.repeat && d <= ringsRef.current) rigRef.current?.keyDown(d - 1); e.preventDefault(); return; }
      const k = "zxcv".indexOf(e.key.toLowerCase());
      if (k >= 0 && e.key.length === 1) { rigRef.current?.wake(); setSpeed(k); return; }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { setBend((b) => Math.max(-200, Math.min(200, b + (e.key === "ArrowRight" ? 10 : -10)))); e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => { const d = parseInt(e.key, 10); if (d >= 1 && d <= 9) rigRef.current?.keyUp(d - 1); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const choosePreset = (p: (typeof PRESETS)[number]) => {
    setSlots(p.slots.slice()); setBase(p.rpm); setPreset(p.id);
    setSlotsText(p.slots.join(", ")); setRpmText(String(p.rpm));
  };
  const slotsOk = parseSlots(slotsText) !== null, rpmOk = parseRpm(rpmText) !== null;
  const commitSlots = () => {
    const s = parseSlots(slotsText);
    if (s && s.join() !== slots.join()) { setSlots(s); setPreset(PRESETS.find((p) => p.slots.join() === s.join())?.id ?? ""); }
  };
  const commitRpm = () => { const v = parseRpm(rpmText); if (v !== null) setBase(v); };
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
  const wake = () => rigRef.current?.wake();

  return (
    <main className="instrument fan-harp" aria-label={title}>
      <h1>{title}</h1>
      <div className="fan">
        <canvas ref={stageRef} className="stage" role="img"
                aria-label="扇風琴" />
        <div className="base" onPointerDownCapture={wake}>
          <Vfd topRight={r ? `${r.best + 1}輪目　${r.N}穴` : ""} note={r ? { name: r.name, oct: r.oct } : "--"} rest={!r}
               cents={r ? r.cents : null}
               bottom={[r ? r.hz.toFixed(1) + "Hz" : "", `${tuner.rpm}rpm`, r ? (r.also.length ? "+ " + r.also.join(" ") : signed(r.cents, "¢")) : ""]} />
          <div className="ctrl">
            <Keys<number> label="風量" value={speed} onChange={setSpeed}
                          options={SPEED_KEYS.map((k, i) => ({ value: i, label: k, content: k, className: "k" + i }))} />
            <div className="under">
              <Knob className="dimmer" label="ディマー" value={bend} min={-200} max={200} step={2} rest={0} onChange={setBend}
                    size={62} ring={pitchRing} ringFrom={0.5} />
              <Rocker className="bulb" label="電球" on={bulb} onClick={() => setBulb((b) => !b)}><i className="lamp" /></Rocker>
            </div>
          </div>
        </div>
      </div>

      <section className="parts" aria-label="円盤">
        <div className="discs" role="group" aria-label="円盤の種類">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className="disc" aria-pressed={preset === p.id} aria-label={p.label} onClick={() => choosePreset(p)}>
              <DiscThumb slots={p.slots} />
            </button>
          ))}
        </div>
        <input className="slots" type="text" value={slotsText} spellCheck={false} autoComplete="off" inputMode="numeric"
               aria-label="穴の数（内側から）" aria-invalid={!slotsOk}
               onChange={(e) => setSlotsText(e.target.value)} onBlur={commitSlots} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
        <input className="rpm" type="number" min={30} max={3000} step={1} value={rpmText} inputMode="numeric"
               aria-label="強の回転数" aria-invalid={!rpmOk}
               onChange={(e) => setRpmText(e.target.value)} onBlur={commitRpm} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
        <div className="hubs">
          <button type="button" className="hubpick" aria-label="ハブの写真を選ぶ" aria-invalid={hubBad}
                  style={hub ? { backgroundImage: `url(${JSON.stringify(hub)})` } : undefined} onClick={() => fileRef.current?.click()} />
          {hub && <button type="button" className="hubclear" aria-label="ハブの写真を外す" onClick={clearHub} />}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickHub(e.target.files?.[0])} />
        </div>
      </section>
    </main>
  );
}
