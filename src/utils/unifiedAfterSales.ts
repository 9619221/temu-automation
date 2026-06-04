// 送仓售后统一视图：聚水潭历史台账 + Temu 官方开放平台退货包裹 → 单表展示。
//
// 数据源：
//   A. 聚水潭 consign_after_sales（本地 erp.sqlite，~5241 条）— 主源（中文品名/货物状态/送仓/物流）
//   B. Temu 官方 OpenAPI 退货包裹（bg.refund.returnpackagelist.get，落 erp_temu_openapi_records 的 return 源）
//      — 平台侧数据源，本地库读取、稳定、全店覆盖；替代了原先不稳定的云端抓包 /api/dashboard/after-sales。
//
// Join key：聚水潭 outerAsId === 官方 packageSn（两侧同为 "TGXJ…-N" 格式，精确匹配，不去后缀）。
// 官方独占包裹（聚水潭尚无台账）单独成行，缺包裹状态/送仓子仓/物流单号/收货人（官方接口未返回这些字段）。

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
  logisticsCompany?: string | null;
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
  // 商品编码（= 货号，退货记录本身不带，由后端从官方 SKU 表按 productSkuId 中转 ext_code 补上）
  internalSkuCode?: string | null;
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
  logisticsCompany?: string | null;
  receiverName?: string | null;
  receiverMobile?: string | null;
  remark?: string | null;
  soId?: string | null;
  oId?: string | null;
  labels?: string | null;
  confirmDate?: string | null;
}

// 官方 OpenAPI 退货包裹记录（erp.temuOpenApi.listRecords("return") 的一行 = 一个包裹内的一个 SKU）。
// raw 为 bg.refund.returnpackagelist.get 的原始 item，含 packageSn/productSkuId/SkcId/SpuId/quantity/
// orderTypeDesc/reasonDesc/remark/secondarySaleSpec/mainSaleSpec/thumbUrl/purchaseSubOrderSn/outboundTime。
interface OfficialReturnRecord {
  mall_id: string;
  product_id?: string | null;
  product_skc_id?: string | null;
  ext_code?: string | null;
  status?: string | null;
  biz_time?: string | null;
  raw?: Record<string, any> | null;
}

// 官方「包裹级」信息（来自 return_package 源 / bg.refund.returnpackage.get），
// 按 packageSn 关联，补到官方独占单的物流/状态列。
interface OfficialPackageInfo {
  lId: string | null;
  shopStatus: string | null;
  logisticsCompany: string | null;
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

function officialReturnToItem(rec: OfficialReturnRecord): PlatformAfterSaleItem {
  const raw = rec.raw || {};
  const spec = raw.secondarySaleSpec || raw.mainSaleSpec || null;
  const reason = Array.isArray(raw.reasonDesc) ? raw.reasonDesc.join("；") : (raw.remark || null);
  const picUrl = normalizeImageUrl(raw.thumbUrl || raw.productSkcPicture || raw.imageUrl);
  return {
    id: `oi:${raw.packageSn || ""}:${raw.productSkuId ?? rec.product_skc_id ?? ""}`,
    picUrl,
    skuId: raw.productSkuId != null ? String(raw.productSkuId) : null,
    skcId: raw.productSkcId != null ? String(raw.productSkcId) : (rec.product_skc_id || null),
    spuId: raw.productSpuId != null ? String(raw.productSpuId) : null,
    internalSkuCode: rec.ext_code || null,
    spec,
    qty: Number(raw.quantity ?? 0) || null,
    purchaseSn: raw.purchaseSubOrderSn || null,
    type: raw.orderTypeDesc || null,
    reason,
  };
}

// 官方退货包裹（按 packageSn 聚合的一组 SKU 行）→ 一张平台独占售后单（聚水潭尚无台账）。
function officialReturnHead(packageSn: string, group: OfficialReturnRecord[], mallMap?: Map<string, string>, pkgInfo?: OfficialPackageInfo): UnifiedAfterSaleRow {
  const first = group[0];
  const raw0 = first?.raw || {};
  const mallId = first?.mall_id || null;
  // 过 normalizeShopName 统一口径：店铺字典 store_code 缺失时映射出的裸数字（如 068）归一成 temu-068店铺，
  // 跟聚水潭/both 来源对齐，避免同一店两种写法。
  const shopName = normalizeShopName((mallId && mallMap?.get(mallId)) || (mallId ? `Temu ${mallId}` : null));
  const ts = Number(raw0.outboundTime || 0);
  const asDate = ts > 0 ? new Date(ts).toISOString() : null;
  const items = group.map(officialReturnToItem);
  const totalQty = items.reduce((s, it) => s + Number(it.qty || 0), 0) || null;
  return {
    id: `platform:${packageSn}`,
    source: "platform",
    asId: null,
    outerAsId: packageSn,
    asDate,
    shopName,
    // 平台状态/物流单号/物流公司来自包裹级接口(return_package)；送仓子仓/收货人官方不返回，仍为空。
    shopStatus: pkgInfo?.shopStatus || null,
    status: "待确认",
    goodStatus: null,
    type: raw0.orderTypeDesc || "退供",
    refundQty: totalQty,
    rQty: null,
    boxIdCount: null,
    warehouse: null,
    lId: pkgInfo?.lId || null,
    logisticsCompany: pkgInfo?.logisticsCompany || null,
    receiverName: null,
    receiverMobile: null,
    remark: null,
    soId: null,
    oId: null,
    labels: null,
    confirmDate: null,
    platformReason: items.find((it) => it.reason)?.reason || null,
    platformQuantity: totalQty,
    platformProductName: null,
    platformItems: items,
  };
}

// 店铺名口径不统一，归一到平台口径 temu-NNN店铺，避免同一店在下拉框/筛选/计数里被当成两个店：
//   ① 聚水潭有的漏「铺」字（temu-073店）或漏连字符（temu046店铺）；
//   ② 官方独占单：店铺字典 store_code 缺失时退化成裸数字店号（如 066/068/070）。
function normalizeShopName(name?: string | null): string | null {
  const t = (name || "").trim();
  if (!t) return null;
  // temu-046店铺 / temu046店 / temu-073店 → temu-046店铺
  const m = t.match(/^temu-?(\d+)\s*店铺?$/i);
  if (m) return `temu-${m[1]}店铺`;
  // 裸数字店号（官方独占单 store_code 缺失时的退化值）→ temu-NNN店铺；
  // 限 2-4 位，避免把 15 位 mall_id（如 Temu 634418225265035 的兜底）误判成店号
  const d = t.match(/^(\d{2,4})$/);
  if (d) return `temu-${d[1]}店铺`;
  return t;
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
    logisticsCompany: j.logisticsCompany || null,
    receiverName: j.receiverName || null,
    receiverMobile: j.receiverMobile || null,
    remark: j.remark || null,
    soId: j.soId || null,
    oId: j.oId || null,
    labels: j.labels || null,
    confirmDate: j.confirmDate || null,
  };
}

function mergeJstAndOfficial(j: ConsignAfterSaleRow, group: OfficialReturnRecord[]): UnifiedAfterSaleRow {
  const base = jstAsBaseRow(j);
  base.source = "both";
  // both：表头/明细以聚水潭为准（明细走 asId 异步加载），仅用官方补平台退货原因/数量。
  const items = group.map(officialReturnToItem);
  base.platformReason = items.find((it) => it.reason)?.reason || null;
  base.platformQuantity = items.reduce((s, it) => s + Number(it.qty || 0), 0) || null;
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

// 统一搜索：在合并后的行上按关键词匹配，覆盖所有来源 + 用户可见字段（店铺 / 售后单号 / 外部单号 /
// 物流单号 / 备注 等）。官方平台退货侧（listRecords）不支持服务端过滤、只能整源全量拉，只靠聚水潭
// 后端 q 会漏掉平台独占单（典型：平台退货包裹的物流单号搜不到）；故搜索统一放前端做、各来源口径一致。
function rowMatchesQuery(row: UnifiedAfterSaleRow, needle: string): boolean {
  if (!needle) return true;
  const fields = [
    row.shopName, row.outerAsId, row.asId, row.lId, row.remark,
    row.platformReason, row.type, row.logisticsCompany, row.receiverName, row.soId,
  ];
  return fields.some((v) => v != null && String(v).toLowerCase().includes(needle));
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
  // 一次拉全量并合并排序，分页交给前端纯切片（避免每翻一页都重拉，导致「换页没反应」）。
  const { q, onPartial } = params;
  const erp = (window as any).electronAPI?.erp;

  // 并发拉两边：A=本地聚水潭台账，B=官方 OpenAPI 退货包裹
  const jstPromise: Promise<{ rows: ConsignAfterSaleRow[]; error?: string | null }> = (async () => {
    if (!erp?.consignAfterSale?.list) {
      return { rows: [], error: "ERP 接口未就绪" };
    }
    try {
      // 不在聚水潭侧做服务端过滤：搜索统一在合并后的结果上做（见 rowMatchesQuery），
      // 这样官方平台退货独占单也能命中，且各来源字段口径一致。
      const list = await erp.consignAfterSale.list({ limit: 100000 });
      return { rows: Array.isArray(list) ? (list as ConsignAfterSaleRow[]) : [], error: null };
    } catch (e: any) {
      return { rows: [], error: e?.message || "送仓售后读取失败" };
    }
  })();

  // 官方退货（替代原云端抓包）：读本地 erp_temu_openapi_records，稳定、全店覆盖。
  //   return         = SKU 明细级（商品/规格/图片）
  //   return_package = 包裹级（物流单号/物流公司/包裹状态）——按 packageSn 关联补字段
  const officialPromise: Promise<{ records: OfficialReturnRecord[]; packages: OfficialReturnRecord[]; error?: string | null }> = (async () => {
    const api = (erp as any)?.temuOpenApi;
    if (!api?.listRecords) return { records: [], packages: [], error: null };
    try {
      const [retResp, pkgResp] = await Promise.all([
        api.listRecords("return"),
        // 包裹级是新 source，老服务器未部署时返回空，静默降级（物流/状态列回退为空）
        Promise.resolve(api.listRecords("return_package")).catch(() => ({ rows: [] })),
      ]);
      const records = (Array.isArray(retResp?.rows) ? retResp.rows : []) as OfficialReturnRecord[];
      const packages = (Array.isArray(pkgResp?.rows) ? pkgResp.rows : []) as OfficialReturnRecord[];
      return { records, packages, error: null };
    } catch {
      return { records: [], packages: [], error: "官方退货数据暂不可用，仅显示本地聚水潭数据" };
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

  // 搜索关键词（统一小写匹配）；空则不过滤。聚水潭秒回与最终合并都用它过滤，口径一致。
  const needle = (q || "").trim().toLowerCase();

  // 本地聚水潭秒回 → 先把 jst-only 行渲染出来；官方退货 / 店铺字典 / 确认台账随后补。
  const jstFetch = await jstPromise;
  if (onPartial) {
    const jstRows = jstFetch.rows.map(jstAsBaseRow).filter((r) => rowMatchesQuery(r, needle)).sort(byAsDateDesc);
    onPartial(jstRows, jstRows.length);
  }
  const [officialFetch, mallMap, receiptMap] = await Promise.all([officialPromise, mallPromise, receiptsPromise]);

  // 构造 jushuitan 索引（按 outerAsId）
  const jstByKey = new Map<string, ConsignAfterSaleRow>();
  for (const row of jstFetch.rows) {
    if (row.outerAsId) jstByKey.set(row.outerAsId, row);
  }

  // 包裹级信息（物流单号/物流公司/包裹状态）按 packageSn 索引，用于补官方独占单
  const pkgInfoMap = new Map<string, OfficialPackageInfo>();
  for (const rec of officialFetch.packages) {
    const raw = rec?.raw || {};
    const pkg = raw.returnSupplierPackageNo ? String(raw.returnSupplierPackageNo) : null;
    if (!pkg) continue;
    pkgInfoMap.set(pkg, {
      lId: raw.expressDeLiverySn != null ? String(raw.expressDeLiverySn) : null,
      shopStatus: raw.packageStatusDesc || null,
      logisticsCompany: raw.logisticsTypeDesc || null,
    });
  }

  // 官方退货行按 packageSn 分组：同一包裹的多个 SKU 聚合成一张售后单
  const officialGroups = new Map<string, OfficialReturnRecord[]>();
  for (const rec of officialFetch.records) {
    const pkg = rec?.raw?.packageSn ? String(rec.raw.packageSn) : null;
    if (!pkg) continue;
    const arr = officialGroups.get(pkg);
    if (arr) arr.push(rec);
    else officialGroups.set(pkg, [rec]);
  }

  const unifiedRows: UnifiedAfterSaleRow[] = [];
  const usedJstIds = new Set<string>();

  for (const [pkg, group] of officialGroups) {
    const j = jstByKey.get(pkg);
    if (j) {
      // both：聚水潭已有台账（物流/送仓/状态更全），用官方补平台退货原因/数量；明细走 asId 异步加载
      usedJstIds.add(j.id);
      unifiedRows.push(mergeJstAndOfficial(j, group));
    } else {
      // 官方独占：聚水潭尚无台账的新退货包裹 = SKU 明细 + 包裹级物流/状态
      unifiedRows.push(officialReturnHead(pkg, group, mallMap, pkgInfoMap.get(pkg)));
    }
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

  // 统一过滤：覆盖聚水潭 / 官方 / both 全部来源，搜什么字段都一致（修复平台退货物流单号搜不到）。
  const resultRows = needle ? unifiedRows.filter((r) => rowMatchesQuery(r, needle)) : unifiedRows;
  resultRows.sort(byAsDateDesc);

  return {
    rows: resultRows,
    total: resultRows.length,
    jstOk: !jstFetch.error,
    platformOk: !officialFetch.error,
    jstError: jstFetch.error || null,
    platformError: officialFetch.error || null,
  };
}
