import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWardrobeHandler, initialize } from "./wardrobe-api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const distIndex = path.join(distDir, "index.html");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = path.join(distDir, pathname);
  if (!requestedPath.startsWith(distDir)) {
    res.statusCode = 400;
    return res.end("Bad request");
  }
  const candidate = pathname.endsWith("/") ? path.join(requestedPath, "index.html") : requestedPath;

  try {
    const data = await readFile(candidate);
    res.setHeader("Content-Type", MIME_TYPES[path.extname(candidate)] || "application/octet-stream");
    res.setHeader("Cache-Control", candidate === distIndex ? "no-cache" : "public, max-age=31536000, immutable");
    res.statusCode = 200;
    return res.end(data);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (req.method !== "GET") {
      res.statusCode = 404;
      return res.end("Not found");
    }
    // SPA fallback: let the client-side router handle unmatched navigations.
    const indexHtml = await readFile(distIndex);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.statusCode = 200;
    return res.end(indexHtml);
  }
}

const env = process.env;
const port = Number(env.PORT) || 4173;
const host = env.HOST || "127.0.0.1";

await initialize({ env, root });
const wardrobeHandler = createWardrobeHandler({ env, root });

const server = createServer(async (req, res) => {
  try {
    await wardrobeHandler(req, res, () => serveStatic(req, res));
  } catch (error) {
    console.error(`Unhandled error for ${req.method} ${req.url}:`, error);
    if (!res.headersSent) res.statusCode = 500;
    res.end("Internal server error");
  }
});

server.listen(port, host, () => {
  console.log(`Wardrobe listening on http://${host}:${port}`);
});
