# BoxBox Web (FIA Console)

React + Vite UI for the BoxBox race-control console. It consumes the server's
Server-Sent Events stream (`GET /events`) and renders the live timing tower.

## Run

1. Start the server (from `../server`): `node src/index.ts`
   (UDP ingest on :20777, HTTP/SSE on :8080).
2. Start the UI (from here): `npm install` then `npm run dev` (Vite on :5173).
3. Open the printed URL. The UI connects to `http://<that host>:8080` by default,
   so opening it from another machine on the LAN points back at the same host.

Override the server location with `VITE_SERVER_URL` (e.g. a `.env.local` with
`VITE_SERVER_URL=http://192.168.1.10:8080`).

## Scripts

- `npm run dev` live dev server with hot reload
- `npm run build` production build to `dist/`
- `npm run typecheck` `tsc --noEmit`
- `npm run preview` serve the production build locally

Unlike `server/` (which runs install-free under Node type stripping), this
package uses a normal Vite toolchain, so it requires `npm install`.
