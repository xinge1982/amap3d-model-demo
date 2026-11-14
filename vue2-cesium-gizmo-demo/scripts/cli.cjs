const { spawnSync } = require('child_process')
const path = require('path')
require('./copy-cesium.cjs')
// Webpack 4 使用旧散列算法，新 Node 使用 OpenSSL 3 时需启用兼容选项。
const flags = Number(process.versions.node.split('.')[0]) >= 17
  ? ['--openssl-legacy-provider'] : []
const cli = require.resolve('@vue/cli-service/bin/vue-cli-service.js')
const result = spawnSync(process.execPath, [...flags, cli, ...process.argv.slice(2)], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  env: process.env,
})
if (result.error) throw result.error
process.exit(result.status === null ? 1 : result.status)
