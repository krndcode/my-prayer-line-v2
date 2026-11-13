// Shared imagery for prayer groups.
//
// Groups created before image uploads existed all point at the same placeholder
// image. To keep the community cards visually distinct we derive a stable image
// from the group id, while still respecting any custom image an admin sets.

export const GROUP_IMAGE_POOL = [
  "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1736802888753-43b386140fbe?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?auto=format&fit=crop&w=1200&q=80",
];

// The placeholder previously written to every new group.
export const LEGACY_DEFAULT_GROUP_IMAGE =
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=900";

function normalizeImage(image) {
  return typeof image === "string" ? image.trim() : "";
}

function isCustomImage(image) {
  const value = normalizeImage(image);

  return (
    Boolean(value) &&
    value !== LEGACY_DEFAULT_GROUP_IMAGE &&
    !GROUP_IMAGE_POOL.includes(value)
  );
}

function hashString(value = "") {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

// Deterministic single-group image.
export function getGroupImage(group) {
  const stored = normalizeImage(group?.image);

  if (stored && stored !== LEGACY_DEFAULT_GROUP_IMAGE) {
    return stored;
  }

  const key = String(group?.id || group?.name || "prayer-group");
  return GROUP_IMAGE_POOL[hashString(key) % GROUP_IMAGE_POOL.length];
}

// Image map for a list of groups. Ensures every visible group gets a different
// image even when two group ids hash to the same pool entry.
export function getGroupImageMap(groups = []) {
  const imageById = new Map();
  const usedImages = new Set();

  const ordered = [...groups].sort((a, b) =>
    String(a.id || a.name || "").localeCompare(String(b.id || b.name || ""))
  );

  // Keep genuine custom uploads untouched.
  ordered.forEach((group) => {
    if (isCustomImage(group.image)) {
      const image = normalizeImage(group.image);
      imageById.set(group.id, image);
      usedImages.add(image);
    }
  });

  ordered.forEach((group) => {
    if (imageById.has(group.id)) return;

    const start =
      hashString(String(group.id || group.name || "prayer-group")) %
      GROUP_IMAGE_POOL.length;

    let image = GROUP_IMAGE_POOL[start];

    for (let offset = 0; offset < GROUP_IMAGE_POOL.length; offset += 1) {
      const candidate =
        GROUP_IMAGE_POOL[(start + offset) % GROUP_IMAGE_POOL.length];

      if (!usedImages.has(candidate)) {
        image = candidate;
        break;
      }
    }

    usedImages.add(image);
    imageById.set(group.id, image);
  });

  return imageById;
}
