import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { STANDARDS, noteOf, stripeHz, type StandardId } from "../../engine/pattern-wave";
import { Knob, driveRing, pitchRing } from "../../ui/Knob";
import { Vfd } from "../../ui/Vfd";
import { Keys, Rocker, Stepper } from "../../ui/controls";
import { useCompact } from "../../ui/useCompact";
import { SCREEN_TEXT, SETS, clampStripes, type Mode } from "./model";
import { CrtRig } from "./rig";
import "./crt-drums.css";

// A rack of Showa CRT sets at midnight, two shelves high; a charcoal video deck below with the VFD,
// the input keys, V-HOLD, drive and the 60i/50i switch.
export default function CrtDrums({ title }: { title: string }) {
  const rackRef = useRef<HTMLElement>(null);
  const rigRef = useRef<CrtRig | null>(null);
  const [mode, setMode] = useState<Mode>("stripes");
  const [std, setStd] = useState<StandardId>("ntsc");
  const [bend, setBend] = useState(0);
  const [drive, setDrive] = useState(45);
  const [stripes, setStripes] = useState<number[]>(() => SETS.map((s) => s.n));
  const [play, setPlay] = useState({ last: -1, sounding: false });
  const compact = useCompact();

  const settings = { mode, text: SCREEN_TEXT, std, bend, drive: drive / 100, stripes };
  const settingsRef = useRef(settings);
  const lastRef = useRef(play.last);
  useEffect(() => { settingsRef.current = settings; lastRef.current = play.last; });

  useEffect(() => {
    const rig = new CrtRig(rackRef.current!, settingsRef.current, (i, on) =>
      setPlay((p) => (on ? { last: i, sounding: true } : p.last === i ? { ...p, sounding: false } : p)));
    rigRef.current = rig;
    return () => { rig.dispose(); rigRef.current = null; };
  }, []);
  useEffect(() => { rigRef.current?.update({ mode, text: SCREEN_TEXT, std, bend, drive: drive / 100, stripes }); }, [mode, std, bend, drive, stripes]);

  const step = useCallback((i: number, d: number) => {
    setStripes((prev) => prev.map((n, k) => (k === i ? clampStripes(n + d) : n)));
    setPlay((p) => (p.last === i ? p : { last: i, sounding: false }));
  }, []);

  // keyboard: Q W E / A S D mirror the two shelves, ↑↓ stripes on the last set, ←→ V-HOLD
  useEffect(() => {
    const keyOf = (e: KeyboardEvent) => SETS.findIndex((s) => s.key === e.key.toLowerCase());
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
      const i = keyOf(e);
      if (i >= 0) { if (!e.repeat) rigRef.current?.press(i, "k", { x: 0.5, y: 0.5 }); e.preventDefault(); return; }
      if (e.target !== document.body) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") { step(Math.max(0, lastRef.current), e.key === "ArrowUp" ? 1 : -1); e.preventDefault(); }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { setBend((b) => Math.max(-100, Math.min(100, b + (e.key === "ArrowRight" ? 10 : -10)))); e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => { const i = keyOf(e); if (i >= 0) rigRef.current?.release(i, "k"); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [step]);

  // VFD: a dim -- until the first hit, as on the other instruments
  const sd = STANDARDS[std];
  let vfd = <Vfd note="--" rest />;
  if (play.last >= 0) {
    const n = stripes[play.last], f = stripeHz(n, sd, bend), nn = noteOf(f);
    vfd = <Vfd topLeft={`${play.last + 1}台目`} topRight={mode === "stripes" ? `縞${n}本` : `「${SCREEN_TEXT}」`}
               note={nn} rest={!play.sounding} cents={nn.cents} bottom={[f.toFixed(1) + "Hz"]} />;
  }

  return (
    <main className="instrument crt-drums" aria-label={title}>
      <div className="rack-area">
      <section className="rack" ref={rackRef} aria-label="ブラウン管ドラム">
        {SETS.map((_, i) => (
          <Fragment key={i}>
          <div className="tv">
            <div className="screen" data-i={i} role="button" aria-label={`${i + 1}台目`}><canvas /><span className="osd" /></div>
            <div className="panel">
              <Stepper label={`${i + 1}台目 縞`} onStep={(d) => step(i, d)} />
              <i className="jacks" /><i className="rca" /><i className="led" />
            </div>
          </div>
          {i % 3 === 2 && <i className="shelf" aria-hidden="true" />}
          </Fragment>
        ))}
      </section>
      </div>

      <div className="deck">
        {vfd}
        <div className="ctrl">
          <Keys<Mode> label="入力" value={mode} onChange={setMode} options={[
            { value: "stripes", label: "縞", content: <i className="bars" /> },
            { value: "text", label: SCREEN_TEXT, content: SCREEN_TEXT },
          ]} />
          <div className="under">
            <Knob className="vhold" label="音程" value={bend} min={-100} max={100} step={2} rest={0} onChange={setBend}
                  size={compact ? 46 : 58} ring={pitchRing} ringFrom={0.5} />
            <Knob className="drive" label="歪み" value={drive} min={0} max={100} step={1} rest={45} onChange={setDrive}
                  size={compact ? 36 : 44} ring={driveRing}
                  style={{ boxShadow: `0 3px 0 rgba(0,0,0,0.45), inset 0 -3px 6px rgba(0,0,0,0.3), 0 0 ${Math.round(drive / 5)}px rgba(242,193,78,${(drive / 100 * 0.55).toFixed(2)})` }} />
            <Rocker label="フィールド周波数" on={std === "pal"} onClick={() => setStd((s) => (s === "ntsc" ? "pal" : "ntsc"))}><b>50</b><b>60</b></Rocker>
          </div>
        </div>
      </div>
    </main>
  );
}
