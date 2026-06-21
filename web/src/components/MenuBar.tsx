import { useEffect, useState } from "react";

interface Props {
  view: "live" | "review";
  onSetView: (v: "live" | "review") => void;
  onOpenNames: () => void;
  onAbout: () => void;
  pendingCount: number;
}

interface MenuItem {
  label: string;
  onClick: () => void;
  checked?: boolean;
  badge?: number;
}

// Desktop-style application menu bar. Top-level menus open a dropdown; once one
// is open, hovering a sibling switches to it (the usual menu behaviour).
export function MenuBar({ view, onSetView, onOpenNames, onAbout, pendingCount }: Props) {
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const menus: { label: string; items: MenuItem[] }[] = [
    { label: "File", items: [{ label: "Reload console", onClick: () => window.location.reload() }] },
    { label: "Edit", items: [{ label: "Names…", onClick: onOpenNames }] },
    {
      label: "View",
      items: [
        { label: "Live", checked: view === "live", onClick: () => onSetView("live") },
        { label: "Review", checked: view === "review", badge: pendingCount, onClick: () => onSetView("review") },
      ],
    },
    { label: "Help", items: [{ label: "About BoxBox", onClick: onAbout }] },
  ];

  const run = (fn: () => void) => {
    fn();
    setOpen(null);
  };

  return (
    <>
      {open && <div className="menu-backdrop" onClick={() => setOpen(null)} />}
      <nav className="menubar">
        {menus.map((m) => (
          <div className="menu" key={m.label}>
            <button
              className={`menu-btn${open === m.label ? " open" : ""}`}
              onClick={() => setOpen((o) => (o === m.label ? null : m.label))}
              onMouseEnter={() => setOpen((o) => (o ? m.label : o))}
            >
              {m.label}
              {m.label === "View" && pendingCount > 0 && <span className="menu-btn-dot" />}
            </button>
            {open === m.label && (
              <div className="menu-dropdown">
                {m.items.map((it) => (
                  <button className="menu-item" key={it.label} onClick={() => run(it.onClick)}>
                    <span className="menu-check">{it.checked ? "✓" : ""}</span>
                    <span className="menu-item-label">{it.label}</span>
                    {it.badge ? <span className="menu-badge">{it.badge}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </>
  );
}
