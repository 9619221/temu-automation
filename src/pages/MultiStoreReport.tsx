import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  AutoComplete,
  Badge,
  Button,
  Card,
  Empty,
  Input,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { readPageCache, writePageCache } from "../utils/pageCache";

interface FinWindow {
  revenue: number;
  cost: number;
  gross_profit: number;
  qty: number;
}
interface StoreFinancials {
  latest_date: string | null;
  today: FinWindow;
  last7d: FinWindow & { revenue_prev: number; rev_wow: number | null };
  last30d: FinWindow & { revenue_prev: number; rev_mom: number | null };
  cost_coverage: number | null;
  trend_daily: Array<{ date: string; revenue: number; gross_profit: number }>;
}

interface ReportStore {
  mall_id: string;
  mall_name: string | null;
  site: string | null;
  mall_last_seen: string | null;
  store_code: string | null;
  store_status: string;
  dict_remark: string | null;
  owner: string | null;
  financials: StoreFinancials | null;
  sales: { today_qty: number; last7d_qty: number; last30d_qty: number; sku_count: number };
  stock_orders: { total: number; pending: number; demand_qty: number; delivered_qty: number };
  activities: { count: number; unique: number; skc_count: number };
  shop_stats: {
    stat_date: string | null;
    sale_volume: number;
    sale_7d: number;
    sale_30d: number;
    on_sale_skc: number;
    wait_skc: number;
    lack_skc: number;
    advice_prepare_skc: number;
    about_to_sell_out_skc: number;
    already_sold_out_skc: number;
    high_price_limit_skc: number;
    after_sale_ratio_90d: string | number | null;
    last_updated_at: string | null;
  };
  after_sales: { count: number };
  health: { last_capture_at: number | null; captures_total: number; lag_seconds: number | null };
}

interface ReportData {
  generated_at: number;
  cloud_tenant_id: string | null;
  store_count: number;
  financials_available: boolean;
  sales_window: { start: string | null; end: string | null; days: number } | null;
  stores: ReportStore[];
  unmapped: ReportStore[];
}

interface MultiStoreResponse {
  ok: boolean;
  error?: string;
  data?: ReportData;
}

interface SkuRow {
  mall_id: string;
  store_code: string | null;
  mall_name: string | null;
  skc_id: string | null;
  sku_ext_code: string | null;
  product_id: string | null;
  title: string | null;
  category: string | null;
  today: number;
  last7d: number;
  last30d: number;
  stock: number;
  occupy: number;
  advice_qty: number;
  sale_days: number | null;
  declared_price: number | null;
  stat_date: string | null;
}

const REFRESH_MS = 5 * 60 * 1000; // 5 分钟自动刷新一次
const MULTI_STORE_REPORT_CACHE_KEY = "temu.multi-store-report.cache.v1";
const STALE_THRESHOLD_SECONDS = 2 * 60 * 60; // 2 小时无数据视为掉线
const UNASSIGNED = "__unassigned__";

// 预警阈值
const ALERT_MARGIN_LOW = 0.1; // 毛利率低于 10% 预警
const ALERT_AFTER_SALE_RATIO = 3; // 90 天售后率高于 3% 预警

function fmtNum(n: number | null | undefined) {
  if (n == null) return "-";
  return n.toLocaleString("zh-CN");
}

function fmtMoney(n: number | null | undefined) {
  if (n == null) return "—";
  return "¥" + Math.round(n).toLocaleString("zh-CN");
}

function fmtPct(n: number | null | undefined, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n * 100).toFixed(digits) + "%";
}

function marginOf(w: FinWindow | null | undefined): number | null {
  if (!w || w.revenue <= 0) return null;
  return w.gross_profit / w.revenue;
}

function parseAfterSaleRatio(v: string | number | null): number | null {
  if (v == null || v === "") return null;
  const num = typeof v === "number" ? v : Number(String(v).replace("%", ""));
  return Number.isFinite(num) ? num : null;
}

function fmtLag(seconds: number | null) {
  if (seconds == null) return "未上传";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function lagColor(seconds: number | null): string {
  if (seconds == null) return "default";
  if (seconds < 600) return "success";
  if (seconds < STALE_THRESHOLD_SECONDS) return "processing";
  return "error";
}

function DeltaTag({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: "#bbb" }}>—</span>;
  if (Math.abs(value) < 0.0005) return <span style={{ color: "#999" }}>0%</span>;
  const up = value > 0;
  return (
    <span style={{ color: up ? "#3f8600" : "#cf1322", fontSize: 12 }}>
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {(Math.abs(value) * 100).toFixed(1)}%
    </span>
  );
}

// 仅渲染店号（+负责人标签）；店铺名拆为独立列
function StoreCell({ store }: { store: ReportStore }) {
  return (
    <span>
      <Typography.Text strong>{store.store_code || "—"}</Typography.Text>
      {store.owner && (
        <Tag color="blue" style={{ marginLeft: 6 }}>{store.owner}</Tag>
      )}
    </span>
  );
}

function storeNameCell(store: ReportStore) {
  return <span style={{ color: "#555" }}>{store.mall_name || "(未命名)"}</span>;
}
const storeNameSorter = (a: ReportStore, b: ReportStore) => (a.mall_name || "").localeCompare(b.mall_name || "");

// SKU 售卖状态：售罄 / 建议补货 / 在售
function skuStatus(r: SkuRow): { text: string; color: string } {
  if (r.stock <= 0) return { text: "已售罄", color: "red" };
  if (r.advice_qty > 0) return { text: "建议补货", color: "orange" };
  return { text: "在售", color: "green" };
}

// 全局色彩语言：绿=健康、黄/橙=注意、红=异常
const COLOR = { good: "#3f8600", warn: "#d46b08", bad: "#cf1322", muted: "#bbb" };

function marginColor(m: number | null): string | undefined {
  if (m == null) return undefined;
  if (m < ALERT_MARGIN_LOW) return COLOR.bad;
  if (m < 0.3) return COLOR.warn;
  return COLOR.good;
}

// 数字 + 热力背景（值越大背景越深），0 显示灰 —
function HeatNum({ value, max, hue }: { value: number; max: number; hue: "red" | "orange" | "gold" }) {
  if (!value || value <= 0) return <span style={{ color: COLOR.muted }}>—</span>;
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const rgb = hue === "red" ? "255,77,79" : hue === "orange" ? "250,140,22" : "250,219,20";
  return (
    <span style={{ backgroundColor: `rgba(${rgb},${0.1 + ratio * 0.38})`, borderRadius: 4, padding: "1px 8px", fontVariantNumeric: "tabular-nums" }}>
      {value.toLocaleString("zh-CN")}
    </span>
  );
}

export default function MultiStoreReport() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReportData | null>(
    () => readPageCache<ReportData | null>(MULTI_STORE_REPORT_CACHE_KEY, null),
  );
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("daily");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [savingMall, setSavingMall] = useState<string | null>(null);
  // 销售管理 Tab（SKU 明细，懒加载）
  const [skuRows, setSkuRows] = useState<SkuRow[]>([]);
  const [skuLoading, setSkuLoading] = useState(false);
  const [skuLoaded, setSkuLoaded] = useState(false);
  const [skuStoreFilter, setSkuStoreFilter] = useState("all");
  const [skuStatusFilter, setSkuStatusFilter] = useState("all");
  const [skuSearch, setSkuSearch] = useState("");

  const load = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.multiStore) {
      setError("当前版本不支持多店报表（IPC 未注册），请升级桌面端");
      return;
    }
    setLoading(true);
    try {
      const resp = (await window.electronAPI.erp.reports.multiStore({ includeTest: false })) as MultiStoreResponse;
      if (!resp.ok || !resp.data) {
        setError(resp.error || "未知错误");
        setData(null);
      } else {
        setData(resp.data);
        setError(null);
        writePageCache(MULTI_STORE_REPORT_CACHE_KEY, resp.data);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const allStores = data?.stores || [];
  const finAvailable = data?.financials_available ?? false;
  const salesWindow = data?.sales_window ?? null;
  const windowDays = salesWindow?.days && salesWindow.days > 0 ? salesWindow.days : 0;
  const label30 = windowDays > 0 && windowDays < 30 ? `近 ${windowDays} 天` : "近 30 天";

  const ownerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of allStores) if (s.owner) set.add(s.owner);
    return Array.from(set).sort();
  }, [allStores]);

  const stores = useMemo(() => {
    if (ownerFilter === "all") return allStores;
    if (ownerFilter === UNASSIGNED) return allStores.filter((s) => !s.owner);
    return allStores.filter((s) => s.owner === ownerFilter);
  }, [allStores, ownerFilter]);

  const saveOwner = useCallback(async (mallId: string, owner: string | null) => {
    if (!window.electronAPI?.erp?.reports?.setMallOwner) {
      message.error("当前版本不支持设置负责人，请升级桌面端");
      return;
    }
    setSavingMall(mallId);
    try {
      const resp = await window.electronAPI.erp.reports.setMallOwner({ mallId, owner: owner || null });
      if (resp.ok) {
        message.success("已保存");
        load();
      } else {
        message.error(resp.error || "保存失败");
      }
    } catch (e: any) {
      message.error(e?.message || String(e));
    } finally {
      setSavingMall(null);
    }
  }, [load]);

  // 销售管理：进 Tab 懒加载 SKU 明细（数据量大，不随主报表一起拉）
  const loadSkuSales = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.skuSales) return;
    setSkuLoading(true);
    try {
      const resp = await window.electronAPI.erp.reports.skuSales({ includeTest: false });
      if (resp.ok && resp.data) {
        setSkuRows((resp.data.rows || []) as SkuRow[]);
        setSkuLoaded(true);
      }
    } catch { /* ignore */ } finally {
      setSkuLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "sales" && !skuLoaded && !skuLoading) loadSkuSales();
  }, [activeTab, skuLoaded, skuLoading, loadSkuSales]);

  const skuStoreOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of skuRows) if (r.store_code) set.add(r.store_code);
    return Array.from(set).sort();
  }, [skuRows]);

  const skuView = useMemo(() => {
    let rows = skuRows;
    if (skuStoreFilter !== "all") rows = rows.filter((r) => r.store_code === skuStoreFilter);
    if (skuStatusFilter === "soldout") rows = rows.filter((r) => r.stock <= 0);
    else if (skuStatusFilter === "low") rows = rows.filter((r) => r.stock > 0 && r.advice_qty > 0);
    else if (skuStatusFilter === "selling") rows = rows.filter((r) => r.stock > 0);
    const q = skuSearch.trim().toLowerCase();
    if (q) rows = rows.filter((r) => (r.sku_ext_code || "").toLowerCase().includes(q) || (r.title || "").toLowerCase().includes(q) || (r.skc_id || "").includes(q));
    return rows;
  }, [skuRows, skuStoreFilter, skuStatusFilter, skuSearch]);

  const summary = useMemo(() => {
    if (!stores.length) return null;
    const onlineCount = stores.filter((s) => s.health.lag_seconds != null && s.health.lag_seconds < STALE_THRESHOLD_SECONDS).length;
    const totalPending = stores.reduce((acc, s) => acc + (s.stock_orders.pending || 0), 0);
    const rev30 = stores.reduce((acc, s) => acc + (s.financials?.last30d.revenue || 0), 0);
    const gp30 = stores.reduce((acc, s) => acc + (s.financials?.last30d.gross_profit || 0), 0);
    const revToday = stores.reduce((acc, s) => acc + (s.financials?.today.revenue || 0), 0);
    return { onlineCount, totalPending, rev30, gp30, revToday, margin30: rev30 > 0 ? gp30 / rev30 : null };
  }, [stores]);

  // 全局趋势（合并各店 trend_daily）
  const combinedTrend = useMemo(() => {
    const m = new Map<string, { date: string; revenue: number; gross_profit: number }>();
    for (const s of stores) {
      for (const t of s.financials?.trend_daily ?? []) {
        const e = m.get(t.date) || { date: t.date, revenue: 0, gross_profit: 0 };
        e.revenue += t.revenue;
        e.gross_profit += t.gross_profit;
        m.set(t.date, e);
      }
    }
    return Array.from(m.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [stores]);

  // 店铺营收排名（Top 15，营收毛利 Tab 横向条形）
  const revRank = useMemo(() => stores
    .filter((s) => s.financials)
    .map((s) => ({ name: s.store_code || s.mall_id.slice(-4), rev: Math.round(s.financials!.last30d.revenue), margin: marginOf(s.financials!.last30d) }))
    .sort((a, b) => b.rev - a.rev)
    .slice(0, 15), [stores]);

  // 营收二八分布：前 N 家贡献 80% 营收
  const pareto = useMemo(() => {
    const arr = stores.map((s) => s.financials?.last30d.revenue || 0).filter((v) => v > 0).sort((a, b) => b - a);
    const total = arr.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    let cum = 0, n = 0;
    for (const v of arr) { cum += v; n++; if (cum >= total * 0.8) break; }
    return { topN: n, total: arr.length };
  }, [stores]);

  // 按负责人卷积
  const ownerRollup = useMemo(() => {
    const m = new Map<string, {
      owner: string;
      store_count: number;
      rev30: number;
      gp30: number;
      pending: number;
      after_sales: number;
      risk: number;
    }>();
    for (const s of stores) {
      const key = s.owner || "(未分配)";
      const r = m.get(key) || { owner: key, store_count: 0, rev30: 0, gp30: 0, pending: 0, after_sales: 0, risk: 0 };
      r.store_count += 1;
      r.rev30 += s.financials?.last30d.revenue || 0;
      r.gp30 += s.financials?.last30d.gross_profit || 0;
      r.pending += s.stock_orders.pending || 0;
      r.after_sales += s.after_sales.count || 0;
      r.risk += 0; // 风险数当前 by-store 未透出，预留
      m.set(key, r);
    }
    return Array.from(m.values()).sort((a, b) => b.rev30 - a.rev30);
  }, [stores]);

  // 异常预警
  const alerts = useMemo(() => {
    const out: Array<{ key: string; level: "error" | "warning"; text: string }> = [];
    for (const s of stores) {
      const code = s.store_code || s.mall_id;
      const who = s.owner ? `（${s.owner}）` : "";
      if (s.health.lag_seconds == null || s.health.lag_seconds >= STALE_THRESHOLD_SECONDS) {
        out.push({ key: `${s.mall_id}-lag`, level: "error", text: `${code}${who} 采集滞后/掉线（${fmtLag(s.health.lag_seconds)}前）` });
      }
      const m30 = marginOf(s.financials?.last30d);
      if (m30 != null && m30 < ALERT_MARGIN_LOW) {
        out.push({ key: `${s.mall_id}-margin`, level: "warning", text: `${code}${who} 近 30 天毛利率偏低（${fmtPct(m30)}）` });
      }
      const asr = parseAfterSaleRatio(s.shop_stats.after_sale_ratio_90d);
      if (asr != null && asr > ALERT_AFTER_SALE_RATIO) {
        out.push({ key: `${s.mall_id}-asr`, level: "warning", text: `${code}${who} 90 天售后率偏高（${asr}%）` });
      }
      if ((s.shop_stats.already_sold_out_skc || 0) > 0) {
        out.push({ key: `${s.mall_id}-soldout`, level: "warning", text: `${code}${who} 已售罄 ${s.shop_stats.already_sold_out_skc} 个 SKC` });
      }
    }
    return out;
  }, [stores]);

  // 各待办列的最大值（用于热力色阶归一化）
  const maxes = useMemo(() => ({
    pending: Math.max(1, ...stores.map((s) => s.stock_orders.pending || 0)),
    lack: Math.max(1, ...stores.map((s) => s.shop_stats.lack_skc || 0)),
    soldout: Math.max(1, ...stores.map((s) => s.shop_stats.already_sold_out_skc || 0)),
    aftersale: Math.max(1, ...stores.map((s) => s.after_sales.count || 0)),
  }), [stores]);

  // 顶部「今日要点」汇总
  const highlights = useMemo(() => {
    const offline = stores.filter((s) => s.health.lag_seconds == null || s.health.lag_seconds >= STALE_THRESHOLD_SECONDS).length;
    const soldout = stores.reduce((a, s) => a + (s.shop_stats.already_sold_out_skc || 0), 0);
    const lack = stores.reduce((a, s) => a + (s.shop_stats.lack_skc || 0), 0);
    const aftersale = stores.reduce((a, s) => a + (s.after_sales.count || 0), 0);
    const lowMargin = stores.filter((s) => { const m = marginOf(s.financials?.last30d); return m != null && m < ALERT_MARGIN_LOW; }).length;
    return { offline, soldout, lack, aftersale, lowMargin };
  }, [stores]);

  // 运营日报按紧急度排序：掉线/售罄/缺货/售后/待发 的店置顶
  const dailyStores = useMemo(() => {
    const urgency = (s: ReportStore) => {
      let u = 0;
      if (s.health.lag_seconds == null || s.health.lag_seconds >= STALE_THRESHOLD_SECONDS) u += 100000;
      u += (s.shop_stats.already_sold_out_skc || 0) * 100;
      u += (s.shop_stats.lack_skc || 0) * 50;
      u += (s.after_sales.count || 0) * 30;
      u += (s.stock_orders.pending || 0);
      return u;
    };
    return [...stores].sort((a, b) => urgency(b) - urgency(a));
  }, [stores]);

  // === 销售管理：SKU 明细列 ===
  const salesColumns: ColumnsType<SkuRow> = [
    { title: "店号", dataIndex: "store_code", width: 78, fixed: "left", render: (v) => <Typography.Text strong>{v || "—"}</Typography.Text>, sorter: (a, b) => (a.store_code || "").localeCompare(b.store_code || "") },
    { title: "店铺", dataIndex: "mall_name", width: 130, render: (v) => <span style={{ color: "#555" }}>{v || "—"}</span> },
    {
      title: "SKU / 商品", key: "sku", width: 300,
      render: (_, r) => (
        <div>
          <Typography.Text copyable={{ text: r.sku_ext_code || "" }} style={{ fontSize: 12 }}>{r.sku_ext_code || "(无货号)"}</Typography.Text>
          <Tooltip title={r.title || ""}>
            <div style={{ color: "#888", fontSize: 12, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "—"}</div>
          </Tooltip>
        </div>
      ),
    },
    { title: "今日销量", dataIndex: "today", width: 90, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.today - b.today },
    { title: "近 7 天", dataIndex: "last7d", width: 88, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.last7d - b.last7d, defaultSortOrder: "descend" },
    { title: "近 30 天", dataIndex: "last30d", width: 92, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.last30d - b.last30d },
    { title: "库存", dataIndex: "stock", width: 100, align: "right", render: (v: number, r) => <span style={{ color: v <= 0 ? COLOR.bad : undefined }}>{fmtNum(v)}{r.occupy > 0 ? <span style={{ color: "#aaa", fontSize: 11 }}> /占{fmtNum(r.occupy)}</span> : null}</span>, sorter: (a, b) => a.stock - b.stock },
    { title: "可售天数", dataIndex: "sale_days", width: 88, align: "right", render: (v: number | null) => (v == null ? "—" : <span style={{ color: v < 7 ? COLOR.warn : undefined }}>{v}天</span>), sorter: (a, b) => (a.sale_days ?? Infinity) - (b.sale_days ?? Infinity) },
    { title: "申报价", dataIndex: "declared_price", width: 88, align: "right", render: (v: number | null) => (v == null ? "—" : "¥" + v.toFixed(2)), sorter: (a, b) => (a.declared_price ?? 0) - (b.declared_price ?? 0) },
    { title: "状态", key: "status", width: 96, render: (_, r) => { const s = skuStatus(r); return <Tag color={s.color}>{s.text}</Tag>; } },
  ];

  // === Tab 1: 运营日报 ===
  const dailyColumns: ColumnsType<ReportStore> = [
    { title: "店号", key: "code", width: 110, fixed: "left", render: (_, s) => <StoreCell store={s} />, sorter: (a, b) => (a.store_code || "").localeCompare(b.store_code || "") },
    { title: "店铺", key: "name", width: 170, render: (_, s) => storeNameCell(s), sorter: storeNameSorter },
    { title: "今日销量", dataIndex: ["sales", "today_qty"], width: 90, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => (a.sales.today_qty || 0) - (b.sales.today_qty || 0) },
    { title: "近 7 天", dataIndex: ["sales", "last7d_qty"], width: 90, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => (a.sales.last7d_qty || 0) - (b.sales.last7d_qty || 0) },
    { title: "待发备货", dataIndex: ["stock_orders", "pending"], width: 95, align: "right", render: (v: number) => <HeatNum value={v} max={maxes.pending} hue="orange" />, sorter: (a, b) => (a.stock_orders.pending || 0) - (b.stock_orders.pending || 0) },
    { title: "缺货", dataIndex: ["shop_stats", "lack_skc"], width: 80, align: "right", render: (v: number) => <HeatNum value={v} max={maxes.lack} hue="gold" />, sorter: (a, b) => (a.shop_stats.lack_skc || 0) - (b.shop_stats.lack_skc || 0) },
    { title: "已售罄", dataIndex: ["shop_stats", "already_sold_out_skc"], width: 80, align: "right", render: (v: number) => <HeatNum value={v} max={maxes.soldout} hue="red" />, sorter: (a, b) => (a.shop_stats.already_sold_out_skc || 0) - (b.shop_stats.already_sold_out_skc || 0) },
    { title: "待处理售后", dataIndex: ["after_sales", "count"], width: 100, align: "right", render: (v: number) => <HeatNum value={v} max={maxes.aftersale} hue="red" />, sorter: (a, b) => (a.after_sales.count || 0) - (b.after_sales.count || 0) },
    {
      title: "数据上报", key: "lag", width: 110,
      render: (_, s) => {
        const sec = s.health.lag_seconds;
        const stale = sec != null && sec >= STALE_THRESHOLD_SECONDS;
        return (
          <Badge
            status={lagColor(sec) as "success" | "processing" | "error" | "default"}
            text={<span style={{ fontSize: 12, color: stale ? COLOR.bad : "#888" }}>{sec == null ? "未上报" : `${fmtLag(sec)}前`}</span>}
          />
        );
      },
      sorter: (a, b) => (a.health.lag_seconds ?? Infinity) - (b.health.lag_seconds ?? Infinity),
    },
  ];

  // === Tab 2: 营收毛利（金额）===
  const bossColumns: ColumnsType<ReportStore> = [
    { title: "店号", key: "code", width: 110, fixed: "left", render: (_, s) => <StoreCell store={s} />, sorter: (a, b) => (a.store_code || "").localeCompare(b.store_code || "") },
    { title: "店铺", key: "name", width: 170, render: (_, s) => storeNameCell(s), sorter: storeNameSorter },
    { title: "近 7 天营收", key: "rev7", width: 120, align: "right", render: (_, s) => fmtMoney(s.financials?.last7d.revenue), sorter: (a, b) => (a.financials?.last7d.revenue || 0) - (b.financials?.last7d.revenue || 0), defaultSortOrder: "descend" },
    { title: "7 天环比", key: "wow", width: 90, align: "right", render: (_, s) => <DeltaTag value={s.financials?.last7d.rev_wow ?? null} /> },
    { title: "近 30 天营收", key: "rev30", width: 120, align: "right", render: (_, s) => fmtMoney(s.financials?.last30d.revenue), sorter: (a, b) => (a.financials?.last30d.revenue || 0) - (b.financials?.last30d.revenue || 0) },
    { title: "30 天环比", key: "mom", width: 90, align: "right", render: (_, s) => <DeltaTag value={s.financials?.last30d.rev_mom ?? null} /> },
    { title: "近 30 天毛利", key: "gp30", width: 120, align: "right", render: (_, s) => fmtMoney(s.financials?.last30d.gross_profit), sorter: (a, b) => (a.financials?.last30d.gross_profit || 0) - (b.financials?.last30d.gross_profit || 0) },
    {
      title: "毛利率", key: "margin", width: 110, align: "right",
      render: (_, s) => {
        const m = marginOf(s.financials?.last30d);
        const cov = s.financials?.cost_coverage;
        const node = <span style={{ color: marginColor(m), fontWeight: 600 }}>{fmtPct(m)}</span>;
        if (cov != null && cov < 0.9) {
          return <Tooltip title={`成本覆盖 ${fmtPct(cov, 0)}，未覆盖 SKU 按 0 成本，毛利率偏高`}>{node} <Typography.Text type="secondary" style={{ fontSize: 11 }}>*</Typography.Text></Tooltip>;
        }
        return node;
      },
      sorter: (a, b) => (marginOf(a.financials?.last30d) ?? -1) - (marginOf(b.financials?.last30d) ?? -1),
    },
    {
      title: "30 天趋势", key: "trend", width: 140,
      render: (_, s) => {
        const t = s.financials?.trend_daily ?? [];
        if (t.length < 2) return <span style={{ color: "#bbb" }}>—</span>;
        return (
          <ResponsiveContainer width="100%" height={36}>
            <LineChart data={t}>
              <Line type="monotone" dataKey="revenue" stroke="#1677ff" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        );
      },
    },
  ];

  // === Tab 3: 团队管理 ===
  const managerColumns: ColumnsType<(typeof ownerRollup)[number]> = [
    { title: "负责人", dataIndex: "owner", key: "owner", width: 140, fixed: "left", render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
    { title: "管理店数", dataIndex: "store_count", key: "store_count", width: 100, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.store_count - b.store_count },
    { title: "近 30 天营收", dataIndex: "rev30", key: "rev30", width: 130, align: "right", render: (v) => fmtMoney(v), sorter: (a, b) => a.rev30 - b.rev30, defaultSortOrder: "descend" },
    { title: "近 30 天毛利", dataIndex: "gp30", key: "gp30", width: 130, align: "right", render: (v) => fmtMoney(v), sorter: (a, b) => a.gp30 - b.gp30 },
    { title: "毛利率", key: "margin", width: 100, align: "right", render: (_, r) => { const m = r.rev30 > 0 ? r.gp30 / r.rev30 : null; return <span style={{ color: marginColor(m), fontWeight: 600 }}>{fmtPct(m)}</span>; } },
    { title: "待发备货", dataIndex: "pending", key: "pending", width: 100, align: "right", render: (v: number) => (v > 0 ? <Tag color="orange">{fmtNum(v)}</Tag> : "—"), sorter: (a, b) => a.pending - b.pending },
    { title: "待处理售后", dataIndex: "after_sales", key: "after_sales", width: 110, align: "right", render: (v: number) => (v > 0 ? <Tag color="volcano">{fmtNum(v)}</Tag> : "—"), sorter: (a, b) => a.after_sales - b.after_sales },
  ];

  // === Tab 4: 店铺归属 ===
  const ownerEditColumns: ColumnsType<ReportStore> = [
    { title: "店号", dataIndex: "store_code", width: 90, fixed: "left", render: (v) => <Typography.Text strong>{v || "—"}</Typography.Text>, sorter: (a, b) => (a.store_code || "").localeCompare(b.store_code || ""), defaultSortOrder: "ascend" },
    { title: "店铺名", dataIndex: "mall_name", width: 200, render: (v) => v || "(未命名)" },
    { title: "站点", dataIndex: "site", width: 120, render: (v) => v || "—" },
    {
      title: "运营负责人", key: "owner", width: 220,
      render: (_, s) => (
        <AutoComplete
          style={{ width: 180 }}
          defaultValue={s.owner || ""}
          options={ownerOptions.map((o) => ({ value: o }))}
          placeholder="输入负责人姓名"
          disabled={savingMall === s.mall_id}
          filterOption={(input, opt) => (opt?.value || "").toLowerCase().includes(input.toLowerCase())}
          onBlur={(e) => {
            const next = (e.target as HTMLInputElement).value.trim();
            if (next !== (s.owner || "")) saveOwner(s.mall_id, next);
          }}
        />
      ),
    },
  ];

  // === Tab 5: 运维监控 ===
  const opsColumns: ColumnsType<ReportStore> = [
    { title: "店号", key: "code", width: 110, fixed: "left", render: (_, s) => <StoreCell store={s} />, sorter: (a, b) => (a.store_code || "").localeCompare(b.store_code || "") },
    { title: "店铺", key: "name", width: 170, render: (_, s) => storeNameCell(s), sorter: storeNameSorter },
    {
      title: "状态", key: "status", width: 100,
      render: (_, s) => {
        const sec = s.health.lag_seconds;
        if (sec == null) return <Badge status="default" text="从未上报" />;
        if (sec < 600) return <Badge status="success" text="实时" />;
        if (sec < STALE_THRESHOLD_SECONDS) return <Badge status="processing" text="活跃" />;
        return <Badge status="error" text="滞后" />;
      },
      sorter: (a, b) => (a.health.lag_seconds ?? Infinity) - (b.health.lag_seconds ?? Infinity), defaultSortOrder: "descend",
    },
    { title: "最近上报", key: "last_capture", width: 140, render: (_, s) => (s.health.last_capture_at ? <Tooltip title={new Date(s.health.last_capture_at).toLocaleString("zh-CN")}><span>{fmtLag(s.health.lag_seconds)}前</span></Tooltip> : <span style={{ color: "#999" }}>无</span>), sorter: (a, b) => (a.health.last_capture_at || 0) - (b.health.last_capture_at || 0) },
    { title: "累计抓取", dataIndex: ["health", "captures_total"], width: 100, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => (a.health.captures_total || 0) - (b.health.captures_total || 0) },
    { title: "店铺数据日期", dataIndex: ["shop_stats", "stat_date"], width: 120, render: (v) => v || <span style={{ color: "#999" }}>—</span> },
    { title: "mall_id", dataIndex: "mall_id", width: 170, render: (v) => <Typography.Text type="secondary" copyable={{ text: v }}>{v}</Typography.Text> },
  ];

  const tabItems = [
    {
      key: "daily",
      label: "运营日报",
      children: (
        <>
          <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <Statistic title="待发备货" value={summary?.totalPending || 0} valueStyle={{ fontSize: 20, color: (summary?.totalPending || 0) > 0 ? "#fa8c16" : undefined }} />
            <Statistic title="缺货 SKC" value={highlights.lack} valueStyle={{ fontSize: 20, color: highlights.lack > 0 ? "#d4b106" : undefined }} />
            <Statistic title="已售罄 SKC" value={highlights.soldout} valueStyle={{ fontSize: 20, color: highlights.soldout > 0 ? "#cf1322" : undefined }} />
            <Statistic title="待处理售后" value={highlights.aftersale} valueStyle={{ fontSize: 20, color: highlights.aftersale > 0 ? "#cf1322" : undefined }} />
          </div>
          <div style={{ padding: "8px 16px 0", color: "#888", fontSize: 12 }}>已按紧急度排序：掉线 / 售罄 / 缺货 / 待处理售后 / 待发 多的店自动置顶。</div>
          <Table<ReportStore> dataSource={dailyStores} columns={dailyColumns} rowKey="mall_id" size="small" pagination={false} scroll={{ x: 945 }} loading={loading} />
        </>
      ),
    },
    {
      key: "sales",
      label: "销售管理",
      children: (
        <div>
          <div style={{ padding: "12px 16px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Select size="small" style={{ width: 130 }} value={skuStoreFilter} onChange={setSkuStoreFilter}
              options={[{ value: "all", label: "全部店铺" }, ...skuStoreOptions.map((c) => ({ value: c, label: c }))]} />
            <Select size="small" style={{ width: 130 }} value={skuStatusFilter} onChange={setSkuStatusFilter}
              options={[{ value: "all", label: "全部状态" }, { value: "soldout", label: "已售罄" }, { value: "low", label: "建议补货" }, { value: "selling", label: "在售" }]} />
            <Input.Search size="small" allowClear placeholder="搜货号 / 标题 / SKC" style={{ width: 240 }} value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>共 {skuView.length} 条（仅含动销或售罄 SKU，取各店最新一天）</Typography.Text>
          </div>
          <Table<SkuRow>
            dataSource={skuView}
            columns={salesColumns}
            rowKey={(r) => `${r.mall_id}|${r.skc_id || ""}|${r.sku_ext_code || ""}`}
            size="small"
            pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
            scroll={{ x: 1080 }}
            loading={skuLoading}
          />
        </div>
      ),
    },
    {
      key: "boss",
      label: "营收毛利",
      children: (
        <>
          {!finAvailable && (
            <Alert type="warning" showIcon style={{ margin: 16 }} message="金额维度暂不可用" description="未能连接 cloud 销量库（attach 失败或主控端未配置），营收/毛利显示为空。" />
          )}
          {finAvailable && salesWindow && windowDays > 0 && windowDays < 30 && (
            <Alert
              type="info"
              showIcon
              style={{ margin: 16 }}
              message={`营收数据目前覆盖 ${salesWindow.start} ~ ${salesWindow.end}，共 ${windowDays} 天（不足 30 天）`}
              description="“近30天”相关金额为该区间累计、非完整自然月；7天/30天环比待数据攒满对比周期后才显示。"
            />
          )}
          {finAvailable && combinedTrend.length >= 2 && (
            <div style={{ padding: "12px 16px 0" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{label30}营收 / 毛利趋势（所选范围合计）</Typography.Text>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={combinedTrend} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => String(d).slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={(v) => "¥" + (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v)} />
                  <RTooltip formatter={(v: any) => fmtMoney(Number(v))} labelFormatter={(d) => `日期 ${d}`} />
                  <Line type="monotone" dataKey="revenue" name="营收" stroke="#1677ff" dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line type="monotone" dataKey="gross_profit" name="毛利" stroke="#52c41a" dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {finAvailable && revRank.length > 0 && (
            <div style={{ padding: "8px 16px 0" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {label30}营收排名 Top {revRank.length}（条形按毛利率着色：绿好·橙中·红差）
                {pareto && <span style={{ marginLeft: 8 }}>· 前 {pareto.topN} 家贡献 80% 营收（共 {pareto.total} 家）</span>}
              </Typography.Text>
              <ResponsiveContainer width="100%" height={Math.max(160, revRank.length * 26)}>
                <BarChart data={revRank} layout="vertical" margin={{ top: 4, right: 70, bottom: 4, left: 8 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => "¥" + (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v)} />
                  <YAxis type="category" dataKey="name" width={44} tick={{ fontSize: 11 }} />
                  <RTooltip formatter={(v: any) => fmtMoney(Number(v))} />
                  <Bar dataKey="rev" name="营收" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {revRank.map((r, i) => <Cell key={i} fill={marginColor(r.margin) || "#1677ff"} />)}
                    <LabelList dataKey="rev" position="right" formatter={(v: any) => fmtMoney(Number(v))} style={{ fontSize: 11, fill: "#666" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <Table<ReportStore> dataSource={stores} columns={bossColumns} rowKey="mall_id" size="small" pagination={false} scroll={{ x: 1000 }} loading={loading} />
        </>
      ),
    },
    {
      key: "manager",
      label: "团队管理",
      children: (
        <div style={{ padding: 16 }}>
          {alerts.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={`异常预警 ${alerts.length} 项`}
              description={
                <div style={{ fontSize: 12, maxHeight: 180, overflowY: "auto" }}>
                  {alerts.map((a) => (
                    <div key={a.key} style={{ color: a.level === "error" ? "#cf1322" : "#d46b08" }}>• {a.text}</div>
                  ))}
                </div>
              }
            />
          )}
          {ownerRollup.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12, marginBottom: 16 }}>
              {ownerRollup.map((o) => {
                const m = o.rev30 > 0 ? o.gp30 / o.rev30 : null;
                return (
                  <Card size="small" key={o.owner} bodyStyle={{ padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography.Text strong>{o.owner}</Typography.Text>
                      <Tag>{o.store_count} 店</Tag>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 20, fontWeight: 600 }}>{finAvailable ? fmtMoney(o.rev30) : "—"}</div>
                    <div style={{ fontSize: 12, color: "#888" }}>{label30}营收 · 毛利率 <span style={{ color: marginColor(m), fontWeight: 600 }}>{finAvailable ? fmtPct(m) : "—"}</span></div>
                    <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {o.pending > 0 && <Tag color="orange">待发 {fmtNum(o.pending)}</Tag>}
                      {o.after_sales > 0 && <Tag color="volcano">售后 {fmtNum(o.after_sales)}</Tag>}
                      {o.pending === 0 && o.after_sales === 0 && <Tag color="success">无积压</Tag>}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
          <Table dataSource={ownerRollup} columns={managerColumns} rowKey="owner" size="small" pagination={false} scroll={{ x: 820 }} loading={loading} />
        </div>
      ),
    },
    {
      key: "owners",
      label: "店铺归属",
      children: (
        <div style={{ padding: 16 }}>
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message="为每家店指定运营负责人，团队管理与运营视图按此聚合 / 过滤。失焦自动保存。" />
          <Table<ReportStore> dataSource={allStores} columns={ownerEditColumns} rowKey="mall_id" size="small" pagination={false} scroll={{ x: 640 }} loading={loading} />
        </div>
      ),
    },
    {
      key: "ops",
      label: "运维监控",
      children: (
        <>
          {data?.unmapped && data.unmapped.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ margin: 16 }}
              message={`检测到 ${data.unmapped.length} 个店铺在云端有数据，但本地字典未登记`}
              description={
                <div style={{ fontSize: 12 }}>
                  {data.unmapped.map((u) => (
                    <div key={u.mall_id}>{u.mall_id} · {u.mall_name || "(未命名)"}</div>
                  ))}
                  <div style={{ marginTop: 6, color: "#888" }}>跑 <code>scripts/seed-temu-malls.cjs</code> 时把它们加上 store_code。</div>
                </div>
              }
            />
          )}
          <Table<ReportStore> dataSource={stores} columns={opsColumns} rowKey="mall_id" size="small" pagination={false} scroll={{ x: 950 }} loading={loading} />
        </>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card
        title="多店数据报表"
        extra={
          <Space>
            <Select
              size="small"
              style={{ width: 160 }}
              value={ownerFilter}
              onChange={setOwnerFilter}
              options={[
                { value: "all", label: "全部负责人" },
                ...ownerOptions.map((o) => ({ value: o, label: o })),
                { value: UNASSIGNED, label: "未分配" },
              ]}
            />
            {data?.generated_at && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                生成于 {new Date(data.generated_at).toLocaleString("zh-CN")}
              </Typography.Text>
            )}
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => { load(); message.success("已刷新"); }}>
              刷新
            </Button>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        {summary && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
              <Statistic title="店铺数" value={stores.length} suffix={`/ ${summary.onlineCount} 实时`} />
              <Statistic title="今日营收" value={finAvailable ? fmtMoney(summary.revToday) : "—"} />
              <Statistic title={`${label30}营收`} value={finAvailable ? fmtMoney(summary.rev30) : "—"} />
              <Statistic title={`${label30}毛利率`} value={finAvailable ? fmtPct(summary.margin30) : "—"} valueStyle={summary.margin30 != null ? { color: marginColor(summary.margin30) } : undefined} />
              <Statistic title="待发备货合计" value={summary.totalPending} valueStyle={summary.totalPending > 0 ? { color: "#fa8c16" } : undefined} />
            </div>
            <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 4 }}>今日要点</Typography.Text>
              {highlights.offline > 0 && <Tag color="error" style={{ cursor: "pointer" }} onClick={() => setActiveTab("ops")}>{highlights.offline} 家掉线</Tag>}
              {highlights.soldout > 0 && <Tag color="red" style={{ cursor: "pointer" }} onClick={() => setActiveTab("daily")}>{highlights.soldout} 个已售罄</Tag>}
              {highlights.lack > 0 && <Tag color="gold" style={{ cursor: "pointer" }} onClick={() => setActiveTab("daily")}>{highlights.lack} 个缺货</Tag>}
              {highlights.aftersale > 0 && <Tag color="volcano" style={{ cursor: "pointer" }} onClick={() => setActiveTab("daily")}>{highlights.aftersale} 待处理售后</Tag>}
              {finAvailable && highlights.lowMargin > 0 && <Tag color="orange" style={{ cursor: "pointer" }} onClick={() => setActiveTab("boss")}>{highlights.lowMargin} 家毛利率偏低</Tag>}
              {highlights.offline === 0 && highlights.soldout === 0 && highlights.lack === 0 && highlights.aftersale === 0 && <Tag color="success">暂无紧急事项</Tag>}
            </div>
          </>
        )}
      </Card>

      {error && (
        <Alert type="error" showIcon message="加载失败" description={error} style={{ marginBottom: 16 }} action={<Button onClick={load} size="small">重试</Button>} />
      )}

      {!error && allStores.length === 0 && !loading && (
        <Card>
          <Empty description="暂无店铺数据 —— 请先在主控端跑 scripts/seed-temu-malls.cjs" />
        </Card>
      )}

      {!error && allStores.length > 0 && (
        <Card bodyStyle={{ padding: 0 }}>
          <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} tabBarStyle={{ paddingLeft: 16, marginBottom: 0 }} />
        </Card>
      )}
    </div>
  );
}
