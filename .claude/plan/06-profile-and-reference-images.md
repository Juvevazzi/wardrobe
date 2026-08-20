# Phase 6 — Profile and reference images

**Depends on:** Phase 1 (a real server), Phase 3 (server owns the data). Both are already in place.
**Blocks:** nothing.
**Effort:** 1–2 evenings.

## Goal

Replace the single hardcoded identity photo with a UI-managed profile: upload several reference images, see them, pick which one drives modeled-image generation, switch it whenever, and capture a little basic info about the wearer.

## The problem

The identity reference is entirely filesystem-managed today. Drop a PNG at `data/model-reference.png` (or point `WARDROBE_MODEL_REFERENCE` elsewhere), restart the server. There's no way to see what's currently set, keep more than one photo around, or try another without overwriting the file and hoping it works as well as the last one.

`generateLook()` reads that one path straight off disk on every generation (`server/wardrobe-api.mjs:847`), and `setupStatus()` (`server/wardrobe-api.mjs:645`) just checks whether the file exists. Both frontend setup-required messages (`src/outfit-flow.jsx:129`, `src/import-flow.jsx:262`) tell the user to hand-edit `.env` and restart — the only "profile UI" that exists.

This is a single-tenant app (one login token, no accounts — see Phase 2), so "profile" means one wearer, not per-user records.

## Data model

New `data/profile.json`, written with the existing `atomicJson()` helper, same as `library.json`/`outfits.json`:

```json
{
  "basicInfo": { "name": "", "notes": "" },
  "referenceImages": [
    { "id": "ref-<uuid>", "filename": "ref-<uuid>.png", "label": "", "createdAt": "..." }
  ],
  "activeReferenceImageId": "ref-<uuid>"
}
```

Image bytes live in `data/reference-images/`, served through an allowlist route the same way `libraryAssetMatch` does (`server/wardrobe-api.mjs:1014`) — never trust the filename in the URL alone.

`basicInfo` stays at name + free-text notes. Nothing downstream reads more than that yet; add fields when a real feature needs them, not speculatively.

## Tasks

### 1. Server: profile + reference-image storage

- `configure()`: add `profileFile = path.join(dataDir, "profile.json")` and `referenceImageDir = path.join(dataDir, "reference-images")`.
- `GET /api/import/profile` → `basicInfo`, `referenceImages` (with servable image URLs), `activeReferenceImageId`.
- `PATCH /api/import/profile` → shallow-merges into `basicInfo`, same pattern as the wardrobe-item metadata PATCH (`server/wardrobe-api.mjs:946`), plus accepts `{ activeReferenceImageId }` to switch the active image (validate it exists in `referenceImages` first).
- `POST /api/import/profile/reference-images` → body `{ imageDataUrl }`, reuse `decodeImage()` (`server/wardrobe-api.mjs:127`), write the file, append the record. If this is the first image, set it active automatically — one upload is enough to finish setup.
- `DELETE /api/import/profile/reference-images/:id` → removes file + record. If it was active, fall back to the next remaining image, or `null` if none are left.
- `GET /api/import/reference-images/:filename` → serves from `referenceImageDir`, filenames checked against `referenceImages` records only.

### 2. Point `generateLook()` at the active image

Swap the `path.resolve(root, setting("WARDROBE_MODEL_REFERENCE", ...))` read (`server/wardrobe-api.mjs:847`) for: load `profile.json`, resolve `activeReferenceImageId` to its file in `referenceImageDir`. If there's no active image, fail with the same shape of error it throws today for a missing file.

Update `setupStatus()` (`server/wardrobe-api.mjs:645`) to report `hasActiveReferenceImage` instead of `hasModelReference`.

**One-time migration:** if `profile.json` doesn't exist yet but a file exists at the `WARDROBE_MODEL_REFERENCE` path, import it as the first reference image the first time `setupStatus()` runs, so anyone already using the app keeps working without re-uploading. Leave `WARDROBE_MODEL_REFERENCE` in `.env.example` as a legacy note once this lands, since the migration still reads it.

### 3. UI: Profile tab

Add `"profile"` next to Wardrobe/Outfits in the tab bar (`src/App.jsx:834`). New `src/profile-flow.jsx` + `.css`, following the `outfit-flow.jsx` shape:

- Basic info form: name + notes, saved on blur via `PATCH /api/import/profile`, same optimistic-update-then-revert-on-error pattern as `saveItem` (`src/App.jsx:773`).
- Reference image grid: tiles like `LookPickerTile` (`src/outfit-flow.jsx:13`), active one visibly marked, click a tile to activate it, a trash button per tile to delete, plus an upload control reusing the file→base64→POST flow already in `import-flow.jsx`.

### 4. Fix the setup-required copy

`src/outfit-flow.jsx:129` and `src/import-flow.jsx:262` currently say to edit `.env` and restart. Point both at the Profile tab instead.

## Done when

Upload two reference photos in Profile, generate a look, switch the active photo, generate again — the new photo is the one used, no restart needed. Deleting the active photo falls back cleanly instead of the next generation throwing.
