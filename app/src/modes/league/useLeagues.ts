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

export function useLeagues(): LeaguesApi {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The most recent league document that failed to persist. */
  const failed = useRef<League | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (IN_TAURI) {
        try {
          const list = await call<League[]>("league_list");
          if (active) setLeagues(list);
        } catch {
          /* fresh install / unreadable store: start empty */
        }
      }
      if (active) setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback((league: League) => {
    if (!IN_TAURI) return;
    void call("league_save", { league })
      .then(() => {
        // Only clear the alarm if a NEWER failure hasn't replaced this doc.
        if (failed.current?.id === league.id) {
          failed.current = null;
          setSaveError(null);
        }
      })
      .catch((e) => {
        // The optimistic copy is on screen but NOT on disk — losing a whole
        // race night's points silently is the one unforgivable failure here.
        failed.current = league;
        setSaveError(String(e));
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
    if (failed.current) persist(failed.current);
  }, [persist]);

  const remove = useCallback((id: string) => {
    setLeagues((cur) => cur.filter((l) => l.id !== id));
    if (IN_TAURI) {
      void call("league_delete", { id }).catch((e) => setSaveError(String(e)));
    }
  }, []);

  return { leagues, loaded, save, remove, saveError, retrySave };
}
