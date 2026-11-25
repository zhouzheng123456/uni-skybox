import { loadImage } from '../platform';
import { CUBE_FACES, CubeImageUrls, CubeImages, ISkyboxCanvas } from '../types';

/**
 * 并发加载六个面的贴图。
 * 浏览器走 new Image()，小程序走 canvas.createImage()，差异在 platform.ts 里处理。
 */
export function loadCubeImages(urls: CubeImageUrls, canvas?: ISkyboxCanvas): Promise<CubeImages> {

    const missing = CUBE_FACES.filter((face) => !urls || !urls[face]);

    if (missing.length) {
        return Promise.reject(
            new Error('[uni-skybox] 缺少贴图地址: ' + missing.join(', ')),
        );
    }

    return Promise.all(
        CUBE_FACES.map((face) => loadImage(urls[face], canvas)),
    ).then((list) => {

        const images = {} as CubeImages;

        for (let i = 0; i < CUBE_FACES.length; i++) {
            images[CUBE_FACES[i]] = list[i];
        }

        return images;
    });
}