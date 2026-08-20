import { useMemo, useState } from "react";
import { CATEGORIES, SEASONS } from "./categories.mjs";

export const TYPES = [{ id: "all", label: "All" }, ...CATEGORIES];
export const TYPE_MAP = Object.fromEntries(TYPES.map((type) => [type.id, type]));
export const TYPE_ORDER = Object.fromEntries(TYPES.slice(1).map((type, index) => [type.id, index]));

export const SEASON_FILTERS = [{ id: "all", label: "All" }, ...SEASONS, { id: "unsorted", label: "Unsorted" }];

const COLOR_MATCH_THRESHOLD = 60;

export function hexToRgb(hex) {
  const value = (hex || "").replace("#", "");
  return {
    red: Number.parseInt(value.slice(0, 2), 16) || 0,
    green: Number.parseInt(value.slice(2, 4), 16) || 0,
    blue: Number.parseInt(value.slice(4, 6), 16) || 0,
  };
}

export function colorDistance(first, second) {
  return Math.sqrt(
    ((first.red - second.red) ** 2)
    + ((first.green - second.green) ** 2)
    + ((first.blue - second.blue) ** 2),
  );
}

export function filterVisibleItems(items, { activeType, activeTags, activeColor, activeSeason }) {
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
}

export function useWardrobeFilters(items) {
  const [activeType, setActiveType] = useState("all");
  const [activeTags, setActiveTags] = useState([]);
  const [activeColor, setActiveColor] = useState(null);
  const [activeSeason, setActiveSeason] = useState("all");

  const availableTags = useMemo(() => [...new Set(items.flatMap((item) => item.tags || []))].sort(), [items]);

  const visibleItems = useMemo(
    () => filterVisibleItems(items, { activeType, activeTags, activeColor, activeSeason }),
    [activeType, activeTags, activeColor, activeSeason, items],
  );

  const toggleTag = (tag) => {
    setActiveTags((current) => current.includes(tag) ? current.filter((existing) => existing !== tag) : [...current, tag]);
  };

  return {
    activeType, setActiveType,
    activeTags, toggleTag,
    activeColor, setActiveColor,
    activeSeason, setActiveSeason,
    availableTags, visibleItems,
  };
}
