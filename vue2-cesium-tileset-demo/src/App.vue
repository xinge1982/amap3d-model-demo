<template>
  <div class="app-shell">
    <header class="toolbar">
      <div class="toolbar-title">
        <p class="brand">AMap3D</p>
        <h1>Tileset 单体演示</h1>
      </div>
      <div class="toolbar-actions" role="group" aria-label="场景工具">
        <button type="button" :disabled="Boolean(placement)" :aria-expanded="String(layersOpen && !placement)" aria-controls="layers-panel" @click="toggleLayers">
          图层（{{ layers.length }}）
        </button>
        <button type="button" :disabled="placementActive" :aria-expanded="String(changesOpen && !placement)" aria-controls="changes-panel" @click="toggleChanges">
          修改信息
        </button>
        <button type="button" :disabled="!sceneReady" @click="toggleGlobe">
          {{ globeVisible ? "隐藏地球" : "显示地球" }}
        </button>
        <button type="button" :disabled="!sceneReady" :aria-expanded="String(cameraOpen)" aria-controls="camera-panel" @click="toggleCamera">
          相机参数
        </button>
        <button
          class="place-model-button"
          type="button"
          :aria-pressed="String(placementActive)"
          :disabled="!sceneReady || saving || reloading || Boolean(placement)"
          @click="openModelPicker('place')"
        >
          摆放模型
        </button>
      </div>
      <div class="toolbar-feedback">
        <p id="status" role="status">{{ status }}</p>
        <button v-if="canRetry" id="retry-start" type="button" @click="start">重新读取配置</button>
        <button v-if="canRetryDynamic" type="button" :disabled="saving || reloading || placementActive" @click="retryDynamic">刷新动态模型</button>
      </div>
    </header>

    <div class="workspace" :class="{ 'globe-hidden': !globeVisible }">
      <main id="scene" ref="scene" aria-label="Cesium 三维场景"></main>

      <aside v-show="layersOpen && !placement" id="layers-panel" class="panel layers" aria-labelledby="layers-title">
        <h2 id="layers-title">场景图层</h2>
        <button class="reload-tilesets-button" type="button" :disabled="!sceneReady || saving || reloading" @click="reloadAllLayers">
          {{ reloading ? "正在重新加载…" : "重新加载所有 Tileset" }}
        </button>
        <ul id="layer-list" aria-label="场景图层">
          <li v-for="layer in layers" :key="layer.config.id" class="layer">
            <label>
              <input v-model="layer.enabled" type="checkbox" :disabled="reloading" @change="updateLayer(layer)">
              {{ layer.config.name }}
            </label>
            <button
              type="button"
              :aria-label="`定位${layer.config.name}`"
              :disabled="!layer.tilesetReady || reloading"
              @click="locate(layer)"
            >定位</button>
            <small>{{ layer.status }}</small>
          </li>
        </ul>
      </aside>

      <FeatureChanges
        v-if="changesOpen && !placement"
        :revision="changesRevision"
        :busy="saving || reloading || placementActive"
        :scene-ready="sceneReady"
        @close="changesOpen = false"
        @locate="locateChange"
        @restore="restoreChange"
      />

      <aside v-show="cameraOpen" id="camera-panel" class="panel camera-panel" aria-labelledby="camera-title">
        <header class="selection-heading">
          <h2 id="camera-title">相机参数</h2>
          <button type="button" @click="toggleCamera">关闭</button>
        </header>
        <dl>
          <template v-for="field in cameraParameters">
            <dt :key="field.label + '-label'">{{ field.label }}</dt>
            <dd :key="field.label">{{ field.value }}</dd>
          </template>
        </dl>
        <h3 v-if="viewPointJson" id="viewpoint-title" class="viewpoint-title">viewPoint 配置</h3>
        <pre v-if="viewPointJson" class="viewpoint-json" aria-labelledby="viewpoint-title" tabindex="0"><code>{{ viewPointJson }}</code></pre>
      </aside>

      <ModelPlacement
        v-if="placement"
        ref="placement"
        :scene-controller="sceneController"
        :item="placement.model"
        :anchor="placement.anchor"
        :initial-placement="placement.initialPlacement"
        :saving="saving"
        :save-error="placementError"
        @load-model="setPlacementSourceHidden(true)"
        @load-error="setPlacementSourceHidden(false)"
        @cancel="cancelPlacement"
        @confirm="confirmPlacement"
      />

      <section v-if="selected && !placement" class="panel selection" aria-labelledby="selection-title">
        <header class="selection-heading">
          <h2 id="selection-title">已选单体</h2>
          <button type="button" aria-label="取消选择" :disabled="saving" @click="selectFeature()">关闭</button>
        </header>
        <dl>
          <dt>图层</dt><dd>{{ selected.layerName }}</dd>
          <dt>单体 ID</dt><dd>{{ selected.id }}</dd>
        </dl>
        <p>替换或移动期间会临时隐藏原单体。</p>
        <p v-if="selectionError" id="selection-error" role="alert">{{ selectionError }}</p>
        <div class="actions">
          <button v-if="canMoveSelected" type="button" :disabled="saving" @click="moveSelected">移动模型</button>
          <button class="primary" type="button" :disabled="saving" @click="openModelPicker('replace')">选择替换模型</button>
          <button class="danger" type="button" :disabled="saving" @click="saveSelection('delete')">删除单体</button>
        </div>
      </section>
    </div>

    <ModelPicker
      v-if="modelPickerMode"
      :title="modelPickerTitle"
      @cancel="modelPickerMode = ''"
      @confirm="confirmModel"
    />
  </div>
</template>

<script>
import { hideFeature, loadDeletedFeatureIds, loadPlacement, loadTilesetConfig, movePlacement, restoreFeatureChange, savePlacement } from "./api";
import FeatureChanges from "./FeatureChanges.vue";
import ModelPicker from "./ModelPicker.vue";
import ModelPlacement from "./ModelPlacement.vue";
import TilesetScene from "./tileset-scene";
import { DYNAMIC_TILESET_ID } from "./feature-id";

const CAMERA_FIELDS = [
  { key: "lon", label: "经度", decimals: 8, unit: "°" },
  { key: "lat", label: "纬度", decimals: 8, unit: "°" },
  { key: "height", label: "高度", decimals: 3, unit: " m" },
  { key: "heading", label: "航向角", decimals: 3, unit: "°" },
  { key: "pitch", label: "俯仰角", decimals: 3, unit: "°" },
  { key: "roll", label: "横滚角", decimals: 3, unit: "°" },
];

export default {
  components: { FeatureChanges, ModelPicker, ModelPlacement },
  data() {
    return {
      layers: [],
      layersOpen: false,
      changesOpen: false,
      changesRevision: 0,
      reloading: false,
      sceneReady: false,
      globeVisible: true,
      cameraOpen: false,
      cameraViewPoint: undefined,
      status: "正在读取图层配置…",
      canRetry: false,
      canRetryDynamic: false,
      selected: undefined,
      saving: false,
      modelPickerMode: "",
      placement: null,
      placementError: "",
      selectionError: "",
    };
  },
  computed: {
    placementActive() {
      return Boolean(this.placement || this.modelPickerMode);
    },
    canMoveSelected() {
      return this.selected?.layerId === DYNAMIC_TILESET_ID;
    },
    modelPickerTitle() {
      return this.modelPickerMode === "replace" ? "选择替换模型" : "选择摆放模型";
    },
    cameraParameters() {
      if (!this.cameraViewPoint) return [];
      return CAMERA_FIELDS.map(({ key, label, decimals, unit }) => ({
        label,
        value: this.cameraViewPoint[key].toFixed(decimals) + unit,
      }));
    },
    viewPointJson() {
      if (!this.cameraViewPoint) return "";
      const viewPoint = {};
      for (const { key, decimals } of CAMERA_FIELDS) {
        viewPoint[key] = Number(this.cameraViewPoint[key].toFixed(decimals));
      }
      return JSON.stringify({ viewPoint }, null, 2);
    },
  },
  created() {
    // Viewer 和瓦片对象由场景实例持有，避免 Vue 2 深度观察。
    this.sceneController = undefined;
    this.disposed = false;
    this.pendingMoveKeys = new Set();
  },
  mounted() {
    this.start();
  },
  beforeDestroy() {
    this.disposed = true;
    this.stopCameraUpdates?.();
    this.$refs.placement?.disposePlacement();
    this.sceneController?.destroy();
  },
  methods: {
    async start() {
      this.canRetry = false;
      this.status = "正在读取图层配置…";
      let configs;
      let deletedIds;
      try {
        [configs, deletedIds] = await loadTilesetConfig();
        if (!Array.isArray(configs) || !Array.isArray(deletedIds)) {
          throw new Error("Mock 接口应返回数组。");
        }
      } catch (error) {
        if (this.disposed) return;
        this.status = `读取图层配置或隐藏记录失败。 ${error.message}`;
        this.canRetry = true;
        return;
      }

      if (this.disposed) return;
      try {
        this.sceneController = new TilesetScene(this.$refs.scene, configs, deletedIds, this.onSceneClick);
      } catch (error) {
        this.status = "无法初始化三维场景，请检查浏览器的 WebGL 支持。";
        console.error(error);
        return;
      }

      this.sceneReady = true;
      this.layers = configs.map((config) => ({
        config,
        enabled: config.defaultLoad === true,
        tilesetReady: false,
        status: "已关闭",
      }));
      this.status = "点击场景中的单体，查看操作选项。";
      await this.sceneController.loadDefaults(this.layers);
    },

    toggleGlobe() {
      this.globeVisible = !this.globeVisible;
      this.sceneController.setGlobeVisible(this.globeVisible);
    },

    toggleLayers() {
      this.layersOpen = !this.layersOpen;
      if (this.layersOpen) this.changesOpen = false;
    },

    toggleChanges() {
      this.changesOpen = !this.changesOpen;
      if (this.changesOpen) this.layersOpen = false;
    },

    toggleCamera() {
      this.cameraOpen = !this.cameraOpen;
      if (this.cameraOpen) {
        this.stopCameraUpdates = this.sceneController.watchCamera((camera) => {
          this.cameraViewPoint = camera;
        });
      } else {
        this.stopCameraUpdates();
        this.stopCameraUpdates = undefined;
      }
    },

    async reloadAllLayers() {
      if (!this.sceneReady || this.saving || this.reloading || this.placementActive) return;
      this.reloading = true;
      this.selectFeature();
      this.status = "正在重新加载所有 Tileset…";

      try {
        const results = await Promise.all(this.layers.map((layer) => this.sceneController.reloadLayer(layer)));
        if (this.disposed) return;
        const failed = results.filter((loaded) => !loaded).length;
        const dynamicIndex = this.layers.findIndex(({ config }) => config.id === DYNAMIC_TILESET_ID);
        if (results[dynamicIndex]) {
          this.canRetryDynamic = false;
          this.releasePendingMoveMasks();
        }
        this.status = failed ? `${failed} 个图层重载失败，可再次点击重载。` : "所有 Tileset 已重新加载。";
      } finally {
        if (!this.disposed) this.reloading = false;
      }
    },

    updateLayer(layer) {
      if (!layer.enabled && this.selected?.layerId === layer.config.id && !this.saving) {
        this.selectFeature();
      }
      this.sceneController.updateLayer(layer);
    },

    locate(layer) {
      this.sceneController.locate(layer);
    },

    async locateChange(record) {
      const { tilesetId, id, worldBounds } = record;
      if (this.selected?.key === id) this.selectFeature();
      if (worldBounds) {
        this.sceneController.flyToFeatureBounds(worldBounds);
        this.status = record.deleted ? "正在定位已删除单体的原位置。" : "正在定位单体。";
        return;
      }
      const tileBounds = this.sceneController.findLoadedFeatureBounds(tilesetId, id);
      if (tileBounds) {
        this.sceneController.flyToFeatureBounds(tileBounds);
        this.status = "旧记录缺少单体坐标，已定位到所在瓦片。";
        return;
      }
      const layer = this.layers.find(({ config }) => config.id === tilesetId);
      if (!layer) {
        this.status = "该记录没有位置，其原图层也不在场景配置中。";
        return;
      }
      if (!layer.tilesetReady) await this.sceneController.reloadLayer(layer);
      if (this.disposed) return;
      this.status = await this.sceneController.locate(layer)
        ? "旧记录缺少单体坐标，已定位到原图层。"
        : "该记录缺少单体坐标，暂时无法定位原图层。";
    },

    async restoreChange(record) {
      if (!this.sceneReady || this.saving || this.reloading || this.placementActive) return;
      this.saving = true;
      try {
        await restoreFeatureChange(record.id);
        if (this.disposed) return;
        this.changesRevision++;
        this.sceneController.restore(record.id);
        const [deleted, dynamic] = await Promise.allSettled([
          loadDeletedFeatureIds(),
          this.refreshDynamic("单体已恢复。"),
        ]);
        if (this.disposed) return;
        if (deleted.status === "fulfilled") {
          this.sceneController.setDeletedKeys(deleted.value);
        } else {
          this.status = "单体已恢复，隐藏列表同步失败，刷新页面可同步。";
        }
        if (dynamic.status === "rejected" || !dynamic.value) {
          this.status += " 动态图层刷新失败。";
        }
      } catch (error) {
        if (!this.disposed) this.status = `恢复失败。 ${error.message}`;
      } finally {
        if (!this.disposed) this.saving = false;
      }
    },

    onSceneClick(position) {
      if (this.saving || this.reloading || this.modelPickerMode) return;
      if (this.placement) {
        this.$refs.placement?.pickAnchor(position);
        return;
      }

      const feature = this.sceneController.pick(position);
      if (feature?.missingId) {
        this.selectFeature();
        this.status = "当前拾取对象缺少可操作的单体 ID。";
        return;
      }
      const anchor = feature ? this.sceneController.pickPlacementPosition(position, false) : undefined;
      this.selectFeature(feature, anchor);
    },

    selectFeature(feature, anchor) {
      this.selectedAnchor = anchor;
      this.selected = feature;
      this.selectionError = "";
      this.sceneController.select(feature?.key);
    },

    openModelPicker(mode) {
      if (mode === "replace") this.selectionError = "";
      this.modelPickerMode = mode;
    },

    confirmModel(model) {
      const mode = this.modelPickerMode;
      this.modelPickerMode = "";
      this.beginPlacement(model, mode === "replace" ? this.selected : null);
    },

    async moveSelected() {
      if (!this.canMoveSelected || this.saving || this.reloading || this.placementActive) return;
      const source = this.selected;
      this.saving = true;
      this.selectionError = "";
      try {
        const record = await loadPlacement(source.id);
        if (this.disposed) return;
        this.beginPlacement({
          id: record.modelId, name: record.modelName, url: record.url, frontMaterial: record.frontMaterial,
        }, source, record);
      } catch (error) {
        if (!this.disposed) this.selectionError = error.message;
      } finally {
        if (!this.disposed) this.saving = false;
      }
    },

    beginPlacement(model, source, initialPlacement = null) {
      const anchor = source ? this.selectedAnchor ?? null : null;
      this.sceneController.select(undefined);
      this.placementError = "";
      this.placement = Object.freeze({ model, source, anchor, initialPlacement });
      if (anchor || initialPlacement) this.setPlacementSourceHidden(true);
      this.status = initialPlacement ? "正在移动模型。" : source ? "正在摆放替换模型。" : "请单击场景选择落点。";
    },

    setPlacementSourceHidden(hidden) {
      const source = this.placement?.source;
      if (source) this.sceneController.setTemporaryHidden(source.key, hidden);
    },

    cancelPlacement() {
      if (this.saving || !this.placement) return;
      const { source, anchor } = this.placement;
      this.$refs.placement?.disposePlacement();
      this.setPlacementSourceHidden(false);
      this.placement = null;
      this.selectFeature(source, anchor);
      this.status = "已取消摆放。";
    },

    releasePendingMoveMasks() {
      for (const key of this.pendingMoveKeys) this.sceneController.setTemporaryHidden(key, false);
      this.pendingMoveKeys.clear();
    },

    async refreshDynamic(successMessage, enable = false) {
      const layer = this.layers.find(({ config }) => config.id === DYNAMIC_TILESET_ID);
      if (enable) layer.enabled = true;
      this.canRetryDynamic = false;
      const refreshed = await this.sceneController.reloadLayer(layer);
      if (this.disposed) return;
      if (refreshed) this.releasePendingMoveMasks();
      this.canRetryDynamic = !refreshed && layer.enabled;
      this.status = this.canRetryDynamic ? "变更已保存，刷新动态模型失败，请重试。" : successMessage;
      return refreshed;
    },

    async retryDynamic() {
      if (this.saving || this.reloading || this.placementActive) return;
      this.saving = true;
      try {
        await this.refreshDynamic("动态模型已刷新。", true);
      } finally {
        if (!this.disposed) this.saving = false;
      }
    },

    async confirmPlacement(placedModel) {
      if (this.saving || !this.placement) return;
      const { source, initialPlacement } = this.placement;
      this.saving = true;
      this.placementError = "";
      try {
        if (initialPlacement) {
          await movePlacement(source.id, placedModel.modelMatrix, placedModel.frontTexture);
        } else {
          const { anchor } = this.placement;
          await savePlacement(placedModel, source
            ? { tilesetId: source.layerId, featureId: source.id, worldBounds: this.anchorBounds(anchor) }
            : undefined);
        }
        if (this.disposed) return;
        this.changesRevision++;

        this.$refs.placement.disposePlacement();
        if (initialPlacement) {
          // 新旧瓦片使用同一 ID，刷新成功后再解除遮罩，避免旧位置重新出现。
          this.pendingMoveKeys.add(source.key);
        } else if (source) {
          this.sceneController.hide(source.key);
          this.setPlacementSourceHidden(false);
        }
        this.placement = null;
        this.selectFeature();
        const message = initialPlacement ? "模型移动已保存。" : source ? "替换模型已保存。" : "模型摆放已保存。";
        await this.refreshDynamic(message, true);
      } catch (error) {
        if (!this.disposed) this.placementError = error.message;
      } finally {
        if (!this.disposed) this.saving = false;
      }
    },

    async saveSelection(action) {
      if (!this.selected || this.saving) return;
      const { layerId, id, key } = this.selected;
      this.saving = true;
      this.selectionError = "";
      try {
        await hideFeature(layerId, id, action, undefined, this.anchorBounds(this.selectedAnchor));
        if (this.disposed) return;
        this.changesRevision++;
        this.sceneController.hide(key);
        this.selectFeature();
        if (layerId === DYNAMIC_TILESET_ID) await this.refreshDynamic("动态单体已删除。");
        else this.status = "已删除，单体已隐藏。";
      } catch (error) {
        if (!this.disposed) this.selectionError = error.message;
      } finally {
        if (!this.disposed) this.saving = false;
      }
    },

    anchorBounds(anchor) {
      return anchor ? [anchor.x, anchor.y, anchor.z, 1] : undefined;
    },
  },
};
</script>
