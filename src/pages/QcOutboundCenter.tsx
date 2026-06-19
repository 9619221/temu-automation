import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
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
  Popover,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  EyeOutlined,
  HolderOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import dayjs from "dayjs";
import { useSessionState } from "../hooks/useSessionState";
import PageHeader from "../components/PageHeader";
import OtherInoutSection from "../components/OtherInoutSection";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { readPageCache, writePageCache } from "../utils/pageCache";
import type { TemuStockOrderRow } from "../utils/cloudClient";

const { Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;
const erp = window.electronAPI?.erp;

function cleanIpcError(e: any): string {
  return String(e?.message || e || "未知错误").replace(/^Error invoking remote method '[^']+':\s*/i, "").replace(/^Error:\s*/i, "").trim() || "未知错误";
}

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
  receive_address_json?: string | null;
  send_address_json?: string | null;
  thumb_url?: string | null;
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
  receiver_state?: string | null;
  receiver_city?: string | null;
  receiver_district?: string | null;
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
  statusBreakdown?: Record<string, number>;
  onlineStatusBreakdown?: Record<string, number>;
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
const TEMU_ONLINE_STATUS_OPTIONS = ["已付款待审核", "待发货", "已发货", "已收货", "取消", "异常", "其他"];

// v3：新增「送货数」「入库数」独立列。升版本让旧客户端的列配置重置为含新列的全可见默认，
// 否则旧 localStorage 的 visible 不含新 key，新列默认隐藏、用户仍看不到。
const UNIFIED_COLUMN_ORDER_STORAGE_KEY = "temu.consign.unified.columnOrder.v5";
const UNIFIED_CONFIGURABLE_COLUMN_KEYS = [
  "thumb",
  "onlineStatus",
  "erpStatus",
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
  thumb: "商品图片",
  onlineStatus: "线上状态",
  erpStatus: "erp状态",
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

function stockStatusCellStyle(status?: string | null): { bg: string; color: string } {
  const s = String(status || "");
  if (!s) return { bg: "#f5f5f5", color: "#bfbfbf" };
  if (/取消|cancel/i.test(s)) return { bg: "#cf1322", color: "#fff" };
  if (/已入库/i.test(s)) return { bg: "#389e0d", color: "#fff" };
  if (/已收货/i.test(s)) return { bg: "#08979c", color: "#fff" };
  if (/已发货|已发|shipped/i.test(s)) return { bg: "#16a34a", color: "#fff" };
  if (/发货中/i.test(s)) return { bg: "#e6f7ff", color: "#096dd9" };
  if (/待发货/i.test(s)) return { bg: "#bae0ff", color: "#003a8c" };
  if (/待接单/i.test(s)) return { bg: "#fa8c16", color: "#fff" };
  if (/已付款待审核/i.test(s)) return { bg: "#ffe58f", color: "#614700" };
  if (/待|未|pending|wait/i.test(s)) return { bg: "#faad14", color: "#fff" };
  if (/完成|done|complete/i.test(s)) return { bg: "#389e0d", color: "#fff" };
  if (/其他/i.test(s)) return { bg: "#722ed1", color: "#fff" };
  return { bg: "#597ef7", color: "#fff" };
}

function SortableColumnItem({
  field,
  checked,
  lockLast,
  onToggle,
}: {
  field: string;
  checked: boolean;
  lockLast: boolean;
  onToggle: (field: string, checked: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="consign-col-cfg__item">
      <HolderOutlined className="consign-col-cfg__handle" {...attributes} {...listeners} />
      <Checkbox
        className="consign-col-cfg__check"
        checked={checked}
        disabled={lockLast}
        onChange={(event) => onToggle(field, event.target.checked)}
      >
        {UNIFIED_COLUMN_LABELS[field] || field}
      </Checkbox>
    </div>
  );
}

function UnifiedColumnSettings({
  order,
  visible,
  onToggle,
  onReorder,
  onRestore,
}: {
  order: string[];
  visible: string[];
  onToggle: (field: string, checked: boolean) => void;
  onReorder: (newOrder: string[]) => void;
  onRestore: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = order.indexOf(active.id as string);
      const newIndex = order.indexOf(over.id as string);
      if (oldIndex !== -1 && newIndex !== -1) {
        onReorder(arrayMove(order, oldIndex, newIndex));
      }
    }
  }, [order, onReorder]);

  return (
    <div className="consign-col-cfg">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="consign-col-cfg__list">
            {order.map((field) => {
              const checked = visible.includes(field);
              const lockLast = checked && visible.length <= 1;
              return (
                <SortableColumnItem
                  key={field}
                  field={field}
                  checked={checked}
                  lockLast={lockLast}
                  onToggle={onToggle}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      <div className="consign-col-cfg__foot">
        <span className="consign-col-cfg__hint">拖动调整顺序</span>
        <Button type="link" size="small" onClick={onRestore}>
          还原默认
        </Button>
      </div>
    </div>
  );
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
  // 会话级视图状态 key：切走再切回出库中心时恢复筛选 / 分页 / 标签，重启软件清空。
  const qcViewKey = (suffix: string) => `temu.qc-outbound.${suffix}`;
  const [unifiedPage, setUnifiedPage] = useSessionState(qcViewKey("page"), 1);
  const [unifiedPageSize, setUnifiedPageSize] = useSessionState(qcViewKey("pageSize"), UNIFIED_DEFAULT_PAGE_SIZE);
  const unifiedSource: "all" | UnifiedRowSource = "all";
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useSessionState(qcViewKey("tab"), "cloud");
  const [stockStatus, setStockStatus] = useSessionState(qcViewKey("status"), "");
  const [onlineStatus, setOnlineStatus] = useSessionState(qcViewKey("onlineStatus"), "");
  const [stockShop, setStockShop] = useSessionState(qcViewKey("shop"), "");
  const [mallOptions, setMallOptions] = useState<{ value: string; label: string }[]>([]);
  const [stockSkuCode, setStockSkuCode] = useSessionState(qcViewKey("skuCode"), "");
  const [stockDateRange, setStockDateRange] = useSessionState<any>(qcViewKey("dateRange"), null, {
    serialize: (value) =>
      Array.isArray(value) && value[0] && value[1]
        ? [value[0].toISOString?.() ?? null, value[1].toISOString?.() ?? null]
        : null,
    deserialize: (raw) =>
      Array.isArray(raw) && raw[0] && raw[1] ? [dayjs(raw[0]), dayjs(raw[1])] : null,
  });
  const [stockQuery, setStockQuery] = useSessionState(qcViewKey("query"), "");
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
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
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
    onlineStatus?: string;
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
        onlineStatus: params.onlineStatus || undefined,
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
    erp?.reports?.mallDict?.().then((resp: any) => {
      const malls: any[] = resp?.data?.malls || resp?.malls || [];
      setMallOptions(
        malls
          .filter((m: any) => m.store_code && m.status !== "test")
          .sort((a: any, b: any) => (a.store_code || "").localeCompare(b.store_code || ""))
          .map((m: any) => ({ value: m.store_code, label: `${m.store_code}店铺` })),
      );
    }).catch(() => {});
  }, []);

  useEffect(() => {
    void loadUnified({
      page: unifiedPage,
      pageSize: unifiedPageSize,
      search: stockQuery,
      status: stockStatus,
      onlineStatus,
      shop: stockShop,
      skuCode: stockSkuCode,
      dateFrom: consignDateBound(stockDateRange?.[0], false),
      dateTo: consignDateBound(stockDateRange?.[1], true),
      source: unifiedSource,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unifiedPage, unifiedPageSize, stockQuery, stockStatus, onlineStatus, stockShop, stockSkuCode, stockDateRange, unifiedSource]);

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
        onlineStatus,
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
  const hasServerOnlineFilter = !!unifiedSnapshot.onlineStatusBreakdown && Object.keys(unifiedSnapshot.onlineStatusBreakdown).length > 0;
  const unifiedRows = useMemo(() => {
    const rows = unifiedSnapshot.rows;
    if (!onlineStatus || hasServerOnlineFilter) return rows;
    return rows.filter((r) => r.rawCloud?.temu_status === onlineStatus);
  }, [unifiedSnapshot.rows, onlineStatus, hasServerOnlineFilter]);
  const unifiedTotal = (!onlineStatus || hasServerOnlineFilter) ? unifiedSnapshot.total : unifiedRows.length;

  const erpStatusFilterOptions = useMemo(() => {
    const breakdown = unifiedSnapshot.statusBreakdown;
    const entries = breakdown ? Object.entries(breakdown).filter(([key]) => key && key !== "(空)") : [];
    if (entries.length) {
      return entries
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => ({ label: `${status}（${formatQty(count)}）`, value: status }));
    }
    return JST_STATUS_OPTIONS.map((value) => ({ label: value, value }));
  }, [unifiedSnapshot.statusBreakdown]);

  const onlineStatusFilterOptions = useMemo(() => {
    const breakdown = unifiedSnapshot.onlineStatusBreakdown;
    const entries = breakdown ? Object.entries(breakdown).filter(([key]) => key && key !== "(空)") : [];
    if (entries.length) {
      return entries
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => ({ label: `${status}（${formatQty(count)}）`, value: status }));
    }
    return TEMU_ONLINE_STATUS_OPTIONS.map((value) => ({ label: value, value }));
  }, [unifiedSnapshot.onlineStatusBreakdown]);

  // 列配置即时生效：所有改动直接写入 unifiedColumnConfig + localStorage，无草稿、无「保存」按钮。
  const persistUnifiedColumnConfig = useCallback((next: UnifiedColumnConfig) => {
    try {
      window.localStorage.setItem(UNIFIED_COLUMN_ORDER_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage 仅做便利保存，失败也不影响表格布局
    }
  }, []);

  // 勾选/取消某列（至少保留 1 列可见），即时反映到表格。
  const toggleUnifiedColumn = useCallback((field: string, checked: boolean) => {
    setUnifiedColumnConfig((prev) => {
      const current = normalizeUnifiedColumnConfig(prev);
      const visible = new Set(current.visible);
      if (checked) visible.add(field);
      else if (visible.size > 1) visible.delete(field);
      const next = { ...current, visible: current.order.filter((key) => visible.has(key)) };
      persistUnifiedColumnConfig(next);
      return next;
    });
  }, [persistUnifiedColumnConfig]);

  const commitUnifiedColumnDrag = useCallback((newOrder: string[]) => {
    setUnifiedColumnConfig((prev) => {
      const current = normalizeUnifiedColumnConfig(prev);
      const next = { ...current, order: newOrder };
      persistUnifiedColumnConfig(next);
      return next;
    });
  }, [persistUnifiedColumnConfig]);

  const restoreUnifiedColumnConfig = useCallback(() => {
    const next = defaultUnifiedColumnConfig();
    setUnifiedColumnConfig(next);
    persistUnifiedColumnConfig(next);
  }, [persistUnifiedColumnConfig]);

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

  // 整页明细预取：列表一加载好，就在后台「限并发」把当前页每行的商品明细提前捞回缓存。
  // 背景：桌面端是客户端，展开某行时明细要现连主控端(跨海)取，单行常等一两秒(见「展开后加载中...」)。
  // 这里趁列表到手先静默预取，用户展开任意一行即命中本地缓存、秒开。
  // 复用 loadUnifiedItems/loadCloudItems(两者均自带「命中缓存/加载中即跳过」保护，不会重复请求)。
  // 翻页或改筛选会让 unifiedRows 变化，旧预取经 cancelled 立即中断，避免堆积无用请求拖累主控端单进程。
  useEffect(() => {
    if (!unifiedRows.length) return;
    let cancelled = false;
    const PARALLEL = 2;          // 限并发 4→2：明细点查虽快，但主控端单进程被采购工作台等重查询占满时，4 路并发会放大瞬时排队压力；2 路够预热又更克制
    const MAX_PREFETCH = 150;    // 上限 300→150：一屏可见也就十几行，预取太多只是徒增主控端负载；其余仍靠鼠标悬停/展开兜底
    const targets = unifiedRows.slice(0, MAX_PREFETCH);
    let cursor = 0;
    const runners = Array.from({ length: Math.min(PARALLEL, targets.length) }, async () => {
      while (cursor < targets.length && !cancelled) {
        const row = targets[cursor++];
        try {
          await loadUnifiedItems(row);   // 有聚水潭 o_id 的走这条；另一条内部 guard 直接跳过
          await loadCloudItems(row);     // cloud-only 单(无 o_id)走这条
        } catch { /* 单行预取失败忽略,不影响其余行 */ }
      }
    });
    void Promise.all(runners);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unifiedRows]);

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

  // cloud-only 单某 SKU(productSkuId)的本地实发数量：写后端 + 乐观更新明细缓存与主表「送货数」之和(仿 handleSetItemShipQty)。
  const handleSetCloudItemShipQty = useCallback(async (row: ConsignDeliverUnifiedRow, item: any, nextQty: number) => {
    const mallId = row.rawCloud?.mall_id ? String(row.rawCloud.mall_id) : "";
    const soId = row.soId || "";
    const skuKey = item?.skuId != null ? String(item.skuId) : "";
    if (!mallId || !soId || !skuKey || !erp?.inventory?.action) return;
    const planQty = Number(item.qty || 0);
    const clamped = Math.max(0, Math.min(Math.floor(Number(nextQty) || 0), planQty));
    const savingKey = `cloud:${soId}:${skuKey}`;
    setItemShipSaving((prev) => ({ ...prev, [savingKey]: true }));
    try {
      await erp.inventory.action({ action: "consign_deliver_cloud_set_item_ship_qty", mallId, soId, skuKey, shipQty: clamped });
      const prevList = cloudItemsCache[soId] || [];
      const nextList = prevList.map((it) => (String(it.skuId) === skuKey ? { ...it, localShipQty: clamped } : it));
      const sum = nextList.reduce(
        (acc, it) => acc + Number(it.localShipQty != null ? it.localShipQty : (it.qty || 0)),
        0,
      );
      setCloudItemsCache((prev) => ({ ...prev, [soId]: nextList }));
      setItemShipDraft((prev) => { const next = { ...prev }; delete next[savingKey]; return next; });
      // 乐观更新主表该行送货数（明细本地实发之和），不必等物化快照重建。
      setUnifiedSnapshot((snap) => ({
        ...snap,
        rows: snap.rows.map((r) => (
          r.source === "cloud" && r.soId === soId ? { ...r, localShipQty: sum } : r
        )),
      }));
      message.success("已更新实发数量");
    } catch (error: any) {
      message.error(error?.message || "更新实发数量失败");
    } finally {
      setItemShipSaving((prev) => ({ ...prev, [savingKey]: false }));
    }
  }, [cloudItemsCache, erp]);

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
        {
          // cloud 单逐 SKU 本地实发数量（默认 = 备货数，可改小，驱动确认发货按实发扣本地库存）。已确认发货时锁定。
          title: "发货数量",
          key: "shipQty",
          width: 130,
          align: "right" as const,
          render: (_v: any, it: any) => {
            const skuKey = it.skuId != null ? String(it.skuId) : "";
            const planQty = Number(it.qty || 0);
            const stored = it.localShipQty != null ? Number(it.localShipQty) : planQty;
            const dk = `cloud:${ck}:${skuKey}`;
            const current = itemShipDraft[dk] != null ? Number(itemShipDraft[dk]) : stored;
            const locked = Boolean(row.inventoryDeducted);
            const commit = (next: number | null) => { if (next == null) return; if (next !== stored) void handleSetCloudItemShipQty(row, it, next); };
            return (
              <InputNumber
                size="small"
                min={0}
                max={planQty}
                precision={0}
                value={current}
                disabled={locked || !canCreateOutbound || Boolean(itemShipSaving[dk])}
                status={current < planQty ? "warning" : undefined}
                style={{ width: 110 }}
                onChange={(val) => setItemShipDraft((prev) => ({ ...prev, [dk]: (val as number) ?? 0 }))}
                onBlur={() => commit(itemShipDraft[dk] ?? null)}
                onPressEnter={() => commit(itemShipDraft[dk] ?? null)}
              />
            );
          },
        },
        { title: "成本单价", dataIndex: "costPrice", key: "cp", width: 110, align: "right" as const, render: (v: any) => fmtC(v) },
        { title: "成本金额", dataIndex: "costAmount", key: "ca", width: 130, align: "right" as const, render: (v: any) => fmtC(v) },
      ];
      // 与聚水潭单明细一致套 .consign-item-detail：复用 global.css 的 width:100%+table-layout:fixed，
      // 让列按 width 规整铺满容器，避免裸表在 table-layout:auto 下被超长商品名撑爆、把右侧成本列挤出裁掉。
      return (
        <div className="consign-item-detail">
          <Image.PreviewGroup>
            <Table className="erp-compact-table" rowKey={(it, i) => String(it.skuId || i)} size="small" columns={cloudCols} dataSource={ci} pagination={false} />
          </Image.PreviewGroup>
        </div>
      );
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
  }, [unifiedItemsCache, unifiedItemsLoading, cloudItemsCache, cloudItemsLoading, itemShipDraft, itemShipSaving, handleSetItemShipQty, handleSetCloudItemShipQty, canCreateOutbound]);

  // ── 官方发货工作流（勾选 + 批量按钮）：加入发货台 → 创建发货单 → 确认发货 ──
  const [selectedShipKeys, setSelectedShipKeys] = useState<string[]>([]);
  // 本会话发货状态：soId → { stage:'staged'|'created'|'shipped', deliveryOrderSn, subWarehouseId, receiveAddressInfo, deliveryAddressId, expressBatchSn }
  const [officialShipState, setOfficialShipState] = useState<Record<string, any>>({});
  const [shipBatchBusy, setShipBatchBusy] = useState(false);
  // 确认发货弹窗：逐单选快递+重量
  const [confirmShipOpen, setConfirmShipOpen] = useState(false);
  const [confirmShipRows, setConfirmShipRows] = useState<any[]>([]);
  // 创建发货单弹窗：选择发货仓库 + 包裹拆分
  const [createShipModal, setCreateShipModal] = useState<{
    open: boolean;
    loading: boolean;
    rows: ConsignDeliverUnifiedRow[];
    addresses: Array<{ id: string; isDefault: boolean; label: string }>;
    selectedAddressId: string;
    // 单单模式：SKU 明细 + 包裹分配
    skus: Array<{ productSkuId: number; qty: number; skuName: string; spec: string }>;
    packages: Array<Array<{ productSkuId: number; skuNum: number }>>;
    // 多单模式：简单包裹数
    packageCount: number;
  } | null>(null);
  // 装箱弹窗：查看/编辑某发货单的分箱（单箱模式，改各 SKU 发货数量）。
  const [packageModal, setPackageModal] = useState<{ open: boolean; soId: string; mallId: string; deliveryOrderSn: string; loading: boolean; saving: boolean; rows: Array<{ productSkuId: string; skuNum: number }> } | null>(null);

  // 勾选行里属于「官方单」（有店铺 + 备货单号）的行。
  const selectedShipRows = useMemo(
    () => unifiedRows.filter((r) => r.soId && selectedShipKeys.includes(r.soId) && r.rawCloud?.mall_id),
    [unifiedRows, selectedShipKeys],
  );

  // 官方发货阶段：优先本会话 state，回退 rawCloud 线上/erp 字段。
  const getShipStage = useCallback((row: ConsignDeliverUnifiedRow): "none" | "staged" | "created" | "shipped" => {
    const st = row.soId ? officialShipState[row.soId] : null;
    if (st?.stage) return st.stage;
    if (row.rawCloud?.delivery_batch_sn) return "shipped";
    const ts = row.rawCloud?.temu_status || "";
    if (ts.includes("已发货") || ts.includes("已收货")) return "shipped";
    if (row.rawCloud?.delivery_order_sn) return "created";
    return "none";
  }, [officialShipState]);

  // 批量「加入发货台」：对勾选官方单串行 staging.add。
  const handleBatchStaging = useCallback(async () => {
    if (!erp?.inventory?.action) { message.error("ERP 接口未就绪"); return; }
    const rows = selectedShipRows;
    if (!rows.length) { message.warning("请先勾选官方单"); return; }
    const SHIPPED_STATUSES = ["已发货", "已收货", "已入库", "取消"];
    const eligible = rows.filter((r) => { const s = r.rawCloud?.temu_status || ""; return s && !SHIPPED_STATUSES.some((x) => s.includes(x)); });
    const skipped = rows.length - eligible.length;
    if (!eligible.length) { message.warning(`所选 ${rows.length} 单均已发货或已取消，无法加入发货台`); return; }
    if (skipped) message.info(`跳过 ${skipped} 单（已发货/已取消），处理 ${eligible.length} 单`);
    setShipBatchBusy(true);
    const hide = message.loading(`加入发货台中…（${eligible.length} 单）`, 0);
    let ok = 0, already = 0, fail = 0; const fails: string[] = [];
    for (const row of eligible) {
      try {
        const r = await erp.inventory.action({ action: "consign_official_staging_add", mallId: String(row.rawCloud!.mall_id), soId: row.soId });
        if (r?.alreadyIn) already++; else ok++;
        setOfficialShipState((s) => {
          const prev = s[row.soId!]?.stage;
          return { ...s, [row.soId!]: { ...(s[row.soId!] || {}), stage: prev === "created" || prev === "shipped" ? prev : "staged" } };
        });
      } catch (e: any) { fail++; fails.push(`${row.soId}: ${cleanIpcError(e)}`); }
    }
    hide();
    setShipBatchBusy(false);
    const summary = `加入发货台完成：新加 ${ok}、已在台 ${already}、失败 ${fail}${skipped ? `、跳过 ${skipped}` : ""}`;
    if (fail) message.warning(`${summary}。${fails.join("；")}`, 8);
    else message.success(summary);
  }, [selectedShipRows, erp]);

  // 打开「创建发货单」弹窗：筛选可处理行 + 加载发货仓库 + SKU 明细。
  const openCreateShipModal = useCallback(async () => {
    if (!erp?.inventory?.action) { message.error("ERP 接口未就绪"); return; }
    const rows = selectedShipRows;
    if (!rows.length) { message.warning("请先勾选官方单"); return; }
    const SHIPPED_STATUSES = ["已发货", "已收货", "已入库", "取消"];
    const eligible = rows.filter((r) => { const s = r.rawCloud?.temu_status || ""; return s && !SHIPPED_STATUSES.some((x) => s.includes(x)); });
    const skipped = rows.length - eligible.length;
    if (!eligible.length) { message.warning(`所选 ${rows.length} 单均已发货或已取消，无法创建发货单`); return; }
    if (skipped) message.info(`跳过 ${skipped} 单（已发货/已取消），处理 ${eligible.length} 单`);
    const init = { open: true, loading: true, rows: eligible, addresses: [] as any[], selectedAddressId: "", skus: [] as any[], packages: [] as any[][], packageCount: 1 };
    setCreateShipModal(init);
    try {
      const firstMallId = String(eligible[0].rawCloud!.mall_id);
      const soId0 = eligible[0].soId || "";
      const preview = await erp.inventory.action({ action: "consign_official_ship_preview", mallId: firstMallId, soId: soId0 }).catch(() => null);
      const addrs = (preview?.sendAddresses || []).map((a: any) => ({
        id: String(a.id),
        isDefault: Boolean(a.isDefault),
        label: [a.addressLabel, a.provinceName, a.cityName, a.districtName, a.addressDetail].filter(Boolean).join(" "),
      }));
      const defaultAddr = addrs.find((a: any) => a.isDefault) || addrs[0];
      let itemsArr: any[] = [];
      if (eligible.length === 1) {
        itemsArr = cloudItemsCache[soId0] || [];
        if (!itemsArr.length && erp.consignDeliver?.cloudItems) {
          itemsArr = await erp.consignDeliver.cloudItems({ mallId: firstMallId, soId: soId0 }).catch(() => []);
          if (!Array.isArray(itemsArr)) itemsArr = [];
        }
      }
      const skus = itemsArr.filter((it: any) => it.skuId && Number(it.qty) > 0).map((it: any) => ({ productSkuId: Number(it.skuId), qty: Number(it.qty), skuName: it.name || "", spec: it.propertiesValue || "" }));
      const defaultPkg = skus.map((s: any) => ({ productSkuId: s.productSkuId, skuNum: s.qty }));
      setCreateShipModal((s) => s ? { ...s, loading: false, addresses: addrs, selectedAddressId: defaultAddr?.id || "", skus, packages: defaultPkg.length ? [defaultPkg] : [] } : s);
    } catch (e: any) {
      message.warning(`加载数据失败：${cleanIpcError(e)}`);
      setCreateShipModal((s) => s ? { ...s, loading: false } : s);
    }
  }, [selectedShipRows, erp, cloudItemsCache]);

  // 确认创建发货单：按弹窗设置批量执行。
  const confirmCreateShip = useCallback(async () => {
    if (!erp?.inventory?.action || !createShipModal) return;
    const { rows, selectedAddressId, packages } = createShipModal;
    const isSingle = rows.length === 1 && packages.length > 0;
    if (isSingle) {
      const totalBySkuMap = new Map<number, number>();
      for (const s of createShipModal.skus) totalBySkuMap.set(s.productSkuId, s.qty);
      const allocBySkuMap = new Map<number, number>();
      for (const pkg of packages) for (const item of pkg) allocBySkuMap.set(item.productSkuId, (allocBySkuMap.get(item.productSkuId) || 0) + item.skuNum);
      for (const [id, need] of totalBySkuMap) {
        if ((allocBySkuMap.get(id) || 0) !== need) { message.error(`SKU ${id} 分配数量不等于实际发货数 ${need}`); return; }
      }
    }
    setCreateShipModal(null);
    setShipBatchBusy(true);
    const hide = message.loading(`创建发货单中…（${rows.length} 单）`, 0);
    let ok = 0, fail = 0; const fails: string[] = [];
    for (const row of rows) {
      try {
        const params: any = { action: "consign_official_ship_create", mallId: String(row.rawCloud!.mall_id), soId: row.soId, packageCount: isSingle ? packages.length : (createShipModal.packageCount || 1) };
        if (selectedAddressId) params.deliveryAddressId = selectedAddressId;
        if (isSingle) params.packages = packages.map((pkg) => pkg.filter((s) => s.skuNum > 0));
        console.log("[Ship] confirmCreateShip params:", JSON.stringify(params));
        const r = await erp.inventory.action(params);
        if (!r?.deliveryOrderSn) throw new Error("未返回发货单号");
        setOfficialShipState((s) => ({ ...s, [row.soId!]: { stage: "created", deliveryOrderSn: r.deliveryOrderSn, subWarehouseId: r.subWarehouseId, receiveAddressInfo: r.receiveAddressInfo, deliveryAddressId: r.deliveryAddressId } }));
        ok++;
      } catch (e: any) { fail++; fails.push(`${row.soId}: ${cleanIpcError(e)}`); }
    }
    hide();
    setShipBatchBusy(false);
    if (fail) message.warning(`创建发货单完成：成功 ${ok}、失败 ${fail}。${fails.slice(0, 3).join("；")}`);
    else message.success(`创建发货单完成：成功 ${ok} 单`);
    if (ok > 0) {
      void loadUnified({ page: unifiedPage, pageSize: unifiedPageSize, search: stockQuery, status: stockStatus, onlineStatus, shop: stockShop, skuCode: stockSkuCode, dateFrom: consignDateBound(stockDateRange?.[0], false), dateTo: consignDateBound(stockDateRange?.[1], true), source: unifiedSource });
    }
  }, [createShipModal, erp, loadUnified, unifiedPage, unifiedPageSize, stockQuery, stockStatus, onlineStatus, stockShop, stockSkuCode, stockDateRange, unifiedSource]);

  // 撤销单个发货单（发货信息列用）。
  const handleCancelShipOrderBySoId = useCallback(async (row: ConsignDeliverUnifiedRow) => {
    if (!erp?.inventory?.action || !row.soId || !row.rawCloud?.mall_id) return;
    const fh = officialShipState[row.soId]?.deliveryOrderSn || row.rawCloud?.delivery_order_sn;
    if (!fh) { message.error("无发货单号可撤销"); return; }
    try {
      await erp.inventory.action({ action: "consign_official_ship_cancel", mallId: String(row.rawCloud.mall_id), deliveryOrderSn: fh, soId: row.soId });
      message.success(`已撤销发货单 ${fh}`);
      setOfficialShipState((s) => { const n = { ...s }; delete n[row.soId!]; return n; });
    } catch (e: any) { message.error(cleanIpcError(e) || "撤销失败（刚创建的单需稍等几秒）"); }
  }, [officialShipState, erp]);

  // 发货信息列「物流下单」：对单个已创建FH的官方单做官方真发货（packing.send 选平台快递、平台揽收）。
  const openShipLogistics = useCallback(async (row: ConsignDeliverUnifiedRow) => {
    if (!erp?.inventory?.action || !row.soId || !row.rawCloud?.mall_id) return;
    const mallId = String(row.rawCloud.mall_id);
    const st = officialShipState[row.soId];
    let deliveryOrderSn = st?.deliveryOrderSn || row.rawCloud?.delivery_order_sn || "";
    let subWarehouseId = st?.subWarehouseId || "";
    let receiveAddressInfo = st?.receiveAddressInfo || null;
    let deliveryAddressId = st?.deliveryAddressId || "";
    if (!deliveryOrderSn) {
      const hide = message.loading("正在查找发货单号...", 0);
      try {
        const lookup = await erp.inventory.action({ action: "consign_official_shiporder_lookup", mallId, soId: row.soId });
        deliveryOrderSn = lookup?.deliveryOrderSn || "";
        if (lookup?.deliveryAddressId && !deliveryAddressId) deliveryAddressId = String(lookup.deliveryAddressId);
        if (lookup?.subWarehouseId && !subWarehouseId) subWarehouseId = String(lookup.subWarehouseId);
      } catch { /* ignore */ }
      hide();
      if (!deliveryOrderSn) { message.warning("该单还没有创建发货单，请先点「创建发货单」"); return; }
    }
    if (!subWarehouseId || !receiveAddressInfo) {
      try {
        const rAddr = row.rawCloud?.receive_address_json ? JSON.parse(row.rawCloud.receive_address_json) : null;
        if (rAddr) {
          receiveAddressInfo = rAddr;
        }
      } catch { /* ignore */ }
      if (!subWarehouseId || !receiveAddressInfo) {
        try {
          const preview = await erp.inventory.action({ action: "consign_official_ship_preview", mallId, soId: row.soId });
          if (preview?.receiveWarehouse) {
            subWarehouseId = subWarehouseId || String(preview.receiveWarehouse.subWarehouseId || "");
            if (!receiveAddressInfo) receiveAddressInfo = preview.receiveWarehouse;
          }
        } catch { /* ignore */ }
      }
    }
    if (!subWarehouseId || !receiveAddressInfo) { message.warning("无法获取子仓参数，请重新创建发货单后再试"); return; }
    const initRows = [{ soId: row.soId, mallId, deliveryOrderSn, deliveryAddressId, subWarehouseId, receiveAddressInfo, matched: [], selectedIdx: -1, weightKg: 1, packageNum: 1, loading: true, error: "" }];
    setConfirmShipRows(initRows);
    setConfirmShipOpen(true);
    const r0 = initRows[0];
    try {
      // 并行取预估体积 + 预估重量 + 发货仓名称（取不到不阻断匹配）。
      let predictVolume: any = null;
      let predictWeightKg: number | null = null;
      let sendAddressLabel = "";
      let sendAddresses: any[] = [];
      try {
        const [volRes, matchRes, previewRes] = await Promise.all([
          erp.inventory.action({ action: "consign_official_predict_volume", mallId: r0.mallId, deliveryOrderSn: r0.deliveryOrderSn }).catch(() => null),
          erp.inventory.action({ action: "consign_official_packing_match", mallId: r0.mallId, deliveryOrderSnList: [r0.deliveryOrderSn] }).catch(() => null),
          erp.inventory.action({ action: "consign_official_ship_preview", mallId: r0.mallId, soId: r0.soId }).catch(() => null),
        ]);
        predictVolume = volRes?.predictVolume ?? null;
        const pw = matchRes?.skuSumWeight;
        if (pw != null && Number(pw) > 0) predictWeightKg = Math.round(Number(pw)) / 1000;
        sendAddresses = previewRes?.sendAddresses || [];
        const matched = r0.deliveryAddressId ? sendAddresses.find((a: any) => String(a.id) === String(r0.deliveryAddressId)) : null;
        sendAddressLabel = matched?.addressLabel || sendAddresses.find((a: any) => a.isDefault)?.addressLabel || sendAddresses[0]?.addressLabel || "";
      } catch { /* 预估接口失败不影响后续物流匹配 */ }
      const r = await erp.inventory.action({ action: "consign_official_logistics_match", mallId: r0.mallId, deliveryOrderSn: r0.deliveryOrderSn, deliveryAddressId: r0.deliveryAddressId, subWarehouseId: r0.subWarehouseId, receiveAddressInfo: r0.receiveAddressInfo, predictTotalPackageWeight: predictWeightKg ? Math.ceil(predictWeightKg) * 1000 : 1000, totalPackageNum: 1, predictVolume });
      const companies = Array.isArray(r?.companies) ? r.companies : [];
      const firstTimes = companies.length ? (companies[0].scheduleTimes || []) : [];
      const ft0 = firstTimes.length ? firstTimes[0] : null;
      const firstDate = ft0?.bjDate || undefined;
      const firstHour = ft0?.bjStartTime ? ft0.bjStartTime.split(":")[0] : undefined;
      const firstMinute = ft0?.bjStartTime ? ft0.bjStartTime.split(":")[1] || "00" : undefined;
      setConfirmShipRows((rows) => rows.map((x) => x.soId === r0.soId ? { ...x, matched: companies, selectedIdx: companies.length ? 0 : -1, selectedScheduleDate: firstDate, selectedPickupHour: firstHour, selectedPickupMinute: firstMinute, weightKg: predictWeightKg || x.weightKg, sendAddresses, sendAddressLabel, loading: false, error: companies.length ? "" : "无可用物流" } : x));
    } catch (e: any) {
      setConfirmShipRows((rows) => rows.map((x) => x.soId === r0.soId ? { ...x, loading: false, error: cleanIpcError(e) || "匹配失败" } : x));
    }
  }, [officialShipState, erp]);

  // 工具栏「确认发货」：对勾选行批量做本地确认发货（扣 ERP 库存；jst 走 o_id，cloud 走 mall_id+soId）。
  const handleBatchConsignShip = useCallback(async () => {
    if (!erp?.inventory?.action) { message.error("ERP 接口未就绪"); return; }
    const rows = unifiedRows.filter((r) => r.soId && selectedShipKeys.includes(r.soId) && !r.inventoryDeducted);
    if (!rows.length) { message.warning("勾选项里没有「未确认发货」的单"); return; }
    setShipBatchBusy(true);
    const hide = message.loading(`确认发货中…（${rows.length} 单）`, 0);
    let ok = 0, skip = 0, fail = 0; const fails: string[] = []; const doneIds = new Set<string>();
    for (const row of rows) {
      const oId = row.rawJst?.o_id;
      const mallId = row.rawCloud?.mall_id ? String(row.rawCloud.mall_id) : "";
      const isCloud = !oId && row.source === "cloud" && Boolean(mallId) && Boolean(row.soId);
      if (!oId && !isCloud) { skip++; continue; }
      try {
        const result = await erp.inventory.action(
          oId ? { action: "consign_deliver_ship", oId } : { action: "consign_deliver_ship_cloud", mallId, soId: row.soId },
        );
        if (result?.idempotent) skip++; else ok++;
        doneIds.add(row.soId!);
      } catch (e: any) { fail++; fails.push(`${row.soId}: ${cleanIpcError(e)}`); }
    }
    hide();
    setShipBatchBusy(false);
    // 乐观更新成功的行（含已扣过的），与单行确认发货一致：不重查，等物化快照刷新。
    setUnifiedSnapshot((snap) => ({
      ...snap,
      rows: snap.rows.map((r) => (r.soId && doneIds.has(r.soId)) ? { ...r, inventoryDeducted: true, localStatusOverride: "已发货", status: "已发货" } : r),
    }));
    setSelectedShipKeys([]);
    if (fail) message.warning(`确认发货完成：成功 ${ok}、跳过(已扣) ${skip}、失败 ${fail}。${fails.slice(0, 3).join("；")}`);
    else message.success(`确认发货完成：成功 ${ok}、跳过(已扣) ${skip}`);
  }, [unifiedRows, selectedShipKeys, erp]);

  // 工具栏「批量撤销」：对勾选的已发货行批量撤销本地确认发货（回补 ERP 库存）。
  const handleBatchUnship = useCallback(async () => {
    if (!erp?.inventory?.action) { message.error("ERP 接口未就绪"); return; }
    const rows = unifiedRows.filter((r) => r.soId && selectedShipKeys.includes(r.soId) && r.inventoryDeducted);
    if (!rows.length) { message.warning("勾选项里没有「已确认发货」的单可撤销"); return; }
    setShipBatchBusy(true);
    const hide = message.loading(`撤销发货中…（${rows.length} 单）`, 0);
    let ok = 0, skip = 0, fail = 0; const fails: string[] = []; const doneIds = new Set<string>();
    for (const row of rows) {
      const oId = row.rawJst?.o_id;
      const mallId = row.rawCloud?.mall_id ? String(row.rawCloud.mall_id) : "";
      const isCloud = !oId && row.source === "cloud" && Boolean(mallId) && Boolean(row.soId);
      if (!oId && !isCloud) { skip++; continue; }
      try {
        const result = await erp.inventory.action(
          oId ? { action: "consign_deliver_unship", oId } : { action: "consign_deliver_unship_cloud", mallId, soId: row.soId },
        );
        if (result?.idempotent) skip++; else ok++;
        doneIds.add(row.soId!);
      } catch (e: any) { fail++; fails.push(`${row.soId}: ${cleanIpcError(e)}`); }
    }
    hide();
    setShipBatchBusy(false);
    setUnifiedSnapshot((snap) => ({
      ...snap,
      rows: snap.rows.map((r) => (r.soId && doneIds.has(r.soId)) ? { ...r, inventoryDeducted: false, localStatusOverride: null, status: r.rawCloud?.temu_status || r.rawJst?.status || r.status } : r),
    }));
    setSelectedShipKeys([]);
    if (fail) message.warning(`撤销完成：成功 ${ok}、跳过 ${skip}、失败 ${fail}。${fails.slice(0, 3).join("；")}`);
    else message.success(`撤销发货完成：成功 ${ok}、跳过(未扣) ${skip}`);
  }, [unifiedRows, selectedShipKeys, erp]);

  // 打印箱唛：取 Temu 打印页 URL（浏览器打开即印）。需已创建发货单(FH)。
  const handlePrintBoxmark = useCallback(async (row: ConsignDeliverUnifiedRow) => {
    if (!erp?.inventory?.action || !row.soId || !row.rawCloud?.mall_id) return;
    const fh = officialShipState[row.soId]?.deliveryOrderSn || row.rawCloud?.delivery_order_sn;
    if (!fh) { message.warning("该单还没有发货单号，请先创建发货单再打印箱唛"); return; }
    try {
      const r = await erp.inventory.action({ action: "consign_official_print_boxmark", mallId: String(row.rawCloud.mall_id), deliveryOrderSn: fh });
      if (r?.printUrl) window.open(r.printUrl, "_blank");
      else message.error("未拿到箱唛打印链接");
    } catch (e: any) { message.error(cleanIpcError(e) || "打印箱唛失败"); }
  }, [officialShipState, erp]);

  // 打印商品条码：按该单 SKC 取 Temu 打印页 URL，不依赖发货单、随时可打。
  const handlePrintLabel = useCallback(async (row: ConsignDeliverUnifiedRow) => {
    if (!erp?.inventory?.action || !row.rawCloud?.mall_id) return;
    const skc = row.rawCloud?.skc_id;
    if (!skc) { message.warning("该单缺少 SKC，无法打印条码"); return; }
    try {
      const r = await erp.inventory.action({ action: "consign_official_print_label", mallId: String(row.rawCloud.mall_id), skcIds: [skc] });
      if (r?.printUrl) window.open(r.printUrl, "_blank");
      else message.error("未拿到条码打印链接");
    } catch (e: any) { message.error(cleanIpcError(e) || "打印条码失败"); }
  }, [erp]);

  // 打印面单：发货后平台分配快递单号才有；后端带鉴权下载 PDF→base64，主进程写临时文件用系统阅读器打开（可打印）。
  const handlePrintExpressNote = useCallback(async (row: ConsignDeliverUnifiedRow) => {
    if (!erp?.inventory?.action || !row.soId || !row.rawCloud?.mall_id) return;
    const fh = officialShipState[row.soId]?.deliveryOrderSn || row.rawCloud?.delivery_order_sn;
    if (!fh) { message.warning("该单还没有发货单号，无法打印面单"); return; }
    const hide = message.loading("获取面单中…", 0);
    try {
      const r = await erp.inventory.action({ action: "consign_official_express_note", mallId: String(row.rawCloud.mall_id), deliveryOrderSn: fh });
      if (r?.pdfBase64 && window.electronAPI?.app?.openPdf) {
        await window.electronAPI.app.openPdf({ base64: r.pdfBase64, filename: r.filename });
      } else { message.error("未拿到面单 PDF"); }
    } catch (e: any) { message.error(cleanIpcError(e) || "打印面单失败（可能平台还没分配快递单号）"); }
    finally { hide(); }
  }, [officialShipState, erp]);

  // 装箱：查当前分箱（按 SKU 汇总），可改各 SKU 发货数量后保存（单箱）。
  const handleOpenPackage = useCallback(async (row: ConsignDeliverUnifiedRow) => {
    if (!erp?.inventory?.action || !row.soId || !row.rawCloud?.mall_id) return;
    const fh = officialShipState[row.soId]?.deliveryOrderSn || row.rawCloud?.delivery_order_sn;
    if (!fh) { message.warning("该单还没有发货单号，请先创建发货单"); return; }
    setPackageModal({ open: true, soId: row.soId, mallId: String(row.rawCloud.mall_id), deliveryOrderSn: fh, loading: true, saving: false, rows: [] });
    try {
      const r = await erp.inventory.action({ action: "consign_official_package_get", mallId: String(row.rawCloud.mall_id), deliveryOrderSn: fh });
      const map = new Map<string, { productSkuId: string; skuNum: number }>();
      for (const pkg of (r?.packageInfo || [])) {
        for (const d of (pkg.packageDetails || [])) {
          const key = String(d.productSkuId);
          const cur = map.get(key) || { productSkuId: key, skuNum: 0 };
          cur.skuNum += Number(d.skuNum || 0);
          map.set(key, cur);
        }
      }
      setPackageModal((m) => m ? { ...m, loading: false, rows: Array.from(map.values()) } : m);
    } catch (e: any) {
      message.error(cleanIpcError(e) || "查询装箱失败");
      setPackageModal((m) => m ? { ...m, loading: false } : m);
    }
  }, [officialShipState, erp]);

  // 保存装箱：单箱含全部 SKU，按编辑后的数量调 package.edit。
  const handleSavePackage = useCallback(async () => {
    if (!packageModal || !erp?.inventory?.action) return;
    const items = packageModal.rows.filter((r) => Number(r.skuNum) > 0);
    if (!items.length) { message.error("发货数量不能全为 0"); return; }
    setPackageModal((m) => m ? { ...m, saving: true } : m);
    try {
      await erp.inventory.action({
        action: "consign_official_package_edit",
        mallId: packageModal.mallId,
        deliveryOrderSn: packageModal.deliveryOrderSn,
        deliverOrderDetailInfos: items.map((r) => ({ productSkuId: Number(r.productSkuId), deliverSkuNum: Number(r.skuNum) })),
        packageInfos: [{ packageDetailSaveInfos: items.map((r) => ({ productSkuId: Number(r.productSkuId), skuNum: Number(r.skuNum) })) }],
      });
      message.success("装箱已更新");
      setPackageModal(null);
    } catch (e: any) {
      message.error(cleanIpcError(e) || "更新装箱失败");
      setPackageModal((m) => m ? { ...m, saving: false } : m);
    }
  }, [packageModal, erp]);

  // 申请/修改备货弹窗 state + 提交：填备货单号(soId)走 purchaseorder.edit 改量，留空走 purchaseorder.apply 新建。
  const [applyPo, setApplyPo] = useState<{ open: boolean; mallId: string; soId: string; productSkcId: string; productSkuId: string; quantity: number }>({ open: false, mallId: "", soId: "", productSkcId: "", productSkuId: "", quantity: 1 });
  const handleApplyPurchase = useCallback(async () => {
    if (!erp?.inventory?.action) return;
    const { mallId, soId, productSkcId, productSkuId, quantity } = applyPo;
    if (!mallId || !productSkuId || !(quantity > 0)) { message.error("请填店铺、SKU 和数量"); return; }
    try {
      if (soId) {
        // 改备货量（purchaseorder.edit，仅待创建备货单可改）。
        await erp.inventory.action({ action: "consign_purchase_edit", mallId, subPurchaseOrderSn: soId, purchaseDetailList: [{ productSkuId: Number(productSkuId), productSkuPurchaseQuantity: Number(quantity) }] });
        message.success("备货量已修改");
      } else {
        // 新建备货单（purchaseorder.apply）。
        if (!productSkcId) { message.error("新建备货单需填 SKC"); return; }
        await erp.inventory.action({ action: "consign_purchase_apply", mallId, purchaseDetailList: [{ productSkcId: Number(productSkcId), productSkuId: Number(productSkuId), productSkuPurchaseQuantity: Number(quantity) }] });
        message.success("备货单已提交");
      }
      setApplyPo((s) => ({ ...s, open: false }));
    } catch (e: any) { message.error(cleanIpcError(e) || "操作失败"); }
  }, [applyPo, erp]);

  // 取消备货单（批量，对勾选官方单；后端只对「待接单」生效，其它状态平台忽略）。
  const handleCancelPurchase = useCallback(() => {
    if (!erp?.inventory?.action) return;
    const rows = selectedShipRows;
    if (!rows.length) { message.warning("请先勾选要取消备货的官方单"); return; }
    Modal.confirm({
      title: `取消 ${rows.length} 个备货单？`,
      content: "仅「待接单」状态的备货单能取消，其它状态平台会忽略。",
      okText: "取消备货单",
      okButtonProps: { danger: true },
      cancelText: "再想想",
      onOk: async () => {
        let ok = 0, fail = 0;
        for (const row of rows) {
          try {
            await erp.inventory.action({ action: "consign_purchase_cancel", mallId: String(row.rawCloud?.mall_id || ""), subPurchaseOrderSnList: [row.soId] });
            ok++;
          } catch { fail++; }
        }
        message[fail ? "warning" : "success"](`取消备货完成：成功 ${ok}、失败/忽略 ${fail}`);
      },
    });
  }, [selectedShipRows, erp]);

  // 更新确认发货弹窗某行字段。
  const updateConfirmRow = useCallback((soId: string, patch: any) => {
    setConfirmShipRows((rows) => rows.map((x) => x.soId === soId ? { ...x, ...patch } : x));
  }, []);

  // 切换发货仓后重新匹配物流。
  const refreshLogisticsForRow = useCallback(async (row: any, newDeliveryAddressId: string, newLabel: string) => {
    setConfirmShipRows((rows) => rows.map((x) => x.soId === row.soId ? { ...x, deliveryAddressId: newDeliveryAddressId, sendAddressLabel: newLabel, matched: [], selectedIdx: -1, loading: true, error: "" } : x));
    try {
      const r = await erp.inventory.action({ action: "consign_official_logistics_match", mallId: row.mallId, deliveryOrderSn: row.deliveryOrderSn, deliveryAddressId: newDeliveryAddressId, subWarehouseId: row.subWarehouseId, receiveAddressInfo: row.receiveAddressInfo, predictTotalPackageWeight: row.weightKg ? Math.ceil(row.weightKg) * 1000 : 1000, totalPackageNum: 1 });
      const companies = Array.isArray(r?.companies) ? r.companies : [];
      const firstTimes = companies.length ? (companies[0].scheduleTimes || []) : [];
      const ft0 = firstTimes.length ? firstTimes[0] : null;
      setConfirmShipRows((rows) => rows.map((x) => x.soId === row.soId ? { ...x, matched: companies, selectedIdx: companies.length ? 0 : -1, selectedScheduleDate: ft0?.bjDate, selectedPickupHour: ft0?.bjStartTime?.split(":")[0], selectedPickupMinute: ft0?.bjStartTime?.split(":")[1] || "00", loading: false, error: companies.length ? "" : "无可用物流" } : x));
    } catch (e: any) {
      setConfirmShipRows((rows) => rows.map((x) => x.soId === row.soId ? { ...x, loading: false, error: cleanIpcError(e) || "匹配失败" } : x));
    }
  }, [erp]);

  // 提交：逐单真发货（强二次确认，confirm=true，不可逆）。
  const handleConfirmShipSubmit = useCallback(() => {
    const rows = confirmShipRows.filter((x: any) => !x.loading && x.matched.length && x.selectedIdx >= 0);
    if (!rows.length) { message.error("没有可发货的单（请等物流匹配完成并选好快递）"); return; }
    Modal.confirm({
      title: `确认真发货 ${rows.length} 单？此操作不可撤销`,
      content: "将逐单物流下单、平台上门揽收、生成运单(EB)，无法撤回。",
      okText: "确认发货",
      okButtonProps: { danger: true },
      cancelText: "再想想",
      onOk: async () => {
        setShipBatchBusy(true);
        const hide = message.loading(`发货中…（${rows.length} 单）`, 0);
        let ok = 0, fail = 0; const fails: string[] = [];
        for (const x of rows) {
          const sel = x.matched[x.selectedIdx];
          try {
            const pickupTs = x.selectedScheduleDate && x.selectedPickupHour ? new Date(`${x.selectedScheduleDate}T${x.selectedPickupHour}:${x.selectedPickupMinute || "00"}:00+08:00`).getTime() : undefined;
            const r = await erp.inventory.action({ action: "consign_official_packing_send", mallId: x.mallId, soId: x.soId, confirm: true, deliveryAddressId: x.deliveryAddressId, deliveryOrderSnList: [x.deliveryOrderSn], expressCompanyId: sel.expressCompanyId, expressCompanyName: sel.expressCompanyName, predictId: sel.predictId, pickupMethod: sel.pickupMethod ?? 0, predictTotalPackageWeight: Math.ceil(Number(x.weightKg || 1)) * 1000, expressPackageNum: x.packageNum || 1, expectPickUpGoodsTime: pickupTs });
            setOfficialShipState((s) => ({ ...s, [x.soId]: { ...(s[x.soId] || {}), stage: "shipped", expressBatchSn: r?.expressBatchSn } }));
            ok++;
          } catch (e: any) { fail++; fails.push(`${x.soId}: ${cleanIpcError(e)}`); }
        }
        hide();
        setShipBatchBusy(false);
        setConfirmShipOpen(false);
        setSelectedShipKeys([]);
        if (fail) message.warning(`发货完成：成功 ${ok}、失败 ${fail}。${fails.slice(0, 3).join("；")}`);
        else message.success(`发货成功：${ok} 单`);
      },
    });
  }, [confirmShipRows, erp]);

  // 本地确认发货 / 撤销：对应后端 inventory.action consign_deliver_ship / consign_deliver_unship。
  const handleConsignShip = useCallback(async (row: ConsignDeliverUnifiedRow, ship: boolean) => {
    if (!erp?.inventory?.action) { message.error("ERP 接口未就绪"); return; }
    const oId = row.rawJst?.o_id;
    const mallId = row.rawCloud?.mall_id ? String(row.rawCloud.mall_id) : "";
    // jst/both 走聚水潭 o_id；cloud-only(无 o_id)走官方 mall_id + 备货单号(soId)。
    const isCloud = !oId && row.source === "cloud" && Boolean(mallId) && Boolean(row.soId);
    if (!oId && !isCloud) { message.error("该行无法本地确认发货"); return; }
    setActingKey(oId ? `consign-${oId}` : `consign-cloud-${row.soId}`);
    try {
      const result = await erp.inventory.action(
        oId
          ? { action: ship ? "consign_deliver_ship" : "consign_deliver_unship", oId }
          : { action: ship ? "consign_deliver_ship_cloud" : "consign_deliver_unship_cloud", mallId, soId: row.soId },
      );
      if (result?.idempotent) {
        message.info(result?.message || (ship ? "已扣过本地库存，未重复扣减" : "未扣减，无需撤销"));
      } else {
        message.success(result?.message || (ship ? "已发货，本地库存已扣减" : "已撤销发货，本地库存已回补"));
      }
      // 乐观更新：立即翻转该行发货状态。物化快照重建有延迟，重查会读到旧快照把状态打回，故不重查。
      setUnifiedSnapshot((snap) => ({
        ...snap,
        rows: snap.rows.map((r) => {
          const sameJst = oId && r.rawJst?.o_id != null && String(r.rawJst.o_id) === String(oId);
          const sameCloud = !oId && r.source === "cloud" && r.soId === row.soId
            && String(r.rawCloud?.mall_id || "") === mallId;
          if (!sameJst && !sameCloud) return r;
          return {
            ...r,
            inventoryDeducted: ship,
            localStatusOverride: ship ? "已发货" : null,
            status: ship ? "已发货" : (r.rawCloud?.temu_status || r.rawJst?.status || r.status),
          };
        }),
      }));
    } catch (error: any) {
      message.error(error?.message || (ship ? "确认发货失败" : "撤销失败"));
    } finally {
      setActingKey(null);
    }
  }, [erp]);

  const cloudStockColumns = useMemo<ColumnsType<ConsignDeliverUnifiedRow>>(() => {
    const columns: ColumnsType<ConsignDeliverUnifiedRow> = [
    {
      title: "商品图片",
      key: "thumb",
      width: 60,
      render: (_value, row) => {
        const url = row.rawCloud?.thumb_url;
        if (!url) return null;
        return <img src={url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4 }} />;
      },
    },
    {
      title: "线上状态",
      key: "onlineStatus",
      width: 120,
      render: (_value, row) => {
        const isCloud = Boolean(row.rawCloud?.mall_id) && Boolean(row.soId);
        if (!isCloud) {
          const j = row.rawJst;
          if (!j) return <Text type="secondary">-</Text>;
          const addr = [j.receiver_state, j.receiver_city, j.receiver_district].filter(Boolean).join("·");
          if (!j.logistics_company && !j.outer_deliver_no && !addr) return <Text type="secondary">-</Text>;
          return (
            <Space direction="vertical" size={2} style={{ width: "100%" }}>
              {j.logistics_company ? <Text style={{ fontSize: 12 }}>{j.logistics_company}</Text> : null}
              {j.outer_deliver_no ? <Text type="secondary" style={{ fontSize: 12 }}>单号：{j.outer_deliver_no}</Text> : null}
              {addr ? <Text type="secondary" style={{ fontSize: 12 }}>收货：{addr}</Text> : null}
            </Space>
          );
        }
        const stage = getShipStage(row);
        const temuStatus = row.rawCloud?.temu_status || "";
        let tagLabel: string;
        let tagColor: string | undefined;
        if (stage === "staged") {
          tagLabel = "已加发货台"; tagColor = "warning";
        } else if (stage === "created") {
          tagLabel = "已创建发货单"; tagColor = "processing";
        } else if (temuStatus) {
          tagLabel = temuStatus;
          tagColor = temuStatus.includes("已收货") ? "cyan"
            : temuStatus.includes("已发货") ? "blue"
            : temuStatus.includes("取消") ? "error"
            : temuStatus.includes("异常") ? "error"
            : undefined;
        } else if (stage === "shipped") {
          tagLabel = "已发货"; tagColor = "blue";
        } else {
          tagLabel = "待发货"; tagColor = undefined;
        }
        return <Tag color={tagColor}>{tagLabel}</Tag>;
      },
    },
    {
      title: "erp状态",
      key: "erpStatus",
      width: 110,
      onCell: (row) => {
        const s = row.localStatusOverride || row.rawJst?.status || "已付款待审核";
        const st = stockStatusCellStyle(s);
        return { className: "status-cell-colored", style: { "--status-bg": st.bg, "--status-color": st.color } as any };
      },
      render: (_value, row) => {
        const s = row.localStatusOverride || row.rawJst?.status || "已付款待审核";
        return <span className="status-cell-text">{s}</span>;
      },
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
      render: (_value, row) => {
        const raw = row.shopName || "";
        const m = raw.match(/(?:temu-?)?(\d{2,4})\s*店铺?$/i) || raw.match(/^(\d{2,4})$/);
        return <Text>{m ? `${m[1]}店铺` : (raw || "-")}</Text>;
      },
    },
    {
      title: "商品信息",
      key: "product",
      width: 300,
      render: (_value, row) => (
        <Space direction="vertical" size={3}>
          <Paragraph ellipsis={{ rows: 2, tooltip: true }} style={{ maxWidth: 280, marginBottom: 0 }}>{row.rawCloud?.product_name || row.rawJst?.sku_info || ""}</Paragraph>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.rawJst?.skus || ""}</Text>
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
      render: (_value, row) => {
        // 官方单显示 Temu 子仓名；聚水潭单显示收货省市区(即收货仓地址,简短)。
        const cloud = row.rawCloud?.receive_warehouse_name || row.rawCloud?.warehouse_group;
        if (cloud) return cloud;
        const j = row.rawJst;
        const jst = j ? [j.receiver_state, j.receiver_city, j.receiver_district].filter(Boolean).join("·") : "";
        return jst || "-";
      },
    },
    {
      title: "收货仓地址",
      key: "receiveAddr",
      width: 240,
      render: (_value, row) => {
        // 大仓收货地址：用服务器已缓存的 receive_address_json（免实时调 Temu）。
        const j = row.rawCloud?.receive_address_json;
        if (!j) return <Text type="secondary">-</Text>;
        try {
          const a = JSON.parse(j);
          const line = [a.provinceName, a.cityName, a.districtName].filter(Boolean).join("");
          return (
            <Space direction="vertical" size={0}>
              {(a.receiverName || a.phone) ? <Text style={{ fontSize: 12 }}>{a.receiverName || ""} {a.phone || ""}</Text> : null}
              <Text type="secondary" style={{ fontSize: 12 }}>{line}{a.detailAddress || ""}</Text>
            </Space>
          );
        } catch { return <Text type="secondary">-</Text>; }
      },
    },
    {
      title: "发货地址",
      key: "sendAddr",
      width: 220,
      render: (_value, row) => {
        // 本店发货地址：用服务器缓存的 send_address_json（refresh-openapi-mall-addresses 定时刷新），取默认地址。
        const j = row.rawCloud?.send_address_json;
        if (!j) return <Text type="secondary">-</Text>;
        try {
          const arr = JSON.parse(j);
          const list = Array.isArray(arr) ? arr : [];
          const def = list.find((a: any) => a?.isDefault) || list[0];
          if (!def) return <Text type="secondary">-</Text>;
          const line = [def.provinceName, def.cityName, def.districtName].filter(Boolean).join("");
          return <Text type="secondary" style={{ fontSize: 12 }}>{line}{def.addressDetail || def.detailAddress || ""}</Text>;
        } catch { return <Text type="secondary">-</Text>; }
      },
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
      title: "右键或点工具栏「列设置」配置显示字段",
      onContextMenu: (event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        setColumnSettingsOpen(true);
      },
    });

    return orderedColumns.map((column) => {
      const key = String(column.key || "");
      if (!UNIFIED_CONFIGURABLE_COLUMN_KEY_SET.has(key)) return column;
      return {
        ...column,
        onHeaderCell: buildColumnMenuHeaderProps,
      };
    });
  }, [accounts.length, actingKey, canCreateOutbound, handleConsignShip, resolveUnifiedRowLink, unifiedColumnConfig, getShipStage]);

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
              onClick={async () => {
                void loadData({ notify: true });
                const soIds = unifiedRows.map((r: any) => r.soId).filter(Boolean);
                if (soIds.length && erp?.inventory?.action) {
                  try { await erp.inventory.action({ action: "consign_sync_ship_status", soIds }); } catch { /* ignore */ }
                }
                void loadUnified({
                  page: unifiedPage,
                  pageSize: unifiedPageSize,
                  search: stockQuery,
                  status: stockStatus,
                  onlineStatus,
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
                    showSearch
                    placeholder="店铺"
                    style={{ width: 200 }}
                    value={stockShop || undefined}
                    onChange={(val) => {
                      setStockShop(val || "");
                      setUnifiedPage(1);
                    }}
                    options={mallOptions}
                    filterOption={(input, option) =>
                      (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                    }
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
                    placeholder="线上状态"
                    style={{ width: 170 }}
                    value={onlineStatus || undefined}
                    options={onlineStatusFilterOptions}
                    getPopupContainer={(trigger) => trigger.parentElement || document.body}
                    onChange={(value) => {
                      setOnlineStatus(value || "");
                      setUnifiedPage(1);
                    }}
                  />
                  <Select
                    allowClear
                    placeholder="erp状态"
                    style={{ width: 170 }}
                    value={stockStatus || undefined}
                    options={erpStatusFilterOptions}
                    getPopupContainer={(trigger) => trigger.parentElement || document.body}
                    onChange={(value) => {
                      setStockStatus(value || "");
                      setUnifiedPage(1);
                    }}
                  />
                  <Popover
                    open={columnSettingsOpen}
                    onOpenChange={setColumnSettingsOpen}
                    trigger="click"
                    placement="bottomRight"
                    title="自定义显示字段（改动即时生效）"
                    content={(
                      <UnifiedColumnSettings
                        order={unifiedColumnConfig.order}
                        visible={unifiedColumnConfig.visible}
                        onToggle={toggleUnifiedColumn}
                        onReorder={commitUnifiedColumnDrag}
                        onRestore={restoreUnifiedColumnConfig}
                      />
                    )}
                  >
                    <Tooltip title="自定义显示哪些列、调整顺序（改动即时生效）">
                      <Button icon={<SettingOutlined />}>列设置</Button>
                    </Tooltip>
                  </Popover>
                </div>
                {/* 批量工具栏：①② 官方流程(仅官方单)；③ 本地确认发货(扣ERP库存,所有勾选单)。官方真发货在发货信息列「物流下单」 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <Text strong>批量操作</Text>
                  <Text type="secondary">已选 {selectedShipKeys.length} 单（官方 {selectedShipRows.length}）</Text>
                  <Button size="small" disabled={!canCreateOutbound || !selectedShipRows.length} loading={shipBatchBusy} onClick={handleBatchStaging}>① 加入发货台</Button>
                  <Button size="small" disabled={!canCreateOutbound || !selectedShipRows.length} loading={shipBatchBusy} onClick={openCreateShipModal}>② 创建发货单</Button>
                  <Button size="small" type="primary" disabled={!canCreateOutbound || !selectedShipKeys.length} loading={shipBatchBusy} onClick={handleBatchConsignShip}>③ 确认发货（本地扣库存）</Button>
                  <Button size="small" danger disabled={!canCreateOutbound || !selectedShipKeys.length} loading={shipBatchBusy} onClick={handleBatchUnship}>批量撤销</Button>
                  <Button size="small" onClick={() => setApplyPo((s) => ({ ...s, open: true }))}>申请备货</Button>
                  <Button size="small" disabled={!selectedShipRows.length} onClick={handleCancelPurchase}>取消备货单</Button>
                  <Text type="secondary" style={{ fontSize: 12 }}>①② 官方流程(仅官方单) · ③ 本地确认发货扣库存</Text>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <Text type="secondary">单行操作（选中官方单）</Text>
                  <Button size="small" disabled={!selectedShipRows.length} onClick={() => handlePrintLabel(selectedShipRows[0])}>打印条码</Button>
                  <Button size="small" disabled={!selectedShipRows.length} onClick={() => handlePrintBoxmark(selectedShipRows[0])}>打印箱唛</Button>
                  <Button size="small" disabled={!selectedShipRows.length} onClick={() => openShipLogistics(selectedShipRows[0])}>物流下单</Button>
                  <Button size="small" disabled={!selectedShipRows.length} onClick={() => handleOpenPackage(selectedShipRows[0])}>装箱</Button>
                  <Button size="small" disabled={!selectedShipRows.length} danger onClick={() => handleCancelShipOrderBySoId(selectedShipRows[0])}>撤销发货单</Button>
                  <Button size="small" disabled={!selectedShipRows.length} onClick={() => handlePrintExpressNote(selectedShipRows[0])}>打印面单</Button>
                </div>
                <Table
                  className="erp-compact-table consign-unified-table"
                  rowKey={(row) => row.soId || JSON.stringify(row)}
                  rowSelection={{
                    selectedRowKeys: selectedShipKeys,
                    onChange: (keys) => setSelectedShipKeys(keys as string[]),
                    preserveSelectedRowKeys: true,
                    getCheckboxProps: (row) => ({ disabled: !row.soId }),
                  }}
                  size="middle"
                  loading={unifiedLoading}
                  columns={cloudStockColumns}
                  dataSource={unifiedRows}
                  scroll={{ x: 2560, y: "max(300px, calc(100vh - 400px))" }}
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

      <Modal
        title="创建发货单"
        open={!!createShipModal?.open}
        onCancel={() => setCreateShipModal(null)}
        onOk={confirmCreateShip}
        okText="确认创建"
        cancelText="取消"
        confirmLoading={shipBatchBusy}
        okButtonProps={{ disabled: createShipModal?.loading }}
        destroyOnClose
        width={createShipModal?.skus.length ? 720 : 520}
      >
        {createShipModal?.loading ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}><Spin tip="加载数据…" /></div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <Text strong>待处理订单：</Text>
              <Text>{createShipModal?.rows.length} 单</Text>
            </div>
            <div>
              <Text strong style={{ display: "block", marginBottom: 6 }}>发货仓库：</Text>
              {createShipModal?.addresses.length ? (
                <Select
                  style={{ width: "100%" }}
                  value={createShipModal?.selectedAddressId}
                  onChange={(v) => setCreateShipModal((s) => s ? { ...s, selectedAddressId: v } : s)}
                  options={createShipModal?.addresses.map((a) => ({ value: a.id, label: `${a.label}${a.isDefault ? "（默认）" : ""}` }))}
                />
              ) : (
                <Text type="secondary">未获取到地址，将使用店铺默认发货地址</Text>
              )}
            </div>

            {/* 单单模式：包裹拆分编辑器 */}
            {createShipModal?.skus.length ? (
              <div>
                <Text strong style={{ display: "block", marginBottom: 8 }}>包裹设置</Text>

                {/* SKU 概览 */}
                <div style={{ background: "#fafafa", borderRadius: 6, padding: "8px 12px", marginBottom: 10, fontSize: 13 }}>
                  {createShipModal.skus.map((sku) => {
                    const allocated = createShipModal.packages.reduce((sum, pkg) => sum + (pkg.find((p) => p.productSkuId === sku.productSkuId)?.skuNum || 0), 0);
                    const remaining = sku.qty - allocated;
                    return (
                      <div key={sku.productSkuId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span>{sku.skuName || `SKU ${sku.productSkuId}`}</span>
                          {sku.spec && <span style={{ color: "#999", marginLeft: 8, fontSize: 12 }}>{sku.spec}</span>}
                        </div>
                        <span style={{ whiteSpace: "nowrap", marginLeft: 12 }}>
                          发货 {sku.qty}　已分配 {allocated}
                          <span style={{ color: remaining !== 0 ? "#ff4d4f" : "#52c41a", fontWeight: 500 }}>剩余 {remaining}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* 每个包裹一行 */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {createShipModal.packages.map((pkg, pi) => {
                    const pkgTotal = pkg.reduce((s, it) => s + (it.skuNum || 0), 0);
                    return (
                      <div key={pi} style={{ border: "1px solid #f0f0f0", borderRadius: 6, padding: "8px 12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <Text strong style={{ fontSize: 13 }}>包裹 {pi + 1} <Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>（{pkgTotal} 件）</Text></Text>
                          {createShipModal.packages.length > 1 && (
                            <span
                              style={{ cursor: "pointer", color: "#ff4d4f", fontSize: 12 }}
                              onClick={() => setCreateShipModal((s) => s ? { ...s, packages: s.packages.filter((_, i) => i !== pi) } : s)}
                            >删除</span>
                          )}
                        </div>
                        {createShipModal.skus.map((sku) => {
                          const item = pkg.find((p) => p.productSkuId === sku.productSkuId);
                          return (
                            <div key={sku.productSkuId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 13 }}>
                              <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {sku.skuName || `SKU ${sku.productSkuId}`}
                                {sku.spec && <span style={{ color: "#999", marginLeft: 6, fontSize: 12 }}>{sku.spec}</span>}
                              </div>
                              <InputNumber
                                size="small"
                                min={0}
                                max={sku.qty}
                                value={item?.skuNum || 0}
                                style={{ width: 70 }}
                                onChange={(v) => setCreateShipModal((s) => {
                                  if (!s) return s;
                                  const newPkgs = s.packages.map((p, i) => {
                                    if (i !== pi) return p;
                                    return p.map((it) => it.productSkuId === sku.productSkuId ? { ...it, skuNum: v || 0 } : it);
                                  });
                                  return { ...s, packages: newPkgs };
                                })}
                              />
                              <span style={{ fontSize: 12, color: "#999", width: 16 }}>件</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <Button
                    size="small"
                    onClick={() => setCreateShipModal((s) => {
                      if (!s) return s;
                      const newPkg = s.skus.map((sk) => ({ productSkuId: sk.productSkuId, skuNum: 0 }));
                      return { ...s, packages: [...s.packages, newPkg] };
                    })}
                  >+ 添加包裹</Button>
                  {createShipModal.packages.length > 1 && (
                    <Button
                      size="small"
                      onClick={() => setCreateShipModal((s) => {
                        if (!s || !s.skus.length) return s;
                        const singlePkg = s.skus.map((sk) => ({ productSkuId: sk.productSkuId, skuNum: sk.qty }));
                        return { ...s, packages: [singlePkg] };
                      })}
                    >重置为 1 个包裹</Button>
                  )}
                </div>
              </div>
            ) : (
              /* 多单批量模式：简单包裹数 */
              <div>
                <Text strong style={{ display: "block", marginBottom: 6 }}>包裹数：</Text>
                <InputNumber
                  min={1}
                  max={99}
                  value={createShipModal?.packageCount}
                  onChange={(v) => setCreateShipModal((s) => s ? { ...s, packageCount: v || 1 } : s)}
                />
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        title="物流下单（官方真发货：选平台快递 → 平台上门揽收）"
        open={confirmShipOpen}
        onCancel={() => setConfirmShipOpen(false)}
        width={760}
        okText="确认物流下单（不可逆）"
        okButtonProps={{ danger: true, loading: shipBatchBusy, disabled: !confirmShipRows.some((x: any) => !x.loading && x.matched.length && x.selectedIdx >= 0) }}
        cancelText="关闭"
        onOk={handleConfirmShipSubmit}
        destroyOnClose
      >
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="选好平台推荐快递、填重量箱数后，「确认物流下单」将真发货、平台上门揽收、生成运单(EB)，不可撤销。" />
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          {confirmShipRows.map((x: any) => (
            <div key={x.soId} style={{ border: "1px solid #f0f0f0", borderRadius: 6, padding: "10px 12px" }}>
              <div style={{ marginBottom: 6 }}>
                <Text strong>{x.soId}</Text>　<Text type="secondary" style={{ fontSize: 12 }}>发货单 {x.deliveryOrderSn}</Text>
              </div>
              {x.loading ? (
                <Text type="secondary"><Spin size="small" /> 匹配平台快递中…</Text>
              ) : x.error ? (
                <Text type="danger">{x.error}</Text>
              ) : (
                <Space direction="vertical" size={6} style={{ width: "100%" }}>
                  {x.sendAddresses?.length > 0 && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>发货仓　</Text>
                      <Select
                        style={{ width: 260 }}
                        value={x.deliveryAddressId || undefined}
                        onChange={(v) => {
                          const a = x.sendAddresses.find((a: any) => String(a.id) === String(v));
                          refreshLogisticsForRow(x, String(v), a?.addressLabel || "");
                        }}
                        options={x.sendAddresses.map((a: any) => ({ value: String(a.id), label: a.addressLabel || `${a.provinceName || ""}${a.cityName || ""}${a.districtName || ""}` }))}
                      />
                    </div>
                  )}
                  <Space size={12} wrap>
                    <Select
                      style={{ width: 300 }}
                      popupMatchSelectWidth={false}
                      dropdownStyle={{ minWidth: 460 }}
                      placeholder="选平台推荐快递"
                      value={x.selectedIdx >= 0 ? x.selectedIdx : undefined}
                      onChange={(v) => {
                        const sel = x.matched[v];
                        const times = sel?.scheduleTimes || [];
                        const ft0 = times.length ? times[0] : null;
                        const fd = ft0?.bjDate || undefined;
                        const fh = ft0?.bjStartTime ? ft0.bjStartTime.split(":")[0] : undefined;
                        const fm = ft0?.bjStartTime ? ft0.bjStartTime.split(":")[1] || "00" : undefined;
                        updateConfirmRow(x.soId, { selectedIdx: v, selectedScheduleDate: fd, selectedPickupHour: fh, selectedPickupMinute: fm });
                      }}
                      options={x.matched.map((c: any, idx: number) => ({ value: idx, label: `${c.expressCompanyName}（运费 ${c.minCharge ?? "?"}~${c.maxCharge ?? "?"} 元）` }))}
                    />
                    <span><Text type="secondary">重量kg </Text><InputNumber min={0.1} step={0.1} style={{ width: 90 }} value={x.weightKg} onChange={(v) => updateConfirmRow(x.soId, { weightKg: v })} /></span>
                    <span><Text type="secondary">箱数 </Text><InputNumber min={1} step={1} style={{ width: 80 }} value={x.packageNum} onChange={(v) => updateConfirmRow(x.soId, { packageNum: v })} /></span>
                  </Space>
                  {(() => {
                    const sel = x.selectedIdx >= 0 ? x.matched[x.selectedIdx] : null;
                    const times: any[] = sel?.scheduleTimes || [];
                    if (!times.length) return null;
                    const dates = [...new Set(times.map((t: any) => t.bjDate))];
                    const curDate = x.selectedScheduleDate || dates[0];
                    const slot = times.find((t: any) => t.bjDate === curDate);
                    const startH = slot ? parseInt(slot.bjStartTime.split(":")[0], 10) : 0;
                    const startM = slot ? parseInt(slot.bjStartTime.split(":")[1] || "0", 10) : 0;
                    const endH = slot ? parseInt(slot.bjEndTime.split(":")[0], 10) : 23;
                    const endM = slot ? parseInt(slot.bjEndTime.split(":")[1] || "59", 10) : 59;
                    const curH = parseInt(x.selectedPickupHour || "0", 10);
                    const hours: string[] = [];
                    for (let h = startH; h <= endH; h++) hours.push(String(h).padStart(2, "0"));
                    const minM = curH === startH ? startM : 0;
                    const maxM = curH === endH ? endM : 59;
                    const minutes: string[] = [];
                    for (let m = minM; m <= maxM; m++) minutes.push(String(m).padStart(2, "0"));
                    return (
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>预约取货时间　</Text>
                        <Select
                          style={{ width: 140 }}
                          value={curDate}
                          onChange={(v) => {
                            const first = times.find((t: any) => t.bjDate === v);
                            const fh = first?.bjStartTime ? first.bjStartTime.split(":")[0] : x.selectedPickupHour;
                            const fm = first?.bjStartTime ? first.bjStartTime.split(":")[1] || "00" : x.selectedPickupMinute;
                            updateConfirmRow(x.soId, { selectedScheduleDate: v, selectedPickupHour: fh, selectedPickupMinute: fm });
                          }}
                          options={dates.map((d) => ({ value: d, label: d }))}
                        />
                        <Select
                          style={{ width: 70, marginLeft: 8 }}
                          value={x.selectedPickupHour}
                          onChange={(v) => {
                            const newH = parseInt(v, 10);
                            const newMinM = newH === startH ? startM : 0;
                            const curM = parseInt(x.selectedPickupMinute || "0", 10);
                            const fixedM = curM < newMinM ? String(newMinM).padStart(2, "0") : x.selectedPickupMinute;
                            updateConfirmRow(x.soId, { selectedPickupHour: v, selectedPickupMinute: fixedM });
                          }}
                          options={hours.map((h) => ({ value: h, label: h }))}
                        />
                        <Text type="secondary" style={{ margin: "0 2px" }}>:</Text>
                        <Select style={{ width: 70 }} value={x.selectedPickupMinute} onChange={(v) => updateConfirmRow(x.soId, { selectedPickupMinute: v })} options={minutes.map((m) => ({ value: m, label: m }))} />
                      </div>
                    );
                  })()}
                </Space>
              )}
            </div>
          ))}
        </Space>
      </Modal>

      <Modal
        title="装箱明细（调整各 SKU 发货数量，保存为单箱）"
        open={Boolean(packageModal?.open)}
        onCancel={() => setPackageModal(null)}
        onOk={handleSavePackage}
        okText="保存装箱"
        okButtonProps={{ loading: Boolean(packageModal?.saving), disabled: Boolean(packageModal?.loading) }}
        confirmLoading={Boolean(packageModal?.saving)}
        width={520}
        destroyOnClose
      >
        {packageModal?.loading ? (
          <div style={{ textAlign: "center", padding: 24 }}><Spin /></div>
        ) : (
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <Text type="secondary" style={{ fontSize: 12 }}>发货单 {packageModal?.deliveryOrderSn}　共 {packageModal?.rows.length || 0} 个 SKU。改数量后保存即重置为单箱装。</Text>
            {(packageModal?.rows || []).map((it, idx) => (
              <div key={it.productSkuId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 12 }}>SKU {it.productSkuId}</Text>
                <InputNumber
                  min={0}
                  step={1}
                  value={it.skuNum}
                  onChange={(v) => setPackageModal((m) => m ? { ...m, rows: m.rows.map((r, i) => i === idx ? { ...r, skuNum: Number(v || 0) } : r) } : m)}
                  style={{ width: 120 }}
                />
              </div>
            ))}
            {!(packageModal?.rows || []).length ? <Text type="secondary">无 SKU 明细</Text> : null}
          </Space>
        )}
      </Modal>

      <Modal
        title="申请 / 修改备货单"
        open={applyPo.open}
        onCancel={() => setApplyPo((s) => ({ ...s, open: false }))}
        onOk={handleApplyPurchase}
        okText={applyPo.soId ? "修改备货量" : "提交备货单"}
        width={460}
        destroyOnClose
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="留空「备货单号」=新建备货单（需 SKC+SKU）；填「备货单号」=改该单数量（只需 SKU）。真下/改单受核价、当日额度限制，失败会提示原因。" />
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <div>
            <Text type="secondary">店铺</Text>
            <Select
              style={{ width: "100%", marginTop: 4 }}
              placeholder="选店铺"
              value={applyPo.mallId || undefined}
              onChange={(v) => setApplyPo((s) => ({ ...s, mallId: v }))}
              options={Array.from(new Map(unifiedRows.filter((r) => r.rawCloud?.mall_id).map((r) => [String(r.rawCloud?.mall_id), r.shopName])).entries()).map(([value, name]) => {
                const raw = name || "";
                const sm = raw.match(/(?:temu-?)?(\d{2,4})\s*店铺?$/i) || raw.match(/^(\d{2,4})$/);
                return { value, label: sm ? `${sm[1]}店铺` : (raw || value) };
              })}
            />
          </div>
          <div>
            <Text type="secondary">备货单号（选填，填则改该单数量）</Text>
            <Input style={{ marginTop: 4 }} value={applyPo.soId} onChange={(e) => setApplyPo((s) => ({ ...s, soId: e.target.value }))} placeholder="留空=新建；填 WB 备货单号=改该单量" />
          </div>
          <div>
            <Text type="secondary">SKC ID</Text>
            <Input style={{ marginTop: 4 }} value={applyPo.productSkcId} onChange={(e) => setApplyPo((s) => ({ ...s, productSkcId: e.target.value }))} placeholder="productSkcId" />
          </div>
          <div>
            <Text type="secondary">SKU ID</Text>
            <Input style={{ marginTop: 4 }} value={applyPo.productSkuId} onChange={(e) => setApplyPo((s) => ({ ...s, productSkuId: e.target.value }))} placeholder="productSkuId" />
          </div>
          <div>
            <Text type="secondary">备货数量</Text>
            <InputNumber style={{ width: "100%", marginTop: 4 }} min={1} value={applyPo.quantity} onChange={(v) => setApplyPo((s) => ({ ...s, quantity: Number(v || 1) }))} />
          </div>
        </Space>
      </Modal>

    </div>
  );
}
