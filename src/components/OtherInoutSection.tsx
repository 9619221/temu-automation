import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Col, Drawer, Input, Row, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CloudSyncOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import EmptyGuide from "./EmptyGuide";
import StatCard from "./StatCard";

const { Paragraph, Text } = Typography;

interface OtherInoutRow {
  id: string;
  ioId: number;
  ioDate?: string | null;
  type?: string | null;
  status?: string | null;
  fStatus?: string | null;
  warehouse?: string | null;
  wmsCoName?: string | null;
  totalQty?: number | null;
  totalAmount?: number | null;
  totalCost?: number | null;
  reason?: string | null;
  creatorName?: string | null;
  archiverName?: string | null;
  archivedAt?: string | null;
  labels?: string | null;
  remark?: string | null;
  createdText?: string | null;
  modifiedText?: string | null;
  updatedAt?: string | null;
}

interface OtherInoutItemRow {
  id: string;
  ioId: number;
  seq: number;
  skuId?: string | null;
  iId?: string | null;
  name?: string | null;
  propertiesValue?: string | null;
  picUrl?: string | null;
  qty?: number | null;
  unit?: string | null;
  costPrice?: number | null;
  costAmount?: number | null;
  supplierName?: string | null;
  supplierIId?: string | null;
  supplierSkuId?: string | null;
  labels?: string | null;
  remark?: string | null;
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
  if (/作废|取消|关闭/.test(text)) return "red";
  if (/生效|完成/.test(text)) return "green";
  return "default";
}

function typeColor(value?: string | null) {
  const text = String(value || "").trim();
  if (/入库/.test(text)) return "blue";
  if (/出库/.test(text)) return "orange";
  if (/调拨/.test(text)) return "purple";
  return "default";
}

export default function OtherInoutSection() {
  const [rows, setRows] = useState<OtherInoutRow[]>([]);
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
  const [activeHead, setActiveHead] = useState<OtherInoutRow | null>(null);
  const [items, setItems] = useState<OtherInoutItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const requestIdRef = useRef(0);

  const loadData = useCallback(async (notify = false) => {
    if (!erp?.otherInout?.page) {
      setError("ERP 接口未就绪，请确认桌面端已登录");
      setLoadedOnce(true);
      return;
    }
    const id = requestIdRef.current + 1;
    requestIdRef.current = id;
    setLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      const result = await erp.otherInout.page({
        search: query || undefined,
        pageSize,
        page,
        limit: pageSize,
        offset,
      });
      if (id !== requestIdRef.current) return;
      setRows(Array.isArray(result?.rows) ? result.rows : []);
      setTotal(Number(result?.total || 0));
      setError(null);
      setLoadedAt(new Date().toISOString());
      setLoadedOnce(true);
      if (notify) message.success(`已同步 ${formatNumber(result?.rows?.length || 0)} 条其他出入库`);
    } catch (e: any) {
      if (id !== requestIdRef.current) return;
      setError(e?.message || "其他出入库读取失败");
      setLoadedOnce(true);
      if (notify) message.error(e?.message || "其他出入库读取失败");
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  }, [query, page, pageSize]);

  useEffect(() => { void loadData(); }, [loadData]);

  const openDrawer = useCallback(async (row: OtherInoutRow) => {
    setActiveHead(row);
    setDrawerOpen(true);
    if (!erp?.otherInout?.items) return;
    setItemsLoading(true);
    try {
      const list = await erp.otherInout.items({ ioId: row.ioId });
      setItems(Array.isArray(list) ? list : []);
    } catch (e: any) {
      message.error(e?.message || "明细读取失败");
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  }, []);

  const typeCount = useMemo(() => new Set(rows.map((r) => r.type).filter(Boolean)).size, [rows]);
  const totalQty = useMemo(() => rows.reduce((s, r) => s + Number(r.totalQty || 0), 0), [rows]);
  const totalAmount = useMemo(() => rows.reduce((s, r) => s + Number(r.totalAmount || 0), 0), [rows]);

  const columns: ColumnsType<OtherInoutRow> = [
    {
      title: "出入库单号",
      key: "io_id",
      width: 130,
      render: (_v, row) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontWeight: 600 }}>{row.ioId}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{formatTime(row.ioDate)}</Text>
        </Space>
      ),
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: 110,
      render: (v) => <Tag color={typeColor(v)}>{v || "-"}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (v) => <Tag color={statusColor(v)}>{v || "-"}</Tag>,
    },
    {
      title: "仓库",
      key: "warehouse",
      width: 200,
      render: (_v, row) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>{row.warehouse || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.wmsCoName || ""}</Text>
        </Space>
      ),
    },
    {
      title: "总数量",
      dataIndex: "totalQty",
      key: "totalQty",
      width: 100,
      align: "right",
      render: (v) => formatNumber(v),
    },
    {
      title: "总金额",
      dataIndex: "totalAmount",
      key: "totalAmount",
      width: 130,
      align: "right",
      render: (v) => formatMoney(v),
    },
    {
      title: "制单人",
      dataIndex: "creatorName",
      key: "creatorName",
      width: 110,
      render: (v) => v || "-",
    },
    {
      title: "原因",
      dataIndex: "reason",
      key: "reason",
      width: 160,
      ellipsis: true,
      render: (v) => v || "-",
    },
    {
      title: "标签",
      dataIndex: "labels",
      key: "labels",
      width: 100,
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

  const itemColumns: ColumnsType<OtherInoutItemRow> = [
    {
      title: "商品",
      key: "product",
      width: 320,
      render: (_v, row) => (
        <Space size={8} align="start">
          {row.picUrl ? <img src={row.picUrl} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4 }} /> : null}
          <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
            <Paragraph ellipsis={{ rows: 2, tooltip: row.name || "-" }} style={{ marginBottom: 0, fontWeight: 600, lineHeight: 1.3 }}>
              {row.name || "-"}
            </Paragraph>
            <Text type="secondary" style={{ fontSize: 12 }}>
              货号 {row.iId || "-"} / SKU {row.skuId || "-"}
            </Text>
          </Space>
        </Space>
      ),
    },
    { title: "规格", dataIndex: "propertiesValue", key: "spec", width: 180, render: (v) => v || "-" },
    { title: "数量", dataIndex: "qty", key: "qty", width: 90, align: "right", render: (v) => formatNumber(v) },
    { title: "成本单价", dataIndex: "costPrice", key: "costPrice", width: 110, align: "right", render: (v) => formatMoney(v) },
    { title: "成本金额", dataIndex: "costAmount", key: "costAmount", width: 130, align: "right", render: (v) => formatMoney(v) },
    { title: "供应商", dataIndex: "supplierName", key: "supplierName", width: 180, render: (v) => v || "-" },
    { title: "标签", dataIndex: "labels", key: "labels", width: 100, render: (v) => v || "-" },
    { title: "备注", dataIndex: "remark", key: "remark", ellipsis: true, render: (v) => v || "-" },
  ];

  return (
    <div>
      {error ? (
        <Alert style={{ marginBottom: 12 }} type="warning" showIcon message={error} />
      ) : null}

      <Row gutter={[12, 12]} className="material-kpi-row" style={{ marginBottom: 12 }}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="本页单数" value={formatNumber(rows.length)} color="brand" icon={<CloudSyncOutlined />} compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="累计单数" value={formatNumber(total)} color="neutral" compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="本页总数量" value={formatNumber(totalQty)} color="blue" compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="本页总金额" value={formatMoney(totalAmount)} color={totalAmount ? "orange" : "neutral"} compact />
        </Col>
      </Row>

      <section className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">其他出入库明细</div>
            <div className="app-panel__title-sub">
              历史台账来自聚水潭导入。本页 {formatNumber(rows.length)} / 累计 {formatNumber(total)} 条；涉及类型 {formatNumber(typeCount)}。
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
              placeholder="搜索单号 / 类型 / 仓库 / 原因 / 制单人 / 标签 / 备注"
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

          <Table<OtherInoutRow>
            className="erp-compact-table"
            rowKey="id"
            size="middle"
            loading={loading && !loadedOnce}
            columns={columns}
            dataSource={rows}
            scroll={{ x: 1400 }}
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
                  title="暂无其他出入库记录"
                  description="确认聚水潭历史数据已导入服务器 erp.sqlite（运行 scripts/import-inout-detail.py 或对应导入脚本）。"
                />
              ),
            }}
          />
        </Space>
      </section>

      <Drawer
        title={activeHead ? `出入库单 ${activeHead.ioId} · ${activeHead.type || "-"}` : "出入库明细"}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={960}
      >
        {activeHead ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Row gutter={[12, 12]}>
              <Col xs={12} sm={6}><Text type="secondary">业务时间</Text><div>{formatTime(activeHead.ioDate)}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">类型</Text><div><Tag color={typeColor(activeHead.type)}>{activeHead.type || "-"}</Tag></div></Col>
              <Col xs={12} sm={6}><Text type="secondary">状态</Text><div><Tag color={statusColor(activeHead.status)}>{activeHead.status || "-"}</Tag></div></Col>
              <Col xs={12} sm={6}><Text type="secondary">财务状态</Text><div>{activeHead.fStatus || "-"}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">仓库</Text><div>{activeHead.warehouse || "-"}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">制单人</Text><div>{activeHead.creatorName || "-"}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">归档人</Text><div>{activeHead.archiverName || "-"}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">归档时间</Text><div>{formatTime(activeHead.archivedAt)}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">原因</Text><div>{activeHead.reason || "-"}</div></Col>
              <Col xs={12} sm={6}><Text type="secondary">标签</Text><div>{activeHead.labels || "-"}</div></Col>
              <Col xs={24}><Text type="secondary">备注</Text><div>{activeHead.remark || "-"}</div></Col>
            </Row>

            <Table<OtherInoutItemRow>
              className="erp-compact-table"
              rowKey="id"
              size="middle"
              loading={itemsLoading}
              columns={itemColumns}
              dataSource={items}
              scroll={{ x: 1200 }}
              pagination={{ pageSize: 20, showSizeChanger: true }}
            />
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
