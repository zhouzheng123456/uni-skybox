import { CUBE_FACES, CubeImages } from '../types';
import { CubeTexture, resolveCubeSize } from './cube-texture';

/**
 * 立方体贴图资源池（对应论文第 4.2 节）。
 *
 * 1. 池按图形上下文隔离：纹理对象只在创建它的上下文内有效，跨上下文共享没有意义；
 * 2. 键由六个面的「图像对象标识 + 贴图边长」构成，而不是 URL——
 *    URL 相同但实际加载到不同图像对象时，仍应视为两份资源；
 * 3. 引用计数归零才真正删除纹理对象，因此同页多实例可以共享同一份立方体贴图；
 * 4. 上下文丢失时把纹理对象标记为失效但保留图像引用，恢复时重新上传，
 *    从而跳过网络请求与图像解码两个最耗时的步骤（第 4.3 节）。
 */

export interface ITextureEntry {
    /** 资源键：六个面的图像标识 + 贴图边长 */
    readonly key: string;
    /** 贴图边长（正方形，单位：像素） */
    readonly size: number;
    /** 已解码完成的六面图像，恢复时用于重新上传 */
    readonly images: CubeImages;
    /** 引用计数 */
    refCount: number;
    /** 纹理对象；上下文丢失后置空，恢复时重建 */
    texture: CubeTexture | null;
}

export interface IPoolStats {
    /** 池内资源条目数 */
    entries: number;
    /** 当前真实存在的纹理对象数 */
    liveTextures: number;
    /** 按 6 × 边长² × 4 字节估算的显存占用 */
    bytes: number;
}

const pools = new WeakMap<WebGLRenderingContext, Map<string, ITextureEntry>>();
const imageIds = new WeakMap<object, number>();

let nextImageId = 1;

function identityOf(image: any): number {

    if (!image || typeof image !== 'object') {
        return 0;
    }

    let id = imageIds.get(image);

    if (id === undefined) {
        id = nextImageId++;
        imageIds.set(image, id);
    }

    return id;
}

function poolOf(gl: WebGLRenderingContext): Map<string, ITextureEntry> {

    let pool = pools.get(gl);

    if (!pool) {
        pool = new Map<string, ITextureEntry>();
        pools.set(gl, pool);
    }

    return pool;
}

/** 单张立方体贴图的显存占用：6 个面 × 边长² × RGBA 四字节 */
function bytesOf(size: number): number {
    return 6 * size * size * 4;
}

/**
 * 申请一份立方体贴图资源。
 *
 * 命中则引用计数加一并直接返回；未命中则创建纹理对象并完成六面上传。
 * 返回值本身就是条目，调用方释放时需要原样传回。
 */
export function acquireCubeTexture(gl: WebGLRenderingContext, images: CubeImages): ITextureEntry {

    const size = resolveCubeSize(images);
    const key = CUBE_FACES.map((face) => identityOf(images[face])).join(':') + '@' + size;

    const pool = poolOf(gl);
    const existing = pool.get(key);

    if (existing) {
        existing.refCount += 1;
        return existing;
    }

    const entry: ITextureEntry = {
        key,
        size,
        images,
        refCount: 1,
        texture: null,
    };

    pool.set(key, entry);

    // 先入池再上传：若上传抛错（尺寸不一致等），异常会向上传递，
    // 此时条目已存在但 status 为初始状态，调用方不会拿到它，由下次申请覆盖。
    try {
        entry.texture = new CubeTexture(gl, images);
    } catch (error) {
        pool.delete(key);
        throw error;
    }

    return entry;
}

/** 释放一份资源；引用计数归零时删除纹理对象并从池中摘除 */
export function releaseCubeTexture(gl: WebGLRenderingContext, entry: ITextureEntry | null): void {

    if (!entry) {
        return;
    }

    entry.refCount -= 1;

    if (entry.refCount > 0) {
        return;
    }

    if (entry.texture) {
        entry.texture.destroy();
        entry.texture = null;
    }

    poolOf(gl).delete(entry.key);
}

/**
 * 上下文丢失：把全部纹理对象标记为失效。
 *
 * 注意这里**不调用** deleteTexture——上下文已经失效，删除调用没有意义，
 * 且会造成「资源已释放」的假象；保留条目与图像引用，供恢复时重建。
 */
export function invalidatePool(gl: WebGLRenderingContext): void {

    poolOf(gl).forEach((entry) => {
        entry.texture = null;
    });
}

/**
 * 上下文恢复：为全部失效条目重新创建纹理对象并上传纹素。
 *
 * 由于 entry.images 持有的是**已解码**的图像对象，这里不产生网络请求，
 * 也不触发解码，这正是恢复耗时的主要收益来源。
 */
export function restorePool(gl: WebGLRenderingContext): void {

    poolOf(gl).forEach((entry) => {
        if (!entry.texture) {
            entry.texture = new CubeTexture(gl, entry.images);
        }
    });
}

/** 查询池的当前状态，供基准测试与内存观测使用 */
export function poolStats(gl: WebGLRenderingContext): IPoolStats {

    let entries = 0;
    let liveTextures = 0;
    let bytes = 0;

    poolOf(gl).forEach((entry) => {

        entries += 1;

        if (entry.texture) {
            liveTextures += 1;
            bytes += bytesOf(entry.size);
        }
    });

    return { entries, liveTextures, bytes };
}

/** 清空池并释放全部纹理对象，主要用于测试与热更新场景 */
export function clearPool(gl: WebGLRenderingContext): void {

    const pool = poolOf(gl);

    pool.forEach((entry) => {
        if (entry.texture) {
            entry.texture.destroy();
            entry.texture = null;
        }
        entry.refCount = 0;
    });

    pool.clear();
}