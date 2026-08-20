# Wardrobe — Improvement Roadmap

A sequenced plan for the issues and features identified in the code review, split by phase. Phases are ordered by dependency, not by appeal: each one removes a blocker for the next.

| Phase | File | Focus | Effort |
| --- | --- | --- | --- |
| 0 | [00-safety-net.md](./00-safety-net.md) | Tests, lint, paper cuts | ~1 evening |
| 1 | [01-extract-server.md](./01-extract-server.md) | A deployable server process | ~1 weekend |
| 2 | [02-auth-and-resilience.md](./02-auth-and-resilience.md) | Auth, spend caps, API retries | 1–2 evenings |
| 3 | [03-single-source-of-truth.md](./03-single-source-of-truth.md) | Server-owned data, kill localStorage | ~1 evening |
| 4 | [04-performance.md](./04-performance.md) | Thumbnails, WebP, polling | 2–3 evenings |
| 5 | [05-features.md](./05-features.md) | Export, search, wear tracking, outfits | Ongoing |
| 6 | [06-season-filter.md](./06-season-filter.md) | Season filter (spring/summer/fall/winter) | ~1 evening |

## Sequencing rationale

Two decisions drive the order.

**Tests before the server extraction.** Phase 1 moves the entire backend. A regression in the chroma-key math won't announce itself — it will just make cutouts subtly wrong, discovered weeks later with no obvious cause.

**Phase 3 before any Phase 5 feature.** Every feature on that list wants to persist new fields. Building them against the current localStorage layer means writing the same migration twice.

Don't start Phase 5 until Phase 1 is done. Features built on a backend that only exists during `vite dev` get rewritten later.

## Dependency graph

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► 5.2 ──► 5.5
                 │                       │
                 └──► Phase 4            ├──► 5.1
                                         ├──► 5.3
                                         └──► 5.4 ──► 5.6
```

Phase 4 can run in parallel with Phase 3 — they touch different files. Everything in Phase 5 depends on Phase 3 for persistence.

**Phase 6** builds on the category/colour filter UI added in 5.2, but has no hard dependency of its own — Phase 3's server-owned data already covers it.

## Suggested first PR

Phase 0, in one commit series, ending with green CI. Low risk, finishable in a sitting, and it makes every subsequent phase safer to attempt.
