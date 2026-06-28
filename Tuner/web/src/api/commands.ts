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

// Thumbs feedback on the last applied change: +1 liked it, -1 did not. The server
// nudges the balance preference and clears the change; the next SSE frame reflects
// both, so this is fire-and-forget like setPreference.
export async function sendFeedback(thumb: 1 | -1): Promise<void> {
  try {
    await fetch(`${SERVER}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thumb }),
    });
  } catch {
    // Network/server error: SSE keeps showing the real state; nothing to undo.
  }
}
