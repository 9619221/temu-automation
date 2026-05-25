import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { Alert, Button, Checkbox, Col, DatePicker, Drawer, Image, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import {
  FilterOutlined,
  HolderOutlined,
  InboxOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { hasPageCache, readPageCache, writePageCache } from "../utils/pageCache";
import {
  INBOUND_STATUS_LABELS,
  canRole,
  formatDateTime,
  formatMoney,
  formatQty,
  statusTag,
} from "../utils/erpUi";

const { Text } = Typography;
const { TextArea } = Input;
const { RangePicker } = DatePicker;
const erp = window.electronAPI?.erp;
const WAREHOUSE_WORKBENCH_CACHE_KEY = "temu.warehouse.workbench.cache.v4";
const DEFAULT_INBOUND_RECEIPT_PAGE_SIZE = 20;
const MAX_INBOUND_RECEIPT_PAGE_SIZE = 50;
const DEFAULT_RECEIPT_SCOPE: ReceiptScopeKey = "actionable";
const INBOUND_RECEIPT_PAGE_SIZE_OPTIONS = [20, 50];
const WAREHOUSE_RECEIPT_COLUMN_STORAGE_KEY = "temu.warehouse.receipt.columns.v1";
const WAREHOUSE_RECEIPT_COLUMN_MENU_WIDTH = 280;
const WAREHOUSE_RECEIPT_COLUMN_MENU_EDGE_GAP = 12;
const WAREHOUSE_RECEIPT_COLUMN_MENU_OFFSET = 8;
const WAREHOUSE_RECEIPT_COLUMN_MENU_CHROME_HEIGHT = 96;
const WAREHOUSE_RECEIPT_COLUMN_MENU_MIN_BODY_HEIGHT = 180;
const WAREHOUSE_RECEIPT_COLUMN_MENU_MAX_BODY_HEIGHT = 430;
const JUSHUITAN_WAREHOUSE_NAME = "义乌明舵国际贸易有限公司";
const WAREHOUSE_RECEIPT_CONFIGURABLE_COLUMN_KEYS = [
  "receipt",
  "poNo",
  "status",
  "productImage",
  "supplierName",
  "productName",
  "skuCode",
  "qty",
  "logistics",
  "receivedAt",
];
const WAREHOUSE_RECEIPT_CONFIGURABLE_COLUMN_KEY_SET = new Set(WAREHOUSE_RECEIPT_CONFIGURABLE_COLUMN_KEYS);
const WAREHOUSE_RECEIPT_COLUMN_LABELS: Record<string, string> = {
  receipt: "入库单",
  poNo: "采购单号",
  status: "状态",
  productImage: "图片",
  supplierName: "供应商",
  productName: "商品名称",
  skuCode: "商品编码",
  qty: "数量",
  logistics: "物流",
  receivedAt: "入库时间",
};
const WAREHOUSE_PRODUCT_IMAGE_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44'%3E%3Crect width='44' height='44' rx='6' fill='%23f1f5f9'/%3E%3Ctext x='22' y='25' text-anchor='middle' font-size='10' fill='%2364748b'%3E无图%3C/text%3E%3C/svg%3E";
type ReceiptQueueKey = "all" | "pending_arrival" | "to_inbound" | "exception" | "inbounded";
type ReceiptIssueKey = "all" | "mismatch" | "shortage" | "over" | "damaged";
type ReceiptScopeKey = "all" | "actionable" | "today" | "overdue";
type ReceiptStatusTone = "neutral" | "blue" | "green" | "amber" | "red";
type ReceiptStatusItem<T extends string> = {
  value: T;
  label: string;
  count: number;
  meta?: string;
  tone?: ReceiptStatusTone;
};

interface WarehouseReceiptColumnConfig {
  order: string[];
  visible: string[];
}

const RECEIPT_QUEUE_STATUS: Record<ReceiptQueueKey, string[]> = {
  all: [],
  pending_arrival: ["pending_arrival"],
  to_inbound: ["arrived", "counted"],
  exception: ["quantity_mismatch", "damaged", "exception"],
  inbounded: ["inbounded_pending_qc"],
};

const INBOUND_ACTION_STATUSES = new Set(["pending_arrival", "arrived", "counted"]);
const INBOUND_EXCEPTION_STATUSES = new Set(["quantity_mismatch", "damaged", "exception"]);
const RECEIPT_OVERDUE_HOURS = 24;

const RECEIPT_ISSUE_OPTIONS: Array<{ label: string; value: ReceiptIssueKey }> = [
  { label: "全部差异", value: "all" },
  { label: "任意差异", value: "mismatch" },
  { label: "短少", value: "shortage" },
  { label: "多到", value: "over" },
  { label: "破损", value: "damaged" },
];

const INBOUND_EDIT_STATUS_VALUES = [
  "jst_pending_inbound",
  "pending_arrival",
  "arrived",
  "counted",
  "inbounded_pending_qc",
  "quantity_mismatch",
  "damaged",
  "exception",
  "cancelled",
] as const;

const INBOUND_EDIT_STATUS_OPTIONS = INBOUND_EDIT_STATUS_VALUES.map((value) => ({
  label: INBOUND_STATUS_LABELS[value] || value,
  value,
}));

type WarehouseWorkbenchParams = {
  inboundReceiptLimit: number;
  inboundReceiptOffset: number;
  inboundReceiptStatus?: string[];
  inboundReceiptKeyword?: string;
  inboundReceiptSupplier?: string;
  inboundReceiptDateFrom?: string;
  inboundReceiptDateTo?: string;
  inboundReceiptIssue?: string;
  inboundReceiptScope?: string;
};

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? Math.floor(next) : fallback;
}

function normalizeOffsetNumber(value: unknown, fallback = 0): number {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? Math.floor(next) : fallback;
}

function takePageRows<T>(rows: T[] | undefined, limit: number, offset = 0): T[] | undefined {
  if (!Array.isArray(rows)) return rows;
  const safeLimit = normalizePositiveNumber(limit, rows.length || 1);
  const safeOffset = normalizeOffsetNumber(offset);
  return rows.slice(safeOffset, safeOffset + safeLimit);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeReceiptPageSize(value: unknown, fallback = DEFAULT_INBOUND_RECEIPT_PAGE_SIZE): number {
  return clampNumber(normalizePositiveNumber(value, fallback), 1, MAX_INBOUND_RECEIPT_PAGE_SIZE);
}

function warehouseReceiptColumnMenuPosition(clientX: number, clientY: number) {
  const maxLeft = Math.max(
    WAREHOUSE_RECEIPT_COLUMN_MENU_EDGE_GAP,
    window.innerWidth - WAREHOUSE_RECEIPT_COLUMN_MENU_WIDTH - WAREHOUSE_RECEIPT_COLUMN_MENU_EDGE_GAP,
  );
  const maxTop = Math.max(
    WAREHOUSE_RECEIPT_COLUMN_MENU_EDGE_GAP,
    window.innerHeight
      - WAREHOUSE_RECEIPT_COLUMN_MENU_CHROME_HEIGHT
      - WAREHOUSE_RECEIPT_COLUMN_MENU_MIN_BODY_HEIGHT
      - WAREHOUSE_RECEIPT_COLUMN_MENU_EDGE_GAP,
  );
  const x = clampNumber(
    clientX + WAREHOUSE_RECEIPT_COLUMN_MENU_OFFSET,
    WAREHOUSE_RECEIPT_COLUMN_MENU_EDGE_GAP,
    maxLeft,
  );
  const y = clampNumber(
    clientY + WAREHOUSE_RECEIPT_COLUMN_MENU_OFFSET,
    WAREHOUSE_RECEIPT_COLUMN_MENU_EDGE_GAP,
    maxTop,
  );
  const availableBodyHeight = window.innerHeight
    - y
    - WAREHOUSE_RECEIPT_COLUMN_MENU_CHROME_HEIGHT
    - WAREHOUSE_RECEIPT_COLUMN_MENU_EDGE_GAP;
  return {
    x,
    y,
    bodyMaxHeight: clampNumber(
      availableBodyHeight,
      WAREHOUSE_RECEIPT_COLUMN_MENU_MIN_BODY_HEIGHT,
      WAREHOUSE_RECEIPT_COLUMN_MENU_MAX_BODY_HEIGHT,
    ),
  };
}

function normalizeWarehouseReceiptColumnOrder(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const ordered = source
    .map((item) => String(item || ""))
    .filter((key) => {
      if (!WAREHOUSE_RECEIPT_CONFIGURABLE_COLUMN_KEY_SET.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return [
    ...ordered,
    ...WAREHOUSE_RECEIPT_CONFIGURABLE_COLUMN_KEYS.filter((key) => !seen.has(key)),
  ];
}

function defaultWarehouseReceiptColumnConfig(): WarehouseReceiptColumnConfig {
  return {
    order: [...WAREHOUSE_RECEIPT_CONFIGURABLE_COLUMN_KEYS],
    visible: [...WAREHOUSE_RECEIPT_CONFIGURABLE_COLUMN_KEYS],
  };
}

function normalizeWarehouseReceiptColumnConfig(value: unknown): WarehouseReceiptColumnConfig {
  const raw = value && typeof value === "object" ? value as { order?: unknown; visible?: unknown } : null;
  const order = normalizeWarehouseReceiptColumnOrder(raw?.order || value);
  const visibleSource = Array.isArray(raw?.visible) ? raw.visible : order;
  const visible = Array.from(new Set(visibleSource.map((item) => String(item || "")).filter((key) => (
    WAREHOUSE_RECEIPT_CONFIGURABLE_COLUMN_KEY_SET.has(key)
  ))));
  return {
    order,
    visible: visible.length ? visible : ["receipt"],
  };
}

function readWarehouseReceiptColumnConfig() {
  if (typeof window === "undefined") return defaultWarehouseReceiptColumnConfig();
  try {
    return normalizeWarehouseReceiptColumnConfig(JSON.parse(window.localStorage.getItem(WAREHOUSE_RECEIPT_COLUMN_STORAGE_KEY) || "[]"));
  } catch {
    return defaultWarehouseReceiptColumnConfig();
  }
}

function dateBoundaryIso(value: any, boundary: "start" | "end"): string {
  if (!value) return "";
  const next = boundary === "start" ? value.startOf?.("day") : value.endOf?.("day");
  if (next?.toISOString) return next.toISOString();
  if (value.toISOString) return value.toISOString();
  return "";
}

function formatAgeHours(value: unknown): string {
  const hours = Number(value || 0);
  if (!Number.isFinite(hours) || hours <= 0) return "-";
  if (hours < 1) return "<1h";
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  const remain = Math.floor(hours % 24);
  return remain ? `${days}d ${remain}h` : `${days}d`;
}

interface InboundReceiptRow {
  id: string;
  receiptNo?: string;
  poNo?: string;
  poId?: string;
  supplierName?: string;
  skuSummary?: string;
  skuCode?: string | null;
  productName?: string | null;
  productImageUrl?: string | null;
  status: string;
  expectedQty?: number;
  receivedQty?: number;
  damagedQty?: number;
  shortageQty?: number;
  overQty?: number;
  lineCount?: number;
  batchLineCount?: number;
  operatorName?: string;
  warehouseName?: string | null;
  receivedAt?: string | null;
  updatedAt?: string;
  ageHours?: number;
  isOverdue?: boolean | number;
  isToday?: boolean | number;
  priorityRank?: number;
  priorityLabel?: string;
  nextActionKey?: string;
  nextActionLabel?: string;
  logistics?: { companyName?: string | null; billNo?: string | null } | null;
  logisticsStatus?: string | null;
  logisticsSource?: string | null;
  logisticsSyncedAt?: string | null;
  logisticsTraceError?: string | null;
  logisticsHasTrace?: boolean | number | null;
  sourceStatus?: string | null;
  sourceFinancialStatus?: string | null;
  sourceRemark?: string | null;
}

interface InboundReceiptLineRow {
  id: string;
  skuCode?: string;
  productName?: string;
  imageUrl?: string | null;
  colorSpec?: string | null;
  styleNo?: string | null;
  unitCost?: number | null;
  logisticsFee?: number | null;
  expectedQty: number;
  receivedQty: number;
  damagedQty: number;
  shortageQty: number;
  overQty: number;
}

interface InboundReceiptEditableLine {
  id: string;
  skuCode?: string;
  productName?: string;
  expectedQty: number;
  receivedQty: number;
  damagedQty: number;
}

interface InboundReceiptTimelineRow {
  id: string;
  eventType?: string;
  label?: string;
  message?: string;
  actorName?: string;
  actorRole?: string;
  source?: string;
  createdAt?: string;
}

interface InboundLogisticsTraceItem {
  id: string;
  time?: string | null;
  text?: string | null;
}

interface InboundLogisticsDetail {
  receiptId?: string | null;
  receiptNo?: string | null;
  poNo?: string | null;
  supplierName?: string | null;
  companyName?: string | null;
  billNo?: string | null;
  status?: string | null;
  signed?: boolean;
  shipped?: boolean;
  source?: string | null;
  syncedAt?: string | null;
  traceError?: string | null;
  traceItems?: InboundLogisticsTraceItem[];
}

interface WarehouseWorkbench {
  generatedAt?: string;
  summary?: Record<string, number>;
  inboundReceiptPage?: { limit?: number; offset?: number; total?: number };
  inboundReceipts?: InboundReceiptRow[];
}

function normalizeWarehouseWorkbenchCache(workbench: WarehouseWorkbench = {}): WarehouseWorkbench {
  const limit = normalizeReceiptPageSize(workbench.inboundReceiptPage?.limit);
  return {
    ...workbench,
    inboundReceiptPage: {
      ...workbench.inboundReceiptPage,
      limit,
      offset: 0,
    },
    inboundReceipts: takePageRows(workbench.inboundReceipts, limit, 0),
  };
}

function normalizeInboundLines(lines: any[] = []): InboundReceiptLineRow[] {
  return lines.map((line) => ({
    id: String(line.id),
    skuCode: line.internalSkuCode || line.skuCode,
    productName: line.productName,
    imageUrl: line.imageUrl || line.skuImageUrl || line.sku_image_url || null,
    colorSpec: line.colorSpec || line.color_spec || null,
    styleNo: line.styleNo || line.style_no || line.externalOfferId || line.external_offer_id || null,
    unitCost: line.unitCost === null || line.unitCost === undefined ? null : Number(line.unitCost),
    logisticsFee: line.logisticsFee === null || line.logisticsFee === undefined ? null : Number(line.logisticsFee),
    expectedQty: Number(line.expectedQty || 0),
    receivedQty: Number(line.receivedQty || 0),
    damagedQty: Number(line.damagedQty || 0),
    shortageQty: Number(line.shortageQty || 0),
    overQty: Number(line.overQty || 0),
  }));
}

function normalizeInboundTimeline(rows: any[] = []): InboundReceiptTimelineRow[] {
  return rows.map((row, index) => ({
    id: String(row.id || `${row.eventType || row.event_type || "event"}-${index}`),
    eventType: row.eventType || row.event_type,
    label: row.label,
    message: row.message,
    actorName: row.actorName || row.actor_name,
    actorRole: row.actorRole || row.actor_role,
    source: row.source,
    createdAt: row.createdAt || row.created_at,
  }));
}

function normalizeInboundLogisticsDetail(raw: any, row?: InboundReceiptRow): InboundLogisticsDetail {
  const source = raw && typeof raw === "object" ? raw : {};
  const traceItems = Array.isArray(source.traceItems) ? source.traceItems : [];
  const status = source.status || row?.logisticsStatus || null;
  const statusText = String(status || "").toLowerCase();
  const signed = Boolean(source.signed || /签收|已收|sign|signed|delivered/.test(statusText));
  const shipped = Boolean(source.shipped || signed || row?.logisticsHasTrace || status);
  return {
    receiptId: String(source.receiptId || row?.id || ""),
    receiptNo: source.receiptNo || row?.receiptNo || row?.id || null,
    poNo: source.poNo || row?.poNo || null,
    supplierName: source.supplierName || row?.supplierName || null,
    companyName: source.companyName || row?.logistics?.companyName || null,
    billNo: source.billNo || row?.logistics?.billNo || null,
    status,
    signed,
    shipped,
    source: source.source || row?.logisticsSource || (row?.logistics ? "local" : null),
    syncedAt: source.syncedAt || row?.logisticsSyncedAt || null,
    traceError: source.traceError || row?.logisticsTraceError || null,
    traceItems: traceItems.map((item: any, index: number) => ({
      id: String(item.id || `${item.time || "trace"}-${index}`),
      time: item.time || item.acceptTime || item.traceTime || null,
      text: item.text || item.message || item.remark || item.context || null,
    })).filter((item: InboundLogisticsTraceItem) => item.time || item.text),
  };
}

function getLogisticsSourceLabel(source?: string | null): string {
  if (source === "1688") return "1688跟踪信息";
  if (source === "jushuitan") return "聚水潭导入";
  return "本地记录";
}

function splitReceiptSkuSummary(summary?: string | null) {
  const first = String(summary || "").split(",")[0]?.trim() || "";
  if (!first || first === "-") return { skuCode: "", productName: "" };
  const match = first.match(/^(\S+)\s+(.+)$/);
  if (!match) return { skuCode: "", productName: first };
  return {
    skuCode: match[1] || "",
    productName: match[2] || "",
  };
}

function getReceiptProductDisplay(row: InboundReceiptRow) {
  const fallback = splitReceiptSkuSummary(row.skuSummary);
  return {
    skuCode: row.skuCode || fallback.skuCode,
    productName: row.productName || fallback.productName || row.skuSummary || "",
    productImageUrl: row.productImageUrl || "",
  };
}

function toPartialReceiveLines(lines: InboundReceiptLineRow[]) {
  return lines.map((line) => ({
    id: line.id,
    skuCode: line.skuCode,
    productName: line.productName,
    expectedQty: line.expectedQty,
    receivedQty: line.receivedQty || line.expectedQty,
    damagedQty: line.damagedQty,
  }));
}

function toEditableReceiptLines(lines: InboundReceiptLineRow[]): InboundReceiptEditableLine[] {
  return lines.map((line) => ({
    id: line.id,
    skuCode: line.skuCode,
    productName: line.productName,
    expectedQty: Number(line.expectedQty || 0),
    receivedQty: Number(line.receivedQty || 0),
    damagedQty: Number(line.damagedQty || 0),
  }));
}

function getIssueTags(record: { damagedQty?: number; shortageQty?: number; overQty?: number }) {
  const tags: Array<{ key: string; label: string; color: string }> = [];
  if (Number(record.shortageQty || 0) > 0) tags.push({ key: "shortage", label: `短少 ${formatQty(record.shortageQty)}`, color: "gold" });
  if (Number(record.overQty || 0) > 0) tags.push({ key: "over", label: `多到 ${formatQty(record.overQty)}`, color: "blue" });
  if (Number(record.damagedQty || 0) > 0) tags.push({ key: "damaged", label: `破损 ${formatQty(record.damagedQty)}`, color: "red" });
  return tags;
}

function roleLabel(role?: string) {
  const labels: Record<string, string> = {
    admin: "管理员",
    manager: "主管",
    buyer: "采购",
    finance: "财务",
    warehouse: "仓库",
    ops: "运营",
    system: "系统",
  };
  return labels[String(role || "")] || role || "-";
}

function getReceiptTaskState(row: InboundReceiptRow) {
  const status = String(row.status || "");
  const backendLabel = String(row.priorityLabel || "").trim();
  const backendNextAction = String(row.nextActionLabel || "").trim();
  if (INBOUND_EXCEPTION_STATUSES.has(status)) {
    return {
      label: backendLabel || "异常优先",
      meta: backendNextAction || "填写说明后入库",
      tone: "red",
      rowClass: "warehouse-receipt-row--exception",
    };
  }
  if (row.isOverdue && INBOUND_ACTION_STATUSES.has(status)) {
    return {
      label: backendLabel || "超期优先",
      meta: backendNextAction ? `${backendNextAction} · ${formatAgeHours(row.ageHours)}` : `已等待 ${formatAgeHours(row.ageHours)}`,
      tone: "red",
      rowClass: "warehouse-receipt-row--overdue",
    };
  }
  if (status === "pending_arrival") {
    return {
      label: backendLabel || "待到货",
      meta: backendNextAction || "确认到仓",
      tone: "amber",
      rowClass: "warehouse-receipt-row--pending",
    };
  }
  if (status === "jst_pending_inbound") {
    return {
      label: "待入库",
      meta: "源数据状态，可修改",
      tone: "amber",
      rowClass: "warehouse-receipt-row--pending",
    };
  }
  if (status === "arrived") {
    return {
      label: backendLabel || "待核数",
      meta: backendNextAction || "核对实收数量",
      tone: "blue",
      rowClass: "warehouse-receipt-row--actionable",
    };
  }
  if (status === "counted") {
    return {
      label: backendLabel || "可入库",
      meta: backendNextAction || "确认入库",
      tone: "blue",
      rowClass: "warehouse-receipt-row--actionable",
    };
  }
  if (status === "inbounded_pending_qc") {
    return {
      label: backendLabel || "已入库",
      meta: backendNextAction || "进入质检",
      tone: "green",
      rowClass: "warehouse-receipt-row--completed",
    };
  }
  if (status === "cancelled") {
    return {
      label: backendLabel || "已取消",
      meta: backendNextAction || "无需处理",
      tone: "neutral",
      rowClass: "warehouse-receipt-row--muted",
    };
  }
  return {
    label: backendLabel || INBOUND_STATUS_LABELS[status] || "待跟进",
    meta: backendNextAction || "查看明细",
    tone: "neutral",
    rowClass: "warehouse-receipt-row--muted",
  };
}

function getReceiptPrimaryAction(row: InboundReceiptRow) {
  const status = String(row.status || "");
  if (status === "pending_arrival") {
    return {
      action: "register_arrival",
      label: "确认到仓",
      successText: "已确认到仓",
      helper: "先确认货已到仓，再进入核数和入库。",
      allowPartialReceive: false,
    };
  }
  if (status === "arrived") {
    return {
      action: "confirm_count",
      label: "提交核数",
      successText: "已提交核数",
      helper: "按采购单核对实收，数量一致后进入待入库确认。",
      allowPartialReceive: true,
    };
  }
  if (status === "counted") {
    return {
      action: "confirm_inbound",
      label: "确认入库",
      successText: "已确认入库",
      helper: "核数已完成，确认后进入已入库状态。",
      allowPartialReceive: false,
    };
  }
  return {
    action: "confirm_count",
    label: "入库",
    successText: "已确认入库",
    helper: "查看单据明细后处理。",
    allowPartialReceive: false,
  };
}

function getBulkInboundBlockReason(row: InboundReceiptRow, role: string): string | null {
  if (!canRole(role, ["warehouse", "manager", "admin"])) return "当前角色无批量处理权限";
  if (INBOUND_ACTION_STATUSES.has(row.status)) return null;
  if (INBOUND_EXCEPTION_STATUSES.has(row.status)) return "异常单需单独处理并填写说明";
  if (row.status === "inbounded_pending_qc") return "已入库单不可重复入库";
  if (row.status === "cancelled") return "已取消单据不可入库";
  return `${INBOUND_STATUS_LABELS[row.status] || row.status || "当前状态"}不可批量处理`;
}

export default function WarehouseCenter() {
  const auth = useErpAuth();
  const role = auth.currentUser?.role || "";
  const navigate = useNavigate();
  const cachedData = useMemo(
    () => normalizeWarehouseWorkbenchCache(readPageCache<WarehouseWorkbench>(WAREHOUSE_WORKBENCH_CACHE_KEY, {})),
    [],
  );
  const [data, setData] = useState<WarehouseWorkbench>(cachedData);
  const [inboundReceiptPageSize, setInboundReceiptPageSize] = useState(() => (
    normalizeReceiptPageSize(cachedData.inboundReceiptPage?.limit)
  ));
  const [inboundReceiptPage, setInboundReceiptPage] = useState(() => {
    const limit = normalizeReceiptPageSize(cachedData.inboundReceiptPage?.limit);
    return Math.floor(Number(cachedData.inboundReceiptPage?.offset || 0) / limit) + 1;
  });
  const [inboundReceiptTotal, setInboundReceiptTotal] = useState(() => (
    Number(cachedData.inboundReceiptPage?.total ?? cachedData.summary?.inboundReceiptCount ?? cachedData.inboundReceipts?.length ?? 0)
  ));
  const [loadedOnce, setLoadedOnce] = useState(() => hasPageCache(cachedData));
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [receiptScopeKey, setReceiptScopeKey] = useState<ReceiptScopeKey>(DEFAULT_RECEIPT_SCOPE);
  const [receiptQueueKey, setReceiptQueueKey] = useState<ReceiptQueueKey>("all");
  const [receiptSearchDraft, setReceiptSearchDraft] = useState("");
  const [receiptKeyword, setReceiptKeyword] = useState("");
  const [receiptSupplierDraft, setReceiptSupplierDraft] = useState("");
  const [receiptSupplierFilter, setReceiptSupplierFilter] = useState("");
  const [receiptIssueDraft, setReceiptIssueDraft] = useState<ReceiptIssueKey>("all");
  const [receiptIssueFilter, setReceiptIssueFilter] = useState<ReceiptIssueKey>("all");
  const [receiptDateRangeDraft, setReceiptDateRangeDraft] = useState<any>(null);
  const [receiptDateFrom, setReceiptDateFrom] = useState("");
  const [receiptDateTo, setReceiptDateTo] = useState("");
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [receiptDetailDrawerOpen, setReceiptDetailDrawerOpen] = useState(false);
  const [selectedReceiptIds, setSelectedReceiptIds] = useState<string[]>([]);
  const [receiptLinesById, setReceiptLinesById] = useState<Record<string, InboundReceiptLineRow[]>>({});
  const [receiptTimelineById, setReceiptTimelineById] = useState<Record<string, InboundReceiptTimelineRow[]>>({});
  const [receiptLogisticsById, setReceiptLogisticsById] = useState<Record<string, InboundLogisticsDetail>>({});
  const [logisticsDialog, setLogisticsDialog] = useState<{
    receipt: InboundReceiptRow;
    detail: InboundLogisticsDetail | null;
    loading: boolean;
  } | null>(null);
  const [editReceiptModal, setEditReceiptModal] = useState<{
    receiptId: string;
    receiptNo: string;
    status: string;
    sourceStatus: string;
    receivedAt: string;
    warehouseName: string;
    logisticsCompany: string;
    trackingNo: string;
    sourceRemark: string;
    lines: InboundReceiptEditableLine[];
    loading: boolean;
    saving: boolean;
  } | null>(null);
  const [detailLoadingReceiptId, setDetailLoadingReceiptId] = useState<string | null>(null);
  const [bulkInboundReviewOpen, setBulkInboundReviewOpen] = useState(false);
  const [receiptColumnConfig, setReceiptColumnConfig] = useState<WarehouseReceiptColumnConfig>(() => readWarehouseReceiptColumnConfig());
  const [receiptColumnDraft, setReceiptColumnDraft] = useState<WarehouseReceiptColumnConfig | null>(null);
  const [receiptColumnMenu, setReceiptColumnMenu] = useState({
    open: false,
    x: 0,
    y: 0,
    bodyMaxHeight: WAREHOUSE_RECEIPT_COLUMN_MENU_MAX_BODY_HEIGHT,
  });
  const [receiptDraggedColumn, setReceiptDraggedColumn] = useState<string | null>(null);
  const receiptLinesByIdRef = useRef(receiptLinesById);
  const receiptLineLoadingIdsRef = useRef(new Set<string>());
  const [partialReceiveModal, setPartialReceiveModal] = useState<{
    receiptId: string;
    receiptNo: string;
    lines: Array<{ id: string; skuCode?: string; productName?: string; expectedQty: number; receivedQty: number; damagedQty: number }>;
    loading: boolean;
  } | null>(null);
  const [resolveExceptionModal, setResolveExceptionModal] = useState<{
    receiptId: string;
    receiptNo: string;
    expectedQty: number;
    receivedQty: number;
    shortageQty: number;
    overQty: number;
    damagedQty: number;
    remark: string;
    loading: boolean;
  } | null>(null);

  const buildWorkbenchParams = useCallback((overrides: Partial<WarehouseWorkbenchParams> = {}): WarehouseWorkbenchParams => {
    const queueStatuses = overrides.inboundReceiptStatus ?? RECEIPT_QUEUE_STATUS[receiptQueueKey];
    const keyword = String(overrides.inboundReceiptKeyword ?? receiptKeyword).trim();
    const supplier = String(overrides.inboundReceiptSupplier ?? receiptSupplierFilter).trim();
    const issue = String(overrides.inboundReceiptIssue ?? receiptIssueFilter).trim();
    const scope = String(overrides.inboundReceiptScope ?? receiptScopeKey).trim();
    const dateFrom = String(overrides.inboundReceiptDateFrom ?? receiptDateFrom).trim();
    const dateTo = String(overrides.inboundReceiptDateTo ?? receiptDateTo).trim();
    const receiptLimit = normalizeReceiptPageSize(overrides.inboundReceiptLimit, inboundReceiptPageSize);
    return {
      inboundReceiptLimit: receiptLimit,
      inboundReceiptOffset: normalizeOffsetNumber(
        overrides.inboundReceiptOffset,
        (Math.max(1, inboundReceiptPage) - 1) * receiptLimit,
      ),
      ...(queueStatuses.length ? { inboundReceiptStatus: queueStatuses } : {}),
      ...(keyword ? { inboundReceiptKeyword: keyword } : {}),
      ...(supplier ? { inboundReceiptSupplier: supplier } : {}),
      ...(dateFrom ? { inboundReceiptDateFrom: dateFrom } : {}),
      ...(dateTo ? { inboundReceiptDateTo: dateTo } : {}),
      ...(issue && issue !== "all" ? { inboundReceiptIssue: issue } : {}),
      ...(scope && scope !== "all" ? { inboundReceiptScope: scope } : {}),
    };
  }, [
    inboundReceiptPage,
    inboundReceiptPageSize,
    receiptDateFrom,
    receiptDateTo,
    receiptIssueFilter,
    receiptKeyword,
    receiptQueueKey,
    receiptScopeKey,
    receiptSupplierFilter,
  ]);

  const applyWorkbench = useCallback((workbench: WarehouseWorkbench, params: WarehouseWorkbenchParams = buildWorkbenchParams()) => {
    const sourceWorkbench = workbench || {};
    const receiptLimit = normalizeReceiptPageSize(
      sourceWorkbench.inboundReceiptPage?.limit,
      params.inboundReceiptLimit,
    );
    const receiptOffset = normalizeOffsetNumber(
      sourceWorkbench.inboundReceiptPage?.offset,
      params.inboundReceiptOffset,
    );
    const receiptTotal = Number(
      sourceWorkbench.inboundReceiptPage?.total
      ?? sourceWorkbench.summary?.inboundReceiptCount
      ?? sourceWorkbench.inboundReceipts?.length
      ?? 0,
    );
    const receiptRowsOffset = sourceWorkbench.inboundReceiptPage ? 0 : receiptOffset;
    const nextWorkbench = {
      ...sourceWorkbench,
      inboundReceiptPage: {
        limit: receiptLimit,
        offset: receiptOffset,
        total: receiptTotal,
      },
      inboundReceipts: takePageRows(sourceWorkbench.inboundReceipts, receiptLimit, receiptRowsOffset),
    };
    setInboundReceiptTotal(receiptTotal);
    setData(nextWorkbench);
    setLoadedOnce(true);
    writePageCache(WAREHOUSE_WORKBENCH_CACHE_KEY, nextWorkbench);
  }, [buildWorkbenchParams]);

  const loadData = useCallback(async (options: { silent?: boolean; params?: WarehouseWorkbenchParams } = {}) => {
    if (!erp) return;
    const params = options.params || buildWorkbenchParams();
    if (!options.silent) setLoading(true);
    try {
      applyWorkbench(await erp.warehouse.workbench(params), params);
    } catch (error: any) {
      if (!options.silent) message.error(error?.message || "仓库中心读取失败");
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [applyWorkbench, buildWorkbenchParams]);

  useEffect(() => {
    // 异步加载：缓存有就 silent，无 spinner / 不闪屏；缓存空才显示加载状态。
    void loadData({ silent: hasPageCache(cachedData) });
  }, []);

  useEffect(() => {
    receiptLinesByIdRef.current = receiptLinesById;
  }, [receiptLinesById]);

  const loadReceiptLines = useCallback(async (receiptId: string, force = false) => {
    if (!erp || !receiptId) return;
    if (!force && receiptLinesByIdRef.current[receiptId]) return;
    if (receiptLineLoadingIdsRef.current.has(receiptId)) return;
    receiptLineLoadingIdsRef.current.add(receiptId);
    setDetailLoadingReceiptId(receiptId);
    try {
      const result = await erp.warehouse.action({
        action: "get_inbound_lines",
        receiptId,
      });
      const normalizedLines = normalizeInboundLines(result?.result?.lines || []);
      setReceiptLinesById((prev) => {
        const next = { ...prev, [receiptId]: normalizedLines };
        receiptLinesByIdRef.current = next;
        return next;
      });
      setReceiptTimelineById((prev) => ({
        ...prev,
        [receiptId]: normalizeInboundTimeline(result?.result?.timeline || []),
      }));
    } catch (error: any) {
      message.error(error?.message || "拉取入库明细失败");
    } finally {
      receiptLineLoadingIdsRef.current.delete(receiptId);
      setDetailLoadingReceiptId((current) => (current === receiptId ? null : current));
    }
  }, []);

  const closeReceiptDetail = useCallback(() => {
    setReceiptDetailDrawerOpen(false);
    setSelectedReceiptId(null);
  }, []);

  const openReceiptDetail = useCallback((row: InboundReceiptRow) => {
    setSelectedReceiptId((current) => {
      const closingCurrent = current === row.id && receiptDetailDrawerOpen;
      if (closingCurrent) {
        setReceiptDetailDrawerOpen(false);
        return null;
      }
      setReceiptDetailDrawerOpen(true);
      void loadReceiptLines(row.id);
      return row.id;
    });
  }, [loadReceiptLines, receiptDetailDrawerOpen]);

  const openReceiptLogistics = useCallback(async (row: InboundReceiptRow) => {
    const fallbackDetail = normalizeInboundLogisticsDetail(null, row);
    const cached = receiptLogisticsById[row.id];
    const hasFinalFallback = Boolean(
      fallbackDetail.traceError
      || row.logisticsHasTrace === false
      || row.logisticsHasTrace === 0
      || fallbackDetail.source === "jushuitan",
    );
    setLogisticsDialog({
      receipt: row,
      detail: cached || fallbackDetail,
      loading: !cached && !hasFinalFallback,
    });
    if (!erp || cached || hasFinalFallback) {
      if (!cached && hasFinalFallback) {
        setReceiptLogisticsById((prev) => ({ ...prev, [row.id]: fallbackDetail }));
      }
      return;
    }
    try {
      const response = await erp.warehouse.action({
        action: "get_inbound_logistics",
        receiptId: row.id,
      });
      const detail = normalizeInboundLogisticsDetail(response?.result?.logistics, row);
      setReceiptLogisticsById((prev) => ({ ...prev, [row.id]: detail }));
      setLogisticsDialog((current) => (
        current?.receipt.id === row.id ? { ...current, detail, loading: false } : current
      ));
    } catch (error: any) {
      message.error(error?.message || "读取物流轨迹失败");
      setLogisticsDialog((current) => (
        current?.receipt.id === row.id ? { ...current, loading: false } : current
      ));
    }
  }, [receiptLogisticsById]);

  const runAction = async (key: string, payload: Record<string, any>, successText: string) => {
    if (!erp) return false;
    const params = buildWorkbenchParams();
    const receiptId = String(payload.receiptId || payload.id || "");
    setActingKey(key);
    try {
      const result = await erp.warehouse.action({ ...payload, ...params });
      applyWorkbench(result?.workbench || await erp.warehouse.workbench(params), params);
        if (receiptId) {
          setReceiptLinesById((prev) => {
            const next = { ...prev };
            delete next[receiptId];
            receiptLinesByIdRef.current = next;
            return next;
          });
        setReceiptTimelineById((prev) => {
          const next = { ...prev };
          delete next[receiptId];
          return next;
        });
        if (receiptId === selectedReceiptId) void loadReceiptLines(receiptId, true);
      }
      message.success(successText);
      return true;
    } catch (error: any) {
      message.error(error?.message || "操作失败");
      return false;
    } finally {
      setActingKey(null);
    }
  };

  const openResolveExceptionModal = useCallback((row: InboundReceiptRow) => {
    setResolveExceptionModal({
      receiptId: row.id,
      receiptNo: row.receiptNo || row.id,
      expectedQty: Number(row.expectedQty || 0),
      receivedQty: Number(row.receivedQty || 0),
      shortageQty: Number(row.shortageQty || 0),
      overQty: Number(row.overQty || 0),
      damagedQty: Number(row.damagedQty || 0),
      remark: "",
      loading: false,
    });
  }, []);

  const submitResolveExceptionModal = useCallback(async () => {
    if (!resolveExceptionModal) return;
    const remark = resolveExceptionModal.remark.trim();
    if (!remark) {
      message.warning("请填写异常处理说明");
      return;
    }
    setResolveExceptionModal({ ...resolveExceptionModal, loading: true });
    const ok = await runAction(
      `resolve-inbound-${resolveExceptionModal.receiptId}`,
      {
        action: "resolve_inbound_exception",
        receiptId: resolveExceptionModal.receiptId,
        resolutionRemark: remark,
      },
      "已处理异常并确认入库",
    );
    if (ok) {
      setResolveExceptionModal(null);
      return;
    }
    setResolveExceptionModal((current) => (
      current?.receiptId === resolveExceptionModal.receiptId
        ? { ...current, loading: false }
        : current
    ));
  }, [resolveExceptionModal]);

  const openPartialReceiveModal = useCallback(async (row: InboundReceiptRow) => {
    const cachedLines = receiptLinesByIdRef.current[row.id];
    if (cachedLines) {
      setPartialReceiveModal({
        receiptId: row.id,
        receiptNo: row.receiptNo || row.id,
        lines: toPartialReceiveLines(cachedLines),
        loading: false,
      });
      return;
    }
    setPartialReceiveModal({ receiptId: row.id, receiptNo: row.receiptNo || row.id, lines: [], loading: true });
    try {
      const result = await erp?.warehouse?.action({ action: "get_inbound_lines", receiptId: row.id });
      const normalizedLines = normalizeInboundLines(result?.result?.lines || []);
      setReceiptLinesById((prev) => {
        const next = { ...prev, [row.id]: normalizedLines };
        receiptLinesByIdRef.current = next;
        return next;
      });
      setReceiptTimelineById((prev) => ({
        ...prev,
        [row.id]: normalizeInboundTimeline(result?.result?.timeline || []),
      }));
      const lines = toPartialReceiveLines(normalizedLines);
      setPartialReceiveModal({ receiptId: row.id, receiptNo: row.receiptNo || row.id, lines, loading: false });
    } catch (error: any) {
      message.error(error?.message || "拉取入库行失败");
      setPartialReceiveModal(null);
    }
  }, []);

  const updateEditReceiptLine = useCallback((lineId: string, patch: Partial<InboundReceiptEditableLine>) => {
    setEditReceiptModal((current) => (
      current
        ? {
          ...current,
          lines: current.lines.map((line) => (
            line.id === lineId ? { ...line, ...patch } : line
          )),
        }
        : current
    ));
  }, []);

  const openEditReceiptModal = useCallback(async (row: InboundReceiptRow) => {
    const cachedLines = receiptLinesByIdRef.current[row.id];
    const product = getReceiptProductDisplay(row);
    const fallbackLines: InboundReceiptEditableLine[] = [{
      id: `${row.id}-summary`,
      skuCode: product.skuCode,
      productName: product.productName || row.skuSummary || "",
      expectedQty: Number(row.expectedQty || 0),
      receivedQty: Number(row.receivedQty || 0),
      damagedQty: Number(row.damagedQty || 0),
    }];
    setEditReceiptModal({
      receiptId: row.id,
      receiptNo: row.receiptNo || row.id,
      status: String(row.status || ""),
      sourceStatus: row.sourceStatus || INBOUND_STATUS_LABELS[String(row.status || "")] || "",
      receivedAt: row.receivedAt || "",
      warehouseName: row.warehouseName || JUSHUITAN_WAREHOUSE_NAME,
      logisticsCompany: row.logistics?.companyName || "",
      trackingNo: row.logistics?.billNo || "",
      sourceRemark: row.sourceRemark || "",
      lines: cachedLines ? toEditableReceiptLines(cachedLines) : fallbackLines,
      loading: !cachedLines,
      saving: false,
    });
    if (cachedLines || !erp) return;
    try {
      const result = await erp.warehouse.action({ action: "get_inbound_lines", receiptId: row.id });
      const normalizedLines = normalizeInboundLines(result?.result?.lines || []);
      setReceiptLinesById((prev) => {
        const next = { ...prev, [row.id]: normalizedLines };
        receiptLinesByIdRef.current = next;
        return next;
      });
      setReceiptTimelineById((prev) => ({
        ...prev,
        [row.id]: normalizeInboundTimeline(result?.result?.timeline || []),
      }));
      setEditReceiptModal((current) => (
        current?.receiptId === row.id
          ? { ...current, lines: toEditableReceiptLines(normalizedLines), loading: false }
          : current
      ));
    } catch (error: any) {
      message.error(error?.message || "拉取入库行失败");
      setEditReceiptModal((current) => (
        current?.receiptId === row.id ? { ...current, loading: false } : current
      ));
    }
  }, []);

  const submitEditReceiptModal = useCallback(async () => {
    if (!erp || !editReceiptModal) return;
    const params = buildWorkbenchParams();
    setEditReceiptModal({ ...editReceiptModal, saving: true });
    try {
      const result = await erp.warehouse.action({
        ...params,
        action: "update_inbound_receipt",
        receiptId: editReceiptModal.receiptId,
        status: editReceiptModal.status,
        sourceStatus: editReceiptModal.sourceStatus,
        receivedAt: editReceiptModal.receivedAt,
        warehouseName: editReceiptModal.warehouseName,
        logisticsCompany: editReceiptModal.logisticsCompany,
        trackingNo: editReceiptModal.trackingNo,
        sourceRemark: editReceiptModal.sourceRemark,
        lines: editReceiptModal.lines.map((line) => ({
          id: line.id,
          expected_qty: Number(line.expectedQty || 0),
          received_qty: Number(line.receivedQty || 0),
          damaged_qty: Number(line.damagedQty || 0),
        })),
      });
      applyWorkbench(result?.workbench || await erp.warehouse.workbench(params), params);
      const normalizedLines = normalizeInboundLines(result?.result?.lines || []);
      if (normalizedLines.length) {
        setReceiptLinesById((prev) => {
          const next = { ...prev, [editReceiptModal.receiptId]: normalizedLines };
          receiptLinesByIdRef.current = next;
          return next;
        });
      }
      setReceiptTimelineById((prev) => ({
        ...prev,
        [editReceiptModal.receiptId]: normalizeInboundTimeline(result?.result?.timeline || []),
      }));
      setEditReceiptModal(null);
      message.success("入库单已修改");
    } catch (error: any) {
      message.error(error?.message || "修改入库单失败");
      setEditReceiptModal((current) => (
        current?.receiptId === editReceiptModal.receiptId ? { ...current, saving: false } : current
      ));
    }
  }, [applyWorkbench, buildWorkbenchParams, editReceiptModal]);

  const applyInboundReceiptPagination = useCallback((nextPage: number, nextPageSize?: number) => {
    const pageSize = normalizeReceiptPageSize(nextPageSize, inboundReceiptPageSize);
    const page = normalizePositiveNumber(nextPage, 1);
    const params = buildWorkbenchParams({
      inboundReceiptLimit: pageSize,
      inboundReceiptOffset: (page - 1) * pageSize,
    });
    setReceiptDetailDrawerOpen(false);
    setSelectedReceiptId(null);
    setSelectedReceiptIds([]);
    setInboundReceiptPageSize(pageSize);
    setInboundReceiptPage(page);
    void loadData({ params });
  }, [buildWorkbenchParams, inboundReceiptPageSize, loadData]);

  const updateInboundReceiptPagination = useCallback((nextPage: number, nextPageSize?: number) => {
    applyInboundReceiptPagination(nextPage, nextPageSize || inboundReceiptPageSize);
  }, [applyInboundReceiptPagination, inboundReceiptPageSize]);

  const updateInboundReceiptPageSize = useCallback((nextPageSize: number) => {
    applyInboundReceiptPagination(1, nextPageSize);
  }, [applyInboundReceiptPagination]);

  const switchReceiptQueue = useCallback((key: ReceiptQueueKey) => {
    const params = buildWorkbenchParams({
      inboundReceiptOffset: 0,
      inboundReceiptStatus: RECEIPT_QUEUE_STATUS[key],
    });
    setReceiptDetailDrawerOpen(false);
    setSelectedReceiptId(null);
    setSelectedReceiptIds([]);
    setReceiptQueueKey(key);
    setInboundReceiptPage(1);
    void loadData({ params });
  }, [buildWorkbenchParams, loadData]);

  const switchReceiptScope = useCallback((key: ReceiptScopeKey) => {
    const params = buildWorkbenchParams({
      inboundReceiptOffset: 0,
      inboundReceiptScope: key,
    });
    setReceiptDetailDrawerOpen(false);
    setSelectedReceiptId(null);
    setSelectedReceiptIds([]);
    setReceiptScopeKey(key);
    setInboundReceiptPage(1);
    void loadData({ params });
  }, [buildWorkbenchParams, loadData]);

  const applyReceiptSearch = useCallback((value: string) => {
    const keyword = String(value || "").trim();
    const params = buildWorkbenchParams({
      inboundReceiptOffset: 0,
      inboundReceiptKeyword: keyword,
    });
    setReceiptDetailDrawerOpen(false);
    setSelectedReceiptId(null);
    setSelectedReceiptIds([]);
    setReceiptKeyword(keyword);
    setReceiptSearchDraft(keyword);
    setInboundReceiptPage(1);
    void loadData({ params });
  }, [buildWorkbenchParams, loadData]);

  const applyAdvancedReceiptFilters = useCallback(() => {
    const supplier = receiptSupplierDraft.trim();
    const dateFrom = dateBoundaryIso(receiptDateRangeDraft?.[0], "start");
    const dateTo = dateBoundaryIso(receiptDateRangeDraft?.[1], "end");
    const issue = receiptIssueDraft;
    const params = buildWorkbenchParams({
      inboundReceiptOffset: 0,
      inboundReceiptSupplier: supplier,
      inboundReceiptDateFrom: dateFrom,
      inboundReceiptDateTo: dateTo,
      inboundReceiptIssue: issue,
    });
    setReceiptDetailDrawerOpen(false);
    setSelectedReceiptId(null);
    setSelectedReceiptIds([]);
    setReceiptSupplierFilter(supplier);
    setReceiptDateFrom(dateFrom);
    setReceiptDateTo(dateTo);
    setReceiptIssueFilter(issue);
    setInboundReceiptPage(1);
    void loadData({ params });
  }, [buildWorkbenchParams, loadData, receiptDateRangeDraft, receiptIssueDraft, receiptSupplierDraft]);

  const resetReceiptFilters = useCallback(() => {
    const params = buildWorkbenchParams({
      inboundReceiptOffset: 0,
      inboundReceiptStatus: [],
      inboundReceiptKeyword: "",
      inboundReceiptSupplier: "",
      inboundReceiptDateFrom: "",
      inboundReceiptDateTo: "",
      inboundReceiptIssue: "all",
      inboundReceiptScope: DEFAULT_RECEIPT_SCOPE,
    });
    setReceiptDetailDrawerOpen(false);
    setSelectedReceiptId(null);
    setSelectedReceiptIds([]);
    setReceiptScopeKey(DEFAULT_RECEIPT_SCOPE);
    setReceiptQueueKey("all");
    setReceiptSearchDraft("");
    setReceiptKeyword("");
    setReceiptSupplierDraft("");
    setReceiptSupplierFilter("");
    setReceiptDateRangeDraft(null);
    setReceiptDateFrom("");
    setReceiptDateTo("");
    setReceiptIssueDraft("all");
    setReceiptIssueFilter("all");
    setInboundReceiptPage(1);
    void loadData({ params });
  }, [buildWorkbenchParams, loadData]);

  const selectedReceiptRows = useMemo(() => {
    const selectedSet = new Set(selectedReceiptIds);
    return (data.inboundReceipts || []).filter((row) => selectedSet.has(row.id));
  }, [data.inboundReceipts, selectedReceiptIds]);

  const selectedReceipt = useMemo(() => (
    (data.inboundReceipts || []).find((row) => row.id === selectedReceiptId) || null
  ), [data.inboundReceipts, selectedReceiptId]);

  useEffect(() => {
    if (receiptDetailDrawerOpen && selectedReceiptId && !selectedReceipt) {
      setReceiptDetailDrawerOpen(false);
      setSelectedReceiptId(null);
    }
  }, [receiptDetailDrawerOpen, selectedReceipt, selectedReceiptId]);

  const selectedActionableRows = useMemo(() => (
    selectedReceiptRows.filter((row) => (
      !getBulkInboundBlockReason(row, role)
    ))
  ), [role, selectedReceiptRows]);

  const currentPageActionableRows = useMemo(() => (
    (data.inboundReceipts || []).filter((row) => !getBulkInboundBlockReason(row, role))
  ), [data.inboundReceipts, role]);

  const currentPageBulkSummary = useMemo(() => {
    const rows = data.inboundReceipts || [];
    const blockedCounts = new Map<string, number>();
    rows.forEach((row) => {
      const reason = getBulkInboundBlockReason(row, role);
      if (!reason) return;
      blockedCounts.set(reason, (blockedCounts.get(reason) || 0) + 1);
    });
    return {
      actionable: currentPageActionableRows.length,
      blocked: rows.length - currentPageActionableRows.length,
      blockedText: Array.from(blockedCounts.entries())
        .map(([reason, count]) => `${reason} ${count}单`)
        .join("；"),
    };
  }, [currentPageActionableRows.length, data.inboundReceipts, role]);

  const selectedBulkTotals = useMemo(() => (
    selectedActionableRows.reduce(
      (acc, row) => {
        acc.expectedQty += Number(row.expectedQty || 0);
        acc.receivedQty += Number(row.receivedQty || 0);
        acc.damagedQty += Number(row.damagedQty || 0);
        return acc;
      },
      { expectedQty: 0, receivedQty: 0, damagedQty: 0 },
    )
  ), [selectedActionableRows]);

  const selectedBulkTaskSummary = useMemo(() => {
    const counts = new Map<string, number>();
    selectedActionableRows.forEach((row) => {
      const action = getReceiptPrimaryAction(row);
      counts.set(action.label, (counts.get(action.label) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
  }, [selectedActionableRows]);

  const selectedBulkPreviewRows = useMemo(() => selectedActionableRows.slice(0, 5), [selectedActionableRows]);
  const selectedBlockedCount = Math.max(0, selectedReceiptIds.length - selectedActionableRows.length);
  const activeReceiptColumnConfig = useMemo(
    () => normalizeWarehouseReceiptColumnConfig(receiptColumnMenu.open ? (receiptColumnDraft || receiptColumnConfig) : receiptColumnConfig),
    [receiptColumnConfig, receiptColumnDraft, receiptColumnMenu.open],
  );

  const openReceiptColumnMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const position = warehouseReceiptColumnMenuPosition(event.clientX, event.clientY);
    setReceiptColumnDraft({
      order: [...receiptColumnConfig.order],
      visible: [...receiptColumnConfig.visible],
    });
    setReceiptColumnMenu({
      open: true,
      ...position,
    });
  }, [receiptColumnConfig]);

  const reorderReceiptDraftColumn = useCallback((sourceField: string, targetField: string) => {
    if (!sourceField || !targetField || sourceField === targetField) return;
    setReceiptColumnDraft((prev) => {
      const current = normalizeWarehouseReceiptColumnConfig(prev || receiptColumnConfig);
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
  }, [receiptColumnConfig]);

  const handleReceiptColumnDragStart = useCallback((event: DragEvent<HTMLDivElement>, field: string) => {
    setReceiptDraggedColumn(field);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", field);
  }, []);

  const handleReceiptColumnDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handleReceiptColumnDrop = useCallback((event: DragEvent<HTMLDivElement>, targetField: string) => {
    event.preventDefault();
    const sourceField = receiptDraggedColumn || event.dataTransfer.getData("text/plain");
    reorderReceiptDraftColumn(sourceField, targetField);
    setReceiptDraggedColumn(null);
  }, [receiptDraggedColumn, reorderReceiptDraftColumn]);

  const handleReceiptColumnDragEnd = useCallback(() => {
    setReceiptDraggedColumn(null);
  }, []);

  const toggleReceiptDraftColumn = useCallback((field: string, checked: boolean) => {
    setReceiptColumnDraft((prev) => {
      const current = normalizeWarehouseReceiptColumnConfig(prev || receiptColumnConfig);
      const visible = new Set(current.visible);
      if (checked) {
        visible.add(field);
      } else if (visible.size > 1) {
        visible.delete(field);
      }
      return { ...current, visible: current.order.filter((key) => visible.has(key)) };
    });
  }, [receiptColumnConfig]);

  const saveReceiptColumnConfig = useCallback(() => {
    const next = normalizeWarehouseReceiptColumnConfig(receiptColumnDraft || receiptColumnConfig);
    setReceiptColumnConfig(next);
    try {
      window.localStorage.setItem(WAREHOUSE_RECEIPT_COLUMN_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage is only a layout convenience.
    }
    setReceiptColumnMenu((prev) => ({ ...prev, open: false }));
  }, [receiptColumnConfig, receiptColumnDraft]);

  const restoreReceiptColumnConfig = useCallback(() => {
    setReceiptColumnDraft(defaultWarehouseReceiptColumnConfig());
  }, []);

  useEffect(() => {
    if (!receiptColumnMenu.open) return undefined;
    const close = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(".purchase-order-column-menu")) return;
      setReceiptColumnMenu((prev) => ({ ...prev, open: false }));
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReceiptColumnMenu((prev) => ({ ...prev, open: false }));
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [receiptColumnMenu.open]);

  const selectCurrentPageActionable = useCallback(() => {
    const nextIds = currentPageActionableRows.map((row) => row.id);
    if (!nextIds.length) {
      message.warning("当前页没有可批量处理单据");
      return;
    }
    setSelectedReceiptIds(nextIds);
  }, [currentPageActionableRows]);

  const openBulkInboundReview = useCallback(() => {
    if (!selectedActionableRows.length) {
      message.warning("请选择待处理单据");
      return;
    }
    setBulkInboundReviewOpen(true);
  }, [selectedActionableRows.length]);

  const receiptRowSelection = useMemo<TableRowSelection<InboundReceiptRow>>(() => ({
    selectedRowKeys: selectedReceiptIds,
    preserveSelectedRowKeys: false,
    onChange: (keys) => setSelectedReceiptIds(keys.map(String)),
    getCheckboxProps: (row) => {
      const blockReason = getBulkInboundBlockReason(row, role);
      return {
        disabled: Boolean(blockReason),
        title: blockReason || "可批量处理",
      };
    },
  }), [role, selectedReceiptIds]);

  const runBulkInbound = useCallback(async () => {
    if (!erp) return false;
    const receiptIds = selectedActionableRows.map((row) => row.id);
    if (!receiptIds.length) {
      message.warning("请选择待处理单据");
      return false;
    }
    const params = buildWorkbenchParams();
    setActingKey("bulk-inbound");
    try {
      const result = await erp.warehouse.action({ action: "confirm_inbound_bulk", receiptIds, ...params });
      applyWorkbench(result?.workbench || await erp.warehouse.workbench(params), params);
      setReceiptDetailDrawerOpen(false);
      setSelectedReceiptId(null);
      setSelectedReceiptIds([]);
      setReceiptLinesById((prev) => {
        const next = { ...prev };
        receiptIds.forEach((id) => { delete next[id]; });
        receiptLinesByIdRef.current = next;
        return next;
      });
      setReceiptTimelineById((prev) => {
        const next = { ...prev };
        receiptIds.forEach((id) => { delete next[id]; });
        return next;
      });
      message.success(`已批量处理 ${result?.result?.count || receiptIds.length} 单`);
      return true;
    } catch (error: any) {
      message.error(error?.message || "批量处理失败");
      return false;
    } finally {
      setActingKey(null);
    }
  }, [applyWorkbench, buildWorkbenchParams, selectedActionableRows]);

  const receiptColumns = useMemo<ColumnsType<InboundReceiptRow>>(() => {
    const columnField = (column: ColumnsType<InboundReceiptRow>[number]) => {
      const rawField = (column as any).key ?? (column as any).dataIndex;
      return Array.isArray(rawField) ? rawField.join(".") : String(rawField || "");
    };
    const buildColumnMenuHeaderProps = () => ({
      title: "右键配置列",
      className: "purchase-order-column-configurable",
      onContextMenu: openReceiptColumnMenu,
    });
    const columns: ColumnsType<InboundReceiptRow> = [
    {
      title: "入库单",
      key: "receipt",
      width: 135,
      render: (_value, row) => (
        <Text strong copyable={{ text: String(row.receiptNo || row.id) }}>
          {row.receiptNo || row.id}
        </Text>
      ),
    },
    {
      title: "采购单号",
      key: "poNo",
      width: 135,
      render: (_value, row) => (
        row.poNo ? (
          <a
            className="erp-link"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard?.writeText(String(row.poNo)).catch(() => {});
              navigate(`/purchase-center?focusPo=${encodeURIComponent(String(row.poNo))}`);
            }}
          >
            {row.poNo}
          </a>
        ) : (
          <Text type="secondary">{row.poId || "-"}</Text>
        )
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 150,
      render: (value, row) => (
        <Space direction="vertical" size={2}>
          {statusTag(value, INBOUND_STATUS_LABELS)}
          {row.sourceStatus && row.sourceStatus !== INBOUND_STATUS_LABELS[String(value)] ? (
            <Text type="secondary" style={{ fontSize: 12 }}>源：{row.sourceStatus}</Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "图片",
      key: "productImage",
      width: 74,
      align: "center",
      render: (_value, row) => {
        const product = getReceiptProductDisplay(row);
        if (!product.productImageUrl) {
          return <div className="warehouse-product-image warehouse-product-image--empty">无图</div>;
        }
        return (
          <img
            src={product.productImageUrl}
            width={44}
            height={44}
            alt=""
            loading="lazy"
            decoding="async"
            className="warehouse-product-image warehouse-product-image--thumb"
            onError={(event) => {
              event.currentTarget.src = WAREHOUSE_PRODUCT_IMAGE_FALLBACK;
            }}
            onClick={(event) => event.stopPropagation()}
          />
        );
      },
    },
    {
      title: "供应商",
      dataIndex: "supplierName",
      key: "supplierName",
      width: 180,
      ellipsis: true,
      render: (value) => <Text title={String(value || "")}>{value || "-"}</Text>,
    },
    {
      title: "商品名称",
      key: "productName",
      width: 360,
      render: (_value, row) => {
        const product = getReceiptProductDisplay(row);
        return (
          <Space direction="vertical" size={2} className="warehouse-product-name-cell">
            <Text>{product.productName || "-"}</Text>
            {Number(row.lineCount || 0) > 1 ? (
              <Text type="secondary" style={{ fontSize: 12 }}>共 {formatQty(row.lineCount)} 行商品</Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: "商品编码",
      key: "skuCode",
      width: 210,
      render: (_value, row) => {
        const product = getReceiptProductDisplay(row);
        return product.skuCode ? (
          <Text copyable={{ text: product.skuCode }} className="warehouse-sku-code">
            {product.skuCode}
          </Text>
        ) : (
          <Text type="secondary">-</Text>
        );
      },
    },
    {
      title: "数量",
      key: "qty",
      width: 180,
      align: "right",
      render: (_value, row) => {
        const issueTags = getIssueTags(row);
        return (
          <Space direction="vertical" size={2} style={{ alignItems: "flex-end" }}>
            <Text strong>{formatQty(row.receivedQty)} / {formatQty(row.expectedQty)} 已收</Text>
            {issueTags.length ? (
              <Space size={4} wrap style={{ justifyContent: "flex-end" }}>
                {issueTags.map((tag) => <Tag key={tag.key} color={tag.color}>{tag.label}</Tag>)}
              </Space>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>无差异</Text>
            )}
          </Space>
        );
      },
    },
    {
      title: "物流",
      key: "logistics",
      width: 200,
      render: (_value, row) => {
        const billNo = row?.logistics?.billNo;
        const company = row?.logistics?.companyName;
        if (!billNo && !company) return <Text type="secondary">-</Text>;
        return (
          <Space direction="vertical" size={2}>
            <Text style={{ fontSize: 12 }}>{company || "未知物流公司"}</Text>
            {billNo ? (
              <Space size={4} wrap>
                <Button
                  type="link"
                  size="small"
                  icon={<SearchOutlined />}
                  className="warehouse-logistics-link"
                  onClick={(event) => {
                    event.stopPropagation();
                    void openReceiptLogistics(row);
                  }}
                >
                  {billNo}
                </Button>
                <Text copyable={{ text: billNo }} style={{ fontSize: 12 }} />
              </Space>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>无运单号</Text>
            )}
          </Space>
        );
      },
    },
    {
      title: "入库时间",
      dataIndex: "receivedAt",
      width: 180,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{formatDateTime(row.receivedAt)}</Text>
          <Space size={4} wrap>
            {row.isOverdue ? <Tag color="red">超期 {formatAgeHours(row.ageHours)}</Tag> : null}
            {row.isToday ? <Tag color="green">今日</Tag> : null}
            {!row.isOverdue && !row.isToday && (INBOUND_ACTION_STATUSES.has(row.status) || INBOUND_EXCEPTION_STATUSES.has(row.status)) ? (
              <Text type="secondary" style={{ fontSize: 12 }}>{formatAgeHours(row.ageHours)}</Text>
            ) : null}
          </Space>
        </Space>
      ),
    },
    {
      title: "动作",
      key: "actions",
      width: 230,
      fixed: "right",
      render: (_value, row) => {
        if (INBOUND_EXCEPTION_STATUSES.has(row.status) && canRole(role, ["warehouse", "manager", "admin"])) {
          return (
            <Space size={6} wrap>
              <Button
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  void openEditReceiptModal(row);
                }}
              >
                修改
              </Button>
              <Button
                size="small"
                type="primary"
                danger
                loading={actingKey === `resolve-inbound-${row.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  openResolveExceptionModal(row);
                }}
              >
                处理入库
              </Button>
            </Space>
          );
        }
        if (!INBOUND_ACTION_STATUSES.has(row.status) || !canRole(role, ["warehouse", "manager", "admin"])) {
          return (
            <Space size={6} wrap>
              <Button
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  void openEditReceiptModal(row);
                }}
              >
                修改
              </Button>
            </Space>
          );
        }
        const primaryAction = getReceiptPrimaryAction(row);
        const loading = actingKey === `inbound-${row.id}`;
        return (
          <Space size={6} wrap>
            <Button
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                void openEditReceiptModal(row);
              }}
            >
              修改
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<InboxOutlined />}
              loading={loading}
              onClick={(e) => {
                e.stopPropagation();
                void runAction(`inbound-${row.id}`, { action: primaryAction.action, receiptId: row.id }, primaryAction.successText);
              }}
            >
              {primaryAction.label}
            </Button>
            {primaryAction.allowPartialReceive ? (
              <Button
                size="small"
                loading={partialReceiveModal?.receiptId === row.id && partialReceiveModal.loading}
                onClick={(e) => {
                  e.stopPropagation();
                  void openPartialReceiveModal(row);
                }}
              >
                按实数核数
              </Button>
            ) : null}
          </Space>
        );
      },
    },
    ];
    const visibleColumnKeys = new Set(activeReceiptColumnConfig.visible);
    const columnsByField = new Map(
      columns
        .filter((column) => WAREHOUSE_RECEIPT_CONFIGURABLE_COLUMN_KEY_SET.has(columnField(column)))
        .map((column) => [columnField(column), column]),
    );
    const orderedColumns = [
      ...activeReceiptColumnConfig.order
        .filter((field) => visibleColumnKeys.has(field))
        .map((field) => columnsByField.get(field))
        .filter(Boolean),
      ...columns.filter((column) => !WAREHOUSE_RECEIPT_CONFIGURABLE_COLUMN_KEY_SET.has(columnField(column))),
    ] as ColumnsType<InboundReceiptRow>;
    return orderedColumns.map((column) => {
      const field = columnField(column);
      if (!WAREHOUSE_RECEIPT_CONFIGURABLE_COLUMN_KEY_SET.has(field)) return column;
      return {
        ...column,
        onHeaderCell: buildColumnMenuHeaderProps,
      };
    });
  }, [actingKey, activeReceiptColumnConfig, openEditReceiptModal, openPartialReceiveModal, openReceiptColumnMenu, openReceiptLogistics, openResolveExceptionModal, partialReceiveModal, role]);

  const renderReceiptDetail = (sel: InboundReceiptRow, mode: "inline" | "drawer" = "inline") => {
    const canInbound = INBOUND_ACTION_STATUSES.has(sel.status)
      && canRole(role, ["warehouse", "manager", "admin"]);
    const canResolveException = INBOUND_EXCEPTION_STATUSES.has(sel.status)
      && canRole(role, ["warehouse", "manager", "admin"]);
    const taskState = getReceiptTaskState(sel);
    const primaryAction = getReceiptPrimaryAction(sel);
    const selectedLines = receiptLinesById[sel.id] || [];
    const selectedTimeline = receiptTimelineById[sel.id] || [];
    const detailLoading = detailLoadingReceiptId === sel.id;
    const receiptIssueTags = getIssueTags(sel);
    const detailClassName = [
      "warehouse-receipt-detail",
      mode === "drawer" ? "warehouse-receipt-detail--drawer" : "",
    ].filter(Boolean).join(" ");
    const formatOptionalMoney = (value?: number | string | null) => {
      if (value === null || value === undefined || value === "") return "-";
      const number = Number(value);
      if (!Number.isFinite(number)) return "-";
      return formatMoney(number);
    };
    const getLineAmount = (line: InboundReceiptLineRow) => {
      if (line.unitCost === null || line.unitCost === undefined) return null;
      const unitCost = Number(line.unitCost);
      if (!Number.isFinite(unitCost)) return null;
      const qty = Number(line.expectedQty || line.receivedQty || 0);
      if (!Number.isFinite(qty)) return null;
      return unitCost * qty;
    };
    const logisticsValue = sel.logistics?.billNo ? (
      <Button
        type="link"
        size="small"
        icon={<SearchOutlined />}
        className="warehouse-logistics-link"
        onClick={() => void openReceiptLogistics(sel)}
      >
        {sel.logistics.billNo}
      </Button>
    ) : (
      <Text type="secondary">-</Text>
    );
    const actionContent = canInbound ? (
      <>
        <Button
          type="primary"
          icon={<InboxOutlined />}
          loading={actingKey === `detail-inbound-${sel.id}`}
          onClick={() => runAction(`detail-inbound-${sel.id}`, { action: primaryAction.action, receiptId: sel.id }, primaryAction.successText)}
        >
          {primaryAction.label}
        </Button>
        {primaryAction.allowPartialReceive ? (
          <Button
            loading={partialReceiveModal?.receiptId === sel.id && partialReceiveModal.loading}
            onClick={() => void openPartialReceiveModal(sel)}
          >
            按实数核数
          </Button>
        ) : null}
      </>
    ) : canResolveException ? (
      <>
        <Button
          type="primary"
          danger
          loading={actingKey === `detail-resolve-inbound-${sel.id}`}
          onClick={() => openResolveExceptionModal(sel)}
        >
          处理异常并入库
        </Button>
      </>
    ) : (
      <>
        <Tag color="green">已完成</Tag>
      </>
    );
    const basicItems = [
      { label: "入库单号", value: sel.receiptNo || sel.id },
      { label: "采购单号", value: sel.poNo || sel.poId || "-" },
      { label: "供应商", value: sel.supplierName || "-" },
      { label: "入库时间", value: formatDateTime(sel.receivedAt) },
      {
        label: "状态",
        value: (
          <Space size={6} wrap>
            {statusTag(sel.status, INBOUND_STATUS_LABELS)}
            {sel.sourceStatus ? <Tag color="gold">源状态 {sel.sourceStatus}</Tag> : null}
            {receiptIssueTags.length ? receiptIssueTags.map((tag) => <Tag key={tag.key} color={tag.color}>{tag.label}</Tag>) : <Tag>无差异</Tag>}
          </Space>
        ),
      },
      { label: "当前任务", value: `${taskState.label} / ${taskState.meta}` },
      { label: "操作员", value: sel.operatorName || "-" },
      { label: "仓库", value: sel.warehouseName || "-" },
      { label: "数量", value: `${formatQty(sel.receivedQty)} / ${formatQty(sel.expectedQty)} 已收` },
      { label: "物流单号", value: logisticsValue },
      { label: "物流公司", value: sel.logistics?.companyName || "-" },
      { label: "备注", value: sel.isOverdue ? `超期 ${formatAgeHours(sel.ageHours)}` : sel.isToday ? "今日入库" : "-" },
    ];
    const detailLineColumns: ColumnsType<InboundReceiptLineRow> = [
      {
        title: "图片",
        key: "image",
        width: 72,
        align: "center",
        render: (_value, line) => {
          const imageUrl = line.imageUrl || sel.productImageUrl;
          if (!imageUrl) return <div className="warehouse-product-image warehouse-product-image--empty">无图</div>;
          return (
            <Image
              src={imageUrl}
              width={44}
              height={44}
              preview={{ mask: "查看" }}
              className="warehouse-product-image"
              style={{ objectFit: "cover" }}
              fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='44' height='44'%3E%3Crect width='44' height='44' rx='6' fill='%23f1f5f9'/%3E%3Ctext x='22' y='25' text-anchor='middle' font-size='10' fill='%2364748b'%3E无图%3C/text%3E%3C/svg%3E"
              onClick={(event) => event.stopPropagation()}
            />
          );
        },
      },
      {
        title: "商品编码",
        dataIndex: "skuCode",
        width: 170,
        render: (value) => (
          value ? <Text copyable={{ text: String(value) }} className="warehouse-sku-code warehouse-sku-code--detail">{value}</Text> : <Text type="secondary">-</Text>
        ),
      },
      {
        title: "商品名称",
        key: "productName",
        width: 260,
        render: (_value, line) => <Text className="warehouse-product-name-text">{line.productName || sel.skuSummary || "-"}</Text>,
      },
      {
        title: "颜色规格",
        dataIndex: "colorSpec",
        width: 130,
        ellipsis: true,
        render: (value) => <Text title={String(value || "")}>{value || "-"}</Text>,
      },
      {
        title: "款号",
        dataIndex: "styleNo",
        width: 130,
        render: (value) => <Text>{value || "-"}</Text>,
      },
      { title: "数量", dataIndex: "expectedQty", width: 90, align: "right", render: formatQty },
      { title: "单价", dataIndex: "unitCost", width: 90, align: "right", render: formatOptionalMoney },
      {
        title: "金额",
        key: "amount",
        width: 100,
        align: "right",
        render: (_value, line) => formatOptionalMoney(getLineAmount(line)),
      },
      {
        title: "明细备注",
        key: "remark",
        width: 180,
        render: (_value, line) => {
          const tags = getIssueTags(line);
          if (!tags.length) return <Text type="secondary">-</Text>;
          return (
            <Space size={4} wrap>
              {tags.map((tag) => <Tag key={tag.key} color={tag.color}>{tag.label}</Tag>)}
            </Space>
          );
        },
      },
    ];
    const timelineColumns: ColumnsType<InboundReceiptTimelineRow> = [
      {
        title: "操作",
        key: "label",
        width: 140,
        render: (_value, event) => <Text strong>{event.label || event.eventType || "流程事件"}</Text>,
      },
      {
        title: "内容",
        key: "message",
        ellipsis: true,
        render: (_value, event) => <Text title={event.message || ""}>{event.message || "-"}</Text>,
      },
      {
        title: "操作员",
        key: "actor",
        width: 130,
        render: (_value, event) => event.actorName || roleLabel(event.actorRole),
      },
      {
        title: "时间",
        dataIndex: "createdAt",
        width: 180,
        render: formatDateTime,
      },
    ];
    return (
      <div className={detailClassName}>
        <div className="warehouse-detail-card">
          <div className="warehouse-detail-card__head">
            <Text strong>基本信息</Text>
            <Space size={8} wrap className="warehouse-detail-actions">
              {actionContent}
              <Button size="small" onClick={() => void openEditReceiptModal(sel)}>修改</Button>
              <Button size="small" type="text" onClick={closeReceiptDetail}>收起</Button>
            </Space>
          </div>
          <div className="warehouse-detail-basic-grid">
            {basicItems.map((item) => (
              <div className="warehouse-detail-basic-item" key={item.label}>
                <span>{item.label}</span>
                <div className="warehouse-detail-basic-value">{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="warehouse-detail-card">
          <div className="warehouse-detail-card__head">
            <Text strong>入库明细</Text>
            <Text type="secondary">共 {formatQty(selectedLines.length)} 行商品</Text>
          </div>
          <Table
            rowKey="id"
            size="small"
            loading={detailLoading}
            className="erp-compact-table warehouse-detail-line-table"
            pagination={false}
            dataSource={selectedLines}
            locale={{ emptyText: detailLoading ? "正在读取明细..." : "暂无商品明细" }}
            columns={detailLineColumns}
            scroll={{ x: 1220 }}
          />
        </div>

        <div className="warehouse-detail-card">
          <div className="warehouse-detail-card__head">
            <Text strong>操作日志</Text>
            <Text type="secondary">入库单号：{sel.receiptNo || sel.id}</Text>
          </div>
          <Table
            rowKey="id"
            size="small"
            loading={detailLoading}
            className="erp-compact-table warehouse-detail-log-table"
            pagination={false}
            dataSource={selectedTimeline}
            locale={{ emptyText: detailLoading ? "正在读取操作日志..." : "暂无操作日志" }}
            columns={timelineColumns}
            scroll={{ x: 720 }}
          />
        </div>
      </div>
    );
  };

  const editReceiptLineColumns = useMemo<ColumnsType<InboundReceiptEditableLine>>(() => [
    { title: "商品编码", dataIndex: "skuCode", width: 170 },
    {
      title: "商品名称",
      dataIndex: "productName",
      render: (value) => <Text className="warehouse-product-name-text">{value || "-"}</Text>,
    },
    {
      title: "应收",
      width: 110,
      align: "right",
      render: (_value, line) => (
        <InputNumber
          size="small"
          min={0}
          precision={0}
          value={line.expectedQty}
          onChange={(value) => updateEditReceiptLine(line.id, { expectedQty: Number(value || 0) })}
        />
      ),
    },
    {
      title: "实收",
      width: 110,
      align: "right",
      render: (_value, line) => (
        <InputNumber
          size="small"
          min={0}
          precision={0}
          value={line.receivedQty}
          onChange={(value) => updateEditReceiptLine(line.id, { receivedQty: Number(value || 0) })}
        />
      ),
    },
    {
      title: "破损",
      width: 110,
      align: "right",
      render: (_value, line) => (
        <InputNumber
          size="small"
          min={0}
          precision={0}
          value={line.damagedQty}
          onChange={(value) => updateEditReceiptLine(line.id, { damagedQty: Number(value || 0) })}
        />
      ),
    },
  ], [updateEditReceiptLine]);

  const summary = data.summary || {};
  const pendingInboundCount = Number(summary.arrivedCount || 0) + Number(summary.countedCount || 0);
  const actionableCount = Number(summary.actionableCount || 0);
  const todayReceiptCount = Number(summary.todayReceiptCount || 0);
  const overdueReceiptCount = Number(summary.overdueReceiptCount || 0);
  const receiptQueueItems = useMemo<Array<ReceiptStatusItem<ReceiptQueueKey>>>(() => ([
    { value: "all", label: "全部", count: Number(summary.inboundReceiptCount || 0), meta: "总入库单", tone: "blue" },
    { value: "pending_arrival", label: "待到货", count: Number(summary.pendingArrivalCount || 0), meta: "未到仓", tone: "amber" },
    { value: "to_inbound", label: "待入库", count: pendingInboundCount, meta: "到仓待确认", tone: "blue" },
    { value: "exception", label: "异常", count: Number(summary.exceptionCount || 0), meta: "需处理", tone: "red" },
    { value: "inbounded", label: "已入库", count: Number(summary.inboundedPendingQcCount || 0), meta: "已完成", tone: "green" },
  ]), [
    pendingInboundCount,
    summary.exceptionCount,
    summary.inboundReceiptCount,
    summary.inboundedPendingQcCount,
    summary.pendingArrivalCount,
  ]);
  const receiptScopeItems = useMemo<Array<ReceiptStatusItem<ReceiptScopeKey>>>(() => ([
    { value: "all", label: "全部", count: Number(summary.inboundReceiptCount || 0), meta: "完整队列", tone: "blue" },
    { value: "actionable", label: "待处理", count: actionableCount, meta: `${RECEIPT_OVERDUE_HOURS}h SLA`, tone: "amber" },
    { value: "today", label: "今日", count: todayReceiptCount, meta: "今日到仓", tone: "green" },
    { value: "overdue", label: "超期", count: overdueReceiptCount, meta: "优先处理", tone: "red" },
  ]), [actionableCount, overdueReceiptCount, summary.inboundReceiptCount, todayReceiptCount]);
  const activeReceiptScope = receiptScopeItems.find((item) => item.value === receiptScopeKey) || receiptScopeItems[0];
  const activeReceiptQueue = receiptQueueItems.find((item) => item.value === receiptQueueKey) || receiptQueueItems[0];
  const activeFilterLabels = useMemo(() => ([
    receiptScopeKey !== DEFAULT_RECEIPT_SCOPE ? "工作视图" : "",
    receiptQueueKey !== "all" ? "状态队列" : "",
    receiptKeyword ? `搜索：${receiptKeyword}` : "",
    receiptSupplierFilter ? `供应商：${receiptSupplierFilter}` : "",
    receiptIssueFilter !== "all" ? RECEIPT_ISSUE_OPTIONS.find((item) => item.value === receiptIssueFilter)?.label || "差异" : "",
    receiptDateFrom || receiptDateTo ? "入库日期" : "",
  ].filter(Boolean)), [receiptDateFrom, receiptDateTo, receiptIssueFilter, receiptKeyword, receiptQueueKey, receiptScopeKey, receiptSupplierFilter]);
  const activeFilterCount = activeFilterLabels.length;
  const receiptTableEmptyText = useMemo(() => {
    if (
      receiptKeyword
      || receiptSupplierFilter
      || receiptIssueFilter !== "all"
      || receiptDateFrom
      || receiptDateTo
    ) {
      return "没有匹配的入库单";
    }
    if (receiptScopeKey === "actionable") return "当前没有待处理入库单";
    if (receiptScopeKey === "today") return "今日暂无到仓入库单";
    if (receiptScopeKey === "overdue") return "当前没有超期入库单";
    if (receiptQueueKey === "pending_arrival") return "当前没有待到货入库单";
    if (receiptQueueKey === "to_inbound") return "当前没有待入库单";
    if (receiptQueueKey === "exception") return "当前没有异常入库单";
    if (receiptQueueKey === "inbounded") return "暂无已入库记录";
    return "暂无入库单";
  }, [
    receiptDateFrom,
    receiptDateTo,
    receiptIssueFilter,
    receiptKeyword,
    receiptQueueKey,
    receiptScopeKey,
    receiptSupplierFilter,
  ]);
  const tableLoading = loading && !loadedOnce;
  const logisticsDetail = logisticsDialog?.detail || null;
  const logisticsTraceItems = logisticsDetail?.traceItems || [];
  const logisticsStatusLabel = logisticsDetail?.signed
    ? "已签收"
    : logisticsDetail?.shipped
      ? "运输中"
      : (logisticsDetail?.status || "暂无状态");
  const logisticsStatusColor = logisticsDetail?.signed ? "green" : logisticsDetail?.shipped ? "blue" : "default";
  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="系统" title="仓库中心" subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境缺少本地服务接口" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <div className="app-panel warehouse-workbench-panel" style={{ marginBottom: 16 }}>
        <div className="warehouse-workbench-header">
          <div className="warehouse-workbench-heading">
            <div className="warehouse-workbench-eyebrow">仓库中心</div>
            <div className="warehouse-workbench-title-row">
              <div className="warehouse-workbench-title">待到货、入库</div>
              <span className="warehouse-workbench-updated">更新 {formatDateTime(data.generatedAt)}</span>
            </div>
            <div className="warehouse-workbench-subtitle">
              当前：{activeReceiptScope?.label || "全部"} / {activeReceiptQueue?.label || "全部"}
              {activeFilterLabels.length ? ` · ${activeFilterLabels.slice(0, 3).join(" · ")}` : ""}
              {activeFilterCount ? ` · ${activeFilterCount} 个筛选` : ""}
            </div>
          </div>
          <Space size={8} wrap>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => loadData()}>
              刷新
            </Button>
            <Input.Search
              allowClear
              value={receiptSearchDraft}
              onChange={(event) => setReceiptSearchDraft(event.target.value)}
              onSearch={applyReceiptSearch}
              placeholder="单号 / 供应商 / 商品 / 运单"
              style={{ width: 260 }}
              enterButton={<SearchOutlined />}
            />
            <Button
              icon={<FilterOutlined />}
              disabled={!activeFilterCount}
              onClick={resetReceiptFilters}
            >
              重置
            </Button>
          </Space>
        </div>
        <div className="warehouse-queue-panel warehouse-queue-panel--merged">
          <div className="warehouse-queue-group">
            <div className="warehouse-queue-group__label">工作视图</div>
            <div className="warehouse-queue-tabs" role="tablist" aria-label="入库工作视图">
              {receiptScopeItems.map((item) => {
                const active = receiptScopeKey === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    className={[
                      "warehouse-queue-tab",
                      `warehouse-queue-tab--${item.tone || "neutral"}`,
                      active ? "is-active" : "",
                    ].filter(Boolean).join(" ")}
                    aria-pressed={active}
                    onClick={() => switchReceiptScope(item.value)}
                  >
                    <span className="warehouse-queue-tab__top">
                      <span className="warehouse-queue-tab__label">{item.label}</span>
                      {active ? <span className="warehouse-queue-tab__selected">已选中</span> : null}
                    </span>
                    <span className="warehouse-queue-tab__count">{formatQty(item.count)}</span>
                    <span className="warehouse-queue-tab__meta">{item.meta || "-"}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="warehouse-queue-group">
            <div className="warehouse-queue-group__label">单据状态</div>
            <div className="warehouse-queue-tabs" role="tablist" aria-label="入库单据状态">
              {receiptQueueItems.map((item) => {
                const active = receiptQueueKey === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    className={[
                      "warehouse-queue-tab",
                      `warehouse-queue-tab--${item.tone || "neutral"}`,
                      active ? "is-active" : "",
                    ].filter(Boolean).join(" ")}
                    aria-pressed={active}
                    onClick={() => switchReceiptQueue(item.value)}
                  >
                    <span className="warehouse-queue-tab__top">
                      <span className="warehouse-queue-tab__label">{item.label}</span>
                      {active ? <span className="warehouse-queue-tab__selected">已选中</span> : null}
                    </span>
                    <span className="warehouse-queue-tab__count">{formatQty(item.count)}</span>
                    <span className="warehouse-queue-tab__meta">{item.meta || "-"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="warehouse-filter-bar">
          <Input
            allowClear
            value={receiptSupplierDraft}
            onChange={(event) => setReceiptSupplierDraft(event.target.value)}
            onPressEnter={applyAdvancedReceiptFilters}
            placeholder="供应商"
            style={{ width: 180 }}
          />
          <Select
            value={receiptIssueDraft}
            options={RECEIPT_ISSUE_OPTIONS}
            onChange={(value) => setReceiptIssueDraft(value)}
            style={{ width: 130 }}
          />
          <RangePicker
            value={receiptDateRangeDraft}
            onChange={(value) => setReceiptDateRangeDraft(value)}
            placeholder={["入库开始", "入库结束"]}
            style={{ width: 250 }}
          />
          <Button icon={<FilterOutlined />} onClick={applyAdvancedReceiptFilters}>
            应用筛选
          </Button>
        </div>
        <div className="warehouse-execution-bar">
          <div className="warehouse-execution-bar__summary">
            <span className="warehouse-execution-bar__label">入库执行</span>
            <span>当前页 {formatQty((data.inboundReceipts || []).length)} 单</span>
            <span>可处理 {formatQty(currentPageBulkSummary.actionable)} 单</span>
            {summary.urgentReceiptCount ? <span className="danger">紧急 {formatQty(summary.urgentReceiptCount)} 单</span> : null}
            {currentPageBulkSummary.blocked ? (
              <span className="muted" title={currentPageBulkSummary.blockedText}>
                已排除 {formatQty(currentPageBulkSummary.blocked)} 单
              </span>
            ) : null}
            {selectedReceiptIds.length ? (
              <>
                <span className="selected">已选 {formatQty(selectedReceiptIds.length)} 单</span>
                <span>实收 {formatQty(selectedBulkTotals.receivedQty)} / 期望 {formatQty(selectedBulkTotals.expectedQty)}</span>
                {selectedBulkTotals.damagedQty ? <span>破损 {formatQty(selectedBulkTotals.damagedQty)}</span> : null}
              </>
            ) : (
              <span className="muted">先选单据再批量确认</span>
            )}
          </div>
          <div className="warehouse-execution-bar__actions">
            <Button
              size="small"
              disabled={!currentPageBulkSummary.actionable}
              onClick={selectCurrentPageActionable}
            >
              选择本页可处理
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<InboxOutlined />}
              loading={actingKey === "bulk-inbound"}
              disabled={!selectedActionableRows.length}
              onClick={openBulkInboundReview}
            >
              批量处理
            </Button>
            <Button size="small" disabled={!selectedReceiptIds.length} onClick={() => setSelectedReceiptIds([])}>
              清空
            </Button>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={tableLoading}
          size="small"
          className="erp-compact-table warehouse-receipt-table"
          columns={receiptColumns}
          dataSource={data.inboundReceipts || []}
          locale={{ emptyText: receiptTableEmptyText }}
          rowSelection={receiptRowSelection}
          scroll={{ x: 2080 }}
          pagination={{
            current: inboundReceiptPage,
            pageSize: inboundReceiptPageSize,
            total: inboundReceiptTotal,
            showSizeChanger: true,
            pageSizeOptions: INBOUND_RECEIPT_PAGE_SIZE_OPTIONS.map(String),
            showTotal: (total, range) => `显示 ${range[0]}-${range[1]} / ${total} 条`,
            onChange: updateInboundReceiptPagination,
            onShowSizeChange: (_current, size) => updateInboundReceiptPageSize(size),
          }}
          rowClassName={(record) => [
            getReceiptTaskState(record).rowClass,
            record.id === selectedReceiptId ? "ant-table-row-selected" : "",
          ].filter(Boolean).join(" ")}
          onRow={(record) => ({
            onClick: () => openReceiptDetail(record),
            style: { cursor: "pointer" },
          })}
        />
        {receiptColumnMenu.open && typeof document !== "undefined" ? createPortal(
          <div
            className="purchase-order-column-menu"
            style={{ left: receiptColumnMenu.x, top: receiptColumnMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="purchase-order-column-menu__head">自定义字段显示信息</div>
            <div className="purchase-order-column-menu__body" style={{ maxHeight: receiptColumnMenu.bodyMaxHeight }}>
              {activeReceiptColumnConfig.order.map((field) => {
                const checked = activeReceiptColumnConfig.visible.includes(field);
                return (
                  <div
                    key={field}
                    className={receiptDraggedColumn === field ? "purchase-order-column-menu__item is-dragging" : "purchase-order-column-menu__item"}
                    draggable
                    onDragStart={(event) => handleReceiptColumnDragStart(event, field)}
                    onDragOver={handleReceiptColumnDragOver}
                    onDrop={(event) => handleReceiptColumnDrop(event, field)}
                    onDragEnd={handleReceiptColumnDragEnd}
                  >
                    <span className="purchase-order-column-menu__drag" aria-hidden="true">
                      <HolderOutlined />
                    </span>
                    <span>{WAREHOUSE_RECEIPT_COLUMN_LABELS[field] || field}</span>
                    <Checkbox
                      checked={checked}
                      disabled={checked && activeReceiptColumnConfig.visible.length <= 1}
                      onChange={(event) => toggleReceiptDraftColumn(field, event.target.checked)}
                    />
                  </div>
                );
              })}
            </div>
            <div className="purchase-order-column-menu__foot">
              <Button size="small" type="primary" onClick={saveReceiptColumnConfig}>保存</Button>
              <Button size="small" onClick={restoreReceiptColumnConfig}>还原</Button>
            </div>
          </div>,
          document.body,
        ) : null}
      </div>

      <Drawer
        open={receiptDetailDrawerOpen && Boolean(selectedReceipt)}
        title={selectedReceipt ? `入库单详情 · ${selectedReceipt.receiptNo || selectedReceipt.id}` : "入库单详情"}
        width={1120}
        destroyOnClose={false}
        onClose={closeReceiptDetail}
        className="warehouse-detail-drawer"
      >
        {selectedReceipt ? renderReceiptDetail(selectedReceipt, "drawer") : null}
      </Drawer>

      <Modal
        open={!!logisticsDialog}
        title={logisticsDialog ? `物流跟踪信息 · ${logisticsDetail?.billNo || logisticsDialog.receipt.logistics?.billNo || logisticsDialog.receipt.receiptNo || logisticsDialog.receipt.id}` : "物流跟踪信息"}
        width={760}
        footer={[
          <Button key="close" onClick={() => setLogisticsDialog(null)}>
            关闭
          </Button>,
        ]}
        onCancel={() => setLogisticsDialog(null)}
        destroyOnClose
      >
        {logisticsDialog ? (
          <div className="warehouse-logistics-dialog">
            <div className="warehouse-logistics-summary">
              <div className="warehouse-logistics-summary__item">
                <span>物流公司</span>
                <strong>{logisticsDetail?.companyName || logisticsDialog.receipt.logistics?.companyName || "未知物流公司"}</strong>
              </div>
              <div className="warehouse-logistics-summary__item">
                <span>物流单号</span>
                {logisticsDetail?.billNo || logisticsDialog.receipt.logistics?.billNo ? (
                  <Text copyable={{ text: String(logisticsDetail?.billNo || logisticsDialog.receipt.logistics?.billNo) }} strong>
                    {logisticsDetail?.billNo || logisticsDialog.receipt.logistics?.billNo}
                  </Text>
                ) : (
                  <Text type="secondary">-</Text>
                )}
              </div>
              <div className="warehouse-logistics-summary__item">
                <span>状态</span>
                <Tag color={logisticsStatusColor}>{logisticsStatusLabel}</Tag>
              </div>
              <div className="warehouse-logistics-summary__item">
                <span>来源</span>
                <strong>{getLogisticsSourceLabel(logisticsDetail?.source)}</strong>
              </div>
            </div>
            <div className="warehouse-logistics-meta">
              <span>入库单：{logisticsDialog.receipt.receiptNo || logisticsDialog.receipt.id}</span>
              <span>采购单：{logisticsDetail?.poNo || logisticsDialog.receipt.poNo || "-"}</span>
              <span>供应商：{logisticsDetail?.supplierName || logisticsDialog.receipt.supplierName || "-"}</span>
              {logisticsDetail?.syncedAt ? <span>同步：{formatDateTime(logisticsDetail.syncedAt)}</span> : null}
            </div>
            <div className="warehouse-logistics-trace">
              <div className="warehouse-logistics-trace__head">
                <span>时间</span>
                <span>轨迹信息</span>
              </div>
              {logisticsDialog.loading && !logisticsTraceItems.length ? (
                <div className="warehouse-logistics-empty">正在补充物流轨迹，列表已有公司和单号可先使用。</div>
              ) : logisticsTraceItems.length ? (
                logisticsTraceItems.map((item) => (
                  <div key={item.id} className="warehouse-logistics-trace__row">
                    <span>{formatDateTime(item.time)}</span>
                    <span>{item.text || "-"}</span>
                  </div>
                ))
              ) : (
                <div className="warehouse-logistics-empty">
                  {logisticsDetail?.traceError ? `1688返回：${logisticsDetail.traceError}` : "暂无轨迹明细，仅保留物流公司和单号。"}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!editReceiptModal}
        title={editReceiptModal ? `修改入库单 · ${editReceiptModal.receiptNo}` : "修改入库单"}
        okText="保存修改"
        cancelText="取消"
        width={980}
        confirmLoading={!!editReceiptModal?.saving}
        okButtonProps={{ disabled: !!editReceiptModal?.loading }}
        onOk={submitEditReceiptModal}
        onCancel={() => setEditReceiptModal(null)}
        destroyOnClose
      >
        {editReceiptModal ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Row gutter={[12, 12]}>
              <Col span={8}>
                <Text type="secondary">状态</Text>
                <Select
                  value={editReceiptModal.status}
                  options={INBOUND_EDIT_STATUS_OPTIONS}
                  style={{ width: "100%", marginTop: 6 }}
                  onChange={(status) => setEditReceiptModal((current) => (
                    current ? { ...current, status, sourceStatus: INBOUND_STATUS_LABELS[status] || current.sourceStatus } : current
                  ))}
                />
              </Col>
              <Col span={8}>
                <Text type="secondary">来源状态</Text>
                <Input
                  value={editReceiptModal.sourceStatus}
                  style={{ marginTop: 6 }}
                  onChange={(event) => setEditReceiptModal((current) => (
                    current ? { ...current, sourceStatus: event.target.value } : current
                  ))}
                />
              </Col>
              <Col span={8}>
                <Text type="secondary">入库时间</Text>
                <Input
                  value={editReceiptModal.receivedAt}
                  style={{ marginTop: 6 }}
                  onChange={(event) => setEditReceiptModal((current) => (
                    current ? { ...current, receivedAt: event.target.value } : current
                  ))}
                />
              </Col>
              <Col span={8}>
                <Text type="secondary">仓库</Text>
                <Input
                  value={editReceiptModal.warehouseName}
                  style={{ marginTop: 6 }}
                  onChange={(event) => setEditReceiptModal((current) => (
                    current ? { ...current, warehouseName: event.target.value } : current
                  ))}
                />
              </Col>
              <Col span={8}>
                <Text type="secondary">物流公司</Text>
                <Input
                  value={editReceiptModal.logisticsCompany}
                  style={{ marginTop: 6 }}
                  onChange={(event) => setEditReceiptModal((current) => (
                    current ? { ...current, logisticsCompany: event.target.value } : current
                  ))}
                />
              </Col>
              <Col span={8}>
                <Text type="secondary">物流单号</Text>
                <Input
                  value={editReceiptModal.trackingNo}
                  style={{ marginTop: 6 }}
                  onChange={(event) => setEditReceiptModal((current) => (
                    current ? { ...current, trackingNo: event.target.value } : current
                  ))}
                />
              </Col>
              <Col span={24}>
                <Text type="secondary">备注</Text>
                <TextArea
                  value={editReceiptModal.sourceRemark}
                  rows={2}
                  style={{ marginTop: 6 }}
                  onChange={(event) => setEditReceiptModal((current) => (
                    current ? { ...current, sourceRemark: event.target.value } : current
                  ))}
                />
              </Col>
            </Row>
            <Table
              rowKey="id"
              size="small"
              className="erp-compact-table"
              loading={editReceiptModal.loading}
              pagination={false}
              dataSource={editReceiptModal.lines}
              scroll={{ x: 760, y: 300 }}
              columns={editReceiptLineColumns}
            />
          </Space>
        ) : null}
      </Modal>

      <Modal
        open={bulkInboundReviewOpen}
        title="批量处理复核"
        okText="确认批量处理"
        cancelText="返回检查"
        width={720}
        confirmLoading={actingKey === "bulk-inbound"}
        okButtonProps={{ disabled: !selectedActionableRows.length }}
        onCancel={() => {
          if (actingKey !== "bulk-inbound") setBulkInboundReviewOpen(false);
        }}
        onOk={async () => {
          const ok = await runBulkInbound();
          if (ok) setBulkInboundReviewOpen(false);
        }}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message={`将处理 ${formatQty(selectedActionableRows.length)} 张入库单`}
            description="系统会按每张单据的当前状态只推进下一步：待到货确认到仓，已到仓提交核数，已核数确认入库；异常单仍需单独填写处理说明。"
          />
          <div className="warehouse-bulk-review-grid">
            {[
              ["可处理", selectedActionableRows.length],
              ["期望数量", selectedBulkTotals.expectedQty],
              ["实收数量", selectedBulkTotals.receivedQty],
              ["破损数量", selectedBulkTotals.damagedQty],
            ].map(([label, value]) => (
              <div key={String(label)} className="warehouse-bulk-review-card">
                <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
                <div className="warehouse-bulk-review-card__value">{formatQty(Number(value || 0))}</div>
              </div>
            ))}
          </div>
          <div className="warehouse-bulk-review-section">
            <Text strong>任务分布</Text>
            <Space size={6} wrap style={{ marginTop: 8 }}>
              {selectedBulkTaskSummary.length ? selectedBulkTaskSummary.map((item) => (
                <Tag key={item.label} color={item.label.includes("确认入库") ? "green" : item.label.includes("核数") ? "blue" : "gold"}>
                  {item.label} {formatQty(item.count)}
                </Tag>
              )) : <Tag>无可处理单</Tag>}
              {selectedBlockedCount ? <Tag color="default">已排除 {formatQty(selectedBlockedCount)}</Tag> : null}
            </Space>
          </div>
          <div className="warehouse-bulk-review-section">
            <Text strong>单据预览</Text>
            <div className="warehouse-bulk-review-list">
              {selectedBulkPreviewRows.map((row) => {
                const action = getReceiptPrimaryAction(row);
                return (
                  <div key={row.id} className="warehouse-bulk-review-line">
                    <span className="warehouse-bulk-review-line__receipt">{row.receiptNo || row.id}</span>
                    <span>{row.supplierName || "-"}</span>
                    <span>{action.label}</span>
                    <span>{formatQty(row.receivedQty)} / {formatQty(row.expectedQty)}</span>
                  </div>
                );
              })}
              {selectedActionableRows.length > selectedBulkPreviewRows.length ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  另有 {formatQty(selectedActionableRows.length - selectedBulkPreviewRows.length)} 张未展示
                </Text>
              ) : null}
            </div>
          </div>
        </Space>
      </Modal>

      <Modal
        open={!!partialReceiveModal}
        title={partialReceiveModal ? `按实数核数 · ${partialReceiveModal.receiptNo}` : "按实数核数"}
        okText="提交核数"
        cancelText="取消"
        width={760}
        confirmLoading={partialReceiveModal?.loading}
        onCancel={() => setPartialReceiveModal(null)}
        onOk={async () => {
          if (!partialReceiveModal) return;
          const linesPayload = partialReceiveModal.lines.map((l) => ({
            id: l.id,
            received_qty: l.receivedQty,
            damaged_qty: l.damagedQty,
          }));
          setPartialReceiveModal({ ...partialReceiveModal, loading: true });
          const ok = await runAction(
            `inbound-partial-${partialReceiveModal.receiptId}`,
            { action: "confirm_count", receiptId: partialReceiveModal.receiptId, lines: linesPayload },
            "已提交实收结果",
          );
          if (ok) {
            setPartialReceiveModal(null);
            return;
          }
          setPartialReceiveModal((current) => (
            current?.receiptId === partialReceiveModal.receiptId
              ? { ...current, loading: false }
              : current
          ));
        }}
        destroyOnClose
      >
        {partialReceiveModal ? (
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              系统会按你填的"实收"更新入库单。短少 / 多到自动算（实收 vs 期望差），破损独立填；核数后再确认入库。
            </Text>
            <Table
              rowKey="id"
              size="small"
              className="erp-compact-table"
              pagination={false}
              dataSource={partialReceiveModal.lines}
              columns={[
                { title: "SKU", dataIndex: "skuCode", width: 120 },
                {
                  title: "商品",
                  dataIndex: "productName",
                  render: (value) => <Text className="warehouse-product-name-text">{value || "-"}</Text>,
                },
                { title: "期望", dataIndex: "expectedQty", width: 70, align: "right" },
                {
                  title: "实收",
                  width: 110,
                  align: "right",
                  render: (_v, r: any) => (
                    <InputNumber
                      size="small"
                      min={0}
                      value={r.receivedQty}
                      onChange={(v) => setPartialReceiveModal({
                        ...partialReceiveModal,
                        lines: partialReceiveModal.lines.map((l) => l.id === r.id ? { ...l, receivedQty: Number(v || 0) } : l),
                      })}
                    />
                  ),
                },
                {
                  title: "破损",
                  width: 90,
                  align: "right",
                  render: (_v, r: any) => (
                    <InputNumber
                      size="small"
                      min={0}
                      value={r.damagedQty}
                      onChange={(v) => setPartialReceiveModal({
                        ...partialReceiveModal,
                        lines: partialReceiveModal.lines.map((l) => l.id === r.id ? { ...l, damagedQty: Number(v || 0) } : l),
                      })}
                    />
                  ),
                },
                {
                  title: "差异",
                  width: 110,
                  render: (_v, r: any) => {
                    const diff = (r.receivedQty || 0) - (r.expectedQty || 0);
                    if (diff > 0) return <Text style={{ color: "#1a73e8" }}>多到 +{diff}</Text>;
                    if (diff < 0) return <Text type="warning">短少 {-diff}</Text>;
                    return <Text type="secondary">符合</Text>;
                  },
                },
              ]}
            />
          </Space>
        ) : null}
      </Modal>

      <Modal
        open={!!resolveExceptionModal}
        title={resolveExceptionModal ? `异常处理 · ${resolveExceptionModal.receiptNo}` : "异常处理"}
        okText="确认处理并入库"
        cancelText="取消"
        width={620}
        confirmLoading={resolveExceptionModal?.loading}
        onCancel={() => {
          if (!resolveExceptionModal?.loading) setResolveExceptionModal(null);
        }}
        onOk={submitResolveExceptionModal}
        destroyOnClose
      >
        {resolveExceptionModal ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Alert
              type="warning"
              showIcon
              message="异常单将带处理说明进入已入库"
              description="请记录已核对的原因、处理结果或后续责任归属；该说明会进入流程追溯。"
            />
            <Row gutter={[8, 8]}>
              {[
                ["期望", resolveExceptionModal.expectedQty],
                ["实收", resolveExceptionModal.receivedQty],
                ["短少", resolveExceptionModal.shortageQty],
                ["多到", resolveExceptionModal.overQty],
                ["破损", resolveExceptionModal.damagedQty],
              ].map(([label, value]) => (
                <Col span={8} key={String(label)}>
                  <div style={{ border: "1px solid #eef1f5", borderRadius: 6, padding: "8px 10px", background: "#fff" }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
                    <div style={{ fontWeight: 600, marginTop: 2 }}>{formatQty(Number(value || 0))}</div>
                  </div>
                </Col>
              ))}
            </Row>
            <TextArea
              rows={4}
              maxLength={300}
              showCount
              disabled={resolveExceptionModal.loading}
              placeholder="例如：已与供应商确认短少补发，当前实收先入库，差异转售后继续跟进。"
              value={resolveExceptionModal.remark}
              onChange={(event) => setResolveExceptionModal((current) => (
                current ? { ...current, remark: event.target.value } : current
              ))}
            />
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
