/**
 * League persistence: loads the stored league documents on mount and writes
 * whole documents back on every mutation (Rust is a dumb shelf; leagueData.ts
 * owns the shape). The browser preview keeps leagues in memory only, so the
 * section is fully explorable without the app.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { League } from "./leagueData";

const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export interface LeaguesApi {
  leagues: League[];
  loaded: boolean;
  /** Upsert one league (optimistic locally, persisted when in Tauri). */
  save: (league: League) => void;
  remove: (id: string) => void;
  /** A disk write failed: the on-screen state is NOT durable until a retry
   *  succeeds. Null when everything saved cleanly. */
  saveError: string | null;
  retrySave: () => void;
}

/** The stored league documents (empty outside Tauri or on a fresh install). */
export async function listLeagues(): Promise<League[]> {
  if (!IN_TAURI) return [];
  try {
    return await call<League[]>("league_list");
  } catch {
    return [];
  }
}

export function useLeagues(): LeaguesApi {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Monotonic stamp per league_save request. Same-id revisions can have
   *  overlapping in-flight writes, so completions must be ordered by REQUEST,
   *  not by document id — an older success must never silently confirm a
   *  newer revision that failed. */
  const seqRef = useRef(0);
  /** Newest successfully persisted request per league id. */
  const okSeq = useRef(new Map<string, number>());
  /** The newest league document revision that failed to persist. */
  const failed = useRef<{ league: League; seq: number } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const list = await listLeagues();
      if (active) {
        setLeagues(list);
        setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback((league: League) => {
    if (!IN_TAURI) return;
    const seq = ++seqRef.current;
    void call("league_save", { league })
      .then(() => {
        okSeq.current.set(league.id, Math.max(okSeq.current.get(league.id) ?? 0, seq));
        // This success confirms this doc's revisions up to `seq` only: a
        // failed NEWER revision of the same doc keeps the alarm.
        if (failed.current && failed.current.league.id === league.id && failed.current.seq <= seq) {
          failed.current = null;
          setSaveError(null);
        }
      })
      .catch((e) => {
        // The optimistic copy is on screen but NOT on disk — losing a whole
        // race night's points silently is the one unforgivable failure here.
        // A stale failure is moot once a newer revision of the doc saved.
        if ((okSeq.current.get(league.id) ?? 0) > seq) return;
        if (failed.current == null || seq >= failed.current.seq) {
          failed.current = { league, seq };
          setSaveError(String(e));
        }
      });
  }, []);

  const save = useCallback(
    (league: League) => {
      setLeagues((cur) => {
        const i = cur.findIndex((l) => l.id === league.id);
        return i >= 0 ? [...cur.slice(0, i), league, ...cur.slice(i + 1)] : [...cur, league];
      });
      persist(league);
    },
    [persist],
  );

  const retrySave = useCallback(() => {
    if (failed.current) persist(failed.current.league);
  }, [persist]);

  const remove = useCallback((id: string) => {
    setLeagues((cur) => cur.filter((l) => l.id !== id));
    if (IN_TAURI) {
      void call("league_delete", { id }).catch((e) => setSaveError(String(e)));
    }
  }, []);

  return { leagues, loaded, save, remove, saveError, retrySave };
}
