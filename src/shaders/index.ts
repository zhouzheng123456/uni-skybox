/**
 * 天空盒着色器。
 *
 * 立方体贴图按「方向」查找纹素，而立方体本身的顶点坐标就是方向，
 * 所以顶点着色器只需把位置透传，片元着色器交给 textureCube 采样，
 * 既不需要 UV，也不需要法线。
 *
 * 两份源码以字符串数组拼接，省掉 glsl 打包插件，nano 级别的体积可控。
 */

export const VERTEX_SHADER = [
    'attribute vec3 aVertex;',

    'uniform mat4 uView;',
    'uniform mat4 uProjection;',

    'varying vec3 vLookup;',

    'void main() {',
    '    vLookup = aVertex;',
    '    gl_Position = uProjection * (uView * vec4(aVertex, 1.0));',
    '}',
].join('\n');

export const FRAGMENT_SHADER = [
    'precision mediump float;',

    'uniform samplerCube uSky;',

    'varying vec3 vLookup;',

    'void main() {',
    '    gl_FragColor = textureCube(uSky, normalize(vLookup));',
    '}',
].join('\n');