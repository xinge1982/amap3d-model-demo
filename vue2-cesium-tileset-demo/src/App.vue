<template>
  <div class="app-shell">
    <header class="toolbar">
      <div class="toolbar-title">
        <p class="brand">AMap3D</p>
        <h1>Tileset 单体演示</h1>
      </div>
      <div class="toolbar-actions" role="group" aria-label="场景工具">
        <button type="button" :aria-expanded="String(layersOpen)" aria-controls="layers-panel" @click="layersOpen = !layersOpen">
          图层（{{ layers.length }}）
        </button>
        <button type="button" :disabled="!sceneReady" @click="toggleGlobe">
          {{ globeVisible ? "隐藏地球" : "显示地球" }}
        </button>
        <button type="button" :disabled="!sceneReady" :aria-expanded="String(cameraOpen)" aria-controls="camera-panel" @click="toggleCamera">
          相机参数
        </button>
      </div>
      <div class="toolbar-feedback">
        <p id="status" role="status">{{ status }}</p>
        <button v-if="canRetry" id="retry-start" type="button" @click="start">重新读取配置</button>
      </div>
    </header>

    <div class="workspace" :class="{ 'globe-hidden': !globeVisible }">
      <main id="scene" ref="scene" aria-label="Cesium 三维场景"></main>

      <aside v-show="layersOpen" id="layers-panel" class="panel layers" aria-labelledby="layers-title">
        <h2 id="layers-title">场景图层</h2>
        <button class="model-library-button" type="button" :disabled="saving" @click="openModelPicker('browse')">模型库</button>
        <p v-if="libraryModel" class="library-choice">已选模型：{{ libraryModel.name }}</p>
        <ul id="layer-list" aria-label="场景图层">
          <li v-for="layer in layers" :key="layer.config.id" class="layer">
            <label>
              <input v-model="layer.enabled" type="checkbox" @change="updateLayer(layer)">
              {{ layer.config.name }}
            </label>
            <button
              type="button"
              :aria-label="`定位${layer.config.name}`"
              :disabled="!layer.tilesetReady"
              @click="locate(layer)"
            >定位</button>
            <small>{{ layer.status }}</small>
          </li>
        </ul>
      </aside>

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
      </aside>

      <section v-if="selected" class="panel selection" aria-labelledby="selection-title">
        <header class="selection-heading">
          <h2 id="selection-title">已选单体</h2>
          <button type="button" aria-label="取消选择" :disabled="saving" @click="selectFeature()">关闭</button>
        </header>
        <dl>
          <dt>图层</dt><dd>{{ selected.layerName }}</dd>
          <dt>单体 ID</dt><dd>{{ selected.id }}</dd>
        </dl>
        <p>删除或标记替换后，原单体将从场景中隐藏。</p>
        <p v-if="selectionError" id="selection-error" role="alert">{{ selectionError }}</p>
        <div class="actions">
          <button class="primary" type="button" :disabled="saving" @click="openModelPicker('replace')">选择替换模型</button>
          <button class="danger" type="button" :disabled="saving" @click="saveSelection('delete')">删除单体</button>
        </div>
      </section>
    </div>

    <ModelPicker
      v-if="modelPickerMode"
      :title="modelPickerMode === 'replace' ? '选择替换模型' : '模型库'"
      @cancel="modelPickerMode = ''"
      @confirm="confirmModel"
    />
  </div>
</template>

<script>
import { hideFeature, loadTilesetConfig } from "./api";
import ModelPicker from "./ModelPicker.vue";
import TilesetScene from "./tileset-scene";

export default {
  components: { ModelPicker },
  data() {
    return {
      layers: [],
      layersOpen: true,
      sceneReady: false,
      globeVisible: true,
      cameraOpen: false,
      cameraParameters: [],
      status: "正在读取图层配置…",
      canRetry: false,
      selected: undefined,
      saving: false,
      modelPickerMode: "",
      libraryModel: undefined,
      selectionError: "",
    };
  },
  created() {
    // Viewer 和瓦片对象由场景实例持有，避免 Vue 2 深度观察。
    this.sceneController = undefined;
    this.disposed = false;
  },
  mounted() {
    this.start();
  },
  beforeDestroy() {
    this.disposed = true;
    this.stopCameraUpdates?.();
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
        this.sceneController = new TilesetScene(this.$refs.scene, configs, deletedIds, this.onPick);
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

    toggleCamera() {
      this.cameraOpen = !this.cameraOpen;
      if (this.cameraOpen) {
        this.stopCameraUpdates = this.sceneController.watchCamera((camera) => {
          this.cameraParameters = [
            { label: "经度", value: `${camera.lon.toFixed(8)}°` },
            { label: "纬度", value: `${camera.lat.toFixed(8)}°` },
            { label: "高度", value: `${camera.height.toFixed(3)} m` },
            { label: "航向角", value: `${camera.heading.toFixed(3)}°` },
            { label: "俯仰角", value: `${camera.pitch.toFixed(3)}°` },
            { label: "横滚角", value: `${camera.roll.toFixed(3)}°` },
          ];
        });
      } else {
        this.stopCameraUpdates();
        this.stopCameraUpdates = undefined;
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

    onPick(feature) {
      if (this.saving) return;
      if (feature?.missingId) {
        this.selectFeature();
        this.status = "当前拾取对象缺少可操作的单体 ID。";
        return;
      }
      this.selectFeature(feature);
    },

    selectFeature(feature) {
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
      if (mode === "replace") {
        this.saveSelection("replace", model);
      } else {
        this.libraryModel = model;
      }
    },

    async saveSelection(action, model) {
      if (!this.selected || this.saving) return;
      const { layerId, id, key } = this.selected;
      this.saving = true;
      this.selectionError = "";
      try {
        await hideFeature(layerId, id, action, model?.id);
        if (this.disposed) return;
        this.sceneController.hide(key);
        this.selectFeature();
        this.status = action === "replace" ? `已标记替换为「${model.name}」，原单体已隐藏。` : "已删除，单体已隐藏。";
      } catch (error) {
        if (!this.disposed) this.selectionError = error.message;
      } finally {
        if (!this.disposed) this.saving = false;
      }
    },
  },
};
</script>
