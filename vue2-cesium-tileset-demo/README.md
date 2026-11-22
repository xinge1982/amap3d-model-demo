# Vue2 Cesium Tileset 单体演示

使用 Vue 2.7.16、Vue CLI 4.5.19（Webpack 4）和 Cesium 1.136.0 加载 3D Tiles。支持图层开关、定位、单体拾取高亮、删除和标记替换。标记替换会记录操作并隐藏原单体，新模型的上传和摆放留待后续实现。

## 启动

使用 Node.js 22.12 或更新版本，在仓库根目录运行。

```bash
cd vue2-cesium-tileset-demo
npm ci
npm run serve
```

打开 [http://localhost:8080](http://localhost:8080)。Vue CLI 开发服务同时提供页面和 mock API。可用 `npm run serve -- --port 8081` 切换端口。`MOCK_DATA_FILE` 可指定操作记录文件。

默认打开道路面、隧道和新建路隧道，优先定位到新建路隧道。勾选其他图层可加载数据。点击场景中的单体后，可选择「删除单体」或「标记替换」。

场景使用高德卫星影像作为默认底图，由浏览器直接请求高德瓦片。

浏览器需要支持 WebGL2，并能访问瓦片地址及其子资源。远程服务需提供浏览器信任且与请求主机匹配的 HTTPS 证书，并允许页面来源跨域读取。瓦片地址在 `mock/tilesets.json` 中配置。

## Mock API

| 请求 | 数据 |
| --- | --- |
| `GET /api/tilesets` | 七个图层的配置数组 |
| `GET /api/tilesets/deleted` | 已删除或已标记替换的组合 ID 数组，例如 `["tunnel:abc_1"]` |
| `GET /api/tileset/deleted` | 同一隐藏列表的兼容路径 |
| `DELETE /api/tilesets/feature` | 接收下方 JSON 并返回包含组合 `id` 的保存记录 |

```json
{
  "tilesetId": "tunnel",
  "featureId": "abc_1",
  "action": "replace"
}
```

`action` 可取 `delete` 或 `replace`，省略时默认为 `delete`。单体 ID 来自瓦片 feature 的 `id` 属性，允许字符串或安全整数。通过 `tilesetId:featureId` 匹配单体，同一图层的各级瓦片应给同一单体提供相同的 ID。配置里的 `hideFeatureIds` 会应用到本层。隧道的 `clip` 参数随接口返回，裁剪交互留待后续实现。

操作记录默认写入 `.mock-data/deleted-features.json`。刷新页面和重启服务都会恢复隐藏状态。停止服务后可删除该文件来重置操作记录。

## 构建和运行

```bash
npm run build
npm start
```

构建生成 `dist/`。运行服务从同一端口提供构建产物和 mock API，`PORT` 可修改默认端口 8080。部署时保留 `mock/`、`src/feature-id.js`、`dist/` 以及生产依赖。Cesium 预构建脚本、样式、Workers 和静态资源会复制到 `dist/vendor/cesium/`。

`src/App.vue` 管理图层面板和操作状态，`src/tileset-scene.js` 管理 Cesium 场景、瓦片加载以及单体拾取和高亮。开发与构建运行共用 `mock/api.js`。
