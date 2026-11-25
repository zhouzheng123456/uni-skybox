/**
 * 天空盒只需要两个矩阵：透视投影与视图矩阵。
 *
 * 两者都按 WebGL 的列主序（column-major）写入 16 个 float，
 * 即 out[列 * 4 + 行] = 矩阵第「行」列「列」个元素。
 */
export type IMat4 = Float32Array;

/** 只读的三维向量，接受 Float32Array / number[] */
type IVec = ArrayLike<number>;

/** 把 out 写成单位矩阵 */
function identity(out: IMat4): IMat4 {
    out.fill(0);
    out[0] = 1;
    out[5] = 1;
    out[10] = 1;
    out[15] = 1;
    return out;
}

/** 新建一个单位矩阵 */
export function create(): IMat4 {
    return identity(new Float32Array(16));
}

/**
 * 透视投影矩阵。
 *
 * 眼睛空间里相机看向 -Z，近裁剪面在 z = -near、远裁剪面在 z = -far。
 * 矩阵要做三件事：
 *   1. 用焦距 focal = 1 / tan(fovy / 2) 把 x / y 缩放到视锥边界；
 *   2. 把 z ∈ [-far, -near] 线性映射到 NDC 的 [-1, +1]；
 *   3. 把 -z 写进 w，交给 GPU 做透视除法。
 *
 * 其余元素为 0，所以直接整块 set 进去，避免逐下标赋值。
 */
export function perspective(
    out: IMat4, fovY: number, aspectRatio: number, zNear: number, zFar: number,
): IMat4 {

    const focal = 1 / Math.tan(fovY * 0.5);
    const depth = zNear - zFar;

    out.set([
        focal / aspectRatio, 0, 0, 0,
        0, focal, 0, 0,
        0, 0, (zFar + zNear) / depth, -1,
        0, 0, (2 * zFar * zNear) / depth, 0,
    ]);

    return out;
}

/**
 * 视图矩阵：把世界坐标变换到相机空间（相机在原点、看向 -Z）。
 *
 * 先由相机位置和观察目标定出三个正交基：
 *   back  = normalize(eye - center)   相机背后，也就是相机空间的 +Z
 *   right = normalize(up × back)      相机右方
 *   top   = back × right              相机上方
 *
 * 旋转部分就是这三个基向量按列排开；平移部分等于「相机位置在三个基向量上的投影取负」，
 * 相当于先把世界平移 -eye，再旋转到相机空间。
 *
 * eye 与 center 重合、或者 up 与视线平行时，朝向无法确定，退化为单位矩阵。
 */
export function lookAt(out: IMat4, eye: IVec, center: IVec, up: IVec): IMat4 {

    const eyeX = eye[0];
    const eyeY = eye[1];
    const eyeZ = eye[2];

    let backX = eyeX - center[0];
    let backY = eyeY - center[1];
    let backZ = eyeZ - center[2];
    const backLength = Math.hypot(backX, backY, backZ);

    if (!backLength) {
        return identity(out);
    }

    backX /= backLength;
    backY /= backLength;
    backZ /= backLength;

    let rightX = up[1] * backZ - up[2] * backY;
    let rightY = up[2] * backX - up[0] * backZ;
    let rightZ = up[0] * backY - up[1] * backX;
    const rightLength = Math.hypot(rightX, rightY, rightZ);

    if (!rightLength) {
        return identity(out);
    }

    rightX /= rightLength;
    rightY /= rightLength;
    rightZ /= rightLength;

    // back 与 right 已归一化且互相垂直，叉乘结果天然是单位向量，无需再归一化
    const topX = backY * rightZ - backZ * rightY;
    const topY = backZ * rightX - backX * rightZ;
    const topZ = backX * rightY - backY * rightX;

    out.set([
        rightX, topX, backX, 0,
        rightY, topY, backY, 0,
        rightZ, topZ, backZ, 0,
        -(rightX * eyeX + rightY * eyeY + rightZ * eyeZ),
        -(topX * eyeX + topY * eyeY + topZ * eyeZ),
        -(backX * eyeX + backY * eyeY + backZ * eyeZ),
        1,
    ]);

    return out;
}