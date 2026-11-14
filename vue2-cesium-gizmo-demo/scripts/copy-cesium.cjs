const fs = require('fs')
const path = require('path')
const source = path.resolve(__dirname, '../node_modules/cesium/Build/Cesium')
const target = path.resolve(__dirname, '../public/vendor/cesium')
function copyDirectory(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) copyDirectory(src, dst)
    else fs.copyFileSync(src, dst)
  }
}
if (!fs.existsSync(source)) throw new Error('Cesium 未安装，请先执行 npm install')
copyDirectory(source, target)
console.log('Cesium 静态资源已复制到 public/vendor/cesium')
