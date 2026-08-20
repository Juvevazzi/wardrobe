# Phase 7 — Outfit management

**Depends on:** nothing outstanding — Phases 1–4 (server-owned data, a real job queue) are already in place.
**Blocks:** nothing.
**Effort:** 1–2 evenings.

## Goal

Three gaps in the Outfits tab, all mechanical once you see the existing pattern each one should reuse:

1. No way to delete a generated outfit.
2. The look builder (`OutfitBuilder`) picks garments from a flat, unfiltered grid — the wardrobe tab's category/tag/colour/season filters don't apply here.
3. Look generation already runs as a background job on a concurrency-limited queue, but there's no UI to see jobs you've navigated away from, and cancelling one doesn't actually stop the in-flight OpenAI request.

## Current state

Outfit jobs already follow the same staged generate → review → approve pattern as garment import (`server/wardrobe-api.mjs:885` `generateLook`, queued through `runQueued` at `server/wardrobe-api.mjs:822`, concurrency-limited by `WARDROBE_GENERATION_CONCURRENCY`). `POST /api/import/outfit-jobs` returns `202` immediately and the job runs fire-and-forget (`wardrobe-api.mjs:1201`); `GET /api/import/outfit-jobs/:id` and `GET /api/import/outfit-jobs` (all jobs, `wardrobe-api.mjs:1204`) already exist. So "background queue, referable by id" is mostly built. What's missing is real cancellation and a UI surface for the queue — see 7.3.

## 7.1 Delete outfits

Mirror the existing wardrobe-item delete exactly (`wardrobe-api.mjs:1096` route, `removeLibraryAssets` at `wardrobe-api.mjs:211`):

- `DELETE /api/import/outfits/:id` — filter `outfits.json`'s array, 404 if the id wasn't there, `atomicJson` the rest back, remove the image file from `outfitAssetDir` plus its cached thumbnails (`cacheDir/outfits/<filename>-w*.webp`, same widths `thumbnailCacheFiles` already uses for the library — write a one-off `removeOutfitAssets(filename)` since outfits only ever have one asset file, not the three-variant shape `removeLibraryAssets` handles).
- Route goes next to the other `/api/import/outfits` handlers (`wardrobe-api.mjs:1129`–`1147`).
- UI: add a delete button to `OutfitCard` (`src/App.jsx:634`) — same `Trash` icon already imported in `outfit-flow.jsx`, no confirmation modal (the wardrobe item's own `.delete-button` in `ItemViewer` at `App.jsx:569` doesn't use one either — stay consistent). On success, `setOutfits((current) => current.filter((o) => o.id !== outfit.id))` in `OutfitsView` (`App.jsx:660`), same optimistic-removal shape as `deleteItem` (`App.jsx:832`).

## 7.2 Filterable garment picker in the look builder

`OutfitBuilder`'s `look-picker-grid` (`src/outfit-flow.jsx:133`) just maps over every `items` prop with no filtering. `Wardrobe()` already built exactly this filter stack for the wardrobe grid — category nav, tag chips, colour swatch, season chips (`src/App.jsx:720`–`762` for the state and `visibleItems` derivation, `874`–`923` for the JSX) — don't rebuild it, extract it.

- Pull the four filter states + `visibleItems` derivation out of `Wardrobe()` into a hook, e.g. `useWardrobeFilters(items)` in `src/shared/wardrobe-filters.mjs`, returning `{ activeType, chooseType, activeTags, toggleTag, activeColor, setActiveColor, activeSeason, setActiveSeason, availableTags, visibleItems }`. `TYPES`/`TYPE_MAP`/`SEASON_FILTERS`/`hexToRgb` (currently module-level in `App.jsx:12`–`23`) move with it since the hook needs them.
- Pull the filter nav JSX (`App.jsx:874`–`923`) into a presentational `<WardrobeFilters />` component taking the hook's return value as props, so both call sites render identical markup instead of two copies drifting apart.
- `Wardrobe()` and `OutfitBuilder` both call the hook and render `<WardrobeFilters />` above their respective grids; swap `items.map(...)` for `visibleItems.map(...)` in `outfit-flow.jsx:135`.

Effort: an extraction, not new logic — every filter already exists and works.

## 7.3 Background queue: visibility + real cancellation

**The cancellation gap.** `DELETE /api/import/outfit-jobs/:id` (`wardrobe-api.mjs:1218`) removes the job directory, but `generateLook`'s `runQueued` task (`wardrobe-api.mjs:888`) keeps running regardless — nothing observes the deletion. When the in-flight `openAIEdit` call finishes, the `catch`/success path calls `saveOutfitJob`, which recreates `job.json` in the directory that was just deleted — a "deleted" job resurrects on disk. Deleting a queued-but-not-started job is fine (it's just never picked up); deleting a processing one isn't.

- Thread an `AbortController` through: `openAIEdit` (`wardrobe-api.mjs:562`) takes a `signal` and passes it into the `fetch` call at `wardrobe-api.mjs:574` (through `withRetry`, which should stop retrying on an abort rather than treating it as a retryable failure). `generateLook` creates the controller at the top of its `runQueued` task and stores it in a module-level `Map` keyed by job id (same in-memory, process-lifetime scope as the existing `running` Map at `wardrobe-api.mjs:609` — consistent with `resumeStaleJobs`, `wardrobe-api.mjs:1418`, already re-running anything left `processing`/`queued` after a restart, so losing an unresolved controller on restart is the existing behavior, not a new gap).
- New terminal status `"cancelled"` alongside `failed`/`review`. `generateLook`'s catch block: if the error is an abort, set `status: "cancelled"` instead of `"failed"`; either way, guard the save — if `loadOutfitJob(current.id)` returns `null` (directory already gone), skip the write instead of resurrecting it. That guard alone fixes the resurrection bug even before cancellation exists.
- `DELETE /api/import/outfit-jobs/:id`: if `stage.status === "processing"`, call `.abort()` on the stored controller before removing the directory.
- The same resurrection bug exists in `generate()` for garment jobs (`wardrobe-api.mjs:837`) — not this phase's scope, but the fix is the identical one-line `null` guard, worth doing in the same pass since you're already touching the pattern.

**The visibility gap.** `OutfitBuilder` only tracks the one job it just created in local state (`job`, `src/outfit-flow.jsx:32`); closing the popover calls `reset()` and that job is gone from view even though it's still running server-side. `GET /api/import/outfit-jobs` already returns every job — the fix is UI-only:

- A small queue list in `OutfitsView` (`src/App.jsx:660`), fetched from the existing all-jobs endpoint, polling on the same ~900ms interval `OutfitBuilder` already uses (`src/outfit-flow.jsx:41`–`51`) only while at least one job is non-terminal. Each row: status pill, thumbnail once one exists, a Cancel button for `queued`/`processing` rows (calls the `DELETE` above).
- Clicking a `review` row opens `OutfitBuilder` against that job instead of starting a new one — give it an optional `initialJobId` prop that fetches and sets `job` on mount rather than always starting from the empty picker. The review/regenerate/approve UI (`outfit-flow.jsx:170`–`196`) already handles any job in that shape; it just needs to be reachable from an existing job, not only a freshly created one.

## Done when

Delete an outfit from the gallery and it's gone from disk, not just the list. Open the look builder, filter to jackets, build a look from the filtered set. Start a generation, close the popover, see it still listed as processing in the queue, cancel it — the job stops immediately (no image finishes writing after cancel) and does not reappear.
