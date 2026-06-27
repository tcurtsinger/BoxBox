import { useMemo, useRef, type CSSProperties, type KeyboardEvent } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnOrderState,
  type ColumnSizingState,
  type OnChangeFn,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DriverState, SessionSnapshot } from "../types";
import {
  towerCellClass,
  towerCellStyle,
  towerColumnClass,
  towerColumns,
  type TowerMeta,
} from "./towerColumns";
import { knockoutLineIndex } from "../presentation/qualifying";
import { driverName } from "../presentation/driver";

const STALE_MS = 3000;

interface Props {
  snapshot: SessionSnapshot;
  selected: number | null;
  columnVisibility: VisibilityState;
  columnOrder: ColumnOrderState;
  columnSizing: ColumnSizingState;
  onColumnVisibilityChange: OnChangeFn<VisibilityState>;
  onColumnOrderChange: OnChangeFn<ColumnOrderState>;
  onColumnSizingChange: OnChangeFn<ColumnSizingState>;
  onSelect: (index: number) => void;
}

export function TimingTower({
  snapshot,
  selected,
  columnVisibility,
  columnOrder,
  columnSizing,
  onColumnVisibilityChange,
  onColumnOrderChange,
  onColumnSizingChange,
  onSelect,
}: Props) {
  const towerRef = useRef<HTMLDivElement>(null);
  // Staleness must reflect the telemetry feed, not steward writes (which also
  // bump lastUpdate), so a note/ruling can't clear a genuine "no packets" state.
  const stale = Date.now() - snapshot.lastPacketAt > STALE_MS;
  const rows = useMemo(() => orderDrivers(snapshot.drivers), [snapshot.drivers]);

  const isQualifying = snapshot.sessionCategory === "qualifying";
  // Session-best lap, for the qualifying "To P1" gap column.
  const poleMS = useMemo(() => {
    let best = 0;
    for (const d of rows) if (d.bestLapMS > 0 && (best === 0 || d.bestLapMS < best)) best = d.bestLapMS;
    return best;
  }, [rows]);
  // 0-based index of the first car in the knockout drop-zone (null = none).
  const dropFrom = isQualifying ? knockoutLineIndex(snapshot.session?.sessionType, rows.length) : null;
  const separatorAt = (index: number): string =>
    isQualifying
      ? dropFrom !== null && index === dropFrom
        ? `Knockout line · top ${dropFrom} advance`
        : ""
      : battleLabel(rows, index);

  const table = useReactTable({
    data: rows,
    columns: towerColumns,
    getRowId: (driver) => String(driver.index), // stable identity by car, not row order
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: "onChange",
    defaultColumn: {
      minSize: 54,
      maxSize: 340,
    },
    state: {
      columnVisibility,
      columnOrder,
      columnSizing,
    },
    meta: { poleMS, dropFrom } satisfies TowerMeta,
    onColumnVisibilityChange,
    onColumnOrderChange,
    onColumnSizingChange,
  });
  const tableRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => towerRef.current,
    estimateSize: (index) => (separatorAt(index) ? 78 : 50),
    overscan: 6,
  });
  // Keyboard navigation: the scroll container holds focus and tracks the active
  // row via aria-activedescendant, so arrowing/j-k works across the virtualised
  // list without focus landing on a row that may be recycled out of the DOM.
  const orderedIndices = useMemo(() => rows.map((d) => d.index), [rows]);
  const selectPos = (pos: number) => {
    const nextIndex = orderedIndices[pos];
    if (nextIndex == null) return;
    onSelect(nextIndex);
    rowVirtualizer.scrollToIndex(pos, { align: "auto" });
  };
  const moveSelection = (delta: number) => {
    if (orderedIndices.length === 0) return;
    const cur = selected == null ? -1 : orderedIndices.indexOf(selected);
    const from = cur < 0 ? (delta > 0 ? -1 : orderedIndices.length) : cur;
    selectPos(Math.max(0, Math.min(orderedIndices.length - 1, from + delta)));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowDown":
      case "j":
        e.preventDefault();
        moveSelection(1);
        break;
      case "ArrowUp":
      case "k":
        e.preventDefault();
        moveSelection(-1);
        break;
      case "Home":
        e.preventDefault();
        selectPos(0);
        break;
      case "End":
        e.preventDefault();
        selectPos(orderedIndices.length - 1);
        break;
    }
  };

  // aria-activedescendant may only point at a row that is actually in the DOM.
  // The virtualizer recycles off-screen rows, so when the selected car is
  // scrolled out (e.g. by mouse wheel) we drop the attribute rather than leave
  // it dangling at a removed node.
  const virtualItems = rowVirtualizer.getVirtualItems();
  const selectedPos = selected != null ? orderedIndices.indexOf(selected) : -1;
  const selectedRendered = selectedPos >= 0 && virtualItems.some((vi) => vi.index === selectedPos);

  const gridTemplate = table
    .getVisibleLeafColumns()
    .map((column) => `${column.getSize()}px`)
    .join(" ");
  const tableStyle = {
    "--tower-grid": gridTemplate,
    "--tower-width": `${table.getTotalSize()}px`,
  } as CSSProperties;

  return (
    <div
      className="tower"
      ref={towerRef}
      style={tableStyle}
      role="grid"
      aria-label="Timing tower. Use arrow keys or J and K to move between cars."
      aria-rowcount={tableRows.length}
      tabIndex={0}
      aria-activedescendant={selectedRendered ? `tower-row-${selected}` : undefined}
      onKeyDown={onKeyDown}
    >
      {stale && (
        <div className="stale-banner">
          No packets in 3s. Session paused or ended, or telemetry is off.
        </div>
      )}

      <div className="tower-head">
        {table.getHeaderGroups().map((headerGroup) =>
          headerGroup.headers.map((header) => (
            <span
              className={`tower-head-cell ${towerColumnClass(header.column.id)}`}
              data-column-id={header.column.id}
              key={header.id}
            >
              <span className="tower-head-label">
                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
              </span>
              {header.column.getCanResize() && (
                <button
                  aria-label={`Resize ${header.column.id} column`}
                  className={`tower-resizer${header.column.getIsResizing() ? " resizing" : ""}`}
                  onDoubleClick={() => header.column.resetSize()}
                  onMouseDown={header.getResizeHandler()}
                  onTouchStart={header.getResizeHandler()}
                  type="button"
                />
              )}
            </span>
          )),
        )}
      </div>

      <div className="tower-body" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {virtualItems.map((virtualRow) => {
          const row = tableRows[virtualRow.index];
          if (!row) return null;
          const driver = row.original;

          return (
            <div
              className="tower-row-wrap"
              data-index={virtualRow.index}
              key={row.id}
              ref={rowVirtualizer.measureElement}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {separatorAt(virtualRow.index) && (
                <div className={`battle-row${isQualifying ? " knockout-row" : ""}`}>{separatorAt(virtualRow.index)}</div>
              )}
              <div
                id={`tower-row-${driver.index}`}
                role="row"
                aria-selected={driver.index === selected}
                aria-label={rowLabel(driver)}
                className={rowClass(driver, driver.index === selected, dropFrom !== null && virtualRow.index >= dropFrom)}
                onClick={() => onSelect(driver.index)}
              >
                {row.getVisibleCells().map((cell) => (
                  <span
                    className={towerCellClass(cell.column.id, driver)}
                    data-column-id={cell.column.id}
                    key={cell.id}
                    style={towerCellStyle(cell.column.id, driver)}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function orderDrivers(drivers: SessionSnapshot["drivers"]): SessionSnapshot["drivers"] {
  const isDriverOut = (driver: DriverState) => isOut(driver);
  return [...drivers.filter((driver) => !isDriverOut(driver)), ...drivers.filter(isDriverOut)];
}

function battleLabel(drivers: SessionSnapshot["drivers"], index: number): string {
  const driver = drivers[index];
  if (!driver || isOut(driver)) return "";
  if (index === 0) return "Battle for the lead";
  if (driver.deltaToCarAheadMS > 1500) return `Battle for P${driver.position || index + 1}`;
  return "";
}

function rowClass(driver: DriverState, selected: boolean, dropZone: boolean): string {
  const pitting = driver.pitStatus > 0;
  const out = isOut(driver);
  return (
    `tower-row${driver.currentLapInvalid ? " row-invalid" : ""}` +
    `${pitting ? " row-pit" : ""}${selected ? " row-selected" : ""}${out ? " row-out" : ""}` +
    `${dropZone ? " row-dropzone" : ""}`
  );
}

function rowLabel(driver: DriverState): string {
  const pos = isOut(driver) ? "out" : `P${driver.position || "-"}`;
  return `${pos} ${driverName(driver)}`;
}

function isOut(driver: DriverState): boolean {
  // 4 DNF, 5 DSQ, 6 Not Classified, 7 Retired - all drop out of the running order.
  return [4, 5, 6, 7].includes(driver.resultStatus);
}
