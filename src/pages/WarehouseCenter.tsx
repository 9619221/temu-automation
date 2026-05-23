import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Col, DatePicker, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Timeline, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  FilterOutlined,
  InboxOutlined,
  ReloadOutlined,
  SearchOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { hasPageCache, readPageCache, writePageCache } from "../utils/pageCache";
import {
  INBOUND_STATUS_LABELS,
  canRole,
  formatDateTime,
  formatQty,
  statusTag,
} from "../utils/erpUi";

const { Text } = Typography;
const { TextArea } = Input;
const { RangePicker } = DatePicker;
const erp = window.electronAPI?.erp;
const WAREHOUSE_WORKBENCH_CACHE_KEY = "temu.warehouse.workbench.cache.v4";
const DEFAULT_INBOUND_RECEIPT_PAGE_SIZE = 20;
const DEFAULT_RECEIPT_SCOPE: ReceiptScopeKey = "actionable";
const INBOUND_RECEIPT_PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

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
  status: string;
  expectedQty?: number;
  receivedQty?: number;
  damagedQty?: number;
  shortageQty?: number;
  overQty?: number;
  lineCount?: number;
  batchLineCount?: number;
  operatorName?: string;
  receivedAt?: string | null;
  updatedAt?: string;
  ageHours?: number;
  isOverdue?: boolean | number;
  isToday?: boolean | number;
  logistics?: { companyName?: string | null; billNo?: string | null } | null;
}

interface InboundReceiptLineRow {
  id: string;
  skuCode?: string;
  productName?: string;
  expectedQty: number;
  receivedQty: number;
  damagedQty: number;
  shortageQty: number;
  overQty: number;
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

interface WarehouseWorkbench {
  generatedAt?: string;
  summary?: Record<string, number>;
  inboundReceiptPage?: { limit?: number; offset?: number; total?: number };
  inboundReceipts?: InboundReceiptRow[];
}

function normalizeInboundLines(lines: any[] = []): InboundReceiptLineRow[] {
  return lines.map((line) => ({
    id: String(line.id),
    skuCode: line.internalSkuCode || line.skuCode,
    productName: line.productName,
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

function getBulkInboundBlockReason(row: InboundReceiptRow, role: string): string | null {
  if (!canRole(role, ["warehouse", "manager", "admin"])) return "当前角色无批量入库权限";
  if (INBOUND_ACTION_STATUSES.has(row.status)) return null;
  if (INBOUND_EXCEPTION_STATUSES.has(row.status)) return "异常单需单独处理并填写说明";
  if (row.status === "inbounded_pending_qc") return "已入库单不可重复入库";
  if (row.status === "cancelled") return "已取消单据不可入库";
  return `${INBOUND_STATUS_LABELS[row.status] || row.status || "当前状态"}不可批量入库`;
}

export default function WarehouseCenter() {
  const auth = useErpAuth();
  const role = auth.currentUser?.role || "";
  const navigate = useNavigate();
  const cachedData = useMemo(
    () => readPageCache<WarehouseWorkbench>(WAREHOUSE_WORKBENCH_CACHE_KEY, {}),
    [],
  );
  const [data, setData] = useState<WarehouseWorkbench>(cachedData);
  const [inboundReceiptPageSize, setInboundReceiptPageSize] = useState(() => (
    Math.max(1, Number(cachedData.inboundReceiptPage?.limit || DEFAULT_INBOUND_RECEIPT_PAGE_SIZE))
  ));
  const [inboundReceiptPage, setInboundReceiptPage] = useState(() => {
    const limit = Math.max(1, Number(cachedData.inboundReceiptPage?.limit || DEFAULT_INBOUND_RECEIPT_PAGE_SIZE));
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
  const [selectedReceiptIds, setSelectedReceiptIds] = useState<string[]>([]);
  const [receiptLinesById, setReceiptLinesById] = useState<Record<string, InboundReceiptLineRow[]>>({});
  const [receiptTimelineById, setReceiptTimelineById] = useState<Record<string, InboundReceiptTimelineRow[]>>({});
  const [detailLoadingReceiptId, setDetailLoadingReceiptId] = useState<string | null>(null);
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
    return {
      inboundReceiptLimit: normalizePositiveNumber(overrides.inboundReceiptLimit, inboundReceiptPageSize),
      inboundReceiptOffset: normalizeOffsetNumber(
        overrides.inboundReceiptOffset,
        (Math.max(1, inboundReceiptPage) - 1) * inboundReceiptPageSize,
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
    const receiptLimit = normalizePositiveNumber(
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

  const loadReceiptLines = useCallback(async (receiptId: string, force = false) => {
    if (!erp || !receiptId) return;
    if (!force && receiptLinesById[receiptId]) return;
    if (receiptLineLoadingIdsRef.current.has(receiptId)) return;
    receiptLineLoadingIdsRef.current.add(receiptId);
    setDetailLoadingReceiptId(receiptId);
    try {
      const result = await erp.warehouse.action({
        action: "get_inbound_lines",
        receiptId,
      });
      setReceiptLinesById((prev) => ({
        ...prev,
        [receiptId]: normalizeInboundLines(result?.result?.lines || []),
      }));
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
  }, [receiptLinesById]);

  const openReceiptDetail = useCallback((row: InboundReceiptRow) => {
    setSelectedReceiptId((current) => {
      const nextId = current === row.id ? null : row.id;
      if (nextId) void loadReceiptLines(row.id);
      return nextId;
    });
  }, [loadReceiptLines]);

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
    setPartialReceiveModal({ receiptId: row.id, receiptNo: row.receiptNo || row.id, lines: [], loading: true });
    try {
      const result = await erp?.warehouse?.action({ action: "get_inbound_lines", receiptId: row.id });
      const normalizedLines = normalizeInboundLines(result?.result?.lines || []);
      setReceiptLinesById((prev) => ({ ...prev, [row.id]: normalizedLines }));
      setReceiptTimelineById((prev) => ({
        ...prev,
        [row.id]: normalizeInboundTimeline(result?.result?.timeline || []),
      }));
      const lines = normalizedLines.map((line) => ({
        id: line.id,
        skuCode: line.skuCode,
        productName: line.productName,
        expectedQty: line.expectedQty,
        receivedQty: line.receivedQty || line.expectedQty,
        damagedQty: line.damagedQty,
      }));
      setPartialReceiveModal({ receiptId: row.id, receiptNo: row.receiptNo || row.id, lines, loading: false });
    } catch (error: any) {
      message.error(error?.message || "拉取入库行失败");
      setPartialReceiveModal(null);
    }
  }, []);

  const applyInboundReceiptPagination = useCallback((nextPage: number, nextPageSize?: number) => {
    const pageSize = normalizePositiveNumber(nextPageSize, inboundReceiptPageSize);
    const page = normalizePositiveNumber(nextPage, 1);
    const params = buildWorkbenchParams({
      inboundReceiptLimit: pageSize,
      inboundReceiptOffset: (page - 1) * pageSize,
    });
    setSelectedReceiptId(null);
    setSelectedReceiptIds([]);
    setInboundReceiptPageSize(pageSize);
    setInboundReceiptPage(page);
    void loadData({ params });
  }, [buildWorkbenchParams, inboundReceiptPageSize, loadData]);

  const updateInboundReceiptPagination = useCallback((nextPage: number) => {
    applyInboundReceiptPagination(nextPage, inboundReceiptPageSize);
  }, [applyInboundReceiptPagination, inboundReceiptPageSize]);

  const updateInboundReceiptPageSize = useCallback((nextPageSize: number) => {
    applyInboundReceiptPagination(1, nextPageSize);
  }, [applyInboundReceiptPagination]);

  const switchReceiptQueue = useCallback((key: ReceiptQueueKey) => {
    const params = buildWorkbenchParams({
      inboundReceiptOffset: 0,
      inboundReceiptStatus: RECEIPT_QUEUE_STATUS[key],
    });
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

  const selectedActionableRows = useMemo(() => (
    selectedReceiptRows.filter((row) => (
      !getBulkInboundBlockReason(row, role)
    ))
  ), [role, selectedReceiptRows]);

  const currentPageBulkSummary = useMemo(() => {
    const rows = data.inboundReceipts || [];
    const blockedCounts = new Map<string, number>();
    let actionable = 0;
    rows.forEach((row) => {
      const reason = getBulkInboundBlockReason(row, role);
      if (!reason) {
        actionable += 1;
        return;
      }
      blockedCounts.set(reason, (blockedCounts.get(reason) || 0) + 1);
    });
    return {
      actionable,
      blocked: rows.length - actionable,
      blockedText: Array.from(blockedCounts.entries())
        .map(([reason, count]) => `${reason} ${count}单`)
        .join("；"),
    };
  }, [data.inboundReceipts, role]);

  const receiptRowSelection = useMemo<TableRowSelection<InboundReceiptRow>>(() => ({
    selectedRowKeys: selectedReceiptIds,
    preserveSelectedRowKeys: false,
    onChange: (keys) => setSelectedReceiptIds(keys.map(String)),
    getCheckboxProps: (row) => {
      const blockReason = getBulkInboundBlockReason(row, role);
      return {
        disabled: Boolean(blockReason),
        title: blockReason || "可批量入库",
      };
    },
  }), [role, selectedReceiptIds]);

  const runBulkInbound = useCallback(async () => {
    if (!erp) return;
    const receiptIds = selectedActionableRows.map((row) => row.id);
    if (!receiptIds.length) {
      message.warning("请选择待入库单据");
      return;
    }
    const params = buildWorkbenchParams();
    setActingKey("bulk-inbound");
    try {
      const result = await erp.warehouse.action({ action: "confirm_inbound_bulk", receiptIds, ...params });
      applyWorkbench(result?.workbench || await erp.warehouse.workbench(params), params);
      setSelectedReceiptId(null);
      setSelectedReceiptIds([]);
      setReceiptLinesById((prev) => {
        const next = { ...prev };
        receiptIds.forEach((id) => { delete next[id]; });
        return next;
      });
      setReceiptTimelineById((prev) => {
        const next = { ...prev };
        receiptIds.forEach((id) => { delete next[id]; });
        return next;
      });
      message.success(`已批量入库 ${result?.result?.count || receiptIds.length} 单`);
    } catch (error: any) {
      message.error(error?.message || "批量入库失败");
    } finally {
      setActingKey(null);
    }
  }, [applyWorkbench, buildWorkbenchParams, selectedActionableRows]);

  const receiptColumns = useMemo<ColumnsType<InboundReceiptRow>>(() => [
    {
      title: "入库单",
      key: "receipt",
      width: 210,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.receiptNo || row.id}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            采购单：
            {row.poNo ? (
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
            ) : (row.poId || "-")}
          </Text>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 130,
      render: (value) => statusTag(value, INBOUND_STATUS_LABELS),
    },
    {
      title: "供应商 / 商品",
      key: "supplier",
      ellipsis: true,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.supplierName || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.skuSummary || "-"}</Text>
        </Space>
      ),
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
            {billNo ? <Text copyable code style={{ fontSize: 12 }}>{billNo}</Text> : <Text type="secondary" style={{ fontSize: 12 }}>无运单号</Text>}
          </Space>
        );
      },
    },
    {
      title: "到仓",
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
      width: 240,
      fixed: "right",
      render: (_value, row) => {
        if (INBOUND_EXCEPTION_STATUSES.has(row.status) && canRole(role, ["warehouse", "manager", "admin"])) {
          return (
            <Space size={6} wrap>
              <Button
                size="small"
                icon={<SearchOutlined />}
                loading={detailLoadingReceiptId === row.id}
                onClick={(e) => {
                  e.stopPropagation();
                  openReceiptDetail(row);
                }}
              >
                {selectedReceiptId === row.id ? "收起" : "明细"}
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
            <Button
              size="small"
              icon={<SearchOutlined />}
              loading={detailLoadingReceiptId === row.id}
              onClick={(e) => {
                e.stopPropagation();
                openReceiptDetail(row);
              }}
            >
              {selectedReceiptId === row.id ? "收起" : "明细"}
            </Button>
          );
        }
        // 单按钮接力：后端会按当前状态依次确认到仓、核数、确认入库，不再生成库存批次。
        const action = "confirm_count";
        const loading = actingKey === `inbound-${row.id}`;
        return (
          <Space size={6} wrap>
            <Button
              size="small"
              icon={<SearchOutlined />}
              loading={detailLoadingReceiptId === row.id}
              onClick={(e) => {
                e.stopPropagation();
                openReceiptDetail(row);
              }}
            >
              {selectedReceiptId === row.id ? "收起" : "明细"}
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<InboxOutlined />}
              loading={loading}
              onClick={(e) => {
                e.stopPropagation();
                void runAction(`inbound-${row.id}`, { action, receiptId: row.id }, "已确认入库");
              }}
            >
              入库
            </Button>
            <Button
              size="small"
              loading={partialReceiveModal?.receiptId === row.id && partialReceiveModal.loading}
              onClick={(e) => {
                e.stopPropagation();
                void openPartialReceiveModal(row);
              }}
            >
              按实数入库
            </Button>
          </Space>
        );
      },
    },
  ], [actingKey, detailLoadingReceiptId, openPartialReceiveModal, openReceiptDetail, openResolveExceptionModal, partialReceiveModal, role, selectedReceiptId]);

  const renderReceiptDetail = (sel: InboundReceiptRow) => {
    const canInbound = INBOUND_ACTION_STATUSES.has(sel.status)
      && canRole(role, ["warehouse", "manager", "admin"]);
    const canResolveException = INBOUND_EXCEPTION_STATUSES.has(sel.status)
      && canRole(role, ["warehouse", "manager", "admin"]);
    const selectedLines = receiptLinesById[sel.id] || [];
    const selectedTimeline = receiptTimelineById[sel.id] || [];
    const detailLoading = detailLoadingReceiptId === sel.id;
    const receiptIssueTags = getIssueTags(sel);
    return (
      <div className="warehouse-receipt-detail">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <Space direction="vertical" size={4}>
            <Space size={8} wrap>
              <Text strong style={{ fontSize: 16 }}>入库单 {sel.receiptNo}</Text>
              {statusTag(sel.status, INBOUND_STATUS_LABELS)}
              {receiptIssueTags.length ? receiptIssueTags.map((tag) => <Tag key={tag.key} color={tag.color}>{tag.label}</Tag>) : <Tag>无差异</Tag>}
              {sel.isOverdue ? <Tag color="red">超期 {formatAgeHours(sel.ageHours)}</Tag> : null}
              {sel.isToday ? <Tag color="green">今日到仓</Tag> : null}
              <Text type="secondary">采购单：{sel.poNo || sel.poId || "-"}</Text>
            </Space>
            <Text type="secondary">
              {sel.supplierName || "-"} · 到仓 {formatDateTime(sel.receivedAt)} · 物流 {sel.logistics?.companyName || "-"} / {sel.logistics?.billNo || "-"}
            </Text>
          </Space>
          <Space size={8} wrap style={{ justifyContent: "flex-end" }}>
            {canInbound ? (
              <>
                <Button
                  type="primary"
                  icon={<InboxOutlined />}
                  loading={actingKey === `detail-inbound-${sel.id}`}
                  onClick={() => runAction(`detail-inbound-${sel.id}`, { action: "confirm_count", receiptId: sel.id }, "已确认入库")}
                >
                  入库
                </Button>
                <Button
                  loading={partialReceiveModal?.receiptId === sel.id && partialReceiveModal.loading}
                  onClick={() => void openPartialReceiveModal(sel)}
                >
                  按实数入库
                </Button>
              </>
            ) : canResolveException ? (
              <Button
                type="primary"
                danger
                loading={actingKey === `detail-resolve-inbound-${sel.id}`}
                onClick={() => openResolveExceptionModal(sel)}
              >
                处理异常并入库
              </Button>
            ) : (
              <Text type="secondary">已入库，无需操作</Text>
            )}
            <Button size="small" type="text" onClick={() => setSelectedReceiptId(null)}>收起</Button>
          </Space>
        </div>
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          {[
            ["期望", sel.expectedQty],
            ["实收", sel.receivedQty],
            ["破损", sel.damagedQty],
            ["短少", sel.shortageQty],
            ["多到", sel.overQty],
          ].map(([label, value]) => (
            <Col xs={12} sm={8} md={4} key={String(label)}>
              <div style={{ border: "1px solid #eef1f5", borderRadius: 6, padding: "8px 10px", background: "#fff" }}>
                <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
                <div style={{ fontWeight: 600, marginTop: 2 }}>{formatQty(Number(value || 0))}</div>
              </div>
            </Col>
          ))}
        </Row>
        <Table
          rowKey="id"
          size="small"
          loading={detailLoading}
          className="erp-compact-table"
          pagination={false}
          dataSource={selectedLines}
          locale={{ emptyText: detailLoading ? "正在读取明细..." : "暂无商品明细" }}
          columns={[
            {
              title: "商品",
              key: "product",
              ellipsis: true,
              render: (_value, line) => (
                <Space direction="vertical" size={2}>
                  <Text>{line.productName || sel.skuSummary || "-"}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{line.skuCode || "-"}</Text>
                </Space>
              ),
            },
            { title: "期望", dataIndex: "expectedQty", width: 90, align: "right", render: formatQty },
            { title: "实收", dataIndex: "receivedQty", width: 90, align: "right", render: formatQty },
            { title: "破损", dataIndex: "damagedQty", width: 90, align: "right", render: formatQty },
            { title: "短少", dataIndex: "shortageQty", width: 90, align: "right", render: formatQty },
            { title: "多到", dataIndex: "overQty", width: 90, align: "right", render: formatQty },
            {
              title: "差异",
              key: "issue",
              width: 160,
              render: (_value, line) => {
                const tags = getIssueTags(line);
                if (!tags.length) return <Text type="secondary">符合</Text>;
                return (
                  <Space size={4} wrap>
                    {tags.map((tag) => <Tag key={tag.key} color={tag.color}>{tag.label}</Tag>)}
                  </Space>
                );
              },
            },
          ]}
          scroll={{ x: 920 }}
        />
        <div className="warehouse-detail-section">
          <Text strong>流程追溯</Text>
          {selectedTimeline.length ? (
            <Timeline
              className="warehouse-detail-timeline"
              items={selectedTimeline.map((event) => ({
                color: event.source === "audit" ? "blue" : "green",
                children: (
                  <Space direction="vertical" size={0}>
                    <Text>
                      {event.label || event.eventType || "流程事件"}
                      <Text type="secondary"> · {formatDateTime(event.createdAt)}</Text>
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {event.message || "-"} · {event.actorName || roleLabel(event.actorRole)}
                    </Text>
                  </Space>
                ),
              }))}
            />
          ) : (
            <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
              {detailLoading ? "正在读取流程..." : "暂无流程记录"}
            </Text>
          )}
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 10, color: "#667085", fontSize: 12, flexWrap: "wrap" }}>
          <span>操作员：{sel.operatorName || "-"}</span>
          <span>入库单号：{sel.receiptNo || "-"}</span>
          <span>运单号：{sel.logistics?.billNo || "-"}</span>
        </div>
      </div>
    );
  };

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
  const activeFilterLabels = useMemo(() => ([
    receiptScopeKey !== DEFAULT_RECEIPT_SCOPE ? "工作视图" : "",
    receiptQueueKey !== "all" ? "状态队列" : "",
    receiptKeyword ? `搜索：${receiptKeyword}` : "",
    receiptSupplierFilter ? `供应商：${receiptSupplierFilter}` : "",
    receiptIssueFilter !== "all" ? RECEIPT_ISSUE_OPTIONS.find((item) => item.value === receiptIssueFilter)?.label || "差异" : "",
    receiptDateFrom || receiptDateTo ? "到仓日期" : "",
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
      <PageHeader
        compact
        eyebrow="仓库中心"
        title="待到货、入库"
        subtitle="仓管确认到仓、核数，并对照采购单查看入库数据。"
        meta={[`更新 ${formatDateTime(data.generatedAt)}`]}
        actions={[
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={() => loadData()}>
            刷新
          </Button>,
        ]}
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={4}>
          <StatCard title="入库单" value={summary.inboundReceiptCount || 0} color="blue" icon={<InboxOutlined />} compact />
        </Col>
        <Col xs={12} md={4}>
          <StatCard title="待处理" value={actionableCount} suffix={`${RECEIPT_OVERDUE_HOURS}h SLA`} color="brand" icon={<ClockCircleOutlined />} compact />
        </Col>
        <Col xs={12} md={4}>
          <StatCard title="待到货" value={summary.pendingArrivalCount || 0} color="brand" icon={<ClockCircleOutlined />} compact />
        </Col>
        <Col xs={12} md={4}>
          <StatCard title="待入库" value={pendingInboundCount} suffix={`已收 ${formatQty(summary.receivedQty)}`} color="purple" icon={<CheckCircleOutlined />} compact />
        </Col>
        <Col xs={12} md={4}>
          <StatCard title="异常" value={summary.exceptionCount || 0} color="danger" icon={<WarningOutlined />} compact />
        </Col>
        <Col xs={12} md={4}>
          <StatCard title="超期" value={overdueReceiptCount} suffix={`今日 ${formatQty(todayReceiptCount)}`} color="danger" icon={<WarningOutlined />} compact />
        </Col>
      </Row>

      <div className="app-panel" style={{ marginBottom: 16 }}>
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">入库工作台</div>
            <div className="app-panel__title-sub">
              {activeFilterLabels.length ? activeFilterLabels.slice(0, 3).join(" · ") : "按入库单、采购单、供应商、商品编码、运单号检索。"}
              {activeFilterCount ? ` · 已启用 ${activeFilterCount} 个筛选` : ""}
            </div>
          </div>
          <Space size={8} wrap>
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
        <div className="warehouse-queue-panel">
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
                    <span className="warehouse-queue-tab__label">{item.label}</span>
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
                    <span className="warehouse-queue-tab__label">{item.label}</span>
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
            placeholder={["到仓开始", "到仓结束"]}
            style={{ width: 250 }}
          />
          <Button icon={<FilterOutlined />} onClick={applyAdvancedReceiptFilters}>
            应用筛选
          </Button>
        </div>
        <Table
          rowKey="id"
          loading={tableLoading}
          size="small"
          className="erp-compact-table"
          columns={receiptColumns}
          dataSource={data.inboundReceipts || []}
          locale={{ emptyText: receiptTableEmptyText }}
          rowSelection={receiptRowSelection}
          scroll={{ x: 1240 }}
          pagination={{
            current: inboundReceiptPage,
            pageSize: inboundReceiptPageSize,
            total: inboundReceiptTotal,
            showSizeChanger: false,
            showTotal: (total, range) => (
              <Space className="warehouse-pagination-total" size={12}>
                <span>{`显示 ${range[0]}-${range[1]} / ${total} 条`}</span>
                <Space className="warehouse-page-size-control" size={6}>
                  <span>每页记录数</span>
                  <Select
                    size="small"
                    value={inboundReceiptPageSize}
                    options={INBOUND_RECEIPT_PAGE_SIZE_OPTIONS.map((value) => ({
                      label: `${value}`,
                      value,
                    }))}
                    style={{ width: 76 }}
                    popupMatchSelectWidth={96}
                    onChange={updateInboundReceiptPageSize}
                    onMouseDown={(event) => event.stopPropagation()}
                  />
                </Space>
              </Space>
            ),
            onChange: updateInboundReceiptPagination,
          }}
          rowClassName={(record) => (record.id === selectedReceiptId ? "ant-table-row-selected" : "")}
          onRow={(record) => ({
            onClick: () => openReceiptDetail(record),
            style: { cursor: "pointer" },
          })}
          expandable={{
            expandedRowKeys: selectedReceiptId ? [selectedReceiptId] : [],
            expandedRowRender: renderReceiptDetail,
            rowExpandable: () => true,
            showExpandColumn: false,
          }}
        />
        {selectedReceiptIds.length ? (
          <div className="erp-bulk-bar">
            <div className="erp-bulk-bar__summary">
              <span className="selected">已选 {selectedReceiptIds.length} 单</span>
              <span>可入库 {selectedActionableRows.length} 单</span>
              <span>当前页可批量 {currentPageBulkSummary.actionable} 单</span>
              {currentPageBulkSummary.blocked ? (
                <span className="muted" title={currentPageBulkSummary.blockedText}>
                  已排除 {currentPageBulkSummary.blocked} 单
                </span>
              ) : null}
            </div>
            <div className="erp-bulk-bar__actions">
              <Button
                size="small"
                type="primary"
                icon={<InboxOutlined />}
                loading={actingKey === "bulk-inbound"}
                disabled={!selectedActionableRows.length}
                onClick={() => void runBulkInbound()}
              >
                批量入库
              </Button>
              <Button size="small" onClick={() => setSelectedReceiptIds([])}>
                清空
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <Modal
        open={!!partialReceiveModal}
        title={partialReceiveModal ? `按实数入库 · ${partialReceiveModal.receiptNo}` : "按实数入库"}
        okText="确认入库"
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
              系统会按你填的"实收"更新入库单。短少 / 多到自动算（实收 vs 期望差），破损独立填。
            </Text>
            <Table
              rowKey="id"
              size="small"
              className="erp-compact-table"
              pagination={false}
              dataSource={partialReceiveModal.lines}
              columns={[
                { title: "SKU", dataIndex: "skuCode", width: 120 },
                { title: "商品", dataIndex: "productName", ellipsis: true },
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
