import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Input, Select, Statistic, Table, Tabs, Tag, Tooltip, Typography, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

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
}
interface ActivityRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  kind: string | null; title: string | null; status: string | null;
  sku_ext_code: string | null; skc_id: string | null;
  signup_price: number | null; suggested_price: number | null; price_diff: number | null;
  activity_stock: number; cost: number | null; end_at: string | null; stat_date: string | null;
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

export default function OperationsWorkbench() {
  const [activeTab, setActiveTab] = useState("diag");
  const [skuRows, setSkuRows] = useState<SkuRow[]>([]);
  const [skuLoading, setSkuLoading] = useState(false);
  const [riskRows, setRiskRows] = useState<RiskRow[]>([]);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskLoaded, setRiskLoaded] = useState(false);
  const [actRows, setActRows] = useState<ActivityRow[]>([]);
  const [actLoading, setActLoading] = useState(false);
  const [actLoaded, setActLoaded] = useState(false);
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

  useEffect(() => { loadSku(); }, [loadSku]);
  useEffect(() => {
    if (activeTab === "risk" && !riskLoaded && !riskLoading) loadRisk();
    if (activeTab === "activity" && !actLoaded && !actLoading) loadAct();
  }, [activeTab, riskLoaded, riskLoading, actLoaded, actLoading, loadRisk, loadAct]);

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
    return [...v].sort((a, b) => (SEV_RANK[b.severity || ""] || 0) - (SEV_RANK[a.severity || ""] || 0));
  }, [riskStoreReady, storeFilter, sevFilter, search]);

  const actView = useMemo(() => {
    let v = actRows;
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    if (kindFilter !== "all") v = v.filter((r) => r.kind === kindFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.title || "").toLowerCase().includes(q) || (r.sku_ext_code || "").toLowerCase().includes(q));
    return v;
  }, [actRows, storeFilter, kindFilter, search]);

  const skuTitleCol = {
    title: "SKU / 商品", key: "sku", width: 280,
    render: (_: any, r: SkuRow) => (
      <div>
        <Typography.Text copyable={{ text: r.sku_ext_code || "" }} style={{ fontSize: 12 }}>{r.sku_ext_code || "(无货号)"}</Typography.Text>
        <Tooltip title={r.title || ""}><div style={{ color: "#888", fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "—"}</div></Tooltip>
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

  const commonFilters = (extra?: React.ReactNode) => (
    <div style={{ padding: "12px 16px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <Select size="small" style={{ width: 130 }} value={storeFilter} onChange={setStoreFilter} options={[{ value: "all", label: "全部店铺" }, ...storeOptions.map((c) => ({ value: c, label: c }))]} />
      {extra}
      <Input.Search size="small" allowClear placeholder="搜货号 / 标题" style={{ width: 220 }} value={search} onChange={(e) => setSearch(e.target.value)} />
    </div>
  );

  const tabItems = [
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
          <Table<DiagnosedRow> dataSource={diagView} columns={diagColumns} rowKey={(r) => `${r.mall_id}|${r.skc_id}|${r.sku_ext_code}`} size="small" pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1120 }} loading={skuLoading} />
        </div>
      ),
    },
    {
      key: "restock", label: "库存补货",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>需补货 SKU（已售罄 / 可售&lt;14天 / 有建议备货量），按紧急度排序。</div>
          {commonFilters()}
          <Table<SkuRow> dataSource={restockView} columns={restockColumns} rowKey={(r) => `${r.mall_id}|${r.skc_id}|${r.sku_ext_code}`} size="small" pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1080 }} loading={skuLoading} />
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
          <Table<RiskRow> dataSource={riskView} columns={riskColumns} rowKey={(r, i) => `${r.mall_id}|${r.risk_type}|${r.skc_id}|${i}`} size="small" pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 880 }} loading={riskLoading} />
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
          <Table<ActivityRow> dataSource={actView} columns={actColumns} rowKey={(r, i) => `${r.mall_id}|${r.sku_ext_code}|${i}`} size="small" pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1000 }} loading={actLoading} />
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
