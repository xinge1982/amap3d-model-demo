<template>
  <main class="page">
    <div ref="map" class="map"></div>
    <section class="panel">
      <div class="eyebrow">VUE 2.7 · VUE CLI 4.5</div>
      <h1>Cesium 模型编辑</h1>
      <p class="intro">拖动彩色坐标轴或平面，调整 luaz.glb。</p>
      <div class="status" :class="{ error: error }">{{ error || status }}</div>
      <fieldset :disabled="!ready">
        <label>变换模式</label>
        <div class="row">
          <button v-for="item in modes" :key="item.value"
            :class="{ active: mode === item.value }" @click="changeMode(item.value)">{{ item.label }}</button>
        </div>
        <label>坐标系</label>
        <select v-model="coordinate" @change="changeCoordinate">
          <option value="surface">地表坐标系（东 / 北 / 上）</option>
          <option value="local">模型自身坐标系</option>
        </select>
        <label class="check"><input v-model="enabled" type="checkbox" @change="changeEnabled">允许拖动</label>
        <div class="values">
          <div><span>经度</span><strong>{{ position.longitude }}°</strong></div>
          <div><span>纬度</span><strong>{{ position.latitude }}°</strong></div>
          <div><span>高度</span><strong>{{ position.height }} m</strong></div>
          <div><span>缩放 X / Y / Z</span><strong>{{ position.scale }}</strong></div>
        </div>
        <div class="row actions">
          <button @click="resetModel">重置模型</button>
          <button @click="locateModel">定位模型</button>
        </div>
        <button class="export" @click="exportTransform">导出变换 JSON</button>
      </fieldset>
      <p class="hint">红 X · 绿 Y · 蓝 Z。左键拖动控件；在空白处使用 Cesium 默认相机操作。示例无在线底图，不需要 Ion Token。</p>
    </section>
  </main>
</template>

<script>
import * as Cesium from 'cesium'
import { Gizmo, GizmoMode, CoordinateMode } from 'cesium-transform-controls'

export default {
  name: 'App',

  data() {
    return {
      ready: false,
      error: '',
      status: '正在加载模型…',
      mode: 'translate',
      coordinate: 'surface',
      enabled: true,
      modes: [
        { value: 'translate', label: '平移' },
        { value: 'rotate', label: '旋转' },
        { value: 'scale', label: '缩放' },
      ],
      position: { longitude: '—', latitude: '—', height: '—', scale: '—' },
    }
  },

  created() {
    // Cesium 对象不进入 data，避免 Vue2 对大型场景对象递归观察。
    this._resources = {
      viewer: null, model: null, gizmo: null, originalMatrix: null,
      disposed: false, removeReady: null, removeError: null,
    }
  },

  mounted() {
    this.initializeScene()
  },

  beforeDestroy() {
    const resources = this._resources
    resources.disposed = true
    if (resources.removeReady) resources.removeReady()
    if (resources.removeError) resources.removeError()
    // Gizmo 必须先于 Viewer 销毁。
    if (resources.gizmo) resources.gizmo.detach()
    if (resources.viewer && !resources.viewer.isDestroyed()) resources.viewer.destroy()
    resources.gizmo = null
    resources.model = null
    resources.viewer = null
  },

  methods: {
    // 创建一个不依赖在线底图、地形或 Ion Token 的场景。
    async initializeScene() {
      const resources = this._resources
      try {
        const viewer = new Cesium.Viewer(this.$refs.map, {
          animation: false,
          timeline: false,
          baseLayerPicker: false,
          baseLayer: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          selectionIndicator: false,
          infoBox: false,
          terrainProvider: new Cesium.EllipsoidTerrainProvider(),
          shouldAnimate: true,
        })
        resources.viewer = viewer
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#26384a')
        viewer.scene.globe.enableLighting = false
        viewer.scene.globe.depthTestAgainstTerrain = false
        resources.removeError = viewer.scene.renderError.addEventListener((scene, error) => {
          this.error = '场景渲染失败：' + (error.message || String(error))
        })
        const matrix = Cesium.Transforms.headingPitchRollToFixedFrame(
          Cesium.Cartesian3.fromDegrees(116.3913, 39.9075, 5),
          new Cesium.HeadingPitchRoll(0, 0, 0),
        )
        resources.originalMatrix = Cesium.Matrix4.clone(matrix)
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(116.3913, 39.9072, 40),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-40), roll: 0 },
        })
        const model = await Cesium.Model.fromGltfAsync({
          url: process.env.BASE_URL + 'models/luaz.glb',
          modelMatrix: matrix,
          minimumPixelSize: 0,
        })
        if (resources.disposed) {
          if (!model.isDestroyed()) model.destroy()
          return
        }
        resources.model = viewer.scene.primitives.add(model)
        // fromGltfAsync 返回后仍可能尚未完成 GPU 资源准备。
        if (model.ready) this.setupGizmo()
        else resources.removeReady = model.readyEvent.addEventListener(() => this.setupGizmo())
      } catch (error) {
        if (!resources.disposed) this.error = '加载失败：' + (error.message || String(error))
      }
    },

    // 只创建一个 Gizmo，由业务代码挂载整车，避免自动拾取到车轮等子节点。
    setupGizmo() {
      const resources = this._resources
      if (resources.disposed || resources.gizmo) return
      if (resources.removeReady) {
        resources.removeReady()
        resources.removeReady = null
      }
      const gizmo = new Gizmo({
        isLeftClick: false,
        onGizmoPointerDown: () => { this.status = '正在编辑…' },
        onGizmoPointerMove: () => { this.updatePosition() },
        onGizmoPointerUp: () => {
          this.updatePosition()
          this.status = '变换已更新'
        },
      })
      resources.gizmo = gizmo
      gizmo.attach(resources.viewer)
      gizmo.setMode(GizmoMode.translate)
      gizmo.coordinateMode = CoordinateMode.surface
      gizmo.mountToPrimitive(resources.model, resources.viewer)
      this.ready = true
      this.status = '模型已就绪'
      this.updatePosition()
      this.locateModel()
    },

    // 切换变换模式。
    changeMode(mode) {
      this.mode = mode
      this._resources.gizmo.setMode(GizmoMode[mode])
    },

    // 设置地表或模型自身坐标系。
    changeCoordinate() {
      this._resources.gizmo.coordinateMode = CoordinateMode[this.coordinate]
    },

    // 禁用交互时保留坐标轴显示。
    changeEnabled() {
      this._resources.gizmo.setEnabled(this.enabled)
    },

    // 从模型最终矩阵读取位置，而非假定移动事件 result 的类型。
    readTransform() {
      const matrix = this._resources.model.modelMatrix
      const cartesian = Cesium.Matrix4.getTranslation(matrix, new Cesium.Cartesian3())
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
      const scale = Cesium.Matrix4.getScale(matrix, new Cesium.Cartesian3())
      return {
        longitude: Cesium.Math.toDegrees(cartographic.longitude),
        latitude: Cesium.Math.toDegrees(cartographic.latitude),
        height: cartographic.height,
        scale: { x: scale.x, y: scale.y, z: scale.z },
        modelMatrix: Cesium.Matrix4.toArray(matrix),
      }
    },

    // 刷新面板数值。
    updatePosition() {
      const transform = this.readTransform()
      this.position = {
        longitude: transform.longitude.toFixed(8),
        latitude: transform.latitude.toFixed(8),
        height: transform.height.toFixed(3),
        scale: [transform.scale.x, transform.scale.y, transform.scale.z]
          .map(value => value.toFixed(3)).join(' / '),
      }
    },

    // 恢复初始变换，重新绑定控件以刷新其位置和方向。
    resetModel() {
      const resources = this._resources
      resources.model.modelMatrix = Cesium.Matrix4.clone(resources.originalMatrix)
      resources.gizmo.mountToPrimitive(resources.model, resources.viewer)
      this.updatePosition()
      this.status = '已恢复初始变换'
      this.locateModel()
    },

    // 根据模型实际包围球定位相机。
    locateModel() {
      const { viewer, model } = this._resources
      const sphere = model.boundingSphere
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 0.6,
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(25), Cesium.Math.toRadians(-25),
          Math.max(sphere.radius * 5, 15),
        ),
      })
    },

    // 导出列主序 modelMatrix，可用 Matrix4.fromArray 恢复完整变换。
    exportTransform() {
      const value = {
        model: 'models/luaz.glb',
        coordinateReferenceSystem: 'WGS84 / ECEF',
        matrixLayout: 'column-major',
        ...this.readTransform(),
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {
        type: 'application/json;charset=utf-8',
      }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'luaz-transform.json'
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
  },
}
</script>

<style>
* { box-sizing: border-box; }
html, body, #app, .page, .map { width: 100%; height: 100%; margin: 0; overflow: hidden; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif; }
.map { position: absolute; inset: 0; }
.panel { position: absolute; top: 24px; left: 24px; width: 330px; max-height: calc(100vh - 48px); overflow: auto; padding: 24px; border: 1px solid #ffffff24; border-radius: 16px; background: #101d2cef; color: #edf3fa; box-shadow: 0 16px 48px #0004; }
.eyebrow { color: #78b9ff; font-size: 11px; letter-spacing: 1.5px; }
h1 { font-size: 24px; margin: 12px 0; }
.intro, .hint { color: #a7b6c8; font-size: 12px; line-height: 1.8; }
.status { padding: 10px 12px; background: #19364a; color: #8cddc6; border-radius: 8px; font-size: 12px; overflow-wrap: anywhere; }
.status.error { color: #ffc7bb; background: #582e33; }
fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
label { display: block; margin: 18px 0 8px; font-size: 12px; color: #bbcadb; }
.row { display: flex; gap: 8px; }
button, select { border: 1px solid #40536b; border-radius: 7px; padding: 9px 12px; color: #deebfa; background: #223249; cursor: pointer; font: inherit; font-size: 12px; }
.row button { flex: 1; }
button.active, button:hover { background: #236dc0; border-color: #4397ef; }
select { width: 100%; }
.check { display: flex; align-items: center; gap: 8px; }
.values { padding: 4px 0; }
.values div { display: flex; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid #ffffff0d; font-size: 12px; }
.values span { color: #91a6bd; }
.values strong { font-family: Consolas, monospace; font-weight: 400; }
.actions { margin-top: 16px; }
.export { width: 100%; margin-top: 8px; }
button:disabled, fieldset:disabled button { cursor: default; opacity: .45; }
.hint { margin-bottom: 0; }
@media (max-width: 600px) { .panel { top: 12px; left: 12px; width: 280px; padding: 16px; max-height: 60vh; } }
</style>
