import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CheckCircleOutlined,
  CloudSyncOutlined,
  ExportOutlined,
  FileDoneOutlined,
  InboxOutlined,
  ReloadOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { hasPageCache, readPageCache, writePageCache } from "../utils/pageCache";
import {
  fetchTemuStockOrders,
  loadCloudConfig,
  type TemuStockOrderRow,
  type TemuStockOrderSummaryRow,
} from "../utils/cloudClient";

const { Text } = Typography;
const erp = window.electronAPI?.erp;
const OUTBOUND_CACHE_KEY = "temu.qc-outbound.workbench.cache.v2";

interface AccountRow {
  id: string;
  name?: string;
  source?: string;
}

interface OutboundBatchRow {
  id: string;
  batchCode?: string;
  receiptNo?: string;
  poNo?: string;
  supplierName?: string;
  internalSkuCode?: string;
  productName?: string;
  availableQty?: number;
  reservedQty?: number;
  blockedQty?: number;
  qcStatus?: string;
  receivedAt?: string | null;
}

interface OutboundShipmentRow {
  id: string;
  accountId?: string;
  shipmentNo?: string;
  batchCode?: string;
  batchId?: string;
  internalSkuCode?: string;
  productName?: string;
  qty?: number;
  boxes?: number;
  status?: string;
  logisticsProvider?: string;
  trackingNo?: string;
  warehouseOperatorName?: string;
  confirmedByName?: string;
  temuStockOrderNo?: string | null;
  temuDeliveryOrderSn?: string | null;
  temuDeliveryBatchSn?: string | null;
  temuSyncStatus?: string | null;
  updatedAt?: string;
}

interface TemuStockOrderPreview {
  requestedQty?: number;
  demandRemainingQty?: number | null;
  existingQty?: number;
  remainingQty?: number;
  availableQty?: number;
  shortageQty?: number;
  matchedSku?: {
    id?: string;
    internalSkuCode?: string;
    productName?: string;
  };
  existingShipments?: OutboundShipmentRow[];
  allocationPlan?: Array<{
    qty: number;
    batch?: {
      id?: string;
      batchCode?: string;
      availableQty?: number;
    };
  }>;
}

interface OutboundWorkbench {
  generatedAt?: string;
  summary?: Record<string, number>;
  availableBatches?: OutboundBatchRow[];
  outboundShipments?: OutboundShipmentRow[];
}

interface OutboundCache {
  generatedAt?: string;
  outboundData?: OutboundWorkbench;
  stockOrders?: TemuStockOrderRow[];
  stockOrderSummary?: TemuStockOrderSummaryRow[];
  accounts?: AccountRow[];
}

const OUTBOUND_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  pending_warehouse: "待仓库处理",
  picking: "拣货中",
  packed: "已打包",
  shipped_out: "已发出",
  pending_ops_confirm: "待运营确认",
  confirmed: "已确认",
  exception: "异常",
  cancelled: "已取消",
};

const OUTBOUND_STATUS_COLORS: Record<string, string> = {
  draft: "default",
  pending_warehouse: "gold",
  picking: "processing",
  packed: "cyan",
  shipped_out: "blue",
  pending_ops_confirm: "gold",
  confirmed: "success",
  exception: "error",
  cancelled: "default",
};

const CLOUD_SOURCE_LABELS: Record<string, string> = {
  stock_order: "备货单",
  shipping_desk: "发货台",
  shipping_list: "发货单",
};

const CLOUD_SOURCE_ORDER = ["stock_order", "shipping_desk", "shipping_list"];

function canRole(role: string, allowed: string[]) {
  return allowed.includes(role) || (role === "admin" && allowed.includes("manager"));
}

function formatQty(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat("zh-CN").format(number);
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const text = String(value).trim();
  const numericTime = /^\d{10,13}$/.test(text) ? Number(text.length === 10 ? `${text}000` : text) : NaN;
  const date = new Date(Number.isFinite(numericTime) ? numericTime : value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatMoneyCents(cents?: number | null, currency?: string | null) {
  if (cents == null || !Number.isFinite(Number(cents))) return "-";
  const value = Number(cents) / 100;
  const suffix = currency ? ` ${currency}` : "";
  return `${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;
}

function stockOrderSourceType(row: TemuStockOrderRow) {
  return row.source_type || (row.delivery_order_sn ? "shipping_list" : row.delivery_batch_sn ? "shipping_desk" : "stock_order");
}

function stockOrderSourceLabel(row: TemuStockOrderRow) {
  const type = stockOrderSourceType(row);
  return CLOUD_SOURCE_LABELS[type] || "履约单";
}

function stockOrderStatusKey(status?: string | null) {
  return status ? String(status) : "__empty__";
}

function stockOrderStatusLabel(sourceType: string, status?: string | null) {
  const raw = stockOrderStatusKey(status);
  if (raw === "__empty__") return "未标记";
  const sourcePrefix = CLOUD_SOURCE_LABELS[sourceType] || "履约单";
  if (/^\d+$/.test(raw)) return `${sourcePrefix}状态 ${raw}`;
  return raw;
}

function stockOrderWorkflowStatusKey(row: TemuStockOrderRow) {
  return `${stockOrderSourceType(row)}:${stockOrderStatusKey(row.temu_status)}`;
}

function stockOrderWorkflowStatusLabel(row: TemuStockOrderRow) {
  return stockOrderStatusLabel(stockOrderSourceType(row), row.temu_status);
}

function stockOrderIdentity(row: TemuStockOrderRow) {
  const type = stockOrderSourceType(row);
  if (type === "shipping_list") return row.delivery_order_sn || row.stock_order_no || row.delivery_batch_sn || row.online_order_no || row.row_key || row.id;
  if (type === "shipping_desk") return row.delivery_batch_sn || row.delivery_order_sn || row.stock_order_no || row.online_order_no || row.row_key || row.id;
  return row.stock_order_no || row.delivery_order_sn || row.delivery_batch_sn || row.online_order_no || row.row_key || row.id;
}

function stockOrderKeys(row: TemuStockOrderRow) {
  const keys: string[] = [];
  const push = (prefix: string, value?: string | null) => {
    const text = String(value || "").trim();
    if (text) keys.push(`${prefix}:${text}`);
  };
  push("stock", row.stock_order_no);
  push("delivery", row.delivery_order_sn);
  push("batch", row.delivery_batch_sn);
  push("online", row.online_order_no);
  push("internal", row.internal_order_no);
  if (row.online_order_no && row.internal_order_no) {
    keys.push(`online_internal:${String(row.online_order_no).trim()}|${String(row.internal_order_no).trim()}`);
  }
  return keys;
}

function shipmentKeys(row: OutboundShipmentRow) {
  const keys: string[] = [];
  const push = (prefix: string, value?: string | null) => {
    const text = String(value || "").trim();
    if (text) keys.push(`${prefix}:${text}`);
  };
  push("stock", row.temuStockOrderNo);
  push("delivery", row.temuDeliveryOrderSn);
  push("batch", row.temuDeliveryBatchSn);
  return keys;
}

function stockOrderDemand(row: TemuStockOrderRow) {
  const demand = Number(row.demand_qty || 0);
  const delivered = Number(row.delivered_qty || 0);
  return Math.max(0, demand - delivered) || demand || 1;
}

function stockStatusColor(status?: string | null) {
  const text = String(status || "");
  if (!text) return "default";
  if (/取消|cancel/i.test(text)) return "default";
  if (/完成|已发|shipped|done|complete/i.test(text)) return "success";
  if (/待|未|pending|wait/i.test(text)) return "gold";
  return "processing";
}

function outboundStatusTag(status?: string) {
  const key = String(status || "draft");
  return <Tag color={OUTBOUND_STATUS_COLORS[key] || "default"}>{OUTBOUND_STATUS_LABELS[key] || key}</Tag>;
}

function stockOrderSummaryTotal(summary: TemuStockOrderSummaryRow[]) {
  return summary.reduce((sum, row) => sum + Number(row.count || 0), 0);
}

export default function QcOutboundCenter() {
  const auth = useErpAuth();
  const role = auth.currentUser?.role || "";
  const cachedData = useMemo(
    () => readPageCache<OutboundCache>(OUTBOUND_CACHE_KEY, {}),
    [],
  );
  const [outboundData, setOutboundData] = useState<OutboundWorkbench>(() => cachedData.outboundData || {});
  const [stockOrders, setStockOrders] = useState<TemuStockOrderRow[]>(() => cachedData.stockOrders || []);
  const [stockOrderSummary, setStockOrderSummary] = useState<TemuStockOrderSummaryRow[]>(() => cachedData.stockOrderSummary || []);
  const [accounts, setAccounts] = useState<AccountRow[]>(() => cachedData.accounts || []);
  const [loadedOnce, setLoadedOnce] = useState(() => hasPageCache(cachedData));
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("cloud");
  const [stockSourceType, setStockSourceType] = useState("");
  const [stockStatus, setStockStatus] = useState("");
  const [stockQuery, setStockQuery] = useState("");
  const [cloudConfigured, setCloudConfigured] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudLoadedAt, setCloudLoadedAt] = useState<string | null>(() => cachedData.generatedAt || null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [planTarget, setPlanTarget] = useState<OutboundBatchRow | null>(null);
  const [stockOrderTarget, setStockOrderTarget] = useState<TemuStockOrderRow | null>(null);
  const [stockOrderPreview, setStockOrderPreview] = useState<TemuStockOrderPreview | null>(null);
  const [stockOrderPreviewError, setStockOrderPreviewError] = useState<string | null>(null);
  const [stockOrderPreviewLoading, setStockOrderPreviewLoading] = useState(false);
  const [shipTarget, setShipTarget] = useState<OutboundShipmentRow | null>(null);
  const [planForm] = Form.useForm();
  const [stockOrderForm] = Form.useForm();
  const [shipForm] = Form.useForm();

  const canCreateOutbound = canRole(role, ["operations", "manager", "admin"]);
  const canWarehouseAction = canRole(role, ["warehouse", "manager", "admin"]);

  const applyCache = useCallback((
    nextOutbound: OutboundWorkbench,
    nextStockOrders: TemuStockOrderRow[],
    nextStockSummary: TemuStockOrderSummaryRow[],
    nextAccounts: AccountRow[],
  ) => {
    setOutboundData(nextOutbound || {});
    setStockOrders(nextStockOrders || []);
    setStockOrderSummary(nextStockSummary || []);
    setAccounts(nextAccounts || []);
    setLoadedOnce(true);
    writePageCache<OutboundCache>(OUTBOUND_CACHE_KEY, {
      generatedAt: new Date().toISOString(),
      outboundData: nextOutbound || {},
      stockOrders: nextStockOrders || [],
      stockOrderSummary: nextStockSummary || [],
      accounts: nextAccounts || [],
    });
  }, []);

  const loadData = useCallback(async (options?: { notify?: boolean; forceAllCloud?: boolean }) => {
    if (!erp) return;
    setLoading(true);
    if (options?.forceAllCloud) {
      setActiveTab("cloud");
      setStockQuery("");
      setStockSourceType("");
      setStockStatus("");
    }
    try {
      const [nextOutbound, nextAccounts, cfg] = await Promise.all([
        erp.outbound.workbench({ limit: 200 }),
        erp.account.list({ limit: 500 }),
        loadCloudConfig(),
      ]);
      let nextStockOrders: TemuStockOrderRow[] = [];
      let nextStockSummary: TemuStockOrderSummaryRow[] = [];
      if (cfg) {
        setCloudConfigured(true);
        try {
          const stockResult = await fetchTemuStockOrders(cfg, {
            q: options?.forceAllCloud ? undefined : stockQuery || undefined,
            limit: 5000,
          });
          nextStockOrders = stockResult.rows || [];
          nextStockSummary = stockResult.summary || [];
          const nextCloudLoadedAt = new Date().toISOString();
          const nextTotal = stockOrderSummaryTotal(nextStockSummary) || nextStockOrders.length;
          setCloudLoadedAt(nextCloudLoadedAt);
          setCloudError(null);
          if (options?.notify) {
            message.success(`云端送仓托管已同步 ${formatQty(nextTotal)} 条`);
          }
        } catch (error: any) {
          setCloudError(error?.message || "云端备货/发货读取失败");
          if (options?.notify) message.error(error?.message || "云端送仓托管读取失败");
        }
      } else {
        setCloudConfigured(false);
        setCloudError("还没有配置云端连接");
      }
      const accountRows = Array.isArray(nextAccounts) ? nextAccounts : [];
      if (!selectedAccountId && accountRows[0]?.id) {
        setSelectedAccountId(accountRows[0].id);
      }
      applyCache(nextOutbound, nextStockOrders, nextStockSummary, accountRows);
    } catch (error: any) {
      message.error(error?.message || "出库中心数据读取失败");
    } finally {
      setLoading(false);
    }
  }, [applyCache, selectedAccountId, stockQuery]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const runOutboundAction = async (key: string, payload: Record<string, any>, successText: string) => {
    if (!erp) return;
    setActingKey(key);
    try {
      await erp.outbound.action({ ...payload, limit: 200 });
      await loadData();
      message.success(successText);
    } catch (error: any) {
      message.error(error?.message || "操作失败");
    } finally {
      setActingKey(null);
    }
  };

  const openPlanModal = (row: OutboundBatchRow) => {
    setPlanTarget(row);
    planForm.setFieldsValue({
      qty: Math.max(1, Number(row.availableQty || 1)),
      boxes: 1,
      remark: "",
    });
  };

  const submitPlan = async () => {
    if (!planTarget) return;
    const values = await planForm.validateFields();
    await runOutboundAction(
      `plan-${planTarget.id}`,
      {
        action: "create_outbound_plan",
        batchId: planTarget.id,
        qty: Number(values.qty),
        boxes: Number(values.boxes || 1),
        remark: values.remark,
      },
      "出库单已创建",
    );
    setPlanTarget(null);
    planForm.resetFields();
  };

  const openStockOrderModal = (row: TemuStockOrderRow) => {
    const linkedAccountId = resolveStockOrderLink(row)?.shipments.find((item) => item.accountId)?.accountId;
    const accountId = linkedAccountId || selectedAccountId || accounts[0]?.id || "";
    setStockOrderTarget(row);
    setStockOrderPreview(null);
    setStockOrderPreviewError(null);
    stockOrderForm.setFieldsValue({
      accountId,
      qty: stockOrderDemand(row),
      boxes: 1,
      remark: `Temu 云端${stockOrderSourceLabel(row)} ${stockOrderIdentity(row)}`,
    });
    if (accountId) {
      void previewStockOrderPlan(row, accountId, stockOrderDemand(row));
    }
  };

  const previewStockOrderPlan = async (
    row = stockOrderTarget,
    accountId?: string,
    qty?: number,
  ) => {
    if (!erp || !row) return;
    const values = stockOrderForm.getFieldsValue();
    const nextAccountId = accountId || values.accountId || selectedAccountId || accounts[0]?.id || "";
    const nextQty = Number(qty || values.qty || stockOrderDemand(row));
    if (!nextAccountId || !nextQty) return;
    setStockOrderPreviewLoading(true);
    setStockOrderPreviewError(null);
    try {
      const response = await erp.outbound.action({
        action: "preview_temu_stock_order_outbound",
        accountId: nextAccountId,
        stockOrder: row,
        qty: nextQty,
        includeWorkbench: false,
        limit: 200,
      });
      setStockOrderPreview(response?.result || null);
    } catch (error: any) {
      setStockOrderPreview(null);
      setStockOrderPreviewError(error?.message || "预检失败");
    } finally {
      setStockOrderPreviewLoading(false);
    }
  };

  const closeStockOrderModal = () => {
    setStockOrderTarget(null);
    setStockOrderPreview(null);
    setStockOrderPreviewError(null);
    setStockOrderPreviewLoading(false);
    stockOrderForm.resetFields();
  };

  const submitStockOrderPlan = async () => {
    if (!erp || !stockOrderTarget) return;
    const values = await stockOrderForm.validateFields();
    setSelectedAccountId(values.accountId);
    setActingKey(`stock-${stockOrderTarget.id}`);
    try {
      const response = await erp.outbound.action({
        action: "create_outbound_plan_from_temu_stock_order",
        accountId: values.accountId,
        stockOrder: stockOrderTarget,
        qty: Number(values.qty),
        boxes: Number(values.boxes || 1),
        remark: values.remark,
        limit: 200,
      });
      await loadData();
      const result = response?.result || {};
      if (result.idempotent) {
        message.info("该云端履约记录已生成本地出库单，未重复创建");
      } else {
        message.success(`已生成 ${formatQty(result.createdQty || values.qty)} 件出库单`);
      }
      closeStockOrderModal();
    } catch (error: any) {
      message.error(error?.message || "生成出库单失败");
    } finally {
      setActingKey(null);
    }
  };

  const openShipModal = (row: OutboundShipmentRow) => {
    setShipTarget(row);
    shipForm.setFieldsValue({
      logisticsProvider: row.logisticsProvider || "",
      trackingNo: row.trackingNo || "",
    });
  };

  const submitShip = async () => {
    if (!shipTarget) return;
    const values = await shipForm.validateFields();
    await runOutboundAction(
      `ship-${shipTarget.id}`,
      {
        action: "confirm_shipped_out",
        outboundId: shipTarget.id,
        logisticsProvider: values.logisticsProvider,
        trackingNo: values.trackingNo,
      },
      "已确认发出，等待运营确认",
    );
    setShipTarget(null);
    shipForm.resetFields();
  };

  const summary = outboundData.summary || {};
  const stockOrderLinkIndex = useMemo(() => {
    const index = new Map<string, { qty: number; shipments: OutboundShipmentRow[] }>();
    for (const shipment of outboundData.outboundShipments || []) {
      for (const key of shipmentKeys(shipment)) {
        const current = index.get(key) || { qty: 0, shipments: [] };
        current.qty += Number(shipment.qty || 0);
        current.shipments.push(shipment);
        index.set(key, current);
      }
    }
    return index;
  }, [outboundData.outboundShipments]);
  const resolveStockOrderLink = useCallback((row: TemuStockOrderRow) => (
    stockOrderKeys(row)
      .map((key) => stockOrderLinkIndex.get(key))
      .find(Boolean)
  ), [stockOrderLinkIndex]);
  const cloudDemandQty = useMemo(
    () => stockOrders.reduce((sum, row) => sum + Number(row.demand_qty || 0), 0),
    [stockOrders],
  );
  const cloudShippingQty = useMemo(
    () => stockOrders.reduce((sum, row) => sum + Number(row.shipping_qty ?? row.delivered_qty ?? 0), 0),
    [stockOrders],
  );
  const cloudTotalCount = useMemo(
    () => stockOrderSummaryTotal(stockOrderSummary) || stockOrders.length,
    [stockOrderSummary, stockOrders.length],
  );
  const stockSourceCounts = useMemo(() => {
    if (stockOrderSummary.length) {
      return stockOrderSummary.reduce<Record<string, number>>((acc, item) => {
        const key = item.source_type || "stock_order";
        acc[key] = (acc[key] || 0) + Number(item.count || 0);
        return acc;
      }, {});
    }
    return stockOrders.reduce<Record<string, number>>((acc, row) => {
      const key = stockOrderSourceType(row);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [stockOrderSummary, stockOrders]);
  const selectedSourceStockOrders = useMemo(
    () => stockOrders.filter((row) => !stockSourceType || stockOrderSourceType(row) === stockSourceType),
    [stockOrders, stockSourceType],
  );
  const filteredStockOrders = useMemo(
    () => selectedSourceStockOrders.filter((row) => !stockStatus || stockOrderWorkflowStatusKey(row) === stockStatus),
    [selectedSourceStockOrders, stockStatus],
  );
  const stockSourceOptions = useMemo(() => {
    const total = Object.values(stockSourceCounts).reduce((sum, value) => sum + Number(value || 0), 0) || stockOrders.length;
    return [
      { label: `全部 ${total}`, value: "" },
      { label: `备货单 ${stockSourceCounts.stock_order || 0}`, value: "stock_order" },
      { label: `发货台 ${stockSourceCounts.shipping_desk || 0}`, value: "shipping_desk" },
      { label: `发货单 ${stockSourceCounts.shipping_list || 0}`, value: "shipping_list" },
    ];
  }, [stockOrders.length, stockSourceCounts]);
  const stockStatusOptions = useMemo(() => {
    const counts = new Map<string, { count: number; sourceType: string; rawStatus: string }>();
    for (const item of stockOrderSummary) {
      const sourceType = item.source_type || "stock_order";
      if (stockSourceType && sourceType !== stockSourceType) continue;
      const rawStatus = stockOrderStatusKey(item.temu_status);
      const key = `${sourceType}:${rawStatus}`;
      const current = counts.get(key) || { count: 0, sourceType, rawStatus };
      current.count += Number(item.count || 0);
      counts.set(key, current);
    }
    if (!counts.size) {
      for (const row of selectedSourceStockOrders) {
        const sourceType = stockOrderSourceType(row);
        const rawStatus = stockOrderStatusKey(row.temu_status);
        const key = `${sourceType}:${rawStatus}`;
        const current = counts.get(key) || { count: 0, sourceType, rawStatus };
        current.count += 1;
        counts.set(key, current);
      }
    }
    const total = Array.from(counts.values()).reduce((sum, item) => sum + item.count, 0) || selectedSourceStockOrders.length;
    const options = [{ label: `全部 ${total}`, value: "__all__" }];
    Array.from(counts.entries())
      .sort((a, b) => {
        const sourceDelta = CLOUD_SOURCE_ORDER.indexOf(a[1].sourceType) - CLOUD_SOURCE_ORDER.indexOf(b[1].sourceType);
        if (sourceDelta) return sourceDelta;
        return b[1].count - a[1].count;
      })
      .forEach(([key, item]) => {
        const label = stockOrderStatusLabel(item.sourceType, item.rawStatus === "__empty__" ? null : item.rawStatus);
        options.push({ label: `${label} ${item.count}`, value: key });
      });
    return options;
  }, [selectedSourceStockOrders, stockOrderSummary, stockSourceType]);
  const stockStatusTabItems = useMemo(
    () => stockStatusOptions.map((item) => ({ key: item.value, label: item.label })),
    [stockStatusOptions],
  );

  const cloudStockColumns = useMemo<ColumnsType<TemuStockOrderRow>>(() => [
    {
      title: "内部/线上单号/平台状态",
      key: "order",
      width: 260,
      fixed: "left",
      render: (_value, row) => (
        <Space direction="vertical" size={3}>
          <Space size={4} wrap>
            <Tag color="blue">{stockOrderSourceLabel(row)}</Tag>
            <Tag color={stockStatusColor(stockOrderWorkflowStatusLabel(row))}>{stockOrderWorkflowStatusLabel(row)}</Tag>
          </Space>
          <Text strong>{stockOrderIdentity(row)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            线上 {row.online_order_no || row.parent_order_no || "-"}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            内部 {row.internal_order_no || row.stock_order_no || "-"}
          </Text>
        </Space>
      ),
    },
    {
      title: "标记/多标签",
      key: "labels",
      width: 170,
      render: (_value, row) => (
        <Space size={4} wrap>
          {row.urgency_info ? <Tag color="orange">{row.urgency_info}</Tag> : null}
          {row.warehouse_group ? <Tag>{row.warehouse_group}</Tag> : null}
          {row.receive_warehouse_name ? <Tag>{row.receive_warehouse_name}</Tag> : null}
          {!row.urgency_info && !row.warehouse_group && !row.receive_warehouse_name ? <Text type="secondary">-</Text> : null}
        </Space>
      ),
    },
    {
      title: "商品信息",
      key: "product",
      width: 320,
      render: (_value, row) => (
        <Space direction="vertical" size={3}>
          <Text>{row.product_name || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.spec_name || "-"}</Text>
          <Space size={4} wrap>
            {row.skc_id ? <Tag>SKC {row.skc_id}</Tag> : null}
            {row.sku_id ? <Tag>SKU {row.sku_id}</Tag> : null}
            {row.sku_ext_code ? <Tag>{row.sku_ext_code}</Tag> : null}
          </Space>
        </Space>
      ),
    },
    {
      title: "订单金额",
      key: "amount",
      width: 130,
      align: "right",
      render: (_value, row) => formatMoneyCents(row.order_amount_cents, row.currency),
    },
    {
      title: "发货单时间",
      key: "orderTime",
      width: 170,
      render: (_value, row) => formatDateTime(row.order_time),
    },
    {
      title: "订单发货时间",
      key: "shipTime",
      width: 170,
      render: (_value, row) => formatDateTime(row.latest_ship_at),
    },
    {
      title: "数量",
      key: "qty",
      width: 160,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{formatQty(row.demand_qty)} 件</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            送货 {formatQty(row.shipping_qty ?? row.delivered_qty)} / 入库 {formatQty(row.inbound_qty)}
          </Text>
        </Space>
      ),
    },
    {
      title: "重量/包裹",
      key: "package",
      width: 160,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.weight_kg ? `${row.weight_kg} kg` : "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>包裹 {formatQty(row.package_count)}</Text>
        </Space>
      ),
    },
    {
      title: "平台发货单",
      key: "platformDelivery",
      width: 210,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.delivery_order_sn || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>批次 {row.delivery_batch_sn || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "包裹号/物流信息",
      key: "logistics",
      width: 230,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.package_no || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.logistics_info || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "收货仓",
      key: "warehouse",
      width: 200,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.receive_warehouse_name || row.warehouse_group || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.receive_warehouse_id || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "本地承接",
      key: "localLink",
      width: 150,
      render: (_value, row) => {
        const localLink = resolveStockOrderLink(row);
        const localQty = Number(localLink?.qty || 0);
        const demandQty = Math.max(1, stockOrderDemand(row));
        const isDone = localQty >= demandQty;
        const isPartial = localQty > 0 && localQty < demandQty;
        return (
          <Space direction="vertical" size={2}>
            <Tag color={isDone ? "success" : isPartial ? "warning" : "default"}>
              {isDone ? "已生成" : isPartial ? "部分生成" : "未生成"}
            </Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatQty(localQty)} / {formatQty(demandQty)} 件
            </Text>
          </Space>
        );
      },
    },
    {
      title: "更新",
      key: "updated",
      width: 170,
      render: (_value, row) => formatDateTime(row.last_updated_at),
    },
    {
      title: "操作",
      key: "actions",
      width: 150,
      fixed: "right",
      render: (_value, row) => {
        const localLink = resolveStockOrderLink(row);
        const isDone = Number(localLink?.qty || 0) >= Math.max(1, stockOrderDemand(row));
        return (
          <Button
            size="small"
            type="primary"
            icon={<ExportOutlined />}
            loading={actingKey === `stock-${row.id}`}
            disabled={!canCreateOutbound || accounts.length === 0}
            onClick={() => openStockOrderModal(row)}
          >
            {isDone ? "查看承接" : "生成出库单"}
          </Button>
        );
      },
    },
  ], [accounts.length, actingKey, canCreateOutbound, resolveStockOrderLink]);

  const availableBatchColumns = useMemo<ColumnsType<OutboundBatchRow>>(() => [
    {
      title: "批次",
      key: "batch",
      width: 210,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.batchCode || row.id}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.receiptNo || row.poNo || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "商品",
      key: "sku",
      width: 300,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.productName || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.internalSkuCode || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "库存",
      key: "inventory",
      width: 180,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>可用 {formatQty(row.availableQty)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            预留 {formatQty(row.reservedQty)} / 锁定 {formatQty(row.blockedQty)}
          </Text>
        </Space>
      ),
    },
    {
      title: "供应商",
      dataIndex: "supplierName",
      width: 180,
      render: (value) => value || "-",
    },
    {
      title: "入库时间",
      dataIndex: "receivedAt",
      width: 170,
      render: formatDateTime,
    },
    {
      title: "操作",
      key: "actions",
      width: 140,
      fixed: "right",
      render: (_value, row) => (
        <Button
          size="small"
          type="primary"
          icon={<ExportOutlined />}
          loading={actingKey === `plan-${row.id}`}
          disabled={!canCreateOutbound}
          onClick={() => openPlanModal(row)}
        >
          创建出库单
        </Button>
      ),
    },
  ], [actingKey, canCreateOutbound]);

  const shipmentColumns = useMemo<ColumnsType<OutboundShipmentRow>>(() => [
    {
      title: "出库单",
      key: "shipment",
      width: 230,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.shipmentNo || row.id}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.batchCode || row.batchId || "-"}</Text>
          {row.temuStockOrderNo ? <Tag color="blue">Temu {row.temuStockOrderNo}</Tag> : null}
        </Space>
      ),
    },
    {
      title: "商品",
      key: "sku",
      width: 280,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.productName || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.internalSkuCode || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "数量",
      key: "qty",
      width: 130,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{formatQty(row.qty)} 件</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{formatQty(row.boxes)} 箱</Text>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 140,
      render: outboundStatusTag,
    },
    {
      title: "物流",
      key: "logistics",
      width: 210,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.logisticsProvider || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.trackingNo || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "更新",
      dataIndex: "updatedAt",
      width: 170,
      render: formatDateTime,
    },
    {
      title: "操作",
      key: "actions",
      width: 240,
      fixed: "right",
      render: (_value, row) => {
        const status = row.status || "";
        if (status === "pending_warehouse") {
          return (
            <Button
              size="small"
              icon={<InboxOutlined />}
              loading={actingKey === `pick-${row.id}`}
              disabled={!canWarehouseAction}
              onClick={() => runOutboundAction(`pick-${row.id}`, { action: "start_picking", outboundId: row.id }, "已开始拣货")}
            >
              开始拣货
            </Button>
          );
        }
        if (status === "picking") {
          return (
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `pack-${row.id}`}
              disabled={!canWarehouseAction}
              onClick={() => runOutboundAction(`pack-${row.id}`, { action: "mark_packed", outboundId: row.id, boxes: row.boxes || 1 }, "已打包")}
            >
              标记打包
            </Button>
          );
        }
        if (status === "packed") {
          return (
            <Button
              size="small"
              type="primary"
              icon={<ExportOutlined />}
              disabled={!canWarehouseAction}
              onClick={() => openShipModal(row)}
            >
              确认发出
            </Button>
          );
        }
        if (status === "pending_ops_confirm") {
          return (
            <Button
              size="small"
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `done-${row.id}`}
              disabled={!canCreateOutbound}
              onClick={() => runOutboundAction(`done-${row.id}`, { action: "confirm_outbound_done", outboundId: row.id }, "出库已确认完成")}
            >
              运营确认
            </Button>
          );
        }
        return <Text type="secondary">-</Text>;
      },
    },
  ], [actingKey, canCreateOutbound, canWarehouseAction]);

  if (!erp) {
    return (
      <PageHeader compact eyebrow="系统" title="出库中心" subtitle="服务未就绪，请重启软件" />
    );
  }

  return (
    <div className="app-workspace-shell">
      <PageHeader
        compact
        eyebrow="系统"
        title="出库中心"
        subtitle="浏览器扩展抓取 Temu 备货单、发货台、发货单并上传云端，桌面端按聚水潭式表单承接出库"
        meta={[
          `更新 ${formatDateTime(outboundData.generatedAt)}`,
          `云端同步 ${formatQty(cloudTotalCount)}`,
          `本地出库 ${summary.outboundShipmentCount || 0}`,
        ]}
        actions={[
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={() => void loadData({ notify: true, forceAllCloud: true })}>
            刷新云端全量
          </Button>,
        ]}
      />

      {!cloudConfigured || cloudError ? (
        <Alert
          style={{ marginBottom: 12 }}
          type={cloudConfigured ? "warning" : "info"}
          showIcon
          message={cloudError || "还没有配置云端连接"}
        />
      ) : cloudLoadedAt ? (
        <Alert
          style={{ marginBottom: 12 }}
          type="success"
          showIcon
          message={`云端送仓托管已同步 ${formatQty(cloudTotalCount)} 条`}
          description={`最后同步：${formatDateTime(cloudLoadedAt)}。明细在下方第一个页签「Temu送仓托管」中展示。`}
        />
      ) : null}

      <Row gutter={[12, 12]} className="material-kpi-row" style={{ marginBottom: 12 }}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="送仓托管单" value={formatQty(cloudTotalCount)} color="blue" icon={<CloudSyncOutlined />} compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="云端需求" value={formatQty(cloudDemandQty)} suffix="件" color="brand" icon={<ShoppingCartOutlined />} compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="云端送货" value={formatQty(cloudShippingQty)} suffix="件" color="success" icon={<ExportOutlined />} compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="待仓库/运营" value={(summary.pendingWarehouseCount || 0) + (summary.pendingOpsConfirmCount || 0)} color="purple" icon={<FileDoneOutlined />} compact />
        </Col>
      </Row>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "cloud",
            label: `Temu送仓托管 ${formatQty(cloudTotalCount)}`,
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <div className="material-filter-bar material-filter-bar--search">
                  <Input.Search
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder="搜索备货单号 / 发货单号 / 商品 / SKC / SKU / 包裹号"
                    enterButton="搜索"
                    onSearch={(value) => setStockQuery(value.trim())}
                    style={{ maxWidth: 520 }}
                  />
                  <Segmented
                    value={stockSourceType || ""}
                    options={stockSourceOptions}
                    onChange={(value) => {
                      setStockSourceType(String(value));
                      setStockStatus("");
                    }}
                  />
                </div>
                <Tabs
                  size="small"
                  activeKey={stockStatus || "__all__"}
                  items={stockStatusTabItems}
                  onChange={(value) => setStockStatus(value === "__all__" ? "" : value)}
                />
                <Table
                  className="erp-compact-table"
                  rowKey="id"
                  size="middle"
                  loading={loading && !loadedOnce}
                  columns={cloudStockColumns}
                  dataSource={filteredStockOrders}
                  scroll={{ x: 2550 }}
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                />
              </Space>
            ),
          },
          {
            key: "inventory",
            label: "可出库库存",
            children: (
              <Table
                className="erp-compact-table"
                rowKey="id"
                size="middle"
                loading={loading && !loadedOnce}
                columns={availableBatchColumns}
                dataSource={outboundData.availableBatches || []}
                scroll={{ x: 1100 }}
                pagination={{ pageSize: 20, showSizeChanger: true }}
              />
            ),
          },
          {
            key: "shipments",
            label: "本地出库单",
            children: (
              <Table
                className="erp-compact-table"
                rowKey="id"
                size="middle"
                loading={loading && !loadedOnce}
                columns={shipmentColumns}
                dataSource={outboundData.outboundShipments || []}
                scroll={{ x: 1400 }}
                pagination={{ pageSize: 20, showSizeChanger: true }}
              />
            ),
          },
        ]}
      />

      <Modal
        title="创建出库单"
        open={Boolean(planTarget)}
        onCancel={() => setPlanTarget(null)}
        onOk={submitPlan}
        confirmLoading={actingKey === `plan-${planTarget?.id}`}
        destroyOnClose
      >
        <Form form={planForm} layout="vertical">
          <Form.Item label="出库数量" name="qty" rules={[{ required: true, message: "请输入出库数量" }]}>
            <InputNumber min={1} max={Math.max(1, Number(planTarget?.availableQty || 1))} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="箱数" name="boxes">
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="从云端履约记录生成出库单"
        open={Boolean(stockOrderTarget)}
        onCancel={closeStockOrderModal}
        onOk={stockOrderPreview && Number(stockOrderPreview.remainingQty || 0) <= 0 ? closeStockOrderModal : submitStockOrderPlan}
        okText={stockOrderPreview && Number(stockOrderPreview.remainingQty || 0) <= 0 ? "关闭" : "生成出库单"}
        okButtonProps={{
          disabled: Boolean(stockOrderPreviewError) || Number(stockOrderPreview?.shortageQty || 0) > 0,
        }}
        confirmLoading={actingKey === `stock-${stockOrderTarget?.id}`}
        destroyOnClose
      >
        <Form
          form={stockOrderForm}
          layout="vertical"
          onValuesChange={() => {
            setStockOrderPreview(null);
            setStockOrderPreviewError(null);
          }}
        >
          <Form.Item label="ERP 店铺" name="accountId" rules={[{ required: true, message: "请选择 ERP 店铺" }]}>
            <Select
              options={accounts.map((account) => ({ label: account.name || account.id, value: account.id }))}
              placeholder="选择承接出库的店铺"
            />
          </Form.Item>
          <Form.Item label="出库数量" name="qty" rules={[{ required: true, message: "请输入出库数量" }]}>
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="箱数" name="boxes">
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <Button
              size="small"
              icon={<SearchOutlined />}
              loading={stockOrderPreviewLoading}
              onClick={() => void previewStockOrderPlan()}
            >
              刷新出库预检
            </Button>
            {stockOrderPreviewError ? (
              <Alert type="error" showIcon message="出库预检失败" description={stockOrderPreviewError} />
            ) : stockOrderPreview ? (
              <Alert
                type={Number(stockOrderPreview.shortageQty || 0) > 0 ? "warning" : "success"}
                showIcon
                message={Number(stockOrderPreview.shortageQty || 0) > 0 ? "库存不足，需调整数量或批次" : "库存可覆盖本次出库"}
                description={(
                  <Space direction="vertical" size={4}>
                    <Text>
                      匹配 SKU：{stockOrderPreview.matchedSku?.internalSkuCode || stockOrderPreview.matchedSku?.productName || "-"}
                    </Text>
                    <Text type="secondary">
                      需求 {formatQty(stockOrderPreview.requestedQty)} · 可用 {formatQty(stockOrderPreview.availableQty)} · 已占用 {formatQty(stockOrderPreview.existingQty)} · 缺口 {formatQty(stockOrderPreview.shortageQty)}
                    </Text>
                    {stockOrderPreview.allocationPlan?.length ? (
                      <Text type="secondary">
                        批次分配：{stockOrderPreview.allocationPlan.map((item) => `${item.batch?.batchCode || item.batch?.id || "批次"} ${formatQty(item.qty)}`).join("；")}
                      </Text>
                    ) : null}
                  </Space>
                )}
              />
            ) : (
              <Alert type="info" showIcon message="选择店铺和数量后，可先预检库存覆盖情况。" />
            )}
          </Space>
        </Form>
      </Modal>

      <Modal
        title="确认发出"
        open={Boolean(shipTarget)}
        onCancel={() => setShipTarget(null)}
        onOk={submitShip}
        confirmLoading={actingKey === `ship-${shipTarget?.id}`}
        destroyOnClose
      >
        <Form form={shipForm} layout="vertical">
          <Form.Item label="物流商" name="logisticsProvider">
            <Input />
          </Form.Item>
          <Form.Item label="运单号" name="trackingNo">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
