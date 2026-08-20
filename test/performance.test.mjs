import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveThumbnailWidth } from "../server/wardrobe-api.mjs";

test("resolveThumbnailWidth snaps to the nearest canonical width", () => {
  assert.equal(resolveThumbnailWidth("180"), 180);
  assert.equal(resolveThumbnailWidth("200"), 180);
  assert.equal(resolveThumbnailWidth("220"), 240);
  assert.equal(resolveThumbnailWidth("2000"), 1280);
  assert.equal(resolveThumbnailWidth("1"), 120);
});

test("resolveThumbnailWidth returns null for missing or invalid widths", () => {
  assert.equal(resolveThumbnailWidth(null), null);
  assert.equal(resolveThumbnailWidth(undefined), null);
  assert.equal(resolveThumbnailWidth(""), null);
  assert.equal(resolveThumbnailWidth("not-a-number"), null);
  assert.equal(resolveThumbnailWidth("0"), null);
  assert.equal(resolveThumbnailWidth("-320"), null);
});
