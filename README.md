<div align="center">

# Wardrobe

Your clothes, extracted and organized with gpt-image.

[![License: MIT](https://img.shields.io/badge/license-MIT-191919?style=flat-square)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-191919?style=flat-square)](package.json)

[See the original post →](https://x.com/cdngdev/status/2076812846793650485)

</div>

![Wardrobe gallery](docs/screenshots/gallery.png)

![Modeled wardrobe editor](docs/screenshots/editor.png)

## Quick start

```bash
git clone https://github.com/tandpfun/wardrobe.git
cd wardrobe
npm install
cp .env.example .env
npm run dev
```

⚠️ The importer stays disabled until you add `OPENAI_API_KEY` to `.env`. Generating a look in the **Outfits** tab also needs a PNG reference photo of yourself at `data/model-reference.png`.

Open [localhost:5173](http://localhost:5173).

## Import with Codex

This repo includes two Codex skills: one imports clothes and generates modeled item photos; the other styles complete outfits and generates a modeled lookbook.

```text
$import-clothes Import the clothes from ~/Pictures/outfits, create modeled photos, and add them to this wardrobe.
$generate-outfits Create modeled outfit ideas from my wardrobe.
```

Open the cloned repo in Codex and run either prompt. The import skill asks for a local model-reference PNG when needed, reviews every cutout, then writes to `data/library.json` and `data/imported/`. The outfit skill asks how many looks to create, then curates, generates, verifies, and saves the complete collection to `data/outfits.json` and `data/outfit-images/` — the app's **Outfits** tab reads that collection directly, so generated looks show up in the web UI once the skill finishes. You can also build a look yourself: select any pieces in the **Outfits** tab and generate a modeled photo of just that combination.

### For agents

If you are setting up Wardrobe for a user, ask how they want to import their clothes:

- **Codex:** Ask for a folder or camera-roll location and a model-reference PNG, then extract, model, and import the individual pieces by following [the bundled import skill](.agents/skills/import-clothes/SKILL.md). Afterward, offer to create a requested number of modeled looks with [the outfit-generation skill](.agents/skills/generate-outfits/SKILL.md).
- **Web UI:** Help the user configure their own `OPENAI_API_KEY`, then let them import through the app. Add `data/model-reference.png` too if they also want to generate looks in the **Outfits** tab.

## What it does

- Detects every garment in a photo with the OpenAI Responses API
- Extracts clean product cutouts with the OpenAI Images API
- Keeps originals, jobs, generated images, and the JSON database local in `data/`
- Supports drag, drop, paste, editing, review, regeneration, and approval
- Filters by detail tag and by similar color, and tracks wears and cost-per-wear
- Exports/imports the whole library as a single backup archive (see [Backup](#backup))
- **Outfits** tab: select any 1+ pieces and generate a modeled editorial photo of that look, or
  browse outfits curated by the `generate-outfits` Codex skill — both save to the same gallery,
  optionally filtered to looks suited to today's weather (via the browser's location and a free
  [Open-Meteo](https://open-meteo.com/) lookup — no API key)
- Surfaces simple wardrobe gaps (e.g. "no light bottoms") with the **Show gaps** panel

## Configuration

| Variable | Default |
| --- | --- |
| `OPENAI_API_KEY` | Required |
| `OPENAI_API_BASE_URL` | `https://api.openai.com/v1` |
| `OPENAI_VISION_MODEL` | `gpt-5.4-mini` |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` |
| `OPENAI_GARMENT_MODEL` | Falls back to `OPENAI_IMAGE_MODEL` |
| `OPENAI_MODELED_MODEL` | Falls back to `OPENAI_IMAGE_MODEL` |
| `OPENAI_IMAGE_QUALITY` | `high` |
| `WARDROBE_MODEL_REFERENCE` | `data/model-reference.png` |
| `WARDROBE_DATA_DIR` | `data` |
| `WARDROBE_ALLOWED_HOSTS` | None (comma-separated dev-server hostnames) |
| `WARDROBE_ACCESS_TOKEN` | None — see [Security](#security) |
| `WARDROBE_DAILY_JOB_LIMIT` | None (unlimited) |
| `WARDROBE_GENERATION_CONCURRENCY` | `3` |
| `PORT` | `4173` (production server only) |
| `HOST` | `127.0.0.1` (production server only; `0.0.0.0` inside Docker) |

## Backup

`data/` is gitignored and generated with real OpenAI spend, so it has no
built-in redundancy. Use **Export backup** in the gallery header to download
`library.json` plus every imported image as a single `.tar.gz`; **Import
backup** uploads one back and merges it into the current library by item id
(existing ids are overwritten, new ids are added — nothing is deleted).

## Security

Set `WARDROBE_ACCESS_TOKEN` to a long random string before exposing the app
beyond `localhost` (any Docker or `HOST=0.0.0.0` deployment). Without it,
`/api/import/*` is open to anyone who can reach the server, including the
ability to trigger paid OpenAI calls. With it set, the web UI prompts for the
token once and stores it in an httpOnly cookie; API clients can also send
`Authorization: Bearer <token>`.

`WARDROBE_DAILY_JOB_LIMIT` caps how many OpenAI image/vision calls the app
will make per UTC day (across new imports and regenerations) and returns 429
once reached, so a compromised token or a runaway client can't run up an
unbounded bill.

## Deploy

`npm run dev` only serves the API while the Vite dev server is running. For a
real deployment, build once and run the standalone server:

```bash
npm run build
npm start
```

This serves the built app and the live import API from a single `node:http`
process, binding to `127.0.0.1:4173` by default — set `HOST=0.0.0.0` to
accept connections from outside the machine (already set for you in Docker).

Or with Docker:

```bash
cp .env.example .env   # add OPENAI_API_KEY, then add data/model-reference.png
docker compose up --build
```

`data/` is bind-mounted from the host so jobs, the imported library, and
your model-reference photo persist across container restarts.

## License

[MIT](LICENSE)
