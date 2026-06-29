import { isTauri } from "./tauri";

/**
 * Thin guards over the Tauri window API. In a plain browser (dev preview) these
 * are no-ops so the frameless titlebar still renders and the app stays usable.
 */

async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export async function minimizeWindow() {
  if (!isTauri()) return;
  (await win()).minimize();
}

export async function toggleMaximizeWindow() {
  if (!isTauri()) return;
  (await win()).toggleMaximize();
}

export async function closeWindow() {
  if (!isTauri()) return;
  (await win()).close();
}

/**
 * Subscribe to maximize/unmaximize so the maximize button can swap to a
 * restore glyph. Returns an unsubscribe; resolves immediately to `false`
 * (not maximized) outside Tauri.
 */
export async function watchMaximized(
  onChange: (maximized: boolean) => void,
): Promise<() => void> {
  if (!isTauri()) {
    onChange(false);
    return () => {};
  }
  const w = await win();
  onChange(await w.isMaximized());
  const unlisten = await w.onResized(async () => {
    onChange(await w.isMaximized());
  });
  return unlisten;
}
