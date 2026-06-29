import { useEffect, useRef, useState } from "react";
import { useShell } from "./shell-context";
import { CloseIcon } from "./icons";
import { Segmented, type SegmentedOption } from "./Segmented";

const FORMAT_OPTIONS: SegmentedOption<"2026" | "2025">[] = [
  { value: "2026", label: "2026" },
  { value: "2025", label: "2025" },
];

/**
 * Shell-level connection settings (UDP port + telemetry format). Native
 * <dialog> so it escapes the titlebar's stacking context. Edits are local until
 * Apply; later these drive the Rust feed listener.
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

  // Sync the dialog element with the `open` prop and reset the draft on open.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setPort(String(connection.port));
      setFormat(connection.format);
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, connection]);

  const portNum = Number(port);
  const portValid = Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535;

  function apply(e: React.FormEvent) {
    e.preventDefault();
    if (!portValid) return;
    setConnection({ port: portNum, format });
    onClose();
  }

  return (
    <dialog ref={ref} className="dialog" onCancel={onClose} onClose={onClose}>
      <form className="dialog-card" method="dialog" onSubmit={apply}>
        <header className="dialog-head">
          <h2 className="dialog-title">Connection</h2>
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

        <footer className="dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!portValid}>
            Apply
          </button>
        </footer>
      </form>
    </dialog>
  );
}
