import { test } from "node:test";
import assert from "node:assert/strict";
import { outfitAssetFilenames } from "../server/wardrobe-api.mjs";

test("outfitAssetFilenames collects basenames from either an API path or a repo-relative one", () => {
  const outfits = [
    { image: "/api/import/outfits/navy-camel-classic.png" },
    { image: "outfit-images/summer-linen.png" },
    { image: null },
  ];
  assert.deepEqual(outfitAssetFilenames(outfits), new Set(["navy-camel-classic.png", "summer-linen.png"]));
});
