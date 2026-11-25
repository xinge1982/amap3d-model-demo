<template>
  <aside id="changes-panel" class="panel changes-panel" aria-labelledby="changes-title">
    <header class="selection-heading">
      <h2 id="changes-title">修改信息</h2>
      <button type="button" @click="$emit('close')">关闭</button>
    </header>

    <form class="change-filters" @submit.prevent="search">
      <label>模型 ID<input v-model.trim="modelId" placeholder="modelId"></label>
      <label>单体 ID<input v-model.trim="featureId" placeholder="featureId"></label>
      <label>状态
        <select v-model="status" @change="search">
          <option value="all">全部</option>
          <option value="deleted">已删除</option>
          <option value="active">正常</option>
        </select>
      </label>
      <button type="submit">搜索</button>
    </form>

    <p v-if="error" class="changes-error" role="alert">{{ error }}</p>
    <p v-else-if="loading" role="status">正在读取修改信息…</p>
    <p v-else-if="!items.length" role="status">没有匹配的修改记录。</p>

    <table v-if="items.length && !error" :aria-busy="String(loading)">
      <thead>
        <tr>
          <th scope="col">单体 / 图层</th>
          <th scope="col">模型 ID</th>
          <th scope="col">状态 / 类型</th>
          <th scope="col">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td>{{ item.featureId }}<small>{{ item.tilesetId }}</small></td>
          <td>{{ item.modelId ?? '—' }}</td>
          <td>{{ item.deleted ? '已删除' : '正常' }}<small>{{ actionLabels[item.action] ?? '—' }}</small></td>
          <td>
            <div class="change-actions">
              <button type="button" :disabled="busy || loading || !sceneReady" @click="$emit('locate', item)">定位</button>
              <button v-if="item.deleted" type="button" :disabled="busy || loading || !sceneReady" @click="$emit('restore', item)">恢复</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <nav v-if="!error" class="change-pagination" aria-label="修改信息分页">
      <span aria-live="polite">共 {{ total }} 条，第 {{ page }} / {{ pageCount }} 页</span>
      <button type="button" :disabled="loading || page <= 1" @click="loadPage(page - 1)">上一页</button>
      <button type="button" :disabled="loading || page >= pageCount" @click="loadPage(page + 1)">下一页</button>
    </nav>
  </aside>
</template>

<script>
import { loadFeatureChanges } from "./api";

export default {
  props: {
    revision: Number,
    busy: Boolean,
    sceneReady: Boolean,
  },
  data() {
    return {
      modelId: "",
      featureId: "",
      status: "all",
      query: {},
      actionLabels: { place: "摆放", replace: "替换", delete: "删除" },
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
      loading: true,
      error: "",
    };
  },
  computed: {
    pageCount() {
      return Math.max(1, Math.ceil(this.total / this.pageSize));
    },
  },
  watch: {
    revision() {
      this.loadPage(this.page);
    },
  },
  created() {
    this.requestId = 0;
    this.search();
  },
  beforeDestroy() {
    this.requestId++;
  },
  methods: {
    search() {
      this.query = { modelId: this.modelId, featureId: this.featureId, status: this.status };
      this.loadPage(1);
    },
    async loadPage(page) {
      const requestId = ++this.requestId;
      this.loading = true;
      this.error = "";
      try {
        const data = await loadFeatureChanges({ ...this.query, page, pageSize: this.pageSize });
        if (requestId !== this.requestId) return;
        this.items = data.items;
        this.total = data.total;
        this.page = data.page;
        this.pageSize = data.pageSize;
      } catch (error) {
        if (requestId === this.requestId) this.error = error.message;
      } finally {
        if (requestId === this.requestId) this.loading = false;
      }
    },
  },
};
</script>

<style scoped>
.changes-panel {
  top: 1rem;
  left: 1rem;
  width: min(36rem, calc(100% - 2rem));
  max-height: calc(100% - 2rem);
  overflow: auto;
}

.change-filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto auto;
  align-items: end;
  gap: 0.5rem;
  margin: 0.85rem 0;
}

.change-filters label { display: grid; gap: 0.3rem; font-size: 0.85rem; }
.change-filters input,
.change-filters select {
  width: 100%;
  min-height: 2rem;
  min-width: 0;
  padding: 0.25rem 0.4rem;
  border: 1px solid #476071;
  border-radius: 0.35rem;
  background: #0c151e;
  color: inherit;
}

table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th, td { padding: 0.5rem 0.35rem; border-bottom: 1px solid #344956; text-align: left; }
td { overflow-wrap: anywhere; }
small { display: block; margin-top: 0.15rem; color: #bfd0db; }
.change-actions, .change-pagination { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; }
.change-actions button { white-space: nowrap; }
.change-pagination { justify-content: flex-end; margin-top: 0.8rem; font-size: 0.85rem; }
.change-pagination span { margin-right: auto; }
.changes-error { color: #ffc0c7; }

@media (max-width: 560px) {
  .change-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
