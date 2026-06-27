import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  onClose: () => void;
  /** Class for the dialog box itself (e.g. "flag-form", "roster-form", "about"). */
  className: string;
  /** Accessible name for the dialog, announced by screen readers. */
  label: string;
  children: ReactNode;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Accessible modal shell: role="dialog" + aria-modal, Escape to close, a focus
// trap so Tab can't leave the dialog, and focus returned to the trigger on
// close. Every steward-facing modal goes through here so the behaviour is
// identical across Flag, Names, and About.
export function Modal({ onClose, className, label, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () =>
      node ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
    // Focus the first interactive element, or the dialog itself as a fallback.
    (focusables()[0] ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !node.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop center" onClick={onClose}>
      <div
        ref={ref}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
