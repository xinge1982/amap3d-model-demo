const { mkdirSync, readFileSync, renameSync, writeFileSync } = require("node:fs");
const { basename, dirname, resolve } = require("node:path");
const express = require("express");
const { Matrix3, Matrix4 } = require("cesium");
const { DYNAMIC_TILESET_ID, featureKey, normalizeFeatureId } = require("../src/feature-id");
const { FRONT_TEXTURE_MAX_BYTES, FRONT_TEXTURE_TYPES, applyFrontTexture } = require("../src/front-texture");
const tilesets = require("./tilesets.json");
const models = require("./models.json");
const { config: dynamicConfig, buildDynamicTileset } = require("./dynamic-tileset");
const modelCatalog = new Map(models.map((model) => [model.id, model]));
const allTilesets = [...tilesets, dynamicConfig];
const layerIds = new Set(allTilesets.map(({ id }) => id));
const modelDirectory = resolve(__dirname, "models");
const parsePlacement = express.json({ limit: "6mb" });

function isFrontTextureValid(value, model) {
  if (value === undefined) return true;
  if (!model.frontMaterial || !model.url?.endsWith(".gltf") || typeof value !== "string") return false;

  const type = FRONT_TEXTURE_TYPES.find((mime) => value.startsWith(`data:${mime};base64,`));
  if (!type) return false;
  const encoded = value.slice(value.indexOf(",") + 1);
  if (!encoded || encoded.length > Math.ceil(FRONT_TEXTURE_MAX_BYTES / 3) * 4 ||
      encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded)) return false;

  const image = Buffer.from(encoded, "base64");
  if (image.length > FRONT_TEXTURE_MAX_BYTES || image.toString("base64") !== encoded) return false;
  const signature = type === "image/png" ? "89504e470d0a1a0a" : "ffd8ff";
  return image.subarray(0, signature.length / 2).toString("hex") === signature;
}

function isFiniteArray(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function isPlacementMatrix(value) {
  if (!isFiniteArray(value, 16) || value[3] !== 0 || value[7] !== 0 || value[11] !== 0 || value[15] !== 1) {
    return false;
  }
  const determinant = Matrix3.determinant(Matrix4.getMatrix3(Matrix4.fromArray(value), new Matrix3()));
  return Number.isFinite(determinant) && determinant !== 0;
}

function readRecords(file) {
  try {
    const records = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(records)) throw new Error("模型变更文件必须包含 JSON 数组。");
    return records;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  }
}

function createMockApi() {
  const router = express.Router();
  const customDataFile = process.env.MOCK_DATA_FILE;
  const dataFile = customDataFile
    ? resolve(customDataFile)
    : resolve(__dirname, "..", ".mock-data/changed-features.json");
  let savedRecords = readRecords(dataFile);
  if (savedRecords === undefined && !customDataFile) {
    const legacyFile = resolve(dirname(dataFile), "deleted-features.json");
    savedRecords = readRecords(legacyFile);
    if (savedRecords !== undefined) renameSync(legacyFile, dataFile);
  }

  let records = new Map();
  for (const record of savedRecords ?? []) {
    // 老版文件中每一项都是已删除或被替换的原单体。
    records.set(record.id, { ...record, deleted: record.deleted ?? true });
  }

  function commitRecords(next, res) {
    try {
      mkdirSync(dirname(dataFile), { recursive: true });
      const temporaryFile = `${dataFile}.tmp`;
      writeFileSync(temporaryFile, JSON.stringify([...next.values()], null, 2) + "\n");
      renameSync(temporaryFile, dataFile);
      records = next;
      return true;
    } catch (error) {
      console.error("保存模型变更失败", error);
      res.status(500).json({ message: "保存模型变更失败，请重试。" });
      return false;
    }
  }

  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.get("/models", (req, res) => {
    res.json(models);
  });

  router.get("/models/files/placement-:featureId.gltf", (req, res, next) => {
    const record = records.get(featureKey(DYNAMIC_TILESET_ID, req.params.featureId));
    if (!record?.frontTexture || record.deleted) return next();

    // 路径与原始文件同目录，保留 glTF 对外部资源的相对引用。
    try {
      const gltf = JSON.parse(readFileSync(resolve(modelDirectory, basename(record.url)), "utf8"));
      res.type("model/gltf+json").json(applyFrontTexture(gltf, record.frontMaterial, record.frontTexture));
    } catch (error) {
      console.error("生成标志牌 glTF 失败", error);
      res.status(500).json({ message: "生成标志牌 glTF 失败。" });
    }
  });

  router.use("/models/files", express.static(modelDirectory, {
    setHeaders(res, path) {
      if (path.endsWith(".glb")) res.type("model/gltf-binary");
      if (path.endsWith(".gltf")) res.type("model/gltf+json");
    },
  }));

  router.get("/tilesets", (req, res) => {
    res.json(allTilesets);
  });

  router.get("/tilesets/dynamic", (req, res) => {
    res.json(buildDynamicTileset(records.values()));
  });

  router.get(["/tilesets/deleted", "/tileset/deleted"], (req, res) => {
    res.json([...records.values()].filter(({ deleted }) => deleted).map(({ id }) => id));
  });

  router.get("/tilesets/placements/:featureId", (req, res) => {
    const record = records.get(featureKey(DYNAMIC_TILESET_ID, req.params.featureId));
    if (!record || record.deleted) return res.status(404).json({ message: "动态单体不存在或已隐藏。" });
    res.json({ ...record, modelName: modelCatalog.get(record.modelId)?.name ?? record.modelId });
  });

  router.put("/tilesets/placements/:featureId", parsePlacement, (req, res) => {
    const id = featureKey(DYNAMIC_TILESET_ID, req.params.featureId);
    const previous = records.get(id);
    if (!previous || previous.deleted) return res.status(404).json({ message: "动态单体不存在或已隐藏。" });

    const { modelMatrix, frontTexture } = req.body ?? {};
    if (!isPlacementMatrix(modelMatrix)) {
      return res.status(400).json({ message: "模型变换矩阵无效。" });
    }

    if (!isFrontTextureValid(frontTexture, previous)) {
      return res.status(400).json({ message: "此模型不支持该贴图，请使用不超过 4 MB 的 PNG 或 JPEG。" });
    }

    const record = { ...previous, modelMatrix };
    if (frontTexture !== undefined) record.frontTexture = frontTexture;
    if (!commitRecords(new Map(records).set(id, record), res)) return;
    res.json(record);
  });

  router.post("/tilesets/placements", parsePlacement, (req, res) => {
    const { placementId, modelId, modelMatrix, localBounds, replacement, frontTexture } = req.body ?? {};
    const model = modelCatalog.get(modelId);
    if (typeof placementId !== "string" ||
        !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(placementId) ||
        !model || !isPlacementMatrix(modelMatrix) ||
        !isFiniteArray(localBounds, 4) || localBounds[3] <= 0) {
      return res.status(400).json({ message: "摆放 ID、模型、变换矩阵或包围球无效。" });
    }

    if (!isFrontTextureValid(frontTexture, model)) {
      return res.status(400).json({ message: "此模型不支持该贴图，请使用不超过 4 MB 的 PNG 或 JPEG。" });
    }

    const id = featureKey(DYNAMIC_TILESET_ID, placementId.toLowerCase());
    let replaces;
    let source;
    if (replacement !== undefined) {
      const { tilesetId, featureId } = replacement ?? {};
      const rawId = normalizeFeatureId(featureId);
      if (!layerIds.has(tilesetId) || rawId === undefined) {
        return res.status(400).json({ message: "被替换单体的图层或 ID 无效。" });
      }
      const sourceId = featureKey(tilesetId, rawId);
      source = records.get(sourceId);
      if (sourceId === id || (tilesetId === DYNAMIC_TILESET_ID && !source)) {
        return res.status(400).json({ message: "被替换的动态单体无效。" });
      }
      replaces = { id: sourceId, tilesetId, featureId: rawId };
    }

    const action = replaces ? "replace" : "place";
    const record = {
      id,
      tilesetId: DYNAMIC_TILESET_ID,
      featureId: placementId.toLowerCase(),
      action,
      deleted: false,
      modelId,
      url: model.url,
      frontMaterial: model.frontMaterial,
      frontTexture,
      modelMatrix,
      localBounds,
      replaces,
    };
    const previous = records.get(id);
    if (previous) {
      if (previous.modelId === modelId && previous.replaces?.id === replaces?.id &&
          previous.frontTexture === frontTexture &&
          JSON.stringify(previous.modelMatrix) === JSON.stringify(modelMatrix) &&
          JSON.stringify(previous.localBounds) === JSON.stringify(localBounds)) {
        return res.json(previous);
      }
      return res.status(409).json({ message: "此摆放 ID 已存在，请重新发起摆放。" });
    }
    if (source?.deleted) {
      return res.status(409).json({ message: "原单体已被删除或替换，请刷新场景。" });
    }

    const next = new Map(records);
    if (replaces) next.set(replaces.id, { ...source, ...replaces, action: "replace", deleted: true });
    next.set(id, record);
    if (!commitRecords(next, res)) return;

    res.status(201).json(record);
  });

  router.delete("/tilesets/feature", express.json({ limit: "8kb" }), (req, res) => {
    const { tilesetId, featureId, action = "delete", modelId } = req.body ?? {};
    const rawId = normalizeFeatureId(featureId);
    if (!layerIds.has(tilesetId) || rawId === undefined || !["delete", "replace"].includes(action)) {
      return res.status(400).json({ message: "图层、单体 ID 或操作类型无效。" });
    }

    if (modelId !== undefined && (action !== "replace" || !modelCatalog.has(modelId))) {
      return res.status(400).json({ message: "替换模型 ID 无效。" });
    }

    const id = featureKey(tilesetId, rawId);
    const previous = records.get(id);
    if (tilesetId === DYNAMIC_TILESET_ID && !previous) {
      return res.status(404).json({ message: "动态单体不存在。" });
    }
    if (previous?.deleted && previous.action === action && (modelId === undefined || previous.modelId === modelId)) {
      return res.json(previous);
    }
    const record = { ...previous, id, tilesetId, featureId: rawId, action, deleted: true };
    if (modelId !== undefined && tilesetId !== DYNAMIC_TILESET_ID) record.modelId = modelId;
    if (!commitRecords(new Map(records).set(id, record), res)) return;

    res.json(record);
  });

  router.use((req, res) => {
    res.status(404).json({ message: "接口不存在。" });
  });

  router.use((error, req, res, next) => {
    if (error.type === "entity.parse.failed" || error.type === "entity.too.large") {
      return res.status(error.status).json({ message: "请求 JSON 无效或过大。" });
    }
    next(error);
  });

  return router;
}

module.exports = createMockApi;
