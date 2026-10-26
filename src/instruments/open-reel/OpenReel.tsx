import { useEffect, useRef, useState } from "react";
import { Vfd, signed } from "../../ui/Vfd";
import { shiftCents, speedText, timeText } from "./model";
import { TapeRig, type Readout } from "./rig";
import "./open-reel.css";

// A 1970s open-reel deck at midnight, set up the Open Reel Ensemble way: the box stands upright with one reel on top,
// and the tape runs down past the heads and out of the box to a lever hinged on its side. Swing the lever to drag the
// tape across the head and back; record onto it with REC.
export default function OpenReel({ title }: { title: string }) {
  const deckRef = useRef<HTMLCanvasElement>(null);
  const needleRef = useRef<HTMLElement>(null);
  const rigRef = useRef<TapeRig | null>(null);
  const [rec, setRec] = useState(false);
  const [readout, setReadout] = useState<Readout>({ s: 0, pos: 0, counter: "0000", recording: false });

  const recRef = useRef(rec);
  useEffect(() => { recRef.current = rec; });

  useEffect(() => {
    const rig = new TapeRig(deckRef.current!, needleRef.current!, { rec: recRef.current }, setReadout, (m) => { if (m === "denied") setRec(false); });
    rigRef.current = rig;
    return () => { rig.dispose(); rigRef.current = null; };
  }, []);
  useEffect(() => { rigRef.current?.update({ rec }); }, [rec]);

  // keyboard: hold ↑ or → to swing the lever up (tape forward), ↓ or ← to swing it down (back), R record
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
      const rig = rigRef.current;
      const dir = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
      if (dir) { rig?.rock(dir); e.preventDefault(); return; }
      if (e.repeat) return;
      if (e.key.toLowerCase() === "r") { rig?.wake(); setRec((r) => !r); }
    };
    const up = (e: KeyboardEvent) => { if (e.key.startsWith("Arrow")) rigRef.current?.rock(0); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const cents = shiftCents(readout.s);
  return (
    <main className="instrument open-reel" aria-label={title}>
      <div className="face">
        <canvas ref={deckRef} className="deck" role="img" aria-label="オープンリールデッキ" />
      </div>
      <div className="panel">
        <Vfd topLeft="19cm/s" topRight={readout.counter} note={speedText(readout.s)} rest={Math.abs(readout.s) < 0.01}
             cents={cents === null ? null : Math.max(-50, Math.min(50, cents))}
             bottom={[timeText(readout.pos), cents === null ? "" : signed(cents, "¢")]} />
        <div className="meter">
          <div className="vu" aria-hidden="true"><i ref={needleRef} className="needle" /></div>
          <i className={"rec-led" + (readout.recording ? " on" : "")} aria-hidden="true" />
        </div>
        <button type="button" className="tkey rec" aria-label="録音" aria-pressed={rec} onClick={() => { rigRef.current?.wake(); setRec((r) => !r); }}><i /></button>
      </div>
    </main>
  );
}
