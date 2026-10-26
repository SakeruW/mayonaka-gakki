import type { ReactNode } from "react";

export interface VfdProps {
  topLeft?: ReactNode;
  topRight?: ReactNode;
  /** a note (big name, small octave) or any short readout such as "--" or "12:00" */
  note: { name: string; oct: number } | string;
  /** dim the note: nothing is sounding */
  rest?: boolean;
  /** blink like an unset clock */
  blink?: boolean;
  /** tuning meter, ±50 cents; null leaves it dark */
  cents: number | null;
  bottom?: ReactNode[];
}

const SEGS = 21, CENTRE = 10;

export function Vfd({ topLeft, topRight, note, rest, blink, cents, bottom = [] }: VfdProps) {
  const on = cents === null ? -1 : Math.max(0, Math.min(SEGS - 1, Math.round(cents / 5) + CENTRE));
  const off = cents !== null && Math.abs(cents) > 10;
  return (
    <div className="vfd" aria-live="off">
      <div className="top"><span>{topLeft}</span><span>{topRight}</span></div>
      <div className={"note" + (rest ? " rest" : "") + (blink ? " blink" : "")}>
        {typeof note === "string" ? note : <>{note.name}<small>{note.oct}</small></>}
      </div>
      <div className="segs" aria-hidden="true">
        {Array.from({ length: SEGS }, (_, i) => (
          <i key={i} className={(i === CENTRE ? "c" : "") + (i === on ? " on" + (off ? " off" : "") : "")} />
        ))}
      </div>
      <div className="row">{bottom.map((b, i) => <span key={i}>{b}</span>)}</div>
    </div>
  );
}

/** +12¢, −5¢, ±0¢ */
export function signed(v: number, unit: string) { return (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v) + unit; }
