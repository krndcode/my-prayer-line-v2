export function normalizeGroupName(name = "") {
  return String(name)
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function getGroupNameClaimId(name = "") {
  return `name-${normalizeGroupName(name)}`;
}

export function getLegacyGroupNameClaimId(name = "") {
  const legacyNormalizedName = String(name)
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return encodeURIComponent(legacyNormalizedName);
}
