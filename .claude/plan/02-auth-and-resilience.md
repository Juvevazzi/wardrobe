# Phase 2 — Auth, rate limiting, and API resilience

**Depends on:** Phase 1.
**Blocks:** Phase 3 (edits become writes and need auth).
**Effort:** 1–2 evenings. The queue is the interesting part; everything else is small.

## Goal

Stop the app from being an unauthenticated way for anyone on the network to spend money on your OpenAI key.

## Why now

Phase 1 makes the app reachable from outside `localhost`. This should land in the same breath — ideally the same PR. Today `server.host: "0.0.0.0"` plus zero auth on `POST /api/import/jobs` means any LAN device can trigger `gpt-image-2` calls at `quality: high`, with no rate limit, no request cap, and no accounting.

## Tasks

### 1. Authenticate `/api/import/*`

Simplest sufficient option: a shared secret in `WARDROBE_ACCESS_TOKEN`, sent as a header, stored in an httpOnly cookie after a single login form. Skip user accounts entirely — this is a single-tenant app.

### 2. Cap spending

A daily job ceiling from `WARDROBE_DAILY_JOB_LIMIT`, tracked in a small counter file next to `library.json`. Return 429 with a clear message when exceeded.

### 3. Add a generation queue

Replace the `void generate(job, stage)` fire-and-forget calls with a concurrency-limited queue, 2–3 in flight. Today a photo containing six garments fires six image-model calls simultaneously. The existing `running` Map is the natural place to build on.

### 4. Retry properly

Neither `openAIEdit` nor `openAIAnalyze` handles 429 or transient 5xx. A rate limit just marks the stage `failed` and makes the user click Retry by hand. Add exponential backoff honouring `retry-after`.

### 5. Harden asset serving

`GET /api/import/assets/:id/:file` does `stat()` then `readFile()`. `path.basename("..")` returns `".."`, so a crafted request resolves to the jobs directory and `readFile` throws `EISDIR` → 500 instead of 404. Validate requested filenames against the filenames recorded on the job rather than regex plus `basename` — this closes the category generally, not just this case.

### 6. Bound request bodies earlier

`body()` caps at 25 MB, but only after buffering the whole thing in memory, with unbounded concurrent requests. Reject on `content-length` first.

## Done when

An unauthenticated `curl` to `POST /api/import/jobs` returns 401, six-garment photos process two at a time, and a simulated 429 recovers without user intervention.
