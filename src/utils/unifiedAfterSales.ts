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

function platformAsBaseRow(p: TemuAfterSaleRow, joinKey: string): UnifiedAfterSaleRow {
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

  // 平台没"店铺名"明文字段，用 mall_id
  const shopName = p.mall_id ? `Temu ${p.mall_id}` : null;
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

  const [jstFetch, platformFetch] = await Promise.all([jstPromise, platformPromise]);

  // 构造 jushuitan 索引
  const jstByKey = new Map<string, ConsignAfterSaleRow>();
  for (const row of jstFetch.rows) {
    if (row.outerAsId) jstByKey.set(row.outerAsId, row);
  }

  const unifiedRows: UnifiedAfterSaleRow[] = [];
  const usedJstIds = new Set<string>();

  // 先走平台行
  for (const p of platformFetch.rows) {
    const key = extractJoinKey(p);
    if (!key) {
      // 没法 join 的平台行，仍作为独占行展示
      unifiedRows.push(platformAsBaseRow(p, p.row_key || p.id));
      continue;
    }
    const j = jstByKey.get(key);
    if (j) {
      usedJstIds.add(j.id);
      unifiedRows.push(mergeJstAndPlatform(j, p));
    } else {
      unifiedRows.push(platformAsBaseRow(p, key));
    }
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
