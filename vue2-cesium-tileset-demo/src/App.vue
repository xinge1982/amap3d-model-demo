<template>
  <div>
    <main id="scene" ref="scene" aria-label="Cesium 三维场景"></main>

    <aside class="panel layers" aria-labelledby="layers-title">
      <header>
        <p class="brand">AMap3D</p>
        <h1 id="layers-title">Tileset 单体演示</h1>
      </header>
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
      <p id="status" role="status">{{ status }}</p>
      <button v-if="canRetry" id="retry-start" type="button" @click="start">重新读取配置</button>
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

      this.layers = configs.map((config) => ({
        config,
        enabled: config.defaultLoad === true,
        tilesetReady: false,
        status: "已关闭",
      }));
      this.status = "点击场景中的单体，查看操作选项。";
      await this.sceneController.loadDefaults(this.layers);
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
