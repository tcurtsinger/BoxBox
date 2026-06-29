import { useShell, type Mode } from "./shell-context";

const MODES: { id: Mode; label: string }[] = [
  { id: "tuner", label: "Tuner" },
  { id: "race-control", label: "Race Control" },
];

/**
 * Top-level identity control. Tuner and Race Control are peers; the active
 * segment is teal text + a 2px underline, never a filled block (DESIGN.md).
 */
export function ModeSwitch() {
  const { mode, setMode } = useShell();
  return (
    <nav className="modeswitch" aria-label="App mode">
      {MODES.map((m) => {
        const active = m.id === mode;
        return (
          <button
            key={m.id}
            type="button"
            className={`mode${active ? " is-active" : ""}`}
            aria-pressed={active}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        );
      })}
    </nav>
  );
}
