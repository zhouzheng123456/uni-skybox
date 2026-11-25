# 更新日志

本文件记录所有值得注意的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

目标版本 `0.2.0`。

### 新增

- 立方体贴图资源池（`src/core/texture-pool.ts`）：按 WebGL 上下文隔离，资源键由「六面图像对象标识 + 边长」构成，引用计数归零才 `deleteTexture`；同一上下文内多实例共享同一份贴图，不重复上传、不重复占用显存
- 上下文丢失与恢复：监听 `webglcontextlost` / `webglcontextrestored`，丢失时 `preventDefault()` 并冻结资源描述（不调用 `deleteTexture`，避免造成已释放的假象），恢复时复用内存中已解码的图像重新上传，跳过网络请求与图像解码两步；丢失前处于渲染循环则自动续跑
- 新选项 `shareTexture`（默认 `true`）：置 `false` 退回「实例各自上传、各自释放」的行为，仅供基准对照实验使用
- 新增导出 `poolStats(gl)`、`clearPool(gl)` 与类型 `IPoolStats`，用于观测纹理对象数与估算显存占用
- `bench/` 基准采集套件：`bench/size.mjs` 统计产物体积（原始 / gzip / brotli）与源码规模，`bench/index.html` 采集冷启动、稳态帧间隔、多实例显存、上下文恢复与能力自检
- `scripts/gen-assets.mjs`：零依赖生成六面立方体贴图 PNG（自写 PNG 编码，不引入第三方素材）
- 新增 npm 脚本 `assets`、`size`、`bench`

### 变更

- `SkyboxRenderer` 改为「program 与顶点缓冲自持 + 纹理走资源池」，并新增 `forget()` 与 `restore()` 分别对应丢失与恢复
- `cube-texture.ts` 抽出 `resolveCubeSize(images)`，让资源池在创建纹理之前就能拿到边长来计算资源键
- 上下文丢失期间调用 `setImages()` 不再直接上传（此时任何 GL 调用都会失败），改为暂存并在恢复后补上

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