/**
 * Temu 多店监控云端客户端
 *
 * 配置：
 *   - URL + JWT 存在 store key `temu_cloud_console_cfg`
 *   - 桌面端启动时由 sw.js auto-config 写入；用户也可改
 */

const STORE_KEY = "temu_cloud_console_cfg";

// 云端采集监控默认地址：erp.temu.chat 的 /cloud 路径
// （Caddy handle_path /cloud/* 反代到本机 temu-cloud 服务 8788，会剥掉 /cloud 前缀）
export const DEFAULT_CLOUD_ENDPOINT = "https://erp.temu.chat/cloud";

export interface CloudConsoleConfig {
  endpoint: string;
  token: string;
}

interface LegacyCloudConfig {
  cloudEndpoint?: string;
  cloudToken?: string;
}

export async function loadCloudConfig(): Promise<CloudConsoleConfig | null> {
  try {
    const v = await window.electronAPI?.store?.get(STORE_KEY);
    // 只要有 token 即可工作，endpoint 缺省回退到默认地址
    if (v && typeof v === "object" && v.token) {
      return { endpoint: v.endpoint || DEFAULT_CLOUD_ENDPOINT, token: v.token };
    }
    const legacy = await window.electronAPI?.store?.get("temu_app_settings") as LegacyCloudConfig | null | undefined;
    if (legacy && typeof legacy === "object" && legacy.cloudToken) {
      const cfg = { endpoint: legacy.cloudEndpoint || DEFAULT_CLOUD_ENDPOINT, token: legacy.cloudToken };
      await saveCloudConfig(cfg);
      return cfg;
    }
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

export async function loginCloud(
  endpoint: string,
  username: string,
  password: string,
): Promise<CloudConsoleConfig> {
  const base = (endpoint || DEFAULT_CLOUD_ENDPOINT).replace(/\/$/, "");
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${text.slice(0, 200)}`);
  }
  const data = await r.json();
  if (!data?.token) throw new Error("Cloud login response did not include a token");
  return { endpoint: base, token: data.token };
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

export interface CloudMall {
  site: string | null;
  mall_id: string | null;
  mall_name: string | null;
  last_seen: string | null;
}

export interface CloudEndpointStat {
  site: string | null;
  method: string;
  url_path: string;
  count_total: number;
  last_seen: number | null;
}

export interface CloudDevice {
  device_uuid: string;
  last_seen: string | null;
  user_agent: string | null;
}

export interface CloudDashboardStats {
  total: number;
  last24h: number;
  malls: CloudMall[];
  topEndpoints: CloudEndpointStat[];
  devices: CloudDevice[];
}

export interface CaptureEventRow {
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

export interface TemuSalesRow {
  skc_id: string;
  product_id: string | null;
  goods_id: string | null;
  mall_supplier_id: string | null;
  title: string | null;
  category_name: string | null;
  thumb_url: string | null;
  sku_ext_code: string | null;
  today_sales: number | null;
  last7d_sales: number | null;
  last30d_sales: number | null;
  total_sales: number | null;
  warehouse_stock: number | null;
  occupy_stock: number | null;
  unavailable_stock: number | null;
  advice_qty: number | null;
  available_sale_days: number | null;
  declared_price_cents: number | null;
  price_currency: string | null;
  asf_score: string | null;
  comment_num: number | null;
  quality_after_sales_rate: string | null;
  supply_status: string | null;
  stock_status: string | null;
  close_jit_status: string | null;
  stat_date: string;
  sources_json?: string | null;
  last_updated_at: string | null;
  flow_only?: boolean;
  flow_stat_date?: string | null;
  flow_pay_goods_num?: number | null;
  flow_pay_order_num?: number | null;
  flow_buyer_num?: number | null;
  flow_expose_num?: number | null;
  flow_click_num?: number | null;
  flow_detail_visit_num?: number | null;
  flow_detail_visitor_num?: number | null;
  flow_add_to_cart_user_num?: number | null;
  flow_collect_user_num?: number | null;
  flow_expose_pay_conversion_rate?: number | null;
  flow_expose_click_conversion_rate?: number | null;
  flow_click_pay_conversion_rate?: number | null;
  flow_search_expose_num?: number | null;
  flow_search_click_num?: number | null;
  flow_search_pay_goods_num?: number | null;
  flow_search_pay_order_num?: number | null;
  flow_recommend_expose_num?: number | null;
  flow_recommend_click_num?: number | null;
  flow_recommend_pay_goods_num?: number | null;
  flow_recommend_pay_order_num?: number | null;
  flow_grow_status?: string | null;
  flow_grow_data_text?: string | null;
  flow_bsr_goods?: number | null;
  trend_daily?: Array<{ date: string; salesNumber: number }>;
  trend_latest_date?: string | null;
  trend_today_sales?: number | null;
  trend_last7d_sales?: number | null;
  trend_last30d_sales?: number | null;
  sku_sales_trends?: Record<string, {
    trend_daily?: Array<{ date: string; salesNumber: number }>;
    latest_date?: string | null;
    today_sales?: number | null;
    last7d_sales?: number | null;
    last30d_sales?: number | null;
  }>;
  raw_item?: Record<string, any> | null;
  raw_source?: {
    id?: string;
    url_path?: string;
    method?: string;
    status?: number | null;
    ts?: number | null;
    body_size?: number | null;
  } | null;
}

export interface TemuShopSalesRow {
  id: string;
  tenant_id: string;
  mall_id: string | null;
  site: string | null;
  stat_date: string;
  sale_volume: number | null;
  seven_days_sale_volume: number | null;
  thirty_days_sale_volume: number | null;
  on_sale_product_number: number | null;
  wait_product_number: number | null;
  lack_skc_number: number | null;
  advice_prepare_skc_number: number | null;
  about_to_sell_out_number: number | null;
  already_sold_out_number: number | null;
  high_price_limit_number: number | null;
  quality_after_sale_ratio_90d: number | null;
  sources_json?: string | null;
  last_updated_at: string | null;
}

export interface TemuActivityRow {
  id: string;
  mall_id: string | null;
  site: string | null;
  stat_date: string;
  row_key: string;
  activity_kind: string | null;
  activity_id: string | null;
  activity_title: string | null;
  activity_status: string | null;
  product_id: string | null;
  skc_id: string | null;
  goods_id: string | null;
  start_at: string | null;
  end_at: string | null;
  metric_json?: string | null;
  raw_json?: string | null;
  source_event_id?: string | null;
  sources_json?: string | null;
  last_updated_at: string | null;
}

export interface TemuActivitySummaryRow {
  activity_kind: string | null;
  count: number;
}

export interface AgentHeartbeat {
  id?: string;
  device_id?: string | null;
  device_uuid?: string | null;
  user_agent?: string | null;
  captured_count?: number | null;
  total_sent?: number | null;
  queue_depth?: number | null;
  last_capture_url?: string | null;
  last_capture_at?: number | null;
  last_flush_at?: number | null;
  last_flush_ok?: number | null;
  last_flush_reason?: string | null;
  hook_xhr_alive?: number | null;
  hook_perf_seen?: number | null;
  page_url?: string | null;
  ts?: number | null;
  received_at?: number | null;
}

export interface JstPurchaseInboundRow {
  line_id: string;
  receipt_no: string;
  purchase_no: string | null;
  online_purchase_no: string | null;
  account_name: string | null;
  supplier_name: string | null;
  supplier_code: string | null;
  operation_warehouse_name: string | null;
  warehouse_name: string | null;
  status: string | null;
  finance_status: string | null;
  inbound_type: string | null;
  created_at: string | null;
  inbound_at: string | null;
  archived_at: string | null;
  sku_code: string | null;
  product_name: string | null;
  style_code: string | null;
  color_spec: string | null;
  image_url: string | null;
  product_tag: string | null;
  qty: number | null;
  unit_price: number | null;
  amount: number | null;
  warehouse_available_qty: number | null;
  bind_location: string | null;
  remark: string | null;
  order_total_qty: number | null;
  order_total_amount: number | null;
  order_freight_amount: number | null;
  order_paid_amount: number | null;
  purchaser_name: string | null;
  creator_name: string | null;
  logistics_company: string | null;
  tracking_no: string | null;
  labels: string | null;
}

export interface JstPurchaseInboundSummary {
  line_count: number;
  receipt_count: number;
  total_qty: number;
  total_amount: number;
}

export interface JstPurchaseInboundOption {
  value: string;
  count: number;
}

export interface JstPurchaseInboundResponse {
  rows: JstPurchaseInboundRow[];
  total: number;
  limit: number;
  offset: number;
  summary: JstPurchaseInboundSummary;
  options: {
    accounts: JstPurchaseInboundOption[];
    statuses: JstPurchaseInboundOption[];
    suppliers: JstPurchaseInboundOption[];
  };
}

export const fetchCloudStats = (cfg: CloudConsoleConfig) => (
  request<CloudDashboardStats>(cfg, "/api/dashboard/stats")
);

export const fetchCaptureEvents = (
  cfg: CloudConsoleConfig,
  params: { url_path?: string; mall_id?: string; limit?: number; since?: number } = {},
) => {
  const qs = new URLSearchParams();
  if (params.url_path) qs.set("url_path", params.url_path);
  if (params.mall_id) qs.set("mall_id", params.mall_id);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.since) qs.set("since", String(params.since));
  return request<CaptureEventRow[]>(cfg, `/api/dashboard/events?${qs.toString()}`);
};

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

export const fetchTemuSales = async (
  cfg: CloudConsoleConfig,
  params: { date?: string; mall_id?: string } = {},
) => {
  const qs = new URLSearchParams();
  if (params.date) qs.set("date", params.date);
  if (params.mall_id) qs.set("mall_id", params.mall_id);
  try {
    return await request<{ date: string; rows: TemuSalesRow[] }>(cfg, `/api/dashboard/temu-sales?${qs.toString()}`);
  } catch (error: any) {
    if (String(error?.message || "").includes("HTTP 404")) {
      return { date: params.date || "", rows: [] };
    }
    throw error;
  }
};

export const fetchTemuShopSales = async (
  cfg: CloudConsoleConfig,
  params: { date?: string; mall_id?: string } = {},
) => {
  const qs = new URLSearchParams();
  if (params.date) qs.set("date", params.date);
  if (params.mall_id) qs.set("mall_id", params.mall_id);
  try {
    return await request<{ date: string; row: TemuShopSalesRow | null }>(cfg, `/api/dashboard/shop-sales?${qs.toString()}`);
  } catch (error: any) {
    if (String(error?.message || "").includes("HTTP 404")) {
      return { date: params.date || "", row: null };
    }
    throw error;
  }
};

export const fetchTemuActivity = async (
  cfg: CloudConsoleConfig,
  params: { date?: string; mall_id?: string; kind?: string; limit?: number } = {},
) => {
  const qs = new URLSearchParams();
  if (params.date) qs.set("date", params.date);
  if (params.mall_id) qs.set("mall_id", params.mall_id);
  if (params.kind) qs.set("kind", params.kind);
  if (params.limit) qs.set("limit", String(params.limit));
  try {
    return await request<{ date: string; rows: TemuActivityRow[]; summary: TemuActivitySummaryRow[] }>(
      cfg,
      `/api/dashboard/activity?${qs.toString()}`,
    );
  } catch (error: any) {
    if (String(error?.message || "").includes("HTTP 404")) {
      return { date: params.date || "", rows: [], summary: [] };
    }
    throw error;
  }
};

export const fetchAgentHeartbeats = (
  cfg: CloudConsoleConfig,
  params: { limit?: number } = {},
) => {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit || 120));
  return request<AgentHeartbeat[]>(cfg, `/api/dashboard/agent?${qs.toString()}`);
};

export const fetchJstPurchaseInbound = async (
  cfg: CloudConsoleConfig,
  params: {
    q?: string;
    account_name?: string;
    supplier?: string;
    status?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
  } = {},
) => {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.account_name) qs.set("account_name", params.account_name);
  if (params.supplier) qs.set("supplier", params.supplier);
  if (params.status) qs.set("status", params.status);
  if (params.date_from) qs.set("date_from", params.date_from);
  if (params.date_to) qs.set("date_to", params.date_to);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  try {
    return await request<JstPurchaseInboundResponse>(cfg, `/api/dashboard/jst-purchase-inbound?${qs.toString()}`);
  } catch (error: any) {
    if (String(error?.message || "").includes("HTTP 404")) {
      return {
        rows: [],
        total: 0,
        limit: params.limit || 50,
        offset: params.offset || 0,
        summary: { line_count: 0, receipt_count: 0, total_qty: 0, total_amount: 0 },
        options: { accounts: [], statuses: [], suppliers: [] },
      };
    }
    throw error;
  }
};
