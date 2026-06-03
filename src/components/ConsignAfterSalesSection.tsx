import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Col, Image, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography, message } from "antd";
import type { SorterResult } from "antd/es/table/interface";
import type { ColumnsType } from "antd/es/table";
import { CloudSyncOutlined, EyeOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import EmptyGuide from "./EmptyGuide";
import StatCard from "./StatCard";
import { fetchUnifiedAfterSales, type PlatformAfterSaleItem, type UnifiedAfterSaleRow } from "../utils/unifiedAfterSales";

const { Paragraph, Text } = Typography;

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

interface ConfirmItemRow {
  key: string;
  productName: string;
  temuSkuId: string | null;
  temuSkcId: string | null;
  internalSkuCode: string | null;
  dueQty: number;
  receivedQty: number;
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
  if (/作废|取消|关闭|驳回|失败/.test(text)) return "red";
  if (/完成|已确认|已签收|已入库|已收货|审核通过/.test(text)) return "green";
  if (/待|等待|处理中|审核|发货/.test(text)) return "orange";
  return "default";
}

// 货物状态（聚水潭 good_status）配色：已收到退货=绿（货已到仓），买家已退货=橙（在途/待收）
function goodStatusColor(value?: string | null) {
  const text = String(value || "").trim();
  if (/卖家已收到|已收到退货|已签收|已入库/.test(text)) return "green";
  if (/买家已退货|退货中|在途|待/.test(text)) return "orange";
  return "default";
}

// 货物状态归一：聚水潭 good_status 为空表示「卖家未收到退货」，与表格 / 筛选口径保持一致
function goodStatusLabel(value?: string | null) {
  const text = String(value || "").trim();
  return text || "卖家未收到退货";
}

// 平台状态归一：空值统一成「-」，便于下拉筛选
function shopStatusLabel(value?: string | null) {
  const text = String(value || "").trim();
  return text || "-";
}

// 按退货时间排序的比较器（升序）；降序取反。null 时间始终排最后
function compareAsDateAsc(a: UnifiedAfterSaleRow, b: UnifiedAfterSaleRow) {
  const tA = a.asDate ? Date.parse(a.asDate) : NaN;
  const tB = b.asDate ? Date.parse(b.asDate) : NaN;
  const okA = Number.isFinite(tA);
  const okB = Number.isFinite(tB);
  if (!okA && !okB) return 0;
  if (!okA) return 1;
  if (!okB) return -1;
  return tA - tB;
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
  const [allRows, setAllRows] = useState<UnifiedAfterSaleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [jstError, setJstError] = useState<string | null>(null);
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // 筛选：货物状态 / 平台状态 / 店铺；排序：退货时间（默认倒序，与原行为一致）
  const [goodStatusFilter, setGoodStatusFilter] = useState<string | null>(null);
  const [shopStatusFilter, setShopStatusFilter] = useState<string | null>(null);
  const [shopFilter, setShopFilter] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"ascend" | "descend">("descend");
  // 单行展开（accordion）：一次只看一单，跟原 Drawer 行为一致
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [items, setItems] = useState<ConsignAfterSaleItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const requestIdRef = useRef(0);

  const loadData = useCallback(async (notify = false) => {
    const id = requestIdRef.current + 1;
    requestIdRef.current = id;
    setLoading(true);
    try {
      const result = await fetchUnifiedAfterSales({
        q: query || undefined,
        // 本地聚水潭秒回先渲染（去掉转圈），云端平台单 / 店铺名 / 确认状态随后补全
        onPartial: (partialRows, partialTotal) => {
          if (id !== requestIdRef.current) return;
          setAllRows(partialRows);
          setTotal(partialTotal);
          setLoadedOnce(true);
        },
      });
      if (id !== requestIdRef.current) return;
      setAllRows(result.rows);
      setTotal(result.total);
      setJstError(result.jstError || null);
      setPlatformError(result.platformError || null);
      setLoadedAt(new Date().toISOString());
      setLoadedOnce(true);
      if (notify) message.success(`已同步 ${formatNumber(result.total)} 条售后`);
    } catch (e: any) {
      if (id !== requestIdRef.current) return;
      setJstError(e?.message || "送仓售后读取失败");
      setLoadedOnce(true);
      if (notify) message.error(e?.message || "送仓售后读取失败");
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => { void loadData(); }, [loadData]);

  // 下拉选项：从全量行去重提取（货物状态 / 平台状态 / 店铺），归一后排序
  const goodStatusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) set.add(goodStatusLabel(r.goodStatus));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [allRows]);
  const shopStatusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) set.add(shopStatusLabel(r.shopStatus));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [allRows]);
  const shopOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) { const v = (r.shopName || "").trim(); if (v) set.add(v); }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [allRows]);

  // 先按筛选 + 排序作用于全量行，再纯前端切片翻页（翻页瞬时响应）
  const filteredRows = useMemo(() => {
    let arr = allRows;
    if (goodStatusFilter) arr = arr.filter((r) => goodStatusLabel(r.goodStatus) === goodStatusFilter);
    if (shopStatusFilter) arr = arr.filter((r) => shopStatusLabel(r.shopStatus) === shopStatusFilter);
    if (shopFilter) arr = arr.filter((r) => (r.shopName || "").trim() === shopFilter);
    const sorted = [...arr].sort(compareAsDateAsc);
    if (sortOrder === "descend") sorted.reverse();
    return sorted;
  }, [allRows, goodStatusFilter, shopStatusFilter, shopFilter, sortOrder]);

  const filteredTotal = filteredRows.length;
  const hasFilter = !!(goodStatusFilter || shopStatusFilter || shopFilter);

  const rows = useMemo(() => {
    const offset = Math.max(0, (page - 1) * pageSize);
    return filteredRows.slice(offset, offset + pageSize);
  }, [filteredRows, page, pageSize]);

  const toggleExpand = useCallback(async (row: UnifiedAfterSaleRow) => {
    if (expandedId === row.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(row.id);
    setItems([]);
    if (!erp?.consignAfterSale?.items || !row.asId) return;
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
  }, [expandedId]);

  const [confirmRow, setConfirmRow] = useState<UnifiedAfterSaleRow | null>(null);
  const [confirmItems, setConfirmItems] = useState<ConfirmItemRow[]>([]);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // 打开确认收货弹框：平台单明细来自 platformItems，聚水潭单走 asId 拉明细。
  const openConfirm = useCallback(async (row: UnifiedAfterSaleRow) => {
    let list: ConfirmItemRow[] = [];
    if (row.source === "platform" && Array.isArray(row.platformItems)) {
      list = row.platformItems.map((it: PlatformAfterSaleItem, idx: number) => ({
        key: it.id || `pi-${idx}`,
        productName: it.spec || it.skuId || it.skcId || "-",
        temuSkuId: it.skuId || null,
        temuSkcId: it.skcId || null,
        internalSkuCode: null,
        dueQty: Number(it.qty || 0),
        receivedQty: Number(it.qty || 0),
      }));
    } else if (row.asId && erp?.consignAfterSale?.items) {
      try {
        const items = await erp.consignAfterSale.items({ asId: row.asId });
        list = (Array.isArray(items) ? items : []).map((it: any, idx: number) => ({
          key: it.id || `ji-${idx}`,
          productName: it.productName || it.skuId || "-",
          temuSkuId: null,
          temuSkcId: null,
          internalSkuCode: it.skuId || null, // 聚水潭 sku_id == internal_sku_code
          dueQty: Number(it.rQty || it.qty || 0),
          receivedQty: Number(it.rQty || it.qty || 0),
        }));
      } catch (e: any) {
        message.error(e?.message || "明细读取失败");
        return;
      }
    }
    if (!list.length) { message.warning("该售后单没有可入库的明细"); return; }
    setConfirmRow(row);
    setConfirmItems(list);
  }, []);

  const submitConfirm = useCallback(async () => {
    if (!confirmRow || !erp?.consignAfterSale?.confirmReceipt) return;
    if (!confirmRow.outerAsId) { message.error("缺少外部单号，无法确认"); return; }
    const items = confirmItems
      .filter((it) => Number(it.receivedQty) > 0)
      .map((it) => ({
        temuSkuId: it.temuSkuId,
        temuSkcId: it.temuSkcId,
        internalSkuCode: it.internalSkuCode,
        productName: it.productName,
        receivedQty: Math.trunc(Number(it.receivedQty)),
      }));
    if (!items.length) { message.warning("请填写实收数量"); return; }
    setConfirmLoading(true);
    try {
      await erp.consignAfterSale.confirmReceipt({
        outerAsId: confirmRow.outerAsId,
        asId: confirmRow.asId ?? null,
        source: confirmRow.source,
        items,
      });
      message.success("已确认收货并入库，货物状态已更新");
      setConfirmRow(null);
      setConfirmItems([]);
      void loadData();
    } catch (e: any) {
      message.error(e?.message || "确认收货失败");
    } finally {
      setConfirmLoading(false);
    }
  }, [confirmRow, confirmItems, loadData]);

  // 涉及店铺：跟「累计」口径对齐，统计当前结果集（未筛选=全量）的不同店铺数，而非仅本页切片
  const shopCount = useMemo(() => new Set(filteredRows.map((r) => r.shopName).filter(Boolean)).size, [filteredRows]);
  const totalRefundQty = useMemo(() => rows.reduce((s, r) => s + Number(r.refundQty || 0), 0), [rows]);
  const pendingCount = useMemo(() => rows.filter((r) => statusColor(r.status) !== "green").length, [rows]);

  const columns: ColumnsType<UnifiedAfterSaleRow> = [
    {
      title: "售后单号",
      key: "as_id",
      width: 200,
      render: (_v, row) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontWeight: 600, fontSize: 12 }}>{row.outerAsId || "-"}</Text>
          {row.asId ? <Text type="secondary" style={{ fontSize: 11 }}>{row.asId}</Text> : null}
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
      sorter: compareAsDateAsc,
      sortOrder,
      sortDirections: ["descend", "ascend"],
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
      title: "货物状态",
      dataIndex: "goodStatus",
      key: "goodStatus",
      width: 120,
      render: (v) => v ? <Tag color={goodStatusColor(v)}>{v}</Tag> : <Tag color="red">卖家未收到退货</Tag>,
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
      width: 110,
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
      render: (v, row) => v || row.platformReason || "-",
    },
    {
      title: "操作",
      key: "action",
      width: 110,
      fixed: "right",
      render: (_v, row) => (
        row.receiptStatus === "confirmed"
          ? <Tag color="green">已确认</Tag>
          : <Button size="small" type="primary" onClick={(e) => { e.stopPropagation(); void openConfirm(row); }}>确认收货</Button>
      ),
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

  // 平台独占单明细：来自平台 raw_json（无中文商品名，用 SKU/SKC 标识）；格式对齐聚水潭明细表
  const platformItemColumns: ColumnsType<PlatformAfterSaleItem> = [
    {
      title: "商品",
      key: "product",
      width: 320,
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
          <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
            <Paragraph ellipsis={{ rows: 2, tooltip: `SKU ${row.skuId || "-"}` }} style={{ marginBottom: 0, fontWeight: 600, lineHeight: 1.3 }}>
              SKU {row.skuId || "-"}
            </Paragraph>
            <Text type="secondary" style={{ fontSize: 12 }}>SKC {row.skcId || "-"}</Text>
          </Space>
        </Space>
      ),
    },
    { title: "规格", dataIndex: "spec", key: "spec", width: 160, render: (v) => v || "-" },
    { title: "数量", dataIndex: "qty", key: "qty", width: 100, align: "right", render: (v) => formatNumber(v) },
    { title: "采购子单", dataIndex: "purchaseSn", key: "purchaseSn", width: 200, render: (v) => v || "-" },
    { title: "类型", dataIndex: "type", key: "type", width: 140, render: (v) => v || "-" },
    { title: "原因", dataIndex: "reason", key: "reason", ellipsis: true, render: (v) => v || "-" },
  ];

  const combinedError = useMemo(() => {
    if (jstError && platformError) return `${jstError}；${platformError}`;
    return jstError || platformError;
  }, [jstError, platformError]);

  return (
    <div>
      {combinedError ? (
        <Alert style={{ marginBottom: 12 }} type="warning" showIcon message={combinedError} />
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
              本页 {formatNumber(rows.length)} / 累计 {formatNumber(total)} 条；涉及店铺 {formatNumber(shopCount)}。
              {loadedAt ? ` 同步 ${formatTime(loadedAt)}` : ""}
            </div>
          </div>
          <div>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadData(true)}>刷新全部</Button>
          </div>
        </div>

        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div className="material-filter-bar material-filter-bar--search" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
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
              style={{ maxWidth: 520, flex: "1 1 320px" }}
            />
            <Select
              allowClear
              placeholder="货物状态"
              value={goodStatusFilter}
              onChange={(v) => { setGoodStatusFilter(v ?? null); setPage(1); }}
              options={goodStatusOptions.map((v) => ({ value: v, label: v }))}
              style={{ width: 160 }}
            />
            <Select
              allowClear
              placeholder="平台状态"
              value={shopStatusFilter}
              onChange={(v) => { setShopStatusFilter(v ?? null); setPage(1); }}
              options={shopStatusOptions.map((v) => ({ value: v, label: v }))}
              style={{ width: 160 }}
            />
            <Select
              allowClear
              showSearch
              placeholder="店铺"
              value={shopFilter}
              onChange={(v) => { setShopFilter(v ?? null); setPage(1); }}
              options={shopOptions.map((v) => ({ value: v, label: v }))}
              optionFilterProp="label"
              style={{ width: 180 }}
            />
            {hasFilter ? (
              <Button
                type="link"
                size="small"
                onClick={() => { setGoodStatusFilter(null); setShopStatusFilter(null); setShopFilter(null); setPage(1); }}
              >
                清除筛选
              </Button>
            ) : null}
          </div>

          <Table<UnifiedAfterSaleRow>
            className="erp-compact-table"
            rowKey="id"
            size="middle"
            loading={loading && !loadedOnce}
            columns={columns}
            dataSource={rows}
            scroll={{ x: 1710 }}
            onChange={(_pagination, _filters, sorter) => {
              const s = (Array.isArray(sorter) ? sorter[0] : sorter) as SorterResult<UnifiedAfterSaleRow>;
              if (s && s.columnKey === "asDate") {
                setSortOrder(s.order === "ascend" ? "ascend" : "descend");
                setPage(1);
              }
            }}
            onRow={(row) => ({ onClick: () => void toggleExpand(row), style: { cursor: "pointer" } })}
            expandable={{
              expandedRowKeys: expandedId ? [expandedId] : [],
              showExpandColumn: false,
              rowExpandable: () => true,
              expandedRowRender: (row) => (
                <div style={{ padding: "8px 4px" }}>
                  <Row gutter={[12, 8]} style={{ marginBottom: 12 }}>
                    <Col xs={12} sm={6}><Text type="secondary">外部单号</Text><div>{row.outerAsId || "-"}</div></Col>
                    {row.asId ? <Col xs={12} sm={6}><Text type="secondary">内部单号</Text><div>{row.asId}</div></Col> : null}
                    <Col xs={12} sm={6}><Text type="secondary">退货时间</Text><div>{formatTime(row.asDate)}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">内部状态</Text><div><Tag color={statusColor(row.status)}>{row.status || "-"}</Tag></div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">货物状态</Text><div>{row.goodStatus ? <Tag color={goodStatusColor(row.goodStatus)}>{row.goodStatus}</Tag> : <Tag color="red">卖家未收到退货</Tag>}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">平台状态</Text><div><Tag color={statusColor(row.shopStatus)}>{row.shopStatus || "-"}</Tag></div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">类型</Text><div>{row.type || "-"}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">仓库</Text><div>{row.warehouse || "-"}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">送仓收货人</Text><div>{row.receiverName || "-"}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">收货电话</Text><div>{row.receiverMobile || "-"}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">物流单号</Text><div>{row.lId || "-"}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">网店订单</Text><div>{row.soId || "-"}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">标签</Text><div>{row.labels || "-"}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">确认时间</Text><div>{formatTime(row.confirmDate)}</div></Col>
                    {row.platformProductName ? <Col xs={24}><Text type="secondary">平台商品</Text><div>{row.platformProductName}</div></Col> : null}
                    {row.platformReason ? <Col xs={24}><Text type="secondary">平台退货原因</Text><div>{row.platformReason}</div></Col> : null}
                    <Col xs={24}><Text type="secondary">备注</Text><div>{row.remark || "-"}</div></Col>
                  </Row>

                  {row.asId ? (
                    <Table<ConsignAfterSaleItemRow>
                      className="erp-compact-table"
                      rowKey="id"
                      size="small"
                      loading={itemsLoading}
                      columns={itemColumns}
                      dataSource={items}
                      scroll={{ x: 1300 }}
                      pagination={false}
                    />
                  ) : row.platformItems?.length ? (
                    <Table<PlatformAfterSaleItem>
                      className="erp-compact-table"
                      rowKey="id"
                      size="small"
                      columns={platformItemColumns}
                      dataSource={row.platformItems}
                      scroll={{ x: 1200 }}
                      pagination={false}
                    />
                  ) : (
                    <Alert type="info" showIcon message="此单仅来自 Temu 平台后台，暂无明细。" />
                  )}
                </div>
              ),
            }}
            pagination={{
              current: page,
              pageSize,
              total: filteredTotal,
              showSizeChanger: true,
              showTotal: (t) => (hasFilter ? `筛选出 ${formatNumber(t)} 条 / 共 ${formatNumber(total)} 条` : `共 ${formatNumber(t)} 条`),
              onChange: (p, s) => { setPage(p); setPageSize(s); },
            }}
            locale={{
              emptyText: (
                <EmptyGuide
                  title="暂无送仓售后记录"
                  description="确认聚水潭历史数据已导入，且官方开放平台退货包裹已采集。"
                />
              ),
            }}
          />
        </Space>
      </section>

      <Modal
        title={`确认收货 — ${confirmRow?.outerAsId || ""}`}
        open={!!confirmRow}
        onCancel={() => { setConfirmRow(null); setConfirmItems([]); }}
        onOk={() => void submitConfirm()}
        okText="确认收货并入库"
        okButtonProps={{ loading: confirmLoading }}
        width={720}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="按实收数量增加库存，并把该单货物状态标记为「卖家已收到退货」。SKU 未绑定内部编码的明细会被拒绝，请先在商品资料补齐。"
        />
        <Table<ConfirmItemRow>
          className="erp-compact-table"
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={confirmItems}
          columns={[
            { title: "商品", dataIndex: "productName", key: "productName", ellipsis: true },
            { title: "应退", dataIndex: "dueQty", key: "dueQty", width: 80, align: "right", render: (v: number) => formatNumber(v) },
            {
              title: "实收",
              key: "receivedQty",
              width: 120,
              render: (_v: unknown, it: ConfirmItemRow) => (
                <InputNumber
                  min={0}
                  precision={0}
                  value={it.receivedQty}
                  onChange={(val) => {
                    setConfirmItems((prev) => prev.map((x) => x.key === it.key ? { ...x, receivedQty: Number(val) || 0 } : x));
                  }}
                />
              ),
            },
          ] as ColumnsType<ConfirmItemRow>}
        />
      </Modal>
    </div>
  );
}
