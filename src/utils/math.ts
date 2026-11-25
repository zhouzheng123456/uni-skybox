/** 角度转弧度：180° 对应 π rad */
export function deg2rad(degrees: number): number {
    return degrees / 180 * Math.PI;
}

/** 把数值限制在 [min, max] 区间内 */
export function clamp(v: number, min: number, max: number): number {
    return v < min ? min : v > max ? max : v;
}