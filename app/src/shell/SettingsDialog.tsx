import { useEffect, useRef, useState } from "react";
import { useShell, type ForwardTarget } from "./shell-context";
import { CloseIcon } from "./icons";
import { Segmented, type SegmentedOption } from "./Segmented";
import { historyRetention, setHistoryRetention } from "../modes/history/historyData";

const FORMAT_OPTIONS: SegmentedOption<"2026" | "2025">[] = [
  { value: "2026", label: "2026" },
  { value: "2025", label: "2025" },
];

const FORWARD_OPTIONS: SegmentedOption<"off" | "on">[] = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
];

const RETENTION_OPTIONS: SegmentedOption<string>[] = [
  { value: "all", label: "Keep all" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
];

/** Editing draft for a forward target — port is a string so it can be cleared
 *  mid-edit; parsed back to a number on Apply. */
interface TargetDraft {
  host: string;
  port: string;
}

function isIPv4(s: string): boolean {
  const parts = s.trim().split(".");
  return (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  );
}

function isForwardPort(s: string): boolean {
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function toDrafts(targets: ForwardTarget[]): TargetDraft[] {
  return targets.map((t) => ({ host: t.host, port: String(t.port) }));
}

/**
 * Shell-level connection settings (UDP port + telemetry format + the optional
 * telemetry repeater). Native <dialog> so it escapes the titlebar's stacking
 * context. Edits are local until Apply; on Apply they update the shared
 * connection, which drives the Rust feed listener and persists.
 */
export function SettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { connection, setConnection } = useShell();
  const [port, setPort] = useState(String(connection.port));
  const [format, setFormat] = useState(connection.format);
  const [forwardEnabled, setForwardEnabled] = useState(connection.forwardEnabled);
  const [targets, setTargets] = useState<TargetDraft[]>(() =>
    toDrafts(connection.forwardTargets),
  );
  // History retention applies immediately (not via the connection Apply); null =
  // keep everything. Loaded from the backend when the dialog opens.
  const [retention, setRetention] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void historyRetention().then((d) => {
      if (active) setRetention(d);
    });
    return () => {
      active = false;
    };
  }, [open]);

  // Sync the dialog element with the `open` prop and reset the draft on open.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setPort(String(connection.port));
      setFormat(connection.format);
      setForwardEnabled(connection.forwardEnabled);
      setTargets(toDrafts(connection.forwardTargets));
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, connection]);

  const portNum = Number(port);
  const portValid = Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535;

  const targetsValid =
    targets.length > 0 &&
    targets.every((t) => isIPv4(t.host) && isForwardPort(t.port));
  const canApply = portValid && (!forwardEnabled || targetsValid);

  function updateTarget(i: number, patch: Partial<TargetDraft>) {
    setTargets((cur) => cur.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }
  function addTarget() {
    setTargets((cur) => [...cur, { host: "127.0.0.1", port: "20778" }]);
  }
  function removeTarget(i: number) {
    setTargets((cur) => cur.filter((_, j) => j !== i));
  }

  function apply(e: React.FormEvent) {
    e.preventDefault();
    if (!canApply) return;
    setConnection({
      port: portNum,
      format,
      forwardEnabled,
      forwardTargets: targets.map((t) => ({
        host: t.host.trim(),
        port: Number(t.port),
      })),
    });
    onClose();
  }

  return (
    <dialog ref={ref} className="dialog" onCancel={onClose} onClose={onClose}>
      <form className="dialog-card" method="dialog" onSubmit={apply}>
        <header className="dialog-head">
          <h2 className="dialog-title">Settings</h2>
          <button
            type="button"
            className="dialog-x"
            aria-label="Close settings"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <p className="dialog-intro">
          BoxBox listens for the game's UDP telemetry. Set these to match your
          F1 game's telemetry options.
        </p>

        <div className="field">
          <label className="field-label" htmlFor="udp-port">
            UDP port
          </label>
          <input
            id="udp-port"
            className="field-input mono"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
            aria-invalid={!portValid}
            aria-describedby="udp-port-hint"
          />
          <p
            id="udp-port-hint"
            className={`field-hint${portValid ? "" : " field-hint-error"}`}
          >
            {portValid
              ? "Default is 20777."
              : "Enter a port between 1024 and 65535."}
          </p>
        </div>

        <div className="field">
          <span className="field-label">Telemetry format</span>
          <Segmented
            options={FORMAT_OPTIONS}
            value={format}
            onChange={setFormat}
            ariaLabel="Telemetry format"
          />
          <p className="field-hint">F1 26 uses 2026; F1 25 falls back to 2025.</p>
        </div>

        <div className="field">
          <span className="field-label">Forward telemetry to</span>
          <Segmented
            options={FORWARD_OPTIONS}
            value={forwardEnabled ? "on" : "off"}
            onChange={(v) => setForwardEnabled(v === "on")}
            ariaLabel="Forward telemetry"
          />
          <p className="field-hint">
            Relay a copy of the feed to another app (e.g. SimHub) so it can read
            telemetry without competing for the port. Keep the game pointed at
            BoxBox's port above; point the other app at the address below.
          </p>

          {forwardEnabled && (
            <div className="fwd-targets">
              {targets.map((t, i) => (
                <div className="fwd-row" key={i}>
                  <input
                    className="field-input mono fwd-host"
                    inputMode="decimal"
                    aria-label={`Target ${i + 1} IP address`}
                    aria-invalid={!isIPv4(t.host)}
                    value={t.host}
                    onChange={(e) =>
                      updateTarget(i, {
                        host: e.target.value.replace(/[^0-9.]/g, ""),
                      })
                    }
                  />
                  <span className="fwd-colon" aria-hidden="true">
                    :
                  </span>
                  <input
                    className="field-input mono fwd-port"
                    inputMode="numeric"
                    aria-label={`Target ${i + 1} port`}
                    aria-invalid={!isForwardPort(t.port)}
                    value={t.port}
                    onChange={(e) =>
                      updateTarget(i, {
                        port: e.target.value.replace(/[^0-9]/g, ""),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="fwd-remove"
                    aria-label={`Remove target ${i + 1}`}
                    onClick={() => removeTarget(i)}
                    disabled={targets.length === 1}
                  >
                    <CloseIcon size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-ghost btn-sm fwd-add"
                onClick={addTarget}
              >
                Add target
              </button>
              {!targetsValid && (
                <p className="field-hint field-hint-error">
                  Enter a valid IPv4 address and port (1–65535) for each target.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="field">
          <span className="field-label">Keep saved sessions</span>
          <Segmented
            options={RETENTION_OPTIONS}
            value={retention == null ? "all" : String(retention)}
            onChange={(v) => {
              const days = v === "all" ? null : Number(v);
              setRetention(days);
              void setHistoryRetention(days);
            }}
            ariaLabel="History retention"
          />
          <p className="field-hint">
            Auto-delete saved sessions older than this. Pinned sessions are always kept.
          </p>
        </div>

        <footer className="dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canApply}>
            Apply
          </button>
        </footer>
      </form>
    </dialog>
  );
}
