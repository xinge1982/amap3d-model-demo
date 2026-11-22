import * as Cesium from "cesium";
import { featureKey, normalizeFeatureId, readFeatureId } from "./feature-id";

function tilesetOptions(config) {
  const options = { ...config.options };
  for (const name of ["modelForwardAxis", "modelUpAxis"]) {
    if (["X", "Y", "Z"].includes(options[name])) {
      options[name] = Cesium.Axis[options[name]];
    }
  }
  return options;
}

export default class TilesetScene {
  constructor(container, configs, deletedIds, onPick) {
    this.destroyed = false;
    this.hiddenKeys = new Set(deletedIds);
    this.hiddenRevision = 0;
    this.selectedKey = undefined;
    this.contentStates = new WeakMap();
    this.layersByFeature = new WeakMap();
    this.layersByTileset = new WeakMap();
    this.layers = new Map();
    for (const config of configs) {
      this.layers.set(config.id, {});
      for (const value of config.hideFeatureIds ?? []) {
        const id = normalizeFeatureId(value);
        if (id !== undefined) this.hiddenKeys.add(featureKey(config.id, id));
      }
    }

    const imageryProvider = new Cesium.UrlTemplateImageryProvider({
      url: "https://webst01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}",
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
      credit: "高德地图",
      maximumLevel: 16,
    });

    const viewer = new Cesium.Viewer(container, {
      animation: false,
      timeline: false,
      baseLayer: new Cesium.ImageryLayer(imageryProvider),
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
    this.viewer = viewer;
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#253643");
    viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(121.47, 31.23, 90000) });
    const handler = viewer.screenSpaceEventHandler;
    handler.setInputAction(({ position }) => onPick(this.pick(position)), Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  }

  pick(position) {
    const feature = this.viewer.scene.pick(position);
    const config = this.layersByFeature.get(feature) ??
      this.layersByTileset.get(feature?.tileset ?? feature?.content?.tileset ?? feature?.primitive);
    if (!config) return undefined;

    const id = readFeatureId(feature);
    if (id === undefined) return { missingId: true };
    const key = featureKey(config.id, id);
    if (this.hiddenKeys.has(key)) return undefined;
    return { layerId: config.id, layerName: config.name, id, key };
  }

  select(key) {
    this.selectedKey = key;
    this.viewer.scene.requestRender();
  }

  hide(key) {
    this.hiddenKeys.add(key);
    this.hiddenRevision++;
    this.viewer.scene.requestRender();
  }

  indexContent(content, config) {
    const featuresByKey = new Map();
    for (let i = 0; i < content.featuresLength; i++) {
      const feature = content.getFeature(i);
      this.layersByFeature.set(feature, config);
      const id = readFeatureId(feature);
      if (id === undefined) continue;
      const key = featureKey(config.id, id);
      if (!featuresByKey.has(key)) featuresByKey.set(key, []);
      featuresByKey.get(key).push(feature);
    }
    const state = { featuresByKey, hiddenRevision: -1, selectedKey: undefined, highlights: [] };
    this.contentStates.set(content, state);
    return state;
  }

  // 新瓦片或重新加载的瓦片使用当前的隐藏和高亮状态。
  updateTileContent(content, config) {
    if (!content) return;
    for (const inner of content.innerContents ?? []) this.updateTileContent(inner, config);
    if (!content.featuresLength) return;

    const state = this.contentStates.get(content) ?? this.indexContent(content, config);
    if (state.hiddenRevision !== this.hiddenRevision) {
      for (const [key, features] of state.featuresByKey) {
        if (!this.hiddenKeys.has(key)) continue;
        for (const feature of features) feature.show = false;
      }
      state.hiddenRevision = this.hiddenRevision;
    }

    if (state.selectedKey !== this.selectedKey) {
      for (const { feature, color } of state.highlights) feature.color = color;
      state.highlights = [];
      for (const feature of state.featuresByKey.get(this.selectedKey) ?? []) {
        if (!feature.show) continue;
        state.highlights.push({ feature, color: Cesium.Color.clone(feature.color) });
        feature.color = Cesium.Color.YELLOW;
      }
      state.selectedKey = this.selectedKey;
    }
  }

  async updateLayer(layer) {
    const { config } = layer;
    const runtime = this.layers.get(config.id);
    if (!layer.enabled) {
      if (runtime.tileset) runtime.tileset.show = false;
      layer.status = "已关闭";
      this.viewer.scene.requestRender();
      return;
    }

    try {
      if (!runtime.tileset) {
        layer.status = "正在加载图层配置…";
        runtime.pending ??= Cesium.Cesium3DTileset.fromUrl(config.url, tilesetOptions(config))
          .then((tileset) => {
            if (this.destroyed) {
              tileset.destroy();
              return;
            }
            runtime.tileset = tileset;
            this.layersByTileset.set(tileset, config);
            tileset.show = layer.enabled;
            tileset.tileVisible.addEventListener(({ content }) => this.updateTileContent(content, config));
            tileset.tileFailed.addEventListener(({ message }) => {
              if (layer.enabled) layer.status = "部分瓦片加载失败";
              console.error(config.name, message);
            });
            this.viewer.scene.primitives.add(tileset);
            layer.tilesetReady = true;
          })
          .finally(() => { runtime.pending = undefined; });
        await runtime.pending;
      }

      if (this.destroyed) return;
      runtime.tileset.show = layer.enabled;
      layer.status = layer.enabled ? "已开启" : "已关闭";
      this.viewer.scene.requestRender();
    } catch (error) {
      if (this.destroyed) return;
      if (layer.enabled) {
        layer.enabled = false;
        layer.status = "图层配置加载失败，重新勾选可重试";
      }
      console.error(config.name, error);
    }
  }

  locate(layer) {
    const tileset = this.layers.get(layer.config.id).tileset;
    return !this.destroyed && tileset
      ? this.viewer.flyTo(tileset)
      : false;
  }

  async loadDefaults(layers) {
    const defaults = layers.filter(({ enabled }) => enabled);
    const tasks = new Map(defaults.map((layer) => [layer, this.updateLayer(layer)]));
    const focusOrder = [
      ...defaults.filter(({ config }) => config.focus === true),
      ...defaults.filter(({ config }) => config.focus === undefined),
    ];
    for (const layer of focusOrder) {
      await tasks.get(layer);
      if (this.destroyed) break;
      if (layer.enabled && await this.locate(layer)) break;
    }
  }

  destroy() {
    this.destroyed = true;
    this.viewer.destroy();
  }
}
