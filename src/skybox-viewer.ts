import { SkyCamera } from './camera/sky-camera';
import { SkyboxRenderer } from './core/skybox-renderer';
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

        this.renderer = new SkyboxRenderer(gl);

        this.initViewport();

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

    /** 传入已加载完成的六面贴图 */
    public setImages(images: CubeImages): void {
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

        if (this.destroyed) {
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

        if (this.running || this.destroyed) {
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
        this.renderer.destroy();
    }

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