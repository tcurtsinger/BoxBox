import { SERVER } from "./server";

// Steward writes. After a successful POST the server's next SSE frame pushes the
// updated state, so callers don't use the response; they await and catch.
async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${SERVER}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
}

export function flagIncident(input: {
  carIndices: number[];
  label?: string;
  note?: string;
}): Promise<void> {
  return post("/api/incidents/manual", input);
}

export function approveIncident(id: string, outcome: string): Promise<void> {
  return post("/api/incidents/approve", { id, outcome });
}

export function dismissIncident(id: string): Promise<void> {
  return post("/api/incidents/dismiss", { id });
}

export function reopenIncident(id: string): Promise<void> {
  return post("/api/incidents/reopen", { id });
}

// Set a manual display-name override for a car; pass an empty string to clear it.
export function setDriverName(index: number, name: string): Promise<void> {
  return post("/api/drivers/name", { index, name });
}
