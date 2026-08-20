# Phase 1 — Extract the server

**Depends on:** Phase 0 (tests must exist before this refactor).
**Blocks:** Phases 2, 3, 4, and all of Phase 5.
**Effort:** the bulk of a weekend. Mostly mechanical, but the job-resume logic needs care.

## Goal

A deployable process. `npm run build && npm start` should serve a working app with a live API.

## The problem

Everything backend lives in `wardrobeImportApi()` inside `scripts/import-job-api.mjs`, registered as a Vite plugin with `apply: "serve"`. So `npm run build` produces a static bundle with **no API at all**.

The irony is visible in `src/main.jsx`:

```js
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
```

The service worker only registers in the one mode where the app is broken.

## Why now

This unblocks reverse-proxy deployment, HTTPS, containerisation, and mobile access. Every later phase assumes a real server process exists.

## Tasks

### 1. Split the module

The handler is already a plain `(req, res, next)` connect middleware, so extraction is cheap:

- **`server/wardrobe-api.mjs`** — exports `createWardrobeHandler({ env, root })`, returning the existing middleware unchanged in behaviour.
- **`server/index.mjs`** — a `node:http` or Fastify server that mounts the handler and serves `dist/` as static files with an SPA fallback.
- **`scripts/import-job-api.mjs`** — becomes a thin Vite plugin calling `createWardrobeHandler` from `configureServer` and `configurePreviewServer`. Roughly 20 lines.

### 2. Move initialisation out of `configResolved`

Startup work — creating `data/jobs` and `data/imported`, resuming interrupted jobs — currently lives in a Vite lifecycle hook. Extract it to an exported `initialize()` that both entry points call.

### 3. Add scripts

`"start": "node server/index.mjs"`. Keep `dev` as-is.

### 4. Add a Dockerfile

Node 22 slim, `npm ci --omit=dev`, build, expose the port, `data/` as a volume. Note that `sharp` needs its platform-specific binaries — build inside the container rather than copying `node_modules` in.

### 5. Bind sensibly

Read the port from `PORT` (default 4173) and bind to `127.0.0.1` by default, with `0.0.0.0` opt-in via env. Behind a reverse proxy, loopback is the correct default.

## Done when

`docker compose up` gives a working wardrobe on a LAN hostname, through a reverse proxy, with the service worker doing something real for the first time.

## Watch for

The resume-on-startup path reconstructs job state and calls `generate()` fire-and-forget. In a long-lived server process that is fine — just make sure it does not run on every hot reload in dev.
