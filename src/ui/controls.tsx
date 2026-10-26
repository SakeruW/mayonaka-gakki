import type { ReactNode } from "react";

export interface KeyOption<T> { value: T; label: string; content: ReactNode; className?: string }

/** a row of latching keys; the pressed one stays down */
export function Keys<T extends string | number>({ options, value, onChange, label, className }: {
  options: KeyOption<T>[]; value: T; onChange(v: T): void; label: string; className?: string;
}) {
  return (
    <div className={"keys" + (className ? " " + className : "")} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={"key" + (o.className ? " " + o.className : "")}
                aria-pressed={o.value === value} aria-label={o.label} onClick={() => onChange(o.value)}>
          {o.content}
        </button>
      ))}
    </div>
  );
}

/** a two-way rocker switch; its cap shows the current setting */
export function Rocker({ on, label, onClick, children, className }: {
  on: boolean; label: string; onClick(): void; children?: ReactNode; className?: string;
}) {
  return (
    <button type="button" className={"rocker" + (className ? " " + className : "")} aria-pressed={on} aria-label={label} onClick={onClick}>
      <span>{children}</span>
    </button>
  );
}

/** ▲▼ drawn in CSS, never as text */
export function Stepper({ label, onStep, className }: { label: string; onStep(d: 1 | -1): void; className?: string }) {
  const cls = "step" + (className ? " " + className : "");
  return (
    <>
      <button type="button" className={cls} data-d="1" aria-label={label + "を増やす"} onClick={() => onStep(1)} />
      <button type="button" className={cls} data-d="-1" aria-label={label + "を減らす"} onClick={() => onStep(-1)} />
    </>
  );
}
