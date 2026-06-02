import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, Drawer, Empty, Image, Input, Modal, Radio, Segmented, Space, Spin, Statistic, Table, Tabs, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  AppstoreOutlined,
  EyeOutlined,
  PictureOutlined,
  SearchOutlined,
  SettingOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLocation, useNavigate } from "react-router-dom";
import EmptyGuide from "../components/EmptyGuide";
import {
  parseOrdersData,
  parseFluxData,
  parseProductCountSummary,
  parseProductsData,
  parseSalesData,
} from "../utils/parseRawApis";
import {
  COLLECTION_DIAGNOSTICS_KEY,
  normalizeCollectionDiagnostics,
  type CollectionDiagnostics,
} from "../utils/collectionDiagnostics";
import { readPageCache, writePageCache } from "../utils/pageCache";
import { getStoreValue } from "../utils/storeCompat";
import { ACTIVE_ACCOUNT_CHANGED_EVENT, STORE_VALUE_UPDATED_EVENT } from "../utils/multiStore";
import { TrafficDriverPanel, buildTrafficDriverSitesFromProduct, type TrafficSiteKey } from "../components/TrafficDriverPanel";
import ProductFluxOperatorCard from "../components/ProductFluxOperatorCard";
import {
  fetchSkcList,
  fetchTemuAfterSales,
  fetchTemuActivity,
  fetchTemuOperationRisks,
  fetchTemuSales,
  fetchTemuShopSales,
  fetchTemuStockOrders,
  loadCloudConfig,
  type SkcRow,
  type TemuAfterSaleRow,
  type TemuActivityRow,
  type TemuOperationRiskRow,
  type TemuSalesRow,
  type TemuShopSalesRow,
  type TemuStockOrderRow,
} from "../utils/cloudClient";

const store = window.electronAPI?.store;
const automation = window.electronAPI?.automation;

type StatusFilter = "all" | "在售" | "已下架" | "未发布" | "other" | "saleOut" | "soonSaleOut" | "shortage" | "advice";
type ActivityDetailFilter = "all" | "running" | "notStarted";

type ProductSkuSpec = {
  parentSpecName: string;
  specName: string;
  unitSpecName: string;
};

type ProductSkuSummary = {
  productSkuId: string;
  thumbUrl: string;
  productSkuSpecList: ProductSkuSpec[];
  specText: string;
  specName: string;
  extCode: string;
};

type ActivitySkuPriceRow = {
  id: string;
  activity: TemuActivityRow;
  sourceSkcId: string;
  skuId: string;
  skuExtCode: string;
  skuAttr: string;
  dailyPriceCents: number | null;
  activityPriceCents: number | null;
  suggestedPriceCents: number | null;
  priceDiffCents: number | null;
  currency: string;
  reportedQty: number | null;
  remainingQty: number | null;
  signupTimeText: string;
  sourceScore: number;
};

type ActivityDetailSkuTarget = {
  skuId?: string | number | null;
  skuExtCode?: string | number | null;
  skuSpec?: string | number | null;
} | null;

type FluxSiteKey = "global" | "us" | "eu";

export const FLUX_SITE_LABELS: Record<FluxSiteKey, string> = {
  global: "全球",
  us: "美国",
  eu: "欧区",
};

interface ProductFluxSiteData {
  siteKey: FluxSiteKey;
  siteLabel: string;
  syncedAt: string;
  summary: ProductTrafficSummary | null;
  summaryByRange: Record<string, ProductTrafficSummary>;
  items: any[];
  itemsByRange: Record<string, any[]>;
  availableRanges: string[];
  primaryRangeLabel: string;
}

interface ProductTrafficSummary {
  siteKey: FluxSiteKey;
  siteLabel: string;
  syncedAt: string;
  dataDate: string;
  updateTime: string;
  growDataText: string;
  exposeNum: number;
  clickNum: number;
  detailVisitNum: number;
  detailVisitorNum: number;
  addToCartUserNum: number;
  collectUserNum: number;
  buyerNum: number;
  payGoodsNum: number;
  payOrderNum: number;
  searchExposeNum: number;
  searchClickNum: number;
  searchPayGoodsNum: number;
  recommendExposeNum: number;
  recommendClickNum: number;
  recommendPayGoodsNum: number;
  trendExposeNum: number;
  trendPayOrderNum: number;
  exposeClickRate: number;
  clickPayRate: number;
  dataOrigin?: "flux" | "gp" | "mall" | "cache";
  rangeTotal?: number;
  changeRate?: number;
  coveredRegions?: number;
  trendPoints?: Array<{ date: string; sales: number }>;
  regionRows?: Array<{ regionId?: string | number; regionName?: string; sales?: number }>;
}

interface ProductItem {
  title: string;
  category: string;
  categories: string;
  spuId: string;
  skcId: string;
  goodsId: string;
  sku: string;
  extCode: string;
  skuId: string;
  skuName: string;
  imageUrl: string;
  mallId: string;
  siteLabel: string;
  productType: string;
  sourceType: string;
  removeStatus: string;
  status: string;
  skcSiteStatus: string;
  flowLimitStatus: string;
  skuSummaries: ProductSkuSummary[];
  todaySales: number;
  last30DaysSales: number;
  totalSales: number;
  last7DaysSales: number;
  syncedAt: string;
  warehouseStock: number;
  occupyStock: number;
  unavailableStock: number;
  lackQuantity: number;
  price: string | number;
  stockStatus: string;
  supplyStatus: string;
  pendingOrderCount: number;
  hotTag?: string;
  availableSaleDays?: string | number | null;
  asfScore?: string | number;
  buyerName?: string;
  buyerUid?: string;
  operatorContact?: string;
  operatorNick?: string;
  highPriceFlowLimit?: boolean;
  highPriceFlowInfo?: any;
  commentNum?: number;
  inBlackList?: string;
  pictureAuditStatus?: string;
  qualityAfterSalesRate?: string | number;
  predictTodaySaleVolume?: number;
  sevenDaysSaleReference?: number;
  sevenDaysAddCartNum?: number;
  hasSalesSnapshot?: boolean;
  salesRaw?: any;
  salesRawSku?: any;
  trendDaily?: Array<{ date: string; salesNumber: number }>;
  fluxItems?: any[];
  fluxSyncedAt?: string;
  fluxSites?: ProductFluxSiteData[];
  adviceQuantity?: number;
  cloudSkc?: SkcRow;
  cloudSales?: TemuSalesRow;
  cloudActivities?: TemuActivityRow[];
  cloudRisks?: TemuOperationRiskRow[];
  cloudStockOrders?: TemuStockOrderRow[];
  cloudAfterSales?: TemuAfterSaleRow[];
}

interface ProductSourceState {
  products: boolean;
  sales: boolean;
  orders: boolean;
}

interface ProductCountSummary {
  totalCount: number;
  onSaleCount: number;
  notPublishedCount: number;
  offSaleCount: number;
}

interface CloudProductBundle {
  skcRows: SkcRow[];
  salesRows: TemuSalesRow[];
  activityRows: TemuActivityRow[];
  riskRows: TemuOperationRiskRow[];
  stockOrderRows: TemuStockOrderRow[];
  afterSaleRows: TemuAfterSaleRow[];
  shopSales: TemuShopSalesRow | null;
  skcMap: Map<string, SkcRow>;
  salesMap: Map<string, TemuSalesRow>;
  activityMap: Map<string, TemuActivityRow[]>;
  riskMap: Map<string, TemuOperationRiskRow[]>;
  stockOrderMap: Map<string, TemuStockOrderRow[]>;
  afterSaleMap: Map<string, TemuAfterSaleRow[]>;
  latestAt: string;
  error: string;
  configured: boolean;
}

interface CloudProductBundleCache {
  generatedAt: string;
  latestAt: string;
  skcRows: SkcRow[];
  salesRows: TemuSalesRow[];
  activityRows: TemuActivityRow[];
  riskRows: TemuOperationRiskRow[];
  stockOrderRows: TemuStockOrderRow[];
  afterSaleRows: TemuAfterSaleRow[];
  shopSales: TemuShopSalesRow | null;
}

const EMPTY_SOURCES: ProductSourceState = {
  products: false,
  sales: false,
  orders: false,
};

const EMPTY_COUNT_SUMMARY: ProductCountSummary = {
  totalCount: 0,
  onSaleCount: 0,
  notPublishedCount: 0,
  offSaleCount: 0,
};

const CLOUD_PRODUCTS_ONLY: boolean = true;
const CLOUD_PRODUCT_BUNDLE_CACHE_KEY = "temu.product-list.cloud-bundle.cache.v1";
const CLOUD_PRODUCT_FETCH_TIMEOUT_MS = 10000;

const PRODUCT_ID_LOOKUP_FIELDS = [
  "skcId",
  "skuId",
  "spuId",
  "productId",
  "productSkcId",
  "productSkuId",
  "productSpuId",
  "goodsSkcId",
] as const;

const EMPTY_IMAGE_FALLBACK =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

export const PRODUCT_FLUX_SITE_OPTIONS: Array<{ key: FluxSiteKey; label: string }> = [
  { key: "global", label: "全球" },
  { key: "us", label: "美国" },
  { key: "eu", label: "欧区" },
];

const PRODUCT_FLUX_RANGE_ORDER = ["今日", "近7日", "近30日", "本周", "本月", "昨日"];

const EMPTY_PARSED_FLUX = {
  summary: null,
  items: [],
  syncedAt: "",
  summaryByRange: {} as Record<string, any>,
  itemsByRange: {} as Record<string, any[]>,
  availableRanges: [] as string[],
  primaryRangeLabel: "",
};

function getParsedFluxSnapshot(source: any) {
  const parsed = source
    ? parseFluxData(source)
    : { summary: null, items: [], syncedAt: "", summaryByRange: {}, itemsByRange: {}, availableRanges: [], primaryRangeLabel: "近7日" };
  const rangeItemCount = Object.values(parsed?.itemsByRange || {}).reduce((total: number, items: any) => {
    return total + (Array.isArray(items) ? items.length : 0);
  }, 0);
  const rangeTrendCount = Object.values(parsed?.summaryByRange || {}).reduce((total: number, summary: any) => {
    return total + (Array.isArray(summary?.trendList) ? summary.trendList.length : 0);
  }, 0);
  return {
    source,
    parsed,
    itemCount: Math.max(Array.isArray(parsed?.items) ? parsed.items.length : 0, rangeItemCount),
    trendCount: Math.max(Array.isArray(parsed?.summary?.trendList) ? parsed.summary.trendList.length : 0, rangeTrendCount),
    syncedAt: String(parsed?.syncedAt || ""),
  };
}

function pickPreferredFluxSource(primarySource: any, fallbackSource: any) {
  if (!fallbackSource) return primarySource;
  if (!primarySource) return fallbackSource;

  const primary = getParsedFluxSnapshot(primarySource);
  const fallback = getParsedFluxSnapshot(fallbackSource);

  if (fallback.itemCount > 0 && primary.itemCount === 0) return fallbackSource;
  if (fallback.itemCount > primary.itemCount) return fallbackSource;
  if (fallback.trendCount > primary.trendCount && fallback.itemCount >= primary.itemCount) return fallbackSource;
  if (fallback.syncedAt && !primary.syncedAt) return fallbackSource;
  return primarySource;
}

const PRODUCT_TRAFFIC_COLORS = {
  expose: "#1a73e8",
  clickRate: "#5f6368",
  clickPayRate: "#34a853",
  detail: "#1a73e8",
  cart: "#7c3aed",
  collect: "#ea4335",
  order: "#137333",
  search: "#1a73e8",
  recommend: "#34a853",
  other: "#fbbc04",
  grid: "#e8eaed",
  axis: "#5f6368",
};

function normalizeLookupValue(value: string) {
  return (value || "").replace(/\s+/g, "").trim().toLowerCase();
}

function normalizeImageUrl(value: unknown): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeImageUrl(item);
      if (normalized) return normalized;
    }
    return "";
  }

  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw || raw === "null" || raw === "undefined" || raw === "[object Object]") return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("data:image/")) return raw;
  const remoteMatch = raw.match(/https?:\/\/[^\s"'\\]+/i);
  return remoteMatch?.[0] || raw;
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function formatTextValue(value: unknown) {
  const text = normalizeText(value);
  return text || "-";
}

function formatSourceType(value: unknown) {
  const text = normalizeText(value);
  const sourceTypeMap: Record<string, string> = {
    "0": "普通发布",
  };
  if (!text) return "-";
  return sourceTypeMap[text] || `来源类型 ${text}`;
}

function toNumberValue(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeStatusText(value: unknown) {
  const text = normalizeText(value);
  const statusMap: Record<string, string> = {
    "0": "在售",
    "1": "已下架",
    "100": "在售",
    "200": "未发布到站点",
    "300": "已下架/已终止",
  };
  return statusMap[text] || text;
}

function getPrimaryCategory(product: ProductItem) {
  return product.category || product.categories || "";
}

function formatSyncedAt(value?: string | null) {
  return value ? `最近同步：${value}` : "等待首次采集";
}

function formatTimestamp(value?: number | string | null) {
  if (!value) return "";
  const numeric = typeof value === "number"
    ? value
    : (/^\d+$/.test(String(value).trim()) ? Number(String(value).trim()) : NaN);
  const rawTime = Number.isFinite(numeric) ? numeric : Date.parse(String(value));
  const time = rawTime > 0 && rawTime < 10_000_000_000 ? rawTime * 1000 : rawTime;
  if (!Number.isFinite(time) || time <= 0) return "";
  return new Date(time).toLocaleString("zh-CN", { hour12: false });
}

function latestCloudTimestamp(
  skcRows: SkcRow[],
  salesRows: TemuSalesRow[],
  activityRows: TemuActivityRow[] = [],
  riskRows: TemuOperationRiskRow[] = [],
  stockOrderRows: TemuStockOrderRow[] = [],
  afterSaleRows: TemuAfterSaleRow[] = [],
) {
  let latest = 0;
  for (const row of skcRows) latest = Math.max(latest, Number(row.last_updated_at || 0));
  for (const row of [...salesRows, ...activityRows, ...riskRows, ...stockOrderRows, ...afterSaleRows]) {
    const time = row.last_updated_at ? Date.parse(row.last_updated_at) : 0;
    if (Number.isFinite(time)) latest = Math.max(latest, time);
  }
  return latest ? formatTimestamp(latest) : "";
}

function firstCloudValue<T>(...values: Array<T | null | undefined | "">): T | undefined {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value as T;
  }
  return undefined;
}

function cloudNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function occupiedInventoryNumber(expected: unknown, normalLock: unknown, fallback?: unknown): number | null {
  const expectedNum = optionalNumber(expected);
  const normalNum = optionalNumber(normalLock);
  const occupied = Math.max(0, expectedNum || 0) + Math.max(0, normalNum || 0);
  if (occupied > 0) return occupied;
  return expectedNum ?? normalNum ?? optionalNumber(fallback);
}

function formatOptionalNumber(value: unknown) {
  const num = optionalNumber(value);
  return num === null ? "-" : num;
}

function cloudProductKey(mallId?: string | null, skcId?: string | null) {
  return `${String(mallId || "")}|${String(skcId || "")}`;
}

function cloudActivityKey(kind: "skc" | "product" | "goods", mallId?: string | null, id?: string | null) {
  const mall = String(mallId || "").trim();
  const value = String(id || "").trim();
  return mall && value ? `${kind}:${mall}|${value}` : "";
}

function cloudKeyFromSkc(row?: SkcRow | null) {
  return cloudProductKey(row?.mall_id, row?.skc_id);
}

function cloudKeyFromSales(row?: TemuSalesRow | null) {
  return cloudProductKey(row?.mall_supplier_id, row?.skc_id);
}

function cloudKeyFromProduct(product?: Partial<ProductItem> | null) {
  return cloudProductKey(product?.mallId || product?.cloudSales?.mall_supplier_id || product?.cloudSkc?.mall_id, product?.skcId);
}

function activityLookupKeys(row?: TemuActivityRow | null) {
  if (!row) return [];
  const keys = new Set<string>();
  const add = (kind: "skc" | "product" | "goods", id: unknown) => {
    const key = cloudActivityKey(kind, row.mall_id, id === null || id === undefined ? null : String(id));
    if (key) keys.add(key);
  };
  add("skc", row.skc_id);
  add("product", row.product_id);
  add("goods", row.goods_id);

  for (const source of [parseCloudJsonObject(row.raw_json), parseCloudJsonObject(row.metric_json)]) {
    add("product", firstDeepValue(source, ["productId", "productSpuId", "spuId", "spu_id", "goodsSpuId"], 4));
    add("goods", firstDeepValue(source, ["goodsId", "goods_id"], 4));
    const skcList = firstDeepValue(source, ["skcList"], 5);
    if (!Array.isArray(skcList)) continue;
    for (const skc of skcList) {
      if (!skc || typeof skc !== "object") continue;
      add("skc", firstDeepValue(skc, ["productSkcId", "skcId", "skc_id"], 2));
      add("product", firstDeepValue(skc, ["productId", "productSpuId", "spuId", "spu_id"], 2));
    }
  }
  return [...keys];
}

function riskLookupKeys(row?: TemuOperationRiskRow | null) {
  if (!row) return [];
  return [
    cloudActivityKey("skc", row.mall_id, row.skc_id),
    cloudActivityKey("product", row.mall_id, row.product_id),
    cloudActivityKey("goods", row.mall_id, row.goods_id),
  ].filter(Boolean);
}

function stockOrderLookupKeys(row?: TemuStockOrderRow | null) {
  if (!row) return [];
  return [
    cloudActivityKey("skc", row.mall_id, row.skc_id),
    cloudActivityKey("product", row.mall_id, row.product_id),
  ].filter(Boolean);
}

function afterSaleLookupKeys(row?: TemuAfterSaleRow | null) {
  if (!row) return [];
  return [
    cloudActivityKey("skc", row.mall_id, row.skc_id),
    cloudActivityKey("product", row.mall_id, row.product_id),
  ].filter(Boolean);
}

function productActivityLookupKeys(source: {
  mallId?: string | null;
  skcId?: string | null;
  productId?: string | null;
  goodsId?: string | null;
}) {
  return [
    cloudActivityKey("skc", source.mallId, source.skcId),
    cloudActivityKey("product", source.mallId, source.productId),
    cloudActivityKey("goods", source.mallId, source.goodsId),
  ].filter(Boolean);
}

function buildCloudActivityMap(rows: TemuActivityRow[]) {
  const activityMap = new Map<string, TemuActivityRow[]>();
  for (const row of rows) {
    for (const key of activityLookupKeys(row)) {
      const bucket = activityMap.get(key) || [];
      bucket.push(row);
      activityMap.set(key, bucket);
    }
  }
  for (const bucket of activityMap.values()) {
    bucket.sort((left, right) => {
      const leftTime = left.last_updated_at ? Date.parse(left.last_updated_at) : 0;
      const rightTime = right.last_updated_at ? Date.parse(right.last_updated_at) : 0;
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    });
  }
  return activityMap;
}

function buildCloudRiskMap(rows: TemuOperationRiskRow[]) {
  const riskMap = new Map<string, TemuOperationRiskRow[]>();
  for (const row of rows) {
    for (const key of riskLookupKeys(row)) {
      const bucket = riskMap.get(key) || [];
      bucket.push(row);
      riskMap.set(key, bucket);
    }
  }
  for (const bucket of riskMap.values()) {
    bucket.sort((left, right) => {
      const severityScore = (value?: string | null) => value === "high" ? 3 : value === "medium" ? 2 : 1;
      const severityDiff = severityScore(right.severity) - severityScore(left.severity);
      if (severityDiff !== 0) return severityDiff;
      const leftTime = left.last_updated_at ? Date.parse(left.last_updated_at) : 0;
      const rightTime = right.last_updated_at ? Date.parse(right.last_updated_at) : 0;
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    });
  }
  return riskMap;
}

function buildCloudStockOrderMap(rows: TemuStockOrderRow[]) {
  const stockOrderMap = new Map<string, TemuStockOrderRow[]>();
  for (const row of rows) {
    for (const key of stockOrderLookupKeys(row)) {
      const bucket = stockOrderMap.get(key) || [];
      bucket.push(row);
      stockOrderMap.set(key, bucket);
    }
  }
  for (const bucket of stockOrderMap.values()) {
    bucket.sort((left, right) => {
      const leftTime = Date.parse(String(left.last_updated_at || left.latest_ship_at || left.order_time || ""));
      const rightTime = Date.parse(String(right.last_updated_at || right.latest_ship_at || right.order_time || ""));
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    });
  }
  return stockOrderMap;
}

function buildCloudAfterSaleMap(rows: TemuAfterSaleRow[]) {
  const afterSaleMap = new Map<string, TemuAfterSaleRow[]>();
  for (const row of rows) {
    for (const key of afterSaleLookupKeys(row)) {
      const bucket = afterSaleMap.get(key) || [];
      bucket.push(row);
      afterSaleMap.set(key, bucket);
    }
  }
  for (const bucket of afterSaleMap.values()) {
    bucket.sort((left, right) => {
      const leftTime = Date.parse(String(left.last_updated_at || left.updated_at_text || left.created_at_text || ""));
      const rightTime = Date.parse(String(right.last_updated_at || right.updated_at_text || right.created_at_text || ""));
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    });
  }
  return afterSaleMap;
}

function getCloudActivities(
  bundle: Pick<CloudProductBundle, "activityMap">,
  source: { mallId?: string | null; skcId?: string | null; productId?: string | null; goodsId?: string | null },
) {
  const seen = new Set<string>();
  const rows: TemuActivityRow[] = [];
  for (const key of productActivityLookupKeys(source)) {
    for (const row of bundle.activityMap.get(key) || []) {
      const rowId = row.id || row.row_key;
      if (seen.has(rowId)) continue;
      seen.add(rowId);
      rows.push(row);
    }
  }
  return rows;
}

function getCloudRisks(
  bundle: Pick<CloudProductBundle, "riskMap">,
  source: { mallId?: string | null; skcId?: string | null; productId?: string | null; goodsId?: string | null },
) {
  const seen = new Set<string>();
  const rows: TemuOperationRiskRow[] = [];
  for (const key of productActivityLookupKeys(source)) {
    for (const row of bundle.riskMap.get(key) || []) {
      const rowId = row.id || row.risk_key;
      if (seen.has(rowId)) continue;
      seen.add(rowId);
      rows.push(row);
    }
  }
  return rows;
}

function getCloudStockOrders(
  bundle: Pick<CloudProductBundle, "stockOrderMap">,
  source: { mallId?: string | null; skcId?: string | null; productId?: string | null; goodsId?: string | null },
) {
  const seen = new Set<string>();
  const rows: TemuStockOrderRow[] = [];
  for (const key of productActivityLookupKeys(source)) {
    for (const row of bundle.stockOrderMap.get(key) || []) {
      const rowId = row.id || row.row_key;
      if (seen.has(rowId)) continue;
      seen.add(rowId);
      rows.push(row);
    }
  }
  return rows;
}

function getCloudAfterSales(
  bundle: Pick<CloudProductBundle, "afterSaleMap">,
  source: { mallId?: string | null; skcId?: string | null; productId?: string | null; goodsId?: string | null },
) {
  const seen = new Set<string>();
  const rows: TemuAfterSaleRow[] = [];
  for (const key of productActivityLookupKeys(source)) {
    for (const row of bundle.afterSaleMap.get(key) || []) {
      const rowId = row.id || row.row_key;
      if (seen.has(rowId)) continue;
      seen.add(rowId);
      rows.push(row);
    }
  }
  return rows;
}

void getCloudStockOrders;
void getCloudAfterSales;

const productOrderCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function compareCloudProductOrder(a: Partial<ProductItem>, b: Partial<ProductItem>) {
  const mallCompare = productOrderCollator.compare(String(a.mallId || ""), String(b.mallId || ""));
  if (mallCompare !== 0) return mallCompare;
  const skcCompare = productOrderCollator.compare(String(a.skcId || ""), String(b.skcId || ""));
  if (skcCompare !== 0) return skcCompare;
  return productOrderCollator.compare(String(a.title || ""), String(b.title || ""));
}

function cloudMoney(cents?: number | null) {
  if (cents === null || cents === undefined) return "";
  return (Number(cents) / 100).toFixed(2);
}

function formatSkuSupplierPrice(value: unknown, fallback: string | number = "") {
  if (value === null || value === undefined || value === "") return String(fallback ?? "");
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  const yuan = Number.isInteger(num) && Math.abs(num) >= 100 ? num / 100 : num;
  return yuan.toFixed(2);
}

function isDiagnosticCloudValue(value: string) {
  return (
    value.startsWith("MALL-DBG")
    || value.startsWith("MALL-EXT-E2E")
    || value.startsWith("SKC-DBG")
    || value.includes("EXT-E2E")
    || value === "debug"
    || value === "local-e2e"
    || value.toLowerCase() === "debug product"
    || value.startsWith("127.0.0.1")
    || value.toLowerCase().includes("codex extension e2e")
  );
}

function isDiagnosticCloudProduct(skc?: SkcRow | null, sales?: TemuSalesRow | null) {
  const values = [
    skc?.mall_id,
    skc?.site,
    skc?.skc_id,
    skc?.product_id,
    skc?.title,
    sales?.mall_supplier_id,
    sales?.skc_id,
    sales?.product_id,
    sales?.title,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return values.some(isDiagnosticCloudValue);
}

function isDiagnosticCloudActivity(row?: TemuActivityRow | null) {
  const values = [
    row?.mall_id,
    row?.site,
    row?.skc_id,
    row?.product_id,
    row?.goods_id,
    row?.activity_id,
    row?.activity_title,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return values.some(isDiagnosticCloudValue);
}

function isDiagnosticCloudRisk(row?: TemuOperationRiskRow | null) {
  const values = [
    row?.mall_id,
    row?.site,
    row?.skc_id,
    row?.product_id,
    row?.goods_id,
    row?.risk_title,
    row?.risk_key,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return values.some(isDiagnosticCloudValue);
}

function isDiagnosticCloudStockOrder(row?: TemuStockOrderRow | null) {
  const values = [
    row?.mall_id,
    row?.site,
    row?.skc_id,
    row?.sku_id,
    row?.product_id,
    row?.product_name,
    row?.stock_order_no,
    row?.delivery_order_sn,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return values.some(isDiagnosticCloudValue);
}

function isDiagnosticCloudAfterSale(row?: TemuAfterSaleRow | null) {
  const values = [
    row?.mall_id,
    row?.site,
    row?.skc_id,
    row?.sku_id,
    row?.product_id,
    row?.product_name,
    row?.package_no,
    row?.order_id,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return values.some(isDiagnosticCloudValue);
}

function operationRiskLabel(value?: string | null) {
  const labels: Record<string, string> = {
    violation_goods: "违规",
    delivery_order: "发货",
    logistics_feedback: "物流",
    spot_check: "质检",
    spot_check_history: "质检",
    inbound_exception: "入库",
    return_package: "退货",
    high_price_flow: "限流",
    regional_sales: "区域",
  };
  return labels[value || ""] || value || "风险";
}

function operationRiskColor(value?: string | null) {
  if (value === "high") return "red";
  if (value === "medium") return "orange";
  return "default";
}

function cloudProductBundleHasData(bundle: Pick<CloudProductBundleCache, "skcRows" | "salesRows" | "activityRows" | "riskRows" | "stockOrderRows" | "afterSaleRows" | "shopSales">) {
  return (
    bundle.skcRows.length > 0
    || bundle.salesRows.length > 0
    || bundle.activityRows.length > 0
    || bundle.riskRows.length > 0
    || bundle.stockOrderRows.length > 0
    || bundle.afterSaleRows.length > 0
    || Boolean(bundle.shopSales)
  );
}

function hydrateCloudProductBundle(
  source: Partial<CloudProductBundleCache>,
  meta: { configured: boolean; error?: string; latestAt?: string },
): CloudProductBundle {
  const skcRows = Array.isArray(source.skcRows) ? source.skcRows : [];
  const salesRows = Array.isArray(source.salesRows) ? source.salesRows : [];
  const activityRows = Array.isArray(source.activityRows) ? source.activityRows : [];
  const riskRows = Array.isArray(source.riskRows) ? source.riskRows : [];
  const stockOrderRows = Array.isArray(source.stockOrderRows) ? source.stockOrderRows : [];
  const afterSaleRows = Array.isArray(source.afterSaleRows) ? source.afterSaleRows : [];
  const skcMap = new Map<string, SkcRow>();
  const salesMap = new Map<string, TemuSalesRow>();
  for (const row of skcRows) {
    if (row.skc_id) skcMap.set(cloudKeyFromSkc(row), row);
  }
  for (const row of salesRows) {
    if (row.skc_id) salesMap.set(cloudKeyFromSales(row), row);
  }
  return {
    skcRows,
    salesRows,
    activityRows,
    riskRows,
    stockOrderRows,
    afterSaleRows,
    shopSales: source.shopSales || null,
    skcMap,
    salesMap,
    activityMap: buildCloudActivityMap(activityRows),
    riskMap: buildCloudRiskMap(riskRows),
    stockOrderMap: buildCloudStockOrderMap(stockOrderRows),
    afterSaleMap: buildCloudAfterSaleMap(afterSaleRows),
    latestAt: meta.latestAt || source.latestAt || latestCloudTimestamp(skcRows, salesRows, activityRows, riskRows, stockOrderRows, afterSaleRows),
    error: meta.error || "",
    configured: meta.configured,
  };
}

function snapshotCloudProductBundle(bundle: CloudProductBundle): CloudProductBundleCache {
  return {
    generatedAt: new Date().toISOString(),
    latestAt: bundle.latestAt,
    skcRows: bundle.skcRows,
    salesRows: bundle.salesRows,
    activityRows: bundle.activityRows,
    riskRows: bundle.riskRows,
    stockOrderRows: bundle.stockOrderRows,
    afterSaleRows: bundle.afterSaleRows,
    shopSales: bundle.shopSales,
  };
}

function normalizeCloudProductBundleCache(value: unknown): CloudProductBundleCache | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<CloudProductBundleCache>;
  const cache: CloudProductBundleCache = {
    generatedAt: String(source.generatedAt || ""),
    latestAt: String(source.latestAt || ""),
    skcRows: Array.isArray(source.skcRows) ? source.skcRows : [],
    salesRows: Array.isArray(source.salesRows) ? source.salesRows : [],
    activityRows: Array.isArray(source.activityRows) ? source.activityRows : [],
    riskRows: Array.isArray(source.riskRows) ? source.riskRows : [],
    stockOrderRows: Array.isArray(source.stockOrderRows) ? source.stockOrderRows : [],
    afterSaleRows: Array.isArray(source.afterSaleRows) ? source.afterSaleRows : [],
    shopSales: source.shopSales || null,
  };
  return cache.generatedAt && cloudProductBundleHasData(cache) ? cache : null;
}

async function readCachedCloudProductBundle(error: string, configured: boolean): Promise<CloudProductBundle | null> {
  const pageCache = normalizeCloudProductBundleCache(
    readPageCache<CloudProductBundleCache | null>(CLOUD_PRODUCT_BUNDLE_CACHE_KEY, null),
  );
  if (pageCache) {
    return hydrateCloudProductBundle(pageCache, {
      configured,
      error,
      latestAt: pageCache.latestAt || pageCache.generatedAt,
    });
  }

  try {
    const storeValue = await store?.get?.(CLOUD_PRODUCT_BUNDLE_CACHE_KEY);
    const storeCache = normalizeCloudProductBundleCache(storeValue);
    if (storeCache) {
      writePageCache<CloudProductBundleCache>(CLOUD_PRODUCT_BUNDLE_CACHE_KEY, storeCache);
      return hydrateCloudProductBundle(storeCache, {
        configured,
        error,
        latestAt: storeCache.latestAt || storeCache.generatedAt,
      });
    }
  } catch {
    // Cache is display-only. If one backend is unavailable, keep going.
  }
  return null;
}

async function writeCachedCloudProductBundle(bundle: CloudProductBundle) {
  if (!cloudProductBundleHasData(bundle)) return;
  const snapshot = snapshotCloudProductBundle(bundle);
  writePageCache<CloudProductBundleCache>(CLOUD_PRODUCT_BUNDLE_CACHE_KEY, snapshot);
  try {
    await store?.set?.(CLOUD_PRODUCT_BUNDLE_CACHE_KEY, snapshot);
  } catch {
    // localStorage already has the same display snapshot.
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, messageText: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(messageText)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function loadCloudProductBundle(): Promise<CloudProductBundle> {
  const empty = hydrateCloudProductBundle({}, { configured: false });

  try {
    const cfg = await loadCloudConfig();
    if (!cfg) {
      return await readCachedCloudProductBundle("云端未配置，显示上次云端缓存", false) || empty;
    }
    const [skc, sales, shopSales, activity, risks, stockOrders, afterSales] = await withTimeout(
      Promise.all([
        fetchSkcList(cfg, { limit: 5000 }),
        fetchTemuSales(cfg, { include_flow_only: true, limit: 5000 }),
        fetchTemuShopSales(cfg),
        fetchTemuActivity(cfg, { limit: 5000, library: true }),
        fetchTemuOperationRisks(cfg, { limit: 3000 }),
        fetchTemuStockOrders(cfg, { limit: 3000 }),
        fetchTemuAfterSales(cfg, { limit: 3000 }),
      ]),
      CLOUD_PRODUCT_FETCH_TIMEOUT_MS,
      "云端读取超时，已显示上次云端缓存",
    );
    const rawSkcRows = Array.isArray(skc?.rows) ? skc.rows : [];
    const diagnosticSkcIds = new Set(
      rawSkcRows
        .filter((row) => isDiagnosticCloudProduct(row, null))
        .map((row) => cloudKeyFromSkc(row)),
    );
    const captureSkcRows = rawSkcRows.filter((row) => !isDiagnosticCloudProduct(row, null));
    // === 融入官方 API 商品作底列表（官方为主，抓包销量/流量按 mall|skc 叠加）===
    // 官方商品转 SkcRow 形状；抓包 skcRows 仅保留官方未覆盖的（按 mall|skc 去重）。
    // 抓包的销量/价格/库存/活动/流量仍由 salesRows 等按同 key enrich，不丢失。
    let officialSkcRows: SkcRow[] = [];
    try {
      const officialApi = (window.electronAPI as any)?.erp?.temuOpenApi;
      if (officialApi?.listProductsAsSkc) {
        const officialRes = await officialApi.listProductsAsSkc();
        officialSkcRows = (Array.isArray(officialRes?.rows) ? officialRes.rows : [])
          .filter((r: any) => r && r.skc_id && r.mall_id)
          .map((r: any) => ({
            skc_id: String(r.skc_id),
            product_id: r.product_id != null ? String(r.product_id) : null,
            mall_id: String(r.mall_id),
            site: null,
            title: r.title || null,
            category_name: null,
            status: null,
            thumb_url: r.thumb_url || null,
            declared_price_cents: null,
            suggested_price_cents: null,
            price_currency: null,
            sales_total: null,
            stock_available: null,
            last_updated_at: r.updated_at ? (Date.parse(r.updated_at) || 0) : 0,
          } as SkcRow));
      }
    } catch { /* 官方读取失败不影响抓包数据 */ }
    const officialKeys = new Set(officialSkcRows.map((r) => cloudKeyFromSkc(r)));
    const skcRows = officialSkcRows.length
      ? [...officialSkcRows, ...captureSkcRows.filter((row) => !officialKeys.has(cloudKeyFromSkc(row)))]
      : captureSkcRows;
    const salesRows = (Array.isArray(sales?.rows) ? sales.rows : []).filter((row) => (
      !isDiagnosticCloudProduct(null, row) && !diagnosticSkcIds.has(cloudKeyFromSales(row))
    ));
    const activityRows = (Array.isArray(activity?.rows) ? activity.rows : []).filter((row) => !isDiagnosticCloudActivity(row));
    const riskRows = (Array.isArray(risks?.rows) ? risks.rows : []).filter((row) => !isDiagnosticCloudRisk(row));
    const stockOrderRows = (Array.isArray(stockOrders?.rows) ? stockOrders.rows : []).filter((row) => !isDiagnosticCloudStockOrder(row));
    const afterSaleRows = (Array.isArray(afterSales?.rows) ? afterSales.rows : []).filter((row) => !isDiagnosticCloudAfterSale(row));
    const bundle = hydrateCloudProductBundle({
      skcRows,
      salesRows,
      activityRows,
      riskRows,
      stockOrderRows,
      afterSaleRows,
      shopSales: shopSales?.row || null,
    }, { configured: true });
    if (cloudProductBundleHasData(bundle)) {
      await writeCachedCloudProductBundle(bundle);
      return bundle;
    }
    return await readCachedCloudProductBundle("云端本次返回为空，已显示上次云端缓存", true) || {
      ...bundle,
      error: "云端本次返回为空，未找到可用缓存",
    };
  } catch (error: any) {
    const messageText = error?.message || "读取云端商品数据失败";
    return await readCachedCloudProductBundle(`读取云端失败，已显示上次云端缓存：${messageText}`, true) || {
      ...empty,
      error: messageText,
      configured: true,
    };
  }
}

function buildCloudSalesRaw(previousRaw: any, skc: SkcRow | undefined, sales: TemuSalesRow | undefined) {
  const rawItem = sales?.raw_item && typeof sales.raw_item === "object" ? sales.raw_item : {};
  const flowRaw = {
    payGoodsNum: sales?.flow_pay_goods_num,
    payOrderNum: sales?.flow_pay_order_num,
    buyerNum: sales?.flow_buyer_num,
    exposeNum: sales?.flow_expose_num,
    clickNum: sales?.flow_click_num,
    goodsDetailVisitNum: sales?.flow_detail_visit_num,
    goodsDetailVisitorNum: sales?.flow_detail_visitor_num,
    addToCartUserNum: sales?.flow_add_to_cart_user_num,
    collectUserNum: sales?.flow_collect_user_num,
    exposePayConversionRate: sales?.flow_expose_pay_conversion_rate,
    exposeClickConversionRate: sales?.flow_expose_click_conversion_rate,
    clickPayConversionRate: sales?.flow_click_pay_conversion_rate,
    searchExposeNum: sales?.flow_search_expose_num,
    searchClickNum: sales?.flow_search_click_num,
    searchPayGoodsNum: sales?.flow_search_pay_goods_num,
    searchPayOrderNum: sales?.flow_search_pay_order_num,
    recommendExposeNum: sales?.flow_recommend_expose_num,
    recommendClickNum: sales?.flow_recommend_click_num,
    recommendPayGoodsNum: sales?.flow_recommend_pay_goods_num,
    recommendPayOrderNum: sales?.flow_recommend_pay_order_num,
    flowGrowStatus: sales?.flow_grow_status,
    growDataText: sales?.flow_grow_data_text,
    bsrGoods: sales?.flow_bsr_goods,
    flowTrendDaily: sales?.flow_trend_daily,
  };
  const baseRaw = {
    ...(previousRaw && typeof previousRaw === "object" ? previousRaw : {}),
    ...rawItem,
    ...Object.fromEntries(Object.entries(flowRaw).filter(([, value]) => value !== null && value !== undefined && value !== "")),
  } as any;
  const declaredPrice = firstCloudValue<number>(sales?.declared_price_cents, skc?.declared_price_cents);
  const currency = firstCloudValue<string>(sales?.price_currency, skc?.price_currency, baseRaw.currencyType) || "CNY";
  const warehouseStock = firstCloudValue<number>(sales?.warehouse_stock);
  const displayedSkcId = sales?.flow_only
    ? firstCloudValue<string>(baseRaw.productSkcId, baseRaw.skcId, skc?.skc_id)
    : firstCloudValue<string>(sales?.skc_id, skc?.skc_id, baseRaw.productSkcId);
  const cloudSku = {
    productSkuId: baseRaw.productSkuId || "",
    className: baseRaw.className || "",
    skuExtCode: sales?.sku_ext_code || baseRaw.skcExtCode || "",
    supplierPrice: declaredPrice ?? undefined,
    currencyType: currency,
    todaySaleVolume: sales?.today_sales ?? null,
    lastSevenDaysSaleVolume: sales?.last7d_sales ?? null,
    lastThirtyDaysSaleVolume: sales?.last30d_sales ?? null,
    sellerWhStock: warehouseStock,
    inventoryNumInfo: {
      warehouseInventoryNum: warehouseStock ?? null,
      expectedOccupiedInventoryNum: sales?.occupy_stock ?? null,
      unavailableWarehouseInventoryNum: sales?.unavailable_stock ?? null,
      waitReceiveNum: null,
    },
    lackQuantity: null,
    adviceQuantity: sales?.advice_qty ?? null,
  };
  const skuTrendMap = sales?.sku_sales_trends && typeof sales.sku_sales_trends === "object"
    ? sales.sku_sales_trends
    : {};
  const rawSkuListSource = Array.isArray(baseRaw.skuQuantityDetailList) ? baseRaw.skuQuantityDetailList : [];
  const rawSkuList = rawSkuListSource.map((sku: any) => {
    const skuId = String(sku?.productSkuId || sku?.prodSkuId || sku?.skuId || "");
    const trend = skuId ? skuTrendMap[skuId] : null;
    if (!trend) return sku;
    return {
      ...sku,
      todaySaleVolume: trend.today_sales ?? sku.todaySaleVolume,
      lastSevenDaysSaleVolume: trend.last7d_sales ?? sku.lastSevenDaysSaleVolume,
      lastThirtyDaysSaleVolume: trend.last30d_sales ?? sku.lastThirtyDaysSaleVolume,
      trendDaily: Array.isArray(trend.trend_daily) ? trend.trend_daily : sku.trendDaily,
    };
  });
  const rawTotalInfo = baseRaw.skuQuantityTotalInfo && typeof baseRaw.skuQuantityTotalInfo === "object"
    ? baseRaw.skuQuantityTotalInfo
    : {};
  const rawInventoryInfo = rawTotalInfo.inventoryNumInfo && typeof rawTotalInfo.inventoryNumInfo === "object"
    ? rawTotalInfo.inventoryNumInfo
    : {};

  return {
    ...baseRaw,
    isCloudProduct: true,
    cloudSourceEvent: sales?.raw_source || null,
    supplierId: sales?.mall_supplier_id || skc?.mall_id || baseRaw.supplierId,
    productSkcId: displayedSkcId || baseRaw.productSkcId,
    productId: sales?.product_id || skc?.product_id || baseRaw.productId || baseRaw.productSpuId,
    goodsId: sales?.goods_id || baseRaw.goodsId,
    productName: sales?.title || skc?.title || baseRaw.productName,
    category: sales?.category_name || skc?.category_name || baseRaw.category,
    productSkcPicture: sales?.thumb_url || skc?.thumb_url || baseRaw.productSkcPicture,
    skcExtCode: sales?.sku_ext_code || baseRaw.skcExtCode,
    productReviewScore: sales?.asf_score ?? baseRaw.productReviewScore ?? baseRaw.goodsScore ?? baseRaw.score ?? baseRaw.avgScore,
    commentNum: sales?.comment_num ?? baseRaw.commentNum,
    qualityAfterSalesRate: sales?.quality_after_sales_rate ?? baseRaw.qualityAfterSalesRate,
    stockStatus: sales?.stock_status ?? baseRaw.stockStatus,
    supplyStatus: sales?.supply_status ?? baseRaw.supplyStatus,
    closeJitStatus: sales?.close_jit_status ?? baseRaw.closeJitStatus,
    trendDaily: Array.isArray(sales?.trend_daily) ? sales?.trend_daily : baseRaw.trendDaily,
    trendLatestDate: sales?.trend_latest_date || baseRaw.trendLatestDate,
    skuQuantityDetailList: rawSkuList.length > 0 ? rawSkuList : [cloudSku],
    skuQuantityTotalInfo: {
      ...rawTotalInfo,
      todaySaleVolume: sales?.today_sales ?? rawTotalInfo.todaySaleVolume ?? null,
      lastSevenDaysSaleVolume: sales?.last7d_sales ?? rawTotalInfo.lastSevenDaysSaleVolume ?? null,
      lastThirtyDaysSaleVolume: sales?.last30d_sales ?? rawTotalInfo.lastThirtyDaysSaleVolume ?? null,
      totalSaleVolume: rawTotalInfo.totalSaleVolume ?? sales?.total_sales ?? null,
      adviceQuantity: rawTotalInfo.adviceQuantity ?? sales?.advice_qty ?? null,
      availableSaleDays: rawTotalInfo.availableSaleDays ?? sales?.available_sale_days ?? undefined,
      inventoryNumInfo: {
        ...rawInventoryInfo,
        expectedOccupiedInventoryNum: rawInventoryInfo.expectedOccupiedInventoryNum ?? sales?.occupy_stock ?? null,
        unavailableWarehouseInventoryNum: rawInventoryInfo.unavailableWarehouseInventoryNum ?? sales?.unavailable_stock ?? null,
        warehouseInventoryNum: rawInventoryInfo.warehouseInventoryNum ?? warehouseStock ?? null,
      },
    },
  };
}

function cloudFlowSummarySource(sales?: TemuSalesRow) {
  if (!sales) return null;
  return {
    dataDate: sales.flow_stat_date || sales.stat_date,
    updateTime: sales.last_updated_at || "",
    payGoodsNum: sales.flow_pay_goods_num,
    payOrderNum: sales.flow_pay_order_num,
    buyerNum: sales.flow_buyer_num,
    exposeNum: sales.flow_expose_num,
    clickNum: sales.flow_click_num,
    detailVisitNum: sales.flow_detail_visit_num,
    detailVisitorNum: sales.flow_detail_visitor_num,
    addToCartUserNum: sales.flow_add_to_cart_user_num,
    collectUserNum: sales.flow_collect_user_num,
    exposeClickRate: sales.flow_expose_click_conversion_rate,
    clickPayRate: sales.flow_click_pay_conversion_rate,
    exposePayRate: sales.flow_expose_pay_conversion_rate,
    searchExposeNum: sales.flow_search_expose_num,
    searchClickNum: sales.flow_search_click_num,
    searchPayGoodsNum: sales.flow_search_pay_goods_num,
    searchPayOrderNum: sales.flow_search_pay_order_num,
    recommendExposeNum: sales.flow_recommend_expose_num,
    recommendClickNum: sales.flow_recommend_click_num,
    recommendPayGoodsNum: sales.flow_recommend_pay_goods_num,
    recommendPayOrderNum: sales.flow_recommend_pay_order_num,
    growDataText: sales.flow_grow_data_text,
    flowGrowStatus: sales.flow_grow_status,
    bsrGoods: sales.flow_bsr_goods,
    _cloudFlow: true,
  };
}

function hasCloudFlowSummary(source: Record<string, any> | null) {
  if (!source) return false;
  return [
    source.exposeNum,
    source.clickNum,
    source.detailVisitNum,
    source.detailVisitorNum,
    source.addToCartUserNum,
    source.collectUserNum,
    source.payGoodsNum,
    source.payOrderNum,
    source.buyerNum,
  ].some((value) => Number(value || 0) > 0);
}

function cloudFlowTrendRows(sales?: TemuSalesRow) {
  const rows = Array.isArray(sales?.flow_trend_daily) ? sales.flow_trend_daily : [];
  return rows
    .filter((row) => row && row.date)
    .map((row) => ({
      ...row,
      fullDate: row.date,
      dataDate: row.date,
      updateTime: (row as any).updatedAt || sales?.last_updated_at || "",
      _cloudFlowTrend: true,
    }))
    .sort((left, right) => String(left.fullDate || "").localeCompare(String(right.fullDate || "")));
}

function buildCloudFlowSite(sales?: TemuSalesRow): ProductFluxSiteData | null {
  const source = cloudFlowSummarySource(sales);
  const trendRows = cloudFlowTrendRows(sales);
  if (!hasCloudFlowSummary(source) && trendRows.length === 0) return null;
  const syncedAt = formatTimestamp(sales?.last_updated_at) || "";
  const latestLabel = "最新";
  const trendLabel = trendRows.length ? `近${Math.min(trendRows.length, 60)}日` : "";
  const summaryByRange: Record<string, ProductTrafficSummary> = {};
  const itemsByRange: Record<string, any[]> = {};
  if (trendRows.length > 0) {
    summaryByRange[trendLabel] = summarizeFluxItems(trendRows, "global", "全球", syncedAt);
    itemsByRange[trendLabel] = trendRows;
  }
  if (source && hasCloudFlowSummary(source)) {
    summaryByRange[latestLabel] = buildTrafficSummary(source, "global", "全球", syncedAt);
    itemsByRange[latestLabel] = [source];
  }
  const availableRanges = sortFluxRangeLabels(Object.keys(summaryByRange));
  const primaryRangeLabel = trendLabel || latestLabel;
  return {
    siteKey: "global",
    siteLabel: "全球",
    syncedAt,
    summary: summaryByRange[primaryRangeLabel] || summaryByRange[latestLabel] || null,
    summaryByRange,
    items: itemsByRange[primaryRangeLabel] || itemsByRange[latestLabel] || [],
    itemsByRange,
    availableRanges,
    primaryRangeLabel,
  };
}

function applyCloudProduct(
  product: ProductItem,
  skc: SkcRow | undefined,
  sales: TemuSalesRow | undefined,
  activities: TemuActivityRow[] = [],
  risks: TemuOperationRiskRow[] = [],
  stockOrders: TemuStockOrderRow[] = [],
  afterSales: TemuAfterSaleRow[] = [],
) {
  if (!skc && !sales && activities.length === 0 && risks.length === 0 && stockOrders.length === 0 && afterSales.length === 0) return;
  const raw = sales?.raw_item && typeof sales.raw_item === "object" ? sales.raw_item as any : {};
  const rawSkuList = Array.isArray(raw.skuQuantityDetailList) ? raw.skuQuantityDetailList : [];
  const rawSku = rawSkuList[0] || {};
  const displayedSkcId = sales?.flow_only
    ? firstCloudValue<string>(raw.productSkcId, raw.skcId, skc?.skc_id)
    : firstCloudValue<string>(sales?.skc_id, skc?.skc_id, raw.productSkcId, raw.skcId);
  const declaredPrice = firstCloudValue<number>(sales?.declared_price_cents, skc?.declared_price_cents);
  const title = firstCloudValue<string>(sales?.title, skc?.title, raw.productName, raw.goodsName, raw.title);
  const category = firstCloudValue<string>(sales?.category_name, skc?.category_name, raw.category, raw.categoryName);
  const imageUrl = normalizeImageUrl(firstCloudValue<string>(sales?.thumb_url, skc?.thumb_url, raw.productSkcPicture, raw.goodsImageUrl, raw.imageUrl, raw.thumbUrl));

  product.cloudSkc = skc;
  product.cloudSales = sales;
  product.cloudActivities = activities;
  product.cloudRisks = risks;
  product.cloudStockOrders = stockOrders;
  product.cloudAfterSales = afterSales;
  product.mallId = firstCloudValue<string>(sales?.mall_supplier_id, skc?.mall_id, raw.supplierId) || product.mallId;
  product.title = title || product.title;
  product.category = category || product.category;
  product.categories = category || product.categories;
  product.skcId = displayedSkcId || product.skcId || "";
  product.spuId = firstCloudValue<string>(sales?.product_id, skc?.product_id, raw.productId, raw.productSpuId, raw.spuId) || product.spuId;
  product.goodsId = firstCloudValue<string>(sales?.goods_id, raw.goodsId) || product.goodsId;
  product.sku = firstCloudValue<string>(rawSku.skuExtCode, rawSku.productSkuId, raw.skuCode) || product.sku;
  product.extCode = firstCloudValue<string>(sales?.sku_ext_code, raw.skcExtCode, rawSku.skuExtCode) || product.extCode;
  product.skuId = firstCloudValue<string>(rawSku.productSkuId, raw.productSkuId) || product.skuId;
  product.skuName = firstCloudValue<string>(rawSku.className, rawSku.specName, raw.skuName) || product.skuName;
  product.imageUrl = imageUrl || product.imageUrl;
  product.siteLabel = skc?.site || product.siteLabel;
  product.productType = firstCloudValue<string>(raw.productType, raw.goodsType) || product.productType;
  product.sourceType = firstCloudValue<string>(raw.sourceType, raw.productSourceType) || product.sourceType;
  product.status = firstCloudValue<string>(sales?.supply_status, sales?.stock_status, skc?.status, raw.supplyStatus, raw.stockStatus) || product.status;
  product.skcSiteStatus = firstCloudValue<string>(sales?.stock_status, skc?.status, raw.stockStatus) || product.skcSiteStatus;
  product.removeStatus = firstCloudValue<string>(raw.removeStatus, raw.offlineStatus) || product.removeStatus;
  product.flowLimitStatus = firstCloudValue<string>(raw.flowLimitStatus, raw.highPriceFlowLimitStatus) || product.flowLimitStatus;
  product.todaySales = cloudNumber(firstCloudValue<number>(sales?.today_sales, raw.todaySales, raw.skuQuantityTotalInfo?.todaySaleVolume), product.todaySales);
  product.last7DaysSales = cloudNumber(firstCloudValue<number>(sales?.last7d_sales, raw.last7DaysSales, raw.skuQuantityTotalInfo?.lastSevenDaysSaleVolume), product.last7DaysSales);
  product.last30DaysSales = cloudNumber(firstCloudValue<number>(sales?.last30d_sales, raw.last30DaysSales, raw.skuQuantityTotalInfo?.lastThirtyDaysSaleVolume), product.last30DaysSales);
  product.totalSales = cloudNumber(firstCloudValue<number>(sales?.total_sales, raw.totalSales, raw.skuQuantityTotalInfo?.totalSaleVolume), product.totalSales);
  product.warehouseStock = cloudNumber(firstCloudValue<number>(sales?.warehouse_stock, raw.warehouseStock, raw.skuQuantityTotalInfo?.inventoryNumInfo?.warehouseInventoryNum), product.warehouseStock);
  product.occupyStock = cloudNumber(occupiedInventoryNumber(
    raw.skuQuantityTotalInfo?.inventoryNumInfo?.expectedOccupiedInventoryNum,
    raw.skuQuantityTotalInfo?.inventoryNumInfo?.normalLockNumber,
    firstCloudValue<number>(sales?.occupy_stock, raw.occupyStock),
  ), product.occupyStock);
  product.unavailableStock = cloudNumber(firstCloudValue<number>(sales?.unavailable_stock, raw.unavailableStock, raw.skuQuantityTotalInfo?.inventoryNumInfo?.unavailableWarehouseInventoryNum), product.unavailableStock);
  product.lackQuantity = cloudNumber(firstCloudValue<number>(raw.lackQuantity, raw.skuQuantityTotalInfo?.lackQuantity), product.lackQuantity);
  product.price = cloudMoney(declaredPrice) || product.price;
  product.stockStatus = sales?.stock_status || product.stockStatus;
  product.supplyStatus = sales?.supply_status || skc?.status || product.supplyStatus;
  product.availableSaleDays = firstCloudValue<number>(sales?.available_sale_days, raw.availableSaleDays, raw.skuQuantityTotalInfo?.availableSaleDays) ?? product.availableSaleDays;
  product.asfScore = firstCloudValue<string>(sales?.asf_score, raw.asfScore, raw.productReviewScore, raw.goodsScore) ?? product.asfScore;
  product.buyerName = firstCloudValue<string>(raw.buyerName, raw.purchaseBuyerName, raw.purchaserName) || product.buyerName;
  product.buyerUid = firstCloudValue<string>(raw.buyerUid, raw.buyerId, raw.purchaseBuyerUid) || product.buyerUid;
  product.commentNum = cloudNumber(firstCloudValue<number>(sales?.comment_num, raw.commentNum), product.commentNum);
  product.inBlackList = firstCloudValue<string>(raw.inBlackList, raw.blackListStatus) || product.inBlackList;
  product.pictureAuditStatus = firstCloudValue<string>(raw.pictureAuditStatus, raw.imageAuditStatus) || product.pictureAuditStatus;
  product.qualityAfterSalesRate = firstCloudValue<string>(sales?.quality_after_sales_rate, raw.qualityAfterSalesRate) ?? product.qualityAfterSalesRate;
  product.hotTag = firstCloudValue<string>(raw.hotTag, raw.hotSaleTag) || product.hotTag;
  product.adviceQuantity = firstCloudValue<number>(sales?.advice_qty, raw.adviceQuantity, raw.skuQuantityTotalInfo?.adviceQuantity) ?? product.adviceQuantity ?? 0;
  product.syncedAt = formatTimestamp(sales?.last_updated_at) || formatTimestamp(skc?.last_updated_at) || product.syncedAt;
  product.hasSalesSnapshot = Boolean(sales || skc || product.hasSalesSnapshot);
  product.salesRaw = {
    ...buildCloudSalesRaw(product.salesRaw, skc, sales),
    cloudActivities: activities,
    cloudRisks: risks,
  };
  product.salesRawSku = rawSku || product.salesRawSku;
  if (Array.isArray(sales?.trend_daily) && sales.trend_daily.length > 0) {
    product.trendDaily = sales.trend_daily;
  } else if (Array.isArray(raw.trendDaily) && raw.trendDaily.length > 0) {
    product.trendDaily = raw.trendDaily;
  }
  const cloudFlowSite = buildCloudFlowSite(sales);
  if (cloudFlowSite) {
    product.fluxSites = [cloudFlowSite];
    product.fluxItems = cloudFlowSite.items || [];
    product.fluxSyncedAt = cloudFlowSite.syncedAt || "";
  }
  if (rawSkuList.length > 0) {
    product.skuSummaries = normalizeSkuSummaryList(rawSkuList.map((item: any) => ({
      productSkuId: item.productSkuId,
      thumbUrl: item.thumbUrl || raw.productSkcPicture || raw.productPicture,
      specText: item.className || item.specText,
      specName: item.className || item.specName,
      extCode: item.skuExtCode,
      productSkuSpecList: item.productSkuSpecList,
    })));
  }
}

function createProductItem(source: Partial<ProductItem> = {}): ProductItem {
  const skuSummaries = normalizeSkuSummaryList(source.skuSummaries);
  return {
    title: source.title || "",
    category: source.category || "",
    categories: source.categories || "",
    spuId: source.spuId || "",
    skcId: source.skcId || "",
    goodsId: source.goodsId || "",
    sku: source.sku || "",
    extCode: source.extCode || "",
    skuId: source.skuId || "",
    skuName: source.skuName || "",
    imageUrl: normalizeImageUrl(source.imageUrl) || skuSummaries[0]?.thumbUrl || "",
    mallId: source.mallId || "",
    siteLabel: source.siteLabel || "",
    productType: source.productType || "",
    sourceType: source.sourceType || "",
    removeStatus: source.removeStatus || "",
    status: source.status || "",
    skcSiteStatus: source.skcSiteStatus || "",
    flowLimitStatus: source.flowLimitStatus || "",
    skuSummaries,
    todaySales: source.todaySales || 0,
    last30DaysSales: source.last30DaysSales || 0,
    totalSales: source.totalSales || 0,
    last7DaysSales: source.last7DaysSales || 0,
    syncedAt: source.syncedAt || "",
    warehouseStock: source.warehouseStock || 0,
    occupyStock: source.occupyStock || 0,
    unavailableStock: source.unavailableStock || 0,
    lackQuantity: source.lackQuantity || 0,
    price: source.price || "",
    stockStatus: source.stockStatus || "",
    supplyStatus: source.supplyStatus || "",
    pendingOrderCount: source.pendingOrderCount || 0,
    hotTag: source.hotTag || "",
    availableSaleDays: source.availableSaleDays ?? "",
    asfScore: source.asfScore,
    buyerName: source.buyerName || "",
    buyerUid: source.buyerUid || "",
    operatorContact: source.operatorContact || "",
    operatorNick: source.operatorNick || "",
    highPriceFlowLimit: source.highPriceFlowLimit,
    highPriceFlowInfo: source.highPriceFlowInfo,
    commentNum: source.commentNum ?? 0,
    inBlackList: source.inBlackList || "",
    pictureAuditStatus: source.pictureAuditStatus || "",
    qualityAfterSalesRate: source.qualityAfterSalesRate ?? "",
    predictTodaySaleVolume: source.predictTodaySaleVolume ?? 0,
    sevenDaysSaleReference: source.sevenDaysSaleReference ?? 0,
    sevenDaysAddCartNum: source.sevenDaysAddCartNum ?? 0,
    hasSalesSnapshot: Boolean(source.hasSalesSnapshot),
    salesRaw: source.salesRaw,
    salesRawSku: source.salesRawSku,
    trendDaily: source.trendDaily,
    fluxItems: source.fluxItems,
    fluxSyncedAt: source.fluxSyncedAt,
    fluxSites: source.fluxSites,
    adviceQuantity: source.adviceQuantity ?? 0,
    cloudSkc: source.cloudSkc,
    cloudSales: source.cloudSales,
    cloudActivities: source.cloudActivities || [],
    cloudRisks: source.cloudRisks || [],
    cloudStockOrders: source.cloudStockOrders || [],
    cloudAfterSales: source.cloudAfterSales || [],
  };
}

function buildCloudProductRows(bundle: CloudProductBundle) {
  const ids = new Set<string>();
  const riskOnlyRows = new Map<string, TemuOperationRiskRow>();
  for (const row of bundle.skcRows) {
    if (row.skc_id && row.mall_id) ids.add(cloudKeyFromSkc(row));
  }
  for (const row of bundle.salesRows) {
    if (row.skc_id && row.mall_supplier_id) ids.add(cloudKeyFromSales(row));
  }
  for (const row of bundle.activityRows) {
    if (row.skc_id && row.mall_id) ids.add(cloudProductKey(row.mall_id, row.skc_id));
    for (const key of activityLookupKeys(row)) {
      const match = /^skc:([^|]+)\|(.+)$/.exec(key);
      const productKey = match ? cloudProductKey(match[1], match[2]) : "";
      if (productKey) ids.add(productKey);
    }
  }
  for (const row of bundle.stockOrderRows) {
    if (row.skc_id && row.mall_id) ids.add(cloudProductKey(row.mall_id, row.skc_id));
  }
  for (const row of bundle.afterSaleRows) {
    if (row.skc_id && row.mall_id) ids.add(cloudProductKey(row.mall_id, row.skc_id));
  }
  for (const row of bundle.riskRows) {
    if (row.skc_id && row.mall_id) {
      ids.add(cloudProductKey(row.mall_id, row.skc_id));
      continue;
    }
    const id = String(row.product_id || row.goods_id || row.risk_key || row.id || "").trim();
    if (row.mall_id && id) {
      const key = `risk:${row.mall_id}|${id}`;
      ids.add(key);
      riskOnlyRows.set(key, row);
    }
  }

  const rows: ProductItem[] = [];
  for (const rowKey of ids) {
    const skc = bundle.skcMap.get(rowKey);
    const sales = bundle.salesMap.get(rowKey);
    const riskOnly = riskOnlyRows.get(rowKey);
    const mallId = sales?.mall_supplier_id || skc?.mall_id || riskOnly?.mall_id || rowKey.replace(/^risk:/, "").split("|")[0] || "";
    const skcId = sales?.skc_id || skc?.skc_id || riskOnly?.skc_id || "";
    const rowKeySkcId = rowKey.startsWith("risk:") ? "" : rowKey.split("|")[1] || "";
    const lookupSkcId = skcId || rowKeySkcId;
    const activities = getCloudActivities(bundle, {
      mallId,
      skcId: lookupSkcId,
      productId: sales?.product_id || skc?.product_id || riskOnly?.product_id || "",
      goodsId: sales?.goods_id || riskOnly?.goods_id || "",
    });
    const risks = getCloudRisks(bundle, {
      mallId,
      skcId: skcId || rowKey.split("|")[1] || "",
      productId: sales?.product_id || skc?.product_id || riskOnly?.product_id || "",
      goodsId: sales?.goods_id || riskOnly?.goods_id || "",
    });
    const stockOrders = getCloudStockOrders(bundle, {
      mallId,
      skcId: skcId || rowKey.split("|")[1] || "",
      productId: sales?.product_id || skc?.product_id || riskOnly?.product_id || "",
      goodsId: sales?.goods_id || riskOnly?.goods_id || "",
    });
    const afterSales = getCloudAfterSales(bundle, {
      mallId,
      skcId: skcId || rowKey.split("|")[1] || "",
      productId: sales?.product_id || skc?.product_id || riskOnly?.product_id || "",
      goodsId: sales?.goods_id || riskOnly?.goods_id || "",
    });
    const firstActivity = activities[0];
    const firstRisk = risks[0] || riskOnly;
    const firstStockOrder = stockOrders[0];
    const firstAfterSale = afterSales[0];
    const product = createProductItem({
      skcId: skcId || firstActivity?.skc_id || firstRisk?.skc_id || firstStockOrder?.skc_id || firstAfterSale?.skc_id || rowKeySkcId || "",
      mallId,
      title: sales?.title || skc?.title || firstStockOrder?.product_name || firstAfterSale?.product_name || firstActivity?.activity_title || firstRisk?.risk_title || "",
      category: sales?.category_name || skc?.category_name || "",
      categories: sales?.category_name || skc?.category_name || "",
      imageUrl: sales?.thumb_url || skc?.thumb_url || "",
      siteLabel: skc?.site || firstStockOrder?.site || firstAfterSale?.site || firstActivity?.site || firstRisk?.site || "",
      syncedAt: formatTimestamp(sales?.last_updated_at) || formatTimestamp(skc?.last_updated_at) || formatTimestamp(firstStockOrder?.last_updated_at) || formatTimestamp(firstAfterSale?.last_updated_at) || formatTimestamp(firstActivity?.last_updated_at) || formatTimestamp(firstRisk?.last_updated_at),
      hasSalesSnapshot: Boolean(sales),
      cloudActivities: activities,
      cloudRisks: risks,
      cloudStockOrders: stockOrders,
      cloudAfterSales: afterSales,
    });
    applyCloudProduct(product, skc, sales, activities, risks, stockOrders, afterSales);
    rows.push(product);
  }

  return rows.sort(compareCloudProductOrder);
}

function buildCloudSalesSummary(products: ProductItem[]) {
  return {
    addedToSiteSkcNum: products.length,
    saleOutSkcNum: products.filter((product) => {
      const status = `${product.stockStatus || ""} ${product.supplyStatus || ""}`;
      return /售罄|断货|SOLD[_\s-]?OUT/i.test(status);
    }).length,
    soonSaleOutSkcNum: products.filter((product) => {
      const days = Number(product.availableSaleDays);
      return Number.isFinite(days) && days > 0 && days < 7;
    }).length,
    shortageSkcNum: products.filter((product) => (product.lackQuantity || 0) > 0).length,
    adviceStockSkcNum: products.filter((product) => (product.adviceQuantity || 0) > 0).length,
    adSkcNum: 0,
  };
}

function renderSnapshotField(label: string, value: unknown, accent = false) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div style={{ fontSize: 12, color: "var(--color-text-sec)" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: accent ? 700 : 500, color: accent ? "var(--color-brand)" : "var(--color-text)" }}>
        {formatTextValue(value)}
      </div>
    </div>
  );
}

function parseCloudJsonObject(text?: string | null) {
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function firstDeepValue(source: unknown, keys: string[], maxDepth = 3): unknown {
  if (!source || typeof source !== "object") return null;
  const seen = new Set<object>();
  const queue: Array<{ value: any; depth: number }> = [{ value: source, depth: 0 }];
  while (queue.length) {
    const { value, depth } = queue.shift()!;
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    for (const key of keys) {
      const next = value[key];
      if (next !== null && next !== undefined && next !== "") return next;
    }
    if (depth >= maxDepth) continue;
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") queue.push({ value: child, depth: depth + 1 });
    }
  }
  return null;
}

function scalarActivityValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  return firstDeepValue(value, ["priceCents", "priceCent", "cent", "cents", "amount", "value", "price"], 1);
}

function toActivityCents(value: unknown, fieldName = "") {
  const scalar = scalarActivityValue(value);
  if (scalar === null || scalar === undefined || scalar === "") return null;
  const number = typeof scalar === "string" ? parseFloat(scalar.replace(/,/g, "")) : Number(scalar);
  if (!Number.isFinite(number)) return null;
  if (/cents?|cent$/i.test(fieldName)) return Math.round(number);
  if (
    Number.isInteger(number)
    && /(activityPrice|dailyPrice|supplierPrice|targetSupplierPrice|suggestActivityPrice|suggestActivitySupplierPrice|suggestedActivitySupplierPrice)/i.test(fieldName)
  ) {
    return Math.round(number);
  }
  if (Number.isInteger(number) && Math.abs(number) >= 1000) return number;
  return Math.round(number * 100);
}

function firstNumberValue(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function pickActivityCents(activity: TemuActivityRow, directValue: unknown, keys: string[]) {
  const direct = firstNumberValue(directValue);
  if (direct !== null) return direct;
  const metric = parseCloudJsonObject(activity.metric_json);
  const raw = parseCloudJsonObject(activity.raw_json);
  for (const source of [metric, raw]) {
    for (const key of keys) {
      const cents = toActivityCents(firstDeepValue(source, [key], 3), key);
      if (cents !== null) return cents;
    }
  }
  return null;
}

function pickActivityNumber(activity: TemuActivityRow, directValue: unknown, keys: string[]) {
  const direct = firstNumberValue(directValue);
  if (direct !== null) return direct;
  const metric = parseCloudJsonObject(activity.metric_json);
  const raw = parseCloudJsonObject(activity.raw_json);
  for (const source of [metric, raw]) {
    const value = firstDeepValue(source, keys, 3);
    const number = firstNumberValue(value);
    if (number !== null) return number;
  }
  return null;
}

function formatActivityMoney(cents: number | null, currency?: string | null) {
  if (cents === null || cents === undefined) return "-";
  return `${(Number(cents) / 100).toFixed(2)} ${currency || "CNY"}`;
}

function formatActivityMoneyCompact(cents: number | null, currency?: string | null) {
  if (cents === null || cents === undefined) return "-";
  const amount = (Number(cents) / 100).toFixed(2);
  return !currency || currency === "CNY" ? amount : `${amount} ${currency}`;
}

function activitySourcePath(activity: TemuActivityRow) {
  const sources = parseCloudJsonObject(activity.sources_json);
  return Object.keys(sources || {})[0] || "";
}

function inferredActivityTitle(activity: TemuActivityRow, raw: Record<string, any>) {
  const sourcePath = activitySourcePath(activity);
  const rawGoodsName = String(firstDeepValue(raw, ["goodsName", "productName"], 1) || "");
  const currentTitle = String(activity.activity_title || "").trim();
  if (/\/api\/activity\/data\/goods\/detail/i.test(sourcePath) && (!currentTitle || currentTitle === rawGoodsName)) {
    return "活动商品数据";
  }
  if (/activity\/tool\/home\/picksGoods/i.test(sourcePath)) return currentTitle || "活动推荐商品";
  if (/activity\/list\/for\/home/i.test(sourcePath)) return currentTitle || "可报名活动";
  if (/biddingInvitation/i.test(sourcePath)) return currentTitle || "竞价活动";
  return currentTitle || activity.activity_id || activity.row_key || "-";
}

function inferredActivityType(activity: TemuActivityRow) {
  const sourcePath = activitySourcePath(activity);
  if (/\/api\/activity\/data\/goods\/detail/i.test(sourcePath)) return "活动数据";
  if (/activity\/tool\/home\/picksGoods/i.test(sourcePath)) return "活动推荐";
  if (/activity\/list\/for\/home/i.test(sourcePath)) return "活动报名";
  if (/coupon/i.test(sourcePath)) return "优惠券";
  if (/biddingInvitation/i.test(sourcePath)) return "竞价活动";
  return activity.activity_type || activityKindLabel(activity.activity_kind);
}

function activityKindLabel(kind?: string | null) {
  const text = String(kind || "").trim();
  const labels: Record<string, string> = {
    activity: "活动",
    bidding: "竞价",
    coupon: "优惠券",
    bsr: "BSR",
    marketing: "营销",
  };
  return labels[text] || text || "-";
}

function activityStatusColor(status?: string | null) {
  const text = String(status || "").toLowerCase();
  if (/reject|fail|cancel|disable|close|end|expired|驳回|失败|取消|结束/.test(text)) return "red";
  if (/pass|success|approved|active|online|running|available|通过|成功|进行|生效/.test(text)) return "green";
  if (/pending|wait|review|audit|待|审核/.test(text)) return "orange";
  return "default";
}

function businessStatusColor(status?: string | null) {
  const text = String(status || "").toLowerCase();
  if (/abnormal|cancel|close|fail|reject|timeout|取消|关闭|拒绝|失败|退回|异常|逾期|超时|驳回/.test(text)) return "red";
  if (/complete|done|finish|signed|success|完成|通过|签收|已发|已入库|成功/.test(text)) return "green";
  if (/audit|pending|processing|review|wait|待|处理中|审核|取件|发货|入库/.test(text)) return "orange";
  return "default";
}

function isPendingBusinessStatus(status?: string | null) {
  return /audit|pending|processing|review|wait|待|处理中|审核|取件|发货|入库/i.test(String(status || ""));
}

function activityDisplayInfo(activity: TemuActivityRow) {
  const metric = parseCloudJsonObject(activity.metric_json);
  const raw = parseCloudJsonObject(activity.raw_json);
  const currency = String(activity.price_currency || firstDeepValue(metric, ["priceCurrency", "currency", "currencyCode"], 2) || firstDeepValue(raw, ["priceCurrency", "currency", "currencyCode", "currencyType"], 3) || "CNY");
  const signupPrice = pickActivityCents(activity, activity.signup_price_cents, [
    "signupPriceCents", "signupPriceCent", "signupPrice",
    "enrollPriceCents", "enrollPriceCent", "enrollPrice",
    "applyPriceCents", "applyPriceCent", "applyPrice",
    "activityPriceCents", "activityPriceCent", "activityPrice",
    "campaignPriceCents", "campaignPriceCent", "campaignPrice",
    "promotionPriceCents", "promotionPriceCent", "promotionPrice",
    "salePriceCents", "salePriceCent", "salePrice",
    "supplierActivityPrice", "skuActivityPrice", "skcActivityPrice",
    "inputPrice", "declarePrice", "declaredPrice",
  ]);
  const suggestedPrice = pickActivityCents(activity, activity.suggested_price_cents, [
    "suggestedPriceCents", "suggestedPriceCent", "suggestedPrice",
    "suggestPriceCents", "suggestPriceCent", "suggestPrice",
    "recommendPriceCents", "recommendPriceCent", "recommendPrice",
    "recommendedPriceCents", "recommendedPriceCent", "recommendedPrice",
    "referencePriceCents", "referencePriceCent", "referencePrice",
    "advicePriceCents", "advicePriceCent", "advicePrice",
    "activitySuggestPrice", "suggestActivityPrice", "maxEnrollPrice", "maxPrice",
  ]);
  const stock = pickActivityNumber(activity, activity.activity_stock, [
    "activityStock", "enrollStock", "signupStock", "applyStock",
    "activityInventory", "promotionStock", "campaignStock", "saleStock",
    "stockNum", "stock", "inventoryNum", "inventory", "availableStock",
    "activityGoodsStock", "goodsStock", "quantity",
  ]);
  const explicitDiff = pickActivityCents(activity, activity.signup_price_diff_cents, [
    "signupPriceDiffCents", "signupPriceDiffCent", "signupPriceDiff",
    "priceDiffCents", "priceDiffCent", "priceDiff",
    "enrollPriceDiff", "applyPriceDiff", "declarePriceDiff",
  ]);
  const diff = explicitDiff ?? (signupPrice !== null && suggestedPrice !== null ? signupPrice - suggestedPrice : null);
  const activitySales = pickActivityNumber(activity, null, ["activitySales", "goodsSales", "saleCount", "sales"]);
  const transactionAmount = pickActivityNumber(activity, null, ["activityTransactionAmount", "transactionAmount", "payAmount", "gmv"]);
  const totalVisitors = pickActivityNumber(activity, null, ["totalVisitorsNum", "activityGoodsVisitorsNum", "visitorsNum"]);
  const clickVisitors = pickActivityNumber(activity, null, ["clickVisitorsNum", "clickVisitorNum"]);
  const payVisitors = pickActivityNumber(activity, null, ["payVisitorsNum", "payVisitorNum"]);
  const canEnrollSessionCount = pickActivityNumber(activity, null, ["canEnrollSessionCount"]);
  const stockThreshold = pickActivityNumber(activity, null, ["stockThreshold"]);
  const discountThreshold = pickActivityNumber(activity, null, ["discountThreshold"]);
  const activityStarLevel = pickActivityNumber(activity, null, ["activityStarLevel"]);
  return {
    title: inferredActivityTitle(activity, raw),
    type: inferredActivityType(activity),
    kind: activityKindLabel(activity.activity_kind),
    status: activity.activity_status || "-",
    signupPrice,
    suggestedPrice,
    currency,
    stock,
    diff,
    activitySales,
    transactionAmount,
    totalVisitors,
    clickVisitors,
    payVisitors,
    canEnrollSessionCount,
    stockThreshold,
    discountThreshold,
    activityStarLevel,
    startText: formatTimestamp(activity.start_at),
    endText: formatTimestamp(activity.end_at),
    updatedText: formatTimestamp(activity.last_updated_at),
  };
}

function activityTimeText(activity: TemuActivityRow) {
  const info = activityDisplayInfo(activity);
  const start = info.startText;
  const end = info.endText;
  if (start && end) return `${start} - ${end}`;
  return start || end || activityRawTimeText(activity);
}

function activityUsefulnessScore(activity: TemuActivityRow) {
  const info = activityDisplayInfo(activity);
  const sourcePath = activitySourcePath(activity);
  const statusText = String(info.status || "").toLowerCase();
  let score = 0;
  if (/marketing\/enroll\/scroll\/match/i.test(sourcePath)) score += 160;
  if (activity.skc_id) score += 80;
  if (activity.product_id) score += 60;
  if (activity.goods_id) score += 30;
  if (/available|active|running|pass|success|can|可报名|通过|进行|成功/i.test(statusText)) score += 70;
  if (/pending|wait|review|audit|待|审核/i.test(statusText)) score += 30;
  if (info.signupPrice !== null) score += 35;
  if (info.suggestedPrice !== null) score += 25;
  if (info.stock !== null) score += 30;
  if (info.diff !== null) score += 25;
  if (info.canEnrollSessionCount !== null) score += 20;
  if (info.activitySales !== null || info.transactionAmount !== null || info.totalVisitors !== null) score += 20;
  return score;
}

function parseActivityTimeMs(value?: number | string | null) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  const numeric = typeof value === "number" ? value : (/^\d+$/.test(raw) ? Number(raw) : NaN);
  const parsed = Number.isFinite(numeric) ? numeric : Date.parse(raw.replace(/\//g, "-"));
  const ms = parsed > 0 && parsed < 10_000_000_000 ? parsed * 1000 : parsed;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

const ACTIVITY_TIME_START_KEYS = [
  "sessionStartTime", "startTime", "beginTime", "activityStartTime", "validStartTime",
  "effectiveStartTime", "startAt", "start_at",
];
const ACTIVITY_TIME_END_KEYS = [
  "sessionEndTime", "endTime", "finishTime", "activityEndTime", "validEndTime",
  "effectiveEndTime", "endAt", "end_at",
];
const ACTIVITY_STATUS_TEXT_KEYS = [
  "statusName", "sessionStatusName", "activityStatusName", "enrollStatusName",
  "statusText", "activityStatusText", "stateName", "stageName", "statusDesc",
  "activityStatusDesc", "enrollStatusDesc", "status", "activityStatus", "enrollStatus",
  "auditStatus", "state", "stage", "orderStatus",
];
const ACTIVITY_SESSION_LIST_KEYS = [
  "assignSessionList", "sessionList", "sessionAggList", "siteSessionList", "activitySessionList",
  "enrollSessionList", "sessionInfoList", "siteActivityList", "enrollSiteList", "activitySiteList",
  "siteList", "sites", "marketList", "countryList",
];
const ACTIVITY_SKC_ID_KEYS = ["productSkcId", "skcId", "skc_id", "goodsSkcId"];
const ACTIVITY_PRODUCT_ID_KEYS = ["productId", "productSpuId", "spuId", "spu_id"];
const ACTIVITY_GOODS_ID_KEYS = ["goodsId", "goods_id"];

function pickActivityDeepValue(activity: TemuActivityRow, keys: string[], maxDepth = 5) {
  const raw = parseCloudJsonObject(activity.raw_json);
  const metric = parseCloudJsonObject(activity.metric_json);
  return firstDeepValue(raw, keys, maxDepth) ?? firstDeepValue(metric, keys, maxDepth);
}

function normalizeActivityStatusText(value: unknown) {
  const text = normalizeText(value);
  if (!text || text === "-") return "";
  if (/^(true|false)$/i.test(text)) return "";
  if (/^-?\d+(\.\d+)?$/.test(text)) return "";
  return text;
}

function activityRawStartValue(activity: TemuActivityRow) {
  return activity.start_at || pickActivityDeepValue(activity, ACTIVITY_TIME_START_KEYS, 6) as any;
}

function activityRawEndValue(activity: TemuActivityRow) {
  return activity.end_at || pickActivityDeepValue(activity, ACTIVITY_TIME_END_KEYS, 6) as any;
}

function activityRawTimeText(activity: TemuActivityRow) {
  const start = formatTimestamp(activityRawStartValue(activity));
  const end = formatTimestamp(activityRawEndValue(activity));
  if (start && end) return `${start}-${end}`;
  return start || end || "";
}

function activitySnapshotStatusText(activity: TemuActivityRow) {
  return normalizeActivityStatusText(activity.activity_status)
    || normalizeActivityStatusText(pickActivityDeepValue(activity, ACTIVITY_STATUS_TEXT_KEYS, 6));
}

function activityLifecycleStatusText(activity: TemuActivityRow) {
  const lifecycle = activityLifecycle(activity);
  if (lifecycle === "running") return "进行中";
  if (lifecycle === "notStarted") return "未开始";
  return "";
}

function activityLifecycle(activity: TemuActivityRow): "running" | "notStarted" | "other" {
  const info = activityDisplayInfo(activity);
  const statusText = `${info.status || ""} ${activity.activity_status || ""} ${activitySnapshotStatusText(activity)}`.toLowerCase();
  if (/未开始|待开始|可报名|not\s*start|upcoming/.test(statusText)) return "notStarted";
  if (/进行|running|active|生效/.test(statusText)) return "running";
  const startMs = parseActivityTimeMs(activityRawStartValue(activity));
  const endMs = parseActivityTimeMs(activityRawEndValue(activity));
  const now = Date.now();
  if (startMs && startMs > now) return "notStarted";
  if (startMs && startMs <= now && (!endMs || endMs >= now)) return "running";
  return "other";
}

function activityDerivedStatusText(activity: TemuActivityRow) {
  const info = activityDisplayInfo(activity);
  const displayStatus = normalizeActivityStatusText(info.status);
  if (displayStatus) return displayStatus;
  const snapshotStatus = activitySnapshotStatusText(activity);
  if (snapshotStatus) return snapshotStatus;
  const lifecycleText = activityLifecycleStatusText(activity);
  if (lifecycleText) return lifecycleText;
  return "-";
}

function parseDisplayPriceCents(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : parseFloat(String(value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  if (Math.abs(numeric) >= 1000 && Number.isInteger(numeric)) return Math.round(numeric);
  return Math.round(numeric * 100);
}

function stringifyActivitySpecValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "object") return normalizeText(value);
  if (Array.isArray(value)) {
    return value.map(stringifyActivitySpecValue).filter(Boolean).join(" / ");
  }
  const record = value as Record<string, any>;
  const direct = normalizeText(firstDeepValue(record, ["specText", "skuAttr", "skuAttrText", "skuAttribute", "skuName", "className", "attrName"], 1));
  if (direct) return direct;
  const label = normalizeText(firstDeepValue(record, ["parentSpecName", "specKey", "key", "name", "label"], 1));
  const text = normalizeText(firstDeepValue(record, ["specName", "unitSpecName", "value", "text", "title"], 1));
  if (label && text) return `${label}: ${text}`;
  return text || label;
}

function activitySignupTimeText(activity: TemuActivityRow) {
  const metric = parseCloudJsonObject(activity.metric_json);
  const raw = parseCloudJsonObject(activity.raw_json);
  const value = firstDeepValue(
    raw,
    ["enrollTime", "signupTime", "signUpTime", "applyTime", "submitTime", "reportTime", "createTime", "createdAt", "gmtCreate"],
    4,
  ) ?? firstDeepValue(metric, ["enrollTime", "signupTime", "applyTime", "submitTime", "reportTime"], 3);
  return formatTimestamp(value as any) || activityDisplayInfo(activity).updatedText || "-";
}

function activitySessionTexts(activity: TemuActivityRow) {
  const metric = parseCloudJsonObject(activity.metric_json);
  const raw = parseCloudJsonObject(activity.raw_json);
  const fallbackRange = activityTimeText(activity);
  const fallbackStatus = activitySnapshotStatusText(activity) || activityLifecycleStatusText(activity);
  const rows = [raw, metric]
    .flatMap((source) => {
      const value = firstDeepValue(source, ACTIVITY_SESSION_LIST_KEYS, 6);
      return Array.isArray(value) ? value : [];
    })
    .filter((row, index, arr) => arr.findIndex((item) => JSON.stringify(item) === JSON.stringify(row)) === index);

  if (rows.length === 0) {
    const site = normalizeText(activity.site || pickActivityDeepValue(activity, ["siteName", "site", "regionName", "countryName", "marketName"], 5));
    const text = [site, fallbackRange, fallbackStatus].filter(Boolean).join(",");
    return text ? [text] : [];
  }

  return rows.map((row: any) => {
    const site = normalizeText(firstDeepValue(row, ["siteName", "sessionName", "site", "regionName", "countryName", "marketName", "name"], 2));
    const start = formatTimestamp(firstDeepValue(row, ACTIVITY_TIME_START_KEYS, 3) as any);
    const end = formatTimestamp(firstDeepValue(row, ACTIVITY_TIME_END_KEYS, 3) as any);
    const status = normalizeActivityStatusText(firstDeepValue(row, ACTIVITY_STATUS_TEXT_KEYS, 3)) || fallbackStatus;
    const range = (start && end ? `${start}-${end}` : start || end) || fallbackRange;
    return [site, range, status].filter(Boolean).join(",");
  }).filter(Boolean);
}

const ACTIVITY_SKU_ID_KEYS = ["productSkuId", "prodSkuId", "skuId", "sku_id"];
const ACTIVITY_SKU_EXT_KEYS = ["skuExtCode", "skuCode", "extCode", "externalSkuCode", "skuNo"];
const ACTIVITY_SKU_ATTR_KEYS = [
  "skuAttrText", "skuAttributeText", "skuPropertyText", "skuPropText",
  "skuName", "className", "specText", "specName",
  "productSkuSpecList", "skuSpecList", "skuAttrList", "skuAttrs",
  "skuProperties", "skuPropertyList",
];
const ACTIVITY_SKU_DAILY_PRICE_KEYS = [
  "dailyDeclarePriceCents", "dailyDeclarePriceCent", "dailyDeclarePrice",
  "normalDeclarePriceCents", "normalDeclarePriceCent", "normalDeclarePrice",
  "dailyPriceCents", "dailyPriceCent", "dailyPrice",
  "normalPriceCents", "normalPriceCent", "normalPrice",
  "basePriceCents", "basePriceCent", "basePrice",
  "supplierPriceCents", "supplierPriceCent", "supplierPrice",
  "declaredPriceCents", "declaredPriceCent", "declaredPrice",
  "declarePriceCents", "declarePriceCent", "declarePrice",
  "skuSupplierPrice", "skuDeclaredPrice",
];
const ACTIVITY_SKU_ACTIVITY_PRICE_KEYS = [
  "signupPriceCents", "signupPriceCent", "signupPrice",
  "enrollPriceCents", "enrollPriceCent", "enrollPrice",
  "applyPriceCents", "applyPriceCent", "applyPrice",
  "activityPriceCents", "activityPriceCent", "activityPrice",
  "campaignPriceCents", "campaignPriceCent", "campaignPrice",
  "promotionPriceCents", "promotionPriceCent", "promotionPrice",
  "salePriceCents", "salePriceCent", "salePrice",
  "supplierActivityPrice", "skuActivityPrice", "skcActivityPrice",
  "inputPrice",
];
const ACTIVITY_SKU_SUGGESTED_PRICE_KEYS = [
  "suggestedPriceCents", "suggestedPriceCent", "suggestedPrice",
  "suggestPriceCents", "suggestPriceCent", "suggestPrice",
  "recommendPriceCents", "recommendPriceCent", "recommendPrice",
  "recommendedPriceCents", "recommendedPriceCent", "recommendedPrice",
  "referencePriceCents", "referencePriceCent", "referencePrice",
  "advicePriceCents", "advicePriceCent", "advicePrice",
  "activitySuggestPrice", "suggestActivityPrice", "maxEnrollPrice", "maxPrice",
];
const ACTIVITY_SKU_STOCK_KEYS = [
  "activityStock", "activityStockNum", "submitQuantity", "submitQty", "reportQuantity",
  "reportedQuantity", "signupQuantity", "applyQuantity", "enrollQuantity", "enrollStock",
  "signupStock", "applyStock", "targetActivityStock", "activityStockQuantity", "stockQuantity",
  "enrollStockNum", "applyStockNum", "reportStock", "reportedStock", "inputStock",
  "skuActivityStock", "activityInventory", "promotionStock", "campaignStock", "saleStock",
  "stockNum", "stock", "inventoryNum", "inventory", "availableStock", "activityGoodsStock",
  "goodsStock", "quantity",
];
const ACTIVITY_SKU_REMAINING_STOCK_KEYS = [
  "remainingActivityStock", "remainActivityStock", "remainingActivityStockNum",
  "activityRemainStock", "activityRemainingStock", "leftActivityStock", "surplusActivityStock",
  "availableActivityStock", "remainingQuantity", "remainQuantity", "leftQuantity", "surplusQuantity",
  "availableQuantity", "remainingStock", "remainStock", "leftStock", "surplusStock", "canEnrollStock",
  "restStock", "remainNum", "leftNum", "surplusNum",
];

function isPlainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pickActivitySkuCentsFromSource(source: unknown, keys: string[], maxDepth = 2) {
  if (!source || typeof source !== "object") return null;
  for (const key of keys) {
    const cents = toActivityCents(firstDeepValue(source, [key], maxDepth), key);
    if (cents !== null) return cents;
  }
  return null;
}

function pickActivitySkuNumberFromSource(source: unknown, keys: string[], maxDepth = 2) {
  if (!source || typeof source !== "object") return null;
  const value = firstDeepValue(source, keys, maxDepth);
  return firstNumberValue(value);
}

function activitySkuRecordHasSignal(source: unknown) {
  if (!source || typeof source !== "object") return false;
  if (firstDeepValue(source, ACTIVITY_SKU_ID_KEYS, 1)) return true;
  if (firstDeepValue(source, ACTIVITY_SKU_EXT_KEYS, 1)) return true;
  if (firstDeepValue(source, ACTIVITY_SKU_ATTR_KEYS, 2)) return true;
  if (pickActivitySkuCentsFromSource(source, ACTIVITY_SKU_ACTIVITY_PRICE_KEYS) !== null) return true;
  if (pickActivitySkuCentsFromSource(source, ACTIVITY_SKU_DAILY_PRICE_KEYS) !== null) return true;
  if (pickActivitySkuNumberFromSource(source, ACTIVITY_SKU_STOCK_KEYS) !== null) return true;
  if (pickActivitySkuNumberFromSource(source, ACTIVITY_SKU_REMAINING_STOCK_KEYS) !== null) return true;
  return false;
}

function activityCandidateContext(source: Record<string, any>, parentContext: Record<string, any>) {
  const next = { ...parentContext };
  const sourceSkcId = normalizeText(firstDeepValue(source, ACTIVITY_SKC_ID_KEYS, 1));
  const sourceProductId = normalizeText(firstDeepValue(source, ACTIVITY_PRODUCT_ID_KEYS, 1));
  const sourceGoodsId = normalizeText(firstDeepValue(source, ACTIVITY_GOODS_ID_KEYS, 1));
  const sourceStock = pickActivitySkuNumberFromSource(source, ACTIVITY_SKU_STOCK_KEYS, 1);
  const sourceRemaining = pickActivitySkuNumberFromSource(source, ACTIVITY_SKU_REMAINING_STOCK_KEYS, 1);
  if (sourceSkcId) next.__activitySkcId = sourceSkcId;
  if (sourceProductId) next.__activityProductId = sourceProductId;
  if (sourceGoodsId) next.__activityGoodsId = sourceGoodsId;
  if (sourceStock !== null) next.__activityStock = sourceStock;
  if (sourceRemaining !== null) next.__activityRemainingStock = sourceRemaining;
  return next;
}

function hasNestedActivitySkuCandidate(source: Record<string, any>, depth = 0): boolean {
  if (depth > 3) return false;
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      if (!/sku|skc|goods|product|activity|enroll|price|session|list|items|vos?/i.test(key)) continue;
      for (const item of value) {
        if (!isPlainRecord(item)) continue;
        if (activitySkuRecordHasSignal(item) || hasNestedActivitySkuCandidate(item, depth + 1)) return true;
      }
      continue;
    }
    if (isPlainRecord(value) && /sku|skc|goods|product|activity|enroll|price|session|detail|info|vo/i.test(key)) {
      if (activitySkuRecordHasSignal(value) || hasNestedActivitySkuCandidate(value, depth + 1)) return true;
    }
  }
  return false;
}

function collectActivitySkuCandidates(source: unknown, out: Record<string, any>[], depth = 0, parentContext: Record<string, any> = {}) {
  if (!isPlainRecord(source) || depth > 5) return;
  const context = activityCandidateContext(source, parentContext);
  if (activitySkuRecordHasSignal(source) && !hasNestedActivitySkuCandidate(source)) {
    out.push(Object.keys(context).length > 0 ? { ...context, ...source } : source);
  }
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      const shouldScanArray = /sku|skc|goods|product|activity|enroll|price|session|list|items|vos?/i.test(key)
        || value.some(activitySkuRecordHasSignal);
      if (!shouldScanArray) continue;
      for (const item of value) collectActivitySkuCandidates(item, out, depth + 1, context);
      continue;
    }
    if (isPlainRecord(value) && /sku|skc|goods|product|activity|enroll|price|session|detail|info|vo/i.test(key)) {
      collectActivitySkuCandidates(value, out, depth + 1, context);
    }
  }
}

function findProductSkuSummary(product: ProductItem | null | undefined, skuId: string, skuExtCode: string, skuAttr: string) {
  const rows = Array.isArray(product?.skuSummaries) ? product!.skuSummaries : [];
  const normSkuId = normalizeLookupValue(skuId);
  const normExt = normalizeLookupValue(skuExtCode);
  const normAttr = normalizeLookupValue(skuAttr);
  return rows.find((row) => {
    const rowSkuId = normalizeLookupValue(row.productSkuId);
    const rowExt = normalizeLookupValue(row.extCode);
    const rowAttr = normalizeLookupValue(row.specText || row.specName);
    return Boolean(
      (normSkuId && rowSkuId === normSkuId)
      || (normExt && rowExt === normExt)
      || (normAttr && rowAttr === normAttr)
    );
  }) || null;
}

function activitySkuCandidateAttr(source: unknown, activity: TemuActivityRow, product?: ProductItem | null) {
  const sourceAttr = stringifyActivitySpecValue(firstDeepValue(source, ACTIVITY_SKU_ATTR_KEYS, 2));
  if (sourceAttr) return sourceAttr;
  if (activity.sku_attr_text) return activity.sku_attr_text;
  const sourceSkuId = normalizeText(firstDeepValue(source, ACTIVITY_SKU_ID_KEYS, 1) || activity.sku_id);
  const sourceSkuExt = normalizeText(firstDeepValue(source, ACTIVITY_SKU_EXT_KEYS, 1) || activity.sku_ext_code);
  const match = findProductSkuSummary(product, sourceSkuId, sourceSkuExt, "");
  if (match?.specText || match?.specName) return match.specText || match.specName;
  if (product?.skuSummaries?.length === 1) return product.skuSummaries[0].specText || product.skuSummaries[0].specName;
  return "-";
}

function buildActivitySkuPriceRow(activity: TemuActivityRow, source: Record<string, any>, index: number, product?: ProductItem | null): ActivitySkuPriceRow {
  const info = activityDisplayInfo(activity);
  const sourceSkcId = normalizeText(source.__activitySkcId || firstDeepValue(source, ACTIVITY_SKC_ID_KEYS, 1) || activity.skc_id);
  const skuId = normalizeText(firstDeepValue(source, ACTIVITY_SKU_ID_KEYS, 1) || activity.sku_id);
  const skuExtCode = normalizeText(firstDeepValue(source, ACTIVITY_SKU_EXT_KEYS, 1) || activity.sku_ext_code);
  const skuAttr = activitySkuCandidateAttr(source, activity, product);
  const matchedSku = findProductSkuSummary(product, skuId, skuExtCode, skuAttr);
  const productPriceFallback = matchedSku || product?.skuSummaries?.length === 1 ? parseDisplayPriceCents(product?.price) : null;
  const dailyPriceCents = pickActivitySkuCentsFromSource(source, ACTIVITY_SKU_DAILY_PRICE_KEYS)
    ?? firstNumberValue(activity.daily_price_cents)
    ?? productPriceFallback;
  const suggestedPriceCents = pickActivitySkuCentsFromSource(source, ACTIVITY_SKU_SUGGESTED_PRICE_KEYS)
    ?? info.suggestedPrice;
  const activityPriceCents = (
    pickActivitySkuCentsFromSource(source, ACTIVITY_SKU_ACTIVITY_PRICE_KEYS)
  );
  const priceDiffCents = pickActivitySkuCentsFromSource(source, [
    "signupPriceDiffCents", "signupPriceDiffCent", "signupPriceDiff",
    "priceDiffCents", "priceDiffCent", "priceDiff",
    "enrollPriceDiff", "applyPriceDiff", "declarePriceDiff",
  ]) ?? (activityPriceCents !== null && suggestedPriceCents !== null ? activityPriceCents - suggestedPriceCents : info.diff);
  const reportedQty = pickActivitySkuNumberFromSource(source, ACTIVITY_SKU_STOCK_KEYS, 6)
    ?? firstNumberValue(source.__activityStock)
    ?? firstNumberValue(activity.activity_stock);
  const remainingQty = pickActivitySkuNumberFromSource(source, ACTIVITY_SKU_REMAINING_STOCK_KEYS, 6)
    ?? firstNumberValue(source.__activityRemainingStock);
  const signupTime = formatTimestamp(firstDeepValue(source, [
    "enrollTime", "signupTime", "signUpTime", "applyTime", "submitTime", "reportTime", "createTime", "createdAt", "gmtCreate",
  ], 2) as any) || activitySignupTimeText(activity);
  const sourceScore = [
    skuId,
    skuExtCode,
    skuAttr && skuAttr !== "-" ? skuAttr : "",
    dailyPriceCents,
    activityPriceCents,
    suggestedPriceCents,
    reportedQty,
    remainingQty,
  ].filter((value) => value !== null && value !== undefined && value !== "").length;
  return {
    id: [
      activity.id || activity.row_key,
      skuId || skuExtCode || skuAttr || "sku",
      activityPriceCents ?? "",
      dailyPriceCents ?? "",
      index,
    ].join("|"),
    activity,
    sourceSkcId,
    skuId,
    skuExtCode,
    skuAttr,
    dailyPriceCents,
    activityPriceCents,
    suggestedPriceCents,
    priceDiffCents,
    currency: info.currency,
    reportedQty,
    remainingQty,
    signupTimeText: signupTime,
    sourceScore,
  };
}

function activitySkuRowKey(row: ActivitySkuPriceRow) {
  return [
    row.activity.activity_id || row.activity.row_key,
    row.activity.product_id || "",
    row.sourceSkcId || row.activity.skc_id || "",
    row.skuId || "",
    row.skuExtCode || "",
    row.skuAttr || "",
  ].join("|");
}

function activitySkuRowIdentity(row: ActivitySkuPriceRow) {
  return normalizeLookupValue(row.activity.activity_id || row.activity.row_key || row.activity.id || "");
}

function usefulSkuAttr(value?: string | null) {
  const text = normalizeLookupValue(value || "");
  return text && text !== "-" ? text : "";
}

function activitySkuRowsEquivalent(left: ActivitySkuPriceRow, right: ActivitySkuPriceRow) {
  const leftIdentity = activitySkuRowIdentity(left);
  const rightIdentity = activitySkuRowIdentity(right);
  if (leftIdentity && rightIdentity && leftIdentity !== rightIdentity) return false;

  const leftProduct = normalizeLookupValue(left.activity.product_id || "");
  const rightProduct = normalizeLookupValue(right.activity.product_id || "");
  if (leftProduct && rightProduct && leftProduct !== rightProduct) return false;

  const leftSkc = normalizeLookupValue(left.activity.skc_id || "");
  const rightSkc = normalizeLookupValue(right.activity.skc_id || "");
  if (leftSkc && rightSkc && leftSkc !== rightSkc) return false;
  const leftSourceSkc = normalizeLookupValue(left.sourceSkcId || "");
  const rightSourceSkc = normalizeLookupValue(right.sourceSkcId || "");
  if (leftSourceSkc && rightSourceSkc && leftSourceSkc !== rightSourceSkc) return false;

  const leftSkuId = normalizeLookupValue(left.skuId);
  const rightSkuId = normalizeLookupValue(right.skuId);
  if (leftSkuId && rightSkuId) return leftSkuId === rightSkuId;

  const leftExt = normalizeLookupValue(left.skuExtCode);
  const rightExt = normalizeLookupValue(right.skuExtCode);
  if (leftExt && rightExt) return leftExt === rightExt;

  const leftAttr = usefulSkuAttr(left.skuAttr);
  const rightAttr = usefulSkuAttr(right.skuAttr);
  return Boolean(leftAttr && rightAttr && leftAttr === rightAttr);
}

function activitySkuRowQuality(row: ActivitySkuPriceRow) {
  return row.sourceScore
    + (row.sourceSkcId ? 6 : 0)
    + (row.activityPriceCents !== null ? 12 : 0)
    + (row.skuId ? 5 : 0)
    + (row.skuExtCode ? 3 : 0)
    + (row.skuAttr && row.skuAttr !== "-" ? 2 : 0)
    + (row.reportedQty !== null ? 2 : 0)
    + (row.remainingQty !== null ? 2 : 0);
}

function mergeActivitySkuRows(left: ActivitySkuPriceRow, right: ActivitySkuPriceRow): ActivitySkuPriceRow {
  const primary = activitySkuRowQuality(right) >= activitySkuRowQuality(left) ? right : left;
  const secondary = primary === right ? left : right;
  const merged = {
    ...primary,
    sourceSkcId: primary.sourceSkcId || secondary.sourceSkcId,
    skuId: primary.skuId || secondary.skuId,
    skuExtCode: primary.skuExtCode || secondary.skuExtCode,
    skuAttr: primary.skuAttr && primary.skuAttr !== "-" ? primary.skuAttr : secondary.skuAttr,
    dailyPriceCents: primary.dailyPriceCents ?? secondary.dailyPriceCents,
    activityPriceCents: primary.activityPriceCents ?? secondary.activityPriceCents,
    suggestedPriceCents: primary.suggestedPriceCents ?? secondary.suggestedPriceCents,
    priceDiffCents: primary.priceDiffCents ?? secondary.priceDiffCents,
    reportedQty: primary.reportedQty ?? secondary.reportedQty,
    remainingQty: primary.remainingQty ?? secondary.remainingQty,
    signupTimeText: primary.signupTimeText && primary.signupTimeText !== "-" ? primary.signupTimeText : secondary.signupTimeText,
    sourceScore: Math.max(primary.sourceScore, secondary.sourceScore),
  };
  return {
    ...merged,
    id: activitySkuRowKey(merged),
  };
}

function activitySkuRowHasUsefulValue(row: ActivitySkuPriceRow) {
  if (row.activityPriceCents === null) return false;
  return activitySkuRowHasCandidateSignal(row);
}

function activitySkuRowHasCandidateSignal(row: ActivitySkuPriceRow) {
  return Boolean(
    row.skuId
    || row.skuExtCode
    || (row.skuAttr && row.skuAttr !== "-")
    || row.activityPriceCents !== null
    || row.suggestedPriceCents !== null
    || row.dailyPriceCents !== null
    || row.reportedQty !== null
    || row.remainingQty !== null
  );
}

function activitySkuRowBelongsToProduct(row: ActivitySkuPriceRow, product?: ProductItem | null) {
  if (!product) return true;
  const productSkcId = normalizeLookupValue(product.skcId || "");
  const rowSkcId = normalizeLookupValue(row.sourceSkcId || row.activity.skc_id || "");
  if (productSkcId && rowSkcId && productSkcId !== rowSkcId) return false;
  const hasSkuSignal = Boolean(row.skuId || row.skuExtCode || usefulSkuAttr(row.skuAttr));
  if (!hasSkuSignal) return true;
  const skuSummaries = Array.isArray(product.skuSummaries) ? product.skuSummaries : [];
  if (skuSummaries.length === 0) return true;
  return Boolean(findProductSkuSummary(product, row.skuId, row.skuExtCode, row.skuAttr));
}

function activityRowDisplayPriceCents(row: ActivitySkuPriceRow) {
  return row.activityPriceCents;
}

function activityRowRemainingValue(row: ActivitySkuPriceRow) {
  if (row.remainingQty !== null) return row.remainingQty;
  const raw = parseCloudJsonObject(row.activity.raw_json);
  const metric = parseCloudJsonObject(row.activity.metric_json);
  return pickActivitySkuNumberFromSource(raw, ACTIVITY_SKU_REMAINING_STOCK_KEYS, 6)
    ?? pickActivitySkuNumberFromSource(metric, ACTIVITY_SKU_REMAINING_STOCK_KEYS, 6);
}

function activityRowStockValue(row: ActivitySkuPriceRow) {
  if (row.reportedQty !== null) return row.reportedQty;
  const raw = parseCloudJsonObject(row.activity.raw_json);
  const metric = parseCloudJsonObject(row.activity.metric_json);
  return pickActivitySkuNumberFromSource(raw, ACTIVITY_SKU_STOCK_KEYS, 6)
    ?? pickActivitySkuNumberFromSource(metric, ACTIVITY_SKU_STOCK_KEYS, 6)
    ?? activityDisplayInfo(row.activity).stock
    ?? activityRowRemainingValue(row);
}

function activityTableNameText(activity: TemuActivityRow) {
  const title = normalizeText(activity.activity_title);
  if (title) return title;
  const info = activityDisplayInfo(activity);
  return info.title && info.title !== "-" ? info.title : info.type;
}

function extractActivitySkuRows(activity: TemuActivityRow, product: ProductItem | null | undefined, requireActivityPrice: boolean): ActivitySkuPriceRow[] {
  const raw = parseCloudJsonObject(activity.raw_json);
  const metric = parseCloudJsonObject(activity.metric_json);
  const direct = {
    productSkuId: activity.sku_id || (metric as any).skuId || (raw as any).productSkuId,
    skuExtCode: activity.sku_ext_code || (metric as any).skuExtCode || (raw as any).skuExtCode,
    skuAttrText: activity.sku_attr_text || (metric as any).skuAttrText || (raw as any).skuAttrText,
    dailyPriceCents: activity.daily_price_cents ?? (metric as any).dailyPriceCents,
    suggestedPriceCents: activity.suggested_price_cents ?? (metric as any).suggestedPriceCents,
    activityStock: activity.activity_stock
      ?? pickActivitySkuNumberFromSource(raw, ACTIVITY_SKU_STOCK_KEYS, 6)
      ?? pickActivitySkuNumberFromSource(metric, ACTIVITY_SKU_STOCK_KEYS, 6),
    remainingActivityStock: pickActivitySkuNumberFromSource(raw, ACTIVITY_SKU_REMAINING_STOCK_KEYS, 6)
      ?? pickActivitySkuNumberFromSource(metric, ACTIVITY_SKU_REMAINING_STOCK_KEYS, 6),
  };
  const candidates: Record<string, any>[] = [];
  const hasNestedSkuRows = (isPlainRecord(raw) && hasNestedActivitySkuCandidate(raw))
    || (isPlainRecord(metric) && hasNestedActivitySkuCandidate(metric));
  if (!hasNestedSkuRows) candidates.push(direct);
  collectActivitySkuCandidates(raw, candidates);
  collectActivitySkuCandidates(metric, candidates);
  const rows: ActivitySkuPriceRow[] = [];
  candidates.forEach((source, index) => {
    const row = buildActivitySkuPriceRow(activity, source, index, product);
    if (requireActivityPrice ? !activitySkuRowHasUsefulValue(row) : !activitySkuRowHasCandidateSignal(row)) return;
    if (!activitySkuRowBelongsToProduct(row, product)) return;
    const existingIndex = rows.findIndex((existing) => activitySkuRowsEquivalent(existing, row));
    if (existingIndex >= 0) {
      rows[existingIndex] = mergeActivitySkuRows(rows[existingIndex], row);
      return;
    }
    rows.push(row);
  });
  return rows;
}

function extractActivitySkuPriceRows(activity: TemuActivityRow, product?: ProductItem | null): ActivitySkuPriceRow[] {
  return extractActivitySkuRows(activity, product, true);
}

function extractActivitySkuCandidateRows(activity: TemuActivityRow, product?: ProductItem | null): ActivitySkuPriceRow[] {
  return extractActivitySkuRows(activity, product, false);
}

function filterActivitySkuPriceRows(rows: ActivitySkuPriceRow[], filter: ActivityDetailFilter) {
  return [...rows]
    .filter((row) => {
      const lifecycle = activityLifecycle(row.activity);
      if (filter === "running") return lifecycle === "running";
      if (filter === "notStarted") return lifecycle === "notStarted";
      return true;
    })
    .sort((left, right) => {
      const activityScore = activityUsefulnessScore(right.activity) - activityUsefulnessScore(left.activity);
      if (activityScore !== 0) return activityScore;
      const priceScore = Number(activityRowDisplayPriceCents(right) !== null) - Number(activityRowDisplayPriceCents(left) !== null);
      if (priceScore !== 0) return priceScore;
      return `${left.skuAttr}${left.skuId}`.localeCompare(`${right.skuAttr}${right.skuId}`, "zh-Hans-CN");
    });
}

function skuActivityRowMatches(row: ActivitySkuPriceRow, sku: { skuId?: unknown; skuExtCode?: unknown; skuSpec?: unknown }) {
  const rowSkuId = normalizeLookupValue(row.skuId || "");
  const rowExtCode = normalizeLookupValue(row.skuExtCode || "");
  const rowAttr = normalizeLookupValue(row.skuAttr || "");
  const skuId = normalizeLookupValue(String(sku.skuId || ""));
  const extCode = normalizeLookupValue(String(sku.skuExtCode || ""));
  const skuSpec = normalizeLookupValue(String(sku.skuSpec || ""));
  return Boolean(
    (rowSkuId && skuId && rowSkuId === skuId)
    || (rowExtCode && extCode && rowExtCode === extCode)
    || (rowAttr && skuSpec && rowAttr === skuSpec)
  );
}

function pickSkuActivityRows(rows: ActivitySkuPriceRow[], sku: { skuId?: unknown; skuExtCode?: unknown; skuSpec?: unknown }, skuCount: number) {
  const matched = rows.filter((row) => skuActivityRowMatches(row, sku));
  if (matched.length > 0) return matched;
  if (skuCount === 1) return rows.filter((row) => !row.skuId && !row.skuExtCode && (!row.skuAttr || row.skuAttr === "-"));
  return [];
}

function hasMeaningfulSnapshotValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return true;
  const text = String(value).trim();
  return Boolean(text);
}

function buildLookupKeys(source: Partial<ProductItem>) {
  const titleKey = normalizeLookupValue(source.title || "");
  const idKeys = [
    source.skcId ? `skc:${source.skcId}` : "",
    source.goodsId ? `goods:${source.goodsId}` : "",
    source.spuId ? `spu:${source.spuId}` : "",
  ].filter(Boolean);

  if (idKeys.length > 0) return idKeys;
  return titleKey ? [`title:${titleKey}`] : [];
}

function getLatestSyncedAt(products: ProductItem[], diagnostics: CollectionDiagnostics | null) {
  if (diagnostics?.syncedAt) return diagnostics.syncedAt;
  for (const product of products) {
    if (product.syncedAt) return product.syncedAt;
  }
  return "";
}

function mergeTextValue(current: unknown, next: unknown) {
  const values = [current, next]
    .flatMap((value) => String(value ?? "").split(/\s*[,/|]\s*/))
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(values)).join(" / ");
}

function mergeAvailableSaleDays(current: unknown, next: unknown) {
  const currentNum = Number(current);
  const nextNum = Number(next);
  if (Number.isFinite(currentNum) && Number.isFinite(nextNum)) return Math.max(currentNum, nextNum);
  if (Number.isFinite(nextNum)) return nextNum;
  return normalizeText(next) || normalizeText(current);
}

function normalizeSkuSummaryList(value: unknown): ProductSkuSummary[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();

  return value
    .map((item: any) => {
      const specList: ProductSkuSpec[] = Array.isArray(item?.productSkuSpecList)
        ? item.productSkuSpecList.map((spec: any) => ({
            parentSpecName: normalizeText(spec?.parentSpecName),
            specName: normalizeText(spec?.specName),
            unitSpecName: normalizeText(spec?.unitSpecName),
          }))
        : [];

      const specText = normalizeText(item?.specText)
        || specList
          .map((spec) => {
            const label = spec.parentSpecName || "规格";
            const valueText = spec.specName || spec.unitSpecName;
            return valueText ? `${label}: ${valueText}` : "";
          })
          .filter(Boolean)
          .join(" / ");

      return {
        productSkuId: normalizeText(item?.productSkuId),
        thumbUrl: normalizeImageUrl(item?.thumbUrl),
        productSkuSpecList: specList,
        specText,
        specName: normalizeText(item?.specName || specList[0]?.specName),
        extCode: normalizeText(item?.extCode),
      };
    })
    .filter((item) => {
      const key = [item.productSkuId, item.extCode, item.specText].filter(Boolean).join("|");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildSearchIndex(product: ProductItem) {
  const skuTexts = product.skuSummaries.flatMap((sku) => [
    sku.productSkuId,
    sku.extCode,
    sku.specText,
    ...sku.productSkuSpecList.map((spec: ProductSkuSpec) => spec.specName),
  ]);
  const activityTexts = (product.cloudActivities || []).flatMap((activity) => [
    activity.activity_title,
    activity.activity_id,
    activity.activity_kind,
    activity.activity_type,
    activity.activity_status,
    activity.signup_price_cents,
    activity.suggested_price_cents,
    activity.activity_stock,
  ]);
  const riskTexts = (product.cloudRisks || []).flatMap((risk) => [
    risk.risk_type,
    risk.risk_key,
    risk.risk_title,
    risk.risk_status,
    risk.severity,
    risk.product_id,
    risk.goods_id,
    risk.order_id,
  ]);
  const stockOrderTexts = (product.cloudStockOrders || []).flatMap((row) => [
    row.stock_order_no,
    row.parent_order_no,
    row.delivery_order_sn,
    row.delivery_batch_sn,
    row.temu_status,
    row.receive_warehouse_name,
    row.sku_id,
    row.sku_ext_code,
  ]);
  const afterSaleTexts = (product.cloudAfterSales || []).flatMap((row) => [
    row.after_sale_type,
    row.package_no,
    row.order_id,
    row.status,
    row.reason,
    row.logistics_no,
    row.warehouse_name,
    row.sku_id,
  ]);

  return [
    product.title,
    product.skcId,
    product.goodsId,
    product.spuId,
    product.sku,
    product.extCode,
    product.productType,
    product.sourceType,
    product.removeStatus,
    product.skcSiteStatus,
    product.flowLimitStatus,
    product.siteLabel,
    product.category,
    product.categories,
    product.skuId,
    product.skuName,
    product.hotTag,
    product.buyerName,
    product.buyerUid,
    ...skuTexts,
    ...activityTexts,
    ...riskTexts,
    ...stockOrderTexts,
    ...afterSaleTexts,
  ]
    .map((item) => normalizeLookupValue(String(item || "")))
    .filter(Boolean)
    .join(" ");
}

export function renderStatusTag(text: string, color: "default" | "success" | "warning" | "error" = "default") {
  if (!text) return <Tag>待同步</Tag>;
  return <Tag color={color}>{text}</Tag>;
}

function sortFluxRangeLabels(labels: string[]) {
  return Array.from(new Set(labels.filter(Boolean))).sort((left, right) => {
    const leftIndex = PRODUCT_FLUX_RANGE_ORDER.indexOf(left);
    const rightIndex = PRODUCT_FLUX_RANGE_ORDER.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right, "zh-CN");
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
}

function mapGpRangeLabel(range: string) {
  switch (String(range || "").trim()) {
    case "1d":
      return "昨日";
    case "7d":
      return "近7日";
    case "30d":
      return "近30日";
    default:
      return String(range || "").trim() || "近7日";
  }
}

export function getRangeDaysByLabel(label: string) {
  switch (label) {
    case "昨日":
      return 1;
    case "近7日":
      return 7;
    case "近30日":
      return 30;
    default:
      return 1;
  }
}

function normalizeGpTrendPoints(trend: any[] = []) {
  return trend
    .map((item) => ({
      date: String(item?.day || item?.date || "").trim(),
      sales: Number(item?.quantity ?? item?.sales ?? item?.value) || 0,
    }))
    .filter((item) => Boolean(item.date))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function buildGpFallbackFluxSite(gp: any): ProductFluxSiteData | null {
  if (!gp || !gp.productId) return null;
  const availableRangeKeys = Array.from(
    new Set(
      (Array.isArray(gp.availableRanges) ? gp.availableRanges : [gp.defaultRange || "7d"])
        .map((item: any) => String(item || "").trim())
        .filter(Boolean),
    ),
  ) as string[];
  const summaryByRange: Record<string, ProductTrafficSummary> = {};
  const itemsByRange: Record<string, any[]> = {};
  const trendPoints = normalizeGpTrendPoints(gp.trend);
  const defaultRangeKey = String(gp.defaultRange || availableRangeKeys[0] || "7d");

  for (const rangeKey of availableRangeKeys) {
    const rangeLabel = mapGpRangeLabel(rangeKey);
    const detail = gp.regionDetailsByRange?.[rangeKey] || (rangeKey === defaultRangeKey ? gp.regionDetail : null) || null;
    const regionRows = Array.isArray(detail?.rows) ? detail.rows : [];
    const rangeTotal = Number(detail?.total) || (rangeKey === defaultRangeKey ? Number(gp.sales) || 0 : 0);
    itemsByRange[rangeLabel] = regionRows;
    summaryByRange[rangeLabel] = {
      siteKey: "global",
      siteLabel: "全球",
      syncedAt: gp.syncedAt || "",
      dataDate: trendPoints[trendPoints.length - 1]?.date || "",
      updateTime: gp.syncedAt || "",
      growDataText:
        Number.isFinite(Number(gp.changeRate)) && Number(gp.changeRate) !== 0
          ? `动销变化 ${Number(gp.changeRate) > 0 ? "+" : ""}${Number(gp.changeRate).toFixed(1)}%`
          : "已采集动销快照",
      exposeNum: 0,
      clickNum: 0,
      detailVisitNum: 0,
      detailVisitorNum: 0,
      addToCartUserNum: 0,
      collectUserNum: 0,
      buyerNum: rangeTotal,
      payGoodsNum: rangeTotal,
      payOrderNum: rangeTotal,
      searchExposeNum: 0,
      searchClickNum: 0,
      searchPayGoodsNum: 0,
      recommendExposeNum: 0,
      recommendClickNum: 0,
      recommendPayGoodsNum: 0,
      trendExposeNum: 0,
      trendPayOrderNum: rangeTotal,
      exposeClickRate: 0,
      clickPayRate: 0,
      dataOrigin: "gp",
      rangeTotal,
      changeRate: Number(gp.changeRate) || 0,
      coveredRegions: regionRows.length,
      trendPoints,
      regionRows,
    };
  }

  const availableRanges = sortFluxRangeLabels(Object.keys(summaryByRange));
  if (availableRanges.length === 0) return null;
  const primaryRangeLabel = availableRanges.includes(mapGpRangeLabel(defaultRangeKey))
    ? mapGpRangeLabel(defaultRangeKey)
    : availableRanges[0];

  return {
    siteKey: "global",
    siteLabel: "全球",
    syncedAt: gp.syncedAt || "",
    summary: summaryByRange[primaryRangeLabel] || null,
    summaryByRange,
    items: itemsByRange[primaryRangeLabel] || [],
    itemsByRange,
    availableRanges,
    primaryRangeLabel,
  };
}

function toPercentValue(value: unknown, fallbackNumerator?: number, fallbackDenominator?: number) {
  const raw = Number(value);
  if (Number.isFinite(raw) && raw > 1) return raw;
  if (Number.isFinite(raw) && raw >= 0) return raw * 100;
  if (fallbackDenominator && fallbackDenominator > 0) {
    return (Number(fallbackNumerator || 0) / fallbackDenominator) * 100;
  }
  return 0;
}

function formatTrafficNumber(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toLocaleString("zh-CN");
}

function formatTrafficPercent(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${num >= 10 ? num.toFixed(1) : num.toFixed(2)}%`;
}

function buildTrafficSummary(source: any, siteKey: FluxSiteKey, siteLabel: string, syncedAt: string): ProductTrafficSummary {
  const exposeNum = toNumberValue(source?.exposeNum);
  const clickNum = toNumberValue(source?.clickNum);
  const detailVisitNum = toNumberValue(source?.detailVisitNum || source?.detailVisitorNum);
  const detailVisitorNum = toNumberValue(source?.detailVisitorNum || source?.detailVisitNum);
  const addToCartUserNum = toNumberValue(source?.addToCartUserNum);
  const collectUserNum = toNumberValue(source?.collectUserNum);
  const buyerNum = toNumberValue(source?.buyerNum);
  const payGoodsNum = toNumberValue(source?.payGoodsNum);
  const payOrderNum = toNumberValue(source?.payOrderNum);
  const searchExposeNum = toNumberValue(source?.searchExposeNum);
  const searchClickNum = toNumberValue(source?.searchClickNum);
  const searchPayGoodsNum = toNumberValue(source?.searchPayGoodsNum);
  const recommendExposeNum = toNumberValue(source?.recommendExposeNum);
  const recommendClickNum = toNumberValue(source?.recommendClickNum);
  const recommendPayGoodsNum = toNumberValue(source?.recommendPayGoodsNum);
  const trendExposeNum = toNumberValue(source?.trendExposeNum);
  const trendPayOrderNum = toNumberValue(source?.trendPayOrderNum);

  return {
    siteKey,
    siteLabel,
    syncedAt,
    dataDate: normalizeText(source?.dataDate),
    updateTime: normalizeText(source?.updateTime),
    growDataText: normalizeText(source?.growDataText),
    exposeNum,
    clickNum,
    detailVisitNum,
    detailVisitorNum,
    addToCartUserNum,
    collectUserNum,
    buyerNum,
    payGoodsNum,
    payOrderNum,
    searchExposeNum,
    searchClickNum,
    searchPayGoodsNum,
    recommendExposeNum,
    recommendClickNum,
    recommendPayGoodsNum,
    trendExposeNum,
    trendPayOrderNum,
    exposeClickRate: toPercentValue(source?.exposeClickRate, clickNum, exposeNum),
    clickPayRate: toPercentValue(source?.clickPayRate, buyerNum, clickNum),
  };
}

function summarizeFluxItems(items: any[], siteKey: FluxSiteKey, siteLabel: string, syncedAt: string) {
  const aggregate = items.reduce(
    (accumulator, item) => ({
      exposeNum: accumulator.exposeNum + toNumberValue(item?.exposeNum),
      clickNum: accumulator.clickNum + toNumberValue(item?.clickNum),
      detailVisitNum: accumulator.detailVisitNum + toNumberValue(item?.detailVisitNum || item?.detailVisitorNum),
      detailVisitorNum: accumulator.detailVisitorNum + toNumberValue(item?.detailVisitorNum || item?.detailVisitNum),
      addToCartUserNum: accumulator.addToCartUserNum + toNumberValue(item?.addToCartUserNum),
      collectUserNum: accumulator.collectUserNum + toNumberValue(item?.collectUserNum),
      buyerNum: accumulator.buyerNum + toNumberValue(item?.buyerNum),
      payGoodsNum: accumulator.payGoodsNum + toNumberValue(item?.payGoodsNum),
      payOrderNum: accumulator.payOrderNum + toNumberValue(item?.payOrderNum),
      searchExposeNum: accumulator.searchExposeNum + toNumberValue(item?.searchExposeNum),
      searchClickNum: accumulator.searchClickNum + toNumberValue(item?.searchClickNum),
      searchPayGoodsNum: accumulator.searchPayGoodsNum + toNumberValue(item?.searchPayGoodsNum),
      recommendExposeNum: accumulator.recommendExposeNum + toNumberValue(item?.recommendExposeNum),
      recommendClickNum: accumulator.recommendClickNum + toNumberValue(item?.recommendClickNum),
      recommendPayGoodsNum: accumulator.recommendPayGoodsNum + toNumberValue(item?.recommendPayGoodsNum),
      trendExposeNum: accumulator.trendExposeNum + toNumberValue(item?.trendExposeNum),
      trendPayOrderNum: accumulator.trendPayOrderNum + toNumberValue(item?.trendPayOrderNum),
      dataDate: normalizeText(item?.dataDate) || accumulator.dataDate,
      updateTime: normalizeText(item?.updateTime) || accumulator.updateTime,
      growDataText: normalizeText(item?.growDataText) || accumulator.growDataText,
    }),
    {
      exposeNum: 0,
      clickNum: 0,
      detailVisitNum: 0,
      detailVisitorNum: 0,
      addToCartUserNum: 0,
      collectUserNum: 0,
      buyerNum: 0,
      payGoodsNum: 0,
      payOrderNum: 0,
      searchExposeNum: 0,
      searchClickNum: 0,
      searchPayGoodsNum: 0,
      recommendExposeNum: 0,
      recommendClickNum: 0,
      recommendPayGoodsNum: 0,
      trendExposeNum: 0,
      trendPayOrderNum: 0,
      dataDate: "",
      updateTime: "",
      growDataText: "",
    },
  );

  return buildTrafficSummary(aggregate, siteKey, siteLabel, syncedAt);
}

function mergeFluxProductHistoryCaches(...sources: Array<Record<string, any> | null | undefined>) {
  const merged: Record<string, any> = {};
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const [goodsId, goodsData] of Object.entries(source) as [string, any][]) {
      if (!goodsId) continue;
      if (!merged[goodsId]) merged[goodsId] = { stations: {} };
      const nextStations = merged[goodsId].stations && typeof merged[goodsId].stations === "object"
        ? merged[goodsId].stations
        : {};
      merged[goodsId] = {
        ...merged[goodsId],
        ...goodsData,
        stations: nextStations,
      };
      for (const [site, siteData] of Object.entries(goodsData?.stations || {}) as [string, any][]) {
        nextStations[site] = siteData;
      }
    }
  }
  return merged;
}

function normalizeFluxHistoryDailyRows(rows: any[] = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((item: any) => ({
      date: normalizeText(item?.date || item?.statDate || item?.day),
      exposeNum: toNumberValue(item?.exposeNum),
      clickNum: toNumberValue(item?.clickNum),
      detailVisitNum: toNumberValue(item?.detailVisitNum || item?.detailVisitorNum),
      detailVisitorNum: toNumberValue(item?.detailVisitorNum || item?.detailVisitNum),
      addToCartUserNum: toNumberValue(item?.addToCartUserNum),
      collectUserNum: toNumberValue(item?.collectUserNum),
      buyerNum: toNumberValue(item?.buyerNum),
      payGoodsNum: toNumberValue(item?.payGoodsNum),
      payOrderNum: toNumberValue(item?.payOrderNum || item?.payGoodsNum),
      searchExposeNum: toNumberValue(item?.searchExposeNum),
      searchClickNum: toNumberValue(item?.searchClickNum),
      searchPayGoodsNum: toNumberValue(item?.searchPayGoodsNum),
      recommendExposeNum: toNumberValue(item?.recommendExposeNum),
      recommendClickNum: toNumberValue(item?.recommendClickNum),
      recommendPayGoodsNum: toNumberValue(item?.recommendPayGoodsNum),
    }))
    .filter((item) => Boolean(item.date))
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));
}

function buildFluxHistoryFallbackSite(
  productHistoryCache: Record<string, any>,
  idCandidates: string[],
  siteKey: FluxSiteKey,
  siteLabel: string,
  syncedAt = "",
): ProductFluxSiteData | null {
  if (!productHistoryCache || typeof productHistoryCache !== "object") return null;
  const ids = Array.from(new Set((Array.isArray(idCandidates) ? idCandidates : []).map((value) => String(value || "").trim()).filter(Boolean)));
  if (ids.length === 0) return null;

  let cachedDaily: any[] = [];
  let cacheSyncedAt = normalizeText(syncedAt);
  for (const id of ids) {
    const station = productHistoryCache[id]?.stations?.[siteLabel];
    const rows = normalizeFluxHistoryDailyRows(station?.daily);
    if (!rows.length) continue;
    cachedDaily = rows;
    const rawCachedAt = station?.cachedAt ?? productHistoryCache[id]?.cachedAt ?? "";
    cacheSyncedAt = normalizeText(
      typeof rawCachedAt === "number" && Number.isFinite(rawCachedAt)
        ? new Date(rawCachedAt).toISOString()
        : rawCachedAt,
    ) || cacheSyncedAt;
    break;
  }

  if (!cachedDaily.length) return null;

  const latestRow = cachedDaily[cachedDaily.length - 1];
  const latestMonth = String(latestRow?.date || "").slice(0, 7);
  const rangeRowsMap: Record<string, any[]> = {
    今日: latestRow ? [latestRow] : [],
    近7日: cachedDaily.slice(-7),
    近30日: cachedDaily.slice(-30),
  };

  if (cachedDaily.length > 1) {
    rangeRowsMap.昨日 = [cachedDaily[cachedDaily.length - 2]];
  }

  if (latestMonth) {
    const monthRows = cachedDaily.filter((item) => String(item?.date || "").startsWith(latestMonth));
    if (monthRows.length) {
      rangeRowsMap.本月 = monthRows;
    }
  }

  const buildSummary = (rangeRows: any[]): ProductTrafficSummary => {
    const aggregate = rangeRows.reduce((accumulator, item) => ({
      exposeNum: accumulator.exposeNum + toNumberValue(item?.exposeNum),
      clickNum: accumulator.clickNum + toNumberValue(item?.clickNum),
      detailVisitNum: accumulator.detailVisitNum + toNumberValue(item?.detailVisitNum || item?.detailVisitorNum),
      detailVisitorNum: accumulator.detailVisitorNum + toNumberValue(item?.detailVisitorNum || item?.detailVisitNum),
      addToCartUserNum: accumulator.addToCartUserNum + toNumberValue(item?.addToCartUserNum),
      collectUserNum: accumulator.collectUserNum + toNumberValue(item?.collectUserNum),
      buyerNum: accumulator.buyerNum + toNumberValue(item?.buyerNum),
      payGoodsNum: accumulator.payGoodsNum + toNumberValue(item?.payGoodsNum),
      payOrderNum: accumulator.payOrderNum + toNumberValue(item?.payOrderNum || item?.payGoodsNum),
      searchExposeNum: accumulator.searchExposeNum + toNumberValue(item?.searchExposeNum),
      searchClickNum: accumulator.searchClickNum + toNumberValue(item?.searchClickNum),
      searchPayGoodsNum: accumulator.searchPayGoodsNum + toNumberValue(item?.searchPayGoodsNum),
      recommendExposeNum: accumulator.recommendExposeNum + toNumberValue(item?.recommendExposeNum),
      recommendClickNum: accumulator.recommendClickNum + toNumberValue(item?.recommendClickNum),
      recommendPayGoodsNum: accumulator.recommendPayGoodsNum + toNumberValue(item?.recommendPayGoodsNum),
      trendExposeNum: accumulator.trendExposeNum + toNumberValue(item?.exposeNum),
      trendPayOrderNum: accumulator.trendPayOrderNum + toNumberValue(item?.payOrderNum || item?.payGoodsNum),
      dataDate: normalizeText(item?.date) || accumulator.dataDate,
    }), {
      exposeNum: 0,
      clickNum: 0,
      detailVisitNum: 0,
      detailVisitorNum: 0,
      addToCartUserNum: 0,
      collectUserNum: 0,
      buyerNum: 0,
      payGoodsNum: 0,
      payOrderNum: 0,
      searchExposeNum: 0,
      searchClickNum: 0,
      searchPayGoodsNum: 0,
      recommendExposeNum: 0,
      recommendClickNum: 0,
      recommendPayGoodsNum: 0,
      trendExposeNum: 0,
      trendPayOrderNum: 0,
      dataDate: "",
    });

    return {
      ...buildTrafficSummary(aggregate, siteKey, siteLabel, cacheSyncedAt),
      dataDate: normalizeText(rangeRows[rangeRows.length - 1]?.date || latestRow?.date),
      updateTime: cacheSyncedAt || normalizeText(latestRow?.date),
      growDataText: "已采集商品级日趋势",
      dataOrigin: "cache",
    };
  };

  const summaryByRange = Object.fromEntries(
    Object.entries(rangeRowsMap)
      .filter(([, rows]) => Array.isArray(rows) && rows.length > 0)
      .map(([label, rows]) => [label, buildSummary(rows)]),
  ) as Record<string, ProductTrafficSummary>;

  const availableRanges = sortFluxRangeLabels(Object.keys(summaryByRange));
  if (!availableRanges.length) return null;

  const primaryRangeLabel = availableRanges.includes("近30日")
    ? "近30日"
    : (availableRanges.includes("近7日") ? "近7日" : availableRanges[0]);

  return {
    siteKey,
    siteLabel,
    syncedAt: cacheSyncedAt,
    summary: summaryByRange[primaryRangeLabel] || null,
    summaryByRange,
    items: [],
    itemsByRange: {},
    availableRanges,
    primaryRangeLabel,
  };
}

function matchesFluxRecord(record: any, idCandidates: Set<string>) {
  const idMatched = PRODUCT_ID_LOOKUP_FIELDS.some((field) => {
    const text = normalizeText(record?.[field]);
    return Boolean(text) && idCandidates.has(text);
  });
  return idMatched;
}

function parseMallFluxTrend(raw: any) {
  const apis = Array.isArray(raw?.apis) ? raw.apis : [];
  const rows = apis
    .filter((api: any) => String(api?.path || "").includes("/flow/analysis/mall/list"))
    .flatMap((api: any) => {
      const payload = api?.data?.result ?? api?.data?.data ?? api?.data ?? {};
      return Array.isArray(payload?.list) ? payload.list : [];
    })
    .map((item: any) => ({
      statDate: normalizeText(item?.statDate),
      totalPageView: toNumberValue(item?.totalPageView),
      totalVisitorsNum: toNumberValue(item?.totalVisitorsNum),
      totalPayBuyerNum: toNumberValue(item?.totalPayBuyerNum),
      totalPayGoodsNum: toNumberValue(item?.totalPayGoodsNum),
      goodsPageView: toNumberValue(item?.goodsPageView),
      goodsVisitorsNum: toNumberValue(item?.goodsVisitorsNum),
      goodsDetailPayBuyerNum: toNumberValue(item?.goodsDetailPayBuyerNum),
      goodsDetailPayConversionRate: Number(item?.goodsDetailPayConversionRate) || 0,
    }))
    .filter((item: any) => item.statDate);

  return rows.sort((left: any, right: any) => left.statDate.localeCompare(right.statDate));
}

function normalizeMallTrendRows(rows: any[]) {
  return rows
    .map((item: any) => {
      const visitors = toNumberValue(item?.goodsVisitorsNum || item?.totalVisitorsNum);
      const buyers = toNumberValue(item?.goodsDetailPayBuyerNum || item?.totalPayBuyerNum);
      return {
        date: normalizeText(item?.statDate),
        visitors,
        buyers,
        conversionRate: toPercentValue(undefined, buyers, visitors),
      };
    })
    .filter((item: any) => item.date);
}

function buildMallFallbackFluxSite(raw: any, siteKey: FluxSiteKey, siteLabel: string): ProductFluxSiteData | null {
  const rows = parseMallFluxTrend(raw);
  if (!rows.length) return null;

  const latestRow = rows[rows.length - 1];
  const latestMonth = String(latestRow?.statDate || "").slice(0, 7);
  const rangeRowsMap: Record<string, any[]> = {
    今日: latestRow ? [latestRow] : [],
    近7日: rows.slice(-7),
    近30日: rows.slice(-30),
  };

  if (rows.length > 1) {
    rangeRowsMap.昨日 = [rows[rows.length - 2]];
  }

  if (latestMonth) {
    const monthRows = rows.filter((item: any) => String(item?.statDate || "").startsWith(latestMonth));
    if (monthRows.length) {
      rangeRowsMap.本月 = monthRows;
    }
  }

  const buildSummary = (rangeLabel: string, rangeRows: any[]): ProductTrafficSummary => {
    const exposeNum = rangeRows.reduce((sum, item) => sum + (item.goodsPageView || item.totalPageView || 0), 0);
    const clickNum = rangeRows.reduce((sum, item) => sum + (item.goodsVisitorsNum || item.totalVisitorsNum || 0), 0);
    const buyerNum = rangeRows.reduce((sum, item) => sum + (item.goodsDetailPayBuyerNum || item.totalPayBuyerNum || 0), 0);
    const payGoodsNum = rangeRows.reduce((sum, item) => sum + (item.totalPayGoodsNum || 0), 0);

    return {
      siteKey,
      siteLabel,
      syncedAt: normalizeText(raw?.finishedAt || raw?.periodEnd || ""),
      dataDate: normalizeText(rangeRows[rangeRows.length - 1]?.statDate || latestRow?.statDate),
      updateTime: normalizeText(raw?.finishedAt || raw?.periodEnd || latestRow?.statDate),
      growDataText: "已采集站点流量趋势",
      exposeNum,
      clickNum,
      detailVisitNum: clickNum,
      detailVisitorNum: clickNum,
      addToCartUserNum: 0,
      collectUserNum: 0,
      buyerNum,
      payGoodsNum,
      payOrderNum: payGoodsNum,
      searchExposeNum: 0,
      searchClickNum: 0,
      searchPayGoodsNum: 0,
      recommendExposeNum: 0,
      recommendClickNum: 0,
      recommendPayGoodsNum: 0,
      trendExposeNum: exposeNum,
      trendPayOrderNum: payGoodsNum,
      exposeClickRate: toPercentValue(undefined, clickNum, exposeNum),
      clickPayRate: toPercentValue(undefined, buyerNum, clickNum),
      dataOrigin: "mall",
      trendPoints: rangeRows.map((item) => ({
        date: normalizeText(item?.statDate),
        sales: toNumberValue(item?.totalPayGoodsNum),
      })),
      regionRows: [],
    };
  };

  const summaryByRange = Object.fromEntries(
    Object.entries(rangeRowsMap)
      .filter(([, rangeRows]) => Array.isArray(rangeRows) && rangeRows.length > 0)
      .map(([rangeLabel, rangeRows]) => [rangeLabel, buildSummary(rangeLabel, rangeRows)]),
  ) as Record<string, ProductTrafficSummary>;

  const availableRanges = sortFluxRangeLabels(Object.keys(summaryByRange));
  if (!availableRanges.length) return null;

  const primaryRangeLabel = availableRanges.includes("近7日")
    ? "近7日"
    : availableRanges.includes("今日")
      ? "今日"
      : availableRanges[0];

  return {
    siteKey,
    siteLabel,
    syncedAt: normalizeText(raw?.finishedAt || raw?.periodEnd || ""),
    summary: summaryByRange[primaryRangeLabel] || null,
    summaryByRange,
    items: [],
    itemsByRange: {},
    availableRanges,
    primaryRangeLabel,
  };
}

function mergeFluxSiteData(primary: ProductFluxSiteData | null, fallback: ProductFluxSiteData | null): ProductFluxSiteData | null {
  if (!primary) return fallback;
  if (!fallback) return primary;

  const summaryByRange = {
    ...fallback.summaryByRange,
    ...primary.summaryByRange,
  };
  const itemsByRange = {
    ...fallback.itemsByRange,
    ...primary.itemsByRange,
  };
  const availableRanges = sortFluxRangeLabels([
    ...Object.keys(summaryByRange),
    ...primary.availableRanges,
    ...fallback.availableRanges,
  ]);
  const primaryRangeLabel = availableRanges.includes(primary.primaryRangeLabel)
    ? primary.primaryRangeLabel
    : (availableRanges.includes(fallback.primaryRangeLabel) ? fallback.primaryRangeLabel : availableRanges[0]);

  return {
    siteKey: primary.siteKey,
    siteLabel: primary.siteLabel,
    syncedAt: primary.syncedAt || fallback.syncedAt,
    summary: summaryByRange[primaryRangeLabel] || primary.summary || fallback.summary || null,
    summaryByRange,
    items: itemsByRange[primaryRangeLabel] || primary.items || fallback.items || [],
    itemsByRange,
    availableRanges,
    primaryRangeLabel,
  };
}

export default function ProductList() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [salesSummary, setSalesSummary] = useState<any>(null);
  const [countSummary, setCountSummary] = useState<ProductCountSummary>(EMPTY_COUNT_SUMMARY);
  // 云端采集到的 SKC / 销售数据，按 skc_id 覆盖商品管理主字段。
  const [cloudSkcMap, setCloudSkcMap] = useState<Map<string, SkcRow>>(new Map());
  const [cloudSalesMap, setCloudSalesMap] = useState<Map<string, TemuSalesRow>>(new Map());
  const [cloudActivityRows, setCloudActivityRows] = useState<TemuActivityRow[]>([]);
  const [cloudActivityCount, setCloudActivityCount] = useState(0);
  const [cloudRiskCount, setCloudRiskCount] = useState(0);
  const [cloudStockOrderCount, setCloudStockOrderCount] = useState(0);
  const [cloudAfterSaleCount, setCloudAfterSaleCount] = useState(0);
  const [cloudShopSales, setCloudShopSales] = useState<TemuShopSalesRow | null>(null);
  const [cloudProductMeta, setCloudProductMeta] = useState({ latestAt: "", error: "" });

  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);
  const [diagnostics, setDiagnostics] = useState<CollectionDiagnostics | null>(null);
  const [, setSourceState] = useState<ProductSourceState>(EMPTY_SOURCES);
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);
  const [activityDetailProduct, setActivityDetailProduct] = useState<ProductItem | null>(null);
  const [activityDetailSku, setActivityDetailSku] = useState<ActivityDetailSkuTarget>(null);
  const [activityDetailFilter, setActivityDetailFilter] = useState<ActivityDetailFilter>("all");
  const [activityCatalogOpen, setActivityCatalogOpen] = useState(false);
  const [activityCatalogFilter, setActivityCatalogFilter] = useState<ActivityDetailFilter>("all");
  const loadProductsInFlightRef = useRef(false);
  const [drawerTab, setDrawerTab] = useState<string>("overview");
  const [activeFluxSiteKey, setActiveFluxSiteKey] = useState<FluxSiteKey>("global");
  const [activeFluxRangeLabel, setActiveFluxRangeLabel] = useState("");
  const [fluxHistoryData, setFluxHistoryData] = useState<any[]>([]);
  const [productHistoryCache, setProductHistoryCache] = useState<Record<string, any>>({});
  const [siteTrendListBySite, setSiteTrendListBySite] = useState<Record<string, any[]>>({});
  const [gpDetailOpen, setGpDetailOpen] = useState(false);
  const [gpDetailLoading, setGpDetailLoading] = useState(false);
  const [gpDetailRow, setGpDetailRow] = useState<{
    productId: number | null;
    productName?: string;
    skcId?: any;
    availableRanges?: Array<"1d" | "7d" | "30d">;
    defaultRange?: "1d" | "7d" | "30d";
    regionDetailsByRange?: Partial<Record<"1d" | "7d" | "30d", any>>;
    fallbackDetail?: any;
  } | null>(null);
  const [gpDetailData, setGpDetailData] = useState<any>(null);
  const [gpDetailRange, setGpDetailRange] = useState<"1d" | "7d" | "30d">("7d");
  const fluxDetailFetchStateRef = useRef<Map<string, "loading" | "done" | "empty">>(new Map());
  void fluxDetailFetchStateRef; // 保留
  const gpDetailRangeOptions: Array<"1d" | "7d" | "30d"> = ["30d", "7d", "1d"];
  const gpDetailCacheMissingMessage = "该商品的动销详情还没有进入缓存，请先到数据采集运行“动销详情 / 地区明细”。";

  const openGpDetail = (record: any, range?: "1d" | "7d" | "30d") => {
    const gp = record?.gp;
    const pid = gp?.productId;
    if (!pid) {
      message.error(gpDetailCacheMissingMessage);
      return;
    }
    const r = range || gpDetailRange;
    const normalizedRanges = Array.from(
      new Set(
        (Array.isArray(gp?.availableRanges) ? gp.availableRanges : [gp?.defaultRange || "7d"])
          .map((item: any) => String(item || "").trim())
          .filter((item: string) => item === "1d" || item === "7d" || item === "30d"),
      ),
    ) as Array<"1d" | "7d" | "30d">;
    const availableRanges: Array<"1d" | "7d" | "30d"> = normalizedRanges.length > 0 ? normalizedRanges : ["7d"];
    const regionDetailsByRange = (gp?.regionDetailsByRange && typeof gp.regionDetailsByRange === "object")
      ? gp.regionDetailsByRange
      : {};
    const cachedDetail = regionDetailsByRange[r] || gp?.regionDetail || null;
    setGpDetailRange(r);
    setGpDetailRow({
      productId: pid,
      productName: gp.productName || record.title,
      skcId: record.skcId,
      availableRanges,
      defaultRange: (gp?.defaultRange || availableRanges[0] || "7d") as "1d" | "7d" | "30d",
      regionDetailsByRange,
      fallbackDetail: gp?.regionDetail || null,
    });
    setGpDetailOpen(true);
    setGpDetailLoading(false);
    setGpDetailData(
      cachedDetail || {
        error: gpDetailCacheMissingMessage,
      },
    );
  };

  const openCompetitorAnalysis = (currentProduct: ProductItem | null) => {
    if (!currentProduct) return;
    navigate("/competitor", {
      state: {
        prefillProduct: {
          token: `${Date.now()}-${currentProduct.goodsId || currentProduct.skcId || currentProduct.spuId || currentProduct.title || "product"}`,
          activateStep: 1,
          productId: currentProduct.skcId || "",
          skcId: currentProduct.skcId || "",
          spuId: currentProduct.spuId || "",
          goodsId: currentProduct.goodsId || "",
          skuId: currentProduct.sku || "",
          title: currentProduct.title || "",
        },
      },
    });
  };
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    void loadProducts();
    const handleActiveAccountChanged = () => {
      void loadProducts();
    };
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const handleStoreValueUpdated = (event: Event) => {
      if (CLOUD_PRODUCTS_ONLY) return;
      const detail = (event as CustomEvent<{ baseKey?: string | null }>)?.detail;
      if (!detail?.baseKey || ![
        "temu_products",
        "temu_sales",
        "temu_orders",
        "temu_flux",
        "temu_raw_fluxUS",
        "temu_raw_fluxEU",
        "temu_raw_mallFlux",
        "temu_raw_mallFluxUS",
        "temu_raw_mallFluxEU",
        "temu_raw_globalPerformance",
        "temu_flux_history",
        COLLECTION_DIAGNOSTICS_KEY,
      ].includes(detail.baseKey)) {
        return;
      }
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        void loadProducts();
      }, 120);
    };
    window.addEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    window.addEventListener(STORE_VALUE_UPDATED_EVENT, handleStoreValueUpdated as EventListener);
    return () => {
      window.removeEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
      window.removeEventListener(STORE_VALUE_UPDATED_EVENT, handleStoreValueUpdated as EventListener);
      if (reloadTimer) clearTimeout(reloadTimer);
    };
  }, []);

  useEffect(() => {
    if (location.pathname === "/products") {
      void loadProducts();
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!selectedProduct) return;
    const sites = Array.isArray(selectedProduct.fluxSites) ? selectedProduct.fluxSites : [];
    const defaultSite = sites.find((site) => site.siteKey === "global") || sites[0] || null;
    setActiveFluxSiteKey(defaultSite?.siteKey || "global");
    setActiveFluxRangeLabel(defaultSite?.primaryRangeLabel || defaultSite?.availableRanges?.[0] || "");
  }, [selectedProduct?.skcId, selectedProduct?.goodsId, selectedProduct?.spuId]);

  useEffect(() => {
    if (!selectedProduct) return;
    const sites = Array.isArray(selectedProduct.fluxSites) ? selectedProduct.fluxSites : [];
    const site = sites.find((item) => item.siteKey === activeFluxSiteKey) || sites[0] || null;
    if (!site) return;
    if (!site.availableRanges.includes(activeFluxRangeLabel)) {
      setActiveFluxRangeLabel(site.primaryRangeLabel || site.availableRanges[0] || "");
    }
  }, [activeFluxSiteKey, activeFluxRangeLabel, selectedProduct]);

  // 从 productHistoryCache 抽取当前商品在三个站点的日趋势 (温缓存,不触发现采)
  const productDailyTrendBySite = useMemo<Record<string, any[]>>(() => {
    if (!selectedProduct || !productHistoryCache) return {};
    const ids = [selectedProduct.goodsId, selectedProduct.skcId, selectedProduct.spuId, selectedProduct.skuId]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (ids.length === 0) return {};
    const siteToLabel: Array<{ key: FluxSiteKey; label: string }> = [
      { key: "global", label: "全球" },
      { key: "us", label: "美国" },
      { key: "eu", label: "欧区" },
    ];
    const result: Record<string, any[]> = {};
    for (const { key, label } of siteToLabel) {
      for (const id of ids) {
        const daily = productHistoryCache[id]?.stations?.[label]?.daily;
        if (Array.isArray(daily) && daily.length > 0) {
          result[key] = daily;
          break;
        }
      }
    }
    return result;
  }, [selectedProduct, productHistoryCache]);

  const applyCloudProductBundleToState = (cloudBundle: CloudProductBundle) => {
    const cloudProducts = buildCloudProductRows(cloudBundle);
    setCloudSkcMap(cloudBundle.skcMap);
    setCloudSalesMap(cloudBundle.salesMap);
    setCloudActivityRows(cloudBundle.activityRows);
    setCloudActivityCount(cloudBundle.activityRows.length);
    setCloudRiskCount(cloudBundle.riskRows.length);
    setCloudStockOrderCount(cloudBundle.stockOrderRows.length);
    setCloudAfterSaleCount(cloudBundle.afterSaleRows.length);
    setCloudShopSales(cloudBundle.shopSales);
    setCloudProductMeta({ latestAt: cloudBundle.latestAt, error: cloudBundle.error });
    setHasAccount(cloudBundle.configured);
    setDiagnostics(null);
    setSourceState({
      products: true,
      sales: true,
      orders: true,
    });
    setSalesSummary(buildCloudSalesSummary(cloudProducts));
    setCountSummary({
      totalCount: cloudProducts.length,
      onSaleCount: cloudProducts.length,
      notPublishedCount: 0,
      offSaleCount: 0,
    });
    setProducts(cloudProducts);
    setFluxHistoryData([]);
    setProductHistoryCache({});
    setSiteTrendListBySite({});
  };

  const loadProducts = async () => {
    if (loadProductsInFlightRef.current) return;
    loadProductsInFlightRef.current = true;
    setLoading(true);
    try {
      if (CLOUD_PRODUCTS_ONLY) {
        if (products.length === 0) {
          const cachedBundle = await readCachedCloudProductBundle("", true);
          if (cachedBundle) {
            applyCloudProductBundleToState(cachedBundle);
          }
        }
        const cloudBundle = await loadCloudProductBundle();
        applyCloudProductBundleToState(cloudBundle);
        return;
      }

      const [
        accounts,
        rawProducts,
        rawSales,
        rawOrders,
        rawFlux,
        rawFluxUS,
        rawFluxEU,
        rawMallFlux,
        rawMallFluxUS,
        rawMallFluxEU,
        diagnosticsRaw,
        rawLifecycle,
        rawFlowPrice,
        rawYunduOverall,
        rawGlobalPerf,
        rawFluxHistory,
        rawFluxProductCache,
        debugFlux,
        debugFluxUS,
        debugFluxEU,
        debugMallFlux,
        debugMallFluxUS,
        debugMallFluxEU,
      ] = await Promise.all([
        store?.get("temu_accounts"),
        getStoreValue(store, "temu_products"),
        getStoreValue(store, "temu_sales"),
        getStoreValue(store, "temu_orders"),
        getStoreValue(store, "temu_flux"),
        getStoreValue(store, "temu_raw_fluxUS"),
        getStoreValue(store, "temu_raw_fluxEU"),
        getStoreValue(store, "temu_raw_mallFlux"),
        getStoreValue(store, "temu_raw_mallFluxUS"),
        getStoreValue(store, "temu_raw_mallFluxEU"),
        getStoreValue(store, COLLECTION_DIAGNOSTICS_KEY),
        getStoreValue(store, "temu_raw_lifecycle"),
        getStoreValue(store, "temu_raw_flowPrice"),
        getStoreValue(store, "temu_raw_yunduOverall"),
        getStoreValue(store, "temu_raw_globalPerformance"),
        getStoreValue(store, "temu_flux_history"),
        store?.get("temu_flux_product_history_cache"),
        automation?.readScrapeData?.("flux").catch(() => null),
        automation?.readScrapeData?.("fluxUS").catch(() => null),
        automation?.readScrapeData?.("fluxEU").catch(() => null),
        automation?.readScrapeData?.("mallFlux").catch(() => null),
        automation?.readScrapeData?.("mallFluxUS").catch(() => null),
        automation?.readScrapeData?.("mallFluxEU").catch(() => null),
      ]);

      // 全球业务表现 / 动销详情：按 skcId 索引，优先读取采集阶段预拉的多时间段缓存
      const gpSkcMap = new Map<string, any>();
      try {
        const bundle = rawGlobalPerf && typeof rawGlobalPerf === "object" ? rawGlobalPerf as any : {};
        const rawRanges = bundle?.ranges && typeof bundle.ranges === "object" ? bundle.ranges : null;
        const fallbackRange = typeof bundle?.range === "string" ? bundle.range : "7d";
        const availableRanges = Array.from(
          new Set(
            (Array.isArray(bundle?.availableRanges) ? bundle.availableRanges : rawRanges ? Object.keys(rawRanges) : [fallbackRange])
              .map((item: any) => String(item || "").trim())
              .filter((item: string) => item === "1d" || item === "7d" || item === "30d"),
          ),
        ) as Array<"1d" | "7d" | "30d">;
        const defaultRange = (availableRanges.includes(bundle?.defaultRange)
          ? bundle.defaultRange
          : (availableRanges.includes("7d") ? "7d" : availableRanges[0] || fallbackRange || "7d")) as "1d" | "7d" | "30d";
        const rangeResults = Object.fromEntries(
          availableRanges.map((rangeKey) => [rangeKey, rawRanges?.[rangeKey] || (rangeKey === fallbackRange ? bundle : null)]),
        ) as Partial<Record<"1d" | "7d" | "30d", any>>;
        const defaultPerf = rangeResults[defaultRange] || bundle;
        const skcSales: any[] = Array.isArray(defaultPerf?.skcSales) ? defaultPerf.skcSales : [];
        for (const r of skcSales) {
          const k = r?.skcId != null ? String(r.skcId) : "";
          if (!k) continue;
          const pid = r.productId ?? null;
          const regionDetailsByRange = pid != null
            ? Object.fromEntries(
                availableRanges
                  .map((rangeKey) => [rangeKey, rangeResults[rangeKey]?.regionDetails?.[String(pid)] || null])
                  .filter(([, detail]) => Boolean(detail)),
              )
            : {};
          gpSkcMap.set(k, {
            sales: Number(r.sales) || 0,
            changeRate: Number(r.changeRate) || 0,
            trend: Array.isArray(r.trend) ? r.trend : [],
            productId: pid,
            productName: r.productName,
            syncedAt: bundle?.finishedAt || bundle?.periodEnd || "",
            defaultRange,
            availableRanges,
            regionDetail: pid != null
              ? (regionDetailsByRange[defaultRange] || defaultPerf?.regionDetails?.[String(pid)] || null)
              : null,
            regionDetailsByRange,
          });
        }
      } catch (e) { console.warn("[ProductList] globalPerf parse error", e); }

      // 云舵 listOverall: 按 skcId 索引（提供「已加站点列表」「处罚原因」）
      const yunduSkcMap = new Map<string, any>();
      try {
        const yList: any[] = (rawYunduOverall as any)?.list || [];
        for (const it of yList) {
          const skc = it?.skcId != null ? String(it.skcId) : "";
          if (!skc) continue;
          yunduSkcMap.set(skc, it);
        }
        console.log("[ProductList] yunduSkcMap size:", yunduSkcMap.size);
      } catch (e) { console.warn("[ProductList] yundu parse error", e); }

      // Build SKC/goodsId/productId -> contact(对接运营) maps from lifecycle searchForChainSupplier
      const operatorMap = new Map<string, string>();
      const operatorByGoodsId = new Map<string, string>();
      const operatorByProductId = new Map<string, string>();
      const operatorNickMap = new Map<string, string>();
      const operatorNickByGoodsId = new Map<string, string>();
      const operatorNickByProductId = new Map<string, string>();
      // Also collect highPriceProductSearchLimit from skcList for 高价限流
      const skcLimitMap = new Map<string, any>();
      try {
        const lc: any = rawLifecycle;
        const lcApis = lc?.apis || lc?.value?.apis || lc?.lifecycle?.apis || lc?.data?.apis || [];
        const processItems = (items: any[]) => {
          if (!Array.isArray(items)) return;
          for (const it of items) {
            const contact = String(it?.contact ?? "").trim();
            const nick = String(it?.nickContact ?? "").trim();
            if (!contact && !nick) continue;
            const gid = it?.goodsId != null ? String(it.goodsId) : "";
            const pid = it?.productId != null ? String(it.productId) : "";
            if (gid) { if (contact) operatorByGoodsId.set(gid, contact); if (nick) operatorNickByGoodsId.set(gid, nick); }
            if (pid) { if (contact) operatorByProductId.set(pid, contact); if (nick) operatorNickByProductId.set(pid, nick); }
            const skcs = Array.isArray(it?.skcList) ? it.skcList : [];
            for (const s of skcs) {
              const skc = s?.skcId != null ? String(s.skcId) : "";
              if (skc) {
                if (contact) operatorMap.set(skc, contact);
                if (nick) operatorNickMap.set(skc, nick);
                if (s?.highPriceProductSearchLimit != null || s?.highPriceProductSearchLimitBeginTime || s?.highPriceProductSearchLimitEndTime) {
                  skcLimitMap.set(skc, s);
                }
              }
            }
            // also try top-level skc fields just in case
            const topSkc = String(it?.skcId ?? it?.productSkcId ?? "").trim();
            if (topSkc) { if (contact) operatorMap.set(topSkc, contact); if (nick) operatorNickMap.set(topSkc, nick); }
          }
        };
        if (Array.isArray(lcApis)) {
          for (const api of lcApis) {
            const path = String(api?.path || "");
            if (!path.includes("searchForChainSupplier")) continue;
            const r = api?.data?.result || api?.data || {};
            processItems(r?.dataList || r?.items || r?.list || r?.data || r?.pageItems || []);
          }
        }
        console.log("[ProductList] lc top keys:", lc ? Object.keys(lc) : null, "lcApis len:", Array.isArray(lcApis) ? lcApis.length : "n/a");
        console.log("[ProductList] operatorMap sizes - skc:", operatorMap.size, "goodsId:", operatorByGoodsId.size, "productId:", operatorByProductId.size);
        if (operatorMap.size > 0) console.log("[ProductList] operator sample skc:", [...operatorMap.entries()].slice(0,3));
      } catch (e) { console.warn("[ProductList] lifecycle parse error", e); }

      setHasAccount(Array.isArray(accounts) && accounts.length > 0);
      setDiagnostics(normalizeCollectionDiagnostics(diagnosticsRaw));

      const parsedProducts = parseProductsData(rawProducts);
      const parsedSales = parseSalesData(rawSales);
      const parsedOrders = parseOrdersData(rawOrders);
      const preferredFlux = pickPreferredFluxSource(rawFlux, debugFlux);
      const preferredFluxUS = pickPreferredFluxSource(rawFluxUS, debugFluxUS);
      const preferredFluxEU = pickPreferredFluxSource(rawFluxEU, debugFluxEU);
      const preferredMallFlux = rawMallFlux || debugMallFlux;
      const preferredMallFluxUS = rawMallFluxUS || debugMallFluxUS;
      const preferredMallFluxEU = rawMallFluxEU || debugMallFluxEU;
      const parsedFlux = preferredFlux ? parseFluxData(preferredFlux) : EMPTY_PARSED_FLUX;
      const parsedFluxUS = preferredFluxUS ? parseFluxData(preferredFluxUS) : EMPTY_PARSED_FLUX;
      const parsedFluxEU = preferredFluxEU ? parseFluxData(preferredFluxEU) : EMPTY_PARSED_FLUX;

      // 提取 mall/summary 的 trendList(站点级 30 天日趋势,作为 chart fallback)
      // 优先从 parsed flux 的 summary.trendList(已 normalized: date/visitors/buyers/conversionRate)
      // fallback 从 raw apis 的 mall/summary -> result.trendList(raw 字段: statDate/visitorsNum/payBuyerNum)
      const extractTrendList = (parsed: any, raw: any, mallRaw?: any): any[] => {
        const parsedList = parsed?.summary?.trendList;
        if (Array.isArray(parsedList) && parsedList.length > 0) return parsedList;
        if (raw && Array.isArray(raw.apis)) {
          const sumApi = raw.apis.find((a: any) => String(a?.path || "").includes("/mall/summary"));
          const list = sumApi?.data?.result?.trendList;
          if (Array.isArray(list) && list.length > 0) return list;
        }
        const mallRows = normalizeMallTrendRows(parseMallFluxTrend(mallRaw));
        if (mallRows.length > 0) return mallRows;
        return [];
      };
      const extractDailyCache = (raw: any): Record<string, any> => {
        const rawApis = Array.isArray(raw?.apis) ? raw.apis : [];
        const dailyCacheEntry = rawApis.find((a: any) => a.path === "__flux_product_daily_cache__");
        return dailyCacheEntry?.data?.result && typeof dailyCacheEntry.data.result === "object"
          ? dailyCacheEntry.data.result
          : {};
      };
      const trendListMap: Record<string, any[]> = {
        global: extractTrendList(parsedFlux, preferredFlux, preferredMallFlux),
        us: extractTrendList(parsedFluxUS, preferredFluxUS, preferredMallFluxUS),
        eu: extractTrendList(parsedFluxEU, preferredFluxEU, preferredMallFluxEU),
      };
      setSiteTrendListBySite(trendListMap);
      const mergedFluxProductCache = mergeFluxProductHistoryCaches(
        rawFluxProductCache && typeof rawFluxProductCache === "object" ? rawFluxProductCache as Record<string, any> : {},
        extractDailyCache(preferredFlux),
        extractDailyCache(preferredFluxUS),
        extractDailyCache(preferredFluxEU),
      );
      const productCounts = parseProductCountSummary(rawProducts);
      const salesItems = Array.isArray(parsedSales?.items) ? parsedSales.items : [];
      const fluxItems = Array.isArray(parsedFlux?.items) ? parsedFlux.items : [];
      void fluxItems; // 保留

      setSalesSummary(parsedSales?.summary || null);
      setCountSummary(productCounts);
      setSourceState({
        products: parsedProducts.length > 0,
        sales: salesItems.length > 0,
        orders: parsedOrders.length > 0,
      });

      const lookup = new Map<string, ProductItem>();
      const salesMergedProducts = new WeakSet<ProductItem>();

      const register = (product: ProductItem) => {
        buildLookupKeys(product).forEach((key) => {
          lookup.set(key, product);
        });
      };

      const findExisting = (source: Partial<ProductItem>) => {
        const keys = buildLookupKeys(source);
        for (const key of keys) {
          const found = lookup.get(key);
          if (found) return found;
        }
        return null;
      };

      const ensureProduct = (source: Partial<ProductItem>) => {
        const existing = findExisting(source);
        if (existing) return existing;

        const skuSummaries = normalizeSkuSummaryList(source.skuSummaries);
        const product: ProductItem = {
          title: source.title || "",
          category: source.category || "",
          categories: source.categories || "",
          spuId: source.spuId || "",
          skcId: source.skcId || "",
          goodsId: source.goodsId || "",
          sku: source.sku || "",
          extCode: source.extCode || "",
          skuId: source.skuId || "",
          skuName: source.skuName || "",
          imageUrl: normalizeImageUrl(source.imageUrl) || skuSummaries[0]?.thumbUrl || "",
          mallId: source.mallId || "",
          siteLabel: source.siteLabel || "",
          productType: source.productType || "",
          sourceType: source.sourceType || "",
          removeStatus: source.removeStatus || "",
          status: source.status || "",
          skcSiteStatus: source.skcSiteStatus || "",
          flowLimitStatus: source.flowLimitStatus || "",
          skuSummaries,
          todaySales: source.todaySales || 0,
          last30DaysSales: source.last30DaysSales || 0,
          totalSales: source.totalSales || 0,
          last7DaysSales: source.last7DaysSales || 0,
          syncedAt: source.syncedAt || "",
          warehouseStock: source.warehouseStock || 0,
          occupyStock: source.occupyStock || 0,
          unavailableStock: source.unavailableStock || 0,
          lackQuantity: source.lackQuantity || 0,
          price: source.price || "",
          stockStatus: source.stockStatus || "",
          supplyStatus: source.supplyStatus || "",
          pendingOrderCount: source.pendingOrderCount || 0,
          hotTag: source.hotTag || "",
          availableSaleDays: source.availableSaleDays ?? "",
          asfScore: source.asfScore,
          buyerName: source.buyerName || "",
          buyerUid: source.buyerUid || "",
          commentNum: source.commentNum ?? 0,
          inBlackList: source.inBlackList || "",
          pictureAuditStatus: source.pictureAuditStatus || "",
          qualityAfterSalesRate: source.qualityAfterSalesRate ?? "",
          predictTodaySaleVolume: source.predictTodaySaleVolume ?? 0,
          sevenDaysSaleReference: source.sevenDaysSaleReference ?? 0,
          hasSalesSnapshot: Boolean(source.hasSalesSnapshot),
        };
        register(product);
        return product;
      };

      parsedProducts.forEach((item: any) => {
        const normalizedSkuSummaries = normalizeSkuSummaryList(item.skuSummaries);
        const product = ensureProduct({
          title: item.title || "",
          category: item.category || "",
          categories: item.categories || "",
          spuId: normalizeText(item.spuId),
          skcId: normalizeText(item.skcId),
          goodsId: normalizeText(item.goodsId),
          sku: item.sku || "",
          extCode: item.extCode || "",
          imageUrl: normalizeImageUrl(item.imageUrl),
          siteLabel: item.siteLabel || "",
          productType: item.productType || "",
          sourceType: item.sourceType || "",
          removeStatus: normalizeText(item.removeStatus),
          status: item.status || "",
          skcSiteStatus: normalizeText(item.skcSiteStatus),
          flowLimitStatus: normalizeText(item.flowLimitStatus),
          skuSummaries: normalizedSkuSummaries,
          todaySales: item.todaySales || 0,
          totalSales: item.totalSales || 0,
          last7DaysSales: item.last7DaysSales || 0,
          syncedAt: item.syncedAt || "",
        });

        product.title = item.title || product.title;
        product.category = item.category || product.category;
        product.categories = item.categories || product.categories;
        product.spuId = normalizeText(item.spuId) || product.spuId;
        product.skcId = normalizeText(item.skcId) || product.skcId;
        product.goodsId = normalizeText(item.goodsId) || product.goodsId;
        product.sku = item.sku || product.sku;
        product.extCode = item.extCode || product.extCode || product.sku;
        product.imageUrl = normalizeImageUrl(item.imageUrl) || product.imageUrl || normalizedSkuSummaries[0]?.thumbUrl || "";
        product.siteLabel = item.siteLabel || product.siteLabel;
        product.productType = item.productType || product.productType;
        product.sourceType = item.sourceType || product.sourceType;
        product.removeStatus = normalizeText(item.removeStatus) || product.removeStatus;
        product.status = item.status || product.status;
        product.skcSiteStatus = normalizeText(item.skcSiteStatus) || product.skcSiteStatus;
        product.flowLimitStatus = normalizeText(item.flowLimitStatus) || product.flowLimitStatus;
        product.skuSummaries = normalizeSkuSummaryList([
          ...product.skuSummaries,
          ...normalizedSkuSummaries,
        ]);
        product.todaySales = toNumberValue(item.todaySales) || product.todaySales;
        product.totalSales = toNumberValue(item.totalSales) || product.totalSales;
        product.last7DaysSales = toNumberValue(item.last7DaysSales) || product.last7DaysSales;
        product.syncedAt = item.syncedAt || product.syncedAt;
        register(product);
      });

      salesItems.forEach((item: any) => {
        const product = ensureProduct({
          title: item.title || "",
          category: item.category || "",
          spuId: normalizeText(item.spuId),
          skcId: normalizeText(item.skcId),
          goodsId: normalizeText(item.goodsId),
          sku: item.skuCode || "",
          extCode: item.skuCode || "",
          skuId: normalizeText(item.skuId),
          skuName: item.skuName || "",
          imageUrl: normalizeImageUrl(item.imageUrl),
          siteLabel: item.siteLabel || "",
          todaySales: item.todaySales || 0,
          last30DaysSales: item.last30DaysSales || 0,
          totalSales: item.totalSales || 0,
          last7DaysSales: item.last7DaysSales || 0,
          warehouseStock: item.warehouseStock || 0,
          occupyStock: item.occupyStock || 0,
          unavailableStock: item.unavailableStock || 0,
          lackQuantity: item.lackQuantity || 0,
          price: item.price || "",
          syncedAt: parsedSales?.syncedAt || "",
          stockStatus: item.stockStatus || "",
          supplyStatus: item.supplyStatus || "",
          hotTag: item.hotTag || "",
          availableSaleDays: item.availableSaleDays ?? "",
          asfScore: item.asfScore,
          buyerName: item.buyerName || "",
          buyerUid: item.buyerUid || "",
          commentNum: item.commentNum ?? 0,
          inBlackList: item.inBlackList || "",
          pictureAuditStatus: item.pictureAuditStatus || "",
          qualityAfterSalesRate: item.qualityAfterSalesRate ?? "",
          predictTodaySaleVolume: item.predictTodaySaleVolume ?? 0,
          sevenDaysSaleReference: item.sevenDaysSaleReference ?? 0,
          sevenDaysAddCartNum: item.sevenDaysAddCartNum ?? 0,
          hasSalesSnapshot: true,
        });

        const firstSalesRow = !salesMergedProducts.has(product);
        if (firstSalesRow) salesMergedProducts.add(product);

        product.title = product.title || item.title || "";
        product.category = product.category || item.category || "";
        product.spuId = product.spuId || normalizeText(item.spuId);
        product.skcId = product.skcId || normalizeText(item.skcId);
        product.goodsId = product.goodsId || normalizeText(item.goodsId);
        product.sku = mergeTextValue(product.sku, item.skuCode);
        product.extCode = mergeTextValue(product.extCode, item.skuCode || item.extCode);
        product.skuId = mergeTextValue(product.skuId, item.skuId);
        product.skuName = mergeTextValue(product.skuName, item.skuName);
        product.imageUrl = product.imageUrl || normalizeImageUrl(item.imageUrl);
        product.siteLabel = product.siteLabel || item.siteLabel || "";
        product.todaySales = firstSalesRow ? toNumberValue(item.todaySales) : product.todaySales + toNumberValue(item.todaySales);
        product.last7DaysSales = firstSalesRow ? toNumberValue(item.last7DaysSales) : product.last7DaysSales + toNumberValue(item.last7DaysSales);
        product.last30DaysSales = firstSalesRow ? toNumberValue(item.last30DaysSales) : product.last30DaysSales + toNumberValue(item.last30DaysSales);
        product.totalSales = firstSalesRow ? toNumberValue(item.totalSales) : product.totalSales + toNumberValue(item.totalSales);
        product.warehouseStock = firstSalesRow ? toNumberValue(item.warehouseStock) : product.warehouseStock + toNumberValue(item.warehouseStock);
        product.occupyStock = firstSalesRow ? toNumberValue(item.occupyStock) : product.occupyStock + toNumberValue(item.occupyStock);
        product.unavailableStock = firstSalesRow ? toNumberValue(item.unavailableStock) : product.unavailableStock + toNumberValue(item.unavailableStock);
        product.lackQuantity = firstSalesRow ? toNumberValue(item.lackQuantity) : product.lackQuantity + toNumberValue(item.lackQuantity);
        product.price = mergeTextValue(product.price, item.price);
        product.syncedAt = parsedSales?.syncedAt || product.syncedAt;
        product.stockStatus = item.stockStatus || product.stockStatus;
        product.supplyStatus = item.supplyStatus || product.supplyStatus;
        product.hotTag = mergeTextValue(product.hotTag, item.hotTag);
        product.availableSaleDays = mergeAvailableSaleDays(product.availableSaleDays, item.availableSaleDays);
        product.asfScore = item.asfScore ?? product.asfScore ?? "";
        product.buyerName = item.buyerName ?? product.buyerName ?? "";
        product.buyerUid = item.buyerUid ?? product.buyerUid ?? "";
        product.commentNum = Math.max(toNumberValue(product.commentNum), toNumberValue(item.commentNum));
        product.inBlackList = item.inBlackList || product.inBlackList || "";
        product.pictureAuditStatus = item.pictureAuditStatus ?? product.pictureAuditStatus ?? "";
        product.qualityAfterSalesRate = item.qualityAfterSalesRate ?? product.qualityAfterSalesRate ?? "";
        product.predictTodaySaleVolume = firstSalesRow
          ? toNumberValue(item.predictTodaySaleVolume)
          : (product.predictTodaySaleVolume ?? 0) + toNumberValue(item.predictTodaySaleVolume);
        product.sevenDaysSaleReference = firstSalesRow
          ? toNumberValue(item.sevenDaysSaleReference)
          : (product.sevenDaysSaleReference ?? 0) + toNumberValue(item.sevenDaysSaleReference);
        product.sevenDaysAddCartNum = firstSalesRow
          ? toNumberValue(item.sevenDaysAddCartNum)
          : (product.sevenDaysAddCartNum ?? 0) + toNumberValue(item.sevenDaysAddCartNum);
        product.hasSalesSnapshot = true;
        product.salesRaw = item.rawItem || product.salesRaw;
        product.salesRawSku = item.rawFirstSku || product.salesRawSku;
        if (Array.isArray(item.trendDaily) && item.trendDaily.length > 0) {
          product.trendDaily = item.trendDaily;
        }
        register(product);
      });

      parsedOrders.forEach((item: any) => {
        const product = ensureProduct({
          title: item.title || "",
          skcId: normalizeText(item.skcId),
          sku: item.skuCode || "",
          extCode: item.skuCode || "",
          imageUrl: normalizeImageUrl(item.imageUrl),
          pendingOrderCount: 0,
        });
        product.title = product.title || item.title || "";
        product.skcId = product.skcId || normalizeText(item.skcId);
        product.sku = product.sku || item.skuCode || "";
        product.extCode = product.extCode || item.skuCode || "";
        product.imageUrl = product.imageUrl || normalizeImageUrl(item.imageUrl);
        product.pendingOrderCount += 1;
        register(product);
      });

      // Build SKC -> high-price flow-limit map from flowPrice raw store
      // Shape can be either { flowPriceList: {result:{pageItems:[...]}} } (listener)
      // or { apis: [{path, data}] } (page-capture)
      const flowLimitMap = new Map<string, any>();
      try {
        const fp: any = rawFlowPrice;
        let items: any[] = [];
        const extractList = (node: any) => {
          const r = node?.result || node;
          return r?.pageItems || r?.list || r?.items || (Array.isArray(r) ? r : []);
        };
        if (fp?.flowPriceList) items = extractList(fp.flowPriceList);
        if ((!items || !items.length) && fp?.flowPriceOverview) items = extractList(fp.flowPriceOverview);
        if ((!items || !items.length) && Array.isArray(fp?.apis)) {
          for (const api of fp.apis) {
            const p = String(api?.path || "");
            if (p.includes("queryFullHighPriceFlowReduceList") || p.includes("highPriceFlowReduce") || p.includes("high/price")) {
              items = extractList(api.data);
              if (items?.length) break;
            }
          }
        }
        // Deep scan fallback
        if (!items || !items.length) {
          const walk = (obj: any, depth = 0) => {
            if (!obj || depth > 4 || items.length) return;
            if (Array.isArray(obj)) { obj.forEach((v) => walk(v, depth + 1)); return; }
            if (typeof obj === "object") {
              if (Array.isArray(obj.pageItems) && obj.pageItems.some((x: any) => x?.productSkcId || x?.skcId)) {
                items = obj.pageItems; return;
              }
              Object.values(obj).forEach((v) => walk(v, depth + 1));
            }
          };
          walk(fp);
        }
        if (Array.isArray(items)) {
          for (const it of items) {
            const skc = String(it?.productSkcId ?? it?.skcId ?? "").trim();
            if (skc) flowLimitMap.set(skc, it);
          }
        }
        console.log("[ProductList] flowLimitMap size:", flowLimitMap.size, "sample:", items?.[0]);
      } catch (e) { console.warn("[ProductList] flowPrice parse error", e); }

      // Apply operator(对接运营) from lifecycle + high-price flow limit
      const sampleProd = [...lookup.values()][0];
      if (sampleProd) console.log("[ProductList] sample product keys:", { skcId: sampleProd.skcId, goodsId: (sampleProd as any).goodsId, productId: (sampleProd as any).productId });
      let opHits = 0;
      for (const product of lookup.values()) {
        const skc = product.skcId ? String(product.skcId) : "";
        const gid = (product as any).goodsId ? String((product as any).goodsId) : "";
        const pid = (product as any).productId ? String((product as any).productId) : "";
        const contact =
          (skc && operatorMap.get(skc)) ||
          (gid && operatorByGoodsId.get(gid)) ||
          (pid && operatorByProductId.get(pid)) ||
          "";
        const nick =
          (skc && operatorNickMap.get(skc)) ||
          (gid && operatorNickByGoodsId.get(gid)) ||
          (pid && operatorNickByProductId.get(pid)) ||
          "";
        if (contact) { product.operatorContact = contact; opHits++; }
        if (nick) { product.operatorNick = nick; }
        if (skc && flowLimitMap.has(skc)) {
          product.highPriceFlowLimit = true;
          product.highPriceFlowInfo = flowLimitMap.get(skc);
        } else if (skc && skcLimitMap.has(skc)) {
          product.highPriceFlowLimit = true;
          product.highPriceFlowInfo = skcLimitMap.get(skc);
        }
      }

      console.log("[ProductList] operator hits:", opHits, "/", lookup.size);
      const mergedProducts: ProductItem[] = [];
      const seen = new Set<ProductItem>();
      for (const item of lookup.values()) {
        if (seen.has(item)) continue;
        seen.add(item);
        if (!item.title && !item.skcId && !item.goodsId && !item.spuId) continue;
        mergedProducts.push(item);
      }

      mergedProducts.sort(compareCloudProductOrder);

      // 把云舵 listOverall 数据按 skcId 注入到每个 product 上
      if (yunduSkcMap.size > 0) {
        for (const p of mergedProducts) {
          const key = p.skcId ? String(p.skcId) : "";
          if (key && yunduSkcMap.has(key)) {
            (p as any).yundu = yunduSkcMap.get(key);
          }
        }
      }

      // 全球业务表现 注入
      if (gpSkcMap.size > 0) {
        for (const p of mergedProducts) {
          const key = p.skcId ? String(p.skcId) : "";
          if (key && gpSkcMap.has(key)) {
            (p as any).gp = gpSkcMap.get(key);
          }
        }
      }

      const fluxSources: Array<{ siteKey: FluxSiteKey; siteLabel: string; parsed: typeof EMPTY_PARSED_FLUX }> = [
        { siteKey: "global", siteLabel: "全球", parsed: parsedFlux },
        { siteKey: "us", siteLabel: "美国", parsed: parsedFluxUS },
        { siteKey: "eu", siteLabel: "欧区", parsed: parsedFluxEU },
      ];
      const mallFallbackSources: Array<{ siteKey: FluxSiteKey; siteLabel: string; raw: any }> = [
        { siteKey: "global", siteLabel: "全球", raw: preferredMallFlux },
        { siteKey: "us", siteLabel: "美国", raw: preferredMallFluxUS },
        { siteKey: "eu", siteLabel: "欧区", raw: preferredMallFluxEU },
      ];

      if (
        fluxSources.some((item) => Array.isArray(item.parsed?.items) && item.parsed.items.length > 0)
        || mallFallbackSources.some((item) => Boolean(item.raw))
      ) {
        for (const product of mergedProducts) {
          const historyIdCandidates = [product.goodsId, product.skcId, product.spuId, product.skuId]
            .map((value) => String(value || "").trim())
            .filter(Boolean);
          const idCandidates = new Set(
            [...historyIdCandidates, product.sku, product.extCode]
              .map((value) => normalizeText(value))
              .filter(Boolean),
          );
          const fluxSites = fluxSources
            .map(({ siteKey, siteLabel, parsed }) => {
              const matchedByRange = Object.entries(parsed?.itemsByRange || {}).reduce<Record<string, any[]>>((accumulator, [label, items]) => {
                const matchedItems = (Array.isArray(items) ? items : []).filter((item: any) => matchesFluxRecord(item, idCandidates));
                if (matchedItems.length > 0) accumulator[label] = matchedItems;
                return accumulator;
              }, {});
              const availableRanges = sortFluxRangeLabels(Object.keys(matchedByRange));
              if (availableRanges.length === 0) return null;
              const primaryRangeLabel = availableRanges.includes(parsed?.primaryRangeLabel)
                ? parsed.primaryRangeLabel
                : availableRanges[0];
              const summaryByRange = Object.fromEntries(
                availableRanges.map((label) => [
                  label,
                  summarizeFluxItems(matchedByRange[label] || [], siteKey, siteLabel, parsed?.syncedAt || ""),
                ]),
              ) as Record<string, ProductTrafficSummary>;

              return {
                siteKey,
                siteLabel,
                syncedAt: parsed?.syncedAt || "",
                summary: summaryByRange[primaryRangeLabel] || null,
                summaryByRange,
                items: matchedByRange[primaryRangeLabel] || [],
                itemsByRange: matchedByRange,
                availableRanges,
                primaryRangeLabel,
              } satisfies ProductFluxSiteData;
            })
            .map((site: ProductFluxSiteData | null, index) => {
              const { siteKey, siteLabel, parsed } = fluxSources[index];
              const cacheFallback = buildFluxHistoryFallbackSite(
                mergedFluxProductCache,
                historyIdCandidates,
                siteKey,
                siteLabel,
                site?.syncedAt || parsed?.syncedAt || "",
              );
              const mallFallback = buildMallFallbackFluxSite(
                mallFallbackSources.find((item) => item.siteKey === siteKey)?.raw,
                siteKey,
                siteLabel,
              );
              return mergeFluxSiteData(mergeFluxSiteData(site, cacheFallback), mallFallback);
            })
            .filter((site): site is ProductFluxSiteData => Boolean(site));

          for (const fallbackSource of mallFallbackSources) {
            if (fluxSites.some((site) => site.siteKey === fallbackSource.siteKey)) continue;
            const cacheFallback = buildFluxHistoryFallbackSite(
              mergedFluxProductCache,
              historyIdCandidates,
              fallbackSource.siteKey,
              fallbackSource.siteLabel,
            );
            const fallback = buildMallFallbackFluxSite(fallbackSource.raw, fallbackSource.siteKey, fallbackSource.siteLabel);
            const mergedFallback = mergeFluxSiteData(cacheFallback, fallback);
            if (mergedFallback) fluxSites.push(mergedFallback);
          }

          if (fluxSites.length > 0) {
            product.fluxSites = fluxSites;
            const globalFlux = fluxSites.find((item) => item.siteKey === "global") || fluxSites[0];
            product.fluxItems = globalFlux?.items || [];
            product.fluxSyncedAt = globalFlux?.syncedAt || "";
          } else if ((product as any).gp) {
            const fallbackSite = buildGpFallbackFluxSite((product as any).gp);
            if (fallbackSite) {
              product.fluxSites = [fallbackSite];
              product.fluxItems = fallbackSite.items || [];
              product.fluxSyncedAt = fallbackSite.syncedAt || "";
            }
          }
        }
      }

      for (const product of mergedProducts) {
        if (Array.isArray(product.fluxSites) && product.fluxSites.length > 0) continue;
        if (!(product as any).gp) continue;
        const fallbackSite = buildGpFallbackFluxSite((product as any).gp);
        if (!fallbackSite) continue;
        product.fluxSites = [fallbackSite];
        product.fluxItems = fallbackSite.items || [];
        product.fluxSyncedAt = fallbackSite.syncedAt || "";
      }

      setProducts(mergedProducts);
      setFluxHistoryData(Array.isArray(rawFluxHistory) ? rawFluxHistory : []);
      setProductHistoryCache(mergedFluxProductCache);
    } catch (error) {
      console.error("加载商品失败", error);
      setProducts([]);
      setFluxHistoryData([]);
      setProductHistoryCache({});
      setSalesSummary(null);
      setCountSummary(EMPTY_COUNT_SUMMARY);
      setDiagnostics(null);
      setSourceState(EMPTY_SOURCES);
    } finally {
      loadProductsInFlightRef.current = false;
      setLoading(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const keyword = normalizeLookupValue(searchText);
    return products.filter((product) => {
      const matchKeyword = !keyword || buildSearchIndex(product).includes(keyword);
      const statusText = product.status || normalizeStatusText(product.removeStatus);
      const siteStatus = normalizeStatusText(product.skcSiteStatus);
      let matchStatus = true;
      if (statusFilter === "在售") matchStatus = Boolean(product.hasSalesSnapshot);
      else if (statusFilter === "已下架") matchStatus = statusText === "已下架" || statusText === "已下架/已终止";
      else if (statusFilter === "未发布") matchStatus = siteStatus === "未发布到站点" || statusText === "未发布到站点";
      else if (statusFilter === "other") matchStatus = !["在售", "已下架", "已下架/已终止", "未发布到站点"].includes(statusText || "");
      else if (statusFilter === "saleOut") {
        const raw = (product.salesRaw || {}) as any;
        matchStatus = Boolean(raw.isSaleOut || raw.isCompletelySoldOut || (product.warehouseStock || 0) === 0);
      } else if (statusFilter === "soonSaleOut") {
        const days = Number(product.availableSaleDays);
        matchStatus = Number.isFinite(days) && days > 0 && days < 7;
      } else if (statusFilter === "shortage") {
        matchStatus = (product.lackQuantity || 0) > 0;
      } else if (statusFilter === "advice") {
        const raw = (product.salesRaw || {}) as any;
        matchStatus = Boolean(raw.isAdviceStock);
      }
      return matchKeyword && matchStatus;
    });
  }, [products, searchText, statusFilter]);

  // 优先用合并后的真实 products 数（含 sales-only 条目），countSummary 仅作 fallback
  const totalProducts = Math.max(products.length, countSummary.totalCount || 0);
  const total7dSales = products.reduce((sum, product) => sum + (product.last7DaysSales || 0), 0);
  void total7dSales; // 保留
  const totalSales = products.reduce((sum, product) => sum + (product.totalSales || 0), 0);
  void totalSales; // 保留
  const onSaleCount = salesSummary?.addedToSiteSkcNum || products.filter((product) => product.hasSalesSnapshot).length;
  const latestSyncedAt = cloudProductMeta.latestAt || getLatestSyncedAt(products, diagnostics);
  const salesAttachedCount = cloudSalesMap.size;

  const dataIssues = cloudProductMeta.error
    ? [`云端商品数据读取失败：${cloudProductMeta.error}`]
    : (products.length > 0 && cloudActivityCount === 0)
      ? ["云端暂无活动快照：需要扩展采集命中活动、营销、报名、竞价相关接口"]
    : [];

  const metricColor = (value: unknown, base = "var(--color-success)", zeroColor = "var(--color-text-muted)", positiveWeight = 600) => {
    const num = optionalNumber(value);
    if (num === null) return { color: "#bfbfbf", fontWeight: 400 };
    return { color: num > 0 ? base : zeroColor, fontWeight: num > 0 ? positiveWeight : 400 };
  };

  // 一个商品一行；每行内部把 SKU 列表作为 _skuRows 保留，供列渲染时纵向堆叠。
  // 第一条永远是 "合计" 汇总行。
  const tableRows = useMemo(() => {
    return filteredProducts.map((product, productIdx) => {
      const skuList: any[] = Array.isArray(product.salesRaw?.skuQuantityDetailList)
        ? product.salesRaw.skuQuantityDetailList
        : [];
      const groupKey = [product.mallId, product.skcId || product.goodsId || product.spuId || product.title || `p${productIdx}`].filter(Boolean).join("|");

      const totalInfo = product.salesRaw?.skuQuantityTotalInfo || {};
      const inventoryInfo = totalInfo?.inventoryNumInfo || {};
      const productToday = optionalNumber(product.cloudSales?.today_sales ?? totalInfo.todaySaleVolume);
      const product7d = optionalNumber(product.cloudSales?.last7d_sales ?? totalInfo.lastSevenDaysSaleVolume);
      const product30d = optionalNumber(product.cloudSales?.last30d_sales ?? totalInfo.lastThirtyDaysSaleVolume);
      const productStock = optionalNumber(product.cloudSales?.warehouse_stock ?? inventoryInfo.warehouseInventoryNum);
      const productOccupy = occupiedInventoryNumber(inventoryInfo.expectedOccupiedInventoryNum, inventoryInfo.normalLockNumber, product.cloudSales?.occupy_stock);
      const productUnavail = optionalNumber(product.cloudSales?.unavailable_stock ?? inventoryInfo.unavailableWarehouseInventoryNum);
      const productInTransit = optionalNumber(inventoryInfo.waitReceiveNum);
      const productLack = optionalNumber(totalInfo.lackQuantity);
      const productAdvice = optionalNumber(product.cloudSales?.advice_qty ?? totalInfo.adviceQuantity);

      const isSingle = skuList.length === 1;
      const baseSkuRows = skuList.length > 0
        ? skuList.map((sku: any, idx: number) => {
            const skuToday = optionalNumber(sku?.todaySaleVolume);
            const sku7d = optionalNumber(sku?.lastSevenDaysSaleVolume);
            const sku30d = optionalNumber(sku?.lastThirtyDaysSaleVolume);
            const skuInventoryInfo = sku?.inventoryNumInfo || {};
            const skuStock = optionalNumber(skuInventoryInfo.warehouseInventoryNum ?? sku?.warehouseInventoryNum ?? sku?.sellerWhStock);
            const skuOccupy = occupiedInventoryNumber(skuInventoryInfo.expectedOccupiedInventoryNum, skuInventoryInfo.normalLockNumber);
            const skuUnavail = optionalNumber(skuInventoryInfo.unavailableWarehouseInventoryNum);
            const skuInTransit = optionalNumber(skuInventoryInfo.waitReceiveNum);
            const skuLack = optionalNumber(sku?.lackQuantity);
            const skuAdvice = optionalNumber(sku?.adviceQuantity);
            // 单 SKU 商品：若 SKU 自身无数据则用商品级兜底
            const fb = (skuVal: number | null, prodVal: any) => (isSingle && skuVal === null ? optionalNumber(prodVal) : skuVal);
            return {
              _skuKey: `${groupKey}-sku-${sku?.productSkuId || idx}`,
              skuId: sku?.productSkuId || "",
              skuSpec: sku?.className || "",
              skuExtCode: sku?.skuExtCode || "",
              skuPrice: formatSkuSupplierPrice(sku?.supplierPrice, product.price),
              today: fb(skuToday, productToday),
              d7: fb(sku7d, product7d),
              d30: fb(sku30d, product30d),
              stock: fb(skuStock, productStock),
              occupy: fb(skuOccupy, productOccupy),
              unavail: fb(skuUnavail, productUnavail),
              inTransit: fb(skuInTransit, productInTransit),
              lack: fb(skuLack, productLack),
              advice: fb(skuAdvice, productAdvice),
            };
          })
        : [{
            _skuKey: `${groupKey}-product`,
            skuId: product.skuId || "",
            skuSpec: product.skuName || "",
            skuExtCode: product.extCode || "",
            skuPrice: product.price,
            today: productToday,
            d7: product7d,
            d30: product30d,
            stock: productStock,
            occupy: productOccupy,
            unavail: productUnavail,
            inTransit: productInTransit,
            lack: productLack,
            advice: productAdvice,
          }];

      const productActivitySkuRows = filterActivitySkuPriceRows(
        (product.cloudActivities || []).flatMap((activity) => extractActivitySkuPriceRows(activity, product)),
        "all",
      );
      const productActivitySignalRows = filterActivitySkuPriceRows(
        (product.cloudActivities || []).flatMap((activity) => extractActivitySkuCandidateRows(activity, product)),
        "all",
      );
      const realSkus = baseSkuRows.map((sku) => ({
        ...sku,
        activityRows: pickSkuActivityRows(productActivitySkuRows, sku, baseSkuRows.length),
        activitySignalRows: pickSkuActivityRows(productActivitySignalRows, sku, baseSkuRows.length),
      }));

      // 汇总行：优先用 SKU 加总，若 SKU 里该字段全为 0 则回退到商品级总值
      const sum = (pick: (s: any) => unknown) => {
        let hasValue = false;
        const total = realSkus.reduce((acc, s) => {
          const value = optionalNumber(pick(s));
          if (value === null) return acc;
          hasValue = true;
          return acc + value;
        }, 0);
        return hasValue ? total : null;
      };
      const sumOrFallback = (pick: (s: any) => unknown, fallback: number | null) => {
        const v = sum(pick);
        return v !== null ? v : fallback;
      };
      const totalRow = {
        _skuKey: `${groupKey}-total`,
        _isTotal: true,
        skuId: "",
        skuSpec: "合计",
        skuExtCode: "",
        skuPrice: "",
        today: sumOrFallback((s) => s.today, productToday),
        d7: sumOrFallback((s) => s.d7, product7d),
        d30: sumOrFallback((s) => s.d30, product30d),
        stock: sumOrFallback((s) => s.stock, productStock),
        occupy: sumOrFallback((s) => s.occupy, productOccupy),
        unavail: sumOrFallback((s) => s.unavail, productUnavail),
        inTransit: sumOrFallback((s) => s.inTransit, productInTransit),
        lack: sumOrFallback((s) => s.lack, productLack),
        advice: sumOrFallback((s) => s.advice, productAdvice),
      };

      const skuRows = [...realSkus, totalRow];

      return {
        ...product,
        _flatKey: groupKey,
        _skuRows: skuRows,
        _skuCount: skuRows.length,
      };
    });
  }, [filteredProducts]);

  const renderSkuActivityCard = (record: ProductItem, sku: any) => {
    const rows: ActivitySkuPriceRow[] = Array.isArray(sku.activityRows) ? sku.activityRows : [];
    const signalRows: ActivitySkuPriceRow[] = Array.isArray(sku.activitySignalRows) ? sku.activitySignalRows : [];
    if (sku._isTotal || (rows.length === 0 && signalRows.length === 0)) return null;
    const row = rows[0] || signalRows[0];
    const costCents = 0;
    const activityPriceCents = activityRowDisplayPriceCents(row);
    const minProfitCents = activityPriceCents !== null ? Math.max(0, activityPriceCents - costCents) : null;
    const profitRate = activityPriceCents && activityPriceCents > 0
      ? Math.max(0, Math.min(100, ((activityPriceCents - costCents) / activityPriceCents) * 100))
      : null;
    return (
      <button
        type="button"
        className="product-sku-activity-card"
        onClick={(event) => {
          event.stopPropagation();
          setActivityDetailFilter("all");
          setActivityDetailSku({
            skuId: sku.skuId,
            skuExtCode: sku.skuExtCode,
            skuSpec: sku.skuSpec,
          });
          setActivityDetailProduct(record);
        }}
      >
        <span className="product-sku-activity-card__head">
          <span>已报名活动</span>
        </span>
        <span className="product-sku-activity-card__line">
          <span>成本价 <span className="product-sku-activity-card__edit">编辑</span></span>
          <strong>{formatActivityMoneyCompact(costCents, row.currency)}</strong>
        </span>
        <span className="product-sku-activity-card__line">
          <span>活动价</span>
          <strong className="is-primary">{formatActivityMoneyCompact(activityPriceCents, row.currency)}</strong>
        </span>
        <span className="product-sku-activity-card__line">
          <span>活动最低利润</span>
          <strong className="is-success">{formatActivityMoneyCompact(minProfitCents, row.currency)}</strong>
        </span>
        <span className="product-sku-activity-card__line">
          <span>利润率</span>
          <strong className="is-danger">{profitRate === null ? "-" : `${profitRate.toFixed(2)}%`}</strong>
        </span>
      </button>
    );
  };

  const columns: ColumnsType<ProductItem> = [
    {
      title: "商品图片",
      key: "imageUrl",
      width: 96,
      fixed: "left",
      render: (_: any, record: ProductItem) => {
        const url = normalizeImageUrl(record.imageUrl);
        return url ? (
          <div onClick={(e) => e.stopPropagation()} style={{ display: "inline-block" }}>
            <Image src={url} width={80} height={80} style={{ objectFit: "cover", borderRadius: 8 }} preview={{ mask: false }} fallback={EMPTY_IMAGE_FALLBACK} />
          </div>
        ) : (
          <div style={{ width: 80, height: 80, background: "#f8fbff", border: "1px solid var(--color-border)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><PictureOutlined /></div>
        );
      },
    },
    {
      title: "商品信息",
      dataIndex: "title",
      key: "title",
      width: 420,
      fixed: "left",
      render: (text: string, record: any) => {
        const raw = record.salesRaw || {};
        const y = record.yundu;
        const gp = record.gp;
        const score = raw.productReviewScore ?? raw.goodsScore ?? raw.score ?? raw.avgScore;
        const comment = record.commentNum ?? raw.commentNum;
        const productDays = raw.productDays ?? raw.onSalesDurationOffline ?? raw.addSiteDays ?? raw.addedToSiteDays ?? raw.onSiteDays ?? raw.onShelfDays ?? raw.listedDays ?? raw.siteOnlineDays ?? raw.launchDays ?? raw.daysSinceAdd;
        const seasonTag = raw.festivalSeasonTag || raw.seasonTag || raw.festivalTag;
        const stockOut = (record.stockStatus || "").includes("断货") || raw.stockStatus === "SOLD_OUT";
        const tags: string[] = y?.tagList || [];
        const statusTags: string[] = y?.statusTags || [];
        const sites: any[] = y?.addedSiteList || [];
        const offSites: any[] = y?.onceAddSiteList || [];
        const siteName = (s: any) => s?.siteName || s?.regionName || s?.name || s?.code || (typeof s === "string" ? s : "?");
        const buyerLine = y?.buyerName || record.operatorContact || record.operatorNick;

        return (
          <div style={{ fontSize: 14, lineHeight: 1.55 }}>
            <Tooltip title={text || "-"} placement="topLeft">
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {text || "-"}
              </div>
            </Tooltip>
            {getPrimaryCategory(record) && <div style={{ color: "var(--color-text-muted)" }}>{getPrimaryCategory(record)}</div>}
            {(score != null || comment != null) && (
              <div style={{ color: "#fbbc04" }}>
                {score != null ? <span>★ {score}分</span> : <span style={{ color: "var(--color-text-muted)" }}>暂无评分</span>}
                {comment != null && <span style={{ color: "var(--color-text-muted)" }}> · 评论 {comment}</span>}
              </div>
            )}
            {record.skcId && <div style={{ color: "var(--color-text-muted)" }}>SKC：<span style={{ fontFamily: "monospace" }}>{record.skcId}</span></div>}
            {record.mallId && <div style={{ color: "var(--color-text-muted)" }}>店铺：<span style={{ fontFamily: "monospace" }}>{record.mallId}</span></div>}
            {productDays != null && productDays !== "" && <div style={{ color: "var(--color-text-muted)" }}>加入站点时长：{productDays}天</div>}
            {record.spuId && <div style={{ color: "var(--color-text-muted)" }}>SPU：<span style={{ fontFamily: "monospace" }}>{record.spuId}</span></div>}
            {seasonTag && <div style={{ color: "var(--color-text-muted)" }}>节日/季节标签：{seasonTag}</div>}

            {/* 状态标签行 */}
            <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 3 }}>
              {stockOut && <Tag color="red" style={{ fontSize: 12, margin: 0 }}>已断货</Tag>}
              {(record.hotTag === "true" || raw.hotTag === true) && <Tag color="volcano" style={{ fontSize: 12, margin: 0 }}>🔥 热销款</Tag>}
              {raw.isAdProduct && <Tag color="blue" style={{ fontSize: 12, margin: 0 }}>广告</Tag>}
              {tags.map((t, i) => <Tag key={`yt${i}`} color="red" style={{ fontSize: 12, margin: 0 }}>{t}</Tag>)}
              {statusTags.map((t, i) => <Tag key={`ys${i}`} color="volcano" style={{ fontSize: 12, margin: 0 }}>{t}</Tag>)}
              {(y?.punishList || []).slice(0, 2).map((p: any, i: number) => (
                <Tag key={`pn${i}`} color="red" style={{ fontSize: 12, margin: 0 }}>处罚:{p.reason || p.type}</Tag>
              ))}
              {(record.cloudRisks || []).slice(0, 3).map((risk: TemuOperationRiskRow, i: number) => (
                <Tooltip key={risk.id || risk.risk_key || `risk-${i}`} title={risk.risk_title || risk.order_id || risk.risk_key}>
                  <Tag color={operationRiskColor(risk.severity)} style={{ fontSize: 12, margin: 0 }}>
                    {operationRiskLabel(risk.risk_type)}
                  </Tag>
                </Tooltip>
              ))}
              {(record.cloudRisks || []).length > 3 ? (
                <Tag color="red" style={{ fontSize: 12, margin: 0 }}>风险+{(record.cloudRisks || []).length - 3}</Tag>
              ) : null}
              {(record.cloudStockOrders || []).length > 0 ? (
                <Tag color={(record.cloudStockOrders || []).some((row: TemuStockOrderRow) => isPendingBusinessStatus(row.temu_status)) ? "orange" : "blue"} style={{ fontSize: 12, margin: 0 }}>
                  备货{(record.cloudStockOrders || []).length}
                </Tag>
              ) : null}
              {(record.cloudAfterSales || []).length > 0 ? (
                <Tag color={(record.cloudAfterSales || []).some((row: TemuAfterSaleRow) => isPendingBusinessStatus(row.status)) ? "red" : "orange"} style={{ fontSize: 12, margin: 0 }}>
                  售后{(record.cloudAfterSales || []).length}
                </Tag>
              ) : null}
            </div>

            {/* 云舵卡区块 */}
            {(y || gp) && (
              <div style={{ marginTop: 5, padding: "5px 8px", background: "#f8fbff", borderRadius: 6, border: "1px solid var(--color-border)", fontSize: 13, lineHeight: 1.55 }}>
                {buyerLine && <div><span style={{ color: "#888" }}>买手：</span><Tag color="orange" style={{ fontSize: 12, margin: 0 }}>{buyerLine}</Tag></div>}
                {y?.category && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                    <span style={{ color: "#888", flexShrink: 0 }}>类目：</span>
                    <Tooltip title={y.category}><span style={{ flex: 1, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{y.category}</span></Tooltip>
                    <a style={{ fontSize: 12, color: "#1a73e8", flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(y.category); message.success("已复制"); }}>复制</a>
                  </div>
                )}
                {sites.length > 0 && (
                  <div><span style={{ color: "#888" }}>销售：</span><span style={{ color: "#1a73e8" }}>{sites.slice(0, 3).map(siteName).join("，")}</span>{sites.length > 3 && <Tag color="blue" style={{ fontSize: 12, marginLeft: 4 }}>共 {sites.length} 站</Tag>}</div>
                )}
                {offSites.length > 0 && (
                  <div><span style={{ color: "var(--color-text-muted)" }}>下架：</span><span style={{ color: "var(--color-text-muted)" }}>{offSites.slice(0, 3).map(siteName).join("，")}{offSites.length > 3 ? `…` : ""}</span></div>
                )}
                {gp && (
                  <div style={{ textAlign: "right" }}>
                    <a style={{ fontSize: 13, color: "#1a73e8" }} onClick={(e) => { e.stopPropagation(); openGpDetail(record); }}>动销详情 →</a>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: "SKU信息",
      key: "skuId",
      width: 170,
      render: (_: any, record: any) => (
        <div className="sku-stack">
          {(record._skuRows || []).map((s: any) => {
            const hasActivity = !s._isTotal && (
              (Array.isArray(s.activityRows) && s.activityRows.length > 0)
              || (Array.isArray(s.activitySignalRows) && s.activitySignalRows.length > 0)
            );
            return (
              <div className={`sku-cell${s._isTotal ? " sku-cell-total" : ""}${hasActivity ? " sku-cell--with-activity" : ""}`} key={s._skuKey}>
                {s._isTotal ? (
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>合计</span>
                ) : (
                  <div className="product-sku-cell-content">
                    {s.skuId
                      ? <span className="product-sku-id">{s.skuId}</span>
                      : <span style={{ color: "#bfbfbf" }}>-</span>}
                    {renderSkuActivityCard(record, s)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ),
    },
    {
      title: "规格",
      key: "skuSpec",
      width: 140,
      render: (_: any, record: any) => (
        <div className="sku-stack">
          {(record._skuRows || []).map((s: any) => (
            <div className={`sku-cell${s._isTotal ? " sku-cell-total" : ""}`} key={s._skuKey}>
              {s._isTotal
                ? <span style={{ color: "#bfbfbf" }}>—</span>
                : s.skuSpec
                  ? <span style={{ fontSize: 14, color: "#262626" }}>{s.skuSpec}</span>
                  : <span style={{ color: "#bfbfbf" }}>-</span>}
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "货号",
      key: "skuExtCode",
      width: 140,
      render: (_: any, record: any) => (
        <div className="sku-stack">
          {(record._skuRows || []).map((s: any) => (
            <div className={`sku-cell${s._isTotal ? " sku-cell-total" : ""}`} key={s._skuKey}>
              {s._isTotal
                ? <span style={{ color: "#bfbfbf" }}>—</span>
                : s.skuExtCode
                  ? <span style={{ fontSize: 13, color: "#262626", fontFamily: "monospace" }}>{s.skuExtCode}</span>
                  : <span style={{ color: "#bfbfbf" }}>-</span>}
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "申报价格",
      key: "price",
      width: 110,
      align: "center",
      render: (_: any, record: any) => (
        <div className="sku-stack">
          {(record._skuRows || []).map((s: any) => (
            <div className={`sku-cell${s._isTotal ? " sku-cell-total" : ""}`} key={s._skuKey} style={{ justifyContent: "center" }}>
              {s._isTotal
                ? <span style={{ color: "#bfbfbf" }}>—</span>
                : <span style={{ fontSize: 15, color: "#d4380d", fontWeight: 600 }}>¥{formatTextValue(s.skuPrice)}</span>}
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "今日销量",
      key: "todaySales",
      width: 95,
      align: "right",
      sorter: (a: any, b: any) => (a.todaySales || 0) - (b.todaySales || 0),
      render: (_: any, record: any) => (
        <div className="sku-stack">
          {(record._skuRows || []).map((s: any) => (
            <div className={`sku-cell${s._isTotal ? " sku-cell-total" : ""}`} key={s._skuKey} style={{ justifyContent: "center" }}>
              <span style={{ fontSize: 15, ...metricColor(s.today) }}>{formatOptionalNumber(s.today)}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "7天销量",
      key: "last7DaysSales",
      width: 95,
      align: "right",
      sorter: (a: any, b: any) => (a.last7DaysSales || 0) - (b.last7DaysSales || 0),
      render: (_: any, record: any) => (
        <div className="sku-stack">
          {(record._skuRows || []).map((s: any) => (
            <div className={`sku-cell${s._isTotal ? " sku-cell-total" : ""}`} key={s._skuKey} style={{ justifyContent: "center" }}>
              <span style={{ fontSize: 15, ...metricColor(s.d7) }}>{formatOptionalNumber(s.d7)}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "30天销量",
      key: "last30DaysSales",
      width: 100,
      align: "right",
      sorter: (a: any, b: any) => (a.last30DaysSales || 0) - (b.last30DaysSales || 0),
      defaultSortOrder: "descend",
      render: (_: any, record: any) => (
        <div className="sku-stack">
          {(record._skuRows || []).map((s: any) => (
            <div className={`sku-cell${s._isTotal ? " sku-cell-total" : ""}`} key={s._skuKey} style={{ justifyContent: "center" }}>
              <span style={{ fontSize: 15, ...metricColor(s.d30) }}>{formatOptionalNumber(s.d30)}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "总销量",
      dataIndex: "totalSales",
      key: "totalSales",
      width: 110,
      align: "center",
      sorter: (a: any, b: any) => (a.totalSales || 0) - (b.totalSales || 0),
      render: (_val: number, record: any) => {
        const value = optionalNumber(record.cloudSales?.total_sales ?? record.salesRaw?.skuQuantityTotalInfo?.totalSaleVolume);
        return <span style={{ fontSize: 18, fontWeight: value !== null && value > 0 ? 700 : 400, color: value !== null && value > 0 ? "#1a73e8" : "#bfbfbf" }}>{formatOptionalNumber(value)}</span>;
      },
    },
    {
      title: "仓内可用库存",
      key: "warehouseStock",
      width: 140,
      align: "right",
      sorter: (a: any, b: any) => (a.warehouseStock || 0) - (b.warehouseStock || 0),
      render: (_: any, record: any) => (
        <div className="sku-stack">
          {(record._skuRows || []).map((s: any) => (
            <div className={`sku-cell${s._isTotal ? " sku-cell-total" : ""}`} key={s._skuKey} style={{ justifyContent: "center" }}>
              <span style={{ fontSize: 15, ...metricColor(s.stock, "#1a73e8", "#ea4335") }}>{formatOptionalNumber(s.stock)}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "仓内预占用库存",
      key: "occupy",
      width: 150,
      align: "center",
      render: (_: any, record: any) => (
        <div className="sku-stack">
          {(record._skuRows || []).map((s: any) => (
            <div className={`sku-cell${s._isTotal ? " sku-cell-total" : ""}`} key={s._skuKey} style={{ justifyContent: "center" }}>
              <span style={{ fontSize: 15, ...metricColor(s.occupy, "#08979c") }}>{formatOptionalNumber(s.occupy)}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "仓内暂不可用库存",
      key: "unavail",
      width: 160,
      align: "center",
      render: (_: any, record: any) => (
        <div className="sku-stack">
          {(record._skuRows || []).map((s: any) => (
            <div className={`sku-cell${s._isTotal ? " sku-cell-total" : ""}`} key={s._skuKey} style={{ justifyContent: "center" }}>
              <span style={{ fontSize: 15, ...metricColor(s.unavail, "#d46b08") }}>{formatOptionalNumber(s.unavail)}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "已发货库存",
      key: "inTransit",
      width: 130,
      align: "center",
      render: (_: any, record: any) => (
        <div className="sku-stack">
          {(record._skuRows || []).map((s: any) => (
            <div className={`sku-cell${s._isTotal ? " sku-cell-total" : ""}`} key={s._skuKey} style={{ justifyContent: "center" }}>
              <span style={{ fontSize: 15, ...metricColor(s.inTransit, "#1a73e8") }}>{formatOptionalNumber(s.inTransit)}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "缺货",
      key: "lackQuantity",
      width: 100,
      align: "center",
      render: (_: any, record: any) => (
        <div className="sku-stack">
          {(record._skuRows || []).map((s: any) => (
            <div className={`sku-cell${s._isTotal ? " sku-cell-total" : ""}`} key={s._skuKey} style={{ justifyContent: "center" }}>
              <span style={{ fontSize: 15, ...metricColor(s.lack, "var(--color-danger)", "var(--color-text-muted)", 700) }}>{formatOptionalNumber(s.lack)}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "建议备货",
      key: "advice",
      width: 120,
      align: "center",
      render: (_: any, record: any) => (
        <div className="sku-stack">
          {(record._skuRows || []).map((s: any) => (
            <div className={`sku-cell${s._isTotal ? " sku-cell-total" : ""}`} key={s._skuKey} style={{ justifyContent: "center" }}>
              <span style={{ fontSize: 15, ...metricColor(s.advice, "#d4380d", "#bfbfbf", 700) }}>{formatOptionalNumber(s.advice)}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "履约/售后",
      key: "fulfillment",
      width: 280,
      render: (_: any, record: ProductItem) => {
        const stockOrders: TemuStockOrderRow[] = Array.isArray(record.cloudStockOrders) ? record.cloudStockOrders : [];
        const afterSales: TemuAfterSaleRow[] = Array.isArray(record.cloudAfterSales) ? record.cloudAfterSales : [];
        if (stockOrders.length === 0 && afterSales.length === 0) return <span style={{ color: "#bfbfbf" }}>-</span>;
        const pendingStock = stockOrders.filter((row) => isPendingBusinessStatus(row.temu_status)).length;
        const pendingAfter = afterSales.filter((row) => isPendingBusinessStatus(row.status)).length;
        const demandQty = stockOrders.reduce((sum, row) => sum + Number(row.demand_qty || 0), 0);
        const deliveredQty = stockOrders.reduce((sum, row) => sum + Number(row.delivered_qty || 0), 0);
        const afterQty = afterSales.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
        const hasAfterAmount = afterSales.some((row) => row.amount_cents !== null && row.amount_cents !== undefined);
        const amountCents = afterSales.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
        const currency = afterSales.find((row) => row.currency)?.currency || "CNY";
        const latestStock = stockOrders[0];
        const latestAfter = afterSales[0];
        return (
          <Space direction="vertical" size={4} style={{ maxWidth: 260 }}>
            <Space size={4} wrap>
              {stockOrders.length ? <Tag color={pendingStock ? "orange" : "blue"}>备货 {pendingStock}/{stockOrders.length}</Tag> : null}
              {afterSales.length ? <Tag color={pendingAfter ? "red" : "orange"}>售后 {pendingAfter}/{afterSales.length}</Tag> : null}
            </Space>
            {stockOrders.length ? (
              <div style={{ fontSize: 12, color: "var(--color-text-sec)" }}>
                需求 {demandQty.toLocaleString("zh-CN")} / 已发 {deliveredQty.toLocaleString("zh-CN")}
              </div>
            ) : null}
            {afterSales.length ? (
              <div style={{ fontSize: 12, color: "var(--color-text-sec)" }}>
                售后件数 {afterQty.toLocaleString("zh-CN")} / 金额 {hasAfterAmount ? formatActivityMoney(amountCents, currency) : "-"}
              </div>
            ) : null}
            {latestStock ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {(latestStock.stock_order_no || latestStock.delivery_order_sn || latestStock.delivery_batch_sn || "-")} · {latestStock.temu_status || "-"}
              </Typography.Text>
            ) : null}
            {latestAfter ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {latestAfter.after_sale_type || "售后"} · {latestAfter.status || "-"}
              </Typography.Text>
            ) : null}
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: "auto", fontWeight: 600 }}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedProduct(record);
                setDrawerTab("fulfillment");
              }}
            >
              查看明细
            </Button>
          </Space>
        );
      },
    },
    {
      title: "操作",
      key: "actions",
      width: 110,
      fixed: "right",
      render: (_: any, record: any) => {
        return (
          <Space direction="vertical" size={2}>
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: "auto", fontWeight: 600, fontSize: 15 }}
              onClick={(event) => {
                event.stopPropagation();
                openCompetitorAnalysis(record);
              }}
            >
              竞品分析
            </Button>
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: "auto", fontWeight: 600, fontSize: 15 }}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedProduct(record);
                setDrawerTab("overview");
              }}
            >
              销售趋势
            </Button>
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: "auto", fontWeight: 600, fontSize: 15 }}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedProduct(record);
                setDrawerTab("flux");
              }}
            >
              流量分析
            </Button>
          </Space>
        );
      },
    },
    // ========== 云端 SKC 快照（按 skc_id 关联） ==========
    {
      title: "云端更新",
      key: "cloud_updated",
      width: 110,
      render: (_: any, record: any) => {
        const c = record.cloudSkc || cloudSkcMap.get(cloudKeyFromProduct(record));
        if (!c) return <span style={{ color: "#bfbfbf" }}>—</span>;
        const ts = c.last_updated_at;
        const ago = Math.round((Date.now() - ts) / 60000);
        return <Tooltip title={new Date(ts).toLocaleString()}><span>{ago < 1 ? "刚刚" : ago < 60 ? `${ago}分前` : ago < 1440 ? `${Math.round(ago / 60)}时前` : `${Math.round(ago / 1440)}天前`}</span></Tooltip>;
      },
    },
    {
      title: "云端申报价",
      key: "cloud_declared",
      width: 110,
      align: "right",
      render: (_: any, record: any) => {
        const c = record.cloudSkc || cloudSkcMap.get(cloudKeyFromProduct(record));
        const cents = c?.declared_price_cents;
        if (cents == null) return <span style={{ color: "#bfbfbf" }}>—</span>;
        return <span>{(cents / 100).toFixed(2)} {c?.price_currency || ""}</span>;
      },
    },
    {
      title: "建议价",
      key: "cloud_suggested",
      width: 110,
      align: "right",
      render: (_: any, record: any) => {
        const c = record.cloudSkc || cloudSkcMap.get(cloudKeyFromProduct(record));
        const cents = c?.suggested_price_cents;
        if (cents == null) return <span style={{ color: "#bfbfbf" }}>—</span>;
        return <span>{(cents / 100).toFixed(2)} {c?.price_currency || ""}</span>;
      },
    },
    {
      title: "申报价差",
      key: "cloud_gap",
      width: 90,
      align: "right",
      render: (_: any, record: any) => {
        const c = record.cloudSkc || cloudSkcMap.get(cloudKeyFromProduct(record));
        const d = c?.declared_price_cents;
        const s = c?.suggested_price_cents;
        if (d == null || s == null || s === 0) return <span style={{ color: "#bfbfbf" }}>—</span>;
        const ratio = (d - s) / s;
        return <Tag color={ratio > 0 ? "green" : ratio < 0 ? "red" : "default"}>{(ratio * 100).toFixed(1)}%</Tag>;
      },
    },
  ];

  // ============ 列配置（显示/隐藏 + 排序） ============
  const COLUMN_STORAGE_KEY = "product-list-column-config";
  const removedCloudColumnKeys = new Set(["cloud_updated", "cloud_declared", "cloud_suggested", "cloud_gap"]);
  const allColumnKeys = columns.map((c: any) => c.key as string).filter((key) => Boolean(key) && !removedCloudColumnKeys.has(key));

  // 列分组定义
  const columnGroups: Array<{ label: string; keys: string[] }> = [
    { label: "商品信息", keys: ["imageUrl", "title"] },
    { label: "SKU信息", keys: ["skuId", "skuSpec", "skuExtCode"] },
    { label: "申报价格", keys: ["price"] },
    { label: "销售数据", keys: ["todaySales", "last7DaysSales", "last30DaysSales", "totalSales"] },
    { label: "缺货数量", keys: ["lackQuantity"] },
    { label: "库存数据", keys: ["warehouseStock", "occupy", "unavail", "inTransit"] },
    { label: "备货履约", keys: ["advice", "fulfillment"] },
    { label: "其他", keys: ["actions"] },
  ];

  const [columnConfig, setColumnConfig] = useState<{ order: string[]; hidden: string[] }>(() => {
    try {
      const saved = localStorage.getItem(COLUMN_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // 迁移：旧版 skuInfo → 新版 skuId/skuSpec/skuExtCode
        const migrate = (arr: string[] = []) => {
          const out: string[] = [];
          for (const k of arr) {
            if (k === "skuInfo") {
              out.push("skuId", "skuSpec", "skuExtCode");
            } else {
              out.push(k);
            }
          }
          return out;
        };
        if (Array.isArray(parsed.order) && parsed.order.includes("skuInfo")) {
          parsed.order = migrate(parsed.order);
        }
        if (Array.isArray(parsed.hidden) && parsed.hidden.includes("skuInfo")) {
          parsed.hidden = migrate(parsed.hidden);
        }
        return parsed;
      }
    } catch (error) {
      // localStorage 列配置解析失败时回落到默认值
      console.warn("[ProductList] parse column settings failed", error);
    }
    return { order: allColumnKeys, hidden: [] };
  });
  const [colSettingsOpen, setColSettingsOpen] = useState(false);
  // 临时编辑状态（确认后才生效）
  const [tempHidden, setTempHidden] = useState<string[]>([]);
  const [tempOrder, setTempOrder] = useState<string[]>([]);

  // 持久化
  useEffect(() => {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columnConfig));
  }, [columnConfig]);

  // 打开时初始化临时状态
  const openColSettings = () => {
    setTempHidden([...columnConfig.hidden]);
    const order = [...columnConfig.order];
    for (const k of allColumnKeys) { if (!order.includes(k)) order.push(k); }
    setTempOrder(order);
    setColSettingsOpen(true);
  };

  // 根据配置过滤 + 排序列
  const configuredColumns = useMemo(() => {
    const colMap = new Map(columns.filter((c: any) => !removedCloudColumnKeys.has(c.key)).map((c: any) => [c.key, c]));
    const knownKeys = new Set(columnConfig.order);
    const mergedOrder = [...columnConfig.order, ...allColumnKeys.filter((k) => !knownKeys.has(k))];
    return mergedOrder
      .filter((key) => !columnConfig.hidden.includes(key) && colMap.has(key))
      .map((key) => colMap.get(key)!);
  }, [columns, columnConfig, allColumnKeys]);

  const tempToggle = (key: string) => {
    setTempHidden((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };

  const tempToggleGroup = (keys: string[]) => {
    const allVisible = keys.every((k) => !tempHidden.includes(k));
    if (allVisible) {
      setTempHidden((prev) => [...prev, ...keys]);
    } else {
      setTempHidden((prev) => prev.filter((k) => !keys.includes(k)));
    }
  };

  const tempMove = (key: string, dir: -1 | 1) => {
    setTempOrder((prev) => {
      const arr = [...prev];
      const idx = arr.indexOf(key);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= arr.length) return prev;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  };
  void tempMove; // 保留

  const confirmColSettings = () => {
    setColumnConfig({ order: tempOrder, hidden: tempHidden });
    setColSettingsOpen(false);
  };

  const resetColSettings = () => {
    setTempOrder([...allColumnKeys]);
    setTempHidden([]);
  };

  const visibleCount = allColumnKeys.filter((k) => !tempHidden.includes(k)).length;
  const allSelected = tempHidden.length === 0;

  const colMap = new Map(columns.filter((c: any) => !removedCloudColumnKeys.has(c.key)).map((c: any) => [c.key, c]));
  const activityDetailAllRows = useMemo(
    () => (Array.isArray(activityDetailProduct?.cloudActivities) ? activityDetailProduct.cloudActivities : []),
    [activityDetailProduct],
  );
  const activityDetailSkuCount = useMemo(() => {
    const skuList = Array.isArray(activityDetailProduct?.salesRaw?.skuQuantityDetailList)
      ? activityDetailProduct.salesRaw.skuQuantityDetailList
      : [];
    const summaryCount = Array.isArray(activityDetailProduct?.skuSummaries) ? activityDetailProduct.skuSummaries.length : 0;
    return Math.max(skuList.length, summaryCount, 1);
  }, [activityDetailProduct]);
  const activityDetailSkuAllRows = useMemo(
    () => {
      const rows = activityDetailAllRows.flatMap((row) => extractActivitySkuCandidateRows(row, activityDetailProduct));
      if (!activityDetailSku) return rows;
      return pickSkuActivityRows(rows, activityDetailSku, activityDetailSkuCount);
    },
    [activityDetailAllRows, activityDetailProduct, activityDetailSku, activityDetailSkuCount],
  );
  const activityDetailRows = useMemo(
    () => filterActivitySkuPriceRows(activityDetailSkuAllRows, activityDetailFilter),
    [activityDetailSkuAllRows, activityDetailFilter],
  );
  const activityDetailColumns = useMemo<ColumnsType<ActivitySkuPriceRow>>(() => [
    {
      title: "SKU属性集",
      key: "skuAttr",
      width: 150,
      render: (_value, row) => (
        <Typography.Text ellipsis={{ tooltip: row.skuAttr }} style={{ maxWidth: 142 }}>
          {row.skuAttr || "-"}
        </Typography.Text>
      ),
    },
    {
      title: "日常申报价",
      key: "dailyPrice",
      width: 112,
      align: "right",
      render: (_value, row) => {
        return formatActivityMoney(row.dailyPriceCents, row.currency);
      },
    },
    {
      title: "活动申报价",
      key: "signupPrice",
      width: 112,
      align: "right",
      render: (_value, row) => {
        return formatActivityMoney(activityRowDisplayPriceCents(row), row.currency);
      },
    },
    {
      title: "报名时间",
      key: "signupTime",
      width: 170,
      render: (_value, row) => row.signupTimeText,
    },
    {
      title: "活动类型",
      key: "activity",
      width: 500,
      render: (_value, row) => {
        const activityName = activityTableNameText(row.activity);
        return (
          <Typography.Text strong ellipsis={{ tooltip: activityName }} style={{ maxWidth: 480 }}>
            {activityName || "-"}
          </Typography.Text>
        );
      },
    },
    {
      title: "报名场次",
      key: "sessions",
      width: 360,
      render: (_value, row) => {
        const sessions = activitySessionTexts(row.activity);
        return (
          <Space direction="vertical" size={1} style={{ maxWidth: 340 }}>
            {sessions.length > 0 ? sessions.slice(0, 3).map((text, index) => (
              <Typography.Text key={`${row.id}-session-${index}`} style={{ fontSize: 12 }} ellipsis={{ tooltip: text }}>
                {text}
              </Typography.Text>
            )) : <span>-</span>}
            {sessions.length > 3 ? (
              <Tooltip title={<div>{sessions.slice(3).map((text, index) => <div key={index}>{text}</div>)}</div>}>
                <Button type="link" size="small" style={{ padding: 0, height: "auto" }}>更多</Button>
              </Tooltip>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: "活动库存",
      key: "activityStock",
      width: 96,
      align: "right",
      render: (_value, row) => {
        const value = activityRowStockValue(row);
        return value === null ? "-" : Number(value).toLocaleString("zh-CN");
      },
    },
    {
      title: "剩余数量",
      key: "remainingQty",
      width: 96,
      align: "right",
      render: (_value, row) => {
        const value = activityRowRemainingValue(row);
        return value === null ? "-" : Number(value).toLocaleString("zh-CN");
      },
    },
    {
      title: "活动状态",
      key: "status",
      width: 110,
      render: (_value, row) => {
        const status = activityDerivedStatusText(row.activity);
        return <Tag color={activityStatusColor(status)}>{status}</Tag>;
      },
    },
  ], [activityDetailProduct]);
  const activityCatalogSkuAllRows = useMemo(
    () => cloudActivityRows.flatMap((row) => extractActivitySkuCandidateRows(row, null)),
    [cloudActivityRows],
  );
  const activityCatalogRows = useMemo(
    () => filterActivitySkuPriceRows(activityCatalogSkuAllRows, activityCatalogFilter),
    [activityCatalogSkuAllRows, activityCatalogFilter],
  );
  const activityCatalogCounts = useMemo(() => ({
    all: activityCatalogSkuAllRows.length,
    running: filterActivitySkuPriceRows(activityCatalogSkuAllRows, "running").length,
    notStarted: filterActivitySkuPriceRows(activityCatalogSkuAllRows, "notStarted").length,
    linked: activityCatalogSkuAllRows.filter((row) => row.activity.skc_id || row.activity.product_id || row.activity.goods_id || row.skuId).length,
  }), [activityCatalogSkuAllRows]);
  const activityCatalogColumns = useMemo<ColumnsType<ActivitySkuPriceRow>>(() => [
    {
      title: "店铺",
      key: "mall",
      width: 110,
      render: (_value, row) => (
        <Space direction="vertical" size={1}>
          <Typography.Text strong>{row.activity.mall_id || "-"}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.activity.site || "-"}</Typography.Text>
        </Space>
      ),
    },
    {
      title: "商品/SKC",
      key: "product",
      width: 180,
      render: (_value, row) => (
        <Space direction="vertical" size={1}>
          <Typography.Text>SKC: {row.activity.skc_id || "-"}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>SKU: {row.skuId || "-"}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Product {row.activity.product_id || "-"} / Goods {row.activity.goods_id || "-"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "活动类型",
      key: "activity",
      width: 360,
      render: (_value, row) => {
        const activityName = activityTableNameText(row.activity);
        return (
          <Typography.Text strong ellipsis={{ tooltip: activityName }} style={{ maxWidth: 340 }}>
            {activityName || "-"}
          </Typography.Text>
        );
      },
    },
    {
      title: "SKU属性集",
      key: "skuAttr",
      width: 150,
      render: (_value, row) => (
        <Space direction="vertical" size={1} style={{ maxWidth: 142 }}>
          <Typography.Text ellipsis={{ tooltip: row.skuAttr }}>{row.skuAttr || "-"}</Typography.Text>
          {row.skuExtCode ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>货号: {row.skuExtCode}</Typography.Text> : null}
        </Space>
      ),
    },
    {
      title: "日常申报价",
      key: "dailyPrice",
      width: 112,
      align: "right",
      render: (_value, row) => {
        return formatActivityMoney(row.dailyPriceCents, row.currency);
      },
    },
    {
      title: "活动申报价",
      key: "signupPrice",
      width: 112,
      align: "right",
      render: (_value, row) => {
        return formatActivityMoney(activityRowDisplayPriceCents(row), row.currency);
      },
    },
    {
      title: "报名时间",
      key: "signupTime",
      width: 170,
      render: (_value, row) => row.signupTimeText,
    },
    {
      title: "报名场次",
      key: "sessions",
      width: 360,
      render: (_value, row) => {
        const sessions = activitySessionTexts(row.activity);
        return (
          <Space direction="vertical" size={1} style={{ maxWidth: 340 }}>
            {sessions.length > 0 ? sessions.slice(0, 3).map((text, index) => (
              <Typography.Text key={`${row.id}-catalog-session-${index}`} style={{ fontSize: 12 }} ellipsis={{ tooltip: text }}>
                {text}
              </Typography.Text>
            )) : <span>-</span>}
            {sessions.length > 3 ? (
              <Tooltip title={<div>{sessions.slice(3).map((text, index) => <div key={index}>{text}</div>)}</div>}>
                <Button type="link" size="small" style={{ padding: 0, height: "auto" }}>更多</Button>
              </Tooltip>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: "活动库存",
      key: "activityStock",
      width: 96,
      align: "right",
      render: (_value, row) => {
        const value = activityRowStockValue(row);
        return value === null ? "-" : Number(value).toLocaleString("zh-CN");
      },
    },
    {
      title: "剩余数量",
      key: "remainingQty",
      width: 96,
      align: "right",
      render: (_value, row) => {
        const value = activityRowRemainingValue(row);
        return value === null ? "-" : Number(value).toLocaleString("zh-CN");
      },
    },
    {
      title: "活动状态",
      key: "status",
      width: 110,
      render: (_value, row) => {
        const status = activityDerivedStatusText(row.activity);
        return <Tag color={activityStatusColor(status)}>{status}</Tag>;
      },
    },
    {
      title: "最近采集",
      key: "updated",
      width: 160,
      render: (_value, row) => formatTimestamp(row.activity.last_updated_at) || "-",
    },
  ], []);

  // 拖拽排序
  const dragRef = useRef<{ key: string; groupLabel: string } | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const handleDragStart = (key: string, groupLabel: string) => {
    dragRef.current = { key, groupLabel };
  };

  const handleDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    setDragOverKey(key);
  };

  const handleDrop = (e: React.DragEvent, targetKey: string, targetGroupLabel: string) => {
    e.preventDefault();
    setDragOverKey(null);
    const src = dragRef.current;
    if (!src || src.key === targetKey || src.groupLabel !== targetGroupLabel) return;
    setTempOrder((prev) => {
      const arr = [...prev];
      const srcIdx = arr.indexOf(src.key);
      const tgtIdx = arr.indexOf(targetKey);
      if (srcIdx < 0 || tgtIdx < 0) return prev;
      // 移除源，插入到目标位置
      arr.splice(srcIdx, 1);
      const insertIdx = arr.indexOf(targetKey);
      arr.splice(insertIdx, 0, src.key);
      return arr;
    });
  };

  const handleDragEnd = () => {
    dragRef.current = null;
    setDragOverKey(null);
  };

  // ============ Drawer 渲染 ============
  const renderDrawer = () => {
    if (!selectedProduct) return null;
    const record = selectedProduct;
    const raw: any = record.salesRaw || {};
    const qty: any = raw.skuQuantityTotalInfo || {};
    const inv: any = qty.inventoryNumInfo || raw.inventoryNumInfo || {};
    const stockOrderRows: TemuStockOrderRow[] = Array.isArray(record.cloudStockOrders) ? record.cloudStockOrders : [];
    const afterSaleRows: TemuAfterSaleRow[] = Array.isArray(record.cloudAfterSales) ? record.cloudAfterSales : [];
    const pendingStockOrderCount = stockOrderRows.filter((row) => isPendingBusinessStatus(row.temu_status)).length;
    const pendingAfterSaleCount = afterSaleRows.filter((row) => isPendingBusinessStatus(row.status)).length;
    const stockDemandQty = stockOrderRows.reduce((sum, row) => sum + Number(row.demand_qty || 0), 0);
    const stockDeliveredQty = stockOrderRows.reduce((sum, row) => sum + Number(row.delivered_qty || 0), 0);
    const afterSaleQty = afterSaleRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const afterSaleAmountCents = afterSaleRows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
    const afterSaleCurrency = afterSaleRows.find((row) => row.currency)?.currency || "CNY";
    void pendingStockOrderCount;
    void pendingAfterSaleCount;
    void stockDemandQty;
    void stockDeliveredQty;
    void afterSaleQty;
    void afterSaleAmountCents;
    void afterSaleCurrency;
    const trend = Array.isArray(record.trendDaily) ? record.trendDaily : [];
    const fluxSites = Array.isArray(record.fluxSites) ? record.fluxSites : [];
    const activeFluxSite = fluxSites.find((site) => site.siteKey === activeFluxSiteKey) || fluxSites[0] || null;
    const fluxRangeOptions = sortFluxRangeLabels(activeFluxSite?.availableRanges || []);
    const selectedFluxRange = fluxRangeOptions.includes(activeFluxRangeLabel)
      ? activeFluxRangeLabel
      : (activeFluxSite?.primaryRangeLabel || fluxRangeOptions[0] || "");
    const currentFluxSummary = selectedFluxRange
      ? activeFluxSite?.summaryByRange?.[selectedFluxRange] || activeFluxSite?.summary || null
      : activeFluxSite?.summary || null;
    const currentFluxItems = selectedFluxRange
      ? activeFluxSite?.itemsByRange?.[selectedFluxRange] || activeFluxSite?.items || []
      : activeFluxSite?.items || [];
    void currentFluxItems; // 保留
    const isGpFallback = currentFluxSummary?.dataOrigin === "gp";
    const detailVisitorValue = currentFluxSummary?.detailVisitorNum || currentFluxSummary?.detailVisitNum || 0;
    const rangeComparisonData = activeFluxSite
      ? sortFluxRangeLabels(Object.keys(activeFluxSite.summaryByRange || {})).map((label) => {
          const summary = activeFluxSite.summaryByRange[label];
          return {
            label,
            fullLabel: `${activeFluxSite.siteLabel} · ${label}`,
            曝光: summary?.exposeNum || 0,
            点击: summary?.clickNum || 0,
            详情访客: summary?.detailVisitorNum || summary?.detailVisitNum || 0,
            支付买家: summary?.buyerNum || 0,
            支付件数: summary?.payGoodsNum || 0,
            曝光点击率: summary?.exposeClickRate || 0,
            点击支付转化率: summary?.clickPayRate || 0,
          };
        })
      : [];

    const sourceBreakdownData = currentFluxSummary
      ? [
          {
            来源: "搜索",
            曝光: currentFluxSummary.searchExposeNum,
            点击: currentFluxSummary.searchClickNum,
            支付件数: currentFluxSummary.searchPayGoodsNum,
            点击率: toPercentValue(undefined, currentFluxSummary.searchClickNum, currentFluxSummary.searchExposeNum),
            支付转化率: toPercentValue(undefined, currentFluxSummary.searchPayGoodsNum, currentFluxSummary.searchClickNum),
          },
          {
            来源: "推荐",
            曝光: currentFluxSummary.recommendExposeNum,
            点击: currentFluxSummary.recommendClickNum,
            支付件数: currentFluxSummary.recommendPayGoodsNum,
            点击率: toPercentValue(undefined, currentFluxSummary.recommendClickNum, currentFluxSummary.recommendExposeNum),
            支付转化率: toPercentValue(undefined, currentFluxSummary.recommendPayGoodsNum, currentFluxSummary.recommendClickNum),
          },
          {
            来源: "其他",
            曝光: Math.max(0, currentFluxSummary.exposeNum - currentFluxSummary.searchExposeNum - currentFluxSummary.recommendExposeNum),
            点击: Math.max(0, currentFluxSummary.clickNum - currentFluxSummary.searchClickNum - currentFluxSummary.recommendClickNum),
            支付件数: Math.max(0, currentFluxSummary.payGoodsNum - currentFluxSummary.searchPayGoodsNum - currentFluxSummary.recommendPayGoodsNum),
            点击率: toPercentValue(
              undefined,
              Math.max(0, currentFluxSummary.clickNum - currentFluxSummary.searchClickNum - currentFluxSummary.recommendClickNum),
              Math.max(0, currentFluxSummary.exposeNum - currentFluxSummary.searchExposeNum - currentFluxSummary.recommendExposeNum),
            ),
            支付转化率: toPercentValue(
              undefined,
              Math.max(0, currentFluxSummary.payGoodsNum - currentFluxSummary.searchPayGoodsNum - currentFluxSummary.recommendPayGoodsNum),
              Math.max(0, currentFluxSummary.clickNum - currentFluxSummary.searchClickNum - currentFluxSummary.recommendClickNum),
            ),
          },
        ]
      : [];
    const sourceDistributionData = sourceBreakdownData.map((item) => ({
      name: item.来源,
      value: item.曝光,
      share: toPercentValue(undefined, item.曝光, currentFluxSummary?.exposeNum),
      color:
        item.来源 === "搜索"
          ? PRODUCT_TRAFFIC_COLORS.search
          : item.来源 === "推荐"
            ? PRODUCT_TRAFFIC_COLORS.recommend
            : PRODUCT_TRAFFIC_COLORS.other,
    }));
    const efficiencyComparisonData = rangeComparisonData.map((item) => ({
      label: item.label,
      fullLabel: item.fullLabel,
      曝光点击率: item.曝光点击率,
      点击支付转化率: item.点击支付转化率,
    }));
    void efficiencyComparisonData; // 保留

    // 日级流量趋势数据（优先从商品级 cache 读取，否则从 flux_history 日快照构建）
    let dailyTrendData: any[] = [];
    {
      const idSet = new Set(
        [record.skcId, record.spuId, record.goodsId, record.skuId]
          .map((v) => String(v || "").trim()).filter(Boolean),
      );
      const titleSet = new Set(
        [record.title].map((v) => String(v || "").replace(/\s+/g, "").trim().toLowerCase()).filter(Boolean),
      );

      // 方法0（最高优先级）: 从云端流量趋势接口读取商品级日趋势
      const selectedRangeRows = activeFluxSite && selectedFluxRange
        ? (activeFluxSite.itemsByRange?.[selectedFluxRange] || [])
        : [];
      const cloudTrendRows = selectedRangeRows.filter((item: any) => item?._cloudFlowTrend && item.fullDate);
      if (cloudTrendRows.length > 0) {
        dailyTrendData = cloudTrendRows.map((d: any) => ({
          date: String(d.fullDate || d.date || "").slice(5),
          fullDate: String(d.fullDate || d.date || ""),
          曝光: toNumberValue(d.exposeNum),
          点击: toNumberValue(d.clickNum),
          详情访客: toNumberValue(d.detailVisitNum || d.detailVisitorNum),
          支付买家: toNumberValue(d.buyerNum),
          支付件数: toNumberValue(d.payGoodsNum),
          搜索曝光: toNumberValue(d.searchExposeNum),
          推荐曝光: toNumberValue(d.recommendExposeNum),
          _fromCloud: true,
        })).sort((a: any, b: any) => String(a.fullDate).localeCompare(String(b.fullDate)));
      }

      // 方法1: 从 temu_flux_product_history_cache 直接读取商品级 30 天日趋势
      // cache 结构: { goodsId: { stations: { 全球|美国|欧区: { daily: [{date,exposeNum,...}] } } } }
      const cacheSiteLabel = activeFluxSite?.siteLabel;
      if (dailyTrendData.length === 0 && cacheSiteLabel && productHistoryCache && Object.keys(productHistoryCache).length > 0) {
        for (const goodsId of idSet) {
          const entry = productHistoryCache[goodsId];
          const dailyArr = entry?.stations?.[cacheSiteLabel]?.daily;
          if (Array.isArray(dailyArr) && dailyArr.length > 0) {
            dailyTrendData = dailyArr.map((d: any) => ({
              date: String(d.date || "").slice(5),
              fullDate: String(d.date || ""),
              曝光: toNumberValue(d.exposeNum),
              点击: toNumberValue(d.clickNum),
              详情访客: toNumberValue(d.detailVisitNum || d.detailVisitorNum),
              支付买家: toNumberValue(d.buyerNum),
              支付件数: toNumberValue(d.payGoodsNum),
              搜索曝光: toNumberValue(d.searchExposeNum),
              推荐曝光: toNumberValue(d.recommendExposeNum),
              _fromCache: true,
            })).sort((a: any, b: any) => String(a.fullDate).localeCompare(String(b.fullDate)));
            break;
          }
        }
      }

      // 方法2: 从 flux_history 日快照获取历史数据（只有 cache 没命中时才用）
      const historyRows: any[] = [];
      if (dailyTrendData.length === 0) {
      for (const snapshot of fluxHistoryData) {
        if (!snapshot?.date || !Array.isArray(snapshot.items)) continue;
        for (const item of snapshot.items) {
          const itemGoodsId = String(item.goodsId || "").trim();
          const itemName = String(item.goodsName || "").replace(/\s+/g, "").trim().toLowerCase();
          if ((itemGoodsId && idSet.has(itemGoodsId)) || (itemName && titleSet.has(itemName))) {
            historyRows.push({
              date: String(snapshot.date).slice(5),
              fullDate: snapshot.date,
              曝光: item.exposeNum || 0,
              点击: item.clickNum || 0,
              详情访客: item.detailVisitNum || 0,
              支付买家: item.buyerNum || 0,
              支付件数: item.payGoodsNum || 0,
              搜索曝光: item.searchExposeNum || 0,
              推荐曝光: item.recommendExposeNum || 0,
              _fromHistory: true,
            });
          }
        }
      }
      // 方法2: 用"今日"和"昨日"range 补充（它们本身就是单日数据）
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const existingDates = new Set(historyRows.map((r) => r.fullDate));
      const singleDayRanges = [
        { range: "今日", date: today },
        { range: "昨日", date: yesterday },
      ];
      for (const { range, date } of singleDayRanges) {
        if (existingDates.has(date)) continue;
        const rangeItems = activeFluxSite?.itemsByRange?.[range];
        if (!Array.isArray(rangeItems)) continue;
        const matched = rangeItems.filter((item: any) => matchesFluxRecord(item, idSet));
        if (matched.length === 0) continue;
        const agg = matched.reduce((acc: any, item: any) => ({
          曝光: acc.曝光 + toNumberValue(item.exposeNum),
          点击: acc.点击 + toNumberValue(item.clickNum),
          详情访客: acc.详情访客 + toNumberValue(item.detailVisitNum || item.detailVisitorNum),
          支付买家: acc.支付买家 + toNumberValue(item.buyerNum),
          支付件数: acc.支付件数 + toNumberValue(item.payGoodsNum),
          搜索曝光: acc.搜索曝光 + toNumberValue(item.searchExposeNum),
          推荐曝光: acc.推荐曝光 + toNumberValue(item.recommendExposeNum),
        }), { 曝光: 0, 点击: 0, 详情访客: 0, 支付买家: 0, 支付件数: 0, 搜索曝光: 0, 推荐曝光: 0 });
        historyRows.push({ ...agg, date: date.slice(5), fullDate: date, _fromHistory: true });
      }
      historyRows.sort((a, b) => String(a.fullDate).localeCompare(String(b.fullDate)));
      // 根据选中的 range 过滤对应天数
      if (historyRows.length > 0) {
        const now = new Date();
        const rangeDaysMap: Record<string, number> = {
          "今日": 1, "昨日": 1, "近7日": 7, "近30日": 30, "本周": 7, "本月": 31,
        };
        const days = rangeDaysMap[selectedFluxRange] || historyRows.length;
        if (selectedFluxRange === "昨日") {
          dailyTrendData = historyRows.filter((r) => r.fullDate === yesterday);
        } else if (selectedFluxRange === "今日") {
          dailyTrendData = historyRows.filter((r) => r.fullDate === today);
        } else {
          const cutoff = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
          dailyTrendData = historyRows.filter((r) => r.fullDate >= cutoff);
        }
        // 如果过滤后不足2个点，用全部历史让图表有意义
        if (dailyTrendData.length < 2) dailyTrendData = historyRows;
      }
      } // end if (dailyTrendData.length === 0) - 方法1 fallback

      // 方法3 (兜底): 用站点级 mall/summary trendList 模拟,按当前商品在站点中的占比折算
      // 兼容两种 trendList shape:
      //   parsed (temu_flux.summary.trendList): { date, visitors, buyers, conversionRate }
      //   raw   (mall/summary.result.trendList): { statDate, visitorsNum, payBuyerNum }
      if (dailyTrendData.length < 2 && currentFluxSummary && activeFluxSite) {
        const stationTrend = siteTrendListBySite[activeFluxSite.siteKey] || [];
        if (stationTrend.length > 1) {
          const getDate = (p: any) => String(p?.date || p?.statDate || "");
          const getVisitors = (p: any) => toNumberValue(
            p?.visitors
            ?? p?.visitorsNum
            ?? p?.goodsVisitorsNum
            ?? p?.totalVisitorsNum,
          );
          const totalExpose = Math.max(toNumberValue(currentFluxSummary.exposeNum), 1);
          const totalClick = Math.max(toNumberValue(currentFluxSummary.clickNum), 0);
          const totalBuyers = Math.max(toNumberValue(currentFluxSummary.buyerNum), 0);
          const stationVisitorTotal = stationTrend.reduce((sum: number, p: any) => sum + getVisitors(p), 0) || 1;
          dailyTrendData = stationTrend.map((p: any) => {
            const ratio = getVisitors(p) / stationVisitorTotal;
            const fullDate = getDate(p);
            return {
              date: fullDate.slice(5),
              fullDate,
              曝光: Math.round(totalExpose * ratio),
              点击: Math.round(totalClick * ratio),
              详情访客: Math.round(toNumberValue(currentFluxSummary.detailVisitorNum || 0) * ratio),
              支付买家: Math.round(totalBuyers * ratio),
              支付件数: Math.round(toNumberValue(currentFluxSummary.payGoodsNum || 0) * ratio),
              搜索曝光: Math.round(toNumberValue(currentFluxSummary.searchExposeNum || 0) * ratio),
              推荐曝光: Math.round(toNumberValue(currentFluxSummary.recommendExposeNum || 0) * ratio),
              _fromStationFallback: true,
            };
          });
        }
      }
    }

    const funnelSteps = currentFluxSummary
      ? [
          { label: "曝光", value: currentFluxSummary.exposeNum },
          { label: "点击", value: currentFluxSummary.clickNum },
          { label: "详情访客", value: currentFluxSummary.detailVisitorNum || currentFluxSummary.detailVisitNum },
          { label: "加购人数", value: currentFluxSummary.addToCartUserNum },
          { label: "支付买家", value: currentFluxSummary.buyerNum },
        ]
      : [];
    void funnelSteps; // 保留

    // 工作台风格的 30 天日趋势数据 — 仅用于"曝光与转化趋势" + "来源结构" 两个图表
    const fluxTrendChartData = dailyTrendData.map((d: any) => {
      const expose = toNumberValue(d.曝光);
      const click = toNumberValue(d.点击);
      const buyers = toNumberValue(d.支付买家);
      return {
        label: d.date,
        fullLabel: d.fullDate,
        expose,
        clickRate: expose > 0 ? Number(((click / expose) * 100).toFixed(1)) : 0,
        clickPayRate: click > 0 ? Number(((buyers / click) * 100).toFixed(1)) : 0,
      };
    });
    void fluxTrendChartData; // 保留
    const fluxSourceTimelineData = dailyTrendData.map((d: any) => {
      const expose = toNumberValue(d.曝光);
      const search = toNumberValue(d.搜索曝光);
      const recommend = toNumberValue(d.推荐曝光);
      return {
        label: d.date,
        search,
        recommend,
        other: Math.max(expose - search - recommend, 0),
      };
    });
    void fluxSourceTimelineData; // 保留

    const diagnosis = (() => {
      if (!currentFluxSummary) {
        return {
          title: "当前还没有可用的流量快照",
          desc: "先运行商品流量采集，后面这里会自动展开站点、周期和来源拆解。",
        };
      }
      if (isGpFallback) {
        return {
          title: "当前展示的是已采集的动销趋势与地区销量",
          desc: "这件商品已经命中动销快照，不需要现场抓取也能直接看销量走势和地区分布；等完整商品流量采集补齐后，这里会自动升级成曝光、点击、加购和支付漏斗。",
        };
      }
      if (currentFluxSummary.exposeNum <= 0) {
        return {
          title: "当前还没有可用的流量快照",
          desc: "先运行商品流量采集，后面这里会自动展开站点、周期和来源拆解。",
        };
      }
      if (currentFluxSummary.exposeClickRate < 2) {
        return {
          title: "曝光有基础，但点击承接偏弱",
          desc: "建议继续强化主图前景识别、首屏卖点和标题前 12 字，让曝光更有效转成点击。",
        };
      }
      if (currentFluxSummary.clickPayRate < 5) {
        return {
          title: "点击已经起来了，转化还可以再往前推",
          desc: "重点检查详情图、价格带和核心卖点表达，先把进店后的支付转化率提上去。",
        };
      }
      return {
        title: "当前流量承接已经形成基础",
        desc: "可以继续放大有效站点和来源，把点击和支付节奏稳定住。",
      };
    })();
    void diagnosis; // 保留
    const executionSignals = currentFluxSummary
      ? [
          { title: "详情承接率", value: formatTrafficPercent(toPercentValue(undefined, detailVisitorValue, currentFluxSummary.clickNum)), helper: "点击后进入详情页的比例", color: PRODUCT_TRAFFIC_COLORS.detail },
          { title: "收藏率", value: formatTrafficPercent(toPercentValue(undefined, currentFluxSummary.collectUserNum, detailVisitorValue || currentFluxSummary.clickNum)), helper: "详情访客里有多少愿意留下兴趣", color: PRODUCT_TRAFFIC_COLORS.collect },
          { title: "加购率", value: formatTrafficPercent(toPercentValue(undefined, currentFluxSummary.addToCartUserNum, detailVisitorValue || currentFluxSummary.clickNum)), helper: "详情页到购物车的承接效率", color: PRODUCT_TRAFFIC_COLORS.cart },
          { title: "订单买家比", value: formatTrafficPercent(toPercentValue(undefined, currentFluxSummary.payOrderNum, currentFluxSummary.buyerNum)), helper: "每个买家贡献的支付订单数", color: PRODUCT_TRAFFIC_COLORS.order },
        ]
      : [];
    void executionSignals; // 保留
    const secondaryTrafficCards = currentFluxSummary
      ? [
          { label: "收藏人数", value: formatTrafficNumber(currentFluxSummary.collectUserNum), helper: "收藏沉淀", accent: PRODUCT_TRAFFIC_COLORS.collect },
          { label: "支付订单", value: formatTrafficNumber(currentFluxSummary.payOrderNum), helper: "成交单量", accent: PRODUCT_TRAFFIC_COLORS.order },
          { label: "搜索曝光", value: formatTrafficNumber(currentFluxSummary.searchExposeNum), helper: "搜索入口", accent: PRODUCT_TRAFFIC_COLORS.search },
          { label: "搜索点击", value: formatTrafficNumber(currentFluxSummary.searchClickNum), helper: "搜索承接", accent: PRODUCT_TRAFFIC_COLORS.search },
          { label: "推荐曝光", value: formatTrafficNumber(currentFluxSummary.recommendExposeNum), helper: "推荐入口", accent: PRODUCT_TRAFFIC_COLORS.recommend },
          { label: "推荐点击", value: formatTrafficNumber(currentFluxSummary.recommendClickNum), helper: "推荐承接", accent: PRODUCT_TRAFFIC_COLORS.recommend },
          { label: "趋势曝光", value: formatTrafficNumber(currentFluxSummary.trendExposeNum), helper: "趋势通道", accent: "#f59e0b" },
          { label: "趋势支付订单", value: formatTrafficNumber(currentFluxSummary.trendPayOrderNum), helper: "趋势成交", accent: "#0f766e" },
        ]
      : [];
    void secondaryTrafficCards; // 保留
    const sourceContributionData = currentFluxSummary
      ? sourceBreakdownData.map((item) => ({
          ...item,
          曝光占比: toPercentValue(undefined, item.曝光, currentFluxSummary.exposeNum),
          支付贡献占比: toPercentValue(undefined, item.支付件数, currentFluxSummary.payGoodsNum),
          千次曝光成交: item.曝光 > 0 ? (item.支付件数 / item.曝光) * 1000 : 0,
          建议:
            item.点击率 >= 5 && item.支付转化率 >= 10
              ? "继续放量"
              : item.点击率 < 3
                ? "先补主图和标题"
                : item.支付转化率 < 5
                  ? "先补详情和价格"
                  : "维持观察",
        }))
      : [];
    const trafficHealthScore = currentFluxSummary
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(
              Math.min(100, currentFluxSummary.exposeClickRate * 8) * 0.28
              + Math.min(100, currentFluxSummary.clickPayRate * 6) * 0.32
              + Math.min(100, toPercentValue(undefined, detailVisitorValue, currentFluxSummary.clickNum) * 1.4) * 0.18
              + Math.min(100, toPercentValue(undefined, currentFluxSummary.addToCartUserNum, detailVisitorValue || currentFluxSummary.clickNum) * 2.2) * 0.12
              + Math.min(
                100,
                100 - Math.max(...sourceDistributionData.map((item) => item.share || 0), 0) * 0.7,
              ) * 0.1,
            ),
          ),
        )
      : 0;
    const trafficHealthTone =
      trafficHealthScore >= 80
        ? { text: "健康", color: "#16a34a", tag: "当前这波流量可以继续放大" }
        : trafficHealthScore >= 60
          ? { text: "稳定", color: "#f59e0b", tag: "主链路已经成型，继续补效率" }
          : { text: "待优化", color: "#e11d48", tag: "先解决点击或转化短板" };
    void trafficHealthTone; // 保留
    const strongestSource = sourceContributionData
      .slice()
      .sort((left, right) => (right.支付件数 || 0) - (left.支付件数 || 0))[0];
    const opportunityHighlights = currentFluxSummary
      ? [
          {
            title: "当前主阵地",
            value: strongestSource?.来源 || "暂无",
            helper: strongestSource ? `支付贡献 ${formatTrafficPercent(strongestSource.支付贡献占比)}` : "先完成来源采集",
            accent: strongestSource?.来源 === "搜索" ? PRODUCT_TRAFFIC_COLORS.search : strongestSource?.来源 === "推荐" ? PRODUCT_TRAFFIC_COLORS.recommend : PRODUCT_TRAFFIC_COLORS.other,
          },
          {
            title: "当前短板",
            value: currentFluxSummary.exposeClickRate < 3 ? "点击承接" : currentFluxSummary.clickPayRate < 5 ? "支付转化" : "站点放量",
            helper: currentFluxSummary.exposeClickRate < 3 ? "先优化主图、标题前 12 字和价格锚点" : currentFluxSummary.clickPayRate < 5 ? "先补详情图、评价和卖点承接" : "可以扩大有效来源和站点预算",
            accent: currentFluxSummary.exposeClickRate < 3 ? "#e11d48" : currentFluxSummary.clickPayRate < 5 ? "#fbbc04" : "#1a73e8",
          },
          {
            title: "下一步动作",
            value:
              currentFluxSummary.recommendExposeNum > currentFluxSummary.searchExposeNum
                ? "补搜索承接"
                : currentFluxSummary.searchExposeNum > currentFluxSummary.recommendExposeNum
                  ? "放大推荐转化"
                  : "同步双入口",
            helper:
              currentFluxSummary.recommendExposeNum > currentFluxSummary.searchExposeNum
                ? "标题关键词和主图首屏优先再加强一档"
                : currentFluxSummary.searchExposeNum > currentFluxSummary.recommendExposeNum
                  ? "继续补场景图和买点文案，让推荐流量吃满"
                  : "全球和站点流量结构比较均衡，继续观察增量",
            accent: "#7c3aed",
          },
        ]
      : [];
    void opportunityHighlights; // 保留
    const actionChecklist = currentFluxSummary
      ? [
          {
            title: "标题动作",
            desc:
              currentFluxSummary.searchClickNum <= 0 || currentFluxSummary.exposeClickRate < 3
                ? "把核心品类词前置到标题前 12 字，配合主图重新强化点击承接。"
                : "标题承接已经有基础，继续扩展同义词和高意图词。 ",
          },
          {
            title: "图片动作",
            desc:
              currentFluxSummary.clickPayRate < 5
                ? "优先补细节图、尺寸图和场景图，把点击后的支付转化率抬起来。"
                : "主图和详情图承接基本合格，可以继续做精细化版本测试。",
          },
          {
            title: "站点动作",
            desc:
              strongestSource?.来源 === "推荐"
                ? "当前推荐流量是主阵地，建议继续做高点击图和高停留详情。"
                : strongestSource?.来源 === "搜索"
                  ? "当前搜索流量更强，建议继续扩词并稳定关键词承接。"
                  : "其他来源占比偏高，建议先把搜索和推荐这两条主链拉稳。",
          },
        ]
      : [];
    void actionChecklist; // 保留

    const renderMetric = (label: string, value: any, accent?: boolean) => (
      <div style={{ padding: "8px 12px", background: "var(--color-bg-1, #f8fbff)", borderRadius: 8 }}>
        <div style={{ fontSize: 13, color: "var(--color-text-sec)" }}>{label}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: accent ? "var(--color-brand)" : "var(--color-text)" }}>
          {formatTextValue(value)}
        </div>
      </div>
    );
    void renderMetric; // 保留

    const renderTrafficCard = (label: string, value: React.ReactNode, helper?: string, accent?: string) => (
      <Card
        size="small"
        bodyStyle={{ padding: 14 }}
        className="material-metric-card"
        style={{ borderColor: "var(--color-border)", boxShadow: "var(--shadow-card)" }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, color: "var(--color-text-sec)" }}>{label}</div>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: accent || "var(--color-text)" }}>{value}</div>
          {helper ? <div style={{ fontSize: 12, color: "var(--color-text-sec)" }}>{helper}</div> : null}
        </div>
      </Card>
    );
    void renderTrafficCard; // 保留

    const overviewTab = (
      <div style={{ display: "grid", gap: 16 }}>
        {trend.length > 0 ? (
          <div className="app-surface material-chart-panel" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>销售趋势</div>
                <div style={{ fontSize: 12, color: "var(--color-text-sec)" }}>最近 {trend.length} 天销量变化</div>
              </div>
              <Tag color="orange">销售表现</Tag>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trend} margin={{ top: 10, right: 16, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1a73e8" stopOpacity={0.24} />
                    <stop offset="100%" stopColor="#1a73e8" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={PRODUCT_TRAFFIC_COLORS.grid} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: PRODUCT_TRAFFIC_COLORS.axis }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 12, fill: PRODUCT_TRAFFIC_COLORS.axis }} allowDecimals={false} />
                <ReTooltip formatter={(value: any) => [formatTrafficNumber(value), "销量"]} />
                <Area type="monotone" dataKey="salesNumber" stroke="#1a73e8" strokeWidth={2.5} fill="url(#salesTrendFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Alert type="info" showIcon message="暂无销售趋势数据" description="重新采集销售数据后，这里会展示最近销售趋势。" />
        )}
      </div>
    );

    const fluxTab = activeFluxSite && currentFluxSummary ? (
      <div>
        <ProductFluxOperatorCard
          productHistoryCache={productHistoryCache}
          productIds={[record.goodsId, record.skcId, record.spuId, record.skuId]}
          activeSiteLabel={activeFluxSite?.siteLabel}
        />
        <TrafficDriverPanel
          sites={buildTrafficDriverSitesFromProduct(fluxSites, siteTrendListBySite, productDailyTrendBySite)}
          activeSiteKey={activeFluxSiteKey as TrafficSiteKey}
          onActiveSiteKeyChange={(key) => setActiveFluxSiteKey(key)}
          rangeLabel={selectedFluxRange}
          onRangeLabelChange={(label) => setActiveFluxRangeLabel(label)}
          productContext={{
            title: selectedProduct?.title,
            category: selectedProduct?.category || selectedProduct?.categories,
            imageUrl: selectedProduct?.imageUrl,
            skcId: selectedProduct?.skcId,
          }}
        />
      </div>
    ) : (
      <Alert
        type="info"
        showIcon
        message="暂无已采集的流量分析数据"
        description="先运行流量采集，再打开这里查看全球、美国和欧区的流量驾驶舱。"
      />
    );

    const skuList = Array.isArray(raw.skuQuantityDetailList) ? raw.skuQuantityDetailList : [];
    const skuTab = skuList.length > 0 ? (
      <Table
        size="small"
        rowKey={(s: any, i) => `${s.productSkuId || i}`}
        dataSource={skuList}
        pagination={false}
        scroll={{ x: 900 }}
        columns={[
          { title: "SKU ID", dataIndex: "productSkuId", width: 120, render: (v) => <span style={{ fontFamily: "Consolas, monospace", fontSize: 13 }}>{formatTextValue(v)}</span> },
          { title: "规格", dataIndex: "className", width: 120 },
          { title: "货号", dataIndex: "skuExtCode", width: 120 },
          { title: "今日", width: 70, align: "right", render: (_: any, s: any) => s.todaySaleVolume ?? 0 },
          { title: "7日", width: 70, align: "right", render: (_: any, s: any) => s.lastSevenDaysSaleVolume ?? 0 },
          { title: "30日", width: 70, align: "right", render: (_: any, s: any) => s.lastThirtyDaysSaleVolume ?? 0 },
          { title: "缺货", dataIndex: "lackQuantity", width: 70, align: "right" },
          { title: "建议", dataIndex: "adviceQuantity", width: 70, align: "right" },
          { title: "卖家库存", dataIndex: "sellerWhStock", width: 90, align: "right" },
          { title: "申报价", dataIndex: "supplierPrice", width: 90, align: "right" },
        ]}
      />
    ) : record.skuSummaries.length > 0 ? (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
        {record.skuSummaries.map((s) => (
          <div key={`${s.productSkuId}-${s.extCode}`} style={{ display: "flex", gap: 8, alignItems: "center", padding: 8, background: "var(--color-bg-1, #f8fbff)", borderRadius: 8 }}>
            {s.thumbUrl ? <Image src={s.thumbUrl} width={36} height={36} preview={false} fallback={EMPTY_IMAGE_FALLBACK} /> : <Tag>无图</Tag>}
            <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <div style={{ fontFamily: "Consolas, monospace" }}>{s.productSkuId || "-"}</div>
              <div style={{ color: "var(--color-text-sec)" }}>{s.specText || s.specName || "-"}</div>
              <div style={{ color: "var(--color-text-sec)" }}>{s.extCode || "-"}</div>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <Alert type="info" showIcon message="暂无 SKU 明细" />
    );

    const fulfillmentTab = stockOrderRows.length > 0 || afterSaleRows.length > 0 ? (
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <div className="app-surface material-detail-section" style={{ padding: 12 }}>
          <Space size={8} wrap>
            <Tag color={pendingStockOrderCount ? "orange" : "blue"}>备货单 {pendingStockOrderCount}/{stockOrderRows.length}</Tag>
            <Tag color={pendingAfterSaleCount ? "red" : "orange"}>售后单 {pendingAfterSaleCount}/{afterSaleRows.length}</Tag>
            <Tag>备货需求 {stockDemandQty.toLocaleString("zh-CN")}</Tag>
            <Tag>已发 {stockDeliveredQty.toLocaleString("zh-CN")}</Tag>
            <Tag>售后件数 {afterSaleQty.toLocaleString("zh-CN")}</Tag>
            <Tag>售后金额 {afterSaleRows.some((row) => row.amount_cents !== null && row.amount_cents !== undefined) ? formatActivityMoney(afterSaleAmountCents, afterSaleCurrency) : "-"}</Tag>
          </Space>
        </div>
        {stockOrderRows.length > 0 ? (
          <div className="app-surface material-detail-section" style={{ padding: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>备货/入仓单据</div>
            <Table<TemuStockOrderRow>
              size="small"
              rowKey={(row) => row.id || row.row_key || row.stock_order_no || row.delivery_order_sn || ""}
              dataSource={stockOrderRows}
              pagination={{ pageSize: 6, showSizeChanger: false }}
              scroll={{ x: 960 }}
              columns={[
                {
                  title: "单号",
                  key: "order",
                  width: 180,
                  render: (_value, row) => (
                    <Space direction="vertical" size={2}>
                      <Typography.Text strong>{row.stock_order_no || row.delivery_order_sn || row.delivery_batch_sn || "-"}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.parent_order_no || row.delivery_batch_sn || "-"}</Typography.Text>
                    </Space>
                  ),
                },
                {
                  title: "状态",
                  dataIndex: "temu_status",
                  width: 110,
                  render: (value) => <Tag color={businessStatusColor(value)}>{value || "-"}</Tag>,
                },
                {
                  title: "需求/已发",
                  key: "qty",
                  width: 110,
                  align: "right",
                  render: (_value, row) => `${Number(row.demand_qty || 0).toLocaleString("zh-CN")} / ${Number(row.delivered_qty || 0).toLocaleString("zh-CN")}`,
                },
                {
                  title: "SKU/货号",
                  key: "sku",
                  width: 160,
                  render: (_value, row) => (
                    <Space direction="vertical" size={2}>
                      <span>{row.sku_id || row.skc_id || "-"}</span>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.sku_ext_code || row.spec_name || "-"}</Typography.Text>
                    </Space>
                  ),
                },
                {
                  title: "收货仓",
                  key: "warehouse",
                  width: 160,
                  render: (_value, row) => row.receive_warehouse_name || row.receive_warehouse_id || row.warehouse_group || "-",
                },
                {
                  title: "要求发货",
                  key: "latest_ship_at",
                  width: 160,
                  render: (_value, row) => formatTimestamp(row.latest_ship_at) || row.latest_ship_at || "-",
                },
                {
                  title: "最近采集",
                  key: "updated",
                  width: 160,
                  render: (_value, row) => formatTimestamp(row.last_updated_at) || "-",
                },
              ]}
            />
          </div>
        ) : null}
        {afterSaleRows.length > 0 ? (
          <div className="app-surface material-detail-section" style={{ padding: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>售后记录</div>
            <Table<TemuAfterSaleRow>
              size="small"
              rowKey={(row) => row.id || row.row_key || row.package_no || row.order_id || ""}
              dataSource={afterSaleRows}
              pagination={{ pageSize: 6, showSizeChanger: false }}
              scroll={{ x: 920 }}
              columns={[
                {
                  title: "类型/单号",
                  key: "type",
                  width: 190,
                  render: (_value, row) => (
                    <Space direction="vertical" size={2}>
                      <Typography.Text strong>{row.after_sale_type || "售后"}</Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.package_no || row.order_id || "-"}</Typography.Text>
                    </Space>
                  ),
                },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 110,
                  render: (value) => <Tag color={businessStatusColor(value)}>{value || "-"}</Tag>,
                },
                {
                  title: "原因",
                  dataIndex: "reason",
                  width: 200,
                  render: (value) => <Typography.Text ellipsis style={{ maxWidth: 180 }}>{value || "-"}</Typography.Text>,
                },
                {
                  title: "数量/金额",
                  key: "amount",
                  width: 130,
                  align: "right",
                  render: (_value, row) => (
                    <Space direction="vertical" size={2}>
                      <span>{Number(row.quantity || 0).toLocaleString("zh-CN")} 件</span>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{formatActivityMoney(row.amount_cents, row.currency)}</Typography.Text>
                    </Space>
                  ),
                },
                {
                  title: "物流/仓",
                  key: "logistics",
                  width: 180,
                  render: (_value, row) => (
                    <Space direction="vertical" size={2}>
                      <span>{row.logistics_no || "-"}</span>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.warehouse_name || "-"}</Typography.Text>
                    </Space>
                  ),
                },
                {
                  title: "最近采集",
                  key: "updated",
                  width: 170,
                  render: (_value, row) => formatTimestamp(row.last_updated_at || row.updated_at_text || row.created_at_text) || row.updated_at_text || row.created_at_text || "-",
                },
              ]}
            />
          </div>
        ) : null}
      </Space>
    ) : (
      <Alert type="info" showIcon message="暂无云端备货或售后数据" description="扩展采集到备货单、入仓履约或售后记录后，会按店铺和 SKC 自动关联到这里。" />
    );

    // ----- 全部字段 Tab -----
    const groups: { title: string; fields: Array<{ label: string; value: any; accent?: boolean }> }[] = [
      {
        title: "基础信息",
        fields: [
          { label: "商品标题", value: record.title, accent: true },
          { label: "商品分类", value: record.category || record.categories },
          { label: "商品类型", value: record.productType },
          { label: "商品来源", value: formatSourceType(record.sourceType) },
          { label: "JIT模式", value: raw.productJitMode ?? raw.purchaseStockType },
          { label: "站点", value: record.siteLabel },
          { label: "SKC ID", value: record.skcId },
          { label: "SPU ID", value: record.spuId },
          { label: "Goods ID", value: record.goodsId },
          { label: "Product ID", value: raw.productId },
          { label: "SKC 货号", value: raw.skcExtCode || record.extCode },
          { label: "云端来源事件", value: raw.cloudSourceEvent?.id },
          { label: "云端来源接口", value: raw.cloudSourceEvent?.url_path },
          { label: "创建时间", value: raw.createdAtStr || raw.createdAt },
          { label: "上架时长", value: raw.onSalesDurationOffline },
          { label: "商品周期", value: raw.productCycleDays },
        ],
      },
      {
        title: "库存信息",
        fields: [
          { label: "仓库库存", value: inv.warehouseInventoryNum ?? record.warehouseStock, accent: true },
          { label: "缺货数量", value: qty.lackQuantity ?? record.lackQuantity, accent: true },
          { label: "建议备货量", value: qty.adviceQuantity },
          { label: "可售天数", value: qty.availableSaleDays },
          { label: "仓内可售天数", value: qty.warehouseAvailableSaleDays },
          { label: "预测可售天数", value: qty.predictSaleAvailableDays },
          { label: "待 QC 数", value: inv.waitQcNum },
          { label: "待上架", value: inv.waitOnShelfNum },
          { label: "待入库", value: inv.waitInStock },
          { label: "待收货", value: inv.waitReceiveNum },
          { label: "待发货", value: inv.waitDeliveryInventoryNum },
          { label: "待审核库存", value: inv.waitApproveInventoryNum },
          { label: "不可用库存", value: inv.unavailableWarehouseInventoryNum },
          { label: "预占库存", value: inv.expectedOccupiedInventoryNum },
          { label: "正常锁定", value: inv.normalLockNumber },
          { label: "库存区域", value: raw.inventoryRegion },
          { label: "仓库分组", value: Array.isArray(raw.warehouseGroupList) ? raw.warehouseGroupList.join("/") : raw.warehouseGroupList },
        ],
      },
      {
        title: "运营/买手",
        fields: [
          { label: "买手", value: record.buyerName, accent: true },
          { label: "买手 ID", value: record.buyerUid },
          { label: "供应商 ID", value: raw.supplierId },
          { label: "供应商名称", value: raw.supplierName },
          { label: "结算类型", value: raw.settlementType },
          { label: "ASF 评分", value: record.asfScore },
          { label: "评论数", value: record.commentNum },
          { label: "品质售后率", value: record.qualityAfterSalesRate },
          { label: "图片审核状态", value: record.pictureAuditStatus },
          { label: "微瑕疵", value: raw.minorFlaw },
          { label: "热卖标签", value: record.hotTag },
          { label: "广告商品", value: raw.isAdProduct ? "是" : "" },
          { label: "广告类型", value: Array.isArray(raw.adTypeList) ? raw.adTypeList.join("/") : raw.adTypeList },
          { label: "店铺履约率", value: raw.mallDeliverRate },
        ],
      },
      {
        title: "供货/备货",
        fields: [
          { label: "库存状态", value: raw.stockStatus },
          { label: "供货状态", value: raw.supplyStatus },
          { label: "供货状态备注", value: raw.supplyStatusRemark },
          { label: "正常供货预计时间", value: raw.expectNormalSupplyTime },
          { label: "缺货", value: raw.isLack ? "是" : "" },
          { label: "库存充足", value: raw.isEnoughStock ? "是" : "" },
          { label: "建议备货", value: raw.isAdviceStock ? "是" : "" },
          { label: "今日已申请备货", value: raw.isApplyStockToday ? "是" : "" },
          { label: "今日申请备货数", value: raw.todayApplyStockNum },
          { label: "建议关闭 JIT", value: raw.suggestCloseJit ? "是" : "" },
          { label: "JIT 关闭状态", value: raw.closeJitStatus },
          { label: "首采等待", value: qty.waitFirstPurchaseSkcNum },
          { label: "首采未发", value: qty.firstPurchaseNotShippedSkcNum },
        ],
      },
      {
        title: "履约/售后",
        fields: [
          { label: "备货单", value: stockOrderRows.length || "" },
          { label: "备货未完成", value: pendingStockOrderCount || "" },
          { label: "备货进度", value: stockDemandQty ? `${stockDeliveredQty}/${stockDemandQty}` : "" },
          { label: "售后单", value: afterSaleRows.length || "" },
          { label: "售后未完结", value: pendingAfterSaleCount || "" },
          { label: "售后件数", value: afterSaleQty || "" },
          { label: "售后金额", value: afterSaleAmountCents ? formatActivityMoney(afterSaleAmountCents, afterSaleCurrency) : "" },
        ],
      },
      {
        title: "状态/合规",
        fields: [
          { label: "商品状态", value: record.status || normalizeStatusText(record.removeStatus) },
          { label: "SKC 站点状态", value: normalizeStatusText(record.skcSiteStatus) },
          { label: "下架状态", value: record.removeStatus },
          { label: "限流状态", value: record.flowLimitStatus },
          { label: "黑名单", value: record.inBlackList },
          { label: "违规影响类型", value: raw.illegalImpactType },
          { label: "违规原因", value: raw.illegalReason },
          { label: "停售类型", value: raw.haltSalesType },
          { label: "停售开始时间", value: raw.haltSalesStartTime },
          { label: "停售结束时间", value: raw.haltSalesEndTime },
        ],
      },
    ];

    const allFieldsTab = (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {groups.map((group) => {
          const visibleFields = group.fields.filter((f) => hasMeaningfulSnapshotValue(f.value));
          if (visibleFields.length === 0) return null;
          return (
            <div key={group.title} className="app-surface material-detail-section" style={{ padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "var(--color-brand)" }}>{group.title}</div>
              <div style={{ display: "grid", gap: 8 }}>
                {visibleFields.map((field) => (
                  <div key={field.label}>
                    {renderSnapshotField(field.label, field.value, field.accent)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
    // ----- 标签 Tab -----
    const labelGroups: { title: string; items: any }[] = [
      { title: "SKC 标签", items: raw.skcLabels },
      { title: "节日/季节标签", items: raw.holidayLabelList },
      { title: "自定义标签", items: raw.customLabelList },
      { title: "采购标签", items: raw.purchaseLabelList },
      { title: "广告类型", items: raw.adTypeList },
      { title: "命中规则", items: raw.hitRuleDetailList },
      { title: "商品属性", items: raw.productProperties },
    ].filter((g) => Array.isArray(g.items) && g.items.length > 0);

    const labelTab = labelGroups.length > 0 ? (
      <div style={{ display: "grid", gap: 12 }}>
        {labelGroups.map((g) => (
          <div key={g.title} className="app-surface material-detail-section" style={{ padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--color-text-sec)", marginBottom: 6 }}>{g.title}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {g.items.map((item: any, idx: number) => {
                const text = typeof item === "string" ? item
                  : item?.tagName || item?.labelName || item?.name || item?.text || JSON.stringify(item);
                return <Tag key={idx}>{String(text).slice(0, 40)}</Tag>;
              })}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <Alert type="info" showIcon message="暂无标签数据" />
    );
    const drawerItems = [
      { key: "overview", label: "概览", children: overviewTab },
      { key: "flux", label: "流量驾驶舱", children: fluxTab },
      { key: "fulfillment", label: `履约售后${stockOrderRows.length + afterSaleRows.length ? ` ${stockOrderRows.length + afterSaleRows.length}` : ""}`, children: fulfillmentTab },
      { key: "sku", label: "SKU", children: skuTab },
      { key: "fields", label: "全部字段", children: allFieldsTab },
      { key: "labels", label: "标签", children: labelTab },
    ];

    return (
      <Drawer
        width={Math.min(1080, typeof window !== "undefined" ? window.innerWidth - 80 : 1080)}
        open={Boolean(selectedProduct)}
        onClose={() => setSelectedProduct(null)}
        title={(
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {record.imageUrl ? (
              <Image src={record.imageUrl} width={60} height={60} preview={{ mask: <EyeOutlined /> }} fallback={EMPTY_IMAGE_FALLBACK} />
            ) : null}
            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{record.title || "未命名商品"}</div>
              <div style={{ fontSize: 13, color: "var(--color-text-sec)", fontFamily: "Consolas, monospace" }}>
                SKC {formatTextValue(record.skcId)} · 货号 {formatTextValue(record.extCode || record.sku)}
              </div>
            </div>
          </div>
        )}
        destroyOnClose
      >
        <Tabs
          activeKey={drawerTab}
          onChange={setDrawerTab}
          items={drawerItems}
          destroyInactiveTabPane
        />
      </Drawer>
    );
  };

  const emptyState = !loading && products.length === 0;
  const filteredEmptyState = !loading && products.length > 0 && filteredProducts.length === 0;


  // 顶部 4 个核心指标 + 可点击筛选标签
  const saleOutCount = salesSummary?.saleOutSkcNum || 0;
  const shortageCount = salesSummary?.shortageSkcNum || 0;
  const adviceCount = salesSummary?.adviceStockSkcNum || 0;
  const soonSaleOutCount = salesSummary?.soonSaleOutSkcNum || 0;
  const adSkcCount = salesSummary?.adSkcNum || 0;
  const productCommandTone = hasAccount === false
    ? "warning"
    : saleOutCount + shortageCount + cloudRiskCount > 0
      ? "warning"
      : "success";
  const productCommandMetrics = [
    {
      label: "商品总数",
      value: totalProducts,
      detail: `${filteredProducts.length} 个当前可见`,
    },
    {
      label: "云端 SKC",
      value: cloudSkcMap.size,
      detail: `${salesAttachedCount} 个有销售快照`,
    },
    {
      label: "售罄",
      value: saleOutCount,
      detail: "点击筛选售罄商品",
      tone: saleOutCount > 0 ? "warning" : "success",
      filter: "saleOut" as StatusFilter,
    },
    {
      label: "即将售罄",
      value: soonSaleOutCount,
      detail: "库存可售天数小于 7",
      tone: soonSaleOutCount > 0 ? "warning" : "success",
      filter: "soonSaleOut" as StatusFilter,
    },
    {
      label: "缺货",
      value: shortageCount,
      detail: "点击筛选缺货商品",
      tone: shortageCount > 0 ? "warning" : "success",
      filter: "shortage" as StatusFilter,
    },
    {
      label: "建议备货",
      value: adviceCount,
      detail: "点击筛选需备货商品",
      tone: adviceCount > 0 ? "warning" : "success",
      filter: "advice" as StatusFilter,
    },
    {
      label: "广告商品",
      value: adSkcCount,
      detail: "当前广告覆盖商品",
    },
    {
      label: "活动数据",
      value: activityCatalogCounts.all || cloudActivityCount,
      detail: `${cloudActivityCount} 条活动快照 · ${activityCatalogCounts.linked} 条SKU价已关联`,
      tone: (activityCatalogCounts.all || cloudActivityCount) > 0 ? "success" : "warning",
    },
    {
      label: "今日销量",
      value: `${cloudShopSales?.sale_volume ?? 0} 件`,
      detail: cloudShopSales?.stat_date ? `店铺销量 ${cloudShopSales.stat_date}` : "店铺今日销量",
      tone: "success",
    },
    {
      label: "7天销量",
      value: `${cloudShopSales?.seven_days_sale_volume ?? 0} 件`,
      detail: "店铺近 7 天销量",
    },
    {
      label: "30天销量",
      value: `${cloudShopSales?.thirty_days_sale_volume ?? 0} 件`,
      detail: "店铺近 30 天销量",
    },
  ];

  return (
    <div className="dashboard-shell">
      <section className="product-list-command product-list-command--merged" aria-label="商品管理概览">
        <div className={`product-list-command__lead is-${productCommandTone}`}>
          <div className="product-list-command__head">
            <div>
              <div className="product-list-command__eyebrow">云端商品数据</div>
              <div className="product-list-command__title">商品管理</div>
            </div>
            <span className={`product-list-command__status is-${productCommandTone}`}>
              {loading ? "同步中" : hasAccount === false ? "云端未连接" : "资料就绪"}
            </span>
          </div>
          <div className="product-list-command__description">
            直接读取云端扩展上报的店铺商品，按 SKC 展示商品基础资料、销量和库存。
          </div>
          <div className="product-list-command__meta">
            <span>{formatSyncedAt(latestSyncedAt)}</span>
            <span>销售快照 {cloudSalesMap.size}</span>
            <span>SKU活动价 {activityCatalogCounts.all || cloudActivityCount}</span>
            <span>风险 {cloudRiskCount}</span>
            <span>备货 {cloudStockOrderCount}</span>
            <span>售后 {cloudAfterSaleCount}</span>
            {cloudShopSales?.stat_date ? <span>店铺销量 {cloudShopSales.stat_date}</span> : null}
          </div>
          <Space wrap>
            <Button onClick={() => setActivityCatalogOpen(true)}>
              活动数据 {activityCatalogCounts.all || cloudActivityCount}
            </Button>
            <Button type="primary" icon={<SyncOutlined spin={loading} />} loading={loading} onClick={loadProducts}>
              刷新数据
            </Button>
          </Space>
        </div>
        {productCommandMetrics.map((metric) => (
          <button
            key={metric.label}
            type="button"
            className={`product-list-command__metric${metric.tone ? ` is-${metric.tone}` : ""}${metric.filter ? " is-clickable" : ""}`}
            onClick={() => {
              if (metric.label === "活动数据") setActivityCatalogOpen(true);
              if (metric.filter) setStatusFilter(metric.filter);
            }}
          >
            <span className="product-list-command__metric-label">{metric.label}</span>
            <span className="product-list-command__metric-value">{metric.value}</span>
            <span className="product-list-command__metric-detail">{metric.detail}</span>
          </button>
        ))}
      </section>
      {hasAccount === false && products.length > 0 ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message="当前没有连接云端，商品管理只展示云端数据"
        />
      ) : null}

      {dataIssues.length > 0 ? (
        <Alert
          className="friendly-alert"
          type="warning"
          showIcon
          message="部分商品数据还没有准备好"
          description={dataIssues.slice(0, 3).join("；")}
          action={(
            <Button type="link" onClick={() => navigate("/collect")}>查看采集状态</Button>
          )}
        />
      ) : null}

      {emptyState ? (
        <div className="app-panel">
          <EmptyGuide
            icon={<AppstoreOutlined />}
            title={hasAccount === false ? "先连接云端" : "云端还没有商品数据"}
            description={
              hasAccount === false
                ? "在设置里配置云端地址和令牌后，商品管理会直接读取扩展上报的店铺商品。"
                : "浏览器扩展上传店铺后台数据后，这里会按商品 SKC 自动展示商品、销量和库存。"
            }
            action={(
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                {hasAccount === false ? (
                  <Button type="primary" onClick={() => navigate("/settings")}>前往设置云端</Button>
                ) : (
                  <Button type="primary" onClick={() => navigate("/collect")}>查看采集状态</Button>
                )}
                <Button onClick={loadProducts}>重新检查</Button>
              </div>
            )}
          />
        </div>
      ) : (
        <>
          {/* 工具栏 - SalesManagement 风格 */}
          <Card size="small" className="material-toolbar-card" style={{ marginBottom: 16 }}>
            <Space wrap>
              <Input
                placeholder="搜索商品名称/SKC/SKU/货号/买手"
                prefix={<SearchOutlined />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                style={{ width: 320 }}
                allowClear
              />
              <Radio.Group
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                size="middle"
                options={[
                  { label: `全部 ${products.length}`, value: "all" },
                  { label: `在售 ${onSaleCount}`, value: "在售" },
                ]}
              />
              <Button type="primary" icon={<SyncOutlined spin={loading} />} loading={loading} onClick={loadProducts}>
                刷新数据
              </Button>
              <Button onClick={() => setActivityCatalogOpen(true)}>活动数据 {activityCatalogCounts.all || cloudActivityCount}</Button>
              <Button icon={<SettingOutlined />} onClick={openColSettings}>列设置</Button>
              <span className="material-toolbar-meta">
                共 {products.length} 条 · 已接销售 {salesAttachedCount} · SKU活动价 {activityCatalogCounts.all || cloudActivityCount} · 备货 {cloudStockOrderCount} · 售后 {cloudAfterSaleCount}
              </span>
              {filteredProducts.length !== products.length && (
                <span className="material-toolbar-meta">
                  显示 {filteredProducts.length} / {products.length}
                </span>
              )}
            </Space>
          </Card>

          {/* 紧凑表格 */}
          <div className="app-panel">
            {filteredEmptyState ? (
              <EmptyGuide
                icon={<SearchOutlined />}
                title="没有符合当前筛选条件的商品"
                description="可以清空关键词或切回全部状态，快速回到完整商品列表。"
                action={(
                  <Button type="primary" onClick={() => { setSearchText(""); setStatusFilter("all"); }}>
                    清空筛选
                  </Button>
                )}
              />
            ) : (
              <>
              <style>{`
                /* 一个商品一行；纯白底 */
                .product-list-table .ant-table-tbody > tr > td {
                  background: #ffffff;
                  padding: 0 !important;
                  border-bottom: 1px solid #e8eaed !important;
                }
                /* 含 sku-stack 的 td：高度 1px 触发 "子元素 100% 撑满真实行高" 技巧 */
                .product-list-table .ant-table-tbody > tr > td:has(.sku-stack) {
                  vertical-align: top;
                  height: 1px;
                }
                /* 不含 sku-stack 的 td（图片/标题/总销量/操作）：垂直居中 + 正常 padding */
                .product-list-table .ant-table-tbody > tr > td:not(:has(.sku-stack)) {
                  padding: 12px 8px !important;
                  vertical-align: middle;
                }
                /* SKU 堆叠容器：height:100% 在父 td height:1px 的 hack 下会解析为真实行高 */
                .sku-stack {
                  display: flex;
                  flex-direction: column;
                  width: 100%;
                  height: 100%;
                }
                .sku-cell {
                  flex: 1 1 auto;
                  padding: 12px 10px;
                  min-height: 54px;
                  display: flex;
                  align-items: center;
                  border-bottom: 1px solid #eef2f7;
                  color: #202124;
                }
                .sku-cell--with-activity {
                  align-items: flex-start;
                  min-height: 154px;
                }
                .sku-cell:last-child { border-bottom: none; }
                /* 合计行样式：固定高度（不拉伸），浅灰底、加粗、顶边实线 */
                .sku-cell-total {
                  flex: 0 0 auto !important;
                  background: #f8fbff;
                  border-top: 1px solid #e8eaed !important;
                  border-bottom: none !important;
                  font-weight: 600;
                  min-height: 40px;
                }
                .sku-cell-total span { font-weight: 600 !important; }
                /* 行悬停淡蓝 */
                .product-list-table .ant-table-tbody > tr:hover > td { background: #f8fbff !important; }
                .product-list-table .ant-table-tbody > tr:hover .sku-cell-total { background: #e8f0fe !important; }
              `}</style>
              <Table
                className="product-list-table"
                rowKey={(record: any, index) => record._flatKey || `row-${index}`}
                dataSource={tableRows}
                columns={configuredColumns as any}
                size="small"
                loading={loading}
                rowClassName={() => "product-row"}
                pagination={{
                  defaultPageSize: 50,
                  showSizeChanger: true,
                  pageSizeOptions: [30, 50, 100, 200],
                  showTotal: (total) => `共 ${total} 个商品`,
                }}
                // 虚拟滚动：仅渲染可视区行，大数据量下避免一次性渲染数百行导致的长时间卡顿。
                // 需配合固定 scroll.y；rowKey 用稳定业务键 _flatKey（不可用 index，否则虚拟滚动错位）。
                virtual
                scroll={{ x: "max-content", y: 560 }}
                locale={{ emptyText: "暂无商品数据" }}
              />
              </>
            )}
          </div>

          {renderDrawer()}

          <Modal
            title={null}
            open={activityCatalogOpen}
            onCancel={() => setActivityCatalogOpen(false)}
            footer={null}
            width="calc(100vw - 96px)"
            destroyOnClose
            closable={false}
            className="activity-price-modal"
          >
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <div className="activity-price-modal__top">
                <div className="activity-price-modal__tabs">
                  <Segmented
                    value={activityCatalogFilter}
                    onChange={(value) => setActivityCatalogFilter(value as ActivityDetailFilter)}
                    options={[
                      { label: "全部", value: "all" },
                      { label: "进行中", value: "running" },
                      { label: "未开始", value: "notStarted" },
                    ]}
                  />
                </div>
                <Button danger type="primary" size="small" onClick={() => setActivityCatalogOpen(false)}>关闭</Button>
              </div>
              <div className="activity-price-modal__coupon-empty">暂无可显示的券信息</div>
              <div className="activity-price-modal__context">
                SKU级活动价 {activityCatalogCounts.all} 条 · 已关联商品 {activityCatalogCounts.linked} 条
              </div>
              <div style={{ display: "none" }}>
                <div style={{ minWidth: 0 }}>
                  <Typography.Text strong>扩展已上报的SKU级活动价格</Typography.Text>
                  <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                    共 {activityCatalogCounts.all} 条 · 已关联商品 {activityCatalogCounts.linked} 条
                  </Typography.Text>
                  <div style={{ marginTop: 8 }}>
                    <Typography.Text type="secondary">
                    来源为浏览器扩展上传到云端的活动、营销、报名、竞价接口；优先展示 SKU ID、SKU属性集、日常申报价和活动申报价。
                    </Typography.Text>
                  </div>
                </div>
                <Segmented
                  value={activityCatalogFilter}
                  onChange={(value) => setActivityCatalogFilter(value as ActivityDetailFilter)}
                  options={[
                    { label: `全部 ${activityCatalogCounts.all}`, value: "all" },
                    { label: `进行中 ${activityCatalogCounts.running}`, value: "running" },
                    { label: `未开始 ${activityCatalogCounts.notStarted}`, value: "notStarted" },
                  ]}
                />
              </div>
              <Table
                className="activity-price-table"
                rowKey={(row) => row.id}
                size="small"
                columns={activityCatalogColumns}
                dataSource={activityCatalogRows}
                pagination={{ pageSize: 20, showSizeChanger: false }}
                scroll={{ x: 2060, y: 560 }}
                locale={{ emptyText: "暂无云端活动数据" }}
              />
            </Space>
          </Modal>

          <Modal
            title={null}
            open={Boolean(activityDetailProduct)}
            onCancel={() => {
              setActivityDetailProduct(null);
              setActivityDetailSku(null);
            }}
            footer={null}
            width="calc(100vw - 96px)"
            destroyOnClose
            closable={false}
            className="activity-price-modal"
          >
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <div className="activity-price-modal__top">
                <div className="activity-price-modal__tabs">
                  <Segmented
                    value={activityDetailFilter}
                    onChange={(value) => setActivityDetailFilter(value as ActivityDetailFilter)}
                    options={[
                      { label: "全部", value: "all" },
                      { label: "进行中", value: "running" },
                      { label: "未开始", value: "notStarted" },
                    ]}
                  />
                </div>
                <Button
                  danger
                  type="primary"
                  size="small"
                  onClick={() => {
                    setActivityDetailProduct(null);
                    setActivityDetailSku(null);
                  }}
                >
                  关闭
                </Button>
              </div>
              <div className="activity-price-modal__coupon-empty">暂无可显示的券信息</div>
              <div className="activity-price-modal__context">
                <span>{activityDetailProduct?.title || "-"}</span>
                <span>
                  店铺 {activityDetailProduct?.mallId || "-"} · SKC {activityDetailProduct?.skcId || "-"}
                  {activityDetailSku ? ` · SKU ${activityDetailSku.skuSpec || activityDetailSku.skuId || activityDetailSku.skuExtCode || "-"}` : ""}
                  · SKU活动 {activityDetailRows.length} 条
                </span>
              </div>
              <Table
                className="activity-price-table"
                rowKey={(row) => row.id}
                size="small"
                columns={activityDetailColumns}
                dataSource={activityDetailRows}
                pagination={false}
                scroll={{ x: 1760, y: 520 }}
                locale={{ emptyText: "暂无活动数据" }}
              />
            </Space>
          </Modal>

          {/* 列设置抽屉 */}
          <Drawer
            title={null}
            open={colSettingsOpen}
            onClose={() => setColSettingsOpen(false)}
            width={360}
            styles={{ body: { padding: 0, display: "flex", flexDirection: "column" } }}
            closable={false}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>自定义列</span>
              <Button type="link" size="small" onClick={() => setColSettingsOpen(false)} style={{ fontSize: 18, padding: 0 }}>✕</Button>
            </div>
            <div style={{ padding: "8px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>请勾选需要显示的字段，可拖换调整顺序</span>
              <Button type="link" size="small" onClick={resetColSettings}>重置</Button>
            </div>
            <div style={{ padding: "8px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8 }}>
              <Checkbox
                checked={allSelected}
                indeterminate={!allSelected && tempHidden.length < allColumnKeys.length}
                onChange={() => {
                  if (allSelected) setTempHidden([...allColumnKeys]);
                  else setTempHidden([]);
                }}
              />
              <span style={{ fontWeight: 500 }}>全选</span>
              <span style={{ color: "var(--color-text-muted)", marginLeft: "auto", fontSize: 13 }}>{visibleCount}/{allColumnKeys.length}</span>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "0 0 80px 0" }}>
              {columnGroups.map((group) => {
                const groupKeySet = new Set(group.keys.filter((k) => colMap.has(k)));
                if (groupKeySet.size === 0) return null;
                // 按 tempOrder 排列组内项目
                const validKeys = tempOrder.filter((k) => groupKeySet.has(k));
                // 补充 tempOrder 里没有的
                for (const k of groupKeySet) { if (!validKeys.includes(k)) validKeys.push(k); }
                const groupAllVisible = validKeys.every((k) => !tempHidden.includes(k));
                const groupSomeVisible = validKeys.some((k) => !tempHidden.includes(k));
                return (
                  <div key={group.label} style={{ borderBottom: "1px solid #f8fbff" }}>
                    <div style={{ padding: "10px 20px", display: "flex", alignItems: "center", gap: 8, background: "#f8fbff" }}>
                      <Checkbox
                        checked={groupAllVisible}
                        indeterminate={!groupAllVisible && groupSomeVisible}
                        onChange={() => tempToggleGroup(validKeys)}
                      />
                      <span style={{ fontWeight: 600, fontSize: 14, color: "#1a73e8" }}>{group.label}</span>
                    </div>
                    {validKeys.map((key) => {
                      const col = colMap.get(key)!;
                      const label = typeof col.title === "string" ? col.title : key;
                      const isHidden = tempHidden.includes(key);
                      const isDragOver = dragOverKey === key;
                      return (
                        <div
                          key={key}
                          draggable
                          onDragStart={() => handleDragStart(key, group.label)}
                          onDragOver={(e) => handleDragOver(e, key)}
                          onDrop={(e) => handleDrop(e, key, group.label)}
                          onDragEnd={handleDragEnd}
                          style={{
                            padding: "8px 20px 8px 44px",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            borderTop: isDragOver ? "2px solid #1a73e8" : "2px solid transparent",
                            background: isDragOver ? "#e6f4ff" : "transparent",
                            transition: "background 0.15s",
                            cursor: "grab",
                          }}
                        >
                          <Checkbox checked={!isHidden} onChange={() => tempToggle(key)} onClick={(e) => e.stopPropagation()} />
                          <span style={{ flex: 1, fontSize: 14, color: isHidden ? "#999" : "#333", userSelect: "none" }}>{label}</span>
                          <span style={{ color: "#bbb", fontSize: 16, cursor: "grab", userSelect: "none" }}>☰</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "12px 20px", borderTop: "1px solid var(--color-border)", background: "#fff", display: "flex", gap: 12, justifyContent: "center" }}>
              <Button type="primary" onClick={confirmColSettings} style={{ minWidth: 80 }}>确认</Button>
              <Button onClick={() => setColSettingsOpen(false)} style={{ minWidth: 80 }}>取消</Button>
            </div>
          </Drawer>

          <Modal
            title={`动销详情 (ID: ${gpDetailRow?.productId || "-"})`}
            open={gpDetailOpen}
            onCancel={() => setGpDetailOpen(false)}
            footer={null}
            width={1100}
            destroyOnClose
          >
            <div style={{ marginBottom: 12, color: "#888", fontSize: 12 }}>
              {gpDetailRow?.productName} {gpDetailRow?.skcId ? `· SKC ${gpDetailRow.skcId}` : ""}
            </div>
            <Space style={{ marginBottom: 12 }}>
              <Typography.Text strong>时间段：</Typography.Text>
              <Segmented
                value={gpDetailRange}
                options={(gpDetailRow?.availableRanges || gpDetailRangeOptions).map((value) => ({
                  value,
                  label: value === "30d" ? "30天" : value === "7d" ? "7天" : "昨天",
                }))}
                onChange={(val) => {
                  const r = val as "1d" | "7d" | "30d";
                  setGpDetailRange(r);
                  const cachedDetail = gpDetailRow?.regionDetailsByRange?.[r] || gpDetailRow?.fallbackDetail || null;
                  setGpDetailData(
                    cachedDetail || {
                      error: gpDetailCacheMissingMessage,
                    },
                  );
                }}
                disabled={gpDetailLoading}
              />
            </Space>
            {gpDetailLoading ? (
              <div style={{ height: 240, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Spin tip="正在读取缓存…" />
              </div>
            ) : gpDetailData && gpDetailData.rows?.length > 0 ? (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Statistic title="总销量" value={gpDetailData.total} suffix="件" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
                  {(["欧洲", "亚洲", "美洲", "非洲", "大洋洲"] as const).map((c) => {
                    const rows = gpDetailData.grouped?.[c] || [];
                    return (
                      <Card key={c} size="small" title={c} bodyStyle={{ padding: 8 }}>
                        {rows.length === 0 ? (
                          <div style={{ textAlign: "center", color: "#bbb", padding: "12px 0" }}>-</div>
                        ) : (
                          <table style={{ width: "100%", fontSize: 12 }}>
                            <thead>
                              <tr style={{ color: "#888" }}>
                                <th style={{ textAlign: "left", padding: "4px 6px" }}>站点</th>
                                <th style={{ textAlign: "right", padding: "4px 6px" }}>销量</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r: any) => (
                                <tr key={r.regionId}>
                                  <td style={{ padding: "4px 6px" }}>{r.regionName}</td>
                                  <td style={{ padding: "4px 6px", textAlign: "right", color: "#1a73e8", fontWeight: 600 }}>{r.sales}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </>
            ) : (
              <Empty description={gpDetailData?.error || "暂无数据"} />
            )}
          </Modal>
        </>
      )}
    </div>
  );
}
