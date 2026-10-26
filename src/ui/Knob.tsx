import { useMemo, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

export interface KnobProps {
  value: number;
  min: number;
  max: number;
  step: number;
  /** where a double-click sends it */
  rest: number;
  onChange(value: number): void;
  label: string;
  /** knob diameter in px */
  size: number;
  /** the wave drawn round the knob, -1..1 across the sweep; it shows what the knob does. Keep it a stable function. */
  ring: (t: number) => number;
  /** where the lit part of the ring starts, 0..1 (0.5 for a centre-detent knob) */
  ringFrom?: number;
  className?: string;
  style?: CSSProperties;
}

const SWEEP = 270, N = 180;

// drag up or right to turn, arrow keys for fine steps, double-click to reset
export function Knob({ value, min, max, step, rest, onChange, label, size, ring, ringFrom = 0, className, style }: KnobProps) {
  const drag = useRef<{ x: number; y: number; v: number } | null>(null);
  const set = (v: number) => onChange(Math.max(min, Math.min(max, Math.round(v / step) * step)));
  const t = (value - min) / (max - min);

  const kr = size / 2, R = kr + 9, c = kr + 15;
  const pts = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, a = (-SWEEP / 2 + SWEEP * u) * Math.PI / 180, r = R + 3.5 * ring(u);
      out.push((c + r * Math.sin(a)).toFixed(2) + "," + (c - r * Math.cos(a)).toFixed(2));
    }
    return out;
  }, [ring, R, c]);
  const seg = (a: number, b: number) => {
    const i = Math.round(a * N), j = Math.round(b * N);
    return j > i ? "M" + pts.slice(i, j + 1).join("L") : "";
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, v: value };
    e.preventDefault();
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) set(d.v + ((d.y - e.clientY) + (e.clientX - d.x)) * (max - min) / 240);
  };
  const end = () => { drag.current = null; };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
    if (d) { set(value + d * step * 5); e.preventDefault(); e.stopPropagation(); }
  };

  return (
    <div className={"dial" + (className ? " " + className : "")}>
      <svg viewBox={`0 0 ${2 * c} ${2 * c}`} aria-hidden="true">
        <path className="dim" d={seg(0, 1)} />
        <path className="lit" d={seg(Math.min(ringFrom, t), Math.max(ringFrom, t))} />
      </svg>
      <div
        className="knob"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        style={{ width: size, height: size, transform: `rotate(${t * SWEEP - SWEEP / 2}deg)`, ...style }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={key}
        onDoubleClick={() => set(rest)}
      />
    </div>
  );
}

/** pitch: the wave packs tighter as the knob turns up */
export function pitchRing(t: number) { return Math.sin(2 * Math.PI * (1.5 * t + 4.5 * t * t)); }

/** drive: the wave squares off as the knob turns up */
export function driveRing(t: number) { const g = 1 + 10 * t * t; return Math.tanh(g * Math.sin(2 * Math.PI * 3.5 * t)) / Math.tanh(g); }
