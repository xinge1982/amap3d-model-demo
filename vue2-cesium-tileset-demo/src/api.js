async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => undefined);
  if (!response.ok || data === undefined) {
    throw new Error(data?.message ?? `请求失败（HTTP ${response.status}）。`);
  }
  return data;
}

export function loadTilesetConfig() {
  return Promise.all([
    request("/api/tilesets"),
    request("/api/tilesets/deleted"),
  ]);
}

export function loadModelCatalog() {
  return request("/api/models");
}

export function hideFeature(tilesetId, featureId, action, modelId) {
  return request("/api/tilesets/feature", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tilesetId, featureId, action, modelId }),
  });
}

export function savePlacement(placement, replacement) {
  const { placementId, modelId, modelMatrix, localBounds } = placement;
  return request("/api/tilesets/placements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ placementId, modelId, modelMatrix, localBounds, replacement }),
  });
}

export function loadPlacement(featureId) {
  return request(`/api/tilesets/placements/${encodeURIComponent(featureId)}`);
}

export function movePlacement(featureId, modelMatrix) {
  return request(`/api/tilesets/placements/${encodeURIComponent(featureId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelMatrix }),
  });
}
