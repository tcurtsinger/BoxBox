import { Modal } from "./Modal";

interface Props {
  onClose: () => void;
}

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ["↑", "↓"], action: "Move up / down the timing tower" },
  { keys: ["j", "k"], action: "Move down / up the timing tower" },
  { keys: ["Home", "End"], action: "Jump to the leader / last car" },
  { keys: ["f"], action: "Flag the selected car for review" },
  { keys: ["Esc"], action: "Close a dialog" },
  { keys: ["?"], action: "Show this list" },
];

// Surfaces the keyboard accelerators so the power steward can find them, instead
// of leaving them buried in an aria-label.
export function ShortcutsModal({ onClose }: Props) {
  return (
    <Modal onClose={onClose} className="shortcuts" label="Keyboard shortcuts">
      <div className="flag-head">
        <span className="flag-title">Keyboard shortcuts</span>
        <button className="detail-close" onClick={onClose} aria-label="Close">
          &times;
        </button>
      </div>
      <dl className="shortcuts-list">
        {SHORTCUTS.map((s) => (
          <div className="shortcuts-row" key={s.action}>
            <dt className="shortcuts-keys">
              {s.keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </dt>
            <dd className="shortcuts-action">{s.action}</dd>
          </div>
        ))}
      </dl>
      <div className="flag-actions">
        <button className="btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
