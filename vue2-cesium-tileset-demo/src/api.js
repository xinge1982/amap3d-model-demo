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

export function hideFeature(tilesetId, featureId, action) {
  return request("/api/tilesets/feature", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tilesetId, featureId, action }),
  });
}
