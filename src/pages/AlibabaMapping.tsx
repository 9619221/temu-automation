import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Col,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Row,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { BellOutlined, DeleteOutlined, EditOutlined, LinkOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, StarOutlined } from "@ant-design/icons";
import { useSessionState, readSessionState } from "../hooks/useSessionState";
import PageHeader from "../components/PageHeader";
import { useErpAuth } from "../contexts/ErpAuthContext";
import ProductMasterData from "./ProductMasterData";

const { Text } = Typography;
const erp = window.electronAPI?.erp;
const appAPI = window.electronAPI?.app;
const ALIBABA_MAPPING_PAGE_SIZE = 20;
const MAPPING_WORKBENCH_PARAMS = {
  limit: 500,
  includeRequestDetails: false,
  include1688Meta: false,
};
const supplierActionGridStyle: CSSProperties = {
  display: "grid",
  gap: 6,
  gridTemplateColumns: "repeat(2, 68px)",
  justifyContent: "start",
};
const supplierActionButtonStyle: CSSProperties = {
  paddingInline: 0,
  width: 68,
};

interface Primary1688Source {
  id?: string | null;
  externalOfferId?: string | null;
  externalSkuId?: string | null;
  externalSpecId?: string | null;
  platformSkuName?: string | null;
  supplierName?: string | null;
  productTitle?: string | null;
  productUrl?: string | null;
  imageUrl?: string | null;
  unitPrice?: number | null;
  moq?: number | null;
  ourQty?: number | null;
  platformQty?: number | null;
}

interface SkuOptionRow {
  id: string;
  accountId?: string | null;
  accountName?: string | null;
  internalSkuCode?: string;
  productName?: string;
  colorSpec?: string | null;
  systemSupplierName?: string | null;
  imageUrl?: string | null;
  primary1688Source?: Primary1688Source | null;
}

interface Sku1688SourceRow {
  id: string;
  accountId?: string | null;
  accountName?: string | null;
  skuId: string;
  mappingGroupId?: string | null;
  internalSkuCode?: string;
  productName?: string;
  colorSpec?: string | null;
  systemSupplierName?: string | null;
  externalOfferId?: string | null;
  externalSkuId?: string | null;
  externalSpecId?: string | null;
  platformSkuName?: string | null;
  supplierName?: string | null;
  productTitle?: string | null;
  productUrl?: string | null;
  imageUrl?: string | null;
  skuImageUrl?: string | null;
  unitPrice?: number | null;
  moq?: number | null;
  ourQty?: number | null;
  platformQty?: number | null;
  ratioText?: string | null;
  status?: string | null;
  isDefault?: boolean;
  sourcePayload?: {
    marketingMixConfig?: MarketingMixConfig | null;
    marketingMixSyncedAt?: string | null;
    marketingMixAutoAttemptedAt?: string | null;
    marketingMixAutoStatus?: string | null;
    marketingMixAutoError?: string | null;
    relationUserInfo?: Record<string, unknown> | null;
    relationUserInfoAutoAttemptedAt?: string | null;
    relationUserInfoAutoStatus?: string | null;
    relationUserInfoAutoError?: string | null;
    purchasedProductSimple?: Record<string, unknown> | null;
    purchasedProductSimpleAutoAttemptedAt?: string | null;
    purchasedProductSimpleAutoStatus?: string | null;
    purchasedProductSimpleAutoError?: string | null;
    followedAt1688?: string | null;
    monitorProduct?: { enabled?: boolean } | null;
    [key: string]: unknown;
  } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  isSkuPlaceholder?: boolean;
}

interface MarketingMixConfig {
  generalHunpi?: boolean;
  mixAmount?: number | null;
  mixNumber?: number | null;
  memberId?: string | null;
  gmtCreate?: string | null;
  gmtModified?: string | null;
}

interface MappingFormValues {
  skuId: string;
  accountId?: string;
  mappingGroupId?: string;
  externalOfferId?: string;
  externalSkuId?: string;
  externalSpecId?: string;
  isNoSpec?: boolean;
  platformSkuName?: string;
  supplierName?: string;
  productTitle?: string;
  productUrl?: string;
  imageUrl?: string;
  unitPrice?: number;
  moq?: number;
  ourQty: number;
  platformQty: number;
  status: string;
  isDefault?: boolean;
}

interface MappingSpecRow {
  key: string;
  externalSkuId?: string | null;
  externalSpecId: string;
  isNoSpec?: boolean;
  specText?: string | null;
  imageUrl?: string | null;
  price?: number | null;
  stock?: number | null;
}

interface PendingMappingSpecRow extends MappingSpecRow {
  platformQty?: number;
}

interface UrlSpecDialogState {
  externalOfferId: string;
  productUrl: string;
  detail: {
    supplierName?: string | null;
    productTitle?: string | null;
    imageUrl?: string | null;
    unitPrice?: number | null;
    moq?: number | null;
    skuOptions?: Array<Partial<MappingSpecRow>>;
  };
  rows: MappingSpecRow[];
}

type MappingTabKey = "profiles" | "bound" | "unbound";

interface PageResult<T> {
  rows: T[];
  total: number;
}

function canManage(role?: string | null) {
  return Boolean(role && ["admin", "manager", "operations", "buyer"].includes(role));
}

function canViewSupplierProfiles(role?: string | null) {
  return Boolean(role && ["admin", "buyer"].includes(role));
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function build1688Link(row: Sku1688SourceRow | MappingFormValues) {
  if (row.productUrl) return row.productUrl;
  if (row.externalOfferId) return `https://detail.1688.com/offer/${row.externalOfferId}.html`;
  return "";
}

function normalizeImageUrl(value: unknown): string {
  const text = String(value || "").trim();
  if (!text || text === "[object Object]") return "";
  return text.startsWith("//") ? `https:${text}` : text;
}

function imageValue(value: unknown): string {
  if (!value) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = imageValue(item);
      if (url) return url;
    }
    return "";
  }
  if (typeof value === "object") {
    const item = value as Record<string, any>;
    return imageValue(
      item.imageUrl
      || item.imgUrl
      || item.picUrl
      || item.pictureUrl
      || item.thumbUrl
      || item.skuImageUrl
      || item.skuImage
      || item.url
      || item.src
      || item.image
      || item.images
      || item.imageUrls,
    );
  }
  return normalizeImageUrl(value);
}

function isSkuPlaceholderRow(row: Sku1688SourceRow) {
  return Boolean(row.isSkuPlaceholder);
}

function buildSkuDisplayRow(sku: SkuOptionRow): Sku1688SourceRow {
  const source = sku.primary1688Source || {};
  const sourceId = source.id || "";
  const externalOfferId = source.externalOfferId || null;
  return {
    id: sourceId || `sku:${sku.id}`,
    accountId: sku.accountId || null,
    accountName: sku.accountName || null,
    skuId: sku.id,
    internalSkuCode: sku.internalSkuCode,
    productName: sku.productName,
    colorSpec: sku.colorSpec || null,
    systemSupplierName: sku.systemSupplierName || null,
    externalOfferId,
    externalSkuId: source.externalSkuId || null,
    externalSpecId: source.externalSpecId || null,
    platformSkuName: source.platformSkuName || null,
    supplierName: source.supplierName || null,
    productTitle: source.productTitle || null,
    productUrl: source.productUrl || (externalOfferId ? `https://detail.1688.com/offer/${externalOfferId}.html` : null),
    imageUrl: source.imageUrl || sku.imageUrl || null,
    unitPrice: source.unitPrice ?? null,
    moq: source.moq ?? null,
    ourQty: source.ourQty ?? 1,
    platformQty: source.platformQty ?? 1,
    status: externalOfferId ? "active" : "unmapped",
    isDefault: Boolean(sourceId),
    sourcePayload: null,
    isSkuPlaceholder: !sourceId,
  };
}

async function openExternalUrl(url: string) {
  const target = url.trim();
  if (!target) return;
  try {
    if (appAPI?.openExternal) {
      await appAPI.openExternal(target);
      return;
    }
    window.open(target, "_blank", "noopener,noreferrer");
  } catch (error: any) {
    message.error(error?.message || "打开 1688 地址失败");
  }
}

function extract1688OfferId(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "";
  const offerPathMatch = text.match(/offer\/(\d+)\.html/i);
  if (offerPathMatch?.[1]) return offerPathMatch[1];
  const queryMatch = text.match(/[?&](?:offerId|offer_id|productId|productID)=(\d+)/i);
  if (queryMatch?.[1]) return queryMatch[1];
  const looseMatch = text.match(/(?:^|[^\d])(\d{8,})(?:[^\d]|$)/);
  return looseMatch?.[1] || "";
}

// 无规格商品的「选中标识」：specId 为空时用 row.key 兜底（selectedUrlSpecIds / 数量映射均以此为 key）。
function specRowSelectId(row: MappingSpecRow): string {
  return row.isNoSpec ? row.key : row.externalSpecId;
}

function productDetailSpecRows(detail?: UrlSpecDialogState["detail"] | null): MappingSpecRow[] {
  const options = Array.isArray(detail?.skuOptions) ? detail.skuOptions : [];
  return options
    .filter((item) => item?.isNoSpec || item?.externalSpecId || item?.externalSkuId)
    .map((item, index) => {
      const isNoSpec = Boolean(item.isNoSpec);
      const externalSpecId = String(item.externalSpecId || item.externalSkuId || "");
      return {
        key: isNoSpec ? `__nospec__:${index}` : `${externalSpecId}:${item.externalSkuId || ""}:${index}`,
        externalSkuId: item.externalSkuId || externalSpecId,
        externalSpecId,
        isNoSpec,
        specText: item.specText || (isNoSpec ? "整款（无规格）" : externalSpecId),
        imageUrl: imageValue([(item as any).imageUrl, (item as any).raw]),
        price: item.price ?? null,
        stock: item.stock ?? null,
      };
    });
}

function specRowSearchText(row: MappingSpecRow) {
  return [
    row.specText,
    row.externalSkuId,
    row.externalSpecId,
  ].map((value) => String(value ?? "")).join(" ");
}

function toPositiveInteger(value: unknown, fallback = 1) {
  const numberValue = Math.floor(Number(value));
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
}

function mappingStatus(row: Sku1688SourceRow) {
  if (!row.supplierName || !build1688Link(row) || !row.externalOfferId) {
    return { label: "未匹配", color: "default" };
  }
  if (!row.platformSkuName && !row.externalSkuId && !row.externalSpecId) {
    return { label: "待同步", color: "warning" };
  }
  return { label: "匹配成功", color: "success" };
}

function formatMixRule(config?: MarketingMixConfig | null) {
  if (!config) return "-";
  if (!config.generalHunpi) return "按单品起订";
  const amountText = config.mixAmount !== null && config.mixAmount !== undefined
    ? `满 ¥${Number(config.mixAmount).toFixed(2)}`
    : "";
  const numberText = config.mixNumber !== null && config.mixNumber !== undefined
    ? `满 ${Number(config.mixNumber)} 件`
    : "";
  return [amountText, numberText].filter(Boolean).join(" / ") || "支持组合起订";
}

function getMarketingMixConfig(row: Sku1688SourceRow) {
  return row.sourcePayload?.marketingMixConfig || null;
}

function getPurchaseRuleState(row: Sku1688SourceRow) {
  const config = getMarketingMixConfig(row);
  if (config) {
    return {
      color: config.generalHunpi ? "success" : "default",
      label: `起批规则：${formatMixRule(config)}`,
      tooltip: row.sourcePayload?.marketingMixSyncedAt
        ? `已识别：${formatDateTime(row.sourcePayload.marketingMixSyncedAt)}`
        : "已识别",
    };
  }
  if (row.sourcePayload?.marketingMixAutoStatus === "running") {
    return { color: "processing", label: "起批规则：识别中", tooltip: "正在自动识别供应商起批规则" };
  }
  if (row.sourcePayload?.marketingMixAutoStatus === "failed") {
    return {
      color: "error",
      label: "起批规则：识别失败",
      tooltip: row.sourcePayload?.marketingMixAutoError || "自动识别失败",
    };
  }
  if (row.sourcePayload?.marketingMixAutoAttemptedAt) {
    return { color: "warning", label: "起批规则：待补充", tooltip: "已尝试自动识别，暂未得到可用结果" };
  }
  return { color: "default", label: "起批规则：待自动识别", tooltip: "系统会自动识别一次并记录到供应商资料" };
}

function needsSupplierProfileAutoSync(row: Sku1688SourceRow) {
  const payload = row.sourcePayload || {};
  return Boolean(
    row.id
    && row.externalOfferId
    && (
      (!payload.relationUserInfo && !payload.relationUserInfoAutoAttemptedAt)
      || (!payload.purchasedProductSimple && !payload.purchasedProductSimpleAutoAttemptedAt)
    ),
  );
}

function buildPageParams(page: number, search: string) {
  const keyword = search.trim();
  return {
    limit: ALIBABA_MAPPING_PAGE_SIZE,
    offset: Math.max(0, (page - 1) * ALIBABA_MAPPING_PAGE_SIZE),
    ...(keyword ? { search: keyword } : {}),
  };
}

export default function AlibabaMapping() {
  const auth = useErpAuth();
  const currentRole = auth.currentUser?.role;
  const editable = canManage(currentRole);
  const supplierProfilesVisible = canViewSupplierProfiles(currentRole);
  const [form] = Form.useForm<MappingFormValues>();
  // 订阅 supplierName,解析 1688 地址后(previewSpecsFromUrl 会 setFieldsValue)在弹框里只读展示
  const supplierNameWatched = Form.useWatch("supplierName", form);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<Sku1688SourceRow | null>(null);
  const amViewKey = (suffix: string) => `temu.alibaba-mapping.${suffix}`;
  const [activeTab, setActiveTab] = useSessionState<MappingTabKey>(amViewKey("tab"), () => (supplierProfilesVisible ? "profiles" : "bound"));
  const [boundRows, setBoundRows] = useState<Sku1688SourceRow[]>([]);
  const [boundTotal, setBoundTotal] = useState(0);
  const [boundPage, setBoundPage] = useSessionState(amViewKey("boundPage"), 1);
  const [boundSearch, setBoundSearch] = useSessionState(amViewKey("boundSearch"), "");
  const [boundDebouncedSearch, setBoundDebouncedSearch] = useState(() => readSessionState(amViewKey("boundSearch"), "").trim());
  const [boundLoading, setBoundLoading] = useState(false);
  const [unboundRows, setUnboundRows] = useState<Sku1688SourceRow[]>([]);
  const [unboundTotal, setUnboundTotal] = useState(0);
  const [unboundPage, setUnboundPage] = useSessionState(amViewKey("unboundPage"), 1);
  const [unboundSearch, setUnboundSearch] = useSessionState(amViewKey("unboundSearch"), "");
  const [unboundDebouncedSearch, setUnboundDebouncedSearch] = useState(() => readSessionState(amViewKey("unboundSearch"), "").trim());
  const [unboundLoading, setUnboundLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [specPreviewLoading, setSpecPreviewLoading] = useState(false);
  const [urlSpecDialog, setUrlSpecDialog] = useState<UrlSpecDialogState | null>(null);
  const [selectedUrlSpecIds, setSelectedUrlSpecIds] = useState<string[]>([]);
  const [urlSpecSearchText, setUrlSpecSearchText] = useState("");
  const [pendingUrlSpecs, setPendingUrlSpecs] = useState<PendingMappingSpecRow[]>([]);
  const [urlSpecOurQty, setUrlSpecOurQty] = useState(1);
  const [urlSpecQtyBySpecId, setUrlSpecQtyBySpecId] = useState<Record<string, number>>({});
  const boundRequestIdRef = useRef(0);
  const unboundRequestIdRef = useRef(0);
  const boundLoadedRef = useRef(false);
  const unboundLoadedRef = useRef(false);
  const autoPurchaseRuleIdsRef = useRef<Set<string>>(new Set());
  const autoSupplierProfileIdsRef = useRef<Set<string>>(new Set());

  const loadBoundPage = useCallback(async (page: number, search: string) => {
    if (!erp?.mapping?.page) return;
    const requestId = boundRequestIdRef.current + 1;
    boundRequestIdRef.current = requestId;
    setBoundLoading(true);
    try {
      const result = (await erp.mapping.page(buildPageParams(page, search))) as PageResult<Sku1688SourceRow>;
      if (requestId !== boundRequestIdRef.current) return;
      setBoundRows(Array.isArray(result?.rows) ? result.rows : []);
      setBoundTotal(Number(result?.total || 0));
      boundLoadedRef.current = true;
    } catch (error: any) {
      if (requestId === boundRequestIdRef.current) {
        message.error(error?.message || "已绑定供应商读取失败");
      }
    } finally {
      if (requestId === boundRequestIdRef.current) {
        setBoundLoading(false);
      }
    }
  }, []);

  const loadUnboundPage = useCallback(async (page: number, search: string) => {
    if (!erp?.sku?.listUnmappedPage) return;
    const requestId = unboundRequestIdRef.current + 1;
    unboundRequestIdRef.current = requestId;
    setUnboundLoading(true);
    try {
      const result = (await erp.sku.listUnmappedPage(buildPageParams(page, search))) as PageResult<SkuOptionRow>;
      if (requestId !== unboundRequestIdRef.current) return;
      const rows = Array.isArray(result?.rows) ? result.rows.map(buildSkuDisplayRow) : [];
      setUnboundRows(rows);
      setUnboundTotal(Number(result?.total || 0));
      unboundLoadedRef.current = true;
    } catch (error: any) {
      if (requestId === unboundRequestIdRef.current) {
        message.error(error?.message || "未绑定商品读取失败");
      }
    } finally {
      if (requestId === unboundRequestIdRef.current) {
        setUnboundLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBoundPage(1);
      setBoundDebouncedSearch(boundSearch.trim());
    }, 400);
    return () => window.clearTimeout(timer);
  }, [boundSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setUnboundPage(1);
      setUnboundDebouncedSearch(unboundSearch.trim());
    }, 400);
    return () => window.clearTimeout(timer);
  }, [unboundSearch]);

  useEffect(() => {
    if (activeTab === "profiles" && !supplierProfilesVisible) {
      setActiveTab("bound");
    }
  }, [activeTab, supplierProfilesVisible]);

  useEffect(() => {
    if (activeTab !== "bound" && !boundLoadedRef.current) return;
    void loadBoundPage(boundPage, boundDebouncedSearch);
  }, [activeTab, boundDebouncedSearch, boundPage, loadBoundPage]);

  useEffect(() => {
    if (activeTab !== "unbound" && !unboundLoadedRef.current) return;
    void loadUnboundPage(unboundPage, unboundDebouncedSearch);
  }, [activeTab, loadUnboundPage, unboundDebouncedSearch, unboundPage]);

  useEffect(() => {
    if (activeTab !== "bound" || boundLoading || unboundLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      void loadUnboundPage(unboundPage, unboundDebouncedSearch);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [activeTab, boundLoading, loadUnboundPage, unboundDebouncedSearch, unboundPage]);

  useEffect(() => {
    if (activeTab !== "unbound" || unboundLoading || boundLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      void loadBoundPage(boundPage, boundDebouncedSearch);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [activeTab, boundDebouncedSearch, boundPage, loadBoundPage, unboundLoading]);

  const reloadCurrentPage = useCallback(async () => {
    if (activeTab === "bound") {
      await loadBoundPage(boundPage, boundDebouncedSearch);
      return;
    }
    await loadUnboundPage(unboundPage, unboundDebouncedSearch);
  }, [activeTab, boundDebouncedSearch, boundPage, loadBoundPage, loadUnboundPage, unboundDebouncedSearch, unboundPage]);

  // 绑定 / 解绑会让 SKU 在「已绑定」「未绑定」两边迁移，两个 Tab 都要刷新，避免切过去看到旧数据。
  const reloadBothPages = useCallback(async () => {
    await Promise.all([
      loadBoundPage(boundPage, boundDebouncedSearch),
      loadUnboundPage(unboundPage, unboundDebouncedSearch),
    ]);
  }, [boundDebouncedSearch, boundPage, loadBoundPage, loadUnboundPage, unboundDebouncedSearch, unboundPage]);

  useEffect(() => {
    if (!erp || !editable) return;
    const targets = boundRows
      .filter((row) => (
        row.id
        && row.externalOfferId
        && !getMarketingMixConfig(row)
        && !row.sourcePayload?.marketingMixAutoAttemptedAt
        && !autoPurchaseRuleIdsRef.current.has(row.id)
      ))
      .slice(0, 2);
    if (!targets.length) return;

    let cancelled = false;
    targets.forEach((row) => {
      autoPurchaseRuleIdsRef.current.add(row.id);
      void erp.purchase.action({
        action: "ensure_1688_mix_config_once",
        sourceId: row.id,
        accountId: row.accountId,
        externalOfferId: row.externalOfferId,
        productId: row.externalOfferId,
        ...MAPPING_WORKBENCH_PARAMS,
      }).then(() => {
        if (!cancelled) void loadBoundPage(boundPage, boundDebouncedSearch);
      }).catch(() => {
        // The row is marked failed by the backend; keep the page quiet.
        if (!cancelled) void loadBoundPage(boundPage, boundDebouncedSearch);
      }).finally(() => {
        autoPurchaseRuleIdsRef.current.delete(row.id);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [boundDebouncedSearch, boundPage, boundRows, editable, loadBoundPage]);

  useEffect(() => {
    if (!erp || !editable) return;
    const targets = boundRows
      .filter((row) => needsSupplierProfileAutoSync(row) && !autoSupplierProfileIdsRef.current.has(row.id))
      .slice(0, 2);
    if (!targets.length) return;

    let cancelled = false;
    targets.forEach((row) => {
      autoSupplierProfileIdsRef.current.add(row.id);
      void erp.purchase.action({
        action: "ensure_1688_supplier_profile_once",
        sourceId: row.id,
        accountId: row.accountId,
        externalOfferId: row.externalOfferId,
        productId: row.externalOfferId,
        ...MAPPING_WORKBENCH_PARAMS,
      }).then(() => {
        if (!cancelled) void loadBoundPage(boundPage, boundDebouncedSearch);
      }).catch(() => {
        // The backend records failed attempts; avoid interrupting table work.
        if (!cancelled) void loadBoundPage(boundPage, boundDebouncedSearch);
      }).finally(() => {
        autoSupplierProfileIdsRef.current.delete(row.id);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [boundDebouncedSearch, boundPage, boundRows, editable, loadBoundPage]);

  const updateSelectedUrlSpecIds = useCallback((ids: string[]) => {
    const nextIds = Array.from(new Set(ids.filter(Boolean)));
    setSelectedUrlSpecIds(nextIds);
    setUrlSpecQtyBySpecId((previous) => {
      const next = { ...previous };
      nextIds.forEach((id) => {
        next[id] = toPositiveInteger(next[id], 1);
      });
      return next;
    });
  }, []);

  const selectedUrlSpecs = useMemo(() => {
    if (!urlSpecDialog) return [];
    const selectedIds = new Set(selectedUrlSpecIds);
    return urlSpecDialog.rows.filter((row) => selectedIds.has(specRowSelectId(row)));
  }, [selectedUrlSpecIds, urlSpecDialog]);

  const filteredUrlSpecRows = useMemo(() => {
    const rows = urlSpecDialog?.rows || [];
    const needle = urlSpecSearchText.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => specRowSearchText(row).toLowerCase().includes(needle));
  }, [urlSpecDialog, urlSpecSearchText]);

  const hasUrlSpecRowImages = useMemo(() => (
    (urlSpecDialog?.rows || []).some((row) => Boolean(imageValue([row.imageUrl, (row as any).raw])))
  ), [urlSpecDialog?.rows]);

  const urlSpecColumns = useMemo<ColumnsType<MappingSpecRow>>(() => [
    {
      title: "图片",
      dataIndex: "imageUrl",
      width: 72,
      render: (_value: string | null | undefined, row) => {
        const rowImageUrl = imageValue([row.imageUrl, (row as any).raw]);
        const imageUrl = rowImageUrl || (hasUrlSpecRowImages ? "" : imageValue(urlSpecDialog?.detail.imageUrl));
        return imageUrl ? (
          <div onClick={(event) => event.stopPropagation()}>
            <Image
              src={imageUrl}
              width={44}
              height={44}
              style={{ objectFit: "cover", borderRadius: 6, display: "block" }}
              preview={{ mask: false }}
            />
          </div>
        ) : <Text type="secondary">无图</Text>;
      },
    },
    {
      title: "规格",
      dataIndex: "specText",
      render: (value: string | null | undefined, row) => value || row.externalSpecId,
    },
    {
      title: "SKU ID",
      dataIndex: "externalSkuId",
      width: 150,
      render: (value: string | null | undefined) => value || "-",
    },
    {
      title: "Spec ID",
      dataIndex: "externalSpecId",
      width: 150,
    },
    {
      title: "价格",
      dataIndex: "price",
      width: 110,
      render: (value: number | null | undefined) => value === null || value === undefined ? "-" : `¥${Number(value).toFixed(2)}`,
    },
    {
      title: "库存",
      dataIndex: "stock",
      width: 100,
      render: (value: number | null | undefined) => value === null || value === undefined ? "-" : Number(value).toLocaleString("zh-CN"),
    },
  ], [hasUrlSpecRowImages, urlSpecDialog?.detail.imageUrl]);

  const openCreateForSku = useCallback((row: Sku1688SourceRow) => {
    setEditingRow(null);
    setPendingUrlSpecs([]);
    setSelectedUrlSpecIds([]);
    setUrlSpecSearchText("");
    setUrlSpecQtyBySpecId({});
    form.resetFields();
    form.setFieldsValue({
      skuId: row.skuId,
      accountId: row.accountId || undefined,
      status: "active",
      isDefault: true,
      imageUrl: imageValue([row.imageUrl, row.skuImageUrl]),
      ourQty: row.ourQty || 1,
      platformQty: row.platformQty || 1,
      moq: row.moq || 1,
    });
    setModalOpen(true);
  }, [form]);

  const openEdit = (row: Sku1688SourceRow) => {
    setEditingRow(row);
    setPendingUrlSpecs([]);
    setSelectedUrlSpecIds(row.externalSpecId ? [row.externalSpecId] : []);
    setUrlSpecSearchText("");
    setUrlSpecQtyBySpecId(row.externalSpecId ? { [row.externalSpecId]: toPositiveInteger(row.platformQty, 1) } : {});
    form.resetFields();
    form.setFieldsValue({
      skuId: row.skuId,
      accountId: row.accountId || undefined,
      mappingGroupId: row.mappingGroupId || "",
      externalOfferId: row.externalOfferId || "",
      externalSkuId: row.externalSkuId || "",
      externalSpecId: row.externalSpecId || "",
      platformSkuName: row.platformSkuName || "",
      supplierName: row.supplierName || "",
      productTitle: row.productTitle || "",
      productUrl: row.productUrl || build1688Link(row),
      imageUrl: row.imageUrl || "",
      unitPrice: row.unitPrice ?? undefined,
      moq: row.moq ?? 1,
      ourQty: row.ourQty || 1,
      platformQty: row.platformQty || 1,
      status: row.status || "active",
      isDefault: Boolean(row.isDefault),
    });
    setModalOpen(true);
  };

  const handleMappingFormValuesChange = useCallback((changedValues: Partial<MappingFormValues>) => {
    if (!Object.prototype.hasOwnProperty.call(changedValues, "productUrl")) return;
    setPendingUrlSpecs([]);
    setSelectedUrlSpecIds([]);
    setUrlSpecSearchText("");
    setUrlSpecQtyBySpecId({});
    const externalOfferId = extract1688OfferId(changedValues.productUrl);
    if (!externalOfferId) return;
    const currentOfferId = form.getFieldValue("externalOfferId");
    form.setFieldsValue({
      externalOfferId,
      ...(currentOfferId && currentOfferId !== externalOfferId
        ? { externalSkuId: undefined, externalSpecId: undefined, platformSkuName: undefined }
        : {}),
    });
  }, [form]);

  const previewSpecsFromUrl = useCallback(async () => {
    if (!erp) return;
    const values = form.getFieldsValue() as MappingFormValues;
    const productUrl = String(values.productUrl || "").trim();
    const externalOfferId = values.externalOfferId || extract1688OfferId(productUrl);
    if (!values.skuId) {
      message.warning("请先选择商品编码");
      return;
    }
    if (!externalOfferId) {
      message.warning("请先填写可识别商品号的 1688 地址");
      return;
    }
    const accountId = String(values.accountId || "").trim();
    if (!accountId) {
      message.error("这个商品编码还没有匹配店铺，请先到采购中心维护店铺");
      return;
    }

    setSpecPreviewLoading(true);
    try {
      const response = await erp.purchase.action({
        action: "preview_1688_url_specs",
        skuId: values.skuId,
        accountId,
        externalOfferId,
        productUrl: productUrl || build1688Link({ ...values, externalOfferId }),
        supplierName: values.supplierName,
        productTitle: values.productTitle,
        imageUrl: values.imageUrl,
        unitPrice: values.unitPrice,
        moq: values.moq,
        ...MAPPING_WORKBENCH_PARAMS,
      });
      const result = response?.result || {};
      const detail = (result.detail || {}) as UrlSpecDialogState["detail"];
      const rows = productDetailSpecRows(detail);
      if (!rows.length) {
        message.warning("这个 1688 地址没有解析到可绑定规格，请换一个地址或检查商品详情权限");
        return;
      }
      const nextOfferId = String(result.externalOfferId || externalOfferId);
      const nextProductUrl = String(result.productUrl || productUrl || build1688Link({ ...values, externalOfferId: nextOfferId }));
      form.setFieldsValue({
        externalOfferId: nextOfferId,
        productUrl: nextProductUrl,
        supplierName: values.supplierName || detail.supplierName || undefined,
        productTitle: values.productTitle || detail.productTitle || undefined,
        imageUrl: values.imageUrl || detail.imageUrl || undefined,
        unitPrice: values.unitPrice ?? detail.unitPrice ?? undefined,
        moq: values.moq ?? detail.moq ?? 1,
      });
      setUrlSpecDialog({
        externalOfferId: nextOfferId,
        productUrl: nextProductUrl,
        detail,
        rows,
      });
      setUrlSpecSearchText("");
      // 预选规格：表单里已有的 specId 必须真出现在本次解析的规格行里才复用（编辑场景）；
      // 否则——例如旧记录是被 offerId 顶替的假 specId、或这次解析退化成了整款行——
      // 落到第一行，避免出现「选中项不存在、点确认却报请先选择规格」。
      const presetSpecId = values.externalSpecId;
      const initialSpecIds = presetSpecId && rows.some((row) => specRowSelectId(row) === presetSpecId)
        ? [presetSpecId]
        : (rows[0] ? [specRowSelectId(rows[0])] : []);
      const initialPlatformQty = toPositiveInteger(values.platformQty, 1);
      setSelectedUrlSpecIds(initialSpecIds);
      setUrlSpecQtyBySpecId(Object.fromEntries(initialSpecIds.map((id) => [id, initialPlatformQty])));
      setPendingUrlSpecs([]);
      setUrlSpecOurQty(toPositiveInteger(values.ourQty, 1));
    } catch (error: any) {
      message.error(error?.message || "1688 地址规格解析失败");
    } finally {
      setSpecPreviewLoading(false);
    }
  }, [form]);

  const applySelectedUrlSpec = useCallback(() => {
    if (!urlSpecDialog) return;
    const selectedRows = urlSpecDialog.rows.filter((row) => selectedUrlSpecIds.includes(specRowSelectId(row)));
    if (!selectedRows.length) {
      message.warning("请先选择 1688 规格");
      return;
    }
    const selected = selectedRows[0];
    // 防御：不可信的 specId（缺失 / 与 skuId 同值）会被 1688 下单接口拒绝
    const invalidMissingSpec = selectedRows.find((row) => !row.isNoSpec && !row.externalSpecId);
    if (invalidMissingSpec) {
      message.error("这个 1688 规格没有可信的 specId，1688 下单时会被拒绝；请换一个规格或申请 1688 官方商品详情接口权限");
      return;
    }
    const invalidSameSkuSpec = selectedRows.find((row) => !row.isNoSpec && row.externalSkuId && row.externalSkuId === row.externalSpecId);
    if (invalidSameSkuSpec) {
      message.error("数据源未提供独立的 specId（与 skuId 同值），1688 下单会失败；建议手工下单或更换数据源");
      return;
    }
    const selectedRowsWithQty = selectedRows.map((row) => ({
      ...row,
      platformQty: toPositiveInteger(urlSpecQtyBySpecId[specRowSelectId(row)], 1),
    }));
    const values = form.getFieldsValue() as MappingFormValues;
    form.setFieldsValue({
      externalOfferId: urlSpecDialog.externalOfferId,
      productUrl: urlSpecDialog.productUrl,
      externalSkuId: selected.externalSkuId || undefined,
      externalSpecId: selected.externalSpecId,
      isNoSpec: selected.isNoSpec,
      platformSkuName: selected.specText || selected.externalSpecId || (selected.isNoSpec ? "整款（无规格）" : undefined),
      supplierName: values.supplierName || urlSpecDialog.detail.supplierName || undefined,
      productTitle: values.productTitle || urlSpecDialog.detail.productTitle || undefined,
      imageUrl: imageValue([selected.imageUrl, values.imageUrl, urlSpecDialog.detail.imageUrl]) || undefined,
      unitPrice: selected.price ?? values.unitPrice ?? urlSpecDialog.detail.unitPrice ?? undefined,
      moq: values.moq ?? urlSpecDialog.detail.moq ?? 1,
      ourQty: urlSpecOurQty,
      platformQty: selectedRowsWithQty[0]?.platformQty || 1,
    });
    setPendingUrlSpecs(selectedRowsWithQty);
    setUrlSpecDialog(null);
    setUrlSpecSearchText("");
    message.success(selectedRows.length > 1 ? `已选择 ${selectedRows.length} 个 1688 规格，保存后会一起绑定` : "1688 规格和映射比例已选择，保存后完成供应商绑定");
  }, [form, selectedUrlSpecIds, urlSpecDialog, urlSpecOurQty, urlSpecQtyBySpecId]);

  const handleSubmit = async (values: MappingFormValues) => {
    if (!erp) return;
    const accountId = String(values.accountId || "").trim();
    if (!accountId) {
      message.error("这个商品编码还没有匹配店铺，请先到采购中心维护店铺");
      return;
    }
    setSaving(true);
    try {
      const externalOfferId = values.externalOfferId || extract1688OfferId(values.productUrl);
      if (!externalOfferId) {
        message.error("请填写可识别商品号的 1688 地址");
        return;
      }
      if (!values.externalSpecId && !values.isNoSpec) {
        message.error("请先解析 1688 地址并选择要绑定的规格");
        return;
      }
      const productUrl = values.productUrl || build1688Link({ ...values, externalOfferId });
      const specsToSave: PendingMappingSpecRow[] = pendingUrlSpecs.length
        ? pendingUrlSpecs
        : [{
          key: values.externalSpecId || "__nospec__",
          externalSkuId: values.externalSkuId,
          externalSpecId: values.externalSpecId || "",
          isNoSpec: values.isNoSpec,
          specText: values.platformSkuName || values.externalSpecId || (values.isNoSpec ? "整款（无规格）" : ""),
          imageUrl: values.imageUrl,
          price: values.unitPrice ?? null,
          platformQty: toPositiveInteger(values.platformQty, 1),
        }];
      // 如果用户重新解析规格选了不同的 specId/skuId/offerId（编辑场景下），不复用旧 id：
      // 后端的 ON CONFLICT 只看 (account_id, sku_id, offerId, skuId, specId) 联合唯一键，
      // 联合 key 变化时不会触发 UPDATE，传旧 id 会撞主键 UNIQUE 约束（erp_sku_1688_sources.id）。
      const norm = (value: unknown) => String(value ?? "").trim();
      for (const [index, spec] of specsToSave.entries()) {
        const platformQty = toPositiveInteger(spec.platformQty ?? values.platformQty, 1);
        const editingMatchesNewKey = specsToSave.length === 1
          && !!editingRow
          && norm(editingRow.externalOfferId) === norm(externalOfferId)
          && norm(editingRow.externalSkuId) === norm(spec.externalSkuId)
          && norm(editingRow.externalSpecId) === norm(spec.externalSpecId);
        await erp.purchase.action({
          action: "upsert_sku_1688_source",
          id: editingMatchesNewKey ? editingRow?.id : undefined,
          skuId: values.skuId,
          accountId,
          mappingGroupId: values.mappingGroupId,
          externalOfferId,
          externalSkuId: spec.externalSkuId || undefined,
          externalSpecId: spec.externalSpecId,
          isNoSpec: spec.isNoSpec,
          platformSkuName: spec.specText || spec.externalSpecId || (spec.isNoSpec ? "整款（无规格）" : undefined),
          supplierName: values.supplierName,
          productTitle: values.productTitle,
          productUrl,
          imageUrl: imageValue([spec.imageUrl, values.imageUrl]),
          unitPrice: spec.price ?? values.unitPrice,
          moq: values.moq,
          ourQty: toPositiveInteger(values.ourQty, 1),
          platformQty,
          status: values.status,
          isDefault: Boolean(values.isDefault) || index === 0,
          ...MAPPING_WORKBENCH_PARAMS,
          includeWorkbench: false,
        });
      }
      message.success(specsToSave.length > 1 ? `供应商信息已保存：${specsToSave.length} 个规格` : "供应商信息已保存");
      setModalOpen(false);
      setEditingRow(null);
      setPendingUrlSpecs([]);
      setSelectedUrlSpecIds([]);
      setUrlSpecQtyBySpecId({});
      form.resetFields();
      // 写走云端、读走本地 cache.db：保存后先等一次增量同步把刚写的行拉进缓存，
      // 否则随后读分页缓存会拿到旧值（如映射数量被打回 1、未绑定列表没及时移除）。
      if (erp.mapping?.sync) {
        await erp.mapping.sync({ mode: "incremental" }).catch(() => {});
      }
      await reloadBothPages();
    } catch (error: any) {
      message.error(error?.message || "供应商信息保存失败");
    } finally {
      setSaving(false);
    }
  };

  const run1688SourceAction = useCallback(async (
    row: Sku1688SourceRow,
    action: string,
    successText: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (!erp) return null;
    const key = `${action}-${row.id}`;
    setActionLoadingId(key);
    try {
      const response = await erp.purchase.action({
        action,
        sourceId: row.id,
        accountId: row.accountId,
        externalOfferId: row.externalOfferId,
        productId: row.externalOfferId,
        externalSkuId: row.externalSkuId,
        externalSpecId: row.externalSpecId,
        keyword: row.productTitle || row.productName || row.externalOfferId,
        imageUrl: row.imageUrl,
        ...extra,
        ...MAPPING_WORKBENCH_PARAMS,
        includeWorkbench: false,
      });
      message.success(successText);
      await reloadCurrentPage();
      return response;
    } catch (error: any) {
      message.error(error?.message || "1688 操作失败");
      return null;
    } finally {
      setActionLoadingId(null);
    }
  }, [reloadCurrentPage]);

  const deleteMapping = useCallback((row: Sku1688SourceRow) => {
    if (!erp) return;
    Modal.confirm({
      title: "删除供应商绑定",
      content: "删除后这条 1688 规格绑定会从供应商管理移除；已生成的采购单和 1688 订单不会删除。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const key = `delete_sku_1688_source-${row.id}`;
        setActionLoadingId(key);
        try {
          await erp.purchase.action({
            action: "delete_sku_1688_source",
            sourceId: row.id,
            ...MAPPING_WORKBENCH_PARAMS,
            includeWorkbench: false,
          });
          message.success("供应商绑定已删除");
          await reloadBothPages();
        } catch (error: any) {
          message.error(error?.message || "供应商绑定删除失败");
        } finally {
          setActionLoadingId(null);
        }
      },
    });
  }, [reloadCurrentPage]);


  const searchRelationSuppliers = useCallback(async () => {
    if (!erp) return;
    setActionLoadingId("search_1688_relation_suppliers");
    try {
      const response = await erp.purchase.action({
        action: "search_1688_relation_suppliers",
        pageSize: 20,
        ...MAPPING_WORKBENCH_PARAMS,
        includeWorkbench: false,
      });
      const suppliers = Array.isArray(response?.result?.suppliers) ? response.result.suppliers : [];
      Modal.info({
        title: "1688 推荐供应商",
        width: 680,
        content: (
          <Space direction="vertical" size={6}>
            {suppliers.length ? suppliers.slice(0, 12).map((supplier: any, index: number) => (
              <Text key={`${supplier.memberId || supplier.loginId || index}`}>
                {supplier.companyName || supplier.shopName || supplier.loginId || supplier.memberId || "-"}
              </Text>
            )) : <Text>已调用接口，暂无可展示供应商</Text>}
          </Space>
        ),
      });
    } catch (error: any) {
      message.error(error?.message || "1688 推荐供应商查询失败");
    } finally {
      setActionLoadingId(null);
    }
  }, []);

  const queryMonitorProducts = useCallback(async () => {
    if (!erp) return;
    setActionLoadingId("query_1688_monitor_products");
    try {
      const response = await erp.purchase.action({
        action: "query_1688_monitor_products",
        pageSize: 50,
        ...MAPPING_WORKBENCH_PARAMS,
        includeWorkbench: false,
      });
      const products = Array.isArray(response?.result?.products) ? response.result.products : [];
      Modal.info({
        title: "1688 监控商品",
        width: 720,
        content: (
          <Space direction="vertical" size={6}>
            {products.length ? products.slice(0, 12).map((product: any, index: number) => (
              <Text key={`${product.externalOfferId || index}`}>
                {product.productTitle || product.externalOfferId || "-"}
              </Text>
            )) : <Text>已调用接口，暂无可展示监控商品</Text>}
          </Space>
        ),
      });
    } catch (error: any) {
      message.error(error?.message || "1688 监控商品查询失败");
    } finally {
      setActionLoadingId(null);
    }
  }, []);

  const columns = useMemo<ColumnsType<Sku1688SourceRow>>(() => [
    {
      title: "商品编码",
      key: "sku",
      width: 170,
      fixed: "left",
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.internalSkuCode || row.skuId}</Text>
        </Space>
      ),
    },
    {
      title: "商品图片",
      key: "productImage",
      width: 100,
      align: "center",
      render: (_value, row) => {
        const src = row.imageUrl || row.skuImageUrl;
        return src ? (
          <Image
            src={src}
            width={72}
            height={72}
            style={{ objectFit: "cover", borderRadius: 6 }}
          />
        ) : (
          <Text type="secondary">-</Text>
        );
      },
    },
    {
      title: "商品名称",
      key: "productName",
      width: 220,
      render: (_value, row) => (
        <Text strong ellipsis style={{ maxWidth: 200 }}>
          {row.productTitle || row.productName || "-"}
        </Text>
      ),
    },
    {
      title: "颜色规格",
      key: "colorSpec",
      width: 160,
      render: (_value, row) => row.colorSpec || "-",
    },
    {
      title: "系统供应商",
      key: "systemSupplier",
      width: 150,
      render: (_value, row) => row.systemSupplierName || "-",
    },
    {
      title: "是否默认供应商",
      key: "defaultSupplier",
      width: 130,
      render: (_value, row) => (row.isDefault ? "是" : "否"),
    },
    {
      title: "基础数量",
      dataIndex: "ourQty",
      width: 100,
      render: (value) => value || 1,
    },
    {
      title: "映射数量",
      dataIndex: "platformQty",
      width: 100,
      render: (value) => value || 1,
    },
    {
      title: "1688单品货号",
      key: "externalSku",
      width: 150,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.externalSkuId || row.externalSpecId || "-"}</Text>
          {row.externalSpecId && row.externalSpecId !== row.externalSkuId ? (
            <Text type="secondary" style={{ fontSize: 12 }}>{row.externalSpecId}</Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "1688供应商旺旺名称",
      key: "supplier",
      width: 240,
      render: (_value, row) => {
        if (isSkuPlaceholderRow(row)) {
          return <Text>{row.supplierName || "-"}</Text>;
        }
        const ruleState = getPurchaseRuleState(row);
        return (
          <Space direction="vertical" size={4}>
            <Text>{row.supplierName || "-"}</Text>
            <Tooltip title={ruleState.tooltip}>
              <Tag color={ruleState.color} style={{ marginInlineEnd: 0 }}>
                {ruleState.label}
              </Tag>
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: "1688地址",
      key: "offerUrl",
      width: 230,
      ellipsis: true,
      render: (_value, row) => {
        const offerUrl = build1688Link(row);
        return offerUrl ? (
          <Tooltip title={offerUrl}>
            <a
              href={offerUrl}
              onClick={(event) => {
                event.preventDefault();
                void openExternalUrl(offerUrl);
              }}
              style={{
                alignItems: "center",
                display: "inline-flex",
                gap: 4,
                maxWidth: 206,
                overflow: "hidden",
                verticalAlign: "middle",
              }}
            >
              <LinkOutlined style={{ flex: "0 0 auto" }} />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {offerUrl}
              </span>
            </a>
          </Tooltip>
        ) : "-";
      },
    },
    {
      title: "查看线上",
      key: "online",
      width: 100,
      render: (_value, row) => (
        build1688Link(row) ? (
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => void openExternalUrl(build1688Link(row))}>
            查看线上
          </Button>
        ) : "-"
      ),
    },
    {
      title: "状态",
      key: "mappingStatus",
      width: 100,
      render: (_value, row) => {
        const state = mappingStatus(row);
        return <Tag color={state.color}>{state.label}</Tag>;
      },
    },
    {
      title: "1688规格描述",
      key: "platformSku",
      width: 220,
      render: (_value, row) => row.platformSkuName || "-",
    },
    {
      title: "1688商品起批数量",
      key: "moq",
      width: 140,
      render: (_value, row) => row.moq || 1,
    },
    {
      title: "1688商品规格ID",
      key: "externalSpecId",
      width: 150,
      render: (_value, row) => row.externalSpecId || "-",
    },
    {
      title: "店铺",
      key: "brand",
      width: 100,
      render: (_value, row) => row.accountName || "-",
    },
    {
      title: "修改时间",
      dataIndex: "updatedAt",
      width: 150,
      render: formatDateTime,
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      width: 150,
      render: formatDateTime,
    },
    {
      title: "操作",
      key: "actions",
      width: 170,
      fixed: "right",
      render: (_value, row) => {
        const monitorEnabled = Boolean(row.sourcePayload?.monitorProduct?.enabled);
        const followEnabled = Boolean(row.sourcePayload?.followedAt1688);
        if (isSkuPlaceholderRow(row)) {
          return editable ? (
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              style={supplierActionButtonStyle}
              onClick={() => openCreateForSku(row)}
            >
              绑定
            </Button>
          ) : <Text type="secondary">-</Text>;
        }
        return (
          <div style={supplierActionGridStyle}>
            {editable ? (
              <Button
                size="small"
                icon={<EditOutlined />}
                style={supplierActionButtonStyle}
                onClick={() => openEdit(row)}
              >
                编辑
              </Button>
            ) : null}
            <Tooltip title="搜索更多可用货源">
              <Button
                size="small"
                icon={<SearchOutlined />}
                loading={actionLoadingId === `run_1688_deep_search_agent-${row.id}`}
                style={supplierActionButtonStyle}
                onClick={() => void run1688SourceAction(row, "run_1688_deep_search_agent", "找货已开始")}
              >
                找货
              </Button>
            </Tooltip>
            <Tooltip title={monitorEnabled ? "取消商品监控" : "加入商品监控"}>
              <Button
                size="small"
                icon={<BellOutlined />}
                loading={actionLoadingId === `${monitorEnabled ? "delete_1688_monitor_product" : "add_1688_monitor_product"}-${row.id}`}
                style={supplierActionButtonStyle}
                onClick={() => void run1688SourceAction(
                  row,
                  monitorEnabled ? "delete_1688_monitor_product" : "add_1688_monitor_product",
                  monitorEnabled ? "已取消监控" : "已加入监控",
                )}
              >
                {monitorEnabled ? "取消" : "监控"}
              </Button>
            </Tooltip>
            <Tooltip title={followEnabled ? "取消关注商品" : "关注商品"}>
              <Button
                size="small"
                icon={<StarOutlined />}
                loading={actionLoadingId === `${followEnabled ? "unfollow_1688_product" : "follow_1688_product"}-${row.id}`}
                style={supplierActionButtonStyle}
                onClick={() => void run1688SourceAction(
                  row,
                  followEnabled ? "unfollow_1688_product" : "follow_1688_product",
                  followEnabled ? "已取消关注" : "已关注",
                )}
              >
                {followEnabled ? "取关" : "关注"}
              </Button>
            </Tooltip>
            {editable ? (
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                loading={actionLoadingId === `delete_sku_1688_source-${row.id}`}
                style={supplierActionButtonStyle}
                onClick={() => deleteMapping(row)}
              >
                删除
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ], [actionLoadingId, deleteMapping, editable, openCreateForSku, run1688SourceAction]);

  const currentLoading = activeTab === "bound" ? boundLoading : activeTab === "unbound" ? unboundLoading : false;
  const searchPlaceholder = "搜索商品编码 / 商品名称 / 规格 / 供应商 / 1688货号";

  const renderPagedTable = (
    rows: Sku1688SourceRow[],
    total: number,
    page: number,
    loading: boolean,
    search: string,
    setSearch: (value: string) => void,
    setPage: (value: number) => void,
  ) => (
    <>
      <div style={{ alignItems: "center", display: "flex", gap: 12, justifyContent: "space-between", marginBottom: 12 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ maxWidth: "100%", width: 460 }}
        />
        <Text type="secondary" style={{ flex: "0 0 auto" }}>
          共 {total} 条
        </Text>
      </div>
      <Table
        className="alibaba-mapping-table alibaba-mapping-table--fixed-bottom"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 2380, y: "max(220px, calc(100vh - 470px))" }}
        pagination={{
          current: page,
          pageSize: ALIBABA_MAPPING_PAGE_SIZE,
          total,
          showSizeChanger: false,
          showTotal: (nextTotal, range) => `显示 ${range[0]}-${range[1]} / ${nextTotal} 条`,
          onChange: (nextPage) => setPage(nextPage),
        }}
      />
    </>
  );

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="业务" title="供应商管理" />
        <Alert type="error" showIcon message="ERP 服务未就绪，请重启软件" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="业务"
        title="供应商管理"
        meta={activeTab === "profiles"
          ? ["供应商档案", "主数据 / 结算 / 采购关系"]
          : [`已绑定 ${boundTotal}`, `未绑定 ${unboundTotal}`]}
        actions={activeTab === "profiles" ? [] : [
          <Button
            key="relation-supply"
            icon={<SearchOutlined />}
            loading={actionLoadingId === "search_1688_relation_suppliers"}
            onClick={searchRelationSuppliers}
          >
            推荐供应商
          </Button>,
          <Button
            key="monitor-list"
            icon={<SearchOutlined />}
            loading={actionLoadingId === "query_1688_monitor_products"}
            onClick={queryMonitorProducts}
          >
            监控列表
          </Button>,
          <Button key="refresh" icon={<ReloadOutlined />} loading={currentLoading} onClick={() => void reloadCurrentPage()}>
            刷新
          </Button>,
        ].filter(Boolean)}
      />

      <section className="content-card alibaba-mapping-panel alibaba-mapping-panel--fixed-bottom">
        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            const nextTab = key as MappingTabKey;
            if (nextTab === "profiles" && !supplierProfilesVisible) return;
            setActiveTab(nextTab);
          }}
          items={[
            ...(supplierProfilesVisible ? [{
              key: "profiles" as const,
              label: "供应商档案",
              children: <ProductMasterData mode="suppliers" embedded />,
            }] : []),
            {
              key: "bound",
              label: "已绑定",
              children: renderPagedTable(boundRows, boundTotal, boundPage, boundLoading, boundSearch, setBoundSearch, setBoundPage),
            },
            {
              key: "unbound",
              label: "未绑定",
              children: renderPagedTable(unboundRows, unboundTotal, unboundPage, unboundLoading, unboundSearch, setUnboundSearch, setUnboundPage),
            },
          ]}
        />
      </section>

      <Modal
        open={modalOpen}
        title={editingRow ? "编辑供应商" : "新增供应商"}
        okText="保存"
        cancelText="取消"
        centered
        width={860}
        confirmLoading={saving}
        onOk={() => form.submit()}
        onCancel={() => {
          setModalOpen(false);
          setEditingRow(null);
          setPendingUrlSpecs([]);
          setSelectedUrlSpecIds([]);
          setUrlSpecQtyBySpecId({});
        }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} onValuesChange={handleMappingFormValuesChange}>
          <Row gutter={12}>
            <Col span={24}>
              <Form.Item label="1688 地址" required>
                <Space.Compact style={{ width: "100%" }}>
                  <Form.Item name="productUrl" noStyle rules={[{ required: true, message: "请输入 1688 地址" }]}>
                    <Input placeholder="https://detail.1688.com/offer/1234567890.html" />
                  </Form.Item>
                  <Button
                    icon={<SearchOutlined />}
                    loading={specPreviewLoading}
                    onClick={() => void previewSpecsFromUrl()}
                  >
                    解析规格
                  </Button>
                </Space.Compact>
              </Form.Item>
            </Col>
          </Row>
          {supplierNameWatched ? (
            <Form.Item label="1688 供应商旺旺名">
              <Text strong>{supplierNameWatched}</Text>
            </Form.Item>
          ) : null}
          <Row gutter={12}>
            <Col span={24}>
              <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                下单时按「本地 : 1688」比例换算采购数量（如本地 1 件 = 1688 2 件，需采购 10 件则下单 20 件）
              </Text>
            </Col>
            <Col span={12}>
              <Form.Item name="ourQty" label="本地数量" rules={[{ required: true, message: "请输入本地数量" }]}>
                <InputNumber min={1} precision={0} style={{ width: "100%" }} addonBefore="本地" addonAfter="件" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="platformQty" label="1688 数量" rules={[{ required: true, message: "请输入 1688 数量" }]}>
                <InputNumber min={1} precision={0} style={{ width: "100%" }} addonBefore="1688" addonAfter="件" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="skuId" hidden><Input /></Form.Item>
          <Form.Item name="accountId" hidden><Input /></Form.Item>
          <Form.Item name="mappingGroupId" hidden><Input /></Form.Item>
          <Form.Item name="externalOfferId" hidden><Input /></Form.Item>
          <Form.Item name="externalSkuId" hidden><Input /></Form.Item>
          <Form.Item name="externalSpecId" hidden><Input /></Form.Item>
          <Form.Item name="platformSkuName" hidden><Input /></Form.Item>
          <Form.Item name="supplierName" hidden><Input /></Form.Item>
          <Form.Item name="productTitle" hidden><Input /></Form.Item>
          <Form.Item name="imageUrl" hidden><Input /></Form.Item>
          <Form.Item name="unitPrice" hidden><InputNumber /></Form.Item>
          <Form.Item name="moq" hidden><InputNumber /></Form.Item>
          <Form.Item name="status" hidden><Input /></Form.Item>
          <Form.Item name="isDefault" hidden valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(urlSpecDialog)}
        title="选择 1688 规格和映射比例"
        okText="确认选择"
        cancelText="取消"
        width={980}
        centered
        okButtonProps={{ disabled: selectedUrlSpecIds.length === 0 }}
        onCancel={() => {
          setUrlSpecDialog(null);
          setUrlSpecSearchText("");
        }}
        onOk={applySelectedUrlSpec}
        destroyOnClose
      >
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          {urlSpecDialog?.detail?.supplierName ? (
            <div style={{ padding: "8px 12px", background: "#f5f7fa", borderRadius: 4 }}>
              <Text type="secondary">1688 供应商旺旺名: </Text>
              <Text strong>{urlSpecDialog.detail.supplierName}</Text>
            </div>
          ) : null}
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索规格 / SKU ID / Spec ID"
            value={urlSpecSearchText}
            onChange={(event) => setUrlSpecSearchText(event.target.value)}
          />
          <Table<MappingSpecRow>
            size="small"
            rowKey={(row) => specRowSelectId(row)}
            columns={urlSpecColumns}
            dataSource={filteredUrlSpecRows}
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            locale={{ emptyText: urlSpecSearchText.trim() ? "没有匹配的 1688 规格" : "暂无可绑定规格" }}
            rowSelection={{
              type: "checkbox",
              selectedRowKeys: selectedUrlSpecIds,
              onChange: (keys) => updateSelectedUrlSpecIds(keys.map((key) => String(key))),
            }}
            onRow={(row) => ({
              onClick: () => updateSelectedUrlSpecIds(
                selectedUrlSpecIds.includes(specRowSelectId(row))
                  ? selectedUrlSpecIds.filter((id) => id !== specRowSelectId(row))
                  : [...selectedUrlSpecIds, specRowSelectId(row)],
              ),
            })}
          />
          <Row gutter={12}>
            <Col span={12}>
              <Text type="secondary" style={{ display: "block", marginBottom: 6 }}>本地数量</Text>
              <InputNumber
                min={1}
                precision={0}
                value={urlSpecOurQty}
                style={{ width: "100%" }}
                addonBefore="本地"
                addonAfter="件"
                onChange={(value) => setUrlSpecOurQty(toPositiveInteger(value, 1))}
              />
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ display: "block", marginBottom: 6 }}>1688 组合数量</Text>
              <div
                style={{
                  border: "1px solid #d9d9d9",
                  borderRadius: 6,
                  minHeight: 40,
                  overflow: "hidden",
                  background: "#fff",
                }}
              >
                {selectedUrlSpecs.length ? selectedUrlSpecs.map((row, index) => (
                  <div
                    key={row.key}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) 104px",
                      gap: 8,
                      alignItems: "center",
                      padding: "8px 10px",
                      borderTop: index === 0 ? undefined : "1px solid #f0f0f0",
                      background: "#fff7ed",
                    }}
                  >
                    <Text
                      ellipsis={{ tooltip: row.specText || row.externalSpecId }}
                      style={{ minWidth: 0 }}
                    >
                      {row.specText || row.externalSpecId}
                    </Text>
                    <InputNumber
                      min={1}
                      precision={0}
                      value={toPositiveInteger(urlSpecQtyBySpecId[specRowSelectId(row)], 1)}
                      style={{ width: "100%" }}
                      addonAfter="件"
                      onChange={(value) => setUrlSpecQtyBySpecId((previous) => ({
                        ...previous,
                        [specRowSelectId(row)]: toPositiveInteger(value, 1),
                      }))}
                    />
                  </div>
                )) : (
                  <div style={{ padding: "9px 10px" }}>
                    <Text type="secondary">未选择</Text>
                  </div>
                )}
              </div>
            </Col>
          </Row>
        </Space>
      </Modal>
    </div>
  );
}
