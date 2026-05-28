import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  Alert, Button, Checkbox, Col, Form, Image, Input, InputNumber, Modal, Popconfirm,
  Row, Select, Space, Table, Tag, Typography, message,
} from "antd";
import type { ColumnsType, ColumnType } from "antd/es/table";
import {
  CloudSyncOutlined, DeleteOutlined, EditOutlined, EyeOutlined, HolderOutlined, PlusOutlined,
  ReloadOutlined, SearchOutlined, StopOutlined,
} from "@ant-design/icons";
import EmptyGuide from "./EmptyGuide";
import StatCard from "./StatCard";

const { Paragraph, Text } = Typography;

// 列自定义：右键列头打开菜单，拖拽排序 + 复选框显隐 + localStorage 持久化。
// 复用采购单同款 CSS class（.purchase-order-column-menu 系列）。
const COLUMN_STORAGE_KEY = "temu.purchase-return.columnOrder.v1";
const CONFIGURABLE_KEYS = [
  "lifecycle", "ioId", "ioDate", "supplierName",
  "warehouse", "wmsCoName", "totalQty", "totalAmount", "totalSkuCount",
  "creatorName", "labels", "remark",
];
const CONFIGURABLE_KEY_SET = new Set(CONFIGURABLE_KEYS);
const COLUMN_LABELS: Record<string, string> = {
  lifecycle: "状态",
  ioId: "退货单号",
  ioDate: "退货时间",
  supplierName: "供应商",
  warehouse: "仓库",
  wmsCoName: "WMS",
  totalQty: "退货数量",
  totalAmount: "退货金额",
  totalSkuCount: "SKU 数",
  creatorName: "制单人",
  labels: "标签",
  remark: "备注",
};
const MENU_WIDTH = 280;
const MENU_EDGE_GAP = 12;
const MENU_OFFSET = 8;
const MENU_CHROME_HEIGHT = 96;
const MENU_MIN_BODY_HEIGHT = 180;
const MENU_MAX_BODY_HEIGHT = 430;

interface ColumnConfig {
  order: string[];
  visible: string[];
}

function clampN(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function menuPosition(clientX: number, clientY: number) {
  const maxLeft = Math.max(MENU_EDGE_GAP, window.innerWidth - MENU_WIDTH - MENU_EDGE_GAP);
  const maxTop = Math.max(MENU_EDGE_GAP, window.innerHeight - MENU_CHROME_HEIGHT - MENU_MIN_BODY_HEIGHT - MENU_EDGE_GAP);
  const x = clampN(clientX + MENU_OFFSET, MENU_EDGE_GAP, maxLeft);
  const y = clampN(clientY + MENU_OFFSET, MENU_EDGE_GAP, maxTop);
  const bodyMaxHeight = clampN(
    window.innerHeight - y - MENU_CHROME_HEIGHT - MENU_EDGE_GAP,
    MENU_MIN_BODY_HEIGHT,
    MENU_MAX_BODY_HEIGHT,
  );
  return { x, y, bodyMaxHeight };
}

function normalizeOrder(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const ordered = source.map((it) => String(it || "")).filter((k) => {
    if (!CONFIGURABLE_KEY_SET.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return [...ordered, ...CONFIGURABLE_KEYS.filter((k) => !seen.has(k))];
}

function defaultConfig(): ColumnConfig {
  return { order: [...CONFIGURABLE_KEYS], visible: [...CONFIGURABLE_KEYS] };
}

function normalizeConfig(value: unknown): ColumnConfig {
  const raw = value && typeof value === "object" ? value as { order?: unknown; visible?: unknown } : null;
  const order = normalizeOrder(raw?.order || value);
  const visibleSource = Array.isArray(raw?.visible) ? raw.visible : order;
  const visible = Array.from(new Set(visibleSource.map((it) => String(it || "")).filter((k) => CONFIGURABLE_KEY_SET.has(k))));
  return { order, visible: visible.length ? visible : ["ioId"] };
}

function readConfig() {
  if (typeof window === "undefined") return defaultConfig();
  try {
    return normalizeConfig(JSON.parse(window.localStorage.getItem(COLUMN_STORAGE_KEY) || "[]"));
  } catch {
    return defaultConfig();
  }
}

interface PurchaseReturnRow {
  id: string;
  ioId: number;
  ioDate?: string | null;
  status?: string | null;
  fStatus?: string | null;
  totalQty?: number | null;
  totalSkuCount?: number | null;
  totalAmount?: number | null;
  warehouse?: string | null;
  wmsCoName?: string | null;
  supplierName?: string | null;
  creatorName?: string | null;
  archiverName?: string | null;
  archivedAt?: string | null;
  labels?: string | null;
  remark?: string | null;
  createdText?: string | null;
  modifiedText?: string | null;
  updatedAt?: string | null;
  source?: string | null;
  lifecycle?: string | null;
  accountId?: string | null;
  createdByUserId?: string | null;
  effectiveAt?: string | null;
  cancelledAt?: string | null;
}

interface PurchaseReturnItemRow {
  id: string;
  ioId: number;
  ioiId: number;
  skuId?: string | null;
  productName?: string | null;
  propertiesValue?: string | null;
  picUrl?: string | null;
  qty?: number | null;
  costPrice?: number | null;
  costAmount?: number | null;
  iId?: string | null;
  supplierIId?: string | null;
  supplierSkuId?: string | null;
  labels?: string | null;
  remark?: string | null;
}

interface DraftItem {
  key: string;
  skuId: string;
  productName?: string | null;
  propertiesValue?: string | null;
  picUrl?: string | null;
  qty: number | null;
  costPrice: number | null;
}

interface AccountRow {
  id: string;
  name?: string | null;
  shopName?: string | null;
}

interface SkuOption {
  id: string;
  name?: string | null;
  spec?: string | null;
  picUrl?: string | null;
  weightedAvgCost?: number | null;
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
  if (/作废|取消|关闭|cancelled/i.test(text)) return "red";
  if (/生效|完成|effective/i.test(text)) return "green";
  if (/draft|草稿/i.test(text)) return "default";
  return "default";
}

// 旧服务器返回不带 lifecycle 字段时按业务语义兜底：手建无值不可能(走新写路径)，
// 聚水潭历史导入全是 effective，所以兜 effective 安全。
function effectiveLifecycle(row: { lifecycle?: string | null; source?: string | null }) {
  return row.lifecycle || "effective";
}

function lifecycleLabel(lifecycle?: string | null) {
  switch (lifecycle) {
    case "draft": return { label: "草稿", color: "default" as const };
    case "effective": return { label: "生效", color: "green" as const };
    case "cancelled": return { label: "已作废", color: "red" as const };
    default: return { label: lifecycle || "-", color: "default" as const };
  }
}

function makeKey() {
  return Math.random().toString(36).slice(2, 10);
}

export default function PurchaseReturnsSection() {
  const [rows, setRows] = useState<PurchaseReturnRow[]>([]);
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
  const [items, setItems] = useState<PurchaseReturnItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const requestIdRef = useRef(0);


  // 新建 / 编辑表单
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const [remark, setRemark] = useState("");
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [skuSearch, setSkuSearch] = useState("");
  const [skuOptions, setSkuOptions] = useState<SkuOption[]>([]);
  const [skuLoading, setSkuLoading] = useState(false);

  // 列自定义
  const [columnConfig, setColumnConfig] = useState<ColumnConfig>(readConfig);
  const [columnDraft, setColumnDraft] = useState<ColumnConfig | null>(null);
  const [columnMenu, setColumnMenu] = useState({ open: false, x: 0, y: 0, bodyMaxHeight: MENU_MAX_BODY_HEIGHT });
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);

  const openColumnMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const pos = menuPosition(event.clientX, event.clientY);
    setColumnDraft({ order: [...columnConfig.order], visible: [...columnConfig.visible] });
    setColumnMenu({ open: true, ...pos });
  }, [columnConfig]);

  const reorderDraft = useCallback((src: string, tgt: string) => {
    if (!src || !tgt || src === tgt) return;
    setColumnDraft((prev) => {
      const current = normalizeConfig(prev || columnConfig);
      const si = current.order.indexOf(src);
      const ti = current.order.indexOf(tgt);
      if (si === -1 || ti === -1) return current;
      const next = current.order.slice();
      const [moved] = next.splice(si, 1);
      next.splice(ti, 0, moved);
      return { ...current, order: next, visible: next.filter((k) => current.visible.includes(k)) };
    });
  }, [columnConfig]);

  const onDragStart = useCallback((event: DragEvent<HTMLDivElement>, field: string) => {
    setDraggedColumn(field);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", field);
  }, []);
  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);
  const onDrop = useCallback((event: DragEvent<HTMLDivElement>, tgt: string) => {
    event.preventDefault();
    const src = draggedColumn || event.dataTransfer.getData("text/plain");
    reorderDraft(src, tgt);
    setDraggedColumn(null);
  }, [draggedColumn, reorderDraft]);
  const onDragEnd = useCallback(() => setDraggedColumn(null), []);

  const toggleDraftColumn = useCallback((field: string, checked: boolean) => {
    setColumnDraft((prev) => {
      const current = normalizeConfig(prev || columnConfig);
      const visible = new Set(current.visible);
      if (checked) visible.add(field);
      else if (visible.size > 1) visible.delete(field);
      return { ...current, visible: current.order.filter((k) => visible.has(k)) };
    });
  }, [columnConfig]);

  const saveColumnConfig = useCallback(() => {
    const next = normalizeConfig(columnDraft || columnConfig);
    setColumnConfig(next);
    try { window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setColumnMenu((prev) => ({ ...prev, open: false }));
  }, [columnConfig, columnDraft]);

  const restoreColumnConfig = useCallback(() => setColumnDraft(defaultConfig()), []);

  useEffect(() => {
    if (!columnMenu.open) return undefined;
    const close = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(".purchase-order-column-menu")) return;
      setColumnMenu((prev) => ({ ...prev, open: false }));
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setColumnMenu((prev) => ({ ...prev, open: false }));
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [columnMenu.open]);

  const loadData = useCallback(async (notify = false) => {
    if (!erp?.purchaseReturn?.page) {
      setError("ERP 接口未就绪，请确认桌面端已登录");
      setLoadedOnce(true);
      return;
    }
    const id = requestIdRef.current + 1;
    requestIdRef.current = id;
    setLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      const result = await erp.purchaseReturn.page({
        q: query || undefined,
        limit: pageSize,
        offset,
      });
      if (id !== requestIdRef.current) return;
      setRows(Array.isArray(result?.rows) ? result.rows : []);
      setTotal(Number(result?.total || 0));
      setError(null);
      setLoadedAt(new Date().toISOString());
      setLoadedOnce(true);
      if (notify) message.success(`已同步 ${formatNumber(result?.rows?.length || 0)} 条采购退货`);
    } catch (e: any) {
      if (id !== requestIdRef.current) return;
      setError(e?.message || "采购退货读取失败");
      setLoadedOnce(true);
      if (notify) message.error(e?.message || "采购退货读取失败");
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  }, [query, page, pageSize]);

  useEffect(() => { void loadData(); }, [loadData]);

  // 编辑器打开时加载 accounts 列表（一次性）
  useEffect(() => {
    if (!editorOpen || !erp?.account?.list) return;
    if (accounts.length) return;
    erp.account.list({}).then((list: any) => {
      setAccounts(Array.isArray(list) ? list : []);
    }).catch(() => { /* ignore */ });
  }, [editorOpen, accounts.length]);

  // SKU 搜索（防抖）
  useEffect(() => {
    if (!editorOpen) return;
    const q = skuSearch.trim();
    const handle = setTimeout(() => {
      if (!erp?.sku?.list) return;
      setSkuLoading(true);
      erp.sku.list({ q: q || undefined, search: q || undefined, limit: 50 })
        .then((list: any) => setSkuOptions(Array.isArray(list) ? list.slice(0, 50) : []))
        .catch(() => setSkuOptions([]))
        .finally(() => setSkuLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [skuSearch, editorOpen]);

  const toggleExpand = useCallback(async (row: PurchaseReturnRow) => {
    if (expandedId === row.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(row.id);
    setItems([]);
    if (!erp?.purchaseReturn?.items) return;
    setItemsLoading(true);
    try {
      const list = await erp.purchaseReturn.items({ ioId: row.ioId });
      setItems(Array.isArray(list) ? list : []);
    } catch (e: any) {
      message.error(e?.message || "明细读取失败");
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  }, [expandedId]);

  const resetEditor = () => {
    setEditorId(null);
    setSupplierName("");
    setAccountId(undefined);
    setRemark("");
    setDraftItems([]);
    setSkuSearch("");
    setSkuOptions([]);
  };

  const openCreate = () => {
    setEditorMode("create");
    resetEditor();
    setEditorOpen(true);
  };

  const openEdit = (row: PurchaseReturnRow, fromItems: PurchaseReturnItemRow[]) => {
    setEditorMode("edit");
    setEditorId(row.id);
    setSupplierName(row.supplierName || "");
    setAccountId(row.accountId || undefined);
    setRemark(row.remark || "");
    setDraftItems(fromItems.map((it) => ({
      key: makeKey(),
      skuId: it.skuId || "",
      productName: it.productName,
      propertiesValue: it.propertiesValue,
      picUrl: it.picUrl,
      qty: it.qty == null ? null : Number(it.qty),
      costPrice: it.costPrice == null ? null : Number(it.costPrice),
    })));
    setSkuSearch("");
    setSkuOptions([]);
    setEditorOpen(true);
  };

  const addSkuToDraft = (sku: SkuOption) => {
    setDraftItems((prev) => {
      if (prev.some((it) => it.skuId === sku.id)) {
        message.info(`${sku.id} 已在明细中`);
        return prev;
      }
      return [...prev, {
        key: makeKey(),
        skuId: sku.id,
        productName: sku.name || null,
        propertiesValue: sku.spec || null,
        picUrl: sku.picUrl || null,
        qty: null,
        costPrice: null,
      }];
    });
  };

  const updateDraftItem = (key: string, patch: Partial<DraftItem>) => {
    setDraftItems((prev) => prev.map((it) => it.key === key ? { ...it, ...patch } : it));
  };

  const removeDraftItem = (key: string) => {
    setDraftItems((prev) => prev.filter((it) => it.key !== key));
  };

  const totalAmountInDraft = useMemo(() => {
    return draftItems.reduce((s, it) => {
      const q = Number(it.qty) || 0;
      const c = Number(it.costPrice) || 0;
      return s + q * c;
    }, 0);
  }, [draftItems]);

  const submitEditor = async (effective: boolean) => {
    if (!supplierName.trim()) { message.error("供应商必填"); return; }
    if (!accountId) { message.error("仓库账户必选"); return; }
    if (!draftItems.length) { message.error("至少一条明细"); return; }
    for (const it of draftItems) {
      if (!it.skuId) { message.error("明细 SKU 不能为空"); return; }
      const q = Number(it.qty);
      if (!Number.isInteger(q) || q <= 0) { message.error(`SKU ${it.skuId} 数量必须为正整数`); return; }
      const c = Number(it.costPrice);
      if (!Number.isFinite(c) || c <= 0) { message.error(`SKU ${it.skuId} 单价必须为正数（必填，无默认值）`); return; }
    }
    setEditorBusy(true);
    try {
      const itemsPayload = draftItems.map((it) => ({
        skuId: it.skuId,
        productName: it.productName || undefined,
        propertiesValue: it.propertiesValue || undefined,
        picUrl: it.picUrl || undefined,
        qty: Number(it.qty),
        costPrice: Number(it.costPrice),
      }));
      let id = editorId;
      if (editorMode === "create") {
        const res = await erp.purchaseReturn.action({
          action: "create_draft",
          supplierName: supplierName.trim(),
          accountId,
          remark: remark.trim() || null,
          items: itemsPayload,
        });
        id = res?.id;
        message.success(`草稿已建：${id}`);
      } else if (editorId) {
        await erp.purchaseReturn.action({
          action: "update_draft",
          id: editorId,
          supplierName: supplierName.trim(),
          accountId,
          remark: remark.trim() || null,
          items: itemsPayload,
        });
        message.success("草稿已更新");
      }
      if (effective && id) {
        await erp.purchaseReturn.action({ action: "effective", id });
        message.success("已生效，库存已扣减");
      }
      setEditorOpen(false);
      setExpandedId(null);
      await loadData();
      // editor 关闭后 items state 不再 fresh，清掉避免下次展开闪一下旧值
      setItems([]);
    } catch (e: any) {
      message.error(e?.message || "操作失败");
    } finally {
      setEditorBusy(false);
    }
  };

  const doEffective = async (row: PurchaseReturnRow) => {
    try {
      await erp.purchaseReturn.action({ action: "effective", id: row.id });
      message.success("已生效，库存已扣减");
      setExpandedId(null);
      await loadData();
    } catch (e: any) {
      message.error(e?.message || "生效失败");
    }
  };

  const doCancel = async (row: PurchaseReturnRow) => {
    try {
      await erp.purchaseReturn.action({ action: "cancel", id: row.id });
      message.success("已作废，库存已加回");
      setExpandedId(null);
      await loadData();
    } catch (e: any) {
      message.error(e?.message || "作废失败");
    }
  };

  const doDelete = async (row: PurchaseReturnRow) => {
    try {
      await erp.purchaseReturn.action({ action: "delete_draft", id: row.id });
      message.success("草稿已删除");
      setExpandedId(null);
      await loadData();
    } catch (e: any) {
      message.error(e?.message || "删除失败");
    }
  };

  const supplierCount = useMemo(() => new Set(rows.map((r) => r.supplierName).filter(Boolean)).size, [rows]);
  const totalQty = useMemo(() => rows.reduce((s, r) => s + Number(r.totalQty || 0), 0), [rows]);
  const totalAmount = useMemo(() => rows.reduce((s, r) => s + Number(r.totalAmount || 0), 0), [rows]);

  const columns = useMemo<ColumnsType<PurchaseReturnRow>>(() => {
    const rawColumns: ColumnsType<PurchaseReturnRow> = [
    {
      title: "状态",
      key: "lifecycle",
      width: 84,
      render: (_v, row) => {
        const lc = lifecycleLabel(effectiveLifecycle(row));
        return <Tag color={lc.color} style={{ marginRight: 0 }}>{lc.label}</Tag>;
      },
    },
    {
      title: "退货单号",
      key: "ioId",
      width: 130,
      render: (_v, row) => {
        const display = row.source === "manual" ? row.id.replace(/^po-ret:/, "").slice(0, 8) : String(row.ioId);
        return <Text style={{ fontWeight: 600, fontSize: 12 }}>{display}</Text>;
      },
    },
    {
      title: "退货时间",
      dataIndex: "ioDate",
      key: "ioDate",
      width: 160,
      render: (v) => <Text style={{ fontSize: 12 }}>{formatTime(v)}</Text>,
    },
    {
      title: "供应商",
      dataIndex: "supplierName",
      key: "supplierName",
      width: 180,
      render: (v) => v || "-",
    },
    {
      title: "仓库",
      dataIndex: "warehouse",
      key: "warehouse",
      width: 200,
      ellipsis: true,
      render: (v) => v || "-",
    },
    {
      title: "WMS",
      dataIndex: "wmsCoName",
      key: "wmsCoName",
      width: 120,
      ellipsis: true,
      render: (v) => v || "-",
    },
    { title: "退货数量", dataIndex: "totalQty", key: "totalQty", width: 100, align: "right", render: (v) => formatNumber(v) },
    { title: "退货金额", dataIndex: "totalAmount", key: "totalAmount", width: 130, align: "right", render: (v) => formatMoney(v) },
    { title: "SKU 数", dataIndex: "totalSkuCount", key: "totalSkuCount", width: 80, align: "right", render: (v) => formatNumber(v) },
    { title: "制单人", dataIndex: "creatorName", key: "creatorName", width: 110, render: (v) => v || "-" },
    { title: "标签", dataIndex: "labels", key: "labels", width: 100, render: (v) => v || "-" },
    { title: "备注", dataIndex: "remark", key: "remark", width: 180, ellipsis: true, render: (v) => v || "-" },
    ];

    // 按 columnConfig 过滤+排序，给可配置列绑右键菜单
    const byKey = new Map<string, ColumnType<PurchaseReturnRow>>(
      rawColumns.map((c) => [String((c as ColumnType<PurchaseReturnRow>).key ?? ""), c as ColumnType<PurchaseReturnRow>]),
    );
    const visibleSet = new Set(columnConfig.visible);
    const ordered = columnConfig.order
      .filter((k) => visibleSet.has(k))
      .map((k) => byKey.get(k))
      .filter(Boolean) as ColumnsType<PurchaseReturnRow>;
    const headerProps = () => ({
      title: "右键配置列",
      className: "purchase-order-column-configurable",
      onContextMenu: openColumnMenu,
    });
    return ordered.map((c) => ({ ...c, onHeaderCell: headerProps }));
  }, [columnConfig, openColumnMenu]);

  const itemColumns: ColumnsType<PurchaseReturnItemRow> = [
    {
      title: "图片",
      key: "picUrl",
      width: 76,
      align: "center",
      render: (_v, row) => (
        row.picUrl
          ? (
            <Image
              src={row.picUrl}
              alt=""
              width={56}
              height={56}
              style={{ objectFit: "cover", borderRadius: 4, cursor: "zoom-in" }}
              preview={{ mask: <EyeOutlined /> }}
              onClick={(e) => e.stopPropagation()}
            />
          )
          : <span style={{ color: "#bbb" }}>-</span>
      ),
    },
    {
      title: "商品名称",
      dataIndex: "productName",
      key: "productName",
      width: 240,
      render: (v) => (
        <Paragraph ellipsis={{ rows: 2, tooltip: v || "-" }} style={{ marginBottom: 0, fontWeight: 600, lineHeight: 1.3 }}>
          {v || "-"}
        </Paragraph>
      ),
    },
    { title: "货号", dataIndex: "iId", key: "iId", width: 130, render: (v) => v || "-" },
    { title: "SKU", dataIndex: "skuId", key: "skuId", width: 130, render: (v) => v || "-" },
    { title: "规格", dataIndex: "propertiesValue", key: "spec", width: 160, render: (v) => v || "-" },
    { title: "数量", dataIndex: "qty", key: "qty", width: 80, align: "right", render: (v) => formatNumber(v) },
    { title: "单价", dataIndex: "costPrice", key: "costPrice", width: 100, align: "right", render: (v) => formatMoney(v) },
    { title: "行金额", dataIndex: "costAmount", key: "costAmount", width: 120, align: "right", render: (v) => formatMoney(v) },
    { title: "标签", dataIndex: "labels", key: "labels", width: 90, render: (v) => v || "-" },
    { title: "备注", dataIndex: "remark", key: "remark", width: 160, ellipsis: true, render: (v) => v || "-" },
  ];


  return (
    <div>
      {error ? (
        <Alert style={{ marginBottom: 12 }} type="warning" showIcon message={error} />
      ) : null}

      <Row gutter={[12, 12]} className="material-kpi-row" style={{ marginBottom: 12 }}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="本页退货单" value={formatNumber(rows.length)} color="danger" icon={<CloudSyncOutlined />} compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="累计单数" value={formatNumber(total)} color="neutral" compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="本页退货件" value={formatNumber(totalQty)} color="blue" compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="本页退货金额" value={formatMoney(totalAmount)} color={totalAmount ? "orange" : "neutral"} compact />
        </Col>
      </Row>

      <section className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">采购退货明细</div>
            <div className="app-panel__title-sub">
              聚水潭历史台账 + 手建退货单（生效后扣库存，作废加回）。
              本页 {formatNumber(rows.length)} / 累计 {formatNumber(total)} 条；涉及供应商 {formatNumber(supplierCount)}。
              {loadedAt ? ` 同步 ${formatTime(loadedAt)}` : ""}
            </div>
          </div>
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建退货单</Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadData(true)}>刷新</Button>
          </Space>
        </div>

        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div className="material-filter-bar material-filter-bar--search">
            <Input.Search
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索供应商 / 单号 / 制单人 / 仓库 / 标签 / 备注"
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

          <Table<PurchaseReturnRow>
            className="erp-compact-table"
            rowKey="id"
            size="middle"
            loading={loading && !loadedOnce}
            columns={columns}
            dataSource={rows}
            scroll={{ x: 1800 }}
            onRow={(row) => ({ onClick: () => void toggleExpand(row), style: { cursor: "pointer" } })}
            expandable={{
              expandedRowKeys: expandedId ? [expandedId] : [],
              showExpandColumn: false,
              rowExpandable: () => true,
              expandedRowRender: (row) => (
                <div style={{ padding: "8px 4px" }}>
                  <Space style={{ marginBottom: 12 }} wrap>
                    {row.source === "manual" && row.lifecycle === "draft" ? (
                      <>
                        <Button icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); openEdit(row, items); }}>编辑</Button>
                        <Popconfirm title="删除这张草稿？" onConfirm={() => doDelete(row)}>
                          <Button danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()}>删除</Button>
                        </Popconfirm>
                        <Popconfirm
                          title="确认生效？"
                          description="生效后会按 FIFO 扣减库存，操作不可撤销（只能作废反向）"
                          onConfirm={() => doEffective(row)}
                        >
                          <Button type="primary" onClick={(e) => e.stopPropagation()}>生效</Button>
                        </Popconfirm>
                      </>
                    ) : null}
                    {row.source === "manual" && row.lifecycle === "effective" ? (
                      <Popconfirm
                        title="作废这张退货单？"
                        description="将按当前明细数量/单价反向加回库存（新建批次），作废为终态"
                        onConfirm={() => doCancel(row)}
                      >
                        <Button danger icon={<StopOutlined />} onClick={(e) => e.stopPropagation()}>作废</Button>
                      </Popconfirm>
                    ) : null}
                  </Space>

                  <Row gutter={[12, 8]} style={{ marginBottom: 12 }}>
                    <Col xs={12} sm={6}><Text type="secondary">退货时间</Text><div>{formatTime(row.ioDate)}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">状态</Text><div><Tag color={statusColor(row.status)}>{row.status || "-"}</Tag></div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">标签</Text><div>{row.labels || "-"}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">仓库</Text><div>{row.warehouse || "-"}</div></Col>
                    <Col xs={12} sm={6}><Text type="secondary">制单人</Text><div>{row.creatorName || "-"}</div></Col>
                    {row.source === "manual" ? (
                      <>
                        <Col xs={12} sm={6}><Text type="secondary">生效时间</Text><div>{formatTime(row.effectiveAt)}</div></Col>
                        <Col xs={12} sm={6}><Text type="secondary">作废时间</Text><div>{formatTime(row.cancelledAt)}</div></Col>
                      </>
                    ) : (
                      <>
                        <Col xs={12} sm={6}><Text type="secondary">归档时间</Text><div>{formatTime(row.archivedAt)}</div></Col>
                        <Col xs={12} sm={6}><Text type="secondary">归档人</Text><div>{row.archiverName || "-"}</div></Col>
                      </>
                    )}
                    {row.remark ? <Col xs={24}><Text type="secondary">备注</Text><div>{row.remark}</div></Col> : null}
                  </Row>

                  <Table<PurchaseReturnItemRow>
                    className="erp-compact-table"
                    rowKey="id"
                    size="small"
                    loading={itemsLoading}
                    columns={itemColumns}
                    dataSource={items}
                    scroll={{ x: 1100 }}
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
                  title="暂无采购退货记录"
                  description="历史数据来自聚水潭一次性导入；新建按钮可建手工退货单。"
                />
              ),
            }}
          />
        </Space>
      </section>

      <Modal
        title={editorMode === "create" ? "新建采购退货单" : "编辑草稿"}
        open={editorOpen}
        onCancel={() => !editorBusy && setEditorOpen(false)}
        width={960}
        maskClosable={false}
        footer={[
          <Button key="cancel" disabled={editorBusy} onClick={() => setEditorOpen(false)}>取消</Button>,
          <Button key="draft" loading={editorBusy} onClick={() => void submitEditor(false)}>
            {editorMode === "create" ? "保存草稿" : "更新草稿"}
          </Button>,
          <Button key="effective" type="primary" loading={editorBusy} onClick={() => void submitEditor(true)}>
            {editorMode === "create" ? "保存并生效" : "更新并生效"}
          </Button>,
        ]}
      >
        <Form layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="供应商" required>
                <Input
                  placeholder="自由文本，如 32棉签盒 / 禧昕塑料制品有限公司"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="退货仓库（从该仓的库存扣）" required>
                <Select
                  showSearch
                  placeholder="选择仓库账户"
                  optionFilterProp="label"
                  value={accountId}
                  onChange={setAccountId}
                  options={accounts.map((a) => ({ value: a.id, label: a.name || a.shopName || a.id }))}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label="备注">
                <Input.TextArea
                  rows={2}
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="可选"
                />
              </Form.Item>
            </Col>
          </Row>

          <div style={{ marginBottom: 8 }}>
            <Text strong>退货明细</Text>
            <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
              单价必填（无默认值），合计 {formatMoney(totalAmountInDraft)}
            </Text>
          </div>

          <Select
            showSearch
            allowClear
            placeholder="搜索 SKU（编码 / 名称 / 规格）"
            style={{ width: "100%", marginBottom: 12 }}
            filterOption={false}
            loading={skuLoading}
            onSearch={setSkuSearch}
            onChange={(value) => {
              if (!value) return;
              const sku = skuOptions.find((s) => s.id === value);
              if (sku) addSkuToDraft(sku);
              setSkuSearch("");
            }}
            value={undefined}
            options={skuOptions.map((s) => ({
              value: s.id,
              label: `${s.id} · ${s.name || ""}${s.spec ? ` / ${s.spec}` : ""}`,
            }))}
            notFoundContent={skuLoading ? "搜索中..." : (skuSearch ? "无匹配" : "请输入关键词")}
          />

          <Table<DraftItem>
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={draftItems}
            locale={{ emptyText: "请从上方搜索并选择 SKU" }}
            columns={[
              {
                title: "SKU / 名称",
                key: "sku",
                render: (_v, it) => (
                  <Space direction="vertical" size={0}>
                    <Text style={{ fontWeight: 600, fontSize: 12 }}>{it.skuId}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{it.productName || "-"} {it.propertiesValue ? `/ ${it.propertiesValue}` : ""}</Text>
                  </Space>
                ),
              },
              {
                title: "数量",
                key: "qty",
                width: 110,
                render: (_v, it) => (
                  <InputNumber
                    min={1}
                    step={1}
                    precision={0}
                    value={it.qty ?? undefined}
                    onChange={(v) => updateDraftItem(it.key, { qty: v == null ? null : Number(v) })}
                    style={{ width: "100%" }}
                  />
                ),
              },
              {
                title: "单价 CNY",
                key: "costPrice",
                width: 140,
                render: (_v, it) => (
                  <InputNumber
                    min={0.01}
                    step={0.01}
                    precision={2}
                    value={it.costPrice ?? undefined}
                    onChange={(v) => updateDraftItem(it.key, { costPrice: v == null ? null : Number(v) })}
                    style={{ width: "100%" }}
                    placeholder="必填"
                  />
                ),
              },
              {
                title: "行金额",
                key: "amount",
                width: 120,
                align: "right",
                render: (_v, it) => formatMoney((Number(it.qty) || 0) * (Number(it.costPrice) || 0)),
              },
              {
                title: "",
                key: "ops",
                width: 60,
                render: (_v, it) => (
                  <Button size="small" type="link" danger onClick={() => removeDraftItem(it.key)}>删除</Button>
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      {columnMenu.open && typeof document !== "undefined" ? createPortal(
        <div
          className="purchase-order-column-menu"
          style={{ left: columnMenu.x, top: columnMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="purchase-order-column-menu__head">自定义字段显示信息</div>
          <div className="purchase-order-column-menu__body" style={{ maxHeight: columnMenu.bodyMaxHeight }}>
            {(columnDraft || columnConfig).order.map((field) => {
              const draft = columnDraft || columnConfig;
              const checked = draft.visible.includes(field);
              return (
                <div
                  key={field}
                  className={draggedColumn === field ? "purchase-order-column-menu__item is-dragging" : "purchase-order-column-menu__item"}
                  draggable
                  onDragStart={(event) => onDragStart(event, field)}
                  onDragOver={onDragOver}
                  onDrop={(event) => onDrop(event, field)}
                  onDragEnd={onDragEnd}
                >
                  <span className="purchase-order-column-menu__drag" aria-hidden="true">
                    <HolderOutlined />
                  </span>
                  <span>{COLUMN_LABELS[field] || field}</span>
                  <Checkbox
                    checked={checked}
                    disabled={checked && draft.visible.length <= 1}
                    onChange={(event) => toggleDraftColumn(field, event.target.checked)}
                  />
                </div>
              );
            })}
          </div>
          <div className="purchase-order-column-menu__foot">
            <Button size="small" type="primary" onClick={saveColumnConfig}>保存</Button>
            <Button size="small" onClick={restoreColumnConfig}>还原</Button>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
