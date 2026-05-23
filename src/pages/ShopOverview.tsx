import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  InputNumber,
  Table,
  Tag,
  Tabs,
  Progress,
  Typography,
  Space,
  Skeleton,
  Segmented,
  message,
} from "antd";
import { CloudSyncOutlined, ReloadOutlined, RiseOutlined, ShopOutlined, WarningOutlined } from "@ant-design/icons";
import { parseDashboardData, parseFluxData, parseSalesData } from "../utils/parseRawApis";
import { APP_SETTINGS_KEY, normalizeAppSettings } from "../utils/appSettings";
import {
  setStoreValueForActiveAccount,
} from "../utils/multiStore";
import {
  COLLECTION_DIAGNOSTICS_KEY,
  getCollectionDataIssue,
  normalizeCollectionDiagnostics,
  type CollectionDiagnostics,
} from "../utils/collectionDiagnostics";
import { useStoreRefresh } from "../hooks/useStoreRefresh";
import { getStoreValues, STORE_KEY_ALIASES } from "../utils/storeCompat";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import EmptyGuide from "../components/EmptyGuide";
import FluxOperatorPanel from "../components/FluxOperatorPanel";
import type { RegionKey } from "../utils/fluxOperator";
import {
  fetchCloudShopMonitor,
  fetchTemuAfterSales,
  fetchTemuActivity,
  fetchTemuOperationRisks,
  fetchTemuStockOrders,
  loadCloudConfig,
  type CloudShopMonitorPayload,
  type CloudShopMonitorRow,
  type TemuAfterSaleRow,
  type TemuAfterSaleSummaryRow,
  type TemuActivityRow,
  type TemuActivitySummaryRow,
  type TemuOperationRiskRow,
  type TemuOperationRiskSummaryRow,
  type TemuStockOrderRow,
  type TemuStockOrderSummaryRow,
} from "../utils/cloudClient";

const { Text, Paragraph } = Typography;

void CloudSyncOutlined;
void RiseOutlined;
void ShopOutlined;
void WarningOutlined;

const store = window.electronAPI?.store;

// 安全渲染值：对象转 JSON，null 显示 "-"
function safeVal(val: any): string {
  if (val === null || val === undefined) return "-";
  if (typeof val === "object") return JSON.stringify(val).slice(0, 100);
  return String(val);
}

// 格式化金额
function formatAmount(val: any): string {
  if (val === null || val === undefined) return "-";
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return num.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 从 raw store（apis 数组格式）中查找匹配路径的 API 数据
function findInRawStore(rawData: any, apiPathFragment: string): any {
  if (!rawData?.apis) return null;
  const api = rawData.apis.find((a: any) => a.path?.includes(apiPathFragment));
  return api?.data?.result || api?.data || null;
}

function deepFindObjectByKeys(rawData: any, keys: string[]): any {
  const queue = [rawData];
  const seen = new Set<any>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    if (keys.every((key) => key in current)) {
      return current;
    }

    if (Array.isArray(current)) {
      current.forEach((item) => queue.push(item));
      continue;
    }

    Object.values(current).forEach((value) => {
      if (value && typeof value === "object") queue.push(value);
    });
  }

  return null;
}

function extractFluxSummary(rawData: any) {
  if (!rawData) return null;
  if (rawData?.summary?.trendList || rawData?.summary?.todayVisitors !== undefined || rawData?.summary?.todayBuyers !== undefined) {
    return rawData.summary;
  }
  const summary = findInRawStore(rawData, "mall/summary");
  if (!summary) return null;
  return {
    todayVisitors: summary.todayTotalVisitorsNum ?? summary.todayVisitors ?? 0,
    todayBuyers: summary.todayPayBuyerNum ?? summary.todayBuyers ?? 0,
    todayConversionRate: summary.todayConversionRate ?? 0,
    trendList: Array.isArray(summary.trendList)
      ? summary.trendList.map((item: any) => ({
          date: item.statDate || item.date || "",
          visitors: item.visitorsNum ?? item.visitors ?? 0,
          buyers: item.payBuyerNum ?? item.buyers ?? 0,
          conversionRate: item.conversionRate ?? 0,
        }))
      : [],
  };
}

function formatCloudNumber(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toLocaleString("zh-CN");
}

function formatCloudRate(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  const percent = Math.abs(num) <= 1 ? num * 100 : num;
  return `${percent.toFixed(2)}%`;
}

function formatCloudMoney(cents?: number | null, currency?: string | null) {
  if (cents === null || cents === undefined) return "-";
  return `${(Number(cents) / 100).toFixed(2)} ${currency || "CNY"}`;
}

function formatCloudTime(value?: string | number | null) {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN");
}

function cloudActivityLabel(value?: string | null) {
  const labels: Record<string, string> = {
    activity: "活动",
    bidding: "竞价",
    coupon: "优惠券",
    bsr: "BSR",
    marketing: "营销",
  };
  return labels[String(value || "")] || value || "-";
}

function cloudRiskLabel(value?: string | null) {
  const labels: Record<string, string> = {
    violation_goods: "违规商品",
    delivery_order: "发货履约",
    logistics_feedback: "物流反馈",
    spot_check: "质检抽检",
    spot_check_history: "历史质检",
    inbound_exception: "入库异常",
    return_package: "退货包裹",
    high_price_flow: "高价限流",
    regional_sales: "区域销售",
    operation: "运营风险",
  };
  return labels[String(value || "")] || value || "风险";
}

function cloudRiskColor(value?: string | null) {
  if (value === "high") return "red";
  if (value === "medium") return "orange";
  return "default";
}

function cloudActivityStatusColor(value?: string | null) {
  const text = String(value || "").toLowerCase();
  if (/reject|fail|cancel|disable|close|end|expired|驳回|失败|取消|结束/.test(text)) return "red";
  if (/pass|success|approved|active|online|running|available|通过|成功|进行|生效/.test(text)) return "green";
  if (/pending|wait|review|audit|待|审核/.test(text)) return "orange";
  return "blue";
}

function cloudBusinessStatusColor(value?: string | null) {
  const text = String(value || "").toLowerCase();
  if (/abnormal|cancel|close|fail|reject|timeout|取消|关闭|拒绝|失败|退回|异常|逾期|超时|驳回/.test(text)) return "red";
  if (/complete|done|finish|signed|success|完成|通过|签收|已发|已入库|成功/.test(text)) return "green";
  if (/audit|pending|processing|review|wait|待|处理中|审核|取件|发货|入库/.test(text)) return "orange";
  return "default";
}

function isDiagnosticCloudText(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return false;
  return (
    text.startsWith("MALL-DBG")
    || text.startsWith("MALL-EXT-E2E")
    || text.startsWith("SKC-DBG")
    || text.includes("EXT-E2E")
    || text.toLowerCase().includes("debug")
    || text.toLowerCase().includes("codex extension e2e")
  );
}

const ShopOverview: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<any>(null);
  const [flux, setFlux] = useState<any>(null);
  const [performance, setPerformance] = useState<any>(null);
  const [soldout, setSoldout] = useState<any>(null);
  const [delivery, setDelivery] = useState<any>(null);
  const [quality, setQuality] = useState<any>(null);
  const [govern, setGovern] = useState<any>(null);
  const [marketing, setMarketing] = useState<any>(null);
  const [, setAdsHome] = useState<any>(null);
  const [fluxUS, setFluxUS] = useState<any>(null);
  const [fluxEU, setFluxEU] = useState<any>(null);
  const [fluxRegion, setFluxRegion] = useState<string>("global");
  const [qualityEU, setQualityEU] = useState<any>(null);
  const [qualityRegion, setQualityRegion] = useState<string>("global");
  const [checkup, setCheckup] = useState<any>(null);
  const [qcDetail, setQcDetail] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<CollectionDiagnostics | null>(null);
  const [productHistoryCache, setProductHistoryCache] = useState<Record<string, any> | null>(null);
  const [cloudConfigured, setCloudConfigured] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [cloudMonitorRows, setCloudMonitorRows] = useState<CloudShopMonitorRow[]>([]);
  const [cloudMonitorTotals, setCloudMonitorTotals] = useState<CloudShopMonitorPayload["totals"] | null>(null);
  const [cloudActivities, setCloudActivities] = useState<TemuActivityRow[]>([]);
  const [cloudActivitySummary, setCloudActivitySummary] = useState<TemuActivitySummaryRow[]>([]);
  const [cloudRisks, setCloudRisks] = useState<TemuOperationRiskRow[]>([]);
  const [cloudRiskSummary, setCloudRiskSummary] = useState<TemuOperationRiskSummaryRow[]>([]);
  const [cloudStockOrders, setCloudStockOrders] = useState<TemuStockOrderRow[]>([]);
  const [cloudStockOrderSummary, setCloudStockOrderSummary] = useState<TemuStockOrderSummaryRow[]>([]);
  const [cloudAfterSales, setCloudAfterSales] = useState<TemuAfterSaleRow[]>([]);
  const [cloudAfterSaleSummary, setCloudAfterSaleSummary] = useState<TemuAfterSaleSummaryRow[]>([]);

  // 商品动态 / 库存预警
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [stockThreshold, setStockThreshold] = useState(10);
  const [savedStockThreshold, setSavedStockThreshold] = useState(10);
  const [stockLastCheckedAt, setStockLastCheckedAt] = useState<string | null>(null);
  const [stockChecking, setStockChecking] = useState(false);
  const [stockNotice, setStockNotice] = useState<{ type: "info" | "warning" | "error"; message: string } | null>(null);
  const [savingStockThreshold, setSavingStockThreshold] = useState(false);

  const loadAllData = async () => {
    setLoading(true);
    setDashboard(null);
    setFlux(null);
    setPerformance(null);
    setSoldout(null);
    setDelivery(null);
    setQuality(null);
    setGovern(null);
    setMarketing(null);
    setAdsHome(null);
    setFluxUS(null);
    setFluxEU(null);
    setQualityEU(null);
    setCheckup(null);
    setQcDetail(null);
    setCloudConfigured(false);
    setCloudError("");
    setCloudMonitorRows([]);
    setCloudMonitorTotals(null);
    setCloudActivities([]);
    setCloudActivitySummary([]);
    setCloudRisks([]);
    setCloudRiskSummary([]);
    setCloudStockOrders([]);
    setCloudStockOrderSummary([]);
    setCloudAfterSales([]);
    setCloudAfterSaleSummary([]);
    try {
      const storeValues = await getStoreValues(store, [
        "temu_dashboard",
        "temu_flux",
        ...STORE_KEY_ALIASES.performance,
        ...STORE_KEY_ALIASES.soldout,
        ...STORE_KEY_ALIASES.delivery,
        "temu_raw_qualityDashboard",
        "temu_raw_governDashboard",
        ...STORE_KEY_ALIASES.marketingActivity,
        "temu_raw_adsHome",
        ...STORE_KEY_ALIASES.fluxUS,
        ...STORE_KEY_ALIASES.fluxEU,
        "temu_raw_qualityDashboardEU",
        "temu_raw_checkup",
        ...STORE_KEY_ALIASES.qcDetail,
        COLLECTION_DIAGNOSTICS_KEY,
        APP_SETTINGS_KEY,
      ]);
      const pickFirst = (keys: readonly string[]) =>
        keys.map((key) => storeValues[key]).find((value) => value !== null && value !== undefined) ?? null;

      const dashRaw = storeValues.temu_dashboard;
      const fluxRaw = storeValues.temu_flux;
      const perfRaw = pickFirst(STORE_KEY_ALIASES.performance);
      const soldoutRaw = pickFirst(STORE_KEY_ALIASES.soldout);
      const deliveryRaw = pickFirst(STORE_KEY_ALIASES.delivery);
      const qualityRaw = storeValues.temu_raw_qualityDashboard;
      const governRaw = storeValues.temu_raw_governDashboard;
      const marketingRaw = pickFirst(STORE_KEY_ALIASES.marketingActivity);
      const adsRaw = storeValues.temu_raw_adsHome;
      const fluxUSRaw = pickFirst(STORE_KEY_ALIASES.fluxUS);
      const fluxEURaw = pickFirst(STORE_KEY_ALIASES.fluxEU);
      const qualityEURaw = storeValues.temu_raw_qualityDashboardEU;
      const checkupRaw = storeValues.temu_raw_checkup;
      const qcDetailRaw = pickFirst(STORE_KEY_ALIASES.qcDetail);
      const diagnosticsRaw = storeValues[COLLECTION_DIAGNOSTICS_KEY];
      const appSettingsRaw = storeValues[APP_SETTINGS_KEY];

      // 加载商品级流量历史缓存（运营助手所需）
      try {
        const phc = await store?.get("temu_flux_product_history_cache");
        setProductHistoryCache(phc && typeof phc === "object" ? (phc as Record<string, any>) : null);
      } catch {
        setProductHistoryCache(null);
      }

      if (dashRaw) setDashboard(parseDashboardData(dashRaw));
      if (fluxRaw) setFlux(parseFluxData(fluxRaw));
      if (perfRaw) setPerformance(perfRaw);
      if (soldoutRaw) setSoldout(soldoutRaw);
      if (deliveryRaw) setDelivery(deliveryRaw);
      if (qualityRaw) setQuality(qualityRaw);
      if (governRaw) setGovern(governRaw);
      if (marketingRaw) setMarketing(marketingRaw);
      if (adsRaw) setAdsHome(adsRaw);
      if (fluxUSRaw) setFluxUS(parseFluxData(fluxUSRaw));
      if (fluxEURaw) setFluxEU(parseFluxData(fluxEURaw));
      if (qualityEURaw) setQualityEU(qualityEURaw);
      if (checkupRaw) setCheckup(checkupRaw);
      if (qcDetailRaw) setQcDetail(qcDetailRaw);
      setDiagnostics(normalizeCollectionDiagnostics(diagnosticsRaw));
      const appSettings = normalizeAppSettings(appSettingsRaw);
      setStockThreshold(appSettings.lowStockThreshold);
      setSavedStockThreshold(appSettings.lowStockThreshold);

      try {
        const cfg = await loadCloudConfig();
        if (!cfg) {
          setCloudConfigured(false);
        } else {
          setCloudConfigured(true);
          const [monitorResult, activityResult, riskResult, stockOrderResult, afterSaleResult] = await Promise.all([
            fetchCloudShopMonitor(cfg),
            fetchTemuActivity(cfg, { limit: 500 }),
            fetchTemuOperationRisks(cfg, { limit: 500 }),
            fetchTemuStockOrders(cfg, { limit: 500 }),
            fetchTemuAfterSales(cfg, { limit: 500 }),
          ]);
          setCloudMonitorRows((monitorResult.rows || []).filter((row) => !isDiagnosticCloudText(row.mall_id)));
          setCloudMonitorTotals(monitorResult.totals || null);
          setCloudActivities((activityResult.rows || []).filter((row) => !isDiagnosticCloudText(row.mall_id) && !isDiagnosticCloudText(row.skc_id)));
          setCloudActivitySummary(activityResult.summary || []);
          setCloudRisks((riskResult.rows || []).filter((row) => !isDiagnosticCloudText(row.mall_id) && !isDiagnosticCloudText(row.skc_id)));
          setCloudRiskSummary(riskResult.summary || []);
          setCloudStockOrders((stockOrderResult.rows || []).filter((row) => !isDiagnosticCloudText(row.mall_id) && !isDiagnosticCloudText(row.skc_id)));
          setCloudStockOrderSummary(stockOrderResult.summary || []);
          setCloudAfterSales((afterSaleResult.rows || []).filter((row) => !isDiagnosticCloudText(row.mall_id) && !isDiagnosticCloudText(row.skc_id)));
          setCloudAfterSaleSummary(afterSaleResult.summary || []);
        }
      } catch (error: any) {
        setCloudConfigured(true);
        setCloudError(error?.message || "云端店铺数据读取失败");
      }
    } catch (e) {
      console.error("加载店铺概览数据失败", e);
      setDiagnostics(null);
    } finally {
      setLoading(false);
    }
  };

  // ========== 数据提取 ==========

  useStoreRefresh({
    load: loadAllData,
    watchKeys: [
      "temu_dashboard",
      "temu_flux",
      "temu_raw_performance",
      "temu_performance",
      "temu_raw_soldout",
      "temu_soldout",
      "temu_raw_delivery",
      "temu_delivery",
      "temu_raw_qualityDashboard",
      "temu_raw_governDashboard",
      "temu_raw_marketingActivity",
      "temu_marketing_activity",
      "temu_raw_adsHome",
      "temu_raw_fluxUS",
      "temu_flux_us",
      "temu_raw_fluxEU",
      "temu_flux_eu",
      "temu_raw_qualityDashboardEU",
      "temu_raw_checkup",
      "temu_raw_qcDetail",
      "temu_qc_detail",
      "temu_flux_product_history_cache",
      COLLECTION_DIAGNOSTICS_KEY,
      APP_SETTINGS_KEY,
    ],
  });

  const stats = dashboard?.statistics;
  const ranking = dashboard?.ranking;
  const income = dashboard?.income;

  // 流量数据 - 根据区域切换
  const getRegionFlux = () => {
    if (fluxRegion === "us") {
      const summary = extractFluxSummary(fluxUS);
      if (!summary) return { summary: null, trendList: [], yesterday: null };
      const trendList = summary.trendList || [];
      return {
        summary,
        trendList,
        yesterday: trendList.length >= 2 ? trendList[trendList.length - 2] : null,
      };
    }
    if (fluxRegion === "eu") {
      const summary = extractFluxSummary(fluxEU);
      if (!summary) return { summary: null, trendList: [], yesterday: null };
      const trendList = summary.trendList || [];
      return {
        summary,
        trendList,
        yesterday: trendList.length >= 2 ? trendList[trendList.length - 2] : null,
      };
    }
    // global
    const fluxSummary = flux?.summary || null;
    const trendList = fluxSummary?.trendList || [];
    return {
      summary: fluxSummary,
      trendList,
      yesterday: trendList.length >= 2 ? trendList[trendList.length - 2] : null,
    };
  };
  const regionFlux = getRegionFlux();
  const fluxSummary = regionFlux.summary;
  const fluxTrendList = regionFlux.trendList;
  const yesterdayFlux = regionFlux.yesterday;

  // 质量数据 - 根据区域切换
  const currentQuality = qualityRegion === "eu" ? qualityEU : quality;
  const qualityMetrics = findInRawStore(currentQuality, "qualityMetrics/query");
  const qualityScoreList = findInRawStore(currentQuality, "qualityScore/count");

  // 履约数据
  const perfAbstract = performance?.purchasePerformance?.abstractInfo
    || deepFindObjectByKeys(performance, ["supplierAvgScore", "excellentZoneStart", "excellentZoneEnd"])
    || null;

  // 售罄数据
  const soldoutOverview = soldout?.overview?.todayTotal
    || deepFindObjectByKeys(soldout, ["soonSellOutNum", "sellOutNum", "sellOutLossNum"])
    || null;

  // 物流发货
  const deliverySummary = delivery?.forwardSummary?.result
    || delivery?.forwardSummary
    || deepFindObjectByKeys(delivery, ["stagingCount", "forwardCount", "expiredCount"])
    || null;

  // 合规数据
  const complianceBoard = findInRawStore(govern, "compliance/dashBoard/main_page");
  const realPictureTodo = findInRawStore(govern, "realPicture/todoList/query");

  // 营销活动
  const marketingStats = findInRawStore(marketing, "activity/statistics");
  const marketingTodo = findInRawStore(marketing, "activity/todo");

  const dataIssues = [
    getCollectionDataIssue(diagnostics, "dashboard", "店铺概览", Boolean(dashboard)),
    getCollectionDataIssue(diagnostics, "flux", "流量分析", Boolean(flux || fluxUS || fluxEU)),
    getCollectionDataIssue(diagnostics, "qualityDashboard", "质量看板", Boolean(quality || qualityEU)),
    getCollectionDataIssue(diagnostics, "performance", "履约表现", Boolean(perfAbstract)),
    getCollectionDataIssue(diagnostics, "marketingActivity", "营销活动", Boolean(marketing)),
    getCollectionDataIssue(diagnostics, "delivery", "发货数据", Boolean(deliverySummary)),
    getCollectionDataIssue(diagnostics, "soldout", "售罄分析", Boolean(soldoutOverview)),
    getCollectionDataIssue(diagnostics, "checkup", "店铺体检", Boolean(checkup)),
    getCollectionDataIssue(diagnostics, "qcDetail", "抽检结果", Boolean(qcDetail)),
  ].filter((issue): issue is string => Boolean(issue));

  const cloudActivityCount = cloudActivities.length || cloudActivitySummary.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const cloudRiskCount = cloudRisks.length || cloudRiskSummary.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const cloudHighRiskCount = cloudRisks.filter((row) => row.severity === "high").length
    || cloudRiskSummary.filter((row) => row.severity === "high").reduce((sum, row) => sum + Number(row.count || 0), 0);
  const cloudQualityRisks = cloudRisks.filter((row) => ["spot_check", "spot_check_history", "violation_goods", "return_package"].includes(String(row.risk_type || "")));
  const cloudDeliveryRisks = cloudRisks.filter((row) => ["delivery_order", "logistics_feedback", "inbound_exception"].includes(String(row.risk_type || "")));
  const cloudPendingAfterSaleCount = cloudAfterSales.filter((row) => cloudBusinessStatusColor(row.status) !== "green").length;
  const cloudPendingStockOrderCount = cloudStockOrders.filter((row) => cloudBusinessStatusColor(row.temu_status) !== "green").length;
  const cloudStockDemandQty = cloudStockOrders.reduce((sum, row) => sum + Number(row.demand_qty || 0), 0);
  const cloudStockDeliveredQty = cloudStockOrders.reduce((sum, row) => sum + Number(row.delivered_qty || 0), 0);
  const cloudLatestAt = [
    ...cloudMonitorRows.flatMap((row) => [row.last_seen, row.last_updated_at, row.last_flow_at, row.last_activity_at, row.last_risk_at, row.last_stock_order_at, row.last_after_sale_at]),
    ...cloudActivities.map((row) => row.last_updated_at),
    ...cloudRisks.map((row) => row.last_updated_at),
    ...cloudStockOrders.map((row) => row.last_updated_at),
    ...cloudAfterSales.map((row) => row.last_updated_at),
  ]
    .filter(Boolean)
    .sort((left, right) => String(right).localeCompare(String(left)))[0] || "";
  const cloudTotals = cloudMonitorTotals || cloudMonitorRows.reduce((acc, row) => ({
    mall_count: acc.mall_count + 1,
    capture_count_24h: acc.capture_count_24h + Number(row.capture_count_24h || 0),
    device_count: acc.device_count,
    sale_volume: acc.sale_volume + Number(row.sale_volume || 0),
    seven_days_sale_volume: acc.seven_days_sale_volume + Number(row.seven_days_sale_volume || 0),
    thirty_days_sale_volume: acc.thirty_days_sale_volume + Number(row.thirty_days_sale_volume || 0),
    on_sale_product_number: acc.on_sale_product_number + Number(row.on_sale_product_number || 0),
    lack_skc_number: acc.lack_skc_number + Number(row.lack_skc_number || 0),
    advice_prepare_skc_number: acc.advice_prepare_skc_number + Number(row.advice_prepare_skc_number || 0),
    already_sold_out_number: acc.already_sold_out_number + Number(row.already_sold_out_number || 0),
    flow_product_count: acc.flow_product_count + Number(row.flow_product_count || 0),
    flow_expose_num: acc.flow_expose_num + Number(row.flow_expose_num || 0),
    flow_click_num: acc.flow_click_num + Number(row.flow_click_num || 0),
    flow_detail_visit_num: acc.flow_detail_visit_num + Number(row.flow_detail_visit_num || 0),
    flow_detail_visitor_num: acc.flow_detail_visitor_num + Number(row.flow_detail_visitor_num || 0),
    flow_add_to_cart_user_num: acc.flow_add_to_cart_user_num + Number(row.flow_add_to_cart_user_num || 0),
    flow_collect_user_num: acc.flow_collect_user_num + Number(row.flow_collect_user_num || 0),
    flow_pay_goods_num: acc.flow_pay_goods_num + Number(row.flow_pay_goods_num || 0),
    flow_pay_order_num: acc.flow_pay_order_num + Number(row.flow_pay_order_num || 0),
    flow_buyer_num: acc.flow_buyer_num + Number(row.flow_buyer_num || 0),
    flow_expose_pay_conversion_rate: acc.flow_expose_pay_conversion_rate,
    flow_expose_click_conversion_rate: acc.flow_expose_click_conversion_rate,
    flow_click_pay_conversion_rate: acc.flow_click_pay_conversion_rate,
    flow_search_expose_num: acc.flow_search_expose_num + Number(row.flow_search_expose_num || 0),
    flow_search_click_num: acc.flow_search_click_num + Number(row.flow_search_click_num || 0),
    flow_search_pay_goods_num: acc.flow_search_pay_goods_num + Number(row.flow_search_pay_goods_num || 0),
    flow_search_pay_order_num: acc.flow_search_pay_order_num + Number(row.flow_search_pay_order_num || 0),
    flow_recommend_expose_num: acc.flow_recommend_expose_num + Number(row.flow_recommend_expose_num || 0),
    flow_recommend_click_num: acc.flow_recommend_click_num + Number(row.flow_recommend_click_num || 0),
    flow_recommend_pay_goods_num: acc.flow_recommend_pay_goods_num + Number(row.flow_recommend_pay_goods_num || 0),
    flow_recommend_pay_order_num: acc.flow_recommend_pay_order_num + Number(row.flow_recommend_pay_order_num || 0),
    activity_count: acc.activity_count + Number(row.activity_count || 0),
    risk_count: acc.risk_count + Number(row.risk_count || 0),
    high_risk_count: acc.high_risk_count + Number(row.high_risk_count || 0),
    stock_order_count: acc.stock_order_count + Number(row.stock_order_count || 0),
    pending_stock_order_count: acc.pending_stock_order_count + Number(row.pending_stock_order_count || 0),
    stock_order_demand_qty: acc.stock_order_demand_qty + Number(row.stock_order_demand_qty || 0),
    stock_order_delivered_qty: acc.stock_order_delivered_qty + Number(row.stock_order_delivered_qty || 0),
    after_sale_count: acc.after_sale_count + Number(row.after_sale_count || 0),
    pending_after_sale_count: acc.pending_after_sale_count + Number(row.pending_after_sale_count || 0),
    return_package_count: acc.return_package_count + Number(row.return_package_count || 0),
    after_sale_quantity: acc.after_sale_quantity + Number(row.after_sale_quantity || 0),
    after_sale_amount_cents: acc.after_sale_amount_cents + Number(row.after_sale_amount_cents || 0),
  }), {
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
  });

  const renderCloudMonitorPanel = () => (
    <div className="app-panel">
      <div className="app-panel__title">
        <div className="app-panel__title-main">云端店铺监控</div>
        <div className="app-panel__title-sub">{cloudLatestAt ? `最近更新：${formatCloudTime(cloudLatestAt)}` : ""}</div>
      </div>
      {!cloudConfigured ? (
        <Alert type="warning" showIcon message="云端未配置" />
      ) : cloudError ? (
        <Alert type="warning" showIcon message="云端读取失败" description={cloudError} />
      ) : (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <StatCard compact title="云端店铺" value={formatCloudNumber(cloudTotals.mall_count || cloudMonitorRows.length)} color="brand" />
            <StatCard compact title="24小时上报" value={formatCloudNumber(cloudTotals.capture_count_24h)} color="blue" />
            <StatCard compact title="采集设备" value={formatCloudNumber(cloudTotals.device_count)} color="purple" />
            <StatCard compact title="今日销量" value={formatCloudNumber(cloudTotals.sale_volume)} color="success" />
            <StatCard compact title="30日销量" value={formatCloudNumber(cloudTotals.thirty_days_sale_volume)} color="success" />
            <StatCard compact title="曝光" value={formatCloudNumber(cloudTotals.flow_expose_num)} color="blue" />
            <StatCard compact title="点击" value={formatCloudNumber(cloudTotals.flow_click_num)} color="blue" />
            <StatCard compact title="买家" value={formatCloudNumber(cloudTotals.flow_buyer_num)} color="purple" />
            <StatCard compact title="点击率" value={formatCloudRate(cloudTotals.flow_expose_click_conversion_rate)} color="brand" />
            <StatCard compact title="活动快照" value={formatCloudNumber(cloudTotals.activity_count || cloudActivityCount)} color="orange" />
            <StatCard compact title="风险快照" value={formatCloudNumber(cloudTotals.risk_count || cloudRiskCount)} color={(cloudTotals.high_risk_count || cloudHighRiskCount) ? "danger" : "neutral"} />
            <StatCard compact title="待发备货单" value={formatCloudNumber(cloudTotals.pending_stock_order_count)} color={cloudTotals.pending_stock_order_count ? "orange" : "neutral"} />
            <StatCard compact title="售后待处理" value={formatCloudNumber(cloudTotals.pending_after_sale_count || cloudTotals.after_sale_count)} color={cloudTotals.pending_after_sale_count ? "danger" : cloudTotals.after_sale_count ? "orange" : "neutral"} />
          </div>
          {cloudMonitorRows.length > 0 ? (
            <Table
              rowKey={(row: CloudShopMonitorRow) => row.mall_id}
              dataSource={cloudMonitorRows}
              size="small"
              pagination={false}
              scroll={{ x: 1760 }}
              columns={[
                {
                  title: "店铺",
                  key: "mall",
                  width: 180,
                  render: (_value: any, row: CloudShopMonitorRow) => (
                    <Space direction="vertical" size={0}>
                      <Text strong>{row.mall_name || row.mall_id || "-"}</Text>
                      {row.mall_name ? <Text type="secondary" style={{ fontSize: 12 }}>{row.mall_id}</Text> : null}
                      <Text type="secondary" style={{ fontSize: 12 }}>{row.site || "-"}</Text>
                    </Space>
                  ),
                },
                { title: "统计日", dataIndex: "stat_date", key: "date", width: 120 },
                { title: "在售商品", dataIndex: "on_sale_product_number", key: "onSale", width: 110, render: formatCloudNumber },
                { title: "今日销量", dataIndex: "sale_volume", key: "sale", width: 110, render: formatCloudNumber },
                { title: "7日销量", dataIndex: "seven_days_sale_volume", key: "seven", width: 110, render: formatCloudNumber },
                { title: "30日销量", dataIndex: "thirty_days_sale_volume", key: "thirty", width: 110, render: formatCloudNumber },
                {
                  title: "流量",
                  key: "flow",
                  width: 170,
                  render: (_value: any, row: CloudShopMonitorRow) => (
                    <Space direction="vertical" size={2}>
                      <Text>曝 {formatCloudNumber(row.flow_expose_num)} / 点 {formatCloudNumber(row.flow_click_num)}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>访客 {formatCloudNumber(row.flow_detail_visitor_num)}</Text>
                    </Space>
                  ),
                },
                {
                  title: "转化",
                  key: "flowConversion",
                  width: 160,
                  render: (_value: any, row: CloudShopMonitorRow) => (
                    <Space direction="vertical" size={2}>
                      <Text>买家 {formatCloudNumber(row.flow_buyer_num)} / 件 {formatCloudNumber(row.flow_pay_goods_num)}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>点击支付 {formatCloudRate(row.flow_click_pay_conversion_rate)}</Text>
                    </Space>
                  ),
                },
                {
                  title: "库存预警",
                  key: "stock",
                  width: 180,
                  render: (_value: any, row: CloudShopMonitorRow) => (
                    <Space size={4} wrap>
                      <Tag color={Number(row.lack_skc_number || 0) > 0 ? "red" : "default"}>缺货 {formatCloudNumber(row.lack_skc_number)}</Tag>
                      <Tag color={Number(row.advice_prepare_skc_number || 0) > 0 ? "orange" : "default"}>备货 {formatCloudNumber(row.advice_prepare_skc_number)}</Tag>
                      <Tag color={Number(row.already_sold_out_number || 0) > 0 ? "red" : "default"}>售罄 {formatCloudNumber(row.already_sold_out_number)}</Tag>
                    </Space>
                  ),
                },
                {
                  title: "活动/风险",
                  key: "activityRisk",
                  width: 170,
                  render: (_value: any, row: CloudShopMonitorRow) => (
                    <Space size={4} wrap>
                      <Tag color={Number(row.activity_count || 0) > 0 ? "blue" : "default"}>活动 {formatCloudNumber(row.activity_count)}</Tag>
                      <Tag color={Number(row.high_risk_count || 0) > 0 ? "red" : Number(row.risk_count || 0) > 0 ? "orange" : "default"}>
                        风险 {formatCloudNumber(row.risk_count)}
                      </Tag>
                    </Space>
                  ),
                },
                {
                  title: "备货单",
                  key: "stockOrders",
                  width: 170,
                  render: (_value: any, row: CloudShopMonitorRow) => (
                    <Space direction="vertical" size={2}>
                      <Text>{formatCloudNumber(row.pending_stock_order_count)} / {formatCloudNumber(row.stock_order_count)} 单待处理</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatCloudNumber(row.stock_order_delivered_qty)} / {formatCloudNumber(row.stock_order_demand_qty)} 已发
                      </Text>
                    </Space>
                  ),
                },
                {
                  title: "售后退货",
                  key: "afterSales",
                  width: 190,
                  render: (_value: any, row: CloudShopMonitorRow) => (
                    <Space direction="vertical" size={2}>
                      <Text>
                        {formatCloudNumber(row.pending_after_sale_count)} / {formatCloudNumber(row.after_sale_count)} 单待处理
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        退货包裹 {formatCloudNumber(row.return_package_count)} / 件 {formatCloudNumber(row.after_sale_quantity)}
                      </Text>
                      {Number(row.after_sale_amount_cents || 0) > 0 ? (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          金额 {(Number(row.after_sale_amount_cents || 0) / 100).toFixed(2)}
                        </Text>
                      ) : null}
                    </Space>
                  ),
                },
                { title: "最近上报", dataIndex: "last_seen", key: "seen", width: 180, render: formatCloudTime },
              ]}
            />
          ) : (
            <EmptyGuide title="暂无云端店铺快照" description="扩展上报店铺概览或销售管理数据后会显示" />
          )}
        </Space>
      )}
    </div>
  );

  // ========== Tab 1: 数据概览 ==========
  const renderOverviewTab = () => (
    <div className="shop-overview-dashboard">
      {renderCloudMonitorPanel()}
      {/* 核心统计 */}
      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">核心数据</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <StatCard compact title="在售商品" value={safeVal(stats?.onSaleProducts)} color="brand" />
          <StatCard compact title="备货单" value={safeVal(dashboard?.productStatus?.toSubmit)} color="blue" />
          <StatCard compact title="7日销量" value={safeVal(stats?.sevenDaysSales)} color="success" />
          <StatCard compact title="30日销量" value={safeVal(stats?.thirtyDaysSales)} color="success" />
          <StatCard compact title="今日访客" value={safeVal(fluxSummary?.todayVisitors)} color="purple" />
          <StatCard compact title="今日买家" value={safeVal(fluxSummary?.todayBuyers)} color="purple" />
        </div>
      </div>

      {/* 预警统计 */}
      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">预警信息</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <StatCard compact title="缺货SKC" value={safeVal(stats?.lackSkcNumber)} color="danger" />
          <StatCard compact title="售罄商品" value={safeVal(stats?.alreadySoldOut)} color="danger" />
          <StatCard compact title="即将售罄" value={safeVal(stats?.aboutToSellOut)} color="danger" />
          <StatCard compact title="建议备货" value={safeVal(stats?.advicePrepareSkcNumber)} color="danger" />
          <StatCard compact title="待处理" value={safeVal(stats?.waitProductNumber)} color="brand" />
          <StatCard compact title="高价限制" value={safeVal(stats?.highPriceLimit)} color="danger" />
        </div>
      </div>

      {/* 近期收入 */}
      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">近期收入</div>
        </div>
        {Array.isArray(income) && income.length > 0 ? (
          <div style={{ borderRadius: 12, overflow: "hidden" }}>
            <Table
              dataSource={income.map((item: any, idx: number) => ({
                key: idx,
                date: safeVal(item.date),
                amount: item.amount,
              }))}
              columns={[
                { title: "日期", dataIndex: "date", key: "date" },
                {
                  title: "收入",
                  dataIndex: "amount",
                  key: "amount",
                  render: (val: any) => (
                    <span style={{ borderLeft: "3px solid #00b96b", paddingLeft: 8, fontWeight: 500 }}>
                      {formatAmount(val)}
                    </span>
                  ),
                },
              ]}
              bordered={false}
              pagination={false}
              size="small"
            />
          </div>
        ) : (
          <EmptyGuide title="暂无收入数据" description="采集数据后将在此展示" />
        )}
      </div>

      {/* 店铺排名 */}
      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">店铺排名</div>
        </div>
        {ranking ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, justifyItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ display: "inline-block", padding: 12, borderRadius: "50%", background: "#f0f5ff" }}>
                <Progress
                  type="circle"
                  percent={ranking.overall ? Math.min(100, ranking.overall) : 0}
                  format={() => safeVal(ranking.overall)}
                  size={90}
                />
              </div>
              <div style={{ marginTop: 10 }}>
                <Text strong>综合排名</Text>
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ display: "inline-block", padding: 12, borderRadius: "50%", background: "#f6ffed" }}>
                <Progress
                  type="circle"
                  percent={ranking.pvRank ? Math.min(100, ranking.pvRank) : 0}
                  format={() => safeVal(ranking.pvRank)}
                  size={90}
                />
              </div>
              <div style={{ marginTop: 10 }}>
                <Text strong>PV排名</Text>
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ display: "inline-block", padding: 12, borderRadius: "50%", background: "#f9f0ff" }}>
                <Progress
                  type="circle"
                  percent={ranking.richnessRank ? Math.min(100, ranking.richnessRank) : 0}
                  format={() => safeVal(ranking.richnessRank)}
                  size={90}
                />
              </div>
              <div style={{ marginTop: 10 }}>
                <Text strong>商品丰富度</Text>
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ display: "inline-block", padding: 12, borderRadius: "50%", background: "rgba(26, 115, 232, 0.08)" }}>
                <Progress
                  type="circle"
                  percent={ranking.saleOutRate ? Math.min(100, ranking.saleOutRate) : 0}
                  format={() => safeVal(ranking.saleOutRate)}
                  size={90}
                />
              </div>
              <div style={{ marginTop: 10 }}>
                <Text strong>售罄率排名</Text>
              </div>
            </div>
          </div>
        ) : (
          <EmptyGuide title="暂无排名数据" description="采集数据后将在此展示" />
        )}
      </div>
    </div>
  );

  // ========== Tab 2: 流量分析（运营助手）==========
  const renderFluxTab = () => (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* 顶部：今日 vs 昨日 概览（保留） */}
      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">流量概览{fluxRegion === "us" ? "（美国）" : fluxRegion === "eu" ? "（欧盟）" : ""}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <StatCard compact title="今日访客" value={safeVal(fluxSummary?.todayVisitors)} color="purple" />
          <StatCard compact title="今日买家" value={safeVal(fluxSummary?.todayBuyers)} color="purple" />
          <StatCard compact title="今日转化率" value={fluxSummary?.todayConversionRate ? (fluxSummary.todayConversionRate * 100).toFixed(2) : "-"} suffix="%" color="success" />
          <StatCard compact title="昨日访客" value={yesterdayFlux?.visitors ?? "-"} color="blue" />
          <StatCard compact title="昨日买家" value={yesterdayFlux?.buyers ?? "-"} color="blue" />
          <StatCard compact title="昨日转化率" value={yesterdayFlux?.conversionRate ? (yesterdayFlux.conversionRate * 100).toFixed(2) : "-"} suffix="%" color="brand" />
        </div>
      </div>

      {/* 运营助手面板 */}
      <FluxOperatorPanel
        cache={productHistoryCache}
        region={fluxRegion as RegionKey}
        onRegionChange={(r) => setFluxRegion(r)}
      />

      {/* 流量趋势（保留为补充）*/}
      {fluxTrendList.length > 0 && (
        <div className="app-panel">
          <div className="app-panel__title">
            <div className="app-panel__title-main">店铺整体流量趋势</div>
          </div>
          <div style={{ borderRadius: 12, overflow: "hidden" }}>
            <Table
              dataSource={fluxTrendList.map((item: any, idx: number) => ({
                key: idx,
                ...item,
              }))}
              columns={[
                { title: "日期", dataIndex: "date", key: "date", width: 120 },
                { title: "访客数", dataIndex: "visitors", key: "visitors", render: (v: number) => <span style={{ color: "#1a73e8", fontWeight: 600 }}>{v?.toLocaleString() ?? "-"}</span> },
                { title: "买家数", dataIndex: "buyers", key: "buyers", render: (v: number) => <span style={{ color: "#00b96b", fontWeight: 600 }}>{v?.toLocaleString() ?? "-"}</span> },
                { title: "转化率", dataIndex: "conversionRate", key: "conversionRate", render: (v: number) => <span style={{ color: "#1a73e8", fontWeight: 600 }}>{v ? (v * 100).toFixed(2) + "%" : "-"}</span> },
              ]}
              bordered={false}
              pagination={{ pageSize: 10 }}
              size="small"
            />
          </div>
        </div>
      )}
    </Space>
  );

  // ========== Tab 3: 质量与履约 ==========
  const scoreEnumMap: Record<number, { label: string; color: string }> = {
    1: { label: "优秀", color: "#00b96b" },
    2: { label: "良好", color: "#1a73e8" },
    3: { label: "一般", color: "#faad14" },
    4: { label: "较差", color: "#ea4335" },
    5: { label: "极差", color: "#cf1322" },
  };

  const renderQualityTab = () => (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* 区域切换 */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Segmented
          value={qualityRegion}
          onChange={(v) => setQualityRegion(v as string)}
          options={[
            { label: "🌍 全球", value: "global" },
            { label: "🇪🇺 欧盟", value: "eu" },
          ]}
          style={{ borderRadius: 8 }}
        />
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">云端售后与质检</div>
            <div className="app-panel__title-sub">浏览器扩展上报的售后、退货、抽检、违规风险，按店铺和 SKC 汇总展示。</div>
          </div>
        </div>
        {cloudAfterSales.length > 0 || cloudQualityRisks.length > 0 ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <StatCard compact title="售后记录" value={formatCloudNumber(cloudAfterSales.length)} color="danger" />
              <StatCard compact title="售后待处理" value={formatCloudNumber(cloudPendingAfterSaleCount)} color={cloudPendingAfterSaleCount ? "danger" : "neutral"} />
              <StatCard compact title="质检/违规风险" value={formatCloudNumber(cloudQualityRisks.length)} color={cloudQualityRisks.length ? "orange" : "neutral"} />
            </div>
            {cloudAfterSaleSummary.length > 0 ? (
              <Space wrap>
                {cloudAfterSaleSummary.map((item) => (
                  <Tag key={`${item.after_sale_type || "after"}-${item.status || "status"}`} color={cloudBusinessStatusColor(item.status)}>
                    {item.after_sale_type || "售后"} {item.status || "未知"} {formatCloudNumber(item.count)}条
                  </Tag>
                ))}
              </Space>
            ) : null}
            {cloudAfterSales.length > 0 ? (
              <Table
                rowKey={(row: TemuAfterSaleRow) => row.id || row.row_key}
                dataSource={cloudAfterSales.slice(0, 120)}
                size="small"
                pagination={{ pageSize: 10 }}
                scroll={{ x: 1260 }}
                columns={[
                  {
                    title: "商品",
                    key: "product",
                    width: 360,
                    render: (_value: any, row: TemuAfterSaleRow) => (
                      <Space direction="vertical" size={0} style={{ width: "100%" }}>
                        <Paragraph ellipsis={{ rows: 2, tooltip: row.product_name || "-" }} style={{ marginBottom: 0, fontWeight: 600, lineHeight: 1.4 }}>
                          {row.product_name || "-"}
                        </Paragraph>
                        <Text type="secondary" style={{ fontSize: 12 }}>SKC: {row.skc_id || "-"} / SKU: {row.sku_id || "-"}</Text>
                      </Space>
                    ),
                  },
                  { title: "类型", dataIndex: "after_sale_type", key: "type", width: 120, render: (value: string | null) => value || "-" },
                  { title: "状态", dataIndex: "status", key: "status", width: 120, render: (value: string | null) => <Tag color={cloudBusinessStatusColor(value)}>{value || "-"}</Tag> },
                  { title: "原因", dataIndex: "reason", key: "reason", width: 180, ellipsis: true, render: (value: string | null) => value || "-" },
                  { title: "数量", dataIndex: "quantity", key: "quantity", width: 90, render: (value: number | null) => formatCloudNumber(value) },
                  { title: "金额", key: "amount", width: 120, render: (_value: any, row: TemuAfterSaleRow) => formatCloudMoney(row.amount_cents, row.currency) },
                  {
                    title: "物流/仓",
                    key: "logistics",
                    width: 190,
                    render: (_value: any, row: TemuAfterSaleRow) => (
                      <Space direction="vertical" size={0}>
                        <Text style={{ fontSize: 12 }}>{row.logistics_no || "-"}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{row.warehouse_name || "-"}</Text>
                      </Space>
                    ),
                  },
                  { title: "更新时间", dataIndex: "last_updated_at", key: "updated", width: 170, render: (value: string | null) => formatCloudTime(value) },
                ]}
              />
            ) : null}
            {cloudQualityRisks.length > 0 ? (
              <Table
                rowKey={(row: TemuOperationRiskRow) => row.id || row.risk_key}
                dataSource={cloudQualityRisks.slice(0, 120)}
                size="small"
                pagination={{ pageSize: 8 }}
                scroll={{ x: 1100 }}
                columns={[
                  { title: "风险类型", dataIndex: "risk_type", key: "riskType", width: 150, render: (value: string | null) => cloudRiskLabel(value) },
                  { title: "等级", dataIndex: "severity", key: "severity", width: 90, render: (value: string | null) => <Tag color={cloudRiskColor(value)}>{value || "default"}</Tag> },
                  { title: "标题/编号", key: "title", width: 300, render: (_value: any, row: TemuOperationRiskRow) => row.risk_title || row.risk_key || "-" },
                  { title: "状态", dataIndex: "risk_status", key: "status", width: 120, render: (value: string | null) => <Tag color={cloudBusinessStatusColor(value)}>{value || "-"}</Tag> },
                  { title: "店铺", dataIndex: "mall_id", key: "mall", width: 140, render: (value: string | null) => value || "-" },
                  { title: "SKC", dataIndex: "skc_id", key: "skc", width: 140, render: (value: string | null) => value || "-" },
                  { title: "数量", dataIndex: "quantity", key: "quantity", width: 90, render: (value: number | null) => formatCloudNumber(value) },
                  { title: "更新时间", dataIndex: "last_updated_at", key: "updated", width: 170, render: (value: string | null) => formatCloudTime(value) },
                ]}
              />
            ) : null}
          </Space>
        ) : (
          <EmptyGuide title="暂无云端售后/质检数据" description="扩展命中售后、退货、抽检或违规接口后会显示在这里" />
        )}
      </div>

      {/* 质量评分卡片 */}
      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">质量评分{qualityRegion === "eu" ? "（欧盟）" : ""}</div>
        </div>
        {qualityMetrics ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <StatCard compact title="90天平均评分" value={Number(qualityMetrics.avgScore90d)?.toFixed(2) || "-"} color="blue" />
            <StatCard compact title="90天售后退货率" value={qualityMetrics.qltyAfsOrdrRate90d ? (Number(qualityMetrics.qltyAfsOrdrRate90d) * 100).toFixed(2) : "-"} suffix="%" color="brand" />
            <StatCard compact title="质量售后成本" value={qualityMetrics.qltyAfsCst != null ? `¥${Number(qualityMetrics.qltyAfsCst).toFixed(2)}` : "-"} color="success" />
          </div>
        ) : (
          <EmptyGuide title="暂无质量评分数据" description="采集数据后将在此展示" />
        )}
      </div>

      {/* 商品质量分布 */}
      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">商品质量分布</div>
        </div>
        {qualityScoreList?.productQualityScoreList?.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {qualityScoreList.productQualityScoreList.map((item: any, idx: number) => {
              const enumVal = item.qualityScoreEnum || item.scoreEnum || idx + 1;
              const meta = scoreEnumMap[enumVal] || { label: `等级${enumVal}`, color: "#999" };
              const count = item.productQuantity || item.count || 0;
              return (
                <Card key={idx} size="small" style={{ borderRadius: 10, borderTop: `3px solid ${meta.color}`, textAlign: "center" }}>
                  <div style={{ fontSize: 32, fontWeight: 700, color: meta.color }}>{count}</div>
                  <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
                    <Tag color={meta.color} style={{ borderRadius: 4 }}>{meta.label}</Tag>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyGuide title="暂无商品质量分布数据" description="采集数据后将在此展示" />
        )}
      </div>

      {/* 履约表现 */}
      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">履约表现</div>
        </div>
        {perfAbstract ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <StatCard compact title="供应商综合得分" value={perfAbstract.supplierAvgScore ?? "-"} color="purple" />
            <StatCard compact title="优秀区间" value={`${perfAbstract.excellentZoneStart ?? "-"} ~ ${perfAbstract.excellentZoneEnd ?? "-"}`} color="success" />
            <StatCard compact title="良好区间" value={`${perfAbstract.wellZoneStart ?? "-"} ~ ${perfAbstract.wellZoneEnd ?? "-"}`} color="danger" />
          </div>
        ) : (
          <EmptyGuide title="暂无履约表现数据" description="采集数据后将在此展示" />
        )}
      </div>

      {/* 抽检结果明细 */}
      {(() => {
        const checkScore = findInRawStore(checkup, "check/score");
        const checkRules = findInRawStore(checkup, "check/rule/list");
        const checkProducts = findInRawStore(checkup, "check/product/list");
        const productList = checkProducts?.pageItems || checkProducts?.list || [];
        const ruleList = checkRules?.supplierCheckRuleList || [];

        return (
          <>
            <div className="app-panel">
              <div className="app-panel__title">
                <div className="app-panel__title-main">店铺体检</div>
              </div>
              {checkScore ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                  <StatCard compact title="体检评分" value={checkScore.score ?? "-"} color="blue" />
                  <StatCard compact title="商品总数" value={checkScore.productNumber ?? "-"} color="purple" />
                  <StatCard compact title="问题商品" value={checkScore.problemProductNumber ?? "-"} color="danger" />
                  <StatCard compact title="检查规则数" value={checkScore.supplierCheckRuleNumber ?? "-"} color="brand" />
                </div>
              ) : (
                <EmptyGuide title="暂无体检数据" description="采集数据后将在此展示" />
              )}
            </div>

            {ruleList.length > 0 && (
              <div className="app-panel">
                <div className="app-panel__title">
                  <div className="app-panel__title-main">问题分类</div>
                </div>
                {ruleList.map((rule: any, idx: number) => (
                  <div key={idx} style={{ marginBottom: idx < ruleList.length - 1 ? 16 : 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: "#1a1a2e" }}>
                      {rule.ruleName} <Tag color="red" style={{ borderRadius: 4 }}>{rule.number} 个问题</Tag>
                    </div>
                    {rule.childCheckRuleList?.length > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                        {rule.childCheckRuleList.map((child: any, ci: number) => (
                          <Card key={ci} size="small" style={{ borderRadius: 8, borderLeft: `3px solid ${child.number > 50 ? "#ea4335" : child.number > 10 ? "#faad14" : "#00b96b"}` }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 13, color: "#333" }}>{child.ruleName}</span>
                              <span style={{ fontSize: 20, fontWeight: 700, color: child.number > 50 ? "#ea4335" : child.number > 10 ? "#faad14" : "#00b96b" }}>
                                {child.number}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>权重: {((child.weight || 0) * 100).toFixed(0)}% | 扣分: {child.score ?? "-"}</div>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {productList.length > 0 && (
              <div className="app-panel">
                <div className="app-panel__title">
                  <div className="app-panel__title-main">问题商品明细 ({productList.length})</div>
                </div>
                <div style={{ borderRadius: 12, overflow: "hidden" }}>
                  <Table
                    dataSource={productList.map((p: any, i: number) => ({ key: i, ...p }))}
                    columns={[
                      {
                        title: "商品名称", dataIndex: "productName", key: "name", width: 420,
                        render: (v: string, r: any) => (
                          <Space align="start">
                            {r.productImageList?.carouselImageUrls?.[0] && (
                              <img src={r.productImageList.carouselImageUrls[0]} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover" }} />
                            )}
                            <div style={{ minWidth: 0 }}>
                              <Paragraph
                                ellipsis={{ rows: 2, tooltip: v || "-" }}
                                style={{ marginBottom: 0, fontSize: 13, lineHeight: 1.5 }}
                              >
                                {v || "-"}
                              </Paragraph>
                            </div>
                          </Space>
                        ),
                      },
                      {
                        title: "类目", dataIndex: "categoriesSimpleVO", key: "cat", width: 150,
                        render: (v: any) => <span style={{ fontSize: 12, color: "#666" }}>{v?.leafCat?.catName || v?.cat1?.catName || "-"}</span>,
                      },
                      {
                        title: "问题类型", dataIndex: "supplierCheckRuleList", key: "rules", width: 200,
                        render: (rules: any[]) => (
                          <Space wrap>
                            {rules?.map((r: any, i: number) => (
                              <Tag key={i} color="red" style={{ borderRadius: 4 }}>{r.ruleName || `规则${r.ruleId}`}</Tag>
                            )) || "-"}
                          </Space>
                        ),
                      },
                    ]}
                    bordered={false}
                    pagination={{ pageSize: 10 }}
                    size="small"
                    scroll={{ x: 860 }}
                  />
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* 抽检结果明细 (商家中心) */}
      {(() => {
        // 从 qcDetail 中提取抽检列表
        const allPagesApi = qcDetail?.apis?.find((a: any) => a.path?.includes("all-pages"));
        const qcListApi = qcDetail?.apis?.find((a: any) => {
          const r = a.data?.result;
          return r && (r.list || r.pageItems || r.total);
        });
        const qcItems = allPagesApi?.data?.result?.list || qcListApi?.data?.result?.list || qcListApi?.data?.result?.pageItems || [];
        const qcTotal = allPagesApi?.data?.result?.total || qcListApi?.data?.result?.total || qcItems.length;

        if (qcItems.length === 0 && !qcTotal) return (
          <div className="app-panel">
            <div className="app-panel__title">
              <div className="app-panel__title-main">抽检结果明细</div>
            </div>
            <EmptyGuide title="暂无抽检数据" description="请重新采集" />
          </div>
        );

        return (
          <div className="app-panel">
            <div className="app-panel__title">
              <div className="app-panel__title-main">抽检结果明细 ({qcTotal})</div>
            </div>
            <div style={{ borderRadius: 12, overflow: "hidden" }}>
              <Table
                dataSource={qcItems.map((item: any, i: number) => ({ key: i, ...item }))}
                columns={[
                  {
                    title: "商品信息", dataIndex: "productName", key: "name", width: 360,
                    render: (v: string, r: any) => {
                      const img = r.productImageList?.carouselImageUrls?.[0] || r.imageUrl || r.goodsImageUrl;
                      return (
                        <Space align="start">
                          {img && <img src={img} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover" }} />}
                          <div style={{ minWidth: 0 }}>
                            <Paragraph
                              ellipsis={{ rows: 2, tooltip: v || r.goodsName || "-" }}
                              style={{ marginBottom: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.5 }}
                            >
                              {v || r.goodsName || "-"}
                            </Paragraph>
                            <div style={{ fontSize: 11, color: "#999" }}>
                              {r.spuId ? `SPU: ${r.spuId}` : ""} {r.skcId ? `SKC: ${r.skcId}` : ""} {r.productSkcId ? `SKC: ${r.productSkcId}` : ""}
                            </div>
                          </div>
                        </Space>
                      );
                    },
                  },
                  {
                    title: "SKU信息", key: "sku", width: 150,
                    render: (_: any, r: any) => (
                      <div style={{ fontSize: 12 }}>
                        {r.skuId ? <div>SKU: {r.skuId}</div> : null}
                        {r.skuAttr || r.attribute ? <div style={{ color: "#666" }}>{r.skuAttr || r.attribute}</div> : null}
                      </div>
                    ),
                  },
                  {
                    title: "备货单号", dataIndex: "purchaseOrderSn", key: "po", width: 180,
                    render: (v: string) => <span style={{ fontSize: 12, fontFamily: "monospace" }}>{v || "-"}</span>,
                  },
                  {
                    title: "抽检时间", dataIndex: "checkTime", key: "time", width: 160,
                    render: (v: any) => {
                      if (!v) return "-";
                      if (typeof v === "number") return new Date(v).toLocaleString("zh-CN");
                      return String(v);
                    },
                  },
                  {
                    title: "结果", dataIndex: "checkResult", key: "result", width: 100,
                    render: (v: any) => {
                      const text = v === 1 || v === "合格" ? "合格" : v === 2 || v === "不合格" ? "不合格" : safeVal(v);
                      const color = text === "合格" ? "#00b96b" : text === "不合格" ? "#ea4335" : "#666";
                      return <Tag color={color} style={{ borderRadius: 4 }}>{text}</Tag>;
                    },
                  },
                ]}
                bordered={false}
                pagination={{ pageSize: 10 }}
                size="small"
                scroll={{ x: 980 }}
              />
            </div>
          </div>
        );
      })()}
    </Space>
  );

  // ========== Tab 4: 营销活动 ==========
  const renderMarketingTab = () => (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">云端活动快照</div>
          <div className="app-panel__title-sub">{cloudActivities.length ? `${cloudActivities.length} 条` : ""}</div>
        </div>
        {cloudActivities.length > 0 ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {cloudActivitySummary.length > 0 ? (
              <Space wrap>
                {cloudActivitySummary.map((item) => (
                  <Tag key={item.activity_kind || "unknown"} color="blue">
                    {cloudActivityLabel(item.activity_kind)} {formatCloudNumber(item.count)}
                  </Tag>
                ))}
              </Space>
            ) : null}
            <Table
              rowKey={(row: TemuActivityRow) => row.id || row.row_key}
              dataSource={cloudActivities.slice(0, 120)}
              size="small"
              pagination={{ pageSize: 10 }}
              scroll={{ x: 1120 }}
              columns={[
                {
                  title: "活动",
                  key: "title",
                  width: 300,
                  render: (_value: any, row: TemuActivityRow) => (
                    <Space direction="vertical" size={2}>
                      <Paragraph ellipsis={{ rows: 2, tooltip: row.activity_title || row.activity_id || "-" }} style={{ marginBottom: 0 }}>
                        {row.activity_title || row.activity_id || "-"}
                      </Paragraph>
                      <Text type="secondary" style={{ fontSize: 12 }}>{row.activity_id || row.row_key}</Text>
                    </Space>
                  ),
                },
                { title: "店铺", dataIndex: "mall_id", key: "mall", width: 140 },
                { title: "SKC", dataIndex: "skc_id", key: "skc", width: 130 },
                {
                  title: "类型",
                  key: "kind",
                  width: 110,
                  render: (_value: any, row: TemuActivityRow) => <Tag color="blue">{row.activity_type || cloudActivityLabel(row.activity_kind)}</Tag>,
                },
                {
                  title: "状态",
                  dataIndex: "activity_status",
                  key: "status",
                  width: 110,
                  render: (value: string | null) => <Tag color={cloudActivityStatusColor(value)}>{value || "-"}</Tag>,
                },
                { title: "报名价", dataIndex: "signup_price_cents", key: "signup", width: 120, render: (value: number | null, row: TemuActivityRow) => formatCloudMoney(value, row.price_currency) },
                { title: "建议价", dataIndex: "suggested_price_cents", key: "suggested", width: 120, render: (value: number | null, row: TemuActivityRow) => formatCloudMoney(value, row.price_currency) },
                { title: "活动库存", dataIndex: "activity_stock", key: "stock", width: 110, render: formatCloudNumber },
                { title: "更新时间", dataIndex: "last_updated_at", key: "updated", width: 180, render: formatCloudTime },
              ]}
            />
          </Space>
        ) : (
          <EmptyGuide title="暂无云端活动数据" description="扩展命中活动、营销、报名或竞价接口后会显示" />
        )}
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">昨日营销数据</div>
        </div>
        {marketingStats?.yesterdayStatistics ? (() => {
          const s = marketingStats.yesterdayStatistics;
          return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <StatCard compact title="活动支付金额" value={s.activityPayAmountTotal ? `¥${Number(s.activityPayAmountTotal).toLocaleString()}` : "-"} color="brand" />
              <StatCard compact title="活动商品数" value={s.activityGoodsCount ?? "-"} color="purple" />
              <StatCard compact title="活动订单数" value={s.activityGoodsOrderCount ?? "-"} color="blue" />
              <StatCard compact title="加购数" value={s.activityGoodsCartCount ?? "-"} color="success" />
              <StatCard compact title="支付金额占比" value={s.activityPayAmountRatio ? `${Number(s.activityPayAmountRatio).toFixed(1)}%` : "-"} color="brand" />
              <StatCard compact title="订单转化率" value={s.activityGoodsOrderRatio ? `${Number(s.activityGoodsOrderRatio).toFixed(2)}%` : "-"} color="blue" />
              <StatCard compact title="加购率" value={s.activityGoodsCartRatio ? `${(Number(s.activityGoodsCartRatio) * 100).toFixed(2)}%` : "-"} color="success" />
              <StatCard compact title="商品占比" value={s.activityGoodsRatio ? `${Number(s.activityGoodsRatio).toFixed(1)}%` : "0%"} color="purple" />
            </div>
          );
        })() : (
          <EmptyGuide title="暂无营销统计数据" description="采集数据后将在此展示" />
        )}
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">活动待办</div>
        </div>
        {marketingTodo ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <StatCard compact title="缺货数量" value={safeVal(marketingTodo.stockShort)} color="danger" />
            <StatCard compact title="处理中" value={safeVal(marketingTodo.inProcess)} color="blue" />
          </div>
        ) : (
          <EmptyGuide title="暂无活动待办数据" description="采集数据后将在此展示" />
        )}
      </div>
    </Space>
  );

  // ========== Tab 5: 合规状态 ==========
  const renderComplianceTab = () => {
    const boardList =
      complianceBoard?.addition_compliance_board_list || [];

    return (
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <div className="app-panel">
          <div className="app-panel__title">
            <div className="app-panel__title-main">云端风险快照</div>
            <div className="app-panel__title-sub">{cloudRisks.length ? `${cloudRisks.length} 条` : ""}</div>
          </div>
          {cloudRisks.length > 0 ? (
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              {cloudRiskSummary.length > 0 ? (
                <Space wrap>
                  {cloudRiskSummary.map((item) => (
                    <Tag key={`${item.risk_type || "risk"}-${item.severity || "level"}`} color={cloudRiskColor(item.severity)}>
                      {cloudRiskLabel(item.risk_type)} {formatCloudNumber(item.count)}
                    </Tag>
                  ))}
                </Space>
              ) : null}
              <Table
                rowKey={(row: TemuOperationRiskRow) => row.id || row.risk_key}
                dataSource={cloudRisks.slice(0, 160)}
                size="small"
                pagination={{ pageSize: 10 }}
                scroll={{ x: 1180 }}
                columns={[
                  {
                    title: "风险类型",
                    dataIndex: "risk_type",
                    key: "type",
                    width: 130,
                    render: (value: string | null) => <Tag color="orange">{cloudRiskLabel(value)}</Tag>,
                  },
                  {
                    title: "等级",
                    dataIndex: "severity",
                    key: "severity",
                    width: 90,
                    render: (value: string | null) => <Tag color={cloudRiskColor(value)}>{value || "-"}</Tag>,
                  },
                  {
                    title: "风险内容",
                    key: "title",
                    width: 320,
                    render: (_value: any, row: TemuOperationRiskRow) => (
                      <Space direction="vertical" size={2}>
                        <Paragraph ellipsis={{ rows: 2, tooltip: row.risk_title || row.risk_key }} style={{ marginBottom: 0 }}>
                          {row.risk_title || row.risk_key || "-"}
                        </Paragraph>
                        <Text type="secondary" style={{ fontSize: 12 }}>{row.risk_status || row.order_id || "-"}</Text>
                      </Space>
                    ),
                  },
                  { title: "店铺", dataIndex: "mall_id", key: "mall", width: 140 },
                  { title: "SKC", dataIndex: "skc_id", key: "skc", width: 130 },
                  { title: "货号", dataIndex: "goods_id", key: "goods", width: 130 },
                  { title: "数量", dataIndex: "quantity", key: "qty", width: 90, render: formatCloudNumber },
                  { title: "更新时间", dataIndex: "last_updated_at", key: "updated", width: 180, render: formatCloudTime },
                ]}
              />
            </Space>
          ) : (
            <EmptyGuide title="暂无云端风险数据" description="扩展命中入库、发货、物流、质检、限流等接口后会显示" />
          )}
        </div>

        <div className="app-panel">
          <div className="app-panel__title">
            <div className="app-panel__title-main">合规看板</div>
          </div>
          {Array.isArray(boardList) && boardList.length > 0 ? (
            <div style={{ borderRadius: 12, overflow: "hidden" }}>
              <Table
                dataSource={boardList.map((item: any, idx: number) => ({
                  key: idx,
                  type: safeVal(item.dash_board_type),
                  count: safeVal(item.main_show_num),
                  url: safeVal(item.jump_url),
                }))}
                columns={[
                  { title: "类型", dataIndex: "type", key: "type" },
                  { title: "数量", dataIndex: "count", key: "count" },
                  { title: "跳转链接", dataIndex: "url", key: "url", ellipsis: true },
                ]}
                bordered={false}
                pagination={false}
                size="small"
              />
            </div>
          ) : (
            <EmptyGuide title="暂无合规数据" description="采集数据后将在此展示" />
          )}
        </div>

        <div className="app-panel">
          <div className="app-panel__title">
            <div className="app-panel__title-main">实拍图待办</div>
          </div>
          <StatCard compact title="待处理总数" value={safeVal(realPictureTodo?.totalCount)} color="blue" />
        </div>
      </Space>
    );
  };

  // ========== Tab 6: 物流发货 ==========
  const renderDeliveryTab = () => (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">云端备货与履约</div>
            <div className="app-panel__title-sub">浏览器扩展上报的备货单、发货单、入库异常和物流反馈。</div>
          </div>
        </div>
        {cloudStockOrders.length > 0 || cloudDeliveryRisks.length > 0 ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
              <StatCard compact title="备货/发货单" value={formatCloudNumber(cloudStockOrders.length)} color="brand" />
              <StatCard compact title="待处理" value={formatCloudNumber(cloudPendingStockOrderCount)} color={cloudPendingStockOrderCount ? "orange" : "neutral"} />
              <StatCard compact title="需求件数" value={formatCloudNumber(cloudStockDemandQty)} color="blue" />
              <StatCard compact title="已发件数" value={formatCloudNumber(cloudStockDeliveredQty)} color="success" />
              <StatCard compact title="物流/入库风险" value={formatCloudNumber(cloudDeliveryRisks.length)} color={cloudDeliveryRisks.length ? "danger" : "neutral"} />
            </div>
            {cloudStockOrderSummary.length > 0 ? (
              <Space wrap>
                {cloudStockOrderSummary.map((item) => (
                  <Tag key={item.temu_status || "unknown"} color={cloudBusinessStatusColor(item.temu_status)}>
                    {item.temu_status || "未知"} {formatCloudNumber(item.count)}单 / {formatCloudNumber(item.demand_qty)}件
                  </Tag>
                ))}
              </Space>
            ) : null}
            {cloudStockOrders.length > 0 ? (
              <Table
                rowKey={(row: TemuStockOrderRow) => row.id || row.row_key}
                dataSource={cloudStockOrders.slice(0, 160)}
                size="small"
                pagination={{ pageSize: 10 }}
                scroll={{ x: 1400 }}
                columns={[
                  {
                    title: "单号",
                    key: "order",
                    width: 210,
                    render: (_value: any, row: TemuStockOrderRow) => (
                      <Space direction="vertical" size={0}>
                        <Text strong>{row.stock_order_no || row.delivery_order_sn || row.delivery_batch_sn || "-"}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{row.parent_order_no || row.delivery_batch_sn || "-"}</Text>
                      </Space>
                    ),
                  },
                  {
                    title: "商品",
                    key: "product",
                    width: 360,
                    render: (_value: any, row: TemuStockOrderRow) => (
                      <Space direction="vertical" size={0} style={{ width: "100%" }}>
                        <Paragraph ellipsis={{ rows: 2, tooltip: row.product_name || "-" }} style={{ marginBottom: 0, fontWeight: 600, lineHeight: 1.4 }}>
                          {row.product_name || "-"}
                        </Paragraph>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          SKC: {row.skc_id || "-"} / SKU: {row.sku_id || "-"} / 货号: {row.sku_ext_code || "-"}
                        </Text>
                      </Space>
                    ),
                  },
                  { title: "状态", dataIndex: "temu_status", key: "status", width: 120, render: (value: string | null) => <Tag color={cloudBusinessStatusColor(value)}>{value || "-"}</Tag> },
                  { title: "需求", dataIndex: "demand_qty", key: "demand", width: 90, render: (value: number | null) => formatCloudNumber(value) },
                  { title: "已发", dataIndex: "delivered_qty", key: "delivered", width: 90, render: (value: number | null) => formatCloudNumber(value) },
                  {
                    title: "收货仓",
                    key: "warehouse",
                    width: 180,
                    render: (_value: any, row: TemuStockOrderRow) => row.receive_warehouse_name || row.warehouse_group || "-",
                  },
                  { title: "要求发货", key: "shipAt", width: 170, render: (_value: any, row: TemuStockOrderRow) => formatCloudTime(row.latest_ship_at || row.order_time) },
                  { title: "更新时间", dataIndex: "last_updated_at", key: "updated", width: 170, render: (value: string | null) => formatCloudTime(value) },
                ]}
              />
            ) : null}
            {cloudDeliveryRisks.length > 0 ? (
              <Table
                rowKey={(row: TemuOperationRiskRow) => row.id || row.risk_key}
                dataSource={cloudDeliveryRisks.slice(0, 120)}
                size="small"
                pagination={{ pageSize: 8 }}
                scroll={{ x: 1100 }}
                columns={[
                  { title: "风险类型", dataIndex: "risk_type", key: "riskType", width: 150, render: (value: string | null) => cloudRiskLabel(value) },
                  { title: "等级", dataIndex: "severity", key: "severity", width: 90, render: (value: string | null) => <Tag color={cloudRiskColor(value)}>{value || "default"}</Tag> },
                  { title: "标题/编号", key: "title", width: 300, render: (_value: any, row: TemuOperationRiskRow) => row.risk_title || row.risk_key || "-" },
                  { title: "状态", dataIndex: "risk_status", key: "status", width: 120, render: (value: string | null) => <Tag color={cloudBusinessStatusColor(value)}>{value || "-"}</Tag> },
                  { title: "店铺", dataIndex: "mall_id", key: "mall", width: 140, render: (value: string | null) => value || "-" },
                  { title: "订单", dataIndex: "order_id", key: "order", width: 160, render: (value: string | null) => value || "-" },
                  { title: "数量", dataIndex: "quantity", key: "quantity", width: 90, render: (value: number | null) => formatCloudNumber(value) },
                  { title: "更新时间", dataIndex: "last_updated_at", key: "updated", width: 170, render: (value: string | null) => formatCloudTime(value) },
                ]}
              />
            ) : null}
          </Space>
        ) : (
          <EmptyGuide title="暂无云端备货/履约数据" description="扩展命中备货、发货、物流或入库接口后会显示在这里" />
        )}
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">发货概览</div>
        </div>
        {deliverySummary ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <StatCard compact title="暂存数量" value={safeVal(deliverySummary.stagingCount)} color="blue" />
            <StatCard compact title="正向发货数" value={safeVal(deliverySummary.forwardCount)} color="success" />
            <StatCard compact title="过期数量" value={safeVal(deliverySummary.expiredCount)} color="danger" />
          </div>
        ) : (
          <EmptyGuide title="暂无发货数据" description="采集数据后将在此展示" />
        )}
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">售罄概览</div>
        </div>
        {soldoutOverview ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <StatCard compact title="即将售罄" value={safeVal(soldoutOverview?.soonSellOutNum)} color="danger" />
            <StatCard compact title="已售罄" value={safeVal(soldoutOverview?.sellOutNum)} color="danger" />
            <StatCard compact title="售罄损失" value={safeVal(soldoutOverview?.sellOutLossNum)} color="danger" />
          </div>
        ) : (
          <EmptyGuide title="暂无售罄数据" description="采集数据后将在此展示" />
        )}
      </div>
    </Space>
  );

  // ========== Tab 7: 商品动态（库存预警）==========
  const runStockCheck = async () => {
    if (!store) {
      message.error("本地存储接口未就绪，请在桌面端内运行。");
      return;
    }
    setStockChecking(true);
    setStockNotice(null);
    try {
      const rawSales = await store.get("temu_sales");
      if (!rawSales) {
        throw new Error("请先执行「一键采集」，再运行库存预警检查。");
      }
      const parsed = parseSalesData(rawSales);
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      const now = new Date().toLocaleString("zh-CN");
      if (items.length === 0) {
        setLowStockItems([]);
        setStockLastCheckedAt(now);
        setStockNotice({ type: "warning", message: "销售数据里没有商品记录，请重新采集后再试。" });
        return;
      }
      const nextItems = items
        .filter((item: any) => typeof item.warehouseStock === "number" && item.warehouseStock <= stockThreshold)
        .map((item: any, index: number) => ({
          key: `${item.skcId || item.skuId || index}`,
          title: item.title || "-",
          skcId: String(item.skcId || "-"),
          skuCode: item.skuCode || "-",
          warehouseStock: Number(item.warehouseStock || 0),
          supplyStatus: item.supplyStatus || "-",
        }))
        .sort((a: any, b: any) => a.warehouseStock - b.warehouseStock);
      setLowStockItems(nextItems);
      setStockLastCheckedAt(now);
      setStockNotice(
        nextItems.length > 0
          ? { type: "warning", message: `库存检查完成，发现 ${nextItems.length} 个低库存商品。` }
          : { type: "info", message: "库存检查完成，当前没有低于阈值的商品。" },
      );
    } catch (error: any) {
      setStockNotice({ type: "error", message: error?.message || "库存检查失败，请稍后重试。" });
    } finally {
      setStockChecking(false);
    }
  };

  const handleSaveStockThreshold = async () => {
    if (!store) return;
    setSavingStockThreshold(true);
    try {
      const appSettings = normalizeAppSettings(await store.get(APP_SETTINGS_KEY));
      await setStoreValueForActiveAccount(store, APP_SETTINGS_KEY, { ...appSettings, lowStockThreshold: stockThreshold });
      setSavedStockThreshold(stockThreshold);
      message.success("低库存阈值已保存。");
    } catch (error: any) {
      message.error(error?.message || "保存阈值失败。");
    } finally {
      setSavingStockThreshold(false);
    }
  };

  const renderProductTab = () => (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">库存预警</div>
        </div>
        <Space size={16} wrap align="end" style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={4}>
            <Text type="secondary">低库存阈值</Text>
            <Space>
              <InputNumber
                min={1} max={1000}
                value={stockThreshold}
                onChange={(v) => setStockThreshold(typeof v === "number" ? v : 1)}
              />
              <Button
                onClick={handleSaveStockThreshold}
                loading={savingStockThreshold}
                disabled={stockThreshold === savedStockThreshold}
              >
                保存
              </Button>
            </Space>
          </Space>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            loading={stockChecking}
            onClick={runStockCheck}
          >
            立即检查
          </Button>
          {stockLastCheckedAt && (
            <Text type="secondary">上次检查：{stockLastCheckedAt}</Text>
          )}
        </Space>
        {stockNotice && (
          <Alert type={stockNotice.type} showIcon message={stockNotice.message} style={{ marginBottom: 12 }} />
        )}
        {lowStockItems.length > 0 ? (
          <Table
            dataSource={lowStockItems}
            rowKey="key"
            pagination={{ pageSize: 10 }}
            columns={[
              {
                title: "商品",
                dataIndex: "title",
                key: "title",
                width: 320,
                render: (value: string) => (
                  <Paragraph ellipsis={{ rows: 2, tooltip: value || "-" }} style={{ marginBottom: 0, lineHeight: 1.5 }}>
                    {value || "-"}
                  </Paragraph>
                ),
              },
              { title: "SKC", dataIndex: "skcId", key: "skcId", width: 140 },
              { title: "SKU", dataIndex: "skuCode", key: "skuCode", width: 140 },
              {
                title: "库存",
                dataIndex: "warehouseStock",
                key: "warehouseStock",
                width: 100,
                render: (value: number) => (
                  <Tag color={value <= Math.max(1, Math.floor(stockThreshold / 2)) ? "error" : "warning"}>{value}</Tag>
                ),
              },
              { title: "供货状态", dataIndex: "supplyStatus", key: "supplyStatus", width: 140 },
            ]}
            scroll={{ x: 820 }}
          />
        ) : (
          <EmptyGuide title={stockLastCheckedAt ? "当前没有低库存商品" : "尚未执行库存检查"} description="点击「立即检查」开始库存预警检查" />
        )}
      </div>
    </Space>
  );

  // ========== 主渲染 ==========
  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  const tabItems = [
    {
      key: "overview",
      label: "数据概览",
      children: renderOverviewTab(),
    },
    {
      key: "flux",
      label: "流量分析",
      children: renderFluxTab(),
    },
    {
      key: "quality",
      label: "质量与履约",
      children: renderQualityTab(),
    },
    {
      key: "marketing",
      label: "营销活动",
      children: renderMarketingTab(),
    },
    {
      key: "compliance",
      label: "合规状态",
      children: renderComplianceTab(),
    },
    {
      key: "delivery",
      label: "物流发货",
      children: renderDeliveryTab(),
    },
    {
      key: "products",
      label: "商品动态",
      children: renderProductTab(),
    },
  ];
  const commandSaleValue = cloudConfigured ? formatCloudNumber(cloudTotals.sale_volume) : safeVal(stats?.sevenDaysSales);
  const commandThirtyDayValue = cloudConfigured ? formatCloudNumber(cloudTotals.thirty_days_sale_volume) : safeVal(stats?.thirtyDaysSales);
  const commandFlowValue = cloudConfigured ? formatCloudNumber(cloudTotals.flow_expose_num) : safeVal(fluxSummary?.todayVisitors);
  const commandRiskValue = cloudConfigured ? formatCloudNumber(cloudTotals.risk_count || cloudRiskCount) : formatCloudNumber(dataIssues.length);
  const commandStatusText = dataIssues.length > 0
    ? "数据待补齐"
    : cloudHighRiskCount > 0
      ? "存在高风险"
      : "经营状态稳定";
  const commandStatusTone = dataIssues.length > 0 || cloudHighRiskCount > 0 ? "is-warning" : "is-success";

  return (
    <div className="dashboard-shell shop-overview-shell">
      <PageHeader
        compact
        eyebrow="运营"
        title="店铺概览"
        subtitle={cloudLatestAt ? `云端最近更新：${formatCloudTime(cloudLatestAt)}` : diagnostics?.syncedAt ? `最近采集：${diagnostics.syncedAt}` : "核心经营数据、预警信息、流量与合规一览"}
        meta={[
          cloudConfigured ? `云端店铺 ${cloudTotals.mall_count || cloudMonitorRows.length}` : "云端未配置",
          cloudConfigured ? `活动 ${cloudTotals.activity_count || cloudActivityCount}` : null,
          cloudConfigured ? `风险 ${cloudTotals.risk_count || cloudRiskCount}` : null,
          cloudConfigured ? `备货单 ${cloudTotals.stock_order_count}` : null,
          cloudConfigured ? `售后 ${cloudTotals.after_sale_count}` : null,
        ].filter(Boolean)}
        actions={<Button icon={<ReloadOutlined />} onClick={loadAllData}>刷新数据</Button>}
      />
      <section className="shop-command-grid">
        <div className="shop-command-panel shop-command-panel--primary">
          <div className="shop-command-panel__head">
            <div>
              <div className="shop-command-panel__eyebrow">今日经营</div>
              <div className="shop-command-panel__title">店铺运行状态</div>
            </div>
            <span className={`shop-command-status ${commandStatusTone}`}>{commandStatusText}</span>
          </div>
          <div className="shop-command-panel__value">{commandSaleValue}</div>
          <div className="shop-command-panel__meta">
            <span>今日销量</span>
            <span>{cloudLatestAt ? `云端 ${formatCloudTime(cloudLatestAt)}` : diagnostics?.syncedAt ? `本地 ${diagnostics.syncedAt}` : "等待采集"}</span>
          </div>
        </div>
        <div className="shop-command-card">
          <div className="shop-command-card__icon"><RiseOutlined /></div>
          <div>
            <div className="shop-command-card__label">30日销量</div>
            <div className="shop-command-card__value">{commandThirtyDayValue}</div>
            <div className="shop-command-card__hint">最近周期表现</div>
          </div>
        </div>
        <div className="shop-command-card">
          <div className="shop-command-card__icon"><ShopOutlined /></div>
          <div>
            <div className="shop-command-card__label">{cloudConfigured ? "曝光" : "今日访客"}</div>
            <div className="shop-command-card__value">{commandFlowValue}</div>
            <div className="shop-command-card__hint">流量入口状态</div>
          </div>
        </div>
        <div className="shop-command-card">
          <div className="shop-command-card__icon"><WarningOutlined /></div>
          <div>
            <div className="shop-command-card__label">{cloudConfigured ? "云端风险" : "待采集模块"}</div>
            <div className="shop-command-card__value">{commandRiskValue}</div>
            <div className="shop-command-card__hint">需要关注的事项</div>
          </div>
        </div>
        <div className="shop-command-card">
          <div className="shop-command-card__icon"><CloudSyncOutlined /></div>
          <div>
            <div className="shop-command-card__label">云端状态</div>
            <div className="shop-command-card__value">{cloudConfigured ? formatCloudNumber(cloudTotals.mall_count || cloudMonitorRows.length) : "--"}</div>
            <div className="shop-command-card__hint">{cloudConfigured ? "已连接店铺" : "尚未配置"}</div>
          </div>
        </div>
      </section>
      {dataIssues.length > 0 && (
        <Alert
          className="shop-data-alert"
          type="warning"
          showIcon
          message="部分模块暂无可用数据"
          description={[
            dataIssues.slice(0, 4).join("；"),
            dataIssues.length > 4 ? `另有 ${dataIssues.length - 4} 个模块也需要重新采集。` : "",
            diagnostics?.syncedAt ? `最近一次采集时间：${diagnostics.syncedAt}` : "",
          ].filter(Boolean).join(" ")}
        />
      )}
      <Tabs
        className="shop-overview-tabs"
        defaultActiveKey="overview"
        items={tabItems}
        tabBarStyle={{ marginBottom: 24 }}
      />
    </div>
  );
};

export default ShopOverview;
