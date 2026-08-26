/**
 * League persistence: loads the stored league documents on mount and writes
 * whole documents back on every mutation (Rust is a dumb shelf; leagueData.ts
 * owns the shape). The browser preview keeps leagues in memory only, so the
 * section is fully explorable without the app.
 */
import { useCallback, useEffect, useState } from "react";
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
}

export function useLeagues(): LeaguesApi {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loaded, setLoaded] = useState(false);

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

  const save = useCallback((league: League) => {
    setLeagues((cur) => {
      const i = cur.findIndex((l) => l.id === league.id);
      return i >= 0 ? [...cur.slice(0, i), league, ...cur.slice(i + 1)] : [...cur, league];
    });
    if (IN_TAURI) {
      void call("league_save", { league }).catch(() => {
        /* the in-memory copy stays; the next successful save persists it */
      });
    }
  }, []);

  const remove = useCallback((id: string) => {
    setLeagues((cur) => cur.filter((l) => l.id !== id));
    if (IN_TAURI) {
      void call("league_delete", { id }).catch(() => {});
    }
  }, []);

  return { leagues, loaded, save, remove };
}
