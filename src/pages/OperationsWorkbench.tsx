import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Input, Select, Statistic, Table, Tag, Tooltip, Typography, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

// 复用 skuSales 接口的 SKU 行（每店最新天）
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

interface Diag { label: string; action: string; level: number }
interface DiagnosedRow extends SkuRow { _level: number; _issues: Diag[] }

// 0 健康 / 1 注意 / 2 警 / 3 急
const LEVEL_COLOR: Record<number, string> = { 3: "#cf1322", 2: "#d46b08", 1: "#d4b106", 0: "#3f8600" };
const TAG_COLOR: Record<number, string> = { 3: "red", 2: "orange", 1: "gold", 0: "green" };

// 商品诊断：不依赖流量的维度（销量趋势/库存/可售天数/建议备货/动销）。流量维度待采集铺开后增强。
function diagnose(r: SkuRow): Diag[] {
  const issues: Diag[] = [];
  const hasSales = (r.last30d || 0) > 0 || (r.last7d || 0) > 0;
  if ((r.stock || 0) <= 0) {
    if (hasSales) issues.push({ label: "已售罄", action: "近期有销量却断货 → 立即补货", level: 3 });
    else issues.push({ label: "售罄无销", action: "长期断货且无销量 → 确认是否下架/清理", level: 1 });
  } else {
    if (r.sale_days != null && r.sale_days < 7) {
      issues.push({ label: "即将断货", action: `仅可售约 ${r.sale_days} 天 → 尽快备货`, level: 2 });
    } else if ((r.advice_qty || 0) > 0) {
      issues.push({ label: "建议补货", action: `系统建议备货 ${r.advice_qty.toLocaleString("zh-CN")} 件`, level: 1 });
    }
    if ((r.last30d || 0) === 0) {
      issues.push({ label: "零动销", action: "30 天无销量但有库存 → 清仓/优化标题/报活动", level: 2 });
    } else if ((r.last7d || 0) === 0) {
      issues.push({ label: "近期停销", action: "30 天有销、近 7 天 0 → 查原因/报活动救量", level: 2 });
    } else {
      const d7 = (r.last7d || 0) / 7;
      const d30 = (r.last30d || 0) / 30;
      if (d30 > 0 && d7 < d30 * 0.5) {
        issues.push({ label: "销量下滑", action: "近 7 天日均不足 30 天一半 → 关注/报活动/比价", level: 1 });
      }
    }
  }
  return issues;
}

function fmtNum(n: number | null | undefined) {
  if (n == null) return "-";
  return n.toLocaleString("zh-CN");
}

export default function OperationsWorkbench() {
  const [rows, setRows] = useState<SkuRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState("all");
  const [diagFilter, setDiagFilter] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.skuSales) {
      setError("当前版本不支持运营工作台（IPC 未注册），请升级桌面端");
      return;
    }
    setLoading(true);
    try {
      const resp = await window.electronAPI.erp.reports.skuSales({ includeTest: false });
      if (resp.ok && resp.data) {
        setRows((resp.data.rows || []) as SkuRow[]);
        setError(null);
      } else {
        setError(resp.error || "加载失败");
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const diagnosed: DiagnosedRow[] = useMemo(() => rows.map((r) => {
    const issues = diagnose(r);
    const level = issues.length ? Math.max(...issues.map((i) => i.level)) : 0;
    return { ...r, _issues: issues, _level: level };
  }), [rows]);

  const storeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.store_code) s.add(r.store_code);
    return Array.from(s).sort();
  }, [rows]);

  const overview = useMemo(() => {
    let urgent = 0, warn = 0, note = 0, healthy = 0;
    const byLabel: Record<string, number> = {};
    for (const r of diagnosed) {
      if (r._level === 3) urgent++; else if (r._level === 2) warn++; else if (r._level === 1) note++; else healthy++;
      for (const i of r._issues) byLabel[i.label] = (byLabel[i.label] || 0) + 1;
    }
    return { urgent, warn, note, healthy, byLabel };
  }, [diagnosed]);

  const view = useMemo(() => {
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

  const columns: ColumnsType<DiagnosedRow> = [
    { title: "店号", dataIndex: "store_code", width: 76, fixed: "left", render: (v) => <Typography.Text strong>{v || "—"}</Typography.Text>, sorter: (a, b) => (a.store_code || "").localeCompare(b.store_code || "") },
    {
      title: "SKU / 商品", key: "sku", width: 280,
      render: (_, r) => (
        <div>
          <Typography.Text copyable={{ text: r.sku_ext_code || "" }} style={{ fontSize: 12 }}>{r.sku_ext_code || "(无货号)"}</Typography.Text>
          <Tooltip title={r.title || ""}><div style={{ color: "#888", fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "—"}</div></Tooltip>
        </div>
      ),
    },
    {
      title: "诊断", key: "diag", width: 150,
      render: (_, r) => r._issues.length
        ? <span>{r._issues.map((i) => <Tag key={i.label} color={TAG_COLOR[i.level]} style={{ marginBottom: 2 }}>{i.label}</Tag>)}</span>
        : <Tag color="green">健康</Tag>,
      sorter: (a, b) => a._level - b._level,
      defaultSortOrder: "descend",
    },
    {
      title: "建议动作", key: "action", width: 300,
      render: (_, r) => r._issues.length
        ? <div style={{ fontSize: 12 }}>{r._issues.map((i) => <div key={i.label} style={{ color: LEVEL_COLOR[i.level] }}>· {i.action}</div>)}</div>
        : <span style={{ color: "#aaa" }}>正常在售</span>,
    },
    { title: "今日", dataIndex: "today", width: 70, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.today - b.today },
    { title: "近7天", dataIndex: "last7d", width: 75, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.last7d - b.last7d },
    { title: "近30天", dataIndex: "last30d", width: 80, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.last30d - b.last30d },
    { title: "库存", dataIndex: "stock", width: 80, align: "right", render: (v: number) => <span style={{ color: v <= 0 ? "#cf1322" : undefined }}>{fmtNum(v)}</span>, sorter: (a, b) => a.stock - b.stock },
    { title: "可售天数", dataIndex: "sale_days", width: 85, align: "right", render: (v: number | null) => (v == null ? "—" : <span style={{ color: v < 7 ? "#d46b08" : undefined }}>{v}天</span>), sorter: (a, b) => (a.sale_days ?? Infinity) - (b.sale_days ?? Infinity) },
    { title: "申报价", dataIndex: "declared_price", width: 80, align: "right", render: (v: number | null) => (v == null ? "—" : "¥" + v.toFixed(2)) },
  ];

  const diagChip = (key: string, label: string, count: number, color: string) => (
    count > 0 ? <Tag color={color} style={{ cursor: "pointer" }} onClick={() => setDiagFilter(diagFilter === key ? "all" : key)}>{label} {count}</Tag> : null
  );

  return (
    <div style={{ padding: 16 }}>
      <Card
        title="运营工作台 · 商品诊断"
        extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => { load(); message.success("已刷新"); }}>刷新</Button>}
        style={{ marginBottom: 16 }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
          <Statistic title="待诊断 SKU" value={diagnosed.length} />
          <Statistic title="急（立即处理）" value={overview.urgent} valueStyle={{ color: overview.urgent > 0 ? "#cf1322" : undefined }} />
          <Statistic title="警（尽快处理）" value={overview.warn} valueStyle={{ color: overview.warn > 0 ? "#d46b08" : undefined }} />
          <Statistic title="注意" value={overview.note} valueStyle={{ color: overview.note > 0 ? "#d4b106" : undefined }} />
          <Statistic title="健康" value={overview.healthy} valueStyle={{ color: "#3f8600" }} />
        </div>
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 4 }}>按病因筛选</Typography.Text>
          {diagChip("已售罄", "已售罄", overview.byLabel["已售罄"] || 0, "red")}
          {diagChip("即将断货", "即将断货", overview.byLabel["即将断货"] || 0, "orange")}
          {diagChip("零动销", "零动销", overview.byLabel["零动销"] || 0, "orange")}
          {diagChip("近期停销", "近期停销", overview.byLabel["近期停销"] || 0, "orange")}
          {diagChip("销量下滑", "销量下滑", overview.byLabel["销量下滑"] || 0, "gold")}
          {diagChip("建议补货", "建议补货", overview.byLabel["建议补货"] || 0, "gold")}
          {diagFilter !== "all" && <Tag onClick={() => setDiagFilter("all")} style={{ cursor: "pointer" }}>清除筛选 ✕</Tag>}
        </div>
      </Card>

      {error && <Alert type="error" showIcon message="加载失败" description={error} style={{ marginBottom: 16 }} action={<Button size="small" onClick={load}>重试</Button>} />}

      {!error && (
        <Card bodyStyle={{ padding: 0 }}>
          <div style={{ padding: "12px 16px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Select size="small" style={{ width: 130 }} value={storeFilter} onChange={setStoreFilter}
              options={[{ value: "all", label: "全部店铺" }, ...storeOptions.map((c) => ({ value: c, label: c }))]} />
            <Select size="small" style={{ width: 140 }} value={diagFilter} onChange={setDiagFilter}
              options={[{ value: "all", label: "全部" }, { value: "issues", label: "仅有问题" }, { value: "urgent", label: "急" }, { value: "warn", label: "警" }, { value: "note", label: "注意" }]} />
            <Input.Search size="small" allowClear placeholder="搜货号 / 标题" style={{ width: 220 }} value={search} onChange={(e) => setSearch(e.target.value)} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>共 {view.length} 条（按严重度排序）· 流量维度待采集铺开后增强</Typography.Text>
          </div>
          <Table<DiagnosedRow>
            dataSource={view}
            columns={columns}
            rowKey={(r) => `${r.mall_id}|${r.skc_id || ""}|${r.sku_ext_code || ""}`}
            size="small"
            pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
            scroll={{ x: 1180 }}
            loading={loading}
          />
        </Card>
      )}
    </div>
  );
}
