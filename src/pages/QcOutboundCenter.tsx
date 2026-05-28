import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Image,
  Select,
  Space,
  Spin,
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
  EyeOutlined,
  FileDoneOutlined,
  HolderOutlined,
  InboxOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { hasPageCache, readPageCache, writePageCache } from "../utils/pageCache";
import type { TemuStockOrderRow } from "../utils/cloudClient";

const { Text } = Typography;
const erp = window.electronAPI?.erp;
const OUTBOUND_CACHE_KEY = "temu.qc-outbound.workbench.cache.v3";
const UNIFIED_DEFAULT_PAGE_SIZE = 100;

// 与 src/types/electron.d.ts 中 ConsignDeliverUnified* 保持一致 —— 类型在 .d.ts 模块外不可访问，
// 这里再声明一份纯结构副本供组件内使用。
interface ConsignDeliverUnifiedRawCloud {
  stock_order_no?: string | null;
  row_key?: string | null;
  mall_id?: string | null;
  site?: string | null;
  parent_order_no?: string | null;
  delivery_batch_sn?: string | null;
  product_id?: string | null;
  skc_id?: string | null;
  sku_id?: string | null;
  sku_ext_code?: string | null;
  temu_status?: string | null;
  demand_qty?: number | null;
  delivered_qty?: number | null;
  order_amount_cents?: number | null;
  currency?: string | null;
  product_name?: string | null;
  spec_name?: string | null;
  delivery_order_sn?: string | null;
  receive_warehouse_id?: string | null;
  receive_warehouse_name?: string | null;
  warehouse_group?: string | null;
  urgency_info?: string | null;
  order_time?: string | null;
  latest_ship_at?: string | null;
  logistics_info?: string | null;
  item_count?: number | null;
}
interface ConsignDeliverUnifiedRawJst {
  o_id?: number | null;
  so_id?: string | null;
  shop_name?: string | null;
  status?: string | null;
  src_status?: string | null;
  shop_status_text?: string | null;
  item_amount?: number | null;
  items_qty?: number | null;
  order_date?: string | null;
  send_date?: string | null;
  outer_deliver_no?: string | null;
  supplier_name?: string | null;
  logistics_company?: string | null;
  l_id?: string | null;
  sku_info?: string | null;
  skus?: string | null;
  currency?: string | null;
}
interface ConsignDeliverUnifiedRow {
  soId: string | null;
  shopName: string | null;
  status: string | null;
  itemAmount: number | null;
  itemsQty: number | null;
  orderDate: string | null;
  outerDeliverNo: string | null;
  supplierName: string | null;
  source: "cloud" | "jst" | "both";
  rawCloud: ConsignDeliverUnifiedRawCloud | null;
  rawJst: ConsignDeliverUnifiedRawJst | null;
}
interface ConsignDeliverUnifiedResult {
  ok?: boolean;
  rows: ConsignDeliverUnifiedRow[];
  total: number;
  page: number;
  pageSize: number;
  sourceBreakdown: { cloud_only: number; jst_only: number; both: number };
}

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
  accounts?: AccountRow[];
  unifiedSnapshot?: ConsignDeliverUnifiedResult;
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

type UnifiedRowSource = "cloud" | "jst" | "both";

const JST_STATUS_OPTIONS = ["已发货", "取消", "已付款待审核", "异常", "发货中", "待付款"];

const UNIFIED_COLUMN_MENU_WIDTH = 280;
const UNIFIED_COLUMN_MENU_EDGE_GAP = 12;
const UNIFIED_COLUMN_MENU_OFFSET = 8;
const UNIFIED_COLUMN_MENU_CHROME_HEIGHT = 96;
const UNIFIED_COLUMN_MENU_MIN_BODY_HEIGHT = 180;
const UNIFIED_COLUMN_MENU_MAX_BODY_HEIGHT = 430;
const UNIFIED_COLUMN_ORDER_STORAGE_KEY = "temu.consign.unified.columnOrder.v2";
const UNIFIED_CONFIGURABLE_COLUMN_KEYS = [
  "status",
  "order",
  "deliver",
  "shop",
  "product",
  "amount",
  "orderTime",
  "shipTime",
  "qty",
  "supplier",
  "logistics",
  "warehouse",
  "localLink",
];
const UNIFIED_CONFIGURABLE_COLUMN_KEY_SET = new Set(UNIFIED_CONFIGURABLE_COLUMN_KEYS);
const UNIFIED_COLUMN_LABELS: Record<string, string> = {
  status: "状态",
  order: "备货单",
  deliver: "发货单",
  shop: "店铺",
  product: "商品信息",
  amount: "订单金额",
  orderTime: "下单时间",
  shipTime: "发货时间",
  qty: "数量",
  supplier: "供应商",
  logistics: "物流",
  warehouse: "收货仓",
  localLink: "本地承接",
};

interface UnifiedColumnConfig {
  order: string[];
  visible: string[];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function unifiedColumnMenuPosition(clientX: number, clientY: number) {
  const maxLeft = Math.max(
    UNIFIED_COLUMN_MENU_EDGE_GAP,
    window.innerWidth - UNIFIED_COLUMN_MENU_WIDTH - UNIFIED_COLUMN_MENU_EDGE_GAP,
  );
  const maxTop = Math.max(
    UNIFIED_COLUMN_MENU_EDGE_GAP,
    window.innerHeight
      - UNIFIED_COLUMN_MENU_CHROME_HEIGHT
      - UNIFIED_COLUMN_MENU_MIN_BODY_HEIGHT
      - UNIFIED_COLUMN_MENU_EDGE_GAP,
  );
  const x = clampNumber(
    clientX + UNIFIED_COLUMN_MENU_OFFSET,
    UNIFIED_COLUMN_MENU_EDGE_GAP,
    maxLeft,
  );
  const y = clampNumber(
    clientY + UNIFIED_COLUMN_MENU_OFFSET,
    UNIFIED_COLUMN_MENU_EDGE_GAP,
    maxTop,
  );
  const availableBodyHeight = window.innerHeight
    - y
    - UNIFIED_COLUMN_MENU_CHROME_HEIGHT
    - UNIFIED_COLUMN_MENU_EDGE_GAP;
  return {
    x,
    y,
    bodyMaxHeight: clampNumber(
      availableBodyHeight,
      UNIFIED_COLUMN_MENU_MIN_BODY_HEIGHT,
      UNIFIED_COLUMN_MENU_MAX_BODY_HEIGHT,
    ),
  };
}

function normalizeUnifiedColumnOrder(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const ordered = source
    .map((item) => String(item || ""))
    .filter((key) => {
      if (!UNIFIED_CONFIGURABLE_COLUMN_KEY_SET.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return [
    ...ordered,
    ...UNIFIED_CONFIGURABLE_COLUMN_KEYS.filter((key) => !seen.has(key)),
  ];
}

function defaultUnifiedColumnConfig(): UnifiedColumnConfig {
  return {
    order: [...UNIFIED_CONFIGURABLE_COLUMN_KEYS],
    visible: [...UNIFIED_CONFIGURABLE_COLUMN_KEYS],
  };
}

function normalizeUnifiedColumnConfig(value: unknown): UnifiedColumnConfig {
  const raw = value && typeof value === "object" ? value as { order?: unknown; visible?: unknown } : null;
  const order = normalizeUnifiedColumnOrder(raw?.order || value);
  const visibleSource = Array.isArray(raw?.visible) ? raw.visible : order;
  const visible = Array.from(new Set(visibleSource.map((item) => String(item || "")).filter((key) => (
    UNIFIED_CONFIGURABLE_COLUMN_KEY_SET.has(key)
  ))));
  return {
    order,
    visible: visible.length ? visible : ["order"],
  };
}

function readUnifiedColumnConfig() {
  if (typeof window === "undefined") return defaultUnifiedColumnConfig();
  try {
    return normalizeUnifiedColumnConfig(JSON.parse(window.localStorage.getItem(UNIFIED_COLUMN_ORDER_STORAGE_KEY) || "[]"));
  } catch {
    return defaultUnifiedColumnConfig();
  }
}

function unifiedRowKeys(row: ConsignDeliverUnifiedRow) {
  const keys: string[] = [];
  const push = (prefix: string, value?: string | null) => {
    const text = String(value || "").trim();
    if (text) keys.push(`${prefix}:${text}`);
  };
  push("stock", row.soId);
  push("online", row.soId);
  push("delivery", row.rawCloud?.delivery_order_sn || row.rawJst?.outer_deliver_no);
  push("batch", row.rawCloud?.delivery_batch_sn);
  return keys;
}

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

function unifiedRowDemand(row: ConsignDeliverUnifiedRow) {
  const demand = Number(row.itemsQty || row.rawCloud?.demand_qty || 0);
  const delivered = Number(row.rawCloud?.delivered_qty || 0);
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

export default function QcOutboundCenter() {
  const auth = useErpAuth();
  const role = auth.currentUser?.role || "";
  const cachedData = useMemo(
    () => readPageCache<OutboundCache>(OUTBOUND_CACHE_KEY, {}),
    [],
  );
  const [outboundData, setOutboundData] = useState<OutboundWorkbench>(() => cachedData.outboundData || {});
  const [accounts, setAccounts] = useState<AccountRow[]>(() => cachedData.accounts || []);
  const [unifiedSnapshot, setUnifiedSnapshot] = useState<ConsignDeliverUnifiedResult>(() => cachedData.unifiedSnapshot || {
    rows: [],
    total: 0,
    page: 1,
    pageSize: UNIFIED_DEFAULT_PAGE_SIZE,
    sourceBreakdown: { cloud_only: 0, jst_only: 0, both: 0 },
  });
  const [unifiedLoading, setUnifiedLoading] = useState(false);
  const [unifiedError, setUnifiedError] = useState<string | null>(null);
  const [unifiedLoadedAt, setUnifiedLoadedAt] = useState<string | null>(() => cachedData.generatedAt || null);
  const [unifiedPage, setUnifiedPage] = useState(1);
  const [unifiedPageSize, setUnifiedPageSize] = useState(UNIFIED_DEFAULT_PAGE_SIZE);
  const unifiedSource: "all" | UnifiedRowSource = "all";
  const [loadedOnce, setLoadedOnce] = useState(() => hasPageCache(cachedData));
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("cloud");
  const [stockStatus, setStockStatus] = useState("");
  const [stockQuery, setStockQuery] = useState("");
  const [unifiedItemsCache, setUnifiedItemsCache] = useState<Record<string, any[]>>({});
  const [unifiedItemsLoading, setUnifiedItemsLoading] = useState<Record<string, boolean>>({});
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [planTarget, setPlanTarget] = useState<OutboundBatchRow | null>(null);
  const [stockOrderTarget, setStockOrderTarget] = useState<TemuStockOrderRow | null>(null);
  const [stockOrderPreview, setStockOrderPreview] = useState<TemuStockOrderPreview | null>(null);
  const [stockOrderPreviewError, setStockOrderPreviewError] = useState<string | null>(null);
  const [stockOrderPreviewLoading, setStockOrderPreviewLoading] = useState(false);
  const [shipTarget, setShipTarget] = useState<OutboundShipmentRow | null>(null);
  const [unifiedColumnConfig, setUnifiedColumnConfig] = useState<UnifiedColumnConfig>(readUnifiedColumnConfig);
  const [unifiedColumnDraft, setUnifiedColumnDraft] = useState<UnifiedColumnConfig | null>(null);
  const [unifiedColumnMenu, setUnifiedColumnMenu] = useState({ open: false, x: 0, y: 0, bodyMaxHeight: UNIFIED_COLUMN_MENU_MAX_BODY_HEIGHT });
  const [unifiedDraggedColumn, setUnifiedDraggedColumn] = useState<string | null>(null);
  const [planForm] = Form.useForm();
  const [stockOrderForm] = Form.useForm();
  const [shipForm] = Form.useForm();

  const canCreateOutbound = canRole(role, ["operations", "manager", "admin"]);
  const canWarehouseAction = canRole(role, ["warehouse", "manager", "admin"]);

  const persistCache = useCallback((
    nextOutbound: OutboundWorkbench,
    nextAccounts: AccountRow[],
    nextSnapshot: ConsignDeliverUnifiedResult | null,
  ) => {
    writePageCache<OutboundCache>(OUTBOUND_CACHE_KEY, {
      generatedAt: new Date().toISOString(),
      outboundData: nextOutbound || {},
      accounts: nextAccounts || [],
      unifiedSnapshot: nextSnapshot || undefined,
    });
  }, []);

  const loadData = useCallback(async (options?: { notify?: boolean }) => {
    if (!erp) return;
    setLoading(true);
    try {
      const [nextOutbound, nextAccounts] = await Promise.all([
        erp.outbound.workbench({ limit: 200 }),
        erp.account.list({ limit: 500 }),
      ]);
      setOutboundData(nextOutbound || {});
      const accountRows = Array.isArray(nextAccounts) ? nextAccounts : [];
      setAccounts(accountRows);
      if (!selectedAccountId && accountRows[0]?.id) {
        setSelectedAccountId(accountRows[0].id);
      }
      setLoadedOnce(true);
      persistCache(nextOutbound, accountRows, unifiedSnapshot);
      if (options?.notify) message.success("出库工作台已刷新");
    } catch (error: any) {
      message.error(error?.message || "出库中心数据读取失败");
    } finally {
      setLoading(false);
    }
  }, [persistCache, selectedAccountId, unifiedSnapshot]);

  const loadUnified = useCallback(async (params: {
    page: number;
    pageSize: number;
    search: string;
    status: string;
    source: "all" | UnifiedRowSource;
    notify?: boolean;
  }) => {
    if (!erp?.consignDeliver?.unified) return;
    setUnifiedLoading(true);
    try {
      const result = await erp.consignDeliver.unified({
        page: params.page,
        pageSize: params.pageSize,
        search: params.search || undefined,
        status: params.status || undefined,
        source: params.source,
      });
      setUnifiedSnapshot(result);
      setUnifiedError(null);
      setUnifiedLoadedAt(new Date().toISOString());
      persistCache(outboundData, accounts, result);
      if (params.notify) {
        message.success(`送仓托管已加载 ${result.rows.length}/${result.total} 条`);
      }
    } catch (error: any) {
      setUnifiedError(error?.message || "送仓托管读取失败");
      if (params.notify) message.error(error?.message || "送仓托管读取失败");
    } finally {
      setUnifiedLoading(false);
    }
  }, [accounts, outboundData, persistCache]);

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadUnified({
      page: unifiedPage,
      pageSize: unifiedPageSize,
      search: stockQuery,
      status: stockStatus,
      source: unifiedSource,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unifiedPage, unifiedPageSize, stockQuery, stockStatus, unifiedSource]);

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
      void loadUnified({
        page: unifiedPage,
        pageSize: unifiedPageSize,
        search: stockQuery,
        status: stockStatus,
        source: unifiedSource,
      });
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
  const resolveUnifiedRowLink = useCallback((row: ConsignDeliverUnifiedRow) => (
    unifiedRowKeys(row).map((key) => stockOrderLinkIndex.get(key)).find(Boolean)
  ), [stockOrderLinkIndex]);
  const unifiedRows = unifiedSnapshot.rows;
  const unifiedTotal = unifiedSnapshot.total;

  const openUnifiedColumnMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const position = unifiedColumnMenuPosition(event.clientX, event.clientY);
    setUnifiedColumnDraft({
      order: [...unifiedColumnConfig.order],
      visible: [...unifiedColumnConfig.visible],
    });
    setUnifiedColumnMenu({
      open: true,
      ...position,
    });
  }, [unifiedColumnConfig]);

  const reorderUnifiedDraftColumn = useCallback((sourceField: string, targetField: string) => {
    if (!sourceField || !targetField || sourceField === targetField) return;
    setUnifiedColumnDraft((prev) => {
      const current = normalizeUnifiedColumnConfig(prev || unifiedColumnConfig);
      const sourceIndex = current.order.indexOf(sourceField);
      const targetIndex = current.order.indexOf(targetField);
      if (sourceIndex === -1 || targetIndex === -1) return current;
      const nextOrder = current.order.slice();
      const [movedField] = nextOrder.splice(sourceIndex, 1);
      nextOrder.splice(targetIndex, 0, movedField);
      return {
        ...current,
        order: nextOrder,
        visible: nextOrder.filter((key) => current.visible.includes(key)),
      };
    });
  }, [unifiedColumnConfig]);

  const handleUnifiedColumnDragStart = useCallback((event: DragEvent<HTMLDivElement>, field: string) => {
    setUnifiedDraggedColumn(field);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", field);
  }, []);

  const handleUnifiedColumnDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handleUnifiedColumnDrop = useCallback((event: DragEvent<HTMLDivElement>, targetField: string) => {
    event.preventDefault();
    const sourceField = unifiedDraggedColumn || event.dataTransfer.getData("text/plain");
    reorderUnifiedDraftColumn(sourceField, targetField);
    setUnifiedDraggedColumn(null);
  }, [unifiedDraggedColumn, reorderUnifiedDraftColumn]);

  const handleUnifiedColumnDragEnd = useCallback(() => {
    setUnifiedDraggedColumn(null);
  }, []);

  const toggleUnifiedDraftColumn = useCallback((field: string, checked: boolean) => {
    setUnifiedColumnDraft((prev) => {
      const current = normalizeUnifiedColumnConfig(prev || unifiedColumnConfig);
      const visible = new Set(current.visible);
      if (checked) {
        visible.add(field);
      } else if (visible.size > 1) {
        visible.delete(field);
      }
      return { ...current, visible: current.order.filter((key) => visible.has(key)) };
    });
  }, [unifiedColumnConfig]);

  const saveUnifiedColumnConfig = useCallback(() => {
    const next = normalizeUnifiedColumnConfig(unifiedColumnDraft || unifiedColumnConfig);
    setUnifiedColumnConfig(next);
    try {
      window.localStorage.setItem(UNIFIED_COLUMN_ORDER_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage 仅做便利保存，失败也不影响表格布局
    }
    setUnifiedColumnMenu((prev) => ({ ...prev, open: false }));
  }, [unifiedColumnConfig, unifiedColumnDraft]);

  const restoreUnifiedColumnConfig = useCallback(() => {
    setUnifiedColumnDraft(defaultUnifiedColumnConfig());
  }, []);

  useEffect(() => {
    if (!unifiedColumnMenu.open) return undefined;
    const close = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(".purchase-order-column-menu")) return;
      setUnifiedColumnMenu((prev) => ({ ...prev, open: false }));
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUnifiedColumnMenu((prev) => ({ ...prev, open: false }));
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [unifiedColumnMenu.open]);

  const activeUnifiedColumnConfig = unifiedColumnDraft || unifiedColumnConfig;

  const loadUnifiedItems = useCallback(async (row: ConsignDeliverUnifiedRow) => {
    const oId = row.rawJst?.o_id ? String(row.rawJst.o_id) : "";
    if (!oId || !erp?.consignDeliver?.items) return;
    if (unifiedItemsCache[oId] || unifiedItemsLoading[oId]) return;
    setUnifiedItemsLoading((prev) => ({ ...prev, [oId]: true }));
    try {
      const items = await erp.consignDeliver.items({ o_id: oId });
      setUnifiedItemsCache((prev) => ({ ...prev, [oId]: Array.isArray(items) ? items : [] }));
    } catch (error: any) {
      message.error(error?.message || "商品明细加载失败");
    } finally {
      setUnifiedItemsLoading((prev) => ({ ...prev, [oId]: false }));
    }
  }, [unifiedItemsCache, unifiedItemsLoading]);

  const renderUnifiedRowItems = useCallback((row: ConsignDeliverUnifiedRow) => {
    const oId = row.rawJst?.o_id ? String(row.rawJst.o_id) : "";
    if (!oId) return <Text type="secondary">仅云端数据，无聚水潭明细</Text>;
    if (unifiedItemsLoading[oId]) return <Spin size="small" />;
    const items = unifiedItemsCache[oId];
    if (!items) return <Text type="secondary">展开后加载中...</Text>;
    if (!items.length) return <Text type="secondary">无明细</Text>;
    const headerCellStyle = {
      fontSize: 12,
      color: "rgba(0,0,0,0.45)",
      fontWeight: 500 as const,
    };
    return (
      <div style={{ margin: -16 }}>
        {/* 列标题 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "8px 16px",
            background: "#f0f5ff",
            borderBottom: "1px solid #d6e4ff",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <div style={{ width: 72, flexShrink: 0, ...headerCellStyle }}>图片</div>
          <div style={{ flex: 1, minWidth: 80, paddingLeft: 12, ...headerCellStyle }}>商品名</div>
          <div style={{ width: 192, flexShrink: 0, paddingLeft: 12, ...headerCellStyle }}>规格</div>
          <div style={{ width: 152, flexShrink: 0, paddingLeft: 12, ...headerCellStyle }}>SKU</div>
          <div style={{ width: 82, flexShrink: 0, paddingLeft: 12, textAlign: "right", ...headerCellStyle }}>数量</div>
          <div style={{ width: 102, flexShrink: 0, paddingLeft: 12, textAlign: "right", ...headerCellStyle }}>单价</div>
          <div style={{ width: 112, flexShrink: 0, paddingLeft: 12, textAlign: "right", ...headerCellStyle }}>金额</div>
        </div>
        {/* 数据行 */}
        <Image.PreviewGroup>
          {items.map((it: any) => (
            <div
              key={String(it.oiId || it.id || `${it.skuId}-${it.skuCode}`)}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "10px 16px",
                borderBottom: "1px solid #f0f0f0",
                background: "#fafafa",
                width: "100%",
                boxSizing: "border-box",
              }}
            >
              <div style={{ width: 72, flexShrink: 0 }}>
                {it.picUrl ? (
                  <Image
                    src={it.picUrl}
                    alt=""
                    width={56}
                    height={56}
                    style={{ objectFit: "cover", borderRadius: 4, cursor: "zoom-in" }}
                    preview={{ mask: <EyeOutlined /> }}
                  />
                ) : "-"}
              </div>
              <div style={{ flex: 1, minWidth: 80, paddingLeft: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.name || "-"}
              </div>
              <div style={{ width: 192, flexShrink: 0, paddingLeft: 12, color: "rgba(0,0,0,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.propertiesValue || "-"}
              </div>
              <div style={{ width: 152, flexShrink: 0, paddingLeft: 12, color: "rgba(0,0,0,0.55)", fontFamily: "monospace" }}>
                {it.skuId || "-"}
              </div>
              <div style={{ width: 82, flexShrink: 0, paddingLeft: 12, textAlign: "right" }}>
                {formatQty(it.qty)} 件
              </div>
              <div style={{ width: 102, flexShrink: 0, paddingLeft: 12, textAlign: "right", color: "rgba(0,0,0,0.55)" }}>
                {it.price != null ? `¥${Number(it.price).toFixed(2)}` : "-"}
              </div>
              <div style={{ width: 112, flexShrink: 0, paddingLeft: 12, textAlign: "right", fontWeight: 600 }}>
                {it.amount != null ? `¥${Number(it.amount).toFixed(2)}` : "-"}
              </div>
            </div>
          ))}
        </Image.PreviewGroup>
      </div>
    );
  }, [unifiedItemsCache, unifiedItemsLoading]);

  const cloudStockColumns = useMemo<ColumnsType<ConsignDeliverUnifiedRow>>(() => {
    const columns: ColumnsType<ConsignDeliverUnifiedRow> = [
    {
      title: "状态",
      key: "status",
      width: 130,
      render: (_value, row) => (
        row.status ? <Tag color={stockStatusColor(row.status)} style={{ whiteSpace: "nowrap" }}>{row.status}</Tag> : <Text type="secondary">-</Text>
      ),
    },
    {
      title: "备货单",
      key: "order",
      width: 180,
      render: (_value, row) => <Text strong>{row.soId || "-"}</Text>,
    },
    {
      title: "发货单",
      key: "deliver",
      width: 170,
      render: (_value, row) => {
        const no = row.outerDeliverNo;
        if (!no) return <Text type="secondary">-</Text>;
        return <Text>{no.startsWith("FH") ? no.slice(2) : no}</Text>;
      },
    },
    {
      title: "店铺",
      key: "shop",
      width: 160,
      render: (_value, row) => <Text>{row.shopName || "-"}</Text>,
    },
    {
      title: "商品信息",
      key: "product",
      width: 300,
      render: (_value, row) => (
        <Space direction="vertical" size={3}>
          <Text>{row.rawCloud?.product_name || row.rawJst?.sku_info || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.rawJst?.skus || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "订单金额",
      key: "amount",
      width: 130,
      align: "right" as const,
      render: (_value, row) => {
        if (row.itemAmount == null) return "-";
        const currency = row.rawCloud?.currency || row.rawJst?.currency || "";
        return `${Number(row.itemAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;
      },
    },
    {
      title: "下单时间",
      key: "orderTime",
      width: 170,
      render: (_value, row) => formatDateTime(row.orderDate),
    },
    {
      title: "发货时间",
      key: "shipTime",
      width: 170,
      render: (_value, row) => formatDateTime(row.rawCloud?.latest_ship_at || row.rawJst?.send_date),
    },
    {
      title: "数量",
      key: "qty",
      width: 150,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{formatQty(row.itemsQty)} 件</Text>
          {row.rawCloud?.delivered_qty != null ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              送货 {formatQty(row.rawCloud.delivered_qty)}
            </Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "供应商",
      key: "supplier",
      width: 180,
      render: (_value, row) => <Text>{row.supplierName || "-"}</Text>,
    },
    {
      title: "物流",
      key: "logistics",
      width: 160,
      render: (_value, row) => (
        <Text type="secondary">
          {row.rawCloud?.logistics_info || row.rawJst?.logistics_company || row.rawJst?.l_id || "-"}
        </Text>
      ),
    },
    {
      title: "收货仓",
      key: "warehouse",
      width: 180,
      render: (_value, row) => row.rawCloud?.receive_warehouse_name || "-",
    },
    {
      title: "本地承接",
      key: "localLink",
      width: 150,
      render: (_value, row) => {
        const localLink = resolveUnifiedRowLink(row);
        const localQty = Number(localLink?.qty || 0);
        const demandQty = Math.max(1, unifiedRowDemand(row));
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
    ];
    const columnsByKey = new Map(columns.map((c) => [String(c.key || ""), c]));
    const visibleColumnKeys = new Set(unifiedColumnConfig.visible);
    const orderedColumns = [
      ...unifiedColumnConfig.order
        .filter((field) => visibleColumnKeys.has(field))
        .map((field) => columnsByKey.get(field))
        .filter(Boolean),
      ...columns.filter((c) => !UNIFIED_CONFIGURABLE_COLUMN_KEY_SET.has(String(c.key || ""))),
    ] as ColumnsType<ConsignDeliverUnifiedRow>;

    const buildColumnMenuHeaderProps = () => ({
      title: "右键配置列",
      onContextMenu: openUnifiedColumnMenu,
    });

    return orderedColumns.map((column) => {
      const key = String(column.key || "");
      if (!UNIFIED_CONFIGURABLE_COLUMN_KEY_SET.has(key)) return column;
      return {
        ...column,
        onHeaderCell: buildColumnMenuHeaderProps,
      };
    });
  }, [accounts.length, actingKey, canCreateOutbound, openUnifiedColumnMenu, resolveUnifiedRowLink, unifiedColumnConfig]);

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
        className="qc-outbound-page-header"
        eyebrow="系统"
        title="出库中心"
        actions={[
          <div key="refresh" className="qc-outbound-header-actions">
            <div className="qc-outbound-refresh-meta">
              <span>最后同步</span>
              <strong>{formatDateTime(unifiedLoadedAt || outboundData.generatedAt)}</strong>
            </div>
            <Button
              icon={<ReloadOutlined />}
              loading={loading || unifiedLoading}
              onClick={() => {
                void loadData({ notify: true });
                void loadUnified({
                  page: unifiedPage,
                  pageSize: unifiedPageSize,
                  search: stockQuery,
                  status: stockStatus,
                  source: unifiedSource,
                  notify: true,
                });
              }}
            >
              刷新
            </Button>
          </div>,
        ]}
      />

      {unifiedError ? (
        <Alert
          className="qc-outbound-sync-alert"
          type="warning"
          showIcon
          message={unifiedError}
        />
      ) : null}

      <div className="qc-outbound-kpi-grid">
        <StatCard title="送仓托管单" value={formatQty(unifiedTotal)} color="blue" icon={<CloudSyncOutlined />} compact />
        <StatCard title="待仓库/运营" value={(summary.pendingWarehouseCount || 0) + (summary.pendingOpsConfirmCount || 0)} color="purple" icon={<FileDoneOutlined />} compact />
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "cloud",
            label: `Temu送仓托管 ${formatQty(unifiedTotal)}`,
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <div className="material-filter-bar material-filter-bar--search">
                  <Input.Search
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder="搜索备货单号 / 发货单号 / 商品 / 店铺 / 物流单号 / 供应商"
                    enterButton="搜索"
                    value={stockQuery}
                    onChange={(event) => {
                      setStockQuery(event.target.value);
                      setUnifiedPage(1);
                    }}
                    onSearch={(value) => {
                      setStockQuery(value.trim());
                      setUnifiedPage(1);
                    }}
                    style={{ maxWidth: 520 }}
                  />
                  <Select
                    allowClear
                    placeholder="按状态过滤"
                    style={{ width: 180 }}
                    value={stockStatus || undefined}
                    options={JST_STATUS_OPTIONS.map((value) => ({ label: value, value }))}
                    getPopupContainer={(trigger) => trigger.parentElement || document.body}
                    onChange={(value) => {
                      setStockStatus(value || "");
                      setUnifiedPage(1);
                    }}
                  />
                </div>
                <Table
                  className="erp-compact-table"
                  rowKey={(row) => row.soId || JSON.stringify(row)}
                  size="middle"
                  loading={unifiedLoading}
                  columns={cloudStockColumns}
                  dataSource={unifiedRows}
                  scroll={{ x: 2050 }}
                  expandable={{
                    expandedRowRender: (row) => renderUnifiedRowItems(row),
                    onExpand: (expanded, row) => { if (expanded) void loadUnifiedItems(row); },
                    expandRowByClick: true,
                    showExpandColumn: false,
                  }}
                  pagination={{
                    current: unifiedPage,
                    pageSize: unifiedPageSize,
                    total: unifiedTotal,
                    showSizeChanger: true,
                    pageSizeOptions: [50, 100, 200, 500],
                    showTotal: (t, range) => `显示 ${range[0]}-${range[1]} / ${t} 条`,
                    onChange: (page, pageSize) => {
                      setUnifiedPage(page);
                      if (pageSize !== unifiedPageSize) setUnifiedPageSize(pageSize);
                    },
                  }}
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

      {unifiedColumnMenu.open && typeof document !== "undefined" ? createPortal(
        <div
          className="purchase-order-column-menu"
          style={{ left: unifiedColumnMenu.x, top: unifiedColumnMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="purchase-order-column-menu__head">自定义字段显示信息</div>
          <div className="purchase-order-column-menu__body" style={{ maxHeight: unifiedColumnMenu.bodyMaxHeight }}>
            {activeUnifiedColumnConfig.order.map((field) => {
              const checked = activeUnifiedColumnConfig.visible.includes(field);
              return (
                <div
                  key={field}
                  className={unifiedDraggedColumn === field ? "purchase-order-column-menu__item is-dragging" : "purchase-order-column-menu__item"}
                  draggable
                  onDragStart={(event) => handleUnifiedColumnDragStart(event, field)}
                  onDragOver={handleUnifiedColumnDragOver}
                  onDrop={(event) => handleUnifiedColumnDrop(event, field)}
                  onDragEnd={handleUnifiedColumnDragEnd}
                >
                  <span className="purchase-order-column-menu__drag" aria-hidden="true">
                    <HolderOutlined />
                  </span>
                  <span>{UNIFIED_COLUMN_LABELS[field] || field}</span>
                  <Checkbox
                    checked={checked}
                    disabled={checked && activeUnifiedColumnConfig.visible.length <= 1}
                    onChange={(event) => toggleUnifiedDraftColumn(field, event.target.checked)}
                  />
                </div>
              );
            })}
          </div>
          <div className="purchase-order-column-menu__foot">
            <Button size="small" type="primary" onClick={saveUnifiedColumnConfig}>保存</Button>
            <Button size="small" onClick={restoreUnifiedColumnConfig}>还原</Button>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
