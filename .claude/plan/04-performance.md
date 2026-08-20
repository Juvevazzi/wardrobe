# Phase 4 — Performance

**Depends on:** Phase 1.
**Blocks:** nothing, but much easier before Phase 5 multiplies the images on screen.
**Effort:** 2–3 evenings. Task 1 is most of it.
**Parallelisable:** yes, alongside Phase 3 — different files.

## Goal

Make a 60-item wardrobe load like a gallery rather than a photo dump.

## Tasks

### 1. Generate thumbnails

`OptimizedImage` is a misnomer — it sets `loading="lazy"` and `decoding="async"` and nothing else. The gallery grid loads 1024×1024 PNGs with alpha for tiles rendered at ~200px.

`sharp` is already a dependency. Add `?w=` support to the library and asset routes, produce and cache WebP variants on first request under `data/cache/`, and emit `srcset` from `OptimizedImage`. On a 60-item wardrobe this is roughly 150 MB of initial transfer down to single-digit MB — the single biggest win in this phase.

### 2. Store modeled images as WebP

They are 1536×1024 editorial photos with no transparency, currently PNG. WebP q82 will be roughly a tenth the size with no visible difference. Keep PNG only for cutouts, where alpha is load-bearing.

### 3. Downscale before the vision call

In `POST /jobs`, `normalizeImage` converts a phone JPEG to PNG, which is then base64'd into the Responses API body at full camera resolution. A 4 MB JPEG can become a 20 MB+ PNG and then a 27 MB base64 string.

Send a ~1536px JPEG for analysis instead. Bounding boxes are normalised to 1000×1000, so nothing is lost. Keep the full-resolution original on disk for the crop step.

### 4. Replace per-job polling

`src/import-flow.jsx` runs:

```js
const timer = setInterval(() => jobs.forEach((job) => refresh(job.id)), 900);
```

in an effect that depends on `jobs` — so every response tears the timer down and rebuilds it, and N jobs means N requests per tick. With eight garments that is roughly nine requests per second.

Switch to a single `GET /api/import/jobs` poll (the endpoint already returns everything), or add SSE and hang listeners off the existing `running` Map.

### 5. Cache images in the service worker

`public/sw.js` only intercepts navigations. Cutouts are immutable and already served `max-age=31536000, immutable` — ideal cache-first candidates.

## Done when

The gallery is usable on mobile data, and the network tab shows one polling request per tick instead of eight.
