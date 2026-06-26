import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Tuner UI talks to the Tuner server (UDP ingest + SSE) over HTTP. Port 5174
// so it can run alongside the Race Control console dev server (5173).
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
});
