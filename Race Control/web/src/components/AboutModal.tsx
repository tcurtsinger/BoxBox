import { SERVER } from "../api/server";
import type { ConnState } from "../api/useSnapshot";
import { Modal } from "./Modal";

interface Props {
  conn: ConnState;
  onClose: () => void;
}

const CONN_LABEL: Record<ConnState, string> = {
  connecting: "Connecting",
  live: "Live",
  error: "Reconnecting",
};

export function AboutModal({ conn, onClose }: Props) {
  return (
    <Modal onClose={onClose} className="about" label="About BoxBox">
        <div className="flag-head">
          <span className="flag-title">About BoxBox</span>
          <button className="detail-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <p className="about-tagline">
          A local FIA and race-control console for F1 26 sim-racing leagues. One observer spectates the
          lobby; BoxBox reads the local UDP feed and drives the timing tower, glanceable telemetry, and
          stewarding.
        </p>
        <dl className="about-grid">
          <dt>Server</dt>
          <dd>{SERVER}</dd>
          <dt>Connection</dt>
          <dd>{CONN_LABEL[conn]}</dd>
        </dl>
        <div className="flag-actions">
          <button className="btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
    </Modal>
  );
}
