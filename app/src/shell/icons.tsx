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

/** Double chevron pointing left (rail collapse); flipped via CSS when collapsed. */
export function CollapseIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M11 17l-5-5 5-5" />
      <path d="M18 17l-5-5 5-5" />
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

/* The five section glyphs below are user-supplied artwork (SVG Repo),
   normalised to currentColor so rest/hover/active tints keep working. The
   fill-based ones override base()'s stroke defaults. */

/** Incidents: the wavy racing flag (32-unit source viewBox, kept). */
export function IncidentsIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} viewBox="0 0 32 32" fill="currentColor" stroke="none" className={className}>
      <path d="M21.25 2.979c-5 0-6.333-3-12.666-3-4.084 0-6.584 3.084-6.584 3.084v27.958c0 0.552 0.448 1 1 1s1-0.448 1-1v-12.746c1.055-0.68 2.511-1.296 4.334-1.296 6.333 0 8.166 3 13.166 3s8.5-3 8.5-3v-17s-3.75 3-8.75 3zM28 15.96c-1.13 0.737-3.524 2.019-6.5 2.019-1.966 0-3.308-0.54-5.007-1.223-2.071-0.832-4.419-1.777-8.159-1.777-1.709 0-3.159 0.43-4.334 1.005v-12.108c0.753-0.685 2.394-1.897 4.584-1.897 2.941 0 4.597 0.714 6.35 1.469 1.746 0.752 3.552 1.531 6.316 1.531 2.664 0 5.004-0.737 6.75-1.529v12.509z" />
    </svg>
  );
}

/** Review: a report sheet under a magnifier. */
export function ReviewIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} fill="currentColor" stroke="none" className={className}>
      <path fillRule="evenodd" clipRule="evenodd" d="M15 14.25C13.3431 14.25 12 15.5931 12 17.25C12 18.9069 13.3431 20.25 15 20.25C16.6569 20.25 18 18.9069 18 17.25C18 15.5931 16.6569 14.25 15 14.25ZM10.5 17.25C10.5 14.7647 12.5147 12.75 15 12.75C17.4853 12.75 19.5 14.7647 19.5 17.25C19.5 19.7353 17.4853 21.75 15 21.75C12.5147 21.75 10.5 19.7353 10.5 17.25Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M15.75 8.25H8.25V6.75H15.75V8.25Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M15.75 11.25H8.25V9.75H15.75V11.25Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M5.25 3H16.0607L18.75 5.68934V12H17.25V6.31066L15.4393 4.5H6.75V19.5H9.75V21H5.25V3Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M9.75 14.25H8.25V12.75H9.75V14.25Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M13.5791 16.0854L14.9207 15.4146L15.4634 16.5H16.4999V18H14.5364L13.5791 16.0854Z" />
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
/** Setups: a clipboard (stroke-based, native to the house style). */
export function SetupsIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <path d="M9 12h6M9 16h3" />
      <path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2H9V5Z" />
    </svg>
  );
}

/** Tuner: two vertical fader sliders. */
export function TunerIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} fill="currentColor" stroke="none" className={className}>
      <path
        fillRule="evenodd"
        d="M8,12 L8,22 L6,22 L6,12 L5,12 C3.8954305,12 3,11.1045695 3,10 L3,9 C3,7.8954305 3.8954305,7 5,7 L9,7 C10.1045695,7 11,7.8954305 11,9 L11,10 C11,11.1045695 10.1045695,12 9,12 L8,12 Z M18,17 L18,22 L16,22 L16,17 L15,17 C13.8954305,17 13,16.1045695 13,15 L13,14 C13,12.8954305 13.8954305,12 15,12 L19,12 C20.1045695,12 21,12.8954305 21,14 L21,15 C21,16.1045695 20.1045695,17 19,17 L18,17 Z M8,6 L6,6 L6,2 L8,2 L8,6 Z M18,11 L16,11 L16,2 L18,2 L18,11 Z M5,9 L5,10 L9,10 L9,9 L5,9 Z M15,14 L15,15 L19,15 L19,14 L15,14 Z"
      />
    </svg>
  );
}

/** Bench: two panels with swap arrows (A/B compare). */
export function BenchIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} fill="currentColor" stroke="none" className={className}>
      <path d="M0,18h7V6H0V18z M2,8h3v8H2V8z" />
      <path d="M17,6v12h7V6H17z M22,16h-3V8h3V16z" />
      <path d="M12,3l4,4l-4,4V8H9V6h3V3z" />
      <path d="M12,16h3v2h-3v3l-4-4l4-4V16z" />
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

export function GearIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.03 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01A1.7 1.7 0 0 0 10 4.09V4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z" />
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
