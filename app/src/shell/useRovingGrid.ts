import { useEffect, useRef, useState, type KeyboardEvent } from "react";

/**
 * Roving-tabindex keyboard navigation for a `role="grid"` of selectable rows: only
 * the active row is in the tab order, Up/Down/Home/End move focus between rows, and
 * Enter/Space activates — the WAI-ARIA grid pattern. This replaces the prior
 * "every row is `tabIndex=0`" approach, which is the wrong semantics for a table
 * and floods the tab order (P3.4).
 *
 * Spread `rowProps(i, onSelect)` onto each `role="row"`; the grid container takes
 * `role="grid"` and its cells `role="gridcell"`.
 */
export function useRovingGrid(count: number) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);

  // Keep the active index in range as the grid grows/shrinks between polls.
  useEffect(() => {
    if (count > 0 && active > count - 1) setActive(count - 1);
  }, [count, active]);

  const focusRow = (i: number) => {
    const n = Math.max(0, Math.min(count - 1, i));
    setActive(n);
    refs.current[n]?.focus();
  };

  const rowProps = (i: number, onSelect: () => void) => ({
    ref: (el: HTMLElement | null) => {
      refs.current[i] = el;
    },
    tabIndex: i === active ? 0 : -1,
    onFocus: () => setActive(i),
    onClick: onSelect,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          focusRow(i + 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          focusRow(i - 1);
          break;
        case "Home":
          e.preventDefault();
          focusRow(0);
          break;
        case "End":
          e.preventDefault();
          focusRow(count - 1);
          break;
      }
    },
  });

  return { rowProps };
}

/** The props `rowProps(...)` returns, for typing a row component that spreads them. */
export type RovingRowProps = ReturnType<ReturnType<typeof useRovingGrid>["rowProps"]>;
