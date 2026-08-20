import { test } from "node:test";
import assert from "node:assert/strict";
import { createTarball, extractTarball, normalizePricePaid } from "../server/wardrobe-api.mjs";

test("createTarball/extractTarball round-trips file names and bytes", () => {
  const files = [
    { name: "library.json", data: Buffer.from(JSON.stringify([{ id: "import-a" }])) },
    { name: "imported/import-a-garment.png", data: Buffer.from([1, 2, 3, 4, 5]) },
    { name: "imported/empty.png", data: Buffer.alloc(0) },
  ];
  const extracted = extractTarball(createTarball(files));
  assert.deepEqual(extracted.map((file) => file.name), files.map((file) => file.name));
  for (const [index, file] of extracted.entries()) assert.deepEqual(Buffer.from(file.data), files[index].data);
});

test("createTarball pads content across the 512-byte block boundary", () => {
  const data = Buffer.alloc(513, 7);
  const [file] = extractTarball(createTarball([{ name: "big.bin", data }]));
  assert.equal(file.data.length, 513);
  assert.deepEqual(Buffer.from(file.data), data);
});

test("normalizePricePaid accepts non-negative finite numbers and rounds to cents", () => {
  assert.equal(normalizePricePaid("42.567"), 42.57);
  assert.equal(normalizePricePaid(0), 0);
  assert.equal(normalizePricePaid(""), null);
  assert.equal(normalizePricePaid(null), null);
  assert.equal(normalizePricePaid(undefined), null);
  assert.equal(normalizePricePaid(-5), null);
  assert.equal(normalizePricePaid("not a number"), null);
});
