import { useEffect, useState } from "react";
import { ArrowCounterClockwise, Check, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { OptimizedImage } from "./OptimizedImage.jsx";
import { apiRequest } from "./shared/api.mjs";
import "./outfit-flow.css";

const API = "/api/import/outfit-jobs";
const CONFIG_API = "/api/import/config";
const PROCESSING_STATUSES = ["queued", "pending", "processing"];

const api = (path, options) => apiRequest(path, options, "The look could not be updated.");

function LookPickerTile({ item, selected, onToggle }) {
  return (
    <button
      type="button"
      className={`look-picker-tile${selected ? " is-selected" : ""}`}
      onClick={() => onToggle(item.id)}
      aria-pressed={selected}
      aria-label={`${selected ? "Remove" : "Add"} ${item.name || "item"}`}
    >
      <OptimizedImage src={item.image} alt="" sizes="110px" breakpoints={[120, 180]} />
      <span className="look-picker-badge" aria-hidden="true"><Check size={12} weight="bold" /></span>
    </button>
  );
}

export function OutfitBuilder({ open, onClose, items, onCreated }) {
  const [setup, setSetup] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [name, setName] = useState("");
  const [job, setJob] = useState(null);
  const [regenPrompt, setRegenPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api(CONFIG_API).then(setSetup).catch((requestError) => setSetup({ ready: false, error: requestError.message }));
  }, []);

  useEffect(() => {
    if (!job || !PROCESSING_STATUSES.includes(job.stages.look.status)) return undefined;
    const timer = setInterval(async () => {
      try {
        setJob(await api(`${API}/${job.id}`));
      } catch (requestError) {
        setError(requestError.message);
      }
    }, 900);
    return () => clearInterval(timer);
  }, [job]);

  const reset = () => {
    setSelectedIds([]);
    setName("");
    setJob(null);
    setRegenPrompt("");
    setError("");
  };

  const close = () => {
    reset();
    onClose();
  };

  const toggleItem = (id) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id]);
  };

  const generate = async () => {
    setBusy(true); setError("");
    try {
      setJob(await api(API, { method: "POST", body: JSON.stringify({ garmentIds: selectedIds, name: name.trim() || undefined }) }));
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const regenerate = async () => {
    setBusy(true); setError("");
    try {
      setJob(await api(`${API}/${job.id}/stages/look/regenerate`, { method: "POST", body: JSON.stringify({ prompt: regenPrompt }) }));
      setRegenPrompt("");
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const reject = async () => {
    setBusy(true); setError("");
    try {
      await api(`${API}/${job.id}/stages/look/reject`, { method: "POST" });
      reset();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    setBusy(true); setError("");
    try {
      const result = await api(`${API}/${job.id}/stages/look/approve`, { method: "POST" });
      onCreated?.(result.outfit);
      close();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const setupRequired = setup && (!setup.hasApiKey || !setup.hasActiveReferenceImage);
  const status = job?.stages?.look?.status;
  const isProcessing = status && PROCESSING_STATUSES.includes(status);
  const isReview = status === "review";
  const isFailed = status === "failed";

  return (
    <div className="import-popover-backdrop" data-open={open} onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="import-popover" role="dialog" aria-modal="true" aria-labelledby="look-title">
        <header className="import-popover__header">
          <div>
            <p className="import-popover__eyebrow">Wardrobe outfits</p>
            <h2 className="import-popover__title" id="look-title">
              {isReview ? "Review this look" : isProcessing ? "Styling your look" : "Create a look"}
            </h2>
          </div>
          <button className="import-icon-button" type="button" onClick={close} aria-label="Close"><X size={20} /></button>
        </header>

        {!job && setupRequired ? (
          <div className="import-drop-target import-setup-warning">
            <WarningCircle size={30} />
            <h2>Setup required</h2>
            <p>Add your OpenAI API key to <code>.env</code> and a reference photo of yourself in the Profile tab.</p>
          </div>
        ) : !job ? (
          <>
            {items.length ? (
              <div className="look-picker-grid">
                {items.map((item) => (
                  <LookPickerTile key={item.id} item={item} selected={selectedIds.includes(item.id)} onToggle={toggleItem} />
                ))}
              </div>
            ) : <p className="import-card__detail">Import a few pieces first, then come back to style a look.</p>}
            {!!selectedIds.length && (
              <div className="look-chip-row">
                {selectedIds.map((id) => {
                  const item = items.find((entry) => entry.id === id);
                  if (!item) return null;
                  return (
                    <span className="look-chip" key={id}>
                      <img src={item.image} alt="" />
                      {item.name || "Item"}
                      <button type="button" onClick={() => toggleItem(id)} aria-label={`Remove ${item.name || "item"}`}><X size={11} /></button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="import-field">
              <label htmlFor="look-name">Name <span>optional</span></label>
              <input id="look-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Weekend errands" />
            </div>
            <div className="import-actions">
              <button className="import-button import-button--primary" disabled={busy || !selectedIds.length} onClick={generate}>
                <Check size={14} weight="bold" /> Generate look
              </button>
            </div>
          </>
        ) : isProcessing ? (
          <div className="import-progress is-indeterminate">
            <div className="import-progress__meta"><span>Styling your look</span></div>
            <div className="import-progress__track"><div className="import-progress__bar" /></div>
          </div>
        ) : isReview ? (
          <div className="import-editor">
            <img className="import-editor__preview" src={job.stages.look.assetUrl} alt="Generated look" />
            <div className="import-fields">
              <p className="import-editor__stage">Look ready</p>
              <p className="import-card__detail">Approve this look to add it to your Outfits gallery, or regenerate it with a more specific direction.</p>
              <div className="import-field import-regenerate-field">
                <label htmlFor="look-regen">Regeneration direction <span>optional</span></label>
                <textarea id="look-regen" rows="3" value={regenPrompt} onChange={(event) => setRegenPrompt(event.target.value)} placeholder="Example: use a quiet evening street" />
              </div>
              <div className="import-actions">
                <button className="import-button" disabled={busy} onClick={reject}><Trash size={14} /> Reject</button>
                <button className="import-button" disabled={busy} onClick={regenerate}><ArrowCounterClockwise size={14} /> Regenerate</button>
                <button className="import-button import-button--primary" disabled={busy} onClick={approve}><Check size={14} weight="bold" /> Approve</button>
              </div>
            </div>
          </div>
        ) : isFailed ? (
          <div className="import-drop-target import-setup-warning">
            <WarningCircle size={30} />
            <h2>That didn't work</h2>
            <p>{job.stages.look.error}</p>
            <div className="import-actions">
              <button className="import-button" disabled={busy} onClick={reject}><Trash size={14} /> Discard</button>
              <button className="import-button import-button--primary" disabled={busy} onClick={regenerate}><ArrowCounterClockwise size={14} /> Retry</button>
            </div>
          </div>
        ) : null}

        {error && <p className="import-status is-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
import { useEffect, useState } from "react";
import { ArrowCounterClockwise, Check, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { OptimizedImage } from "./OptimizedImage.jsx";
import { apiRequest } from "./shared/api.mjs";
import "./outfit-flow.css";

const API = "/api/import/outfit-jobs";
const CONFIG_API = "/api/import/config";
const PROCESSING_STATUSES = ["queued", "pending", "processing"];

const api = (path, options) => apiRequest(path, options, "The look could not be updated.");

function LookPickerTile({ item, selected, onToggle }) {
  return (
    <button
      type="button"
      className={`look-picker-tile${selected ? " is-selected" : ""}`}
      onClick={() => onToggle(item.id)}
      aria-pressed={selected}
      aria-label={`${selected ? "Remove" : "Add"} ${item.name || "item"}`}
    >
      <OptimizedImage src={item.image} alt="" sizes="110px" breakpoints={[120, 180]} />
      <span className="look-picker-badge" aria-hidden="true"><Check size={12} weight="bold" /></span>
    </button>
  );
}

export function OutfitBuilder({ open, onClose, items, onCreated }) {
  const [setup, setSetup] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [name, setName] = useState("");
  const [job, setJob] = useState(null);
  const [regenPrompt, setRegenPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api(CONFIG_API).then(setSetup).catch((requestError) => setSetup({ ready: false, error: requestError.message }));
  }, []);

  useEffect(() => {
    if (!job || !PROCESSING_STATUSES.includes(job.stages.look.status)) return undefined;
    const timer = setInterval(async () => {
      try {
        setJob(await api(`${API}/${job.id}`));
      } catch (requestError) {
        setError(requestError.message);
      }
    }, 900);
    return () => clearInterval(timer);
  }, [job]);

  const reset = () => {
    setSelectedIds([]);
    setName("");
    setJob(null);
    setRegenPrompt("");
    setError("");
  };

  const close = () => {
    reset();
    onClose();
  };

  const toggleItem = (id) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id]);
  };

  const generate = async () => {
    setBusy(true); setError("");
    try {
      setJob(await api(API, { method: "POST", body: JSON.stringify({ garmentIds: selectedIds, name: name.trim() || undefined }) }));
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const regenerate = async () => {
    setBusy(true); setError("");
    try {
      setJob(await api(`${API}/${job.id}/stages/look/regenerate`, { method: "POST", body: JSON.stringify({ prompt: regenPrompt }) }));
      setRegenPrompt("");
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const reject = async () => {
    setBusy(true); setError("");
    try {
      await api(`${API}/${job.id}/stages/look/reject`, { method: "POST" });
      reset();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    setBusy(true); setError("");
    try {
      const result = await api(`${API}/${job.id}/stages/look/approve`, { method: "POST" });
      onCreated?.(result.outfit);
      close();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const setupRequired = setup && (!setup.hasApiKey || !setup.hasModelReference);
  const status = job?.stages?.look?.status;
  const isProcessing = status && PROCESSING_STATUSES.includes(status);
  const isReview = status === "review";
  const isFailed = status === "failed";

  return (
    <div className="import-popover-backdrop" data-open={open} onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="import-popover" role="dialog" aria-modal="true" aria-labelledby="look-title">
        <header className="import-popover__header">
          <div>
            <p className="import-popover__eyebrow">Wardrobe outfits</p>
            <h2 className="import-popover__title" id="look-title">
              {isReview ? "Review this look" : isProcessing ? "Styling your look" : "Create a look"}
            </h2>
          </div>
          <button className="import-icon-button" type="button" onClick={close} aria-label="Close"><X size={20} /></button>
        </header>

        {!job && setupRequired ? (
          <div className="import-drop-target import-setup-warning">
            <WarningCircle size={30} />
            <h2>Setup required</h2>
            <p>Add your OpenAI API key to <code>.env</code> and a PNG reference photo of yourself at <code>{setup.modelReference || "data/model-reference.png"}</code>, then restart the app.</p>
          </div>
        ) : !job ? (
          <>
            {items.length ? (
              <div className="look-picker-grid">
                {items.map((item) => (
                  <LookPickerTile key={item.id} item={item} selected={selectedIds.includes(item.id)} onToggle={toggleItem} />
                ))}
              </div>
            ) : <p className="import-card__detail">Import a few pieces first, then come back to style a look.</p>}
            {!!selectedIds.length && (
              <div className="look-chip-row">
                {selectedIds.map((id) => {
                  const item = items.find((entry) => entry.id === id);
                  if (!item) return null;
                  return (
                    <span className="look-chip" key={id}>
                      <img src={item.image} alt="" />
                      {item.name || "Item"}
                      <button type="button" onClick={() => toggleItem(id)} aria-label={`Remove ${item.name || "item"}`}><X size={11} /></button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="import-field">
              <label htmlFor="look-name">Name <span>optional</span></label>
              <input id="look-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Weekend errands" />
            </div>
            <div className="import-actions">
              <button className="import-button import-button--primary" disabled={busy || !selectedIds.length} onClick={generate}>
                <Check size={14} weight="bold" /> Generate look
              </button>
            </div>
          </>
        ) : isProcessing ? (
          <div className="import-progress is-indeterminate">
            <div className="import-progress__meta"><span>Styling your look</span></div>
            <div className="import-progress__track"><div className="import-progress__bar" /></div>
          </div>
        ) : isReview ? (
          <div className="import-editor">
            <img className="import-editor__preview" src={job.stages.look.assetUrl} alt="Generated look" />
            <div className="import-fields">
              <p className="import-editor__stage">Look ready</p>
              <p className="import-card__detail">Approve this look to add it to your Outfits gallery, or regenerate it with a more specific direction.</p>
              <div className="import-field import-regenerate-field">
                <label htmlFor="look-regen">Regeneration direction <span>optional</span></label>
                <textarea id="look-regen" rows="3" value={regenPrompt} onChange={(event) => setRegenPrompt(event.target.value)} placeholder="Example: use a quiet evening street" />
              </div>
              <div className="import-actions">
                <button className="import-button" disabled={busy} onClick={reject}><Trash size={14} /> Reject</button>
                <button className="import-button" disabled={busy} onClick={regenerate}><ArrowCounterClockwise size={14} /> Regenerate</button>
                <button className="import-button import-button--primary" disabled={busy} onClick={approve}><Check size={14} weight="bold" /> Approve</button>
              </div>
            </div>
          </div>
        ) : isFailed ? (
          <div className="import-drop-target import-setup-warning">
            <WarningCircle size={30} />
            <h2>That didn't work</h2>
            <p>{job.stages.look.error}</p>
            <div className="import-actions">
              <button className="import-button" disabled={busy} onClick={reject}><Trash size={14} /> Discard</button>
              <button className="import-button import-button--primary" disabled={busy} onClick={regenerate}><ArrowCounterClockwise size={14} /> Retry</button>
            </div>
          </div>
        ) : null}

        {error && <p className="import-status is-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
