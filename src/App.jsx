import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Trash, X } from "@phosphor-icons/react";
import { WardrobeImportFlow } from "./import-flow.jsx";
import { OutfitBuilder } from "./outfit-flow.jsx";
import { ProfileView } from "./profile-flow.jsx";
import { OptimizedImage } from "./OptimizedImage.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import { CATEGORIES, SEASONS } from "./shared/categories.mjs";
import { wardrobeGaps } from "./shared/wardrobe-insights.mjs";
import { suggestOutfitsForWeather, weatherBucket } from "./shared/weather.mjs";

const TYPES = [{ id: "all", label: "All" }, ...CATEGORIES];

const TYPE_MAP = Object.fromEntries(TYPES.map((type) => [type.id, type]));
const TYPE_ORDER = Object.fromEntries(TYPES.slice(1).map((type, index) => [type.id, index]));

const SEASON_FILTERS = [{ id: "all", label: "All" }, ...SEASONS, { id: "unsorted", label: "Unsorted" }];

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex) {
  const value = (hex || "").replace("#", "");
  return {
    red: Number.parseInt(value.slice(0, 2), 16) || 0,
    green: Number.parseInt(value.slice(2, 4), 16) || 0,
    blue: Number.parseInt(value.slice(4, 6), 16) || 0,
  };
}

const COLOR_MATCH_THRESHOLD = 60;

function colorDistance(first, second) {
  return Math.sqrt(
    ((first.red - second.red) ** 2)
    + ((first.green - second.green) ** 2)
    + ((first.blue - second.blue) ** 2),
  );
}

function extractPalette(image) {
  const canvas = document.createElement("canvas");
  canvas.width = 72;
  canvas.height = 72;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const buckets = new Map();

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 72) continue;

    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const key = `${Math.round(red / 28)}-${Math.round(green / 28)}-${Math.round(blue / 28)}`;
    const current = buckets.get(key) || { red: 0, green: 0, blue: 0, count: 0 };
    current.red += red;
    current.green += green;
    current.blue += blue;
    current.count += 1;
    buckets.set(key, current);
  }

  const ranked = [...buckets.values()]
    .map((bucket) => ({
      red: Math.round(bucket.red / bucket.count),
      green: Math.round(bucket.green / bucket.count),
      blue: Math.round(bucket.blue / bucket.count),
      count: bucket.count,
    }))
    .sort((a, b) => b.count - a.count);

  const selected = [];
  for (const color of ranked) {
    if (selected.every((existing) => colorDistance(existing, color) > 38)) selected.push(color);
    if (selected.length === 5) break;
  }

  return selected.map((color) => rgbToHex(color.red, color.green, color.blue));
}

function buildSamplingCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
  return canvas;
}

function sampleImageColor(image, canvas, event) {
  const bounds = image.getBoundingClientRect();
  const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  const offsetX = (bounds.width - renderedWidth) / 2;
  const offsetY = (bounds.height - renderedHeight) / 2;
  const imageX = Math.floor((event.clientX - bounds.left - offsetX) / scale);
  const imageY = Math.floor((event.clientY - bounds.top - offsetY) / scale);

  if (imageX < 0 || imageY < 0 || imageX >= canvas.width || imageY >= canvas.height) return null;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  for (let radius = 0; radius <= 18; radius += 2) {
    const startX = Math.max(0, imageX - radius);
    const startY = Math.max(0, imageY - radius);
    const width = Math.min(canvas.width - startX, (radius * 2) + 1);
    const height = Math.min(canvas.height - startY, (radius * 2) + 1);
    const data = context.getImageData(startX, startY, width, height).data;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 96) return rgbToHex(data[index], data[index + 1], data[index + 2]);
    }
  }

  return null;
}

function draftFromItem(item) {
  return {
    name: item.name || "",
    part: item.part,
    color: item.color || "#9a9286",
    secondaryColor: item.secondaryColor || null,
    season: item.season || null,
    tags: [...(item.tags || [])],
    pricePaid: item.pricePaid != null ? String(item.pricePaid) : "",
  };
}

function LoginGate({ children }) {
  const [status, setStatus] = useState("checking");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/import/wardrobe", { cache: "no-store" })
      .then((response) => setStatus(response.status === 401 ? "needed" : "ok"))
      .catch(() => setStatus("ok"));
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/import/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error("Incorrect access token.");
      setStatus("ok");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "checking") return null;

  if (status === "needed") {
    return (
      <div className="login-gate">
        <form className="login-form" onSubmit={submit}>
          <h1>Wardrobe</h1>
          <label className="field">
            <span>Access token</span>
            <input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoFocus autoComplete="current-password" />
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={submitting || !token}>Unlock</button>
        </form>
      </div>
    );
  }

  return children;
}

function GalleryItem({ item, selected, onOpen }) {
  const type = TYPE_MAP[item.part]?.singular || "wardrobe item";

  return (
    <button
      className={`gallery-item${selected ? " selected" : ""}`}
      type="button"
      onClick={() => onOpen(item.id)}
      aria-label={`View ${item.name || type}`}
      aria-pressed={selected}
      data-testid={`wardrobe-item-${item.id}`}
    >
      <OptimizedImage
        src={item.image}
        alt=""
        sizes="(max-width: 520px) calc(50vw - 16px), (max-width: 860px) calc(33vw - 18px), 180px"
        breakpoints={[120, 180, 240, 320, 480]}
      />
    </button>
  );
}

function TagEditor({ tags, onChange }) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const nextTag = input.trim().replace(/^#/, "");
    if (!nextTag || tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) return;
    onChange([...tags, nextTag]);
    setInput("");
  };

  return (
    <div className="tag-editor">
      <div className="editable-tags">
        {tags.map((tag) => (
          <span className="editable-tag" key={tag}>
            {tag}
            <button type="button" onClick={() => onChange(tags.filter((existing) => existing !== tag))} aria-label={`Remove ${tag}`}>
              <X size={12} weight="regular" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <div className="tag-input-row">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag();
            }
          }}
          placeholder="Add a detail"
          aria-label="Add detail tag"
        />
        <button type="button" onClick={addTag} disabled={!input.trim()} aria-label="Add detail">
          <Plus size={15} weight="regular" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ColorControl({ label, field, value, palette, onChange, sampling, setSampling, optional = false, onClear, onAdd }) {
  if (optional && !value) {
    return (
      <div className="color-slot empty-color-slot">
        <div className="color-slot-heading">
          <span>{label}</span>
          <small>Optional</small>
        </div>
        <p>No distinct secondary color detected.</p>
        <button className="add-secondary-button" type="button" onClick={onAdd}>Add secondary color</button>
      </div>
    );
  }

  return (
    <div className="color-slot">
      <div className="color-slot-heading">
        <span>{label}</span>
        {optional && <button type="button" onClick={onClear}>Remove</button>}
      </div>
      <label className="selected-color-control">
        <input
          type="color"
          value={value || "#9a9286"}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`Choose ${label.toLowerCase()}`}
        />
        <span className="selected-color-copy">
          <small>Selected</small>
          <strong>{value || "Custom"}</strong>
        </span>
      </label>
      <div className="suggestion-heading">
        <span>Image suggestions</span>
        <small>Click to apply</small>
      </div>
      <div className="palette" aria-label={`${label} suggestions from image`}>
        {palette.map((color) => (
          <button
            type="button"
            key={color}
            className={value?.toLowerCase() === color.toLowerCase() ? "active" : ""}
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
            aria-label={`Use ${color} as ${label.toLowerCase()}`}
            title={color}
          />
        ))}
      </div>
      <button
        className={`sample-button${sampling === field ? " active" : ""}`}
        type="button"
        onClick={() => setSampling((current) => current === field ? null : field)}
      >
        {sampling === field ? "Cancel picking" : `Pick ${label.toLowerCase()} from image`}
      </button>
    </div>
  );
}

function ItemEditor({ draft, setDraft, palette, sampling, setSampling, sampleStatus }) {
  const suggestedSecondary = palette.find((color) => color.toLowerCase() !== draft.color?.toLowerCase()) || "#9a9286";

  return (
    <div className="item-editor">
      <label className="field">
        <span>Name</span>
        <input
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          placeholder={TYPE_MAP[draft.part]?.singular || "Wardrobe item"}
        />
      </label>

      <label className="field">
        <span>Category</span>
        <select value={draft.part} onChange={(event) => setDraft((current) => ({ ...current, part: event.target.value }))}>
          {TYPES.slice(1).map((type) => <option value={type.id} key={type.id}>{type.label}</option>)}
        </select>
      </label>

      <label className="field">
        <span>Season</span>
        <select value={draft.season || ""} onChange={(event) => setDraft((current) => ({ ...current, season: event.target.value || null }))}>
          <option value="">Unsorted</option>
          {SEASONS.map((season) => <option value={season.id} key={season.id}>{season.label}</option>)}
        </select>
      </label>

      <label className="field">
        <span>Price paid</span>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={draft.pricePaid}
          onChange={(event) => setDraft((current) => ({ ...current, pricePaid: event.target.value }))}
          placeholder="0.00"
        />
      </label>

      <fieldset className="color-field">
        <legend>Colors</legend>
        <div className="colors-editor">
          <ColorControl
            label="Primary color"
            field="primary"
            value={draft.color}
            palette={palette}
            onChange={(color) => setDraft((current) => ({ ...current, color }))}
            sampling={sampling}
            setSampling={setSampling}
          />
          <ColorControl
            label="Secondary color"
            field="secondary"
            value={draft.secondaryColor}
            palette={palette}
            onChange={(secondaryColor) => setDraft((current) => ({ ...current, secondaryColor }))}
            sampling={sampling}
            setSampling={setSampling}
            optional
            onClear={() => setDraft((current) => ({ ...current, secondaryColor: null }))}
            onAdd={() => setDraft((current) => ({ ...current, secondaryColor: suggestedSecondary }))}
          />
        </div>
        <p className="color-help" aria-live="polite">{sampling ? `Click anywhere on the garment to sample the ${sampling} color.` : sampleStatus || "Primary colors come from the image. A secondary is suggested only when a distinct color has meaningful coverage."}</p>
      </fieldset>

      <div className="field details-field">
        <span>Details</span>
        <TagEditor tags={draft.tags} onChange={(tags) => setDraft((current) => ({ ...current, tags }))} />
      </div>
    </div>
  );
}

function WearTracker({ item, onLogWear, onUndoWear }) {
  const wears = item.wears || [];
  const lastWorn = wears.length ? new Date(wears[wears.length - 1]).toLocaleDateString() : "Never";
  const costPerWear = item.pricePaid && wears.length ? `$${(item.pricePaid / wears.length).toFixed(2)}` : "—";

  return (
    <div className="wear-tracker">
      <div className="wear-stats">
        <div className="wear-stat"><strong>{wears.length}</strong><span>{wears.length === 1 ? "wear" : "wears"}</span></div>
        <div className="wear-stat"><strong>{lastWorn}</strong><span>last worn</span></div>
        <div className="wear-stat"><strong>{costPerWear}</strong><span>cost per wear</span></div>
      </div>
      <div className="wear-actions">
        <button type="button" className="secondary-button" onClick={() => onLogWear(item.id)}>Log wear today</button>
        <button type="button" className="viewer-text-close wear-undo" onClick={() => onUndoWear(item.id)} disabled={!wears.length}>Undo last</button>
      </div>
    </div>
  );
}

function ItemViewer({ item, onClose, onSave, onDelete, onLogWear, onUndoWear }) {
  const closeButtonRef = useRef(null);
  const imageRef = useRef(null);
  const samplingCanvasRef = useRef(null);
  const shakeTimerRef = useRef(null);
  const [sampling, setSampling] = useState(null);
  const [sampleStatus, setSampleStatus] = useState("");
  const [palette, setPalette] = useState(item.palette || []);
  const [draft, setDraft] = useState(() => draftFromItem(item));
  const [shaking, setShaking] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const type = TYPE_MAP[item.part]?.singular || "Wardrobe item";

  const isDirty = useMemo(() => {
    const normalizedTags = (tags) => tags.map((tag) => tag.trim()).filter(Boolean);
    return JSON.stringify({
      name: draft.name.trim(),
      part: draft.part,
      color: draft.color?.toLowerCase() || null,
      secondaryColor: draft.secondaryColor?.toLowerCase() || null,
      season: draft.season || null,
      tags: normalizedTags(draft.tags),
      pricePaid: draft.pricePaid.trim(),
    }) !== JSON.stringify({
      name: (item.name || "").trim(),
      part: item.part,
      color: item.color?.toLowerCase() || null,
      secondaryColor: item.secondaryColor?.toLowerCase() || null,
      season: item.season || null,
      tags: normalizedTags(item.tags || []),
      pricePaid: item.pricePaid != null ? String(item.pricePaid) : "",
    });
  }, [draft, item]);

  const nudgeUnsaved = useCallback(() => {
    setCloseBlocked(true);
    setShaking(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setShaking(true));
    });
    clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => setShaking(false), 420);
  }, []);

  const requestClose = useCallback(() => {
    if (isDirty) nudgeUnsaved();
    else onClose();
  }, [isDirty, nudgeUnsaved, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        if (sampling) setSampling(null);
        else requestClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("viewer-open");
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("viewer-open");
      clearTimeout(shakeTimerRef.current);
    };
  }, [requestClose, sampling]);

  useEffect(() => {
    if (!isDirty) setCloseBlocked(false);
  }, [isDirty]);

  // Keyed on item.id, not item itself: a wear log/undo replaces the item object in place
  // (same id, new reference) and must not clobber an in-progress, unsaved edit draft.
  useEffect(() => {
    setSampling(null);
    setSampleStatus("");
    setPalette(item.palette || []);
    setDraft(draftFromItem(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const cancelEditing = () => {
    setDraft(draftFromItem(item));
    setSampling(null);
    setSampleStatus("");
    onClose();
  };

  const saveEditing = () => {
    onSave({ ...item, ...draft, name: draft.name.trim(), tags: draft.tags.map((tag) => tag.trim()).filter(Boolean) });
    setSampling(null);
    setSampleStatus("Changes saved.");
  };

  const handleImageLoad = (event) => {
    samplingCanvasRef.current = buildSamplingCanvas(event.currentTarget);
    const extracted = extractPalette(event.currentTarget);
    setPalette([...new Set([...(item.palette || []), ...extracted])].slice(0, 5));
  };

  const handleImageClick = (event) => {
    if (!sampling || !samplingCanvasRef.current) return;
    const color = sampleImageColor(event.currentTarget, samplingCanvasRef.current, event);
    if (!color) {
      setSampleStatus("That spot is transparent—try directly on the garment.");
      return;
    }
    const targetField = sampling === "secondary" ? "secondaryColor" : "color";
    setDraft((current) => ({ ...current, [targetField]: color }));
    setPalette((current) => [color, ...current.filter((existing) => existing.toLowerCase() !== color.toLowerCase())].slice(0, 5));
    setSampleStatus(`Sampled ${color} as the ${sampling} color.`);
    setSampling(null);
  };

  const garmentArtwork = (
    <div className={`viewer-art${sampling ? " sampling" : ""}`}>
      <OptimizedImage
        ref={imageRef}
        src={item.image}
        alt={`Selected ${type.toLowerCase()}`}
        sizes="(max-width: 520px) 40vw, 300px"
        breakpoints={[160, 240, 320, 480, 640]}
        priority
        onLoad={handleImageLoad}
        onClick={handleImageClick}
      />
      {sampling && <span className="sample-hint">Click garment to sample</span>}
    </div>
  );

  return (
    <div className="viewer-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
    <div className="viewer-entry">
    <aside className={`viewer editing${shaking ? " shake" : ""}`} role="dialog" aria-modal="true" aria-label="Selected wardrobe item">
      <button className="viewer-icon-close" type="button" onClick={requestClose} aria-label="Close viewer" ref={closeButtonRef}>
        <X size={24} weight="light" aria-hidden="true" />
      </button>

      <div className="viewer-heading">
        <div>
          <h2>{draft.name || TYPE_MAP[draft.part]?.singular}</h2>
        </div>
      </div>
      {garmentArtwork}

      <div className="viewer-details editing">
        <ItemEditor
          draft={draft}
          setDraft={setDraft}
          palette={palette}
          sampling={sampling}
          setSampling={setSampling}
          sampleStatus={sampleStatus}
        />

        <WearTracker item={item} onLogWear={onLogWear} onUndoWear={onUndoWear} />

        {closeBlocked && <p className="unsaved-notice" role="status">Save or cancel changes before closing.</p>}

        <div className="viewer-actions">
          <button className="delete-button" type="button" onClick={() => onDelete(item.id)}>
            <Trash size={15} weight="regular" aria-hidden="true" /> Delete
          </button>
          <span className="action-spacer" />
          <button className="secondary-button" type="button" onClick={cancelEditing}>Cancel</button>
          <button className="primary-button" type="button" onClick={saveEditing}>
            <Check size={15} weight="bold" aria-hidden="true" /> Save
          </button>
        </div>
      </div>
    </aside>
    </div>
    </div>
  );
}

function GapsPanel({ items }) {
  const { rows, notes } = useMemo(() => wardrobeGaps(items, CATEGORIES), [items]);

  return (
    <div className="gaps-panel">
      <table className="gaps-table">
        <thead><tr><th>Category</th><th>Light</th><th>Dark</th><th>Total</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}><td>{row.label}</td><td>{row.light}</td><td>{row.dark}</td><td>{row.total}</td></tr>
          ))}
        </tbody>
      </table>
      {notes.length
        ? <ul className="gaps-notes">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
        : <p className="gaps-notes-empty">No obvious gaps — nice balance.</p>}
    </div>
  );
}

function useWeather() {
  const [weather, setWeather] = useState(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setWeather("unavailable");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current=temperature_2m`;
          const response = await fetch(url);
          if (!response.ok) throw new Error("Weather lookup failed");
          const data = await response.json();
          const tempC = data?.current?.temperature_2m;
          setWeather({ tempC, bucket: weatherBucket(tempC) });
        } catch {
          setWeather("unavailable");
        }
      },
      () => setWeather("unavailable"),
      { timeout: 8000 },
    );
  }, []);

  return weather;
}

function OutfitCard({ outfit, itemsById }) {
  const garments = (outfit.garmentIds || []).map((id) => itemsById[id]).filter(Boolean);

  return (
    <article className="outfit-card">
      <div className="outfit-card-photo">
        <OptimizedImage
          src={outfit.image}
          alt={outfit.name || "Outfit"}
          sizes="(max-width: 860px) 50vw, 320px"
          breakpoints={[240, 320, 480, 640]}
        />
      </div>
      <div className="outfit-card-body">
        <h3>{outfit.name || "Untitled outfit"}</h3>
        {!!outfit.occasion?.length && <p className="outfit-card-occasion">{outfit.occasion.join(" · ")}</p>}
        {!!garments.length && (
          <div className="outfit-card-garments">
            {garments.map((item) => <img key={item.id} src={item.image} alt="" title={item.name} />)}
          </div>
        )}
      </div>
    </article>
  );
}

function OutfitsView({ items }) {
  const [outfits, setOutfits] = useState(null);
  const [error, setError] = useState("");
  const [weatherFilter, setWeatherFilter] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const weather = useWeather();

  useEffect(() => {
    fetch("/api/import/outfits", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load outfits.");
        return response.json();
      })
      .then(setOutfits)
      .catch((requestError) => setError(requestError.message));
  }, []);

  const itemsById = useMemo(() => Object.fromEntries(items.map((item) => [item.id, item])), [items]);

  const visibleOutfits = useMemo(() => {
    if (!outfits) return [];
    if (!weatherFilter || typeof weather !== "object" || !weather?.bucket) return outfits;
    return suggestOutfitsForWeather(outfits, itemsById, weather.bucket);
  }, [outfits, weatherFilter, weather, itemsById]);

  if (error) return <p className="status error">{error}</p>;
  if (outfits === null) return <p className="status">Loading outfits</p>;

  return (
    <>
      <div className="outfits-toolbar">
        <button type="button" className="secondary-button" onClick={() => setBuilderOpen(true)}>Create a look</button>
      </div>
      <OutfitBuilder
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        items={items}
        onCreated={(outfit) => setOutfits((current) => [outfit, ...(current || [])])}
      />
      {typeof weather === "object" && weather?.bucket && !!outfits.length && (
        <label className="weather-toggle">
          <input type="checkbox" checked={weatherFilter} onChange={(event) => setWeatherFilter(event.target.checked)} />
          <span>Suggested for today ({Math.round(weather.tempC)}°C, {weather.bucket})</span>
        </label>
      )}
      {outfits.length
        ? (
          <section className="outfits-grid" aria-label="Generated outfits">
            {visibleOutfits.map((outfit) => <OutfitCard key={outfit.id} outfit={outfit} itemsById={itemsById} />)}
          </section>
        )
        : <p className="status empty">No outfits yet. Create one above, or ask the generate-outfits Codex skill to curate some from your wardrobe.</p>}
    </>
  );
}

function Wardrobe() {
  const [items, setItems] = useState([]);
  const [view, setView] = useState("wardrobe");
  const [showGaps, setShowGaps] = useState(false);
  const [activeType, setActiveType] = useState("all");
  const [activeTags, setActiveTags] = useState([]);
  const [activeColor, setActiveColor] = useState(null);
  const [activeSeason, setActiveSeason] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef(null);

  useEffect(() => {
    fetch("/api/import/wardrobe", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the wardrobe.");
        return response.json();
      })
      .then(setItems)
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  const selectedItem = items.find((item) => item.id === selectedId) || null;

  const availableTags = useMemo(() => [...new Set(items.flatMap((item) => item.tags || []))].sort(), [items]);

  const visibleItems = useMemo(() => {
    let filtered = activeType === "all" ? items : items.filter((item) => item.part === activeType);
    if (activeTags.length) filtered = filtered.filter((item) => activeTags.every((tag) => (item.tags || []).includes(tag)));
    if (activeColor) {
      const target = hexToRgb(activeColor);
      filtered = filtered.filter((item) => [item.color, item.secondaryColor].filter(Boolean)
        .some((color) => colorDistance(hexToRgb(color), target) <= COLOR_MATCH_THRESHOLD));
    }
    if (activeSeason === "unsorted") filtered = filtered.filter((item) => !item.season);
    else if (activeSeason !== "all") filtered = filtered.filter((item) => item.season === activeSeason);
    return [...filtered].sort((a, b) => {
      if (activeType === "all") {
        const typeDifference = (TYPE_ORDER[a.part] ?? 99) - (TYPE_ORDER[b.part] ?? 99);
        if (typeDifference) return typeDifference;
      }
      return a.id.localeCompare(b.id);
    });
  }, [activeType, activeTags, activeColor, activeSeason, items]);

  const chooseType = (typeId) => {
    setActiveType(typeId);
    setSelectedId(null);
  };

  const toggleTag = (tag) => {
    setActiveTags((current) => current.includes(tag) ? current.filter((existing) => existing !== tag) : [...current, tag]);
  };

  const handleImportFile = async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const response = await fetch("/api/import/import", { method: "POST", body: file });
      if (!response.ok) throw new Error("Could not import that backup file.");
      const refreshed = await fetch("/api/import/wardrobe", { cache: "no-store" });
      setItems(await refreshed.json());
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setImporting(false);
    }
  };

  const saveItem = async (updatedItem) => {
    const previousItems = items;
    const pricePaid = updatedItem.pricePaid === "" || updatedItem.pricePaid == null ? null : Number(updatedItem.pricePaid);
    setItems((current) => current.map((item) => item.id === updatedItem.id ? { ...updatedItem, pricePaid } : item));
    try {
      const response = await fetch(`/api/import/wardrobe/${updatedItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { name: updatedItem.name, part: updatedItem.part, color: updatedItem.color, secondaryColor: updatedItem.secondaryColor, season: updatedItem.season, tags: updatedItem.tags },
          pricePaid,
        }),
      });
      if (!response.ok) throw new Error("Could not save changes.");
    } catch (requestError) {
      setItems(previousItems);
      setError(requestError.message);
    }
  };

  const logWear = async (id) => {
    try {
      const response = await fetch(`/api/import/wardrobe/${id}/wears`, { method: "POST" });
      if (!response.ok) throw new Error("Could not log wear.");
      const updated = await response.json();
      setItems((current) => current.map((item) => item.id === id ? updated : item));
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const undoWear = async (id) => {
    try {
      const response = await fetch(`/api/import/wardrobe/${id}/wears`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not undo wear.");
      const updated = await response.json();
      setItems((current) => current.map((item) => item.id === id ? updated : item));
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const deleteItem = async (id) => {
    try {
      const response = await fetch(`/api/import/wardrobe/${id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error("Could not delete the imported item.");
    } catch (requestError) {
      setError(requestError.message);
      return;
    }
    setItems((current) => current.filter((item) => item.id !== id));
    setSelectedId(null);
  };

  const addImportedItem = useCallback((newItem) => {
    setItems((current) => current.some((item) => item.id === newItem.id) ? current : [...current, newItem]);
  }, []);

  return (
    <div className={`app-shell${selectedItem && view === "wardrobe" ? " has-selection" : ""}`}>
      <main className="gallery-pane">
        <div className="view-tabs" role="tablist" aria-label="Wardrobe views">
          <button type="button" role="tab" aria-selected={view === "wardrobe"} className={view === "wardrobe" ? "active" : ""} onClick={() => setView("wardrobe")}>Wardrobe</button>
          <button type="button" role="tab" aria-selected={view === "outfits"} className={view === "outfits" ? "active" : ""} onClick={() => setView("outfits")}>Outfits</button>
          <button type="button" role="tab" aria-selected={view === "profile"} className={view === "profile" ? "active" : ""} onClick={() => setView("profile")}>Profile</button>
        </div>

        {view === "wardrobe" ? (
          <>
            <header className="gallery-header">
              <div className="gallery-meta-row">
                <p className="piece-count">{items.length} {items.length === 1 ? "piece" : "pieces"}</p>
                <div className="backup-actions">
                  <button type="button" className="secondary-button" onClick={() => setShowGaps((current) => !current)} aria-pressed={showGaps}>
                    {showGaps ? "Hide gaps" : "Show gaps"}
                  </button>
                  <a className="secondary-button" href="/api/import/export" download>Export backup</a>
                  <button type="button" className="secondary-button" onClick={() => importInputRef.current?.click()} disabled={importing}>
                    {importing ? "Importing…" : "Import backup"}
                  </button>
                  <input ref={importInputRef} type="file" accept=".gz,.tgz,application/gzip" hidden onChange={handleImportFile} />
                </div>
              </div>
              {showGaps && <GapsPanel items={items} />}
              <nav className="category-nav" aria-label="Filter wardrobe by item type">
                {TYPES.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    className={activeType === type.id ? "active" : ""}
                    onClick={() => chooseType(type.id)}
                    aria-pressed={activeType === type.id}
                  >
                    {type.label}
                  </button>
                ))}
              </nav>
              {!!items.length && (
                <div className="search-filters">
                  {!!availableTags.length && (
                    <div className="tag-filter" aria-label="Filter by detail tag">
                      {availableTags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          className={activeTags.includes(tag) ? "active" : ""}
                          onClick={() => toggleTag(tag)}
                          aria-pressed={activeTags.includes(tag)}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="color-filter">
                    <span>Color</span>
                    <input type="color" value={activeColor || "#9a9286"} onChange={(event) => setActiveColor(event.target.value)} aria-label="Filter by similar color" />
                    {activeColor && <button type="button" onClick={() => setActiveColor(null)}>Clear</button>}
                  </label>
                  <div className="tag-filter" aria-label="Filter by season">
                    {SEASON_FILTERS.map((season) => (
                      <button
                        key={season.id}
                        type="button"
                        className={activeSeason === season.id ? "active" : ""}
                        onClick={() => setActiveSeason(season.id)}
                        aria-pressed={activeSeason === season.id}
                      >
                        {season.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </header>

            {error && <p className="status error">{error}</p>}
            {!error && loading && <p className="status">Loading wardrobe</p>}
            {!error && !loading && !items.length && <p className="status empty">Drop, paste, or add a photo to import your first piece.</p>}
            {!error && !loading && !!items.length && !visibleItems.length && <p className="status empty">No items match these filters.</p>}

            {!!visibleItems.length && (
              <section className="gallery-grid" aria-label={`${TYPE_MAP[activeType]?.label || "All"} wardrobe items`}>
                {visibleItems.map((item) => (
                  <GalleryItem
                    key={item.id}
                    item={item}
                    selected={selectedId === item.id}
                    onOpen={setSelectedId}
                  />
                ))}
              </section>
            )}
          </>
        ) : view === "outfits" ? (
          <div className="outfits-pane">
            <OutfitsView items={items} />
          </div>
        ) : (
          <ProfileView />
        )}
      </main>

      {selectedItem && view === "wardrobe" && (
        <ErrorBoundary>
          <ItemViewer item={selectedItem} onClose={() => setSelectedId(null)} onSave={saveItem} onDelete={deleteItem} onLogWear={logWear} onUndoWear={undoWear} />
        </ErrorBoundary>
      )}
      <ErrorBoundary>
        <WardrobeImportFlow onGarmentApproved={addImportedItem} />
      </ErrorBoundary>
    </div>
  );
}

export function App() {
  return (
    <LoginGate>
      <Wardrobe />
    </LoginGate>
  );
}
