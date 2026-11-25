/**
 * 产物体积与源码规模统计，对应论文表 2。
 *
 * 用法：
 *   npm run build && node bench/size.mjs
 *   node bench/size.mjs --json    # 额外把结果写到 bench/out/size.json
 *
 * 为什么要单独测 gzip / brotli：npm 上标称的体积通常是未压缩的，网络实际传输的是
 * 压缩后体积，两者差 3~4 倍，只报原始体积会让对比失去意义。
 */
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const TARGETS = [
    { name: 'uni-skybox.esm.js', label: 'ESM（module 入口）' },
    { name: 'uni-skybox.umd.js', label: 'UMD（script 直引）' },
];

function kb(bytes) {
    return (bytes / 1024).toFixed(1);
}

function walk(dir, out = []) {

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);

        if (entry.isDirectory()) {
            walk(full, out);
        } else if (entry.name.endsWith('.ts')) {
            out.push(full);
        }
    }

    return out;
}

/** 统计源码规模：总行数、非空行、注释行、导出符号数 */
function measureSource() {

    const files = walk(resolve(ROOT, 'src'));
    const totals = { files: files.length, lines: 0, code: 0, comment: 0, blank: 0, exports: 0 };

    for (const file of files) {

        const text = readFileSync(file, 'utf8');
        const lines = text.split(/\r?\n/);

        totals.lines += lines.length;

        for (const line of lines) {
            const trimmed = line.trim();

            if (!trimmed) {
                totals.blank += 1;
            } else if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                totals.comment += 1;
            } else {
                totals.code += 1;
            }
        }

        totals.exports += (text.match(/^export\s/gm) || []).length;
    }

    return totals;
}

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const rows = [];

for (const target of TARGETS) {

    const file = resolve(ROOT, 'dist', target.name);

    let buffer;

    try {
        buffer = readFileSync(file);
    } catch (error) {
        console.error(`[bench] 缺少 dist/${target.name}，请先执行 npm run build`);
        process.exit(1);
    }

    rows.push({
        label: target.label,
        file: target.name,
        raw: buffer.length,
        gzip: gzipSync(buffer, { level: 9 }).length,
        brotli: brotliCompressSync(buffer).length,
    });
}

const source = measureSource();
const deps = Object.keys(pkg.dependencies || {}).length;

console.log(`\nuni-skybox v${pkg.version} · 来源 src/（${source.files} 个文件 / ${source.lines} 行）`);

console.log('\n| 产物 | 原始 | gzip | brotli |');
console.log('|---|---|---|---|');

for (const row of rows) {
    console.log(`| ${row.label} | ${kb(row.raw)} KB | ${kb(row.gzip)} KB | ${kb(row.brotli)} KB |`);
}

console.log('\n| 指标 | 数值 |');
console.log('|---|---|');
console.log(`| 源码文件数 | ${source.files} |`);
console.log(`| 源码总行数 | ${source.lines} |`);
console.log(`| 代码行（非空非注释） | ${source.code} |`);
console.log(`| 注释行 | ${source.comment} |`);
console.log(`| 空白行 | ${source.blank} |`);
console.log(`| 运行时依赖数 | ${deps} |`);
console.log(`| export 语句数 | ${source.exports} |`);

console.log('\n提示：表 2 的“对比方案”列需要用同一台机器、同一构建配置另外测 three.js / Babylon.js 等');

if (process.argv.includes('--json')) {

    const outDir = resolve(HERE, 'out');

    mkdirSync(outDir, { recursive: true });

    writeFileSync(
        resolve(outDir, 'size.json'),
        JSON.stringify({ version: pkg.version, artifacts: rows, source, runtimeDeps: deps }, null, 2),
    );

    console.log(`\n[bench] 已写入 bench/out/size.json（${kb(statSync(resolve(outDir, 'size.json')).size)} KB）`);
}