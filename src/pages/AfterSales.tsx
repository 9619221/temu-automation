import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Col, Input, Row, Select, Space, Table, Tabs, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CloudSyncOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import EmptyGuide from "../components/EmptyGuide";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import PurchaseReturnsSection from "../components/PurchaseReturnsSection";
import ConsignAfterSalesSection from "../components/ConsignAfterSalesSection";
import {
  fetchTemuAfterSales,
  loadCloudConfig,
  type TemuAfterSaleRow,
  type TemuAfterSaleSummaryRow,
} from "../utils/cloudClient";

const { Paragraph, Text } = Typography;

function formatNumber(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toLocaleString("zh-CN");
}

function formatMoney(cents?: number | null, currency?: string | null) {
  if (cents === null || cents === undefined) return "-";
  return `${(Number(cents) / 100).toFixed(2)} ${currency || "CNY"}`;
}

function formatTime(value?: string | number | null) {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN");
}

function statusColor(value?: string | null) {
  const text = String(value || "").toLowerCase();
  if (/abnormal|cancel|close|fail|reject|timeout|取消|关闭|拒绝|失败|退回|异常|逾期|超时|驳回/.test(text)) return "red";
  if (/complete|done|finish|signed|success|完成|通过|签收|已发|已入库|成功/.test(text)) return "green";
  if (/audit|pending|processing|review|wait|待|处理中|审核|取件|发货|入库/.test(text)) return "orange";
  return "default";
}

function isDiagnosticText(value?: string | null) {
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

function optionFromText(value?: string | null) {
  const text = String(value || "").trim();
  return text ? { label: text, value: text } : null;
}

export default function AfterSales() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TemuAfterSaleRow[]>([]);
  const [summary, setSummary] = useState<TemuAfterSaleSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [cloudConfigured, setCloudConfigured] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");

  const loadData = useCallback(async (notify = false) => {
    setLoading(true);
    try {
      const cfg = await loadCloudConfig();
      if (!cfg) {
        setCloudConfigured(false);
        setCloudError("还没有配置云端连接");
        setRows([]);
        setSummary([]);
        setLoadedOnce(true);
        return;
      }

      setCloudConfigured(true);
      const result = await fetchTemuAfterSales(cfg, {
        q: query || undefined,
        status: status || undefined,
        type: type || undefined,
        limit: 1000,
      });
      const nextRows = (result.rows || []).filter((row) => !isDiagnosticText(row.mall_id) && !isDiagnosticText(row.skc_id));
      setRows(nextRows);
      setSummary(result.summary || []);
      setCloudError(null);
      setLoadedAt(new Date().toISOString());
      setLoadedOnce(true);
      if (notify) message.success(`已同步 ${formatNumber(nextRows.length)} 条售后记录`);
    } catch (error: any) {
      const text = error?.message || "云端售后数据读取失败";
      setCloudError(text);
      setLoadedOnce(true);
      if (notify) message.error(text);
    } finally {
      setLoading(false);
    }
  }, [query, status, type]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const pendingCount = useMemo(
    () => rows.filter((row) => statusColor(row.status) !== "green").length,
    [rows],
  );
  const totalQuantity = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    [rows],
  );
  const amountCents = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0),
    [rows],
  );
  const amountCurrency = rows.find((row) => row.currency)?.currency || "CNY";

  const typeOptions = useMemo(() => (
    Array.from(new Map(
      [...summary.map((item) => item.after_sale_type), ...rows.map((row) => row.after_sale_type)]
        .map(optionFromText)
        .filter((item): item is { label: string; value: string } => Boolean(item))
        .map((item) => [item.value, item]),
    ).values())
  ), [rows, summary]);

  const statusOptions = useMemo(() => (
    Array.from(new Map(
      [...summary.map((item) => item.status), ...rows.map((row) => row.status)]
        .map(optionFromText)
        .filter((item): item is { label: string; value: string } => Boolean(item))
        .map((item) => [item.value, item]),
    ).values())
  ), [rows, summary]);

  const columns: ColumnsType<TemuAfterSaleRow> = [
    {
      title: "商品",
      key: "product",
      width: 340,
      render: (_value, row) => (
        <Space direction="vertical" size={0} style={{ width: "100%" }}>
          <Paragraph ellipsis={{ rows: 2, tooltip: row.product_name || "-" }} style={{ marginBottom: 0, fontWeight: 600, lineHeight: 1.4 }}>
            {row.product_name || "-"}
          </Paragraph>
          <Text type="secondary" style={{ fontSize: 12 }}>
            SKC: {row.skc_id || "-"} / SKU: {row.sku_id || "-"}
          </Text>
        </Space>
      ),
    },
    { title: "类型", dataIndex: "after_sale_type", key: "type", width: 130, render: (value) => value || "-" },
    { title: "状态", dataIndex: "status", key: "status", width: 130, render: (value) => <Tag color={statusColor(value)}>{value || "-"}</Tag> },
    { title: "原因", dataIndex: "reason", key: "reason", width: 200, ellipsis: true, render: (value) => value || "-" },
    { title: "数量", dataIndex: "quantity", key: "quantity", width: 90, render: formatNumber },
    { title: "金额", key: "amount", width: 130, render: (_value, row) => formatMoney(row.amount_cents, row.currency) },
    {
      title: "单号",
      key: "order",
      width: 220,
      render: (_value, row) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>订单 {row.order_id || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>包裹 {row.package_no || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "物流/仓库",
      key: "logistics",
      width: 200,
      render: (_value, row) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>{row.logistics_no || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.warehouse_name || "-"}</Text>
        </Space>
      ),
    },
    { title: "店铺", dataIndex: "mall_id", key: "mall", width: 150, render: (value) => value || "-" },
    {
      title: "更新时间",
      key: "updated",
      width: 180,
      render: (_value, row) => formatTime(row.updated_at_text || row.last_updated_at || row.first_seen_at),
    },
  ];

  const buyerSection = (
    <>
      {!cloudConfigured || cloudError ? (
        <Alert
          style={{ marginBottom: 12 }}
          type={cloudConfigured ? "warning" : "info"}
          showIcon
          message={cloudError || "还没有配置云端连接"}
        />
      ) : null}

      <Row gutter={[12, 12]} className="material-kpi-row" style={{ marginBottom: 12 }}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="售后记录" value={formatNumber(rows.length)} color="danger" icon={<CloudSyncOutlined />} compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="待处理" value={formatNumber(pendingCount)} color={pendingCount ? "danger" : "neutral"} compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="售后件数" value={formatNumber(totalQuantity)} color="blue" compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="售后金额" value={formatMoney(amountCents, amountCurrency)} color={amountCents ? "orange" : "neutral"} compact />
        </Col>
      </Row>

      <section className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">售后明细</div>
            <div className="app-panel__title-sub">按商品、订单、包裹、物流、售后类型或状态筛选。</div>
          </div>
        </div>

        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div className="material-filter-bar material-filter-bar--search">
            <Input.Search
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索商品 / 订单 / 包裹 / 物流 / SKC / SKU"
              enterButton="搜索"
              value={searchDraft}
              onChange={(event) => {
                const next = event.target.value;
                setSearchDraft(next);
                if (!next.trim()) setQuery("");
              }}
              onSearch={(value) => setQuery(value.trim())}
              style={{ maxWidth: 520 }}
            />
            <Select
              allowClear
              placeholder="售后类型"
              value={type || undefined}
              options={typeOptions}
              onChange={(value) => setType(value || "")}
              style={{ width: 180 }}
            />
            <Select
              allowClear
              placeholder="状态"
              value={status || undefined}
              options={statusOptions}
              onChange={(value) => setStatus(value || "")}
              style={{ width: 180 }}
            />
          </div>

          {summary.length > 0 ? (
            <Space wrap>
              {summary.slice(0, 16).map((item) => (
                <Tag key={`${item.after_sale_type || "after"}-${item.status || "status"}`} color={statusColor(item.status)}>
                  {item.after_sale_type || "售后"} {item.status || "未知"} {formatNumber(item.count)}条
                </Tag>
              ))}
            </Space>
          ) : null}

          <Table<TemuAfterSaleRow>
            className="erp-compact-table"
            rowKey={(row) => row.id || row.row_key}
            size="middle"
            loading={loading && !loadedOnce}
            columns={columns}
            dataSource={rows}
            scroll={{ x: 1750 }}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            locale={{
              emptyText: (
                <EmptyGuide
                  title={cloudConfigured ? "暂无售后记录" : "暂无云端售后数据"}
                  description={cloudConfigured ? "扩展采集到售后或退货接口后会显示在这里。" : "先配置云端连接或前往采集页检查扩展上报状态。"}
                  action={<Button type="primary" onClick={() => navigate("/collect")}>查看采集状态</Button>}
                />
              ),
            }}
          />
        </Space>
      </section>
    </>
  );

  return (
    <div>
      <PageHeader
        title="售后"
        subtitle="平台售后 / 送仓售后 / 采购退货 分三个 Tab 看。"
        eyebrow="运营"
        meta={[
          loadedAt ? `平台售后同步 ${formatTime(loadedAt)}` : "等待同步",
          cloudConfigured ? "云端已连接" : "云端未配置",
        ]}
        actions={[
          <Button key="collect" onClick={() => navigate("/collect")}>
            查看采集
          </Button>,
          <Button key="refresh" type="primary" icon={<ReloadOutlined />} loading={loading} onClick={() => void loadData(true)}>
            刷新平台售后
          </Button>,
        ]}
      />

      <Tabs
        defaultActiveKey="platform"
        items={[
          { key: "platform", label: "平台售后", children: buyerSection },
          { key: "consign", label: "送仓售后", children: <ConsignAfterSalesSection /> },
          { key: "purchase-return", label: "采购退货", children: <PurchaseReturnsSection /> },
        ]}
      />
    </div>
  );
}
