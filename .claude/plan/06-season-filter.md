# Phase 6 — Season filter

**Depends on:** nothing outstanding — Phases 1–4 (server-owned data) are already in place.
**Effort:** ~1 evening

## Goal

Sort every piece into spring / summer / fall / winter, and let the wardrobe view filter by it — the fourth filter alongside category, details, and colour.

## Current state

Category and colour filters follow two different existing patterns; season should reuse whichever fits, not invent a third:

- **Category (`part`)** — fixed vocabulary, single-select. Defined in `src/shared/categories.mjs`, rendered as the `category-nav` button row, edited via a `<select>` in the item viewer (`src/App.jsx:323`), filtered with a single `activeType` state (`src/App.jsx:731`).
- **Details (`tags`)** — free-text, multi-select AND filter. `TagEditor` component, `activeTags` state, `toggleTag` (`src/App.jsx:753`).
- **Colour** — derived similarity match against `activeColor`, not a stored category at all.

Season is a fixed 4-value vocabulary where each item has exactly one value — that's the category shape, not the tags shape. Reuse that pattern rather than the tag one.

## 6.1 Data: add `season` to the item schema

- `src/shared/categories.mjs`: add a `SEASONS` list (`id`/`label`) next to `CATEGORIES` — spring, summer, fall, winter.
- `server/wardrobe-api.mjs`, `normalizeMetadata` (~line 138): validate `metadata.season` against the four ids, default to `null` (unassigned) rather than guessing a value.
- The PATCH `/wardrobe/:id` metadata handler (~line 952) already spreads `normalizeMetadata`'s output into the saved record — no separate change needed there.

## 6.2 Editor: manual season picker

- `ItemViewer`'s draft editor (`src/App.jsx`, next to the existing `part` `<select>` at line 323): add a matching `<select>` bound to `draft.season`.
- Include `season` in the `isDirty` diff (~line 408) and in `saveItem`'s PATCH payload (~line 782), same as `part`.

## 6.3 Infer season on import (optional, do after 6.1–6.2 work manually)

- The garment-detection call already asks the model for `part`/`color`/`tags` per item via a strict JSON schema (`server/wardrobe-api.mjs` ~line 588–591). Add `season` to that schema with the same enum, and one line to the prompt telling it to infer season from garment weight/type (e.g. wool coat → winter, tank top → summer).
- Let it return `null` when it isn't confident (an accessory, a year-round basic) — unassigned beats a wrong guess.

## 6.4 Filter UI

- Add a `season-nav` chip row next to `category-nav`, single-select like category (not multi-select like tags — an item has one season).
- New `activeSeason` state, one more clause in the `visibleItems` filter chain (`src/App.jsx:731`), same shape as the existing `activeType` check.
- Include an "Unsorted" option covering `season === null`, so items nobody has classified yet don't just disappear from a season filter.

## 6.5 Backfill

Skip a migration script. `normalizeMetadata` already defaults a missing `season` to `null`, and 6.4's "Unsorted" bucket surfaces those items instead of hiding them. Classify pieces opportunistically by opening them; only write a bulk-backfill pass later if the wardrobe is large enough that this is genuinely tedious.

## Effort

~1 evening. Every piece (schema field, `<select>`, filter chip row, filter clause) is a small mechanical addition next to code that already does this exact job for category.
