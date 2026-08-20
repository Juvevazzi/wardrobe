import { useEffect, useRef, useState } from "react";
import { Star, Trash, UploadSimple } from "@phosphor-icons/react";
import { apiRequest } from "./shared/api.mjs";
import "./profile-flow.css";

const API = "/api/import/profile";
const IMAGES_API = "/api/import/profile/reference-images";

const api = (path, options) => apiRequest(path, options, "The profile could not be updated.");

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error("Could not read that image."));
  reader.readAsDataURL(file);
});

export function ProfileView() {
  const inputRef = useRef(null);
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api(API)
      .then((loaded) => { setProfile(loaded); setName(loaded.basicInfo.name); setNotes(loaded.basicInfo.notes); })
      .catch((requestError) => setError(requestError.message));
  }, []);

  const saveBasicInfo = async () => {
    try {
      setProfile(await api(API, { method: "PATCH", body: JSON.stringify({ basicInfo: { name, notes } }) }));
    } catch (requestError) { setError(requestError.message); }
  };

  const uploadFiles = async (files) => {
    const images = [...files].filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    setUploading(true); setError("");
    try {
      for (const file of images) {
        const imageDataUrl = await fileToDataUrl(file);
        setProfile(await api(IMAGES_API, { method: "POST", body: JSON.stringify({ imageDataUrl }) }));
      }
    } catch (requestError) { setError(requestError.message); }
    finally { setUploading(false); }
  };

  const activate = async (id) => {
    try {
      setProfile(await api(API, { method: "PATCH", body: JSON.stringify({ activeReferenceImageId: id }) }));
    } catch (requestError) { setError(requestError.message); }
  };

  const remove = async (id) => {
    try {
      setProfile(await api(`${IMAGES_API}/${id}`, { method: "DELETE" }));
    } catch (requestError) { setError(requestError.message); }
  };

  if (!profile) return error ? <p className="status error">{error}</p> : <p className="status">Loading profile</p>;

  return (
    <div className="profile-view">
      <section className="profile-section">
        <h2>Basic info</h2>
        <div className="import-field">
          <label htmlFor="profile-name">Name</label>
          <input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} onBlur={saveBasicInfo} placeholder="Your name" />
        </div>
        <div className="import-field">
          <label htmlFor="profile-notes">Notes <span>optional</span></label>
          <textarea id="profile-notes" rows="3" value={notes} onChange={(event) => setNotes(event.target.value)} onBlur={saveBasicInfo} placeholder="Styling notes, sizing, anything worth remembering" />
        </div>
      </section>

      <section className="profile-section">
        <div className="profile-section__header">
          <h2>Reference images</h2>
          <button type="button" className="import-button import-button--primary" disabled={uploading} onClick={() => inputRef.current?.click()}>
            <UploadSimple size={14} /> {uploading ? "Uploading…" : "Add photo"}
          </button>
          <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(event) => { uploadFiles(event.target.files); event.target.value = ""; }} />
        </div>
        <p className="import-card__detail">The starred photo is your identity when generating modeled outfit looks. Click a photo to make it the active one.</p>
        {!profile.referenceImages.length ? (
          <p className="status empty">Add a clear photo of yourself to start generating modeled looks.</p>
        ) : (
          <div className="look-picker-grid">
            {profile.referenceImages.map((image) => {
              const isActive = image.id === profile.activeReferenceImageId;
              return (
                <div className={`look-picker-tile reference-image-tile${isActive ? " is-selected" : ""}`} key={image.id}>
                  <button type="button" className="reference-image-tile__activate" onClick={() => activate(image.id)} aria-pressed={isActive} aria-label={isActive ? "Active reference photo" : "Set as active reference photo"}>
                    <img src={image.image} alt="" />
                    <span className="look-picker-badge" aria-hidden="true"><Star size={12} weight="fill" /></span>
                  </button>
                  <button type="button" className="reference-image-tile__delete" onClick={() => remove(image.id)} aria-label="Delete this reference photo"><Trash size={14} /></button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {error && <p className="import-status is-error" role="alert">{error}</p>}
    </div>
  );
}
