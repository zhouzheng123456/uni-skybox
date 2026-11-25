export default {
    input: 'dist/esm/index.js',
    output: [
        {
            file: 'dist/uni-skybox.esm.js',
            format: 'es',
        },
        {
            file: 'dist/uni-skybox.umd.js',
            format: 'umd',
            name: 'UniSkybox',
            exports: 'named',
        },
    ],
};