import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Col, Drawer, Input, Row, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CloudSyncOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import EmptyGuide from "./EmptyGuide";
import StatCard from "./StatCard";

const { Paragraph, Text } = Typography;

interface ConsignAfterSaleRow {
  id: string;
  asId: number;
  outerAsId?: string | null;
  asDate?: string | null;
  shopType?: string | null;
  type?: string | null;
  status?: string | null;
  shopStatus?: string | null;
  shopName?: string | null;
  shopSite?: string | null;
  warehouse?: string | null;
  refundQty?: number | null;
  rQty?: number | null;
  boxIdCount?: number | null;
  totalAmount?: number | null;
  refundTotalAmount?: number | null;
  logisticsCompany?: string | null;
  lId?: string | null;
  oId?: string | null;
  soId?: string | null;
  labels?: string | null;
  remark?: string | null;
  receiverName?: string | null;
  receiverMobile?: string | null;
  creatorName?: string | null;
  confirmDate?: string | null;
  createdText?: string | null;
  modifiedText?: string | null;
}

interface ConsignAfterSaleItemRow {
  id: string;
  asId: number;
  asiId: number;
  outerAsId?: string | null;
  shopName?: string | null;
  skuId?: string | null;
  iId?: string | null;
  productName?: string | null;
  propertiesValue?: string | null;
  picUrl?: string | null;
  qty?: number | null;
  rQty?: number | null;
  defectiveQty?: number | null;
  price?: number | null;
  amount?: number | null;
  refundAmount?: number | null;
  supplierName?: string | null;
  type?: string | null;
  des?: string | null;
  outerOiId?: string | null;
  temuBillIds?: string | null;
  temuHasFlaw?: number | null;
  temuSoId?: string | null;
  boxId?: string | null;
  itemLabels?: string | null;
}

const erp = (window as any).electronAPI?.erp;

function formatNumber(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toLocaleString("zh-CN");
}

function formatMoney(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${num.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CNY`;
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const text = String(value).trim();
  if (!text) return "-";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString("zh-CN");
}

function statusColor(value?: string | null) {
  const text = String(value || "").trim();
  if (/作废|取消|关闭|驳回/.test(text)) return "red";
  if (/完成|已确认|已签收|已入库|已收货/.test(text)) return "green";
  if (/待|等待|处理中|审核|发货/.test(text)) return "orange";
  return "default";
}

function parseReasons(des?: string | null) {
  if (!des) return "";
  const text = String(des).trim();
  if (!text) return "";
  try {
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) return arr.join("；");
  } catch { /* fallthrough */ }
  return text;
}

export default function ConsignAfterSalesSection() {
  const [rows, setRows] = useState<ConsignAfterSaleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeHead, setActiveHead] = useState<ConsignAfterSaleRow | null>(null);
  const [items, setItems] = useState<ConsignAfterSaleItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const requestIdRef = useRef(0);

  const loadData = useCallback(async (notify = false) => {
    if (!erp?.consignAfterSale?.page) {
      setError("ERP 接口未就绪，请确认桌面端已登录");
      setLoadedOnce(true);
      return;
    }
    const id = requestIdRef.current + 1;
    requestIdRef.current = id;
    setLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      const result = await erp.consignAfterSale.page({
        q: query || undefined,
        limit: pageSize,
        offset,
      });
      if (id !== requestIdRef.current) return;
      setRows(Array.isArray(result?.rows) ? result.rows : []);
      setTotal(Number(result?.total || 0));
      setError(null);
      setLoadedAt(new Date().toISOString());
      setLoadedOnce(true);
      if (notify) message.success(`已同步 ${formatNumber(result?.rows?.length || 0)} 条送仓售后`);
    } catch (e: any) {
      if (id !== requestIdRef.current) return;
      setError(e?.message || "送仓售后读取失败");
      setLoadedOnce(true);
      if (notify) message.error(e?.message || "送仓售后读取失败");
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  }, [query, page, pageSize]);

  useEffect(() => { void loadData(); }, [loadData]);

  const openDrawer = useCallback(async (row: ConsignAfterSaleRow) => {
    setActiveHead(row);
    setDrawerOpen(true);
    if (!erp?.consignAfterSale?.items) return;
    setItemsLoading(true);
    try {
      const list = await erp.consignAfterSale.items({ asId: row.asId });
      setItems(Array.isArray(list) ? list : []);
    } catch (e: any) {
      message.error(e?.message || "明细读取失败");
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  }, []);

  const shopCount = useMemo(() => new Set(rows.map((r) => r.shopName).filter(Boolean)).size, [rows]);
  const totalRefundQty = useMemo(() => rows.reduce((s, r) => s + Number(r.refundQty || 0), 0), [rows]);
  const pendingCount = useMemo(() => rows.filter((r) => statusColor(r.status) !== "green").length, [rows]);

  const columns: ColumnsType<ConsignAfterSaleRow> = [
    {
      title: "售后单号",
      key: "as_id",
      width: 200,
      render: (_v, row) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontWeight: 600, fontSize: 12 }}>{row.asId}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{row.outerAsId || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "店铺",
      dataIndex: "shopName",
      key: "shopName",
      width: 140,
      render: (v) => v || "-",
    },
    {
      title: "退货时间",
      dataIndex: "asDate",
      key: "asDate",
      width: 160,
      render: (v) => formatTime(v),
    },
    {
      title: "退货数量",
      key: "refundQty",
      width: 100,
      align: "right",
      render: (_v, row) => (
        <Space direction="vertical" size={0}>
          <Text>{formatNumber(row.refundQty)}</Text>
          {row.rQty && row.rQty > 0 ? (
            <Text type="secondary" style={{ fontSize: 11 }}>实退 {formatNumber(row.rQty)}</Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "包裹数",
      dataIndex: "boxIdCount",
      key: "boxIdCount",
      width: 80,
      align: "right",
      render: (v) => formatNumber(v),
    },
    {
      title: "内部状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (v) => <Tag color={statusColor(v)}>{v || "-"}</Tag>,
    },
    {
      title: "平台状态",
      dataIndex: "shopStatus",
      key: "shopStatus",
      width: 130,
      render: (v) => <Tag color={statusColor(v)}>{v || "-"}</Tag>,
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: 100,
      render: (v) => v || "-",
    },
    {
      title: "物流单号",
      dataIndex: "lId",
      key: "lId",
      width: 160,
      render: (v) => v || "-",
    },
    {
      title: "送仓",
      dataIndex: "receiverName",
      key: "receiverName",
      width: 140,
      ellipsis: true,
      render: (v) => v || "-",
    },
    {
      title: "备注",
      dataIndex: "remark",
      key: "remark",
      ellipsis: true,
      render: (v) => v || "-",
    },
  ];

  const itemColumns: ColumnsType<ConsignAfterSaleItemRow> = [
    {
      title: "商品",
      key: "product",
      width: 320,
      render: (_v, row) => (
        <Space size={8} align="start">
          {row.picUrl ? <img src={row.picUrl} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4 }} /> : null}
          <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
            <Paragraph ellipsis={{ rows: 2, tooltip: row.productName || "-" }} style={{ marginBottom: 0, fontWeight: 600, lineHeight: 1.3 }}>
              {row.productName || "-"}
            </Paragraph>
            <Text type="secondary" style={{ fontSize: 12 }}>货号 {row.iId || "-"} / SKU {row.skuId || "-"}</Text>
          </Space>
        </Space>
      ),
    },
    { title: "规格", dataIndex: "propertiesValue", key: "spec", width: 160, render: (v) => v || "-" },
    {
      title: "数量",
      key: "qty",
      width: 100,
      align: "right",
      render: (_v, row) => (
        <Space direction="vertical" size={0}>
          <Text>{formatNumber(row.qty)}</Text>
          {row.rQty && row.rQty > 0 ? <Text type="secondary" style={{ fontSize: 11 }}>实 {formatNumber(row.rQty)}</Text> : null}
        </Space>
      ),
    },
    { title: "退款", dataIndex: "refundAmount", key: "refundAmount", width: 110, align: "right", render: (v) => formatMoney(v) },
    { title: "供应商", dataIndex: "supplierName", key: "supplierName", width: 140, render: (v) => v || "-" },
    {
      title: "Temu 单号",
      key: "temu",
      width: 200,
      render: (_v, row) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>{row.temuSoId || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>账单 {row.temuBillIds || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "原因",
      dataIndex: "des",
      key: "des",
      ellipsis: true,
      render: (v) => parseReasons(v) || "-",
    },
  ];

  return (
    <div>
      {error ? (
        <Alert style={{ marginBottom: 12 }} type="warning" showIcon message={error} />
      ) : null}

      <Row gutter={[12, 12]} className="material-kpi-row" style={{ marginBottom: 12 }}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="本页售后单" value={formatNumber(rows.length)} color="danger" icon={<CloudSyncOutlined />} compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="累计单数" value={formatNumber(total)} color="neutral" compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="本页未完成" value={formatNumber(pendingCount)} color={pendingCount ? "orange" : "neutral"} compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="本页退货件" value={formatNumber(totalRefundQty)} color="blue" compact />
        </Col>
      </Row>

      <section className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">送仓售后明细</div>
            <div className="app-panel__title-sub">
              半托管送仓历史台账来自聚水潭导入。本页 {formatNumber(rows.length)} / 累计 {formatNumber(total)} 条；涉及店铺 {formatNumber(shopCount)}。
              {loadedAt ? ` 同步 ${formatTime(loadedAt)}` : ""}
            </div>
          </div>
          <div>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadData(true)}>刷新</Button>
          </div>
        </div>

        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div className="material-filter-bar material-filter-bar--search">
            <Input.Search
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索店铺 / 售后单号 / 外部单号 / 物流单号 / 备注"
              enterButton="搜索"
              value={searchDraft}
              onChange={(e) => {
                const next = e.target.value;
                setSearchDraft(next);
                if (!next.trim()) { setQuery(""); setPage(1); }
              }}
              onSearch={(value) => { setQuery(value.trim()); setPage(1); }}
              style={{ maxWidth: 520 }}
            />
          </div>

          <Table<ConsignAfterSaleRow>
            className="erp-compact-table"
            rowKey="id"
            size="middle"
            loading={loading && !loadedOnce}
            columns={columns}
            dataSource={rows}
            scroll={{ x: 1700 }}
            onRow={(row) => ({ onClick: () => openDrawer(row), style: { cursor: "pointer" } })}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              showTotal: (t) => `共 ${formatNumber(t)} 条`,
              onChange: (p, s) => { setPage(p); setPageSize(s); },
            }}
            locale={{
              emptyText: (
                <EmptyGuide
                  title="暂无送仓售后记录"
                  description="确认聚水潭历史数据已导入服务器 erp.sqlite（运行 scripts/jushuitan-aftersale-consign-import.cjs）。"
                />
              ),
            }}
          />
        </Space>
      </section>

      <Drawer
        title={activeHead ? `送仓售后 ${activeHead.asId} · ${activeHead.shopName || "-"}` : "送仓售后明细"}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={1100}
      >
        {activeHead ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Row gutter={[12, 12]}>
              <Col xs={12} sm={6}><Text type="secondary">外部单号</Text><div>{activeHead.outerAsId || "-"}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">退货时间</Text><div>{formatTime(activeHead.asDate)}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">内部状态</Text><div><Tag color={statusColor(activeHead.status)}>{activeHead.status || "-"}</Tag></div></Col>
              <Col xs={12} sm={6}><Text type="secondary">平台状态</Text><div><Tag color={statusColor(activeHead.shopStatus)}>{activeHead.shopStatus || "-"}</Tag></div></Col>
              <Col xs={12} sm={6}><Text type="secondary">类型</Text><div>{activeHead.type || "-"}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">仓库</Text><div>{activeHead.warehouse || "-"}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">送仓收货人</Text><div>{activeHead.receiverName || "-"}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">收货电话</Text><div>{activeHead.receiverMobile || "-"}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">物流单号</Text><div>{activeHead.lId || "-"}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">网店订单</Text><div>{activeHead.soId || "-"}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">标签</Text><div>{activeHead.labels || "-"}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">确认时间</Text><div>{formatTime(activeHead.confirmDate)}</div></Col>
              <Col xs={24}><Text type="secondary">备注</Text><div>{activeHead.remark || "-"}</div></Col>
            </Row>

            <Table<ConsignAfterSaleItemRow>
              className="erp-compact-table"
              rowKey="id"
              size="middle"
              loading={itemsLoading}
              columns={itemColumns}
              dataSource={items}
              scroll={{ x: 1300 }}
              pagination={{ pageSize: 20, showSizeChanger: true }}
            />
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
