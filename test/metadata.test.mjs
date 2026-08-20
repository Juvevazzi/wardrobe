import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBoundingBox, normalizeMetadata } from "../server/wardrobe-api.mjs";

test("normalizeBoundingBox defaults to the full 1000x1000 frame", () => {
  assert.deepEqual(normalizeBoundingBox(), { x: 0, y: 0, width: 1000, height: 1000 });
  assert.deepEqual(normalizeBoundingBox({}), { x: 0, y: 0, width: 1000, height: 1000 });
});

test("normalizeBoundingBox clamps negative and out-of-range coordinates", () => {
  assert.deepEqual(normalizeBoundingBox({ x: -50, y: -10, width: 100, height: 100 }), { x: 0, y: 0, width: 100, height: 100 });
  assert.deepEqual(normalizeBoundingBox({ x: 5000, y: 5000, width: 50, height: 50 }), { x: 999, y: 999, width: 1, height: 1 });
});

test("normalizeBoundingBox clamps width/height so the box stays inside the 1000x1000 frame", () => {
  assert.deepEqual(normalizeBoundingBox({ x: 900, y: 900, width: 500, height: 500 }), { x: 900, y: 900, width: 100, height: 100 });
});

test("normalizeBoundingBox falls back to defaults for malformed input", () => {
  assert.deepEqual(normalizeBoundingBox(null), { x: 0, y: 0, width: 1000, height: 1000 });
  assert.deepEqual(normalizeBoundingBox([1, 2, 3]), { x: 0, y: 0, width: 1000, height: 1000 });
  assert.deepEqual(normalizeBoundingBox("not a box"), { x: 0, y: 0, width: 1000, height: 1000 });
});

test("normalizeBoundingBox falls back per-field for non-numeric values", () => {
  assert.deepEqual(normalizeBoundingBox({ x: "abc", width: "200" }), { x: 0, y: 0, width: 200, height: 1000 });
});

test("normalizeMetadata defaults an empty or malformed record", () => {
  const expected = { name: "New piece", part: "upperbody", color: "#d8d0c2", secondaryColor: null, tags: [], boundingBox: { x: 0, y: 0, width: 1000, height: 1000 } };
  assert.deepEqual(normalizeMetadata(), expected);
  assert.deepEqual(normalizeMetadata({}), expected);
  assert.deepEqual(normalizeMetadata(null), expected);
  assert.deepEqual(normalizeMetadata([1, 2]), expected);
});

test("normalizeMetadata validates and lowercases hex colors, rejecting invalid ones", () => {
  assert.equal(normalizeMetadata({ color: "#ABCDEF" }).color, "#abcdef");
  assert.equal(normalizeMetadata({ color: "not-a-color" }).color, "#d8d0c2");
  assert.equal(normalizeMetadata({ secondaryColor: "#123ABC" }).secondaryColor, "#123abc");
  assert.equal(normalizeMetadata({ secondaryColor: "not-a-color" }).secondaryColor, null);
});

test("normalizeMetadata falls back for an unknown part", () => {
  assert.equal(normalizeMetadata({ part: "shoes" }).part, "shoes");
  assert.equal(normalizeMetadata({ part: "hat" }).part, "upperbody");
});

test("normalizeMetadata trims and length-limits the name, falling back when empty", () => {
  assert.equal(normalizeMetadata({ name: "  Blue Jacket  " }).name, "Blue Jacket");
  assert.equal(normalizeMetadata({ name: "   " }).name, "New piece");
  assert.equal(normalizeMetadata({ name: "x".repeat(200) }).name.length, 120);
});

test("normalizeMetadata filters, trims, lowercases, and caps tags", () => {
  const tags = [" Denim ", 42, "STRIPED", "x".repeat(50), ...Array.from({ length: 20 }, (_, i) => `tag${i}`)];
  const result = normalizeMetadata({ tags });
  assert.equal(result.tags[0], "denim");
  assert.equal(result.tags[1], "striped");
  assert.equal(result.tags[2].length, 40);
  assert.equal(result.tags.length, 12);
});
