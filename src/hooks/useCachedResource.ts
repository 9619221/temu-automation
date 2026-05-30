import { useCallback, useRef, useState } from "react";
import { readPageCache, writePageCache } from "../utils/pageCache";
import { useStoreRefresh } from "./useStoreRefresh";

/**
 * 统一的「响应体验 / 缓存」原语,落地 docs/frontend-response-cache-spec.md 的 stale-while-revalidate 模型。
 *
 * 行为:
 * - 挂载时同步读 localStorage 缓存作为初值 → warm 首屏立即可见旧数据(≤100ms),不闪空。
 * - 后台静默刷新:有缓存时只翻 isFetching(给细进度条用),绝不把 isLoading 翻 true(warm 态不全屏转圈)。
 * - 冷启动(无任何缓存)才 isLoading=true,页面据此显示骨架屏。
 * - 请求失败保留旧数据 + error,不清屏。
 * - 触发(挂载/账号切换/store 事件/依赖变化/防抖)统一委托 useStoreRefresh。
 * - 内置请求竞态保护:只应用最新一次请求的结果,丢弃过期响应。
 *
 * 注意:本 Hook 面向「从某个 fetcher 拉一份数据再渲染」的页面。像 PurchaseCenter 那种已自带成熟
 * 缓存机制的复杂页面无需强行迁移,保留其机制即可。
 */

export type RefreshDependency = string | number | boolean | null | undefined;

export interface CachedResourceState<T> {
  /** 当前数据(可能来自缓存,见 isStale)。冷启动且无缓存时为 undefined。 */
  data: T | undefined;
  /** 冷启动且无缓存、首个请求未回时为 true。页面据此显示骨架屏。 */
  isLoading: boolean;
  /** 后台刷新进行中。给顶部细进度条用——绝不用它驱动全屏转圈。 */
  isFetching: boolean;
  /** 当前 data 来自缓存、尚未被一次成功的实时请求确认。 */
  isStale: boolean;
  /** 最近一次请求的错误。失败时旧数据仍保留,据此显示非阻塞提示。 */
  error: Error | null;
  /** 手动触发一次刷新(走同一条竞态保护路径)。 */
  refetch: () => Promise<void>;
}

export interface UseCachedResourceOptions<T> {
  /** 缓存键,务必带版本号,如 "temu.shop.overview.cache.v1"。 */
  cacheKey: string;
  /** 实际拉数逻辑,通常是一次 IPC 调用,如 () => erp.purchase.workbench(params)。 */
  fetcher: () => Promise<T>;
  /** 写缓存前裁剪重字段(详情/timeline/大 JSON),控制 localStorage 体积。 */
  compact?: (data: T) => T;
  /** 这些 store key 变化即失效重拉,透传给 useStoreRefresh。 */
  watchKeys?: readonly string[];
  /** 账号切换时是否重拉,默认 true。 */
  reloadOnAccountChange?: boolean;
  /** 挂载时是否立即拉一次,默认 true。 */
  reloadOnMount?: boolean;
  /** 条件加载;为 false 时不触发请求。 */
  enabled?: boolean;
  /** 触发防抖,默认 120ms,与 useStoreRefresh 对齐。 */
  debounceMs?: number;
  /** 这些值(如 page / 筛选条件)变化时重新拉取。 */
  dependencies?: readonly RefreshDependency[];
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  const message = (err as { message?: unknown })?.message;
  return new Error(typeof message === "string" ? message : String(err));
}

export function useCachedResource<T>(options: UseCachedResourceOptions<T>): CachedResourceState<T> {
  const {
    cacheKey,
    fetcher,
    compact,
    watchKeys = [],
    reloadOnAccountChange = true,
    reloadOnMount = true,
    enabled = true,
    debounceMs = 120,
    dependencies = [],
  } = options;

  const [data, setData] = useState<T | undefined>(() => {
    const cached = readPageCache<T | undefined>(cacheKey, undefined);
    return cached ?? undefined;
  });
  const [isLoading, setIsLoading] = useState<boolean>(() => enabled && data === undefined);
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [isStale, setIsStale] = useState<boolean>(() => data !== undefined);
  const [error, setError] = useState<Error | null>(null);

  // 用 ref 持有最新的 fetcher/compact,避免把它们塞进 load 的依赖、引发 useStoreRefresh 反复重订阅。
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const compactRef = useRef(compact);
  compactRef.current = compact;
  // 是否已有数据在屏:决定本次请求算冷启动(显骨架)还是后台刷新(仅细进度条)。
  const hasDataRef = useRef<boolean>(data !== undefined);
  // 竞态保护:仅应用最新一次请求的结果。
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const reqId = ++requestIdRef.current;
    setIsFetching(true);
    if (!hasDataRef.current) setIsLoading(true);
    try {
      const result = await fetcherRef.current();
      if (reqId !== requestIdRef.current) return; // 过期响应,丢弃
      setData(result);
      hasDataRef.current = result !== undefined;
      setIsStale(false);
      setError(null);
      const toCache = compactRef.current ? compactRef.current(result) : result;
      writePageCache(cacheKey, toCache);
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      setError(toError(err)); // 保留旧数据,不清屏
    } finally {
      if (reqId === requestIdRef.current) {
        setIsFetching(false);
        setIsLoading(false);
      }
    }
  }, [cacheKey]);

  useStoreRefresh({
    load,
    watchKeys,
    enabled,
    debounceMs,
    reloadOnMount,
    reloadOnAccountChange,
    dependencies,
  });

  const refetch = useCallback(() => load(), [load]);

  return { data, isLoading, isFetching, isStale, error, refetch };
}
