export function weatherBucket(tempC) {
  if (!Number.isFinite(tempC)) return null;
  if (tempC < 8) return "cold";
  if (tempC < 17) return "cool";
  if (tempC < 24) return "mild";
  return "warm";
}

const COLD_CUES = ["wool", "fleece", "thermal", "puffer", "knit", "sweater", "coat", "corduroy", "flannel", "quilted", "shearling", "cashmere"];
const WARM_CUES = ["linen", "shorts", "tank", "short-sleeve", "sandals", "mesh", "seersucker", "sleeveless", "lightweight", "breathable"];

// ponytail: keyword match over existing item tags, not a real fabric/warmth model. Upgrade to
// a dedicated "warmth" field on garments if this scores too many outfits wrong.
export function outfitWarmthScore(outfit, itemsById) {
  const tags = (outfit.garmentIds || []).flatMap((id) => itemsById[id]?.tags || []).map((tag) => tag.toLowerCase());
  const cold = tags.filter((tag) => COLD_CUES.some((cue) => tag.includes(cue))).length;
  const warm = tags.filter((tag) => WARM_CUES.some((cue) => tag.includes(cue))).length;
  return cold - warm;
}

export function suggestOutfitsForWeather(outfits, itemsById, bucket) {
  if (bucket !== "cold" && bucket !== "warm") return outfits;
  const matches = outfits.filter((outfit) => {
    const score = outfitWarmthScore(outfit, itemsById);
    return bucket === "cold" ? score >= 0 : score <= 0;
  });
  return matches.length ? matches : outfits;
}
