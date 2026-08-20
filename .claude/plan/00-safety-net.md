# Phase 0 — Safety net and paper cuts

**Depends on:** nothing. Start here.
**Blocks:** Phase 1.
**Effort:** ~1 focused evening. Items 4–6 are 20 minutes total.

## Goal

Make it safe to refactor. Nothing here changes architecture; it is all groundwork so the next phases cannot silently break the image pipeline.

## Why first

Phase 1 moves the entire backend out of the Vite plugin. Without tests around the chroma-key code, a regression there will only surface as "the cutouts look slightly wrong," weeks later, with no obvious cause.

## Tasks

### 1. Test the image pipeline

Add `node --test` coverage for the pure functions in `scripts/import-job-api.mjs`:

- **`processChromaBackground`** — green garment on a green key, magenta key, a garment that legitimately contains the key colour, and a fully opaque image (must not blank out).
- **`frameTransparentGarment`** — off-centre garment, garment touching the frame edge, all-transparent input (must throw the existing "did not leave a visible garment" error).
- **`chooseChromaKey`** — verify it avoids the garment's own primary colour.
- **`normalizeBoundingBox`** and **`normalizeMetadata`** — clamping, malformed input, missing fields.

Commit 5–6 small fixture PNGs under `test/fixtures/`. These are characterisation tests: they capture today's behaviour so Phase 1 cannot change it by accident.

### 2. Add linting

ESLint with the React hooks plugin. The hooks plugin alone will flag the polling effect in `src/import-flow.jsx` that Phase 4 addresses.

### 3. Wire up CI

Change `npm run check` from `vite build` to `lint && test && build`, and update `.github/workflows/ci.yml` to match.

### 4. Fix the dead progress bar

`src/import-flow.jsx` contains `const progress = 0;`, which then feeds `style={{ "--import-progress": ... }}`. Leftover scaffolding producing a permanently empty track. Either compute it from stage completion — crop → garment → modeled maps cleanly to 33/66/100 — or delete the track and keep only the indeterminate state.

### 5. Complete `.env.example`

Missing but read by `setting()`: `OPENAI_API_BASE_URL`, `OPENAI_GARMENT_MODEL`, `OPENAI_MODELED_MODEL`, `WARDROBE_DATA_DIR`. Add the same rows to the README config table. The base-URL one matters most — it is what lets someone point this at a local or alternative endpoint.

### 6. Make `allowedHosts` configurable

`vite.config.mjs` hardcodes `allowedHosts: ["terminal.local"]`, inherited from the upstream author's machine. Behind a reverse proxy on any other hostname, Vite rejects the request with a host-check error. Replace with `env.WARDROBE_ALLOWED_HOSTS?.split(",") ?? []`.

## Done when

CI runs lint, tests, and build, and the chroma tests pass against the current implementation unmodified.
