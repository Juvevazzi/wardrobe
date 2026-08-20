import { test } from "node:test";
import assert from "node:assert/strict";
import {
  body,
  constantTimeEquals,
  extractToken,
  jobAssetFilenames,
  libraryAssetFilenames,
  nextQuotaState,
  nextRetryDelay,
  runQueued,
} from "../server/wardrobe-api.mjs";

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fakeRequest({ chunks = [], contentLength } = {}) {
  return {
    headers: contentLength !== undefined ? { "content-length": String(contentLength) } : {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield Buffer.from(chunk);
    },
  };
}

test("body() rejects based on declared content-length before reading anything", async () => {
  const req = fakeRequest({ contentLength: 1000, chunks: [] });
  await assert.rejects(() => body(req, 100), (error) => error.status === 413);
});

test("body() still enforces the limit when content-length is missing or lying", async () => {
  const req = fakeRequest({ chunks: ["x".repeat(200)] });
  await assert.rejects(() => body(req, 100), (error) => error.status === 413);
});

test("body() parses a valid JSON body", async () => {
  const req = fakeRequest({ chunks: [JSON.stringify({ a: 1 })] });
  assert.deepEqual(await body(req), { a: 1 });
});

test("body() returns {} for an empty body", async () => {
  assert.deepEqual(await body(fakeRequest({ chunks: [] })), {});
});

test("body() rejects invalid JSON with 400", async () => {
  await assert.rejects(() => body(fakeRequest({ chunks: ["not json"] })), (error) => error.status === 400);
});

test("constantTimeEquals matches equal strings and rejects mismatches", () => {
  assert.equal(constantTimeEquals("secret", "secret"), true);
  assert.equal(constantTimeEquals("secret", "wrong!"), false);
  assert.equal(constantTimeEquals("secret", "secrets"), false);
  assert.equal(constantTimeEquals("", ""), true);
  assert.equal(constantTimeEquals(undefined, "secret"), false);
});

test("extractToken reads a Bearer header first, then falls back to the session cookie", () => {
  assert.equal(extractToken({ authorization: "Bearer abc123" }), "abc123");
  assert.equal(extractToken({ authorization: "bearer abc123" }), "abc123");
  assert.equal(extractToken({ cookie: "wardrobe_session=xyz789; other=1" }), "xyz789");
  assert.equal(extractToken({ authorization: "Bearer abc", cookie: "wardrobe_session=xyz" }), "abc");
  assert.equal(extractToken({}), null);
});

test("nextRetryDelay backs off exponentially for 429 and 5xx", () => {
  assert.equal(nextRetryDelay({ status: 429, retryAfterSeconds: NaN, attempt: 0 }), 500);
  assert.equal(nextRetryDelay({ status: 500, retryAfterSeconds: NaN, attempt: 1 }), 1000);
  assert.equal(nextRetryDelay({ status: 503, retryAfterSeconds: NaN, attempt: 2 }), 2000);
});

test("nextRetryDelay honors retry-after over the exponential schedule", () => {
  assert.equal(nextRetryDelay({ status: 429, retryAfterSeconds: 5, attempt: 0 }), 5000);
});

test("nextRetryDelay does not retry non-retryable statuses", () => {
  assert.equal(nextRetryDelay({ status: 400, retryAfterSeconds: NaN, attempt: 0 }), null);
  assert.equal(nextRetryDelay({ status: 200, retryAfterSeconds: NaN, attempt: 0 }), null);
});

test("nextRetryDelay stops once maxRetries is reached", () => {
  assert.equal(nextRetryDelay({ status: 429, retryAfterSeconds: NaN, attempt: 4 }), null);
});

test("nextRetryDelay caps the exponential backoff", () => {
  assert.equal(nextRetryDelay({ status: 429, retryAfterSeconds: NaN, attempt: 20, maxRetries: 30 }), 30000);
});

test("nextQuotaState starts a fresh count on a new day", () => {
  const result = nextQuotaState({ stored: { date: "2026-08-14", count: 50 }, today: "2026-08-15", limit: 10 });
  assert.deepEqual(result, { allowed: true, date: "2026-08-15", count: 1 });
});

test("nextQuotaState increments within the same day under the limit", () => {
  const result = nextQuotaState({ stored: { date: "2026-08-15", count: 3 }, today: "2026-08-15", limit: 10 });
  assert.deepEqual(result, { allowed: true, date: "2026-08-15", count: 4 });
});

test("nextQuotaState rejects once the daily limit is reached", () => {
  const result = nextQuotaState({ stored: { date: "2026-08-15", count: 10 }, today: "2026-08-15", limit: 10 });
  assert.deepEqual(result, { allowed: false, date: "2026-08-15", count: 10 });
});

test("nextQuotaState treats a missing counter file as day one", () => {
  assert.deepEqual(nextQuotaState({ stored: null, today: "2026-08-15", limit: 10 }), { allowed: true, date: "2026-08-15", count: 1 });
});

test("jobAssetFilenames collects only filenames the job currently references", () => {
  const job = {
    originalAssetUrl: "/api/import/assets/abc/original.png",
    stages: {
      crop: { assetUrl: "/api/import/assets/abc/crop.png" },
      garment: { assetUrl: "/api/import/assets/abc/garment-2.png", failedAssetUrl: null, cleanupPreviewUrl: null },
    },
  };
  assert.deepEqual(jobAssetFilenames(job), new Set(["original.png", "crop.png", "garment-2.png"]));
});

test("jobAssetFilenames never allows a path-traversal segment through", () => {
  const job = { originalAssetUrl: "/api/import/assets/abc/original.png" };
  assert.equal(jobAssetFilenames(job).has(".."), false);
});

test("runQueued caps concurrency and starts a queued task once a slot frees up", async () => {
  const started = [];
  const releases = [];
  const makeTask = (id) => () => new Promise((resolve) => { started.push(id); releases.push(resolve); });

  const p1 = runQueued(makeTask(1), 2);
  const p2 = runQueued(makeTask(2), 2);
  const p3 = runQueued(makeTask(3), 2);

  assert.deepEqual(started, [1, 2], "a third task beyond the limit should not start yet");

  releases[0]();
  await tick();
  assert.deepEqual(started, [1, 2, 3], "the queued task should start once a slot frees up");

  releases[1]();
  releases[2]();
  await Promise.all([p1, p2, p3]);
});

test("libraryAssetFilenames collects image and modeledImage basenames", () => {
  const records = [
    { image: "/api/import/library/import-a-garment.png", modeledImage: "/api/import/library/import-a-modeled.png" },
    { image: "/api/import/library/import-b-garment.png", modeledImage: null },
  ];
  assert.deepEqual(libraryAssetFilenames(records), new Set(["import-a-garment.png", "import-a-modeled.png", "import-b-garment.png"]));
});
