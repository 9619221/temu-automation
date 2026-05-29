// 送仓售后统一视图：聚水潭历史台账 + Temu 平台后台 → 单表展示。
//
// 数据源：
//   A. 聚水潭 consign_after_sales（本地 cache.db，~5483 条）— 主源
//   B. Temu 平台 /api/dashboard/after-sales（云端 32 条左右）— 补充
//
// Join key：outerAsId (TGXJ...) ↔ 平台 packageSn (return_package 类型) / returnSupplierApplicationId (after_sale 类型)。
// after_sale 类型 (TGSQ 前缀) 永远独占，不会跟聚水潭匹配。

import { fetchTemuAfterSales, loadCloudConfig, type TemuAfterSaleRow } from "./cloudClient";

export interface UnifiedAfterSaleRow {
  // 唯一行 id（前端 rowKey 用）
  id: string;
  // 内部来源标记，UI 不展示
  source: "jushuitan" | "platform" | "both";

  // 聚水潭单号（仅聚水潭侧有）
  asId?: number | null;
  // Temu 售后单号 / packageSn
  outerAsId?: string | null;

  // 基础字段（聚水潭口径，平台独占行从 raw_json 反推填充）
  asDate?: string | null;
  shopName?: string | null;
  shopStatus?: string | null;
  status?: string | null;
  type?: string | null;
  refundQty?: number | null;
  rQty?: number | null;
  boxIdCount?: number | null;
  warehouse?: string | null;
  lId?: string | null;
  receiverName?: string | null;
  receiverMobile?: string | null;
  remark?: string | null;
  soId?: string | null;
  oId?: string | null;
  labels?: string | null;
  confirmDate?: string | null;

  // 平台补充字段（仅平台侧采到的额外信息）
  platformReason?: string | null;
  platformQuantity?: number | null;
  platformProductName?: string | null;

  // 平台独占单的明细：从平台 raw_json 解析，按 packageSn 聚合（聚水潭单不用，走 asId 异步加载）
  platformItems?: PlatformAfterSaleItem[];
}

// 平台 raw_json 解析出的单个 SKU 明细
export interface PlatformAfterSaleItem {
  id: string;
  picUrl?: string | null;
  skuId?: string | null;
  skcId?: string | null;
  spuId?: string | null;
  spec?: string | null;
  qty?: number | null;
  purchaseSn?: string | null;
  type?: string | null;
  reason?: string | null;
}

interface ConsignAfterSaleRow {
  id: string;
  asId: number;
  outerAsId?: string | null;
  asDate?: string | null;
  shopName?: string | null;
  shopStatus?: string | null;
  status?: string | null;
  type?: string | null;
  refundQty?: number | null;
  rQty?: number | null;
  boxIdCount?: number | null;
  warehouse?: string | null;
  lId?: string | null;
  receiverName?: string | null;
  receiverMobile?: string | null;
  remark?: string | null;
  soId?: string | null;
  oId?: string | null;
  labels?: string | null;
  confirmDate?: string | null;
}

function extractJoinKey(row: TemuAfterSaleRow): string | null {
  // row_key 格式：return_package|TGXJ...|... 或 after_sale|<UUID>|...
  // return_package 第 2 段就是 packageSn；after_sale 第 2 段是 UUID 不是单号
  if (row.row_key) {
    const parts = row.row_key.split("|");
    if (row.after_sale_type === "return_package" && parts[1]) return parts[1];
  }
  // raw_json fallback
  if (row.raw_json) {
    try {
      const raw = JSON.parse(row.raw_json) as Record<string, any>;
      if (row.after_sale_type === "return_package") return raw.packageSn || null;
      if (row.after_sale_type === "after_sale") return raw.returnSupplierApplicationId || null;
    } catch {
      /* swallow */
    }
  }
  return null;
}

function platformAsBaseRow(p: TemuAfterSaleRow, joinKey: string, mallMap?: Map<string, string>): UnifiedAfterSaleRow {
  // 解析 raw_json 拿更多字段
  let raw: Record<string, any> = {};
  if (p.raw_json) {
    try { raw = JSON.parse(p.raw_json); } catch { /* swallow */ }
  }

  // 类型描述：return_package → "买家退货包裹"；after_sale → raw.typeDescription（"按SKC退"）
  let typeText: string | null = null;
  if (p.after_sale_type === "return_package") {
    typeText = raw.orderTypeDesc || "买家退货包裹";
  } else if (p.after_sale_type === "after_sale") {
    typeText = raw.typeDescription || "按SKC退";
  } else {
    typeText = p.after_sale_type || null;
  }

  // 时间：return_package 用 outboundTime；after_sale 用 createdAtTimestamp
  let asDate: string | null = null;
  const ts = Number(raw.outboundTime || raw.createdAtTimestamp || 0);
  if (ts > 0) {
    asDate = new Date(ts).toISOString();
  } else if (p.created_at_text) {
    asDate = p.created_at_text;
  }

  // 平台没"店铺名"明文字段，用 erp_temu_malls 店铺绑定表把 mall_id 映射成"店号 店名"，映射不到才退回 mall_id
  const shopName = (p.mall_id && mallMap?.get(p.mall_id)) || (p.mall_id ? `Temu ${p.mall_id}` : null);
  const reason = Array.isArray(raw.reasonDesc) ? raw.reasonDesc.join("；") : (p.reason || null);

  return {
    id: `platform:${p.id || p.row_key}`,
    source: "platform",
    asId: null,
    outerAsId: joinKey,
    asDate,
    shopName,
    shopStatus: p.status || null,
    status: raw.statusDescription || p.status || null,
    type: typeText,
    refundQty: Number(p.quantity || raw.quantity || 0) || null,
    rQty: null,
    boxIdCount: null,
    warehouse: p.warehouse_name || null,
    lId: p.logistics_no || null,
    receiverName: null,
    receiverMobile: null,
    remark: raw.remark || p.reason || null,
    soId: p.order_id || null,
    oId: null,
    labels: null,
    confirmDate: null,
    platformReason: reason,
    platformQuantity: Number(p.quantity || 0) || null,
    platformProductName: p.product_name || null,
  };
}

// Temu 图片常是协议相对 URL（//img.kwcdn.com/...），需补 https: 才能加载
function normalizeImageUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw || raw === "null" || raw === "undefined" || raw === "[object Object]") return null;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("data:image/")) return raw;
  const remoteMatch = raw.match(/https?:\/\/[^\s"'\\]+/i);
  return remoteMatch?.[0] || raw;
}

function toPlatformItem(p: TemuAfterSaleRow): PlatformAfterSaleItem {
  let raw: Record<string, any> = {};
  if (p.raw_json) { try { raw = JSON.parse(p.raw_json); } catch { /* swallow */ } }
  const spec = raw.secondarySaleSpec || raw.mainSaleSpec || null;
  const reason = Array.isArray(raw.reasonDesc) ? raw.reasonDesc.join("；") : (raw.remark || p.reason || null);
  const picUrl = normalizeImageUrl(
    raw.thumbUrl || raw.productSkcPicture || raw.goodsImageUrl || raw.imageUrl || raw.productPicture,
  );
  return {
    id: `pi:${p.id || p.row_key}`,
    picUrl,
    skuId: raw.productSkuId != null ? String(raw.productSkuId) : (p.sku_id || null),
    skcId: raw.productSkcId != null ? String(raw.productSkcId) : (p.skc_id || null),
    spuId: raw.productSpuId != null ? String(raw.productSpuId) : null,
    spec,
    qty: Number(raw.quantity ?? p.quantity ?? 0) || null,
    purchaseSn: raw.purchaseSubOrderSn || null,
    type: raw.orderTypeDesc || p.after_sale_type || null,
    reason,
  };
}

function jstAsBaseRow(j: ConsignAfterSaleRow): UnifiedAfterSaleRow {
  return {
    id: `jst:${j.id}`,
    source: "jushuitan",
    asId: j.asId,
    outerAsId: j.outerAsId || null,
    asDate: j.asDate || null,
    shopName: j.shopName || null,
    shopStatus: j.shopStatus || null,
    status: j.status || null,
    type: j.type || null,
    refundQty: j.refundQty ?? null,
    rQty: j.rQty ?? null,
    boxIdCount: j.boxIdCount ?? null,
    warehouse: j.warehouse || null,
    lId: j.lId || null,
    receiverName: j.receiverName || null,
    receiverMobile: j.receiverMobile || null,
    remark: j.remark || null,
    soId: j.soId || null,
    oId: j.oId || null,
    labels: j.labels || null,
    confirmDate: j.confirmDate || null,
  };
}

function mergeJstAndPlatform(j: ConsignAfterSaleRow, p: TemuAfterSaleRow): UnifiedAfterSaleRow {
  const base = jstAsBaseRow(j);
  base.source = "both";

  let raw: Record<string, any> = {};
  if (p.raw_json) {
    try { raw = JSON.parse(p.raw_json); } catch { /* swallow */ }
  }
  const reason = Array.isArray(raw.reasonDesc) ? raw.reasonDesc.join("；") : (p.reason || null);

  base.platformReason = reason;
  base.platformQuantity = Number(p.quantity || 0) || null;
  base.platformProductName = p.product_name || null;
  return base;
}

export interface FetchUnifiedParams {
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface FetchUnifiedResult {
  rows: UnifiedAfterSaleRow[];
  total: number;
  jstOk: boolean;
  platformOk: boolean;
  jstError?: string | null;
  platformError?: string | null;
}

// 从多店报表端点（已部署）取 erp_temu_malls 店铺绑定表，建 mall_id → "temu-店号店铺" 映射。
// 该端点要连云端、可能较慢，所以：①模块级缓存（绑定很少变）②超时兜底——绝不拖住主列表加载。
let mallMapCache: { map: Map<string, string>; at: number } | null = null;
const MALL_MAP_TTL_MS = 10 * 60 * 1000;
const MALL_MAP_TIMEOUT_MS = 4000;

async function loadMallNameMap(erp: any): Promise<Map<string, string>> {
  if (mallMapCache && Date.now() - mallMapCache.at < MALL_MAP_TTL_MS) return mallMapCache.map;
  const empty = new Map<string, string>();
  if (!erp?.reports?.mallDict) return empty;
  try {
    const resp = await Promise.race([
      erp.reports.mallDict(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), MALL_MAP_TIMEOUT_MS)),
    ]);
    if (!resp?.ok || !resp.data) return mallMapCache?.map || empty;
    const map = new Map<string, string>();
    for (const s of resp.data.malls || []) {
      if (!s?.mall_id) continue;
      const name = s.store_code ? `temu-${s.store_code}店铺` : (s.mall_name || "");
      if (name) map.set(s.mall_id, name);
    }
    if (map.size) mallMapCache = { map, at: Date.now() };
    return map;
  } catch {
    return mallMapCache?.map || empty; // 映射不到退回 mall_id 显示
  }
}

export async function fetchUnifiedAfterSales(params: FetchUnifiedParams = {}): Promise<FetchUnifiedResult> {
  const { q, page = 1, pageSize = 20 } = params;
  const erp = (window as any).electronAPI?.erp;

  // 并发拉两边
  const jstPromise: Promise<{ rows: ConsignAfterSaleRow[]; error?: string | null }> = (async () => {
    if (!erp?.consignAfterSale?.list) {
      return { rows: [], error: "ERP 接口未就绪" };
    }
    try {
      const list = await erp.consignAfterSale.list({ q: q || undefined, limit: 100000 });
      return { rows: Array.isArray(list) ? (list as ConsignAfterSaleRow[]) : [], error: null };
    } catch (e: any) {
      return { rows: [], error: e?.message || "送仓售后读取失败" };
    }
  })();

  const platformPromise: Promise<{ rows: TemuAfterSaleRow[]; error?: string | null }> = (async () => {
    const cfg = await loadCloudConfig().catch(() => null);
    if (!cfg) return { rows: [], error: "云端未配置" };
    try {
      const result = await fetchTemuAfterSales(cfg, { q: q || undefined, limit: 1000 });
      return { rows: result.rows || [], error: null };
    } catch (e: any) {
      return { rows: [], error: e?.message || "云端售后读取失败" };
    }
  })();

  const mallPromise = loadMallNameMap(erp);

  const [jstFetch, platformFetch, mallMap] = await Promise.all([jstPromise, platformPromise, mallPromise]);

  // 构造 jushuitan 索引
  const jstByKey = new Map<string, ConsignAfterSaleRow>();
  for (const row of jstFetch.rows) {
    if (row.outerAsId) jstByKey.set(row.outerAsId, row);
  }

  // 平台行按 join key 分组：同一 packageSn 的多个 SKU 聚合成一张售后单
  const platformGroups = new Map<string, TemuAfterSaleRow[]>();
  const platformNoKey: TemuAfterSaleRow[] = [];
  for (const p of platformFetch.rows) {
    const key = extractJoinKey(p);
    if (key) {
      const arr = platformGroups.get(key);
      if (arr) arr.push(p);
      else platformGroups.set(key, [p]);
    } else {
      platformNoKey.push(p);
    }
  }

  const unifiedRows: UnifiedAfterSaleRow[] = [];
  const usedJstIds = new Set<string>();

  // 聚合后的平台单
  for (const [key, group] of platformGroups) {
    const j = jstByKey.get(key);
    if (j) {
      // both：用聚水潭 head（明细走 asId 异步加载），平台字段用组首条补充
      usedJstIds.add(j.id);
      unifiedRows.push(mergeJstAndPlatform(j, group[0]));
    } else {
      // 平台独占：一张单 + 多 SKU 明细（来自 raw_json）
      const head = platformAsBaseRow(group[0], key, mallMap);
      head.id = `platform:${key}`;
      head.platformItems = group.map(toPlatformItem);
      head.refundQty = head.platformItems.reduce((s, it) => s + Number(it.qty || 0), 0) || null;
      unifiedRows.push(head);
    }
  }

  // 没法 join 的平台行：各自独立，明细取自身
  for (const p of platformNoKey) {
    const head = platformAsBaseRow(p, p.row_key || p.id, mallMap);
    head.platformItems = [toPlatformItem(p)];
    unifiedRows.push(head);
  }

  // 再补聚水潭独占
  for (const j of jstFetch.rows) {
    if (usedJstIds.has(j.id)) continue;
    unifiedRows.push(jstAsBaseRow(j));
  }

  // 按 asDate 倒序，null 排最后
  unifiedRows.sort((a, b) => {
    const tA = a.asDate ? Date.parse(a.asDate) : 0;
    const tB = b.asDate ? Date.parse(b.asDate) : 0;
    return (tB || 0) - (tA || 0);
  });

  const total = unifiedRows.length;
  const offset = Math.max(0, (page - 1) * pageSize);
  const rows = unifiedRows.slice(offset, offset + pageSize);

  return {
    rows,
    total,
    jstOk: !jstFetch.error,
    platformOk: !platformFetch.error,
    jstError: jstFetch.error || null,
    platformError: platformFetch.error || null,
  };
}
