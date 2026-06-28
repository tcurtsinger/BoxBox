import { SERVER } from "./server";

// Client -> server writes for the Tuner control API. The server clamps and echoes
// the applied value, but the UI shows its state from the SSE snapshot (the source
// of truth), so callers can fire-and-forget. Errors are swallowed: a dropped write
// just means the next SSE frame still shows the old value, so the user sees it
// didn't take and can retry.
export async function setPreference(preference: number): Promise<void> {
  try {
    await fetch(`${SERVER}/api/preference`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preference }),
    });
  } catch {
    // Network/server error: SSE keeps showing the real value; nothing to undo.
  }
}
