import { SkyCamera } from './camera/sky-camera';
import { SkyboxRenderer } from './core/skybox-renderer';
import { invalidatePool, restorePool } from './core/texture-pool';
import { loadCubeImages } from './image/loader';
import { cancelFrame, getDevicePixelRatio, requestFrame } from './platform';
import { CubeImages, CubeImageUrls, ISkyboxCanvas, ISkyboxOptions } from './types';
import { clamp } from './utils/math';

const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 150;
const MAX_DELTA_SECONDS = 0.1;

/**
 * 天空盒查看器。
 *
 * 对外只暴露「贴图 + 视角 + 生命周期」，内部不依赖场景图或全局单例：
 * 视图矩阵的平移分量被剔除，天空盒永远以相机为中心，
 * 因此同一页面可以安全地创建/销毁多个实例（路由切换不会互相污染）。
 */
export class SkyboxViewer {

    public readonly canvas: ISkyboxCanvas;

    public readonly gl: WebGLRenderingContext;

    public readonly camera: SkyCamera = new SkyCamera();

    /** 自动旋转速度，单位：度/秒，运行时修改立即生效 */
    public autoRotate: number;

    private renderer: SkyboxRenderer;

    private clearColor: number[];

    private running: boolean = false;
    private destroyed: boolean = false;
    private frameHandle: any = null;
    private lastTime: number = 0;

    /** 上下文是否处于丢失状态；为 true 时所有绘制与循环均不生效 */
    private contextLost: boolean = false;

    /** 丢失前是否处于渲染循环，恢复后据此自动续跑 */
    private resumeAfterRestore: boolean = false;

    /** 上下文丢失期间收到的贴图，恢复后再真正上传 */
    private pendingImages: CubeImages = null;

    constructor(options: ISkyboxOptions) {

        const canvas = options && options.canvas;

        if (!canvas) {
            throw new Error('[uni-skybox] 缺少 canvas，请传入 DOM canvas 或小程序 canvas 节点。');
        }

        this.canvas = canvas;

        const gl = canvas.getContext('webgl', Object.assign({
            alpha: false,
            antialias: true,
            depth: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
        }, options.contextAttributes)) || canvas.getContext('experimental-webgl');

        if (!gl) {
            throw new Error(
                '[uni-skybox] 创建 WebGL 上下文失败：请确认 canvas 为 WebGL 画布，并且当前环境支持 WebGL1。',
            );
        }

        this.gl = gl;

        this.camera.fov = options.fov === undefined ? 75 : options.fov;
        this.camera.alpha = options.alpha || 0;
        this.camera.beta = this.camera.clampBeta(options.beta || 0);

        this.autoRotate = options.autoRotate || 0;
        this.clearColor = options.clearColor || [0, 0, 0, 1];

        this.renderer = new SkyboxRenderer(gl, options.shareTexture !== false);

        this.initViewport();
        this.bindContextEvents();

        if (options.images) {
            this.setImages(options.images);
        }
    }

    /**
     * 一步完成创建 + 贴图加载。
     *
     * ```js
     * const viewer = await SkyboxViewer.create({ canvas, autoRotate: 6 }, urls);
     * viewer.start();
     * ```
     */
    public static create(options: ISkyboxOptions, urls?: CubeImageUrls): Promise<SkyboxViewer> {

        const viewer = new SkyboxViewer(options);

        if (!urls) {
            return Promise.resolve(viewer);
        }

        return viewer.setImageUrls(urls).then(() => viewer);
    }

    /**
     * 传入已加载完成的六面贴图。
     *
     * 上下文丢失期间不直接上传（此时任何 GL 调用都会失败），先记下来，
     * 等 restored 事件到达后补上。
     */
    public setImages(images: CubeImages): void {

        if (this.contextLost) {
            this.pendingImages = images;
            return;
        }

        this.renderer.setImages(images);
        this.render();
    }

    /** 传入六面贴图地址，内部按运行环境选择 new Image() 或 canvas.createImage() */
    public setImageUrls(urls: CubeImageUrls): Promise<void> {
        return loadCubeImages(urls, this.canvas).then((images) => {
            this.setImages(images);
        });
    }

    /** 直接设置朝向，单位：度 */
    public setView(alpha: number, beta: number): void {

        this.camera.alpha = alpha;
        this.camera.beta = this.camera.clampBeta(beta);

        if (!this.running) {
            this.render();
        }
    }

    /**
     * 按像素增量旋转，供拖拽控制调用。
     * 采用「拖拽内容跟手」的手感：右拖画面右移、下拖画面下移。
     */
    public rotateBy(dx: number, dy: number): void {
        this.setView(this.camera.alpha - dx, this.camera.beta + dy);
    }

    /** 设置垂直视角，单位：度 */
    public setFov(fov: number): void {
        this.camera.fov = clamp(fov, 20, 110);
        if (!this.running) {
            this.render();
        }
    }

    /**
     * 设置画布尺寸（CSS 像素），内部按 dpr 放大到物理像素。
     * H5 与小程序都需要在 onReady / mounted 之后调用一次。
     */
    public resize(width: number, height: number, dpr?: number): void {

        const ratio = dpr || getDevicePixelRatio();

        this.canvas.width = Math.max(1, Math.round(width * ratio));
        this.canvas.height = Math.max(1, Math.round(height * ratio));

        this.initViewport();
        this.render();
    }

    public render(): void {

        if (this.destroyed || this.contextLost) {
            return;
        }

        const gl = this.gl;
        const color = this.clearColor;

        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(color[0], color[1], color[2], color[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);

        this.renderer.draw(this.camera);
    }

    public start(): void {

        if (this.running || this.destroyed || this.contextLost) {
            return;
        }

        this.running = true;
        this.lastTime = 0;
        this.frameHandle = requestFrame(this.canvas, this.loop);
    }

    public stop(): void {

        if (!this.running) {
            return;
        }

        this.running = false;
        cancelFrame(this.canvas, this.frameHandle);
        this.frameHandle = null;
    }

    public isRunning(): boolean {
        return this.running;
    }

    public destroy(): void {

        if (this.destroyed) {
            return;
        }

        this.stop();
        this.destroyed = true;
        this.pendingImages = null;
        this.unbindContextEvents();
        this.renderer.destroy();
    }

    /**
     * 监听上下文丢失与恢复。
     *
     * 小程序画布节点未必实现事件模型，因此按能力探测绑定；浏览器下必须在
     * 丢失事件里调用 preventDefault，否则浏览器不会尝试恢复上下文。
     */
    private bindContextEvents(): void {

        const target: any = this.canvas;

        if (!target || typeof target.addEventListener !== 'function') {
            return;
        }

        target.addEventListener('webglcontextlost', this.onContextLost, false);
        target.addEventListener('webglcontextrestored', this.onContextRestored, false);
    }

    private unbindContextEvents(): void {

        const target: any = this.canvas;

        if (!target || typeof target.removeEventListener !== 'function') {
            return;
        }

        target.removeEventListener('webglcontextlost', this.onContextLost, false);
        target.removeEventListener('webglcontextrestored', this.onContextRestored, false);
    }

    /** 上下文丢失：暂停循环、冻结资源描述；图像引用保留在资源池里供重建 */
    private onContextLost = (event: any): void => {

        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }

        this.contextLost = true;
        this.resumeAfterRestore = this.running;

        this.stop();

        invalidatePool(this.gl);
        this.renderer.forget();
    };

    /**
     * 上下文恢复：按「纹理 → 程序与缓冲 → 视口 → 首帧」的顺序重建。
     *
     * 纹理必须先于绘制重建，否则首帧会因绑定空纹理而丢帧。
     */
    private onContextRestored = (): void => {

        if (this.destroyed) {
            return;
        }

        this.contextLost = false;

        restorePool(this.gl);
        this.renderer.restore();

        // 丢失期间换过贴图：此时上下文已可用，补上最后一份，避免恢复后仍是旧图
        if (this.pendingImages) {
            const images = this.pendingImages;
            this.pendingImages = null;
            this.renderer.setImages(images);
        }

        this.initViewport();
        this.render();

        if (this.resumeAfterRestore) {
            this.resumeAfterRestore = false;
            this.start();
        }
    };

    private loop = (): void => {

        if (!this.running) {
            return;
        }

        const now = Date.now();
        const delta = this.lastTime ? Math.min((now - this.lastTime) / 1000, MAX_DELTA_SECONDS) : 0;

        this.lastTime = now;

        if (this.autoRotate) {
            this.camera.alpha = (this.camera.alpha + this.autoRotate * delta) % 360;
        }

        this.render();

        this.frameHandle = requestFrame(this.canvas, this.loop);
    }

    private initViewport(): void {

        const { canvas, gl } = this;

        if (!canvas.width) {
            canvas.width = DEFAULT_WIDTH;
        }

        if (!canvas.height) {
            canvas.height = DEFAULT_HEIGHT;
        }

        gl.viewport(0, 0, canvas.width, canvas.height);
        this.camera.aspect = canvas.width / canvas.height;
    }
}