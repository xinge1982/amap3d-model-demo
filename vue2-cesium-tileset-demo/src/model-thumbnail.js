import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
let sharedRenderer;

function getRenderer(size) {
  if (!sharedRenderer) {
    sharedRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    sharedRenderer.setPixelRatio(1);
  }
  sharedRenderer.setSize(size, size, false);
  return sharedRenderer;
}

function createCamera(model) {
  const bounds = new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) throw new Error("模型没有可预览的几何体。");

  const { center, radius } = bounds.getBoundingSphere(new THREE.Sphere());
  const scale = Math.max(radius, 0.001);
  const halfSize = scale / 0.8;
  const camera = new THREE.OrthographicCamera(-halfSize, halfSize, halfSize, -halfSize, scale / 100, scale * 8);
  const offset = new THREE.Vector3(-1, 1, 1).setLength(scale * 3);
  camera.position.copy(center).add(offset);
  camera.lookAt(center);
  return camera;
}

function disposeModel(gltf) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const bitmaps = new Set();
  const skeletons = new Set();
  for (const scene of gltf.scenes) {
    scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.skeleton) skeletons.add(object.skeleton);
      for (const material of [].concat(object.material || [])) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) textures.add(value);
        }
      }
    });
  }
  geometries.forEach((geometry) => geometry.dispose());
  skeletons.forEach((skeleton) => skeleton.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => {
    if (typeof texture.image?.close === "function") bitmaps.add(texture.image);
    texture.dispose();
  });
  bitmaps.forEach((bitmap) => bitmap.close());
}

export async function generateThumbnail(url, isCurrent, size = 500) {
  const gltf = await loader.loadAsync(url);
  try {
    if (!isCurrent()) return "";
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcccccc);
    scene.add(gltf.scene, new THREE.HemisphereLight(0xffffff, 0x555555, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(-5, 10, 5);
    scene.add(sun);

    const camera = createCamera(gltf.scene);
    // 加载完成后才取渲染器。尺寸调整、渲染和导出同步完成。
    const renderer = getRenderer(size);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  } finally {
    disposeModel(gltf);
  }
}
