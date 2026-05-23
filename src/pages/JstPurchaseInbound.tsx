import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, DatePicker, Empty, Image, Input, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DatabaseOutlined, InboxOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import {
  fetchJstPurchaseInbound,
  loadCloudConfig,
  type CloudConsoleConfig,
  type JstPurchaseInboundOption,
  type JstPurchaseInboundResponse,
  type JstPurchaseInboundRow,
} from "../utils/cloudClient";

const { RangePicker } = DatePicker;
const { Paragraph, Text } = Typography;

const currencyFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
});

const qtyFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const time = Date.parse(String(value).replace(" ", "T"));
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleString("zh-CN", { hour12: false });
}

function formatCurrency(value?: number | null) {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  return currencyFormatter.format(Number(value));
}

function formatQty(value?: number | null) {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  return qtyFormatter.format(Number(value));
}

function statusTag(value?: string | null) {
  if (!value) return <Text type="secondary">-</Text>;
  const color = value.includes("入库") ? "green" : value.includes("审核") ? "blue" : "default";
  return <Tag color={color}>{value}</Tag>;
}

function optionLabel(option: JstPurchaseInboundOption) {
  return `${option.value} ${option.count}`;
}

export default function JstPurchaseInbound() {
  const [cfg, setCfg] = useState<CloudConsoleConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<JstPurchaseInboundResponse>({
    rows: [],
    total: 0,
    limit: 50,
    offset: 0,
    summary: { line_count: 0, receipt_count: 0, total_qty: 0, total_amount: 0 },
    options: { accounts: [], statuses: [], suppliers: [] },
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filters, setFilters] = useState({
    q: "",
    accountName: "",
    supplier: "",
    status: "",
    dateRange: null as any,
  });
  const [query, setQuery] = useState(filters);

  const refresh = useCallback(async (silent = false) => {
    const nextCfg = cfg || await loadCloudConfig();
    setCfg(nextCfg);
    if (!nextCfg) {
      setError("还没有配置云端连接，请先在云端采集页登录或保存云端地址。");
      return;
    }
    if (!silent) setLoading(true);
    setError("");
    try {
      const dateRange = query.dateRange;
      const payload = await fetchJstPurchaseInbound(nextCfg, {
        q: query.q.trim(),
        account_name: query.accountName,
        supplier: query.supplier.trim(),
        status: query.status,
        date_from: dateRange?.[0] ? dayjs(dateRange[0]).format("YYYY-MM-DD") : "",
        date_to: dateRange?.[1] ? dayjs(dateRange[1]).format("YYYY-MM-DD") : "",
        limit: pageSize,
        offset: Math.max(0, page - 1) * pageSize,
      });
      setData(payload);
    } catch (err: any) {
      setError(err?.message || "聚水潭入库单读取失败");
      message.error(err?.message || "聚水潭入库单读取失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [cfg, page, pageSize, query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const accountOptions = useMemo(() => data.options.accounts.map((item) => ({
    label: optionLabel(item),
    value: item.value,
  })), [data.options.accounts]);

  const statusOptions = useMemo(() => data.options.statuses.map((item) => ({
    label: optionLabel(item),
    value: item.value,
  })), [data.options.statuses]);

  const columns = useMemo<ColumnsType<JstPurchaseInboundRow>>(() => [
    {
      title: "入库日期",
      dataIndex: "inbound_at",
      width: 160,
      fixed: "left",
      render: formatDateTime,
    },
    {
      title: "入仓单号",
      dataIndex: "receipt_no",
      width: 120,
      fixed: "left",
      render: (value) => <Text strong>{value || "-"}</Text>,
    },
    {
      title: "采购单号",
      dataIndex: "purchase_no",
      width: 120,
      render: (value) => value || "-",
    },
    {
      title: "店铺",
      dataIndex: "account_name",
      width: 110,
      render: (value) => value || "-",
    },
    {
      title: "供应商",
      dataIndex: "supplier_name",
      width: 170,
      ellipsis: true,
      render: (value) => value || "-",
    },
    {
      title: "商品",
      key: "product",
      width: 330,
      render: (_value, row) => (
        <Space size={10} align="start">
          {row.image_url ? (
            <Image
              src={row.image_url}
              width={46}
              height={46}
              preview={false}
              style={{ objectFit: "cover", borderRadius: 6, border: "1px solid #e5e7eb" }}
            />
          ) : (
            <div style={{ width: 46, height: 46, borderRadius: 6, border: "1px solid #e5e7eb", background: "#f8fafc" }} />
          )}
          <Space direction="vertical" size={2}>
            <Text strong>{row.sku_code || "-"}</Text>
            <Paragraph
              ellipsis={{ rows: 2, tooltip: row.product_name || "-" }}
              style={{ marginBottom: 0, maxWidth: 250, lineHeight: 1.45 }}
            >
              {row.product_name || "-"}
            </Paragraph>
            {row.color_spec ? <Text type="secondary" style={{ fontSize: 12 }}>{row.color_spec}</Text> : null}
          </Space>
        </Space>
      ),
    },
    {
      title: "数量",
      dataIndex: "qty",
      width: 90,
      align: "right",
      render: formatQty,
    },
    {
      title: "商品金额",
      dataIndex: "amount",
      width: 110,
      align: "right",
      render: formatCurrency,
    },
    {
      title: "运费",
      dataIndex: "order_freight_amount",
      width: 100,
      align: "right",
      render: formatCurrency,
    },
    {
      title: "实付总金额",
      dataIndex: "order_paid_amount",
      width: 120,
      align: "right",
      render: formatCurrency,
    },
    {
      title: "入库状态",
      dataIndex: "status",
      width: 110,
      render: statusTag,
    },
    {
      title: "财审",
      dataIndex: "finance_status",
      width: 100,
      render: statusTag,
    },
    {
      title: "仓库",
      dataIndex: "warehouse_name",
      width: 220,
      ellipsis: true,
      render: (value) => value || "-",
    },
    {
      title: "采购员",
      dataIndex: "purchaser_name",
      width: 120,
      render: (value) => value || "-",
    },
    {
      title: "物流",
      key: "logistics",
      width: 190,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.logistics_company || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.tracking_no || "-"}</Text>
        </Space>
      ),
    },
  ], []);

  const applyFilters = () => {
    setPage(1);
    setQuery(filters);
  };

  const resetFilters = () => {
    const empty = { q: "", accountName: "", supplier: "", status: "", dateRange: null as any };
    setPage(1);
    setFilters(empty);
    setQuery(empty);
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <PageHeader
        eyebrow="数据"
        title="聚水潭入库"
        subtitle="按桌面商品文件夹里的最新聚水潭导出接入云端，展示入仓单明细、店铺、商品金额、运费和实付总金额。"
        meta={[
          `入仓单 ${formatQty(data.summary.receipt_count)}`,
          `明细 ${formatQty(data.summary.line_count)}`,
        ]}
        actions={(
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>
            刷新
          </Button>
        )}
      />

      {error ? <Alert type="warning" showIcon message={error} /> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <StatCard compact title="入仓单" value={data.summary.receipt_count || 0} icon={<InboxOutlined />} color="brand" />
        <StatCard compact title="明细行" value={data.summary.line_count || 0} icon={<DatabaseOutlined />} color="blue" />
        <StatCard compact title="入库数量" value={formatQty(data.summary.total_qty)} icon={<InboxOutlined />} color="success" />
        <StatCard compact title="商品金额" value={formatCurrency(data.summary.total_amount)} icon={<DatabaseOutlined />} color="purple" />
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">入库明细</div>
            <div className="app-panel__title-sub">当前筛选共 {formatQty(data.total)} 行，分页不会截断总数据。</div>
          </div>
        </div>
        <Space size={[10, 10]} wrap style={{ marginBottom: 12 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索入仓单 / 采购单 / 商品 / 供应商 / 物流单号"
            value={filters.q}
            onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
            onPressEnter={applyFilters}
            style={{ width: 330 }}
          />
          <RangePicker
            value={filters.dateRange}
            onChange={(value) => setFilters((prev) => ({ ...prev, dateRange: value }))}
            allowClear
            placeholder={["入库开始", "入库结束"]}
            style={{ width: 250 }}
          />
          <Select
            allowClear
            showSearch
            placeholder="店铺"
            value={filters.accountName || undefined}
            optionFilterProp="label"
            options={accountOptions}
            onChange={(value) => setFilters((prev) => ({ ...prev, accountName: value || "" }))}
            style={{ width: 150 }}
          />
          <Input
            allowClear
            placeholder="供应商"
            value={filters.supplier}
            onChange={(event) => setFilters((prev) => ({ ...prev, supplier: event.target.value }))}
            onPressEnter={applyFilters}
            style={{ width: 160 }}
          />
          <Select
            allowClear
            placeholder="入库状态"
            value={filters.status || undefined}
            options={statusOptions}
            onChange={(value) => setFilters((prev) => ({ ...prev, status: value || "" }))}
            style={{ width: 140 }}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={applyFilters}>
            查询
          </Button>
          <Button onClick={resetFilters}>
            重置
          </Button>
        </Space>

        <Table
          rowKey="line_id"
          loading={loading}
          size="small"
          className="erp-compact-table"
          columns={columns}
          dataSource={data.rows}
          scroll={{ x: 2320 }}
          locale={{ emptyText: <Empty description="暂无入库数据" /> }}
          pagination={{
            current: page,
            pageSize,
            total: data.total,
            showSizeChanger: true,
            pageSizeOptions: [25, 50, 100, 200],
            showTotal: (total, range) => `显示 ${range[0]}-${range[1]} / ${total} 条`,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              if (nextPageSize !== pageSize) {
                setPage(1);
                setPageSize(nextPageSize);
              }
            },
          }}
        />
      </div>
    </Space>
  );
}
