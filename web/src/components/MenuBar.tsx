import { useEffect, useState } from "react";

interface Props {
  onOpenNames: () => void;
  onAbout: () => void;
}

interface MenuItem {
  label: string;
  onClick: () => void;
  checked?: boolean;
  badge?: number;
  disabled?: boolean;
}

// Desktop-style application menu bar. Top-level menus open a dropdown; once one
// is open, hovering a sibling switches to it (the usual menu behaviour).
export function MenuBar({ onOpenNames, onAbout }: Props) {
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
    { label: "Edit", items: [{ label: "Names...", onClick: onOpenNames }] },
    {
      label: "View",
      items: [{ label: "Column picker coming next", onClick: () => {}, disabled: true }],
    },
    { label: "Help", items: [{ label: "About BoxBox", onClick: onAbout }] },
  ];

  const run = (item: MenuItem) => {
    if (item.disabled) return;
    item.onClick();
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
            </button>
            {open === m.label && (
              <div className="menu-dropdown">
                {m.items.map((it) => (
                  <button
                    className={`menu-item${it.disabled ? " disabled" : ""}`}
                    key={it.label}
                    onClick={() => run(it)}
                    disabled={it.disabled}
                  >
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
