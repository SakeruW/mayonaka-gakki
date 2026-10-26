import { useEffect, useRef, useState } from "react";
import { Knob, pitchRing } from "../../ui/Knob";
import { Vfd, signed } from "../../ui/Vfd";
import { Rocker } from "../../ui/controls";
import { useCompact } from "../../ui/useCompact";
import { PITCH_RANGE, shiftCents, speedText, timeText, type Transport } from "./model";
import { TapeRig, type Readout } from "./rig";
import "./open-reel.css";

const KEYS: { t: Transport | "stopkey"; label: string }[] = [
  { t: "rew", label: "巻き戻し" }, { t: "play", label: "再生" }, { t: "ff", label: "早送り" }, { t: "stopkey", label: "停止" },
];

// A 1970s open-reel deck at midnight: two metal reels and the tape across the heads on a black brushed faceplate,
// the transport keys, VFD, VU meter, pitch and the 19/38 cm/s switch below.
// Grab a reel to scratch the tape, tap the tape to knock it against the head, record onto it with REC.
export default function OpenReel({ title }: { title: string }) {
  const deckRef = useRef<HTMLCanvasElement>(null);
  const needleRef = useRef<HTMLElement>(null);
  const rigRef = useRef<TapeRig | null>(null);
  const compact = useCompact();
  const [transport, setTransport] = useState<Transport>("stop");
  const [fast, setFast] = useState(false);
  const [pitch, setPitch] = useState(0);
  const [rec, setRec] = useState(false);
  const [readout, setReadout] = useState<Readout>({ s: 0, pos: 0, counter: "0000", recording: false });

  const settings = { transport, fast, pitch, rec };
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; });

  useEffect(() => {
    const rig = new TapeRig(deckRef.current!, needleRef.current!, settingsRef.current, setReadout, (m) => { if (m === "denied") setRec(false); });
    rigRef.current = rig;
    return () => { rig.dispose(); rigRef.current = null; };
  }, []);
  useEffect(() => { rigRef.current?.update({ transport, fast, pitch, rec }); }, [transport, fast, pitch, rec]);

  const press = (t: Transport | "stopkey") => { rigRef.current?.wake(); setTransport(t === "stopkey" ? "stop" : t); };

  // keyboard: space play/stop, ← → rewind / fast forward, ↓ stop, R record, T tap the tape
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const rig = rigRef.current;
      if (e.key === " ") { rig?.wake(); setTransport((t) => (t === "play" ? "stop" : "play")); e.preventDefault(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { rig?.wake(); setTransport(e.key === "ArrowLeft" ? "rew" : "ff"); e.preventDefault(); }
      else if (e.key === "ArrowDown") { setTransport("stop"); e.preventDefault(); }
      else if (e.key.toLowerCase() === "r") { rig?.wake(); setRec((r) => !r); }
      else if (e.key.toLowerCase() === "t") rig?.tap();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const cents = shiftCents(readout.s);
  return (
    <main className="instrument open-reel" aria-label={title}>
      <div className="face">
        <canvas ref={deckRef} className="deck" role="img" aria-label="オープンリールデッキ" />
      </div>
      <div className="panel">
        <Vfd topLeft={`${fast ? 38 : 19}cm/s`} topRight={readout.counter} note={speedText(readout.s)} rest={Math.abs(readout.s) < 0.01}
             cents={cents === null ? null : Math.max(-50, Math.min(50, cents))}
             bottom={[timeText(readout.pos), cents === null ? "" : signed(cents, "¢")]} />
        <div className="meter">
          <div className="vu" aria-hidden="true"><i ref={needleRef} className="needle" /></div>
          <i className={"rec-led" + (readout.recording ? " on" : "")} aria-hidden="true" />
        </div>
        <div className="ctrl">
          <div className="transport" role="group" aria-label="操作">
            {KEYS.map((k) => (
              <button key={k.t} type="button" className={"tkey " + k.t} aria-label={k.label}
                      aria-pressed={k.t === "stopkey" ? undefined : transport === k.t} onClick={() => press(k.t)}><i /></button>
            ))}
            <button type="button" className="tkey rec" aria-label="録音" aria-pressed={rec} onClick={() => { rigRef.current?.wake(); setRec((r) => !r); }}><i /></button>
          </div>
          <div className="under">
            <Knob className="pitch" label="ピッチ" value={pitch} min={-PITCH_RANGE} max={PITCH_RANGE} step={2} rest={0} onChange={setPitch}
                  size={compact ? 40 : 52} ring={pitchRing} ringFrom={0.5} />
            <Rocker className="speed" label="テープ速度" on={fast} onClick={() => setFast((f) => !f)}>{fast ? 38 : 19}</Rocker>
          </div>
        </div>
      </div>
    </main>
  );
}
