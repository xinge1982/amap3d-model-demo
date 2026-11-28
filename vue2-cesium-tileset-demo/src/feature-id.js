const DYNAMIC_TILESET_ID = "dynamic";

function normalizeFeatureId(value) {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  return undefined;
}

function featureKey(tilesetId, featureId) {
  return `${tilesetId}:${featureId}`;
}

function readFeatureId(feature, field = "id") {
  return normalizeFeatureId(feature?.getProperty?.(field));
}

module.exports = { DYNAMIC_TILESET_ID, featureKey, normalizeFeatureId, readFeatureId };
