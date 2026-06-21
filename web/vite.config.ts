import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The UI talks to the BoxBox server (UDP ingest + SSE) over HTTP. CORS on the
// server is permissive, so the dev server connects directly rather than proxying.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
