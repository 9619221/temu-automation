import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Image,
  Input,
  List,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  EyeOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  buildExecutionReport,
  buildMarketInsight,
  buildTrackedSignals,
  normalizeMyProduct,
  type ComparisonRow,
  type ExecutionReport,
  type MarketInsight,
  type NormalizedMyProduct,
} from "../utils/competitorWorkbench";
import { parseFluxData, parseProductsData, parseSalesData } from "../utils/parseRawApis";
import { getStoreValue, getStoreValues } from "../utils/storeCompat";
import { setStoreValueForActiveAccount } from "../utils/multiStore";
import { withRetry } from "../utils/withRetry";
import {
  toSafeNumber,
  average,
  formatPercentText,
  parseReviewCountText,
  getErrorMessage,
  stripWorkerErrorCode,
} from "../utils/dataTransform";

const { Text, Paragraph } = Typography;

const store = window.electronAPI?.store;
const automation = window.electronAPI?.automation;
const competitor = window.electronAPI?.competitor;

const TEMU_ORANGE = "#e55b00";
const CARD_STYLE: React.CSSProperties = { borderRadius: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" };
const TRAFFIC_CHART_COLORS = {
  expose: "#ff8a1f",
  clickRate: "#4e79a7",
  clickPayRate: "#f6c343",
  search: "#ff8a1f",
  recommend: "#5b7fa3",
  other: "#f6c343",
  grid: "#d9d9d9",
  axis: "#8c8c8c",
  text: "#262626",
};
const PRODUCT_WORKSPACE_STORE_KEY = "temu_competitor_product_workspaces";
const COMPETITOR_TRACKED_UPDATED_EVENT = "temu:competitor-tracked-updated";
const PRICE_COLORS = ["#ff7300", "#ff9500", "#ffb700", "#ffd900", "#52c41a", "#1677ff", "#722ed1", "#eb2f96"];
const YUNQI_AUTH_INVALID_CODE = "YUNQI_AUTH_INVALID";
const YUNQI_NOT_MATCHED_MESSAGE = "云启在线当前没有返回这件商品的精确详情，请先确认 goodsId 是否正确，或重新登录云启后再试。";
const DEFAULT_WAREHOUSE_TYPE = 0;
const DEFAULT_SORT_FIELD = "daily_sales";
const DEFAULT_SORT_ORDER = "desc";
const FLUX_RANGE_ORDER = ["昨日", "今日", "本周", "本月", "近7日", "近30日"];
const FLUX_SITE_ORDER: Array<{ siteKey: FluxSiteDataset["siteKey"]; siteLabel: string }> = [
  { siteKey: "global", siteLabel: "全球" },
  { siteKey: "us", siteLabel: "美国" },
  { siteKey: "eu", siteLabel: "欧区" },
];

function renderTrafficTooltipCard(title: string, rows: Array<{ color: string; label: string; value: string }>) {
  return (
    <div
      style={{
        minWidth: 132,
        borderRadius: 12,
        background: "#fff",
        boxShadow: "0 10px 28px rgba(0,0,0,0.12)",
        border: "1px solid rgba(0,0,0,0.06)",
        padding: "12px 14px",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 500, color: "#595959", marginBottom: 8 }}>{title}</div>
      <Space direction="vertical" size={6} style={{ width: "100%" }}>
        {rows.map((row) => (
          <div key={`${row.label}-${row.value}`} style={{ display: "flex", alignItems: "center", gap: 8, color: TRAFFIC_CHART_COLORS.text, fontSize: 13 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: row.color, display: "inline-block", flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{row.label}</span>
            <span style={{ fontWeight: 600 }}>{row.value}</span>
          </div>
        ))}
      </Space>
    </div>
  );
}

function renderTrafficTrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const rows = payload.map((item: any) => ({
    color: item?.color || item?.stroke || TRAFFIC_CHART_COLORS.expose,
    label: String(item?.name || ""),
    value: item?.name === "曝光" ? formatTrafficNumber(item?.value) : formatTrafficPercentValue(item?.value),
  }));
  const title = payload?.[0]?.payload?.fullLabel || String(label || "");
  return renderTrafficTooltipCard(title, rows);
}

function renderTrafficSourceTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const rows = payload.map((item: any) => ({
    color: item?.color || item?.stroke || TRAFFIC_CHART_COLORS.search,
    label: item?.name === "search" ? "搜索" : item?.name === "recommend" ? "推荐" : "其他",
    value: formatTrafficNumber(item?.value),
  }));
  const title = payload?.[0]?.payload?.fullDate || String(label || "");
  return renderTrafficTooltipCard(title, rows);
}

interface TrackedProduct {
  url: string;
  title?: string;
  snapshots: any[];
  addedAt: string;
  sourceKeyword?: string;
  goodsId?: string;
}

interface ProductWorkspaceSnapshotCache {
  url: string;
  title?: string;
  sourceKeyword?: string;
  goodsId?: string;
  addedAt?: string;
  snapshot: any;
  updatedAt: string;
}

/** Phase4·P4.2：单条动作的勾选状态 */
interface ActionStateEntry {
  checked: boolean;
  note?: string;
  checkedAt?: string;
}

interface ProductWorkspaceState {
  productId: string;
  keyword: string;
  wareHouseType: number;
  selectedUrls: string[];
  /** Phase1·P1.3：把最新一次 snapshot 冗余进 workspace，离线 / 降级时可直接渲染样本 */
  selectedSampleSnapshots?: ProductWorkspaceSnapshotCache[];
  /** Phase4·P4.2：动作勾选状态（key = actionId） */
  actionStates?: Record<string, ActionStateEntry>;
  updatedAt: string;
}

interface CompetitorProductWorkbenchProps {
  onYunqiRequestStart?: () => void;
  onYunqiRequestFinish?: () => void;
  onYunqiRequestSuccess?: () => void;
  onYunqiAuthInvalid?: (error?: unknown) => void;
  activeStep?: number;
  onActiveStepChange?: (step: number) => void;
  onStepStateChange?: (state: ProductWorkbenchStepState) => void;
  hideStepShell?: boolean;
  prefillProduct?: CompetitorProductPrefill | null;
}

export interface CompetitorProductPrefill {
  token?: string;
  activateStep?: number;
  productId?: string;
  skcId?: string;
  spuId?: string;
  goodsId?: string;
  skuId?: string;
  title?: string;
}

export interface ProductWorkbenchStepItem {
  key: number;
  title: string;
  desc: string;
  enabled: boolean;
  completed: boolean;
}

export interface ProductWorkbenchStepState {
  activeStep: number;
  currentStepMeta: ProductWorkbenchStepItem;
  stepItems: ProductWorkbenchStepItem[];
  nextStepTarget: number | null;
  nextStepLabel: string;
  canGoNext: boolean;
}

type SearchTableSortKey = "price" | "dailySales" | "ratingReview";

interface SearchTableSortState {
  columnKey: SearchTableSortKey | "";
  order: "ascend" | "descend" | null;
}

interface ProductTrafficSummary {
  sourceKind: "flux";
  siteKey?: "global" | "us" | "eu";
  siteLabel?: string;
  syncedAt: string;
  exposeNum: number;
  exposeNumChange: unknown;
  clickNum: number;
  clickNumChange: unknown;
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
  dataDate: string;
  updateTime: string;
  exposeClickRate: number;
  clickPayRate: number;
  growDataText: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  clickRateLabel?: string;
  conversionRateLabel?: string;
  detailLabel?: string;
  supportLabel?: string;
}

interface FluxSiteDataset {
  siteKey: "global" | "us" | "eu";
  siteLabel: string;
  syncedAt: string;
  summary: any;
  items: any[];
  summaryByRange: Record<string, any>;
  itemsByRange: Record<string, any[]>;
  availableRanges: string[];
  primaryRangeLabel: string;
}

interface FluxTrendPoint {
  date: string;
  visitors: number;
  buyers: number;
  conversionRate: number;
  // 商品级日缓存才有的原始字段；存在则图表直接渲染真实值，无需按 summary 比例估算
  rawExposeNum?: number;
  rawClickNum?: number;
  rawBuyerNum?: number;
  rawSearchExpose?: number;
  rawRecommendExpose?: number;
}

interface DiagnosisPanel {
  status: string;
  statusColor: string;
  summary: string;
  findings: string[];
  actions: string[];
}

// toSafeNumber / average / formatPercentText / parseReviewCountText / getErrorMessage
// / stripWorkerErrorCode 等通用工具已抽到 src/utils/dataTransform.ts

function getRelativeChangePercent(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.abs(num) <= 1 ? num * 100 : num;
}

function formatRelativeChangeText(value: unknown) {
  const percent = getRelativeChangePercent(value);
  if (percent === null) return "暂无变化";
  const display = Math.abs(percent) >= 10
    ? percent.toFixed(0)
    : percent.toFixed(1).replace(/\.0$/, "");
  return `${percent > 0 ? "+" : ""}${display}%`;
}

function getRelativeChangeColor(value: unknown) {
  const percent = getRelativeChangePercent(value);
  if (percent === null) return "#8c8c8c";
  if (percent > 0) return "#389e0d";
  if (percent < 0) return "#cf1322";
  return "#8c8c8c";
}

function normalizeFluxTrendSeries(trendList: unknown): FluxTrendPoint[] {
  const rawList = Array.isArray(trendList) ? trendList : [];
  return rawList
    .map((item: any) => {
      const hasRawExpose = item?.exposeNum != null;
      const hasRawClick = item?.clickNum != null;
      const hasRawBuyer = item?.buyerNum != null;
      return {
        date: String(item?.date || item?.statDate || "").trim(),
        visitors: toSafeNumber(
          item?.visitors
          ?? item?.visitorsNum
          ?? item?.detailVisitNum
          ?? item?.detailVisitorNum
          ?? item?.clickNum,
        ),
        buyers: toSafeNumber(item?.buyers ?? item?.payBuyerNum ?? item?.buyerNum),
        conversionRate: toSafeNumber(item?.conversionRate),
        rawExposeNum: hasRawExpose ? toSafeNumber(item.exposeNum) : undefined,
        rawClickNum: hasRawClick ? toSafeNumber(item.clickNum) : undefined,
        rawBuyerNum: hasRawBuyer ? toSafeNumber(item.buyerNum) : undefined,
        rawSearchExpose: item?.searchExposeNum != null ? toSafeNumber(item.searchExposeNum) : undefined,
        rawRecommendExpose: item?.recommendExposeNum != null ? toSafeNumber(item.recommendExposeNum) : undefined,
      };
    })
    .filter((item) => item.date)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function formatFluxTrendRange(trendSeries: FluxTrendPoint[]) {
  if (trendSeries.length === 0) return "";
  const first = trendSeries[0]?.date || "";
  const last = trendSeries[trendSeries.length - 1]?.date || "";
  if (!first) return "";
  return first === last ? first : `${first} - ${last}`;
}

// 当某站点没有商品级 summary，但日级缓存有数据时，把日级累加成一份 summary 用于点亮漏斗 / 指标卡
function buildSummaryFromDailyCache(daily: any[], siteKey: string, siteLabel: string, syncedAt: string): any {
  let exposeNum = 0, clickNum = 0, buyerNum = 0, addToCartUserNum = 0;
  let detailVisitorNum = 0, searchExposeNum = 0, recommendExposeNum = 0;
  let searchClickNum = 0, recommendClickNum = 0, payGoodsNum = 0, payOrderNum = 0;
  let searchPayGoodsNum = 0, recommendPayGoodsNum = 0, collectUserNum = 0;
  for (const d of daily) {
    exposeNum += toSafeNumber(d?.exposeNum);
    clickNum += toSafeNumber(d?.clickNum);
    buyerNum += toSafeNumber(d?.buyerNum);
    addToCartUserNum += toSafeNumber(d?.addCartUserNum ?? d?.addToCartUserNum);
    detailVisitorNum += toSafeNumber(d?.detailVisitorNum ?? d?.detailVisitNum);
    searchExposeNum += toSafeNumber(d?.searchExposeNum);
    recommendExposeNum += toSafeNumber(d?.recommendExposeNum);
    searchClickNum += toSafeNumber(d?.searchClickNum);
    recommendClickNum += toSafeNumber(d?.recommendClickNum);
    searchPayGoodsNum += toSafeNumber(d?.searchPayGoodsNum);
    recommendPayGoodsNum += toSafeNumber(d?.recommendPayGoodsNum);
    payGoodsNum += toSafeNumber(d?.payGoodsNum);
    payOrderNum += toSafeNumber(d?.payOrderNum);
    collectUserNum += toSafeNumber(d?.collectUserNum);
  }
  const sorted = [...daily].sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));
  const lastDate = sorted.length > 0 ? String(sorted[sorted.length - 1]?.date || "") : "";
  return {
    __siteKey: siteKey,
    __siteLabel: siteLabel,
    siteKey,
    siteLabel,
    dataDate: lastDate,
    syncedAt,
    exposeNum,
    clickNum,
    buyerNum,
    addToCartUserNum,
    payGoodsNum,
    payOrderNum,
    collectUserNum,
    detailVisitorNum,
    detailVisitNum: detailVisitorNum,
    searchExposeNum,
    recommendExposeNum,
    searchClickNum,
    recommendClickNum,
    searchPayGoodsNum,
    recommendPayGoodsNum,
    trendExposeNum: exposeNum,
    trendPayOrderNum: payOrderNum,
    exposeClickRate: exposeNum > 0 ? clickNum / exposeNum : 0,
    clickPayRate: clickNum > 0 ? buyerNum / clickNum : 0,
  };
}

function buildFluxSiteDataset(siteKey: FluxSiteDataset["siteKey"], siteLabel: string, source: any): FluxSiteDataset {
  const parsed = source
    ? parseFluxData(source)
    : { summary: null, items: [], syncedAt: "", summaryByRange: {}, itemsByRange: {}, availableRanges: [], primaryRangeLabel: "今日" };
  const items = Array.isArray(parsed?.items)
    ? parsed.items.map((item: any) => ({ ...item, __siteKey: siteKey, __siteLabel: siteLabel }))
    : [];
  const summaryByRange = Object.entries(parsed?.summaryByRange || {}).reduce<Record<string, any>>((accumulator, [label, summary]) => {
    accumulator[label] = summary;
    return accumulator;
  }, {});
  const itemsByRange = Object.entries(parsed?.itemsByRange || {}).reduce<Record<string, any[]>>((accumulator, [label, rawItems]) => {
    accumulator[label] = Array.isArray(rawItems)
      ? rawItems.map((item: any) => ({ ...item, __siteKey: siteKey, __siteLabel: siteLabel }))
      : [];
    return accumulator;
  }, {});
  return {
    siteKey,
    siteLabel,
    syncedAt: String(parsed?.syncedAt || ""),
    summary: parsed?.summary || null,
    items,
    summaryByRange,
    itemsByRange,
    availableRanges: Array.isArray(parsed?.availableRanges) ? parsed.availableRanges.filter(Boolean) : [],
    primaryRangeLabel: String(parsed?.primaryRangeLabel || "今日"),
  };
}

function buildFluxDataset(sources: Array<{ siteKey: FluxSiteDataset["siteKey"]; siteLabel: string; data: any }>) {
  const siteDatasets = sources.map((item) => buildFluxSiteDataset(item.siteKey, item.siteLabel, item.data));
  const syncedAt = siteDatasets.map((item) => item.syncedAt).find(Boolean) || "";
  return {
    summary: siteDatasets.find((item) => item.siteKey === "global")?.summary || null,
    syncedAt,
    items: siteDatasets.flatMap((item) => item.items),
    siteDatasets,
  };
}

function getParsedFluxSnapshot(source: any) {
  const parsed = source
    ? parseFluxData(source)
    : { summary: null, items: [], syncedAt: "", summaryByRange: {}, itemsByRange: {}, availableRanges: [], primaryRangeLabel: "今日" };
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

function buildProductTrafficSummary(
  matchedItems: any[],
  syncedAt: string,
  siteKey: FluxSiteDataset["siteKey"],
  siteLabel: string,
): ProductTrafficSummary | null {
  if (matchedItems.length === 0) return null;

  const primary = [...matchedItems].sort((left: any, right: any) => {
    const exposeDiff = toSafeNumber(right?.exposeNum) - toSafeNumber(left?.exposeNum);
    if (exposeDiff !== 0) return exposeDiff;
    return toSafeNumber(right?.clickNum) - toSafeNumber(left?.clickNum);
  })[0];

  const exposeNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.exposeNum), 0);
  const clickNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.clickNum), 0);
  const detailVisitNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.detailVisitNum), 0);
  const detailVisitorNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.detailVisitorNum), 0);
  const addToCartUserNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.addToCartUserNum), 0);
  const collectUserNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.collectUserNum), 0);
  const buyerNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.buyerNum), 0);
  const payGoodsNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.payGoodsNum), 0);
  const payOrderNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.payOrderNum), 0);
  const searchExposeNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.searchExposeNum), 0);
  const searchClickNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.searchClickNum), 0);
  const searchPayGoodsNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.searchPayGoodsNum), 0);
  const recommendExposeNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.recommendExposeNum), 0);
  const recommendClickNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.recommendClickNum), 0);
  const recommendPayGoodsNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.recommendPayGoodsNum), 0);
  const trendExposeNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.trendExposeNum), 0);
  const trendPayOrderNum = matchedItems.reduce((sum: number, item: any) => sum + toSafeNumber(item?.trendPayOrderNum), 0);

  return {
    sourceKind: "flux",
    siteKey,
    siteLabel,
    syncedAt,
    exposeNum,
    exposeNumChange: primary?.exposeNumChange,
    clickNum,
    clickNumChange: primary?.clickNumChange,
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
    dataDate: String(primary?.dataDate || ""),
    updateTime: String(primary?.updateTime || syncedAt || ""),
    exposeClickRate: exposeNum > 0 ? clickNum / exposeNum : toSafeNumber(primary?.exposeClickRate),
    clickPayRate: clickNum > 0 ? buyerNum / clickNum : toSafeNumber(primary?.clickPayRate),
    growDataText: matchedItems.map((item: any) => firstTextValue(item?.growDataText)).find(Boolean) || "",
    primaryLabel: "曝光",
    secondaryLabel: "点击",
    clickRateLabel: "曝光点击率",
    conversionRateLabel: "点击支付转化率",
    detailLabel: "详情访问",
    supportLabel: "加购人数",
  };
}

function getTrafficSiteMode(site: any) {
  if (site?.summary) return "product";
  if (Array.isArray(site?.recentTrendSeries) && site.recentTrendSeries.length > 0) return "trend";
  return "empty";
}

function buildTrafficPerformanceTrendData(site: any) {
  // 1) 商品级日缓存自带 rawExposeNum/rawClickNum/rawBuyerNum，直接渲染真实日值（与商品分析一致）
  const trendSeriesAll: FluxTrendPoint[] = Array.isArray(site?.trendSeries) ? site.trendSeries.slice(-30) : [];
  const hasRawDaily = trendSeriesAll.some((p) => p?.rawExposeNum != null || p?.rawClickNum != null || p?.rawBuyerNum != null);
  if (trendSeriesAll.length > 1 && hasRawDaily) {
    return trendSeriesAll.map((item) => {
      const expose = toSafeNumber(item.rawExposeNum);
      const click = toSafeNumber(item.rawClickNum);
      const buyers = toSafeNumber(item.rawBuyerNum);
      return {
        label: item.date.slice(5),
        fullLabel: item.date,
        expose,
        clickRate: expose > 0 ? Number(((click / expose) * 100).toFixed(1)) : 0,
        clickPayRate: click > 0 ? Number(((buyers / click) * 100).toFixed(1)) : 0,
      };
    }).filter((item) => item.expose > 0 || item.clickRate > 0 || item.clickPayRate > 0);
  }

  const labels = FLUX_RANGE_ORDER.filter((label) => site?.summaryByRange?.[label]);
  const rangeData = labels.map((label) => {
    const summary = site?.summaryByRange?.[label];
    const expose = toSafeNumber(summary?.exposeNum);
    const clickRate = Number((toSafeNumber(summary?.exposeClickRate) * 100).toFixed(1));
    const clickPayRate = Number((toSafeNumber(summary?.clickPayRate) * 100).toFixed(1));
    return {
      label,
      fullLabel: label,
      expose,
      clickRate,
      clickPayRate,
    };
  }).filter((item: any) => item.expose > 0 || item.clickRate > 0 || item.clickPayRate > 0);

  if (rangeData.length > 1) return rangeData;

  const trendSeries = trendSeriesAll.slice(-7);
  const summary = site?.summary;
  if (trendSeries.length <= 1 || !summary) return rangeData;

  const totalExpose = Math.max(toSafeNumber(summary?.exposeNum), 1);
  const baseClickRate = toSafeNumber(summary?.exposeClickRate);
  const baseClickPayRate = toSafeNumber(summary?.clickPayRate);
  const anchorPoint = [...trendSeries].reverse().find((item: FluxTrendPoint) => item.visitors > 0) || trendSeries[trendSeries.length - 1];
  const anchorVisitors = Math.max(toSafeNumber(anchorPoint?.visitors), 1);
  const anchorBuyers = Math.max(toSafeNumber(anchorPoint?.buyers), 1);

  return trendSeries.map((item: FluxTrendPoint) => {
    const visitorsRatio = Math.max(toSafeNumber(item.visitors) / anchorVisitors, 0);
    const buyersRatio = Math.max(toSafeNumber(item.buyers) / anchorBuyers, 0);
    const expose = Math.max(Math.round(totalExpose * visitorsRatio), 0);
    const clickRate = Math.min(baseClickRate * (0.85 + visitorsRatio * 0.15), 0.95);
    const clickPayRate = Math.min(baseClickPayRate * (0.75 + buyersRatio * 0.25), 0.95);
    return {
      label: item.date.slice(5),
      fullLabel: item.date,
      expose,
      clickRate: Number((clickRate * 100).toFixed(1)),
      clickPayRate: Number((clickPayRate * 100).toFixed(1)),
    };
  }).filter((item: any) => item.expose > 0 || item.clickRate > 0 || item.clickPayRate > 0);
}

export function _buildTrafficSourceChartData(site: any) {
  const summary = site?.summary;
  if (!summary) return [];

  const searchExpose = toSafeNumber(summary.searchExposeNum);
  const searchClick = toSafeNumber(summary.searchClickNum);
  const searchPay = toSafeNumber(summary.searchPayGoodsNum);
  const recommendExpose = toSafeNumber(summary.recommendExposeNum);
  const recommendClick = toSafeNumber(summary.recommendClickNum);
  const recommendPay = toSafeNumber(summary.recommendPayGoodsNum);

  const buildOtherValue = (total: number, search: number, recommend: number) =>
    Math.max(total - search - recommend, 0);

  return [
    {
      stage: "曝光",
      search: searchExpose,
      recommend: recommendExpose,
      other: buildOtherValue(toSafeNumber(summary.exposeNum), searchExpose, recommendExpose),
    },
    {
      stage: "点击",
      search: searchClick,
      recommend: recommendClick,
      other: buildOtherValue(toSafeNumber(summary.clickNum), searchClick, recommendClick),
    },
    {
      stage: "支付",
      search: searchPay,
      recommend: recommendPay,
      other: buildOtherValue(toSafeNumber(summary.payGoodsNum), searchPay, recommendPay),
    },
  ];
}

export function _buildTrafficSourceOverview(summary: any) {
  if (!summary) return [];
  const searchExpose = toSafeNumber(summary.searchExposeNum);
  const recommendExpose = toSafeNumber(summary.recommendExposeNum);
  const totalExpose = toSafeNumber(summary.exposeNum);
  const otherExpose = Math.max(totalExpose - searchExpose - recommendExpose, 0);
  const total = Math.max(totalExpose, 1);

  return [
    {
      key: "search",
      label: "搜索曝光",
      value: searchExpose,
      share: searchExpose / total,
      color: "#fa8c16",
    },
    {
      key: "recommend",
      label: "推荐曝光",
      value: recommendExpose,
      share: recommendExpose / total,
      color: "#4e79a7",
    },
    {
      key: "other",
      label: "其他曝光",
      value: otherExpose,
      share: otherExpose / total,
      color: "#f6bd16",
    },
  ];
}

function buildTrafficSourceTimelineData(site: any, days: number) {
  const trendSeries: FluxTrendPoint[] = Array.isArray(site?.trendSeries) ? site.trendSeries.slice(-(days || 7)) : [];
  const summary = site?.summary;
  const totalExpose = toSafeNumber(summary?.exposeNum);
  const searchExpose = toSafeNumber(summary?.searchExposeNum);
  const recommendExpose = toSafeNumber(summary?.recommendExposeNum);
  void Math.max(totalExpose - searchExpose - recommendExpose, 0); // otherExpose（占位，保留计算给未来恢复）

  // 1) 商品级日缓存自带 rawExposeNum/rawSearchExpose/rawRecommendExpose，直接用，不做比例估算（与商品分析一致）
  const hasRawDaily = trendSeries.some((p) => p?.rawExposeNum != null);
  if (trendSeries.length > 1 && hasRawDaily) {
    return trendSeries.map((item) => {
      const total = toSafeNumber(item.rawExposeNum);
      const search = toSafeNumber(item.rawSearchExpose);
      const recommend = toSafeNumber(item.rawRecommendExpose);
      return {
        label: item.date.slice(5),
        fullDate: item.date,
        search,
        recommend,
        other: Math.max(total - search - recommend, 0),
        total,
      };
    }).filter((item) => item.total > 0 || item.search > 0 || item.recommend > 0 || item.other > 0);
  }

  if (trendSeries.length > 1 && totalExpose > 0) {
    const anchorPoint = [...trendSeries].reverse().find((item: FluxTrendPoint) => item.visitors > 0) || trendSeries[trendSeries.length - 1];
    const anchorVisitors = Math.max(toSafeNumber(anchorPoint?.visitors), 1);
    const searchShare = searchExpose / Math.max(totalExpose, 1);
    const recommendShare = recommendExpose / Math.max(totalExpose, 1);

    return trendSeries.map((item: FluxTrendPoint) => {
      const estimatedTotal = Math.max(Math.round(totalExpose * (toSafeNumber(item.visitors) / anchorVisitors)), 0);
      const search = Math.round(estimatedTotal * searchShare);
      const recommend = Math.round(estimatedTotal * recommendShare);
      return {
        label: item.date.slice(5),
        fullDate: item.date,
        search,
        recommend,
        other: Math.max(estimatedTotal - search - recommend, 0),
        total: estimatedTotal,
      };
    }).filter((item: any) => item.total > 0 || item.search > 0 || item.recommend > 0 || item.other > 0);
  }

  const labels = FLUX_RANGE_ORDER.filter((label) => site?.summaryByRange?.[label]);
  return labels.map((label) => {
    const rangeSummary = site?.summaryByRange?.[label] || {};
    const search = toSafeNumber(rangeSummary.searchExposeNum);
    const recommend = toSafeNumber(rangeSummary.recommendExposeNum);
    const total = toSafeNumber(rangeSummary.exposeNum);
    return {
      label,
      search,
      recommend,
      other: Math.max(total - search - recommend, 0),
      total,
    };
  }).filter((item) => item.total > 0 || item.search > 0 || item.recommend > 0 || item.other > 0);
}

function buildTrafficFunnelSteps(site: any) {
  const summary = site?.summary;
  if (!summary) return [];

  const steps = [
    { label: "曝光", value: toSafeNumber(summary.exposeNum) },
    { label: "点击", value: toSafeNumber(summary.clickNum) },
    { label: "详情访客", value: toSafeNumber(summary.detailVisitorNum || summary.detailVisitNum) },
    { label: "加购", value: toSafeNumber(summary.addToCartUserNum) },
    { label: "支付买家", value: toSafeNumber(summary.buyerNum) },
  ];
  const maxValue = Math.max(...steps.map((item) => item.value), 1);

  return steps.map((item, index) => {
    const previousValue = index === 0 ? maxValue : Math.max(steps[index - 1]?.value || 0, 1);
    return {
      ...item,
      widthPercent: Math.max(24, Math.round((item.value / maxValue) * 100)),
      conversionText: index === 0 ? "基线" : `${((item.value / previousValue) * 100).toFixed(1)}%`,
    };
  });
}

function formatTrafficNumber(value: unknown) {
  const num = toSafeNumber(value);
  if (Number.isInteger(num)) return num.toLocaleString("zh-CN");
  return num.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function formatTrafficPercentValue(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${num.toFixed(1)}%`;
}

function getTrafficModeMeta(site: any) {
  const mode = getTrafficSiteMode(site);
  if (mode === "product") {
    return { label: "商品级数据", color: "orange" as const };
  }
  if (mode === "trend") {
    return { label: "站点趋势", color: "blue" as const };
  }
  return { label: "暂无数据", color: "default" as const };
}

function getFluxSiteDisplayName(siteKey: FluxSiteDataset["siteKey"]) {
  if (siteKey === "global") return "全球";
  if (siteKey === "us") return "美国";
  return "欧区";
}

async function readArrayStoreValue(key: string) {
  const value = await getStoreValue(store, key);
  return Array.isArray(value) ? value : [];
}

function stripInvokeErrorPrefix(message: string) {
  return message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/i, "").trim();
}

function isLegacyGoodsIdPrompt(message: string) {
  return /请输入商品链接|无法从 URL 中提取商品 ID/i.test(message);
}

function normalizeYunqiDetailError(message: string, goodsId: string) {
  const normalized = stripInvokeErrorPrefix(stripWorkerErrorCode(message)).trim();
  if (!normalized) return "";
  if (goodsId && isLegacyGoodsIdPrompt(normalized)) return "";
  // 云启服务端内部错误，给友好提示
  if (/Cannot read properties of undefined/i.test(normalized) || /proxyother.*failed/i.test(normalized)) {
    return "云启数据服务暂时不可用，请稍后再试";
  }
  return normalized;
}

function isYunqiAuthInvalidError(error: unknown) {
  const message = getErrorMessage(error);
  return message.includes(`[${YUNQI_AUTH_INVALID_CODE}]`);
}

function isUnsupportedCompetitorTrackError(error: unknown) {
  const message = stripInvokeErrorPrefix(stripWorkerErrorCode(getErrorMessage(error))).trim();
  return /未知命令[:：]?\s*competitor_track/i.test(message)
    || /\[UNKNOWN\].*competitor_track/i.test(message)
    || /competitor_track/i.test(message) && /unknown/i.test(message);
}

function getWorkspaceMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, ProductWorkspaceState>;
  return Object.entries(value as Record<string, any>).reduce<Record<string, ProductWorkspaceState>>((accumulator, [key, item]) => {
    if (!item || typeof item !== "object") return accumulator;
    accumulator[key] = {
      productId: typeof item.productId === "string" && item.productId ? item.productId : key,
      keyword: typeof item.keyword === "string" ? item.keyword : "",
      wareHouseType: Number(item.wareHouseType) === 1 ? 1 : 0,
      selectedUrls: Array.isArray(item.selectedUrls) ? item.selectedUrls.map((url: unknown) => String(url || "")).filter(Boolean) : [],
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    };
    return accumulator;
  }, {});
}

function dedupeStrings(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function cleanKeywordCandidate(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,，、|/]+|[\s,，、|/]+$/g, "")
    .trim();
}

function deriveMyProductKeywords(rawProduct: Record<string, unknown> | null | undefined, normalized: NormalizedMyProduct | null) {
  const titleSource = cleanKeywordCandidate(rawProduct?.productName || rawProduct?.title || rawProduct?.goodsName || normalized?.title || "");
  const category = cleanKeywordCandidate(rawProduct?.category || rawProduct?.categories || rawProduct?.catName || normalized?.category || "");
  const chunks = titleSource
    .split(/[|/，,、;；\-()（）[\]【】]+/)
    .map(cleanKeywordCandidate)
    .filter((item) => item.length >= 2 && item.length <= 40);
  const englishWords = titleSource.split(/\s+/).filter(Boolean);
  const englishPhrases = [
    englishWords.slice(0, 2).join(" "),
    englishWords.slice(0, 3).join(" "),
    englishWords.slice(0, 4).join(" "),
  ].map(cleanKeywordCandidate).filter((item) => item.length >= 3 && item.length <= 40);
  const shortTitle = titleSource.length > 24 ? cleanKeywordCandidate(titleSource.slice(0, 24)) : titleSource;
  return dedupeStrings([category, shortTitle, titleSource, ...chunks, ...englishPhrases]).slice(0, 6);
}

function parsePriceBand(label: string) {
  const match = label.match(/\$?([\d.]+)\s*-\s*\$?([\d.]+)/);
  if (!match) return null;
  const min = Number(match[1] || 0);
  const max = Number(match[2] || 0);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max };
}

function getMyPriceBandStatus(price: number, recommendedBand: string) {
  if (!price) return "当前商品缺少售价，先补齐价格后再判断。";
  const band = parsePriceBand(recommendedBand);
  if (!band) return "先补充更多样本，再确认建议价格带。";
  if (price < band.min * 0.98) return "当前价格低于建议带，可以测试提利润或补高客单版本。";
  if (price > band.max * 1.02) return "当前价格高于建议带，先测试回落后再抢主词。";
  return "当前价格落在建议带内，优先优化素材和转化承接。";
}

const TITLE_ATTRIBUTE_WORDS = [
  "加厚",
  "免打孔",
  "防滑",
  "防水",
  "防锈",
  "不锈钢",
  "可折叠",
  "可裁剪",
  "静音",
  "重型",
  "耐用",
  "强力",
  "磁吸",
  "可调",
  "无痕",
  "abs",
  "pet",
  "led",
];

const TITLE_SCENE_WORDS = [
  "浴室",
  "厨房",
  "卧室",
  "客厅",
  "玄关",
  "门后",
  "墙面",
  "桌面",
  "冰箱",
  "抽屉",
  "车载",
  "办公室",
  "户外",
  "健身房",
  "仓库",
];

const TITLE_BUNDLE_WORDS = [
  "套装",
  "组合",
  "赠",
  "pack",
  "pcs",
  "件",
  "套",
];

function normalizeCompareText(value: unknown) {
  return String(value || "").replace(/\s+/g, "").trim().toLowerCase();
}

function includesKeyword(source: unknown, keyword: unknown) {
  const normalizedSource = normalizeCompareText(source);
  const normalizedKeyword = normalizeCompareText(keyword);
  if (!normalizedSource || !normalizedKeyword) return false;
  return normalizedSource.includes(normalizedKeyword);
}

function collectMatchedWords(source: unknown, candidates: string[], limit = 4) {
  return dedupeStrings(
    candidates.filter((candidate) => includesKeyword(source, candidate)),
  ).slice(0, limit);
}

function getTitleLengthStatus(title: string) {
  const length = title.replace(/\s+/g, "").length;
  if (length === 0) return { length, label: "缺标题", color: "red" };
  if (length < 18) return { length, label: "偏短", color: "orange" };
  if (length > 68) return { length, label: "偏长", color: "gold" };
  return { length, label: "长度正常", color: "green" };
}

function buildTitleDiagnosis(options: {
  title: string;
  category?: string;
  keyword?: string;
  suggestedKeywords?: string[];
  marketInsight?: MarketInsight | null;
}): DiagnosisPanel {
  const title = String(options.title || "").trim();
  const category = String(options.category || "").trim();
  const coreKeyword = firstTextValue(options.keyword, options.suggestedKeywords?.[0], category);
  const lengthMeta = getTitleLengthStatus(title);
  const hasCoreKeyword = includesKeyword(title, coreKeyword);
  const hasCategory = category ? includesKeyword(title, category) : false;
  const matchedAttributes = collectMatchedWords(title, TITLE_ATTRIBUTE_WORDS);
  const matchedScenes = collectMatchedWords(title, TITLE_SCENE_WORDS);
  const matchedBundles = collectMatchedWords(title, TITLE_BUNDLE_WORDS);
  const primaryNeed = options.marketInsight?.primaryNeed || "";

  if (!title) {
    return {
      status: "待补标题",
      statusColor: "red",
      summary: "当前还没有可诊断的标题，先补齐商品标题后再判断关键词承接。",
      findings: ["缺少标题"],
      actions: ["先补 1 条完整标题，再开始测试关键词。"],
    };
  }

  const findings = [
    coreKeyword ? `${hasCoreKeyword ? "主打词已覆盖" : "主打词未覆盖"}：${coreKeyword}` : "暂未锁定主打词",
    `${lengthMeta.label}：${lengthMeta.length} 字`,
    matchedAttributes.length > 0 ? `属性词：${matchedAttributes.join(" / ")}` : "属性词偏少",
    matchedScenes.length > 0 ? `场景词：${matchedScenes.join(" / ")}` : "场景词偏少",
  ];
  if (matchedBundles.length > 0) {
    findings.push(`套装/件数词：${matchedBundles.join(" / ")}`);
  }
  if (category && !hasCategory) {
    findings.push(`类目词未前置：${category}`);
  }

  const actions = [
    !hasCoreKeyword && coreKeyword ? `把“${coreKeyword}”前置到标题前 12-18 个字。` : "",
    primaryNeed === "功能" && matchedAttributes.length < 2 ? "补 1-2 个功能/属性词，让标题更像解决方案。" : "",
    primaryNeed === "外观" && matchedScenes.length === 0 ? "补 1 个场景或风格词，先把点击理由说清楚。" : "",
    primaryNeed === "套装" && matchedBundles.length === 0 ? "补件数或套装词，让买家一眼看懂组合内容。" : "",
    lengthMeta.label === "偏长" ? "删掉重复修饰词，把核心词、规格词、场景词排在前面。" : "",
    hasCoreKeyword && matchedAttributes.length > 0 ? "保持主打词不变，优先测试词序和前 20 字的承接。" : "",
  ].filter(Boolean);

  let status = "可继续优化";
  let statusColor = "blue";
  let summary = "标题基础可用，下一步重点是把核心词和卖点顺序排得更利于点击。";

  if (!hasCoreKeyword && coreKeyword) {
    status = "先补主打词";
    statusColor = "orange";
    summary = `当前标题还没把这次主打词“${coreKeyword}”明确打进去，先补词再测。`;
  } else if (primaryNeed === "功能" && matchedAttributes.length < 2) {
    status = "功能承接偏弱";
    statusColor = "gold";
    summary = "这个词更看重功能和解决问题，标题里的功能/属性表达还不够。";
  } else if (primaryNeed === "套装" && matchedBundles.length === 0) {
    status = "套装表达偏弱";
    statusColor = "gold";
    summary = "当前市场更吃套装和件数组合，标题里还没有把套装价值说透。";
  } else if (lengthMeta.label === "偏长") {
    status = "信息过满";
    statusColor = "gold";
    summary = "标题信息有点满，建议删冗余，把核心词和规格词往前挪。";
  } else if (hasCoreKeyword && matchedAttributes.length > 0 && (matchedScenes.length > 0 || primaryNeed !== "外观")) {
    status = "标题承接正常";
    statusColor = "green";
    summary = "标题已经覆盖主打词，也带了关键卖点，可以先把精力放到素材和转化。";
  }

  return {
    status,
    statusColor,
    summary,
    findings,
    actions: actions.slice(0, 3),
  };
}

function buildMainImageDiagnosis(options: {
  hasImage: boolean;
  hasVideo: boolean;
  marketInsight?: MarketInsight | null;
  referenceTags?: string[];
}): DiagnosisPanel {
  const primaryNeed = options.marketInsight?.primaryNeed || "";
  const videoRate = options.marketInsight?.videoRate || 0;
  const referenceTags = dedupeStrings(options.referenceTags || []).slice(0, 4);

  const findings = [
    options.hasImage ? "当前主图已存在" : "当前主图缺失",
    options.hasVideo ? "当前已有视频" : "当前缺视频",
    primaryNeed ? `市场主需求：${primaryNeed}` : "还没有足够样本判断市场主需求",
    options.marketInsight ? `视频门槛：${Math.round(videoRate * 100)}%` : "还没有素材门槛判断",
  ];
  if (referenceTags.length > 0) {
    findings.push(`样本高频标签：${referenceTags.join(" / ")}`);
  }

  const actions = [
    !options.hasImage ? "先补 1 张能一眼看懂用途的首图。" : "",
    primaryNeed === "价格" ? "首图直接露出件数、规格或到手价值，别只放单个产品图。" : "",
    primaryNeed === "功能" ? "首图改成使用动作、功能结果或前后对比，先把用途讲明白。" : "",
    primaryNeed === "信任" ? "首图减少花哨元素，补材质、品质或信任背书。" : "",
    primaryNeed === "套装" ? "首图把套装内容平铺出来，让件数和组合一眼可见。" : "",
    primaryNeed === "外观" ? "首图优先统一场景和风格，先争取点击率。" : "",
    !options.hasVideo && videoRate >= 0.35 ? "补 1 条短视频，至少覆盖功能演示或场景使用。" : "",
  ].filter(Boolean);

  let status = "素材可继续优化";
  let statusColor = "blue";
  let summary = "主图和素材已经能支撑基础分析，下一步重点看首屏卖点表达。";

  if (!options.hasImage) {
    status = "先补主图";
    statusColor = "red";
    summary = "当前没有稳定主图素材，先补首图再讨论点击和转化。";
  } else if (!options.hasVideo && videoRate >= 0.55) {
    status = "素材门槛偏高";
    statusColor = "orange";
    summary = "这个词的样本视频门槛偏高，只有静态主图时很难和头部样本竞争。";
  } else if (primaryNeed === "功能") {
    status = "功能表达优先";
    statusColor = "gold";
    summary = "当前市场更看重功能演示，主图要更像功能结果和使用场景，不是单纯摆拍。";
  } else if (primaryNeed === "价格") {
    status = "性价比表达优先";
    statusColor = "gold";
    summary = "当前市场更看重性价比，主图要把件数、规格和到手价值讲清楚。";
  } else if (primaryNeed === "信任") {
    status = "信任感优先";
    statusColor = "gold";
    summary = "当前市场更吃信任感，主图先补品质背书，再谈流量放大。";
  } else if (options.hasImage && (options.hasVideo || videoRate < 0.35)) {
    status = "素材基础正常";
    statusColor = "green";
    summary = "当前素材基础是够用的，下一步更适合微调首图卖点和关键词承接。";
  }

  return {
    status,
    statusColor,
    summary,
    findings,
    actions: actions.slice(0, 3),
  };
}

function getLatestSnapshot(item: TrackedProduct) {
  return item?.snapshots?.[item.snapshots.length - 1] || null;
}

function buildFallbackSnapshotFromSearch(product: any) {
  return {
    title: product.title,
    titleZh: product.titleZh || product.title,
    price: product.price || 0,
    priceText: product.priceText || `$${toSafeNumber(product.price).toFixed(2)}`,
    marketPrice: product.marketPrice || null,
    score: product.score || 0,
    reviewCount: parseReviewCountText(product.commentNumTips),
    dailySales: product.dailySales || 0,
    weeklySales: product.weeklySales || 0,
    monthlySales: product.monthlySales || 0,
    weeklySalesPercentage: product.weeklySalesPercentage || 0,
    monthlySalesPercentage: product.monthlySalesPercentage || 0,
    imageUrl: product.imageUrl || (Array.isArray(product.imageUrls) ? product.imageUrls[0] : ""),
    imageUrls: Array.isArray(product.imageUrls) ? product.imageUrls : [product.imageUrl].filter(Boolean),
    videoUrl: product.videoUrl || "",
    wareHouseType: product.wareHouseType,
    goodsId: product.goodsId,
    mall: product.mall,
    mallScore: product.mallScore,
    mallTotalGoods: product.mallTotalGoods,
    commentNumTips: product.commentNumTips,
    url: product.productUrl,
    productUrl: product.productUrl,
    createdAt: product.createdAt,
    scrapedAt: new Date().toISOString(),
  };
}

function getPrimaryImageUrl(record: any) {
  const candidates = [
    record?.imageUrl,
    Array.isArray(record?.imageUrls) ? record.imageUrls[0] : "",
    record?.snapshot?.imageUrl,
    Array.isArray(record?.snapshot?.imageUrls) ? record.snapshot.imageUrls[0] : "",
    record?.latest?.imageUrl,
    Array.isArray(record?.latest?.images) ? record.latest.images[0] : "",
  ];
  return candidates.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function getSearchRowKey(record: any, fallback = "") {
  return String(record?.goodsId || record?.productUrl || fallback);
}

function getSearchResultReviewCount(record: any) {
  return toSafeNumber(record?.reviewCount) || parseReviewCountText(record?.commentNumTips);
}

// Phase1·P1.4：从当前商品 / 关键词里凑出近义词建议
const KEYWORD_STOP_WORDS = new Set([
  "for", "the", "a", "an", "of", "with", "and", "or", "to", "in", "on", "by", "at",
  "from", "new", "hot", "2024", "2025", "2026", "pcs", "set", "pack", "size", "style", "color",
]);

function buildKeywordSuggestions(currentKeyword: string, title?: string, category?: string): string[] {
  const current = (currentKeyword || "").toLowerCase().trim();
  const source = `${title || ""} ${category || ""}`.toLowerCase();
  if (!source.trim()) return [];
  // 粗糙分词：按空格 / 逗号 / 斜杠 / 竖线切
  const tokens = source.split(/[\s,/|()\-·、，。]+/).map((t) => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  const single: string[] = [];
  for (const token of tokens) {
    if (token.length < 3) continue;
    if (KEYWORD_STOP_WORDS.has(token)) continue;
    if (current && current.includes(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    single.push(token);
    if (single.length >= 6) break;
  }
  // 补一个两词组合（前两 token）作为更具体的变体
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1 && bigrams.length < 2; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (!a || !b) continue;
    if (KEYWORD_STOP_WORDS.has(a) || KEYWORD_STOP_WORDS.has(b)) continue;
    const phrase = `${a} ${b}`;
    if (current && current.includes(phrase)) continue;
    bigrams.push(phrase);
  }
  return [...bigrams, ...single].slice(0, 6);
}

function firstTextValue(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function getMyProductImageUrl(rawProduct: Record<string, unknown> | null | undefined) {
  const skuSummaries = Array.isArray(rawProduct?.skuSummaries) ? rawProduct?.skuSummaries : [];
  return firstTextValue(
    rawProduct?.imageUrl,
    rawProduct?.thumbUrl,
    rawProduct?.mainImageUrl,
    rawProduct?.goodsImageUrl,
    rawProduct?.productSkcPicture,
    skuSummaries[0]?.thumbUrl,
  );
}

function getMyProductStatusText(rawProduct: Record<string, unknown> | null | undefined, normalized?: NormalizedMyProduct | null) {
  return firstTextValue(
    rawProduct?.skcSiteStatusName,
    rawProduct?.siteStatusName,
    rawProduct?.goodsStatusName,
    rawProduct?.listingStatusName,
    rawProduct?.skcSiteStatus,
    rawProduct?.siteStatus,
    rawProduct?.goodsStatus,
    rawProduct?.listingStatus,
    rawProduct?.status,
    rawProduct?.removeStatus,
    normalized?.status,
  );
}

function isMyProductOnSale(rawProduct: Record<string, unknown> | null | undefined, normalized?: NormalizedMyProduct | null) {
  void normalized;
  return Boolean(rawProduct?.hasSalesSnapshot);
}

function getYunqiDetailImageUrl(detail: any) {
  return firstTextValue(
    detail?.imageUrl,
    Array.isArray(detail?.imageUrls) ? detail.imageUrls[0] : "",
    Array.isArray(detail?.images) ? detail.images[0] : "",
  );
}

function formatDateDisplay(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "-";
  return text.replace("T", " ").slice(0, 19);
}

function formatMoneyDisplay(value: unknown, prefix = "$") {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return "-";
  return `${prefix}${num.toFixed(2)}`;
}

function getYunqiSiteLabel(region: unknown, currency: unknown) {
  const regionText = String(region || "").trim();
  const currencyText = String(currency || "").trim().toUpperCase();
  const regionMap: Record<string, string> = {
    "100": "日本",
    "1": "美国",
    "210": "英国",
    "119": "马来西亚",
    "12": "澳大利亚",
    "37": "加拿大",
  };

  if (regionMap[regionText]) return regionMap[regionText];
  if (/^(JP|JPN|JAPAN)$/i.test(regionText) || regionText.includes("日本")) return "日本";
  if (/^(US|USA|AMERICA)$/i.test(regionText) || regionText.includes("美国")) return "美国";
  if (/^(UK|GB|GBR|BRITAIN)$/i.test(regionText) || regionText.includes("英国")) return "英国";
  if (/^(AU|AUS)$/i.test(regionText) || regionText.includes("澳")) return "澳大利亚";
  if (/^(CA|CAN)$/i.test(regionText) || regionText.includes("加拿大")) return "加拿大";
  if (/^(MY|MYS)$/i.test(regionText) || regionText.includes("马来")) return "马来西亚";
  if (/^(EU|EUR)$/i.test(regionText) || regionText.includes("欧")) return "欧区";
  if (currencyText.includes("AU$")) return "澳大利亚";
  if (currencyText.includes("CA$")) return "加拿大";
  if (currencyText.includes("RM")) return "马来西亚";
  if (currencyText.includes("£") || currencyText.includes("GBP")) return "英国";
  if (currencyText.includes("€") || currencyText.includes("EUR")) return "欧区";
  if (currencyText.includes("¥") || currencyText.includes("JPY") || currencyText.includes("円") || currencyText.includes("日元")) return "日本";
  if (currencyText.includes("$") || currencyText.includes("USD")) return "美国";
  if (regionText && !/^\d+$/.test(regionText)) return regionText;
  return regionText;
}

function formatCompactTrendDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8) return `${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (digits.length === 4) return `${digits.slice(0, 2)}-${digits.slice(2, 4)}`;
  if (digits.length === 3) {
    const padded = digits.padStart(4, "0");
    return `${padded.slice(0, 2)}-${padded.slice(2, 4)}`;
  }
  if (raw.includes("-") || raw.includes("/")) return raw.slice(-5).replace("/", "-");
  return raw;
}

function getWareHouseTypeLabel(value: unknown) {
  if (value === 0 || value === "0") return "全托管";
  if (value === 1 || value === "1") return "半托管";
  const text = String(value ?? "").trim();
  return text ? `仓型 ${text}` : "";
}

function flattenYunqiTagText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => flattenYunqiTagText(item));
  if (value && typeof value === "object") {
    return flattenYunqiTagText(
      (value as Record<string, unknown>).name
      || (value as Record<string, unknown>).label
      || (value as Record<string, unknown>).title
      || (value as Record<string, unknown>).value
      || "",
    );
  }
  const text = String(value || "").trim();
  return text ? [text] : [];
}

function collectYunqiTags(detail: any) {
  return Array.from(new Set([
    ...flattenYunqiTagText(detail?.labels),
    ...flattenYunqiTagText(detail?.tags),
    ...flattenYunqiTagText(detail?.customTags),
  ].filter(Boolean)));
}

export function normalizeLookupText(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function buildLocalYunduOverallDetail(source: Record<string, unknown>) {
  const tags = dedupeStrings([
    ...flattenYunqiTagText(source.tagList),
    ...flattenYunqiTagText(source.statusTags),
    ...flattenYunqiTagText(source.addedSiteList),
    ...flattenYunqiTagText(source.onceAddSiteList),
    ...(source.isLack ? ["缺货"] : []),
    ...(source.isAdProduct ? ["广告商品"] : []),
  ]);
  const punishTags = flattenYunqiTagText(source.punishList);

  return {
    sourceKind: "yundu_overall",
    matchStatus: "local",
    goodsId: firstTextValue(source.goodsId),
    id: firstTextValue(source.goodsId, source.id, source.productId, source.skcId),
    title: firstTextValue(source.productName, source.title, source.goodsName),
    titleZh: firstTextValue(source.productName, source.title, source.goodsName),
    imageUrl: firstTextValue(source.image, source.imageUrl, source.mainImageUrl),
    category: firstTextValue(source.category),
    categoryName: firstTextValue(source.categoryName, source.category),
    buyerName: firstTextValue(source.buyerName),
    labels: tags,
    tags,
    customTags: punishTags,
    sameNum: toSafeNumber(source.addedSiteCount),
    soldOut: Boolean(source.isLack),
    isAdProduct: Boolean(source.isAdProduct),
    addedSiteList: Array.isArray(source.addedSiteList) ? source.addedSiteList : [],
    onceAddSiteList: Array.isArray(source.onceAddSiteList) ? source.onceAddSiteList : [],
    punishList: Array.isArray(source.punishList) ? source.punishList : [],
  };
}

function mergeTrackedProducts(existing: TrackedProduct[], additions: TrackedProduct[]) {
  const merged = new Map<string, TrackedProduct>();
  existing.forEach((item) => merged.set(item.url, item));
  additions.forEach((item) => {
    const previous = merged.get(item.url);
    if (!previous) {
      merged.set(item.url, item);
      return;
    }
    merged.set(item.url, {
      ...previous,
      ...item,
      title: item.title || previous.title,
      sourceKeyword: item.sourceKeyword || previous.sourceKeyword,
      goodsId: item.goodsId || previous.goodsId,
      snapshots: [...(previous.snapshots || []), ...(item.snapshots || [])].slice(-30),
    });
  });
  return Array.from(merged.values()).sort((left, right) => (right.addedAt || "").localeCompare(left.addedAt || ""));
}

function getWorkbenchProductLookupKeys(source: Record<string, unknown> | null | undefined) {
  if (!source) return [] as string[];
  return dedupeStrings([
    firstTextValue(source.skcId, source.productSkcId) ? `skc:${firstTextValue(source.skcId, source.productSkcId)}` : "",
    firstTextValue(source.goodsId) ? `goods:${firstTextValue(source.goodsId)}` : "",
    firstTextValue(source.spuId, source.productId, source.productSpuId) ? `spu:${firstTextValue(source.spuId, source.productId, source.productSpuId)}` : "",
    firstTextValue(source.title, source.productName, source.goodsName) ? `title:${firstTextValue(source.title, source.productName, source.goodsName).toLowerCase()}` : "",
  ]);
}

function buildWorkbenchProductSource(rawProducts: any, rawSales: any) {
  const parsedProducts = parseProductsData(rawProducts);
  const parsedSales = parseSalesData(rawSales);
  const salesItems = Array.isArray(parsedSales?.items) ? parsedSales.items : [];
  const lookup = new Map<string, Record<string, unknown>>();

  const ensureProduct = (source: Record<string, unknown>) => {
    const keys = getWorkbenchProductLookupKeys(source);
    for (const key of keys) {
      const existing = lookup.get(key);
      if (existing) return existing;
    }
    const next: Record<string, unknown> = { ...source };
    keys.forEach((key) => lookup.set(key, next));
    return next;
  };

  parsedProducts.forEach((item: any) => {
    const product = ensureProduct({ ...(item || {}) });
    Object.assign(product, {
      ...product,
      ...(item || {}),
      hasSalesSnapshot: Boolean(product.hasSalesSnapshot),
    });
    getWorkbenchProductLookupKeys(product).forEach((key) => lookup.set(key, product));
  });

  salesItems.forEach((item: any) => {
    const product = ensureProduct({ ...(item || {}), hasSalesSnapshot: true });
    Object.assign(product, {
      ...product,
      ...(item || {}),
      hasSalesSnapshot: true,
      title: firstTextValue(product.title, item.title, item.productName, item.goodsName),
      category: firstTextValue(product.category, item.category),
      categories: firstTextValue(product.categories, item.categories),
      skcId: firstTextValue(product.skcId, item.skcId, item.productSkcId),
      goodsId: firstTextValue(product.goodsId, item.goodsId),
      spuId: firstTextValue(product.spuId, item.spuId, item.productId, item.productSpuId),
      skuId: firstTextValue(product.skuId, item.skuId, item.productSkuId),
      sku: firstTextValue(product.sku, item.sku, item.skuCode),
      extCode: firstTextValue(product.extCode, item.extCode, item.skuCode, item.sku),
      imageUrl: firstTextValue(product.imageUrl, item.imageUrl, item.productSkcPicture, item.goodsImageUrl),
      todaySales: toSafeNumber(item.todaySales) || toSafeNumber(product.todaySales),
      last7DaysSales: toSafeNumber(item.last7DaysSales) || toSafeNumber(product.last7DaysSales),
      last30DaysSales: toSafeNumber(item.last30DaysSales) || toSafeNumber(product.last30DaysSales),
      totalSales: toSafeNumber(item.totalSales) || toSafeNumber(product.totalSales),
      price: firstTextValue(product.price, item.price),
    });
    getWorkbenchProductLookupKeys(product).forEach((key) => lookup.set(key, product));
  });

  const uniqueProducts = Array.from(new Set(lookup.values())).filter((item) => {
    const product = item as Record<string, unknown>;
    return Boolean(firstTextValue(product.title, product.productName, product.goodsName, product.skcId, product.goodsId, product.spuId));
  });

  uniqueProducts.sort((left, right) => {
    const rightSales = toSafeNumber(right.totalSales) || toSafeNumber(right.last30DaysSales) || toSafeNumber(right.last7DaysSales);
    const leftSales = toSafeNumber(left.totalSales) || toSafeNumber(left.last30DaysSales) || toSafeNumber(left.last7DaysSales);
    if (rightSales !== leftSales) return rightSales - leftSales;
    return String(left.title || "").localeCompare(String(right.title || ""), "zh-CN");
  });

  return uniqueProducts;
}

export default function CompetitorProductWorkbench({
  onYunqiRequestStart,
  onYunqiRequestFinish,
  onYunqiRequestSuccess,
  onYunqiAuthInvalid,
  activeStep: controlledActiveStep,
  onActiveStepChange,
  onStepStateChange,
  hideStepShell = false,
  prefillProduct = null,
}: CompetitorProductWorkbenchProps = {}) {
  const [myProducts, setMyProducts] = useState<any[]>([]);
  const [, setFluxStoreItems] = useState<any[]>([]);
  const [, setFluxStoreSyncedAt] = useState("");
  const [fluxSiteDatasets, setFluxSiteDatasets] = useState<FluxSiteDataset[]>([]);
  const [tracked, setTracked] = useState<TrackedProduct[]>([]);
  const [workspaces, setWorkspaces] = useState<Record<string, ProductWorkspaceState>>({});
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [internalActiveStep, setInternalActiveStep] = useState(0);
  const [selectedMy, setSelectedMy] = useState<string | null>(null);
  const pendingPrefillStepRef = useRef<number | null>(null);
  const appliedPrefillKeyRef = useRef("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [selectedResultKeys, setSelectedResultKeys] = useState<string[]>([]);
  const [searchTableSort, setSearchTableSort] = useState<SearchTableSortState>({ columnKey: "", order: null });
  const [trackingKeys, setTrackingKeys] = useState<string[]>([]);
  const [manualUrl, setManualUrl] = useState("");
  const [addingManual, setAddingManual] = useState(false);
  const [refreshingSamples, setRefreshingSamples] = useState(false);
  const [yunqiProductDetails, setYunqiProductDetails] = useState<Record<string, any>>({});
  const [yunqiProductDetailLoading, setYunqiProductDetailLoading] = useState(false);
  const [yunqiProductDetailError, setYunqiProductDetailError] = useState("");
  const [trafficActiveSiteKey, setTrafficActiveSiteKey] = useState<FluxSiteDataset["siteKey"]>("global");
  const [trafficRangeLabel, setTrafficRangeLabel] = useState<string>("今日");
  const [productHistoryCache, setProductHistoryCache] = useState<Record<string, any>>({});
  const [degradedReason, setDegradedReason] = useState<string>("");
  const sampleCardRef = useRef<HTMLDivElement | null>(null);
  // 云启"无匹配"自救：根据标题搜出候选 / 手动贴链接
  const [yunqiRescueLoading, setYunqiRescueLoading] = useState(false);
  const [yunqiRescueCandidates, setYunqiRescueCandidates] = useState<any[]>([]);
  const [yunqiRescueUrl, setYunqiRescueUrl] = useState("");
  // 标题中文化：英文标题 → 中文缓存（持久 + 运行时）
  const [titleTranslations, setTitleTranslations] = useState<Record<string, string>>({});
  const titleTranslatePendingRef = useRef<Set<string>>(new Set());
  const titleTranslateHydratedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!store) return;
        const cache = await getStoreValue(store, "temu_competitor_title_translations");
        if (!cancelled && cache && typeof cache === "object") {
          setTitleTranslations((prev) => ({ ...(cache as Record<string, string>), ...prev }));
        }
      } catch {
        // ignore
      } finally {
        titleTranslateHydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const displayTitle = useCallback((raw: unknown, zh?: unknown): string => {
    const zhStr = typeof zh === "string" ? zh.trim() : "";
    if (zhStr && /[\u4e00-\u9fa5]/.test(zhStr)) return zhStr;
    const rawStr = typeof raw === "string" ? raw.trim() : String(raw || "").trim();
    if (!rawStr) return "";
    if (/[\u4e00-\u9fa5]/.test(rawStr)) return rawStr;
    return titleTranslations[rawStr] || rawStr;
  }, [titleTranslations]);
  const requestTitleTranslations = useCallback((titles: Array<string | undefined | null>) => {
    const api = (window as any).electronAPI?.imageStudio;
    if (!api?.translate) return;
    const pending = titleTranslatePendingRef.current;
    const unique = new Set<string>();
    titles.forEach((t) => {
      const s = typeof t === "string" ? t.trim() : "";
      if (!s) return;
      if (s.length < 3) return;
      if (/[\u4e00-\u9fa5]/.test(s)) return;
      if (titleTranslations[s]) return;
      if (pending.has(s)) return;
      unique.add(s);
    });
    if (unique.size === 0) return;
    const batch = Array.from(unique).slice(0, 20);
    batch.forEach((t) => pending.add(t));
    (async () => {
      try {
        const result = await api.translate({ texts: batch });
        const translations = Array.isArray(result?.translations) ? result.translations : [];
        const next: Record<string, string> = {};
        batch.forEach((src, idx) => {
          const dst = typeof translations[idx] === "string" ? translations[idx].trim() : "";
          if (dst && /[\u4e00-\u9fa5]/.test(dst)) next[src] = dst;
        });
        if (Object.keys(next).length > 0) {
          setTitleTranslations((prev) => {
            const merged = { ...prev, ...next };
            store?.set("temu_competitor_title_translations", merged).catch(() => {});
            return merged;
          });
        }
      } catch {
        // 降级静默
      } finally {
        batch.forEach((t) => pending.delete(t));
      }
    })();
  }, [titleTranslations]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!store) return;
        const cache = await getStoreValue(store, "temu_flux_product_history_cache");
        if (!cancelled && cache && typeof cache === "object") setProductHistoryCache(cache as Record<string, any>);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const wareHouseType = DEFAULT_WAREHOUSE_TYPE;

  const activeStep = typeof controlledActiveStep === "number" ? controlledActiveStep : internalActiveStep;
  const setActiveStep = useCallback((nextStep: number) => {
    if (typeof controlledActiveStep !== "number") {
      setInternalActiveStep(nextStep);
    }
    onActiveStepChange?.(nextStep);
  }, [controlledActiveStep, onActiveStepChange]);

  // 切步骤时回到页面顶部（否则上一步位置留在底部，新步骤从底部开始看，体验错乱）
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "auto" });
    document.querySelectorAll(".ant-layout-content, .ant-pro-layout-content, main").forEach((el) => {
      if (el && typeof (el as HTMLElement).scrollTo === "function") {
        (el as HTMLElement).scrollTo({ top: 0, behavior: "auto" });
      }
    });
  }, [activeStep]);

  const loadTracked = useCallback(async () => {
    const data = await readArrayStoreValue("temu_competitor_tracked");
    setTracked(data as TrackedProduct[]);
  }, []);

  const loadWorkspaces = useCallback(async () => {
    const data = await store?.get(PRODUCT_WORKSPACE_STORE_KEY);
    setWorkspaces(getWorkspaceMap(data));
    setWorkspaceReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadTracked();
    void loadWorkspaces();

    const loadInitialData = async () => {
      const storeValues = await getStoreValues(store, [
        "temu_products",
        "temu_sales",
        "temu_flux",
        "temu_raw_fluxUS",
        "temu_raw_fluxEU",
      ]);
      const rawProducts = storeValues.temu_products;
      const rawSales = storeValues.temu_sales;
      const rawFlux = storeValues.temu_flux;
      const rawFluxUS = storeValues.temu_raw_fluxUS;
      const rawFluxEU = storeValues.temu_raw_fluxEU;

      const [debugFlux, debugFluxUS, debugFluxEU] = await Promise.all([
        automation?.readScrapeData?.("flux").catch(() => null),
        automation?.readScrapeData?.("fluxUS").catch(() => null),
        automation?.readScrapeData?.("fluxEU").catch(() => null),
      ]);

      if (cancelled) return;

      setMyProducts(buildWorkbenchProductSource(rawProducts, rawSales));

      const preferredFlux = pickPreferredFluxSource(rawFlux, debugFlux);
      const preferredFluxUS = pickPreferredFluxSource(rawFluxUS, debugFluxUS);
      const preferredFluxEU = pickPreferredFluxSource(rawFluxEU, debugFluxEU);

      const parsedFlux = buildFluxDataset([
        { siteKey: "global", siteLabel: "全球", data: preferredFlux },
        { siteKey: "us", siteLabel: "美国", data: preferredFluxUS },
        { siteKey: "eu", siteLabel: "欧区", data: preferredFluxEU },
      ]);
      setFluxStoreItems(Array.isArray(parsedFlux?.items) ? parsedFlux.items : []);
      setFluxStoreSyncedAt(String(parsedFlux?.syncedAt || ""));
      setFluxSiteDatasets(Array.isArray(parsedFlux?.siteDatasets) ? parsedFlux.siteDatasets : []);
    };

    void loadInitialData();

    const listener = () => { void loadTracked(); };
    window.addEventListener(COMPETITOR_TRACKED_UPDATED_EVENT, listener);
    return () => {
      cancelled = true;
      window.removeEventListener(COMPETITOR_TRACKED_UPDATED_EVENT, listener);
    };
  }, [loadTracked, loadWorkspaces]);

  const myProductOptions = useMemo(() => {
    return myProducts.map((item) => {
      const raw = item && typeof item === "object" ? item as Record<string, unknown> : null;
      const normalized = normalizeMyProduct(item);
      const statusText = Boolean(raw?.hasSalesSnapshot) ? "在售" : getMyProductStatusText(raw, normalized);
      return {
        value: normalized.id,
        label: normalized.title,
        raw: item,
        normalized,
        imageUrl: getMyProductImageUrl(raw),
        category: firstTextValue(raw?.category, raw?.categories, raw?.catName, normalized.category),
        skcId: firstTextValue(raw?.productSkcId, raw?.skcId, normalized.id),
        goodsId: firstTextValue(raw?.goodsId),
        statusText,
        monthlySales: normalized.monthlySales,
        price: normalized.price,
        searchLabel: [
          normalized.title,
          statusText,
          firstTextValue(raw?.category, raw?.categories, raw?.catName, normalized.category),
          firstTextValue(raw?.productSkcId, raw?.skcId, normalized.id),
          firstTextValue(raw?.goodsId),
        ].join(" "),
      };
    }).filter((item) => item.value && item.label && isMyProductOnSale(item.raw as Record<string, unknown> | null, item.normalized));
  }, [myProducts]);

  const normalizedPrefillProduct = useMemo(() => {
    if (!prefillProduct) return null;
    return {
      token: firstTextValue(prefillProduct.token),
      activateStep: typeof prefillProduct.activateStep === "number" ? prefillProduct.activateStep : 1,
      productId: firstTextValue(prefillProduct.productId),
      skcId: firstTextValue(prefillProduct.skcId),
      spuId: firstTextValue(prefillProduct.spuId),
      goodsId: firstTextValue(prefillProduct.goodsId),
      skuId: firstTextValue(prefillProduct.skuId),
      title: firstTextValue(prefillProduct.title),
    };
  }, [prefillProduct]);

  useEffect(() => {
    if (myProductOptions.length === 0) {
      if (selectedMy) setSelectedMy(null);
      return;
    }
    if (!selectedMy || !myProductOptions.some((item) => item.value === selectedMy)) {
      setSelectedMy(myProductOptions[0].value);
    }
  }, [myProductOptions, selectedMy]);

  useEffect(() => {
    if (!normalizedPrefillProduct || myProductOptions.length === 0) return;
    const prefillKey = [
      normalizedPrefillProduct.token,
      normalizedPrefillProduct.productId,
      normalizedPrefillProduct.skcId,
      normalizedPrefillProduct.spuId,
      normalizedPrefillProduct.goodsId,
      normalizedPrefillProduct.skuId,
      normalizedPrefillProduct.title,
    ].filter(Boolean).join("|");
    if (!prefillKey || appliedPrefillKeyRef.current === prefillKey) return;

    const normalizeMatchText = (value: unknown) => String(value ?? "").trim().toLowerCase();
    const targetTitle = normalizeMatchText(normalizedPrefillProduct.title);
    const matchedOption = myProductOptions.find((option) => {
      const raw = option.raw && typeof option.raw === "object" ? option.raw as Record<string, unknown> : null;
      const optionKeys = [
        option.value,
        option.skcId,
        option.goodsId,
        firstTextValue(raw?.spuId, raw?.productId, raw?.productSpuId),
        firstTextValue(raw?.skuId, raw?.productSkuId),
      ].map(normalizeMatchText).filter(Boolean);
      const targetKeys = [
        normalizedPrefillProduct.productId,
        normalizedPrefillProduct.skcId,
        normalizedPrefillProduct.spuId,
        normalizedPrefillProduct.goodsId,
        normalizedPrefillProduct.skuId,
      ].map(normalizeMatchText).filter(Boolean);
      if (targetKeys.some((target) => optionKeys.includes(target))) return true;
      const optionTitle = normalizeMatchText(option.label);
      return Boolean(
        targetTitle
        && optionTitle
        && (optionTitle === targetTitle || optionTitle.includes(targetTitle) || targetTitle.includes(optionTitle))
      );
    });

    if (!matchedOption) return;

    appliedPrefillKeyRef.current = prefillKey;
    const nextStep = normalizedPrefillProduct.activateStep ?? 1;
    if (matchedOption.value !== selectedMy) {
      pendingPrefillStepRef.current = nextStep;
      setSelectedMy(matchedOption.value);
      return;
    }
    if (activeStep !== nextStep) {
      setActiveStep(nextStep);
    }
  }, [activeStep, myProductOptions, normalizedPrefillProduct, selectedMy, setActiveStep]);

  const selectedOption = useMemo(() => myProductOptions.find((item) => item.value === selectedMy) || null, [myProductOptions, selectedMy]);
  const selectedProduct = selectedOption?.normalized || null;
  const selectedRawProduct = useMemo<Record<string, unknown> | null>(() => {
    if (!selectedOption?.raw || typeof selectedOption.raw !== "object") return null;
    return selectedOption.raw as Record<string, unknown>;
  }, [selectedOption]);
  const selectedProductMeta = useMemo(() => {
    if (!selectedRawProduct) return null;
    return {
      imageUrl: getMyProductImageUrl(selectedRawProduct),
      skcId: firstTextValue(selectedRawProduct.productSkcId, selectedRawProduct.skcId, selectedProduct?.id),
      spuId: firstTextValue(selectedRawProduct.spuId, selectedRawProduct.productId, selectedRawProduct.productSpuId),
      goodsId: firstTextValue(selectedRawProduct.goodsId),
      skuId: firstTextValue(selectedRawProduct.skuId, selectedRawProduct.productSkuId),
      extCode: firstTextValue(selectedRawProduct.extCode, selectedRawProduct.sku, selectedRawProduct.outSkuSn),
      siteStatus: getMyProductStatusText(selectedRawProduct, selectedProduct),
      category: firstTextValue(selectedRawProduct.category, selectedRawProduct.categories, selectedRawProduct.catName, selectedProduct?.category),
    };
  }, [selectedProduct, selectedRawProduct]);
  const selectedGoodsId = selectedProductMeta?.goodsId || "";
  const selectedYunqiCachedDetail = selectedGoodsId ? yunqiProductDetails[selectedGoodsId] || null : null;
  const selectedYunqiDetail = selectedYunqiCachedDetail || null;
  const selectedYunqiMatchStatus = String(selectedYunqiDetail?.matchStatus || "").trim();
  const selectedYunqiGoodsId = firstTextValue(selectedYunqiDetail?.goodsId, selectedYunqiDetail?.id);
  const isSelectedYunqiExactMatch = Boolean(selectedYunqiDetail)
    && Boolean(selectedGoodsId)
    && Boolean(selectedYunqiGoodsId)
    && selectedYunqiGoodsId === selectedGoodsId;
  const selectedYunqiDisplay = useMemo(() => {
    if (!selectedProduct) return null;
    // 全部从云启取数据，卖家后台数据仅作兜底
    const yunqi = isSelectedYunqiExactMatch ? selectedYunqiDetail : null;
    return {
      title: firstTextValue(
        yunqi?.title,
        yunqi?.titleZh,
        selectedProduct.title,
      ),
      imageUrl: firstTextValue(
        yunqi ? getYunqiDetailImageUrl(yunqi) : "",
        selectedProductMeta?.imageUrl,
      ),
      price: (yunqi ? toSafeNumber(yunqi.price) : 0) || selectedProduct.price || 0,
      dailySales: (yunqi ? toSafeNumber(yunqi.dailySales) : 0) || selectedProduct.dailySales || 0,
      monthlySales: (yunqi ? toSafeNumber(yunqi.monthlySales) : 0) || selectedProduct.monthlySales || 0,
      score: (yunqi ? toSafeNumber(yunqi.score ?? yunqi.rating) : 0) || selectedProduct.score || 0,
      reviewCount: (yunqi ? toSafeNumber(yunqi.reviewCount) : 0) || selectedProduct.reviewCount || 0,
      hasVideo: (yunqi ? Boolean(yunqi.videoUrl) : false) || selectedProduct.hasVideo,
    };
  }, [isSelectedYunqiExactMatch, selectedProduct, selectedProductMeta?.imageUrl, selectedYunqiDetail]);
  const selectedYunqiTags = useMemo(() => collectYunqiTags(selectedYunqiDetail).slice(0, 12), [selectedYunqiDetail]);
  const selectedYunqiPriceItems = useMemo(() => {
    if (!isSelectedYunqiExactMatch || !Array.isArray(selectedYunqiDetail?.prices)) return [];
    return selectedYunqiDetail.prices
      .slice(0, 8)
      .map((entry: any) => {
        const site = getYunqiSiteLabel(entry?.region, entry?.currency);
        const currency = String(entry?.currency || "").trim() || "$";
        const price = Number(entry?.price || 0);
        if (!site || !Number.isFinite(price) || price <= 0) return null;
        return {
          key: `${site}-${currency}-${price}`,
          site,
          priceLabel: `${currency}${price.toFixed(2)}`,
        };
      })
      .filter(Boolean);
  }, [isSelectedYunqiExactMatch, selectedYunqiDetail]);
  const selectedYunqiSalesTrendItems = useMemo(() => {
    if (!isSelectedYunqiExactMatch || !Array.isArray(selectedYunqiDetail?.dailySalesList)) return [];
    return selectedYunqiDetail.dailySalesList
      .slice(-7)
      .map((entry: any) => {
        const rawDate = String(entry?.date || "");
        const date = formatCompactTrendDate(rawDate);
        const sales = Number(entry?.sales || 0);
        if (!date) return null;
        return {
          key: `${date}-${sales}`,
          date,
          sales: Number.isFinite(sales) ? sales : 0,
        };
      })
      .filter(Boolean);
  }, [isSelectedYunqiExactMatch, selectedYunqiDetail]);
  const selectedTrafficMatchContext = useMemo(() => {
    if (!selectedProduct) return null;
    return {
      candidateIds: new Set(
        [
          selectedProductMeta?.goodsId,
          selectedProductMeta?.spuId,
          selectedProductMeta?.skcId,
          selectedProductMeta?.skuId,
          selectedRawProduct?.goodsId,
          selectedRawProduct?.spuId,
          selectedRawProduct?.skcId,
          selectedRawProduct?.productSkcId,
          selectedRawProduct?.goodsSkcId,
          selectedRawProduct?.skuId,
          selectedRawProduct?.productSkuId,
          selectedRawProduct?.productId,
          selectedRawProduct?.productSpuId,
          selectedProduct?.id,
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
      titleCandidate: firstTextValue(
        selectedRawProduct?.productName,
        selectedRawProduct?.title,
        selectedRawProduct?.goodsName,
        selectedProduct?.title,
      ).toLowerCase(),
    };
  }, [selectedProduct, selectedProductMeta?.goodsId, selectedProductMeta?.skcId, selectedProductMeta?.skuId, selectedProductMeta?.spuId, selectedRawProduct]);
  const selectedTrafficBySite = useMemo(() => {
    return FLUX_SITE_ORDER.map((site) => {
      const dataset = fluxSiteDatasets.find((item) => item.siteKey === site.siteKey) || {
        siteKey: site.siteKey,
        siteLabel: site.siteLabel,
        syncedAt: "",
        summary: null,
        items: [],
        summaryByRange: {},
        itemsByRange: {},
        availableRanges: [],
        primaryRangeLabel: "今日",
      };
      if (!selectedTrafficMatchContext) {
        return {
          ...site,
          syncedAt: dataset.syncedAt,
          summary: null as ProductTrafficSummary | null,
          summaryByRange: {} as Record<string, ProductTrafficSummary | null>,
          availableRanges: dataset.availableRanges || [],
          activeRangeLabel: dataset.primaryRangeLabel || "今日",
          siteSummary: dataset.summary || null,
        };
      }
      const matchItems = (items: any[]) => items.filter((item: any) => {
        const goodsId = String(item?.goodsId || "").trim();
        const spuId = String(item?.spuId || "").trim();
        const skcId = String(item?.skcId || "").trim();
        const skuId = String(item?.skuId || "").trim();
        const goodsName = String(item?.goodsName || "").trim().toLowerCase();
        return selectedTrafficMatchContext.candidateIds.has(goodsId)
          || selectedTrafficMatchContext.candidateIds.has(spuId)
          || selectedTrafficMatchContext.candidateIds.has(skcId)
          || selectedTrafficMatchContext.candidateIds.has(skuId)
          || (selectedTrafficMatchContext.titleCandidate && goodsName === selectedTrafficMatchContext.titleCandidate);
      });
      const availableRanges = Array.from(new Set([
        ...FLUX_RANGE_ORDER.filter((label) => dataset.summaryByRange?.[label] || (dataset.itemsByRange?.[label] || []).length > 0),
        ...(dataset.availableRanges || []),
      ])).filter(Boolean);
      const summaryByRange = availableRanges.reduce<Record<string, ProductTrafficSummary | null>>((accumulator, label) => {
        const matchedItems = matchItems(dataset.itemsByRange?.[label] || []);
        accumulator[label] = buildProductTrafficSummary(matchedItems, dataset.syncedAt, site.siteKey, site.siteLabel);
        return accumulator;
      }, {});
      const activeRangeLabel = availableRanges.includes(trafficRangeLabel)
        ? trafficRangeLabel
        : (dataset.primaryRangeLabel && availableRanges.includes(dataset.primaryRangeLabel) ? dataset.primaryRangeLabel : availableRanges[0] || "今日");
      const matchedItems = matchItems(dataset.items || []);
      return {
        ...site,
        syncedAt: dataset.syncedAt,
        summary: summaryByRange[activeRangeLabel] || buildProductTrafficSummary(matchedItems, dataset.syncedAt, site.siteKey, site.siteLabel),
        summaryByRange,
        availableRanges,
        activeRangeLabel,
        siteSummary: dataset.summary || null,
      };
    });
  }, [fluxSiteDatasets, selectedTrafficMatchContext, trafficRangeLabel]);
  const selectedTrafficDetailBySite = useMemo(() => {
    const labelMap: Record<FluxSiteDataset["siteKey"], string> = {
      global: "全球",
      us: "美国",
      eu: "欧区",
    };
    return selectedTrafficBySite.map((site) => {
      // 与 ProductList → TrafficDriverPanel 商品分析对齐：
      // 1) summary 始终用商品级匹配出的 site.summary，不做合成
      // 2) trendList 优先用商品级日缓存（粒度更细），> 1 条才用，否则回退到站点级 siteSummary.trendList
      let cacheDaily: any[] | null = null;
      if (selectedTrafficMatchContext) {
        const stationLabel = labelMap[site.siteKey];
        for (const id of selectedTrafficMatchContext.candidateIds) {
          const daily = productHistoryCache?.[id]?.stations?.[stationLabel]?.daily;
          if (Array.isArray(daily) && daily.length > 0) {
            cacheDaily = daily;
            break;
          }
        }
      }
      const trendList = cacheDaily && cacheDaily.length > 1
        ? cacheDaily
        : (site.siteSummary?.trendList || []);
      const trendSeries = normalizeFluxTrendSeries(trendList);

      // 三站点统一：只要日级缓存存在，就用 30 天累加 summary（与 trendList 同口径）；
      // 缓存缺失时才回退到 fluxStoreItems 匹配出的 site.summary
      const effectiveSummary = (cacheDaily
        ? buildSummaryFromDailyCache(cacheDaily, site.siteKey, labelMap[site.siteKey], site.syncedAt || "")
        : null) || site.summary;

      return {
        ...site,
        summary: effectiveSummary,
        detailLoading: false,
        trendSeries,
        recentTrendSeries: trendSeries.slice(-7),
        trendRangeText: formatFluxTrendRange(trendSeries),
        latestTrendPoint: trendSeries.slice(-1)[0] || null,
        detailSummary: effectiveSummary ? {
          dataDate: effectiveSummary.dataDate,
          updateTime: effectiveSummary.updateTime,
          detailVisitorNum: effectiveSummary.detailVisitorNum,
          collectUserNum: effectiveSummary.collectUserNum,
          payOrderNum: effectiveSummary.payOrderNum,
          payGoodsNum: effectiveSummary.payGoodsNum,
          searchExposeNum: effectiveSummary.searchExposeNum,
          searchClickNum: effectiveSummary.searchClickNum,
          searchPayGoodsNum: effectiveSummary.searchPayGoodsNum,
          recommendExposeNum: effectiveSummary.recommendExposeNum,
          recommendClickNum: effectiveSummary.recommendClickNum,
          recommendPayGoodsNum: effectiveSummary.recommendPayGoodsNum,
          trendExposeNum: effectiveSummary.trendExposeNum,
          trendPayOrderNum: effectiveSummary.trendPayOrderNum,
        } : null,
      };
    });
  }, [selectedTrafficBySite, selectedTrafficMatchContext, productHistoryCache]);
  const trafficOverviewSyncedAt = useMemo(() => {
    return selectedTrafficDetailBySite
      .map((item) => item.summary?.syncedAt || item.summary?.updateTime || item.syncedAt)
      .find(Boolean) || "";
  }, [selectedTrafficDetailBySite]);
  const activeTrafficSite = useMemo(() => {
    return selectedTrafficDetailBySite.find((item) => item.siteKey === trafficActiveSiteKey)
      || selectedTrafficDetailBySite[0]
      || null;
  }, [selectedTrafficDetailBySite, trafficActiveSiteKey]);
  const activeTrafficModeMeta = useMemo(() => getTrafficModeMeta(activeTrafficSite), [activeTrafficSite]);
  const activeTrafficTrendChartData = useMemo(() => {
    return activeTrafficSite ? buildTrafficPerformanceTrendData(activeTrafficSite) : [];
  }, [activeTrafficSite]);
  const activeTrafficTrendRangeText = useMemo(() => {
    if (activeTrafficSite?.trendRangeText) return activeTrafficSite.trendRangeText;
    if (activeTrafficTrendChartData.length > 1) {
      const first = activeTrafficTrendChartData[0]?.fullLabel || activeTrafficTrendChartData[0]?.label;
      const last = activeTrafficTrendChartData[activeTrafficTrendChartData.length - 1]?.fullLabel || activeTrafficTrendChartData[activeTrafficTrendChartData.length - 1]?.label;
      return `${first} - ${last}`;
    }
    return "";
  }, [activeTrafficSite, activeTrafficTrendChartData]);
  const activeTrafficSourceChartData = useMemo(() => {
    const rangeDays = trafficRangeLabel === "近30日" || trafficRangeLabel === "本月" ? 30 : 7;
    return activeTrafficSite ? buildTrafficSourceTimelineData(activeTrafficSite, rangeDays) : [];
  }, [activeTrafficSite, trafficRangeLabel]);
  const activeTrafficFunnelSteps = useMemo(() => {
    return activeTrafficSite ? buildTrafficFunnelSteps(activeTrafficSite) : [];
  }, [activeTrafficSite]);
  const showTrafficSourceTimelineChart = activeTrafficSourceChartData.length > 1;
  const activeTrafficAvailableRanges = useMemo(() => {
    return FLUX_RANGE_ORDER.filter((label) => activeTrafficSite?.summaryByRange?.[label]);
  }, [activeTrafficSite]);
  const showTrafficRangeSwitcher = activeTrafficAvailableRanges.length > 1;
  const trafficRangeDisplayLabel = activeTrafficAvailableRanges.length === 1
    ? activeTrafficAvailableRanges[0]
    : "";
  const activeTrafficFunnelDisplaySteps = useMemo(() => {
    const labels = ["曝光", "点击", "详情访客", "加购", "支付买家"];
    return activeTrafficFunnelSteps.map((item, index) => ({
      ...item,
      displayLabel: labels[index] || item.label,
    }));
  }, [activeTrafficFunnelSteps]);
  const activeTrafficDateLabel = useMemo(() => {
    if (activeTrafficSite?.summary?.dataDate) return activeTrafficSite.summary.dataDate;
    if (activeTrafficSite?.latestTrendPoint?.date) return activeTrafficSite.latestTrendPoint.date;
    return "";
  }, [activeTrafficSite]);
  const activeTrafficTodayFallbackText = useMemo(() => {
    if (trafficRangeLabel !== "今日" || !activeTrafficDateLabel) return "";
    const now = new Date();
    const todayLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (activeTrafficDateLabel === todayLabel) return "";
    return `今日暂未返回商品级明细，当前展示最近一个统计日（${activeTrafficDateLabel}）`;
  }, [activeTrafficDateLabel, trafficRangeLabel]);
  useEffect(() => {
    if (activeTrafficAvailableRanges.length === 0) return;
    if (activeTrafficAvailableRanges.includes(trafficRangeLabel)) return;
    setTrafficRangeLabel(activeTrafficSite?.activeRangeLabel || activeTrafficAvailableRanges[0]);
  }, [activeTrafficAvailableRanges, activeTrafficSite, trafficRangeLabel]);
  const activeTrafficMetricCards = useMemo(() => {
    if (!activeTrafficSite) return [];
    if (activeTrafficSite.summary) {
      return [
        {
          key: "expose",
          title: "曝光",
          value: formatTrafficNumber(activeTrafficSite.summary.exposeNum),
          caption: `较上期 ${formatRelativeChangeText(activeTrafficSite.summary.exposeNumChange)}`,
          captionColor: getRelativeChangeColor(activeTrafficSite.summary.exposeNumChange),
        },
        {
          key: "click",
          title: "点击",
          value: formatTrafficNumber(activeTrafficSite.summary.clickNum),
          caption: `较上期 ${formatRelativeChangeText(activeTrafficSite.summary.clickNumChange)}`,
          captionColor: getRelativeChangeColor(activeTrafficSite.summary.clickNumChange),
        },
        {
          key: "visitor",
          title: "商品访客",
          value: formatTrafficNumber(activeTrafficSite.summary.detailVisitorNum || activeTrafficSite.summary.detailVisitNum),
          caption: "进入详情页的人数",
          captionColor: "#8c8c8c",
        },
        {
          key: "cart",
          title: "加购人数",
          value: formatTrafficNumber(activeTrafficSite.summary.addToCartUserNum),
          caption: "更接近下单的信号",
          captionColor: "#8c8c8c",
        },
        {
          key: "buyer",
          title: "支付买家",
          value: formatTrafficNumber(activeTrafficSite.summary.buyerNum),
          caption: `支付买家 / 件数 ${formatTrafficNumber(activeTrafficSite.summary.buyerNum)} / ${formatTrafficNumber(activeTrafficSite.summary.payGoodsNum)}`,
          captionColor: "#8c8c8c",
        },
        {
          key: "conversion",
          title: "点击支付转化率",
          value: formatTrafficPercentValue(toSafeNumber(activeTrafficSite.summary.clickPayRate) * 100),
          caption: "判断这波流量有没有成交能力",
          captionColor: "#8c8c8c",
        },
      ];
    }
    const trendSeries = Array.isArray(activeTrafficSite.recentTrendSeries) ? activeTrafficSite.recentTrendSeries : [];
    const visitorsAverage = average(trendSeries.map((item: FluxTrendPoint) => item.visitors));
    const buyersAverage = average(trendSeries.map((item: FluxTrendPoint) => item.buyers));
    const conversionAverage = average(trendSeries.map((item: FluxTrendPoint) => item.conversionRate));
    return [
      {
        key: "latestVisitors",
        title: "最新访客",
        value: formatTrafficNumber(activeTrafficSite.latestTrendPoint?.visitors || 0),
        caption: activeTrafficSite.latestTrendPoint?.date || "暂无日期",
        captionColor: "#8c8c8c",
      },
      {
        key: "latestBuyers",
        title: "最新支付买家",
        value: formatTrafficNumber(activeTrafficSite.latestTrendPoint?.buyers || 0),
        caption: "站点级最近一天",
        captionColor: "#8c8c8c",
      },
      {
        key: "latestConversion",
        title: "最新转化率",
        value: formatTrafficPercentValue((activeTrafficSite.latestTrendPoint?.conversionRate || 0) * 100),
        caption: "站点级最近一天",
        captionColor: "#8c8c8c",
      },
      {
        key: "avgVisitors",
        title: "近7天均访客",
        value: formatTrafficNumber(visitorsAverage),
        caption: "站点整体走势",
        captionColor: "#8c8c8c",
      },
      {
        key: "avgBuyers",
        title: "近7天均买家",
        value: formatTrafficNumber(buyersAverage),
        caption: "站点整体走势",
        captionColor: "#8c8c8c",
      },
      {
        key: "avgConversion",
        title: "近7天均转化率",
        value: formatTrafficPercentValue(conversionAverage * 100),
        caption: "站点整体走势",
        captionColor: "#8c8c8c",
      },
    ];
  }, [activeTrafficSite]);
  const suggestedKeywords = useMemo(() => deriveMyProductKeywords(selectedOption?.raw || null, selectedProduct), [selectedOption, selectedProduct]);

  useEffect(() => {
    if (!selectedMy || !workspaceReady) return;
    const workspace = workspaces[selectedMy];
    const fallbackStep = (workspace?.selectedUrls?.length ?? 0) > 0 ? 2 : 0;
    const nextStep = pendingPrefillStepRef.current ?? fallbackStep;
    pendingPrefillStepRef.current = null;
    setActiveStep(nextStep);
    setKeyword(workspace?.keyword || suggestedKeywords[0] || selectedProduct?.category || selectedProduct?.title || "");
    setResults(null);
    setSelectedResultKeys([]);
    setSearchTableSort({ columnKey: "", order: null });
    setTrafficRangeLabel("今日");
    setYunqiProductDetailLoading(false);
    setYunqiProductDetailError("");
  }, [selectedMy, workspaceReady]);

  useEffect(() => {
    if (activeStep !== 1) {
      setYunqiProductDetailLoading(false);
      return;
    }
    if (!selectedGoodsId || !competitor) {
      setYunqiProductDetailLoading(false);
      return;
    }
    const cachedDetail = selectedYunqiCachedDetail;
    const cachedMatchStatus = selectedYunqiMatchStatus;
    const cachedGoodsId = firstTextValue(cachedDetail?.goodsId, cachedDetail?.id);
    const canReuseCachedDetail = Boolean(cachedDetail)
      && (
        cachedMatchStatus === "exact"
        || (cachedMatchStatus !== "not_matched" && Boolean(cachedGoodsId) && cachedGoodsId === selectedGoodsId)
      );
    if (canReuseCachedDetail) {
      setYunqiProductDetailLoading(false);
      setYunqiProductDetailError("");
      return;
    }
    if (cachedDetail) {
      setYunqiProductDetailLoading(false);
      setYunqiProductDetailError(YUNQI_NOT_MATCHED_MESSAGE);
      return;
    }

    let alive = true;
    setYunqiProductDetailLoading(true);
    setYunqiProductDetailError("");
    onYunqiRequestStart?.();

    withRetry(
      () => competitor.track({ goodsId: selectedGoodsId, allowNotMatched: true }),
      { label: "detail-track" },
    ).then((detail: any) => {
      if (!alive) return;
      setYunqiProductDetails((current) => ({ ...current, [selectedGoodsId]: detail }));
      if (detail?.matchStatus === "not_matched") {
        setYunqiProductDetailError(YUNQI_NOT_MATCHED_MESSAGE);
        onYunqiRequestSuccess?.();
        return;
      }
      const returnedGoodsId = firstTextValue(detail?.goodsId, detail?.id);
      if (returnedGoodsId && returnedGoodsId !== selectedGoodsId) {
        setYunqiProductDetailError(YUNQI_NOT_MATCHED_MESSAGE);
        return;
      }
      setYunqiProductDetailError("");
      onYunqiRequestSuccess?.();
    }).catch((error: unknown) => {
      if (!alive) return;
      if (isYunqiAuthInvalidError(error)) {
        onYunqiAuthInvalid?.(error);
        return;
      }
      if (isUnsupportedCompetitorTrackError(error)) {
        setYunqiProductDetailError("当前版本暂未接入云启补充详情抓取，先展示已采集数据。");
        return;
      }
      const rawErrorMessage = getErrorMessage(error);
      const cleanedError = normalizeYunqiDetailError(rawErrorMessage, selectedGoodsId);
      if (!cleanedError && selectedGoodsId && isLegacyGoodsIdPrompt(rawErrorMessage)) {
        setYunqiProductDetailError("");
        return;
      }
      setYunqiProductDetailError(cleanedError || "云启商品详情获取失败");
    }).finally(() => {
      if (!alive) return;
      onYunqiRequestFinish?.();
      setYunqiProductDetailLoading(false);
    });

    return () => {
      alive = false;
    };
  }, [
    activeStep,
    onYunqiAuthInvalid,
    onYunqiRequestFinish,
    onYunqiRequestStart,
    onYunqiRequestSuccess,
    selectedGoodsId,
    selectedYunqiCachedDetail,
    selectedYunqiMatchStatus,
  ]);

  const persistWorkspace = useCallback(async (productId: string, patch: Partial<ProductWorkspaceState>) => {
    const current = workspaces[productId];
    const nextSelectedUrls = patch.selectedUrls ?? current?.selectedUrls ?? [];
    // P1.3：把 tracked 里对应 url 的最新 snapshot 冗余进 workspace
    const nowIso = new Date().toISOString();
    const previousSnapshots = current?.selectedSampleSnapshots ?? [];
    const prevByUrl = new Map(previousSnapshots.map((item) => [item.url, item]));
    const nextSnapshots: ProductWorkspaceSnapshotCache[] = nextSelectedUrls.map((url) => {
      const trackedItem = tracked.find((item) => item.url === url);
      const latest = trackedItem ? getLatestSnapshot(trackedItem) : null;
      if (latest) {
        return {
          url,
          title: trackedItem?.title,
          sourceKeyword: trackedItem?.sourceKeyword,
          goodsId: trackedItem?.goodsId,
          addedAt: trackedItem?.addedAt,
          snapshot: latest,
          updatedAt: nowIso,
        };
      }
      // 没有新 snapshot 就沿用上一份缓存，避免断网时丢失
      return prevByUrl.get(url) || { url, snapshot: null, updatedAt: nowIso };
    }).filter((item) => item.snapshot);
    const nextWorkspace: ProductWorkspaceState = {
      productId,
      keyword: patch.keyword ?? current?.keyword ?? "",
      wareHouseType: patch.wareHouseType ?? current?.wareHouseType ?? 0,
      selectedUrls: nextSelectedUrls,
      selectedSampleSnapshots: nextSnapshots,
      actionStates: patch.actionStates ?? current?.actionStates ?? {},
      updatedAt: nowIso,
    };
    const next = { ...workspaces, [productId]: nextWorkspace };
    setWorkspaces(next);
    await store?.set(PRODUCT_WORKSPACE_STORE_KEY, next);
  }, [workspaces, tracked]);

  const selectedUrls = (selectedMy && workspaces[selectedMy]?.selectedUrls) || [];

  const resultSnapshots = useMemo<any[]>(() => {
    const products = Array.isArray(results?.products) ? results.products : [];
    return products.map((product: any) => buildFallbackSnapshotFromSearch(product));
  }, [results]);

  const rawSearchRows = useMemo(() => {
    return resultSnapshots.map((snapshot: any, index: number) => {
      const raw = results?.products?.[index];
      return {
        ...raw,
        snapshot,
        signal: buildTrackedSignals(snapshot, resultSnapshots, selectedProduct || undefined),
      };
    });
  }, [resultSnapshots, results, selectedProduct]);

  // yunqi 的关键词搜索经常返回大量不相关品类（盲盒、吸尘器、座椅套……），
  // 这里用关键词的 2-gram 子串与标题匹配，给每行打一个相关度分数，并按分数过滤/排序
  const onlyRelevantSamples = false;
  const relevanceKeyword = (results?.keyword || keyword || "").trim();
  const relevanceGrams = useMemo(() => {
    // 同时保留空格分隔的 token（英文词）和 2-gram（中文窗口）
    const cleaned = relevanceKeyword.replace(/[()（）\[\]【】,，.。!?！？"'`~#\-_/\\]/g, " ");
    const tokens = cleaned.split(/\s+/).filter((token: string) => token.length >= 2);
    const grams = new Set<string>(tokens);
    for (const token of tokens) {
      if (token.length <= 2) continue;
      for (let i = 0; i < token.length - 1; i += 1) grams.add(token.slice(i, i + 2));
    }
    return Array.from(grams);
  }, [relevanceKeyword]);

  const computeRelevanceScore = useCallback((row: any) => {
    if (relevanceGrams.length === 0) return 1; // 没关键词则默认全相关
    const titlePool = [row?.title, row?.titleZh, row?.titleEn, row?.originalTitle, row?.snapshot?.title, row?.snapshot?.titleZh, row?.snapshot?.titleEn]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!titlePool) return 0;
    let hit = 0;
    for (const gram of relevanceGrams) {
      if (titlePool.includes(gram.toLowerCase())) hit += 1;
    }
    return hit / relevanceGrams.length;
  }, [relevanceGrams]);

  const searchRows = useMemo(() => {
    return rawSearchRows.map((row: any) => ({
      ...row,
      relevanceScore: computeRelevanceScore(row),
    }));
  }, [rawSearchRows, computeRelevanceScore]);

  const filteredSearchRows = useMemo(() => {
    if (!onlyRelevantSamples || relevanceGrams.length === 0) return searchRows;
    // 至少命中 30% 的 2-gram 才算相关，留底：只要命中数 >= 2 也放行
    const threshold = 0.3;
    return searchRows.filter((row: any) => row.relevanceScore >= threshold || row.relevanceScore * relevanceGrams.length >= 2);
  }, [searchRows, onlyRelevantSamples, relevanceGrams.length]);

  const sortedSearchRows = useMemo(() => {
    // 未显式排序时按相关度降序，比原来"按 yunqi 默认顺序"实用得多
    if (!searchTableSort.columnKey || !searchTableSort.order) {
      return [...filteredSearchRows].sort((left: any, right: any) =>
        (right?.relevanceScore || 0) - (left?.relevanceScore || 0),
      );
    }
    const originalIndex = new Map(
      filteredSearchRows.map((record: any, index: number) => [getSearchRowKey(record, String(index)), index]),
    );
    const direction = searchTableSort.order === "ascend" ? 1 : -1;

    return [...filteredSearchRows].sort((left: any, right: any) => {
      let diff = 0;
      if (searchTableSort.columnKey === "price") {
        diff = toSafeNumber(left?.price) - toSafeNumber(right?.price);
      } else if (searchTableSort.columnKey === "dailySales") {
        diff = toSafeNumber(left?.dailySales) - toSafeNumber(right?.dailySales);
      } else if (searchTableSort.columnKey === "ratingReview") {
        diff = toSafeNumber(left?.score) - toSafeNumber(right?.score);
        if (diff === 0) {
          diff = getSearchResultReviewCount(left) - getSearchResultReviewCount(right);
        }
      }

      if (diff !== 0) {
        return diff * direction;
      }

      return (originalIndex.get(getSearchRowKey(left)) ?? 0) - (originalIndex.get(getSearchRowKey(right)) ?? 0);
    });
  }, [filteredSearchRows, searchTableSort]);

  const workspaceSnapshotCache = useMemo(() => {
    if (!selectedMy) return [] as ProductWorkspaceSnapshotCache[];
    return workspaces[selectedMy]?.selectedSampleSnapshots ?? [];
  }, [selectedMy, workspaces]);

  const selectedSampleRows = useMemo(() => {
    const trackedByUrl = new Map(tracked.map((item) => [item.url, item]));
    // P1.3：tracked store 没来得及加载 / 被清空时，fallback 到 workspace 冗余的 snapshot
    const merged: TrackedProduct[] = selectedUrls.map((url) => {
      const hit = trackedByUrl.get(url);
      if (hit && hit.snapshots && hit.snapshots.length > 0) return hit;
      const cached = workspaceSnapshotCache.find((item) => item.url === url);
      if (cached && cached.snapshot) {
        return {
          url,
          title: cached.title,
          sourceKeyword: cached.sourceKeyword,
          goodsId: cached.goodsId,
          addedAt: cached.addedAt || cached.updatedAt,
          snapshots: [cached.snapshot],
        };
      }
      return null as unknown as TrackedProduct;
    }).filter(Boolean) as TrackedProduct[];

    const peerSnapshots = merged.map((item) => getLatestSnapshot(item)).filter(Boolean);
    return merged.map((item) => {
      const latest = getLatestSnapshot(item);
      return {
        ...item,
        latest,
        signal: latest ? buildTrackedSignals(latest, peerSnapshots, selectedProduct || undefined) : null,
      };
    }).filter((item) => item.latest).sort((left, right) => {
      const priorityOrder = { P0: 0, P1: 1, P2: 2 };
      const priorityDiff = priorityOrder[left.signal?.priority || "P2"] - priorityOrder[right.signal?.priority || "P2"];
      if (priorityDiff !== 0) return priorityDiff;
      return toSafeNumber(right.latest?.monthlySales) - toSafeNumber(left.latest?.monthlySales);
    });
  }, [selectedProduct, selectedUrls, tracked, workspaceSnapshotCache]);

  const selectedSnapshots = useMemo(() => selectedSampleRows.map((item) => item.latest).filter(Boolean), [selectedSampleRows]);

  const marketInsight = useMemo<MarketInsight | null>(() => {
    if (resultSnapshots.length > 0) return buildMarketInsight(results?.keyword || keyword.trim(), resultSnapshots, wareHouseType);
    if (selectedSnapshots.length > 0) return buildMarketInsight(keyword.trim() || selectedProduct?.title || "当前商品", selectedSnapshots, wareHouseType);
    return null;
  }, [keyword, results, resultSnapshots, selectedProduct, selectedSnapshots, wareHouseType]);

  // 用云启数据覆盖本地商品数据，确保对比分析使用最新的价格/销量/评分
  const analysisMyProduct = useMemo(() => {
    if (!selectedProduct) return null;
    if (!selectedYunqiDisplay) return selectedProduct;
    return {
      ...selectedProduct,
      title: selectedYunqiDisplay.title || selectedProduct.title,
      price: selectedYunqiDisplay.price || selectedProduct.price,
      dailySales: selectedYunqiDisplay.dailySales || selectedProduct.dailySales,
      monthlySales: selectedYunqiDisplay.monthlySales || selectedProduct.monthlySales,
      score: selectedYunqiDisplay.score || selectedProduct.score,
      reviewCount: selectedYunqiDisplay.reviewCount || selectedProduct.reviewCount,
      hasVideo: selectedYunqiDisplay.hasVideo || selectedProduct.hasVideo,
    };
  }, [selectedProduct, selectedYunqiDisplay]);

  const analysis = useMemo<ExecutionReport | null>(() => {
    if (!analysisMyProduct || !marketInsight || selectedSnapshots.length === 0) return null;
    return buildExecutionReport(analysisMyProduct, selectedSnapshots, marketInsight);
  }, [analysisMyProduct, marketInsight, selectedSnapshots]);
  const diagnosisReferenceTags = useMemo(() => {
    const rows = selectedSampleRows.length > 0 ? selectedSampleRows : searchRows.slice(0, 5);
    return dedupeStrings(
      rows.flatMap((row: any) => (Array.isArray(row?.signal?.tags) ? row.signal.tags : []))
        .map((tag: unknown) => String(tag || "").trim())
        .filter(Boolean),
    ).slice(0, 4);
  }, [searchRows, selectedSampleRows]);
  const titleDiagnosis = useMemo(() => {
    return buildTitleDiagnosis({
      title: firstTextValue(selectedYunqiDisplay?.title, selectedProduct?.title),
      category: firstTextValue(selectedProductMeta?.category, selectedProduct?.category),
      keyword,
      suggestedKeywords,
      marketInsight,
    });
  }, [keyword, marketInsight, selectedProduct, selectedProductMeta?.category, selectedYunqiDisplay?.title, suggestedKeywords]);
  const imageDiagnosis = useMemo(() => {
    return buildMainImageDiagnosis({
      hasImage: Boolean(firstTextValue(selectedYunqiDisplay?.imageUrl, selectedProductMeta?.imageUrl)),
      hasVideo: Boolean(selectedYunqiDisplay?.hasVideo),
      marketInsight,
      referenceTags: diagnosisReferenceTags,
    });
  }, [diagnosisReferenceTags, marketInsight, selectedProductMeta?.imageUrl, selectedYunqiDisplay?.hasVideo, selectedYunqiDisplay?.imageUrl]);

  // 主图视觉对比：步骤 4 自动触发，基于已加入对比的链接（selectedSampleRows）
  const [visionLoading, setVisionLoading] = useState(false);
  const [visionResult, setVisionResult] = useState<Awaited<ReturnType<NonNullable<typeof window.electronAPI>["competitor"]["visionCompare"]>> | null>(null);
  const [visionError, setVisionError] = useState<string | null>(null);
  // 记录上次分析的输入指纹，避免 selectedSampleRows 对象引用变化时反复触发
  const visionFingerprintRef = useRef<string>("");

  const visionAutoRefreshedRef = useRef(false);

  const runVisionCompare = useCallback(async () => {
    const myImageUrl = firstTextValue(selectedYunqiDisplay?.imageUrl, selectedProductMeta?.imageUrl);
    const buildCompetitorEntries = () => selectedSampleRows
      .slice(0, 3)
      .map((row) => {
        const latest = row.latest as any;
        const url = firstTextValue(latest?.imageUrl, latest?.imageUrls?.[0]);
        if (!url) return null;
        return {
          url,
          title: latest?.titleZh || latest?.title || row.title || "竞品",
          priceText: latest?.priceText || "",
          monthlySales: toSafeNumber(latest?.monthlySales),
        };
      })
      .filter(Boolean) as Array<{ url: string; title: string; priceText: string; monthlySales: number }>;

    let competitorImageEntries = buildCompetitorEntries();

    if (!myImageUrl && competitorImageEntries.length === 0) {
      return; // 步骤 4 自动触发时静默跳过，等用户补齐数据
    }

    setVisionLoading(true);
    setVisionError(null);

    const doVisionCompare = async (entries: typeof competitorImageEntries) => {
      const result = await window.electronAPI?.competitor?.visionCompare({
        myImage: myImageUrl ? { url: myImageUrl, title: selectedYunqiDisplay?.title || selectedProduct?.title || "我的主图" } : null,
        competitorImages: entries,
        context: {
          keyword: results?.keyword || keyword.trim(),
          primaryNeed: marketInsight?.primaryNeed,
          videoRate: marketInsight?.videoRate,
          category: selectedProductMeta?.category || selectedProduct?.category || "",
        },
      });
      if (!result) throw new Error("AI 返回为空");
      return result;
    };

    try {
      const result = await doVisionCompare(competitorImageEntries);
      // 部分图片 403（未全挂所以后端没 throw）——自动刷新一次获取新签名 URL 后重试
      const partialOssErrors = Array.isArray(result?.imageErrors)
        ? result.imageErrors.filter((e: any) => /403|Forbidden|Expires/i.test(e.error || ""))
        : [];
      if (partialOssErrors.length > 0 && !visionAutoRefreshedRef.current && competitor && selectedUrls.length > 0) {
        visionAutoRefreshedRef.current = true;
        try {
          const response = await withRetry(() => competitor.batchTrack({ urls: selectedUrls }), { label: "vision-partial-refresh" });
          const existingTracked = await readArrayStoreValue("temu_competitor_tracked");
          const updated = (existingTracked as TrackedProduct[]).map((item) => {
            if (!selectedUrls.includes(item.url)) return item;
            const next = response.results.find((r: any) => r.url === item.url);
            if (next && !next.error) return { ...item, title: next.title || item.title, snapshots: [...item.snapshots, next].slice(-30) };
            return item;
          });
          setTracked(updated);
          await setStoreValueForActiveAccount(store, "temu_competitor_tracked", updated);
          window.dispatchEvent(new CustomEvent(COMPETITOR_TRACKED_UPDATED_EVENT));
          const trackedByUrl = new Map(updated.map((item) => [item.url, item]));
          const freshEntries = selectedUrls.slice(0, 3).map((url) => {
            const item = trackedByUrl.get(url);
            const latest = item?.snapshots?.[item.snapshots.length - 1] as any;
            const imgUrl = firstTextValue(latest?.imageUrl, latest?.imageUrls?.[0]);
            if (!imgUrl) return null;
            return { url: imgUrl, title: latest?.titleZh || latest?.title || "竞品", priceText: latest?.priceText || "", monthlySales: toSafeNumber(latest?.monthlySales) };
          }).filter(Boolean) as typeof competitorImageEntries;
          if (freshEntries.length > 0) {
            const retryResult = await doVisionCompare(freshEntries);
            setVisionResult(retryResult);
            visionAutoRefreshedRef.current = false;
            setVisionLoading(false);
            return;
          }
        } catch (refreshErr) {
          console.warn("[vision-compare] partial-refresh failed:", refreshErr);
        }
      }
      setVisionResult(result);
      visionAutoRefreshedRef.current = false;
    } catch (error) {
      const errMsg = getErrorMessage(error);
      // OSS 签名过期（403）：自动刷新样本获取新图片 URL，然后重试一次
      const isOssExpired = /403|OSS.*签名.*过期|Forbidden/i.test(errMsg);
      if (isOssExpired && !visionAutoRefreshedRef.current && competitor && selectedUrls.length > 0) {
        visionAutoRefreshedRef.current = true;
        try {
          const response = await withRetry(
            () => competitor.batchTrack({ urls: selectedUrls }),
            { label: "vision-auto-refresh" },
          );
          // 把新快照写入 tracked store
          const existingTracked = await readArrayStoreValue("temu_competitor_tracked");
          const updated = (existingTracked as TrackedProduct[]).map((item) => {
            if (!selectedUrls.includes(item.url)) return item;
            const next = response.results.find((r: any) => r.url === item.url);
            if (next && !next.error) {
              return { ...item, title: next.title || item.title, snapshots: [...item.snapshots, next].slice(-30) };
            }
            return item;
          });
          setTracked(updated);
          await setStoreValueForActiveAccount(store, "temu_competitor_tracked", updated);
          window.dispatchEvent(new CustomEvent(COMPETITOR_TRACKED_UPDATED_EVENT));
          // 用刷新后的 sampleRows 构建新的图片入参（此处 selectedSampleRows 还没更新，从 updated 里取）
          const trackedByUrl = new Map(updated.map((item) => [item.url, item]));
          const freshEntries = selectedUrls.slice(0, 3).map((url) => {
            const item = trackedByUrl.get(url);
            const latest = item?.snapshots?.[item.snapshots.length - 1] as any;
            const imgUrl = firstTextValue(latest?.imageUrl, latest?.imageUrls?.[0]);
            if (!imgUrl) return null;
            return { url: imgUrl, title: latest?.titleZh || latest?.title || "竞品", priceText: latest?.priceText || "", monthlySales: toSafeNumber(latest?.monthlySales) };
          }).filter(Boolean) as typeof competitorImageEntries;

          if (freshEntries.length > 0) {
            const retryResult = await doVisionCompare(freshEntries);
            setVisionResult(retryResult);
            setVisionError(null);
            setVisionLoading(false);
            return;
          }
        } catch (refreshErr) {
          console.warn("[vision-compare] auto-refresh failed:", refreshErr);
        }
      }
      setVisionError(stripWorkerErrorCode(errMsg));
      setVisionResult(null);
    } finally {
      setVisionLoading(false);
    }
  }, [competitor, keyword, marketInsight, results?.keyword, selectedProduct, selectedProductMeta, selectedSampleRows, selectedUrls, selectedYunqiDisplay, store]);

  // 步骤 4 自动触发主图视觉对比；只有输入指纹变化时才重跑
  useEffect(() => {
    if (activeStep !== 3) return;
    const myImageUrl = firstTextValue(selectedYunqiDisplay?.imageUrl, selectedProductMeta?.imageUrl) || "";
    const competitorUrls = selectedSampleRows
      .slice(0, 3)
      .map((row) => {
        const latest = row.latest as any;
        return firstTextValue(latest?.imageUrl, latest?.imageUrls?.[0]) || "";
      })
      .filter(Boolean);
    if (!myImageUrl && competitorUrls.length === 0) return;
    const fingerprint = [myImageUrl, ...competitorUrls].join("|");
    if (fingerprint === visionFingerprintRef.current) return;
    if (visionLoading) return;
    visionFingerprintRef.current = fingerprint;
    void runVisionCompare();
  }, [activeStep, selectedSampleRows, selectedYunqiDisplay?.imageUrl, selectedProductMeta?.imageUrl, visionLoading, runVisionCompare]);

  const productDataCompareSections = useMemo(() => {
    if (!selectedProduct || !analysis) return [];

    const myPrice = toSafeNumber(selectedYunqiDisplay?.price || selectedProduct.price);
    const myDailySales = toSafeNumber(selectedYunqiDisplay?.dailySales || selectedProduct.dailySales);
    const myScore = toSafeNumber(selectedYunqiDisplay?.score || selectedProduct.score);
    const myReviewCount = toSafeNumber(selectedYunqiDisplay?.reviewCount || selectedProduct.reviewCount);
    const myHasVideo = Boolean(selectedYunqiDisplay?.hasVideo || selectedProduct.hasVideo);

    const samplePrices = analysis.comparisonRows
      .map((row) => Number(String(row.currentPrice || "").replace(/[^\d.]/g, "")))
      .filter((value) => Number.isFinite(value) && value > 0);
    const sampleDailySales = analysis.comparisonRows
      .map((row) => toSafeNumber(row.dailySales))
      .filter((value) => value > 0);
    const sampleScores = analysis.comparisonRows
      .map((row) => toSafeNumber(row.score))
      .filter((value) => value > 0);
    const sampleReviewCounts = analysis.comparisonRows
      .map((row) => toSafeNumber(row.reviewCount))
      .filter((value) => value > 0);
    const sampleVideoRate = analysis.comparisonRows.length > 0
      ? analysis.comparisonRows.filter((row) => row.hasVideo).length / analysis.comparisonRows.length
      : 0;

    const averageSamplePrice = average(samplePrices);
    const averageSampleDailySales = average(sampleDailySales);
    const averageSampleScore = average(sampleScores);
    const averageSampleReviewCount = average(sampleReviewCounts);

    const priceText = (() => {
      if (!myPrice || !averageSamplePrice) return "当前价格数据还不完整，先继续补齐样本后再判断价格带。";
      const diff = ((myPrice - averageSamplePrice) / Math.max(averageSamplePrice, 0.01)) * 100;
      if (diff >= 8) {
        return `当前定价 $${myPrice.toFixed(2)}，高于对比样本均价 $${averageSamplePrice.toFixed(2)} 约 ${Math.abs(diff).toFixed(0)}%，如果继续打这个词，优先往 ${marketInsight?.recommendedPriceBand || "建议价格带"} 回调。`;
      }
      if (diff <= -8) {
        return `当前定价 $${myPrice.toFixed(2)}，低于对比样本均价 $${averageSamplePrice.toFixed(2)} 约 ${Math.abs(diff).toFixed(0)}%，可以保留价格优势，重点补主图和转化承接。`;
      }
      return `当前定价 $${myPrice.toFixed(2)}，基本贴近对比样本均价 $${averageSamplePrice.toFixed(2)}，价格不是第一优先矛盾。`;
    })();

    const salesText = (() => {
      if (!averageSampleDailySales) return "当前还没有足够的样本销量数据，先继续补样本。";
      if (myDailySales <= 0) {
        return `对比样本日销均值约 ${averageSampleDailySales.toFixed(0)}，你当前几乎没有稳定日销，优先先解决点击和转化承接。`;
      }
      const diff = ((myDailySales - averageSampleDailySales) / Math.max(averageSampleDailySales, 1)) * 100;
      if (diff >= 15) {
        return `当前日销 ${myDailySales.toFixed(0)}，高于样本均值 ${averageSampleDailySales.toFixed(0)}，可以继续放大有效关键词。`;
      }
      if (diff <= -15) {
        return `当前日销 ${myDailySales.toFixed(0)}，低于样本均值 ${averageSampleDailySales.toFixed(0)}，说明这轮样本里你还没吃到同等成交能力。`;
      }
      return `当前日销 ${myDailySales.toFixed(0)}，和样本均值 ${averageSampleDailySales.toFixed(0)} 接近，重点看流量结构和素材承接。`;
    })();

    const reputationText = (() => {
      const marketReviewGate = toSafeNumber(marketInsight?.medianReviewCount);
      if (myReviewCount <= 0 && myScore <= 0) {
        return marketReviewGate > 0
          ? `当前评分和评论基础偏弱，市场中位评论门槛约 ${marketReviewGate}，先补评价与信任背书。`
          : "当前评分和评论基础偏弱，先补信任背书后再放量。";
      }
      const scorePart = myScore > 0 && averageSampleScore > 0
        ? `当前评分 ${myScore.toFixed(1)}，样本均值 ${averageSampleScore.toFixed(1)}`
        : `当前评论量 ${myReviewCount.toFixed(0)}`;
      const reviewPart = averageSampleReviewCount > 0
        ? `，样本均值评论约 ${averageSampleReviewCount.toFixed(0)}`
        : "";
      return `${scorePart}${reviewPart}。${myReviewCount < marketReviewGate ? "当前信任门槛仍偏低，优先补评价和详情页信任感。" : "当前口碑基础还能打，继续把点击和转化承接做扎实。"}`;
    })();

    const materialText = myHasVideo
      ? `当前商品已经有视频，对比样本视频覆盖约 ${Math.round(sampleVideoRate * 100)}%，下一步优先优化首图和前 3 张卖点图。`
      : sampleVideoRate >= 0.5
        ? `对比样本里约 ${Math.round(sampleVideoRate * 100)}% 都有视频，当前素材短板很明确，优先补 1 条功能演示视频。`
        : `对比样本视频覆盖约 ${Math.round(sampleVideoRate * 100)}%，当前还能先靠首图和标题承接，但视频仍建议排上。`;

    return [
      { title: "价格对比", value: priceText },
      { title: "销量对比", value: salesText },
      { title: "口碑对比", value: reputationText },
      { title: "素材对比", value: materialText },
    ];
  }, [analysis, marketInsight, selectedProduct, selectedYunqiDisplay]);
  // 汇聚所有可见的英文标题并批量翻译
  useEffect(() => {
    if (!titleTranslateHydratedRef.current) return;
    const pool: string[] = [];
    resultSnapshots.forEach((s: any) => pool.push(s?.title, s?.titleEn, s?.originalTitle));
    (analysis?.comparisonRows || []).forEach((row) => pool.push(row.competitorTitle));
    if (selectedProduct) pool.push(selectedProduct.title, (selectedProduct as any).titleEn);
    requestTitleTranslations(pool);
  }, [resultSnapshots, analysis?.comparisonRows, selectedProduct, requestTitleTranslations]);
  const reviewTrustSections = useMemo(() => {
    if (!marketInsight) return [];

    const myScore = toSafeNumber(selectedYunqiDisplay?.score || selectedProduct?.score);
    const myReviewCount = toSafeNumber(selectedYunqiDisplay?.reviewCount || selectedProduct?.reviewCount);
    const marketReviewGate = toSafeNumber(marketInsight.medianReviewCount);
    const clickPayRate = toSafeNumber(activeTrafficSite?.summary?.clickPayRate);

    const trustBase = myReviewCount > 0 || myScore > 0
      ? `当前评分 ${myScore > 0 ? myScore.toFixed(1) : "-"}，评论约 ${myReviewCount.toFixed(0)}。`
      : "当前评分与评论基础偏弱。";
    const marketGate = marketReviewGate > 0
      ? `当前词的评论中位门槛约 ${marketReviewGate.toFixed(0)}，市场更吃信任感。`
      : "当前词的评论门槛还不算高，但详情页信任承接仍然重要。";
    const conversionTrust = clickPayRate > 0.05
      ? `当前点击支付转化率约 ${(clickPayRate * 100).toFixed(1)}%，这波流量是有成交能力的，重点继续补评价和详情页背书。`
      : "当前支付转化偏弱，先补评价、详情页信任要素和规格说明。";
    const nextMove = myReviewCount < marketReviewGate
      ? "优先补评价数量、评价摘要和详情页信任要素。"
      : "当前评价门槛不算吃亏，重点先把首图点击和价格带承接做好。";

    return [
      { title: "当前评价基础", value: trustBase },
      { title: "市场信任门槛", value: marketGate },
      { title: "转化承接判断", value: conversionTrust },
      { title: "优先补强动作", value: nextMove },
    ];
  }, [activeTrafficSite, marketInsight, selectedProduct?.reviewCount, selectedProduct?.score, selectedYunqiDisplay?.reviewCount, selectedYunqiDisplay?.score]);
  const fulfillmentSections = useMemo(() => {
    if (!marketInsight) return [];

    const warehouseLabel = getWareHouseTypeLabel(selectedYunqiDetail?.wareHouseType) || "当前还没有识别到明确履约模式";
    const bundleLikeCount = analysis?.comparisonRows.filter((row) => String(row.tags || "").includes("套装/赠品拉单型")).length || 0;
    const videoLikeCount = analysis?.comparisonRows.filter((row) => row.hasVideo).length || 0;

    return [
      { title: "当前履约模式", value: warehouseLabel },
      { title: "市场履约判断", value: marketInsight.warehouseInsight },
      {
        title: "套装 / 变体机会",
        value: bundleLikeCount > 0
          ? `当前样本里有 ${bundleLikeCount} 个在用套装或赠品拉单，说明这个词可以考虑用组合装、赠品和变体规格去做差异化。`
          : "当前样本里套装打法不多，先把单品价格带和主图承接打顺，再考虑扩组合装。",
      },
      {
        title: "扩款方向",
        value: analysis?.summary.nextProductDirection
          || (videoLikeCount > 0 ? "优先扩有明显功能演示空间、能配视频承接的 SKU。" : marketInsight.nextAction),
      },
    ];
  }, [analysis, marketInsight, selectedYunqiDetail?.wareHouseType]);

  useEffect(() => {
    if (!selectedProduct) {
      if (activeStep !== 0) setActiveStep(0);
      return;
    }
    if (activeStep === 3 && selectedSampleRows.length === 0) {
      setActiveStep(searchRows.length > 0 ? 2 : 1);
      return;
    }
    if (activeStep === 2 && searchRows.length === 0) {
      setActiveStep(1);
    }
  }, [activeStep, searchRows.length, selectedProduct, selectedSampleRows.length]);

  const priceDistribution = useMemo(() => {
    const prices = resultSnapshots.map((product: any) => toSafeNumber(product.price)).filter((price: number) => price > 0);
    if (prices.length === 0) return [];
    const min = Math.floor(Math.min(...prices));
    const max = Math.ceil(Math.max(...prices));
    const range = Math.max(1, max - min);
    const bucketSize = Math.max(1, Math.ceil(range / 8));
    const buckets: Record<string, number> = {};
    prices.forEach((price: number) => {
      const start = Math.floor((price - min) / bucketSize) * bucketSize + min;
      const label = `$${start}-${start + bucketSize}`;
      buckets[label] = (buckets[label] || 0) + 1;
    });
    return Object.entries(buckets).map(([range, count]) => ({ range, count }));
  }, [resultSnapshots]);

  const avgPrice = average(resultSnapshots.map((item: any) => toSafeNumber(item.price)).filter((price: number) => price > 0));
  const priceBandStatus = marketInsight && selectedProduct ? getMyPriceBandStatus(selectedProduct.price, marketInsight.recommendedPriceBand) : "先给当前商品拉一轮可比样本。";
  const materialStatus = marketInsight && selectedProduct
    ? selectedProduct.hasVideo
      ? "当前商品已有视频，可以优先验证首图和卖点排序。"
      : marketInsight.videoRate >= 0.5
        ? "当前市场视频门槛偏高，先补 1 条功能演示视频。"
        : "当前市场视频门槛一般，可以先用价格和首图承接。"
    : "补齐市场样本后，再判断素材优先级。";

  const handleRequestError = useCallback((error: unknown, fallbackMessage: string) => {
    if (isYunqiAuthInvalidError(error)) {
      onYunqiAuthInvalid?.(error);
      return;
    }
    const nextMessage = stripWorkerErrorCode(getErrorMessage(error)) || fallbackMessage;
    message.error(nextMessage);
    // 网络 / 接口层非鉴权失败：落入"看本地缓存"降级提示
    if (!isUnsupportedCompetitorTrackError(error)) {
      setDegradedReason(nextMessage);
    }
  }, [onYunqiAuthInvalid]);

  const handleRetryToast = useCallback((label: string) => (error: unknown, attempt: number) => {
    const reason = stripWorkerErrorCode(getErrorMessage(error)) || "网络不稳定";
    message.warning(`${label} 正在重试 (${attempt})：${reason}`);
  }, []);

  const scrollToSamples = useCallback(() => {
    sampleCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleSearch = async () => {
    if (!selectedMy || !selectedProduct) return message.warning("请先选择你的商品");
    if (!keyword.trim()) return message.warning("请输入当前商品要打的关键词");
    if (!competitor) return message.error("当前竞品分析功能暂时不可用，请稍后再试");
    setLoading(true);
    onYunqiRequestStart?.();
    try {
      const response = await withRetry(() => competitor.search({
        keyword: keyword.trim(),
        maxResults: 50,
        wareHouseType,
        sortField: DEFAULT_SORT_FIELD,
        sortOrder: DEFAULT_SORT_ORDER,
      } as any), { onRetry: handleRetryToast("搜索"), label: "search" });
      onYunqiRequestSuccess?.();
      setDegradedReason("");
      setResults(response);
      setSelectedResultKeys([]);
      setSearchTableSort({ columnKey: "", order: null });
      setActiveStep(2);
      await persistWorkspace(selectedMy, { keyword: keyword.trim(), wareHouseType });
      message.success(`已为“${selectedProduct.title}”找到 ${response.totalFound} 个搜索样本`);
    } catch (error) {
      handleRequestError(error, "搜索失败");
    } finally {
      onYunqiRequestFinish?.();
      setLoading(false);
    }
  };

  const handleAddSamples = async (items: any[]) => {
    if (!selectedMy || !selectedProduct) return message.warning("请先选择你的商品");
    if (!competitor) return message.error("当前竞品分析功能暂时不可用，请稍后再试");
    const validItems = items.filter((item) => item?.productUrl);
    if (validItems.length === 0) return message.warning("请选择可加入对比的商品");

    const urls = dedupeStrings(validItems.map((item) => item.productUrl));
    setTrackingKeys(validItems.map((item) => String(item.goodsId || item.productUrl)));
    onYunqiRequestStart?.();
    try {
      const existingTracked = await readArrayStoreValue("temu_competitor_tracked");
      const batch = await withRetry(() => competitor.batchTrack({ urls }), { onRetry: handleRetryToast("加入对比"), label: "batchTrack" });
      onYunqiRequestSuccess?.();
      setDegradedReason("");
      const lookup = new Map(validItems.map((item) => [item.productUrl, item]));
      const additions: TrackedProduct[] = urls.map((url) => {
        const matched = batch.results.find((result: any) => result.url === url);
        const base = lookup.get(url);
        const snapshot = matched && !matched.error ? { ...buildFallbackSnapshotFromSearch(base), ...matched } : buildFallbackSnapshotFromSearch(base);
        return {
          url,
          goodsId: base?.goodsId ? String(base.goodsId) : undefined,
          sourceKeyword: keyword.trim() || results?.keyword || undefined,
          title: snapshot.title || base?.title || url,
          snapshots: [snapshot],
          addedAt: new Date().toISOString(),
        };
      });
      const merged = mergeTrackedProducts(existingTracked as TrackedProduct[], additions);
      setTracked(merged);
      await setStoreValueForActiveAccount(store, "temu_competitor_tracked", merged);
      await persistWorkspace(selectedMy, { keyword: keyword.trim(), wareHouseType, selectedUrls: dedupeStrings([...selectedUrls, ...urls]) });
      window.dispatchEvent(new CustomEvent(COMPETITOR_TRACKED_UPDATED_EVENT));
      message.success(`已加入“${selectedProduct.title}”的对比样本：${urls.length} 个`);
    } catch (error) {
      handleRequestError(error, "加入对比样本失败");
    } finally {
      onYunqiRequestFinish?.();
      setTrackingKeys([]);
    }
  };

  // 云启参考信息「无匹配」自救 · 用标题搜一次，列出候选
  const handleYunqiRescueSearch = async () => {
    if (!selectedProduct) return message.warning("请先选择你的商品");
    if (!competitor) return message.error("当前竞品分析功能暂时不可用，请稍后再试");
    const title = String(selectedProduct.title || "").trim();
    if (!title) return message.warning("当前商品没有标题，无法自动搜索");
    setYunqiRescueLoading(true);
    onYunqiRequestStart?.();
    try {
      const resp = await withRetry(
        () => competitor.search({
          keyword: title.slice(0, 60),
          maxResults: 5,
          wareHouseType,
          sortField: DEFAULT_SORT_FIELD,
          sortOrder: DEFAULT_SORT_ORDER,
        } as any),
        { onRetry: handleRetryToast("候选搜索"), label: "yunqi-rescue-search" },
      );
      onYunqiRequestSuccess?.();
      setDegradedReason("");
      const list = Array.isArray(resp?.products) ? resp.products.slice(0, 5) : [];
      setYunqiRescueCandidates(list);
      if (list.length === 0) message.warning("云启按标题没有搜到候选，可以手动贴链接。");
    } catch (error) {
      handleRequestError(error, "候选搜索失败");
    } finally {
      onYunqiRequestFinish?.();
      setYunqiRescueLoading(false);
    }
  };

  // 应用某个候选 / 手动链接：track 一次，结果写回 yunqiProductDetails，让详情卡片直接亮
  const applyYunqiRescueCandidate = async (url: string) => {
    if (!url || !/temu\.com/i.test(url)) return message.warning("请输入有效的 Temu 商品链接");
    if (!competitor) return message.error("当前竞品分析功能暂时不可用，请稍后再试");
    if (!selectedGoodsId) return message.warning("当前商品缺少 goodsId，无法绑定云启详情");
    setYunqiRescueLoading(true);
    onYunqiRequestStart?.();
    try {
      const detail: any = await withRetry(
        () => competitor.track({ url }),
        { onRetry: handleRetryToast("绑定云启"), label: "yunqi-rescue-track" },
      );
      onYunqiRequestSuccess?.();
      setDegradedReason("");
      if (!detail || detail?.matchStatus === "not_matched") {
        message.warning("这个候选暂时也拿不到匹配详情，换一个再试。");
        return;
      }
      // 覆盖 goodsId 保证 isSelectedYunqiExactMatch 命中
      const patched = { ...detail, goodsId: selectedGoodsId };
      setYunqiProductDetails((current) => ({ ...current, [selectedGoodsId]: patched }));
      setYunqiRescueCandidates([]);
      setYunqiRescueUrl("");
      message.success("已把云启详情绑定到当前商品");
    } catch (error) {
      handleRequestError(error, "绑定云启详情失败");
    } finally {
      onYunqiRequestFinish?.();
      setYunqiRescueLoading(false);
    }
  };

  const handleManualAdd = async () => {
    if (!selectedMy || !selectedProduct) return message.warning("请先选择你的商品");
    const url = manualUrl.trim();
    if (!url) return message.warning("请输入 Temu 商品链接");
    if (!/temu\.com/i.test(url)) return message.warning("请输入有效的 Temu 商品链接");
    if (!competitor) return message.error("当前竞品分析功能暂时不可用，请稍后再试");

    setAddingManual(true);
    try {
      const existingTracked = await readArrayStoreValue("temu_competitor_tracked");
      const existingItem = (existingTracked as TrackedProduct[]).find((item) => item.url === url);
      if (!existingItem) {
        onYunqiRequestStart?.();
        const snapshot = await withRetry(() => competitor.track({ url }), { onRetry: handleRetryToast("手动加入"), label: "track" });
        onYunqiRequestSuccess?.();
        setDegradedReason("");
        const merged = mergeTrackedProducts(existingTracked as TrackedProduct[], [{
          url,
          title: snapshot.title,
          sourceKeyword: keyword.trim() || undefined,
          snapshots: [snapshot],
          addedAt: new Date().toISOString(),
        }]);
        setTracked(merged);
        await setStoreValueForActiveAccount(store, "temu_competitor_tracked", merged);
        window.dispatchEvent(new CustomEvent(COMPETITOR_TRACKED_UPDATED_EVENT));
      }
      await persistWorkspace(selectedMy, { keyword: keyword.trim(), wareHouseType, selectedUrls: dedupeStrings([...selectedUrls, url]) });
      setManualUrl("");
      message.success("手动链接已加入当前商品对比");
    } catch (error) {
      handleRequestError(error, "手动添加失败");
    } finally {
      onYunqiRequestFinish?.();
      setAddingManual(false);
    }
  };

  const handleRefreshSelected = async () => {
    if (selectedUrls.length === 0) return;
    if (!competitor) return message.error("当前竞品分析功能暂时不可用，请稍后再试");
    setRefreshingSamples(true);
    onYunqiRequestStart?.();
    try {
      const response = await withRetry(() => competitor.batchTrack({ urls: selectedUrls }), { onRetry: handleRetryToast("刷新样本"), label: "refreshSamples" });
      onYunqiRequestSuccess?.();
      setDegradedReason("");
      const existingTracked = await readArrayStoreValue("temu_competitor_tracked");
      const updated = (existingTracked as TrackedProduct[]).map((item) => {
        if (!selectedUrls.includes(item.url)) return item;
        const nextSnapshot = response.results.find((result: any) => result.url === item.url);
        if (nextSnapshot && !nextSnapshot.error) {
          return {
            ...item,
            title: nextSnapshot.title || item.title,
            snapshots: [...item.snapshots, nextSnapshot].slice(-30),
          };
        }
        return item;
      });
      setTracked(updated);
      await setStoreValueForActiveAccount(store, "temu_competitor_tracked", updated);
      window.dispatchEvent(new CustomEvent(COMPETITOR_TRACKED_UPDATED_EVENT));
      message.success(`已刷新当前商品样本：${response.success}/${response.total}`);
    } catch (error) {
      handleRequestError(error, "刷新样本失败");
    } finally {
      onYunqiRequestFinish?.();
      setRefreshingSamples(false);
    }
  };

  const handleRemoveSample = async (url: string) => {
    if (!selectedMy) return;
    await persistWorkspace(selectedMy, { keyword: keyword.trim(), wareHouseType, selectedUrls: selectedUrls.filter((item) => item !== url) });
    message.success("已移出当前商品对比");
  };

  const handleSearchTableChange = useCallback((_: any, __: any, sorter: any) => {
    const nextSorter = Array.isArray(sorter) ? sorter[0] : sorter;
    const columnKey = typeof nextSorter?.columnKey === "string" ? nextSorter.columnKey : "";
    const order = nextSorter?.order === "ascend" || nextSorter?.order === "descend"
      ? nextSorter.order
      : null;
    if (!order || !["price", "dailySales", "ratingReview"].includes(columnKey)) {
      setSearchTableSort({ columnKey: "", order: null });
      return;
    }
    setSearchTableSort({ columnKey: columnKey as SearchTableSortKey, order });
  }, []);

  const searchColumns = [
    {
      title: "商品",
      dataIndex: "title",
      key: "title",
      width: 360,
      fixed: "left" as const,
      render: (_: string, record: any) => (
        <Space align="start" size={12}>
          <Image
            src={getPrimaryImageUrl(record)}
            alt={record.title}
            width={68}
            height={68}
            style={{ objectFit: "cover", borderRadius: 10, flexShrink: 0 }}
            fallback="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='68' height='68'><rect width='100%' height='100%' fill='%23f5f5f5'/></svg>"
            preview={false}
          />
          <Space direction="vertical" size={2}>
            <Paragraph
              ellipsis={{ rows: 2, tooltip: record.title }}
              style={{ maxWidth: 250, marginBottom: 0, lineHeight: 1.35 }}
            >
              {displayTitle(record.title, record.titleZh)}
            </Paragraph>
            <Space wrap size={[4, 4]}>
              {selectedUrls.includes(record.productUrl) ? <Tag color="green">已加入当前商品</Tag> : null}
              {record.signal?.priority ? <Tag color={record.signal.priority === "P0" ? "red" : record.signal.priority === "P1" ? "orange" : "default"}>{record.signal.priority}</Tag> : null}
              {record.mall ? <Tag>{record.mall}</Tag> : null}
            </Space>
          </Space>
        </Space>
      ),
    },
    {
      title: "价格",
      key: "price",
      width: 120,
      sorter: true,
      sortOrder: searchTableSort.columnKey === "price" ? searchTableSort.order || undefined : undefined,
      render: (_: any, record: any) => <Text strong style={{ color: TEMU_ORANGE }}>{record.priceText || `$${toSafeNumber(record.price).toFixed(2)}`}</Text>,
    },
    {
      title: "日销",
      dataIndex: "dailySales",
      key: "dailySales",
      width: 90,
      sorter: true,
      sortOrder: searchTableSort.columnKey === "dailySales" ? searchTableSort.order || undefined : undefined,
      render: (value: number) => toSafeNumber(value).toLocaleString(),
    },
    {
      title: "评分 / 评论",
      key: "ratingReview",
      width: 120,
      sorter: true,
      sortOrder: searchTableSort.columnKey === "ratingReview" ? searchTableSort.order || undefined : undefined,
      render: (_: any, record: any) => <Text>{toSafeNumber(record.score) || "-"} / {getSearchResultReviewCount(record) || "-"}</Text>,
    },
    {
      title: "标签",
      key: "tags",
      width: 200,
      render: (_: any, record: any) => <Space wrap size={[4, 4]}>{(record.signal?.tags || []).slice(0, 2).map((tag: string) => <Tag key={tag} color="orange">{tag}</Tag>)}</Space>,
    },
    {
      title: "给我的动作",
      key: "responseAction",
      width: 260,
      render: (_: any, record: any) => (
        <Paragraph
          ellipsis={{ rows: 2, tooltip: record.signal?.responseAction }}
          style={{ maxWidth: 230, marginBottom: 0, lineHeight: 1.35 }}
        >
          {record.signal?.responseAction || "-"}
        </Paragraph>
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 150,
      fixed: "right" as const,
      render: (_: any, record: any) => (
        <Space>
          <Button size="small" loading={trackingKeys.includes(String(record.goodsId || record.productUrl))} onClick={() => void handleAddSamples([record])}>加入对比</Button>
          {record.productUrl ? <Button size="small" type="link" icon={<EyeOutlined />} href={record.productUrl} target="_blank">查看</Button> : null}
        </Space>
      ),
    },
  ];

  const sampleColumns = [
    {
      title: "对比样本",
      dataIndex: "title",
      key: "title",
      ellipsis: true,
      render: (_: string, record: any) => (
        <Space align="start" size={8}>
          <Image
            src={getPrimaryImageUrl(record)}
            alt={record.title || record.url}
            width={52}
            height={52}
            style={{ objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
            fallback="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='52' height='52'><rect width='100%' height='100%' fill='%23f5f5f5'/></svg>"
            preview={false}
          />
          <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
            <Tooltip title={record.title || record.url}>
              <Text ellipsis style={{ display: "block", maxWidth: "100%" }}>{displayTitle(record.title, record.titleZh) || record.url}</Text>
            </Tooltip>
            <Space wrap size={[4, 4]}>
              {record.sourceKeyword ? <Tag color="blue" style={{ marginInlineEnd: 0 }}>{record.sourceKeyword}</Tag> : null}
              {record.signal?.priority ? <Tag style={{ marginInlineEnd: 0 }} color={record.signal.priority === "P0" ? "red" : record.signal.priority === "P1" ? "orange" : "default"}>{record.signal.priority}</Tag> : null}
            </Space>
          </Space>
        </Space>
      ),
    },
    {
      title: "价格 / 日销",
      key: "sales",
      width: 96,
      render: (_: any, record: any) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ color: TEMU_ORANGE }}>${toSafeNumber(record.latest?.price).toFixed(2)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>日销 {toSafeNumber(record.latest?.dailySales).toLocaleString()}</Text>
        </Space>
      ),
    },
    {
      title: "标签",
      key: "tags",
      width: 140,
      render: (_: any, record: any) => <Space wrap size={[4, 4]}>{(record.signal?.tags || []).map((tag: string) => <Tag key={tag} color="orange" style={{ marginInlineEnd: 0 }}>{tag}</Tag>)}</Space>,
    },
    {
      title: "操作",
      key: "action",
      width: 72,
      render: (_: any, record: any) => (
        <Space size={4}>
          {record.url ? <Button size="small" type="link" icon={<LinkOutlined />} href={record.url} target="_blank" style={{ padding: 0 }} /> : null}
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void handleRemoveSample(record.url)} />
        </Space>
      ),
    },
  ];

  const comparisonColumns = [
    {
      title: "样本",
      dataIndex: "competitorTitle",
      key: "competitorTitle",
      width: 220,
      ellipsis: true,
      render: (value: string, record: ComparisonRow) => (
        <Space direction="vertical" size={0}>
          <Tooltip title={value}><Text ellipsis style={{ maxWidth: 200 }}>{displayTitle(value)}</Text></Tooltip>
          <Text type="secondary" style={{ fontSize: 13 }}>{record.goodsId || record.competitorUrl || "-"}</Text>
        </Space>
      ),
    },
    { title: "价格", dataIndex: "currentPrice", key: "currentPrice", width: 120 },
    { title: "日销", dataIndex: "dailySales", key: "dailySales", width: 90, render: (value: number) => toSafeNumber(value).toLocaleString() },
    { title: "标签", dataIndex: "tags", key: "tags", width: 180 },
    { title: "我方差距", dataIndex: "gap", key: "gap", width: 190, ellipsis: true, render: (value: string) => <Tooltip title={value}><Text ellipsis style={{ maxWidth: 170 }}>{value}</Text></Tooltip> },
    { title: "优先动作", dataIndex: "responseAction", key: "responseAction", ellipsis: true, render: (value: string) => <Tooltip title={value}><Text ellipsis style={{ maxWidth: 220 }}>{value}</Text></Tooltip> },
    { title: "优先级", dataIndex: "priority", key: "priority", width: 90, render: (value: string) => <Tag color={value === "P0" ? "red" : value === "P1" ? "orange" : "default"}>{value}</Tag> },
  ];
  void comparisonColumns; // 保留给未来比较面板使用

  const hasSearchContext = searchRows.length > 0 || selectedSampleRows.length > 0 || Boolean(analysis);
  const hasSampleContext = selectedSampleRows.length > 0 || Boolean(analysis);

  const stepItems = [
    {
      key: 0,
      title: "选商品",
      desc: "先锁定这次要分析的商品",
      enabled: true,
      completed: Boolean(selectedProduct),
    },
    {
      key: 1,
      title: "商品体检",
      desc: "先看自己的价格、流量、标题和主图",
      enabled: Boolean(selectedProduct),
      completed: hasSearchContext,
    },
    {
      key: 2,
      title: "竞品对比",
      desc: "挑样本看我和对手差在哪",
      enabled: searchRows.length > 0 || selectedSampleRows.length > 0,
      completed: hasSampleContext,
    },
    {
      key: 3,
      title: "优化方向",
      desc: "输出市场盘面、商品体检、对比结论和动作",
      enabled: selectedSampleRows.length > 0,
      completed: Boolean(analysis),
    },
  ];

  const currentStepMeta = stepItems[activeStep] || stepItems[0];
  const nextStepTarget = activeStep < stepItems.length - 1 ? activeStep + 1 : null;
  const canGoNext = nextStepTarget !== null ? stepItems[nextStepTarget].enabled : false;
  const nextStepLabel = nextStepTarget !== null ? `下一步：${stepItems[nextStepTarget].title}` : "";

  useEffect(() => {
    onStepStateChange?.({
      activeStep,
      currentStepMeta,
      stepItems,
      nextStepTarget,
      nextStepLabel,
      canGoNext,
    });
  }, [activeStep, canGoNext, currentStepMeta, nextStepLabel, nextStepTarget, onStepStateChange, stepItems]);

  const renderSelectedProductSummary = (useYunqiData = false) => {
    if (!selectedProduct) return null;
    const display = useYunqiData ? selectedYunqiDisplay : null;
    return (
      <div
        style={{
          display: "flex",
          gap: 18,
          alignItems: "flex-start",
          padding: "8px 0 4px",
        }}
      >
        {(display?.imageUrl || selectedProductMeta?.imageUrl) ? (
          <Image
            src={display?.imageUrl || selectedProductMeta?.imageUrl}
            alt={display?.title || selectedProduct.title}
            width={104}
            height={104}
            style={{ objectFit: "cover", borderRadius: 16, flexShrink: 0 }}
            preview={false}
            fallback="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='104' height='104'><rect width='100%' height='100%' fill='%23f5f5f5'/></svg>"
          />
        ) : null}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div>
            <Paragraph style={{ marginBottom: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>
              {display?.title || selectedProduct.title}
            </Paragraph>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(220px, 1fr))",
              gap: "12px 32px",
              marginTop: 14,
            }}
          >
            {[
              { label: "SKC", value: selectedProductMeta?.skcId || "-", tagColor: "orange" as const },
              { label: "SPU", value: selectedProductMeta?.spuId || "-", tagColor: "default" as const },
              { label: "Goods", value: selectedProductMeta?.goodsId || "-", tagColor: "default" as const },
              { label: "SKU ID", value: selectedProductMeta?.skuId || "-" },
              { label: "货号", value: selectedProductMeta?.extCode || "-" },
              { label: "类目", value: selectedProductMeta?.category || "-" },
              { label: "站点状态", value: selectedProductMeta?.siteStatus || "-" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <Text type="secondary" style={{ minWidth: 64 }}>{item.label}</Text>
                {"tagColor" in item ? (
                  item.value === "-" ? <Text style={{ color: "#262626" }}>-</Text> : <Tag color={item.tagColor}>{item.value}</Tag>
                ) : (
                  <Text style={{ color: "#262626" }} ellipsis>{item.value}</Text>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderStepZero = () => (
    <Card style={CARD_STYLE}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <div>
          <Text strong style={{ fontSize: 20 }}>步骤 1：先选我的商品</Text>
          <div style={{ marginTop: 6, color: "#8c8c8c" }}>
            像 AI 出图一样，先把这次要分析的商品定下来，再进入下一步。
          </div>
        </div>

        <div>
            <Text strong>选择我的商品</Text>
          <div style={{ marginTop: 6, color: "#8c8c8c", fontSize: 13 }}>
            这里只显示当前在售商品，共 {myProductOptions.length} 个。
          </div>
          <Select
            showSearch
            placeholder="搜索并选择你的商品"
            value={selectedMy}
            onChange={setSelectedMy}
            style={{ width: "100%", marginTop: 8 }}
            listHeight={440}
            optionRender={(option) => {
              const data = option.data as typeof myProductOptions[number];
              return (
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "4px 0" }}>
                  {data.imageUrl ? (
                    <Image
                      src={data.imageUrl}
                      alt={data.label}
                      width={68}
                      height={68}
                      preview={false}
                      style={{ objectFit: "cover", borderRadius: 10, flexShrink: 0 }}
                      fallback="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='68' height='68'><rect width='100%' height='100%' fill='#f5f5f5'/></svg>"
                    />
                  ) : (
                    <div style={{ width: 68, height: 68, borderRadius: 10, background: "#f5f5f5", flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text strong style={{ display: "block", lineHeight: 1.5 }}>
                      {data.label}
                    </Text>
                    <Space wrap size={[4, 4]} style={{ marginTop: 6 }}>
                      <Tag color="success">在售</Tag>
                      {data.category ? <Tag>{data.category}</Tag> : null}
                      {data.skcId ? <Tag color="orange">SKC {data.skcId}</Tag> : null}
                      {data.goodsId ? <Tag>Goods {data.goodsId}</Tag> : null}
                    </Space>
                    <div style={{ marginTop: 6, color: "#8c8c8c", fontSize: 13 }}>
                      {[
                        data.price > 0 ? `$${toSafeNumber(data.price).toFixed(2)}` : "",
                        data.monthlySales > 0 ? `近30天销量 ${toSafeNumber(data.monthlySales).toLocaleString()}` : "",
                      ].filter(Boolean).join(" · ") || "暂无价格 / 销量数据"}
                    </div>
                  </div>
                </div>
              );
            }}
            notFoundContent="没有可选的在售商品"
            options={myProductOptions.map((option) => ({
              value: option.value,
              label: option.label,
              searchLabel: option.searchLabel,
              imageUrl: option.imageUrl,
              category: option.category,
              skcId: option.skcId,
              goodsId: option.goodsId,
              statusText: option.statusText,
              monthlySales: option.monthlySales,
              price: option.price,
            }))}
          />
        </div>

        {renderSelectedProductSummary()}

        {selectedProduct ? (
          <>
            <Row gutter={[12, 12]}>
              <Col span={6}><Card size="small"><Statistic title="当前售价" value={selectedProduct.price || 0} prefix="$" precision={2} /></Card></Col>
              <Col span={6}><Card size="small"><Statistic title="近30天销量" value={selectedProduct.monthlySales} /></Card></Col>
              <Col span={6}><Card size="small"><Statistic title="评分 / 评论" value={`${selectedProduct.score || "-"} / ${selectedProduct.reviewCount || "-"}`} /></Card></Col>
              <Col span={6}><Card size="small"><Statistic title="素材状态" value={selectedProduct.hasVideo ? "有视频" : "缺视频"} valueStyle={{ fontSize: 20 }} /></Card></Col>
            </Row>
            <div style={{ color: "#8c8c8c", lineHeight: 1.8 }}>
              先确认商品信息没有问题，再继续分析。
            </div>
          </>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先选一个商品，再开始分析。" />
        )}
      </Space>
    </Card>
  );
  // 云启「无匹配」自救面板：说明原因 + 两条自救路径
  const renderYunqiRescuePanel = () => {
    if (yunqiProductDetailLoading) return null;
    if (isSelectedYunqiExactMatch) return null;
    const hasGoodsId = Boolean(selectedGoodsId);
    const returnedMatch = selectedYunqiMatchStatus || "unknown";
    const reasonText = !hasGoodsId
      ? "当前商品还没有 Temu goodsId（可能是只拿到了 SKC / 货号），云启没法直接匹配到数据。"
      : selectedYunqiMatchStatus === "not_matched"
        ? "云启已经回应但 matchStatus = not_matched，数据库里暂时没有这件商品的精确记录。"
        : selectedYunqiDetail
          ? `云启返回的 goodsId（${selectedYunqiGoodsId || "空"}）和本地 goodsId（${selectedGoodsId}）对不上。`
          : "云启当前还没有返回这件商品的精确详情。";
    return (
      <div
        style={{
          borderRadius: 12,
          border: "1px dashed rgba(229,91,0,0.4)",
          background: "rgba(255,247,240,0.5)",
          padding: 14,
        }}
      >
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <div>
            <Text strong>无法自动匹配云启详情</Text>
            <div style={{ marginTop: 4, color: "#8c8c8c", fontSize: 13, lineHeight: 1.7 }}>
              {reasonText}下面两条路径任选一条，把云启详情手动绑到当前商品上：
            </div>
          </div>

          <div>
            <Space size={8} wrap>
              <Button
                size="small"
                type="primary"
                loading={yunqiRescueLoading}
                onClick={handleYunqiRescueSearch}
                style={{ background: TEMU_ORANGE, borderColor: TEMU_ORANGE }}
              >
                用标题搜一次候选
              </Button>
              <Text type="secondary" style={{ fontSize: 12 }}>
                按"{String(selectedProduct?.title || "").slice(0, 28)}..." 搜最多 5 个候选
              </Text>
            </Space>

            {yunqiRescueCandidates.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <List
                  size="small"
                  dataSource={yunqiRescueCandidates}
                  renderItem={(item: any) => (
                    <List.Item
                      actions={[
                        <Button
                          key="apply"
                          size="small"
                          loading={yunqiRescueLoading}
                          onClick={() => void applyYunqiRescueCandidate(item.productUrl)}
                        >
                          选这个
                        </Button>,
                      ]}
                    >
                      <Space size={8} style={{ width: "100%" }}>
                        {item.thumbUrl ? <Image src={item.thumbUrl} width={36} height={36} preview={false} style={{ borderRadius: 6 }} /> : null}
                        <div style={{ minWidth: 0 }}>
                          <Text ellipsis style={{ maxWidth: 360 }}>{item.title}</Text>
                          <div style={{ fontSize: 12, color: "#8c8c8c" }}>
                            ${toSafeNumber(item.price).toFixed(2)} · 月销 {toSafeNumber(item.monthlySales).toLocaleString() || "-"} · 评分 {toSafeNumber(item.score) || "-"}
                          </div>
                        </div>
                      </Space>
                    </List.Item>
                  )}
                />
              </div>
            ) : null}
          </div>

          <div>
            <Space.Compact style={{ width: "100%", maxWidth: 520 }}>
              <Input
                prefix={<LinkOutlined />}
                placeholder="或者直接粘贴 Temu 商品链接"
                value={yunqiRescueUrl}
                onChange={(event) => setYunqiRescueUrl(event.target.value)}
                onPressEnter={() => void applyYunqiRescueCandidate(yunqiRescueUrl.trim())}
                allowClear
              />
              <Button
                type="primary"
                loading={yunqiRescueLoading}
                onClick={() => void applyYunqiRescueCandidate(yunqiRescueUrl.trim())}
                style={{ background: TEMU_ORANGE, borderColor: TEMU_ORANGE }}
              >
                绑定
              </Button>
            </Space.Compact>
          </div>

          <div style={{ fontSize: 11, color: "#bfbfbf" }}>
            调试：本地 goodsId={selectedGoodsId || "空"} · 返回 matchStatus={returnedMatch}
          </div>
        </Space>
      </div>
    );
  };

  const renderStepOne = () => (
    <Card style={CARD_STYLE}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <div>
          <Text strong style={{ fontSize: 20 }}>步骤 2：设置关键词并开始搜索</Text>
        </div>

        {renderSelectedProductSummary(true)}

        {selectedProduct ? (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <div>
              <Text strong>商品基础表现</Text>
            </div>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}><Card size="small"><Statistic title="参考售价" value={selectedYunqiDisplay?.price || 0} prefix="$" precision={2} /></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Statistic title="参考日销" value={selectedYunqiDisplay?.dailySales || 0} /></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Statistic title="评分 / 评论" value={`${selectedYunqiDisplay?.score || "-"} / ${selectedYunqiDisplay?.reviewCount || "-"}`} /></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Statistic title="素材状态" value={selectedYunqiDisplay?.hasVideo ? "有视频" : "缺视频"} valueStyle={{ fontSize: 20 }} /></Card></Col>
            </Row>

            <Card
              size="small"
              style={{ borderRadius: 16, border: "1px solid #f0f0f0" }}
              bodyStyle={{ padding: 16 }}
            >
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <Text strong>云启参考信息</Text>
                    <div style={{ marginTop: 4, color: "#8c8c8c" }}>
                      这里把云启当前能返回的价格、销量、店铺、标签和时间信息都展开给你。
                    </div>
                  </div>
                  {yunqiProductDetailLoading ? (
                    <Text type="secondary">正在获取云启补充信息...</Text>
                  ) : null}
                </div>

                {yunqiProductDetailError ? (
                  <Text type="secondary">{yunqiProductDetailError}</Text>
                ) : null}

                {isSelectedYunqiExactMatch && selectedYunqiDetail ? (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    {/* ── 标签栏 ── */}
                    <Space wrap size={[6, 6]}>
                      {selectedYunqiDetail.mallName ? <Tag color="blue">{selectedYunqiDetail.mallName}</Tag> : null}
                      {selectedYunqiDetail.brand ? <Tag>{selectedYunqiDetail.brand}</Tag> : null}
                      {getWareHouseTypeLabel(selectedYunqiDetail.wareHouseType) ? (
                        <Tag color="orange">{getWareHouseTypeLabel(selectedYunqiDetail.wareHouseType)}</Tag>
                      ) : null}
                      {selectedYunqiDetail.activityType ? <Tag color="magenta">{selectedYunqiDetail.activityType}</Tag> : null}
                      {selectedYunqiDetail.soldOut ? <Tag color="red">已售罄</Tag> : <Tag color="success">在售</Tag>}
                      {selectedYunqiDetail.adult ? <Tag color="volcano">成人</Tag> : null}
                      {selectedYunqiTags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
                    </Space>

                    {/* ── 核心指标（紧凑网格） ── */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                      {[
                        { label: "日销", value: toSafeNumber(selectedYunqiDetail.dailySales), color: "#262626" },
                        { label: "周销", value: toSafeNumber(selectedYunqiDetail.weeklySales), color: "#262626" },
                        { label: "月销", value: toSafeNumber(selectedYunqiDetail.monthlySales), color: "#262626" },
                        { label: "累计", value: toSafeNumber(selectedYunqiDetail.totalSales), color: "#262626" },
                        { label: "评分", value: toSafeNumber(selectedYunqiDetail.score ?? selectedYunqiDetail.rating), precision: 1, color: "#fa8c16" },
                        { label: "USD GMV", value: toSafeNumber(selectedYunqiDetail.usdGmv), prefix: "$", precision: 2, color: "#389e0d" },
                        { label: "EUR GMV", value: toSafeNumber(selectedYunqiDetail.eurGmv), prefix: "€", precision: 2, color: "#389e0d" },
                        { label: "评论", value: toSafeNumber(selectedYunqiDetail.reviewCount), color: "#595959" },
                        { label: "同款数", value: toSafeNumber(selectedYunqiDetail.sameNum), color: "#595959" },
                        { label: "广告", value: Array.isArray(selectedYunqiDetail.adRecords) ? selectedYunqiDetail.adRecords.length : 0, color: "#595959" },
                      ].map((item) => (
                        <div key={item.label} style={{ background: "#fafafa", borderRadius: 10, padding: "8px 10px", border: "1px solid #f0f0f0" }}>
                          <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 2 }}>{item.label}</div>
                          <div style={{ fontSize: 17, fontWeight: 600, color: item.color, lineHeight: 1.3 }}>
                            {item.prefix || ""}{item.precision != null ? Number(item.value || 0).toLocaleString(undefined, { minimumFractionDigits: item.precision, maximumFractionDigits: item.precision }) : (item.value || 0).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* ── 原始标题 ── */}
                    <Paragraph
                      style={{ margin: 0, padding: "8px 12px", background: "#fafafa", borderRadius: 10, border: "1px solid #f0f0f0", lineHeight: 1.8, fontSize: 13, color: "#595959" }}
                      ellipsis={{ rows: 2, expandable: true, symbol: "展开" }}
                    >
                      {firstTextValue(selectedYunqiDetail.titleZh, selectedYunqiDetail.titleEn, selectedYunqiDetail.originalTitle, selectedYunqiDetail.title) || "-"}
                    </Paragraph>

                    {/* ── 价格 + 店铺 + 时间（Descriptions 紧凑表格） ── */}
                    <Descriptions
                      size="small"
                      bordered
                      column={{ xs: 2, sm: 3, md: 3, lg: 3 }}
                      labelStyle={{ fontSize: 12, color: "#8c8c8c", padding: "6px 10px", background: "#fafafa" }}
                      contentStyle={{ fontSize: 13, padding: "6px 10px", fontWeight: 500 }}
                    >
                      <Descriptions.Item label="美元价">{formatMoneyDisplay(selectedYunqiDetail.usdPrice)}</Descriptions.Item>
                      <Descriptions.Item label="欧元价">{formatMoneyDisplay(selectedYunqiDetail.eurPrice, "€")}</Descriptions.Item>
                      <Descriptions.Item label="市场价">{formatMoneyDisplay(selectedYunqiDetail.marketPrice)}</Descriptions.Item>
                      <Descriptions.Item label="店铺评分">
                        {toSafeNumber(selectedYunqiDetail.mallScore) > 0 ? (
                          <span style={{ color: toSafeNumber(selectedYunqiDetail.mallScore) >= 4.5 ? "#389e0d" : "#595959" }}>
                            {toSafeNumber(selectedYunqiDetail.mallScore).toFixed(1)}
                          </span>
                        ) : "-"}
                      </Descriptions.Item>
                      <Descriptions.Item label="店铺商品数">{toSafeNumber(selectedYunqiDetail.mallTotalGoods) || "-"}</Descriptions.Item>
                      <Descriptions.Item label="类目">
                        <Tooltip title={firstTextValue(selectedYunqiDetail.categoryName, selectedYunqiDetail.category)}>
                          <span style={{ maxWidth: 160, display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
                            {firstTextValue(selectedYunqiDetail.categoryName, selectedYunqiDetail.category) || "-"}
                          </span>
                        </Tooltip>
                      </Descriptions.Item>
                      <Descriptions.Item label="上架时间">{formatDateDisplay(selectedYunqiDetail.createdAt || selectedYunqiDetail.issuedDate)}</Descriptions.Item>
                      <Descriptions.Item label="最近更新">{formatDateDisplay(selectedYunqiDetail.lastModified)}</Descriptions.Item>
                      <Descriptions.Item label="最近投流">{formatDateDisplay(selectedYunqiDetail.lastAdTime)}</Descriptions.Item>
                      {firstTextValue(selectedYunqiDetail.commentNumTips) ? (
                        <Descriptions.Item label="评论提示">{selectedYunqiDetail.commentNumTips}</Descriptions.Item>
                      ) : null}
                    </Descriptions>

                    {/* ── 分站价格 + 近日销量走势（并排） ── */}
                    {(selectedYunqiPriceItems.length > 0 || selectedYunqiSalesTrendItems.length > 0) ? (
                      <Row gutter={[12, 12]}>
                        {selectedYunqiPriceItems.length > 0 ? (
                          <Col xs={24} xl={12}>
                            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>分站价格</div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 6 }}>
                              {selectedYunqiPriceItems.map((item: any) => (
                                <div key={item.key} style={{ borderRadius: 8, border: "1px solid #f0f0f0", background: "#fafafa", padding: "6px 10px" }}>
                                  <div style={{ fontSize: 11, color: "#8c8c8c" }}>{item.site}</div>
                                  <div style={{ fontSize: 15, fontWeight: 600, color: "#262626", marginTop: 2 }}>{item.priceLabel}</div>
                                </div>
                              ))}
                            </div>
                          </Col>
                        ) : null}
                        {selectedYunqiSalesTrendItems.length > 0 ? (
                          <Col xs={24} xl={selectedYunqiPriceItems.length > 0 ? 12 : 24}>
                            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>近日销量走势</div>
                            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
                              {selectedYunqiSalesTrendItems.map((item: any) => (
                                <div key={item.key} style={{ minWidth: 72, borderRadius: 8, border: "1px solid #f0f0f0", background: "#fafafa", padding: "6px 10px", flexShrink: 0, textAlign: "center" }}>
                                  <div style={{ fontSize: 11, color: "#8c8c8c", whiteSpace: "nowrap" }}>{item.date}</div>
                                  <div style={{ fontSize: 15, fontWeight: 600, color: "#262626", marginTop: 2 }}>{item.sales}</div>
                                </div>
                              ))}
                            </div>
                          </Col>
                        ) : null}
                      </Row>
                    ) : null}
                  </Space>
                ) : !yunqiProductDetailLoading ? (
                  renderYunqiRescuePanel()
                ) : null}
              </Space>
            </Card>

            <Card
              size="small"
              style={{ borderRadius: 16, background: "#fafafa", border: "1px solid #f0f0f0" }}
              bodyStyle={{ padding: 16 }}
            >
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <Text strong>最近流量表现</Text>
                    <div style={{ marginTop: 4, color: "#8c8c8c" }}>
                      这里只看“商品流量”页面采回来的曝光、点击和转化，再决定这次主打词要不要继续打。
                    </div>
                  </div>
                  {selectedTrafficBySite.map((item) => item.summary?.updateTime || item.summary?.syncedAt || item.syncedAt).find(Boolean) ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      最近更新：{selectedTrafficDetailBySite.map((item) => item.summary?.syncedAt || item.syncedAt).find(Boolean)}
                    </Text>
                  ) : null}
                </div>

                <Row gutter={[12, 12]}>
                  {selectedTrafficDetailBySite.map((site) => (
                    <Col xs={24} xl={8} key={site.siteKey}>
                      <Card
                        size="small"
                        title={(
                          <Space size={8}>
                            <Text strong>{site.siteLabel}</Text>
                            <Tag color={site.summary ? "orange" : "default"}>
                              {site.summary ? "已匹配" : "暂无数据"}
                            </Tag>
                          </Space>
                        )}
                        extra={site.summary?.syncedAt ? <Text type="secondary" style={{ fontSize: 12 }}>{site.summary.syncedAt}</Text> : null}
                      >
                        {site.summary ? (
                          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                            <Row gutter={[8, 8]}>
                              <Col span={12}>
                                <Statistic title="曝光" value={site.summary.exposeNum} formatter={(value) => toSafeNumber(value).toLocaleString()} />
                                <Text style={{ color: getRelativeChangeColor(site.summary.exposeNumChange), fontSize: 12 }}>
                                  较上期 {formatRelativeChangeText(site.summary.exposeNumChange)}
                                </Text>
                              </Col>
                              <Col span={12}>
                                <Statistic title="点击" value={site.summary.clickNum} formatter={(value) => toSafeNumber(value).toLocaleString()} />
                                <Text style={{ color: getRelativeChangeColor(site.summary.clickNumChange), fontSize: 12 }}>
                                  较上期 {formatRelativeChangeText(site.summary.clickNumChange)}
                                </Text>
                              </Col>
                              <Col span={12}>
                                <Statistic title="曝光点击率" value={site.summary.exposeClickRate * 100} precision={1} suffix="%" />
                              </Col>
                              <Col span={12}>
                                <Statistic title="点击支付转化率" value={site.summary.clickPayRate * 100} precision={1} suffix="%" />
                              </Col>
                            </Row>
                            <div style={{ color: "#595959", lineHeight: 1.9 }}>
                              <div>详情访问：{site.summary.detailVisitNum.toLocaleString()}</div>
                              <div>加购人数：{site.summary.addToCartUserNum.toLocaleString()}</div>
                              <div>支付买家 / 件数：{site.summary.buyerNum.toLocaleString()} / {site.summary.payGoodsNum.toLocaleString()}</div>
                            </div>
                            {site.summary.growDataText ? (
                              <div style={{ color: "#8c8c8c", lineHeight: 1.8 }}>
                                {`增长潜力：${site.summary.growDataText}`}
                              </div>
                            ) : null}
                            {site.detailLoading ? (
                              <div style={{ color: "#8c8c8c", lineHeight: 1.8, paddingTop: 8, borderTop: "1px dashed #f0f0f0" }}>
                                正在补充更多流量明细…
                              </div>
                            ) : site.detailSummary ? (
                              <div style={{ color: "#595959", lineHeight: 1.9, paddingTop: 8, borderTop: "1px dashed #f0f0f0" }}>
                                {site.detailSummary.dataDate ? (
                                  <div>数据日期：{site.detailSummary.dataDate}</div>
                                ) : null}
                                <div>详情访客 / 收藏人数：{site.detailSummary.detailVisitorNum.toLocaleString()} / {site.detailSummary.collectUserNum.toLocaleString()}</div>
                                <div>搜索曝光 / 点击 / 支付：{site.detailSummary.searchExposeNum.toLocaleString()} / {site.detailSummary.searchClickNum.toLocaleString()} / {site.detailSummary.searchPayGoodsNum.toLocaleString()}</div>
                                <div>推荐曝光 / 点击 / 支付：{site.detailSummary.recommendExposeNum.toLocaleString()} / {site.detailSummary.recommendClickNum.toLocaleString()} / {site.detailSummary.recommendPayGoodsNum.toLocaleString()}</div>
                                {(site.detailSummary.trendExposeNum > 0 || site.detailSummary.trendPayOrderNum > 0) ? (
                                  <div>趋势曝光 / 支付订单：{site.detailSummary.trendExposeNum.toLocaleString()} / {site.detailSummary.trendPayOrderNum.toLocaleString()}</div>
                                ) : null}
                              </div>
                            ) : null}
                            {site.recentTrendSeries.length > 0 ? (
                              <div style={{ color: "#595959", lineHeight: 1.9, paddingTop: 8, borderTop: "1px dashed #f0f0f0" }}>
                                <div style={{ fontWeight: 600, marginBottom: 6 }}>最近 7 天站点趋势</div>
                                {site.trendRangeText ? (
                                  <div style={{ color: "#8c8c8c", marginBottom: 6 }}>
                                    日期范围：{site.trendRangeText}
                                  </div>
                                ) : null}
                                {site.recentTrendSeries.map((trend: FluxTrendPoint) => (
                                  <div key={`${site.siteKey}-${trend.date}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                                    <span>{trend.date}</span>
                                    <span>访客 {trend.visitors.toLocaleString()}</span>
                                    <span>支付买家 {trend.buyers.toLocaleString()}</span>
                                    <span>转化率 {(trend.conversionRate * 100).toFixed(1)}%</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </Space>
                        ) : (
                          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                            <div style={{ color: "#8c8c8c", lineHeight: 1.8 }}>
                              {site.recentTrendSeries.length > 0
                                ? "这件商品在这个区域暂时没有匹配到商品流量行数据，先看该区域整体趋势。"
                                : "这个区域暂时没有匹配到“商品流量”数据。"}
                            </div>
                            {site.latestTrendPoint ? (
                              <div style={{ color: "#595959", lineHeight: 1.9 }}>
                                <div>最新日期：{site.latestTrendPoint.date}</div>
                                <div>站点访客：{site.latestTrendPoint.visitors.toLocaleString()}</div>
                                <div>站点支付买家：{site.latestTrendPoint.buyers.toLocaleString()}</div>
                                <div>站点转化率：{(site.latestTrendPoint.conversionRate * 100).toFixed(1)}%</div>
                              </div>
                            ) : null}
                            {site.recentTrendSeries.length > 0 ? (
                              <div style={{ color: "#595959", lineHeight: 1.9, paddingTop: 8, borderTop: "1px dashed #f0f0f0" }}>
                                <div style={{ fontWeight: 600, marginBottom: 6 }}>最近 7 天站点趋势</div>
                                {site.trendRangeText ? (
                                  <div style={{ color: "#8c8c8c", marginBottom: 6 }}>
                                    日期范围：{site.trendRangeText}
                                  </div>
                                ) : null}
                                {site.recentTrendSeries.map((trend: FluxTrendPoint) => (
                                  <div key={`${site.siteKey}-${trend.date}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                                    <span>{trend.date}</span>
                                    <span>访客 {trend.visitors.toLocaleString()}</span>
                                    <span>支付买家 {trend.buyers.toLocaleString()}</span>
                                    <span>转化率 {(trend.conversionRate * 100).toFixed(1)}%</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </Space>
                        )}
                      </Card>
                    </Col>
                  ))}
                </Row>
              </Space>
            </Card>
          </Space>
        ) : null}

        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Text strong>从这个商品出发打词</Text>
          <Space wrap size={[6, 6]}>
            {suggestedKeywords.map((item) => <Tag key={item} style={{ cursor: "pointer" }} onClick={() => setKeyword(item)}>{item}</Tag>)}
          </Space>
        </Space>

        <Space wrap align="start">
          <Input
            prefix={<SearchOutlined />}
            placeholder="输入这个商品当前要打的关键词"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 360 }}
            allowClear
          />
          <Button
            type="primary"
            icon={<SearchOutlined />}
            loading={loading}
            onClick={handleSearch}
            style={{ background: TEMU_ORANGE, borderColor: TEMU_ORANGE }}
          >
            分析这个商品
          </Button>
        </Space>

        <div style={{ color: searchRows.length > 0 ? TEMU_ORANGE : "#8c8c8c", lineHeight: 1.8 }}>
          {searchRows.length > 0
            ? `已找到 ${searchRows.length} 个相似商品，当前关键词：${results?.keyword || keyword}。`
            : "先确定这次要打的关键词，再开始看市场结果。"}
        </div>
      </Space>
    </Card>
  );
  void renderStepOne; // 旧版单卡布局，已被 renderStepOneDashboard 取代，保留备用

  const renderStepOneDashboard = () => (
    <Card style={CARD_STYLE}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <div>
          <Text strong style={{ fontSize: 20 }}>步骤 2：先做商品体检，再设关键词</Text>
          <div style={{ marginTop: 6, color: "#8c8c8c" }}>
            先看这个商品最近的价格、销量、流量、标题和主图状态，再决定这次主打关键词。
          </div>
        </div>

        {renderSelectedProductSummary(true)}

        {selectedProduct ? (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <div>
              <Text strong>商品基础表现</Text>
            </div>

            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}><Card size="small"><Statistic title="参考售价" value={selectedYunqiDisplay?.price || 0} prefix="$" precision={2} /></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Statistic title="参考日销" value={selectedYunqiDisplay?.dailySales || 0} /></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Statistic title="评分 / 评论" value={`${selectedYunqiDisplay?.score || "-"} / ${selectedYunqiDisplay?.reviewCount || "-"}`} /></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Statistic title="素材状态" value={selectedYunqiDisplay?.hasVideo ? "有视频" : "缺视频"} valueStyle={{ fontSize: 20 }} /></Card></Col>
            </Row>

            <Row gutter={[12, 12]}>
              <Col xs={24} xl={12}>
                <Card size="small" style={{ borderRadius: 16, height: "100%" }}>
                  <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <Text strong>标题诊断</Text>
                      <Tag color={titleDiagnosis.statusColor}>{titleDiagnosis.status}</Tag>
                    </div>

                    <Paragraph style={{ marginBottom: 0, lineHeight: 1.7 }}>
                      {titleDiagnosis.summary}
                    </Paragraph>

                    <div>
                      <Text type="secondary" style={{ fontSize: 13 }}>诊断要点</Text>
                      <div style={{ marginTop: 8 }}>
                        <Space wrap size={[6, 6]}>
                          {titleDiagnosis.findings.map((item) => <Tag key={item}>{item}</Tag>)}
                        </Space>
                      </div>
                    </div>

                    <div>
                      <Text type="secondary" style={{ fontSize: 13 }}>建议动作</Text>
                      <List
                        size="small"
                        dataSource={titleDiagnosis.actions}
                        locale={{ emptyText: "当前标题先保持不动，优先看流量和样本表现。" }}
                        renderItem={(item) => (
                          <List.Item style={{ paddingInline: 0, paddingBlock: 8, alignItems: "flex-start" }}>
                            <Text style={{ lineHeight: 1.7 }}>{item}</Text>
                          </List.Item>
                        )}
                      />
                    </div>
                  </Space>
                </Card>
              </Col>

              <Col xs={24} xl={12}>
                <Card size="small" style={{ borderRadius: 16, height: "100%" }}>
                  <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <Space size={8}>
                        <Text strong>主图诊断</Text>
                        <Tag color={imageDiagnosis.statusColor}>{imageDiagnosis.status}</Tag>
                      </Space>
                    </div>

                    <Paragraph style={{ marginBottom: 0, lineHeight: 1.7 }}>
                      {imageDiagnosis.summary}
                    </Paragraph>

                    <div>
                      <Text type="secondary" style={{ fontSize: 13 }}>诊断要点</Text>
                      <div style={{ marginTop: 8 }}>
                        <Space wrap size={[6, 6]}>
                          {imageDiagnosis.findings.map((item) => <Tag key={item}>{item}</Tag>)}
                        </Space>
                      </div>
                    </div>

                    <div>
                      <Text type="secondary" style={{ fontSize: 13 }}>建议动作</Text>
                      <List
                        size="small"
                        dataSource={imageDiagnosis.actions}
                        locale={{ emptyText: "当前主图先保持不动，继续观察样本素材变化。" }}
                        renderItem={(item) => (
                          <List.Item style={{ paddingInline: 0, paddingBlock: 8, alignItems: "flex-start" }}>
                            <Text style={{ lineHeight: 1.7 }}>{item}</Text>
                          </List.Item>
                        )}
                      />
                    </div>
                  </Space>
                </Card>
              </Col>
            </Row>

            <Card
              size="small"
              style={{ borderRadius: 16, border: "1px solid #f0f0f0" }}
              bodyStyle={{ padding: 16 }}
            >
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <Text strong>云启参考信息</Text>
                  </div>
                  {yunqiProductDetailLoading ? <Text type="secondary">正在获取云启补充信息...</Text> : null}
                </div>

                {yunqiProductDetailError ? <Text type="secondary">{yunqiProductDetailError}</Text> : null}

                {isSelectedYunqiExactMatch && selectedYunqiDetail ? (
                  <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                    <Space wrap size={[6, 6]}>
                      {selectedYunqiDetail.mallName ? <Tag color="blue">{selectedYunqiDetail.mallName}</Tag> : null}
                      {selectedYunqiDetail.brand ? <Tag>{selectedYunqiDetail.brand}</Tag> : null}
                      {getWareHouseTypeLabel(selectedYunqiDetail.wareHouseType) ? (
                        <Tag color="orange">{getWareHouseTypeLabel(selectedYunqiDetail.wareHouseType)}</Tag>
                      ) : null}
                      {selectedYunqiDetail.activityType ? <Tag color="magenta">{selectedYunqiDetail.activityType}</Tag> : null}
                      {selectedYunqiDetail.soldOut ? <Tag color="red">已售罄</Tag> : <Tag color="success">在售</Tag>}
                      {selectedYunqiDetail.adult ? <Tag color="volcano">成人</Tag> : null}
                    </Space>

                    <Row gutter={[12, 12]}>
                      <Col xs={12} md={6}><Card size="small"><Statistic title="参考周销" value={toSafeNumber(selectedYunqiDetail.weeklySales)} /></Card></Col>
                      <Col xs={12} md={6}><Card size="small"><Statistic title="参考月销" value={toSafeNumber(selectedYunqiDetail.monthlySales)} /></Card></Col>
                      <Col xs={12} md={6}><Card size="small"><Statistic title="累计销量" value={toSafeNumber(selectedYunqiDetail.totalSales)} /></Card></Col>
                      <Col xs={12} md={6}><Card size="small"><Statistic title="同款数" value={toSafeNumber(selectedYunqiDetail.sameNum)} /></Card></Col>
                      <Col xs={12} md={6}><Card size="small"><Statistic title="USD GMV" value={toSafeNumber(selectedYunqiDetail.usdGmv)} prefix="$" precision={2} /></Card></Col>
                      <Col xs={12} md={6}><Card size="small"><Statistic title="EUR GMV" value={toSafeNumber(selectedYunqiDetail.eurGmv)} prefix="€" precision={2} /></Card></Col>
                      <Col xs={12} md={6}><Card size="small"><Statistic title="店铺评分" value={toSafeNumber(selectedYunqiDetail.mallScore)} precision={1} /></Card></Col>
                      <Col xs={12} md={6}><Card size="small"><Statistic title="店铺商品数" value={toSafeNumber(selectedYunqiDetail.mallTotalGoods)} /></Card></Col>
                    </Row>

                    <div
                      style={{
                        borderRadius: 16,
                        border: "1px solid #f0f0f0",
                        background: "#fafafa",
                        padding: 16,
                      }}
                    >
                      <Text type="secondary" style={{ fontSize: 13 }}>原始标题</Text>
                      <Paragraph
                        style={{ marginTop: 8, marginBottom: 0, lineHeight: 1.8 }}
                        ellipsis={{ rows: 3, expandable: true, symbol: "展开" }}
                      >
                        {firstTextValue(selectedYunqiDetail.titleZh, selectedYunqiDetail.titleEn, selectedYunqiDetail.originalTitle, selectedYunqiDetail.title) || "-"}
                      </Paragraph>
                    </div>

                    <Row gutter={[12, 12]}>
                      {[
                        { label: "市场价", value: formatMoneyDisplay(selectedYunqiDetail.marketPrice) },
                        { label: "美元价", value: formatMoneyDisplay(selectedYunqiDetail.usdPrice) },
                        { label: "欧元价", value: formatMoneyDisplay(selectedYunqiDetail.eurPrice, "€") },
                        { label: "上架时间", value: formatDateDisplay(selectedYunqiDetail.createdAt || selectedYunqiDetail.issuedDate) },
                        { label: "最近更新", value: formatDateDisplay(selectedYunqiDetail.lastModified) },
                        { label: "最近投流", value: formatDateDisplay(selectedYunqiDetail.lastAdTime) },
                        { label: "评论提示", value: firstTextValue(selectedYunqiDetail.commentNumTips) || "-" },
                        { label: "类目", value: firstTextValue(selectedYunqiDetail.categoryName, selectedYunqiDetail.category) || "-" },
                        { label: "广告记录", value: String(Array.isArray(selectedYunqiDetail.adRecords) ? selectedYunqiDetail.adRecords.length : 0) },
                      ].map((item) => (
                        <Col xs={12} md={8} xl={8} key={item.label}>
                          <Card size="small" style={{ borderRadius: 14, height: "100%" }} bodyStyle={{ padding: 14 }}>
                            <Text type="secondary" style={{ fontSize: 13 }}>{item.label}</Text>
                            <Paragraph
                              style={{ marginTop: 8, marginBottom: 0, lineHeight: 1.7, fontSize: 16 }}
                              ellipsis={{ rows: 2, tooltip: item.value }}
                            >
                              {item.value}
                            </Paragraph>
                          </Card>
                        </Col>
                      ))}
                    </Row>

                    {selectedYunqiTags.length > 0 ? (
                      <div>
                        <Text strong style={{ fontSize: 13 }}>云启标签</Text>
                        <div style={{ marginTop: 8 }}>
                          <Space wrap size={[6, 6]}>
                            {selectedYunqiTags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
                          </Space>
                        </div>
                      </div>
                    ) : null}

                    {(selectedYunqiPriceItems.length > 0 || selectedYunqiSalesTrendItems.length > 0) ? (
                      <Row gutter={[12, 12]}>
                        <Col xs={24} xl={12}>
                          <Card size="small" title="分站价格">
                            {selectedYunqiPriceItems.length > 0 ? (
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "repeat(auto-fit, minmax(116px, 1fr))",
                                  gap: 8,
                                }}
                              >
                                {selectedYunqiPriceItems.map((item: any) => (
                                  <div
                                    key={item.key}
                                    style={{
                                      borderRadius: 12,
                                      border: "1px solid #f0f0f0",
                                      background: "#fafafa",
                                      padding: "10px 12px",
                                    }}
                                  >
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                      {item.site}
                                    </Text>
                                    <div style={{ marginTop: 6, fontSize: 18, fontWeight: 600, color: "#262626", lineHeight: 1.2 }}>
                                      {item.priceLabel}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <Text type="secondary">暂时没有分站价格记录</Text>
                            )}
                          </Card>
                        </Col>
                        <Col xs={24} xl={12}>
                          <Card size="small" title="近日销量走势">
                            {selectedYunqiSalesTrendItems.length > 0 ? (
                              <div
                                style={{
                                  display: "flex",
                                  gap: 8,
                                  overflowX: "auto",
                                  paddingBottom: 4,
                                }}
                              >
                                {selectedYunqiSalesTrendItems.map((item: any) => (
                                  <div
                                    key={item.key}
                                    style={{
                                      minWidth: 96,
                                      borderRadius: 12,
                                      border: "1px solid #f0f0f0",
                                      background: "#fafafa",
                                      padding: "10px 12px",
                                      flexShrink: 0,
                                    }}
                                  >
                                    <Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                                      {item.date}
                                    </Text>
                                    <div style={{ marginTop: 6, fontSize: 18, fontWeight: 600, color: "#262626", lineHeight: 1.2 }}>
                                      {item.sales}
                                    </div>
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                      日销
                                    </Text>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <Text type="secondary">暂时没有近日销量走势</Text>
                            )}
                          </Card>
                        </Col>
                      </Row>
                    ) : null}
                  </Space>
                ) : !yunqiProductDetailLoading ? (
                  renderYunqiRescuePanel()
                ) : null}
              </Space>
            </Card>

            <Card
              size="small"
              style={{ borderRadius: 16, background: "#fafafa", border: "1px solid #f0f0f0" }}
              bodyStyle={{ padding: 16 }}
            >
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <Text strong>流量驾驶舱</Text>
                  </div>
                  <Space wrap size={[8, 8]}>
                    {activeTrafficSite ? (
                      <Tag color="orange">{getFluxSiteDisplayName(activeTrafficSite.siteKey)} · {activeTrafficModeMeta.label}</Tag>
                    ) : null}
                    {activeTrafficDateLabel ? <Tag color="blue">数据日期 {activeTrafficDateLabel}</Tag> : null}
                    {trafficOverviewSyncedAt ? <Tag>同步 {trafficOverviewSyncedAt}</Tag> : null}
                  </Space>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <Space wrap size={[8, 8]}>
                    {FLUX_SITE_ORDER.map((site) => {
                      const siteMeta = getTrafficModeMeta(selectedTrafficDetailBySite.find((item) => item.siteKey === site.siteKey));
                      const selected = trafficActiveSiteKey === site.siteKey;
                      return (
                        <Button
                          key={site.siteKey}
                          size="small"
                          type={selected ? "primary" : "default"}
                          onClick={() => setTrafficActiveSiteKey(site.siteKey)}
                          style={selected ? { background: TEMU_ORANGE, borderColor: TEMU_ORANGE } : undefined}
                        >
                          {getFluxSiteDisplayName(site.siteKey)} · {siteMeta.label}
                        </Button>
                      );
                    })}
                  </Space>

                  {showTrafficRangeSwitcher ? (
                    <Space wrap size={[8, 8]}>
                      {activeTrafficAvailableRanges.map((label) => (
                        <Button
                          key={`range-${label}`}
                          size="small"
                          type={trafficRangeLabel === label ? "primary" : "default"}
                          onClick={() => setTrafficRangeLabel(label)}
                          style={trafficRangeLabel === label ? { background: TEMU_ORANGE, borderColor: TEMU_ORANGE } : undefined}
                        >
                          {label}
                        </Button>
                      ))}
                    </Space>
                  ) : trafficRangeDisplayLabel ? (
                    <Tag>{trafficRangeDisplayLabel}</Tag>
                  ) : null}
                </div>

                {activeTrafficSite?.summary?.growDataText ? (
                  <div
                    style={{
                      borderRadius: 12,
                      background: "#fff7e6",
                      border: "1px solid #ffe7ba",
                      padding: "10px 12px",
                      color: "#ad4e00",
                    }}
                  >
                    增长潜力：{activeTrafficSite.summary.growDataText}
                  </div>
                ) : null}
                {activeTrafficTodayFallbackText ? (
                  <div
                    style={{
                      borderRadius: 12,
                      background: "#fffbe6",
                      border: "1px solid #ffe58f",
                      padding: "10px 12px",
                      color: "#ad6800",
                    }}
                  >
                    {activeTrafficTodayFallbackText}
                  </div>
                ) : null}

                <Row gutter={[12, 12]}>
                  {activeTrafficMetricCards.map((metric) => (
                    <Col xs={12} lg={8} xl={4} key={metric.key}>
                      <Card size="small" style={{ height: "100%", borderRadius: 14 }} bodyStyle={{ padding: 14 }}>
                        <div style={{ color: "#8c8c8c", fontSize: 13 }}>{metric.title}</div>
                        <div style={{ marginTop: 10, fontSize: 34, fontWeight: 700, lineHeight: 1.1 }}>{metric.value}</div>
                        <div style={{ marginTop: 8, fontSize: 12, color: metric.captionColor }}>{metric.caption}</div>
                      </Card>
                    </Col>
                  ))}
                </Row>

                <Row gutter={[12, 12]}>
                  <Col xs={24} xl={14}>
                    <Card
                      size="small"
                      title="曝光与转化趋势"
                      extra={activeTrafficTrendRangeText ? (
                        <Text type="secondary">
                          {activeTrafficTrendRangeText}
                        </Text>
                      ) : null}
                      style={{ borderRadius: 14, height: "100%" }}
                    >
                      {activeTrafficTrendChartData.length > 1 ? (
                        <div style={{ width: "100%", height: 280 }}>
                          <ResponsiveContainer>
                            <LineChart data={activeTrafficTrendChartData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                              <CartesianGrid stroke={TRAFFIC_CHART_COLORS.grid} strokeDasharray="4 4" vertical={false} />
                              <XAxis dataKey="label" tick={{ fill: TRAFFIC_CHART_COLORS.axis, fontSize: 12 }} axisLine={{ stroke: "#d9d9d9" }} tickLine={false} />
                              <YAxis yAxisId="left" tickFormatter={(value) => formatTrafficNumber(value)} tick={{ fill: TRAFFIC_CHART_COLORS.axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                              <YAxis yAxisId="right" orientation="right" tickFormatter={(value) => `${value}%`} tick={{ fill: TRAFFIC_CHART_COLORS.axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                              <RTooltip content={renderTrafficTrendTooltip} cursor={{ stroke: "#d9d9d9", strokeDasharray: "4 4" }} />
                              <Legend iconType="circle" wrapperStyle={{ paddingTop: 8 }} />
                              <Line yAxisId="left" type="monotone" dataKey="expose" name="曝光" stroke={TRAFFIC_CHART_COLORS.expose} strokeWidth={3} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: TRAFFIC_CHART_COLORS.expose }} />
                              <Line yAxisId="right" type="monotone" dataKey="clickRate" name="点击率" stroke={TRAFFIC_CHART_COLORS.clickRate} strokeWidth={2.5} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: TRAFFIC_CHART_COLORS.clickRate }} />
                              <Line yAxisId="right" type="monotone" dataKey="clickPayRate" name="点击支付率" stroke={TRAFFIC_CHART_COLORS.clickPayRate} strokeWidth={2.5} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: TRAFFIC_CHART_COLORS.clickPayRate }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有可展示的多时间商品流量趋势" />
                      )}
                    </Card>
                  </Col>

                  <Col xs={24} xl={10}>
                    <Card
                      size="small"
                      title="来源结构"
                      extra={<Text type="secondary">搜索 / 推荐 / 其他</Text>}
                      style={{ borderRadius: 14, height: "100%" }}
                    >
                      {showTrafficSourceTimelineChart ? (
                        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                          <div style={{ width: "100%", height: 240 }}>
                            <ResponsiveContainer>
                              <AreaChart data={activeTrafficSourceChartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid stroke={TRAFFIC_CHART_COLORS.grid} strokeDasharray="4 4" vertical={false} />
                                <XAxis dataKey="label" tick={{ fill: TRAFFIC_CHART_COLORS.axis, fontSize: 12 }} axisLine={{ stroke: "#d9d9d9" }} tickLine={false} />
                                <YAxis tick={{ fill: TRAFFIC_CHART_COLORS.axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                                <RTooltip content={renderTrafficSourceTooltip} cursor={{ stroke: "#d9d9d9", strokeDasharray: "4 4" }} />
                                <Legend
                                  iconType="circle"
                                  wrapperStyle={{ paddingTop: 8 }}
                                  formatter={(value) => (value === "search" ? "搜索" : value === "recommend" ? "推荐" : "其他")}
                                />
                                <Area type="monotone" dataKey="search" name="search" stackId="traffic-source" stroke={TRAFFIC_CHART_COLORS.search} fill={TRAFFIC_CHART_COLORS.search} fillOpacity={0.28} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: TRAFFIC_CHART_COLORS.search }} />
                                <Area type="monotone" dataKey="recommend" name="recommend" stackId="traffic-source" stroke={TRAFFIC_CHART_COLORS.recommend} fill={TRAFFIC_CHART_COLORS.recommend} fillOpacity={0.46} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: TRAFFIC_CHART_COLORS.recommend }} />
                                <Area type="monotone" dataKey="other" name="other" stackId="traffic-source" stroke={TRAFFIC_CHART_COLORS.other} fill={TRAFFIC_CHART_COLORS.other} fillOpacity={0.52} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: TRAFFIC_CHART_COLORS.other }} />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </Space>
                      ) : (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="当前还没有可用的来源走势"
                        />
                      )}
                    </Card>
                  </Col>
                </Row>

                <Row gutter={[12, 12]}>
                  <Col xs={24} xl={14}>
                    <Card size="small" title="转化漏斗" style={{ borderRadius: 14, height: "100%" }}>
                      {activeTrafficFunnelDisplaySteps.length > 0 ? (
                        <Space direction="vertical" size={14} style={{ width: "100%" }}>
                          {activeTrafficFunnelDisplaySteps.map((step, index) => (
                            <div
                              key={step.displayLabel}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "96px 1fr 128px",
                                gap: 12,
                                alignItems: "center",
                              }}
                            >
                              <Text strong>{step.displayLabel}</Text>
                              <div style={{ height: 12, background: "#f5f5f5", borderRadius: 999, overflow: "hidden" }}>
                                <div
                                  style={{
                                    width: `${step.widthPercent}%`,
                                    height: "100%",
                                    background: index === 0 ? "#fa8c16" : index === 1 ? "#ffb347" : index === 2 ? "#69b1ff" : index === 3 ? "#95de64" : "#36cfc9",
                                    borderRadius: 999,
                                  }}
                                />
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <div style={{ fontWeight: 600 }}>{formatTrafficNumber(step.value)}</div>
                                <div style={{ fontSize: 12, color: "#8c8c8c" }}>{index === 0 ? "基线" : `环节转化 ${step.conversionText}`}</div>
                              </div>
                            </div>
                          ))}
                        </Space>
                      ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前站点还没有足够的商品级转化数据" />
                      )}
                    </Card>
                  </Col>

                  <Col xs={24} xl={10}>
                    <Card size="small" title="站点对比" style={{ borderRadius: 14, height: "100%" }}>
                      <Space direction="vertical" size="small" style={{ width: "100%" }}>
                        {selectedTrafficDetailBySite.map((site) => {
                          const modeMeta = getTrafficModeMeta(site);
                          const selected = site.siteKey === trafficActiveSiteKey;
                          return (
                            <div
                              key={site.siteKey}
                              onClick={() => setTrafficActiveSiteKey(site.siteKey)}
                              style={{
                                border: selected ? `1px solid ${TEMU_ORANGE}` : "1px solid #f0f0f0",
                                background: selected ? "#fff7e6" : "#fff",
                                borderRadius: 12,
                                padding: 12,
                                cursor: "pointer",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                <Text strong>{getFluxSiteDisplayName(site.siteKey)}</Text>
                                <Tag color={modeMeta.color}>{modeMeta.label}</Tag>
                              </div>
                              <div style={{ marginTop: 8, fontWeight: 600, color: "#262626" }}>
                                {site.summary
                                  ? `${formatTrafficNumber(site.summary.exposeNum)} 曝光 · ${formatTrafficNumber(site.summary.clickNum)} 点击`
                                  : site.latestTrendPoint
                                    ? `${formatTrafficNumber(site.latestTrendPoint.visitors)} 访客 · ${formatTrafficNumber(site.latestTrendPoint.buyers)} 买家`
                                    : "当前没有可用流量数据"}
                              </div>
                              <div style={{ marginTop: 4, fontSize: 12, color: "#8c8c8c" }}>
                                {site.summary
                                  ? `点击支付转化率 ${formatTrafficPercentValue(toSafeNumber(site.summary.clickPayRate) * 100)}`
                                  : site.latestTrendPoint
                                    ? `站点转化率 ${formatTrafficPercentValue((site.latestTrendPoint.conversionRate || 0) * 100)}`
                                    : "等待下一次采集"}
                              </div>
                            </div>
                          );
                        })}
                      </Space>
                    </Card>
                  </Col>
                </Row>

                {activeTrafficSite?.detailSummary ? (
                  <Card size="small" title="流量细拆" style={{ borderRadius: 14 }}>
                    <Row gutter={[12, 12]}>
                      <Col xs={24} md={12}>
                        <Space direction="vertical" size={8} style={{ width: "100%" }}>
                          <div>详情访客 / 收藏人数：{formatTrafficNumber(activeTrafficSite.detailSummary.detailVisitorNum)} / {formatTrafficNumber(activeTrafficSite.detailSummary.collectUserNum)}</div>
                          <div>搜索曝光 / 点击 / 支付：{formatTrafficNumber(activeTrafficSite.detailSummary.searchExposeNum)} / {formatTrafficNumber(activeTrafficSite.detailSummary.searchClickNum)} / {formatTrafficNumber(activeTrafficSite.detailSummary.searchPayGoodsNum)}</div>
                          <div>推荐曝光 / 点击 / 支付：{formatTrafficNumber(activeTrafficSite.detailSummary.recommendExposeNum)} / {formatTrafficNumber(activeTrafficSite.detailSummary.recommendClickNum)} / {formatTrafficNumber(activeTrafficSite.detailSummary.recommendPayGoodsNum)}</div>
                        </Space>
                      </Col>
                      <Col xs={24} md={12}>
                        <Space direction="vertical" size={8} style={{ width: "100%" }}>
                          <div>支付订单数：{formatTrafficNumber(activeTrafficSite.detailSummary.payOrderNum)}</div>
                          <div>趋势曝光 / 支付订单：{formatTrafficNumber(activeTrafficSite.detailSummary.trendExposeNum)} / {formatTrafficNumber(activeTrafficSite.detailSummary.trendPayOrderNum)}</div>
                          <div>明细数据日期：{activeTrafficSite.detailSummary.dataDate || "-"}</div>
                        </Space>
                      </Col>
                    </Row>
                  </Card>
                ) : null}
              </Space>
            </Card>
          </Space>
        ) : null}

        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Text strong>从这个商品出发打词</Text>
          <Space wrap size={[6, 6]}>
            {suggestedKeywords.map((item) => <Tag key={item} style={{ cursor: "pointer" }} onClick={() => setKeyword(item)}>{item}</Tag>)}
          </Space>
        </Space>

        <Space wrap align="start">
          <Input
            prefix={<SearchOutlined />}
            placeholder="输入这个商品当前要打的关键词"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 360 }}
            allowClear
          />
          <Button
            type="primary"
            icon={<SearchOutlined />}
            loading={loading}
            onClick={handleSearch}
            style={{ background: TEMU_ORANGE, borderColor: TEMU_ORANGE }}
          >
            分析这个商品
          </Button>
        </Space>

        <div style={{ color: searchRows.length > 0 ? TEMU_ORANGE : "#8c8c8c", lineHeight: 1.8 }}>
          {searchRows.length > 0
            ? `已找到 ${searchRows.length} 个相似商品，当前关键词：${results?.keyword || keyword}。`
            : "先确定这次要打的关键词，再开始看市场结果。"}
        </div>
      </Space>
    </Card>
  );

  const renderSearchResultCard = () => (
    <Card
      title={`搜索结果 - ${results?.keyword || keyword} (${filteredSearchRows.length}/${searchRows.length})`}
      style={CARD_STYLE}
      size="small"
      extra={(
        <Space size={12}>
          <Button
            size="small"
            disabled={selectedResultKeys.length === 0}
            loading={trackingKeys.length > 0}
            onClick={() => {
              const selected = searchRows.filter((row: any) => selectedResultKeys.includes(String(row.goodsId || row.productUrl)));
              void handleAddSamples(selected);
            }}
          >
            加入当前商品对比 ({selectedResultKeys.length})
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>{results?.scrapedAt || ""}</Text>
        </Space>
      )}
    >
      <Table
        dataSource={sortedSearchRows}
        columns={searchColumns}
        rowKey={(record: any) => getSearchRowKey(record)}
        size="small"
        scroll={{ x: 1380 }}
        onChange={handleSearchTableChange}
        rowSelection={{ selectedRowKeys: selectedResultKeys, onChange: (keys) => setSelectedResultKeys(keys.map((key) => String(key))) }}
        pagination={{ pageSize: 12, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
      />
    </Card>
  );

  const renderSampleCard = () => (
    <div ref={sampleCardRef}>
    <Card
      title={`当前商品的对比样本 (${selectedSampleRows.length})`}
      size="small"
      style={CARD_STYLE}
      extra={(
        <Space>
          <Input
            prefix={<LinkOutlined />}
            placeholder="粘贴 Temu 商品链接"
            value={manualUrl}
            onChange={(event) => setManualUrl(event.target.value)}
            onPressEnter={handleManualAdd}
            style={{ width: 240 }}
            allowClear
          />
          <Button size="small" icon={<PlusOutlined />} loading={addingManual} onClick={handleManualAdd}>手动加入</Button>
          <Button size="small" icon={<ReloadOutlined />} loading={refreshingSamples} onClick={handleRefreshSelected} disabled={selectedSampleRows.length === 0}>刷新样本</Button>
        </Space>
      )}
    >
      {selectedSampleRows.length === 0 ? (
        <Empty description="先从搜索结果里挑 3-5 个真正可比的样本加入当前商品。" />
      ) : (
        <Table dataSource={selectedSampleRows} columns={sampleColumns} rowKey="url" size="small" pagination={false} tableLayout="fixed" />
      )}
    </Card>
    </div>
  );

  const renderStepTwo = () => (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Card style={CARD_STYLE}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <div>
            <Text strong style={{ fontSize: 20 }}>步骤 3：挑样本做竞品对比</Text>
            <div style={{ marginTop: 6, color: "#8c8c8c" }}>
              这里只保留这次分析里真正和你抢单的 3-5 个对象，用来判断你输在哪里、能靠什么赢。
            </div>
          </div>
          <div style={{ color: selectedSampleRows.length >= 3 && selectedSampleRows.length <= 5 ? TEMU_ORANGE : "#8c8c8c", lineHeight: 1.8 }}>
            {selectedSampleRows.length === 0
              ? "先给当前商品选 3-5 个可比样本，支持从搜索结果批量加入，也支持手动贴 Temu 链接补充。"
              : `当前商品已选 ${selectedSampleRows.length} 个对比样本，建议先保持在 3-5 个。`}
          </div>
        </Space>
      </Card>

      {searchRows.length > 0 ? renderSearchResultCard() : (
        <Card style={CARD_STYLE}>
          {results && (results.totalFound === 0 || (Array.isArray(results.products) && results.products.length === 0)) ? (
            (() => {
              const suggestions = buildKeywordSuggestions(
                keyword,
                selectedProduct?.title,
                (selectedProduct as any)?.category || (selectedProduct as any)?.categoryName,
              );
              return (
                <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                  <Empty description={`关键词"${results.keyword || keyword}"暂无可比样本。换个词再试试：`} />
                  {suggestions.length > 0 ? (
                    <div style={{ textAlign: "center" }}>
                      <Space size={[8, 8]} wrap style={{ justifyContent: "center" }}>
                        {suggestions.map((word) => (
                          <Tag
                            key={word}
                            color="orange"
                            style={{ cursor: "pointer", padding: "4px 10px", fontSize: 13 }}
                            onClick={() => {
                              setKeyword(word);
                              // 自动再搜一次
                              setTimeout(() => void handleSearch(), 0);
                            }}
                          >
                            {word}
                          </Tag>
                        ))}
                      </Space>
                      <div style={{ marginTop: 8, color: "#8c8c8c", fontSize: 12 }}>
                        点击标签可以直接替换关键词并重新搜索。
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: "center", color: "#8c8c8c" }}>
                      可以试着去掉修饰词，或用英文核心名词再搜一次。
                    </div>
                  )}
                </Space>
              );
            })()
          ) : (
            <Empty description="先完成关键词搜索，再来挑样本。" />
          )}
        </Card>
      )}

      <Row gutter={[16, 16]}>
        <Col span={16}>
          {renderSampleCard()}
        </Col>
        <Col span={8}>
          <Card title="这一步看什么" size="small" style={CARD_STYLE}>
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="优先挑谁">同用途、同价格带、同履约模式的样本。</Descriptions.Item>
                <Descriptions.Item label="建议数量">先选 3-5 个，不追求越多越好。</Descriptions.Item>
                <Descriptions.Item label="左侧 P0/P1/P2">这是样本优先级，不是店铺等级。</Descriptions.Item>
              </Descriptions>
              <Button
                type="primary"
                disabled={selectedSampleRows.length === 0}
                onClick={() => setActiveStep(3)}
                style={{ background: TEMU_ORANGE, borderColor: TEMU_ORANGE }}
              >
                查看动作建议
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );

  const renderStepThree = () => {
    const softPanelStyle: React.CSSProperties = {
      borderRadius: 14,
      border: "1px solid #f0f0f0",
      background: "#fafafa",
      padding: 16,
      height: "100%",
    };
    const accentPanelStyle: React.CSSProperties = {
      ...softPanelStyle,
      border: "1px solid rgba(229,91,0,0.16)",
      background: "linear-gradient(180deg, rgba(255,247,240,0.92) 0%, rgba(255,255,255,1) 100%)",
    };
    const outlinePanelStyle: React.CSSProperties = {
      ...softPanelStyle,
      background: "#fff",
      border: "1px solid rgba(229,91,0,0.12)",
    };
    void outlinePanelStyle; // 保留备用样式
    const sectionTitleStyle: React.CSSProperties = { fontSize: 13, color: "#8c8c8c" };
    const comparisonRows = analysis?.comparisonRows || [];
    const marketPanels = marketInsight ? [
      { label: "用户最看重", value: marketInsight.primaryNeed },
      { label: "建议切入", value: marketInsight.entryFocus },
      { label: "我的价格判断", value: priceBandStatus },
      { label: "我的素材判断", value: materialStatus },
      { label: "履约判断", value: marketInsight.warehouseInsight },
      { label: "下一步", value: marketInsight.nextAction },
    ] : [];
    const actionSections: Array<{ title: string; items: string[]; key: "why" | "today" | "week" | "sourcing" }> = analysis ? [
      { title: "为什么别人卖得更快", items: analysis.whyCompetitorsWin, key: "why" },
      { title: "今天先改", items: analysis.immediateActions, key: "today" },
      { title: "本周验证", items: analysis.weeklyActions, key: "week" },
      { title: "下批开发", items: analysis.sourcingActions, key: "sourcing" },
    ] : [];
    const whyWinSection = actionSections.find((section) => section.key === "why");
    const executionSections = actionSections.filter((section) => section.key !== "why");
    const trafficDiagnosisSummary = (() => {
      if (!activeTrafficSite) return "当前还没有可用的流量体检数据，先补齐商品流量采集。";
      if (activeTrafficSite.summary) {
        const expose = toSafeNumber(activeTrafficSite.summary.exposeNum);
        const click = toSafeNumber(activeTrafficSite.summary.clickNum);
        const buyer = toSafeNumber(activeTrafficSite.summary.buyerNum);
        const clickRate = toSafeNumber(activeTrafficSite.summary.exposeClickRate);
        const clickPayRate = toSafeNumber(activeTrafficSite.summary.clickPayRate);

        if (expose <= 0) return "当前问题先卡在曝光，先回到词路和切入价格带。";
        if (click <= 0 || clickRate < 0.015) return "当前有曝光但点击偏弱，优先改首图和标题前半段。";
        if (buyer <= 0 || clickPayRate < 0.02) return "当前有点击但支付承接偏弱，优先补信任感、规格和价格带。";
        return "当前流量承接已经有基础，可以继续放大有效关键词和素材。";
      }
      if (activeTrafficSite.latestTrendPoint) {
        return "当前站点只有整体趋势，先把商品级流量补齐后再判断具体掉点。";
      }
      return "当前还没有商品级流量数据，先补齐采集再判断流量问题。";
    })();
    const productCheckSections = [
      { title: "价格与切入", value: priceBandStatus },
      { title: "流量问题定位", value: trafficDiagnosisSummary },
      { title: "标题诊断", value: `${titleDiagnosis.status}：${titleDiagnosis.summary}` },
      { title: "主图诊断", value: `${imageDiagnosis.status}：${imageDiagnosis.summary}` },
    ];
    const monitorSections: Array<{ title: string; items: string[]; key: "daily" | "weekly" | "monthly" }> = analysis ? [
      { title: "每天盯什么", items: analysis.dailyChecklist, key: "daily" },
      { title: "每周复盘什么", items: analysis.weeklyChecklist, key: "weekly" },
      { title: "每月调整什么", items: analysis.monthlyChecklist, key: "monthly" },
    ] : [];
    const overviewStats = [
      { label: "机会分", value: marketInsight ? `${marketInsight.opportunityScore}/100` : "-" },
      { label: "建议价格带", value: marketInsight?.recommendedPriceBand || "-" },
      { label: "主需求", value: marketInsight?.primaryNeed || "-" },
      { label: "下一批扩款", value: analysis?.summary.nextProductDirection || "-" },
    ];
    const diagnosticSections = [...productCheckSections, ...productDataCompareSections];

    // Phase2·定位力升级：机会分拆解 / 价格带热力图 / 定位散点
    const opportunityBreakdown = marketInsight?.opportunityBreakdown ?? [];
    const priceBandMatrix = marketInsight?.priceBandMatrix ?? [];
    const maxBandSalesShare = Math.max(0.001, ...priceBandMatrix.map((b) => b.salesShare));
    const scatterSourceSnapshots = selectedSnapshots.length > 0 ? selectedSnapshots : resultSnapshots;
    const scatterPoints = scatterSourceSnapshots
      .map((snapshot: any) => {
        const price = toSafeNumber(snapshot?.price);
        const sales = toSafeNumber(snapshot?.monthlySales);
        if (price <= 0) return null;
        return {
          price,
          sales,
          title: String(snapshot?.title || "").slice(0, 60),
          hasVideo: Boolean(snapshot?.videoUrl || snapshot?.hasVideo),
        };
      })
      .filter(Boolean) as Array<{ price: number; sales: number; title: string; hasVideo: boolean }>;
    const myScatterPoint = selectedProduct
      ? {
          price: toSafeNumber(selectedProduct.price),
          sales: toSafeNumber(selectedProduct.monthlySales),
          title: selectedProduct.title || "我的商品",
        }
      : null;
    const recommendedBandCell = priceBandMatrix.find((b) => b.isRecommended);
    // 机会分拆解：负向项汇总、正向项汇总、基线 100
    const negativeSum = opportunityBreakdown.filter((f) => f.direction === "negative").reduce((sum, f) => sum + f.contribution, 0);
    const positiveSum = opportunityBreakdown.filter((f) => f.direction === "positive").reduce((sum, f) => sum + f.contribution, 0);
    const OPP_FACTOR_COLORS: Record<string, string> = {
      crowd: "#eb2f96",
      concentration: "#cf1322",
      score: "#fa8c16",
      video: "#d48806",
      review: "#faad14",
      priceBand: "#52c41a",
    };

    const renderOpportunityBreakdown = () => {
      if (!marketInsight || opportunityBreakdown.length === 0) return null;
      return (
        <Card title="机会分拆解 · 为什么是这个分数" size="small" style={CARD_STYLE}>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <div style={{ ...accentPanelStyle, textAlign: "center" }}>
                <Text type="secondary" style={sectionTitleStyle}>机会分</Text>
                <div style={{ fontSize: 44, fontWeight: 700, color: TEMU_ORANGE, lineHeight: 1.2, marginTop: 6 }}>
                  {marketInsight.opportunityScore}
                  <span style={{ fontSize: 16, color: "#8c8c8c", marginLeft: 4 }}>/100</span>
                </div>
                <div style={{ marginTop: 6, color: "#8c8c8c", fontSize: 12 }}>
                  基线 100，扣 {Math.round(negativeSum)}，加 {Math.round(positiveSum)}
                </div>
                <div style={{ marginTop: 12, fontSize: 12, color: "#595959", lineHeight: 1.7, textAlign: "left" }}>
                  {marketInsight.marketVerdict}，切入建议：{marketInsight.entryFocus}。
                </div>
              </div>
            </Col>
            <Col xs={24} md={16}>
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                {opportunityBreakdown.map((factor) => {
                  const denom = factor.direction === "negative" ? 38 : 18; // 最大扣分 38（拥挤度），最大加分 ~18
                  const widthPct = Math.min(100, (factor.contribution / denom) * 100);
                  const color = OPP_FACTOR_COLORS[factor.key] || "#1677ff";
                  return (
                    <div key={factor.key}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, marginBottom: 4 }}>
                        <Space size={6}>
                          <Tag color={factor.direction === "positive" ? "green" : "red"} style={{ marginInlineEnd: 0 }}>
                            {factor.direction === "positive" ? "+" : "-"}{Math.round(factor.contribution)}
                          </Tag>
                          <Text strong>{factor.label}</Text>
                          <Text type="secondary">{factor.rawLabel}</Text>
                        </Space>
                      </div>
                      <div style={{ background: "#f5f5f5", borderRadius: 4, height: 8, overflow: "hidden" }}>
                        <div style={{ width: `${widthPct}%`, height: "100%", background: color, opacity: factor.contribution > 0 ? 1 : 0.25 }} />
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: "#8c8c8c", lineHeight: 1.6 }}>
                        {factor.note}
                      </div>
                    </div>
                  );
                })}
              </Space>
            </Col>
          </Row>
        </Card>
      );
    };

    const renderPriceBandHeatmap = () => {
      if (!marketInsight || priceBandMatrix.length === 0) return null;
      return (
        <Card title="价格带热力图 · 哪里有供需缺口" size="small" style={CARD_STYLE}>
          <Row gutter={[12, 12]}>
            {priceBandMatrix.map((band) => {
              const heat = maxBandSalesShare > 0 ? band.salesShare / maxBandSalesShare : 0;
              // 热力：销量占比越高颜色越橙；商品占比越高边框越重
              const bg = band.isRecommended
                ? `rgba(82,196,26,${0.12 + heat * 0.35})`
                : `rgba(229,91,0,${0.06 + heat * 0.4})`;
              const borderColor = band.isRecommended ? "#52c41a" : "rgba(229,91,0,0.4)";
              // 商品占比与销量占比的差：正数 = 供给过剩，负数 = 蓝海
              const gap = band.countShare - band.salesShare;
              const gapText = gap > 0.08
                ? "供给过剩：商品多但销量没跟上"
                : gap < -0.08
                  ? "需求缺口：销量大但商品数少"
                  : "供需基本匹配";
              return (
                <Col xs={24} md={8} key={band.key}>
                  <div style={{ border: `1px solid ${borderColor}`, borderRadius: 12, padding: 14, background: bg, height: "100%" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <Text strong>{band.key === "low" ? "低价带" : band.key === "mid" ? "中价带" : "高价带"}</Text>
                      {band.isRecommended ? <Tag color="green" style={{ marginInlineEnd: 0 }}>推荐切入</Tag> : null}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6 }}>{band.label}</div>
                    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>商品占比</Text>
                        <div style={{ fontSize: 18, fontWeight: 600 }}>{Math.round(band.countShare * 100)}%</div>
                        <Text type="secondary" style={{ fontSize: 11 }}>{band.count} 个样本</Text>
                      </div>
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>销量占比</Text>
                        <div style={{ fontSize: 18, fontWeight: 600, color: TEMU_ORANGE }}>{Math.round(band.salesShare * 100)}%</div>
                        <Text type="secondary" style={{ fontSize: 11 }}>累计 {Math.round(band.sales).toLocaleString()}</Text>
                      </div>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 12, color: "#595959", lineHeight: 1.6 }}>
                      {gapText}。
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>
          {recommendedBandCell ? (
            <div style={{ marginTop: 12, fontSize: 12, color: "#8c8c8c" }}>
              推荐 <Text strong style={{ color: "#52c41a" }}>{recommendedBandCell.label}</Text>：销量占比 {Math.round(recommendedBandCell.salesShare * 100)}%，商品占比 {Math.round(recommendedBandCell.countShare * 100)}%，供需缝隙 {Math.round((recommendedBandCell.salesShare - recommendedBandCell.countShare) * 100)}pt。
            </div>
          ) : null}
        </Card>
      );
    };

    // ================= Phase 3 · 差距力升级 =================
    // 统一的工具：中位数 & 安全百分比差
    const medianOf = (nums: number[]) => {
      const valid = nums.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
      if (valid.length === 0) return 0;
      const mid = Math.floor(valid.length / 2);
      return valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid];
    };
    // 样本 snapshot 源：优先已选样本，降级到搜索样本
    const peerSnapshots = selectedSnapshots.length > 0 ? selectedSnapshots : resultSnapshots;
    const myStat = selectedYunqiDisplay || selectedProduct;
    const myPrice = toSafeNumber(myStat?.price);
    const myMonthly = toSafeNumber(myStat?.monthlySales);
    const myScore = toSafeNumber(myStat?.score);
    const myReview = toSafeNumber(myStat?.reviewCount);
    const myHasVideo = Boolean(myStat?.hasVideo);
    const myTitle = String(myStat?.title || selectedProduct?.title || "").toLowerCase();

    // P3.3：样本标题高频词
    const TITLE_STOP = new Set([
      "for", "with", "and", "the", "a", "an", "of", "to", "in", "on", "by", "at", "or", "new",
      "pcs", "pack", "set", "pieces", "piece", "size", "color", "style", "hot", "top",
      "2024", "2025", "2026", "free", "shipping", "us", "usa",
    ]);
    const tokenize = (text: string) => String(text || "").toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((w) => w.length >= 3 && !TITLE_STOP.has(w));
    const keywordCoverage = (() => {
      if (peerSnapshots.length === 0) return [] as Array<{ word: string; freq: number; coverRate: number; myHas: boolean }>;
      const freqMap = new Map<string, number>();
      const docCount = peerSnapshots.length;
      peerSnapshots.forEach((snap: any) => {
        const words = new Set(tokenize(snap?.title));
        words.forEach((w) => freqMap.set(w, (freqMap.get(w) || 0) + 1));
      });
      const myWords = new Set(tokenize(myTitle));
      return [...freqMap.entries()]
        .map(([word, freq]) => ({ word, freq, coverRate: freq / docCount, myHas: myWords.has(word) }))
        .filter((item) => item.coverRate >= 0.3) // 至少 30% 样本覆盖
        .sort((a, b) => b.coverRate - a.coverRate)
        .slice(0, 12);
    })();
    const missingKeywords = keywordCoverage.filter((item) => !item.myHas);

    // P3.1：对位矩阵 — 每个已选样本一行
    const comparisonMatrix = selectedSampleRows.slice(0, 10).map((row: any) => {
      const peer = row.latest || {};
      const peerPrice = toSafeNumber(peer.price);
      const peerMonthly = toSafeNumber(peer.monthlySales);
      const peerScore = toSafeNumber(peer.score);
      const peerReview = toSafeNumber(peer.reviewCount) || parseReviewCountText(peer.commentNumTips);
      const peerHasVideo = Boolean(peer.videoUrl || peer.hasVideo);
      const peerWords = new Set(tokenize(peer.title));
      const myWords = new Set(tokenize(myTitle));
      const coveredByMe = [...peerWords].filter((w) => myWords.has(w)).length;
      const coverRate = peerWords.size > 0 ? coveredByMe / peerWords.size : 0;
      return {
        key: row.url,
        title: peer.title || row.title || row.url,
        priority: row.signal?.priority || "P2",
        trafficSource: row.signal?.trafficSource || "-",
        priceDelta: myPrice > 0 && peerPrice > 0 ? (myPrice - peerPrice) / peerPrice : 0,
        monthlyDelta: peerMonthly > 0 ? (myMonthly - peerMonthly) / peerMonthly : 0,
        scoreDelta: peerScore > 0 ? myScore - peerScore : 0, // 绝对值差
        reviewDelta: peerReview > 0 ? (myReview - peerReview) / peerReview : 0,
        videoDelta: myHasVideo ? (peerHasVideo ? 0 : 1) : (peerHasVideo ? -1 : 0),
        keywordCoverage: coverRate,
        weakness: row.signal?.weakness || "",
      };
    });

    // 差距颜色：我赢绿、我输红、基本打平灰
    const deltaCellStyle = (delta: number, winIfPositive = true, threshold = 0.08): React.CSSProperties => {
      if (!Number.isFinite(delta)) return {};
      const abs = Math.abs(delta);
      if (abs < threshold) return { color: "#8c8c8c" };
      const isPositive = delta > 0;
      const iWin = winIfPositive ? isPositive : !isPositive;
      return { color: iWin ? "#389e0d" : "#cf1322", fontWeight: 600 };
    };
    const formatPct = (value: number, withSign = true) => {
      const pct = Math.round(value * 100);
      return `${withSign && pct > 0 ? "+" : ""}${pct}%`;
    };

    const renderGapMatrix = () => {
      if (comparisonMatrix.length === 0) return null;
      return (
        <Card title="差距对位矩阵 · 每个样本在哪里赢我" size="small" style={CARD_STYLE}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 880 }}>
              <thead>
                <tr style={{ color: "#8c8c8c", background: "#fafafa" }}>
                  <th style={{ padding: "8px 10px", textAlign: "left" }}>样本</th>
                  <th style={{ padding: "8px 10px" }}>价格差</th>
                  <th style={{ padding: "8px 10px" }}>月销差</th>
                  <th style={{ padding: "8px 10px" }}>评分差</th>
                  <th style={{ padding: "8px 10px" }}>评价差</th>
                  <th style={{ padding: "8px 10px" }}>素材</th>
                  <th style={{ padding: "8px 10px" }}>标题词覆盖</th>
                  <th style={{ padding: "8px 10px", textAlign: "left" }}>流量来源 / 弱点</th>
                </tr>
              </thead>
              <tbody>
                {comparisonMatrix.map((row) => (
                  <tr key={row.key} style={{ borderTop: "1px solid #f4f4f4" }}>
                    <td style={{ padding: "8px 10px" }}>
                      <Space size={6} wrap>
                        <Tag color={row.priority === "P0" ? "red" : row.priority === "P1" ? "orange" : "default"} style={{ marginInlineEnd: 0 }}>{row.priority}</Tag>
                        <Text ellipsis style={{ maxWidth: 240 }}>{row.title}</Text>
                      </Space>
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center", ...deltaCellStyle(row.priceDelta, false) }}>
                      {row.priceDelta === 0 ? "-" : formatPct(row.priceDelta)}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center", ...deltaCellStyle(row.monthlyDelta, true) }}>
                      {row.monthlyDelta === 0 ? "-" : formatPct(row.monthlyDelta)}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center", ...deltaCellStyle(row.scoreDelta, true, 0.1) }}>
                      {row.scoreDelta === 0 ? "-" : `${row.scoreDelta > 0 ? "+" : ""}${row.scoreDelta.toFixed(2)}`}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center", ...deltaCellStyle(row.reviewDelta, true) }}>
                      {row.reviewDelta === 0 ? "-" : formatPct(row.reviewDelta)}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>
                      {row.videoDelta === 0 ? <Tag style={{ marginInlineEnd: 0 }}>平</Tag> : row.videoDelta > 0 ? <Tag color="green" style={{ marginInlineEnd: 0 }}>我有</Tag> : <Tag color="red" style={{ marginInlineEnd: 0 }}>缺</Tag>}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center", ...deltaCellStyle(row.keywordCoverage - 0.7, true, 0.1) }}>
                      {Math.round(row.keywordCoverage * 100)}%
                    </td>
                    <td style={{ padding: "8px 10px", color: "#595959" }}>
                      <div><Tag color="geekblue" style={{ marginInlineEnd: 0 }}>{row.trafficSource}</Tag></div>
                      {row.weakness ? <div style={{ marginTop: 4, fontSize: 11, color: "#8c8c8c" }}>{row.weakness}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "#8c8c8c", lineHeight: 1.7 }}>
            红色 = 我输、绿色 = 我赢、灰色 = 基本打平（阈值 8% 或 0.1 分）。价格低 / 月销高 / 评分高 / 评价多 / 有视频 / 标题词覆盖高 都算赢。
          </div>
        </Card>
      );
    };

    // P3.2：差距雷达图（归一化到 0-100，我的 vs 竞品中位数）
    const radarData = (() => {
      if (peerSnapshots.length === 0) return [];
      const peerPrices = peerSnapshots.map((s: any) => toSafeNumber(s.price)).filter((v: number) => v > 0);
      const peerMonthly = peerSnapshots.map((s: any) => toSafeNumber(s.monthlySales));
      const peerScores = peerSnapshots.map((s: any) => toSafeNumber(s.score));
      const peerReviews = peerSnapshots.map((s: any) => toSafeNumber(s.reviewCount) || parseReviewCountText(s.commentNumTips));
      const peerVideoRate = peerSnapshots.filter((s: any) => Boolean(s.videoUrl || s.hasVideo)).length / peerSnapshots.length;
      const peerPriceMed = medianOf(peerPrices);
      const peerMonthlyMed = medianOf(peerMonthly);
      const peerScoreMed = medianOf(peerScores);
      const peerReviewMed = medianOf(peerReviews);
      // 标题词匹配：我 vs 竞品（以样本内高频词集为基准，竞品"完全覆盖" = 100）
      const hotWords = keywordCoverage.map((k) => k.word);
      const myWordSet = new Set(tokenize(myTitle));
      const myHotCoverRate = hotWords.length > 0 ? hotWords.filter((w) => myWordSet.has(w)).length / hotWords.length : 0;
      // 归一化：我的 / 峰值 * 100，其中"价格力"取倒数（价格低 = 力强）
      const normalize = (value: number, peak: number, invert = false) => {
        if (peak <= 0) return 0;
        const raw = invert ? peak / Math.max(value, 0.01) : value / peak;
        return Math.max(0, Math.min(100, Math.round(raw * 100)));
      };
      const peak = {
        price: Math.max(peerPriceMed, myPrice),
        monthly: Math.max(peerMonthlyMed, myMonthly, 1),
        score: 5,
        review: Math.max(peerReviewMed, myReview, 1),
        video: 1,
        keyword: 1,
      };
      return [
        { axis: "价格力", me: normalize(myPrice || peerPriceMed, peak.price, true), peer: normalize(peerPriceMed, peak.price, true) },
        { axis: "销量规模", me: normalize(myMonthly, peak.monthly), peer: normalize(peerMonthlyMed, peak.monthly) },
        { axis: "评分", me: normalize(myScore, peak.score), peer: normalize(peerScoreMed, peak.score) },
        { axis: "评价壁垒", me: normalize(myReview, peak.review), peer: normalize(peerReviewMed, peak.review) },
        { axis: "素材", me: myHasVideo ? 100 : 20, peer: Math.round(peerVideoRate * 100) },
        { axis: "标题匹配", me: Math.round(myHotCoverRate * 100), peer: 100 },
      ];
    })();

    const biggestGap = (() => {
      if (radarData.length === 0) return null;
      const sorted = [...radarData].sort((a, b) => (a.me - a.peer) - (b.me - b.peer));
      const worst = sorted[0];
      if (!worst || worst.me >= worst.peer) return null;
      return worst;
    })();

    const renderGapRadar = () => {
      if (radarData.length === 0) return null;
      return (
        <Card title="差距雷达 · 我 vs 竞品中位数" size="small" style={CARD_STYLE}>
          <Row gutter={[12, 12]}>
            <Col xs={24} md={14}>
              <div style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} outerRadius="72%">
                    <PolarGrid />
                    <PolarAngleAxis dataKey="axis" tick={{ fontSize: 12 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Radar name="竞品中位数" dataKey="peer" stroke="#ff8a1f" fill="#ff8a1f" fillOpacity={0.25} />
                    <Radar name="我" dataKey="me" stroke="#1677ff" fill="#1677ff" fillOpacity={0.35} />
                    <Legend />
                    <RTooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </Col>
            <Col xs={24} md={10}>
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <div style={accentPanelStyle}>
                  <Text type="secondary" style={sectionTitleStyle}>最大差距</Text>
                  <div style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: TEMU_ORANGE }}>
                    {biggestGap ? `${biggestGap.axis}（差 ${biggestGap.peer - biggestGap.me} 分）` : "当前所有维度都不落下风"}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: "#595959", lineHeight: 1.7 }}>
                    {biggestGap
                      ? `先把「${biggestGap.axis}」补到竞品中位水平，再谈做加法。`
                      : "继续放大现有优势词路和素材即可。"}
                  </div>
                </div>
                {radarData.map((row) => {
                  const gap = row.me - row.peer;
                  const iWin = gap >= 0;
                  return (
                    <div key={row.axis} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                      <Text>{row.axis}</Text>
                      <Space size={6}>
                        <Text type="secondary" style={{ fontSize: 12 }}>{row.me} / {row.peer}</Text>
                        <Tag color={iWin ? "green" : "red"} style={{ marginInlineEnd: 0 }}>
                          {iWin ? `+${gap}` : gap}
                        </Tag>
                      </Space>
                    </div>
                  );
                })}
              </Space>
            </Col>
          </Row>
        </Card>
      );
    };

    // P3.3：标题关键词覆盖差距
    const renderKeywordCoverage = () => {
      if (keywordCoverage.length === 0) return null;
      return (
        <Card
          title="标题关键词覆盖 · 头部普遍打但我没打的词"
          size="small"
          style={CARD_STYLE}
          extra={<Text type="secondary" style={{ fontSize: 12 }}>只看至少 30% 样本覆盖的高频词</Text>}
        >
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>我缺的高频词（{missingKeywords.length}）</Text>
              <div style={{ marginTop: 8 }}>
                {missingKeywords.length === 0 ? (
                  <Text type="secondary">头部高频词已经都在你的标题里了。</Text>
                ) : (
                  <Space wrap size={[8, 8]}>
                    {missingKeywords.map((item) => (
                      <Tooltip key={item.word} title={`${Math.round(item.coverRate * 100)}% 样本标题里有这个词，点击加入当前关键词`}>
                        <Tag
                          color="red"
                          style={{ cursor: "pointer", padding: "4px 10px", fontSize: 13 }}
                          onClick={() => {
                            const nextKeyword = keyword.trim() ? `${keyword.trim()} ${item.word}` : item.word;
                            setKeyword(nextKeyword);
                            message.success(`已把"${item.word}"加入关键词，回到步骤 2 重新搜索`);
                            setActiveStep(1);
                          }}
                        >
                          {item.word} <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>{Math.round(item.coverRate * 100)}%</Text>
                        </Tag>
                      </Tooltip>
                    ))}
                  </Space>
                )}
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>我已覆盖的高频词（{keywordCoverage.length - missingKeywords.length}）</Text>
              <div style={{ marginTop: 8 }}>
                <Space wrap size={[8, 8]}>
                  {keywordCoverage.filter((k) => k.myHas).map((item) => (
                    <Tag key={item.word} color="green" style={{ marginInlineEnd: 0 }}>
                      {item.word} <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>{Math.round(item.coverRate * 100)}%</Text>
                    </Tag>
                  ))}
                </Space>
              </div>
            </div>
          </Space>
        </Card>
      );
    };

    const renderPositioningScatter = () => {
      if (!marketInsight || scatterPoints.length === 0) return null;
      return (
        <Card title="定位散点 · 我在市场里的位置" size="small" style={CARD_STYLE}>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 12, right: 24, bottom: 12, left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" dataKey="price" name="价格" unit="$" fontSize={11} />
                <YAxis type="number" dataKey="sales" name="月销" fontSize={11} />
                <ZAxis type="number" range={[60, 60]} />
                <RTooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  formatter={(value: any, name: string) => {
                    if (name === "价格") return [`$${Number(value).toFixed(2)}`, name];
                    if (name === "月销") return [Number(value).toLocaleString(), name];
                    return [value, name];
                  }}
                  content={({ active, payload }: any) => {
                    if (!active || !payload || !payload.length) return null;
                    const p = payload[0].payload;
                    return (
                      <div style={{ background: "#fff", border: "1px solid #e5e5e5", borderRadius: 8, padding: 8, fontSize: 12, maxWidth: 260 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.title || "-"}</div>
                        <div>价格：${Number(p.price || 0).toFixed(2)}</div>
                        <div>月销：{Number(p.sales || 0).toLocaleString()}</div>
                        {p.hasVideo ? <div style={{ color: "#1677ff" }}>含视频素材</div> : null}
                      </div>
                    );
                  }}
                />
                {recommendedBandCell ? (
                  <>
                    <ReferenceLine x={recommendedBandCell.min} stroke="#52c41a" strokeDasharray="4 4" label={{ value: `推荐带下限 $${recommendedBandCell.min.toFixed(2)}`, position: "insideTopLeft", fontSize: 10, fill: "#52c41a" }} />
                    <ReferenceLine x={recommendedBandCell.max} stroke="#52c41a" strokeDasharray="4 4" label={{ value: `推荐带上限 $${recommendedBandCell.max.toFixed(2)}`, position: "insideTopRight", fontSize: 10, fill: "#52c41a" }} />
                  </>
                ) : null}
                <Scatter name="样本" data={scatterPoints} fill="#ff8a1f" fillOpacity={0.65} />
                {myScatterPoint && myScatterPoint.price > 0 ? (
                  <Scatter name="我的商品" data={[myScatterPoint]} fill="#1677ff" shape="star" />
                ) : null}
                <Legend />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "#8c8c8c", lineHeight: 1.7 }}>
            绿色虚线框住的是推荐价格带，橙色点是样本，蓝色星是你的商品。如果蓝星远离绿框或远离橙色密集区，就是定位错配。
          </div>
        </Card>
      );
    };

    const renderInsightPanel = (
      title: string,
      value: string,
      options?: { accent?: boolean; rows?: number }
    ) => (
      <div style={options?.accent ? accentPanelStyle : softPanelStyle}>
        <Text type="secondary" style={sectionTitleStyle}>{title}</Text>
        <Paragraph
          style={{ marginTop: 8, marginBottom: 0, lineHeight: 1.75 }}
          ellipsis={options?.rows ? { rows: options.rows, tooltip: value } : undefined}
        >
          {value}
        </Paragraph>
      </div>
    );

    // 动作清单：纯文本列表
    const renderActionBoard = (
      title: string,
      items: string[],
      accent?: boolean,
      _sectionKey: string = "misc",
    ) => (
      <div style={accent ? accentPanelStyle : softPanelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Text strong>{title}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>共 {items.length} 条</Text>
        </div>
        <List
          size="small"
          dataSource={items}
          locale={{ emptyText: "暂无动作" }}
          renderItem={(item) => (
            <List.Item style={{ paddingInline: 0, paddingBlock: 8, alignItems: "flex-start", borderBottom: "1px solid #f4f4f4" }}>
              <Text style={{ lineHeight: 1.75, color: "#262626" }}>{item}</Text>
            </List.Item>
          )}
        />
      </div>
    );

    // 今日清单：生成 Markdown 并复制（纯文本）
    const collectAllActions = (): Array<{ section: string; text: string }> => {
      if (!analysis) return [];
      const sections = [
        { title: "今天先改", items: analysis.immediateActions },
        { title: "本周验证", items: analysis.weeklyActions },
        { title: "下批开发", items: analysis.sourcingActions },
      ];
      const out: Array<{ section: string; text: string }> = [];
      sections.forEach((section) => {
        section.items.forEach((text) => out.push({ section: section.title, text }));
      });
      return out;
    };
    const copyTodayChecklist = () => {
      if (!analysis || !selectedProduct) return message.warning("还没有动作可以复制");
      const allActions = collectAllActions();
      if (allActions.length === 0) return message.warning("还没有动作可以复制");
      const lines: string[] = [];
      lines.push(`# 今日运营清单 · ${selectedProduct.title}`);
      lines.push(`> 生成时间：${new Date().toLocaleString()} · 共 ${allActions.length} 条`);
      lines.push("");
      const bySection = allActions.reduce((acc, item) => {
        (acc[item.section] ||= []).push(item);
        return acc;
      }, {} as Record<string, typeof allActions>);
      Object.entries(bySection).forEach(([title, list]) => {
        lines.push(`## ${title}`);
        list.forEach((item) => lines.push(`- ${item.text}`));
        lines.push("");
      });
      const md = lines.join("\n");
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(md).then(() => message.success("今日清单已复制，粘到群里或文档里")).catch(() => message.error("复制失败，请手动选中"));
      } else {
        message.info("浏览器不支持剪贴板，请手动选中下方文本");
      }
      console.log(md);
    };
    const actionProgress = (() => {
      if (!analysis) return null;
      const all = collectAllActions();
      if (all.length === 0) return null;
      return { total: all.length };
    })();

    const renderComparisonEvidence = (item: ComparisonRow) => {
      const tagList = String(item.tags || "")
        .split(/[、，,\/|]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 4);
      return (
        <div key={item.key} style={softPanelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Paragraph ellipsis={{ rows: 2, tooltip: item.competitorTitle }} style={{ marginBottom: 8, fontWeight: 600, lineHeight: 1.5 }}>
                {displayTitle(item.competitorTitle)}
              </Paragraph>
              <Space wrap size={[6, 6]}>
                <Tag color={item.priority === "P0" ? "red" : item.priority === "P1" ? "orange" : "default"}>{item.priority}</Tag>
                {item.hasVideo ? <Tag color="green">有视频</Tag> : <Tag>缺视频</Tag>}
                {item.goodsId ? <Tag>Goods {item.goodsId}</Tag> : null}
                {tagList.map((tag) => <Tag key={`${item.key}-${tag}`} color="orange">{tag}</Tag>)}
              </Space>
            </div>
            {item.competitorUrl ? (
              <Button size="small" type="link" icon={<LinkOutlined />} href={item.competitorUrl} target="_blank">
                查看
              </Button>
            ) : null}
          </div>

          <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
            <Col xs={12} md={6}>
              <Text type="secondary">价格</Text>
              <div style={{ marginTop: 4, fontWeight: 600, color: TEMU_ORANGE }}>{item.currentPrice || "-"}</div>
            </Col>
            <Col xs={12} md={6}>
              <Text type="secondary">日销</Text>
              <div style={{ marginTop: 4, fontWeight: 600 }}>{toSafeNumber(item.dailySales).toLocaleString()}</div>
            </Col>
            <Col xs={24} md={6}>
              <Text type="secondary">流量来源</Text>
              <div style={{ marginTop: 4, fontWeight: 600 }}>{item.trafficSource || "-"}</div>
            </Col>
            <Col xs={24} md={6}>
              <Text type="secondary">它为什么赢</Text>
              <Paragraph style={{ marginTop: 4, marginBottom: 0, lineHeight: 1.6 }} ellipsis={{ rows: 3, tooltip: item.winningHook || "-" }}>
                {item.winningHook || "-"}
              </Paragraph>
            </Col>
          </Row>

          <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
            <Col xs={24} md={12}>
              <div style={{ ...accentPanelStyle, padding: 14 }}>
                <Text type="secondary">我方差距</Text>
                <Paragraph style={{ marginTop: 6, marginBottom: 0, lineHeight: 1.7 }} ellipsis={{ rows: 3, tooltip: item.gap || "-" }}>
                  {item.gap || "-"}
                </Paragraph>
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div style={{ ...softPanelStyle, padding: 14 }}>
                <Text type="secondary">优先动作</Text>
                <Paragraph style={{ marginTop: 6, marginBottom: 0, lineHeight: 1.7 }} ellipsis={{ rows: 3, tooltip: item.responseAction || "-" }}>
                  {item.responseAction || "-"}
                </Paragraph>
              </div>
            </Col>
          </Row>
        </div>
      );
    };

    // ========== 精简版头部结论条：一句话 + 4 列 Stat ==========
    const renderHeroSummary = () => (
      <Card style={{ ...CARD_STYLE, background: "linear-gradient(135deg, rgba(255,247,240,0.98) 0%, rgba(255,255,255,1) 100%)" }}>
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <Text strong style={{ fontSize: 20 }}>步骤 4 · 决策总览</Text>
              {analysis ? (
                <div style={{ marginTop: 8, fontSize: 14, color: "#262626", lineHeight: 1.8 }}>
                  <Tag color="orange" style={{ marginRight: 6 }}>{analysis.summary.canCompete}</Tag>
                  关键词判断：<Text strong>{analysis.summary.keywordDecision}</Text>
                </div>
              ) : (
                <div style={{ marginTop: 6, color: "#8c8c8c" }}>
                  先选好样本，再生成当前商品的动作判断。
                </div>
              )}
            </div>
            {marketInsight ? (
              <Space size={6} wrap>
                <Tag color="orange">{marketInsight.marketVerdict}</Tag>
                <Tag color="gold">价格带 {marketInsight.recommendedPriceBand}</Tag>
                <Tag color="blue">样本 {results?.totalFound || resultSnapshots.length}</Tag>
              </Space>
            ) : null}
          </div>
          {analysis ? (
            <Row gutter={[12, 12]}>
              {overviewStats.map((item, idx) => (
                <Col xs={12} md={6} key={item.label}>
                  <div style={{ background: "#fff", border: "1px solid rgba(229,91,0,0.12)", borderRadius: 12, padding: 14, height: "100%" }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{item.label}</Text>
                    <div style={{ marginTop: 6, fontSize: idx === 0 ? 22 : 15, fontWeight: 600, color: idx === 0 ? TEMU_ORANGE : "#262626", lineHeight: 1.4 }}>
                      {item.value}
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          ) : null}
          {analysis ? (
            <div style={{ fontSize: 13, color: "#595959", lineHeight: 1.7, padding: "10px 12px", background: "rgba(255,255,255,0.6)", borderRadius: 8 }}>
              <Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>为什么还能赢</Text>
              {analysis.summary.winAngle}
            </div>
          ) : null}
        </Space>
      </Card>
    );

    // ========== Tab 1 · 结论与动作 ==========
    const renderConclusionTab = () => {
      if (!analysis) return <Empty description="先选好样本，再生成动作建议。" />;
      return (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={14}>
              <Card
                title="动作待办 · 按优先级排"
                size="small"
                style={CARD_STYLE}
                extra={
                  actionProgress ? (
                    <Space size={8}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        共 {actionProgress.total} 条
                      </Text>
                      <Button size="small" icon={<CopyOutlined />} onClick={copyTodayChecklist}>
                        复制今日清单
                      </Button>
                    </Space>
                  ) : null
                }
              >
                <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                  {whyWinSection ? renderActionBoard(whyWinSection.title, whyWinSection.items, true, whyWinSection.key) : null}
                  {executionSections.map((section) => (
                    <div key={section.key}>{renderActionBoard(section.title, section.items, false, section.key)}</div>
                  ))}
                </Space>
              </Card>
            </Col>
            <Col xs={24} xl={10}>
              <Card title="持续监控 · 盯什么指标" size="small" style={CARD_STYLE}>
                <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                  {monitorSections.map((section) => (
                    <div key={section.key}>{renderActionBoard(section.title, section.items, false, section.key)}</div>
                  ))}
                </Space>
              </Card>
            </Col>
          </Row>
          <Card
            title={`证据样本 · Top ${Math.min(3, comparisonRows.length)}`}
            size="small"
            style={CARD_STYLE}
            extra={<Text type="secondary" style={{ fontSize: 12 }}>价格、销量、流量来源、差距、动作</Text>}
          >
            {comparisonRows.length === 0 ? (
              <Empty description="先从步骤 3 挑 3-5 个真正可比的样本。" />
            ) : (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                {comparisonRows.slice(0, 3).map((item) => renderComparisonEvidence(item))}
              </Space>
            )}
          </Card>
        </Space>
      );
    };

    // ========== Tab 2 · 市场定位 ==========
    const renderMarketTab = () => {
      if (!marketInsight) return <Empty description="先完成搜索，再看市场定位。" />;
      return (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          {renderOpportunityBreakdown()}
          {renderPriceBandHeatmap()}
          {scatterPoints.length > 0 ? renderPositioningScatter() : null}
          <Card title="价格分布" size="small" style={CARD_STYLE}
            extra={(
              <Space size={6}>
                <Tag color="gold">均价 ${avgPrice.toFixed(2)}</Tag>
                <Tag color="orange">机会分 {marketInsight.opportunityScore}/100</Tag>
              </Space>
            )}>
            {priceDistribution.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先搜索这个商品的核心关键词" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={priceDistribution}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="range" fontSize={11} />
                  <YAxis fontSize={11} />
                  <RTooltip />
                  <Bar dataKey="count" name="商品数" radius={[6, 6, 0, 0]}>
                    {priceDistribution.map((_: any, index: number) => <Cell key={index} fill={PRICE_COLORS[index % PRICE_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Space>
      );
    };

    // ========== Tab 3 · 竞品差距 ==========
    const renderGapTab = () => {
      if (comparisonMatrix.length === 0 && radarData.length === 0 && keywordCoverage.length === 0) {
        return <Empty description="先选 3-5 个竞品样本，再看差距分析。" />;
      }
      return (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          {comparisonMatrix.length > 0 ? renderGapMatrix() : null}
          {radarData.length > 0 ? renderGapRadar() : null}
          {keywordCoverage.length > 0 ? renderKeywordCoverage() : null}
        </Space>
      );
    };

    // ========== 诊断详情（扁平展开） ==========
    const renderDiagnosticsSection = () => (
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Card title="我的商品诊断（价格 / 流量 / 标题 / 主图 等）" size="small" style={CARD_STYLE}>
          <Row gutter={[12, 12]}>
            {diagnosticSections.map((item) => (
              <Col xs={24} md={12} key={item.title}>
                {renderInsightPanel(item.title, item.value, { rows: 4 })}
              </Col>
            ))}
          </Row>
        </Card>
        <Card title="市场与竞品判断（评价 / 履约 / 六格说明）" size="small" style={CARD_STYLE}>
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <div style={accentPanelStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <Text strong>市场盘面</Text>
                <Space wrap size={[6, 6]}>
                  <Tag color="orange">{marketInsight?.marketVerdict}</Tag>
                  <Tag color="gold">价格带 {marketInsight?.recommendedPriceBand}</Tag>
                </Space>
              </div>
              {marketInsight ? (
                <Paragraph style={{ marginTop: 8, marginBottom: 0, lineHeight: 1.8 }}>
                  当前词更看重 {marketInsight.primaryNeed}，建议从 {marketInsight.entryFocus} 切入。Top10 集中度 {formatPercentText(marketInsight.top10SalesShare)}，视频覆盖 {formatPercentText(marketInsight.videoRate)}。
                </Paragraph>
              ) : null}
            </div>
            <Row gutter={[12, 12]}>
              {[...reviewTrustSections, ...fulfillmentSections, ...marketPanels].map((item: any) => (
                <Col xs={24} md={12} xl={8} key={item.title || item.label}>
                  {renderInsightPanel((item.title || item.label) as string, item.value, { rows: 4 })}
                </Col>
              ))}
            </Row>
          </Space>
        </Card>
      </Space>
    );

    // ========== 主图视觉对比（基于已加入对比的链接，自动触发）==========
    const renderVisionCompareCard = () => {
      const hasMyImage = Boolean(firstTextValue(selectedYunqiDisplay?.imageUrl, selectedProductMeta?.imageUrl));
      const competitorCount = selectedSampleRows.slice(0, 3).filter((row) => {
        const latest = row.latest as any;
        return Boolean(firstTextValue(latest?.imageUrl, latest?.imageUrls?.[0]));
      }).length;

      return (
        <Card
          size="small"
          title={(
            <Space size={8}>
              <RobotOutlined style={{ color: TEMU_ORANGE }} />
              <Text strong>主图视觉对比（Gemini）</Text>
              {visionLoading ? <Tag color="processing">分析中</Tag> : null}
            </Space>
          )}
          extra={(
            <Space size={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                对比 {hasMyImage ? "我方 + " : ""}{competitorCount} 张竞品主图
              </Text>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={visionLoading}
                onClick={() => {
                  visionFingerprintRef.current = ""; // 清掉指纹，强制重跑
                  void runVisionCompare();
                }}
                disabled={!hasMyImage && competitorCount === 0}
              >
                重新分析
              </Button>
            </Space>
          )}
          style={CARD_STYLE}
        >
          {visionLoading && !visionResult ? (
            <div style={{ padding: "20px 0", textAlign: "center", color: "#8c8c8c" }}>
              正在把我方主图和竞品主图丢给 Gemini 做视觉对比，通常 10-30 秒…
            </div>
          ) : visionError ? (
            <Alert type="error" showIcon message="AI 视觉对比失败" description={visionError} />
          ) : !hasMyImage && competitorCount === 0 ? (
            <Empty description="需要先关联我方主图或在步骤 3 勾选带主图的竞品样本" />
          ) : visionResult ? (
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              {Array.isArray(visionResult.imageErrors) && visionResult.imageErrors.length > 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message={`${visionResult.imageErrors.length} 张图片拉取失败，已自动跳过`}
                  description={visionResult.imageErrors.map((item) => `${item.title}: ${item.error}`).join("；")}
                />
              ) : null}

              {visionResult.rawText ? (
                <Alert
                  type="info"
                  showIcon
                  message="AI 未按 JSON 格式返回，下方为原始文本"
                  description={<pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{visionResult.rawText}</pre>}
                />
              ) : null}

              <Row gutter={[16, 16]}>
                {visionResult.myStrengths.length > 0 ? (
                  <Col xs={24} md={12}>
                    <Text strong style={{ color: "#52c41a" }}>我方主图优势</Text>
                    <List
                      size="small"
                      dataSource={visionResult.myStrengths}
                      renderItem={(item) => (
                        <List.Item style={{ paddingInline: 0 }}>
                          <Text>✓ {item}</Text>
                        </List.Item>
                      )}
                    />
                  </Col>
                ) : null}

                {visionResult.myWeaknesses.length > 0 ? (
                  <Col xs={24} md={12}>
                    <Text strong style={{ color: "#fa541c" }}>我方主图短板</Text>
                    <List
                      size="small"
                      dataSource={visionResult.myWeaknesses}
                      renderItem={(item) => (
                        <List.Item style={{ paddingInline: 0 }}>
                          <Text>▲ {item}</Text>
                        </List.Item>
                      )}
                    />
                  </Col>
                ) : null}

                {visionResult.competitorTakeaways.length > 0 ? (
                  <Col xs={24} md={12}>
                    <Text strong>竞品可借鉴点</Text>
                    <List
                      size="small"
                      dataSource={visionResult.competitorTakeaways}
                      renderItem={(item) => (
                        <List.Item style={{ paddingInline: 0, flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>{item.title || "竞品"}</Text>
                          <Text>{item.takeaway || "-"}</Text>
                        </List.Item>
                      )}
                    />
                  </Col>
                ) : null}

                {visionResult.improvements.length > 0 ? (
                  <Col xs={24} md={12}>
                    <Text strong>改图动作清单</Text>
                    <List
                      size="small"
                      dataSource={visionResult.improvements}
                      renderItem={(item) => (
                        <List.Item style={{ paddingInline: 0 }}>
                          <Space align="start">
                            <Tag color={item.priority === "P0" ? "red" : item.priority === "P1" ? "orange" : "default"}>
                              {item.priority || "P2"}
                            </Tag>
                            <Text>{item.action || "-"}</Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Col>
                ) : null}
              </Row>

              <Text type="secondary" style={{ fontSize: 12 }}>
                模型：{visionResult.model || "gemini"} · 最多分析 1 张我方主图 + 3 张竞品主图
              </Text>
            </Space>
          ) : (
            <div style={{ padding: "20px 0", textAlign: "center", color: "#8c8c8c" }}>
              进入步骤 4 时会自动分析当前已加入对比的主图
            </div>
          )}
        </Card>
      );
    };

    return (
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        {renderHeroSummary()}
        {renderVisionCompareCard()}
        {renderConclusionTab()}
        {renderMarketTab()}
        {renderGapTab()}
        {renderDiagnosticsSection()}
      </Space>
    );
  };

  const renderStepContent = () => {
    if (activeStep === 0) return renderStepZero();
    if (activeStep === 1) return renderStepOneDashboard();
    if (activeStep === 2) return renderStepTwo();
    return renderStepThree();
  };

  if (myProductOptions.length === 0) {
    return <Card style={CARD_STYLE}><Empty description="还没有读取到你的商品，请先同步商品列表。" /></Card>;
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {degradedReason ? (
        <Alert
          type="warning"
          showIcon
          message="云启接口暂时不可用，已切换到本地缓存模式"
          description={`最近一次失败原因：${degradedReason}。你仍然可以查看已采集的样本和流量历史，做离线决策。`}
          action={(
            <Space>
              <Button size="small" onClick={scrollToSamples}>看本地缓存</Button>
              <Button size="small" type="text" onClick={() => setDegradedReason("")}>关闭</Button>
            </Space>
          )}
          style={{ borderRadius: 12 }}
        />
      ) : null}
      {!hideStepShell ? (
        <Card
          style={{
            ...CARD_STYLE,
            background: "linear-gradient(135deg, rgba(255,248,240,0.98) 0%, rgba(255,255,255,1) 68%, rgba(255,244,230,0.95) 100%)",
            border: "1px solid rgba(229,91,0,0.12)",
          }}
        >
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
              <div>
                <Text strong style={{ fontSize: 20 }}>按步骤做竞品分析</Text>
                <div style={{ marginTop: 6, color: "#8c8c8c" }}>
                  先看市场和自己，再看竞品差距，最后只保留可执行动作。
                </div>
              </div>

              <Space wrap>
                {activeStep > 0 ? <Button onClick={() => setActiveStep(Math.max(0, activeStep - 1))}>上一步</Button> : null}
                {nextStepTarget !== null ? (
                  <Button
                    type="primary"
                    disabled={!canGoNext}
                    onClick={() => canGoNext && setActiveStep(nextStepTarget)}
                    style={{ background: TEMU_ORANGE, borderColor: TEMU_ORANGE }}
                  >
                    {nextStepLabel}
                  </Button>
                ) : (
                  <Button onClick={() => setActiveStep(2)}>继续调整样本</Button>
                )}
              </Space>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 12,
              }}
            >
              {stepItems.map((item) => {
                const isActive = item.key === activeStep;
                const isClickable = item.enabled || item.key <= activeStep;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => isClickable && setActiveStep(item.key)}
                    style={{
                      textAlign: "left",
                      padding: "14px 16px",
                      borderRadius: 16,
                      border: isActive ? `1px solid ${TEMU_ORANGE}` : "1px solid #ebeef5",
                      background: isActive ? "rgba(229,91,0,0.08)" : item.completed ? "#fff7e8" : "#fff",
                      cursor: isClickable ? "pointer" : "not-allowed",
                      opacity: isClickable ? 1 : 0.55,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <Text strong style={{ color: isActive ? TEMU_ORANGE : "#262626" }}>{`${item.key + 1}. ${item.title}`}</Text>
                      {item.completed ? <Tag color="success" style={{ marginInlineEnd: 0 }}>已就绪</Tag> : null}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, color: "#8c8c8c", lineHeight: 1.5 }}>
                      {item.desc}
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={{ color: "#8c8c8c", lineHeight: 1.7 }}>
              当前在做：<Text strong style={{ color: "#262626" }}>{currentStepMeta.title}</Text>。{currentStepMeta.desc}
            </div>
          </Space>
        </Card>
      ) : null}

      {renderStepContent()}
    </Space>
  );
}

