const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const express = require("express");
const createMockApi = require("./api");

const dist = resolve(__dirname, "../dist");
if (!existsSync(resolve(dist, "index.html"))) {
  console.error("请先运行 npm run build 生成 dist。");
  process.exit(1);
}

const app = express();
app.use("/api", createMockApi());
app.use(express.static(dist));

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`Vue2 Cesium Tileset Demo  http://localhost:${port}`);
});
