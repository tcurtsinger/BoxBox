import type { StopwatchIcon } from "./icons";
import { RailFeedStatus } from "./RailFeedStatus";

export interface RailItem<T extends string> {
  id: T;
  label: string;
  Icon: typeof StopwatchIcon;
}

/**
 * A left section rail, shared by the railed modes (Race, Tunes). Muted at rest;
 * the active item is teal text with a left-aligned teal marker (DESIGN.md
 * Navigation, in-mode nav). The global telemetry-feed status is pinned to its
 * foot. The owning view supplies the items, the active id, and the select handler.
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
  return (
    <nav className="rail" aria-label={ariaLabel}>
      {items.map(({ id, label, Icon }) => {
        const isActive = id === active;
        return (
          <button
            key={id}
            type="button"
            className={`rail-item${isActive ? " is-active" : ""}`}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onSelect(id)}
          >
            <span className="rail-marker" aria-hidden="true" />
            <Icon size={18} />
            <span className="rail-label">{label}</span>
          </button>
        );
      })}
      <RailFeedStatus />
    </nav>
  );
}
