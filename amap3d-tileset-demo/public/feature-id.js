export function normalizeFeatureId(value) {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  return undefined;
}

export function featureKey(tilesetId, featureId) {
  return `${tilesetId}:${featureId}`;
}

export function readFeatureId(feature) {
  return normalizeFeatureId(feature?.getProperty?.("id"));
}
