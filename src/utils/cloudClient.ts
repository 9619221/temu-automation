/**
 * Temu 多店监控云端 客户端
 * 桌面端连 cloud server 看 dashboard 数据
 *
 * 配置：
 *   - URL + JWT 存在 store key `temu_cloud_console_cfg`
 *   - URL 例：http://43.156.121.172:8788
 */

const STORE_KEY = "temu_cloud_console_cfg";

export interface CloudConsoleConfig {
  endpoint: string;
  token: string;
}

export async function loadCloudConfig(): Promise<CloudConsoleConfig | null> {
  try {
    const v = await window.electronAPI?.store?.get(STORE_KEY);
    if (v && typeof v === "object" && v.endpoint && v.token) return v as CloudConsoleConfig;
    return null;
  } catch {
    return null;
  }
}

export async function saveCloudConfig(cfg: CloudConsoleConfig): Promise<void> {
  await window.electronAPI?.store?.set(STORE_KEY, {
    endpoint: cfg.endpoint.replace(/\/$/, ""),
    token: cfg.token,
  });
}

export async function clearCloudConfig(): Promise<void> {
  await window.electronAPI?.store?.set(STORE_KEY, null);
}

async function request<T = any>(cfg: CloudConsoleConfig, path: string, init?: RequestInit): Promise<T> {
  const url = cfg.endpoint.replace(/\/$/, "") + path;
  const r = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.token}`,
      ...(init?.headers || {}),
    },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${text.slice(0, 200)}`);
  }
  return r.json();
}

export async function login(endpoint: string, username: string, password: string): Promise<{ token: string; user: any }> {
  const r = await fetch(endpoint.replace(/\/$/, "") + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${r.status}`);
  }
  return r.json();
}

export async function ping(endpoint: string): Promise<boolean> {
  try {
    const r = await fetch(endpoint.replace(/\/$/, "") + "/api/_meta", { method: "GET" });
    return r.ok;
  } catch {
    return false;
  }
}

export interface Stats {
  total: number;
  last24h: number;
  malls: { site: string; mall_id: string; mall_name: string | null; last_seen: string | null }[];
  topEndpoints: { site: string; method: string; url_path: string; count_total: number; last_seen: number }[];
  devices: { device_uuid: string; last_seen: string | null; user_agent: string | null }[];
}

export interface AgentHeartbeat {
  device_uuid: string;
  captured_count: number | null;
  total_sent: number | null;
  queue_depth: number | null;
  last_capture_url: string | null;
  last_capture_at: number | null;
  last_flush_at: number | null;
  last_flush_ok: 0 | 1 | null;
  last_flush_reason: string | null;
  hook_xhr_alive: 0 | 1 | null;
  hook_perf_seen: number | null;
  page_url: string | null;
  ts: number;
}

export interface CaptureEvent {
  id: string;
  ts: number;
  mall_id: string | null;
  site: string | null;
  page: string | null;
  method: string;
  url_path: string;
  status: number | null;
  body_size: number | null;
}

export const fetchStats = (cfg: CloudConsoleConfig) => request<Stats>(cfg, "/api/dashboard/stats");
export const fetchAgent = (cfg: CloudConsoleConfig) => request<AgentHeartbeat[]>(cfg, "/api/dashboard/agent");
export const fetchEvents = (cfg: CloudConsoleConfig, limit = 50) => request<CaptureEvent[]>(cfg, `/api/dashboard/events?limit=${limit}`);
export const fetchEventBody = (cfg: CloudConsoleConfig, id: string) => request<any>(cfg, `/api/dashboard/event/${id}/body`);

// 聚合接口 (可视化用)
export interface TimelinePoint { bucket_ts: number; n: number; ok: number; err4: number; err5: number; }
export interface MallSummary { site: string; mall_id: string; total: number; errors: number; last_ts: number; distinct_endpoints: number; }
export interface StatusBucket { bucket: string; n: number; }
export interface CategoryBucket { category: string; n: number; }

export const fetchTimeline = (cfg: CloudConsoleConfig, bucket: "hour" | "day" = "hour", since?: number) =>
  request<{ bucket: number; since: number; points: TimelinePoint[] }>(cfg,
    `/api/dashboard/timeline?bucket=${bucket}${since ? `&since=${since}` : ""}`);
export const fetchByMall = (cfg: CloudConsoleConfig, since?: number) =>
  request<MallSummary[]>(cfg, `/api/dashboard/by-mall${since ? `?since=${since}` : ""}`);
export const fetchStatusBreakdown = (cfg: CloudConsoleConfig, since?: number) =>
  request<StatusBucket[]>(cfg, `/api/dashboard/status-breakdown${since ? `?since=${since}` : ""}`);
export const fetchByCategory = (cfg: CloudConsoleConfig, since?: number) =>
  request<CategoryBucket[]>(cfg, `/api/dashboard/by-category${since ? `?since=${since}` : ""}`);

// 远程操控扩展（reload / reconfig）
export const triggerReload = (cfg: CloudConsoleConfig) =>
  request(cfg, "/api/ingest/_admin/trigger-reload", { method: "POST", body: "" });

export const triggerReconfig = (cfg: CloudConsoleConfig, target: { cloud_endpoint: string; auth_token: string }) =>
  request(cfg, "/api/ingest/_admin/trigger-reconfig", { method: "POST", body: JSON.stringify(target) });

// ================= SKC 主体 / PriceReview =================

export interface SkcRow {
  skc_id: string;
  product_id: string | null;
  mall_id: string | null;
  site: string | null;
  title: string | null;
  category_name: string | null;
  status: string | null;
  thumb_url: string | null;
  declared_price_cents: number | null;
  suggested_price_cents: number | null;
  price_currency: string | null;
  sales_total: number | null;
  stock_available: number | null;
  last_updated_at: number;
}

export interface PriceReviewRow extends SkcRow {
  gap_cents: number | null;
  gap_ratio: number | null;
}

export interface SkcDetail {
  skc: SkcRow & { sources_json: string | null; first_seen_at: number };
  sources: Record<string, string>;
  events: { id: string; url_path: string; method: string; status: number | null; ts: number }[];
}

export const fetchSkcList = (cfg: CloudConsoleConfig, params: { mall_id?: string; q?: string; limit?: number; offset?: number } = {}) => {
  const qs = new URLSearchParams();
  if (params.mall_id) qs.set("mall_id", params.mall_id);
  if (params.q) qs.set("q", params.q);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  return request<{ rows: SkcRow[]; total: number; limit: number; offset: number }>(cfg, `/api/dashboard/skc?${qs.toString()}`);
};

export const fetchSkcDetail = (cfg: CloudConsoleConfig, skcId: string) =>
  request<SkcDetail>(cfg, `/api/dashboard/skc/${encodeURIComponent(skcId)}`);

export const fetchPriceReview = (cfg: CloudConsoleConfig, params: { mall_id?: string; limit?: number; offset?: number } = {}) => {
  const qs = new URLSearchParams();
  if (params.mall_id) qs.set("mall_id", params.mall_id);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  return request<{ rows: PriceReviewRow[]; total: number; limit: number; offset: number }>(cfg, `/api/dashboard/price-review?${qs.toString()}`);
};
