/**
 * 前端性能日志（常驻、轻量）。
 *
 * 两类数据：
 *  - route：路由切换到首帧渲染的耗时（页面打开时间，前端侧）
 *  - ipc：来自 preload 环形缓冲的 IPC 往返耗时（按钮响应时间，主进程往返）
 *
 * 仅记录时间戳与耗时，不涉及任何业务数据。供「日志中心」聚合展示或一键导出。
 */

export interface RoutePerfEntry {
  path: string;
  ms: number;
  at: number;
}

export interface IpcPerfEntry {
  channel: string;
  ms: number;
  error: boolean;
  at: number;
}

const ROUTE_MAX = 300;
const routeRing: RoutePerfEntry[] = [];

/** 记录一次路由打开耗时。 */
export function recordRouteOpen(path: string, ms: number): void {
  routeRing.push({ path, ms: Math.round(ms * 10) / 10, at: Date.now() });
  if (routeRing.length > ROUTE_MAX) routeRing.shift();
}

/** 读取路由耗时记录（副本）。 */
export function getRouteEntries(): RoutePerfEntry[] {
  return routeRing.slice();
}

/** 读取 IPC 耗时记录（来自 preload，副本）。 */
export function getIpcEntries(): IpcPerfEntry[] {
  try {
    const perf = window.electronAPI?.perf;
    if (perf?.getEntries) return perf.getEntries() as IpcPerfEntry[];
  } catch {
    /* ignore */
  }
  return [];
}

/** 清空所有性能记录。 */
export function clearPerf(): void {
  routeRing.length = 0;
  try {
    window.electronAPI?.perf?.clear?.();
  } catch {
    /* ignore */
  }
}

export interface PerfSummaryRow {
  key: string;
  count: number;
  median: number;
  max: number;
}

function summarize(groups: Map<string, number[]>): PerfSummaryRow[] {
  const rows: PerfSummaryRow[] = [];
  for (const [key, arr] of groups) {
    const sorted = [...arr].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    rows.push({ key, count: arr.length, median: Math.round(median), max: Math.round(sorted[sorted.length - 1] ?? 0) });
  }
  return rows.sort((a, b) => b.max - a.max);
}

/** 按路由聚合（中位/最大）。 */
export function summarizeRoutes(): PerfSummaryRow[] {
  const groups = new Map<string, number[]>();
  for (const e of routeRing) {
    if (!groups.has(e.path)) groups.set(e.path, []);
    groups.get(e.path)!.push(e.ms);
  }
  return summarize(groups);
}

/** 按 IPC channel 聚合（中位/最大）。 */
export function summarizeIpc(): PerfSummaryRow[] {
  const groups = new Map<string, number[]>();
  for (const e of getIpcEntries()) {
    if (!groups.has(e.channel)) groups.set(e.channel, []);
    groups.get(e.channel)!.push(e.ms);
  }
  return summarize(groups);
}

/**
 * 生成完整性能报告对象（路由 + IPC 聚合与原始记录）。
 * 供导出/控制台查看。
 */
export function buildPerfReport() {
  return {
    generatedAt: new Date().toISOString(),
    routeSummary: summarizeRoutes(),
    ipcSummary: summarizeIpc(),
    rawRoute: getRouteEntries(),
    rawIpc: getIpcEntries(),
  };
}

/**
 * 把性能报告下载为 JSON 文件。返回报告对象，便于同时在控制台查看。
 * 用法（开发者工具 Console）：window.__exportPerfReport()
 */
export function exportPerfReport() {
  const payload = buildPerfReport();
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `perf-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    /* ignore download failure，仍返回报告对象 */
  }
  return payload;
}
