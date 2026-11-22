import * as Cesium from "cesium";
import CesiumNavigation from "cesium-navigation-es6";
import { DYNAMIC_TILESET_ID, featureKey, normalizeFeatureId, readFeatureId } from "./feature-id";

const dynamicStyles = {
  hidden: new Cesium.Cesium3DTileStyle({ show: false }),
  selected: new Cesium.Cesium3DTileStyle({ color: "color('yellow')" }),
};

function dynamicContentId(content) {
  return normalizeFeatureId(content?.metadata?.getProperty("id"));
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

export default class TilesetScene {
  constructor(container, configs, deletedIds, onSceneClick) {
    this.destroyed = false;
    this.hiddenKeys = new Set(deletedIds);
    this.temporaryHiddenKeys = new Set();
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
    const homePosition = Cesium.Cartographic.fromDegrees(121.47, 31.23, 90000);
    const homeOrientation = { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 };
    viewer.camera.setView({
      destination: Cesium.Cartographic.toCartesian(homePosition),
      orientation: homeOrientation,
    });
    this.navigation = new CesiumNavigation(viewer, {
      defaultResetView: homePosition,
      orientation: homeOrientation,
      enableCompass: true,
      enableCompassOuterRing: true,
      enableZoomControls: true,
      enableDistanceLegend: true,
      resetTooltip: "返回上海初始视角",
      zoomInTooltip: "放大",
      zoomOutTooltip: "缩小",
    });
    const handler = viewer.screenSpaceEventHandler;
    handler.setInputAction(({ position }) => onSceneClick(position), Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  }

  setGlobeVisible(visible) {
    const scene = this.viewer.scene;
    scene.globe.show = visible;
    scene.requestRender();
  }

  watchCamera(onChange) {
    const { scene } = this.viewer;
    const { camera } = scene;
    const update = () => {
      const position = camera.positionCartographic;
      onChange({
        lon: Cesium.Math.toDegrees(position.longitude),
        lat: Cesium.Math.toDegrees(position.latitude),
        height: position.height,
        heading: Cesium.Math.toDegrees(camera.heading),
        pitch: Cesium.Math.toDegrees(camera.pitch),
        roll: Cesium.Math.toDegrees(camera.roll),
      });
    };
    update();
    return scene.postRender.addEventListener(update);
  }

  pickPlacementPosition(position, allowEllipsoid = true) {
    const { scene, camera } = this.viewer;
    const depthPosition = scene.pickPositionSupported ? scene.pickPosition(position) : undefined;
    if (depthPosition) return depthPosition;
    if (allowEllipsoid && scene.globe.show) {
      return camera.pickEllipsoid(position, scene.globe.ellipsoid);
    }
    return undefined;
  }

  pick(position) {
    const feature = this.viewer.scene.pick(position);
    const content = feature?.content ?? feature?.primitive?.content;
    const config = this.layersByFeature.get(feature) ??
      this.layersByTileset.get(feature?.tileset ?? content?.tileset ?? feature?.primitive);
    if (!config) return undefined;

    const id = config.id === DYNAMIC_TILESET_ID
      ? dynamicContentId(content)
      : readFeatureId(feature);
    if (id === undefined) return { missingId: true };
    const key = featureKey(config.id, id);
    if (this.isHidden(key)) return undefined;
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

  isHidden(key) {
    return this.hiddenKeys.has(key) || this.temporaryHiddenKeys.has(key);
  }

  setTemporaryHidden(key, hidden) {
    if (hidden === this.temporaryHiddenKeys.has(key)) return;
    if (hidden) this.temporaryHiddenKeys.add(key);
    else this.temporaryHiddenKeys.delete(key);
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
    const state = {
      featuresByKey, hiddenRevision: -1, selectedKey: undefined, highlights: [], visibilityBeforeHide: new Map(),
    };
    this.contentStates.set(content, state);
    return state;
  }

  // 新瓦片或重新加载的瓦片使用当前的隐藏和高亮状态。
  updateTileContent(content, config) {
    if (!content) return;
    if (config.id === DYNAMIC_TILESET_ID) {
      this.styleDynamicContent(content);
      return;
    }
    for (const inner of content.innerContents ?? []) this.updateTileContent(inner, config);
    if (!content.featuresLength) return;

    const state = this.contentStates.get(content) ?? this.indexContent(content, config);
    if (state.hiddenRevision !== this.hiddenRevision) {
      for (const [key, features] of state.featuresByKey) {
        const hidden = this.isHidden(key);
        for (const feature of features) {
          const original = state.visibilityBeforeHide;
          if (hidden) {
            if (!original.has(feature)) original.set(feature, feature.show);
            feature.show = false;
          } else if (original.has(feature)) {
            feature.show = original.get(feature);
            original.delete(feature);
          }
        }
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

  styleDynamicContent(content) {
    const id = dynamicContentId(content);
    if (id === undefined) return;
    const key = featureKey(DYNAMIC_TILESET_ID, id);
    const style = this.isHidden(key) ? dynamicStyles.hidden
      : key === this.selectedKey ? dynamicStyles.selected : undefined;
    if (!this.contentStates.has(content) || this.contentStates.get(content) !== style) {
      content.applyStyle(style);
      this.contentStates.set(content, style);
    }
  }

  async reloadLayer(layer) {
    const runtime = this.layers.get(layer.config.id);
    // 若首次加载尚未完成，等它退出后再取写入后的新版本。
    await runtime.pending?.catch(() => {});
    if (this.destroyed) return false;
    return this.updateLayer(layer, true);
  }

  async updateLayer(layer, reload = false) {
    const { config } = layer;
    const runtime = this.layers.get(config.id);
    if (!layer.enabled && !reload) {
      if (runtime.tileset) runtime.tileset.show = false;
      layer.status = "已关闭";
      this.viewer.scene.requestRender();
      return;
    }

    try {
      if (!runtime.tileset || reload) {
        layer.status = "正在加载图层配置…";
        runtime.pending ??= Cesium.Cesium3DTileset.fromUrl(config.url, tilesetOptions(config))
          .then((tileset) => {
            if (this.destroyed) {
              tileset.destroy();
              return;
            }
            this.layersByTileset.set(tileset, config);
            tileset.show = layer.enabled;
            tileset.tileVisible.addEventListener(({ content }) => this.updateTileContent(content, config));
            tileset.tileFailed.addEventListener(({ message }) => {
              if (layer.enabled) layer.status = "部分瓦片加载失败";
              console.error(config.name, message);
            });
            const primitives = this.viewer.scene.primitives;
            primitives.add(tileset);
            if (runtime.tileset) primitives.remove(runtime.tileset);
            runtime.tileset = tileset;
            layer.tilesetReady = config.id !== DYNAMIC_TILESET_ID || tileset.root.children.length > 0;
          })
          .finally(() => { runtime.pending = undefined; });
        await runtime.pending;
      }

      if (this.destroyed) return;
      runtime.tileset.show = layer.enabled;
      layer.status = layer.enabled ? "已开启" : "已关闭";
      this.viewer.scene.requestRender();
      return true;
    } catch (error) {
      if (this.destroyed) return;
      if (reload) {
        layer.status = "图层重载失败";
      } else if (layer.enabled) {
        layer.enabled = false;
        layer.status = "图层配置加载失败，重新勾选可重试";
      }
      console.error(config.name, error);
      return false;
    }
  }

  locate(layer) {
    const { id, viewPoint } = layer.config;
    const tileset = this.layers.get(id).tileset;
    if (this.destroyed || !tileset) return false;
    if (!viewPoint) return this.viewer.flyTo(tileset);

    const { lon, lat, height, heading, pitch, roll } = viewPoint;
    if (![lon, lat, height, heading, pitch, roll].every(Number.isFinite) ||
        Math.abs(lon) > 180 || Math.abs(lat) > 90) {
      return this.viewer.flyTo(tileset);
    }

    return new Promise((resolve) => {
      this.viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        orientation: {
          heading: Cesium.Math.toRadians(heading),
          pitch: Cesium.Math.toRadians(pitch),
          roll: Cesium.Math.toRadians(roll),
        },
        complete: () => resolve(true),
        cancel: () => resolve(false),
      });
    });
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
      if (layer.enabled && layer.tilesetReady) {
        await this.locate(layer);
        break;
      }
    }
  }

  destroy() {
    this.destroyed = true;
    this.navigation.destroy();
    this.viewer.destroy();
  }
}
