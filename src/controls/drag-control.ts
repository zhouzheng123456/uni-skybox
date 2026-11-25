import type { SkyboxViewer } from '../skybox-viewer';
import { clamp } from '../utils/math';

export interface IDragControlOptions {
    /** 移动 1px 对应的旋转角度，单位：度，默认 0.2 */
    sensitivity?: number;
    /** 缩放下限（fov），默认 20 */
    minFov?: number;
    /** 缩放上限（fov），默认 100 */
    maxFov?: number;
}

interface IListener {
    target: any;
    type: string;
    handler: any;
    options?: any;
}

/**
 * 拖拽/滚轮控制。
 *
 * 之所以不直接把 DOM 事件写死：小程序里 canvas 是组件，事件要靠模板上的
 * @touchstart / @touchmove / @touchend 传入，所以这里同时提供：
 * - start / move / end / zoom：由宿主自己转发坐标；
 * - bindDOM：H5 场景下一行接入鼠标与触摸。
 */
export class DragControl {

    private viewer: SkyboxViewer;

    private sensitivity: number;
    private minFov: number;
    private maxFov: number;

    private dragging: boolean = false;
    private lastX: number = null;
    private lastY: number = null;

    private listeners: IListener[] = [];

    constructor(viewer: SkyboxViewer, options: IDragControlOptions = {}) {
        this.viewer = viewer;
        this.sensitivity = options.sensitivity || 0.2;
        this.minFov = options.minFov || 20;
        this.maxFov = options.maxFov || 100;
    }

    public start(x: number, y: number): void {
        this.dragging = true;
        this.lastX = x;
        this.lastY = y;
    }

    public move(x: number, y: number): void {

        if (!this.dragging) {
            return;
        }

        if (this.lastX === null) {
            this.start(x, y);
            return;
        }

        this.viewer.rotateBy(
            (x - this.lastX) * this.sensitivity,
            (y - this.lastY) * this.sensitivity,
        );

        this.lastX = x;
        this.lastY = y;
    }

    public end(): void {
        this.dragging = false;
        this.lastX = null;
        this.lastY = null;
    }

    /** 滚轮/双指缩放，delta > 0 表示拉远 */
    public zoom(delta: number): void {
        const fov = clamp(this.viewer.camera.fov + delta * 0.05, this.minFov, this.maxFov);
        this.viewer.setFov(fov);
    }

    /** 仅 H5 使用：给真实 DOM canvas 绑定鼠标/触摸事件 */
    public bindDOM(element: any): this {

        if (this.listeners.length) {
            return this;
        }

        const windowObject = typeof window !== 'undefined' ? window : element;

        this.on(windowObject, 'mousemove', (e: MouseEvent) => {
            if (this.dragging) {
                this.move(e.clientX, e.clientY);
            }
        });

        this.on(element, 'mousedown', (e: MouseEvent) => {
            this.start(e.clientX, e.clientY);
            e.preventDefault();
        });

        this.on(windowObject, 'mouseup', () => this.end());

        this.on(element, 'wheel', (e: WheelEvent) => {
            this.zoom(e.deltaY);
            e.preventDefault();
        }, { passive: false });

        this.on(element, 'touchstart', (e: TouchEvent) => {
            const touch = e.touches[0];
            if (touch) {
                this.start(touch.clientX, touch.clientY);
            }
        }, { passive: true });

        this.on(element, 'touchmove', (e: TouchEvent) => {
            const touch = e.touches[0];
            if (touch) {
                this.move(touch.clientX, touch.clientY);
            }
            if (e.cancelable) {
                e.preventDefault();
            }
        }, { passive: false });

        this.on(element, 'touchend', () => this.end());
        this.on(element, 'touchcancel', () => this.end());

        return this;
    }

    public destroy(): void {

        for (let i = 0; i < this.listeners.length; i++) {
            const { target, type, handler, options } = this.listeners[i];
            target.removeEventListener(type, handler, options);
        }

        this.listeners = [];
    }

    private on(target: any, type: string, handler: any, options?: any): void {
        if (!target || typeof target.addEventListener !== 'function') {
            return;
        }
        target.addEventListener(type, handler, options);
        this.listeners.push({ target, type, handler, options });
    }
}