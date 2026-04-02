import { useState, useEffect } from "react";
import {
  Alert,
  Button,
  Card,
  InputNumber,
  Table,
  Tag,
  Tabs,
  Descriptions,
  Progress,
  Typography,
  Space,
  Skeleton,
  Segmented,
  message,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { parseDashboardData, parseFluxData, parseSalesData } from "../utils/parseRawApis";
import { APP_SETTINGS_KEY, normalizeAppSettings } from "../utils/appSettings";
import { setStoreValueForActiveAccount } from "../utils/multiStore";
import {
  COLLECTION_DIAGNOSTICS_KEY,
  getCollectionDataIssue,
  normalizeCollectionDiagnostics,
  type CollectionDiagnostics,
} from "../utils/collectionDiagnostics";
import { getFirstExistingStoreValue, getStoreValue, STORE_KEY_ALIASES } from "../utils/storeCompat";
import { ACTIVE_ACCOUNT_CHANGED_EVENT } from "../utils/multiStore";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import EmptyGuide from "../components/EmptyGuide";

const { Text } = Typography;

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
  const [adsHome, setAdsHome] = useState<any>(null);
  const [fluxUS, setFluxUS] = useState<any>(null);
  const [fluxEU, setFluxEU] = useState<any>(null);
  const [fluxRegion, setFluxRegion] = useState<string>("global");
  const [qualityEU, setQualityEU] = useState<any>(null);
  const [qualityRegion, setQualityRegion] = useState<string>("global");
  const [checkup, setCheckup] = useState<any>(null);
  const [qcDetail, setQcDetail] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<CollectionDiagnostics | null>(null);

  // 商品动态 / 库存预警
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [stockThreshold, setStockThreshold] = useState(10);
  const [savedStockThreshold, setSavedStockThreshold] = useState(10);
  const [stockLastCheckedAt, setStockLastCheckedAt] = useState<string | null>(null);
  const [stockChecking, setStockChecking] = useState(false);
  const [stockNotice, setStockNotice] = useState<{ type: "info" | "warning" | "error"; message: string } | null>(null);
  const [savingStockThreshold, setSavingStockThreshold] = useState(false);

  useEffect(() => {
    loadAllData();
    const handleActiveAccountChanged = () => {
      void loadAllData();
    };
    window.addEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    return () => {
      window.removeEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    };
  }, []);

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
    try {
      const results = await Promise.allSettled([
        getStoreValue(store, "temu_dashboard"),
        getStoreValue(store, "temu_flux"),
        getFirstExistingStoreValue(store, STORE_KEY_ALIASES.performance),
        getFirstExistingStoreValue(store, STORE_KEY_ALIASES.soldout),
        getFirstExistingStoreValue(store, STORE_KEY_ALIASES.delivery),
        getStoreValue(store, "temu_raw_qualityDashboard"),
        getStoreValue(store, "temu_raw_governDashboard"),
        getFirstExistingStoreValue(store, STORE_KEY_ALIASES.marketingActivity),
        getStoreValue(store, "temu_raw_adsHome"),
        getFirstExistingStoreValue(store, STORE_KEY_ALIASES.fluxUS),
        getFirstExistingStoreValue(store, STORE_KEY_ALIASES.fluxEU),
        getStoreValue(store, "temu_raw_qualityDashboardEU"),
        getStoreValue(store, "temu_raw_checkup"),
        getFirstExistingStoreValue(store, STORE_KEY_ALIASES.qcDetail),
        getStoreValue(store, COLLECTION_DIAGNOSTICS_KEY),
        getStoreValue(store, APP_SETTINGS_KEY),
      ]);
      const val = (i: number) => results[i].status === "fulfilled" ? (results[i] as PromiseFulfilledResult<any>).value : null;

      const dashRaw = val(0);
      const fluxRaw = val(1);
      const perfRaw = val(2);
      const soldoutRaw = val(3);
      const deliveryRaw = val(4);
      const qualityRaw = val(5);
      const governRaw = val(6);
      const marketingRaw = val(7);
      const adsRaw = val(8);
      const fluxUSRaw = val(9);
      const fluxEURaw = val(10);
      const qualityEURaw = val(11);
      const checkupRaw = val(12);
      const qcDetailRaw = val(13);
      const diagnosticsRaw = val(14);
      const appSettingsRaw = val(15);

      if (dashRaw) setDashboard(parseDashboardData(dashRaw));
      if (fluxRaw) setFlux(parseFluxData(fluxRaw));
      if (perfRaw) setPerformance(perfRaw);
      if (soldoutRaw) setSoldout(soldoutRaw);
      if (deliveryRaw) setDelivery(deliveryRaw);
      if (qualityRaw) setQuality(qualityRaw);
      if (governRaw) setGovern(governRaw);
      if (marketingRaw) setMarketing(marketingRaw);
      if (adsRaw) setAdsHome(adsRaw);
      if (fluxUSRaw) setFluxUS(fluxUSRaw);
      if (fluxEURaw) setFluxEU(fluxEURaw);
      if (qualityEURaw) setQualityEU(qualityEURaw);
      if (checkupRaw) setCheckup(checkupRaw);
      if (qcDetailRaw) setQcDetail(qcDetailRaw);
      setDiagnostics(normalizeCollectionDiagnostics(diagnosticsRaw));
      const appSettings = normalizeAppSettings(appSettingsRaw);
      setStockThreshold(appSettings.lowStockThreshold);
      setSavedStockThreshold(appSettings.lowStockThreshold);
    } catch (e) {
      console.error("加载店铺概览数据失败", e);
      setDiagnostics(null);
    } finally {
      setLoading(false);
    }
  };

  // ========== 数据提取 ==========

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

  // 广告数据
  const adsCount = findInRawStore(adsHome, "coconut/message_box/count");

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

  // ========== Tab 1: 数据概览 ==========
  const renderOverviewTab = () => (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
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
              <div style={{ display: "inline-block", padding: 12, borderRadius: "50%", background: "#fff7f0" }}>
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
    </Space>
  );

  // ========== Tab 2: 流量分析 ==========
  const renderFluxTab = () => (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* 区域切换 */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Segmented
          value={fluxRegion}
          onChange={(v) => setFluxRegion(v as string)}
          options={[
            { label: "🌍 全球", value: "global" },
            { label: "🇺🇸 美国", value: "us" },
            { label: "🇪🇺 欧盟", value: "eu" },
          ]}
          style={{ borderRadius: 8 }}
        />
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">流量概览{fluxRegion === "us" ? "（美国）" : fluxRegion === "eu" ? "（欧盟）" : ""}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <StatCard compact title="今日访客" value={safeVal(fluxSummary?.todayVisitors)} color="purple" />
          <StatCard compact title="今日买家" value={safeVal(fluxSummary?.todayBuyers)} color="purple" />
          <StatCard compact title="今日转化率" value={fluxSummary?.todayConversionRate ? (fluxSummary.todayConversionRate * 100).toFixed(2) : "-"} suffix="%" color="success" />
          <StatCard compact title="昨日访客" value={yesterdayFlux?.visitors ?? "-"} color="blue" />
          <StatCard compact title="昨日买家" value={yesterdayFlux?.buyers ?? "-"} color="blue" />
          <StatCard compact title="昨日转化率" value={yesterdayFlux?.conversionRate ? (yesterdayFlux.conversionRate * 100).toFixed(2) : "-"} suffix="%" color="brand" />
        </div>
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div className="app-panel__title-main">流量趋势</div>
        </div>
        {fluxTrendList.length > 0 ? (
          <div style={{ borderRadius: 12, overflow: "hidden" }}>
            <Table
              dataSource={fluxTrendList.map((item: any, idx: number) => ({
                key: idx,
                ...item,
              }))}
              columns={[
                { title: "日期", dataIndex: "date", key: "date", width: 120 },
                { title: "访客数", dataIndex: "visitors", key: "visitors", render: (v: number) => <span style={{ color: "#1677ff", fontWeight: 600 }}>{v?.toLocaleString() ?? "-"}</span> },
                { title: "买家数", dataIndex: "buyers", key: "buyers", render: (v: number) => <span style={{ color: "#00b96b", fontWeight: 600 }}>{v?.toLocaleString() ?? "-"}</span> },
                { title: "转化率", dataIndex: "conversionRate", key: "conversionRate", render: (v: number) => <span style={{ color: "#e55b00", fontWeight: 600 }}>{v ? (v * 100).toFixed(2) + "%" : "-"}</span> },
              ]}
              bordered={false}
              pagination={{ pageSize: 10 }}
              size="small"
            />
          </div>
        ) : (
          <EmptyGuide title="暂无流量趋势数据" description="采集数据后将在此展示" />
        )}
      </div>
    </Space>
  );

  // ========== Tab 3: 质量与履约 ==========
  const scoreEnumMap: Record<number, { label: string; color: string }> = {
    1: { label: "优秀", color: "#00b96b" },
    2: { label: "良好", color: "#1677ff" },
    3: { label: "一般", color: "#faad14" },
    4: { label: "较差", color: "#ff4d4f" },
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
                          <Card key={ci} size="small" style={{ borderRadius: 8, borderLeft: `3px solid ${child.number > 50 ? "#ff4d4f" : child.number > 10 ? "#faad14" : "#00b96b"}` }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 13, color: "#333" }}>{child.ruleName}</span>
                              <span style={{ fontSize: 20, fontWeight: 700, color: child.number > 50 ? "#ff4d4f" : child.number > 10 ? "#faad14" : "#00b96b" }}>
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
                        title: "商品名称", dataIndex: "productName", key: "name", width: 350, ellipsis: true,
                        render: (v: string, r: any) => (
                          <Space>
                            {r.productImageList?.carouselImageUrls?.[0] && (
                              <img src={r.productImageList.carouselImageUrls[0]} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover" }} />
                            )}
                            <span style={{ fontSize: 13 }}>{v?.slice(0, 60) || "-"}</span>
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
                    title: "商品信息", dataIndex: "productName", key: "name", width: 300, ellipsis: true,
                    render: (v: string, r: any) => {
                      const img = r.productImageList?.carouselImageUrls?.[0] || r.imageUrl || r.goodsImageUrl;
                      return (
                        <Space>
                          {img && <img src={img} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover" }} />}
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{(v || r.goodsName || "-").slice(0, 50)}</div>
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
                      const color = text === "合格" ? "#00b96b" : text === "不合格" ? "#ff4d4f" : "#666";
                      return <Tag color={color} style={{ borderRadius: 4 }}>{text}</Tag>;
                    },
                  },
                ]}
                bordered={false}
                pagination={{ pageSize: 10 }}
                size="small"
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
              { title: "商品", dataIndex: "title", key: "title", ellipsis: true },
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

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="运营"
        title="店铺概览"
        subtitle={diagnostics?.syncedAt ? `最近采集：${diagnostics.syncedAt}` : "核心经营数据、预警信息、流量与合规一览"}
      />
      {dataIssues.length > 0 && (
        <Alert
          style={{ marginBottom: 16 }}
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
        defaultActiveKey="overview"
        items={tabItems}
        tabBarStyle={{ marginBottom: 24 }}
      />
    </div>
  );
};

export default ShopOverview;
