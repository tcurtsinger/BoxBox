import { useRef, type KeyboardEvent } from "react";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string | number> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Group/option/active class names — each call site keeps its own look. */
  groupClassName?: string;
  optionClassName?: string;
  activeClassName?: string;
}

/**
 * Accessible single-select segmented control implementing the WAI-ARIA
 * radiogroup pattern: a single tab stop (roving tabindex) with Arrow / Home /
 * End keys moving focus *and* selection, matching the role="radio" semantics it
 * announces. Visuals are entirely caller-driven so it can wear any skin.
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  groupClassName = "seg",
  optionClassName = "seg-opt",
  activeClassName = "is-active",
}: SegmentedProps<T>) {
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  const current = options.findIndex((o) => o.value === value);
  const focusIndex = current < 0 ? 0 : current;

  const select = (i: number) => {
    const n = options.length;
    const idx = ((i % n) + n) % n;
    onChange(options[idx].value);
    btns.current[idx]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        select(i + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        select(i - 1);
        break;
      case "Home":
        e.preventDefault();
        select(0);
        break;
      case "End":
        e.preventDefault();
        select(options.length - 1);
        break;
    }
  };

  return (
    <div className={groupClassName} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              btns.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={i === focusIndex ? 0 : -1}
            className={`${optionClassName}${active ? ` ${activeClassName}` : ""}`}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
