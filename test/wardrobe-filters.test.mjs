import { test } from "node:test";
import assert from "node:assert/strict";
import { filterVisibleItems } from "../src/shared/wardrobe-filters.mjs";

const NO_FILTER = { activeType: "all", activeTags: [], activeColor: null, activeSeason: "all" };

test("filterVisibleItems returns everything, sorted by id, when no filter is active", () => {
  const items = [{ id: "b", part: "upperbody" }, { id: "a", part: "upperbody" }];
  assert.deepEqual(filterVisibleItems(items, NO_FILTER).map((item) => item.id), ["a", "b"]);
});

test("filterVisibleItems narrows by category", () => {
  const items = [{ id: "a", part: "upperbody" }, { id: "b", part: "shoes" }];
  const result = filterVisibleItems(items, { ...NO_FILTER, activeType: "shoes" });
  assert.deepEqual(result.map((item) => item.id), ["b"]);
});

test("filterVisibleItems requires every active tag to match", () => {
  const items = [
    { id: "a", part: "upperbody", tags: ["wool", "warm"] },
    { id: "b", part: "upperbody", tags: ["wool"] },
  ];
  const result = filterVisibleItems(items, { ...NO_FILTER, activeTags: ["wool", "warm"] });
  assert.deepEqual(result.map((item) => item.id), ["a"]);
});

test("filterVisibleItems matches close but not distant colors", () => {
  const items = [
    { id: "close", part: "upperbody", color: "#101010" },
    { id: "far", part: "upperbody", color: "#ffffff" },
  ];
  const result = filterVisibleItems(items, { ...NO_FILTER, activeColor: "#000000" });
  assert.deepEqual(result.map((item) => item.id), ["close"]);
});

test("filterVisibleItems 'unsorted' season selects only items with no season", () => {
  const items = [
    { id: "a", part: "upperbody", season: "summer" },
    { id: "b", part: "upperbody", season: null },
  ];
  const result = filterVisibleItems(items, { ...NO_FILTER, activeSeason: "unsorted" });
  assert.deepEqual(result.map((item) => item.id), ["b"]);
});
