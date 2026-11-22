# Vue2 Cesium Tileset 单体演示

使用 Vue 2.7.16、Vue CLI 4.5.19（Webpack 4）和 Cesium 1.136.0 加载 3D Tiles。支持图层开关、定位、单体拾取高亮、删除、替换和移动动态模型。

## 启动

使用 Node.js 22.12 或更新版本，在仓库根目录运行。

```bash
cd vue2-cesium-tileset-demo
npm ci
npm run serve
```

打开 [http://localhost:8080](http://localhost:8080)。Vue CLI 开发服务同时提供页面和 mock API。可用 `npm run serve -- --port 8081` 切换端口。`MOCK_DATA_FILE` 可指定操作记录文件。

页面按图层的 `defaultLoad` 配置加载图层，优先定位到启用且设置 `focus: true` 的图层。勾选其他图层可加载数据。点击场景中的单体后，可选择「删除单体」或「选择替换模型」。

图层的 `tileset.json` 加载成功后即可定位，子瓦片会随视角继续加载。关闭已加载的图层后仍可定位到其范围，图层继续保持隐藏。

手动定位和启动时的自动定位都会优先使用图层配置里的 `viewPoint`。其中 `lon`、`lat`、`heading`、`pitch` 和 `roll` 使用角度，`height` 为椭球高（米），表示相机位置。配置缺失或数值无效时，使用图层范围定位。

顶部工具栏可以开关左侧图层栏、显示或隐藏地球，并查看实时相机参数。图层栏中的「重新加载所有 Tileset」会重新请求各图层的 tileset，包括「动态模型」和已关闭的图层，并保留图层开关状态。隐藏地球时，底图随地球隐藏，已打开的 3D Tiles 图层继续显示。

右上角的导航控件支持调整方向、放大、缩小和返回上海初始视角。左下角显示距离比例尺。

场景使用高德卫星影像作为默认底图，由浏览器直接请求高德瓦片。

浏览器需要支持 WebGL2，并能访问瓦片地址及其子资源。远程服务需提供浏览器信任且与请求主机匹配的 HTTPS 证书，并允许页面来源跨域读取。瓦片地址在 `mock/tilesets.json` 中配置。

## Mock API

| 请求 | 数据 |
| --- | --- |
| `GET /api/tilesets` | 配置的图层及「动态模型」图层 |
| `GET /api/tilesets/deleted` | 所有已删除或被替换的组合 ID 数组，例如 `["tunnel:abc_1"]` |
| `GET /api/tileset/deleted` | 同一隐藏列表的兼容路径 |
| `DELETE /api/tilesets/feature` | 接收下方 JSON 并返回包含组合 `id` 的保存记录 |
| `POST /api/tilesets/placements` | 保存摆放。接收 `placementId`（UUID）、`modelId`、`modelMatrix`（列主序 ECEF）和 `localBounds`（局部包围球四个数），替换时另传 `replacement: { tilesetId, featureId }` |
| `GET /api/tilesets/placements/:featureId` | 读取动态单体保存的 GLB 地址、变换矩阵和局部包围球 |
| `PUT /api/tilesets/placements/:featureId` | 接收 `modelMatrix`，更新同一动态单体的变换 |
| `GET /api/tilesets/dynamic` | 返回 3D Tiles 1.1，按摆放记录引用模型库 GLB，单体 ID 写在 `content.metadata.properties.id` |

```json
{
  "tilesetId": "tunnel",
  "featureId": "abc_1",
  "action": "replace",
  "modelId": "camera-01"
}
```

`action` 可取 `delete` 或 `replace`，省略时默认为 `delete`。替换操作可传入模型库中的 `modelId`。单体 ID 来自瓦片 feature 的 `id` 属性，允许字符串或安全整数。通过 `tilesetId:featureId` 匹配单体，同一图层的各级瓦片应给同一单体提供相同的 ID。配置里的 `hideFeatureIds` 会应用到本层。隧道的 `clip` 参数随接口返回，裁剪交互留待后续实现。

摆放和隐藏记录默认共用 `.mock-data/changed-features.json`，每项使用 `deleted` 标志记录隐藏状态。使用默认路径时，如果新文件不存在，服务启动时会将旧的 `deleted-features.json` 迁移为新文件名。刷新页面和重启服务都会恢复已保存的模型和隐藏状态。停止服务后可删除该文件来重置操作记录。

## 构建和运行

```bash
npm run build
npm start
```

构建生成 `dist/`。运行服务从同一端口提供构建产物和 mock API，`PORT` 可修改默认端口 8080。部署时保留 `mock/`、`src/feature-id.js`、`dist/` 以及生产依赖。Cesium 预构建脚本、样式、Workers 和静态资源会复制到 `dist/vendor/cesium/`。

`src/App.vue` 管理图层面板和操作状态，`src/tileset-scene.js` 管理 Cesium 场景、瓦片加载以及单体拾取和高亮。开发与构建运行共用 `mock/api.js`。

## 模型库和预览

- 通过工具栏「摆放模型」或单体面板「选择替换模型」打开模型库，再依次选择模型大类、小类和名称。选中名称后会生成 PNG 预览。
- 选中场景单体后，点击「选择替换模型」进入摆放。确认摆放后，服务在同一次写入中保存新模型并隐藏原单体。
- `GET /api/models` 返回模型数组。编辑 `mock/models.json` 增加条目，将对应的 GLB 文件放入 `mock/models/` 后重启服务。开发服务和构建后的服务都通过 `/api/models/files/<文件名>.glb` 提供文件。
- 项目自带六个简化示例，覆盖设备（相机、雷达、ETC）、龙门架和标志牌。Three.js 在首次生成预览时创建一个 WebGLRenderer，后续预览复用该实例。

模型条目示例：

```json
{
  "id": "camera-01",
  "category": "设备",
  "subcategory": "相机",
  "name": "枪式相机",
  "url": "/api/models/files/camera-01.glb"
}
```


## 场景内摆放

- 点击工具栏「摆放模型」，从模型库选择 GLB，再单击场景落点。进入替换时优先使用选中原单体的点击位置，深度不可用时可重新选择落点。
- 左侧面板沿用 Gizmo 演示中的平移、旋转、缩放、地表/模型坐标系、位置和缩放信息，以及重置和定位按钮。
- 选中动态单体后，点击「移动模型」，使用已保存的位置、角度和缩放进入 Gizmo 编辑。确认后沿用原单体 ID 更新变换。
- 替换或移动时，场景会临时隐藏原单体。取消或模型加载失败时恢复显示，确认替换后原单体保留为隐藏记录。
- 确认后，页面移除编辑预览并重新加载「动态模型」图层。启动时自动加载该图层。
