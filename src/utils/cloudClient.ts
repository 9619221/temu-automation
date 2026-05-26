/**
 * Temu 多店监控云端客户端
 *
 * 配置：
 *   - URL + JWT 存在 store key `temu_cloud_console_cfg`
 *   - 桌面端启动时由 sw.js auto-config 写入；用户也可改
 */

import { ERP_CLOUD_SERVER_URL } from "../config/erpCloud";

const STORE_KEY = "temu_cloud_console_cfg";
const DEFAULT_CLOUD_USERNAME = "admin";
const DEFAULT_CLOUD_PASSWORD = "cjl20020421";
let defaultCloudLoginPromise: Promise<CloudConsoleConfig | null> | null = null;
let defaultCloudLoginCooldownUntil = 0;

// 云端采集监控默认地址：erp.temu.chat 的 /cloud 路径
// （Caddy handle_path /cloud/* 反代到本机 temu-cloud 服务 8788，会剥掉 /cloud 前缀）
export const DEFAULT_CLOUD_ENDPOINT = `${ERP_CLOUD_SERVER_URL}/cloud`;

function normalizeCloudEndpoint(endpoint?: string | null): string {
  const normalized = String(endpoint || "").trim().replace(/\/$/, "");
  if (!normalized) return DEFAULT_CLOUD_ENDPOINT;
  if (normalized === DEFAULT_CLOUD_ENDPOINT || normalized === ERP_CLOUD_SERVER_URL) {
    return normalized === ERP_CLOUD_SERVER_URL ? DEFAULT_CLOUD_ENDPOINT : normalized;
  }
  return DEFAULT_CLOUD_ENDPOINT;
}

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
      const cfg = { endpoint: normalizeCloudEndpoint(v.endpoint), token: v.token };
      if (cfg.endpoint !== v.endpoint) await saveCloudConfig(cfg);
      return cfg;
    }
    const legacy = await window.electronAPI?.store?.get("temu_app_settings") as LegacyCloudConfig | null | undefined;
    if (legacy && typeof legacy === "object" && legacy.cloudToken) {
      const cfg = { endpoint: normalizeCloudEndpoint(legacy.cloudEndpoint), token: legacy.cloudToken };
      await saveCloudConfig(cfg);
      return cfg;
    }
  } catch {}
  return autoLoginDefaultCloud();
}

export async function saveCloudConfig(cfg: CloudConsoleConfig): Promise<void> {
  await window.electronAPI?.store?.set(STORE_KEY, {
    endpoint: normalizeCloudEndpoint(cfg.endpoint),
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
  const base = normalizeCloudEndpoint(endpoint);
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

async function autoLoginDefaultCloud(force = false): Promise<CloudConsoleConfig | null> {
  const now = Date.now();
  if (!force && now < defaultCloudLoginCooldownUntil) return null;
  if (!force && defaultCloudLoginPromise) return defaultCloudLoginPromise;

  defaultCloudLoginPromise = (async () => {
    try {
      const cfg = await loginCloud(DEFAULT_CLOUD_ENDPOINT, DEFAULT_CLOUD_USERNAME, DEFAULT_CLOUD_PASSWORD);
      await saveCloudConfig(cfg).catch(() => {});
      defaultCloudLoginCooldownUntil = 0;
      return cfg;
    } catch {
      defaultCloudLoginCooldownUntil = Date.now() + 60_000;
      return null;
    } finally {
      defaultCloudLoginPromise = null;
    }
  })();
  return defaultCloudLoginPromise;
}

async function request<T = any>(
  cfg: CloudConsoleConfig,
  path: string,
  init?: RequestInit,
  retryOnAuth = true,
): Promise<T> {
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
    if (r.status === 401 && retryOnAuth) {
      const freshCfg = await autoLoginDefaultCloud(true);
      if (freshCfg?.token && freshCfg.token !== cfg.token) {
        return request<T>(freshCfg, path, init, false);
      }
    }
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

export interface CloudEndpointCandidate {
  site: string | null;
  method: string;
  url_path: string;
  count_total: number;
  last_seen: number | null;
  last_status: number | null;
  last_body_size: number | null;
  last_page: string | null;
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
  flow_trend_daily?: Array<{
    date: string;
    exposeNum?: number | null;
    clickNum?: number | null;
    detailVisitNum?: number | null;
    detailVisitorNum?: number | null;
    addToCartUserNum?: number | null;
    collectUserNum?: number | null;
    payGoodsNum?: number | null;
    payOrderNum?: number | null;
    buyerNum?: number | null;
    searchExposeNum?: number | null;
    searchClickNum?: number | null;
    searchPayGoodsNum?: number | null;
    searchPayOrderNum?: number | null;
    recommendExposeNum?: number | null;
    recommendClickNum?: number | null;
    recommendPayGoodsNum?: number | null;
    recommendPayOrderNum?: number | null;
  }>;
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
  activity_type?: string | null;
  activity_status: string | null;
  product_id: string | null;
  skc_id: string | null;
  sku_id?: string | null;
  sku_ext_code?: string | null;
  sku_attr_text?: string | null;
  goods_id: string | null;
  daily_price_cents?: number | null;
  signup_price_cents?: number | null;
  suggested_price_cents?: number | null;
  price_currency?: string | null;
  activity_stock?: number | null;
  signup_price_diff_cents?: number | null;
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

export interface TemuOperationRiskRow {
  id: string;
  mall_id: string | null;
  site: string | null;
  stat_date: string;
  risk_type: string;
  risk_key: string;
  risk_title: string | null;
  risk_status: string | null;
  severity: string | null;
  product_id: string | null;
  skc_id: string | null;
  goods_id: string | null;
  order_id: string | null;
  quantity: number | null;
  metric_json?: string | null;
  raw_json?: string | null;
  source_event_id?: string | null;
  sources_json?: string | null;
  last_updated_at: string | null;
}

export interface TemuOperationRiskSummaryRow {
  risk_type: string | null;
  severity: string | null;
  count: number;
}

export interface TemuStockOrderRow {
  id: string;
  mall_id: string | null;
  site: string | null;
  source_type?: "stock_order" | "shipping_desk" | "shipping_list" | string | null;
  row_key: string;
  stock_order_no: string | null;
  parent_order_no: string | null;
  delivery_order_sn: string | null;
  delivery_batch_sn: string | null;
  product_id: string | null;
  skc_id: string | null;
  sku_id: string | null;
  sku_ext_code: string | null;
  online_order_no?: string | null;
  internal_order_no?: string | null;
  order_amount_cents?: number | null;
  currency?: string | null;
  product_name: string | null;
  spec_name: string | null;
  demand_qty: number | null;
  delivered_qty: number | null;
  shipping_qty?: number | null;
  inbound_qty?: number | null;
  temu_status: string | null;
  warehouse_group: string | null;
  receive_warehouse_id: string | null;
  receive_warehouse_name: string | null;
  urgency_info: string | null;
  order_time: string | null;
  latest_ship_at: string | null;
  weight_kg?: number | null;
  package_count?: number | null;
  package_no?: string | null;
  logistics_info?: string | null;
  raw_json?: string | null;
  source_event_id?: string | null;
  sources_json?: string | null;
  first_seen_at: string | null;
  last_updated_at: string | null;
}

export interface TemuStockOrderSummaryRow {
  source_type?: string | null;
  temu_status: string | null;
  count: number;
  demand_qty: number | null;
  delivered_qty?: number | null;
  shipping_qty?: number | null;
  inbound_qty?: number | null;
}

export interface TemuAfterSaleRow {
  id: string;
  mall_id: string | null;
  site: string | null;
  row_key: string;
  after_sale_type: string | null;
  package_no: string | null;
  order_id: string | null;
  product_id: string | null;
  skc_id: string | null;
  sku_id: string | null;
  product_name: string | null;
  quantity: number | null;
  status: string | null;
  reason: string | null;
  logistics_no: string | null;
  warehouse_name: string | null;
  amount_cents: number | null;
  currency: string | null;
  created_at_text: string | null;
  updated_at_text: string | null;
  raw_json?: string | null;
  source_event_id?: string | null;
  sources_json?: string | null;
  first_seen_at: string | null;
  last_updated_at: string | null;
}

export interface TemuAfterSaleSummaryRow {
  after_sale_type: string | null;
  status: string | null;
  count: number;
  quantity: number | null;
  amount_cents: number | null;
}

export interface CloudShopMonitorRow {
  mall_id: string;
  site: string | null;
  mall_name: string | null;
  last_seen: string | number | null;
  last_capture_at: string | number | null;
  capture_count_24h: number;
  stat_date: string | null;
  sale_volume: number;
  seven_days_sale_volume: number;
  thirty_days_sale_volume: number;
  on_sale_product_number: number;
  wait_product_number: number;
  lack_skc_number: number;
  advice_prepare_skc_number: number;
  about_to_sell_out_number: number;
  already_sold_out_number: number;
  high_price_limit_number: number;
  quality_after_sale_ratio_90d: number | null;
  product_skc_count: number;
  product_stock_available: number;
  product_occupy_stock: number;
  product_unavailable_stock: number;
  flow_product_count: number;
  flow_expose_num: number;
  flow_click_num: number;
  flow_detail_visit_num: number;
  flow_detail_visitor_num: number;
  flow_add_to_cart_user_num: number;
  flow_collect_user_num: number;
  flow_pay_goods_num: number;
  flow_pay_order_num: number;
  flow_buyer_num: number;
  flow_expose_pay_conversion_rate: number | null;
  flow_expose_click_conversion_rate: number | null;
  flow_click_pay_conversion_rate: number | null;
  flow_search_expose_num: number;
  flow_search_click_num: number;
  flow_search_pay_goods_num: number;
  flow_search_pay_order_num: number;
  flow_recommend_expose_num: number;
  flow_recommend_click_num: number;
  flow_recommend_pay_goods_num: number;
  flow_recommend_pay_order_num: number;
  activity_count: number;
  bidding_activity_count: number;
  coupon_activity_count: number;
  activity_stock: number;
  risk_count: number;
  high_risk_count: number;
  medium_risk_count: number;
  stock_order_count: number;
  pending_stock_order_count: number;
  stock_order_demand_qty: number;
  stock_order_delivered_qty: number;
  after_sale_count: number;
  pending_after_sale_count: number;
  return_package_count: number;
  after_sale_quantity: number;
  after_sale_amount_cents: number;
  last_flow_at: string | null;
  last_activity_at: string | null;
  last_risk_at: string | null;
  last_stock_order_at: string | null;
  last_after_sale_at: string | null;
  last_updated_at: string | null;
}

export interface CloudShopMonitorTotals {
  mall_count: number;
  capture_count_24h: number;
  device_count: number;
  sale_volume: number;
  seven_days_sale_volume: number;
  thirty_days_sale_volume: number;
  on_sale_product_number: number;
  lack_skc_number: number;
  advice_prepare_skc_number: number;
  already_sold_out_number: number;
  flow_product_count: number;
  flow_expose_num: number;
  flow_click_num: number;
  flow_detail_visit_num: number;
  flow_detail_visitor_num: number;
  flow_add_to_cart_user_num: number;
  flow_collect_user_num: number;
  flow_pay_goods_num: number;
  flow_pay_order_num: number;
  flow_buyer_num: number;
  flow_expose_pay_conversion_rate: number | null;
  flow_expose_click_conversion_rate: number | null;
  flow_click_pay_conversion_rate: number | null;
  flow_search_expose_num: number;
  flow_search_click_num: number;
  flow_search_pay_goods_num: number;
  flow_search_pay_order_num: number;
  flow_recommend_expose_num: number;
  flow_recommend_click_num: number;
  flow_recommend_pay_goods_num: number;
  flow_recommend_pay_order_num: number;
  activity_count: number;
  risk_count: number;
  high_risk_count: number;
  stock_order_count: number;
  pending_stock_order_count: number;
  stock_order_demand_qty: number;
  stock_order_delivered_qty: number;
  after_sale_count: number;
  pending_after_sale_count: number;
  return_package_count: number;
  after_sale_quantity: number;
  after_sale_amount_cents: number;
}

export interface CloudShopMonitorPayload {
  generated_at: string;
  rows: CloudShopMonitorRow[];
  totals: CloudShopMonitorTotals;
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
  collector_enabled?: number | null;
  collector_index?: number | null;
  collector_last_target_key?: string | null;
  collector_last_target_url?: string | null;
  collector_last_targets_json?: string | null;
  collector_updated_at?: number | null;
  ts?: number | null;
  received_at?: number | null;
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
  params: { date?: string; mall_id?: string; include_flow_only?: boolean; limit?: number } = {},
) => {
  const qs = new URLSearchParams();
  if (params.date) qs.set("date", params.date);
  if (params.mall_id) qs.set("mall_id", params.mall_id);
  if (params.include_flow_only) qs.set("include_flow_only", "1");
  if (params.limit) qs.set("limit", String(params.limit));
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

export const fetchEndpointCandidates = (
  cfg: CloudConsoleConfig,
  params: { limit?: number } = {},
) => {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit || 120));
  return request<CloudEndpointCandidate[]>(cfg, `/api/dashboard/endpoint-candidates?${qs.toString()}`);
};

export const fetchTemuActivity = async (
  cfg: CloudConsoleConfig,
  params: { date?: string; mall_id?: string; kind?: string; limit?: number; library?: boolean } = {},
) => {
  const qs = new URLSearchParams();
  if (params.date) qs.set("date", params.date);
  if (params.mall_id) qs.set("mall_id", params.mall_id);
  if (params.kind) qs.set("kind", params.kind);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.library) qs.set("library", "1");
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

export const fetchTemuOperationRisks = async (
  cfg: CloudConsoleConfig,
  params: { date?: string; mall_id?: string; type?: string; limit?: number } = {},
) => {
  const qs = new URLSearchParams();
  if (params.date) qs.set("date", params.date);
  if (params.mall_id) qs.set("mall_id", params.mall_id);
  if (params.type) qs.set("type", params.type);
  if (params.limit) qs.set("limit", String(params.limit));
  try {
    return await request<{ date: string; rows: TemuOperationRiskRow[]; summary: TemuOperationRiskSummaryRow[] }>(
      cfg,
      `/api/dashboard/operation-risks?${qs.toString()}`,
    );
  } catch (error: any) {
    if (String(error?.message || "").includes("HTTP 404")) {
      return { date: params.date || "", rows: [], summary: [] };
    }
    throw error;
  }
};

export const fetchTemuStockOrders = async (
  cfg: CloudConsoleConfig,
  params: { mall_id?: string; status?: string; source_type?: string; q?: string; limit?: number } = {},
) => {
  const qs = new URLSearchParams();
  if (params.mall_id) qs.set("mall_id", params.mall_id);
  if (params.status) qs.set("status", params.status);
  if (params.source_type) qs.set("source_type", params.source_type);
  if (params.q) qs.set("q", params.q);
  if (params.limit) qs.set("limit", String(params.limit));
  try {
    return await request<{ rows: TemuStockOrderRow[]; summary: TemuStockOrderSummaryRow[] }>(
      cfg,
      `/api/dashboard/stock-orders?${qs.toString()}`,
    );
  } catch (error: any) {
    if (String(error?.message || "").includes("HTTP 404")) {
      return { rows: [], summary: [] };
    }
    throw error;
  }
};

export const fetchTemuAfterSales = async (
  cfg: CloudConsoleConfig,
  params: { mall_id?: string; status?: string; type?: string; q?: string; limit?: number } = {},
) => {
  const qs = new URLSearchParams();
  if (params.mall_id) qs.set("mall_id", params.mall_id);
  if (params.status) qs.set("status", params.status);
  if (params.type) qs.set("type", params.type);
  if (params.q) qs.set("q", params.q);
  if (params.limit) qs.set("limit", String(params.limit));
  try {
    return await request<{ rows: TemuAfterSaleRow[]; summary: TemuAfterSaleSummaryRow[] }>(
      cfg,
      `/api/dashboard/after-sales?${qs.toString()}`,
    );
  } catch (error: any) {
    if (String(error?.message || "").includes("HTTP 404")) {
      return { rows: [], summary: [] };
    }
    throw error;
  }
};

export const fetchCloudShopMonitor = async (
  cfg: CloudConsoleConfig,
) => {
  try {
    return await request<CloudShopMonitorPayload>(cfg, "/api/dashboard/shop-monitor");
  } catch (error: any) {
    if (String(error?.message || "").includes("HTTP 404")) {
      return {
        generated_at: "",
        rows: [],
        totals: {
          mall_count: 0,
          capture_count_24h: 0,
          device_count: 0,
          sale_volume: 0,
          seven_days_sale_volume: 0,
          thirty_days_sale_volume: 0,
          on_sale_product_number: 0,
          lack_skc_number: 0,
          advice_prepare_skc_number: 0,
          already_sold_out_number: 0,
          flow_product_count: 0,
          flow_expose_num: 0,
          flow_click_num: 0,
          flow_detail_visit_num: 0,
          flow_detail_visitor_num: 0,
          flow_add_to_cart_user_num: 0,
          flow_collect_user_num: 0,
          flow_pay_goods_num: 0,
          flow_pay_order_num: 0,
          flow_buyer_num: 0,
          flow_expose_pay_conversion_rate: null,
          flow_expose_click_conversion_rate: null,
          flow_click_pay_conversion_rate: null,
          flow_search_expose_num: 0,
          flow_search_click_num: 0,
          flow_search_pay_goods_num: 0,
          flow_search_pay_order_num: 0,
          flow_recommend_expose_num: 0,
          flow_recommend_click_num: 0,
          flow_recommend_pay_goods_num: 0,
          flow_recommend_pay_order_num: 0,
          activity_count: 0,
          risk_count: 0,
          high_risk_count: 0,
          stock_order_count: 0,
          pending_stock_order_count: 0,
          stock_order_demand_qty: 0,
          stock_order_delivered_qty: 0,
          after_sale_count: 0,
          pending_after_sale_count: 0,
          return_package_count: 0,
          after_sale_quantity: 0,
          after_sale_amount_cents: 0,
        },
      };
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
