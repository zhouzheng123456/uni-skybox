/**
 * 生成基准测试用的六面立方体贴图（PNG），内容全部由程序绘制，不含第三方素材。
 *
 * 用法：
 *   node scripts/gen-assets.mjs               # 默认 1024×1024
 *   node scripts/gen-assets.mjs --size=2048   # 论文表 5 / 表 6 用的尺寸
 *
 * 之所以要真实 PNG 而不是 canvas 内存贴图：只有走 HTTP 才能测得「网络请求 + 图像
 * 解码」这段耗时，而这段正是上下文恢复机制声称省掉的部分。
 *
 * 不引入 pngjs / sharp 之类依赖：PNG 是 zlib + 四个自描述块，直接用 node:zlib 写。
 */
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const SIZE = Number((process.argv.find((arg) => arg.startsWith('--size=')) || '').split('=')[1]) || 1024;

const FACES = [
    { key: 'front', from: [11, 61, 145], to: [30, 136, 229] },
    { key: 'back', from: [74, 20, 140], to: [142, 36, 170] },
    { key: 'left', from: [27, 94, 32], to: [67, 160, 71] },
    { key: 'right', from: [183, 28, 28], to: [229, 57, 53] },
    { key: 'top', from: [13, 71, 161], to: [0, 172, 193] },
    { key: 'bottom', from: [78, 52, 46], to: [141, 110, 99] },
];

/* ---------------------------------------------------------------- PNG 编码 */

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c;
    }
    return table;
})();

function crc32(buffer) {
    let c = -1;
    for (let i = 0; i < buffer.length; i++) {
        c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ -1) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const name = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
}

function encodePng(width, height, rgba) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;   // 位深
    header[9] = 6;   // 颜色类型：RGBA
    header[10] = 0;  // 压缩方法
    header[11] = 0;  // 滤波方法
    header[12] = 0;  // 非隔行

    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);

    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0; // 每行滤波类型：None
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/* ----------------------------------------------------------------- 绘制 */

function paint(size, face, index) {
    const pixels = Buffer.alloc(size * size * 4);
    const grid = Math.max(8, Math.round(size / 8));
    const barWidth = Math.max(4, Math.round(size / 32));

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // 对角渐变：足够平滑，压缩率高，同时能看出纹理坐标是否拉伸
            const t = (x / (size - 1) + y / (size - 1)) / 2;
            let r = face.from[0] + (face.to[0] - face.from[0]) * t;
            let g = face.from[1] + (face.to[1] - face.from[1]) * t;
            let b = face.from[2] + (face.to[2] - face.from[2]) * t;

            if (x % grid === 0 || y % grid === 0) {
                r = r * 0.82 + 255 * 0.18;
                g = g * 0.82 + 255 * 0.18;
                b = b * 0.82 + 255 * 0.18;
            }

            // 左上角画 (index + 1) 条竖条，用来肉眼核对六面朝向是否接得上
            if (x < barWidth * 2 * (index + 1) && y < size / 10 && x % (barWidth * 2) < barWidth) {
                r = 245; g = 245; b = 245;
            }

            const offset = (y * size + x) * 4;
            pixels[offset] = Math.round(r);
            pixels[offset + 1] = Math.round(g);
            pixels[offset + 2] = Math.round(b);
            pixels[offset + 3] = 255;
        }
    }

    return pixels;
}

/* ------------------------------------------------------------------ 主流程 */

const outDir = resolve(ROOT, 'bench', 'assets', String(SIZE));

mkdirSync(outDir, { recursive: true });

console.log(`[uni-skybox] 生成 ${SIZE}×${SIZE} 六面贴图 → ${outDir}`);

for (let i = 0; i < FACES.length; i++) {
    const face = FACES[i];
    const png = encodePng(SIZE, SIZE, paint(SIZE, face, i));
    const file = resolve(outDir, face.key + '.png');

    writeFileSync(file, png);

    const kb = (png.length / 1024).toFixed(1);
    const gz = (gzipSync(png).length / 1024).toFixed(1);
    const br = (brotliCompressSync(png).length / 1024).toFixed(1);

    console.log(`  ${face.key.padEnd(7)} ${kb.padStart(8)} KB  gzip ${gz.padStart(7)} KB  br ${br.padStart(7)} KB`);
}

console.log('[uni-skybox] 完成。基准页地址：npm run bench → http://localhost:5174/bench/');