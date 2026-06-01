import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Image, Input, Select, Statistic, Table, Tabs, Tag, Tooltip, Typography, message } from "antd";
import { EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ResponsiveContainer } from "recharts";

// 分页「每页条数」选择器:antd 5.25+ 默认带搜索框(聚焦冒出可编辑光标),这里强制关掉
const NoSearchSelect = (props: Record<string, unknown>) => <Select {...props} showSearch={false} />;

interface SkuRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  skc_id: string | null; sku_ext_code: string | null; product_id: string | null;
  title: string | null; category: string | null;
  today: number; last7d: number; last30d: number;
  stock: number; occupy: number; advice_qty: number;
  sale_days: number | null; declared_price: number | null; stat_date: string | null;
}
interface RiskRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  risk_type: string | null; severity: string | null; title: string | null; status: string | null;
  product_id: string | null; skc_id: string | null; quantity: number; stat_date: string | null;
  __rk?: number;
}
interface ActivityRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  kind: string | null; title: string | null; status: string | null;
  sku_ext_code: string | null; skc_id: string | null;
  signup_price: number | null; suggested_price: number | null; price_diff: number | null;
  activity_stock: number; cost: number | null; end_at: string | null; stat_date: string | null;
  __rk?: number;
}
interface ShopHealthRow {
  mall_id: string; store_code: string | null; mall_name: string | null; owner: string | null;
  sale_volume: number; sale_7d: number; sale_30d: number;
  on_sale: number; wait_online: number; lack_skc: number; advice_prepare_skc: number;
  about_to_sell_out: number; already_sold_out: number; high_price_limit: number;
  after_sale_ratio_90d: number | null; stat_date: string | null; __rk?: number;
}
interface StockOrderRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  sku_ext_code: string | null; product_name: string | null; spec_name: string | null;
  source_type: string | null; demand_qty: number; delivered_qty: number; gap: number;
  shipping_qty: number; inbound_qty: number; latest_ship_at: string | null; warehouse: string | null; order_no: string | null;
  __rk?: number;
}
interface TrendRow { mall_id: string; store_code: string | null; mall_name: string | null; stat_date: string; sales: number; }
interface StoreMatrixRow {
  store_code: string; mall_id: string; mall_name: string | null; owner: string | null;
  sales: number; sale_7d: number; lack: number; soldout: number;
  high_risk: number; restock: number; stock_gap: number; activity: number;
}
interface ProductPanelRow {
  mall_id: string; product_id: string; store_code: string | null; mall_name: string | null; title: string | null; thumb: string | null;
  expose: number | null; click: number | null; pay: number | null; conv: number | null; grow: string | null;
  limited: boolean; act_cnt: number; min_price: number | null; compliance: string | null; __rk?: number;
}

interface Diag { label: string; action: string; level: number }
interface DiagnosedRow extends SkuRow { _level: number; _issues: Diag[] }

const LEVEL_COLOR: Record<number, string> = { 3: "#cf1322", 2: "#d46b08", 1: "#d4b106", 0: "#3f8600" };
const TAG_COLOR: Record<number, string> = { 3: "red", 2: "orange", 1: "gold", 0: "green" };

const RISK_TYPE_LABEL: Record<string, string> = {
  high_price_flow: "高价限流", high_price: "高价限制", violation: "违规", appeal: "申诉",
  compliance: "合规风险", quality: "质量风险", punish: "处罚",
};
const SEV_COLOR: Record<string, string> = { high: "red", medium: "orange", low: "gold" };
const SEV_TEXT: Record<string, string> = { high: "高", medium: "中", low: "低" };
const SEV_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
const KIND_LABEL: Record<string, string> = { activity: "活动", bidding: "竞价", coupon: "优惠券" };

function diagnose(r: SkuRow): Diag[] {
  const issues: Diag[] = [];
  const hasSales = (r.last30d || 0) > 0 || (r.last7d || 0) > 0;
  if ((r.stock || 0) <= 0) {
    if (hasSales) issues.push({ label: "已售罄", action: "近期有销量却断货 → 立即补货", level: 3 });
    else issues.push({ label: "售罄无销", action: "长期断货且无销量 → 确认是否下架/清理", level: 1 });
  } else {
    if (r.sale_days != null && r.sale_days < 7) issues.push({ label: "即将断货", action: `仅可售约 ${r.sale_days} 天 → 尽快备货`, level: 2 });
    else if ((r.advice_qty || 0) > 0) issues.push({ label: "建议补货", action: `系统建议备货 ${r.advice_qty.toLocaleString("zh-CN")} 件`, level: 1 });
    if ((r.last30d || 0) === 0) issues.push({ label: "零动销", action: "30 天无销量但有库存 → 清仓/优化标题/报活动", level: 2 });
    else if ((r.last7d || 0) === 0) issues.push({ label: "近期停销", action: "30 天有销、近 7 天 0 → 查原因/报活动救量", level: 2 });
    else {
      const d7 = (r.last7d || 0) / 7, d30 = (r.last30d || 0) / 30;
      if (d30 > 0 && d7 < d30 * 0.5) issues.push({ label: "销量下滑", action: "近 7 天日均不足 30 天一半 → 关注/报活动/比价", level: 1 });
    }
  }
  return issues;
}

const fmtNum = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("zh-CN"));
const fmtMoney = (n: number | null | undefined) => (n == null ? "—" : "¥" + n.toFixed(2));
const TREND_COLORS = ["#1a73e8", "#34a853", "#fbbc04", "#ea4335", "#a142f4", "#24c1e0", "#ff6d01", "#7c8597"];

export default function OperationsWorkbench() {
  const [activeTab, setActiveTab] = useState("overview");
  const [skuRows, setSkuRows] = useState<SkuRow[]>([]);
  const [skuLoading, setSkuLoading] = useState(false);
  const [riskRows, setRiskRows] = useState<RiskRow[]>([]);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskLoaded, setRiskLoaded] = useState(false);
  const [actRows, setActRows] = useState<ActivityRow[]>([]);
  const [actLoading, setActLoading] = useState(false);
  const [actLoaded, setActLoaded] = useState(false);
  const [shopRows, setShopRows] = useState<ShopHealthRow[]>([]);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopLoaded, setShopLoaded] = useState(false);
  const [stockRows, setStockRows] = useState<StockOrderRow[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockLoaded, setStockLoaded] = useState(false);
  const [trendRows, setTrendRows] = useState<TrendRow[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendLoaded, setTrendLoaded] = useState(false);
  const [panelRows, setPanelRows] = useState<ProductPanelRow[]>([]);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelLoaded, setPanelLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [storeFilter, setStoreFilter] = useState("all");
  const [diagFilter, setDiagFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");

  const loadSku = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.skuSales) { setError("当前版本不支持运营工作台，请升级桌面端"); return; }
    setSkuLoading(true);
    try {
      const resp = await window.electronAPI.erp.reports.skuSales({ includeTest: false });
      if (resp.ok && resp.data) { setSkuRows((resp.data.rows || []) as SkuRow[]); setError(null); }
      else setError(resp.error || "加载失败");
    } catch (e: any) { setError(e?.message || String(e)); } finally { setSkuLoading(false); }
  }, []);
  const loadRisk = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.riskList) return;
    setRiskLoading(true);
    try { const resp = await window.electronAPI.erp.reports.riskList({ includeTest: false }); if (resp.ok && resp.data) { setRiskRows((resp.data.rows || []) as RiskRow[]); setRiskLoaded(true); } } catch { /* */ } finally { setRiskLoading(false); }
  }, []);
  const loadAct = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.activityList) return;
    setActLoading(true);
    try { const resp = await window.electronAPI.erp.reports.activityList({ includeTest: false }); if (resp.ok && resp.data) { setActRows((resp.data.rows || []) as ActivityRow[]); setActLoaded(true); } } catch { /* */ } finally { setActLoading(false); }
  }, []);
  const loadShop = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.shopHealth) return;
    setShopLoading(true);
    try { const resp = await window.electronAPI.erp.reports.shopHealth({ includeTest: false }); if (resp.ok && resp.data) { setShopRows((resp.data.rows || []) as ShopHealthRow[]); setShopLoaded(true); } } catch { /* */ } finally { setShopLoading(false); }
  }, []);
  const loadStockOrders = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.stockOrders) return;
    setStockLoading(true);
    try { const resp = await window.electronAPI.erp.reports.stockOrders({ includeTest: false }); if (resp.ok && resp.data) { setStockRows((resp.data.rows || []) as StockOrderRow[]); setStockLoaded(true); } } catch { /* */ } finally { setStockLoading(false); }
  }, []);
  const loadTrend = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.salesTrend) return;
    setTrendLoading(true);
    try { const resp = await window.electronAPI.erp.reports.salesTrend({ includeTest: false }); if (resp.ok && resp.data) { setTrendRows((resp.data.rows || []) as TrendRow[]); setTrendLoaded(true); } } catch { /* */ } finally { setTrendLoading(false); }
  }, []);

  const loadPanel = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.productPanel) return;
    setPanelLoading(true);
    try { const resp = await window.electronAPI.erp.reports.productPanel({ includeTest: false }); if (resp.ok && resp.data) { setPanelRows((resp.data.rows || []) as ProductPanelRow[]); setPanelLoaded(true); } } catch { /* */ } finally { setPanelLoading(false); }
  }, []);

  useEffect(() => { loadSku(); }, [loadSku]);
  useEffect(() => {
    const ov = activeTab === "overview";
    if ((activeTab === "shop" || ov) && !shopLoaded && !shopLoading) loadShop();
    if ((activeTab === "trend" || ov) && !trendLoaded && !trendLoading) loadTrend();
    if ((activeTab === "stock" || ov) && !stockLoaded && !stockLoading) loadStockOrders();
    if ((activeTab === "risk" || ov) && !riskLoaded && !riskLoading) loadRisk();
    if ((activeTab === "activity" || ov) && !actLoaded && !actLoading) loadAct();
    if (activeTab === "panel" && !panelLoaded && !panelLoading) loadPanel();
  }, [activeTab, shopLoaded, shopLoading, trendLoaded, trendLoading, stockLoaded, stockLoading, riskLoaded, riskLoading, actLoaded, actLoading, panelLoaded, panelLoading, loadShop, loadTrend, loadStockOrders, loadRisk, loadAct, loadPanel]);

  const diagnosed: DiagnosedRow[] = useMemo(() => skuRows.map((r) => {
    const issues = diagnose(r);
    return { ...r, _issues: issues, _level: issues.length ? Math.max(...issues.map((i) => i.level)) : 0 };
  }), [skuRows]);

  const storeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of skuRows) if (r.store_code) s.add(r.store_code);
    return Array.from(s).sort();
  }, [skuRows]);

  const overview = useMemo(() => {
    let urgent = 0, warn = 0, note = 0, healthy = 0;
    const byLabel: Record<string, number> = {};
    for (const r of diagnosed) {
      if (r._level === 3) urgent++; else if (r._level === 2) warn++; else if (r._level === 1) note++; else healthy++;
      for (const i of r._issues) byLabel[i.label] = (byLabel[i.label] || 0) + 1;
    }
    return { urgent, warn, note, healthy, byLabel };
  }, [diagnosed]);

  const diagView = useMemo(() => {
    let v = diagnosed;
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    if (diagFilter === "urgent") v = v.filter((r) => r._level === 3);
    else if (diagFilter === "warn") v = v.filter((r) => r._level === 2);
    else if (diagFilter === "note") v = v.filter((r) => r._level === 1);
    else if (diagFilter === "issues") v = v.filter((r) => r._level > 0);
    else if (diagFilter !== "all") v = v.filter((r) => r._issues.some((i) => i.label === diagFilter));
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.sku_ext_code || "").toLowerCase().includes(q) || (r.title || "").toLowerCase().includes(q));
    return [...v].sort((a, b) => b._level - a._level || b.last7d - a.last7d);
  }, [diagnosed, storeFilter, diagFilter, search]);

  // 库存补货：需补货 SKU（售罄/即将断货/有建议备货），紧急度排序
  const restockView = useMemo(() => {
    const need = (r: SkuRow) => (r.stock || 0) <= 0 || (r.sale_days != null && r.sale_days < 14) || (r.advice_qty || 0) > 0;
    const urg = (r: SkuRow) => {
      if ((r.stock || 0) <= 0 && ((r.last30d || 0) > 0 || (r.last7d || 0) > 0)) return 3;
      if (r.sale_days != null && r.sale_days < 7) return 2;
      if ((r.advice_qty || 0) > 0 || (r.sale_days != null && r.sale_days < 14)) return 1;
      return 0;
    };
    let v = skuRows.filter(need);
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.sku_ext_code || "").toLowerCase().includes(q) || (r.title || "").toLowerCase().includes(q));
    return [...v].sort((a, b) => urg(b) - urg(a) || (a.sale_days ?? Infinity) - (b.sale_days ?? Infinity) || b.advice_qty - a.advice_qty);
  }, [skuRows, storeFilter, search]);

  const riskStoreReady = riskRows;
  const riskOverview = useMemo(() => {
    let high = 0, medium = 0, low = 0;
    for (const r of riskRows) { if (r.severity === "high") high++; else if (r.severity === "medium") medium++; else low++; }
    return { high, medium, low };
  }, [riskRows]);
  const riskView = useMemo(() => {
    let v = riskStoreReady;
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    if (sevFilter !== "all") v = v.filter((r) => r.severity === sevFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.title || "").toLowerCase().includes(q) || (r.risk_type || "").toLowerCase().includes(q) || (r.skc_id || "").includes(q));
    return [...v].sort((a, b) => (SEV_RANK[b.severity || ""] || 0) - (SEV_RANK[a.severity || ""] || 0)).map((r, i) => ({ ...r, __rk: i }));
  }, [riskStoreReady, storeFilter, sevFilter, search]);

  const actView = useMemo(() => {
    let v = actRows;
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    if (kindFilter !== "all") v = v.filter((r) => r.kind === kindFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.title || "").toLowerCase().includes(q) || (r.sku_ext_code || "").toLowerCase().includes(q));
    return v.map((r, i) => ({ ...r, __rk: i }));
  }, [actRows, storeFilter, kindFilter, search]);

  const shopAgg = useMemo(() => {
    let lack = 0, soldout = 0, sales = 0;
    for (const r of shopRows) { lack += r.lack_skc || 0; soldout += r.already_sold_out || 0; sales += r.sale_volume || 0; }
    return { lack, soldout, sales };
  }, [shopRows]);
  const overviewTrend = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const r of trendRows) byDate.set(r.stat_date, (byDate.get(r.stat_date) || 0) + r.sales);
    return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, sales]) => ({ date, sales }));
  }, [trendRows]);
  const storeMatrix = useMemo(() => {
    const m = new Map<string, StoreMatrixRow>();
    const get = (code: string, mall_id: string, mall_name: string | null, owner: string | null) => {
      let e = m.get(code);
      if (!e) { e = { store_code: code, mall_id, mall_name, owner, sales: 0, sale_7d: 0, lack: 0, soldout: 0, high_risk: 0, restock: 0, stock_gap: 0, activity: 0 }; m.set(code, e); }
      if (mall_name && !e.mall_name) e.mall_name = mall_name;
      if (owner && !e.owner) e.owner = owner;
      return e;
    };
    for (const r of shopRows) { const e = get(r.store_code || r.mall_id, r.mall_id, r.mall_name, r.owner); e.sales = r.sale_volume; e.sale_7d = r.sale_7d; e.lack = r.lack_skc; e.soldout = r.already_sold_out; }
    for (const r of riskRows) if (r.severity === "high") get(r.store_code || r.mall_id, r.mall_id, r.mall_name, null).high_risk++;
    const need = (r: SkuRow) => (r.stock || 0) <= 0 || (r.sale_days != null && r.sale_days < 14) || (r.advice_qty || 0) > 0;
    for (const r of skuRows) if (need(r)) get(r.store_code || r.mall_id, r.mall_id, r.mall_name, null).restock++;
    for (const r of stockRows) get(r.store_code || r.mall_id, r.mall_id, r.mall_name, null).stock_gap++;
    for (const r of actRows) get(r.store_code || r.mall_id, r.mall_id, r.mall_name, null).activity++;
    return [...m.values()].sort((a, b) => (b.lack + b.soldout + b.high_risk * 5) - (a.lack + a.soldout + a.high_risk * 5));
  }, [shopRows, riskRows, skuRows, stockRows, actRows]);
  const panelView = useMemo(() => {
    let v = panelRows;
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.title || "").toLowerCase().includes(q) || (r.product_id || "").includes(q));
    return v.map((r, i) => ({ ...r, __rk: i }));
  }, [panelRows, storeFilter, search]);
  const shopView = useMemo(() => {
    let v = shopRows;
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.store_code || "").toLowerCase().includes(q) || (r.mall_name || "").toLowerCase().includes(q) || (r.owner || "").toLowerCase().includes(q));
    return v.map((r, i) => ({ ...r, __rk: i }));
  }, [shopRows, storeFilter, search]);
  const stockView = useMemo(() => {
    let v = stockRows;
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.sku_ext_code || "").toLowerCase().includes(q) || (r.product_name || "").toLowerCase().includes(q) || (r.order_no || "").toLowerCase().includes(q));
    return v.map((r, i) => ({ ...r, __rk: i }));
  }, [stockRows, storeFilter, search]);
  const trendChart = useMemo(() => {
    const dates = [...new Set(trendRows.map((r) => r.stat_date))].sort();
    const totals = new Map<string, number>();
    for (const r of trendRows) { const k = r.store_code || r.mall_id; totals.set(k, (totals.get(k) || 0) + r.sales); }
    let stores: string[];
    if (storeFilter !== "all") stores = [storeFilter];
    else stores = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map((e) => e[0]);
    const byDate = new Map<string, Record<string, number | string>>();
    for (const d of dates) byDate.set(d, { date: d });
    for (const r of trendRows) {
      const k = r.store_code || r.mall_id;
      if (!stores.includes(k)) continue;
      const row = byDate.get(r.stat_date);
      if (row) row[k] = r.sales;
    }
    return { data: dates.map((d) => byDate.get(d)!), stores };
  }, [trendRows, storeFilter]);

  const skuTitleCol = {
    title: "商品 · SKU / SKC / SPU", key: "sku", width: 300,
    render: (_: any, r: SkuRow) => (
      <div>
        <Typography.Text copyable={{ text: r.sku_ext_code || "" }} style={{ fontSize: 12, fontWeight: 600 }}>{r.sku_ext_code || "(无货号)"}</Typography.Text>
        <Tooltip title={r.title || ""}><div style={{ color: "#888", fontSize: 12, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "—"}</div></Tooltip>
        <div style={{ fontSize: 11, color: "#aaa" }}>
          {r.skc_id ? <span>SKC&nbsp;{r.skc_id}</span> : null}
          {r.product_id ? <span style={{ marginLeft: 8 }}>SPU&nbsp;{r.product_id}</span> : null}
        </div>
      </div>
    ),
  };
  const storeCol = { title: "店号", dataIndex: "store_code", width: 76, fixed: "left" as const, render: (v: string | null) => <Typography.Text strong>{v || "—"}</Typography.Text>, sorter: (a: any, b: any) => (a.store_code || "").localeCompare(b.store_code || "") };

  const diagColumns: ColumnsType<DiagnosedRow> = [
    storeCol, skuTitleCol,
    { title: "诊断", key: "diag", width: 150, render: (_, r) => r._issues.length ? <span>{r._issues.map((i) => <Tag key={i.label} color={TAG_COLOR[i.level]} style={{ marginBottom: 2 }}>{i.label}</Tag>)}</span> : <Tag color="green">健康</Tag>, sorter: (a, b) => a._level - b._level, defaultSortOrder: "descend" },
    { title: "建议动作", key: "action", width: 290, render: (_, r) => r._issues.length ? <div style={{ fontSize: 12 }}>{r._issues.map((i) => <div key={i.label} style={{ color: LEVEL_COLOR[i.level] }}>· {i.action}</div>)}</div> : <span style={{ color: "#aaa" }}>正常在售</span> },
    { title: "近7天", dataIndex: "last7d", width: 75, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.last7d - b.last7d },
    { title: "近30天", dataIndex: "last30d", width: 80, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.last30d - b.last30d },
    { title: "库存", dataIndex: "stock", width: 80, align: "right", render: (v: number) => <span style={{ color: v <= 0 ? "#cf1322" : undefined }}>{fmtNum(v)}</span>, sorter: (a, b) => a.stock - b.stock },
    { title: "可售天数", dataIndex: "sale_days", width: 85, align: "right", render: (v: number | null) => (v == null ? "—" : <span style={{ color: v < 7 ? "#d46b08" : undefined }}>{v}天</span>) },
  ];

  const restockColumns: ColumnsType<SkuRow> = [
    storeCol, skuTitleCol,
    { title: "库存", dataIndex: "stock", width: 90, align: "right", render: (v: number, r) => <span style={{ color: v <= 0 ? "#cf1322" : undefined }}>{fmtNum(v)}{r.occupy > 0 ? <span style={{ color: "#aaa", fontSize: 11 }}> /占{fmtNum(r.occupy)}</span> : null}</span>, sorter: (a, b) => a.stock - b.stock },
    { title: "可售天数", dataIndex: "sale_days", width: 90, align: "right", render: (v: number | null) => (v == null ? "—" : <span style={{ color: v < 7 ? "#cf1322" : v < 14 ? "#d46b08" : undefined }}>{v}天</span>), sorter: (a, b) => (a.sale_days ?? Infinity) - (b.sale_days ?? Infinity) },
    { title: "建议备货", dataIndex: "advice_qty", width: 100, align: "right", render: (v: number) => (v > 0 ? <Tag color="blue">{fmtNum(v)}</Tag> : "—"), sorter: (a, b) => a.advice_qty - b.advice_qty, defaultSortOrder: "descend" },
    { title: "近7天", dataIndex: "last7d", width: 75, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.last7d - b.last7d },
    { title: "近30天", dataIndex: "last30d", width: 80, align: "right", render: (v) => fmtNum(v) },
    { title: "申报价", dataIndex: "declared_price", width: 80, align: "right", render: (v: number | null) => (v == null ? "—" : "¥" + v.toFixed(2)) },
  ];

  const riskColumns: ColumnsType<RiskRow> = [
    storeCol,
    { title: "严重度", dataIndex: "severity", width: 80, render: (v: string | null) => <Tag color={SEV_COLOR[v || ""] || "default"}>{SEV_TEXT[v || ""] || v || "—"}</Tag>, sorter: (a, b) => (SEV_RANK[a.severity || ""] || 0) - (SEV_RANK[b.severity || ""] || 0), defaultSortOrder: "descend" },
    { title: "风险类型", dataIndex: "risk_type", width: 120, render: (v: string | null) => RISK_TYPE_LABEL[v || ""] || v || "—" },
    { title: "标题 / 商品", dataIndex: "title", width: 360, render: (v: string | null) => <Tooltip title={v || ""}><div style={{ maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v || "—"}</div></Tooltip> },
    { title: "数量", dataIndex: "quantity", width: 80, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.quantity - b.quantity },
    { title: "SKC", dataIndex: "skc_id", width: 130, render: (v: string | null) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v || "—"}</Typography.Text> },
  ];

  const actColumns: ColumnsType<ActivityRow> = [
    storeCol,
    { title: "类型", dataIndex: "kind", width: 80, render: (v: string | null) => <Tag color={v === "bidding" ? "purple" : v === "coupon" ? "cyan" : "blue"}>{KIND_LABEL[v || ""] || v || "—"}</Tag> },
    { title: "活动 / SKU", key: "at", width: 300, render: (_, r) => <div><div style={{ fontSize: 12 }}>{r.title || "(未命名活动)"}</div>{r.sku_ext_code ? <div style={{ color: "#888", fontSize: 12 }}>{r.sku_ext_code}</div> : null}</div> },
    { title: "报名价", dataIndex: "signup_price", width: 90, align: "right", render: (v) => fmtMoney(v) },
    { title: "成本价", dataIndex: "cost", width: 90, align: "right", render: (v: number | null) => (v == null ? <Tooltip title="无成本台账（未采购入库/未绑定）"><span style={{ color: "#bbb" }}>—</span></Tooltip> : fmtMoney(v)) },
    { title: "活动毛利", key: "amargin", width: 110, align: "right", render: (_, r) => { if (r.signup_price == null || r.cost == null) return <span style={{ color: "#bbb" }}>—</span>; const gp = r.signup_price - r.cost; return <span style={{ color: gp < 0 ? "#cf1322" : "#3f8600", fontWeight: 600 }}>{gp < 0 ? "亏 " : ""}{fmtMoney(gp)}</span>; }, sorter: (a, b) => ((a.signup_price ?? 0) - (a.cost ?? 0)) - ((b.signup_price ?? 0) - (b.cost ?? 0)) },
    { title: "活动库存", dataIndex: "activity_stock", width: 90, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.activity_stock - b.activity_stock },
    { title: "截止", dataIndex: "end_at", width: 130, render: (v: string | null) => { if (!v) return "—"; const n = Number(v); return Number.isFinite(n) && n > 1e11 ? new Date(n).toLocaleDateString("zh-CN") : String(v); } },
  ];

  const shopColumns: ColumnsType<ShopHealthRow> = [
    { title: "店号", dataIndex: "store_code", width: 80, fixed: "left", render: (v, r) => v || r.mall_id },
    { title: "店铺", dataIndex: "mall_name", width: 140, ellipsis: true, render: (v) => v || "—" },
    { title: "负责人", dataIndex: "owner", width: 80, render: (v) => v || "—" },
    { title: "今日销量", dataIndex: "sale_volume", width: 90, align: "right", sorter: (a, b) => a.sale_volume - b.sale_volume, render: fmtNum },
    { title: "7天销量", dataIndex: "sale_7d", width: 90, align: "right", sorter: (a, b) => a.sale_7d - b.sale_7d, render: fmtNum },
    { title: "30天销量", dataIndex: "sale_30d", width: 95, align: "right", sorter: (a, b) => a.sale_30d - b.sale_30d, render: fmtNum },
    { title: "在售", dataIndex: "on_sale", width: 75, align: "right", render: fmtNum },
    { title: "缺货SKC", dataIndex: "lack_skc", width: 90, align: "right", sorter: (a, b) => a.lack_skc - b.lack_skc, render: (v: number) => (v > 0 ? <span style={{ color: "#d46b08", fontWeight: 600 }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "即将售罄", dataIndex: "about_to_sell_out", width: 90, align: "right", sorter: (a, b) => a.about_to_sell_out - b.about_to_sell_out, render: (v: number) => (v > 0 ? <span style={{ color: "#d46b08" }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "已售罄", dataIndex: "already_sold_out", width: 85, align: "right", sorter: (a, b) => a.already_sold_out - b.already_sold_out, render: (v: number) => (v > 0 ? <span style={{ color: "#cf1322", fontWeight: 600 }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "建议备货SKC", dataIndex: "advice_prepare_skc", width: 110, align: "right", render: fmtNum },
    { title: "高价限制", dataIndex: "high_price_limit", width: 90, align: "right", render: (v: number) => (v > 0 ? <span style={{ color: "#cf1322" }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "90天售后率", dataIndex: "after_sale_ratio_90d", width: 100, align: "right", sorter: (a, b) => (a.after_sale_ratio_90d ?? 0) - (b.after_sale_ratio_90d ?? 0), render: (v: number | null) => (v == null ? "—" : (v * 100).toFixed(2) + "%") },
  ];

  const SRC_LABEL: Record<string, string> = { stock_order: "备货单", shipping_list: "发货单", shipping_desk: "发货台" };
  const stockColumns: ColumnsType<StockOrderRow> = [
    { title: "店号", dataIndex: "store_code", width: 70, fixed: "left", render: (v, r) => v || r.mall_id },
    { title: "货号", dataIndex: "sku_ext_code", width: 120, render: (v) => v || "—" },
    { title: "商品", dataIndex: "product_name", width: 200, ellipsis: true, render: (v, r) => <span>{v || "—"}{r.spec_name ? <span style={{ color: "#999" }}> / {r.spec_name}</span> : null}</span> },
    { title: "类型", dataIndex: "source_type", width: 80, render: (v: string | null) => (v ? SRC_LABEL[v] || v : "—") },
    { title: "需求量", dataIndex: "demand_qty", width: 80, align: "right", sorter: (a, b) => a.demand_qty - b.demand_qty, render: fmtNum },
    { title: "已发", dataIndex: "delivered_qty", width: 75, align: "right", render: fmtNum },
    { title: "缺口", dataIndex: "gap", width: 80, align: "right", sorter: (a, b) => a.gap - b.gap, defaultSortOrder: "descend", render: (v: number) => (v > 0 ? <span style={{ color: "#cf1322", fontWeight: 600 }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "已入库", dataIndex: "inbound_qty", width: 80, align: "right", render: fmtNum },
    { title: "最晚发货", dataIndex: "latest_ship_at", width: 130, render: (v: string | null) => { if (!v) return "—"; const n = Number(v); return Number.isFinite(n) && n > 1e11 ? new Date(n).toLocaleDateString("zh-CN") : String(v); } },
    { title: "收货仓", dataIndex: "warehouse", width: 140, ellipsis: true, render: (v) => v || "—" },
  ];

  const redNum = (color: string) => (v: number) => (v > 0 ? <span style={{ color, fontWeight: 600 }}>{fmtNum(v)}</span> : <span style={{ color: "#bbb" }}>0</span>);
  const storeMatrixColumns: ColumnsType<StoreMatrixRow> = [
    { title: "店号", dataIndex: "store_code", width: 70, fixed: "left" },
    { title: "店铺", dataIndex: "mall_name", width: 130, ellipsis: true, render: (v) => v || "—" },
    { title: "负责人", dataIndex: "owner", width: 70, render: (v) => v || "—" },
    { title: "今日销量", dataIndex: "sales", width: 85, align: "right", sorter: (a, b) => a.sales - b.sales, render: fmtNum },
    { title: "7天销量", dataIndex: "sale_7d", width: 85, align: "right", sorter: (a, b) => a.sale_7d - b.sale_7d, render: fmtNum },
    { title: "缺货", dataIndex: "lack", width: 70, align: "right", sorter: (a, b) => a.lack - b.lack, render: redNum("#d46b08") },
    { title: "售罄", dataIndex: "soldout", width: 70, align: "right", sorter: (a, b) => a.soldout - b.soldout, render: redNum("#cf1322") },
    { title: "高风险", dataIndex: "high_risk", width: 75, align: "right", sorter: (a, b) => a.high_risk - b.high_risk, render: redNum("#cf1322") },
    { title: "待补货", dataIndex: "restock", width: 75, align: "right", sorter: (a, b) => a.restock - b.restock, render: redNum("#d46b08") },
    { title: "备货缺口", dataIndex: "stock_gap", width: 85, align: "right", sorter: (a, b) => a.stock_gap - b.stock_gap, render: fmtNum },
    { title: "可报活动", dataIndex: "activity", width: 85, align: "right", sorter: (a, b) => a.activity - b.activity, render: (v: number) => (v > 0 ? <span style={{ color: "#3f8600" }}>{fmtNum(v)}</span> : <span style={{ color: "#bbb" }}>0</span>) },
  ];

  const panelColumns: ColumnsType<ProductPanelRow> = [
    { title: "店号", dataIndex: "store_code", width: 70, fixed: "left", render: (v, r) => v || r.mall_id },
    { title: "商品 (SPU)", key: "prod", width: 310, render: (_, r) => (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {r.thumb ? <div style={{ flexShrink: 0, width: 40, height: 40 }}><Image src={r.thumb} width={40} height={40} style={{ objectFit: "cover", borderRadius: 4 }} preview={{ mask: <EyeOutlined />, maskClassName: "prod-thumb-mask" }} /></div> : <div style={{ width: 40, height: 40, borderRadius: 4, background: "#f0f0f0", flexShrink: 0 }} />}
        <div style={{ minWidth: 0 }}>
          <Typography.Text copyable={{ text: r.product_id }} style={{ fontSize: 12, fontWeight: 600 }}>{r.product_id}</Typography.Text>
          <Tooltip title={r.title || ""}><div style={{ color: "#888", fontSize: 12, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "—"}</div></Tooltip>
        </div>
      </div>
    ) },
    { title: "可报活动", key: "act", width: 130, align: "right", sorter: (a, b) => a.act_cnt - b.act_cnt, render: (_, r) => (r.act_cnt > 0 ? <span style={{ color: "#3f8600" }}>{r.act_cnt}个{r.min_price != null ? ` / 低¥${r.min_price.toFixed(2)}` : ""}</span> : <span style={{ color: "#bbb" }}>—</span>) },
    { title: "合规", dataIndex: "compliance", width: 170, render: (v: string | null) => (v ? <Tag color="red" style={{ whiteSpace: "normal" }}>{v}</Tag> : <span style={{ color: "#3f8600" }}>正常</span>) },
    { title: "限流", dataIndex: "limited", width: 90, align: "center", sorter: (a, b) => (a.limited ? 1 : 0) - (b.limited ? 1 : 0), render: (v: boolean) => (v ? <Tag color="volcano">高价限流</Tag> : <span style={{ color: "#bbb" }}>—</span>) },
    { title: "曝光", dataIndex: "expose", width: 80, align: "right", sorter: (a, b) => (a.expose || 0) - (b.expose || 0), render: (v: number | null) => (v == null ? <span style={{ color: "#ccc" }}>无</span> : fmtNum(v)) },
    { title: "点击", dataIndex: "click", width: 70, align: "right", render: (v: number | null) => (v == null ? "—" : fmtNum(v)) },
    { title: "支付件", dataIndex: "pay", width: 75, align: "right", render: (v: number | null) => (v == null ? "—" : fmtNum(v)) },
    { title: "曝光转化", dataIndex: "conv", width: 90, align: "right", render: (v: number | null) => (v == null ? "—" : (v * 100).toFixed(2) + "%") },
  ];

  const commonFilters = (extra?: React.ReactNode) => (
    <div style={{ padding: "12px 16px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <Select size="small" style={{ width: 130 }} value={storeFilter} onChange={setStoreFilter} options={[{ value: "all", label: "全部店铺" }, ...storeOptions.map((c) => ({ value: c, label: c }))]} />
      {extra}
      <Input.Search size="small" allowClear placeholder="搜货号 / 标题" style={{ width: 220 }} value={search} onChange={(e) => setSearch(e.target.value)} />
    </div>
  );

  const tabItems = [
    {
      key: "overview", label: "总览",
      children: (
        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            <Card size="small" hoverable onClick={() => setActiveTab("shop")}><Statistic title="今日销量(全店)" value={shopAgg.sales} /></Card>
            <Card size="small" hoverable onClick={() => setActiveTab("shop")}><Statistic title="缺货 SKC" value={shopAgg.lack} valueStyle={{ color: shopAgg.lack > 0 ? "#d46b08" : undefined }} /></Card>
            <Card size="small" hoverable onClick={() => setActiveTab("shop")}><Statistic title="已售罄" value={shopAgg.soldout} valueStyle={{ color: shopAgg.soldout > 0 ? "#cf1322" : undefined }} /></Card>
            <Card size="small" hoverable onClick={() => setActiveTab("risk")}><Statistic title="高风险待办" value={riskOverview.high} valueStyle={{ color: riskOverview.high > 0 ? "#cf1322" : undefined }} /></Card>
            <Card size="small" hoverable onClick={() => setActiveTab("diag")}><Statistic title="诊断 · 急" value={overview.urgent} valueStyle={{ color: overview.urgent > 0 ? "#cf1322" : undefined }} /></Card>
            <Card size="small" hoverable onClick={() => setActiveTab("restock")}><Statistic title="急需补货 SKU" value={restockView.length} valueStyle={{ color: restockView.length > 0 ? "#d46b08" : undefined }} /></Card>
            <Card size="small" hoverable onClick={() => setActiveTab("stock")}><Statistic title="备货缺口单" value={stockView.length} /></Card>
            <Card size="small" hoverable onClick={() => setActiveTab("activity")}><Statistic title="可报活动" value={actView.length} valueStyle={{ color: "#3f8600" }} /></Card>
          </div>
          <Card size="small" title="各店概览 · 点店查看商品明细,问题多的店排在前" style={{ marginBottom: 16 }} loading={shopLoading || riskLoading || skuLoading}>
            <Table<StoreMatrixRow> dataSource={storeMatrix} columns={storeMatrixColumns} rowKey="store_code" size="small"
              pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 店` }}
              scroll={{ x: 980 }}
              onRow={(r) => ({ onClick: () => { setStoreFilter(r.store_code); setActiveTab("diag"); }, style: { cursor: "pointer" } })} />
          </Card>
          <Card size="small" title="全店销量趋势 · 近 30 天" style={{ marginBottom: 16 }} loading={trendLoading}>
            <div style={{ height: 200 }}>
              {overviewTrend.length === 0 ? <Empty description="暂无趋势数据" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={overviewTrend} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <RTooltip />
                    <Line type="monotone" dataKey="sales" name="全店销量" stroke="#1a73e8" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <Card size="small" title="高风险待办" extra={<a onClick={() => setActiveTab("risk")}>全部</a>} loading={riskLoading}>
              {riskView.filter((r) => r.severity === "high").slice(0, 6).map((r) => (
                <div key={r.__rk} style={{ padding: "4px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <Tag color="red">{r.store_code || r.mall_id}</Tag>{r.title || r.risk_type || "—"}
                </div>
              ))}
              {riskView.filter((r) => r.severity === "high").length === 0 && <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>无高风险</div>}
            </Card>
            <Card size="small" title="急需补货" extra={<a onClick={() => setActiveTab("restock")}>全部</a>} loading={skuLoading}>
              {restockView.slice(0, 6).map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Tag color="orange">{r.store_code || r.mall_id}</Tag>{r.title || r.sku_ext_code || "—"}</span>
                  <span style={{ color: "#d46b08", whiteSpace: "nowrap" }}>{(r.stock || 0) <= 0 ? "已断货" : `可售${r.sale_days ?? "?"}天`}</span>
                </div>
              ))}
              {restockView.length === 0 && <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>无需补货</div>}
            </Card>
            <Card size="small" title="紧急备货在途" extra={<a onClick={() => setActiveTab("stock")}>全部</a>} loading={stockLoading}>
              {stockView.slice(0, 6).map((r) => (
                <div key={r.__rk} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Tag>{r.store_code || r.mall_id}</Tag>{r.product_name || r.sku_ext_code || "—"}</span>
                  <span style={{ color: "#cf1322", whiteSpace: "nowrap" }}>缺{r.gap}</span>
                </div>
              ))}
              {stockView.length === 0 && <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>无备货缺口</div>}
            </Card>
          </div>
        </div>
      ),
    },
    {
      key: "shop", label: "店铺健康",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            <Statistic title="店铺数" value={shopRows.length} />
            <Statistic title="缺货SKC合计" value={shopAgg.lack} valueStyle={{ color: shopAgg.lack > 0 ? "#d46b08" : undefined }} />
            <Statistic title="已售罄合计" value={shopAgg.soldout} valueStyle={{ color: shopAgg.soldout > 0 ? "#cf1322" : undefined }} />
            <Statistic title="今日销量合计" value={shopAgg.sales} />
          </div>
          <div style={{ padding: "8px 16px 0", color: "#888", fontSize: 12 }}>各店体检:销量 / 在售 / 缺货 / 售罄 / 90天售后率,按已售罄、缺货降序。</div>
          {commonFilters()}
          <Table<ShopHealthRow> dataSource={shopView} columns={shopColumns} rowKey={(r) => String(r.__rk)} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1200 }} loading={shopLoading} />
        </div>
      ),
    },
    {
      key: "trend", label: "销量趋势",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>各店近 30 天每日销量走势(已排除预测值)。全部店时显示销量 Top 8;选具体店看单店曲线。</div>
          {commonFilters()}
          <div style={{ padding: "8px 16px 16px", height: 440 }}>
            {trendLoading ? (
              <div style={{ textAlign: "center", color: "#999", paddingTop: 170 }}>加载中…</div>
            ) : trendChart.data.length === 0 ? (
              <Empty description="暂无趋势数据" style={{ paddingTop: 140 }} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendChart.data} margin={{ top: 10, right: 24, bottom: 4, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={20} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <RTooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {trendChart.stores.map((s, i) => (
                    <Line key={s} type="monotone" dataKey={s} name={s} stroke={TREND_COLORS[i % TREND_COLORS.length]} dot={false} strokeWidth={2} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "diag", label: "商品诊断",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
            <Statistic title="待诊断 SKU" value={diagnosed.length} />
            <Statistic title="急" value={overview.urgent} valueStyle={{ color: overview.urgent > 0 ? "#cf1322" : undefined }} />
            <Statistic title="警" value={overview.warn} valueStyle={{ color: overview.warn > 0 ? "#d46b08" : undefined }} />
            <Statistic title="注意" value={overview.note} valueStyle={{ color: overview.note > 0 ? "#d4b106" : undefined }} />
            <Statistic title="健康" value={overview.healthy} valueStyle={{ color: "#3f8600" }} />
          </div>
          {commonFilters(
            <Select size="small" style={{ width: 130 }} value={diagFilter} onChange={setDiagFilter} options={[{ value: "all", label: "全部" }, { value: "issues", label: "仅有问题" }, { value: "urgent", label: "急" }, { value: "warn", label: "警" }, { value: "note", label: "注意" }]} />,
          )}
          <Table<DiagnosedRow> dataSource={diagView} columns={diagColumns} rowKey={(r) => `${r.mall_id}|${r.skc_id}|${r.sku_ext_code}`} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1120 }} loading={skuLoading} />
        </div>
      ),
    },
    {
      key: "restock", label: "库存补货",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>需补货 SKU（已售罄 / 可售&lt;14天 / 有建议备货量），按紧急度排序。</div>
          {commonFilters()}
          <Table<SkuRow> dataSource={restockView} columns={restockColumns} rowKey={(r) => `${r.mall_id}|${r.skc_id}|${r.sku_ext_code}`} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1080 }} loading={skuLoading} />
        </div>
      ),
    },
    {
      key: "stock", label: "备货在途",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>未完成的备货 / 发货单(需求量 &gt; 已发量),按最晚发货时间升序(越紧急越靠前);缺口 = 需求 − 已发。</div>
          {commonFilters()}
          <Table<StockOrderRow> dataSource={stockView} columns={stockColumns} rowKey={(r) => String(r.__rk)} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1050 }} loading={stockLoading} />
        </div>
      ),
    },
    {
      key: "risk", label: "风险待办",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            <Statistic title="风险总数" value={riskRows.length} />
            <Statistic title="高" value={riskOverview.high} valueStyle={{ color: riskOverview.high > 0 ? "#cf1322" : undefined }} />
            <Statistic title="中" value={riskOverview.medium} valueStyle={{ color: riskOverview.medium > 0 ? "#d46b08" : undefined }} />
            <Statistic title="低" value={riskOverview.low} valueStyle={{ color: "#d4b106" }} />
          </div>
          {commonFilters(
            <Select size="small" style={{ width: 110 }} value={sevFilter} onChange={setSevFilter} options={[{ value: "all", label: "全部严重度" }, { value: "high", label: "高" }, { value: "medium", label: "中" }, { value: "low", label: "低" }]} />,
          )}
          <Table<RiskRow> dataSource={riskView} columns={riskColumns} rowKey={(r) => String(r.__rk)} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 880 }} loading={riskLoading} />
        </div>
      ),
    },
    {
      key: "activity", label: "活动机会",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>各店可报活动 / 竞价 / 优惠券（仅含有报名价或 SKU 的行；部分活动平台未透出名称）。</div>
          {commonFilters(
            <Select size="small" style={{ width: 120 }} value={kindFilter} onChange={setKindFilter} options={[{ value: "all", label: "全部类型" }, { value: "activity", label: "活动" }, { value: "bidding", label: "竞价" }, { value: "coupon", label: "优惠券" }]} />,
          )}
          <Table<ActivityRow> dataSource={actView} columns={actColumns} rowKey={(r) => String(r.__rk)} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1000 }} loading={actLoading} />
        </div>
      ),
    },
    {
      key: "panel", label: "商品运营",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>每个商品(SPU)横向集成:可报活动 / 合规状态 / 流量(曝光·点击·转化) / 高价限流。按 限流 &gt; 违规 &gt; 活动 排序;流量「无」表示该商品暂未采到(采集覆盖待提升)。</div>
          {commonFilters()}
          <Table<ProductPanelRow> dataSource={panelView} columns={panelColumns} rowKey={(r) => String(r.__rk)} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 个商品` }} scroll={{ x: 1100 }} loading={panelLoading} />
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card
        title="运营工作台"
        extra={<Button icon={<ReloadOutlined />} loading={skuLoading || riskLoading || actLoading} onClick={() => { loadSku(); setRiskLoaded(false); setActLoaded(false); if (activeTab === "risk") loadRisk(); if (activeTab === "activity") loadAct(); message.success("已刷新"); }}>刷新</Button>}
        bodyStyle={{ padding: 0 }}
      >
        {error && <Alert type="error" showIcon message="加载失败" description={error} style={{ margin: 16 }} action={<Button size="small" onClick={loadSku}>重试</Button>} />}
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} tabBarStyle={{ paddingLeft: 16, marginBottom: 0 }} />
      </Card>
    </div>
  );
}
