module.exports = {
  publicPath: './',
  productionSourceMap: false,
  transpileDependencies: ['cesium-transform-controls'],
  configureWebpack: {
    // 使用本地预构建版 Cesium，避免 Webpack 4 解析新版 Cesium 的源码及依赖。
    externals: { cesium: 'Cesium' },
  },
  devServer: { port: 8080 },
}
