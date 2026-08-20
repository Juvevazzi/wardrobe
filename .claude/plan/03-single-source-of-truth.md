# Phase 3 — One source of truth

**Depends on:** Phase 1 (a real server), Phase 2 (edits are writes, so they need auth).
**Blocks:** all of Phase 5.
**Effort:** ~1 evening, plus care on the migration.

## Goal

The server owns the data. Edits made on one device show up on another.

## The problem

`persistEdit` and `persistDeletedItem` in `src/App.jsx` write to browser localStorage while `library.json` stays stale. Rename an item on your desktop and it is gone on your phone. Clear site data and every rename reverts while the images remain.

The infrastructure to fix this already exists — `atomicJson()` and `library.json` are both there. There simply is no `PATCH` endpoint.

## Why now

Every Phase 5 feature wants to persist new fields. Building them on localStorage means writing the same migration twice.

## Tasks

### 1. Add `PATCH /api/import/wardrobe/:id`

Updates the record in `library.json` via the existing `atomicJson()` helper, reusing `normalizeMetadata()` for validation.

### 2. Delete the localStorage layer

Remove from `src/App.jsx`: `readEdits`, `persistEdit`, `removePersistedEdit`, `readDeletedItems`, `persistDeletedItem`, and both storage-key constants. Roughly 60 lines out.

### 3. Write a one-time migration

On first load after the upgrade, if `open-wardrobe-edits-v1` exists in localStorage, PATCH each edit up to the server, then clear the key. Without this, everyone silently loses their renames.

### 4. Extract shared categories

The category list is defined three times in three different shapes: `TYPES` in `App.jsx`, `PARTS` in `import-flow.jsx`, and `PARTS` as a Set in the server. Adding a category means editing three files and hoping. Create `src/shared/categories.mjs` exporting the id / label / singular triples, imported by all three.

### 5. Add a React error boundary

Wrap the viewer and import tray so a render throw does not blank the whole app.

## Done when

Rename an item on desktop, refresh on phone, see the new name. Add a "bags" category by editing exactly one file.
