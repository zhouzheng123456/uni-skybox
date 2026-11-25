import { SkyCamera } from '../camera/sky-camera';
import { FRAGMENT_SHADER, VERTEX_SHADER } from '../shaders/index';
import { CubeImages } from '../types';
import { CUBE_VERTEX_COUNT, createCubeVertexBuffer } from './cube-geometry';
import { CubeTexture } from './cube-texture';
import { GLProgram } from './gl-program';

/**
 * 天空盒渲染器：上传六面贴图、绘制立方体、释放 GPU 资源。
 *
 * 不依赖场景或引擎单例，贴图与顶点缓冲都由实例自己持有与释放。
 */
export class SkyboxRenderer {

    private gl: WebGLRenderingContext;
    private program: GLProgram;
    private vertexBuffer: WebGLBuffer;
    private texture: CubeTexture = null;

    constructor(gl: WebGLRenderingContext) {
        this.gl = gl;
        this.program = new GLProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
        this.vertexBuffer = createCubeVertexBuffer(gl);
    }

    public setImages(images: CubeImages): void {
        if (this.texture) {
            this.texture.upload(images);
        } else {
            this.texture = new CubeTexture(this.gl, images);
        }
    }

    public hasTexture(): boolean {
        return !!this.texture;
    }

    public draw(camera: SkyCamera): void {

        if (!this.texture) {
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
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.texture.glTexture);
        gl.drawArrays(gl.TRIANGLES, 0, CUBE_VERTEX_COUNT);
    }

    public destroy(): void {

        const gl = this.gl;

        if (this.texture) {
            this.texture.destroy();
            this.texture = null;
        }

        if (this.vertexBuffer) {
            gl.deleteBuffer(this.vertexBuffer);
            this.vertexBuffer = null;
        }

        this.program.destroy();
    }
}