import { test } from "node:test";
import assert from "node:assert/strict";
import { outfitWarmthScore, suggestOutfitsForWeather, weatherBucket } from "../src/shared/weather.mjs";

test("weatherBucket buckets a Celsius temperature", () => {
  assert.equal(weatherBucket(-2), "cold");
  assert.equal(weatherBucket(12), "cool");
  assert.equal(weatherBucket(20), "mild");
  assert.equal(weatherBucket(28), "warm");
  assert.equal(weatherBucket(NaN), null);
  assert.equal(weatherBucket(undefined), null);
});

const itemsById = {
  a: { tags: ["wool", "knit"] },
  b: { tags: ["linen", "short-sleeve"] },
  c: { tags: ["cotton"] },
};

test("outfitWarmthScore is positive for cold-cue tags and negative for warm-cue tags", () => {
  assert.equal(outfitWarmthScore({ garmentIds: ["a"] }, itemsById), 2);
  assert.equal(outfitWarmthScore({ garmentIds: ["b"] }, itemsById), -2);
  assert.equal(outfitWarmthScore({ garmentIds: ["c"] }, itemsById), 0);
  assert.equal(outfitWarmthScore({ garmentIds: ["a", "b"] }, itemsById), 0);
});

test("suggestOutfitsForWeather keeps warm-scoring outfits for cold and light ones for warm", () => {
  const outfits = [{ id: "cold-fit", garmentIds: ["a"] }, { id: "warm-fit", garmentIds: ["b"] }, { id: "neutral-fit", garmentIds: ["c"] }];
  assert.deepEqual(suggestOutfitsForWeather(outfits, itemsById, "cold").map((o) => o.id), ["cold-fit", "neutral-fit"]);
  assert.deepEqual(suggestOutfitsForWeather(outfits, itemsById, "warm").map((o) => o.id), ["warm-fit", "neutral-fit"]);
});

test("suggestOutfitsForWeather passes everything through for mild/cool buckets or no match", () => {
  const outfits = [{ id: "x", garmentIds: ["a"] }];
  assert.deepEqual(suggestOutfitsForWeather(outfits, itemsById, "mild"), outfits);
  assert.deepEqual(suggestOutfitsForWeather(outfits, itemsById, null), outfits);
});

test("suggestOutfitsForWeather falls back to everything when nothing matches", () => {
  const outfits = [{ id: "warm-fit", garmentIds: ["b"] }];
  assert.deepEqual(suggestOutfitsForWeather(outfits, itemsById, "cold"), outfits);
});
