import { TYPES, SEASON_FILTERS } from "./shared/wardrobe-filters.mjs";

export function WardrobeFilters({ itemCount, activeType, onChooseType, availableTags, activeTags, onToggleTag, activeColor, onColorChange, activeSeason, onSeasonChange }) {
  return (
    <>
      <nav className="category-nav" aria-label="Filter wardrobe by item type">
        {TYPES.map((type) => (
          <button
            key={type.id}
            type="button"
            className={activeType === type.id ? "active" : ""}
            onClick={() => onChooseType(type.id)}
            aria-pressed={activeType === type.id}
          >
            {type.label}
          </button>
        ))}
      </nav>
      {!!itemCount && (
        <div className="search-filters">
          {!!availableTags.length && (
            <div className="tag-filter" aria-label="Filter by detail tag">
              {availableTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={activeTags.includes(tag) ? "active" : ""}
                  onClick={() => onToggleTag(tag)}
                  aria-pressed={activeTags.includes(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
          <label className="color-filter">
            <span>Color</span>
            <input type="color" value={activeColor || "#9a9286"} onChange={(event) => onColorChange(event.target.value)} aria-label="Filter by similar color" />
            {activeColor && <button type="button" onClick={() => onColorChange(null)}>Clear</button>}
          </label>
          <div className="tag-filter" aria-label="Filter by season">
            {SEASON_FILTERS.map((season) => (
              <button
                key={season.id}
                type="button"
                className={activeSeason === season.id ? "active" : ""}
                onClick={() => onSeasonChange(season.id)}
                aria-pressed={activeSeason === season.id}
              >
                {season.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
