import { IMat4, create, lookAt, perspective } from '../math/mat4';
import { clamp, deg2rad } from '../utils/math';

const MAX_BETA = 89.9;

/**
 * 极简球坐标相机，只负责产出视图/投影矩阵。
 *
 * 1. 没有 radius：天空盒永远以相机为中心，视图矩阵的平移分量会被剔除；
 * 2. 不依赖场景图或任何全局单例，可同时存在多个实例。
 */
export class SkyCamera {

    /** 水平朝向，单位：度，0 表示正对 front(+Z) 面 */
    public alpha: number = 0;

    /** 俯仰角，单位：度 */
    public beta: number = 0;

    /** 垂直视角，单位：度 */
    public fov: number = 75;

    /** 画布宽高比 */
    public aspect: number = 1;

    public near: number = 0.1;
    public far: number = 10;

    private vMatrix: IMat4 = create();
    private pMatrix: IMat4 = create();

    private eye = new Float32Array(3);
    private center = new Float32Array(3);
    private up = new Float32Array([0, 1, 0]);

    /**
     * 朝向约定：
     * alpha = 0, beta = 0 -> 正对 front(+Z) 面；
     * alpha = 90 -> 正对 right(+X) 面；beta = 90 -> 正对 top(+Y) 面。
     */
    public getVMatrix(): IMat4 {
        const alpha = deg2rad(this.alpha);
        const beta = deg2rad(this.beta);
        const r = Math.cos(beta);

        // 视线方向
        const dx = Math.sin(alpha) * r;
        const dy = Math.sin(beta);
        const dz = Math.cos(alpha) * r;

        // 相机放在视线的反方向、看向原点，这样 alpha = 0 时正好看向 +Z
        this.eye[0] = -dx;
        this.eye[1] = -dy;
        this.eye[2] = -dz;

        lookAt(this.vMatrix, this.eye, this.center, this.up);

        // 天空盒永远以相机为中心，剔除视图矩阵的平移分量
        this.vMatrix[12] = 0;
        this.vMatrix[13] = 0;
        this.vMatrix[14] = 0;

        return this.vMatrix;
    }

    public getPMatrix(): IMat4 {
        perspective(this.pMatrix, deg2rad(this.fov), this.aspect || 1, this.near, this.far);
        return this.pMatrix;
    }

    public clampBeta(beta: number): number {
        return clamp(beta, -MAX_BETA, MAX_BETA);
    }
}