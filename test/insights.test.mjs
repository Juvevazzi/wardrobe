import { test } from "node:test";
import assert from "node:assert/strict";
import { isLightColor, wardrobeGaps } from "../src/shared/wardrobe-insights.mjs";

const CATEGORIES = [
  { id: "upperbody", label: "Tops" },
  { id: "lowerbody", label: "Bottoms" },
  { id: "shoes", label: "Shoes" },
];

test("isLightColor classifies near-white as light and near-black as dark", () => {
  assert.equal(isLightColor("#f5f5f5"), true);
  assert.equal(isLightColor("#101010"), false);
});

test("wardrobeGaps counts light/dark per category", () => {
  const items = [
    { part: "upperbody", color: "#101010" },
    { part: "upperbody", color: "#151515" },
    { part: "lowerbody", color: "#eeeeee" },
  ];
  const { rows } = wardrobeGaps(items, CATEGORIES);
  assert.deepEqual(rows.find((row) => row.id === "upperbody"), { id: "upperbody", label: "Tops", total: 2, light: 0, dark: 2 });
  assert.deepEqual(rows.find((row) => row.id === "shoes"), { id: "shoes", label: "Shoes", total: 0, light: 0, dark: 0 });
});

test("wardrobeGaps flags mostly-dark tops with no light bottoms, and empty categories", () => {
  const items = [
    { part: "upperbody", color: "#101010" },
    { part: "upperbody", color: "#151515" },
    { part: "upperbody", color: "#181818" },
    { part: "lowerbody", color: "#202020" },
  ];
  const { notes } = wardrobeGaps(items, CATEGORIES);
  assert.ok(notes.some((note) => note.includes("Mostly dark tops")));
  assert.ok(notes.some((note) => note.includes("No shoes")));
});

test("wardrobeGaps stays quiet when a category is too small to judge", () => {
  const items = [{ part: "upperbody", color: "#101010" }, { part: "lowerbody", color: "#101010" }, { part: "shoes", color: "#101010" }];
  const { notes } = wardrobeGaps(items, CATEGORIES);
  assert.equal(notes.some((note) => note.includes("Mostly dark tops")), false);
});
