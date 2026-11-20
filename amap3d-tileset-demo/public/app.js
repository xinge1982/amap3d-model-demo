import { featureKey, normalizeFeatureId, readFeatureId } from "./feature-id.js";

const Cesium = window.Cesium;
const byId = (id) => document.getElementById(id);
const status = byId("status");
const retryStart = byId("retry-start");
const selectionPanel = byId("selection");
const selectionError = byId("selection-error");
const actionButtons = ["cancel", "replace", "delete"].map(byId);
const layersByTileset = new WeakMap();
const layersByFeature = new WeakMap();
const contentStates = new WeakMap();
const hiddenFeatures = new Map();
let hiddenRevision = 0;
let selected;
let saving = false;
let viewer;

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => undefined);
  if (!response.ok || data === undefined) {
    throw new Error(data?.message ?? `请求失败（HTTP ${response.status}）。`);
  }
  return data;
}

function indexContent(content, layer) {
  const featuresByKey = new Map();
  for (let i = 0; i < content.featuresLength; i++) {
    const feature = content.getFeature(i);
    layersByFeature.set(feature, layer);
    const id = readFeatureId(feature);
    if (id === undefined) continue;
    const key = featureKey(layer.config.id, id);
    if (!featuresByKey.has(key)) featuresByKey.set(key, []);
    featuresByKey.get(key).push(feature);
  }
  const state = { featuresByKey, hiddenRevision: -1, selectedKey: undefined, highlights: [] };
  contentStates.set(content, state);
  return state;
}

// 每个可见瓦片首次出现时建立索引。瓦片重新加载后会应用最新的隐藏和选择状态。
function updateTileContent(content, layer) {
  if (!content) return;
  for (const inner of content.innerContents ?? []) {
    updateTileContent(inner, layer);
  }
  if (!content.featuresLength) return;

  const state = contentStates.get(content) ?? indexContent(content, layer);
  if (state.hiddenRevision !== hiddenRevision) {
    for (const [key, features] of state.featuresByKey) {
      if (!hiddenFeatures.has(key)) continue;
      for (const feature of features) feature.show = false;
    }
    state.hiddenRevision = hiddenRevision;
  }

  const selectedKey = selected?.key;
  if (state.selectedKey !== selectedKey) {
    for (const { feature, color } of state.highlights) feature.color = color;
    state.highlights = [];
    for (const feature of state.featuresByKey.get(selectedKey) ?? []) {
      if (!feature.show) continue;
      state.highlights.push({ feature, color: Cesium.Color.clone(feature.color) });
      feature.color = Cesium.Color.YELLOW;
    }
    state.selectedKey = selectedKey;
  }
}

function selectFeature(next) {
  selected = next;
  selectionPanel.hidden = !next;
  selectionError.hidden = true;
  if (next) {
    byId("selected-layer").textContent = next.layer.config.name;
    byId("selected-id").textContent = next.id;
  }
  viewer.scene.requestRender();
}

function onPick({ position }) {
  if (saving) return;
  const feature = viewer.scene.pick(position);
  const layer = layersByFeature.get(feature) ??
    layersByTileset.get(feature?.tileset ?? feature?.content?.tileset ?? feature?.primitive);
  if (!layer) {
    selectFeature(undefined);
    return;
  }

  const id = readFeatureId(feature);
  if (id === undefined) {
    selectFeature(undefined);
    status.textContent = "当前拾取对象缺少可操作的单体 ID。";
    return;
  }
  const key = featureKey(layer.config.id, id);
  if (hiddenFeatures.has(key)) return;
  selectFeature({ layer, id, key });
}

async function saveSelection(action) {
  if (!selected || saving) return;
  const { layer, id, key } = selected;
  saving = true;
  selectionError.hidden = true;
  actionButtons.forEach((button) => { button.disabled = true; });

  try {
    await request("/api/tilesets/feature", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tilesetId: layer.config.id, featureId: id, action }),
    });
    hiddenFeatures.set(key, action);
    hiddenRevision++;
    selectFeature(undefined);
    status.textContent = action === "replace" ? "已标记替换，原单体已隐藏。" : "已删除，单体已隐藏。";
  } catch (error) {
    selectionError.textContent = error.message;
    selectionError.hidden = false;
  } finally {
    actionButtons.forEach((button) => { button.disabled = false; });
    saving = false;
  }
}

function tilesetOptions(config) {
  const options = { ...config.options };
  for (const name of ["modelForwardAxis", "modelUpAxis"]) {
    if (["X", "Y", "Z"].includes(options[name])) {
      options[name] = Cesium.Axis[options[name]];
    }
  }
  return options;
}

async function loadLayer(layer) {
  if (!layer.toggle.checked) {
    if (layer.tileset) layer.tileset.show = false;
    if (selected?.layer === layer && !saving) selectFeature(undefined);
    layer.locate.disabled = true;
    layer.state.textContent = "已关闭";
    viewer.scene.requestRender();
    return;
  }

  try {
    if (!layer.tileset) {
      layer.state.textContent = "加载中…";
      layer.loading ??= Cesium.Cesium3DTileset.fromUrl(layer.config.url, tilesetOptions(layer.config))
        .then((tileset) => {
          layer.tileset = tileset;
          layersByTileset.set(tileset, layer);
          tileset.show = layer.toggle.checked;
          tileset.tileVisible.addEventListener((tile) => updateTileContent(tile.content, layer));
          tileset.tileFailed.addEventListener(({ message }) => {
            if (layer.toggle.checked) layer.state.textContent = "部分瓦片加载失败";
            console.error(layer.config.name, message);
          });
          viewer.scene.primitives.add(tileset);
        })
        .finally(() => { layer.loading = undefined; });
      await layer.loading;
    }

    const shown = layer.toggle.checked;
    layer.tileset.show = shown;
    layer.locate.disabled = !shown;
    layer.state.textContent = shown ? "已开启" : "已关闭";
    viewer.scene.requestRender();
  } catch (error) {
    layer.toggle.checked = false;
    layer.state.textContent = "加载失败，重新勾选可重试";
    console.error(layer.config.name, error);
  }
}

function addLayer(config) {
  const row = document.createElement("li");
  row.className = "layer";
  const label = document.createElement("label");
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = config.defaultLoad === true;
  label.append(toggle, config.name);
  const locate = document.createElement("button");
  locate.type = "button";
  locate.textContent = "定位";
  locate.setAttribute("aria-label", `定位${config.name}`);
  locate.disabled = true;
  const state = document.createElement("small");
  state.textContent = "已关闭";
  row.append(label, locate, state);
  byId("layer-list").append(row);

  const layer = { config, toggle, locate, state };
  toggle.addEventListener("change", () => loadLayer(layer));
  locate.addEventListener("click", () => viewer.flyTo(layer.tileset));
  return layer;
}

async function start() {
  retryStart.hidden = true;
  status.textContent = "正在读取图层配置…";
  let configs;
  try {
    const [configData, deletedIds] = await Promise.all([
      request("/api/tilesets"),
      request("/api/tilesets/deleted"),
    ]);
    if (!Array.isArray(configData) || !Array.isArray(deletedIds)) {
      throw new Error("Mock 接口应返回数组。");
    }
    configs = configData;
    for (const id of deletedIds) hiddenFeatures.set(id, "saved");
    for (const config of configs) {
      for (const value of config.hideFeatureIds ?? []) {
        const id = normalizeFeatureId(value);
        if (id !== undefined) hiddenFeatures.set(featureKey(config.id, id), "configured");
      }
    }
  } catch (error) {
    status.textContent = `读取图层配置或隐藏记录失败。 ${error.message}`;
    retryStart.hidden = false;
    return;
  }

  try {
    viewer = new Cesium.Viewer("scene", {
      animation: false,
      timeline: false,
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      infoBox: false,
      selectionIndicator: false,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
    });
  } catch (error) {
    status.textContent = "无法初始化三维场景，请检查浏览器的 WebGL 支持。";
    console.error(error);
    return;
  }
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#253643");
  viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(121.47, 31.23, 90000) });
  viewer.screenSpaceEventHandler.setInputAction(onPick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  const layers = configs.map(addLayer);
  const defaults = layers.filter(({ toggle }) => toggle.checked);
  status.textContent = "点击场景中的单体，查看操作选项。";

  const tasks = new Map(defaults.map((layer) => [layer, loadLayer(layer)]));
  const focusOrder = [
    ...defaults.filter(({ config }) => config.focus === true),
    ...defaults.filter(({ config }) => config.focus === undefined),
  ];
  for (const layer of focusOrder) {
    await tasks.get(layer);
    if (layer.toggle.checked && layer.tileset && await viewer.flyTo(layer.tileset)) break;
  }
}

byId("cancel").addEventListener("click", () => selectFeature(undefined));
byId("replace").addEventListener("click", () => saveSelection("replace"));
byId("delete").addEventListener("click", () => saveSelection("delete"));
retryStart.addEventListener("click", start);
start();
