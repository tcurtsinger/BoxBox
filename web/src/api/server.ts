// Base URL for the BoxBox server. Defaults to the same host the UI is served
// from, on the server's port, so it works on the observer's machine and from a
// LAN box pointed at it. Override with VITE_SERVER_URL.
export const SERVER = import.meta.env.VITE_SERVER_URL ?? `http://${location.hostname}:8080`;
