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
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { BellOutlined, DeleteOutlined, EditOutlined, LinkOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, StarOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { hasPageCache, readPageCache, writePageCache } from "../utils/pageCache";

const { Text } = Typography;
const erp = window.electronAPI?.erp;
const appAPI = window.electronAPI?.app;
const ALIBABA_MAPPING_CACHE_KEY = "temu.alibaba-mapping.cache.v1";
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

interface AlibabaMappingCache {
  generatedAt?: string;
  skus?: SkuOptionRow[];
  mappings?: Sku1688SourceRow[];
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
  mappingGroupId?: string;
  externalOfferId?: string;
  externalSkuId?: string;
  externalSpecId?: string;
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
  specText?: string | null;
  price?: number | null;
  stock?: number | null;
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

function canManage(role?: string | null) {
  return Boolean(role && ["admin", "manager", "buyer"].includes(role));
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

function mergeSkuAndMappingRows(skus: SkuOptionRow[], mappings: Sku1688SourceRow[]) {
  const skusById = new Map(skus.map((sku) => [sku.id, sku]));
  const rows: Sku1688SourceRow[] = mappings.map((row): Sku1688SourceRow => {
    const sku = skusById.get(row.skuId);
    return {
      ...row,
      accountId: row.accountId || sku?.accountId || null,
      accountName: row.accountName || sku?.accountName || null,
      internalSkuCode: row.internalSkuCode || sku?.internalSkuCode,
      productName: row.productName || sku?.productName,
      colorSpec: row.colorSpec ?? sku?.colorSpec ?? null,
      systemSupplierName: row.systemSupplierName || sku?.systemSupplierName || null,
      imageUrl: row.imageUrl || sku?.imageUrl || null,
      isSkuPlaceholder: false,
    };
  });
  const mappedSkuIds = new Set(rows.map((row) => row.skuId));
  for (const sku of skus) {
    if (!mappedSkuIds.has(sku.id)) {
      rows.push(buildSkuDisplayRow(sku));
    }
  }
  return rows;
}

function normalizeSearchText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function getRowSearchText(row: Sku1688SourceRow) {
  return [
    row.internalSkuCode,
    row.skuId,
    row.productName,
    row.productTitle,
    row.colorSpec,
    row.systemSupplierName,
    row.supplierName,
    row.platformSkuName,
    row.externalOfferId,
    row.externalSkuId,
    row.externalSpecId,
    row.accountName,
    row.isSkuPlaceholder ? "未绑定 未匹配 无1688供应商" : "",
  ].map((value) => String(value ?? "")).join(" ").toLowerCase();
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

function productDetailSpecRows(detail?: UrlSpecDialogState["detail"] | null): MappingSpecRow[] {
  const options = Array.isArray(detail?.skuOptions) ? detail.skuOptions : [];
  return options
    .filter((item) => item?.externalSpecId || item?.externalSkuId)
    .map((item, index) => {
      const externalSpecId = String(item.externalSpecId || item.externalSkuId || "");
      return {
        key: `${externalSpecId}:${item.externalSkuId || ""}:${index}`,
        externalSkuId: item.externalSkuId || externalSpecId,
        externalSpecId,
        specText: item.specText || externalSpecId,
        price: item.price ?? null,
        stock: item.stock ?? null,
      };
    });
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

export default function AlibabaMapping() {
  const auth = useErpAuth();
  const editable = canManage(auth.currentUser?.role);
  const cachedData = useMemo(
    () => readPageCache<AlibabaMappingCache>(ALIBABA_MAPPING_CACHE_KEY, {}),
    [],
  );
  const [form] = Form.useForm<MappingFormValues>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<Sku1688SourceRow | null>(null);
  const [skus, setSkus] = useState<SkuOptionRow[]>(() => cachedData.skus || []);
  const [mappings, setMappings] = useState<Sku1688SourceRow[]>(() => cachedData.mappings || []);
  const [loadedOnce, setLoadedOnce] = useState(() => hasPageCache(cachedData));
  const [searchText, setSearchText] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [specPreviewLoading, setSpecPreviewLoading] = useState(false);
  const [urlSpecDialog, setUrlSpecDialog] = useState<UrlSpecDialogState | null>(null);
  const [selectedUrlSpecId, setSelectedUrlSpecId] = useState<string | null>(null);
  const [urlSpecOurQty, setUrlSpecOurQty] = useState(1);
  const [urlSpecPlatformQty, setUrlSpecPlatformQty] = useState(1);
  const autoPurchaseRuleIdsRef = useRef<Set<string>>(new Set());
  const autoSupplierProfileIdsRef = useRef<Set<string>>(new Set());

  const applyMappingRows = useCallback((nextSkus: SkuOptionRow[], nextMappings: Sku1688SourceRow[]) => {
    setSkus(nextSkus);
    setMappings(nextMappings);
    setLoadedOnce(true);
    writePageCache<AlibabaMappingCache>(ALIBABA_MAPPING_CACHE_KEY, {
      generatedAt: new Date().toISOString(),
      skus: nextSkus,
      mappings: nextMappings,
    });
  }, []);

  const applyMappingSources = useCallback((nextMappings: Sku1688SourceRow[]) => {
    setMappings(nextMappings);
    setLoadedOnce(true);
    writePageCache<AlibabaMappingCache>(ALIBABA_MAPPING_CACHE_KEY, {
      generatedAt: new Date().toISOString(),
      skus,
      mappings: nextMappings,
    });
  }, [skus]);

  const updateMappingSources = useCallback((updater: (rows: Sku1688SourceRow[]) => Sku1688SourceRow[]) => {
    setMappings((current) => {
      const nextMappings = updater(current);
      setLoadedOnce(true);
      writePageCache<AlibabaMappingCache>(ALIBABA_MAPPING_CACHE_KEY, {
        generatedAt: new Date().toISOString(),
        skus,
        mappings: nextMappings,
      });
      return nextMappings;
    });
  }, [skus]);

  const loadData = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const workbench = await erp.purchase.workbench(MAPPING_WORKBENCH_PARAMS);
      applyMappingRows(
        Array.isArray(workbench?.skuOptions) ? workbench.skuOptions : [],
        Array.isArray(workbench?.sku1688Sources) ? workbench.sku1688Sources : [],
      );
    } catch (error: any) {
      message.error(error?.message || "供应商管理读取失败");
    } finally {
      setLoading(false);
    }
  }, [applyMappingRows]);

  useEffect(() => {
    void loadData();
  }, [loadData, updateMappingSources]);

  useEffect(() => {
    if (!erp || !editable) return;
    const targets = mappings
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
      }).then((response: any) => {
        if (cancelled) return;
        if (Array.isArray(response?.workbench?.sku1688Sources)) {
          applyMappingSources(response.workbench.sku1688Sources);
        }
      }).catch(() => {
        // The row is marked failed by the backend; keep the page quiet.
      }).finally(() => {
        autoPurchaseRuleIdsRef.current.delete(row.id);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [applyMappingSources, editable, mappings]);

  useEffect(() => {
    if (!erp || !editable) return;
    const targets = mappings
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
      }).then((response: any) => {
        if (cancelled) return;
        if (Array.isArray(response?.workbench?.sku1688Sources)) {
          applyMappingSources(response.workbench.sku1688Sources);
        }
      }).catch(() => {
        // The backend records failed attempts; avoid interrupting table work.
      }).finally(() => {
        autoSupplierProfileIdsRef.current.delete(row.id);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [applyMappingSources, editable, mappings]);

  const allDisplayRows = useMemo(
    () => mergeSkuAndMappingRows(skus, mappings),
    [skus, mappings],
  );

  const displayRows = useMemo(() => {
    const needle = normalizeSearchText(searchText);
    if (!needle) return allDisplayRows;
    return allDisplayRows.filter((row) => getRowSearchText(row).includes(needle));
  }, [allDisplayRows, searchText]);

  const urlSpecColumns = useMemo<ColumnsType<MappingSpecRow>>(() => [
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
  ], []);

  const openCreateForSku = useCallback((row: Sku1688SourceRow) => {
    setEditingRow(null);
    form.resetFields();
    form.setFieldsValue({
      skuId: row.skuId,
      status: "active",
      isDefault: true,
      ourQty: row.ourQty || 1,
      platformQty: row.platformQty || 1,
      moq: row.moq || 1,
    });
    setModalOpen(true);
  }, [form]);

  const openEdit = (row: Sku1688SourceRow) => {
    setEditingRow(row);
    form.resetFields();
    form.setFieldsValue({
      skuId: row.skuId,
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
    const sku = skus.find((item) => item.id === values.skuId);
    if (!sku?.accountId) {
      message.error("这个商品编码还没有匹配店铺，请先到采购中心维护店铺");
      return;
    }

    setSpecPreviewLoading(true);
    try {
      const response = await erp.purchase.action({
        action: "preview_1688_url_specs",
        skuId: values.skuId,
        accountId: sku.accountId,
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
      setSelectedUrlSpecId(values.externalSpecId || rows[0]?.externalSpecId || null);
      setUrlSpecOurQty(Math.max(1, Math.floor(Number(values.ourQty || 1))));
      setUrlSpecPlatformQty(Math.max(1, Math.floor(Number(values.platformQty || 1))));
    } catch (error: any) {
      message.error(error?.message || "1688 地址规格解析失败");
    } finally {
      setSpecPreviewLoading(false);
    }
  }, [form, skus]);

  const applySelectedUrlSpec = useCallback(() => {
    if (!urlSpecDialog) return;
    const selected = urlSpecDialog.rows.find((row) => row.externalSpecId === selectedUrlSpecId);
    if (!selected) {
      message.warning("请先选择一个 1688 规格");
      return;
    }
    // 防御：不可信的 specId（缺失 / 与 skuId 同值）会被 1688 下单接口拒绝
    if (!selected.externalSpecId) {
      message.error("这个 1688 规格没有可信的 specId，1688 下单时会被拒绝；请换一个规格或申请 1688 官方商品详情接口权限");
      return;
    }
    if (selected.externalSkuId && selected.externalSkuId === selected.externalSpecId) {
      message.error("数据源未提供独立的 specId（与 skuId 同值），1688 下单会失败；建议手工下单或更换数据源");
      return;
    }
    const values = form.getFieldsValue() as MappingFormValues;
    form.setFieldsValue({
      externalOfferId: urlSpecDialog.externalOfferId,
      productUrl: urlSpecDialog.productUrl,
      externalSkuId: selected.externalSkuId || undefined,
      externalSpecId: selected.externalSpecId,
      platformSkuName: selected.specText || selected.externalSpecId,
      supplierName: values.supplierName || urlSpecDialog.detail.supplierName || undefined,
      productTitle: values.productTitle || urlSpecDialog.detail.productTitle || undefined,
      imageUrl: values.imageUrl || urlSpecDialog.detail.imageUrl || undefined,
      unitPrice: selected.price ?? values.unitPrice ?? urlSpecDialog.detail.unitPrice ?? undefined,
      moq: values.moq ?? urlSpecDialog.detail.moq ?? 1,
      ourQty: urlSpecOurQty,
      platformQty: urlSpecPlatformQty,
    });
    setUrlSpecDialog(null);
    message.success("1688 规格和映射比例已选择，保存后完成供应商绑定");
  }, [form, selectedUrlSpecId, urlSpecDialog, urlSpecOurQty, urlSpecPlatformQty]);

  const handleSubmit = async (values: MappingFormValues) => {
    if (!erp) return;
    const sku = skus.find((item) => item.id === values.skuId);
    if (!sku?.accountId) {
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
      if (!values.externalSpecId) {
        message.error("请先解析 1688 地址并选择要绑定的规格");
        return;
      }
      const productUrl = values.productUrl || build1688Link({ ...values, externalOfferId });
      // 如果用户重新解析规格选了不同的 specId/skuId/offerId（编辑场景下），不复用旧 id：
      // 后端的 ON CONFLICT 只看 (account_id, sku_id, offerId, skuId, specId) 联合唯一键，
      // 联合 key 变化时不会触发 UPDATE，传旧 id 会撞主键 UNIQUE 约束（erp_sku_1688_sources.id）。
      const norm = (value: unknown) => String(value ?? "").trim();
      const editingMatchesNewKey = !!editingRow
        && norm(editingRow.externalOfferId) === norm(externalOfferId)
        && norm(editingRow.externalSkuId) === norm(values.externalSkuId)
        && norm(editingRow.externalSpecId) === norm(values.externalSpecId);
      const response = await erp.purchase.action({
        action: "upsert_sku_1688_source",
        id: editingMatchesNewKey ? editingRow?.id : undefined,
        skuId: values.skuId,
        accountId: sku.accountId,
        mappingGroupId: values.mappingGroupId,
        externalOfferId,
        externalSkuId: values.externalSkuId,
        externalSpecId: values.externalSpecId,
        platformSkuName: values.platformSkuName,
        supplierName: values.supplierName,
        productTitle: values.productTitle,
        productUrl,
        imageUrl: values.imageUrl,
        unitPrice: values.unitPrice,
        moq: values.moq,
        ourQty: values.ourQty,
        platformQty: values.platformQty,
        status: values.status,
        isDefault: values.isDefault,
        ...MAPPING_WORKBENCH_PARAMS,
        includeWorkbench: false,
      });
      const savedSource = response?.result?.sku1688Source as Sku1688SourceRow | undefined;
      if (savedSource?.id) {
        updateMappingSources((rows) => {
          const exists = rows.some((item) => item.id === savedSource.id);
          return exists
            ? rows.map((item) => (item.id === savedSource.id ? { ...item, ...savedSource } : item))
            : [savedSource, ...rows];
        });
      }
      message.success("供应商信息已保存");
      setModalOpen(false);
      setEditingRow(null);
      form.resetFields();
      void loadData();
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
    const optimisticAction = [
      "follow_1688_product",
      "unfollow_1688_product",
      "add_1688_monitor_product",
      "delete_1688_monitor_product",
    ].includes(action);
    if (optimisticAction) {
      const now = new Date().toISOString();
      updateMappingSources((rows) => rows.map((item) => {
        if (item.id !== row.id) return item;
        const payload = { ...(item.sourcePayload || {}) };
        if (action === "follow_1688_product") {
          payload.followedAt1688 = now;
          payload.unfollowedAt1688 = null;
        } else if (action === "unfollow_1688_product") {
          payload.followedAt1688 = null;
          payload.unfollowedAt1688 = now;
        } else if (action === "add_1688_monitor_product") {
          payload.monitorProduct = { ...((payload.monitorProduct as Record<string, unknown>) || {}), enabled: true };
        } else if (action === "delete_1688_monitor_product") {
          payload.monitorProduct = { ...((payload.monitorProduct as Record<string, unknown>) || {}), enabled: false };
        }
        return { ...item, sourcePayload: payload, updatedAt: now };
      }));
    } else {
      setActionLoadingId(key);
    }
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
      if (response?.result?.sku1688Source) {
        const updatedSource = response.result.sku1688Source as Sku1688SourceRow;
        updateMappingSources((rows) => rows.map((item) => (item.id === row.id ? updatedSource : item)));
      } else if (Array.isArray(response?.workbench?.sku1688Sources)) {
        applyMappingSources(response.workbench.sku1688Sources);
      }
      message.success(successText);
      return response;
    } catch (error: any) {
      if (optimisticAction) {
        updateMappingSources((rows) => rows.map((item) => (item.id === row.id ? row : item)));
      }
      message.error(error?.message || "1688 操作失败");
      return null;
    } finally {
      setActionLoadingId(null);
    }
  }, [applyMappingSources, updateMappingSources]);

  const deleteMapping = useCallback((row: Sku1688SourceRow) => {
    if (!erp) return;
    Modal.confirm({
      title: "删除供应商绑定",
      content: "删除后这条 1688 规格绑定会从供应商管理移除；已生成的采购单和 1688 订单不会删除。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => {
        updateMappingSources((rows) => rows.filter((item) => item.id !== row.id));
        void erp.purchase.action({
          action: "delete_sku_1688_source",
          sourceId: row.id,
          ...MAPPING_WORKBENCH_PARAMS,
          includeWorkbench: false,
        }).then(() => {
          message.success("供应商绑定已删除");
        }).catch((error: any) => {
          updateMappingSources((rows) => rows.some((item) => item.id === row.id) ? rows : [row, ...rows]);
          message.error(error?.message || "供应商绑定删除失败");
        });
      },
    });
  }, [updateMappingSources]);


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
      title: "商品名称",
      key: "productName",
      width: 220,
      render: (_value, row) => (
        <Space size={10} align="start">
          {row.imageUrl ? <Image src={row.imageUrl} width={54} height={54} style={{ objectFit: "cover", borderRadius: 6 }} /> : null}
          <Space direction="vertical" size={2}>
            <Text strong ellipsis style={{ maxWidth: 150 }}>{row.productTitle || row.productName || "-"}</Text>
          </Space>
        </Space>
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

  const tableLoading = loading && !loadedOnce && displayRows.length > 0;

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
        meta={[`商品 ${skus.length}`, `供应商 ${mappings.length}`]}
        actions={[
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
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={loadData}>
            刷新
          </Button>,
        ].filter(Boolean)}
      />

      <section className="content-card alibaba-mapping-panel alibaba-mapping-panel--fixed-bottom">
        <div style={{ alignItems: "center", display: "flex", gap: 12, justifyContent: "space-between", marginBottom: 12 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索商品编码 / 商品名称 / 规格 / 供应商 / 1688货号"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            style={{ maxWidth: "100%", width: 460 }}
          />
          <Text type="secondary" style={{ flex: "0 0 auto" }}>
            显示 {displayRows.length} / {allDisplayRows.length} 条
          </Text>
        </div>
        <Table
          className="alibaba-mapping-table alibaba-mapping-table--fixed-bottom"
          rowKey="id"
          loading={tableLoading}
          columns={columns}
          dataSource={displayRows}
          scroll={{ x: 2380, y: "max(220px, calc(100vh - 430px))" }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
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
          <Form.Item name="skuId" hidden><Input /></Form.Item>
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
          <Form.Item name="ourQty" hidden><InputNumber /></Form.Item>
          <Form.Item name="platformQty" hidden><InputNumber /></Form.Item>
          <Form.Item name="status" hidden><Input /></Form.Item>
          <Form.Item name="isDefault" hidden valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(urlSpecDialog)}
        title="选择 1688 规格和映射比例"
        okText="确认选择"
        cancelText="取消"
        width={860}
        centered
        okButtonProps={{ disabled: !selectedUrlSpecId }}
        onCancel={() => setUrlSpecDialog(null)}
        onOk={applySelectedUrlSpec}
        destroyOnClose
      >
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Table<MappingSpecRow>
            size="small"
            rowKey="externalSpecId"
            columns={urlSpecColumns}
            dataSource={urlSpecDialog?.rows || []}
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            rowSelection={{
              type: "radio",
              selectedRowKeys: selectedUrlSpecId ? [selectedUrlSpecId] : [],
              onChange: (keys) => setSelectedUrlSpecId(String(keys[0] || "")),
            }}
            onRow={(row) => ({
              onClick: () => setSelectedUrlSpecId(row.externalSpecId),
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
                onChange={(value) => setUrlSpecOurQty(Math.max(1, Math.floor(Number(value || 1))))}
              />
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ display: "block", marginBottom: 6 }}>1688 数量</Text>
              <InputNumber
                min={1}
                precision={0}
                value={urlSpecPlatformQty}
                style={{ width: "100%" }}
                addonBefore="1688"
                addonAfter="件"
                onChange={(value) => setUrlSpecPlatformQty(Math.max(1, Math.floor(Number(value || 1))))}
              />
            </Col>
          </Row>
        </Space>
      </Modal>
    </div>
  );
}
