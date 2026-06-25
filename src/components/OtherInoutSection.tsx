import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Col, DatePicker, Image, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DownloadOutlined, EyeOutlined, SearchOutlined, SwapOutlined } from "@ant-design/icons";
import EmptyGuide from "./EmptyGuide";

const { Paragraph, Text } = Typography;

interface OtherInoutRow {
  id: string;
  ioId: number | string;
  isSwap?: boolean;
  ioDate?: string | null;
  type?: string | null;
  status?: string | null;
  fStatus?: string | null;
  warehouse?: string | null;
  wmsCoName?: string | null;
  storeName?: string | null;
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
  // 物理库存 = SUM(available+reserved+blocked+defective+rework)，跨所有 qc_status。
  // 恒 ≥ 换货「换出」守卫真正扣的「passed 可用」，所以拿它当换出上限永远不会误拦合法换货。
  actualStockQty?: number | null;
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
  if (/换货/.test(text)) return "purple";
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
  const [, setLoadedAt] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [dateRange, setDateRange] = useState<[any, any] | null>(null);
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
  // 记住选中的换出编码整行，用它的 actualStockQty 做「可用库存」提示与换出上限。
  const [fromSkuObj, setFromSkuObj] = useState<SkuOpt | null>(null);
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
        dateFrom: dateRange?.[0]?.format?.("YYYY-MM-DD") || undefined,
        dateTo: dateRange?.[1]?.format?.("YYYY-MM-DD 23:59:59") || undefined,
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
  }, [query, page, pageSize, dateRange]);

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

  const totalQty = useMemo(() => rows.reduce((s, r) => s + Number(r.totalQty || 0), 0), [rows]);
  const totalAmount = useMemo(() => rows.reduce((s, r) => s + Number(r.totalAmount || 0), 0), [rows]);

  const [exporting, setExporting] = useState(false);
  const exportExcel = useCallback(async () => {
    let exportRows: OtherInoutRow[] = rows;
    if (dateRange?.[0] && dateRange?.[1]) {
      if (!erp?.otherInout?.list) { message.error("ERP 接口未就绪"); return; }
      setExporting(true);
      try {
        const all = await erp.otherInout.list({
          dateFrom: dateRange[0].format("YYYY-MM-DD"),
          dateTo: dateRange[1].format("YYYY-MM-DD 23:59:59"),
          search: query || undefined,
          limit: 100000,
        });
        exportRows = Array.isArray(all) ? all : [];
      } catch (e: any) {
        message.error(e?.message || "导出数据获取失败");
        setExporting(false);
        return;
      }
      setExporting(false);
    }
    if (!exportRows.length) { message.warning("暂无数据可导出"); return; }
    const XLSX = await import("xlsx");
    const header = ["出入库单号", "业务时间", "类型", "状态", "仓库", "店铺", "总数量", "总金额", "制单人", "原因", "标签", "备注"];
    const data = exportRows.map(r => [
      String(r.ioId ?? ""), r.ioDate ?? "", r.type ?? "", r.status ?? "",
      [r.warehouse, r.wmsCoName].filter(Boolean).join(" / "), r.storeName ?? "",
      r.totalQty ?? "", r.totalAmount ?? "", r.creatorName ?? "",
      r.reason ?? "", r.labels ?? "", r.remark ?? "",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    ws["!cols"] = [{ wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "其他出入库");
    const fromStr = dateRange?.[0]?.format?.("YYYYMMDD") || "";
    const toStr = dateRange?.[1]?.format?.("YYYYMMDD") || "";
    const dateSuffix = fromStr && toStr ? `${fromStr}-${toStr}` : new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `其他出入库_${dateSuffix}.xlsx`);
    message.success(`已导出 ${exportRows.length} 条`);
  }, [rows, dateRange, query]);

  const columns: ColumnsType<OtherInoutRow> = [
    {
      title: "出入库单号",
      key: "io_id",
      width: 120,
      render: (_v, row) => (row.isSwap
        ? <Tag color="purple">换货单</Tag>
        : <Text style={{ fontWeight: 600 }}>{row.ioId}</Text>),
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
      title: "店铺",
      dataIndex: "storeName",
      key: "storeName",
      width: 160,
      ellipsis: true,
      render: (v) => v
        ? <Text style={{ fontSize: 12 }} title={v}>{v}</Text>
        : <Text type="secondary">-</Text>,
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
      width: 160,
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

  const [revertingDocId, setRevertingDocId] = useState<string | null>(null);

  const handleRevertSwap = async (row: OtherInoutRow) => {
    if (!erp?.inventory?.action) { message.error("ERP 接口未就绪"); return; }
    const docId = String(row.ioId || "");
    if (!docId) return;
    setRevertingDocId(docId);
    try {
      const result = await erp.inventory.action({ action: "revert_swap_sku", sourceDocId: docId });
      message.success("已取消生效，请修改后重新提交");
      setFromSkuId(result.fromSkuId);
      setFromSkuObj(null);
      setFromQty(result.fromQty ?? null);
      setFromUnitCost(result.fromUnitCost ?? null);
      setFromAmount(result.fromAmount ?? null);
      setFromSkuSearch(result.fromCode || "");
      setFromSkuOptions([]);
      setToSkuId(result.toSkuId);
      setToQty(result.toQty ?? null);
      setToSkuSearch(result.toCode || "");
      setToSkuOptions([]);
      setXferOpen(true);
      setExpandedId(null);
      void loadData();
    } catch (e: any) {
      message.error(e?.message || "取消生效失败");
    } finally {
      setRevertingDocId(null);
    }
  };

  const openXfer = () => {
    setFromSkuId(undefined);
    setFromSkuObj(null);
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

  // 选中换出编码后的可用库存上限（物理库存）。未选则 null，不做本地拦截。
  const fromAvailable = fromSkuObj && Number.isFinite(Number(fromSkuObj.actualStockQty))
    ? Number(fromSkuObj.actualStockQty)
    : null;

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
    // 提交前拦超额：换出量超过可用库存就别发请求，避免撞服务器那条被 toast 吃掉 < 的乱码报错。
    if (fromAvailable != null && fq > fromAvailable) {
      message.error(`换出数量 ${fq} 超过可用库存 ${fromAvailable}，请改成 ≤ ${fromAvailable} 或先给该编码补货`);
      return;
    }
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

      <div style={{ display: "flex", alignItems: "center", gap: 24, padding: "8px 0", fontSize: 14 }}>
        <span>本页 <strong>{formatNumber(rows.length)}</strong> 单</span>
        <span>累计 <strong>{formatNumber(total)}</strong> 单</span>
        <span>总数量 <strong>{formatNumber(totalQty)}</strong> 件</span>
        <span>总金额 <strong style={{ color: totalAmount ? "#fa8c16" : undefined }}>{formatMoney(totalAmount)}</strong></span>
      </div>

      <section className="app-panel">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div className="material-filter-bar material-filter-bar--search" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
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
            <DatePicker.RangePicker
              allowClear
              placeholder={["开始日期", "结束日期"]}
              value={dateRange}
              onChange={(dates) => { setDateRange(dates as [any, any] | null); setPage(1); }}
              style={{ width: 260 }}
            />
            <div style={{ marginLeft: "auto" }}>
              <Space>
                <Button type="primary" icon={<SwapOutlined />} onClick={openXfer}>新建换货</Button>
                <Button icon={<DownloadOutlined />} loading={exporting} onClick={exportExcel}>导出</Button>
              </Space>
            </div>
          </div>

          <Table<OtherInoutRow>
            className="erp-compact-table"
            rowKey="id"
            size="middle"
            loading={loading && !loadedOnce}
            columns={columns}
            dataSource={rows}
            scroll={{ x: 1600 }}
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
                    {row.isSwap && row.status === "生效" && (
                      <Col xs={24} style={{ display: "flex", justifyContent: "flex-end" }}>
                        <Button
                          danger
                          size="large"
                          loading={revertingDocId === String(row.ioId)}
                          onClick={(e) => { e.stopPropagation(); void handleRevertSwap(row); }}
                        >
                          取消生效
                        </Button>
                      </Col>
                    )}
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
        title={fromSkuId ? "编辑换货（修改后重新生效）" : "新建换货（商品编码之间调拨库存）"}
        open={xferOpen}
        onCancel={() => setXferOpen(false)}
        onOk={() => void submitXfer()}
        okText={fromSkuId ? "重新生效" : "确认换货"}
        confirmLoading={xferSubmitting}
        width={760}
        destroyOnClose
      >
        <Row gutter={16} align="stretch" wrap={false}>
          {/* 左栏：换出 A（减库存），淡红 */}
          <Col flex="1 1 0">
            <div
              style={{
                background: "#fff1f0",
                border: "1px solid #ffccc7",
                borderRadius: 8,
                padding: 16,
                height: "100%",
              }}
            >
              <Tag color="error" style={{ marginBottom: 12, fontWeight: 600 }}>
                换出 A · 减库存
              </Tag>
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <div>
                  <Text type="secondary">换出商品编码</Text>
                  <Select
                    style={{ width: "100%", marginTop: 4 }}
                    placeholder="输入编码 / 名称搜索"
                    value={fromSkuId}
                    onChange={(v) => {
                      setFromSkuId(v);
                      setFromSkuObj(fromSkuOptions.find((o) => o.id === v) || null);
                    }}
                    showSearch
                    filterOption={false}
                    onSearch={setFromSkuSearch}
                    loading={fromSkuLoading}
                    notFoundContent={fromSkuLoading ? "搜索中…" : "无匹配商品"}
                    options={fromSkuOptions.map((s) => ({ value: s.id, label: skuOptionLabel(s) }))}
                  />
                </div>
                <div>
                  <Space size={6}>
                    <Text type="secondary">换出数量</Text>
                    {fromAvailable != null && (
                      <Text type={fromQty != null && fromQty > fromAvailable ? "danger" : "secondary"} style={{ fontSize: 12 }}>
                        可用库存 {fromAvailable}
                      </Text>
                    )}
                  </Space>
                  <InputNumber
                    style={{ width: "100%", marginTop: 4 }}
                    min={1}
                    max={fromAvailable ?? undefined}
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
              </Space>
            </div>
          </Col>
          {/* 中间箭头 */}
          <Col flex="0 0 auto" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <SwapOutlined style={{ fontSize: 22, color: "#bfbfbf" }} />
          </Col>
          {/* 右栏：换入 B（加库存），淡绿 */}
          <Col flex="1 1 0">
            <div
              style={{
                background: "#f6ffed",
                border: "1px solid #b7eb8f",
                borderRadius: 8,
                padding: 16,
                height: "100%",
              }}
            >
              <Tag color="success" style={{ marginBottom: 12, fontWeight: 600 }}>
                换入 B · 加库存
              </Tag>
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <div>
                  <Text type="secondary">换入商品编码</Text>
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
            </div>
          </Col>
        </Row>
      </Modal>
    </div>
  );
}
