import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLookPrompt,
  orderGarmentsForLook,
  outfitJobAssetFilenames,
  slugifyOutfitId,
} from "../server/wardrobe-api.mjs";

test("orderGarmentsForLook puts tops/outerwear before bottoms, accessories, then shoes", () => {
  const garments = [
    { name: "shoes", part: "shoes" },
    { name: "jacket", part: "wholebody_up" },
    { name: "bag", part: "accessories_up" },
    { name: "jeans", part: "lowerbody" },
    { name: "shirt", part: "upperbody" },
  ];
  assert.deepEqual(orderGarmentsForLook(garments).map((garment) => garment.name), ["jacket", "shirt", "jeans", "bag", "shoes"]);
});

test("orderGarmentsForLook keeps selection order within the same category tier", () => {
  const garments = [
    { name: "jacket", part: "wholebody_up" },
    { name: "shirt", part: "upperbody" },
  ];
  assert.deepEqual(orderGarmentsForLook(garments).map((garment) => garment.name), ["jacket", "shirt"]);
});

test("orderGarmentsForLook is a no-op for a single item", () => {
  const garments = [{ name: "shoes", part: "shoes" }];
  assert.deepEqual(orderGarmentsForLook(garments), garments);
});

test("buildLookPrompt uses singular phrasing and one Image line for a single garment", () => {
  const prompt = buildLookPrompt([{ name: "navy sweater", part: "upperbody" }]);
  assert.match(prompt, /wearing the exact navy sweater from Image 2\./);
  assert.equal((prompt.match(/^Image \d+:/gm) || []).length, 2); // identity + the one garment
});

test("buildLookPrompt lists one Image line per garment and uses plural phrasing for multiple", () => {
  const prompt = buildLookPrompt([
    { name: "navy sweater", part: "upperbody" },
    { name: "black jeans", part: "lowerbody" },
  ]);
  assert.match(prompt, /all 2 exact referenced garments from Images 2-3, and only those garments\./);
  assert.match(prompt, /Image 2: exact navy sweater reference\./);
  assert.match(prompt, /Image 3: exact black jeans reference\./);
});

test("outfitJobAssetFilenames collects only the look stage's current asset", () => {
  const job = { stages: { look: { assetUrl: "/api/import/outfit-job-assets/abc/look-2.webp" } } };
  assert.deepEqual(outfitJobAssetFilenames(job), new Set(["look-2.webp"]));
});

test("outfitJobAssetFilenames returns an empty set when there is no asset yet", () => {
  const job = { stages: { look: { assetUrl: null } } };
  assert.deepEqual(outfitJobAssetFilenames(job), new Set());
});

test("slugifyOutfitId slugifies a name and de-dupes against existing ids", () => {
  assert.equal(slugifyOutfitId("Navy & Camel Classic!", new Set()), "navy-camel-classic");
  assert.equal(slugifyOutfitId("Navy & Camel Classic!", new Set(["navy-camel-classic"])), "navy-camel-classic-2");
  assert.equal(slugifyOutfitId("Navy & Camel Classic!", new Set(["navy-camel-classic", "navy-camel-classic-2"])), "navy-camel-classic-3");
});

test("slugifyOutfitId falls back to \"look\" for an empty or missing name", () => {
  assert.equal(slugifyOutfitId(null, new Set()), "look");
  assert.equal(slugifyOutfitId("   ", new Set()), "look");
  assert.equal(slugifyOutfitId(null, new Set(["look"])), "look-2");
});
