import type { StopwatchIcon } from "./icons";
import { CollapseIcon } from "./icons";
import { useShell } from "./shell-context";

export interface RailItem<T extends string> {
  id: T;
  label: string;
  Icon: typeof StopwatchIcon;
}

/**
 * A left section rail, shared by the railed modes (Race, Tunes). Muted at rest;
 * the active item is teal text with a left-aligned teal marker (DESIGN.md
 * Navigation, in-mode nav). Collapsible to icons only — the toggle sits at the
 * rail's foot and the choice is shared across modes (shell context, persisted).
 * The owning view supplies the items, the active id, and the select handler.
 */
export function SectionRail<T extends string>({
  items,
  active,
  onSelect,
  ariaLabel,
}: {
  items: RailItem<T>[];
  active: T;
  onSelect: (id: T) => void;
  ariaLabel: string;
}) {
  const { railCollapsed, setRailCollapsed } = useShell();
  return (
    <nav className={`rail${railCollapsed ? " is-collapsed" : ""}`} aria-label={ariaLabel}>
      {items.map(({ id, label, Icon }) => {
        const isActive = id === active;
        return (
          <button
            key={id}
            type="button"
            className={`rail-item${isActive ? " is-active" : ""}`}
            aria-current={isActive ? "page" : undefined}
            // Collapsed, the icon is all that's visible — the tooltip carries the name.
            title={railCollapsed ? label : undefined}
            aria-label={label}
            onClick={() => onSelect(id)}
          >
            <span className="rail-marker" aria-hidden="true" />
            <Icon size={18} />
            <span className="rail-label">{label}</span>
          </button>
        );
      })}
      <button
        type="button"
        className="rail-collapse"
        aria-expanded={!railCollapsed}
        aria-label={railCollapsed ? "Expand navigation" : "Collapse navigation"}
        title={railCollapsed ? "Expand" : "Collapse"}
        onClick={() => setRailCollapsed(!railCollapsed)}
      >
        <CollapseIcon size={15} />
      </button>
    </nav>
  );
}
