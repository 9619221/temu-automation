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
  // 货物状态（聚水潭 good_status）：卖家已收到退货 / 买家已退货 — 真实收货状态，与审核状态 status 区分
  goodStatus?: string | null;
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

  // 确认收货状态（本地确认台账，confirmed = 已确认收货 + 已入库）；用于操作列显示「已确认」
  receiptStatus?: string | null;
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
  goodStatus?: string | null;
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
    // 平台状态：Temu 平台侧状态（已出库 / 平台审核中 等）
    shopStatus: raw.packageStatusDesc || raw.statusDescription || p.status || null,
    // 内部状态：按聚水潭口径，是「我方在 ERP 是否确认建台账」（待确认/已确认），与 Temu 物流无关。
    // 平台独占单尚未进聚水潭台账确认，统一显示「待确认」。
    status: "待确认",
    type: typeText,
    refundQty: Number(p.quantity || raw.quantity || 0) || null,
    rQty: null,
    boxIdCount: null,
    warehouse: p.warehouse_name || null,
    lId: p.logistics_no || null,
    // 退货包裹管理接口提供退货子仓名（returnSubWarehouseName，与聚水潭 receiver_name 同口径）
    // 和联系人 contactName；「送仓」列优先展示子仓名，与聚水潭行保持一致。
    receiverName: raw.returnSubWarehouseName || p.warehouse_name || raw.contactName || null,
    receiverMobile: raw.contactPhone || null,
    remark: (raw.remark || p.reason || "").trim() || null,
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

// 聚水潭店铺名口径不统一（有的漏「铺」字，如 temu-073店），归一到平台口径 temu-NNN店铺，
// 避免同一店在下拉框/筛选/计数里被当成两个店。
function normalizeShopName(name?: string | null): string | null {
  const t = (name || "").trim();
  if (!t) return null;
  const m = t.match(/^temu-?(\d+)\s*店铺?$/i);
  return m ? `temu-${m[1]}店铺` : t;
}

function jstAsBaseRow(j: ConsignAfterSaleRow): UnifiedAfterSaleRow {
  return {
    id: `jst:${j.id}`,
    source: "jushuitan",
    asId: j.asId,
    outerAsId: j.outerAsId || null,
    asDate: j.asDate || null,
    shopName: normalizeShopName(j.shopName),
    shopStatus: j.shopStatus || null,
    status: j.status || null,
    goodStatus: j.goodStatus || null,
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
  // 本地聚水潭秒回后先回调一次（jst-only），让表格先渲染，云端/字典慢慢补
  onPartial?: (rows: UnifiedAfterSaleRow[], total: number) => void;
}

// 按退货时间倒序，null 排最后
function byAsDateDesc(a: UnifiedAfterSaleRow, b: UnifiedAfterSaleRow) {
  const tA = a.asDate ? Date.parse(a.asDate) : 0;
  const tB = b.asDate ? Date.parse(b.asDate) : 0;
  return (tB || 0) - (tA || 0);
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
// 云端平台售后单超时阈值：云端慢/挂时超过即降级到仅本地，避免拖垮整表加载
const PLATFORM_FETCH_TIMEOUT_MS = 8000;

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
  // 一次拉全量并合并排序，分页交给前端纯切片（避免每翻一页都重拉云端，导致「换页没反应」）。
  const { q, onPartial } = params;
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
      // 云端平台单接口在重负载下偶发很慢/连接重置（Failed to fetch）。加超时降级：
      // 超时即放弃，只用本地聚水潭，不让最终合并那步死等、拖垮整张表的加载。
      const result = await Promise.race([
        fetchTemuAfterSales(cfg, { q: q || undefined, limit: 1000 }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("__platform_timeout__")), PLATFORM_FETCH_TIMEOUT_MS)),
      ]);
      return { rows: result.rows || [], error: null };
    } catch {
      // 不把 "Failed to fetch" / 超时原文抛给用户，温和提示仅显示本地数据
      return { rows: [], error: "云端平台数据暂不可用，仅显示本地聚水潭数据" };
    }
  })();

  const mallPromise = loadMallNameMap(erp);

  // 确认收货台账（本地，按 outerAsId）：已确认的单，货物状态标记为「已收到货物」
  const receiptsPromise: Promise<Map<string, string>> = (async () => {
    if (!erp?.consignAfterSale?.receipts) return new Map<string, string>();
    try {
      const list = await erp.consignAfterSale.receipts({});
      const map = new Map<string, string>();
      for (const r of Array.isArray(list) ? list : []) {
        if (r?.outerAsId) map.set(String(r.outerAsId), String(r.receiptStatus || "confirmed"));
      }
      return map;
    } catch {
      return new Map<string, string>();
    }
  })();

  // 本地聚水潭秒回 → 先把 jst-only 行渲染出来；云端平台单 / 店铺字典 / 确认台账慢慢补，
  // 不让本地数据被慢的网络调用扣住（初次加载「好慢」的根因）。
  const jstFetch = await jstPromise;
  if (onPartial) {
    const jstRows = jstFetch.rows.map(jstAsBaseRow).sort(byAsDateDesc);
    onPartial(jstRows, jstRows.length);
  }
  const [platformFetch, mallMap, receiptMap] = await Promise.all([platformPromise, mallPromise, receiptsPromise]);

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
    // 同一 packageSn 下可能既有「退货包裹管理」接口的包裹级行（带物流/子仓/状态），
    // 又有「退货明细」接口的 SKU 级行（只有商品维度）。选包裹级行做表头，SKU 级行做商品明细。
    const pkgRow = group.find((p) => p.logistics_no || p.warehouse_name) || group[0];
    const detailRows = group.filter((p) => p.skc_id || p.sku_id);
    if (j) {
      // both：用聚水潭 head（明细走 asId 异步加载），平台字段用包裹级行补充
      usedJstIds.add(j.id);
      unifiedRows.push(mergeJstAndPlatform(j, pkgRow));
    } else {
      // 平台独占：一张单 + 多 SKU 明细（来自 raw_json）
      const head = platformAsBaseRow(pkgRow, key, mallMap);
      head.id = `platform:${key}`;
      head.platformItems = (detailRows.length ? detailRows : group).map(toPlatformItem);
      head.refundQty = head.platformItems.reduce((s, it) => s + Number(it.qty || 0), 0) || null;
      // 退货原因通常在 SKU 明细行里（包裹级行的 reason 可能为空），表头取明细兜底
      if (!head.platformReason || !String(head.platformReason).trim()) {
        head.platformReason = head.platformItems.find((it) => it.reason)?.reason || null;
      }
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

  // 附加确认收货状态：已确认收货的单，货物状态标记为「卖家已收到退货」（已收到货物）
  if (receiptMap.size) {
    for (const row of unifiedRows) {
      const st = row.outerAsId ? receiptMap.get(String(row.outerAsId)) : undefined;
      if (st) {
        row.receiptStatus = st;
        if (st === "confirmed") row.goodStatus = "卖家已收到退货";
      }
    }
  }

  unifiedRows.sort(byAsDateDesc);

  return {
    rows: unifiedRows,
    total: unifiedRows.length,
    jstOk: !jstFetch.error,
    platformOk: !platformFetch.error,
    jstError: jstFetch.error || null,
    platformError: platformFetch.error || null,
  };
}
