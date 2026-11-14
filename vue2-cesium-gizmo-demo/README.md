# Vue2 + Vue CLI 4.5 + Cesium Gizmo 示例

一个可直接安装、运行和打包的 Vue2 项目。模型 `public/models/luaz.glb` 已包含，无需自行下载。

## 固定版本

- Vue：2.7.16（Vue2 Options API）
- Vue CLI Service / Babel 插件：4.5.19（Webpack 4）
- Cesium：1.136.0
- cesium-transform-controls：1.2.8

使用 Node.js 22.12+ 的 22.x 版本和 npm。不要使用 Node.js 16：本例固定的 Cesium 版本需要更新的 Node。旧 CLI 的部分间接依赖可能提示 engine/deprecated 警告。

## 启动

在项目目录内运行：

```bash
npm install
npm run serve
```

浏览器打开开发服务输出的地址，默认 http://localhost:8080 。如果端口已占用，以终端实际输出为准。

后续按锁文件重新安装可使用 `npm ci`。项目 `.npmrc` 已设置 `legacy-peer-deps=true`，使旧 CLI 在新版 npm 中使用兼容的依赖解析方式。

## 使用

- 模型加载完成后自动定位，Gizmo 默认绑定整车，采用地表坐标系。
- 左键拖动红、绿、蓝坐标轴或平面进行变换。
- 面板可以切换平移、旋转、缩放，以及地表 / 本地坐标系。
- 地表坐标系中 X 为东、Y 为北、Z 为上；本地坐标系随模型方向变化。
- “允许拖动”可禁用交互，但保留坐标轴显示。
- “重置模型”恢复初始位置、方向和缩放；“定位模型”将相机移回模型。
- “导出变换 JSON”导出模型原点经纬高、缩放值及完整列主序 ECEF modelMatrix。
- 单击模型不会自动切换到车轮等子节点，业务代码手动绑定整车。

初始位置为 116.3913°E、39.9075°N，高度 5 米。高度为 WGS84 椭球高，面板坐标是模型原点坐标。

## 为什么兼容 Vue CLI 4.5

1. `scripts/copy-cesium.cjs` 将 npm 中的 Cesium 预构建资源复制到 `public/vendor/cesium`。
2. `public/index.html` 在应用执行前加载本地 Cesium.js 和样式，并设置 CESIUM_BASE_URL。
3. `vue.config.js` 用 `externals: { cesium: 'Cesium' }` 让 Gizmo 和业务代码共享同一份 Cesium，避免 Webpack 4 解析新版 Cesium 源码及其依赖。
4. `transpileDependencies` 加上 Gizmo 包，Babel 的语法转译目标包含 Chrome 70，以转译 Webpack 4 无法直接解析的可选链等语法。这只是转译目标；运行时请使用支持 WebGL2 的现代 Chrome / Edge。
5. `scripts/cli.cjs` 在 Node >=17 时给子进程加入 `--openssl-legacy-provider`，处理 Webpack 4 的 OpenSSL 散列兼容问题；无需在 Windows 手工设置环境变量。

npm 安装、启动、打包时自动复制 Cesium 资源。不要删除 `public/vendor/cesium` 后直接调用裸的 `vue-cli-service`，优先使用本项目 npm scripts。

## 部署

```bash
npm run build
```

将整个 `dist` 目录部署到 Nginx 等 HTTP 静态服务，包括 `vendor`、`models`、`js`、`css`，不要直接双击 index.html。

压缩包附有已打包的 `dist`，也可先体验：

```bash
python -m http.server 8080 --directory dist
```

然后打开 http://localhost:8080 。Python 命令仅用于本地预览，源码开发使用 `npm run serve`。

使用 `publicPath: './'`，可以部署到子目录。不含路由和服务器端接口。

## 文件

- `src/App.vue`：场景、模型、Gizmo 和交互面板，方法附有中文注释。
- `src/main.js`：Vue2 入口。
- `vue.config.js`：Webpack4 和 Cesium 兼容设置。
- `public/models/luaz.glb`：指定的示例模型。
- `scripts/copy-cesium.cjs`：静态资源复制。
- `scripts/cli.cjs`：跨平台 CLI 启动包装。

## 生命周期与限制

Cesium Viewer、Model、Gizmo 保存在 data 之外，避免 Vue2 深度观察。组件卸载时先 detach Gizmo，再销毁 Viewer；模型异步加载结束时检查组件是否已卸载。

本例只有一个 Gizmo。上游实现使用模块级共享鼠标状态，多实例同时 attach 存在事件冲突；本例没有修改上游库。拖动释放时上游会重新启用相机操作，本例沿用 Cesium 默认相机配置。

不加载在线底图或地形，不需要 Ion Token，地球以纯色显示。首次 npm install 需要联网；开发和部署运行时使用本地资源。

## 验证范围

- 已完成 npm 依赖安装及 Vue CLI 4.5.19 生产打包，产物中包含模型、Cesium 静态资源和控件代码。
- 已检查模型为完整 GLB 2.0：1,275,224 字节，20 个节点、10 个网格，无 required 扩展。
- 构建环境为 Node 24.22.1 / npm 11.9.0。验证环境禁止读取网络接口，构建时仅在验证进程中使用了 os.networkInterfaces 的回退；该环境补丁不属于项目，不会影响用户机器。
- 当前验证环境无法启动 Chromium（系统禁止其 socket 调用），因此尚未完成真实浏览器拖动测试。请以本机浏览器实际效果为准。
- Cesium 和 GLB 体积会触发 Webpack 的 asset size 提示，这是性能提示，非构建失败。

## 来源与许可

控件与模型来源：https://github.com/123164867376464646/cesium-transform-controls

模型原始地址：https://github.com/123164867376464646/cesium-transform-controls/blob/master/example/public/luaz.glb

仓库以 MIT License 发布，原文保留在 `THIRD_PARTY_LICENSES/cesium-transform-controls-LICENSE.txt`。Cesium、Vue 和其他 npm 依赖沿用各自许可，依赖包内保留其许可文件；Cesium 页面默认署名未移除。模型未见独立许可声明，以上只记录来源和仓库许可。
