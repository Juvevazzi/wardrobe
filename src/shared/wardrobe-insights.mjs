function channel(hex, start) {
  const value = Number.parseInt((hex || "").replace("#", "").slice(start, start + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  return (0.2126 * channel(hex, 0)) + (0.7152 * channel(hex, 2)) + (0.0722 * channel(hex, 4));
}

export function isLightColor(hex) {
  return relativeLuminance(hex) > 0.4;
}

// ponytail: light/dark by relative luminance is a coarse stand-in for real color-family
// clustering (5.5 in the roadmap explicitly scopes this as "cheap aggregation"). Upgrade to
// hue/family buckets if light-vs-dark stops surfacing anything useful.
export function wardrobeGaps(items, categories) {
  const rows = categories.map((category) => {
    const inCategory = items.filter((item) => item.part === category.id);
    const light = inCategory.filter((item) => isLightColor(item.color)).length;
    return { id: category.id, label: category.label, total: inCategory.length, light, dark: inCategory.length - light };
  });

  const notes = [];
  const tops = rows.find((row) => row.id === "upperbody");
  const bottoms = rows.find((row) => row.id === "lowerbody");
  if (tops?.total >= 3 && bottoms?.total >= 1) {
    if (tops.dark / tops.total >= 0.7 && bottoms.light === 0) {
      notes.push(`Mostly dark tops (${tops.dark}/${tops.total}) but no light bottoms to break them up.`);
    }
    if (tops.light / tops.total >= 0.7 && bottoms.dark === 0) {
      notes.push(`Mostly light tops (${tops.light}/${tops.total}) but no dark bottoms to ground them.`);
    }
  }
  for (const row of rows) {
    if (row.total === 0) notes.push(`No ${row.label.toLowerCase()} in the wardrobe yet.`);
  }

  return { rows, notes };
}
