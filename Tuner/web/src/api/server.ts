// Base URL for the Tuner server. Defaults to the same host the UI is served from,
// on the Tuner server's port (8090, distinct from Race Control's 8080). Override
// with VITE_SERVER_URL.
export const SERVER = import.meta.env.VITE_SERVER_URL ?? `http://${location.hostname}:8090`;
