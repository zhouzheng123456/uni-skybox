/**
 * 基准采集页逻辑（对应论文表 1、表 3 ~ 表 7）。
 *
 * 设计原则：
 * 1. 每项实验独立成函数，互不共享可变状态，可以单独重跑；
 * 2. 固定 960×540 的绘制缓冲、不乘 dpr，避免不同机器分辨率差异污染对比；
 * 3. 所有结果同时保留原始样本与分位数，表格只用于看，JSON 用于复核。
 */
import { SkyboxViewer, clearPool, loadCubeImages, poolStats } from '../dist/uni-skybox.esm.js';

const FACES = ['front', 'back', 'left', 'right', 'top', 'bottom'];

const params = new URLSearchParams(location.search);
const ASSET_SIZE = Number(params.get('size')) || 1024;

const STAGE = document.getElementById('stage');

const state = {
    env: null,
    source: null,
    cold: null,
    frame: null,
    memory: null,
    recovery: null,
    capability: null,
};

/* ------------------------------------------------------------------ 小工具 */

const $ = (id) => document.getElementById(id);
const round = (value, digits = 2) => Number(value.toFixed(digits));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

function setStatus(id, text) {
    const node = $(id);
    if (node) {
        node.textContent = text;
    }
}

function quantile(sorted, q) {

    if (!sorted.length) {
        return 0;
    }

    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = sorted[base + 1];

    return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

function summary(samples) {

    const sorted = samples.slice().sort((a, b) => a - b);
    const total = sorted.reduce((sum, value) => sum + value, 0);

    return {
        n: sorted.length,
        mean: round(total / (sorted.length || 1)),
        min: round(sorted[0] || 0),
        p50: round(quantile(sorted, 0.5)),
        p95: round(quantile(sorted, 0.95)),
        p99: round(quantile(sorted, 0.99)),
        max: round(sorted[sorted.length - 1] || 0),
    };
}

function table(headers, rows) {

    const head = '<tr>' + headers.map((text, index) => `<th>${text}</th>`).join('') + '</tr>';
    const body = rows
        .map((cells) => '<tr>' + cells.map((text) => `<td>${text}</td>`).join('') + '</tr>')
        .join('');

    return `<table>${head}${body}</table>`;
}

function makeSurface(width, height) {

    const canvas = document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;

    STAGE.appendChild(canvas);

    return canvas;
}

function waitEventOrTimeout(target, name, timeout) {

    return new Promise((resolve) => {

        let settled = false;

        const done = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            target.removeEventListener(name, onEvent);
            resolve(value);
        };

        const onEvent = (event) => done(event);

        target.addEventListener(name, onEvent);
        setTimeout(() => done(null), timeout);
    });
}

/** 请求恢复前的等待：在丢失事件的同一任务里直接恢复，失败率明显更高 */
const RESTORE_DELAY_MS = 120;

/* -------------------------------------------------------------- 贴图来源 */

function proceduralFace(from, to, bars) {

    const size = 512;
    const canvas = document.createElement('canvas');

    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, size, size);

    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2;

    for (let i = 0; i <= size; i += size / 8) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, size);
        ctx.moveTo(0, i);
        ctx.lineTo(size, i);
        ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < bars; i++) {
        ctx.fillRect(24 + i * 26, 24, 14, 90);
    }

    return canvas;
}

function proceduralUrls() {

    const palette = [
        ['#0b3d91', '#1e88e5'],
        ['#4a148c', '#8e24aa'],
        ['#1b5e20', '#43a047'],
        ['#b71c1c', '#e53935'],
        ['#0d47a1', '#00acc1'],
        ['#4e342e', '#8d6e63'],
    ];

    const urls = {};

    FACES.forEach((face, index) => {
        urls[face] = proceduralFace(palette[index][0], palette[index][1], index + 1).toDataURL('image/png');
    });

    return urls;
}

async function resolveSource() {

    if (state.source) {
        return state.source;
    }

    const urls = {};

    FACES.forEach((face) => {
        urls[face] = `./assets/${ASSET_SIZE}/${face}.png`;
    });

    let served = false;

    try {
        served = (await fetch(urls.front, { cache: 'no-store' })).ok;
    } catch (error) {
        served = false;
    }

    state.source = served
        ? { label: `assets/${ASSET_SIZE} PNG`, network: true, urls }
        : { label: '程序化 data URL（未找到 bench/assets）', network: false, urls: proceduralUrls() };

    return state.source;
}

function bust(urls, seed) {

    const out = {};

    FACES.forEach((face) => {
        const url = urls[face];
        out[face] = url.startsWith('data:')
            ? url
            : url + (url.includes('?') ? '&' : '?') + 'r=' + Date.now() + '-' + seed;
    });

    return out;
}

/* ------------------------------------------------------------ 0 环境信息 */

async function collectEnv() {

    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    const debug = gl && gl.getExtension('WEBGL_debug_renderer_info');

    let version = 'unknown';

    try {
        version = (await (await fetch('../package.json')).json()).version;
    } catch (error) {
        version = 'unknown';
    }

    return {
        library: `uni-skybox v${version}`,
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        screen: `${screen.width}×${screen.height}`,
        cpuThreads: navigator.hardwareConcurrency || '未知',
        deviceMemory: navigator.deviceMemory ? navigator.deviceMemory + ' GB' : '未提供',
        gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : '被浏览器隐藏',
        gpuVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : '被浏览器隐藏',
        glVersion: gl ? gl.getParameter(gl.VERSION) : '不支持 WebGL',
        glslVersion: gl ? gl.getParameter(gl.SHADING_LANGUAGE_VERSION) : '-',
        maxCubeMap: gl ? gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE) : 0,
        maxTexture: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0,
        textureSource: (state.source && state.source.label) || '',
    };
}

function renderEnv(env) {

    const rows = Object.entries(env)
        .filter(([, value]) => value !== '' && value !== null)
        .map(([key, value]) => [key, String(value)]);

    $('env').innerHTML = table(['字段', '值'], rows);
}

/* ------------------------------------------------------- 1 冷启动至首帧 */

async function runColdStart(times) {

    const source = await resolveSource();
    const samples = [];

    for (let i = 0; i < times; i++) {

        const canvas = makeSurface(960, 540);
        const t0 = performance.now();
        const viewer = new SkyboxViewer({ canvas, autoRotate: 0 });

        await viewer.setImageUrls(source.urls);
        await nextFrame();

        samples.push(performance.now() - t0);

        viewer.destroy();
        canvas.remove();

        setStatus('cold-status', `进行中 ${i + 1}/${times}`);
    }

    setStatus('cold-status', '完成');

    return {
        source: source.label,
        first: round(samples[0]),
        rest: summary(samples.slice(1)),
        samples: samples.map((value) => round(value)),
    };
}

function renderCold(result) {

    const rest = result.rest;

    $('cold-out').innerHTML = table(
        ['分组', '样本数', '均值', 'p50', 'p95', '最大'],
        [
            ['首次（含下载与解码）', 1, `—`, `—`, `—`, `${result.first} ms`],
            ['后续（含纹理上传）', rest.n, `${rest.mean} ms`, `${rest.p50} ms`, `${rest.p95} ms`, `${rest.max} ms`],
        ],
    ) + `<p class="hint">贴图来源：${result.source}</p>`;
}

/* -------------------------------------------------- 2 稳态帧间隔与单帧耗时 */

async function runFrameStats(frames) {

    const source = await resolveSource();
    const canvas = makeSurface(960, 540);
    const viewer = new SkyboxViewer({ canvas, autoRotate: 6 });

    await viewer.setImageUrls(source.urls);

    viewer.start();

    const intervals = await new Promise((resolve) => {

        const list = [];
        let previous = 0;

        const tick = (time) => {

            if (previous) {
                list.push(time - previous);
            }

            previous = time;

            if (list.length >= frames) {
                resolve(list);
                return;
            }

            if (list.length > 0 && list.length % 300 === 0) {
                setStatus('frame-status', `帧间隔 ${list.length}/${frames}`);
            }

            requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
    });

    viewer.stop();

    // 预热：首批渲染包含管线首次提交与缓存建立，先跑十几帧再计时
    const warmup = new Uint8Array(4);

    for (let i = 0; i < 12; i++) {
        viewer.camera.alpha = i * 5;
        viewer.render();
    }

    viewer.gl.readPixels(0, 0, 1, 1, viewer.gl.RGBA, viewer.gl.UNSIGNED_BYTE, warmup);

    // 单帧耗时之一：只统计 JS + GL 命令提交，不含 GPU 光栅化等待。
    // performance.now() 在非跨源隔离页面上被钳到 100 µs，单帧级测不准，
    // 所以按批次计时再除以帧数。
    const submit = [];

    for (let batch = 0; batch < 30; batch++) {

        const t0 = performance.now();

        for (let i = 0; i < 30; i++) {
            viewer.camera.alpha = (batch * 30 + i) * 0.37 % 360;
            viewer.render();
        }

        submit.push((performance.now() - t0) / 30);
    }

    // 单帧耗时之二：用 readPixels 强制同步，把 GPU 光栅化等待计入。
    // 不用 gl.finish()：ANGLE / D3D11 后端上它实测并不阻塞，读数恒为 0。
    const sync = [];
    const pixel = new Uint8Array(4);

    for (let batch = 0; batch < 20; batch++) {

        const t0 = performance.now();

        for (let i = 0; i < 5; i++) {
            viewer.camera.alpha = (batch * 5 + i) * 0.37 % 360;
            viewer.render();
        }

        viewer.gl.readPixels(0, 0, 1, 1, viewer.gl.RGBA, viewer.gl.UNSIGNED_BYTE, pixel);
        sync.push((performance.now() - t0) / 5);
    }

    viewer.destroy();
    canvas.remove();

    setStatus('frame-status', '完成');

    return {
        intervals: summary(intervals),
        submit: summary(submit),
        sync: summary(sync),
        frames,
    };
}

function renderFrame(result) {

    const row = (name, item, unit) => [
        name, item.n, `${item.mean}${unit}`, `${item.p50}${unit}`, `${item.p95}${unit}`, `${item.p99}${unit}`, `${item.max}${unit}`,
    ];

    $('frame-out').innerHTML = table(
        ['指标', '样本数', '均值', 'p50', 'p95', 'p99', '最大'],
        [
            row('帧间隔', result.intervals, ' ms'),
            row('单帧耗时（仅提交）', result.submit, ' ms'),
            row('单帧耗时（含 readPixels 同步）', result.sync, ' ms'),
        ],
    );
}

/* ---------------------------------------------------------- 3 多实例显存 */

async function runMemory(maxInstances) {

    const source = await resolveSource();
    const counts = [1, 2, 4, 8].filter((value) => value <= maxInstances);
    const rows = [];

    for (const count of counts) {

        for (const share of [true, false]) {

            const canvas = makeSurface(64, 64);
            const gl = canvas.getContext('webgl');
            const images = await loadCubeImages(source.urls, canvas);

            const size = images.front.width;
            const one = 6 * size * size * 4;
            const viewers = [];

            for (let i = 0; i < count; i++) {
                viewers.push(new SkyboxViewer({ canvas, images, shareTexture: share }));
            }

            const stats = poolStats(gl);

            rows.push({
                instances: count,
                share,
                size,
                liveTextures: share ? stats.liveTextures : count,
                pooled: stats.entries,
                bytesMB: round((share ? stats.bytes : count * one) / (1024 * 1024)),
            });

            for (const viewer of viewers) {
                viewer.destroy();
            }

            clearPool(gl);
            canvas.remove();

            setStatus('mem-status', `进行中 实例数 ${count} / ${share ? '共享' : '独占'}`);
        }
    }

    setStatus('mem-status', '完成');

    return { source: source.label, rows };
}

function renderMemory(result) {

    const rows = result.rows.map((item) => [
        item.instances,
        item.share ? '共享（默认）' : '独占（shareTexture: false）',
        item.liveTextures,
        `${item.bytesMB} MB`,
    ]);

    $('mem-out').innerHTML = table(['实例数', '模式', '实际纹理对象数', '估算显存'], rows)
        + `<p class="hint">贴图来源：${result.source}；显存按 6 × 边长² × 4 字节估算。</p>`;
}

/* ------------------------------------------------------ 4 上下文丢失与恢复 */

async function runRecovery(trials, bypassCache) {

    const source = await resolveSource();
    const groups = [
        { key: 'reuse', label: '复用已解码图像', reuse: true },
        { key: 'reload', label: '清池后重新加载', reuse: false },
    ];

    const result = {};
    const networkOf = () => performance.getEntriesByType('resource')
        .filter((entry) => entry.name.indexOf('/assets/') >= 0).length;

    for (const group of groups) {

        const samples = [];
        let failed = 0;

        for (let i = 0; i < trials; i++) {

            const canvas = makeSurface(960, 540);
            const viewer = new SkyboxViewer({ canvas, autoRotate: 0 });

            await viewer.setImageUrls(source.urls);
            viewer.start();
            await nextFrame();

            const gl = viewer.gl;
            const ext = gl.getExtension('WEBGL_lose_context');

            if (!ext) {
                viewer.destroy();
                canvas.remove();
                throw new Error('当前浏览器不支持 WEBGL_lose_context，无法做本实验');
            }

            let reload = Promise.resolve();

            if (!group.reuse) {
                // 监听器在 viewer 构造之后注册，因此会在其重建逻辑之后执行
                canvas.addEventListener('webglcontextrestored', () => {
                    const urls = bypassCache ? bust(source.urls, i) : source.urls;
                    reload = viewer.setImageUrls(urls);
                }, { once: true });
            }

            const before = networkOf();
            const t0 = performance.now();
            const lostWaiting = waitEventOrTimeout(canvas, 'webglcontextlost', 2000);

            ext.loseContext();

            const lost = await lostWaiting;
            const tLost = performance.now();

            if (!lost) {
                viewer.destroy();
                clearPool(gl);
                canvas.remove();
                failed += 1;
                setStatus('rec-status', `${group.label} ${i + 1}/${trials}（丢失事件超时）`);
                continue;
            }

            if (!group.reuse) {
                clearPool(gl);
            }

            // 关键：等丢失流程结束后再请求恢复。在 lost 事件的同一任务里立刻
            // restoreContext()，Chrome/ANGLE 上有相当概率永远不派发 restored。
            await sleep(RESTORE_DELAY_MS);

            let restored = null;
            const tRequest = performance.now();

            for (let attempt = 0; attempt < 3 && !restored; attempt++) {
                const waiting = waitEventOrTimeout(canvas, 'webglcontextrestored', 2500);
                ext.restoreContext();
                restored = await waiting;
                if (!restored) {
                    await sleep(200);
                }
            }

            const tRestored = performance.now();

            if (!restored) {
                viewer.destroy();
                clearPool(gl);
                canvas.remove();
                failed += 1;
                setStatus('rec-status', `${group.label} ${i + 1}/${trials}（恢复事件超时）`);
                continue;
            }

            await reload;
            await nextFrame();
            await nextFrame();

            const tDone = performance.now();

            samples.push({
                lost: tLost - t0,
                rebuild: tRestored - tRequest,
                firstFrame: tDone - tRestored,
                effective: tDone - tRequest,
                total: tDone - t0,
                requests: networkOf() - before,
            });

            viewer.destroy();
            clearPool(gl);
            canvas.remove();

            await sleep(40);
            setStatus('rec-status', `${group.label} ${i + 1}/${trials}`);
        }

        result[group.key] = {
            label: group.label,
            failed,
            effective: summary(samples.map((item) => item.effective)),
            total: summary(samples.map((item) => item.total)),
            lost: summary(samples.map((item) => item.lost)),
            rebuild: summary(samples.map((item) => item.rebuild)),
            firstFrame: summary(samples.map((item) => item.firstFrame)),
            requests: Math.round(samples.reduce((sum, item) => sum + item.requests, 0) / samples.length),
        };
    }

    setStatus('rec-status', '完成');

    return { source: source.label, bypassCache, trials, groups: result };
}

function renderRecovery(result) {

    const groups = result.groups;

    const rows = ['reuse', 'reload'].map((key) => {
        const group = groups[key];

        return [
            group.label,
            `${group.effective.mean} ms`,
            `${group.effective.p50} ms`,
            `${group.effective.p95} ms`,
            `${group.effective.max} ms`,
            group.requests,
            group.failed,
        ];
    });

    $('rec-out').innerHTML = table(
        ['组别', '恢复耗时均值', 'p50', 'p95', '最大', '平均图片请求数', '失败次数'],
        rows,
    ) + `<p class="hint">恢复耗时 = 发起恢复请求 → 首帧稳定，已扣除 ${RESTORE_DELAY_MS} ms 的固定等待；
        试验次数 ${result.trials}；重载组${result.bypassCache ? '已' : '未'}绕开 HTTP 缓存；贴图来源：${result.source}。
        失败次数不是 0 时，说明该浏览器没能完成一次完整的丢失/恢复，需在 README 的已知问题里记下来。</p>`;
}

/* ------------------------------------------------------------- 5 能力自检 */

function testNpot(gl) {

    const texture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X, 0, gl.RGBA, 1023, 1023, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const error = gl.getError();

    gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
    gl.deleteTexture(texture);

    return error === gl.NO_ERROR;
}

function runCapability() {

    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    const max = gl ? gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE) : 0;

    const rows = [
        ['WebGL1 上下文可创建', !!gl, gl ? '通过' : '失败'],
        ['立方体贴图最大边长', max, max >= 2048 ? '通过' : '偏低'],
        ['非 2 次幂贴图可用', gl ? testNpot(gl) : false, ''],
        ['WEBGL_lose_context 可用', gl ? !!gl.getExtension('WEBGL_lose_context') : false, ''],
        ['devicePixelRatio 可读', typeof window.devicePixelRatio === 'number', window.devicePixelRatio],
        ['performance.memory 可读', !!performance.memory, ''],
        ['canvas.createImage（小程序）', typeof canvas.createImage === 'function', ''],
        ['canvas.requestAnimationFrame（小程序）', typeof canvas.requestAnimationFrame === 'function', ''],
    ].map(([name, value, extra]) => {
        const pass = typeof value === 'boolean' ? value : Boolean(value);
        const shown = typeof value === 'boolean' ? (pass ? '是' : '否') : String(value);

        return [name, shown, extra === '' ? (pass ? '通过' : '不可用') : String(extra)];
    });

    setStatus('cap-status', '完成');

    return {
        rows,
        passRate: round(rows.filter((row) => row[2] === '通过').length / rows.length * 100, 1),
    };
}

function renderCapability(result) {

    $('cap-out').innerHTML = table(['检查项', '结果', '判定'], result.rows)
        + `<p class="hint">本机通过率 ${result.passRate}%；表 7 需要多机型汇总。</p>`;
}

/* ------------------------------------------------------------------ 导出 */

function limitSamples(value) {

    if (Array.isArray(value)) {
        return value.length > 400 ? value.slice(0, 400).concat(['…共 ' + value.length + ' 个样本']) : value;
    }

    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value)) {
            out[key] = limitSamples(value[key]);
        }
        return out;
    }

    return value;
}

function buildPayload() {

    return {
        generatedAt: new Date().toISOString(),
        env: state.env,
        experiments: {
            coldStart: state.cold,
            steadyState: state.frame,
            memory: state.memory,
            recovery: state.recovery,
            capability: state.capability,
        },
    };
}

function buildCsv() {

    const lines = ['表,方案,指标,值'];

    const push = (tableName, plan, metric, value) => {
        lines.push([tableName, plan, metric, value].join(','));
    };

    if (state.env) {
        for (const [key, value] of Object.entries(state.env)) {
            push('表1', key, '值', String(value).replace(/,/g, ' '));
        }
    }

    if (state.cold) {
        push('表3', '首次', 'ms', state.cold.first);
        for (const key of ['mean', 'p50', 'p95', 'max']) {
            push('表3', '后续', key + '(ms)', state.cold.rest[key]);
        }
    }

    if (state.frame) {
        for (const key of ['intervals', 'submit', 'sync']) {
            for (const item of ['mean', 'p50', 'p95', 'p99', 'max']) {
                push('表4', key, item + '(ms)', state.frame[key][item]);
            }
        }
    }

    if (state.memory) {
        for (const row of state.memory.rows) {
            push('表5', `${row.instances} 实例/${row.share ? '共享' : '独占'}`, '纹理数', row.liveTextures);
            push('表5', `${row.instances} 实例/${row.share ? '共享' : '独占'}`, '显存(MB)', row.bytesMB);
        }
    }

    if (state.recovery) {
        for (const key of ['reuse', 'reload']) {
            const group = state.recovery.groups[key];
            for (const item of ['mean', 'p50', 'p95', 'max']) {
                push('表6', group.label, item + '(ms)', group.effective[item]);
            }
            push('表6', group.label, '图片请求数', group.requests);
            push('表6', group.label, '失败次数', group.failed);
        }
    }

    if (state.capability) {
        for (const row of state.capability.rows) {
            push('表7', row[0], row[1], row[2]);
        }
    }

    return lines.join('\n');
}

/* ------------------------------------------------------------------ 绑定 */

function bind(id, handler) {

    const button = $(id);

    button.addEventListener('click', async () => {

        button.disabled = true;

        try {
            await handler();
        } catch (error) {
            console.error(error);
            setStatus(id.replace('-run', '-status'), '出错：' + error.message);
        } finally {
            button.disabled = false;
        }
    });
}

bind('cold-run', async () => {
    const times = Math.max(1, Number($('cold-n').value) || 30);
    state.cold = await runColdStart(times);
    renderCold(state.cold);
});

bind('frame-run', async () => {
    const frames = Math.max(100, Number($('frame-n').value) || 3000);
    state.frame = await runFrameStats(frames);
    renderFrame(state.frame);
});

bind('mem-run', async () => {
    const maxInstances = Math.max(2, Number($('mem-n').value) || 8);
    state.memory = await runMemory(maxInstances);
    renderMemory(state.memory);
});

bind('rec-run', async () => {
    const trials = Math.max(1, Number($('rec-n').value) || 20);
    state.recovery = await runRecovery(trials, $('rec-nocache').checked);
    renderRecovery(state.recovery);
});

bind('cap-run', async () => {
    state.capability = runCapability();
    renderCapability(state.capability);
});

$('export-json').addEventListener('click', () => {
    $('export-out').value = JSON.stringify(limitSamples(buildPayload()), null, 2);
    setStatus('export-status', '已生成，可直接复制或下载 CSV');
});

$('copy-json').addEventListener('click', async () => {

    const text = $('export-out').value || JSON.stringify(limitSamples(buildPayload()), null, 2);

    $('export-out').value = text;

    try {
        await navigator.clipboard.writeText(text);
        setStatus('export-status', '已复制到剪贴板');
    } catch (error) {
        setStatus('export-status', '复制失败，请手动全选复制');
    }
});

$('export-csv').addEventListener('click', () => {

    const blob = new Blob(['\ufeff' + buildCsv()], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');

    link.href = URL.createObjectURL(blob);
    link.download = 'uni-skybox-bench.csv';
    link.click();

    URL.revokeObjectURL(link.href);
    setStatus('export-status', '已下载 uni-skybox-bench.csv');
});

/* ------------------------------------------------------------------ 启动 */

(async function boot() {

    await resolveSource();

    state.env = await collectEnv();
    state.env.textureSource = state.source.label;

    renderEnv(state.env);

    setStatus('cold-status', state.source.network
        ? '就绪：贴图走 HTTP'
        : '就绪：未找到 bench/assets，已退回程序化贴图（跑 node scripts/gen-assets.mjs 可启用 PNG）');

    window.__bench = state;
})();