import { SkyCamera } from '../camera/sky-camera';
import { FRAGMENT_SHADER, VERTEX_SHADER } from '../shaders/index';
import { CubeImages } from '../types';
import { CUBE_VERTEX_COUNT, createCubeVertexBuffer } from './cube-geometry';
import { CubeTexture } from './cube-texture';
import { GLProgram } from './gl-program';
import { acquireCubeTexture, ITextureEntry, releaseCubeTexture } from './texture-pool';

/**
 * 天空盒渲染器：持有 program、顶点缓冲与立方体贴图，组织单帧绘制。
 *
 * 贴图默认走资源池，同页多实例共享同一份纹理；shareTexture 为 false 时退回
 * 「实例自己上传、自己释放」的行为，仅用于基准测试中的对照实验。
 *
 * 上下文丢失后 program 与顶点缓冲全部失效，由 restore() 重新创建；纹理的
 * 重建统一交给资源池，因为贴图可能被多个实例共享，重建只能做一次。
 */
export class SkyboxRenderer {

    private gl: WebGLRenderingContext;

    private shareTexture: boolean;

    private program: GLProgram = null;
    private vertexBuffer: WebGLBuffer = null;

    /** 走资源池时持有的条目 */
    private entry: ITextureEntry = null;

    /** 不走资源池时自己持有的纹理 */
    private owned: CubeTexture = null;

    /** 保留贴图描述，用于上下文恢复时重新上传 */
    private images: CubeImages = null;

    constructor(gl: WebGLRenderingContext, shareTexture: boolean = true) {
        this.gl = gl;
        this.shareTexture = shareTexture;
        this.createPipeline();
    }

    public setImages(images: CubeImages): void {

        this.images = images;

        if (this.shareTexture) {

            // 先申请再释放：同一份贴图重复设置时键相同，引用计数一增一减，净变化为零
            const next = acquireCubeTexture(this.gl, images);

            if (this.entry) {
                releaseCubeTexture(this.gl, this.entry);
            }

            this.entry = next;
            return;
        }

        if (this.owned) {
            this.owned.upload(images);
        } else {
            this.owned = new CubeTexture(this.gl, images);
        }
    }

    public hasTexture(): boolean {
        return !!this.texture();
    }

    public draw(camera: SkyCamera): void {

        const texture = this.texture();

        if (!texture || !this.program) {
            return;
        }

        const gl = this.gl;

        this.program.use();

        // 天空盒铺满整个画面且只有它自己：
        // 关掉深度测试（避免与后续内容互相影响），只画盒子内侧所以剔除正面。
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.FRONT);

        this.program.attribute('aVertex', this.vertexBuffer, 3);
        this.program.matrix4fv('uView', camera.getVMatrix());
        this.program.matrix4fv('uProjection', camera.getPMatrix());
        this.program.uniform1i('uSky', 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture.glTexture);
        gl.drawArrays(gl.TRIANGLES, 0, CUBE_VERTEX_COUNT);
    }

    /**
     * 上下文丢失：丢弃已失效的图形对象引用。
     *
     * 共享模式下条目不在这里释放——它仍被资源池与其他实例引用，
     * 由资源池统一标记失效。
     */
    public forget(): void {

        this.program = null;
        this.vertexBuffer = null;

        if (!this.shareTexture) {
            this.owned = null;
        }
    }

    /**
     * 上下文恢复：重建 program 与顶点缓冲。
     *
     * 共享模式下的纹理由 restorePool() 负责重建，调用方需先调用它；
     * 独立模式下则在本实例内重新上传。
     */
    public restore(): void {

        this.createPipeline();

        if (!this.shareTexture && this.images) {
            this.owned = new CubeTexture(this.gl, this.images);
        }
    }

    public destroy(): void {

        if (this.shareTexture) {
            releaseCubeTexture(this.gl, this.entry);
        } else if (this.owned) {
            this.owned.destroy();
        }

        this.entry = null;
        this.owned = null;
        this.images = null;

        if (this.vertexBuffer) {
            this.gl.deleteBuffer(this.vertexBuffer);
            this.vertexBuffer = null;
        }

        if (this.program) {
            this.program.destroy();
            this.program = null;
        }
    }

    private createPipeline(): void {
        this.program = new GLProgram(this.gl, VERTEX_SHADER, FRAGMENT_SHADER);
        this.vertexBuffer = createCubeVertexBuffer(this.gl);
    }

    private texture(): CubeTexture {
        return this.shareTexture ? (this.entry ? this.entry.texture : null) : this.owned;
    }
}