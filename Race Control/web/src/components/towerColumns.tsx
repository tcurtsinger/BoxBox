import type { CSSProperties, ReactNode } from "react";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import type { DriverState } from "../types";
import { teamColor } from "../presentation/teams";
import { tyre } from "../presentation/tyres";
import { flag } from "../presentation/flags";
import { driverName } from "../presentation/driver";
import { lapTime, gap, fuelLaps } from "../presentation/format";
import { poleGap, lapStatus } from "../presentation/qualifying";

// Per-table context. The qualifying "To P1" column needs the field-best lap,
// which a single cell cannot see; the tower computes it once and passes it here.
export interface TowerMeta {
  poleMS: number;
}

export type TowerColumnId =
  | "position"
  | "delta"
  | "driver"
  | "status"
  | "warnings"
  | "penalties"
  | "interval"
  | "gap"
  | "last"
  | "best"
  | "poleGap"
  | "lapStatus"
  | "ers"
  | "tyre"
  | "pits";

const labels: Record<TowerColumnId, string> = {
  position: "Pos",
  delta: "+/-",
  driver: "Driver",
  status: "Status",
  warnings: "Warn",
  penalties: "Pen",
  interval: "Int",
  gap: "Gap",
  last: "Last",
  best: "Best",
  poleGap: "To P1",
  lapStatus: "Lap",
  ers: "ERS",
  tyre: "Tyre",
  pits: "Pits",
};

const classNames: Record<TowerColumnId, string> = {
  position: "col-pos",
  delta: "col-delta",
  driver: "col-driver",
  status: "col-status",
  warnings: "col-warn",
  penalties: "col-pen",
  interval: "col-int",
  gap: "col-gap",
  last: "col-last",
  best: "col-best",
  poleGap: "col-polegap",
  lapStatus: "col-lapstatus",
  ers: "col-ers",
  tyre: "col-tyre",
  pits: "col-pits",
};

export const lockedTowerColumnIds = ["position", "driver"] as const;

export const towerColumns: ColumnDef<DriverState>[] = [
  {
    id: "position",
    header: labels.position,
    size: 64,
    minSize: 54,
    maxSize: 96,
    enableHiding: false,
    cell: ({ row }) => (isOut(row.original) ? "OUT" : row.original.position || "-"),
  },
  {
    id: "delta",
    header: labels.delta,
    size: 62,
    minSize: 54,
    maxSize: 90,
    cell: ({ row }) => {
      const delta = positionDelta(row.original);
      return <span className={delta.cls}>{delta.label}</span>;
    },
  },
  {
    id: "driver",
    header: labels.driver,
    size: 220,
    minSize: 160,
    maxSize: 340,
    enableHiding: false,
    cell: ({ row }) => (
      <>
        <span className="team-stripe" />
        <span className="driver-name">{driverName(row.original)}</span>
      </>
    ),
  },
  {
    id: "status",
    header: labels.status,
    size: 210,
    minSize: 150,
    maxSize: 280,
    cell: ({ row }) => <StatusCell driver={row.original} />,
  },
  {
    id: "warnings",
    header: labels.warnings,
    size: 74,
    minSize: 54,
    maxSize: 110,
    cell: ({ row }) => {
      const n = row.original.cornerCuttingWarnings;
      if (n <= 0) return "-";
      return <span className={n >= 3 ? "status-penalty" : "status-warn"}>{n}/3</span>;
    },
  },
  {
    id: "penalties",
    header: labels.penalties,
    size: 96,
    minSize: 70,
    maxSize: 150,
    cell: ({ row }) => {
      const p = penaltyText(row.original);
      return p ? <span className="status-penalty">{p}</span> : "-";
    },
  },
  {
    id: "interval",
    header: labels.interval,
    size: 92,
    minSize: 78,
    maxSize: 130,
    cell: ({ row }) => {
      const d = row.original;
      if (d.pitStatus > 0) return <span className="pit-text">PIT</span>;
      if (d.position === 1 || isOut(d)) return "-";
      return gap(d.deltaToCarAheadMS);
    },
  },
  {
    id: "gap",
    header: labels.gap,
    size: 104,
    minSize: 84,
    maxSize: 140,
    cell: ({ row }) => {
      const d = row.original;
      if (d.position === 1) return "LEADER";
      if (isOut(d)) return "-";
      return gap(d.deltaToLeaderMS);
    },
  },
  {
    id: "last",
    header: labels.last,
    size: 104,
    minSize: 86,
    maxSize: 140,
    cell: ({ row }) => lapTime(row.original.lastLapMS),
  },
  {
    id: "best",
    header: labels.best,
    size: 104,
    minSize: 86,
    maxSize: 140,
    cell: ({ row }) => lapTime(row.original.bestLapMS),
  },
  {
    id: "poleGap",
    header: labels.poleGap,
    size: 96,
    minSize: 78,
    maxSize: 130,
    cell: ({ row, table }) => {
      const best = row.original.bestLapMS;
      if (!best) return <span className="no-time">NO TIME</span>;
      const poleMS = (table.options.meta as TowerMeta | undefined)?.poleMS ?? 0;
      const g = poleGap(best, poleMS);
      return g ? g : <span className="pole-ref">—</span>;
    },
  },
  {
    id: "lapStatus",
    header: labels.lapStatus,
    size: 96,
    minSize: 74,
    maxSize: 130,
    cell: ({ row }) => {
      const s = lapStatus(row.original);
      return <span className={s.cls}>{s.label}</span>;
    },
  },
  {
    id: "ers",
    header: labels.ers,
    size: 126,
    minSize: 110,
    maxSize: 170,
    cell: ({ row }) => <ErsCell driver={row.original} />,
  },
  {
    id: "tyre",
    header: labels.tyre,
    size: 78,
    minSize: 68,
    maxSize: 110,
    cell: ({ row }) => {
      const t = tyre(row.original.tyreVisual);
      return (
        <>
          <span
            className="tyre-chip"
            style={{ background: t.color, color: t.dark ? "#111" : "#fff" }}
            title={t.label}
          >
            {t.letter}
          </span>
          <span className="tyre-age">{row.original.tyreAgeLaps}</span>
        </>
      );
    },
  },
  {
    id: "pits",
    header: labels.pits,
    size: 68,
    minSize: 54,
    maxSize: 92,
    cell: ({ row }) => row.original.numPitStops,
  },
];

// The tower flips its column set with the session. Each mode lists every column
// (so the View menu can toggle any of them) but orders the relevant ones first
// and hides the rest. Locked columns (Pos, Driver) are always visible.
export type TowerMode = "race" | "qualifying";

const raceColumnOrder: TowerColumnId[] = [
  "position", "delta", "driver", "status", "warnings", "penalties",
  "interval", "gap", "last", "best", "ers", "tyre", "pits", "poleGap", "lapStatus",
];
const raceHiddenColumns: VisibilityState = {
  warnings: false, penalties: false, poleGap: false, lapStatus: false,
};

const qualifyingColumnOrder: TowerColumnId[] = [
  "position", "driver", "best", "poleGap", "last", "lapStatus", "tyre",
  "warnings", "penalties", "delta", "status", "interval", "gap", "ers", "pits",
];
const qualifyingHiddenColumns: VisibilityState = {
  delta: false, status: false, interval: false, gap: false, ers: false, pits: false,
  warnings: false, penalties: false,
};

export function towerDefaults(mode: TowerMode): { order: TowerColumnId[]; visibility: VisibilityState } {
  return mode === "qualifying"
    ? { order: qualifyingColumnOrder, visibility: qualifyingHiddenColumns }
    : { order: raceColumnOrder, visibility: raceHiddenColumns };
}

// Default (race) order, kept for callers that want a stable initial layout.
export const defaultTowerColumnOrder = raceColumnOrder;

export function towerColumnLabel(id: string): string {
  return labels[id as TowerColumnId] ?? id;
}

export function towerColumnClass(id: string): string {
  return classNames[id as TowerColumnId] ?? "";
}

export function isLockedTowerColumn(id: string): boolean {
  return lockedTowerColumnIds.includes(id as (typeof lockedTowerColumnIds)[number]);
}

export function towerCellClass(id: string, driver: DriverState): string {
  const base = towerColumnClass(id);
  if (id === "ers" && driver.overtakeActive) return `${base} boosting`;
  return base;
}

export function towerCellStyle(id: string, driver: DriverState): CSSProperties | undefined {
  if (id === "position") {
    return { borderLeftColor: teamColor(driver.teamId, driver.liveryColours) };
  }

  if (id === "driver") {
    return { "--team": teamColor(driver.teamId, driver.liveryColours) } as CSSProperties;
  }

  return undefined;
}

function StatusCell({ driver }: { driver: DriverState }) {
  const pitting = driver.pitStatus > 0;
  const out = isOut(driver);
  const f = flag(driver.fiaFlags);
  const status = statusText(driver, pitting, out);
  const hasStatus = status.label !== "-";
  const fuelShort = driver.fuelRemainingLaps < 0;
  // Only show the "-" placeholder when there is genuinely nothing to report.
  const empty = !f && !hasStatus && !fuelShort;

  return (
    <>
      {f && <span className="flag-dot" style={{ background: f.color }} title={`${f.label} flag`} />}
      {hasStatus && <span className={status.cls}>{status.label}</span>}
      {fuelShort && <span className="fuel-short">Fuel {fuelLaps(driver.fuelRemainingLaps)}</span>}
      {empty && <span>-</span>}
    </>
  );
}

function ErsCell({ driver }: { driver: DriverState }) {
  const battery = Math.max(0, Math.min(100, Math.round(driver.batteryPct)));
  const batteryClass = battery > 50 ? "batt-high" : battery > 20 ? "batt-mid" : "batt-low";

  return (
    <>
      <span className="batt-bar">
        <span
          className={`batt-fill ${driver.overtakeActive ? "batt-boost" : batteryClass}`}
          style={{ width: `${battery}%` }}
        />
      </span>
      <span className="batt-pct">{battery}%</span>
    </>
  );
}

function isOut(driver: DriverState): boolean {
  return [4, 5, 7].includes(driver.resultStatus);
}

function positionDelta(driver: DriverState): { label: ReactNode; cls: string } {
  if (!driver.position || !driver.gridPosition) return { label: "-", cls: "" };
  const delta = driver.gridPosition - driver.position;
  if (delta > 0) return { label: `\u25B2 ${delta}`, cls: "delta-up" };
  if (delta < 0) return { label: `\u25BC ${Math.abs(delta)}`, cls: "delta-down" };
  return { label: "-", cls: "" };
}

function statusText(
  driver: DriverState,
  pitting: boolean,
  out: boolean,
): { label: string; cls: string } {
  if (out) return { label: driver.resultStatus === 7 ? "RET" : "OUT", cls: "status-out" };
  if (pitting) return { label: "PIT", cls: "status-pit" };
  const penalties = penaltyText(driver);
  if (penalties !== "") return { label: penalties, cls: "status-penalty" };
  if (driver.cornerCuttingWarnings > 0) return { label: `Warn ${driver.cornerCuttingWarnings}/3`, cls: "status-warn" };
  return { label: "-", cls: "" };
}

function penaltyText(driver: DriverState): string {
  const parts = [
    driver.penaltiesSec > 0 ? `+${driver.penaltiesSec}s` : "",
    driver.numUnservedDriveThrough > 0 ? `${driver.numUnservedDriveThrough}DT` : "",
    driver.numUnservedStopGo > 0 ? `${driver.numUnservedStopGo}SG` : "",
  ].filter(Boolean);
  return parts.join("/");
}
