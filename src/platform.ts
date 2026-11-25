import { ISkyboxCanvas } from './types';

/**
 * 运行时差异全部收敛在这里：requestAnimationFrame、devicePixelRatio、图片创建。
 * 浏览器与微信小程序共用同一套上层逻辑。
 */

/** 小程序 canvas 节点自带 createImage，用来判断是否运行在小程序环境 */
export function isMiniProgramCanvas(canvas: any): boolean {
    return !!canvas && typeof canvas.createImage === 'function';
}

export function requestFrame(canvas: ISkyboxCanvas, callback: (time: number) => void): any {

    if (canvas && typeof canvas.requestAnimationFrame === 'function') {
        return canvas.requestAnimationFrame(callback);
    }

    if (typeof requestAnimationFrame === 'function') {
        return requestAnimationFrame(callback);
    }

    return setTimeout(() => callback(Date.now()), 16);
}

export function cancelFrame(canvas: ISkyboxCanvas, handle: any): void {

    if (handle === null || handle === undefined) {
        return;
    }

    if (canvas && typeof canvas.cancelAnimationFrame === 'function') {
        canvas.cancelAnimationFrame(handle);
        return;
    }

    if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(handle);
        return;
    }

    clearTimeout(handle);
}

export function getDevicePixelRatio(): number {

    if (typeof window !== 'undefined' && (window as any).devicePixelRatio) {
        return (window as any).devicePixelRatio;
    }

    const wx = (typeof globalThis !== 'undefined' ? (globalThis as any).wx : null);

    if (wx && typeof wx.getSystemInfoSync === 'function') {
        try {
            return wx.getSystemInfoSync().pixelRatio || 1;
        } catch (e) {
            return 1;
        }
    }

    return 1;
}

/**
 * 创建图片对象。
 * - 浏览器：new Image()
 * - 小程序：canvas.createImage()（不能直接 new Image）
 */
export function createImage(canvas: ISkyboxCanvas): any {

    if (canvas && typeof canvas.createImage === 'function') {
        return canvas.createImage();
    }

    if (typeof Image !== 'undefined') {
        const image = new Image();
        // 跨域图片需要带 CORS 头才能上传为纹理，否则 texImage2D 会抛安全错误
        (image as any).crossOrigin = 'anonymous';
        return image;
    }

    throw new Error(
        '[uni-skybox] 当前环境不支持图片加载，请自行加载图片后通过 setImages() 传入。',
    );
}

export function loadImage(url: string, canvas: ISkyboxCanvas): Promise<any> {

    return new Promise((resolve, reject) => {

        const image = createImage(canvas);

        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('[uni-skybox] 图片加载失败: ' + url));

        image.src = url;
    });
}