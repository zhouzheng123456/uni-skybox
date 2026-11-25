/**
 * 天空盒立方体顶点数据。
 *
 * 顶点完全由代码生成，不手写坐标表：
 * 每个面用「法线 + 从盒外看时的屏幕向上方向」描述，右向量由叉乘得到，
 * 四个角就是 法线 ± 右向量 ± 上向量，再拆成两个三角形。
 *
 * 这样单个面只有 2 条常量，6 个面共 12 条，改起来不容易写错。
 * 顶点顺序固定为 front / back / left / right / top / bottom，
 * 每个面按「从盒外看」的左上 → 左下 → 右下 → 右上 排列，
 * 因此外表面为正面；绘制时用 cullFace(FRONT) 剔掉外侧、看到盒子内壁。
 *
 * 展开成 36 个顶点后可以 drawArrays 一次画完，不需要索引缓冲。
 */

type IVec3 = [number, number, number];

interface IBoxFace {
    /** 面朝外的法线 */
    normal: IVec3;
    /** 从盒外正对该面时，屏幕的向上方向 */
    up: IVec3;
}

const FACES: IBoxFace[] = [
    { normal: [0, 0, 1], up: [0, 1, 0] },    // front  +Z
    { normal: [0, 0, -1], up: [0, 1, 0] },   // back   -Z
    { normal: [-1, 0, 0], up: [0, 1, 0] },   // left   -X
    { normal: [1, 0, 0], up: [0, 1, 0] },    // right  +X
    { normal: [0, 1, 0], up: [0, 0, -1] },   // top    +Y
    { normal: [0, -1, 0], up: [0, 0, 1] },   // bottom -Y
];

/** 半边长：顶点落在 [-size, +size] 之间 */
const CUBE_HALF_SIZE = 1;

function cross(a: IVec3, b: IVec3): IVec3 {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

/**
 * 把面描述展开成 36 个顶点（6 面 × 2 三角形 × 3 顶点）。
 *
 * 因为 right = up × normal，所以顺序 right → up → normal 恰好构成右手系，
 * 按「左上 → 左下 → 右下」推进时从盒外看是逆时针，正面朝外。
 */
function buildVertices(): Float32Array {

    const data: number[] = [];

    for (let f = 0; f < FACES.length; f++) {

        const { normal, up } = FACES[f];
        const right = cross(up, normal);

        // 单个角的坐标：法线方向固定，另外两个方向由正负号决定
        const corner = (rightSign: number, upSign: number): void => {
            for (let axis = 0; axis < 3; axis++) {
                const offset = rightSign * right[axis] + upSign * up[axis];
                data.push(CUBE_HALF_SIZE * (normal[axis] + offset));
            }
        };

        corner(-1, 1);   // 左上
        corner(-1, -1);  // 左下
        corner(1, -1);   // 右下

        corner(-1, 1);   // 左上
        corner(1, -1);   // 右下
        corner(1, 1);    // 右上
    }

    return new Float32Array(data);
}

const CUBE_VERTICES: Float32Array = buildVertices();

export const CUBE_VERTEX_COUNT: number = CUBE_VERTICES.length / 3;

export function createCubeVertexBuffer(gl: WebGLRenderingContext): WebGLBuffer {

    const buffer = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, CUBE_VERTICES, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    return buffer;
}