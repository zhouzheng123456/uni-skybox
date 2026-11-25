/**
 * H5 demo：优先加载 ./assets 下的六张立方体贴图；目录为空时自动退回程序化贴图，
 * 用来验证渲染、接缝、朝向与拖拽。
 *
 * 调试参数：
 *   ?alpha=45&beta=10&fov=75&auto=0   指定初始视角与自动旋转速度（度、度/秒）
 *   ?fmt=webp                         改用体积更小的 .webp 贴图
 *   ?face=right                       直接跳到某一面（front/back/left/right/top/bottom）
 */
(function () {
    'use strict';

    var FACES = ['front', 'back', 'left', 'right', 'top', 'bottom'];

    // 视角与面的一一对应：alpha = 0 时正对 front(+Z)
    var FACING = [
        { alpha: 0, name: 'FRONT +Z' },
        { alpha: 90, name: 'RIGHT +X' },
        { alpha: 180, name: 'BACK -Z' },
        { alpha: 270, name: 'LEFT -X' },
    ];

    var FACE_VIEW = {
        front: [0, 0],
        right: [90, 0],
        back: [180, 0],
        left: [270, 0],
        top: [0, 89.9],
        bottom: [0, -89.9],
    };

    var DEFAULT_FOV = 75;
    var DEFAULT_AUTO_ROTATE = 6;

    var canvas = document.getElementById('skybox');
    var stage = document.getElementById('stage');
    var status = document.getElementById('status');
    var overlay = document.getElementById('overlay');
    var overlayText = document.getElementById('overlay-text');
    var assetInfo = document.getElementById('asset-info');

    var query = new URLSearchParams(location.search);
    var num = function (key, fallback) {
        var value = parseFloat(query.get(key));
        return isNaN(value) ? fallback : value;
    };

    var format = query.get('fmt') === 'webp' ? 'webp' : 'png';
    var urls = {};
    FACES.forEach(function (face) {
        urls[face] = './assets/' + face + '.' + format;
    });

    var viewer = null;
    var control = null;

    function showOverlay(text, isError) {
        overlayText.textContent = text;
        overlay.classList.toggle('error', !!isError);
        overlay.classList.remove('hidden');
    }

    function hideOverlay() {
        overlay.classList.add('hidden');

        // 淡出结束后彻底移除，避免透明层继续盖在画布上
        var drop = function () {
            overlay.style.display = 'none';
        };

        overlay.addEventListener('transitionend', drop, { once: true });
        setTimeout(drop, 600);
    }

    /** 当前视线落在哪一面：beta 超过 45° 判为顶/底，alpha 取最近的水平面 */
    function facingText() {
        var beta = viewer.camera.beta;

        if (beta > 45) {
            return 'TOP +Y';
        }
        if (beta < -45) {
            return 'BOTTOM -Y';
        }

        var alpha = ((viewer.camera.alpha % 360) + 360) % 360;
        var nearest = FACING[0];
        var nearestDiff = 360;

        FACING.forEach(function (item) {
            var diff = Math.abs(((alpha - item.alpha + 540) % 360) - 180);
            if (diff < nearestDiff) {
                nearestDiff = diff;
                nearest = item;
            }
        });

        return nearestDiff > 45 ? '接缝 ' + nearest.name : nearest.name;
    }

    function report() {
        if (!viewer) {
            return;
        }

        status.textContent = 'alpha=' + viewer.camera.alpha.toFixed(1) + '°'
            + '  beta=' + viewer.camera.beta.toFixed(1) + '°'
            + '  fov=' + viewer.camera.fov.toFixed(0) + '°'
            + '  autoRotate=' + viewer.autoRotate + '°/s'
            + '  size=' + canvas.width + 'x' + canvas.height
            + '\n面向 ' + facingText();
    }

    function fit() {
        var rect = stage.getBoundingClientRect();
        viewer.resize(rect.width, rect.height);
    }

    function jumpTo(face) {
        var view = FACE_VIEW[face];
        if (!viewer || !view) {
            return;
        }

        // 手动定位时先停下自动旋转，方便逐面比对接缝
        viewer.autoRotate = 0;
        viewer.setView(view[0], view[1]);
        report();
    }

    function reset() {
        if (!viewer) {
            return;
        }

        viewer.autoRotate = DEFAULT_AUTO_ROTATE;
        viewer.setFov(DEFAULT_FOV);
        viewer.setView(0, 0);
        report();
    }

    /** 单独探一张贴图，把真实尺寸回填到左上角信息条 */
    function describeAssets() {
        var probe = new Image();

        probe.onload = function () {
            assetInfo.textContent = '六面立方体贴图 · ' + format.toUpperCase()
                + ' · ' + probe.width + '×' + probe.height + ' ×6';
        };

        probe.src = urls.front;
    }

    /** 仓库不附带第三方贴图，缺失时现场画六张带网格与标签的色块 */
    function makeFace(label, from, to) {
        var size = 512;
        var face = document.createElement('canvas');

        face.width = size;
        face.height = size;

        var ctx = face.getContext('2d');
        var gradient = ctx.createLinearGradient(0, 0, size, size);

        gradient.addColorStop(0, from);
        gradient.addColorStop(1, to);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);

        // 网格线便于观察旋转与透视变形
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 2;
        for (var i = 0; i <= size; i += size / 12) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, size);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(size, i);
            ctx.stroke();
        }

        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '600 40px -apple-system, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, size / 2, size / 2);

        return face;
    }

    function makeFaces() {
        return {
            front: makeFace('FRONT +Z', '#0b3d91', '#1e88e5'),
            back: makeFace('BACK -Z', '#4a148c', '#8e24aa'),
            left: makeFace('LEFT -X', '#1b5e20', '#43a047'),
            right: makeFace('RIGHT +X', '#b71c1c', '#e53935'),
            top: makeFace('TOP +Y', '#0d47a1', '#00acc1'),
            bottom: makeFace('BOTTOM -Y', '#4e342e', '#8d6e63'),
        };
    }

    function ready() {
        control = new UniSkybox.DragControl(viewer, { sensitivity: 0.2 }).bindDOM(canvas);

        jumpTo(query.get('face'));

        hideOverlay();
        viewer.start();
        report();
    }

    function init() {
        try {
            viewer = new UniSkybox.SkyboxViewer({
                canvas: canvas,
                fov: num('fov', DEFAULT_FOV),
                alpha: num('alpha', 0),
                beta: num('beta', 0),
                autoRotate: num('auto', DEFAULT_AUTO_ROTATE),
            });
        } catch (error) {
            showOverlay('创建 WebGL 上下文失败：' + error.message, true);
            console.error(error);
            return;
        }

        fit();
        showOverlay('正在加载六张 ' + format.toUpperCase() + ' 贴图…');

        viewer.setImageUrls(urls).then(function () {
            describeAssets();
            ready();
        }).catch(function (error) {
            // 仓库不附带第三方素材，assets 缺失属于预期情况，退回程序化贴图
            console.info('[uni-skybox] 未找到 demo/assets 下的贴图，改用程序化贴图。', error.message);

            assetInfo.textContent = '程序化贴图 · 512×512 ×6';
            viewer.setImages(makeFaces());
            ready();
        });
    }

    window.addEventListener('keydown', function (event) {
        if (!viewer) {
            return;
        }

        if (event.code === 'Space') {
            viewer.autoRotate = viewer.autoRotate ? 0 : DEFAULT_AUTO_ROTATE;
            report();
            event.preventDefault();
            return;
        }

        if (event.key === 'r' || event.key === 'R') {
            reset();
            return;
        }

        var index = parseInt(event.key, 10);
        if (index >= 1 && index <= FACES.length) {
            jumpTo(FACES[index - 1]);
        }
    });

    window.addEventListener('resize', function () {
        if (!viewer) {
            return;
        }
        fit();
        report();
    });

    init();
    setInterval(report, 250);

    // 便于在控制台调试
    window.skyboxDemo = {
        get viewer() {
            return viewer;
        },
        get control() {
            return control;
        },
        jumpTo: jumpTo,
        reset: reset,
    };
})();