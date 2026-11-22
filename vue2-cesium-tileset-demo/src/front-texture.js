const FRONT_TEXTURE_MAX_BYTES = 4 * 1024 * 1024;
const FRONT_TEXTURE_TYPES = ["image/png", "image/jpeg"];

function applyFrontTexture(gltf, materialName, uri) {
  const material = gltf.materials?.find(({ name }) => name === materialName);
  const baseColorTexture = material?.pbrMetallicRoughness?.baseColorTexture;
  const original = gltf.textures?.[baseColorTexture?.index];
  if (!original || !gltf.images?.[original.source]) {
    throw new Error("找不到标志牌正面材质的基础颜色贴图。");
  }

  // 给正面材质单独添加贴图，保留使用原贴图的其他材质及原有 UV。
  const texture = { source: gltf.images.length };
  if (original.sampler !== undefined) texture.sampler = original.sampler;
  gltf.images.push({ uri });
  baseColorTexture.index = gltf.textures.push(texture) - 1;
  return gltf;
}

module.exports = { FRONT_TEXTURE_MAX_BYTES, FRONT_TEXTURE_TYPES, applyFrontTexture };
