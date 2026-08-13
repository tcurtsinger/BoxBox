import { useEffect, useState } from "react";
import { useShell, type ForwardTarget, type EngineerCategories } from "./shell-context";
import { CloseIcon } from "./icons";
import { Segmented, type SegmentedOption } from "./Segmented";
import { historyRetention, setHistoryRetention } from "../modes/history/historyData";
import { listVoices, onVoicesReady, speakOnce } from "../engineer/speech";

/** Feed controls talk to the Rust listener, which only exists inside Tauri. */
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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

const ONOFF_OPTIONS: SegmentedOption<"off" | "on">[] = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
];

const ENGINEER_CATEGORIES: { key: keyof EngineerCategories; label: string }[] = [
  { key: "fuelTyres", label: "Fuel & tyres" },
  { key: "gapsPosition", label: "Gaps & position" },
  { key: "lapTimes", label: "Lap times" },
  { key: "flagsIncidents", label: "Flags & incidents" },
];

/** Mirror of the Rust `DiscordConfig` (serde camelCase). */
interface DiscordConfig {
  webhookUrl: string;
  postQuali: boolean;
  postRace: boolean;
  postIncidents: boolean;
}

const DISCORD_TOGGLES: { key: keyof Omit<DiscordConfig, "webhookUrl">; label: string }[] = [
  { key: "postQuali", label: "Qualifying results" },
  { key: "postRace", label: "Race results" },
  { key: "postIncidents", label: "Major incidents" },
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section" aria-label={title}>
      <h3 className="settings-section-title">{title}</h3>
      {children}
    </section>
  );
}

/**
 * The Settings page — a rail destination like every other section, replacing
 * the old modal. One centered column, grouped: Telemetry (the connection —
 * applies as a batch from its own button, since a port change rebinds the
 * listener), Sessions and Voice engineer (apply immediately, as before), and
 * Discord (explicit save, so a rejected webhook URL is always seen).
 */
export function SettingsView() {
  const { connection, setConnection, engineer, setEngineer, feed, resetFeed, setMode } =
    useShell();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  // --- Telemetry draft (applies as a batch) --------------------------------
  const [port, setPort] = useState(String(connection.port));
  const [format, setFormat] = useState(connection.format);
  const [forwardEnabled, setForwardEnabled] = useState(connection.forwardEnabled);
  const [targets, setTargets] = useState<TargetDraft[]>(() =>
    toDrafts(connection.forwardTargets),
  );
  const [applied, setApplied] = useState(false);

  // --- Sessions (retention applies immediately, tightening via confirm) ----
  const [retention, setRetention] = useState<number | null>(null);
  const [pendingRetention, setPendingRetention] = useState<number | null>(null);
  const [retentionNote, setRetentionNote] = useState<string | null>(null);

  // --- Discord draft (explicit save) ----------------------------------------
  const [discord, setDiscord] = useState<DiscordConfig>({
    webhookUrl: "",
    postQuali: true,
    postRace: true,
    postIncidents: true,
  });
  const [discordNote, setDiscordNote] = useState<string | null>(null);
  const [discordBusy, setDiscordBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void historyRetention().then((d) => {
      if (active) setRetention(d);
    });
    if (IN_TAURI) {
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke<DiscordConfig>("discord_config").then(
          (c) => {
            if (active) setDiscord(c);
          },
          () => {},
        ),
      );
    }
    return () => {
      active = false;
    };
  }, []);

  // OS voices populate asynchronously; keep the picker's list in sync.
  useEffect(() => {
    const update = () => setVoices(listVoices());
    const off = onVoicesReady(update);
    update();
    return off;
  }, []);

  const cats = engineer.categories;
  const toggleCat = (k: keyof EngineerCategories) =>
    setEngineer({ ...engineer, categories: { ...cats, [k]: !cats[k] } });

  const portNum = Number(port);
  const portValid = Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535;
  const targetsValid =
    targets.length > 0 &&
    targets.every((t) => isIPv4(t.host) && isForwardPort(t.port));
  const canApply = portValid && (!forwardEnabled || targetsValid);
  const dirty =
    portNum !== connection.port ||
    format !== connection.format ||
    forwardEnabled !== connection.forwardEnabled ||
    JSON.stringify(targets) !== JSON.stringify(toDrafts(connection.forwardTargets));

  function updateTarget(i: number, patch: Partial<TargetDraft>) {
    setApplied(false);
    setTargets((cur) => cur.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }
  function addTarget() {
    setApplied(false);
    setTargets((cur) => [...cur, { host: "127.0.0.1", port: "20778" }]);
  }
  function removeTarget(i: number) {
    setApplied(false);
    setTargets((cur) => cur.filter((_, j) => j !== i));
  }

  function applyTelemetry() {
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
    setApplied(true);
  }

  async function saveDiscord(): Promise<boolean> {
    if (!IN_TAURI) return true;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const clean = await invoke<DiscordConfig>("set_discord_config", { config: discord });
      setDiscord(clean);
      return true;
    } catch (e) {
      setDiscordNote(String(e));
      return false;
    }
  }

  async function testDiscord() {
    setDiscordBusy(true);
    setDiscordNote(null);
    if (await saveDiscord()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("discord_test");
        setDiscordNote("Test post sent — check the channel.");
      } catch (e) {
        setDiscordNote(String(e));
      }
    }
    setDiscordBusy(false);
  }

  async function saveDiscordOnly() {
    setDiscordBusy(true);
    setDiscordNote(null);
    if (await saveDiscord()) setDiscordNote("Saved.");
    setDiscordBusy(false);
  }

  return (
    <div className="settings-page">
        <div className="settings-inner">
          <h2 className="settings-title">Settings</h2>
          <p className="settings-sub">
            Connection, session storage, and integrations for this install.
          </p>

          <Section title="Telemetry">
            <div className="field">
              <label className="field-label" htmlFor="udp-port">
                UDP port
              </label>
              <input
                id="udp-port"
                className="field-input mono"
                inputMode="numeric"
                value={port}
                onChange={(e) => {
                  setApplied(false);
                  setPort(e.target.value.replace(/[^0-9]/g, ""));
                }}
                aria-invalid={!portValid}
                aria-describedby="udp-port-hint"
              />
              <p
                id="udp-port-hint"
                className={`field-hint${portValid ? "" : " field-hint-error"}`}
              >
                {portValid
                  ? "Default is 20777 — match your F1 game's telemetry options."
                  : "Enter a port between 1024 and 65535."}
              </p>
            </div>

            <div className="field">
              <span className="field-label">Telemetry format</span>
              <Segmented
                options={FORMAT_OPTIONS}
                value={format}
                onChange={(v) => {
                  setApplied(false);
                  setFormat(v);
                }}
                ariaLabel="Telemetry format"
              />
              <p className="field-hint">F1 26 uses 2026; F1 25 falls back to 2025.</p>
            </div>

            <div className="field">
              <span className="field-label">Forward telemetry to</span>
              <Segmented
                options={FORWARD_OPTIONS}
                value={forwardEnabled ? "on" : "off"}
                onChange={(v) => {
                  setApplied(false);
                  setForwardEnabled(v === "on");
                }}
                ariaLabel="Forward telemetry"
              />
              <p className="field-hint">
                Relay a copy of the feed to another app (e.g. SimHub) so it can read
                telemetry without competing for the port.
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

            <div className="settings-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={applyTelemetry}
                disabled={!canApply || !dirty}
              >
                Apply connection
              </button>
              {IN_TAURI && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  // The hint promises the setup screen — leave Settings so the
                  // no-feed view (with the re-detect steps) is actually shown.
                  onClick={() => {
                    resetFeed();
                    setMode("race");
                  }}
                >
                  Reset connection
                </button>
              )}
              {applied && !dirty && (
                <span className="field-hint" role="status">
                  Applied.
                </span>
              )}
            </div>
            {IN_TAURI && (
              <p className="field-hint">
                {feed.state === "standby"
                  ? "The feed is on standby. Resetting returns to the setup screen and re-detects the telemetry source."
                  : "Reset returns to the setup screen and re-detects the telemetry source — use it after moving the game to another PC or if the feed looks stuck."}
              </p>
            )}
          </Section>

          <Section title="Sessions">
            <div className="field">
              <span className="field-label">Keep saved sessions</span>
              <Segmented
                options={RETENTION_OPTIONS}
                value={
                  pendingRetention != null
                    ? String(pendingRetention)
                    : retention == null
                      ? "all"
                      : String(retention)
                }
                onChange={(v) => {
                  setRetentionNote(null);
                  const days = v === "all" ? null : Number(v);
                  // Loosening (or no change) can't delete anything — apply directly.
                  // Tightening arms a confirm instead of pruning on the click.
                  if (days == null || (retention != null && days >= retention)) {
                    setPendingRetention(null);
                    setRetention(days);
                    void setHistoryRetention(days);
                  } else {
                    setPendingRetention(days);
                  }
                }}
                ariaLabel="History retention"
              />
              {pendingRetention != null ? (
                <div className="retention-confirm">
                  <p className="field-hint field-hint-error">
                    Permanently deletes unpinned sessions older than {pendingRetention} days.
                  </p>
                  <div className="retention-confirm-actions">
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => {
                        const days = pendingRetention;
                        setPendingRetention(null);
                        setRetention(days);
                        void setHistoryRetention(days).then((removed) => {
                          setRetentionNote(
                            removed > 0
                              ? `${removed} session${removed === 1 ? "" : "s"} removed.`
                              : "No sessions were old enough to remove.",
                          );
                        });
                      }}
                    >
                      Apply retention
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={() => setPendingRetention(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="field-hint">
                  {retentionNote ??
                    "Auto-delete saved sessions older than this. Pinned sessions are always kept."}
                </p>
              )}
            </div>
          </Section>

          <Section title="Voice engineer">
            <div className="field">
              <span className="field-label">Voice race engineer</span>
              <Segmented
                options={ONOFF_OPTIONS}
                value={engineer.enabled ? "on" : "off"}
                onChange={(v) => setEngineer({ ...engineer, enabled: v === "on" })}
                ariaLabel="Voice race engineer"
              />
              <p className="field-hint">
                Speaks proactive callouts from live telemetry using your computer's
                voice — offline, no account, no AI.
              </p>

              {engineer.enabled && (
                <div className="eng-config">
                  <div className="eng-cats" role="group" aria-label="Callout types">
                    {ENGINEER_CATEGORIES.map(({ key, label }) => (
                      <label className="eng-cat" key={key}>
                        <input
                          type="checkbox"
                          checked={cats[key]}
                          onChange={() => toggleCat(key)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>

                  <label className="field-label" htmlFor="eng-voice">
                    Voice
                  </label>
                  <select
                    id="eng-voice"
                    className="field-input"
                    value={engineer.voiceURI ?? ""}
                    onChange={(e) =>
                      setEngineer({ ...engineer, voiceURI: e.target.value || null })
                    }
                  >
                    <option value="">System default</option>
                    {voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>

                  <label className="field-label eng-rate-label" htmlFor="eng-rate">
                    Speech speed — {engineer.rate.toFixed(1)}×
                  </label>
                  <input
                    id="eng-rate"
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.1}
                    value={engineer.rate}
                    onChange={(e) =>
                      setEngineer({ ...engineer, rate: Number(e.target.value) })
                    }
                  />

                  <button
                    type="button"
                    className="btn btn-ghost btn-sm eng-test"
                    onClick={() =>
                      speakOnce("Radio check — loud and clear.", {
                        voiceURI: engineer.voiceURI,
                        rate: engineer.rate,
                        volume: engineer.volume,
                      })
                    }
                  >
                    Test voice
                  </button>
                </div>
              )}
            </div>
          </Section>

          <Section title="Discord">
            <div className="field">
              <label className="field-label" htmlFor="discord-url">
                Channel webhook URL
              </label>
              <input
                id="discord-url"
                className="field-input mono"
                type="password"
                autoComplete="off"
                placeholder="https://discord.com/api/webhooks/…"
                value={discord.webhookUrl}
                onChange={(e) => {
                  setDiscordNote(null);
                  setDiscord({ ...discord, webhookUrl: e.target.value });
                }}
              />
              <p className="field-hint">
                Paste a channel webhook URL (Channel settings → Integrations →
                Webhooks) and BoxBox posts results there. Leave empty to turn off.
                {!IN_TAURI && " Available in the desktop app."}
              </p>
              {discord.webhookUrl.trim() !== "" && (
                <div className="eng-cats" role="group" aria-label="Discord post types">
                  {DISCORD_TOGGLES.map(({ key, label }) => (
                    <label className="eng-cat" key={key}>
                      <input
                        type="checkbox"
                        checked={discord[key]}
                        onChange={() => {
                          setDiscordNote(null);
                          setDiscord({ ...discord, [key]: !discord[key] });
                        }}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              )}
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void saveDiscordOnly()}
                  disabled={discordBusy || !IN_TAURI}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void testDiscord()}
                  disabled={discordBusy || !IN_TAURI || discord.webhookUrl.trim() === ""}
                >
                  {discordBusy ? "Working…" : "Send test post"}
                </button>
              </div>
              {discordNote && (
                <p
                  className={`field-hint${
                    discordNote === "Saved." || discordNote.startsWith("Test post sent")
                      ? ""
                      : " field-hint-error"
                  }`}
                  role="status"
                >
                  {discordNote}
                </p>
              )}
            </div>
          </Section>
      </div>
    </div>
  );
}
