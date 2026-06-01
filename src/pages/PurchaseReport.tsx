import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Row, Col, Table, Tag, Select, Input, Space, Typography, Alert, Button, Progress, Tooltip } from "antd";
import { ReloadOutlined, AccountBookOutlined, CheckCircleOutlined, ClockCircleOutlined, InboxOutlined, CalendarOutlined, WalletOutlined, InfoCircleOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

const fmtMoney = (n?: number | null) => "¥" + Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const fmtNum = (n?: number | null) => Number(n || 0).toLocaleString("zh-CN");
const ymd = (s?: string | null) => (s ? String(s).slice(0, 10) : "—");
const pctNum = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const pctOf = (a: number, b: number) => (b > 0 ? `占 ${Math.round((a / b) * 100)}%` : "");

// 采购单状态色 → antd Tag color（明细状态列）
const STATUS_COLOR: Record<string, string> = {
  draft: "default", pushed_pending_price: "orange", pending_finance_approval: "gold",
  approved_to_pay: "blue", paid: "cyan", supplier_processing: "geekblue",
  shipped: "purple", arrived: "lime", inbounded: "green", closed: "default",
  delayed: "volcano", exception: "red", cancelled: "default",
};
// 状态语义色（分布图色点/条）
const STATUS_HEX: Record<string, string> = {
  draft: "#bfbfbf", pushed_pending_price: "#fa8c16", pending_finance_approval: "#faad14",
  approved_to_pay: "#1677ff", paid: "#13c2c2", supplier_processing: "#2f54eb",
  shipped: "#722ed1", arrived: "#a0d911", inbounded: "#52c41a", closed: "#8c8c8c",
  delayed: "#fa541c", exception: "#f5222d", cancelled: "#d9d9d9",
};
// 账龄分桶配色/标签
const AGE_HEX: Record<string, string> = { "0-30": "#52c41a", "31-60": "#faad14", "61-90": "#fa8c16", "90+": "#cf1322" };
const AGE_LABEL: Record<string, string> = { "0-30": "0-30 天", "31-60": "31-60 天", "61-90": "61-90 天", "90+": "90 天以上" };

interface OrderRow {
  id: string; po_no: string; status: string; status_label: string; payment_status: string | null;
  supplier_id: string | null; supplier_name: string | null; account_id: string | null; account_name: string | null;
  goods_amount: number; freight_amount: number; total_amount: number; paid_amount: number; unpaid_amount: number;
  line_count: number; total_qty: number; received_qty: number; inbound_pct: number;
  created_at: string | null; expected_delivery_date: string | null; actual_delivery_date: string | null; paid_at: string | null;
}
interface ByStatus { status: string; label: string; count: number; amount: number; }
interface BySupplier { supplier_id: string | null; supplier_name: string; count: number; amount: number; paid: number; }
interface Monthly { month: string; count: number; amount: number; }
interface Quad { count: number; amount: number; }
interface Aging { bucket: string; count: number; amount: number; }
interface Report {
  generated_at: number; row_count: number; orders_shown: number; orders_truncated: boolean;
  summary: {
    po_count: number; cancelled_count: number; goods_amount: number; freight_amount: number; total_amount: number;
    paid_amount: number; unpaid_amount: number; pending_inbound_amount: number; this_month_amount: number; this_month_count: number; payment_rate: number;
  };
  capital: { paid_done: Quad; paid_undone: Quad; unpaid_done: Quad; unpaid_undone: Quad };
  aging: Aging[];
  cash_outflow: { coverage: number; monthly: Monthly[] };
  by_status: ByStatus[]; by_supplier: BySupplier[]; monthly: Monthly[]; orders: OrderRow[];
}

export default function PurchaseReportPanel() {
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.purchase) {
      setError("当前版本不支持采购单报表，请升级桌面端");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await window.electronAPI.erp.reports.purchase();
      if (resp.ok && resp.data) setData(resp.data as Report);
      else setError(resp.error || "加载失败");
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orders = useMemo(() => data?.orders || [], [data]);
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (supplierFilter !== "all" && (o.supplier_id || "__none__") !== supplierFilter) return false;
      if (kw) {
        const hay = [o.po_no, o.supplier_name, o.account_name].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [orders, statusFilter, supplierFilter, keyword]);

  const s = data?.summary;
  const cap = data?.capital;
  const aging = data?.aging || [];
  const cashMonthly = data?.cash_outflow?.monthly || [];
  const cashCoverage = data?.cash_outflow?.coverage || 0;
  const monthly = data?.monthly || [];
  const maxMonth = Math.max(1, ...monthly.map((m) => m.amount));
  const maxCash = Math.max(1, ...cashMonthly.map((m) => m.amount));
  const curMonth = new Date().toISOString().slice(0, 7);
  const byStatus = data?.by_status || [];
  const bySupplier = data?.by_supplier || [];
  const maxSupplier = Math.max(1, ...bySupplier.map((x) => x.amount));
  const totalStatusCount = byStatus.reduce((a, x) => a + x.count, 0) || 1;
  const agingMaxAmt = Math.max(1, ...aging.map((x) => x.amount));

  // 财务 KPI
  const KPIS = s && cap ? [
    { icon: <AccountBookOutlined />, label: "采购总额", value: fmtMoney(s.total_amount), sub: "货款 + 运费", bg: "#e6f4ff", bd: "#bae0ff", t: "#1677ff" },
    { icon: <CheckCircleOutlined />, label: "已付款", value: fmtMoney(s.paid_amount), sub: `付款率 ${(s.payment_rate * 100).toFixed(1)}%`, bg: "#f6ffed", bd: "#d9f7be", t: "#389e0d" },
    { icon: <ClockCircleOutlined />, label: "应付账款余额", value: fmtMoney(s.unpaid_amount), sub: `待付 · ${pctOf(s.unpaid_amount, s.total_amount)}`, bg: "#fff1f0", bd: "#ffccc7", t: "#cf1322" },
    { icon: <WalletOutlined />, label: "预付资金占用", value: fmtMoney(cap.paid_undone.amount), sub: `${fmtNum(cap.paid_undone.count)} 单 · 已付未到货`, bg: "#fff7e6", bd: "#ffe7ba", t: "#d46b08" },
    { icon: <InboxOutlined />, label: "未入库金额", value: fmtMoney(s.pending_inbound_amount), sub: "未到货 / 未入库", bg: "#f9f0ff", bd: "#efdbff", t: "#722ed1" },
    { icon: <CalendarOutlined />, label: "本月采购", value: fmtMoney(s.this_month_amount), sub: `${fmtNum(s.this_month_count)} 单`, bg: "#fafafa", bd: "#f0f0f0", t: "#595959" },
  ] : [];

  // 资金占用四象限
  const QUAD = cap ? [
    { label: "已付 · 已入库", desc: "已结算完成", v: cap.paid_done, c: "#389e0d", bg: "#f6ffed", bd: "#d9f7be" },
    { label: "已付 · 未入库", desc: "预付 / 在途资金占用", v: cap.paid_undone, c: "#d46b08", bg: "#fff7e6", bd: "#ffe7ba" },
    { label: "未付 · 已入库", desc: "暂估应付（已收货欠款）", v: cap.unpaid_done, c: "#1677ff", bg: "#e6f4ff", bd: "#bae0ff" },
    { label: "未付 · 未入库", desc: "在途订单负债", v: cap.unpaid_undone, c: "#cf1322", bg: "#fff1f0", bd: "#ffccc7" },
  ] : [];
  const capTotal = cap ? (cap.paid_done.amount + cap.paid_undone.amount + cap.unpaid_done.amount + cap.unpaid_undone.amount) || 1 : 1;

  const columns: ColumnsType<OrderRow> = [
    { title: "采购单号", dataIndex: "po_no", width: 140, fixed: "left", render: (v: string) => <Typography.Text copyable={{ text: v }} style={{ fontSize: 12 }}>{v}</Typography.Text> },
    { title: "店铺/账号", dataIndex: "account_name", width: 100, render: (v: string | null, r) => v || r.account_id || "—" },
    { title: "供应商", dataIndex: "supplier_name", width: 130, render: (v: string | null) => v || <span style={{ color: "#bbb" }}>未指定</span> },
    { title: "状态", dataIndex: "status_label", width: 100, render: (_, r) => <Tag color={STATUS_COLOR[r.status] || "default"}>{r.status_label}</Tag>, filters: byStatus.map((st) => ({ text: st.label, value: st.status })), onFilter: (val, r) => r.status === val },
    { title: "货款", dataIndex: "goods_amount", width: 100, align: "right", sorter: (a, b) => a.goods_amount - b.goods_amount, render: fmtMoney },
    { title: "运费", dataIndex: "freight_amount", width: 85, align: "right", sorter: (a, b) => a.freight_amount - b.freight_amount, render: (v: number) => (v > 0 ? fmtMoney(v) : <span style={{ color: "#bbb" }}>—</span>) },
    { title: "采购总额", dataIndex: "total_amount", width: 115, align: "right", sorter: (a, b) => a.total_amount - b.total_amount, defaultSortOrder: "descend", render: (v: number) => <span style={{ fontWeight: 600 }}>{fmtMoney(v)}</span> },
    { title: "付款", dataIndex: "payment_status", width: 80, align: "center", render: (v: string | null) => (v === "paid" ? <Tag color="green">已付</Tag> : <Tag color="red">未付</Tag>) },
    { title: "应付", dataIndex: "unpaid_amount", width: 110, align: "right", sorter: (a, b) => a.unpaid_amount - b.unpaid_amount, render: (v: number) => (v > 0 ? <span style={{ color: "#cf1322", fontWeight: 600 }}>{fmtMoney(v)}</span> : <span style={{ color: "#bbb" }}>0</span>) },
    { title: "账龄", key: "age", width: 80, align: "right", sorter: (a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")), render: (_, r) => {
      if (r.payment_status === "paid") return <span style={{ color: "#bbb" }}>已付清</span>;
      if (!r.created_at) return "—";
      const d = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
      const c = d > 90 ? "#cf1322" : d > 60 ? "#fa8c16" : d > 30 ? "#faad14" : "#52c41a";
      return <span style={{ color: c, fontWeight: d > 90 ? 600 : 400 }}>{d} 天</span>;
    } },
    { title: "入库进度", key: "inbound", width: 140, render: (_, r) => (
      <div>
        <Progress percent={r.inbound_pct} size="small" status={r.inbound_pct >= 100 ? "success" : "active"} />
        <span style={{ fontSize: 11, color: "#888" }}>{fmtNum(r.received_qty)} / {fmtNum(r.total_qty)}</span>
      </div>
    ) },
    { title: "下单时间", dataIndex: "created_at", width: 105, sorter: (a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")), render: ymd },
    { title: "付款时间", dataIndex: "paid_at", width: 105, render: ymd },
  ];

  const cardBody = { minHeight: 240 };

  return (
    <div style={{ padding: 16 }}>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {data?.generated_at ? `数据更新于 ${new Date(data.generated_at).toLocaleString("zh-CN")}` : ""}
        </Typography.Text>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading} size="small">刷新</Button>
      </div>

      {/* 财务 KPI */}
      <Row gutter={[12, 12]}>
        {KPIS.map((k) => (
          <Col xs={12} sm={8} md={4} key={k.label}>
            <div style={{ background: k.bg, border: `1px solid ${k.bd}`, borderRadius: 10, padding: "12px 14px", height: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: k.t, fontSize: 12 }}>{k.icon}<span>{k.label}</span></div>
              <div style={{ fontSize: 19, fontWeight: 700, color: k.t, marginTop: 8, lineHeight: 1.2, wordBreak: "break-all" }}>{k.value}</div>
              <div style={{ fontSize: 11, color: "#999", marginTop: 4, minHeight: 15 }}>{k.sub}</div>
            </div>
          </Col>
        ))}
      </Row>
      <div style={{ marginTop: 8, fontSize: 12, color: "#999" }}>
        采购总额 = 货款 + 运费（已排除「已取消」单）；已付/应付按付款状态判定（系统 paid_amount 字段不可信，故按状态口径）。
      </div>

      {/* 资金占用四象限 + 应付账款账龄 */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card size="small" title="资金占用结构（付款 × 入库）" styles={{ body: cardBody }}>
            <Row gutter={[10, 10]}>
              {QUAD.map((q) => (
                <Col span={12} key={q.label}>
                  <div style={{ background: q.bg, border: `1px solid ${q.bd}`, borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 12, color: q.c, fontWeight: 600 }}>{q.label}</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: q.c, marginTop: 4 }}>{fmtMoney(q.v.amount)}</div>
                    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{fmtNum(q.v.count)} 单 · {pctNum(q.v.amount, capTotal)}%</div>
                    <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{q.desc}</div>
                  </div>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card
            size="small"
            title="应付账款账龄"
            extra={<Tooltip title="按下单日距今计（系统无账期/交期字段，无法按到期日算逾期）。90 天以上为长账龄，需财务核销或确认呆账。"><InfoCircleOutlined style={{ color: "#999" }} /></Tooltip>}
            styles={{ body: cardBody }}
          >
            {aging.some((a) => a.amount > 0) ? aging.map((a) => (
              <div key={a.bucket} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: AGE_HEX[a.bucket], flexShrink: 0 }} />
                <span style={{ width: 76, fontSize: 12, color: a.bucket === "90+" ? "#cf1322" : "#333", fontWeight: a.bucket === "90+" ? 600 : 400, flexShrink: 0 }}>{AGE_LABEL[a.bucket]}</span>
                <div style={{ flex: 1, minWidth: 40 }}>
                  <Progress percent={Math.round((a.amount / agingMaxAmt) * 100)} showInfo={false} size="small" strokeColor={AGE_HEX[a.bucket]} />
                </div>
                <span style={{ width: 52, textAlign: "right", fontSize: 12, color: "#666", flexShrink: 0 }}>{fmtNum(a.count)}单</span>
                <span style={{ width: 96, textAlign: "right", fontSize: 12, fontWeight: a.bucket === "90+" ? 600 : 400, color: a.bucket === "90+" ? "#cf1322" : undefined, flexShrink: 0 }}>{fmtMoney(a.amount)}</span>
              </div>
            )) : <span style={{ color: "#bbb" }}>暂无未付款单</span>}
          </Card>
        </Col>
      </Row>

      {/* 月度采购趋势 + 现金流出 */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card size="small" title="月度采购趋势（按下单日，近12月）" styles={{ body: cardBody }}>
            {monthly.length ? monthly.map((m) => {
              const isCur = m.month === curMonth;
              return (
                <div key={m.month} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 56, fontSize: 12, color: isCur ? "#fa8c16" : "#666", fontWeight: isCur ? 600 : 400, flexShrink: 0 }}>{m.month}</span>
                  <div style={{ flex: 1, minWidth: 40 }}><Progress percent={Math.round((m.amount / maxMonth) * 100)} showInfo={false} size="small" strokeColor={isCur ? "#fa8c16" : "#1677ff"} /></div>
                  <span style={{ width: 104, textAlign: "right", fontSize: 12, fontWeight: isCur ? 600 : 400, flexShrink: 0 }}>{fmtMoney(m.amount)}</span>
                  <span style={{ width: 44, textAlign: "right", fontSize: 11, color: "#999", flexShrink: 0 }}>{fmtNum(m.count)}单</span>
                </div>
              );
            }) : <span style={{ color: "#bbb" }}>暂无数据</span>}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card
            size="small"
            title="现金流出趋势（按实际付款日）"
            extra={<Tooltip title={`仅基于有付款日期(paid_at)的单，覆盖约 ${cashCoverage}% 的已付单；其余历史已付单无付款日期，未纳入。`}><span style={{ fontSize: 12, color: "#999" }}>覆盖 {cashCoverage}% <InfoCircleOutlined /></span></Tooltip>}
            styles={{ body: cardBody }}
          >
            {cashMonthly.length ? cashMonthly.map((m) => {
              const isCur = m.month === curMonth;
              return (
                <div key={m.month} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 56, fontSize: 12, color: isCur ? "#fa8c16" : "#666", fontWeight: isCur ? 600 : 400, flexShrink: 0 }}>{m.month}</span>
                  <div style={{ flex: 1, minWidth: 40 }}><Progress percent={Math.round((m.amount / maxCash) * 100)} showInfo={false} size="small" strokeColor={isCur ? "#fa8c16" : "#13c2c2"} /></div>
                  <span style={{ width: 104, textAlign: "right", fontSize: 12, fontWeight: isCur ? 600 : 400, flexShrink: 0 }}>{fmtMoney(m.amount)}</span>
                  <span style={{ width: 44, textAlign: "right", fontSize: 11, color: "#999", flexShrink: 0 }}>{fmtNum(m.count)}单</span>
                </div>
              );
            }) : <span style={{ color: "#bbb" }}>暂无付款日期数据</span>}
          </Card>
        </Col>
      </Row>

      {/* 采购成本结构 + 状态分布 */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} md={10}>
          <Card size="small" title="采购成本结构" styles={{ body: { minHeight: 160 } }}>
            {s ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ width: 48, fontSize: 12, color: "#333" }}>货款</span>
                  <div style={{ flex: 1 }}><Progress percent={pctNum(s.goods_amount, s.total_amount)} size="small" strokeColor="#1677ff" /></div>
                  <span style={{ width: 120, textAlign: "right", fontSize: 12, fontWeight: 600 }}>{fmtMoney(s.goods_amount)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ width: 48, fontSize: 12, color: "#333" }}>运费</span>
                  <div style={{ flex: 1 }}><Progress percent={pctNum(s.freight_amount, s.total_amount)} size="small" strokeColor="#d46b08" /></div>
                  <span style={{ width: 120, textAlign: "right", fontSize: 12, fontWeight: 600 }}>{fmtMoney(s.freight_amount)}</span>
                </div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 8 }}>
                  运费率 <span style={{ color: "#d46b08", fontWeight: 600 }}>{s.total_amount > 0 ? (s.freight_amount / s.total_amount * 100).toFixed(2) : "0"}%</span>
                  （运费占采购总额比重，越低成本结构越健康）
                </div>
              </>
            ) : <span style={{ color: "#bbb" }}>暂无数据</span>}
          </Card>
        </Col>
        <Col xs={24} md={14}>
          <Card size="small" title="采购单状态分布" styles={{ body: { minHeight: 160 } }}>
            {byStatus.length ? byStatus.map((st) => (
              <div key={st.status} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_HEX[st.status] || "#d9d9d9", flexShrink: 0 }} />
                <span style={{ width: 88, fontSize: 12, color: "#333", flexShrink: 0 }}>{st.label}</span>
                <div style={{ flex: 1, minWidth: 40 }}><Progress percent={Math.round((st.count / totalStatusCount) * 100)} showInfo={false} size="small" strokeColor={STATUS_HEX[st.status] || "#d9d9d9"} /></div>
                <span style={{ width: 52, textAlign: "right", fontSize: 12, color: "#666", flexShrink: 0 }}>{fmtNum(st.count)}单</span>
                <span style={{ width: 100, textAlign: "right", fontSize: 12, flexShrink: 0 }}>{fmtMoney(st.amount)}</span>
              </div>
            )) : <span style={{ color: "#bbb" }}>暂无数据</span>}
          </Card>
        </Col>
      </Row>

      {/* 供应商应付排行 */}
      <Card size="small" title="供应商采购 / 应付 TOP20" style={{ marginTop: 16 }}>
        <Table
          dataSource={bySupplier}
          rowKey={(r) => r.supplier_id || "__none__"}
          size="small"
          pagination={false}
          scroll={{ y: 260 }}
          columns={[
            { title: "供应商", dataIndex: "supplier_name", render: (v: string) => v || <span style={{ color: "#bbb" }}>(未指定供应商)</span> },
            { title: "采购单数", dataIndex: "count", width: 90, align: "right", render: fmtNum },
            { title: "采购额", dataIndex: "amount", width: 220, render: (v: number) => (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 40 }}><Progress percent={Math.round((v / maxSupplier) * 100)} showInfo={false} size="small" strokeColor="#1677ff" /></div>
                <span style={{ width: 100, textAlign: "right", fontWeight: 600 }}>{fmtMoney(v)}</span>
              </div>
            ) },
            { title: "已付", dataIndex: "paid", width: 120, align: "right", render: (v: number) => <span style={{ color: "#389e0d" }}>{fmtMoney(v)}</span> },
            { title: "应付余额", key: "unpaid", width: 120, align: "right", sorter: (a, b) => (a.amount - a.paid) - (b.amount - b.paid), render: (_, r) => { const u = r.amount - r.paid; return u > 0 ? <span style={{ color: "#cf1322", fontWeight: 600 }}>{fmtMoney(u)}</span> : <span style={{ color: "#bbb" }}>0</span>; } },
          ]}
        />
      </Card>

      {/* 采购单明细 */}
      <Card size="small" title="采购单明细" style={{ marginTop: 16 }}>
        <Space style={{ marginBottom: 12 }} wrap>
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 150 }}
            options={[{ value: "all", label: "全部状态" }, ...byStatus.map((st) => ({ value: st.status, label: `${st.label}(${st.count})` }))]}
          />
          <Select
            value={supplierFilter}
            onChange={setSupplierFilter}
            style={{ width: 200 }}
            showSearch
            optionFilterProp="label"
            options={[{ value: "all", label: "全部供应商" }, ...bySupplier.map((sp) => ({ value: sp.supplier_id || "__none__", label: sp.supplier_name }))]}
          />
          <Input.Search placeholder="搜索采购单号 / 供应商 / 店铺" allowClear style={{ width: 260 }} onChange={(e) => setKeyword(e.target.value)} />
          <span style={{ color: "#999", fontSize: 12 }}>
            筛选后 {filtered.length} 单
            {data?.orders_truncated ? `（明细仅展示最近 ${data.orders_shown} 单 / 全量 ${data.row_count} 单；上方汇总·分布·账龄为全量统计）` : ""}
          </span>
        </Space>
        <Table<OrderRow>
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          scroll={{ x: 1400 }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (t) => `共 ${t} 单` }}
        />
      </Card>
    </div>
  );
}
