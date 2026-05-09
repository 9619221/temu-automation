/**
 * Temu 多店监控云端客户端
 *
 * 配置：
 *   - URL + JWT 存在 store key `temu_cloud_console_cfg`
 *   - 桌面端启动时由 sw.js auto-config 写入；用户也可改
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

export const fetchSkcList = (
  cfg: CloudConsoleConfig,
  params: { mall_id?: string; q?: string; limit?: number; offset?: number } = {},
) => {
  const qs = new URLSearchParams();
  if (params.mall_id) qs.set("mall_id", params.mall_id);
  if (params.q) qs.set("q", params.q);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  return request<{ rows: SkcRow[]; total: number; limit: number; offset: number }>(
    cfg,
    `/api/dashboard/skc?${qs.toString()}`,
  );
};
