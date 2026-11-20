import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { featureKey, normalizeFeatureId } from "./public/feature-id.js";
import tilesets from "./tilesets.json" with { type: "json" };

const app = express();
const projectDir = dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.MOCK_DATA_FILE
  ? resolve(process.env.MOCK_DATA_FILE)
  : resolve(projectDir, ".mock-data/deleted-features.json");
const layerIds = new Set(tilesets.map(({ id }) => id));
const deleted = new Map();

try {
  for (const record of JSON.parse(readFileSync(dataFile, "utf8"))) {
    deleted.set(record.id, record);
  }
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

app.use("/api", express.json({ limit: "8kb" }), (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.get("/api/tilesets", (req, res) => {
  res.json(tilesets);
});

app.get(["/api/tilesets/deleted", "/api/tileset/deleted"], (req, res) => {
  res.json([...deleted.keys()]);
});

app.delete("/api/tilesets/feature", (req, res) => {
  const { tilesetId, featureId, action = "delete" } = req.body ?? {};
  const rawId = normalizeFeatureId(featureId);
  if (!layerIds.has(tilesetId) || rawId === undefined || !["delete", "replace"].includes(action)) {
    return res.status(400).json({ message: "图层、单体 ID 或操作类型无效。" });
  }

  const id = featureKey(tilesetId, rawId);
  const record = { id, tilesetId, featureId: rawId, action };
  if (deleted.get(id)?.action !== action) {
    const records = new Map(deleted).set(id, record);
    try {
      mkdirSync(dirname(dataFile), { recursive: true });
      const temporaryFile = `${dataFile}.tmp`;
      writeFileSync(temporaryFile, JSON.stringify([...records.values()], null, 2) + "\n");
      renameSync(temporaryFile, dataFile);
      deleted.set(id, record);
    } catch (error) {
      console.error("保存隐藏记录失败", error);
      return res.status(500).json({ message: "保存隐藏记录失败，请重试。" });
    }
  }

  res.json(record);
});

app.use("/api", (req, res) => {
  res.status(404).json({ message: "接口不存在。" });
});

app.use((error, req, res, next) => {
  if (error.type === "entity.parse.failed" || error.type === "entity.too.large") {
    return res.status(error.status).json({ message: "请求 JSON 无效或过大。" });
  }
  next(error);
});

app.use("/vendor/cesium", express.static(resolve(projectDir, "node_modules/cesium/Build/Cesium")));
app.use(express.static(resolve(projectDir, "public")));

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`AMap3D Tileset Demo  http://localhost:${port}`);
});
