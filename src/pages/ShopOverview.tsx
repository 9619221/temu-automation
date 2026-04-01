import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Col,
  Row,
  Segmented,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {
  AppstoreOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  InboxOutlined,
  NotificationOutlined,
  ReloadOutlined,
  RocketOutlined,
  SafetyOutlined,
  ShopOutlined,
  ThunderboltOutlined,
  UserOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";
import EmptyGuide from "../components/EmptyGuide";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { parseDashboardData, parseFluxData } from "../utils/parseRawApis";
import {
  COLLECTION_DIAGNOSTICS_KEY,
  getCollectionDataIssue,
  normalizeCollectionDiagnostics,
  type CollectionDiagnostics,
} from "../utils/collectionDiagnostics";
import { getFirstExistingStoreValue, getStoreValue, STORE_KEY_ALIASES } from "../utils/storeCompat";
import { ACTIVE_ACCOUNT_CHANGED_EVENT } from "../utils/multiStore";

const { Text } = Typography;
const store = window.electronAPI?.store;

type ProductSnapshot = {
  key: string;
  title: string;
  category: string;
  imageUrl: string;
  goodsId: string;
  skcId: string;
  spuId: string;
  createdAt?: any;
  todaySales?: number;
  last7DaysSales?: number;
  last30DaysSales?: number;
  warehouseStock?: number;
  lackQuantity?: number;
  supplyStatus?: string;
  status?: string;
};

function formatNumber(value: any) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString("zh-CN") : "-";
}

function formatPercent(value: any, digits = 1) {
  const num = Number(value);
  return Number.isFinite(num) ? `${(num * 100).toFixed(digits)}%` : "-";
}

function formatCurrency(value: any) {
  const num = Number(value);
  return Number.isFinite(num) ? `¥${num.toLocaleString("zh-CN")}` : "-";
}

function formatShortDate(value: any) {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function findInRawStore(rawData: any, apiPathFragment: string): any {
  if (!rawData?.apis) return null;
  const api = rawData.apis.find((item: any) => item.path?.includes(apiPathFragment));
  return api?.data?.result || api?.data || null;
}

function deepFindObjectByKeys(rawData: any, keys: string[]): any {
  const queue = [rawData];
  const seen = new Set<any>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (keys.every((key) => key in current)) return current;
    Object.values(current).forEach((value) => {
      if (value && typeof value === "object") queue.push(value);
    });
  }
  return null;
}

function extractFluxSummary(rawData: any) {
  if (!rawData) return null;
  if (rawData?.summary?.trendList || rawData?.summary?.todayVisitors !== undefined) return rawData.summary;
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

function renderProductTitle(record: ProductSnapshot) {
  return (
    <Space align="start">
      {record.imageUrl ? (
        <img src={record.imageUrl} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", background: "#f4f6fa" }} />
      ) : (
        <div style={{ width: 44, height: 44, borderRadius: 10, background: "#f4f6fa" }} />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: "#1f2329", lineHeight: 1.5 }}>{record.title || "-"}</div>
        <div style={{ marginTop: 4, fontSize: 12, color: "#7c8597" }}>{record.category || "-"}</div>
      </div>
    </Space>
  );
}

function SectionPanel({ title, subtitle, extra, children }: { title: string; subtitle?: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="app-panel">
      <div className="app-panel__title">
        <div>
          <div className="app-panel__title-main">{title}</div>
          {subtitle ? <div className="app-panel__title-sub">{subtitle}</div> : null}
        </div>
        {extra}
      </div>
      {children}
    </div>
  );
}

export default function ShopOverview() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<any>(null);
  const [flux, setFlux] = useState<any>(null);
  const [fluxUS, setFluxUS] = useState<any>(null);
  const [fluxEU, setFluxEU] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [sales, setSales] = useState<any>({ summary: {}, items: [] });
  const [orders, setOrders] = useState<any[]>([]);
  const [performance, setPerformance] = useState<any>(null);
  const [soldout, setSoldout] = useState<any>(null);
  const [delivery, setDelivery] = useState<any>(null);
  const [quality, setQuality] = useState<any>(null);
  const [govern, setGovern] = useState<any>(null);
  const [marketing, setMarketing] = useState<any>(null);
  const [adsHome, setAdsHome] = useState<any>(null);
  const [qualityEU, setQualityEU] = useState<any>(null);
  const [checkup, setCheckup] = useState<any>(null);
  const [qcDetail, setQcDetail] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<CollectionDiagnostics | null>(null);
  const [fluxRegion, setFluxRegion] = useState<"global" | "us" | "eu">("global");

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [dashboardRaw, fluxRaw, productsRaw, salesRaw, ordersRaw, performanceRaw, soldoutRaw, deliveryRaw, qualityRaw, governRaw, marketingRaw, adsRaw, fluxUSRaw, fluxEURaw, qualityEURaw, checkupRaw, qcDetailRaw, diagnosticsRaw] = await Promise.all([
        getStoreValue(store, "temu_dashboard"),
        getStoreValue(store, "temu_flux"),
        getStoreValue(store, "temu_products"),
        getStoreValue(store, "temu_sales"),
        getStoreValue(store, "temu_orders"),
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
      ]);
      setDashboard(dashboardRaw ? parseDashboardData(dashboardRaw) : null);
      setFlux(fluxRaw ? parseFluxData(fluxRaw) : null);
      setProducts(Array.isArray(productsRaw) ? productsRaw : []);
      setSales(salesRaw || { summary: {}, items: [] });
      setOrders(Array.isArray(ordersRaw) ? ordersRaw : []);
      setPerformance(performanceRaw || null);
      setSoldout(soldoutRaw || null);
      setDelivery(deliveryRaw || null);
      setQuality(qualityRaw || null);
      setGovern(governRaw || null);
      setMarketing(marketingRaw || null);
      setAdsHome(adsRaw || null);
      setFluxUS(fluxUSRaw || null);
      setFluxEU(fluxEURaw || null);
      setQualityEU(qualityEURaw || null);
      setCheckup(checkupRaw || null);
      setQcDetail(qcDetailRaw || null);
      setDiagnostics(normalizeCollectionDiagnostics(diagnosticsRaw));
    } catch (error) {
      console.error("加载店铺概览数据失败", error);
      setDiagnostics(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllData();
    const handleActiveAccountChanged = () => void loadAllData();
    window.addEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    return () => window.removeEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
  }, [loadAllData]);

  const fluxSummary = useMemo(() => {
    if (fluxRegion === "us") return extractFluxSummary(fluxUS);
    if (fluxRegion === "eu") return extractFluxSummary(fluxEU);
    return flux?.summary || extractFluxSummary(flux);
  }, [flux, fluxEU, fluxRegion, fluxUS]);

  const qualitySource = fluxRegion === "eu" ? qualityEU : quality;
  const qualityMetrics = findInRawStore(qualitySource, "qualityMetrics/query");
  const qualityScoreList = Array.isArray(findInRawStore(qualitySource, "qualityScore/count")) ? findInRawStore(qualitySource, "qualityScore/count") : [];
  const perfAbstract = performance?.purchasePerformance?.abstractInfo || deepFindObjectByKeys(performance, ["supplierAvgScore", "excellentZoneStart", "excellentZoneEnd"]) || null;
  const soldoutOverview = soldout?.overview?.todayTotal || deepFindObjectByKeys(soldout, ["soonSellOutNum", "sellOutNum", "sellOutLossNum"]) || null;
  const deliverySummary = delivery?.forwardSummary?.result || delivery?.forwardSummary || deepFindObjectByKeys(delivery, ["stagingCount", "forwardCount", "expiredCount"]) || null;
  const marketingStats = findInRawStore(marketing, "activity/statistics");
  const marketingTodo = findInRawStore(marketing, "activity/todo");
  const marketingInvites = Array.isArray(findInRawStore(marketing, "inviteActivityList")?.list) ? findInRawStore(marketing, "inviteActivityList").list : [];
  const complianceBoard = findInRawStore(govern, "compliance/dashBoard/main_page");
  const realPictureTodo = findInRawStore(govern, "realPicture/todoList/query");
  const checkScore = findInRawStore(checkup, "check/score");
  const checkRulesRaw = findInRawStore(checkup, "check/rule/list");
  const topCheckRules = Array.isArray(checkRulesRaw?.list) ? checkRulesRaw.list.slice(0, 6) : [];

  const coreMetrics = {
    onSaleProducts: dashboard?.statistics?.onSaleProducts ?? products.length,
    todaySalesTotal: sales?.summary?.todaySalesTotal ?? 0,
    last7DaysSalesTotal: sales?.summary?.last7DaysSalesTotal ?? 0,
    last30DaysSalesTotal: sales?.summary?.last30DaysSalesTotal ?? 0,
    todayVisitors: fluxSummary?.todayVisitors ?? 0,
    todayBuyers: fluxSummary?.todayBuyers ?? 0,
  };
  const coreMetricNotes = {
    onSaleProducts: "看当前可售商品池规模",
    todaySalesTotal: "优先看今天是否有新单",
    last7DaysSalesTotal: "判断这周销售走势",
    last30DaysSalesTotal: "对比月度累计表现",
    todayVisitors: "来自流量分析今日访客",
    todayBuyers: coreMetrics.todayVisitors > 0 ? "和访客一起看转化" : "来自流量分析今日买家",
  };

  const recentProducts = products.slice(0, 8).map((item: any, index: number) => ({ key: item.skcId || item.goodsId || String(index), title: item.title || "", category: item.category || "", imageUrl: item.imageUrl || "", goodsId: String(item.goodsId || ""), skcId: String(item.skcId || ""), spuId: String(item.spuId || ""), createdAt: item.createdAt, todaySales: Number(item.todaySales || 0), last7DaysSales: Number(item.last7DaysSales || 0), last30DaysSales: Number(item.last30DaysSales || 0), warehouseStock: Number(item.warehouseStock || 0), lackQuantity: Number(item.lackQuantity || 0), supplyStatus: item.supplyStatus || "", status: item.status || "" })) as ProductSnapshot[];
  const stockWarnings = recentProducts.filter((item) => (item.warehouseStock ?? 0) <= 0 || (item.lackQuantity ?? 0) > 0 || (item.supplyStatus && item.supplyStatus !== "正常供货"));
  const dataIssues = [
    getCollectionDataIssue(diagnostics, "dashboard", "店铺概览", Boolean(dashboard)),
    getCollectionDataIssue(diagnostics, "products", "商品列表", products.length > 0),
    getCollectionDataIssue(diagnostics, "sales", "销售数据", Array.isArray(sales?.items) && sales.items.length > 0),
    getCollectionDataIssue(diagnostics, "orders", "备货单数据", orders.length > 0),
    getCollectionDataIssue(diagnostics, "flux", "流量分析", Boolean(fluxSummary)),
    getCollectionDataIssue(diagnostics, "qualityDashboard", "质量看板", Boolean(quality || qualityEU)),
  ].filter((item): item is string => Boolean(item));

  const renderBusinessTab = () => (
    <div className="overview-shell">
      <SectionPanel title="核心指标" subtitle="首屏只保留最能驱动决策的核心数据">
        <Row gutter={[16, 16]}>
          <Col xs={12} md={8} xl={4}><StatCard title="在售商品" value={formatNumber(coreMetrics.onSaleProducts)} icon={<ShopOutlined />} color="brand" trend={coreMetricNotes.onSaleProducts} empty="采集后显示" /></Col>
          <Col xs={12} md={8} xl={4}><StatCard title="今日销量" value={formatNumber(coreMetrics.todaySalesTotal)} icon={<ThunderboltOutlined />} color="success" trend={coreMetricNotes.todaySalesTotal} empty="采集后显示" /></Col>
          <Col xs={12} md={8} xl={4}><StatCard title="7日销量" value={formatNumber(coreMetrics.last7DaysSalesTotal)} icon={<BarChartOutlined />} color="blue" trend={coreMetricNotes.last7DaysSalesTotal} empty="采集后显示" /></Col>
          <Col xs={12} md={8} xl={4}><StatCard title="30日销量" value={formatNumber(coreMetrics.last30DaysSalesTotal)} icon={<RocketOutlined />} color="purple" trend={coreMetricNotes.last30DaysSalesTotal} empty="采集后显示" /></Col>
          <Col xs={12} md={8} xl={4}><StatCard title="今日访客" value={formatNumber(coreMetrics.todayVisitors)} icon={<NotificationOutlined />} color="neutral" trend={coreMetricNotes.todayVisitors} empty="采集后显示" /></Col>
          <Col xs={12} md={8} xl={4}><StatCard title="今日买家" value={formatNumber(coreMetrics.todayBuyers)} icon={<UserOutlined />} color="danger" trend={coreMetricNotes.todayBuyers} empty="采集后显示" /></Col>
        </Row>
      </SectionPanel>
      <SectionPanel title="运营预警" subtitle="把需要动作的事项集中在首屏">
        <div className="warning-list">
          {[
            { key: "lack", label: "缺货 SKC", value: Number(dashboard?.statistics?.lackSkcNumber || 0), desc: "库存见底会直接影响转化" },
            { key: "soldout", label: "即将售罄", value: Number(dashboard?.statistics?.aboutToSellOut || 0), desc: "建议优先补货" },
            { key: "todo", label: "待处理", value: Number(dashboard?.statistics?.waitProductNumber || 0), desc: "建议尽快处理审核或资料问题" },
            { key: "price", label: "高价限制", value: Number(dashboard?.statistics?.highPriceLimit || 0), desc: "会影响曝光和上架效率" },
          ].map((item) => (
            <div key={item.key} className="warning-list__item">
              <div className="warning-list__main">
                <div className={`warning-list__dot${item.value > 0 ? " is-danger" : ""}`} />
                <div><div className="warning-list__label">{item.label}</div><div className="warning-list__desc">{item.value > 0 ? item.desc : "当前正常"}</div></div>
              </div>
              <div className={`warning-list__value${item.value > 0 ? " is-danger" : ""}`}>{formatNumber(item.value)}</div>
            </div>
          ))}
        </div>
      </SectionPanel>
    </div>
  );

  const renderProductsTab = () => (
    <div className="overview-shell">
      <SectionPanel title="近期上架商品" subtitle="优先盯住最近新增的商品">
        {recentProducts.length > 0 ? (
          <Table rowKey="key" dataSource={recentProducts} pagination={false} size="small" columns={[{ title: "商品", dataIndex: "title", key: "title", render: (_: any, record: ProductSnapshot) => renderProductTitle(record) }, { title: "今日销量", dataIndex: "todaySales", key: "todaySales", width: 110, render: formatNumber }, { title: "7日销量", dataIndex: "last7DaysSales", key: "last7DaysSales", width: 110, render: formatNumber }, { title: "上架时间", dataIndex: "createdAt", key: "createdAt", width: 120, render: formatShortDate }, { title: "操作", key: "action", width: 100, render: (_: any, record: ProductSnapshot) => <Button type="link" size="small" onClick={() => navigate(`/products/${record.goodsId || record.skcId || record.spuId}`)}>查看详情</Button> }]} />
        ) : (
          <EmptyGuide icon={<AppstoreOutlined />} title="暂无最近新增商品" description="商品列表接入后，这里会自动筛出值得关注的新款。" />
        )}
      </SectionPanel>
      <SectionPanel title="库存与备货" subtitle="把缺货风险和备货状态放在一起看">
        {stockWarnings.length > 0 ? (
          <Table rowKey="key" dataSource={stockWarnings} pagination={false} size="small" columns={[{ title: "商品", dataIndex: "title", key: "title", render: (_: any, record: ProductSnapshot) => renderProductTitle(record) }, { title: "库存", dataIndex: "warehouseStock", key: "warehouseStock", width: 90, render: (value: number) => <Tag color={value <= 0 ? "error" : "warning"}>{formatNumber(value)}</Tag> }, { title: "缺货量", dataIndex: "lackQuantity", key: "lackQuantity", width: 100, render: formatNumber }, { title: "供货状态", dataIndex: "supplyStatus", key: "supplyStatus", width: 140, render: (value: string) => value || "正常供货" }]} />
        ) : (
          <EmptyGuide icon={<CheckCircleOutlined />} title="当前没有库存风险商品" description="库存或供货异常商品会在这里集中展示。" />
        )}
      </SectionPanel>
    </div>
  );

  const renderQualityTab = () => (
    <div className="overview-shell">
      <SectionPanel title="质量总览" subtitle="聚焦评分、退货率和履约表现">
        <Row gutter={[16, 16]}>
          <Col xs={12} md={8}><StatCard title="90天平均评分" value={qualityMetrics?.avgScore90d != null ? Number(qualityMetrics.avgScore90d).toFixed(2) : "-"} icon={<SafetyOutlined />} color="blue" empty="采集后显示" /></Col>
          <Col xs={12} md={8}><StatCard title="90天售后退货率" value={qualityMetrics?.qltyAfsOrdrRate90d != null ? formatPercent(qualityMetrics.qltyAfsOrdrRate90d, 2) : "-"} icon={<BarChartOutlined />} color="danger" empty="采集后显示" /></Col>
          <Col xs={12} md={8}><StatCard title="供应商综合得分" value={perfAbstract?.supplierAvgScore ?? "-"} icon={<RocketOutlined />} color="success" empty="采集后显示" /></Col>
        </Row>
      </SectionPanel>
      <SectionPanel title="合规待处理项" subtitle="只展示真正有风险的事项">
        {Array.isArray(complianceBoard?.addition_compliance_board_list) && complianceBoard.addition_compliance_board_list.length > 0 ? (
          <Table rowKey={(record: any, index) => `${record.dash_board_type || "type"}-${index}`} dataSource={complianceBoard.addition_compliance_board_list} pagination={false} size="small" columns={[{ title: "类型", dataIndex: "dash_board_type", key: "type" }, { title: "数量", dataIndex: "main_show_num", key: "count", render: formatNumber }]} />
        ) : (
          <EmptyGuide icon={<CheckCircleOutlined />} title="当前没有高优先级合规待处理项" description="如果后续出现合规问题，这里会优先展示需要动作的项目。" />
        )}
      </SectionPanel>
      <SectionPanel title="体检报告摘要" subtitle="把体检分和主要问题类型压缩成可读摘要">
        {checkScore || topCheckRules.length > 0 ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Row gutter={[16, 16]}>
              <Col xs={12} md={6}><StatCard title="体检评分" value={checkScore?.score ?? "-"} icon={<SafetyOutlined />} color="blue" empty="采集后显示" /></Col>
              <Col xs={12} md={6}><StatCard title="问题商品" value={formatNumber(checkScore?.problemProductNumber ?? 0)} icon={<NotificationOutlined />} color="danger" empty="采集后显示" /></Col>
              <Col xs={12} md={6}><StatCard title="规则数" value={formatNumber(checkScore?.supplierCheckRuleNumber ?? topCheckRules.length)} icon={<AppstoreOutlined />} color="brand" empty="采集后显示" /></Col>
              <Col xs={12} md={6}><StatCard title="实拍图待办" value={formatNumber(realPictureTodo?.totalCount ?? 0)} icon={<DatabaseOutlined />} color="neutral" empty="采集后显示" /></Col>
            </Row>
            {topCheckRules.length > 0 ? <Table rowKey={(record: any, index) => `${record.ruleName || index}-${record.number || 0}`} dataSource={topCheckRules} pagination={false} size="small" columns={[{ title: "问题类型", dataIndex: "ruleName", key: "ruleName" }, { title: "数量", dataIndex: "number", key: "number", width: 120, render: formatNumber }]} /> : null}
          </Space>
        ) : (
          <EmptyGuide icon={<InboxOutlined />} title="暂无体检摘要" description="体检数据源采集成功后，这里会自动收敛成简短结论。" />
        )}
      </SectionPanel>
    </div>
  );

  const renderMarketingTab = () => (
    <div className="overview-shell">
      <SectionPanel title="营销活动" subtitle="优先展示活动支付、订单和机会池">
        <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
          <Col xs={12} md={6}><StatCard title="活动支付金额" value={formatCurrency(marketingStats?.yesterdayStatistics?.activityPayAmountTotal)} icon={<ThunderboltOutlined />} color="brand" empty="采集后显示" /></Col>
          <Col xs={12} md={6}><StatCard title="活动订单数" value={formatNumber(marketingStats?.yesterdayStatistics?.activityGoodsOrderCount)} icon={<InboxOutlined />} color="blue" empty="采集后显示" /></Col>
          <Col xs={12} md={6}><StatCard title="活动库存问题" value={formatNumber(marketingTodo?.stockShort ?? 0)} icon={<NotificationOutlined />} color="danger" empty="采集后显示" /></Col>
          <Col xs={12} md={6}><StatCard title="可报名活动" value={formatNumber(marketingInvites.length)} icon={<AppstoreOutlined />} color="success" empty="采集后显示" /></Col>
        </Row>
        <Table rowKey={(record: any, index) => record.activityThematicId || record.activityName || index} dataSource={marketingInvites.slice(0, 8)} pagination={false} size="small" locale={{ emptyText: "暂无可报名活动" }} columns={[{ title: "活动名称", dataIndex: "activityName", key: "activityName" }, { title: "可报商品", dataIndex: "validInviteProductNum", key: "validInviteProductNum", width: 110, render: formatNumber }, { title: "已报商品", dataIndex: "enrollProductNum", key: "enrollProductNum", width: 110, render: formatNumber }, { title: "截止时间", dataIndex: "enrollEndTime", key: "enrollEndTime", width: 120, render: formatShortDate }]} />
      </SectionPanel>
    </div>
  );

  const tabItems = [
    { key: "business", label: "经营总览", children: renderBusinessTab() },
    { key: "products", label: "商品动态", children: renderProductsTab() },
    { key: "quality", label: "质量与合规", children: renderQualityTab() },
    { key: "marketing", label: "营销推广", children: renderMarketingTab() },
  ];

  const activeTab = tabItems.some((item) => item.key === searchParams.get("tab")) ? String(searchParams.get("tab")) : "business";

  if (loading) {
    return (
      <div className="overview-shell">
        <div className="app-panel">
          <Skeleton active paragraph={{ rows: 1 }} title={{ width: 220 }} />
          <div className="metric-strip" style={{ marginTop: 20 }}>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="metric-strip__item">
                <div className="app-skeleton" style={{ width: 72, height: 14, borderRadius: 8 }} />
                <div className="app-skeleton" style={{ width: "60%", height: 30, borderRadius: 10, marginTop: 18 }} />
                <div className="app-skeleton" style={{ width: "75%", height: 12, borderRadius: 8, marginTop: 18 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overview-shell">
      <PageHeader
        compact
        eyebrow="经营工作台"
        title="店铺概览"
        subtitle={diagnostics?.syncedAt ? `最近一次采集时间：${diagnostics.syncedAt}` : "聚焦经营、商品、质量和营销四个视图"}
        meta={["经营 / 商品 / 质量 / 营销", "优先看销量、流量和预警"]}
        actions={<Button icon={<ReloadOutlined />} onClick={() => void loadAllData()}>刷新当前视图</Button>}
      />
      {dataIssues.length > 0 ? <Alert className="friendly-alert" type="warning" showIcon icon={<WarningOutlined />} message="部分模块的数据还不完整" description={<div className="friendly-alert__summary">{dataIssues.join("；")}</div>} action={<Button size="small" type="primary" onClick={() => navigate("/collect")}>前往采集</Button>} /> : null}
      <Tabs activeKey={activeTab} onChange={(nextTab) => { const next = new URLSearchParams(searchParams); next.set("tab", nextTab); setSearchParams(next, { replace: true }); }} items={tabItems} tabBarStyle={{ marginBottom: 0 }} />
    </div>
  );
}
