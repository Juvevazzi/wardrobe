import { randomUUID, timingSafeEqual } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import sharp from "sharp";
import { CATEGORIES, SEASONS } from "../src/shared/categories.mjs";

const API_ROOT = "/api/import/jobs";
const ASSET_ROOT = "/api/import/assets";
const LIBRARY_ASSET_ROOT = "/api/import/library";
const OUTFIT_ASSET_ROOT = "/api/import/outfits";
const OUTFIT_JOB_API = "/api/import/outfit-jobs";
const OUTFIT_JOB_ASSET_ROOT = "/api/import/outfit-job-assets";
const STAGES = new Set(["crop", "garment"]);
const DECISIONS = new Set(["approve", "reject"]);
const PARTS = new Set(CATEGORIES.map((category) => category.id));
const SEASON_IDS = new Set(SEASONS.map((season) => season.id));
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((category) => [category.id, category]));
const LOOK_CATEGORY_RANK = { upperbody: 0, wholebody_up: 0, lowerbody: 1, accessories_up: 2, shoes: 3 };
const MAX_LOOK_GARMENTS = 6;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SESSION_COOKIE = "wardrobe_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}

const isDev = process.env.NODE_ENV === "development";
function devLog(...args) { if (isDev) console.log("[wardrobe]", ...args); }

async function readBoundedBody(req, limit) {
  const contentLength = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw Object.assign(new Error("Request body too large"), { status: 413 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function body(req, limit = 25 * 1024 * 1024) {
  const buffer = await readBoundedBody(req, limit);
  if (!buffer.length) return {};
  try { return JSON.parse(buffer.toString("utf8")); }
  catch { throw Object.assign(new Error("Expected a JSON request body"), { status: 400 }); }
}

// A full-library backup can be much larger than a JSON request, so it gets its own limit.
export async function rawBody(req, limit = 250 * 1024 * 1024) {
  return readBoundedBody(req, limit);
}

function publicJob(job) {
  const copy = structuredClone(job);
  delete copy.internal;
  return copy;
}

function filenameFromUrl(url) {
  return path.basename(new URL(url, "http://localhost").pathname);
}

// Allowlist, not a sanitizer: only filenames the job itself currently references are
// servable, so a crafted path segment (e.g. "..") can never resolve outside its own job dir.
export function jobAssetFilenames(job) {
  const urls = [
    job?.originalAssetUrl,
    job?.stages?.crop?.assetUrl,
    job?.stages?.garment?.assetUrl,
    job?.stages?.garment?.failedAssetUrl,
    job?.stages?.garment?.cleanupPreviewUrl,
  ];
  return new Set(urls.filter(Boolean).map(filenameFromUrl));
}

export function libraryAssetFilenames(records) {
  const urls = records.flatMap((record) => [record.image, record.modeledImage]);
  return new Set(urls.filter(Boolean).map(filenameFromUrl));
}

// The generate-outfits Codex skill writes data/outfits.json directly; this app only reads it.
export function outfitAssetFilenames(outfits) {
  return new Set(outfits.map((outfit) => outfit.image).filter(Boolean).map(filenameFromUrl));
}

export function constantTimeEquals(a, b) {
  const bufferA = Buffer.from(String(a ?? ""));
  const bufferB = Buffer.from(String(b ?? ""));
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

function parseCookies(header = "") {
  const cookies = {};
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return cookies;
}

export function extractToken(headers = {}) {
  const authorization = headers.authorization || "";
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) return bearerMatch[1];
  const cookies = parseCookies(headers.cookie || "");
  return cookies[SESSION_COOKIE] || null;
}

function isAuthorized(req) {
  const token = setting("WARDROBE_ACCESS_TOKEN").trim();
  if (!token) return true;
  return constantTimeEquals(extractToken(req.headers), token);
}

function decodeImage(input) {
  const raw = input.imageDataUrl || input.imageBase64;
  if (!raw || typeof raw !== "string") throw Object.assign(new Error("imageDataUrl or imageBase64 is required"), { status: 400 });
  const match = raw.match(/^data:([^;]+);base64,(.+)$/s);
  const mime = match?.[1] || input.mimeType || "image/png";
  const data = Buffer.from(match?.[2] || raw, "base64");
  if (!data.length) throw Object.assign(new Error("Image payload is empty"), { status: 400 });
  return { data, mime };
}

export function normalizeMetadata(value = {}) {
  const metadata = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const color = typeof metadata.color === "string" && HEX_COLOR.test(metadata.color) ? metadata.color.toLowerCase() : "#d8d0c2";
  const secondaryColor = typeof metadata.secondaryColor === "string" && HEX_COLOR.test(metadata.secondaryColor) ? metadata.secondaryColor.toLowerCase() : null;
  return {
    name: typeof metadata.name === "string" ? metadata.name.trim().slice(0, 120) || "New piece" : "New piece",
    part: PARTS.has(metadata.part) ? metadata.part : "upperbody",
    color,
    secondaryColor,
    season: SEASON_IDS.has(metadata.season) ? metadata.season : null,
    tags: Array.isArray(metadata.tags) ? metadata.tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 12) : [],
    boundingBox: normalizeBoundingBox(metadata.boundingBox),
  };
}

export function normalizePricePaid(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}

export function normalizeBoundingBox(value = {}) {
  const box = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const number = (key, fallback) => Number.isFinite(Number(box[key])) ? Math.round(Number(box[key])) : fallback;
  const x = Math.max(0, Math.min(999, number("x", 0)));
  const y = Math.max(0, Math.min(999, number("y", 0)));
  const width = Math.max(1, Math.min(1000 - x, number("width", 1000 - x)));
  const height = Math.max(1, Math.min(1000 - y, number("height", 1000 - y)));
  return { x, y, width, height };
}

async function normalizeImage(bytes) {
  return sharp(bytes).rotate().toColorspace("srgb").png().toBuffer();
}

// A phone photo can be 4000px+ per side; the vision model only needs enough resolution to
// find garments, and bounding boxes are normalized to 1000x1000 so downscaling loses nothing.
async function analysisImage(bytes) {
  return sharp(bytes).rotate().resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}

const THUMBNAIL_WIDTHS = [120, 160, 180, 240, 320, 480, 640, 800, 1040, 1280];

export function resolveThumbnailWidth(param) {
  const requested = Number(param);
  if (!Number.isFinite(requested) || requested <= 0) return null;
  return THUMBNAIL_WIDTHS.reduce((closest, width) => Math.abs(width - requested) < Math.abs(closest - requested) ? width : closest);
}

async function resizeToWebp(sourceFile, width) {
  const source = await readFile(sourceFile);
  return sharp(source).resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
}

// Library assets are immutable once written (approving a job is a one-way copy into
// libraryAssetDir), so a plain cache-once-forever is correct — no invalidation needed.
async function cachedThumbnail(sourceFile, cacheFile, width) {
  try {
    return await readFile(cacheFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const resized = await resizeToWebp(sourceFile, width);
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, resized);
  return resized;
}

function thumbnailCacheFiles(filename) {
  return THUMBNAIL_WIDTHS.map((width) => path.join(cacheDir, "library", `${filename}-w${width}.webp`));
}

async function removeLibraryAssets(id) {
  const filenames = [`${id}-garment.png`, `${id}-modeled.png`, `${id}-modeled.webp`];
  await Promise.all(filenames.flatMap((filename) => [
    rm(path.join(libraryAssetDir, filename), { force: true }),
    ...thumbnailCacheFiles(filename).map((file) => rm(file, { force: true })),
  ]));
}

async function cropDetectedItem(bytes, boundingBox) {
  const normalized = await normalizeImage(bytes);
  const { width, height } = await sharp(normalized).metadata();
  const box = normalizeBoundingBox(boundingBox);
  const rawLeft = (box.x / 1000) * width;
  const rawTop = (box.y / 1000) * height;
  const rawWidth = (box.width / 1000) * width;
  const rawHeight = (box.height / 1000) * height;
  const padding = Math.max(12, Math.round(Math.max(rawWidth, rawHeight) * 0.08));
  const left = Math.max(0, Math.floor(rawLeft - padding));
  const top = Math.max(0, Math.floor(rawTop - padding));
  const right = Math.min(width, Math.ceil(rawLeft + rawWidth + padding));
  const bottom = Math.min(height, Math.ceil(rawTop + rawHeight + padding));
  return sharp(normalized).extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }).png().toBuffer();
}

function hexToRgb(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function chromaChannels(hex) {
  const target = hexToRgb(hex);
  const keyedChannels = target.map((channel, index) => (channel > 200 ? index : null)).filter((index) => index !== null);
  const neutralChannels = target.map((channel, index) => (channel < 55 ? index : null)).filter((index) => index !== null);
  return { target, keyedChannels, neutralChannels };
}

export function chooseChromaKey(primary = "#808080") {
  const value = HEX_COLOR.test(primary) ? primary : "#808080";
  const source = hexToRgb(value);
  const candidates = [[0, 255, 0], [255, 0, 255], [0, 255, 255]];
  const selected = candidates.sort((a, b) => {
    const distance = (color) => color.reduce((total, channel, index) => total + ((channel - source[index]) ** 2), 0);
    return distance(b) - distance(a);
  })[0];
  return `#${selected.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function buildGarmentPrompt(metadata = {}, chromaKey = "#00ff00") {
  const name = metadata.name || "clothing item";
  const category = metadata.part || "wardrobe item";
  const primary = metadata.color || "the exact visible color";
  const secondary = metadata.secondaryColor ? ` with distinct secondary color ${metadata.secondaryColor}` : "";
  const details = Array.isArray(metadata.tags) && metadata.tags.length
    ? metadata.tags.join(", ")
    : "all visible construction and design details";

  return `Use case: background-extraction
Asset type: ecommerce catalog product cutout source

Input image: The reference photograph shows the exact garment, either by itself or worn by a person. Use it only to identify and reconstruct the garment.

Primary request: Reconstruct ONLY the complete empty ${name} (${category}) as a clean, front-facing ecommerce catalog product photograph. If a wearer is present, remove them. Remove every other garment, object, and background element. Show the complete item naturally arranged and symmetrical, with no person, body, mannequin, or hanger visible.

Garment fidelity: Preserve the reference garment's exact primary color ${primary}${secondary}, material and texture, silhouette, neckline, sleeves, fastenings, pattern, and distinctive details (${details}). Preserve any clearly legible existing graphic or logo exactly, but do not invent or reinterpret uncertain logos, text, pockets, seams, hardware, colors, or decoration.

Composition: Centered straight-on product view. Keep the entire garment inside the frame with generous, even padding on every side. No cropping or truncation.

Background: Perfectly flat, absolutely uniform solid ${chromaKey} chroma-key color, edge-to-edge. No shadows, gradient, texture, vignette, floor, horizon, reflection, or lighting variation.

Lighting: Neutral diffuse product lighting contained on the garment only.

Avoid: person, body, skin, hair, mannequin, hanger, props, other garments, retail tags, cast shadow, contact shadow, reflection, watermark, caption, border, background variation, or chroma spill.

Critical: Use no ${chromaKey} anywhere in the garment. Produce exactly one complete garment with a crisp, separable outer silhouette.`;
}

// Fixed category order keeps the prompt and image ordering coherent regardless of click
// order: top/outer first, then bottom, then accessories, then shoes. Ties keep selection order.
export function orderGarmentsForLook(garments) {
  return garments
    .map((garment, index) => ({ garment, index }))
    .sort((a, b) => (LOOK_CATEGORY_RANK[a.garment.part] ?? 4) - (LOOK_CATEGORY_RANK[b.garment.part] ?? 4) || a.index - b.index)
    .map((entry) => entry.garment);
}

export function buildLookPrompt(garments) {
  const referenceLines = garments.map((garment, index) => {
    const label = garment.name || CATEGORY_LABELS[garment.part]?.singular || "wardrobe item";
    return `Image ${index + 2}: exact ${label} reference. Preserve its exact color, material, fit, construction, pattern, graphics, and distinctive details.`;
  }).join("\n");
  const itemsPhrase = garments.length === 1
    ? `the exact ${garments[0].name || "garment"} from Image 2`
    : `all ${garments.length} exact referenced garments from Images 2-${garments.length + 1}, and only those garments`;

  return `Use case: identity-preserve
Asset type: square outfit gallery photograph

Image 1: identity reference for the exact person to preserve.
${referenceLines}

Primary request: Create a professional square editorial fashion photograph of the person from Image 1 wearing ${itemsPhrase}.

Subject: Preserve the same person's recognizable face, hair, age, build, skin texture, and body proportions. Dress them in the exact referenced garments. Plain understated shoes and invisible basics such as socks are allowed only where needed when no shoe reference is provided. Do not add, replace, or invent any other visible clothing or accessory.

Style/medium: Photorealistic natural editorial fashion campaign with authentic skin and fabric texture and no synthetic AI polish.

Composition/framing: Square 1:1 image. Show the complete person and outfit from head through shoes, centered, occupying most of the frame, relaxed and mostly front-facing with arms away from the torso so every item remains readable.

Lighting/mood: Warm professional natural light, realistic shadows, restrained editorial color grading.

Garment fidelity: Preserve every referenced garment precisely: color, material, fit, construction, pattern, graphics, logos, text, proportions, and distinctive details.

Avoid: hidden selected garments, invented zippers, buttons or closures, unnatural layering, extra layers, hats, bags, scarves, jewelry, visible unreferenced undershirts, crossed arms, hands blocking clothing, garment redesign, changed logos or text, cropped feet, extra people, text overlays, watermarks, studio cutout appearance, or synthetic AI polish.`;
}

export function slugifyOutfitId(name, existingIds) {
  const base = (name || "look").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "look";
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function outfitJobAssetFilenames(job) {
  return new Set([job?.stages?.look?.assetUrl].filter(Boolean).map(filenameFromUrl));
}

function cleanupTolerance(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(18, Math.min(110, Math.round(parsed))) : 46;
}

function removeKeyedSpill(data, index, keyedChannels, neutralLevel) {
  let remaining = Math.ceil(keyedChannels.reduce((total, channel) => total + data[index + channel], 0) - (neutralLevel * keyedChannels.length));
  let active = keyedChannels.filter((channel) => data[index + channel] > 0);
  while (remaining > 0 && active.length) {
    const share = Math.ceil(remaining / active.length);
    const next = [];
    for (const channel of active) {
      const reduction = Math.min(data[index + channel], share, remaining);
      data[index + channel] -= reduction;
      remaining -= reduction;
      if (data[index + channel] > 0) next.push(channel);
    }
    active = next;
  }
}

export async function processChromaBackground(bytes, key, options = {}) {
  const tolerance = cleanupTolerance(options.tolerance);
  const feather = 80;
  const { target, keyedChannels, neutralChannels } = chromaChannels(key);
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += 4) {
    const distance = Math.sqrt(
      ((data[index] - target[0]) ** 2)
      + ((data[index + 1] - target[1]) ** 2)
      + ((data[index + 2] - target[2]) ** 2),
    );
    if (distance <= tolerance) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
    } else {
      if (distance < tolerance + feather) data[index + 3] = Math.round(data[index + 3] * ((distance - tolerance) / feather));
      const keyedLevel = keyedChannels.reduce((total, channel) => total + data[index + channel], 0) / keyedChannels.length;
      const neutralLevel = neutralChannels.reduce((total, channel) => total + data[index + channel], 0) / neutralChannels.length;
      const spill = Math.max(0, keyedLevel - neutralLevel);
      if (spill > 0) {
        const spillAlpha = Math.max(0, 1 - (Math.max(0, spill - 4) / 150));
        data[index + 3] = Math.round(data[index + 3] * spillAlpha);
        removeKeyedSpill(data, index, keyedChannels, neutralLevel);
      }
      if (data[index + 3] <= 8) {
        data[index] = 0;
        data[index + 1] = 0;
        data[index + 2] = 0;
        data[index + 3] = 0;
      }
    }
  }
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const keyedLevel = keyedChannels.reduce((total, channel) => total + data[index + channel], 0) / keyedChannels.length;
    const neutralLevel = neutralChannels.reduce((total, channel) => total + data[index + channel], 0) / neutralChannels.length;
    const residualSpill = Math.max(0, keyedLevel - neutralLevel);
    if (residualSpill > 0) {
      removeKeyedSpill(data, index, keyedChannels, neutralLevel);
    }
  }
  const keyedOutput = await sharp(data, { raw: info }).png().toBuffer();
  const framedOutput = await frameTransparentGarment(keyedOutput);
  const { data: framedData, info: framedInfo } = await sharp(framedOutput).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < framedData.length; index += 4) {
    if (framedData[index + 3] === 0) continue;
    const keyedLevel = keyedChannels.reduce((total, channel) => total + framedData[index + channel], 0) / keyedChannels.length;
    const neutralLevel = neutralChannels.reduce((total, channel) => total + framedData[index + channel], 0) / neutralChannels.length;
    const residualSpill = Math.max(0, keyedLevel - neutralLevel);
    if (residualSpill <= 0) continue;
    removeKeyedSpill(framedData, index, keyedChannels, neutralLevel);
  }
  const output = await sharp(framedData, { raw: framedInfo }).png().toBuffer();
  const verification = await verifyNoChromaSpill(output, key);
  return { bytes: output, verification, tolerance };
}

export async function removeChromaBackground(bytes, key, options = {}) {
  const result = await processChromaBackground(bytes, key, options);
  if (options.strict !== false && result.verification.contaminatedPixels > 1) {
    throw new Error(`Background cleanup left ${result.verification.contaminatedPixels} chroma-contaminated pixels`);
  }
  return result.bytes;
}

export async function frameTransparentGarment(bytes, canvasSize = 1024, occupancy = 0.88) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    if (data[index + 3] <= 8) continue;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (maxX < minX || maxY < minY) throw new Error("Background removal did not leave a visible garment");

  const trimmed = await sharp(data, { raw: info })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer();
  const targetSize = Math.max(1, Math.round(canvasSize * Math.max(0.5, Math.min(0.96, occupancy))));
  const resized = await sharp(trimmed)
    .resize(targetSize, targetSize, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.floor((canvasSize - resized.info.width) / 2);
  const top = Math.floor((canvasSize - resized.info.height) / 2);
  return sharp({ create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized.data, left, top }])
    .png()
    .toBuffer();
}

async function verifyNoChromaSpill(bytes, key) {
  const { keyedChannels, neutralChannels } = chromaChannels(key);
  const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let contaminatedPixels = 0;
  let maxSpill = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const keyedLevel = keyedChannels.reduce((total, channel) => total + data[index + channel], 0) / keyedChannels.length;
    const neutralLevel = neutralChannels.reduce((total, channel) => total + data[index + channel], 0) / neutralChannels.length;
    const spill = Math.max(0, keyedLevel - neutralLevel);
    maxSpill = Math.max(maxSpill, spill);
    if (spill > 1.5) contaminatedPixels += 1;
  }
  return { contaminatedPixels, maxSpill };
}

async function atomicJson(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  try {
    await rename(tmp, file);
  } catch (error) {
    if (!["EBUSY", "EXDEV", "EPERM"].includes(error.code)) {
      await rm(tmp, { force: true });
      throw error;
    }
    await copyFile(tmp, file);
    await rm(tmp, { force: true });
  }
}

// Minimal USTAR reader/writer for the export/import backup. Good enough to round-trip
// through our own extractTarball (and opens fine in Finder/7zip/tar), without a dependency.
function tarHeader(name, size) {
  const buf = Buffer.alloc(512);
  buf.write(name.slice(0, 100), 0, "utf8");
  buf.write("0000644\0", 100, "ascii");
  buf.write("0000000\0", 108, "ascii");
  buf.write("0000000\0", 116, "ascii");
  buf.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "ascii");
  buf.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")}\0`, 136, "ascii");
  buf.write("        ", 148, "ascii");
  buf.write("0", 156, "ascii");
  buf.write("ustar\0", 257, "ascii");
  buf.write("00", 263, "ascii");
  let checksum = 0;
  for (const byte of buf) checksum += byte;
  buf.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return buf;
}

export function createTarball(files) {
  const parts = files.flatMap(({ name, data }) => {
    const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
    return [tarHeader(name, data.length), data, padding];
  });
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

export function extractTarball(buffer) {
  const files = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii"), 8) || 0;
    offset += 512;
    if (name) files.push({ name, data: buffer.subarray(offset, offset + size) });
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

function stageState() {
  return { status: "pending", decision: null, attempts: 0, assetUrl: null, failedAssetUrl: null, cleanupPreviewUrl: null, cleanupTolerance: 46, cleanupDiagnostics: null, error: null, prompt: null, updatedAt: null };
}

const RETRY_MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 30000;

export function nextRetryDelay({ status, retryAfterSeconds, attempt, maxRetries = RETRY_MAX_ATTEMPTS }) {
  if (attempt >= maxRetries) return null;
  if (status !== 429 && !(status >= 500 && status < 600)) return null;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) return retryAfterSeconds * 1000;
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** attempt));
}

async function withRetry(request) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await request();
    if (response.ok) return response;
    const delay = nextRetryDelay({ status: response.status, retryAfterSeconds: Number(response.headers.get("retry-after")), attempt });
    if (delay === null) return response;
    devLog(`OpenAI request failed (${response.status}), retrying in ${delay}ms (attempt ${attempt + 1})`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

async function openAIEdit({ key, baseUrl, model, prompt, images, size, background, quality }) {
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", prompt);
  form.set("size", size);
  form.set("quality", quality || "high");
  form.set("output_format", "png");
  if (background) form.set("background", background);
  for (const [index, image] of images.entries()) {
    const normalized = await normalizeImage(image.data);
    form.append("image[]", new Blob([normalized], { type: "image/png" }), image.name?.replace(/\.[^.]+$/, ".png") || `image-${index + 1}.png`);
  }
  const response = await withRetry(() => fetch(`${baseUrl}/images/edits`, {
    method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
  }));
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `OpenAI image request failed (${response.status})`);
  const encoded = result.data?.[0]?.b64_json;
  if (!encoded) throw new Error("OpenAI response did not contain image data");
  return Buffer.from(encoded, "base64");
}

async function openAIAnalyze({ key, baseUrl, model, image, mime }) {
  const response = await withRetry(() => fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content: [
        { type: "input_text", text: "Identify every distinct wearable clothing item visible in this image. A photo may show one isolated garment or a person wearing several items. Return one record per actual item that should enter a wardrobe. Ignore the person's body and non-wearable background objects. For each item, include a tight bounding box around only that item using integer coordinates normalized to a 1000 by 1000 image: x and y are the top-left corner, followed by width and height. Boxes may overlap when garments overlap, but each box must focus on one distinct item. Use only these category ids: upperbody, wholebody_up, lowerbody, accessories_up, shoes. Suggest a concise specific name, primary hex color, optional genuinely distinct secondary hex color, and 1-4 useful lowercase detail tags." },
        { type: "input_image", image_url: `data:${mime};base64,${image.toString("base64")}` },
      ] }],
      text: { format: { type: "json_schema", name: "wardrobe_items", strict: true, schema: { type: "object", additionalProperties: false, properties: { items: { type: "array", minItems: 0, maxItems: 8, items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, part: { type: "string", enum: ["upperbody", "wholebody_up", "lowerbody", "accessories_up", "shoes"] }, color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, secondaryColor: { anyOf: [{ type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, { type: "null" }] }, tags: { type: "array", items: { type: "string" }, maxItems: 4 }, boundingBox: { type: "object", additionalProperties: false, properties: { x: { type: "integer", minimum: 0, maximum: 999 }, y: { type: "integer", minimum: 0, maximum: 999 }, width: { type: "integer", minimum: 1, maximum: 1000 }, height: { type: "integer", minimum: 1, maximum: 1000 } }, required: ["x", "y", "width", "height"] } }, required: ["name", "part", "color", "secondaryColor", "tags", "boundingBox"] } } }, required: ["items"] } } },
    }),
  }));
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `OpenAI analysis failed (${response.status})`);
  const outputText = result.output_text || result.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("OpenAI analysis returned no structured result");
  const parsed = JSON.parse(outputText);
  if (!Array.isArray(parsed.items)) throw new Error("OpenAI analysis returned an invalid clothing list");
  return parsed.items;
}

// Shared across createWardrobeHandler() and initialize(): both entry points (the Vite
// dev plugin and the standalone server) configure this module once per process with the
// same { env, root }, so a module-level singleton is simpler than threading a context object.
const running = new Map();
const DEFAULT_GENERATION_CONCURRENCY = 3;
const generationQueue = [];
let activeGenerations = 0;
let env;
let root;
let jobsDir;
let importedFile;
let libraryAssetDir;
let jobCountFile;
let cacheDir;
let outfitsFile;
let outfitAssetDir;
let outfitJobsDir;
let promptOverrides = {};

function configure({ env: nextEnv, root: nextRoot, garmentPrompt }) {
  env = nextEnv;
  root = nextRoot;
  promptOverrides = { garmentPrompt };
  const dataDir = path.resolve(root, setting("WARDROBE_DATA_DIR", "data"));
  jobsDir = path.join(dataDir, "jobs");
  importedFile = path.join(dataDir, "library.json");
  jobCountFile = path.join(dataDir, "job-count.json");
  libraryAssetDir = path.join(dataDir, "imported");
  outfitsFile = path.join(dataDir, "outfits.json");
  outfitAssetDir = path.join(dataDir, "outfit-images");
  outfitJobsDir = path.join(dataDir, "outfit-jobs");
  cacheDir = path.join(dataDir, "cache");
}

function setting(name, fallback = "") {
  return env?.[name] || process.env[name] || fallback;
}

function apiBaseUrl() {
  return setting("OPENAI_API_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, "");
}

async function setupStatus() {
  const hasApiKey = Boolean(setting("OPENAI_API_KEY").trim());
  const referenceSetting = setting("WARDROBE_MODEL_REFERENCE", "data/model-reference.png");
  const referencePath = path.resolve(root, referenceSetting);
  let hasModelReference = false;
  try {
    hasModelReference = (await stat(referencePath)).isFile();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    ready: hasApiKey,
    hasApiKey,
    hasModelReference,
    modelReference: referenceSetting,
  };
}

async function loadJob(id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  try { return JSON.parse(await readFile(path.join(jobsDir, id, "job.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function saveJob(job) {
  job.updatedAt = new Date().toISOString();
  await atomicJson(path.join(jobsDir, job.id, "job.json"), job);
}

async function loadOutfitJob(id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  try { return JSON.parse(await readFile(path.join(outfitJobsDir, id, "job.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function saveOutfitJob(job) {
  job.updatedAt = new Date().toISOString();
  await atomicJson(path.join(outfitJobsDir, job.id, "job.json"), job);
}

async function loadImported() {
  try { return JSON.parse(await readFile(importedFile, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function loadOutfitsRaw() {
  try {
    const parsed = JSON.parse(await readFile(outfitsFile, "utf8"));
    return { version: 1, ...parsed, outfits: Array.isArray(parsed?.outfits) ? parsed.outfits : [] };
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, outfits: [] };
    throw error;
  }
}

async function loadOutfits() {
  return (await loadOutfitsRaw()).outfits;
}

async function persistImported(job) {
  const id = `import-${job.id}`;
  await mkdir(libraryAssetDir, { recursive: true });
  const garmentName = `${id}-garment.png`;
  const garmentSource = job.stages.garment.assetUrl
    ? filenameFromUrl(job.stages.garment.assetUrl)
    : `garment-${job.stages.garment.attempts}.png`;
  await copyFile(path.join(jobsDir, job.id, garmentSource), path.join(libraryAssetDir, garmentName));
  const metadata = job.metadata || {};
  const records = await loadImported();
  const existing = records.find((record) => record.id === id);
  const record = {
    id,
    name: metadata.name || "New piece",
    part: metadata.part || "upperbody",
    color: metadata.color || "#d8d0c2",
    secondaryColor: metadata.secondaryColor || null,
    season: SEASON_IDS.has(metadata.season) ? metadata.season : null,
    palette: [metadata.color, metadata.secondaryColor].filter(Boolean),
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    image: `${LIBRARY_ASSET_ROOT}/${garmentName}`,
    modeledImage: existing?.modeledImage || null,
    importJobId: job.id,
    pricePaid: existing?.pricePaid ?? null,
    wears: existing?.wears ?? [],
  };
  const next = [...records.filter((item) => item.id !== id), record];
  await atomicJson(importedFile, next);
  return record;
}

export function nextQuotaState({ stored, today, limit }) {
  const count = stored?.date === today ? stored.count : 0;
  if (limit > 0 && count >= limit) return { allowed: false, date: today, count };
  return { allowed: true, date: today, count: count + 1 };
}

async function readJobCount() {
  try { return JSON.parse(await readFile(jobCountFile, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

let quotaChain = Promise.resolve();

function chargeQuota() {
  const limit = Number(setting("WARDROBE_DAILY_JOB_LIMIT"));
  if (!Number.isFinite(limit) || limit <= 0) return Promise.resolve();

  async function doCharge() {
    const stored = await readJobCount();
    const today = new Date().toISOString().slice(0, 10);
    const next = nextQuotaState({ stored, today, limit });
    if (!next.allowed) throw Object.assign(new Error(`Daily generation limit of ${limit} reached. Try again tomorrow or raise WARDROBE_DAILY_JOB_LIMIT.`), { status: 429 });
    await atomicJson(jobCountFile, { date: next.date, count: next.count });
  }

  // Chain serializes concurrent charges against the same counter file; .catch keeps the
  // chain alive after a rejection (a poisoned quota day should not block future callers).
  const attempt = quotaChain.then(doCharge, doCharge);
  quotaChain = attempt.catch(() => {});
  return attempt;
}

function generationConcurrencyLimit() {
  const limit = Number(setting("WARDROBE_GENERATION_CONCURRENCY"));
  return Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_GENERATION_CONCURRENCY;
}

// Bounds how many generate() bodies run at once, independent of the running Map above
// (which only dedups repeat calls for the same job+stage). FIFO queue, no dependency needed.
export function runQueued(task, limit = generationConcurrencyLimit()) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      activeGenerations += 1;
      task().then(resolve, reject).finally(() => {
        activeGenerations -= 1;
        const next = generationQueue.shift();
        if (next) next();
      });
    };
    if (activeGenerations < limit) attempt();
    else generationQueue.push(attempt);
  });
}

async function generate(job) {
  const lock = job.id;
  if (running.has(lock)) return running.get(lock);
  const task = runQueued(async () => {
    const current = await loadJob(job.id);
    const stage = current.stages.garment;
    stage.status = "processing"; stage.decision = null; stage.error = null; stage.attempts += 1; stage.updatedAt = new Date().toISOString();
    await saveJob(current);
    let failedAssetUrl = null;
    let chromaKeyUsed = null;
    try {
      const dir = path.join(jobsDir, current.id);
      const output = path.join(dir, `garment-${stage.attempts}.png`);
      const key = setting("OPENAI_API_KEY");
      if (!key) throw new Error("OPENAI_API_KEY is not configured");
      await chargeQuota();
      const sourceFile = current.internal.cropFile || current.internal.originalFile;
      const original = { data: await readFile(path.join(dir, sourceFile)), mime: "image/png", name: sourceFile };
      chromaKeyUsed = chooseChromaKey(current.metadata.color);
      const basePrompt = promptOverrides.garmentPrompt || buildGarmentPrompt(current.metadata, chromaKeyUsed);
      let bytes = await openAIEdit({ key, baseUrl: apiBaseUrl(), model: setting("OPENAI_GARMENT_MODEL", setting("OPENAI_IMAGE_MODEL", "gpt-image-2")), quality: setting("OPENAI_IMAGE_QUALITY", "high"), size: "1024x1024", images: [original], prompt: current.stages.garment.prompt ? `${basePrompt}\nUser regeneration direction: ${current.stages.garment.prompt}` : basePrompt });
      const rawName = `garment-${stage.attempts}-source.png`;
      await writeFile(path.join(dir, rawName), bytes);
      failedAssetUrl = `${ASSET_ROOT}/${current.id}/${rawName}`;
      bytes = await removeChromaBackground(bytes, chromaKeyUsed);
      await writeFile(output, bytes);
      const fresh = await loadJob(current.id);
      fresh.stages.garment.status = "review";
      fresh.stages.garment.assetUrl = `${ASSET_ROOT}/${fresh.id}/${path.basename(output)}`;
      fresh.stages.garment.failedAssetUrl = null;
      fresh.stages.garment.cleanupPreviewUrl = null;
      fresh.stages.garment.cleanupDiagnostics = null;
      fresh.stages.garment.chromaKey = chromaKeyUsed;
      fresh.stages.garment.updatedAt = new Date().toISOString();
      await saveJob(fresh);
    } catch (error) {
      devLog("garment generation failed", current.id, error);
      const fresh = await loadJob(current.id);
      fresh.stages.garment.status = "failed"; fresh.stages.garment.error = error.message; fresh.stages.garment.updatedAt = new Date().toISOString();
      if (typeof failedAssetUrl === "string") fresh.stages.garment.failedAssetUrl = failedAssetUrl;
      if (chromaKeyUsed) fresh.stages.garment.chromaKey = chromaKeyUsed;
      await saveJob(fresh);
    }
  }).finally(() => running.delete(lock));
  running.set(lock, task);
  return task;
}

async function generateLook(job) {
  const lock = `outfit:${job.id}`;
  if (running.has(lock)) return running.get(lock);
  const task = runQueued(async () => {
    const current = await loadOutfitJob(job.id);
    const stage = current.stages.look;
    stage.status = "processing"; stage.decision = null; stage.error = null; stage.attempts += 1; stage.updatedAt = new Date().toISOString();
    await saveOutfitJob(current);
    try {
      const key = setting("OPENAI_API_KEY");
      if (!key) throw new Error("OPENAI_API_KEY is not configured");
      const modelPath = path.resolve(root, setting("WARDROBE_MODEL_REFERENCE", "data/model-reference.png"));
      let modelData;
      try {
        modelData = await readFile(modelPath);
      } catch (error) {
        if (error.code === "ENOENT") throw new Error(`Model reference not found at ${modelPath}. Set WARDROBE_MODEL_REFERENCE or add data/model-reference.png.`, { cause: error });
        throw error;
      }
      const model = { data: modelData, mime: "image/png", name: "model.png" };
      const records = await loadImported();
      const garments = current.garmentIds.map((id) => records.find((record) => record.id === id));
      if (garments.some((garment) => !garment)) throw new Error("One or more selected garments no longer exist");
      const garmentImages = await Promise.all(garments.map(async (garment) => ({
        data: await readFile(path.join(libraryAssetDir, filenameFromUrl(garment.image))),
        mime: "image/png",
        name: `${garment.id}.png`,
      })));
      await chargeQuota();
      const basePrompt = buildLookPrompt(garments);
      const rendered = await openAIEdit({
        key, baseUrl: apiBaseUrl(),
        model: setting("OPENAI_MODELED_MODEL", setting("OPENAI_IMAGE_MODEL", "gpt-image-2")),
        quality: setting("OPENAI_IMAGE_QUALITY", "high"),
        size: "1024x1024",
        images: [model, ...garmentImages],
        prompt: stage.prompt ? `${basePrompt}\nUser regeneration direction: ${stage.prompt}` : basePrompt,
      });
      const bytes = await sharp(rendered).webp({ quality: 82 }).toBuffer();
      const output = path.join(outfitJobsDir, current.id, `look-${stage.attempts}.webp`);
      await writeFile(output, bytes);
      const fresh = await loadOutfitJob(current.id);
      fresh.stages.look.status = "review";
      fresh.stages.look.assetUrl = `${OUTFIT_JOB_ASSET_ROOT}/${fresh.id}/${path.basename(output)}`;
      fresh.stages.look.updatedAt = new Date().toISOString();
      await saveOutfitJob(fresh);
    } catch (error) {
      devLog("look generation failed", current.id, error);
      const fresh = await loadOutfitJob(current.id);
      fresh.stages.look.status = "failed";
      fresh.stages.look.error = error.message;
      fresh.stages.look.updatedAt = new Date().toISOString();
      await saveOutfitJob(fresh);
    }
  }).finally(() => running.delete(lock));
  running.set(lock, task);
  return task;
}

async function persistOutfit(job) {
  await mkdir(outfitAssetDir, { recursive: true });
  const source = path.join(outfitJobsDir, job.id, filenameFromUrl(job.stages.look.assetUrl));
  const raw = await loadOutfitsRaw();
  const existingIds = new Set(raw.outfits.map((outfit) => outfit.id));
  const id = slugifyOutfitId(job.name, existingIds);
  const filename = `${id}.webp`;
  await copyFile(source, path.join(outfitAssetDir, filename));
  const record = {
    id,
    name: job.name || "New look",
    occasion: job.occasion || [],
    garmentIds: job.garmentIds,
    reason: null,
    setting: null,
    image: `${OUTFIT_ASSET_ROOT}/${filename}`,
    status: "accepted",
  };
  await atomicJson(outfitsFile, { ...raw, outfits: [...raw.outfits, record] });
  return record;
}

async function handler(req, res, next) {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith("/api/import/")) return next();
  if (isDev) {
    const startedAt = Date.now();
    const originalEnd = res.end.bind(res);
    res.end = (...args) => {
      devLog(`${req.method} ${url.pathname} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
      return originalEnd(...args);
    };
  }
  try {
    if (url.pathname === "/api/import/login" && req.method === "POST") {
      const token = setting("WARDROBE_ACCESS_TOKEN").trim();
      if (!token) return json(res, 200, { ok: true });
      const input = await body(req);
      const provided = typeof input.token === "string" ? input.token : "";
      if (!constantTimeEquals(provided, token)) return json(res, 401, { error: "Incorrect access token" });
      res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`);
      return json(res, 200, { ok: true });
    }
    if (!isAuthorized(req)) return json(res, 401, { error: "Authentication required" });
    if (url.pathname === "/api/import/wardrobe" && req.method === "GET") {
      return json(res, 200, await loadImported());
    }
    if (url.pathname === "/api/import/config" && req.method === "GET") {
      return json(res, 200, await setupStatus());
    }
    const wardrobeItemMatch = url.pathname.match(/^\/api\/import\/wardrobe\/(import-[a-f0-9-]{36})$/i);
    if (wardrobeItemMatch && req.method === "PATCH") {
      const id = wardrobeItemMatch[1];
      const records = await loadImported();
      const index = records.findIndex((record) => record.id === id);
      if (index === -1) return json(res, 404, { error: "Imported wardrobe item not found" });
      const input = await body(req);
      if (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata)) throw Object.assign(new Error("metadata must be an object"), { status: 400 });
      const normalized = normalizeMetadata({ ...records[index], ...input.metadata });
      const pricePaid = "pricePaid" in input ? normalizePricePaid(input.pricePaid) : (records[index].pricePaid ?? null);
      const updated = { ...records[index], name: normalized.name, part: normalized.part, color: normalized.color, secondaryColor: normalized.secondaryColor, season: normalized.season, tags: normalized.tags, pricePaid };
      const next = [...records];
      next[index] = updated;
      await atomicJson(importedFile, next);
      return json(res, 200, updated);
    }
    const wearsMatch = url.pathname.match(/^\/api\/import\/wardrobe\/(import-[a-f0-9-]{36})\/wears$/i);
    if (wearsMatch && (req.method === "POST" || req.method === "DELETE")) {
      const id = wearsMatch[1];
      const records = await loadImported();
      const index = records.findIndex((record) => record.id === id);
      if (index === -1) return json(res, 404, { error: "Imported wardrobe item not found" });
      const wears = req.method === "POST"
        ? [...(records[index].wears || []), new Date().toISOString()]
        : (records[index].wears || []).slice(0, -1);
      const updated = { ...records[index], wears };
      const next = [...records];
      next[index] = updated;
      await atomicJson(importedFile, next);
      return json(res, 200, updated);
    }
    if (url.pathname === "/api/import/export" && req.method === "GET") {
      const library = await readFile(importedFile).catch(() => Buffer.from("[]"));
      const assetNames = await readdir(libraryAssetDir).catch(() => []);
      const assets = await Promise.all(assetNames.map(async (name) => ({ name: `imported/${name}`, data: await readFile(path.join(libraryAssetDir, name)) })));
      const tarball = createTarball([{ name: "library.json", data: library }, ...assets]);
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Disposition", `attachment; filename="wardrobe-export-${new Date().toISOString().slice(0, 10)}.tar.gz"`);
      return res.end(gzipSync(tarball));
    }
    if (url.pathname === "/api/import/import" && req.method === "POST") {
      const raw = await rawBody(req);
      let files;
      try { files = extractTarball(gunzipSync(raw)); }
      catch { throw Object.assign(new Error("That file is not a valid wardrobe export"), { status: 400 }); }
      const libraryEntry = files.find((file) => file.name === "library.json");
      const incoming = libraryEntry ? JSON.parse(libraryEntry.data.toString("utf8")) : [];
      if (!Array.isArray(incoming)) throw Object.assign(new Error("That file is not a valid wardrobe export"), { status: 400 });
      const current = await loadImported();
      const merged = [...current];
      for (const record of incoming) {
        const index = merged.findIndex((existing) => existing.id === record.id);
        if (index === -1) merged.push(record);
        else merged[index] = record;
      }
      await atomicJson(importedFile, merged);
      await mkdir(libraryAssetDir, { recursive: true });
      await Promise.all(files.filter((file) => file.name.startsWith("imported/")).map((file) => writeFile(path.join(libraryAssetDir, path.basename(file.name)), file.data)));
      return json(res, 200, { imported: incoming.length, total: merged.length });
    }
    if (wardrobeItemMatch && req.method === "DELETE") {
      const id = wardrobeItemMatch[1];
      const records = await loadImported();
      const next = records.filter((record) => record.id !== id);
      if (next.length === records.length) return json(res, 404, { error: "Imported wardrobe item not found" });
      await atomicJson(importedFile, next);
      await removeLibraryAssets(id);
      return json(res, 200, { deleted: true, id });
    }
    const libraryAssetMatch = url.pathname.match(/^\/api\/import\/library\/([\w.-]+)$/i);
    if (libraryAssetMatch && req.method === "GET") {
      const known = libraryAssetFilenames(await loadImported());
      if (!known.has(libraryAssetMatch[1])) return json(res, 404, { error: "Not found" });
      const file = path.join(libraryAssetDir, libraryAssetMatch[1]);
      const width = resolveThumbnailWidth(url.searchParams.get("w"));
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      if (width) {
        res.setHeader("Content-Type", "image/webp");
        const cacheFile = path.join(cacheDir, "library", `${libraryAssetMatch[1]}-w${width}.webp`);
        return res.end(await cachedThumbnail(file, cacheFile, width));
      }
      res.setHeader("Content-Type", file.endsWith(".webp") ? "image/webp" : "image/png");
      return res.end(await readFile(file));
    }
    if (url.pathname === "/api/import/outfits" && req.method === "GET") {
      const outfits = await loadOutfits();
      return json(res, 200, outfits.map((outfit) => ({ ...outfit, image: outfit.image ? `${OUTFIT_ASSET_ROOT}/${filenameFromUrl(outfit.image)}` : null })));
    }
    const outfitAssetMatch = url.pathname.match(/^\/api\/import\/outfits\/([\w.-]+)$/i);
    if (outfitAssetMatch && req.method === "GET") {
      const known = outfitAssetFilenames(await loadOutfits());
      if (!known.has(outfitAssetMatch[1])) return json(res, 404, { error: "Not found" });
      const file = path.join(outfitAssetDir, outfitAssetMatch[1]);
      const width = resolveThumbnailWidth(url.searchParams.get("w"));
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      if (width) {
        res.setHeader("Content-Type", "image/webp");
        const cacheFile = path.join(cacheDir, "outfits", `${outfitAssetMatch[1]}-w${width}.webp`);
        return res.end(await cachedThumbnail(file, cacheFile, width));
      }
      res.setHeader("Content-Type", file.endsWith(".webp") ? "image/webp" : "image/png");
      return res.end(await readFile(file));
    }
    const assetMatch = url.pathname.match(/^\/api\/import\/assets\/([a-f0-9-]{36})\/([\w.-]+)$/i);
    if (assetMatch && req.method === "GET") {
      const assetJob = await loadJob(assetMatch[1]);
      if (!assetJob || !jobAssetFilenames(assetJob).has(assetMatch[2])) return json(res, 404, { error: "Not found" });
      const file = path.join(jobsDir, assetMatch[1], assetMatch[2]);
      const width = file.endsWith(".svg") ? null : resolveThumbnailWidth(url.searchParams.get("w"));
      res.setHeader("Cache-Control", "no-store");
      if (width) {
        res.setHeader("Content-Type", "image/webp");
        return res.end(await resizeToWebp(file, width));
      }
      res.setHeader("Content-Type", file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".webp") ? "image/webp" : "image/png");
      return res.end(await readFile(file));
    }
    const outfitJobAssetMatch = url.pathname.match(/^\/api\/import\/outfit-job-assets\/([a-f0-9-]{36})\/([\w.-]+)$/i);
    if (outfitJobAssetMatch && req.method === "GET") {
      const assetJob = await loadOutfitJob(outfitJobAssetMatch[1]);
      if (!assetJob || !outfitJobAssetFilenames(assetJob).has(outfitJobAssetMatch[2])) return json(res, 404, { error: "Not found" });
      const file = path.join(outfitJobsDir, outfitJobAssetMatch[1], outfitJobAssetMatch[2]);
      const width = resolveThumbnailWidth(url.searchParams.get("w"));
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "image/webp");
      return res.end(width ? await resizeToWebp(file, width) : await readFile(file));
    }
    if (url.pathname === OUTFIT_JOB_API && req.method === "POST") {
      const setup = await setupStatus();
      if (!setup.hasApiKey || !setup.hasModelReference) {
        const missing = [
          !setup.hasApiKey && "OPENAI_API_KEY in .env",
          !setup.hasModelReference && `a PNG photo of yourself at ${setup.modelReference}`,
        ].filter(Boolean).join(" and ");
        return json(res, 503, { error: `Setup required: add ${missing}, then restart the app.` });
      }
      const input = await body(req);
      const requestedIds = Array.isArray(input.garmentIds) ? input.garmentIds.filter((id) => typeof id === "string") : [];
      if (!requestedIds.length) throw Object.assign(new Error("Select at least one wardrobe item"), { status: 400 });
      if (requestedIds.length > MAX_LOOK_GARMENTS) throw Object.assign(new Error(`Select at most ${MAX_LOOK_GARMENTS} items for a single look`), { status: 400 });
      const records = await loadImported();
      const garments = requestedIds.map((id) => records.find((record) => record.id === id));
      const missingIndex = garments.findIndex((garment) => !garment);
      if (missingIndex !== -1) throw Object.assign(new Error(`Unknown wardrobe item: ${requestedIds[missingIndex]}`), { status: 400 });
      const id = randomUUID();
      await mkdir(path.join(outfitJobsDir, id), { recursive: true });
      const now = new Date().toISOString();
      const job = {
        id,
        garmentIds: orderGarmentsForLook(garments).map((garment) => garment.id),
        name: typeof input.name === "string" ? input.name.trim().slice(0, 120) || null : null,
        occasion: Array.isArray(input.occasion) ? input.occasion.filter((entry) => typeof entry === "string").slice(0, 6) : [],
        stages: { look: stageState() },
        createdAt: now, updatedAt: now,
      };
      await saveOutfitJob(job);
      void generateLook(job);
      return json(res, 202, job);
    }
    if (url.pathname === OUTFIT_JOB_API && req.method === "GET") {
      const ids = await readdir(outfitJobsDir).catch(() => []);
      const loadedJobs = (await Promise.all(ids.map((id) => loadOutfitJob(id)))).filter(Boolean);
      const rejected = loadedJobs.filter((job) => job.stages.look.status === "rejected");
      await Promise.all(rejected.map((job) => rm(path.join(outfitJobsDir, job.id), { recursive: true, force: true })));
      const jobs = loadedJobs.filter((job) => !rejected.includes(job)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return json(res, 200, jobs);
    }
    const outfitJobMatch = url.pathname.match(/^\/api\/import\/outfit-jobs\/([a-f0-9-]{36})(?:\/(.*))?$/i);
    if (outfitJobMatch) {
      const outfitJob = await loadOutfitJob(outfitJobMatch[1]);
      if (!outfitJob) return json(res, 404, { error: "Outfit job not found" });
      const jobAction = outfitJobMatch[2] || "";
      if (!jobAction && req.method === "GET") return json(res, 200, outfitJob);
      if (!jobAction && req.method === "DELETE") {
        await rm(path.join(outfitJobsDir, outfitJob.id), { recursive: true, force: true });
        return json(res, 200, { deleted: true, id: outfitJob.id });
      }
      const lookMatch = jobAction.match(/^stages\/look\/(approve|reject|regenerate)$/);
      if (lookMatch && req.method === "POST") {
        const decision = lookMatch[1];
        if (decision === "regenerate") {
          const input = await body(req);
          outfitJob.stages.look.prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 1200) || null : null;
          outfitJob.stages.look.status = "queued";
          outfitJob.stages.look.decision = null;
          await saveOutfitJob(outfitJob);
          void generateLook(outfitJob);
          return json(res, 202, outfitJob);
        }
        if (!DECISIONS.has(decision) || outfitJob.stages.look.status !== "review") throw Object.assign(new Error("Look is not ready for review"), { status: 409 });
        if (decision === "reject") {
          await rm(path.join(outfitJobsDir, outfitJob.id), { recursive: true, force: true });
          return json(res, 200, { deleted: true, id: outfitJob.id });
        }
        const record = await persistOutfit(outfitJob);
        await rm(path.join(outfitJobsDir, outfitJob.id), { recursive: true, force: true });
        return json(res, 200, { outfit: record });
      }
      return json(res, 404, { error: "Not found" });
    }
    if (url.pathname === API_ROOT && req.method === "POST") {
      const setup = await setupStatus();
      if (!setup.ready) {
        return json(res, 503, { error: "Setup required: add OPENAI_API_KEY in .env, then restart the app." });
      }
      const input = await body(req);
      const image = decodeImage(input);
      await chargeQuota();
      const [normalizedImage, forAnalysis] = await Promise.all([normalizeImage(image.data), analysisImage(image.data)]);
      const key = setting("OPENAI_API_KEY");
      const detected = (await openAIAnalyze({ key, baseUrl: apiBaseUrl(), model: setting("OPENAI_VISION_MODEL", "gpt-5.4-mini"), image: forAnalysis, mime: "image/jpeg" })).map(normalizeMetadata);
      const jobs = [];
      for (const metadata of detected) {
        const id = randomUUID();
        const dir = path.join(jobsDir, id); await mkdir(dir, { recursive: true });
        const originalFile = "original.png";
        const cropFile = "crop.png";
        const croppedImage = await cropDetectedItem(normalizedImage, metadata.boundingBox);
        await writeFile(path.join(dir, originalFile), normalizedImage);
        await writeFile(path.join(dir, cropFile), croppedImage);
        const now = new Date().toISOString();
        const cropStage = { ...stageState(), status: "review", assetUrl: `${ASSET_ROOT}/${id}/${cropFile}`, updatedAt: now };
        const job = { id, status: "active", metadata, stages: { crop: cropStage, garment: stageState() }, createdAt: now, updatedAt: now, internal: { originalFile, cropFile, originalMime: "image/png" } };
        job.originalAssetUrl = `${ASSET_ROOT}/${id}/${originalFile}`;
        await saveJob(job); jobs.push(publicJob(job));
      }
      return json(res, 202, { jobs, noClothingDetected: jobs.length === 0 });
    }
    if (url.pathname === API_ROOT && req.method === "GET") {
      const ids = await readdir(jobsDir).catch(() => []);
      const loadedJobs = (await Promise.all(ids.map((id) => loadJob(id)))).filter(Boolean);
      const hiddenJobs = loadedJobs.filter((job) => job.status === "complete" || job.stages.crop?.status === "rejected" || job.stages.garment.status === "rejected");
      await Promise.all(hiddenJobs.map((job) => rm(path.join(jobsDir, job.id), { recursive: true, force: true })));
      const jobs = loadedJobs.filter((job) => !hiddenJobs.includes(job)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return json(res, 200, jobs.map(publicJob));
    }
    const match = url.pathname.match(/^\/api\/import\/jobs\/([a-f0-9-]{36})(?:\/(.*))?$/i);
    if (!match) return json(res, 404, { error: "Not found" });
    const job = await loadJob(match[1]);
    if (!job) return json(res, 404, { error: "Job not found" });
    const action = match[2] || "";
    if (!action && req.method === "GET") return json(res, 200, publicJob(job));
    if (!action && req.method === "DELETE") {
      await rm(path.join(jobsDir, job.id), { recursive: true, force: true });
      return json(res, 200, { deleted: true, id: job.id });
    }
    if (action === "metadata" && (req.method === "PATCH" || req.method === "PUT")) {
      const input = await body(req);
      if (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata)) throw Object.assign(new Error("metadata must be an object"), { status: 400 });
      job.metadata = normalizeMetadata({ ...job.metadata, ...input.metadata }); await saveJob(job);
      return json(res, 200, publicJob(job));
    }
    const cleanupAction = action.match(/^stages\/garment\/(cleanup-preview|cleanup-accept)$/);
    if (cleanupAction && req.method === "POST") {
      const stage = job.stages.garment;
      if (stage.status !== "failed" || !stage.failedAssetUrl) {
        throw Object.assign(new Error("No failed garment source is available for cleanup"), { status: 409 });
      }
      const input = await body(req);
      const tolerance = cleanupTolerance(input.tolerance);
      const sourceName = path.basename(new URL(stage.failedAssetUrl, "http://localhost").pathname);
      const source = await readFile(path.join(jobsDir, job.id, sourceName));
      const key = stage.chromaKey || chooseChromaKey(job.metadata?.color);
      const cleaned = await processChromaBackground(source, key, { tolerance });
      const previewName = `garment-${stage.attempts}-cleanup-${tolerance}.png`;
      const previewUrl = `${ASSET_ROOT}/${job.id}/${previewName}`;
      await writeFile(path.join(jobsDir, job.id, previewName), cleaned.bytes);
      stage.chromaKey = key;
      stage.cleanupTolerance = cleaned.tolerance;
      stage.cleanupDiagnostics = cleaned.verification;
      stage.cleanupPreviewUrl = previewUrl;
      stage.updatedAt = new Date().toISOString();
      if (cleanupAction[1] === "cleanup-accept") {
        stage.status = "review";
        stage.decision = null;
        stage.error = null;
        stage.assetUrl = previewUrl;
      }
      await saveJob(job);
      return json(res, 200, publicJob(job));
    }
    const stageMatch = action.match(/^stages\/(crop|garment)\/(approve|reject|regenerate)$/);
    if (stageMatch && req.method === "POST") {
      const [, stageName, decision] = stageMatch;
      if (!STAGES.has(stageName)) throw Object.assign(new Error("Invalid stage"), { status: 400 });
      if (decision === "regenerate") {
        if (stageName === "crop") throw Object.assign(new Error("Upload the image again to create new crops"), { status: 400 });
        const input = await body(req);
        job.stages[stageName].prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 1200) || null : null;
        job.stages[stageName].status = "queued";
        job.stages[stageName].decision = null;
        await saveJob(job);
        void generate(job);
        return json(res, 202, publicJob(job));
      }
      if (!DECISIONS.has(decision) || job.stages[stageName].status !== "review") throw Object.assign(new Error("Stage is not ready for review"), { status: 409 });
      const previousStatus = job.stages[stageName].status;
      const previousDecision = job.stages[stageName].decision;
      const previousJobStatus = job.status;
      job.stages[stageName].decision = decision === "approve" ? "approved" : "rejected";
      job.stages[stageName].status = job.stages[stageName].decision;
      job.stages[stageName].error = null;
      job.stages[stageName].updatedAt = new Date().toISOString();
      const startGarment = stageName === "crop" && decision === "approve" && job.stages.garment.status === "pending";
      if (stageName === "garment" && decision === "approve") job.status = "complete";
      await saveJob(job);
      if (decision === "approve" && stageName !== "crop") {
        try {
          await persistImported(job);
        } catch (error) {
          job.stages[stageName].status = previousStatus;
          job.stages[stageName].decision = previousDecision;
          job.status = previousJobStatus;
          await saveJob(job);
          throw error;
        }
      }
      if (decision === "reject") await rm(path.join(jobsDir, job.id), { recursive: true, force: true });
      if (startGarment) void generate(job);
      const response = publicJob(job);
      if (job.status === "complete") await rm(path.join(jobsDir, job.id), { recursive: true, force: true });
      return json(res, 200, response);
    }
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    const statusCode = error.code === "ENOENT" ? 404 : error.status || 500;
    return json(res, statusCode, { error: statusCode === 500 ? "Internal server error" : error.message, ...(process.env.NODE_ENV === "development" && statusCode === 500 ? { detail: error.message } : {}) });
  }
}

export function createWardrobeHandler(context) {
  configure(context);
  return handler;
}

let initialized = false;

export async function initialize(context) {
  configure(context);
  if (initialized) return;
  initialized = true;
  await mkdir(jobsDir, { recursive: true });
  await mkdir(libraryAssetDir, { recursive: true });
  await mkdir(outfitJobsDir, { recursive: true });
  const ids = await readdir(jobsDir).catch(() => []);
  for (const id of ids) {
    const job = await loadJob(id);
    if (!job) continue;
    if (job.status === "complete") {
      try {
        await persistImported(job);
        await rm(path.join(jobsDir, job.id), { recursive: true, force: true });
      } catch (error) {
        console.error(`Failed to finalize completed import job ${job.id}:`, error);
        job.status = "active";
        job.stages.garment.status = "review";
        job.stages.garment.decision = null;
        job.stages.garment.error = null;
        await saveJob(job);
      }
      continue;
    }
    if (job.stages.crop?.status === "rejected" || job.stages.garment.status === "rejected") {
      await rm(path.join(jobsDir, job.id), { recursive: true, force: true });
      continue;
    }
    if (job.stages.crop && job.stages.crop.status !== "approved") continue;
    if (["processing", "queued"].includes(job.stages.garment.status)) {
      job.stages.garment.status = "pending";
      await saveJob(job);
      void generate(job);
    }
  }
  const outfitIds = await readdir(outfitJobsDir).catch(() => []);
  for (const id of outfitIds) {
    const job = await loadOutfitJob(id);
    if (!job) continue;
    if (job.stages.look.status === "rejected") {
      await rm(path.join(outfitJobsDir, job.id), { recursive: true, force: true });
      continue;
    }
    if (["processing", "queued"].includes(job.stages.look.status)) {
      job.stages.look.status = "pending";
      await saveOutfitJob(job);
      void generateLook(job);
    }
  }
}
