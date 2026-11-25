/**
 * 极简 WebGL program 封装。
 *
 * 不做全量 uniform / attribute 反射，也不支持 define 变体，
 * 只提供天空盒用得到的按名查询与赋值。
 */
export class GLProgram {

    public readonly program: WebGLProgram;

    private gl: WebGLRenderingContext;

    private attributeLocations: { [name: string]: number } = {};
    private uniformLocations: { [name: string]: WebGLUniformLocation } = {};

    constructor(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string) {

        this.gl = gl;

        const vertexShader = this.compile(gl.VERTEX_SHADER, vertexSource);
        const fragmentShader = this.compile(gl.FRAGMENT_SHADER, fragmentSource);

        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error('[uni-skybox] 着色器链接失败: ' + log);
        }

        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        this.program = program;
    }

    public use(): void {
        this.gl.useProgram(this.program);
    }

    /** 绑定 vecN 顶点属性 */
    public attribute(name: string, buffer: WebGLBuffer, size: number): void {

        const gl = this.gl;
        let location = this.attributeLocations[name];

        if (location === undefined) {
            location = this.attributeLocations[name] = gl.getAttribLocation(this.program, name);
        }

        if (location < 0) {
            return;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }

    public matrix4fv(name: string, value: Float32Array): void {
        const location = this.location(name);
        if (location) {
            this.gl.uniformMatrix4fv(location, false, value);
        }
    }

    public uniform1i(name: string, value: number): void {
        const location = this.location(name);
        if (location) {
            this.gl.uniform1i(location, value);
        }
    }

    public destroy(): void {
        this.gl.deleteProgram(this.program);
        this.attributeLocations = {};
        this.uniformLocations = {};
    }

    private location(name: string): WebGLUniformLocation {
        if (name in this.uniformLocations) {
            return this.uniformLocations[name];
        }
        const location = this.gl.getUniformLocation(this.program, name);
        this.uniformLocations[name] = location;
        return location;
    }

    private compile(type: number, source: string): WebGLShader {

        const gl = this.gl;
        const shader = gl.createShader(type);

        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        // 成功是常态，先把它送出去，失败路径再读日志
        const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);

        if (compiled) {
            return shader;
        }

        const log = gl.getShaderInfoLog(shader);

        gl.deleteShader(shader);

        throw new Error('[uni-skybox] 着色器编译失败: ' + log + '\n' + source);
    }
}