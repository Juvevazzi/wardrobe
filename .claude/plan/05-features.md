# Phase 5 — Features

**Depends on:** Phase 3 for persistence. 5.6 additionally depends on 5.4.
**Effort:** ongoing. Each item ships independently.

## Goal

Turn a photo gallery into something worth opening twice a week.

Ordered so each item is independently shippable. 5.1 comes first for a non-negotiable reason.

---

## 5.1 Export and backup

`data/` is gitignored and there is no export path, so the entire library — generated with real money — is one `rm -rf` from gone.

`GET /api/import/export` streams a zip of `library.json` plus `data/imported/`, with a matching import endpoint that merges records and files.

**Effort:** about an hour. Removes a genuine risk.

---

## 5.2 Search and filter

Every item already carries `tags`, `color`, and `secondaryColor`, and the only filter is the five category buttons.

Add tag chips and a colour-similarity filter — `colorDistance` already exists in `src/App.jsx`.

**Effort:** ~40 lines plus styling.

---

## 5.3 Wear tracking and cost-per-wear

Add `pricePaid` and `wears: [timestamp]` to the library record — trivial once Phase 3 lands.

Unlocks cost-per-wear ranking, "not worn in six months," and most-worn pieces. This is the feature that makes wardrobe apps sticky, and it is mostly UI over data you already have.

**Effort:** 1–2 evenings.

---

## 5.4 Outfits in the web UI

The biggest gap between what the codebase can do and what the app does. `.agents/skills/generate-outfits/` is the most interesting thing in the repo and it is reachable only by opening the folder in Codex.

The staged generate → review → approve pattern is already built; outfits are the same flow with multiple garment inputs and a new job type.

**Effort:** budget real time — new job type, new stage set, new UI surface. But the plumbing is all there.

---

## 5.5 Gap analysis

**Depends on:** 5.2 (shares the colour-grouping logic).

With colours and categories structured, "you own nine dark tops and one light bottom" is an aggregation over `library.json`. Cheap once 5.2 exists, and it surfaces something people genuinely do not notice about their own wardrobes.

**Effort:** an evening.

---

## 5.6 Weather-aware suggestions

**Depends on:** 5.4.

Filter to appropriate layers based on a forecast lookup and item tags. Natural fit, and it gives the app a reason to be opened in the morning.

Build on top of 5.4 so outfit suggestions can be weather-filtered rather than reimplemented.

**Effort:** 1–2 evenings on top of 5.4.
