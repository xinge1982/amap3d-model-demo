const { Axis, BoundingSphere, Cartesian3, Matrix4 } = require("cesium");
const { DYNAMIC_TILESET_ID } = require("../src/feature-id");

// 按默认 16 px SSE 设置细化距离，小模型在约 200 米处也能开始加载。
const DYNAMIC_GEOMETRIC_ERROR = 5;

const config = {
  id: DYNAMIC_TILESET_ID,
  name: "动态模型",
  title: "新增与替换",
  url: "/api/tilesets/dynamic",
  defaultLoad: true,
  focus: false,
  options: { dynamicScreenSpaceError: false },
};

// 独立 Model 用 Y-up/Z-forward，3D Tiles 的 glTF 内容用 Y-up/X-forward。
const previewToTileBasis = Matrix4.multiplyTransformation(
  Matrix4.multiplyTransformation(Axis.Y_UP_TO_Z_UP, Axis.Z_UP_TO_X_UP, new Matrix4()),
  Axis.Z_UP_TO_Y_UP,
  new Matrix4(),
);
const tileToPreviewBasis = Matrix4.inverseTransformation(previewToTileBasis, new Matrix4());

function sphereValues({ center, radius }) {
  return [...Cartesian3.pack(center, []), radius];
}

function buildDynamicTileset(records) {
  const children = [];
  const rootSphere = new BoundingSphere();
  for (const record of records) {
    if (record.tilesetId !== DYNAMIC_TILESET_ID || record.deleted) continue;

    const matrix = Matrix4.fromArray(record.modelMatrix);
    const tileMatrix = Matrix4.multiplyTransformation(matrix, previewToTileBasis, new Matrix4());
    const previewCenter = Cartesian3.fromArray(record.localBounds);
    const tileCenter = Matrix4.multiplyByPoint(tileToPreviewBasis, previewCenter, new Cartesian3());
    const tileSphere = new BoundingSphere(tileCenter, record.localBounds[3]);
    const worldSphere = BoundingSphere.transform(tileSphere, tileMatrix, new BoundingSphere());
    if (children.length === 0) BoundingSphere.clone(worldSphere, rootSphere);
    else BoundingSphere.union(rootSphere, worldSphere, rootSphere);

    children.push({
      boundingVolume: { sphere: sphereValues(tileSphere) },
      geometricError: 0,
      transform: Matrix4.toArray(tileMatrix),
      content: {
        uri: record.url,
        metadata: { class: "placedModel", properties: { id: record.featureId } },
      },
    });
  }

  const geometricError = children.length > 0 ? DYNAMIC_GEOMETRIC_ERROR : 0;
  return {
    asset: { version: "1.1" },
    schema: {
      classes: {
        placedModel: { properties: { id: { type: "STRING", required: true } } },
      },
    },
    geometricError,
    root: {
      boundingVolume: { sphere: sphereValues(rootSphere) },
      geometricError,
      refine: "ADD",
      children,
    },
  };
}

module.exports = { config, buildDynamicTileset };
