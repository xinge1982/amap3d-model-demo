<template>
  <dialog ref="dialog" class="model-picker" aria-labelledby="model-picker-title" @cancel.prevent="cancel">
    <form @submit.prevent="confirm">
      <header class="selection-heading">
        <h2 id="model-picker-title">{{ title }}</h2>
        <button type="button" autofocus @click="cancel">关闭</button>
      </header>
      <p v-if="loading" role="status">正在读取模型库…</p>
      <div v-else-if="catalogError" class="picker-error">
        <p role="alert">{{ catalogError }}</p>
        <button type="button" @click="loadCatalog">重新读取</button>
      </div>
      <p v-else-if="!models.length" role="status">模型库暂无可选模型。</p>
      <div v-else class="picker-body">
        <div class="picker-fields">
          <label>
            模型大类
            <select v-model="category" @change="changeCategory">
              <option value="" disabled>选择大类</option>
              <option v-for="value in categories" :key="value">{{ value }}</option>
            </select>
          </label>
          <label>
            模型小类
            <select v-model="subcategory" :disabled="!category" @change="changeSubcategory">
              <option value="" disabled>选择小类</option>
              <option v-for="value in subcategories" :key="value">{{ value }}</option>
            </select>
          </label>
          <label>
            模型名称
            <select v-model="modelId" :disabled="!subcategory">
              <option value="" disabled>选择模型</option>
              <option v-for="model in availableModels" :key="model.id" :value="model.id">{{ model.name }}</option>
            </select>
          </label>
        </div>
        <div class="picker-preview" aria-label="模型预览">
          <img v-if="thumbnail" :src="thumbnail" :alt="`${selectedModel.name}的预览`">
          <p v-else-if="previewLoading" role="status">正在生成预览…</p>
          <div v-else-if="previewError" class="picker-error">
            <p role="alert">{{ previewError }}</p>
            <button type="button" @click="updatePreview">重试预览</button>
          </div>
          <p v-else>选择模型后显示预览</p>
        </div>
      </div>
      <footer class="actions">
        <button type="button" @click="cancel">取消</button>
        <button class="primary" type="submit" :disabled="!selectedModel">确定选择</button>
      </footer>
    </form>
  </dialog>
</template>

<script>
import { loadModelCatalog } from "./api";

export default {
  props: {
    title: { type: String, required: true },
  },
  data() {
    return {
      models: [],
      category: "",
      subcategory: "",
      modelId: "",
      loading: true,
      catalogError: "",
      previewLoading: false,
      previewError: "",
      thumbnail: "",
    };
  },
  computed: {
    categories() {
      return [...new Set(this.models.map(({ category }) => category))];
    },
    categoryModels() {
      return this.models.filter(({ category }) => category === this.category);
    },
    subcategories() {
      return [...new Set(this.categoryModels.map(({ subcategory }) => subcategory))];
    },
    availableModels() {
      return this.categoryModels.filter(({ subcategory }) => subcategory === this.subcategory);
    },
    selectedModel() {
      return this.availableModels.find(({ id }) => id === this.modelId);
    },
  },
  watch: {
    selectedModel: "updatePreview",
  },
  created() {
    this.previewRequest = 0;
    this.disposed = false;
  },
  mounted() {
    this.$refs.dialog.showModal();
    this.loadCatalog();
  },
  beforeDestroy() {
    this.disposed = true;
    if (this.$refs.dialog.open) this.$refs.dialog.close();
  },
  methods: {
    async loadCatalog() {
      this.loading = true;
      this.catalogError = "";
      try {
        const data = await loadModelCatalog();
        if (!Array.isArray(data)) throw new Error("模型库接口应返回数组。");
        if (!this.disposed) this.models = data;
      } catch (error) {
        if (!this.disposed) this.catalogError = `读取模型库失败。 ${error.message}`;
      } finally {
        if (!this.disposed) this.loading = false;
      }
    },
    changeCategory() {
      this.subcategory = "";
      this.changeSubcategory();
    },
    changeSubcategory() {
      this.modelId = "";
    },
    async updatePreview() {
      const model = this.selectedModel;
      const request = ++this.previewRequest;
      const isCurrent = () => !this.disposed && request === this.previewRequest && this.selectedModel === model;
      this.thumbnail = "";
      this.previewError = "";
      this.previewLoading = Boolean(model);
      if (!model) return;
      try {
        const { generateThumbnail } = await import("./model-thumbnail");
        if (!isCurrent()) return;
        const image = await generateThumbnail(model.url, isCurrent);
        if (isCurrent()) this.thumbnail = image;
      } catch (error) {
        if (isCurrent()) {
          this.previewError = "无法生成模型预览。";
          console.error(model.url, error);
        }
      } finally {
        if (isCurrent()) this.previewLoading = false;
      }
    },
    cancel() {
      this.$emit("cancel");
    },
    confirm() {
      if (this.selectedModel) this.$emit("confirm", this.selectedModel);
    },
  },
};
</script>

<style scoped>
.model-picker {
  width: min(40rem, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  padding: 1.25rem;
  border: 1px solid #476071;
  border-radius: 0.85rem;
  background: #122232;
  color: inherit;
}

.model-picker::backdrop { background: #071019bf; }
.picker-body { display: grid; grid-template-columns: 1fr 1.25fr; gap: 1rem; margin-top: 1rem; }
.picker-fields { display: grid; align-content: start; gap: 0.85rem; }
.picker-fields label { display: grid; gap: 0.35rem; }
.picker-fields select {
  width: 100%;
  padding: 0.45rem;
  border: 1px solid #567086;
  border-radius: 0.35rem;
  background: #20364a;
  color: inherit;
  font: inherit;
}
.picker-fields select:focus-visible { outline: 2px solid #8debd9; outline-offset: 2px; }
.picker-preview {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  text-align: center;
  overflow: hidden;
  padding: 0.5rem;
  border: 1px solid #476071;
  border-radius: 0.5rem;
  background: #0b141f;
  color: #bfd0db;
}
.picker-preview img { display: block; width: 100%; border-radius: 0.25rem; }
.picker-error { color: #ffc0c7; }

@media (max-width: 540px) {
  .picker-body { grid-template-columns: 1fr; }
  .picker-preview { width: min(100%, 15rem); justify-self: center; }
}
</style>
