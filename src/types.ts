/**
 * 立方体贴图面名的顺序与 WebGL 约定一致：
 * front = +Z, back = -Z, left = -X, right = +X, top = +Y, bottom = -Y。
 */
export type CubeFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export const CUBE_FACES: CubeFace[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];

/** 能作为立方体贴图纹素来源的对象：HTMLImageElement / HTMLCanvasElement / 小程序 canvas.createImage() 的结果 */
export interface ISkyboxImage {
    width: number;
    height: number;
}

export type CubeImages = { [K in CubeFace]: ISkyboxImage };

export type CubeImageUrls = { [K in CubeFace]: string };

/** 同时兼容 DOM canvas 与微信小程序 canvas 节点（wx.createSelectorQuery().node()） */
export interface ISkyboxCanvas {
    width: number;
    height: number;
    getContext(type: string, attributes?: any): any;
    requestAnimationFrame?(callback: (time: number) => void): number;
    cancelAnimationFrame?(handle: number): void;
    /** 仅微信小程序 canvas 节点具备 */
    createImage?(): any;
}

export interface ISkyboxOptions {
    canvas: ISkyboxCanvas;
    /** 已经加载完成的六面贴图；也可以之后调用 setImages / setImageUrls 再传 */
    images?: CubeImages;
    /** 垂直视角，单位：度，默认 75 */
    fov?: number;
    /** 水平朝向，单位：度，0 表示正对 front 面，默认 0 */
    alpha?: number;
    /** 俯仰角，单位：度，默认 0，会被限制在 [-89.9, 89.9] */
    beta?: number;
    /** 自动旋转速度，单位：度/秒，默认 0（不旋转） */
    autoRotate?: number;
    /** 清屏颜色，默认 [0, 0, 0, 1] */
    clearColor?: [number, number, number, number];
    /** 透传给 canvas.getContext('webgl', attributes) */
    contextAttributes?: object;
}