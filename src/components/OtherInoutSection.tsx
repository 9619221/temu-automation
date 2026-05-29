import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Col, Image, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CloudSyncOutlined, EyeOutlined, ReloadOutlined, SearchOutlined, SwapOutlined } from "@ant-design/icons";
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

interface SkuOpt {
  id: string;
  internalSkuCode?: string | null;
  name?: string | null;
  accountName?: string | null;
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
  // 单行展开（accordion）：一次只看一单，跟原 Drawer 行为一致
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [items, setItems] = useState<OtherInoutItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const requestIdRef = useRef(0);

  // 商品编码换货（只动库存不留单）：编码 A 减、编码 B 加，店铺跟着 SKU 走
  const [xferOpen, setXferOpen] = useState(false);
  const [xferSubmitting, setXferSubmitting] = useState(false);
  const [fromSkuId, setFromSkuId] = useState<string | undefined>(undefined);
  const [fromQty, setFromQty] = useState<number | null>(null);
  const [fromUnitCost, setFromUnitCost] = useState<number | null>(null);
  const [fromAmount, setFromAmount] = useState<number | null>(null);
  const [fromSkuSearch, setFromSkuSearch] = useState("");
  const [fromSkuOptions, setFromSkuOptions] = useState<SkuOpt[]>([]);
  const [fromSkuLoading, setFromSkuLoading] = useState(false);
  const [toSkuId, setToSkuId] = useState<string | undefined>(undefined);
  const [toQty, setToQty] = useState<number | null>(null);
  const [toSkuSearch, setToSkuSearch] = useState("");
  const [toSkuOptions, setToSkuOptions] = useState<SkuOpt[]>([]);
  const [toSkuLoading, setToSkuLoading] = useState(false);

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

  const toggleExpand = useCallback(async (row: OtherInoutRow) => {
    if (expandedId === row.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(row.id);
    setItems([]);
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
  }, [expandedId]);

  const typeCount = useMemo(() => new Set(rows.map((r) => r.type).filter(Boolean)).size, [rows]);
  const totalQty = useMemo(() => rows.reduce((s, r) => s + Number(r.totalQty || 0), 0), [rows]);
  const totalAmount = useMemo(() => rows.reduce((s, r) => s + Number(r.totalAmount || 0), 0), [rows]);

  const columns: ColumnsType<OtherInoutRow> = [
    {
      title: "出入库单号",
      key: "io_id",
      width: 120,
      render: (_v, row) => <Text style={{ fontWeight: 600 }}>{row.ioId}</Text>,
    },
    {
      title: "业务时间",
      dataIndex: "ioDate",
      key: "ioDate",
      width: 160,
      render: (v) => formatTime(v),
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
      width: 280,
      render: (_v, row) => (
        <Space size={8} align="start">
          {row.picUrl ? (
            <Image
              src={row.picUrl}
              alt=""
              width={40}
              height={40}
              style={{ objectFit: "cover", borderRadius: 4, cursor: "zoom-in" }}
              preview={{ mask: <EyeOutlined /> }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
          <Paragraph ellipsis={{ rows: 2, tooltip: row.name || "-" }} style={{ marginBottom: 0, fontWeight: 600, lineHeight: 1.3, minWidth: 0 }}>
            {row.name || "-"}
          </Paragraph>
        </Space>
      ),
    },
    {
      title: "货号 / SKU",
      key: "iidSku",
      width: 160,
      render: (_v, row) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>货号 {row.iId || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>SKU {row.skuId || "-"}</Text>
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

  // 换出编码 A 的 SKU 搜索（防抖）
  useEffect(() => {
    if (!xferOpen) return;
    const q = fromSkuSearch.trim();
    const handle = setTimeout(() => {
      if (!erp?.sku?.list) return;
      setFromSkuLoading(true);
      erp.sku.list({ q: q || undefined, search: q || undefined, limit: 50 })
        .then((list: any) => setFromSkuOptions(Array.isArray(list) ? list.slice(0, 50) : []))
        .catch(() => setFromSkuOptions([]))
        .finally(() => setFromSkuLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [fromSkuSearch, xferOpen]);

  // 换入编码 B 的 SKU 搜索（防抖）
  useEffect(() => {
    if (!xferOpen) return;
    const q = toSkuSearch.trim();
    const handle = setTimeout(() => {
      if (!erp?.sku?.list) return;
      setToSkuLoading(true);
      erp.sku.list({ q: q || undefined, search: q || undefined, limit: 50 })
        .then((list: any) => setToSkuOptions(Array.isArray(list) ? list.slice(0, 50) : []))
        .catch(() => setToSkuOptions([]))
        .finally(() => setToSkuLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [toSkuSearch, xferOpen]);

  const openXfer = () => {
    setFromSkuId(undefined);
    setFromQty(null);
    setFromUnitCost(null);
    setFromAmount(null);
    setFromSkuSearch("");
    setFromSkuOptions([]);
    setToSkuId(undefined);
    setToQty(null);
    setToSkuSearch("");
    setToSkuOptions([]);
    setXferOpen(true);
  };

  const round2 = (n: number) => Math.round(n * 100) / 100;

  // 换出 A 的 数量 / 单价 / 总额 三者联动：总额 = 单价 × 数量
  const onFromQtyChange = (v: number | null) => {
    setFromQty(v);
    if (v != null && fromUnitCost != null) setFromAmount(round2(fromUnitCost * v));
  };
  const onFromUnitCostChange = (v: number | null) => {
    setFromUnitCost(v);
    if (v != null && fromQty != null) setFromAmount(round2(v * fromQty));
  };
  const onFromAmountChange = (v: number | null) => {
    setFromAmount(v);
    if (v != null && fromQty != null && fromQty > 0) setFromUnitCost(round2(v / fromQty));
  };

  const skuOptionLabel = (s: SkuOpt) =>
    `${s.internalSkuCode || s.id}${s.name ? ` · ${s.name}` : ""}${s.accountName ? `（${s.accountName}）` : ""}`;

  const submitXfer = async () => {
    if (!erp?.inventory?.action) { message.error("ERP 接口未就绪"); return; }
    if (!fromSkuId) { message.error("请选择换出商品编码（A）"); return; }
    if (!toSkuId) { message.error("请选择换入商品编码（B）"); return; }
    if (fromSkuId === toSkuId) { message.error("换出和换入不能是同一个编码"); return; }
    const fq = Number(fromQty);
    const tq = Number(toQty);
    const fa = Number(fromAmount);
    if (!Number.isFinite(fq) || fq <= 0) { message.error("换出数量必须大于 0"); return; }
    if (!Number.isFinite(tq) || tq <= 0) { message.error("换入数量必须大于 0"); return; }
    if (!Number.isFinite(fa) || fa < 0) { message.error("请填写换出单价或总额"); return; }
    setXferSubmitting(true);
    try {
      await erp.inventory.action({
        action: "swap_sku",
        fromSkuId,
        fromQty: fq,
        toSkuId,
        toQty: tq,
        fromAmount: fa,
      });
      message.success(`换货成功：编码 A 减 ${fq} 件（货值 ${fa}），编码 B 加 ${tq} 件`);
      setXferOpen(false);
    } catch (e: any) {
      message.error(e?.message || "换货失败");
    } finally {
      setXferSubmitting(false);
    }
  };

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
              历史台账来自导入。本页 {formatNumber(rows.length)} / 累计 {formatNumber(total)} 条；涉及类型 {formatNumber(typeCount)}。
              {loadedAt ? ` 同步 ${formatTime(loadedAt)}` : ""}
            </div>
          </div>
          <div>
            <Space>
              <Button type="primary" icon={<SwapOutlined />} onClick={openXfer}>新建换货</Button>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadData(true)}>刷新</Button>
            </Space>
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
            onRow={(row) => ({ onClick: () => void toggleExpand(row), style: { cursor: "pointer" } })}
            expandable={{
              expandedRowKeys: expandedId ? [expandedId] : [],
              showExpandColumn: false,
              rowExpandable: () => true,
              expandedRowRender: (row) => (
                <div style={{ padding: "8px 4px" }}>
                  <Row gutter={[12, 8]} style={{ marginBottom: 12 }}>
                    <Col xs={12} sm={6}><Text type="secondary">业务时间</Text><div>{formatTime(row.ioDate)}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">类型</Text><div><Tag color={typeColor(row.type)}>{row.type || "-"}</Tag></div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">状态</Text><div><Tag color={statusColor(row.status)}>{row.status || "-"}</Tag></div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">财务状态</Text><div>{row.fStatus || "-"}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">仓库</Text><div>{row.warehouse || "-"}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">制单人</Text><div>{row.creatorName || "-"}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">归档人</Text><div>{row.archiverName || "-"}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">归档时间</Text><div>{formatTime(row.archivedAt)}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">原因</Text><div>{row.reason || "-"}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">标签</Text><div>{row.labels || "-"}</div></Col>
                    {row.remark ? <Col xs={24}><Text type="secondary">备注</Text><div>{row.remark}</div></Col> : null}
                  </Row>

                  <Table<OtherInoutItemRow>
                    className="erp-compact-table"
                    rowKey="id"
                    size="small"
                    loading={itemsLoading}
                    columns={itemColumns}
                    dataSource={items}
                    scroll={{ x: 1200 }}
                    pagination={false}
                  />
                </div>
              ),
            }}
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
                  description="确认历史数据已导入服务器 erp.sqlite（运行 scripts/import-inout-detail.py 或对应导入脚本）。"
                />
              ),
            }}
          />
        </Space>
      </section>

      <Modal
        title="新建换货（商品编码之间调拨库存）"
        open={xferOpen}
        onCancel={() => setXferOpen(false)}
        onOk={() => void submitXfer()}
        okText="确认换货"
        confirmLoading={xferSubmitting}
        destroyOnClose
      >
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message="只动库存、不留单据"
          description="换出编码（A）按 FIFO 扣减库存，按你填的总额计货值；A 减这笔货值、B 加这笔货值，两边均价各自重算。店铺跟着商品编码走，数量可不等。不生成出入库单。"
        />
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div>
            <Text type="secondary">换出商品编码（A，减库存）</Text>
            <Select
              style={{ width: "100%", marginTop: 4 }}
              placeholder="输入编码 / 名称搜索"
              value={fromSkuId}
              onChange={setFromSkuId}
              showSearch
              filterOption={false}
              onSearch={setFromSkuSearch}
              loading={fromSkuLoading}
              notFoundContent={fromSkuLoading ? "搜索中…" : "无匹配商品"}
              options={fromSkuOptions.map((s) => ({ value: s.id, label: skuOptionLabel(s) }))}
            />
          </div>
          <div>
            <Text type="secondary">换出数量</Text>
            <InputNumber
              style={{ width: "100%", marginTop: 4 }}
              min={1}
              precision={0}
              placeholder="A 减少的数量"
              value={fromQty}
              onChange={(v) => onFromQtyChange(v as number | null)}
            />
          </div>
          <Row gutter={12}>
            <Col span={12}>
              <Text type="secondary">换出单价</Text>
              <InputNumber
                style={{ width: "100%", marginTop: 4 }}
                min={0}
                precision={2}
                placeholder="单价、总额填一个"
                value={fromUnitCost}
                onChange={(v) => onFromUnitCostChange(v as number | null)}
              />
            </Col>
            <Col span={12}>
              <Text type="secondary">换出总额</Text>
              <InputNumber
                style={{ width: "100%", marginTop: 4 }}
                min={0}
                precision={2}
                placeholder="另一个自动算"
                value={fromAmount}
                onChange={(v) => onFromAmountChange(v as number | null)}
              />
            </Col>
          </Row>
          <div>
            <Text type="secondary">换入商品编码（B，加库存）</Text>
            <Select
              style={{ width: "100%", marginTop: 4 }}
              placeholder="输入编码 / 名称搜索"
              value={toSkuId}
              onChange={setToSkuId}
              showSearch
              filterOption={false}
              onSearch={setToSkuSearch}
              loading={toSkuLoading}
              notFoundContent={toSkuLoading ? "搜索中…" : "无匹配商品"}
              options={toSkuOptions.map((s) => ({ value: s.id, label: skuOptionLabel(s) }))}
            />
          </div>
          <div>
            <Text type="secondary">换入数量</Text>
            <InputNumber
              style={{ width: "100%", marginTop: 4 }}
              min={1}
              precision={0}
              placeholder="B 增加的数量"
              value={toQty}
              onChange={(v) => setToQty(v as number | null)}
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
}
