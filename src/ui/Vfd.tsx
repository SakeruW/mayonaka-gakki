import type { ReactNode } from "react";

/**
 * The one display every instrument uses, always laid out the same way:
 *   top left  — what is sounding (a ring, a set, the tape's state)
 *   top right — the instrument's one live value (rpm, stripes, speed)
 *   big       — what you hear (a note), or for the tape where it is on the tape
 *   meter     — tuning: one segment, centre = in tune, pink when well off;
 *               or a bar from the centre (the tape's speed: right = forward, left = back)
 *   bottom    — supporting values, few
 */
export interface VfdProps {
  topLeft?: ReactNode;
  topRight?: ReactNode;
  /** a note (big name, small octave) or any short readout such as "--", "12:00" or "0:12.4" */
  note: { name: string; oct: number } | string;
  /** dim the big readout: nothing is sounding */
  rest?: boolean;
  /** blink like an unset clock */
  blink?: boolean;
  /** tuning needle, ±50 cents; null leaves it dark */
  cents?: number | null;
  /** a bar from the centre instead of the needle, −1..1 */
  bar?: number | null;
  bottom?: ReactNode[];
}

const SEGS = 21, CENTRE = 10;

export function Vfd({ topLeft, topRight, note, rest, blink, cents = null, bar = null, bottom = [] }: VfdProps) {
  let lit: (i: number) => string;
  if (bar !== null) {
    const reach = Math.round(Math.max(-1, Math.min(1, bar)) * CENTRE);
    lit = (i) => (reach !== 0 && Math.sign(i - CENTRE) === Math.sign(reach) && Math.abs(i - CENTRE) <= Math.abs(reach) ? " on" : "");
  } else {
    const on = cents === null ? -1 : Math.max(0, Math.min(SEGS - 1, Math.round(cents / 5) + CENTRE));
    const off = cents !== null && Math.abs(cents) > 10;
    lit = (i) => (i === on ? " on" + (off ? " off" : "") : "");
  }
  return (
    <div className="vfd" aria-live="off">
      <div className="top"><span>{topLeft}</span><span>{topRight}</span></div>
      <div className={"note" + (rest ? " rest" : "") + (blink ? " blink" : "")}>
        {typeof note === "string" ? note : <>{note.name}<small>{note.oct}</small></>}
      </div>
      <div className="segs" aria-hidden="true">
        {Array.from({ length: SEGS }, (_, i) => <i key={i} className={(i === CENTRE ? "c" : "") + lit(i)} />)}
      </div>
      <div className="row">{bottom.map((b, i) => <span key={i}>{b}</span>)}</div>
    </div>
  );
}

/** +12¢, −5¢, ±0¢ */
export function signed(v: number, unit: string) { return (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v) + unit; }
