import { useCallback, useEffect, useMemo, useState } from "react";
import { useShell } from "../../shell/shell-context";
import { Segmented } from "../../shell/Segmented";
import { SlidersIcon } from "../../shell/icons";
import { useTunerSnapshot } from "../tuner/useTunerSnapshot";
import { COMPOUND_NAME, fmtLap } from "../tuner/tunerData";
import { SetupSheet } from "./SetupSheet";
import {
  deleteTune,
  fmtBest,
  fmtWhen,
  getTune,
  listTunes,
  renameTune,
  saveCurrentTune,
  setTuneNotes,
  setTunePinned,
  trackName,
  type LapRecord,
  type TimeStore,
  type Tune,
  type TuneSummary,
} from "./tunesData";
import "./tunes.css";

/**
 * Tunes / Setups — the saved-setup library. A sortable list on the left, the
 * selected tune's detail (its two time stores, the saved setup sheet, notes) on
 * the right. The header reflects what the Tuner is reading live: the matching
 * saved tune ("Running …"), or a "Save current setup" action when the live setup
 * isn't in the library yet.
 */
type SortKey = "recent" | "track" | "bestTt" | "bestPractice";

const SORTS: readonly { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "track", label: "Track" },
  { value: "bestTt", label: "Best TT" },
  { value: "bestPractice", label: "Best Practice" },
];

/** A best time of 0 (no laps) sorts last, not first. */
const bestKey = (ms: number): number => (ms > 0 ? ms : Number.POSITIVE_INFINITY);

function sortTunes(list: TuneSummary[], key: SortKey): TuneSummary[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    switch (key) {
      case "track": {
        const t = trackName(a.trackId).localeCompare(trackName(b.trackId));
        return t !== 0 ? t : b.lastUsedAtMs - a.lastUsedAtMs;
      }
      case "bestTt":
        return bestKey(a.bestTimeTrialMs) - bestKey(b.bestTimeTrialMs);
      case "bestPractice":
        return bestKey(a.bestPracticeMs) - bestKey(b.bestPracticeMs);
      case "recent":
      default:
        return b.lastUsedAtMs - a.lastUsedAtMs;
    }
  });
}

export function SetupsView() {
  const { feed, setTunesSection, setReferenceTune } = useShell();
  const sample = feed.sample === true;
  const snap = useTunerSnapshot(sample);
  const matchedId = snap?.matchedTuneId ?? null;
  const liveSetup = snap?.setup ?? null;

  const [tunes, setTunes] = useState<TuneSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [sort, setSort] = useState<SortKey>("recent");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Tune | null>(null);

  const reload = useCallback(async () => {
    setTunes(await listTunes());
    setReady(true);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const sorted = useMemo(() => sortTunes(tunes, sort), [tunes, sort]);

  // Keep a valid selection: preserve the current one, else prefer the live tune,
  // else fall back to the first in the sorted list.
  useEffect(() => {
    if (selectedId && tunes.some((t) => t.id === selectedId)) return;
    const next =
      matchedId && tunes.some((t) => t.id === matchedId) ? matchedId : sorted[0]?.id ?? null;
    setSelectedId(next);
  }, [tunes, sorted, matchedId, selectedId]);

  const loadDetail = useCallback(async (id: string | null) => {
    setDetail(id ? await getTune(id) : null);
  }, []);
  useEffect(() => {
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // After an in-place mutation (pin / rename / notes), refresh both the list and
  // the open detail so the headline times and metadata stay in step.
  const refresh = useCallback(async () => {
    await reload();
    await loadDetail(selectedId);
  }, [reload, loadDetail, selectedId]);

  // After a delete, drop the selection; the effect above repicks a default.
  const onDeleted = useCallback(async () => {
    setSelectedId(null);
    await reload();
  }, [reload]);

  const onSaveCurrent = useCallback(async () => {
    const id = await saveCurrentTune();
    await reload();
    if (id) setSelectedId(id);
  }, [reload]);

  const matchedInList = !!matchedId && tunes.some((t) => t.id === matchedId);
  const matchedName = matchedInList ? tunes.find((t) => t.id === matchedId)!.name : null;

  const summaryLine = useMemo(() => {
    const tracks = new Set(tunes.map((t) => t.trackId)).size;
    return `${tunes.length} setup${tunes.length > 1 ? "s" : ""} · ${tracks} track${tracks > 1 ? "s" : ""}`;
  }, [tunes]);

  // Brief blank during the initial load, so neither the empty hero nor the list flashes.
  if (!ready) return <div className="setups" />;

  // Empty library: one hero centred in the content area (the app's empty-state
  // convention), with no header bar competing for the eye.
  if (tunes.length === 0) {
    return (
      <div className="setups setups-centered">
        <SetupsEmpty hasLiveSetup={!!liveSetup} onSave={onSaveCurrent} />
      </div>
    );
  }

  return (
    <div className="setups">
      <div className="setups-inner">
        <header className="setups-bar">
          <div className="setups-head">
            <h1 className="setups-title">Setups</h1>
            <p className="setups-sub">{summaryLine}</p>
          </div>
          <div className="setups-bar-right">
            {matchedInList ? (
              <button
                type="button"
                className="setups-running"
                onClick={() => setSelectedId(matchedId)}
              >
                <span className="tune-dot is-live" aria-hidden="true" />
                Running <strong>{matchedName}</strong>
              </button>
            ) : liveSetup ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={onSaveCurrent}>
                Save current setup
              </button>
            ) : null}
            {tunes.length > 0 && (
              <div className="setups-sort">
                <span className="setups-sort-label">Sort</span>
                <Segmented
                  options={SORTS}
                  value={sort}
                  onChange={setSort}
                  ariaLabel="Sort setups"
                  groupClassName="seg seg-sm"
                />
              </div>
            )}
          </div>
        </header>

        <div className="setups-body">
          <ul className="setups-list" aria-label="Saved setups">
            {sorted.map((t) => (
              <TuneRow
                key={t.id}
                tune={t}
                active={t.id === selectedId}
                live={t.id === matchedId}
                onSelect={() => setSelectedId(t.id)}
              />
            ))}
          </ul>
          <div className="setups-detail">
            {detail ? (
              <TuneDetail
                tune={detail}
                isLive={detail.id === matchedId}
                onReload={refresh}
                onDeleted={onDeleted}
                onOpenInTuner={() => {
                  setReferenceTune(detail);
                  setTunesSection("tuner");
                }}
              />
            ) : (
              <div className="tune-detail-empty">Select a setup to see its laps and values.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SetupsEmpty({ hasLiveSetup, onSave }: { hasLiveSetup: boolean; onSave: () => void }) {
  return (
    <div className="setups-empty">
      <span className="setups-empty-icon" aria-hidden="true">
        <SlidersIcon size={26} />
      </span>
      <h2 className="setups-empty-title">No saved setups yet</h2>
      <p className="setups-empty-lead">
        Save the setup you&rsquo;re running from the Tuner and it lands here, with your best Time
        Trial and Practice laps tracked against it.
      </p>
      {hasLiveSetup ? (
        <button type="button" className="btn btn-primary" onClick={onSave}>
          Save current setup
        </button>
      ) : (
        <p className="setups-empty-note">
          Open the in-game setup screen on track &mdash; BoxBox detects it automatically.
        </p>
      )}
    </div>
  );
}

function TuneRow({
  tune,
  active,
  live,
  onSelect,
}: {
  tune: TuneSummary;
  active: boolean;
  live: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={`tune-row${active ? " is-active" : ""}`}
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
      >
        <span className="tune-row-main">
          <span className="tune-row-name">
            {tune.pinned && <span className="tune-dot is-pin" title="Pinned" aria-hidden="true" />}
            {live && <span className="tune-dot is-live" title="Running now" aria-hidden="true" />}
            {tune.name}
          </span>
          <span className="tune-row-track">{trackName(tune.trackId)}</span>
        </span>
        <span className="tune-row-times mono">
          <span className="tune-row-time">
            <b>TT</b> {fmtBest(tune.bestTimeTrialMs)}
          </span>
          <span className="tune-row-time">
            <b>PR</b> {fmtBest(tune.bestPracticeMs)}
          </span>
        </span>
      </button>
    </li>
  );
}

function TuneDetail({
  tune,
  isLive,
  onReload,
  onDeleted,
  onOpenInTuner,
}: {
  tune: Tune;
  isLive: boolean;
  onReload: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onOpenInTuner: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(tune.name);
  const [notesDraft, setNotesDraft] = useState(tune.notes);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset ephemeral edit state when a different tune is selected.
  useEffect(() => {
    setEditingName(false);
    setNameDraft(tune.name);
    setNotesDraft(tune.notes);
    setConfirmDelete(false);
  }, [tune.id]);

  // A staged delete reverts on its own if not confirmed, so a stray click never
  // leaves the button armed.
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3500);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const commitName = async () => {
    setEditingName(false);
    const next = nameDraft.trim();
    if (next && next !== tune.name) {
      await renameTune(tune.id, next);
      await onReload();
    } else {
      setNameDraft(tune.name);
    }
  };
  const commitNotes = async () => {
    if (notesDraft.trim() !== tune.notes) {
      await setTuneNotes(tune.id, notesDraft);
      await onReload();
    }
  };
  const togglePin = async () => {
    await setTunePinned(tune.id, !tune.pinned);
    await onReload();
  };
  const remove = async () => {
    await deleteTune(tune.id);
    await onDeleted();
  };

  return (
    <div className="tune-detail">
      <header className="tune-detail-head">
        <div className="tune-detail-id">
          {editingName ? (
            <input
              className="field-input tune-name-input"
              value={nameDraft}
              autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitName();
                if (e.key === "Escape") {
                  setNameDraft(tune.name);
                  setEditingName(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="tune-name"
              onClick={() => setEditingName(true)}
              title="Rename"
            >
              {tune.name}
            </button>
          )}
          <span className="tune-detail-track">
            {trackName(tune.trackId)}
            {isLive && (
              <span className="tune-live-chip">
                <span className="tune-dot is-live" aria-hidden="true" />
                Running now
              </span>
            )}
            <span className="tune-detail-when">· Updated {fmtWhen(tune.lastUsedAtMs)}</span>
          </span>
        </div>
        <div className="tune-detail-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenInTuner}>
            Open in Tuner
          </button>
          <button
            type="button"
            className={`btn btn-sm ${tune.pinned ? "btn-ghost" : "btn-quiet"}`}
            onClick={togglePin}
          >
            {tune.pinned ? "Pinned" : "Pin"}
          </button>
          {confirmDelete ? (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove()}>
              Confirm delete
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          )}
        </div>
      </header>

      <div className="tune-times">
        <TimeStat label="Best Time Trial" store={tune.timeTrial} />
        <TimeStat label="Best Practice" store={tune.practice} />
      </div>

      <div className="tune-sheet">
        <div className="setup-ref-label">Saved setup</div>
        <SetupSheet values={tune.setup} />
      </div>

      <label className="tune-notes-field">
        <span className="setup-ref-label">Notes</span>
        <textarea
          className="field-input tune-notes"
          rows={3}
          value={notesDraft}
          placeholder="What this setup is for, how it drives, what to tweak…"
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={commitNotes}
        />
      </label>
    </div>
  );
}

function TimeStat({ label, store }: { label: string; store: TimeStore }) {
  const n = store.laps.length;
  return (
    <div className="timestat">
      <span className="timestat-label">{label}</span>
      <span className="timestat-best mono">{fmtBest(store.bestMs)}</span>
      <span className="timestat-meta">
        {n > 0 ? `${n} clean lap${n > 1 ? "s" : ""}` : "No clean laps yet"}
      </span>
      {n > 0 && <RecentLaps laps={store.laps} />}
    </div>
  );
}

function RecentLaps({ laps }: { laps: LapRecord[] }) {
  // Newest first; the array is chronological and the best is held independently.
  const recent = laps.slice(-3).reverse();
  return (
    <ul className="lap-list">
      {recent.map((l, i) => (
        <li className="lap-item" key={`${l.recordedAtMs}-${i}`}>
          <span className="lap-time mono">{fmtLap(l.lapTimeMs)}</span>
          <span className="lap-tags">
            {l.compound != null && (
              <span className="lap-tag">{COMPOUND_NAME[l.compound] ?? `#${l.compound}`}</span>
            )}
            {l.trackTemp != null && <span className="lap-tag mono">{l.trackTemp}°</span>}
            {l.fuel != null && <span className="lap-tag mono">{l.fuel.toFixed(0)} kg</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
