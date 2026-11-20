const createMockApi = require("./mock/api");

module.exports = {
  publicPath: "./",
  productionSourceMap: false,
  configureWebpack: {
    externals: { cesium: "Cesium" },
  },
  devServer: {
    port: 8080,
    before(app) {
      app.use("/api", createMockApi());
    },
  },
};
