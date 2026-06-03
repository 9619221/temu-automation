import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
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
  CloudSyncOutlined,
  EyeOutlined,
  HolderOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import OtherInoutSection from "../components/OtherInoutSection";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { readPageCache, writePageCache } from "../utils/pageCache";
import type { TemuStockOrderRow } from "../utils/cloudClient";

const { Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;
const erp = window.electronAPI?.erp;

// 下单时间区间边界 → 聚水潭文本格式「YYYY-MM-DD HH:mm:ss」，与 order_date 存储格式一致以便字符串比较。
function consignDateBound(value: any, end: boolean): string {
  if (!value?.format) return "";
  return `${value.format("YYYY-MM-DD")} ${end ? "23:59:59" : "00:00:00"}`;
}
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
  inbound_qty?: number | null;
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
  localShipQty?: number | null;
  orderDate: string | null;
  outerDeliverNo: string | null;
  supplierName: string | null;
  source: "cloud" | "jst" | "both";
  localStatusOverride?: string | null;
  inventoryDeducted?: boolean;
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
  // 各「显示状态」条数，仅受搜索约束；旧服务器不返回，做缺省兜底。
  statusBreakdown?: Record<string, number>;
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

type UnifiedRowSource = "cloud" | "jst" | "both";

const JST_STATUS_OPTIONS = ["已发货", "取消", "已付款待审核", "异常", "发货中", "待付款"];

const UNIFIED_COLUMN_MENU_WIDTH = 280;
const UNIFIED_COLUMN_MENU_EDGE_GAP = 12;
const UNIFIED_COLUMN_MENU_OFFSET = 8;
const UNIFIED_COLUMN_MENU_CHROME_HEIGHT = 96;
const UNIFIED_COLUMN_MENU_MIN_BODY_HEIGHT = 180;
const UNIFIED_COLUMN_MENU_MAX_BODY_HEIGHT = 430;
// v3：新增「送货数」「入库数」独立列。升版本让旧客户端的列配置重置为含新列的全可见默认，
// 否则旧 localStorage 的 visible 不含新 key，新列默认隐藏、用户仍看不到。
const UNIFIED_COLUMN_ORDER_STORAGE_KEY = "temu.consign.unified.columnOrder.v3";
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
  "deliveredQty",
  "inboundQty",
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
  deliveredQty: "送货数",
  inboundQty: "入库数",
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
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("cloud");
  const [stockStatus, setStockStatus] = useState("");
  const [stockShop, setStockShop] = useState("");
  const [stockSkuCode, setStockSkuCode] = useState("");
  const [stockDateRange, setStockDateRange] = useState<any>(null);
  const [stockQuery, setStockQuery] = useState("");
  const [unifiedItemsCache, setUnifiedItemsCache] = useState<Record<string, any[]>>({});
  const [unifiedItemsLoading, setUnifiedItemsLoading] = useState<Record<string, boolean>>({});
  // cloud-only 单官方明细缓存(按 soId);与聚水潭明细分开。
  const [cloudItemsCache, setCloudItemsCache] = useState<Record<string, any[]>>({});
  const [cloudItemsLoading, setCloudItemsLoading] = useState<Record<string, boolean>>({});
  // 送仓明细「本地实发数量」编辑：草稿值（按 oiId）与保存中标记。
  const [itemShipDraft, setItemShipDraft] = useState<Record<string, number | null>>({});
  const [itemShipSaving, setItemShipSaving] = useState<Record<string, boolean>>({});
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [stockOrderTarget, setStockOrderTarget] = useState<TemuStockOrderRow | null>(null);
  const [stockOrderPreview, setStockOrderPreview] = useState<TemuStockOrderPreview | null>(null);
  const [stockOrderPreviewError, setStockOrderPreviewError] = useState<string | null>(null);
  const [stockOrderPreviewLoading, setStockOrderPreviewLoading] = useState(false);
  const [unifiedColumnConfig, setUnifiedColumnConfig] = useState<UnifiedColumnConfig>(readUnifiedColumnConfig);
  const [unifiedColumnDraft, setUnifiedColumnDraft] = useState<UnifiedColumnConfig | null>(null);
  const [unifiedColumnMenu, setUnifiedColumnMenu] = useState({ open: false, x: 0, y: 0, bodyMaxHeight: UNIFIED_COLUMN_MENU_MAX_BODY_HEIGHT });
  const [unifiedDraggedColumn, setUnifiedDraggedColumn] = useState<string | null>(null);
  const [stockOrderForm] = Form.useForm();

  const canCreateOutbound = canRole(role, ["operations", "manager", "admin"]);

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
    shop?: string;
    skuCode?: string;
    dateFrom?: string;
    dateTo?: string;
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
        shop: params.shop || undefined,
        skuCode: params.skuCode || undefined,
        dateFrom: params.dateFrom || undefined,
        dateTo: params.dateTo || undefined,
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
      shop: stockShop,
      skuCode: stockSkuCode,
      dateFrom: consignDateBound(stockDateRange?.[0], false),
      dateTo: consignDateBound(stockDateRange?.[1], true),
      source: unifiedSource,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unifiedPage, unifiedPageSize, stockQuery, stockStatus, stockShop, stockSkuCode, stockDateRange, unifiedSource]);

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
        shop: stockShop,
        skuCode: stockSkuCode,
        dateFrom: consignDateBound(stockDateRange?.[0], false),
        dateTo: consignDateBound(stockDateRange?.[1], true),
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

  // 状态筛选下拉选项：优先用服务器返回的真实状态分布（含条数）；
  // 旧服务器无 statusBreakdown 时回退到静态列表，保证不报错。
  const statusFilterOptions = useMemo(() => {
    const breakdown = unifiedSnapshot.statusBreakdown;
    const entries = breakdown ? Object.entries(breakdown).filter(([key]) => key && key !== "(空)") : [];
    if (entries.length) {
      return entries
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => ({ label: `${status}（${formatQty(count)}）`, value: status }));
    }
    return JST_STATUS_OPTIONS.map((value) => ({ label: value, value }));
  }, [unifiedSnapshot.statusBreakdown]);

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

  // cloud-only 单(无聚水潭 o_id):展开取官方逐SKU明细(erp_temu_openapi_consign.items_json)。
  const loadCloudItems = useCallback(async (row: ConsignDeliverUnifiedRow) => {
    const oId = row.rawJst?.o_id ? String(row.rawJst.o_id) : "";
    if (oId) return; // 有聚水潭单走聚水潭明细，不取官方
    const key = row.soId || "";
    const mallId = row.rawCloud?.mall_id ? String(row.rawCloud.mall_id) : "";
    if (!key || !mallId || !erp?.consignDeliver?.cloudItems) return;
    if (cloudItemsCache[key] || cloudItemsLoading[key]) return;
    setCloudItemsLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const items = await erp.consignDeliver.cloudItems({ mallId, soId: key });
      setCloudItemsCache((prev) => ({ ...prev, [key]: Array.isArray(items) ? items : [] }));
    } catch (error: any) {
      message.error(error?.message || "官方明细加载失败");
    } finally {
      setCloudItemsLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, [cloudItemsCache, cloudItemsLoading]);

  // 保存某条明细的本地实发数量：写后端 + 乐观更新明细缓存与主表「送货数」之和。
  const handleSetItemShipQty = useCallback(async (row: ConsignDeliverUnifiedRow, item: any, nextQty: number) => {
    const oId = row.rawJst?.o_id != null ? String(row.rawJst.o_id) : "";
    const oiId = item?.oiId != null ? String(item.oiId) : "";
    if (!oId || !oiId || !erp?.inventory?.action) return;
    const planQty = Number(item.qty || 0);
    const clamped = Math.max(0, Math.min(Math.floor(Number(nextQty) || 0), planQty));
    setItemShipSaving((prev) => ({ ...prev, [oiId]: true }));
    try {
      await erp.inventory.action({ action: "consign_deliver_set_item_ship_qty", oId, oiId, shipQty: clamped });
      const prevList = unifiedItemsCache[oId] || [];
      const nextList = prevList.map((it) => (String(it.oiId) === oiId ? { ...it, localShipQty: clamped } : it));
      const sum = nextList.reduce(
        (acc, it) => acc + Number(it.localShipQty != null ? it.localShipQty : (it.qty || 0)),
        0,
      );
      setUnifiedItemsCache((prev) => ({ ...prev, [oId]: nextList }));
      setItemShipDraft((prev) => { const next = { ...prev }; delete next[oiId]; return next; });
      // 乐观更新主表该行送货数（明细本地实发之和），不必等物化快照重建。
      setUnifiedSnapshot((snap) => ({
        ...snap,
        rows: snap.rows.map((r) => (
          r.rawJst?.o_id != null && String(r.rawJst.o_id) === oId ? { ...r, localShipQty: sum } : r
        )),
      }));
      message.success("已更新实发数量");
    } catch (error: any) {
      message.error(error?.message || "更新实发数量失败");
    } finally {
      setItemShipSaving((prev) => ({ ...prev, [oiId]: false }));
    }
  }, [unifiedItemsCache]);

  const renderUnifiedRowItems = useCallback((row: ConsignDeliverUnifiedRow) => {
    const oId = row.rawJst?.o_id ? String(row.rawJst.o_id) : "";
    if (!oId) {
      // cloud-only 单:显示官方逐SKU明细(货号/规格/备货数/成本)。无本地发货编辑(聚水潭无此单,不能本地扣库存)。
      const ck = row.soId || "";
      if (cloudItemsLoading[ck]) return <Spin size="small" />;
      const ci = cloudItemsCache[ck];
      if (!ci) return <Text type="secondary">展开后加载中...</Text>;
      if (!ci.length) return <Text type="secondary">仅云端数据，官方备货单未含 SKU 明细</Text>;
      const fmtC = (v: any) => (v != null && v !== "" ? `¥${Number(v).toFixed(2)}` : "-");
      const cloudCols: ColumnsType<any> = [
        { title: "商品", key: "p", width: 300, render: (_v, it: any) => (
          <Space size={8} align="start">
            {it.picUrl ? <Image src={it.picUrl} width={40} height={40} style={{ objectFit: "cover", borderRadius: 4, cursor: "zoom-in" }} preview={{ mask: <EyeOutlined /> }} onClick={(e) => e.stopPropagation()} /> : null}
            <Paragraph ellipsis={{ rows: 2, tooltip: it.name || "-" }} style={{ marginBottom: 0, fontWeight: 600, lineHeight: 1.3, minWidth: 0 }}>{it.name || "-"}</Paragraph>
          </Space>
        ) },
        { title: "货号 / SKU", key: "s", width: 170, render: (_v, it: any) => (
          <Space direction="vertical" size={0}>
            <Text style={{ fontSize: 12 }}>货号 {it.iId || "-"}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>SKU {it.skuId || "-"}</Text>
          </Space>
        ) },
        { title: "规格", dataIndex: "propertiesValue", key: "spec", width: 180, render: (v: any) => v || "-" },
        { title: "备货数", dataIndex: "qty", key: "qty", width: 90, align: "right" as const, render: (v: any) => formatQty(v) },
        { title: "成本单价", dataIndex: "costPrice", key: "cp", width: 110, align: "right" as const, render: (v: any) => fmtC(v) },
        { title: "成本金额", dataIndex: "costAmount", key: "ca", width: 130, align: "right" as const, render: (v: any) => fmtC(v) },
      ];
      return <Table className="erp-compact-table" rowKey={(it, i) => String(it.skuId || i)} size="small" columns={cloudCols} dataSource={ci} pagination={false} />;
    }
    if (unifiedItemsLoading[oId]) return <Spin size="small" />;
    const items = unifiedItemsCache[oId];
    if (!items) return <Text type="secondary">展开后加载中...</Text>;
    if (!items.length) return <Text type="secondary">无明细</Text>;
    // 明细列：对齐「其他出入库」明细（OtherInoutSection）的列布局与风格。
    const fmtMoney = (v: any) => (v != null && v !== "" ? `¥${Number(v).toFixed(2)}` : "-");
    const itemColumns: ColumnsType<any> = [
      {
        title: "商品",
        key: "product",
        width: 280,
        render: (_v, it: any) => (
          <Space size={8} align="start">
            {it.picUrl ? (
              <Image
                src={it.picUrl}
                alt=""
                width={40}
                height={40}
                style={{ objectFit: "cover", borderRadius: 4, cursor: "zoom-in" }}
                preview={{ mask: <EyeOutlined /> }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : null}
            <Paragraph ellipsis={{ rows: 2, tooltip: it.name || "-" }} style={{ marginBottom: 0, fontWeight: 600, lineHeight: 1.3, minWidth: 0 }}>
              {it.name || "-"}
            </Paragraph>
          </Space>
        ),
      },
      {
        title: "货号 / SKU",
        key: "iidSku",
        width: 160,
        render: (_v, it: any) => (
          <Space direction="vertical" size={0}>
            <Text style={{ fontSize: 12 }}>货号 {it.iId || "-"}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>SKU {it.skuId || "-"}</Text>
          </Space>
        ),
      },
      { title: "规格", dataIndex: "propertiesValue", key: "spec", width: 180, render: (v) => v || "-" },
      { title: "备货数", dataIndex: "qty", key: "qty", width: 90, align: "right" as const, render: (v) => formatQty(v) },
      {
        // 本地实发数量：默认 = 备货数（全发），可改小。改后驱动确认发货按实发扣本地库存。
        // 已确认发货（row.inventoryDeducted）时锁定，需先撤销发货才能改。
        title: "发货数量",
        key: "shipQty",
        width: 130,
        align: "right" as const,
        render: (_v, it: any) => {
          const oiId = it.oiId != null ? String(it.oiId) : "";
          const planQty = Number(it.qty || 0);
          const stored = it.localShipQty != null ? Number(it.localShipQty) : planQty;
          const current = itemShipDraft[oiId] != null ? Number(itemShipDraft[oiId]) : stored;
          const locked = Boolean(row.inventoryDeducted);
          const commit = (next: number | null) => {
            if (next == null) return;
            if (next !== stored) void handleSetItemShipQty(row, it, next);
          };
          return (
            <InputNumber
              size="small"
              min={0}
              max={planQty}
              precision={0}
              value={current}
              disabled={locked || !canCreateOutbound || Boolean(itemShipSaving[oiId])}
              status={current < planQty ? "warning" : undefined}
              style={{ width: 110 }}
              onChange={(val) => setItemShipDraft((prev) => ({ ...prev, [oiId]: (val as number) ?? 0 }))}
              onBlur={() => commit(itemShipDraft[oiId] ?? null)}
              onPressEnter={() => commit(itemShipDraft[oiId] ?? null)}
            />
          );
        },
      },
      { title: "成本单价", dataIndex: "costPrice", key: "costPrice", width: 110, align: "right" as const, render: (v) => fmtMoney(v) },
      { title: "成本金额", dataIndex: "costAmount", key: "costAmount", width: 130, align: "right" as const, render: (v) => fmtMoney(v) },
      // 供应商不设宽度，撑满剩余宽度让明细铺满整行。
      { title: "供应商", key: "supplier", render: () => row.supplierName || "-" },
    ];
    return (
      <div className="consign-item-detail">
        <Image.PreviewGroup>
          <Table
            className="erp-compact-table"
            rowKey={(it: any) => String(it.oiId || it.id || `${it.skuId}-${it.skuCode}`)}
            size="small"
            columns={itemColumns}
            dataSource={items}
            pagination={false}
          />
        </Image.PreviewGroup>
      </div>
    );
  }, [unifiedItemsCache, unifiedItemsLoading, cloudItemsCache, cloudItemsLoading, itemShipDraft, itemShipSaving, handleSetItemShipQty, canCreateOutbound]);

  // 本地确认发货 / 撤销：对应后端 inventory.action consign_deliver_ship / consign_deliver_unship。
  const handleConsignShip = useCallback(async (row: ConsignDeliverUnifiedRow, ship: boolean) => {
    if (!erp?.inventory?.action) { message.error("ERP 接口未就绪"); return; }
    const oId = row.rawJst?.o_id;
    if (!oId) { message.error("该行无聚水潭送仓单，无法确认发货"); return; }
    setActingKey(`consign-${oId}`);
    try {
      const result = await erp.inventory.action({
        action: ship ? "consign_deliver_ship" : "consign_deliver_unship",
        oId,
      });
      if (result?.idempotent) {
        message.info(result?.message || (ship ? "已扣过本地库存，未重复扣减" : "未扣减，无需撤销"));
      } else {
        message.success(result?.message || (ship ? "已发货，本地库存已扣减" : "已撤销发货，本地库存已回补"));
      }
      void loadUnified({
        page: unifiedPage,
        pageSize: unifiedPageSize,
        search: stockQuery,
        status: stockStatus,
        shop: stockShop,
        skuCode: stockSkuCode,
        dateFrom: consignDateBound(stockDateRange?.[0], false),
        dateTo: consignDateBound(stockDateRange?.[1], true),
        source: unifiedSource,
      });
    } catch (error: any) {
      message.error(error?.message || (ship ? "确认发货失败" : "撤销失败"));
    } finally {
      setActingKey(null);
    }
  }, [erp, loadUnified, unifiedPage, unifiedPageSize, stockQuery, stockStatus, stockShop, stockSkuCode, stockDateRange, unifiedSource]);

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
      // 数量 = Temu 备货单商品总数（demand_qty）；无云端数据的纯聚水潭行回退聚水潭件数。
      title: "数量",
      key: "qty",
      width: 110,
      align: "right" as const,
      render: (_value, row) => {
        const demand = row.rawCloud?.demand_qty != null ? row.rawCloud.demand_qty : row.itemsQty;
        return <Text strong>{formatQty(demand)} 件</Text>;
      },
    },
    {
      // 送货数 = 本地实发之和（明细 local_ship_qty 之和，默认全发=备货数，可在展开明细逐条改）。
      // 纯云端行无聚水潭明细，回退展示 Temu 平台「已送货」delivered_qty 作参考（带「平台」字样）。
      title: "送货数",
      key: "deliveredQty",
      width: 110,
      align: "right" as const,
      render: (_value, row) => {
        if (row.localShipQty != null) return <Text>{formatQty(row.localShipQty)}</Text>;
        if (row.rawCloud?.delivered_qty != null) {
          return <Text type="secondary">{formatQty(row.rawCloud.delivered_qty)}（平台）</Text>;
        }
        return <Text type="secondary">-</Text>;
      },
    },
    {
      title: "入库数",
      key: "inboundQty",
      width: 100,
      align: "right" as const,
      render: (_value, row) => (
        row.rawCloud?.inbound_qty != null
          ? <Text>{formatQty(row.rawCloud.inbound_qty)}</Text>
          : <Text type="secondary">-</Text>
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
      render: (_value, row) =>
        row.rawCloud?.receive_warehouse_name || row.rawCloud?.warehouse_group || "-",
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
    {
      title: "本地发货",
      key: "shipAction",
      width: 140,
      fixed: "right" as const,
      render: (_value, row) => {
        // 只有带聚水潭送仓单(jst/both)的行能扣本地库存；cloud-only 备货单行不可。
        if (!row.rawJst?.o_id) return <Text type="secondary">-</Text>;
        const busy = actingKey === `consign-${row.rawJst.o_id}`;
        if (row.inventoryDeducted) {
          return (
            <Button
              size="small"
              danger
              loading={busy}
              disabled={!canCreateOutbound}
              onClick={() => handleConsignShip(row, false)}
            >
              撤销发货
            </Button>
          );
        }
        return (
          <Button
            size="small"
            type="primary"
            loading={busy}
            disabled={!canCreateOutbound}
            onClick={() => handleConsignShip(row, true)}
          >
            确认发货
          </Button>
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
  }, [accounts.length, actingKey, canCreateOutbound, handleConsignShip, openUnifiedColumnMenu, resolveUnifiedRowLink, unifiedColumnConfig]);

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
                  shop: stockShop,
                  skuCode: stockSkuCode,
                  dateFrom: consignDateBound(stockDateRange?.[0], false),
                  dateTo: consignDateBound(stockDateRange?.[1], true),
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
                  <Input
                    allowClear
                    placeholder="店铺"
                    style={{ width: 160 }}
                    value={stockShop}
                    onChange={(event) => {
                      setStockShop(event.target.value);
                      setUnifiedPage(1);
                    }}
                  />
                  <Input
                    allowClear
                    placeholder="商品编码"
                    style={{ width: 160 }}
                    value={stockSkuCode}
                    onChange={(event) => {
                      setStockSkuCode(event.target.value);
                      setUnifiedPage(1);
                    }}
                  />
                  <RangePicker
                    placeholder={["下单开始", "下单结束"]}
                    style={{ width: 250 }}
                    value={stockDateRange}
                    onChange={(value) => {
                      setStockDateRange(value);
                      setUnifiedPage(1);
                    }}
                  />
                  <Select
                    allowClear
                    placeholder="按状态过滤"
                    style={{ width: 180 }}
                    value={stockStatus || undefined}
                    options={statusFilterOptions}
                    getPopupContainer={(trigger) => trigger.parentElement || document.body}
                    onChange={(value) => {
                      setStockStatus(value || "");
                      setUnifiedPage(1);
                    }}
                  />
                </div>
                <Table
                  className="erp-compact-table consign-unified-table"
                  rowKey={(row) => row.soId || JSON.stringify(row)}
                  size="middle"
                  loading={unifiedLoading}
                  columns={cloudStockColumns}
                  dataSource={unifiedRows}
                  scroll={{ x: 2560 }}
                  // 悬停即后台预取明细，点开时多半已缓存，避免每次展开都等一次跨区请求。
                  onRow={(row) => ({ onMouseEnter: () => { void loadUnifiedItems(row); void loadCloudItems(row); } })}
                  expandable={{
                    expandedRowRender: (row) => renderUnifiedRowItems(row),
                    onExpand: (expanded, row) => { if (expanded) { void loadUnifiedItems(row); void loadCloudItems(row); } },
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
            key: "other-inout",
            label: "其他出入库",
            children: <OtherInoutSection />,
          },
        ]}
      />

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
