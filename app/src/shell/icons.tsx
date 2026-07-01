/**
 * Hand-rolled inline icon set. One coherent style: 24-unit viewBox, 1.5 stroke,
 * round caps/joins, sized via `size` (default 16). No icon-library dependency.
 */
type IconProps = { size?: number; className?: string };

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

/** Disclosure chevron, pointing down by default; rotate via CSS for other states. */
export function ChevronIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/* ---- Window controls (square 10-unit glyphs centred in 24 box) ---------- */
export function MinimizeIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M7 12h10" />
    </svg>
  );
}

export function MaximizeIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </svg>
  );
}

export function RestoreIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="8.5" y="8.5" width="8" height="8" rx="1.5" />
      <path d="M8.5 11V8a1.5 1.5 0 0 1 1.5-1.5h3" />
    </svg>
  );
}

export function CloseIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M7 7l10 10M17 7 7 17" />
    </svg>
  );
}

/* ---- Section rails (Race + Tunes) --------------------------------------- */
export function StopwatchIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="13.5" r="6.5" />
      <path d="M12 13.5V10M10 2.5h4M18.5 7l1.3-1.3" />
    </svg>
  );
}

export function FlagIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 21V4M6 4.5h9.5l-1.5 3 1.5 3H6" />
    </svg>
  );
}

export function GavelIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 19h7M14.5 4.5l5 5M16 3l4 4M9.5 9.5l5 5M12 7l5 5M6.5 12.5l5 5" />
    </svg>
  );
}

export function ReportIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 16.5h6M9 9.5h2" />
    </svg>
  );
}

/** Horizontal tuning sliders: the Setups library section. */
export function SlidersIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 7h7M16 7h4M4 12h2M11 12h9M4 17h9M18 17h2" />
      <circle cx="13" cy="7" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="15" cy="17" r="2" />
    </svg>
  );
}

/** A dial/gauge with a needle: the Tuner section. */
export function GaugeIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 18a8 8 0 0 0 16 0" />
      <path d="M12 18l4.5-4.5" />
      <circle cx="12" cy="18" r="1.25" />
    </svg>
  );
}

/** A clock with a rewind arrow: the saved-session History section. */
export function HistoryIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

export function PlugIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9 2v5M15 2v5M7 7h10v3a5 5 0 0 1-10 0zM12 15v7" />
    </svg>
  );
}

export function LockIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </svg>
  );
}
