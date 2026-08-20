import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { processChromaBackground, frameTransparentGarment, chooseChromaKey } from "../server/wardrobe-api.mjs";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixture(name) {
  return readFile(path.join(FIXTURES, name));
}

async function pixelAt(bytes, x, y) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const index = ((y * info.width) + x) * 4;
  return { r: data[index], g: data[index + 1], b: data[index + 2], a: data[index + 3] };
}

async function opaqueBounds(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    if (data[index + 3] <= 8) continue;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

test("chooseChromaKey avoids the garment's own primary color", () => {
  assert.equal(chooseChromaKey("#00ff00"), "#ff00ff");
  assert.equal(chooseChromaKey("#ff00ff"), "#00ff00");
  assert.notEqual(chooseChromaKey("#808080").toLowerCase(), "#808080");
});

test("processChromaBackground removes a green key cleanly and preserves the garment", async () => {
  const source = await fixture("garment-on-green.png");
  const result = await processChromaBackground(source, "#00ff00");
  assert.deepEqual(result.verification, { contaminatedPixels: 0, maxSpill: 0 });
  const meta = await sharp(result.bytes).metadata();
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 1024);
  assert.deepEqual(await opaqueBounds(result.bytes), { minX: 61, minY: 61, maxX: 961, maxY: 961 });
  assert.deepEqual(await pixelAt(result.bytes, 512, 512), { r: 204, g: 51, b: 51, a: 255 });
  assert.deepEqual(await pixelAt(result.bytes, 2, 2), { r: 0, g: 0, b: 0, a: 0 });
});

test("processChromaBackground removes a magenta key and cleans blue-channel spill", async () => {
  const source = await fixture("garment-on-magenta.png");
  const result = await processChromaBackground(source, "#ff00ff");
  assert.deepEqual(result.verification, { contaminatedPixels: 0, maxSpill: 0 });
  assert.deepEqual(await pixelAt(result.bytes, 512, 512), { r: 6, g: 84, b: 161, a: 190 });
});

test("processChromaBackground keeps a garment color that legitimately sits near the key", async () => {
  const source = await fixture("garment-with-greenish-detail.png");
  const result = await processChromaBackground(source, "#00ff00");
  assert.deepEqual(result.verification, { contaminatedPixels: 0, maxSpill: 0 });
  assert.deepEqual(await opaqueBounds(result.bytes), { minX: 61, minY: 61, maxX: 961, maxY: 961 });
  const center = await pixelAt(result.bytes, 512, 512);
  assert.ok(center.a > 0, "garment interior should not be wiped to fully transparent");
  assert.deepEqual(center, { r: 106, g: 70, b: 34, a: 141 });
});

test("processChromaBackground does not blank out an image with no key-colored pixels", async () => {
  const source = await fixture("opaque-no-key-color.png");
  const result = await processChromaBackground(source, "#00ff00");
  assert.deepEqual(result.verification, { contaminatedPixels: 0, maxSpill: 0 });
  assert.deepEqual(await opaqueBounds(result.bytes), { minX: 61, minY: 61, maxX: 961, maxY: 961 });
  assert.deepEqual(await pixelAt(result.bytes, 100, 100), { r: 26, g: 35, b: 64, a: 255 });
});

test("frameTransparentGarment centers an off-centre garment", async () => {
  const source = await fixture("garment-off-centre.png");
  const output = await frameTransparentGarment(source);
  const meta = await sharp(output).metadata();
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 1024);
  assert.deepEqual(await opaqueBounds(output), { minX: 61, minY: 61, maxX: 961, maxY: 961 });
});

test("frameTransparentGarment handles a garment touching the source edge", async () => {
  const source = await fixture("garment-touching-edge.png");
  const output = await frameTransparentGarment(source);
  const meta = await sharp(output).metadata();
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 1024);
  assert.deepEqual(await opaqueBounds(output), { minX: 211, minY: 61, maxX: 811, maxY: 961 });
});

test("frameTransparentGarment rejects a fully transparent image", async () => {
  const blank = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  await assert.rejects(() => frameTransparentGarment(blank), /did not leave a visible garment/);
});
