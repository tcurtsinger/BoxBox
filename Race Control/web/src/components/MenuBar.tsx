import { useEffect, useState } from "react";

export interface ViewColumnItem {
  id: string;
  label: string;
  checked: boolean;
  locked: boolean;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  onToggle: () => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
}

interface Props {
  columnItems: ViewColumnItem[];
  onOpenNames: () => void;
  onResetColumns: () => void;
  onShortcuts: () => void;
  onAbout: () => void;
}

type MenuItem =
  | {
      type: "action";
      label: string;
      onClick: () => void;
      checked?: boolean;
      badge?: number;
      disabled?: boolean;
    }
  | { type: "column"; column: ViewColumnItem }
  | { type: "separator"; key: string };

// Desktop-style application menu bar. Top-level menus open a dropdown; once one
// is open, hovering a sibling switches to it (the usual menu behaviour).
export function MenuBar({ columnItems, onOpenNames, onResetColumns, onShortcuts, onAbout }: Props) {
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
    { label: "File", items: [{ type: "action", label: "Reload console", onClick: () => window.location.reload() }] },
    { label: "Edit", items: [{ type: "action", label: "Names...", onClick: onOpenNames }] },
    {
      label: "View",
      items: [
        ...columnItems.map((column) => ({ type: "column" as const, column })),
        { type: "separator", key: "column-reset-separator" },
        { type: "action", label: "Reset columns", onClick: onResetColumns },
      ],
    },
    {
      label: "Help",
      items: [
        { type: "action", label: "Keyboard shortcuts", onClick: onShortcuts },
        { type: "separator", key: "help-separator" },
        { type: "action", label: "About BoxBox", onClick: onAbout },
      ],
    },
  ];

  const run = (item: MenuItem) => {
    if (item.type !== "action" || item.disabled) return;
    item.onClick();
    setOpen(null);
  };

  return (
    <>
      {open && <div className="menu-backdrop" onClick={() => setOpen(null)} />}
      <nav className="menubar">
        {menus.map((menu) => (
          <div className="menu" key={menu.label}>
            <button
              className={`menu-btn${open === menu.label ? " open" : ""}`}
              onClick={() => setOpen((current) => (current === menu.label ? null : menu.label))}
              onMouseEnter={() => setOpen((current) => (current ? menu.label : current))}
            >
              {menu.label}
            </button>
            {open === menu.label && (
              <div className="menu-dropdown">
                {menu.items.map((item) => renderMenuItem(item, run))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </>
  );
}

function renderMenuItem(item: MenuItem, run: (item: MenuItem) => void) {
  if (item.type === "separator") return <div className="menu-separator" key={item.key} />;

  if (item.type === "column") {
    return <ColumnMenuItem column={item.column} key={item.column.id} />;
  }

  return (
    <button
      className={`menu-item${item.disabled ? " disabled" : ""}`}
      key={item.label}
      onClick={() => run(item)}
      disabled={item.disabled}
    >
      <span className="menu-check">{item.checked ? "\u2713" : ""}</span>
      <span className="menu-item-label">{item.label}</span>
      {item.badge ? <span className="menu-badge">{item.badge}</span> : null}
    </button>
  );
}

function ColumnMenuItem({ column }: { column: ViewColumnItem }) {
  return (
    <div className="menu-item menu-column" data-column-id={column.id}>
      <button
        aria-checked={column.checked}
        aria-label={`${column.checked ? "Hide" : "Show"} ${column.label} column`}
        className="menu-column-toggle"
        disabled={column.locked}
        onClick={column.onToggle}
        role="menuitemcheckbox"
        type="button"
      >
        <span className="menu-check">{column.checked ? "\u2713" : ""}</span>
        <span className="menu-item-label">{column.label}</span>
      </button>
      <span className="menu-column-order" aria-label={`${column.label} column order controls`}>
        <button
          aria-label={`Move ${column.label} earlier`}
          className="menu-order-btn"
          disabled={!column.canMoveEarlier}
          onClick={column.onMoveEarlier}
          type="button"
        >
          {"\u2191"}
        </button>
        <button
          aria-label={`Move ${column.label} later`}
          className="menu-order-btn"
          disabled={!column.canMoveLater}
          onClick={column.onMoveLater}
          type="button"
        >
          {"\u2193"}
        </button>
      </span>
    </div>
  );
}
