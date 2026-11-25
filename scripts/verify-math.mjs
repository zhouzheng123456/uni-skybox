/**
 * 纯数学自检：不依赖浏览器，验证相机朝向、投影结果与背面剔除的正确性。
 * 用法：npm run verify
 *
 * 之所以放进仓库：天空盒出问题往往不是 GL 调用写错，而是矩阵或三角形绕序错了，
 * 这类错误在真机上的表现是「全黑」，很难定位。
 */
import { DragControl, SkyCamera } from '../dist/uni-skybox.esm.js';

const EPSILON = 1e-6;

function multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                sum += a[k * 4 + row] * b[col * 4 + k];
            }
            out[col * 4 + row] = sum;
        }
    }
    return out;
}

function transform(m, x, y, z, w) {
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12] * w,
        m[1] * x + m[5] * y + m[9] * z + m[13] * w,
        m[2] * x + m[6] * y + m[10] * z + m[14] * w,
        m[3] * x + m[7] * y + m[11] * z + m[15] * w,
    ];
}

function toNDC(m, p) {
    const clip = transform(m, p[0], p[1], p[2], 1);
    return { x: clip[0] / clip[3], y: clip[1] / clip[3], z: clip[2] / clip[3], w: clip[3] };
}

function signedArea(m, a, b, c) {
    const pa = toNDC(m, a);
    const pb = toNDC(m, b);
    const pc = toNDC(m, c);
    return (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
}

function createMatrix(alpha, beta, aspect = 1) {
    const camera = new SkyCamera();
    camera.alpha = alpha;
    camera.beta = beta;
    camera.aspect = aspect;
    return multiply(camera.getPMatrix(), camera.getVMatrix());
}

const results = [];
let failed = 0;

function check(name, condition, detail) {
    results.push(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
    if (!condition) {
        failed++;
    }
}

// 六个面的中心点、首三角形（与 src/core/cube-geometry.ts 完全一致），
// 以及正对该面时相机应使用的角度
const FACES = [
    { name: 'front(+Z)', center: [0, 0, 1], tri: [[-1, 1, 1], [-1, -1, 1], [1, -1, 1]], alpha: 0, beta: 0 },
    { name: 'back(-Z)', center: [0, 0, -1], tri: [[1, 1, -1], [1, -1, -1], [-1, -1, -1]], alpha: 180, beta: 0 },
    { name: 'right(+X)', center: [1, 0, 0], tri: [[1, 1, 1], [1, -1, 1], [1, -1, -1]], alpha: 90, beta: 0 },
    { name: 'left(-X)', center: [-1, 0, 0], tri: [[-1, 1, -1], [-1, -1, -1], [-1, -1, 1]], alpha: 270, beta: 0 },
    { name: 'top(+Y)', center: [0, 1, 0], tri: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1]], alpha: 0, beta: 89.9 },
    { name: 'bottom(-Y)', center: [0, -1, 0], tri: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1]], alpha: 0, beta: -89.9 },
];

for (const face of FACES) {

    const matrix = createMatrix(face.alpha, face.beta, 1.6);

    // 1. 正对该面时，面中心应投影到画面中心，且位于近远裁剪面之间
    // beta 最大只能到 89.9，抬头看 top/bottom 时中心会有极小偏移，容差取 0.01
    const center = toNDC(matrix, face.center);

    check(
        `${face.name} 中心投影到画面中心`,
        Math.abs(center.x) < 0.01 && Math.abs(center.y) < 0.01 && Math.abs(center.z) < 1,
        `ndc=(${center.x.toFixed(3)}, ${center.y.toFixed(3)}, ${center.z.toFixed(3)}) w=${center.w.toFixed(2)}`,
    );

    // 2. 该面三个顶点必须都在相机前方，否则面积判据没有意义
    const clipped = face.tri.filter((p) => toNDC(matrix, p).w <= EPSILON);

    check(`${face.name} 顶点均在相机前方`, clipped.length === 0, `被裁剪顶点数=${clipped.length}`);

    // 3. 从盒内看，面的三角形必须是顺时针（背面），才能被 cullFace(FRONT) 保留
    const area = signedArea(matrix, face.tri[0], face.tri[1], face.tri[2]);

    check(`${face.name} 为背面（cullFace(FRONT) 会保留）`, area < 0, `signedArea=${area.toFixed(4)}`);
}

// 4. 视角朝向与面命名的对应关系（alpha/beta 的语义）
{
    const cases = [
        { alpha: 0, beta: 0, expect: 'front(+Z)' },
        { alpha: 90, beta: 0, expect: 'right(+X)' },
        { alpha: 180, beta: 0, expect: 'back(-Z)' },
        { alpha: 270, beta: 0, expect: 'left(-X)' },
    ];

    for (const item of cases) {
        const matrix = createMatrix(item.alpha, item.beta);
        const hit = FACES.find((face) => {
            const ndc = toNDC(matrix, face.center);
            return ndc.w > 0 && Math.abs(ndc.x) < 1e-3 && Math.abs(ndc.y) < 1e-3;
        });
        check(
            `alpha=${item.alpha} 正对 ${item.expect}`,
            !!hit && hit.name === item.expect,
            hit ? hit.name : '无命中',
        );
    }
}

// 5. 拖拽控制只依赖 viewer 的三个接口，这里用桩对象验证符号与缩放限位
{
    const calls = [];
    const stub = {
        camera: { fov: 75 },
        rotateBy(dx, dy) {
            calls.push([dx, dy]);
        },
        setFov(fov) {
            stub.camera.fov = fov;
        },
    };

    const control = new DragControl(stub, { sensitivity: 0.2, minFov: 30, maxFov: 90 });

    control.move(200, 200);
    check('未按下时移动不产生旋转', calls.length === 0, `调用次数=${calls.length}`);

    control.start(100, 100);
    control.move(120, 110);
    check(
        '右拖 +20px / 下拖 +10px 产生 (4, 2) 的旋转量',
        calls.length === 1 && Math.abs(calls[0][0] - 4) < EPSILON && Math.abs(calls[0][1] - 2) < EPSILON,
        JSON.stringify(calls[0]),
    );

    control.end();
    control.move(300, 300);
    check('松手后不再旋转', calls.length === 1, `调用次数=${calls.length}`);

    control.zoom(1000);
    check('滚轮拉远被 minFov/maxFov 限位', stub.camera.fov <= 90 && stub.camera.fov >= 30, `fov=${stub.camera.fov}`);
}

console.log(results.join('\n'));
console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);