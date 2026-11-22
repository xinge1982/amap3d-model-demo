<template>
  <section class="panel placement-panel" aria-labelledby="placement-title">
    <header class="selection-heading">
      <h2 id="placement-title">{{ initialPlacement ? '移动模型' : '摆放模型' }}</h2>
      <button type="button" :disabled="saving" @click="$emit('cancel')">取消</button>
    </header>
    <p class="intro">{{ item.name }}</p>
    <p class="status" :class="{ error: saveError || error }" role="status">{{ saveError || error || (saving ? '正在保存摆放…' : status) }}</p>
    <button v-if="error && !loading && (anchor || initialPlacement)" type="button" @click="loadInitialModel">重试加载模型</button>
    <fieldset :disabled="!ready || saving">
      <p class="field-label">变换模式</p>
      <div class="row">
        <button v-for="item in modes" :key="item.value" type="button"
          :class="{ active: mode === item.value }" @click="changeMode(item.value)">{{ item.label }}</button>
      </div>
      <label for="placement-coordinate">坐标系</label>
      <select id="placement-coordinate" v-model="coordinate" @change="changeCoordinate">
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
        <button type="button" @click="resetModel">重置模型</button>
        <button type="button" @click="locateModel">定位模型</button>
      </div>
      <button class="confirm primary" type="button" @click="confirmPlacement">{{ initialPlacement ? '确定移动' : '确定摆放' }}</button>
    </fieldset>
    <p class="hint">红 X、绿 Y、蓝 Z。用左键拖动坐标轴或平面。</p>
  </section>
</template>

<script>
import * as Cesium from 'cesium'
import { Gizmo, GizmoMode, CoordinateMode } from 'cesium-transform-controls'

const CAMERA_INPUTS = [
  'enableRotate', 'enableTranslate', 'enableZoom', 'enableTilt', 'enableLook',
  'rotateEventTypes', 'tiltEventTypes', 'zoomEventTypes',
]

export default {
  name: 'ModelPlacement',

  props: {
    sceneController: { type: Object, required: true },
    item: { type: Object, required: true },
    anchor: { type: Object, default: null },
    initialPlacement: { type: Object, default: null },
    saving: { type: Boolean, default: false },
    saveError: { type: String, default: '' },
  },

  data() {
    return {
      ready: false,
      error: '',
      status: '请单击场景中的摆放位置。',
      loading: false,
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

  watch: {
    saving(value) {
      this._resources.gizmo?.setEnabled(!value && this.enabled)
    },
  },

  created() {
    // Cesium 对象不进入 data，避免 Vue2 对大型场景对象递归观察。
    this._resources = {
      viewer: this.sceneController.viewer, model: null, gizmo: null, originalMatrix: null,
      disposed: false, removeReady: null, removeError: null, placementId: Cesium.createGuid(),
    }
  },

  mounted() {
    this.loadInitialModel()
  },

  beforeDestroy() {
    this.disposePlacement()
  },

  methods: {
    // 摆放流程复用主场景的 Viewer，销毁编辑器时只清理本次摆放资源。
    disposePlacement() {
      const resources = this._resources
      if (resources.disposed) return
      resources.disposed = true
      this.releaseModel()
    },

    releaseModel() {
      const resources = this._resources
      resources.removeReady?.()
      resources.removeError?.()
      resources.removeReady = null
      resources.removeError = null
      const { viewer, model, gizmo } = resources
      gizmo?.detach()
      if (resources.cameraInputs) {
        Object.assign(viewer.scene.screenSpaceCameraController, resources.cameraInputs)
        resources.cameraInputs = null
      }
      if (model) viewer.scene.primitives.remove(model)
      resources.model = null
      resources.gizmo = null
      viewer.scene.requestRender()
    },

    pickAnchor(position) {
      if (this.initialPlacement || this.loading || this.ready) return
      this.placeAt(this.sceneController.pickPlacementPosition(position))
    },

    loadInitialModel() {
      if (this.initialPlacement) {
        return this.loadModel(Cesium.Matrix4.fromArray(this.initialPlacement.modelMatrix))
      }
      if (this.anchor) return this.placeAt(this.anchor)
    },

    placeAt(position) {
      if (!position) {
        this.error = '无法获取落点，请单击可见模型或地球表面。'
        return
      }

      return this.loadModel(Cesium.Transforms.eastNorthUpToFixedFrame(position))
    },

    async loadModel(modelMatrix) {
      const resources = this._resources
      if (this.loading || this.ready || resources.disposed) return

      this.$emit('load-model')
      this.error = ''
      this.status = '正在加载模型…'
      this.loading = true
      const { viewer } = resources
      try {
        resources.originalMatrix = Cesium.Matrix4.clone(modelMatrix)
        const model = await Cesium.Model.fromGltfAsync({
          url: this.item.url,
          modelMatrix,
          minimumPixelSize: 0,
        })
        if (resources.disposed) {
          model.destroy()
          return
        }
        resources.model = viewer.scene.primitives.add(model)
        resources.removeError = model.errorEvent.addEventListener((error) => {
          // Cesium 可能在遍历图元时触发错误，下一轮再移除模型。
          Promise.resolve().then(() => {
            if (resources.model === model) this.handleError(error)
          })
        })
        if (model.ready) this.setupGizmo()
        else resources.removeReady = model.readyEvent.addEventListener(this.setupGizmo)
        viewer.scene.requestRender()
      } catch (error) {
        if (!resources.disposed) this.handleError(error)
      }
    },

    handleError(error) {
      this.releaseModel()
      this.loading = false
      this.ready = false
      this.error = '模型加载或初始化失败。' + (error.message || String(error))
      this.$emit('load-error')
    },

    // 只创建一个 Gizmo，显式绑定本次摆放的完整模型。
    setupGizmo() {
      const resources = this._resources
      if (resources.disposed || resources.gizmo) return
      if (resources.removeReady) {
        resources.removeReady()
        resources.removeReady = null
      }
      try {
        const gizmo = new Gizmo({
          isLeftClick: false,
          onGizmoPointerDown: () => { this.status = '正在编辑…' },
          onGizmoPointerMove: () => {
            this.updatePosition()
            resources.viewer.scene.requestRender()
          },
          onGizmoPointerUp: () => {
            this.updatePosition()
            this.status = '变换已更新'
            resources.viewer.scene.requestRender()
          },
        })
        resources.gizmo = gizmo
        const controls = resources.viewer.scene.screenSpaceCameraController
        resources.cameraInputs = {}
        for (const name of CAMERA_INPUTS) resources.cameraInputs[name] = controls[name]
        gizmo.attach(resources.viewer)
        gizmo.setMode(GizmoMode.translate)
        gizmo.coordinateMode = CoordinateMode.surface
        gizmo.mountToPrimitive(resources.model, resources.viewer)
        resources.localBounds = this.initialPlacement?.localBounds
        if (!resources.localBounds) {
          const initialBounds = resources.model.boundingSphere
          const worldToLocal = Cesium.Matrix4.inverseTransformation(resources.originalMatrix, new Cesium.Matrix4())
          const center = Cesium.Matrix4.multiplyByPoint(worldToLocal, initialBounds.center, new Cesium.Cartesian3())
          resources.localBounds = [...Cesium.Cartesian3.pack(center, []), initialBounds.radius]
        }
        this.ready = true
        this.loading = false
        this.status = '模型已就绪'
        this.updatePosition()
        if (!this.initialPlacement) this.locateModel()
      } catch (error) {
        this.handleError(error)
      }
    },

    // 切换变换模式。
    changeMode(mode) {
      this.mode = mode
      this._resources.gizmo.setMode(GizmoMode[mode])
      this._resources.viewer.scene.requestRender()
    },

    // 设置地表或模型自身坐标系。
    changeCoordinate() {
      this._resources.gizmo.coordinateMode = CoordinateMode[this.coordinate]
      this._resources.viewer.scene.requestRender()
    },

    // 禁用交互时保留坐标轴显示。
    changeEnabled() {
      this._resources.gizmo.setEnabled(this.enabled)
      this._resources.viewer.scene.requestRender()
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

    // 预览保留到保存成功。重试同一摆放时复用 ID。
    confirmPlacement() {
      const resources = this._resources
      if (!this.ready || this.saving || resources.disposed) return
      this.$emit('confirm', {
        placementId: resources.placementId,
        modelId: this.item.id,
        modelMatrix: Cesium.Matrix4.toArray(resources.model.modelMatrix),
        localBounds: resources.localBounds,
      })
    },
  },
}
</script>

<style scoped>
.placement-panel {
  top: 1rem;
  left: 1rem;
  z-index: 2;
  max-height: calc(100% - 2rem);
  overflow: auto;
}

.intro, .hint { color: #bfd0db; font-size: 0.8rem; }
.status { padding: 0.6rem; background: #19364a; color: #8cddc6; border-radius: 0.35rem; font-size: 0.8rem; overflow-wrap: anywhere; }
.status.error { color: #ffc7bb; background: #582e33; }
fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
label, .field-label { display: block; margin: 0.9rem 0 0.45rem; font-size: 0.8rem; color: #bfd0db; }
.row { display: flex; gap: 0.5rem; }
.row button { flex: 1; }
button.active { background: #1d5a54; border-color: #3c8d83; }
select { width: 100%; padding: 0.4rem; border: 1px solid #567086; border-radius: 0.35rem; background: #20364a; color: inherit; }
.check { display: flex; align-items: center; gap: 0.4rem; }
.values div { display: flex; justify-content: space-between; gap: 0.5rem; padding: 0.5rem 0; border-bottom: 1px solid #ffffff16; font-size: 0.8rem; }
.values span { color: #a8bdcd; }
.values strong { font-variant-numeric: tabular-nums; font-weight: 500; }
.actions, .confirm { margin-top: 0.75rem; }
.confirm { width: 100%; }
.hint { margin-bottom: 0; }
fieldset:disabled button { cursor: default; opacity: 0.45; }
</style>
