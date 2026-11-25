# Vue2 Cesium Tileset 单体演示

使用 Vue 2.7.16、Vue CLI 4.5.19（Webpack 4）和 Cesium 1.136.0 加载 3D Tiles。

## 启动

使用 Node.js 22.12 或更新版本，在仓库根目录运行。

```bash
cd vue2-cesium-tileset-demo
npm ci
npm run serve
```

打开 [http://localhost:8080](http://localhost:8080)。Vue CLI 开发服务同时提供页面和 mock API。可用 `npm run serve -- --port 8081` 切换端口。`MOCK_DATA_FILE` 可指定操作记录文件。

## 页面功能与操作

| 功能 | 操作方法 |
| --- | --- |
| 图层开关与定位 | 点击顶部「图层」打开面板，勾选图层名称以加载或显示图层，取消勾选以隐藏。点击该行「定位」跳到图层位置，已加载的隐藏图层也可以定位。 |
| 重新加载瓦片 | 点击图层面板的「重新加载所有 Tileset」。页面会重新请求各图层配置，包括「动态模型」和已关闭的图层，并保留开关状态。 |
| 地球与相机 | 点击「隐藏地球」或「显示地球」切换地球和底图。点击「相机参数」查看实时经纬度、高度、方向角和可复制的 `viewPoint` 配置。右上角导航控件可调整方向、缩放并返回上海初始视角，左下角显示距离比例尺。 |
| 拾取与删除单体 | 单击模型可高亮单体，并在「已选单体」面板查看图层和 ID。点击「删除单体」保存隐藏状态。 |
| 查询修改信息 | 点击顶部「修改信息」。可按模型 ID、单体 ID 搜索，按「已删除」或「正常」筛选，并用「上一页」「下一页」翻页。 |
| 定位与恢复修改记录 | 点击记录的「定位」飞到单体位置，已删除单体可定位到原位置。缺少坐标的旧记录定位到已加载的所在瓦片或原图层。点击「恢复」重新显示该单体，页面同步隐藏列表并刷新动态图层。恢复被替换的原单体时，替换模型仍保留。 |
| 从模型库摆放 | 点击「摆放模型」，依次选择模型大类、小类和名称，查看预览并点击「确定选择」。单击场景选择落点，调整模型后点击「确定摆放」。 |
| 替换单体 | 选中原单体，点击「选择替换模型」，从模型库选模型。优先使用原来的点击位置，深度不可用时可重新选择落点。点击「确定摆放」后保存新模型并隐藏原单体。 |
| 移动动态模型 | 选中「动态模型」图层中的单体，点击「移动模型」。编辑从已保存的变换开始，点击「确定移动」后按原 ID 保存。 |
| 调整模型变换 | 在编辑面板选择「平移」「旋转」或「缩放」，并选择地表坐标系（东／北／上）或模型自身坐标系。勾选「允许拖动」后，用左键拖动 Gizmo 的轴或平面。红、绿、蓝分别对应 X、Y、Z。也可点击「重置模型」或「定位模型」。 |
| 更换标志牌正面贴图 | 摆放或移动支持换图的标志牌时，点击「上传正面图片」，选择不超过 4 MB 的 PNG 或 JPEG。确认前可在面板和场景中预览。 |

确认摆放、替换或移动后，页面会刷新「动态模型」图层。替换或移动期间原单体会临时隐藏，取消或模型加载失败时会恢复显示。刷新页面后，已保存的模型和隐藏状态会恢复。

页面按 `defaultLoad` 加载图层，默认加载「动态模型」，并优先定位到启用且配置 `focus: true` 的图层。图层的 `tileset.json` 加载成功后即可定位，子瓦片会随视角继续加载。

手动定位和启动时自动定位均优先使用图层的 `viewPoint`。其中 `lon`、`lat`、`heading`、`pitch` 和 `roll` 使用角度，`height` 为椭球高（米）。配置缺失或数值无效时，使用图层范围定位。

场景使用高德卫星影像作为默认底图，由浏览器直接请求高德瓦片。

浏览器需要支持 WebGL2，并能访问瓦片地址及其子资源。远程服务需提供浏览器信任且与请求主机匹配的 HTTPS 证书，并允许页面来源跨域读取。瓦片地址在 `mock/tilesets.json` 中配置。

## Mock API

| 请求 | 数据 |
| --- | --- |
| `GET /api/tilesets` | 配置的图层及「动态模型」图层 |
| `GET /api/tilesets/deleted` | 所有已删除或被替换的组合 ID 数组，例如 `["tunnel:abc_1"]` |
| `GET /api/tilesets/changes` | 从修改记录分页查询，支持 `page`（默认 1）、`pageSize`（默认 10，最多 100）、`modelId`、`featureId`（不区分大小写的子串匹配）及 `status`（`all`、`deleted` 或 `active`）。返回 `items`、`total`、`page`、`pageSize`，有位置的记录包含 ECEF 包围球数组 `worldBounds`。 |
| `POST /api/tilesets/changes/restore` | 接收 `{ "id": "tunnel:abc_1" }`，恢复该记录对应的单体并返回更新后的记录摘要。 |
| `DELETE /api/tilesets/feature` | 接收下方 JSON 并返回包含组合 `id` 的保存记录 |
| `POST /api/tilesets/placements` | 保存摆放。接收 `placementId`（UUID）、`modelId`、`modelMatrix`（列主序 ECEF）和 `localBounds`（局部包围球四个数），替换时另传 `replacement: { tilesetId, featureId }`，可换贴图的标志牌可传 `frontTexture` |
| `GET /api/tilesets/placements/:featureId` | 读取动态单体保存的模型地址、变换矩阵、局部包围球和自定义贴图 |
| `PUT /api/tilesets/placements/:featureId` | 接收 `modelMatrix`，可同时传 `frontTexture` 更新正面贴图 |
| `GET /api/tilesets/dynamic` | 返回 3D Tiles 1.1，按摆放记录引用原模型或应用了自定义贴图的 glTF，单体 ID 写在 `content.metadata.properties.id` |

```json
{
  "tilesetId": "tunnel",
  "featureId": "abc_1",
  "action": "replace",
  "modelId": "sxj_01_01"
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

## 模型库配置

- `GET /api/models` 返回模型数组。编辑 `mock/models.json` 增加条目，将对应的 GLB 或 glTF 文件及其依赖放入 `mock/models/` 后重启服务。开发服务和构建后的服务都通过 `/api/models/files/` 提供文件。
- 项目自带示例覆盖设备（相机、雷达、ETC）、龙门架和标志牌。Three.js 在首次生成预览时创建一个 WebGLRenderer，后续预览复用该实例。

模型条目示例：

```json
{
  "id": "sxj_01_01",
  "category": "设备",
  "subcategory": "相机",
  "name": "枪式相机",
  "url": "/api/models/files/sxj_01_01.glb"
}
```

### 标志牌正面贴图

模型库的「矩形标志牌」使用 `Rect.gltf`。其他 glTF 模型可以在 `mock/models.json` 中设置 `frontMaterial`，值为 glTF 中带基础颜色贴图的正面材质名称。

确认摆放或移动后，服务将图片以 Base64 data URL 保存到 `.mock-data/changed-features.json` 的 `frontTexture` 字段。动态 Tileset 会加载带贴图的 glTF，再次移动同一标志牌时会恢复贴图和图片预览。
