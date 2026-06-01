import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Row, Col, Statistic, Table, Tag, Select, Input, Space, Typography, Alert, Button, Progress } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

const fmtMoney = (n?: number | null) => "¥" + Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const fmtNum = (n?: number | null) => Number(n || 0).toLocaleString("zh-CN");
const ymd = (s?: string | null) => (s ? String(s).slice(0, 10) : "—");

// 采购单状态色 → antd Tag color
const STATUS_COLOR: Record<string, string> = {
  draft: "default", pushed_pending_price: "orange", pending_finance_approval: "gold",
  approved_to_pay: "blue", paid: "cyan", supplier_processing: "geekblue",
  shipped: "purple", arrived: "lime", inbounded: "green", closed: "default",
  delayed: "volcano", exception: "red", cancelled: "default",
};

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
interface Report {
  generated_at: number; row_count: number; orders_shown: number; orders_truncated: boolean;
  summary: {
    po_count: number; cancelled_count: number; goods_amount: number; freight_amount: number; total_amount: number;
    paid_amount: number; unpaid_amount: number; pending_inbound_amount: number; this_month_amount: number; this_month_count: number;
  };
  by_status: ByStatus[]; by_supplier: BySupplier[]; monthly: Monthly[]; orders: OrderRow[];
}

export default function PurchaseReport() {
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
      if (resp.ok && resp.data) setData(resp.data);
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
  const monthly = data?.monthly || [];
  const maxMonth = Math.max(1, ...monthly.map((m) => m.amount));

  const columns: ColumnsType<OrderRow> = [
    { title: "采购单号", dataIndex: "po_no", width: 150, fixed: "left", render: (v: string) => <Typography.Text copyable={{ text: v }} style={{ fontSize: 12 }}>{v}</Typography.Text> },
    { title: "店铺/账号", dataIndex: "account_name", width: 110, render: (v: string | null, r) => v || r.account_id || "—" },
    { title: "供应商", dataIndex: "supplier_name", width: 140, render: (v: string | null) => v || <span style={{ color: "#bbb" }}>未指定</span> },
    { title: "状态", dataIndex: "status_label", width: 110, render: (_, r) => <Tag color={STATUS_COLOR[r.status] || "default"}>{r.status_label}</Tag>, filters: (data?.by_status || []).map((st) => ({ text: st.label, value: st.status })), onFilter: (val, r) => r.status === val },
    { title: "货款", dataIndex: "goods_amount", width: 110, align: "right", sorter: (a, b) => a.goods_amount - b.goods_amount, render: fmtMoney },
    { title: "运费", dataIndex: "freight_amount", width: 90, align: "right", sorter: (a, b) => a.freight_amount - b.freight_amount, render: (v: number) => (v > 0 ? fmtMoney(v) : <span style={{ color: "#bbb" }}>—</span>) },
    { title: "采购总额", dataIndex: "total_amount", width: 120, align: "right", sorter: (a, b) => a.total_amount - b.total_amount, defaultSortOrder: "descend", render: (v: number) => <span style={{ fontWeight: 600 }}>{fmtMoney(v)}</span> },
    { title: "已付", dataIndex: "paid_amount", width: 110, align: "right", sorter: (a, b) => a.paid_amount - b.paid_amount, render: (v: number) => (v > 0 ? <span style={{ color: "#3f8600" }}>{fmtMoney(v)}</span> : <span style={{ color: "#bbb" }}>—</span>) },
    { title: "待付", dataIndex: "unpaid_amount", width: 110, align: "right", sorter: (a, b) => a.unpaid_amount - b.unpaid_amount, render: (v: number) => (v > 0 ? <span style={{ color: "#cf1322", fontWeight: 600 }}>{fmtMoney(v)}</span> : <span style={{ color: "#bbb" }}>0</span>) },
    { title: "SKU数", dataIndex: "line_count", width: 75, align: "right", render: fmtNum },
    { title: "订购量", dataIndex: "total_qty", width: 80, align: "right", sorter: (a, b) => a.total_qty - b.total_qty, render: fmtNum },
    { title: "入库进度", key: "inbound", width: 150, render: (_, r) => (
      <div>
        <Progress percent={r.inbound_pct} size="small" status={r.inbound_pct >= 100 ? "success" : "active"} />
        <span style={{ fontSize: 11, color: "#888" }}>{fmtNum(r.received_qty)} / {fmtNum(r.total_qty)}</span>
      </div>
    ) },
    { title: "下单时间", dataIndex: "created_at", width: 105, sorter: (a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")), render: ymd },
    { title: "预计到货", dataIndex: "expected_delivery_date", width: 105, render: ymd },
    { title: "付款时间", dataIndex: "paid_at", width: 105, render: ymd },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card
        title="采购单报表"
        extra={<Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>}
        styles={{ body: { paddingTop: 16 } }}
      >
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

        {/* 采购总览 */}
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={8} md={4}><Statistic title="采购单数" value={s?.po_count || 0} suffix={s?.cancelled_count ? <span style={{ fontSize: 12, color: "#999" }}>（含取消 {s.cancelled_count}）</span> : undefined} /></Col>
          <Col xs={12} sm={8} md={4}><Statistic title="采购总额" value={s?.total_amount || 0} precision={2} prefix="¥" valueStyle={{ color: "#1677ff" }} /></Col>
          <Col xs={12} sm={8} md={4}><Statistic title="已付款" value={s?.paid_amount || 0} precision={2} prefix="¥" valueStyle={{ color: "#3f8600" }} /></Col>
          <Col xs={12} sm={8} md={4}><Statistic title="待付款" value={s?.unpaid_amount || 0} precision={2} prefix="¥" valueStyle={{ color: "#cf1322" }} /></Col>
          <Col xs={12} sm={8} md={4}><Statistic title="未入库金额" value={s?.pending_inbound_amount || 0} precision={2} prefix="¥" valueStyle={{ color: "#d46b08" }} /></Col>
          <Col xs={12} sm={8} md={4}><Statistic title="本月采购" value={s?.this_month_amount || 0} precision={2} prefix="¥" suffix={s?.this_month_count ? <span style={{ fontSize: 12, color: "#999" }}>/{s.this_month_count}单</span> : undefined} /></Col>
        </Row>
        <div style={{ marginTop: 4, fontSize: 12, color: "#999" }}>采购总额 = 货款 + 运费；金额汇总已排除「已取消」单。未入库金额 = 未到「已入库/已关闭」状态的采购单总额。</div>

        {/* 状态分布 + 月趋势 */}
        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col xs={24} md={12}>
            <Card size="small" title="状态分布" styles={{ body: { minHeight: 120 } }}>
              <Space size={[8, 8]} wrap>
                {(data?.by_status || []).map((st) => (
                  <Tag key={st.status} color={STATUS_COLOR[st.status] || "default"} style={{ marginInlineEnd: 0 }}>
                    {st.label} · {st.count}单 · {fmtMoney(st.amount)}
                  </Tag>
                ))}
                {!(data?.by_status || []).length && <span style={{ color: "#bbb" }}>暂无数据</span>}
              </Space>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card size="small" title="月度采购趋势（近12月）" styles={{ body: { minHeight: 120 } }}>
              {monthly.length ? monthly.map((m) => (
                <div key={m.month} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 56, fontSize: 12, color: "#666" }}>{m.month}</span>
                  <div style={{ flex: 1 }}>
                    <Progress percent={Math.round((m.amount / maxMonth) * 100)} showInfo={false} size="small" />
                  </div>
                  <span style={{ width: 110, textAlign: "right", fontSize: 12 }}>{fmtMoney(m.amount)}</span>
                  <span style={{ width: 44, textAlign: "right", fontSize: 11, color: "#999" }}>{m.count}单</span>
                </div>
              )) : <span style={{ color: "#bbb" }}>暂无数据</span>}
            </Card>
          </Col>
        </Row>

        {/* 供应商 TOP */}
        <Card size="small" title="供应商采购 TOP20" style={{ marginTop: 16 }}>
          <Table
            dataSource={data?.by_supplier || []}
            rowKey={(r) => r.supplier_id || "__none__"}
            size="small"
            pagination={false}
            scroll={{ y: 260 }}
            columns={[
              { title: "供应商", dataIndex: "supplier_name" },
              { title: "采购单数", dataIndex: "count", width: 100, align: "right", render: fmtNum },
              { title: "采购额", dataIndex: "amount", width: 140, align: "right", render: (v: number) => <span style={{ fontWeight: 600 }}>{fmtMoney(v)}</span> },
              { title: "已付", dataIndex: "paid", width: 140, align: "right", render: (v: number) => <span style={{ color: "#3f8600" }}>{fmtMoney(v)}</span> },
              { title: "待付", key: "unpaid", width: 140, align: "right", render: (_, r) => { const u = r.amount - r.paid; return u > 0 ? <span style={{ color: "#cf1322" }}>{fmtMoney(u)}</span> : <span style={{ color: "#bbb" }}>0</span>; } },
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
              options={[{ value: "all", label: "全部状态" }, ...(data?.by_status || []).map((st) => ({ value: st.status, label: `${st.label}(${st.count})` }))]}
            />
            <Select
              value={supplierFilter}
              onChange={setSupplierFilter}
              style={{ width: 200 }}
              showSearch
              optionFilterProp="label"
              options={[{ value: "all", label: "全部供应商" }, ...(data?.by_supplier || []).map((sp) => ({ value: sp.supplier_id || "__none__", label: sp.supplier_name }))]}
            />
            <Input.Search
              placeholder="搜索采购单号 / 供应商 / 店铺"
              allowClear
              style={{ width: 260 }}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <span style={{ color: "#999", fontSize: 12 }}>
              筛选后 {filtered.length} 单
              {data?.orders_truncated ? `（明细仅展示最近 ${data.orders_shown} 单 / 全量 ${data.row_count} 单；上方汇总·分布为全量统计）` : ""}
            </span>
          </Space>
          <Table<OrderRow>
            dataSource={filtered}
            columns={columns}
            rowKey="id"
            size="small"
            loading={loading}
            scroll={{ x: 1500 }}
            pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (t) => `共 ${t} 单` }}
          />
        </Card>
      </Card>
    </div>
  );
}
