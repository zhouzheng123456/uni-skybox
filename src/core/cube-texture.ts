import { CUBE_FACES, CubeFace, CubeImages } from '../types';

/**
 * 立方体贴图。
 *
 * 1. 不要求图片边长是 2 的幂（WebGL1 在 CLAMP_TO_EDGE + LINEAR 下允许 NPOT）；
 * 2. 不做 mipmap 与 sRGB 分支（天空盒用不到，小程序基本也没有 EXT_sRGB）；
 * 3. 不挂到任何全局纹理表上，生命周期由 renderer 负责。
 */

const FACE_TARGETS: Array<{ key: CubeFace; target: string }> = [
    { key: 'right', target: 'TEXTURE_CUBE_MAP_POSITIVE_X' },
    { key: 'left', target: 'TEXTURE_CUBE_MAP_NEGATIVE_X' },
    { key: 'top', target: 'TEXTURE_CUBE_MAP_POSITIVE_Y' },
    { key: 'bottom', target: 'TEXTURE_CUBE_MAP_NEGATIVE_Y' },
    { key: 'front', target: 'TEXTURE_CUBE_MAP_POSITIVE_Z' },
    { key: 'back', target: 'TEXTURE_CUBE_MAP_NEGATIVE_Z' },
];

/**
 * 采样参数：
 * 立方体贴图没有边界，wrap 只能 CLAMP_TO_EDGE；
 * 天空盒是固定远景，只用 LINEAR，不生成 mipmap。
 */
const SAMPLER_STATE: Array<[string, string]> = [
    ['TEXTURE_WRAP_S', 'CLAMP_TO_EDGE'],
    ['TEXTURE_WRAP_T', 'CLAMP_TO_EDGE'],
    ['TEXTURE_MIN_FILTER', 'LINEAR'],
    ['TEXTURE_MAG_FILTER', 'LINEAR'],
];

/**
 * 校验六面图像并返回贴图边长。
 *
 * 独立成函数的原因：资源池在创建纹理之前就需要边长来计算资源键，
 * 若校验内嵌在 CubeTexture 里，就必须先上传才能拿到边长。
 */
export function resolveCubeSize(images: CubeImages): number {

    let size = 0;

    for (let i = 0; i < CUBE_FACES.length; i++) {

        const face = CUBE_FACES[i];
        const image = images && images[face];

        if (!image || !image.width || !image.height) {
            throw new Error(
                `[uni-skybox] 缺少 ${face} 面贴图，或该图片尚未加载完成（宽高为 0）。`,
            );
        }

        if (image.width !== image.height) {
            throw new Error(
                `[uni-skybox] ${face} 面贴图必须是正方形，当前为 ${image.width}x${image.height}。`,
            );
        }

        if (size === 0) {
            size = image.width;
        } else if (size !== image.width) {
            throw new Error(
                `[uni-skybox] 六个面的贴图尺寸必须一致，${face} 面为 ${image.width}，其余为 ${size}。`,
            );
        }
    }

    return size;
}

export class CubeTexture {

    public readonly glTexture: WebGLTexture;

    private gl: WebGLRenderingContext;

    private size: number = 0;

    constructor(gl: WebGLRenderingContext, images: CubeImages) {

        this.gl = gl;
        this.glTexture = gl.createTexture();

        this.upload(images);
    }

    /** 原位更新六个面，可重复调用（例如切换场景） */
    public upload(images: CubeImages): void {

        const gl = this.gl;

        this.size = resolveCubeSize(images);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.glTexture);

        // 立方体贴图没有边界，只能 CLAMP_TO_EDGE；天空盒是远景，无需 mipmap
        for (let i = 0; i < SAMPLER_STATE.length; i++) {
            const [pname, value] = SAMPLER_STATE[i];
            gl.texParameteri(gl.TEXTURE_CUBE_MAP, (gl as any)[pname], (gl as any)[value]);
        }

        // 立方体贴图不翻转 Y：六面图按「从盒外看」的方向存储
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);

        for (let i = 0; i < FACE_TARGETS.length; i++) {
            const { key, target } = FACE_TARGETS[i];
            gl.texImage2D(
                (gl as any)[target], 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images[key] as any,
            );
        }

        gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
    }

    public getSize(): number {
        return this.size;
    }

    public destroy(): void {
        this.gl.deleteTexture(this.glTexture);
    }
}