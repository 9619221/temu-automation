import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, Col, Drawer, Empty, Image, Input, Modal, Radio, Row, Segmented, Space, Spin, Statistic, Table, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  AppstoreOutlined,
  FireOutlined,
  PictureOutlined,
  SearchOutlined,
  SettingOutlined,
  ShoppingCartOutlined,
  StopOutlined,
  SyncOutlined,
  WarningOutlined,
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
import PageHeader from "../components/PageHeader";
import {
  parseOrdersData,
  parseFluxData,
  parseProductCountSummary,
  parseProductsData,
  parseSalesData,
} from "../utils/parseRawApis";
import {
  COLLECTION_DIAGNOSTICS_KEY,
  getCollectionDataIssue,
  normalizeCollectionDiagnostics,
  type CollectionDiagnostics,
} from "../utils/collectionDiagnostics";
import { getStoreValue } from "../utils/storeCompat";
import { ACTIVE_ACCOUNT_CHANGED_EVENT, STORE_VALUE_UPDATED_EVENT } from "../utils/multiStore";
import { TrafficDriverPanel, buildTrafficDriverSitesFromProduct, type TrafficSiteKey } from "../components/TrafficDriverPanel";
import ProductFluxOperatorCard from "../components/ProductFluxOperatorCard";

const store = window.electronAPI?.store;
const automation = window.electronAPI?.automation;

type StatusFilter = "all" | "在售" | "已下架" | "未发布" | "other" | "saleOut" | "soonSaleOut" | "shortage" | "advice";

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
  expose: "#ff8a1f",
  clickRate: "#4e79a7",
  clickPayRate: "#16a34a",
  detail: "#2563eb",
  cart: "#9333ea",
  collect: "#ec4899",
  order: "#0f766e",
  search: "#ff8a1f",
  recommend: "#4e79a7",
  other: "#f6bd16",
  grid: "#eceef2",
  axis: "#8c8c8c",
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
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);
  const [diagnostics, setDiagnostics] = useState<CollectionDiagnostics | null>(null);
  const [sourceState, setSourceState] = useState<ProductSourceState>(EMPTY_SOURCES);
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);
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

  const loadProducts = async () => {
    setLoading(true);
    try {
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

      mergedProducts.sort((a, b) => {
        if ((b.totalSales || 0) !== (a.totalSales || 0)) return (b.totalSales || 0) - (a.totalSales || 0);
        if ((b.last7DaysSales || 0) !== (a.last7DaysSales || 0)) return (b.last7DaysSales || 0) - (a.last7DaysSales || 0);
        return (a.title || "").localeCompare(b.title || "", "zh-CN");
      });

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
  const latestSyncedAt = getLatestSyncedAt(products, diagnostics);
  const salesAttachedCount = products.filter((product) => product.hasSalesSnapshot).length;

  const dataIssues = [
    getCollectionDataIssue(diagnostics, "products", "商品列表", sourceState.products),
    getCollectionDataIssue(diagnostics, "sales", "销售数据", sourceState.sales),
    getCollectionDataIssue(diagnostics, "orders", "备货单数据", sourceState.orders),
  ].filter((issue): issue is string => Boolean(issue));

  const numColor = (val: number, base = "#389e0d") => ({ color: val > 0 ? base : "#bfbfbf", fontWeight: val > 0 ? 600 : 400 });

  // 一个商品一行；每行内部把 SKU 列表作为 _skuRows 保留，供列渲染时纵向堆叠。
  // 第一条永远是 "合计" 汇总行。
  const tableRows = useMemo(() => {
    return filteredProducts.map((product, productIdx) => {
      const skuList: any[] = Array.isArray(product.salesRaw?.skuQuantityDetailList)
        ? product.salesRaw.skuQuantityDetailList
        : [];
      const groupKey = product.skcId || product.goodsId || product.spuId || product.title || `p${productIdx}`;

      const isSingle = skuList.length === 1;
      const realSkus = skuList.length > 0
        ? skuList.map((sku: any, idx: number) => {
            const skuToday = Number(sku?.todaySaleVolume || 0);
            const sku7d = Number(sku?.lastSevenDaysSaleVolume || 0);
            const sku30d = Number(sku?.lastThirtyDaysSaleVolume || 0);
            const skuStock = Number(sku?.sellerWhStock || 0);
            const skuOccupy = Number(sku?.inventoryNumInfo?.expectedOccupiedInventoryNum || 0);
            const skuUnavail = Number(sku?.inventoryNumInfo?.unavailableWarehouseInventoryNum || 0);
            const skuInTransit = Number(sku?.inventoryNumInfo?.waitReceiveNum || 0);
            const skuLack = Number(sku?.lackQuantity || 0);
            const skuAdvice = Number(sku?.adviceQuantity || 0);
            // 单 SKU 商品：若 SKU 自身无数据则用商品级兜底
            const fb = (skuVal: number, prodVal: any) => (isSingle && !skuVal ? Number(prodVal || 0) : skuVal);
            return {
              _skuKey: `${groupKey}-sku-${sku?.productSkuId || idx}`,
              skuId: sku?.productSkuId || "",
              skuSpec: sku?.className || "",
              skuExtCode: sku?.skuExtCode || "",
              skuPrice: sku?.supplierPrice != null
                ? (Number(sku.supplierPrice) / 100).toFixed(2)
                : product.price,
              today: fb(skuToday, product.todaySales),
              d7: fb(sku7d, product.last7DaysSales),
              d30: fb(sku30d, product.last30DaysSales),
              stock: fb(skuStock, product.warehouseStock),
              occupy: fb(skuOccupy, product.occupyStock),
              unavail: fb(skuUnavail, product.unavailableStock),
              inTransit: skuInTransit,
              lack: fb(skuLack, product.lackQuantity),
              advice: skuAdvice,
            };
          })
        : [{
            _skuKey: `${groupKey}-product`,
            skuId: product.skuId || "",
            skuSpec: product.skuName || "",
            skuExtCode: product.extCode || "",
            skuPrice: product.price,
            today: Number(product.todaySales || 0),
            d7: Number(product.last7DaysSales || 0),
            d30: Number(product.last30DaysSales || 0),
            stock: Number(product.warehouseStock || 0),
            occupy: Number(product.occupyStock || 0),
            unavail: Number(product.unavailableStock || 0),
            inTransit: 0,
            lack: Number(product.lackQuantity || 0),
            advice: 0,
          }];

      // 汇总行：优先用 SKU 加总，若 SKU 里该字段全为 0 则回退到商品级总值
      const sum = (pick: (s: any) => number) => realSkus.reduce((acc, s) => acc + (Number(pick(s)) || 0), 0);
      const sumOrFallback = (pick: (s: any) => number, fallback: number) => {
        const v = sum(pick);
        return v > 0 ? v : Number(fallback || 0);
      };
      const totalRow = {
        _skuKey: `${groupKey}-total`,
        _isTotal: true,
        skuId: "",
        skuSpec: "合计",
        skuExtCode: "",
        skuPrice: "",
        today: sumOrFallback((s) => s.today, product.todaySales || 0),
        d7: sumOrFallback((s) => s.d7, product.last7DaysSales || 0),
        d30: sumOrFallback((s) => s.d30, product.last30DaysSales || 0),
        stock: sumOrFallback((s) => s.stock, product.warehouseStock || 0),
        occupy: sumOrFallback((s) => s.occupy, product.occupyStock || 0),
        unavail: sumOrFallback((s) => s.unavail, product.unavailableStock || 0),
        inTransit: sum((s) => s.inTransit),
        lack: sumOrFallback((s) => s.lack, product.lackQuantity || 0),
        advice: sum((s) => s.advice),
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
          <div style={{ width: 80, height: 80, background: "#f0f0f0", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><PictureOutlined /></div>
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
            {getPrimaryCategory(record) && <div style={{ color: "#8c8c8c" }}>{getPrimaryCategory(record)}</div>}
            {(score != null || comment != null) && (
              <div style={{ color: "#faad14" }}>
                {score != null ? <span>★ {score}分</span> : <span style={{ color: "#8c8c8c" }}>暂无评分</span>}
                {comment != null && <span style={{ color: "#8c8c8c" }}> · 评论 {comment}</span>}
              </div>
            )}
            {record.skcId && <div style={{ color: "#8c8c8c" }}>SKC：<span style={{ fontFamily: "monospace" }}>{record.skcId}</span></div>}
            {productDays != null && productDays !== "" && <div style={{ color: "#8c8c8c" }}>加入站点时长：{productDays}天</div>}
            {record.spuId && <div style={{ color: "#8c8c8c" }}>SPU：<span style={{ fontFamily: "monospace" }}>{record.spuId}</span></div>}
            {seasonTag && <div style={{ color: "#8c8c8c" }}>节日/季节标签：{seasonTag}</div>}

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
            </div>

            {/* 云舵卡区块 */}
            {(y || gp) && (
              <div style={{ marginTop: 5, padding: "5px 8px", background: "#fafafa", borderRadius: 6, border: "1px solid #f0f0f0", fontSize: 13, lineHeight: 1.55 }}>
                {buyerLine && <div><span style={{ color: "#888" }}>买手：</span><Tag color="orange" style={{ fontSize: 12, margin: 0 }}>{buyerLine}</Tag></div>}
                {y?.category && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                    <span style={{ color: "#888", flexShrink: 0 }}>类目：</span>
                    <Tooltip title={y.category}><span style={{ flex: 1, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{y.category}</span></Tooltip>
                    <a style={{ fontSize: 12, color: "#1677ff", flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(y.category); message.success("已复制"); }}>复制</a>
                  </div>
                )}
                {sites.length > 0 && (
                  <div><span style={{ color: "#888" }}>销售：</span><span style={{ color: "#1677ff" }}>{sites.slice(0, 3).map(siteName).join("，")}</span>{sites.length > 3 && <Tag color="blue" style={{ fontSize: 12, marginLeft: 4 }}>共 {sites.length} 站</Tag>}</div>
                )}
                {offSites.length > 0 && (
                  <div><span style={{ color: "#888" }}>下架：</span><span style={{ color: "#8c8c8c" }}>{offSites.slice(0, 3).map(siteName).join("，")}{offSites.length > 3 ? `…` : ""}</span></div>
                )}
                {gp && (
                  <div style={{ textAlign: "right" }}>
                    <a style={{ fontSize: 13, color: "#1677ff" }} onClick={(e) => { e.stopPropagation(); openGpDetail(record); }}>动销详情 →</a>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: "SKU",
      key: "skuId",
      width: 150,
      render: (_: any, record: any) => (
        <div className="sku-stack">
          {(record._skuRows || []).map((s: any) => (
            <div className={`sku-cell${s._isTotal ? " sku-cell-total" : ""}`} key={s._skuKey}>
              {s._isTotal
                ? <span style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>合计</span>
                : s.skuId
                  ? <span style={{ fontSize: 13, fontFamily: "monospace", color: "#262626" }}>{s.skuId}</span>
                  : <span style={{ color: "#bfbfbf" }}>-</span>}
            </div>
          ))}
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
              <span style={{ fontSize: 15, ...numColor(s.today) }}>{s.today}</span>
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
              <span style={{ fontSize: 15, ...numColor(s.d7) }}>{s.d7}</span>
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
              <span style={{ fontSize: 15, ...numColor(s.d30) }}>{s.d30}</span>
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
      render: (val: number) => <span style={{ fontSize: 18, fontWeight: 700, color: (val || 0) > 0 ? "#1677ff" : "#bfbfbf" }}>{val || 0}</span>,
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
              <span style={{ fontSize: 15, color: s.stock > 0 ? "#1677ff" : "#ff4d4f", fontWeight: 600 }}>{s.stock}</span>
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
              <span style={{ fontSize: 15, color: s.occupy > 0 ? "#08979c" : "#bfbfbf", fontWeight: s.occupy > 0 ? 600 : 400 }}>{s.occupy}</span>
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
              <span style={{ fontSize: 15, color: s.unavail > 0 ? "#d46b08" : "#bfbfbf", fontWeight: s.unavail > 0 ? 600 : 400 }}>{s.unavail}</span>
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
              <span style={{ fontSize: 15, color: s.inTransit > 0 ? "#1677ff" : "#bfbfbf", fontWeight: s.inTransit > 0 ? 600 : 400 }}>{s.inTransit}</span>
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
              <span style={{ fontSize: 15, color: s.lack > 0 ? "#cf1322" : "#bfbfbf", fontWeight: s.lack > 0 ? 700 : 400 }}>{s.lack}</span>
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
              <span style={{ fontSize: 15, color: s.advice > 0 ? "#d4380d" : "#bfbfbf", fontWeight: s.advice > 0 ? 700 : 400 }}>{s.advice || "-"}</span>
            </div>
          ))}
        </div>
      ),
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
  ];

  // ============ 列配置（显示/隐藏 + 排序） ============
  const COLUMN_STORAGE_KEY = "product-list-column-config";
  const allColumnKeys = columns.map((c: any) => c.key as string).filter(Boolean);

  // 列分组定义
  const columnGroups: Array<{ label: string; keys: string[] }> = [
    { label: "商品信息", keys: ["imageUrl", "title"] },
    { label: "SKU信息", keys: ["skuId", "skuSpec", "skuExtCode"] },
    { label: "申报价格", keys: ["price"] },
    { label: "销售数据", keys: ["todaySales", "last7DaysSales", "last30DaysSales", "totalSales"] },
    { label: "缺货数量", keys: ["lackQuantity"] },
    { label: "库存数据", keys: ["warehouseStock", "occupy", "unavail", "inTransit"] },
    { label: "备货建议", keys: ["advice"] },
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
    const colMap = new Map(columns.map((c: any) => [c.key, c]));
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

  const colMap = new Map(columns.map((c: any) => [c.key, c]));

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

      // 方法0（最高优先级）: 从 temu_flux_product_history_cache 直接读取商品级 30 天日趋势
      // cache 结构: { goodsId: { stations: { 全球|美国|欧区: { daily: [{date,exposeNum,...}] } } } }
      const cacheSiteLabel = activeFluxSite?.siteLabel;
      if (cacheSiteLabel && productHistoryCache && Object.keys(productHistoryCache).length > 0) {
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

      // 方法1: 从 flux_history 日快照获取历史数据（只有 cache 没命中时才用）
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
            accent: currentFluxSummary.exposeClickRate < 3 ? "#e11d48" : currentFluxSummary.clickPayRate < 5 ? "#f97316" : "#2563eb",
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
      <div style={{ padding: "8px 12px", background: "var(--color-bg-1, #fafafa)", borderRadius: 8 }}>
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
        style={{ borderRadius: 16, borderColor: "rgba(255,138,31,0.12)", boxShadow: "0 10px 30px rgba(15,23,42,0.04)" }}
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
          <div className="app-surface" style={{ padding: 16, borderRadius: 18 }}>
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
                    <stop offset="0%" stopColor="#ff8a1f" stopOpacity={0.38} />
                    <stop offset="100%" stopColor="#ff8a1f" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={PRODUCT_TRAFFIC_COLORS.grid} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: PRODUCT_TRAFFIC_COLORS.axis }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 12, fill: PRODUCT_TRAFFIC_COLORS.axis }} allowDecimals={false} />
                <ReTooltip formatter={(value: any) => [formatTrafficNumber(value), "销量"]} />
                <Area type="monotone" dataKey="salesNumber" stroke="#ff8a1f" strokeWidth={2.5} fill="url(#salesTrendFill)" />
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
          <div key={`${s.productSkuId}-${s.extCode}`} style={{ display: "flex", gap: 8, alignItems: "center", padding: 8, background: "var(--color-bg-1, #fafafa)", borderRadius: 8 }}>
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
    void skuTab; // 保留

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
            <div key={group.title} className="app-surface" style={{ padding: 12, borderRadius: 12 }}>
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
    void allFieldsTab; // 保留

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
          <div key={g.title} className="app-surface" style={{ padding: 12, borderRadius: 12 }}>
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
    void labelTab; // 保留

    return (
      <Drawer
        width={Math.min(1080, typeof window !== "undefined" ? window.innerWidth - 80 : 1080)}
        open={Boolean(selectedProduct)}
        onClose={() => setSelectedProduct(null)}
        title={(
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {record.imageUrl ? (
              <Image src={record.imageUrl} width={60} height={60} preview={{ mask: "查看大图" }} fallback={EMPTY_IMAGE_FALLBACK} />
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
        {drawerTab === "flux" ? fluxTab : overviewTab}
      </Drawer>
    );
  };

  const emptyState = !loading && products.length === 0;
  const filteredEmptyState = !loading && products.length > 0 && filteredProducts.length === 0;


  // 顶部 4 个核心指标 + 可点击筛选标签
  const saleOutCount = salesSummary?.saleOutSkcNum || 0;
  const shortageCount = salesSummary?.shortageSkcNum || 0;
  const adviceCount = salesSummary?.adviceStockSkcNum || 0;

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="商品数据"
        title="商品管理"
        subtitle="紧凑表格 + 详情抽屉，集中查看商品基础资料、销量趋势和 SKU 字段。"
        meta={[
          formatSyncedAt(latestSyncedAt),
          hasAccount === false ? "本地历史数据" : null,
        ].filter(Boolean)}
        actions={(
          <Button type="primary" icon={<SyncOutlined />} loading={loading} onClick={loadProducts}>
            刷新数据
          </Button>
        )}
      />
      {hasAccount === false && products.length > 0 ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message="当前没有绑定账号，正在展示本地历史数据"
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
            <Button type="link" onClick={() => navigate("/collect")}>前往采集</Button>
          )}
        />
      ) : null}

      {emptyState ? (
        <div className="app-panel">
          <EmptyGuide
            icon={<AppstoreOutlined />}
            title={hasAccount === false ? "先绑定店铺账号" : "先执行一次数据采集"}
            description={
              hasAccount === false
                ? "绑定 Temu 店铺账号后，商品列表会自动汇总商品、销量和库存数据。"
                : "执行商品列表、销售数据和备货单采集后，这里会自动出现统计指标和商品表格。"
            }
            action={(
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                {hasAccount === false ? (
                  <Button type="primary" onClick={() => navigate("/accounts")}>前往绑定店铺</Button>
                ) : (
                  <Button type="primary" onClick={() => navigate("/collect")}>前往数据采集</Button>
                )}
                <Button onClick={loadProducts}>重新检查</Button>
              </div>
            )}
          />
        </div>
      ) : (
        <>
          {/* 汇总指标卡片 - SalesManagement 风格 */}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col span={4}>
              <Card size="small">
                <Statistic title="商品总数" value={totalProducts} prefix={<ShoppingCartOutlined />} valueStyle={{ color: "#1890ff" }} />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="售罄" value={saleOutCount} prefix={<StopOutlined />} valueStyle={{ color: "#ff4d4f" }} />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="即将售罄" value={salesSummary?.soonSaleOutSkcNum || 0} prefix={<WarningOutlined />} valueStyle={{ color: "#fa8c16" }} />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="缺货" value={shortageCount} valueStyle={{ color: "#fa541c" }} />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="建议备货" value={adviceCount} valueStyle={{ color: "#fa541c" }} />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="广告商品" value={salesSummary?.adSkcNum || 0} prefix={<FireOutlined />} valueStyle={{ color: "#722ed1" }} />
              </Card>
            </Col>
          </Row>


          {/* 工具栏 - SalesManagement 风格 */}
          <Card size="small" style={{ marginBottom: 16 }}>
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
              <Button icon={<SettingOutlined />} onClick={openColSettings}>列设置</Button>
              <span style={{ color: "#8c8c8c", fontSize: 13 }}>
                共 {products.length} 条 · 已接销售 {salesAttachedCount}
              </span>
              {filteredProducts.length !== products.length && (
                <span style={{ color: "#8c8c8c", fontSize: 13 }}>
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
                  border-bottom: 2px solid #e4e9f0 !important;
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
                  border-bottom: 1px dashed #e8e8e8;
                  color: #262626;
                }
                .sku-cell:last-child { border-bottom: none; }
                /* 合计行样式：固定高度（不拉伸），浅灰底、加粗、顶边实线 */
                .sku-cell-total {
                  flex: 0 0 auto !important;
                  background: #fafbfc;
                  border-top: 1px solid #e4e9f0 !important;
                  border-bottom: none !important;
                  font-weight: 600;
                  min-height: 40px;
                }
                .sku-cell-total span { font-weight: 600 !important; }
                /* 行悬停淡蓝 */
                .product-list-table .ant-table-tbody > tr:hover > td { background: #f5faff !important; }
                .product-list-table .ant-table-tbody > tr:hover .sku-cell-total { background: #e6f4ff !important; }
              `}</style>
              <Table
                className="product-list-table"
                rowKey={(record: any, index) => `row-${index}-${record._flatKey || ""}`}
                dataSource={tableRows}
                columns={configuredColumns as any}
                size="small"
                loading={loading}
                rowClassName={() => "product-row"}
                pagination={{
                  pageSize: 50,
                  showSizeChanger: true,
                  pageSizeOptions: [30, 50, 100, 200],
                  showTotal: (total) => `共 ${total} 个商品`,
                }}
                scroll={{ x: 2300 }}
                locale={{ emptyText: "暂无商品数据" }}
              />
              </>
            )}
          </div>

          {renderDrawer()}

          {/* 列设置抽屉 */}
          <Drawer
            title={null}
            open={colSettingsOpen}
            onClose={() => setColSettingsOpen(false)}
            width={360}
            styles={{ body: { padding: 0, display: "flex", flexDirection: "column" } }}
            closable={false}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>自定义列</span>
              <Button type="link" size="small" onClick={() => setColSettingsOpen(false)} style={{ fontSize: 18, padding: 0 }}>✕</Button>
            </div>
            <div style={{ padding: "8px 20px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "#8c8c8c", fontSize: 13 }}>请勾选需要显示的字段，可拖换调整顺序</span>
              <Button type="link" size="small" onClick={resetColSettings}>重置</Button>
            </div>
            <div style={{ padding: "8px 20px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 8 }}>
              <Checkbox
                checked={allSelected}
                indeterminate={!allSelected && tempHidden.length < allColumnKeys.length}
                onChange={() => {
                  if (allSelected) setTempHidden([...allColumnKeys]);
                  else setTempHidden([]);
                }}
              />
              <span style={{ fontWeight: 500 }}>全选</span>
              <span style={{ color: "#8c8c8c", marginLeft: "auto", fontSize: 13 }}>{visibleCount}/{allColumnKeys.length}</span>
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
                  <div key={group.label} style={{ borderBottom: "1px solid #f5f5f5" }}>
                    <div style={{ padding: "10px 20px", display: "flex", alignItems: "center", gap: 8, background: "#fafafa" }}>
                      <Checkbox
                        checked={groupAllVisible}
                        indeterminate={!groupAllVisible && groupSomeVisible}
                        onChange={() => tempToggleGroup(validKeys)}
                      />
                      <span style={{ fontWeight: 600, fontSize: 14, color: "#1677ff" }}>{group.label}</span>
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
                            borderTop: isDragOver ? "2px solid #1677ff" : "2px solid transparent",
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
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "12px 20px", borderTop: "1px solid #f0f0f0", background: "#fff", display: "flex", gap: 12, justifyContent: "center" }}>
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
                <Spin tip="正在读取缓存..." />
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
                                  <td style={{ padding: "4px 6px", textAlign: "right", color: "#1677ff", fontWeight: 600 }}>{r.sales}</td>
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
