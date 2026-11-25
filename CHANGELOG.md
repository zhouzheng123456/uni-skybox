# 更新日志

本文件记录所有值得注意的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.0] - 2026-11-25

首个可用版本。

### 新增

- `SkyboxViewer`：实例化的天空盒查看器，负责 WebGL 资源、渲染循环与 `resize`
- 三种贴图入口：`setImages()`（图片对象）、`setImageUrls()`（URL 数组，返回 Promise）、
  构造时直接给定六面
- `DragControl`：H5 下 `bindDOM()` 即接入鼠标 / 触摸；小程序可转发 `start / move / end` 坐标
- 视角控制：`setView(alpha, beta)`、`rotateBy(dx, dy)`、`setFov(20–110)`、`autoRotate`（度/秒）
- 跨端适配：`requestAnimationFrame`、`devicePixelRatio`、图片创建方式（`new Image()` 与
  `canvas.createImage()`）在内部自动选择
- H5 示例（`demo/`）：拖拽、滚轮缩放、快捷键、朝向提示，未放置贴图时回退到程序化贴图
- 数学自检脚本（`npm run verify`）：覆盖相机朝向、三角形绕序、拖拽方向符号

[Unreleased]: https://github.com/zhouzheng123456/uni-skybox/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/zhouzheng123456/uni-skybox/releases/tag/v0.1.0