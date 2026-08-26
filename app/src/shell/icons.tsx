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
/** Half-gauge with a needle: the in-race glance dashboard. */
export function DashboardIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.5 16.5a7.5 7.5 0 1 1 15 0" />
      <path d="M12 16.5l3.2-4.2" />
      <path d="M5.5 20h13" />
    </svg>
  );
}

/** Trophy: the League section (standings, rounds, roster). */
export function TrophyIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
      <path d="M8 5H5.5a0 0 0 0 0 0 0c0 2.5 1 4 2.5 4.5M16 5h2.5c0 2.5-1 4-2.5 4.5" />
      <path d="M12 13v3.5M9 20h6M10.5 16.5h3" />
    </svg>
  );
}

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

/** Steering wheel — the league's chosen input-device glyph (SVG Repo, archived
 *  in assets/design/input-detection/). Filled, unlike the stroke set: kept as
 *  supplied, recoloured via currentColor. */
export function SteeringWheelIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M12,2A10,10,0,1,0,22,12,10,10,0,0,0,12,2Zm0,2a8,8,0,0,1,7.38,4.92A29.93,29.93,0,0,0,12,8a29.63,29.63,0,0,0-7.4.94A8,8,0,0,1,12,4ZM4,12.67l1.11-.13A4.38,4.38,0,0,1,10,16.89v2.85A8,8,0,0,1,4,12.67Zm10,7.07V16.89a4.38,4.38,0,0,1,4.86-4.35l1.11.13A8,8,0,0,1,14,19.74Z" />
    </svg>
  );
}

/** Game controller — the league's chosen pad glyph (SVG Repo, archived in
 *  assets/design/input-detection/). Filled, recoloured via currentColor. */
export function GamepadIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M7.99999 8.5C7.99999 7.94772 7.55227 7.5 6.99999 7.5C6.4477 7.5 5.99999 7.94772 5.99999 8.5V9H5.49999C4.9477 9 4.49999 9.44771 4.49999 10C4.49999 10.5523 4.9477 11 5.49999 11H5.99999V11.5C5.99999 12.0523 6.4477 12.5 6.99999 12.5C7.55227 12.5 7.99999 12.0523 7.99999 11.5V11H8.49999C9.05227 11 9.49999 10.5523 9.49999 10C9.49999 9.44771 9.05227 9 8.49999 9H7.99999V8.5Z" />
      <path d="M18 8C18 8.55229 17.5523 9 17 9C16.4477 9 16 8.55229 16 8C16 7.44772 16.4477 7 17 7C17.5523 7 18 7.44772 18 8Z" />
      <path d="M17 13C17.5523 13 18 12.5523 18 12C18 11.4477 17.5523 11 17 11C16.4477 11 16 11.4477 16 12C16 12.5523 16.4477 13 17 13Z" />
      <path d="M16 10C16 10.5523 15.5523 11 15 11C14.4477 11 14 10.5523 14 10C14 9.44771 14.4477 9 15 9C15.5523 9 16 9.44771 16 10Z" />
      <path d="M19 11C19.5523 11 20 10.5523 20 10C20 9.44771 19.5523 9 19 9C18.4477 9 18 9.44771 18 10C18 10.5523 18.4477 11 19 11Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 3C10.1879 3 7.96237 3.25817 6.21782 3.5093C3.94305 3.83676 2.09096 5.51696 1.60993 7.7883C1.34074 9.05935 1.07694 10.5622 1.01649 11.8204C0.973146 12.7225 0.877981 13.9831 0.777155 15.1923C0.672256 16.4504 1.09148 17.7464 1.86079 18.6681C2.64583 19.6087 3.88915 20.2427 5.32365 19.8413C6.24214 19.5842 6.97608 18.9387 7.5205 18.3026C8.07701 17.6525 8.51992 16.9124 8.83535 16.3103C9.07821 15.8467 9.50933 15.5855 9.91539 15.5855H14.0846C14.4906 15.5855 14.9218 15.8467 15.1646 16.3103C15.4801 16.9124 15.923 17.6525 16.4795 18.3026C17.0239 18.9387 17.7578 19.5842 18.6763 19.8413C20.1108 20.2427 21.3541 19.6087 22.1392 18.6681C22.9085 17.7464 23.3277 16.4504 23.2228 15.1923C23.122 13.9831 23.0268 12.7225 22.9835 11.8204C22.923 10.5622 22.6592 9.05935 22.39 7.7883C21.909 5.51696 20.0569 3.83676 17.7821 3.5093C16.0376 3.25817 13.8121 3 12 3ZM6.50279 5.48889C8.22744 5.24063 10.3368 5 12 5C13.6632 5 15.7725 5.24063 17.4972 5.4889C18.965 5.70019 20.1311 6.77489 20.4334 8.20267C20.6967 9.44565 20.9332 10.8223 20.9858 11.9164C21.0309 12.856 21.1287 14.1463 21.2297 15.3585C21.2912 16.0956 21.0342 16.8708 20.6037 17.3866C20.1889 17.8836 19.7089 18.0534 19.2153 17.9153C18.8497 17.8129 18.4327 17.509 17.9989 17.0021C17.5771 16.5094 17.2144 15.9131 16.9362 15.3822C16.4043 14.3667 15.3482 13.5855 14.0846 13.5855H9.91539C8.65178 13.5855 7.59571 14.3667 7.06374 15.3822C6.78558 15.9131 6.42285 16.5094 6.00109 17.0021C5.56723 17.509 5.15027 17.8129 4.78463 17.9153C4.29109 18.0534 3.81102 17.8836 3.39625 17.3866C2.96576 16.8708 2.70878 16.0956 2.77024 15.3585C2.87131 14.1463 2.96904 12.856 3.01418 11.9164C3.06675 10.8223 3.30329 9.44565 3.56653 8.20267C3.86891 6.77489 5.03497 5.70019 6.50279 5.48889Z"
      />
    </svg>
  );
}
