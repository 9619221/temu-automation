import { useCallback, useEffect, useMemo, useRef, useState, type Key } from "react";
import { Alert, Button, Col, Descriptions, Drawer, Form, Image, Input, InputNumber, Modal, Popconfirm, Progress, Row, Select, Space, Table, Tag, Tooltip, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, EditOutlined, LineChartOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { hasPageCache, readIndexedPageCache, readPageCache, writeIndexedPageCache, writePageCache } from "../utils/pageCache";

const erp = window.electronAPI?.erp;
const PRODUCT_MASTER_DATA_CACHE_KEY = "temu.product-master-data.cache.v2";
const PRODUCT_MASTER_DATA_SKUS_CACHE_KEY = `${PRODUCT_MASTER_DATA_CACHE_KEY}.skus`;
const ADDRESS_WORKBENCH_PARAMS = {
  limit: 20,
  includeRequestDetails: false,
  includeOptions: false,
  include1688Meta: true,
};
const SKU_LOAD_CHUNK_SIZE = 1000;
const SKU_LOAD_MAX_OFFSET = 200000;
const SKU_LOAD_YIELD_MS = 60;
const JUSHUITAN_WAREHOUSE_NAME = "义乌明舵国际贸易有限公司";

interface ErpAccountRow {
  id: string;
  name: string;
  phone?: string | null;
  status?: string;
  source?: string;
  alibaba1688AddressId?: string | null;
  alibaba1688AddressLabel?: string | null;
  alibaba1688FullName?: string | null;
  alibaba1688Mobile?: string | null;
  alibaba1688Phone?: string | null;
  alibaba1688PostCode?: string | null;
  alibaba1688ProvinceText?: string | null;
  alibaba1688CityText?: string | null;
  alibaba1688AreaText?: string | null;
  alibaba1688TownText?: string | null;
  alibaba1688Address?: string | null;
  alibaba1688AddressRemoteId?: string | null;
  alibaba1688AddressIsDefault?: number | boolean | null;
  updatedAt?: string;
}

interface Alibaba1688AddressRow {
  id: string;
  label?: string | null;
  fullName?: string | null;
  mobile?: string | null;
  phone?: string | null;
  postCode?: string | null;
  provinceText?: string | null;
  cityText?: string | null;
  areaText?: string | null;
  townText?: string | null;
  address?: string | null;
  addressId?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  isDefault?: boolean | number | null;
  rawAddressParam?: Record<string, any> | null;
  addressParam?: Record<string, any> | null;
}

interface ErpSupplierRow {
  id: string;
  name: string;
  supplierCode?: string | null;
  contactName?: string | null;
  phone?: string | null;
  wechat?: string | null;
  address?: string | null;
  categories?: string[];
  supplierLevel?: string | null;
  paymentTerms?: string | null;
  leadDays?: number | null;
  taxRate?: number | null;
  settlementCurrency?: string | null;
  remark?: string | null;
  status?: string;
  source?: string | null;
  skuCount?: number | null;
  mappedSkuCount?: number | null;
  purchaseOrderCount?: number | null;
  purchaseAmount?: number | null;
  lastPurchaseAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface ErpSkuRow {
  id: string;
  accountId?: string | null;
  accountName?: string | null;
  internalSkuCode: string;
  productName: string;
  colorSpec?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  supplierId?: string | null;
  actualStockQty?: number | null;
  costedStockQty?: number | null;
  missingCostStockQty?: number | null;
  stockValue?: number | null;
  weightedStockCost?: number | null;
  warehouseLocation?: string | null;
  costPrice?: number | null;
  skuType?: string | null;
  bundleCostPrice?: number | null;
  bundleComponentCount?: number | null;
  jstActualStockQty?: number | null;
  jstCostPrice?: number | null;
  jstSupplierName?: string | null;
  jstMainBin?: string | null;
  jstCreatedAt?: string | null;
  jstModifiedAt?: string | null;
  jstCreator?: string | null;
  createdByName?: string | null;
  source?: string | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface SkuDialogValues {
  productName: string;
  colorSpec: string;
  accountId?: string;
}

interface SkuBundleDialogValues {
  internalSkuCode?: string;
  productName: string;
  colorSpec: string;
  accountId?: string;
}

interface BundleComponentDraft {
  key: string;
  skuId?: string;
  qty: number;
}

interface BundleComponentView extends BundleComponentDraft {
  sku?: ErpSkuRow;
  unitCost: number | null;
  lineCost: number | null;
}

type SkuIssueKey = "missing_image" | "missing_spec" | "missing_cost" | "zero_stock" | "missing_supplier" | "stale_data";
type SupplierRiskLevel = "high" | "medium" | "low";
type SupplierPerformanceBand = "core" | "growth" | "trial" | "governance";

interface SkuFilters {
  keyword: string;
  accountId?: string;
  status?: string;
  hasIssue?: boolean;
  issue?: SkuIssueKey;
}

interface SkuQualityCard {
  label: string;
  value: number | string;
  tone: string;
  hasIssue?: boolean;
  issue?: SkuIssueKey;
}

interface SkuActiveFilterTag {
  key: string;
  label: string;
  color?: string;
  clear: (current: SkuFilters) => SkuFilters;
}

interface SupplierWorkLogItem {
  key: string;
  color: string;
  title: string;
  description: string;
}

interface SkuCostRecord {
  key: string;
  label: string;
  amount: number;
  at?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  note: string;
}

interface SkuStockRecord {
  key: string;
  businessType: string;
  date?: string | null;
  qty: number;
  orderNo: string;
  batchCode?: string;
  receiptNo?: string;
  poNo?: string;
  warehouse: string;
  store: string;
  operator: string;
  availableQty?: number;
  reservedQty?: number;
  blockedQty?: number;
  defectiveQty?: number;
  reworkQty?: number;
  currentQty?: number;
  unitCost?: number;
  unitFreightCost?: number;
  unitLandedCost?: number;
  stockValue?: number;
  costStatus?: string;
  costedQty?: number;
  missingCostQty?: number;
  sourceStatus?: string;
  sourceRemark?: string;
}

interface SkuLogRecord {
  key: string;
  skuCode: string;
  content: string;
  action: string;
  operator: string;
  at?: string | null;
}

interface SupplierFilters {
  keyword: string;
  status?: string;
  supplierLevel?: string;
  category?: string;
  attention?: string;
  riskLevel?: SupplierRiskLevel;
  performanceBand?: SupplierPerformanceBand;
}

interface StoreAddressValues {
  selected1688AddressId?: string;
  alibabaAddressId?: string;
  label: string;
  fullName: string;
  mobile?: string;
  phone?: string;
  postCode?: string;
  provinceText?: string;
  cityText?: string;
  areaText?: string;
  townText?: string;
  address: string;
}

type MasterDataMode = "skus" | "suppliers" | "stores";

interface ProductMasterDataProps {
  mode?: MasterDataMode;
  embedded?: boolean;
}

interface ProductMasterDataCache {
  generatedAt?: string;
  accounts?: ErpAccountRow[];
  suppliers?: ErpSupplierRow[];
  skus?: ErpSkuRow[];
  alibaba1688Addresses?: Alibaba1688AddressRow[];
}

interface ProductMasterDataSkuCache {
  generatedAt?: string;
  skus?: ErpSkuRow[];
}

function statusColor(status?: string) {
  switch (status) {
    case "active":
    case "online":
    case "success":
      return "success";
    case "offline":
    case "skipped":
      return "default";
    case "blocked":
    case "failed":
      return "error";
    default:
      return "processing";
  }
}

const STATUS_LABELS: Record<string, string> = {
  active: "启用",
  blocked: "停用",
  online: "在线",
  offline: "下线",
  success: "成功",
  skipped: "跳过",
  failed: "失败",
};

function statusLabel(status?: string | null) {
  if (!status) return "-";
  return STATUS_LABELS[status] || "未知状态";
}

const SKU_ISSUE_META: Record<SkuIssueKey, { label: string; color: string }> = {
  missing_image: { label: "缺图片", color: "orange" },
  missing_spec: { label: "缺规格", color: "gold" },
  missing_cost: { label: "缺成本", color: "red" },
  zero_stock: { label: "零库存", color: "volcano" },
  missing_supplier: { label: "未绑供应商", color: "purple" },
  stale_data: { label: "久未更新", color: "blue" },
};

const SKU_ISSUE_KEYS = Object.keys(SKU_ISSUE_META) as SkuIssueKey[];

const SKU_ISSUE_CARD_TONES: Record<SkuIssueKey, string> = {
  missing_image: "#f97316",
  missing_spec: "#d97706",
  missing_cost: "#dc2626",
  zero_stock: "#7c3aed",
  missing_supplier: "#9333ea",
  stale_data: "#2563eb",
};

const SUPPLIER_ATTENTION_META: Record<string, { label: string; color: string; detail: string }> = {
  missing_contact: { label: "缺联系人", color: "orange", detail: "联系人、电话、微信至少维护一项" },
  missing_category: { label: "缺类目", color: "gold", detail: "经营类目为空，采购筛选不完整" },
  no_sku: { label: "无商品", color: "purple", detail: "还没有关联商品资料" },
  no_mapping: { label: "无货源", color: "volcano", detail: "还没有关联 1688 货源" },
  missing_terms: { label: "缺结算", color: "red", detail: "缺少账期、交期或税率信息" },
};

const SUPPLIER_RISK_META: Record<SupplierRiskLevel, { label: string; color: string; tone: string }> = {
  high: { label: "高风险", color: "red", tone: "#dc2626" },
  medium: { label: "中风险", color: "orange", tone: "#ea580c" },
  low: { label: "低风险", color: "green", tone: "#16a34a" },
};

const SUPPLIER_RISK_OPTIONS = (Object.keys(SUPPLIER_RISK_META) as SupplierRiskLevel[]).map((key) => ({
  value: key,
  label: SUPPLIER_RISK_META[key].label,
}));

const SUPPLIER_PERFORMANCE_META: Record<SupplierPerformanceBand, { label: string; color: string; tone: string; detail: string }> = {
  core: { label: "核心供应商", color: "green", tone: "#16a34a", detail: "采购沉淀、货源覆盖和资料完整度较好，可优先维护长期合作。" },
  growth: { label: "成长供应商", color: "blue", tone: "#2563eb", detail: "已有合作基础，货源、账期和履约数据可继续沉淀。" },
  trial: { label: "待验证", color: "gold", tone: "#d97706", detail: "缺少稳定采购沉淀，适合小批量验证交期、质量和售后。" },
  governance: { label: "风险治理", color: "red", tone: "#dc2626", detail: "风险、资料缺口或履约沉淀不足，需要先治理再放大采购。" },
};

const SUPPLIER_PERFORMANCE_OPTIONS = (Object.keys(SUPPLIER_PERFORMANCE_META) as SupplierPerformanceBand[]).map((key) => ({
  value: key,
  label: SUPPLIER_PERFORMANCE_META[key].label,
}));

const SUPPLIER_LEVEL_OPTIONS = [
  { label: "战略", value: "strategic", color: "purple" },
  { label: "优选", value: "preferred", color: "green" },
  { label: "标准", value: "standard", color: "blue" },
  { label: "观察", value: "watch", color: "orange" },
  { label: "淘汰", value: "blocked", color: "red" },
];

const PAYMENT_TERM_OPTIONS = [
  { label: "现结", value: "cash" },
  { label: "预付", value: "prepaid" },
  { label: "货到付款", value: "cod" },
  { label: "7 天账期", value: "net_7" },
  { label: "15 天账期", value: "net_15" },
  { label: "30 天账期", value: "net_30" },
  { label: "月结", value: "monthly" },
];

const SKU_STALE_DAYS = 90;

function optionLabel(options: Array<{ label: string; value: string }>, value?: string | null) {
  if (!value) return "-";
  return options.find((item) => item.value === value)?.label || value;
}

function supplierLevelMeta(value?: string | null) {
  return SUPPLIER_LEVEL_OPTIONS.find((item) => item.value === value)
    || SUPPLIER_LEVEL_OPTIONS.find((item) => item.value === "standard")!;
}

function toOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function isBundleSku(row: ErpSkuRow) {
  return String(row.skuType || "").toLowerCase() === "bundle";
}

function getSkuStockQty(row: ErpSkuRow) {
  const actualStockQty = toOptionalNumber(row.actualStockQty);
  const jstActualStockQty = toOptionalNumber(row.jstActualStockQty);
  if (actualStockQty !== null && actualStockQty !== 0) return actualStockQty;
  if (jstActualStockQty !== null) return jstActualStockQty;
  return actualStockQty ?? 0;
}

function normalizeSkuWarehouseLocation(...values: Array<string | null | undefined>) {
  const parts = values
    .flatMap((value) => String(value || "").split(/[,，;；、|]/))
    .map((value) => value.trim())
    .filter((value) => value && value !== JUSHUITAN_WAREHOUSE_NAME);
  return Array.from(new Set(parts)).join("、");
}

function getSkuWarehouseLocation(row: ErpSkuRow) {
  return normalizeSkuWarehouseLocation(row.warehouseLocation, row.jstMainBin);
}

function getSkuStockRecords(row: ErpSkuRow): SkuStockRecord[] {
  return [{
    key: "current",
    businessType: "库存结存",
    date: getSkuTouchedAt(row),
    qty: getSkuStockQty(row),
    orderNo: row.internalSkuCode || row.id,
    warehouse: getSkuWarehouseLocation(row) || "-",
    store: row.accountName || "-",
    operator: row.createdByName || row.jstCreator || "-",
  }];
}

function normalizeSkuStockDetailRecord(row: any, index: number): SkuStockRecord {
  const qty = toOptionalNumber(row?.qty ?? row?.receivedQty ?? row?.received_qty) ?? 0;
  const availableQty = toOptionalNumber(row?.availableQty ?? row?.available_qty) ?? 0;
  const reservedQty = toOptionalNumber(row?.reservedQty ?? row?.reserved_qty) ?? 0;
  const blockedQty = toOptionalNumber(row?.blockedQty ?? row?.blocked_qty) ?? 0;
  const defectiveQty = toOptionalNumber(row?.defectiveQty ?? row?.defective_qty) ?? 0;
  const reworkQty = toOptionalNumber(row?.reworkQty ?? row?.rework_qty) ?? 0;
  const currentQty = toOptionalNumber(row?.currentQty ?? row?.current_qty) ?? (availableQty + reservedQty + blockedQty + defectiveQty + reworkQty);
  const unitCost = toOptionalNumber(row?.unitCost ?? row?.unit_cost) ?? 0;
  const unitFreightCost = toOptionalNumber(row?.unitFreightCost ?? row?.unit_freight_cost) ?? 0;
  const unitLandedCost = toOptionalNumber(row?.unitLandedCost ?? row?.unit_landed_cost) ?? 0;
  const stockValue = toOptionalNumber(row?.stockValue ?? row?.stock_value) ?? (unitLandedCost * currentQty);
  const costStatus = row?.costStatus || row?.cost_status || (currentQty > 0 && unitLandedCost <= 0 ? "missing" : "confirmed");
  return {
    key: String(row?.id || row?.batchId || row?.batchCode || row?.receiptNo || row?.orderNo || `stock-${index}`),
    businessType: row?.businessType || "采购进仓",
    date: row?.date || row?.receivedAt || row?.received_at || row?.createdAt || row?.created_at || null,
    qty,
    orderNo: row?.orderNo || row?.receiptNo || row?.batchCode || row?.id || "-",
    batchCode: row?.batchCode || row?.batch_code || "",
    receiptNo: row?.receiptNo || row?.receipt_no || "",
    poNo: row?.poNo || row?.po_no || "",
    warehouse: row?.warehouse || row?.locationCode || row?.location_code || "-",
    store: row?.store || row?.accountName || row?.account_name || row?.accountId || row?.account_id || "-",
    operator: row?.operator || row?.operatorName || row?.operator_name || "-",
    availableQty,
    reservedQty,
    blockedQty,
    defectiveQty,
    reworkQty,
    currentQty,
    unitCost,
    unitFreightCost,
    unitLandedCost,
    stockValue,
    costStatus,
    costedQty: toOptionalNumber(row?.costedQty ?? row?.costed_qty) ?? (costStatus === "confirmed" ? currentQty : 0),
    missingCostQty: toOptionalNumber(row?.missingCostQty ?? row?.missing_cost_qty) ?? (costStatus === "missing" ? currentQty : 0),
    sourceStatus: row?.sourceStatus || row?.source_status || "",
    sourceRemark: row?.sourceRemark || row?.source_remark || "",
  };
}

function getSkuCostPrice(row: ErpSkuRow) {
  const cost = row.costPrice ?? row.jstCostPrice;
  return toOptionalNumber(cost);
}

function getSkuCostRecords(row: ErpSkuRow): SkuCostRecord[] {
  const records: SkuCostRecord[] = [];
  const jstCostPrice = toOptionalNumber(row.jstCostPrice);
  const erpCostPrice = toOptionalNumber(row.costPrice);
  if (jstCostPrice !== null) {
    records.push({
      key: "jst",
      label: "同步成本",
      amount: jstCostPrice,
      at: row.jstModifiedAt || row.jstCreatedAt || row.updatedAt || row.createdAt,
      startAt: row.jstCreatedAt || row.createdAt,
      endAt: row.jstModifiedAt || row.updatedAt,
      createdAt: row.jstCreatedAt || row.createdAt,
      updatedAt: row.jstModifiedAt || row.updatedAt,
      note: "-",
    });
  }
  if (erpCostPrice !== null) {
    records.push({
      key: "erp",
      label: "当前资料成本",
      amount: erpCostPrice,
      at: row.updatedAt || row.createdAt || row.jstModifiedAt || row.jstCreatedAt,
      startAt: row.createdAt || row.jstCreatedAt,
      endAt: row.updatedAt || row.jstModifiedAt,
      createdAt: row.createdAt || row.jstCreatedAt,
      updatedAt: row.updatedAt || row.jstModifiedAt,
      note: "-",
    });
  }
  return records;
}

function getSkuSupplierText(row: ErpSkuRow) {
  return row.jstSupplierName || row.supplierId || "";
}

function getSkuTouchedAt(row: ErpSkuRow) {
  return row.jstModifiedAt || row.updatedAt || row.jstCreatedAt || row.createdAt || null;
}

function getDaysSince(value?: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.floor((Date.now() - time) / 86400000);
}

function getSkuStaleDays(row: ErpSkuRow) {
  return getDaysSince(getSkuTouchedAt(row));
}

function isSkuDataStale(row: ErpSkuRow) {
  const staleDays = getSkuStaleDays(row);
  return staleDays !== null && staleDays >= SKU_STALE_DAYS;
}

function getSkuDataIssues(row: ErpSkuRow): SkuIssueKey[] {
  const issues: SkuIssueKey[] = [];
  if (!row.imageUrl) issues.push("missing_image");
  if (!(row.colorSpec || row.category)) issues.push("missing_spec");
  if (getSkuCostPrice(row) === null || Number(row.missingCostStockQty || 0) > 0) issues.push("missing_cost");
  if (getSkuStockQty(row) <= 0) issues.push("zero_stock");
  if (!isBundleSku(row) && !getSkuSupplierText(row)) issues.push("missing_supplier");
  if (isSkuDataStale(row)) issues.push("stale_data");
  return issues;
}

function getSupplierCompleteness(row: ErpSupplierRow) {
  const total = 10;
  const filled = [
    row.supplierCode,
    row.name,
    row.contactName,
    row.phone || row.wechat,
    row.address,
    row.categories?.length ? "categories" : "",
    row.paymentTerms,
    row.leadDays !== null && row.leadDays !== undefined ? "lead" : "",
    row.taxRate !== null && row.taxRate !== undefined ? "tax" : "",
    Number(row.skuCount || 0) > 0 ? "skus" : "",
  ].filter(Boolean).length;
  return Math.round((filled / total) * 100);
}

function getSupplierAttentionKeys(row: ErpSupplierRow) {
  const keys: string[] = [];
  if (!row.contactName && !row.phone && !row.wechat) keys.push("missing_contact");
  if (!row.categories?.length) keys.push("missing_category");
  if (Number(row.skuCount || 0) <= 0) keys.push("no_sku");
  if (Number(row.mappedSkuCount || 0) <= 0) keys.push("no_mapping");
  if (!row.paymentTerms || row.leadDays === null || row.leadDays === undefined || row.taxRate === null || row.taxRate === undefined) {
    keys.push("missing_terms");
  }
  return keys;
}

function getSupplierRiskSignals(row: ErpSupplierRow) {
  const signals: Array<{ key: string; label: string; detail: string; weight: number; color: string }> = [];
  const attentionKeys = getSupplierAttentionKeys(row);
  const completeness = getSupplierCompleteness(row);
  const leadDays = Number(row.leadDays || 0);
  const purchaseOrderCount = Number(row.purchaseOrderCount || 0);
  const skuCount = Number(row.skuCount || 0);

  if (row.status === "blocked") {
    signals.push({ key: "blocked", label: "已停用", detail: "供应商当前为停用状态，不应继续进入采购履约。", weight: 90, color: "red" });
  }
  if (completeness < 60) {
    signals.push({ key: "low_profile", label: "资料低完整度", detail: `资料完整度 ${completeness}%，关键联系方式或结算信息不足。`, weight: 28, color: "orange" });
  }
  if (attentionKeys.includes("missing_terms")) {
    signals.push({ key: "missing_terms", label: "结算规则缺失", detail: SUPPLIER_ATTENTION_META.missing_terms.detail, weight: 22, color: "red" });
  }
  if (attentionKeys.includes("missing_contact")) {
    signals.push({ key: "missing_contact", label: "联系链路缺失", detail: SUPPLIER_ATTENTION_META.missing_contact.detail, weight: 18, color: "orange" });
  }
  if (attentionKeys.includes("no_sku")) {
    signals.push({ key: "no_sku", label: "未关联商品", detail: SUPPLIER_ATTENTION_META.no_sku.detail, weight: 20, color: "purple" });
  }
  if (attentionKeys.includes("no_mapping")) {
    signals.push({ key: "no_mapping", label: "缺 1688 货源", detail: SUPPLIER_ATTENTION_META.no_mapping.detail, weight: 15, color: "volcano" });
  }
  if (leadDays > 14) {
    signals.push({ key: "long_lead", label: "交期偏长", detail: `标准交期 ${leadDays} 天，供货响应慢。`, weight: 12, color: "gold" });
  }
  if (skuCount > 0 && purchaseOrderCount <= 0) {
    signals.push({ key: "no_purchase", label: "暂无采购记录", detail: "已有商品关联但暂无采购单沉淀，履约稳定性未验证。", weight: 10, color: "blue" });
  }

  return signals;
}

function getSupplierRiskScore(row: ErpSupplierRow) {
  return Math.min(100, getSupplierRiskSignals(row).reduce((score, item) => score + item.weight, 0));
}

function getSupplierRiskLevel(row: ErpSupplierRow): SupplierRiskLevel {
  const score = getSupplierRiskScore(row);
  if (score >= 60) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function getSupplierMappedRate(row: ErpSupplierRow) {
  const skuCount = Number(row.skuCount || 0);
  if (skuCount <= 0) return 0;
  return Math.round((Number(row.mappedSkuCount || 0) / skuCount) * 100);
}

function getSupplierPerformanceScore(row: ErpSupplierRow) {
  const purchaseOrderCount = Number(row.purchaseOrderCount || 0);
  const purchaseAmount = Number(row.purchaseAmount || 0);
  const skuCount = Number(row.skuCount || 0);
  const mappedRate = getSupplierMappedRate(row);
  const completeness = getSupplierCompleteness(row);
  const leadDays = toOptionalNumber(row.leadDays);
  const riskLevel = getSupplierRiskLevel(row);
  let score = 0;

  if (purchaseOrderCount >= 20) score += 25;
  else if (purchaseOrderCount >= 5) score += 18;
  else if (purchaseOrderCount > 0) score += 10;

  if (purchaseAmount >= 100000) score += 25;
  else if (purchaseAmount >= 10000) score += 18;
  else if (purchaseAmount > 0) score += 10;

  if (skuCount >= 50) score += 15;
  else if (skuCount >= 10) score += 10;
  else if (skuCount > 0) score += 6;

  if (mappedRate >= 80) score += 10;
  else if (mappedRate >= 40) score += 6;

  if (completeness >= 80) score += 15;
  else if (completeness >= 60) score += 8;

  if (leadDays !== null && leadDays <= 7) score += 10;
  else if (leadDays !== null && leadDays <= 14) score += 6;

  if (riskLevel === "high") score -= 35;
  else if (riskLevel === "medium") score -= 15;
  if (row.status === "blocked") score -= 40;

  return Math.max(0, Math.min(100, score));
}

function getSupplierPerformanceBand(row: ErpSupplierRow): SupplierPerformanceBand {
  const score = getSupplierPerformanceScore(row);
  const purchaseOrderCount = Number(row.purchaseOrderCount || 0);
  const riskLevel = getSupplierRiskLevel(row);
  if (row.status === "blocked" || riskLevel === "high" || score < 35) return "governance";
  if (purchaseOrderCount <= 0) return "trial";
  if (score >= 75) return "core";
  return "growth";
}

function getSupplierPerformanceReasons(row: ErpSupplierRow) {
  const reasons: string[] = [];
  const purchaseOrderCount = Number(row.purchaseOrderCount || 0);
  const purchaseAmount = Number(row.purchaseAmount || 0);
  const skuCount = Number(row.skuCount || 0);
  const mappedRate = getSupplierMappedRate(row);
  const completeness = getSupplierCompleteness(row);
  const leadDays = toOptionalNumber(row.leadDays);
  const riskLevel = getSupplierRiskLevel(row);

  if (purchaseOrderCount > 0) reasons.push(`累计采购 ${purchaseOrderCount} 单`);
  else reasons.push("暂无采购沉淀");
  if (purchaseAmount > 0) reasons.push(`采购金额 ${formatMoney(purchaseAmount)}`);
  if (skuCount > 0) reasons.push(`关联 ${skuCount} 个商品，货源覆盖 ${mappedRate}%`);
  else reasons.push("未关联商品");
  reasons.push(`资料完整度 ${completeness}%`);
  if (leadDays !== null) reasons.push(`标准交期 ${leadDays} 天`);
  if (riskLevel !== "low") reasons.push(SUPPLIER_RISK_META[riskLevel].label);
  return reasons;
}

function getSupplierWorkLogItems(row: ErpSupplierRow): SupplierWorkLogItem[] {
  const riskSignals = getSupplierRiskSignals(row);
  const performanceBand = getSupplierPerformanceBand(row);
  const performanceMeta = SUPPLIER_PERFORMANCE_META[performanceBand];
  const items = riskSignals.map((signal) => ({
    key: `risk:${signal.key}`,
    color: signal.color,
    title: `问题：${signal.label}`,
    description: signal.detail,
  }));

  if (!items.length) {
    items.push({
      key: "ready",
      color: "green",
      title: "合作状态可用",
      description: "资料、结算和货源关系完整，可正常进入采购履约。",
    });
  }

  items.push({
    key: "performance",
    color: performanceMeta.color,
    title: `绩效分层：${performanceMeta.label}`,
    description: `${performanceMeta.detail} ${getSupplierPerformanceReasons(row).join("；")}。`,
  });
  items.push({
    key: "purchase",
    color: "blue",
    title: "最近采购记录",
    description: row.lastPurchaseAt
      ? `最近采购 ${formatDateTime(row.lastPurchaseAt)}，累计采购单 ${Number(row.purchaseOrderCount || 0)} 单。`
      : "暂无最近采购记录，可结合商品关联数量判断是否需要验证履约稳定性。",
  });
  items.push({
    key: "updated",
    color: "blue",
    title: "最近资料更新",
    description: formatDateTime(row.updatedAt || row.createdAt),
  });

  return items;
}

function canRole(role: string | undefined, roles: string[]) {
  return Boolean(role && roles.includes(role));
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

function formatMoney(value?: number | string | null) {
  if (value === null || value === undefined || value === "") return "-";
  const amount = Number(value);
  if (Number.isNaN(amount)) return String(value);
  return `¥${amount.toFixed(2)}`;
}

const SKU_ISSUE_NOTES: Record<SkuIssueKey, string> = {
  missing_image: "商品主图为空，采购、仓库和运营难以快速识别货品。",
  missing_spec: "颜色、尺寸、数量组合或关键规格为空，下单和拣货容易看错。",
  missing_cost: "成本价为空，利润判断和采购比价会失真。",
  zero_stock: "实际库存为 0，当前不可直接流转到发货。",
  missing_supplier: "供应商为空，采购、售后追责和后续供货关系不完整。",
  stale_data: `超过 ${SKU_STALE_DAYS} 天未更新，成本、供应商、规格或库存口径可能已经变旧。`,
};

function getSkuWorkLogItems(row: ErpSkuRow) {
  const issues = getSkuDataIssues(row);
  const stockQty = getSkuStockQty(row);
  const costPrice = getSkuCostPrice(row);
  const supplierText = getSkuSupplierText(row);
  const location = getSkuWarehouseLocation(row);
  const items = issues.map((issue) => ({
    key: `issue:${issue}`,
    color: SKU_ISSUE_META[issue].color,
    title: `问题：${SKU_ISSUE_META[issue].label}`,
    description: issue === "stale_data"
      ? `${SKU_ISSUE_NOTES[issue]} 最近更新 ${formatDateTime(getSkuTouchedAt(row))}。`
      : SKU_ISSUE_NOTES[issue],
  }));

  if (!issues.length) {
    items.push({
      key: "complete",
      color: "green",
      title: "资料校验通过",
      description: "图片、规格、成本、库存、供应商都满足当前治理规则。",
    });
  }

  items.push({
    key: "updated",
    color: "blue",
    title: "最近资料更新",
    description: formatDateTime(getSkuTouchedAt(row)),
  });

  if (stockQty > 0) {
    items.push({
      key: "stock",
      color: "green",
      title: "库存状态",
      description: `实际库存 ${stockQty} 件${location ? `，仓位 ${location}` : ""}`,
    });
  }

  if (costPrice !== null) {
    items.push({
      key: "cost",
      color: "green",
      title: "成本已维护",
      description: `当前成本 ${formatMoney(costPrice)}`,
    });
  }

  if (supplierText) {
    items.push({
      key: "supplier",
      color: "green",
      title: "供应商已维护",
      description: supplierText,
    });
  }

  return items;
}

function getSkuLogRecords(row: ErpSkuRow): SkuLogRecord[] {
  const skuCode = row.internalSkuCode || row.id;
  return getSkuWorkLogItems(row).map((item) => ({
    key: item.key,
    skuCode,
    content: item.description,
    action: item.title.replace(/^问题：/, ""),
    operator: row.createdByName || row.jstCreator || "-",
    at: getSkuTouchedAt(row),
  }));
}

function storeAddressSummary(row: ErpAccountRow) {
  return [row.alibaba1688ProvinceText, row.alibaba1688CityText, row.alibaba1688AreaText, row.alibaba1688Address]
    .filter(Boolean)
    .join("");
}

function getStoreAddressInitialValues(row: ErpAccountRow): StoreAddressValues {
  return {
    alibabaAddressId: row.alibaba1688AddressRemoteId || "",
    label: row.alibaba1688AddressLabel || `${row.name}地址`,
    fullName: row.alibaba1688FullName || "",
    mobile: row.alibaba1688Mobile || "",
    phone: row.alibaba1688Phone || "",
    postCode: row.alibaba1688PostCode || "",
    provinceText: row.alibaba1688ProvinceText || "",
    cityText: row.alibaba1688CityText || "",
    areaText: row.alibaba1688AreaText || "",
    townText: row.alibaba1688TownText || "",
    address: row.alibaba1688Address || "",
  };
}

function get1688AddressSummary(row: Alibaba1688AddressRow) {
  return [row.provinceText, row.cityText, row.areaText, row.address]
    .filter(Boolean)
    .join("");
}

function get1688AddressRows(value: any): Alibaba1688AddressRow[] {
  const rows = value?.alibaba1688Addresses
    || value?.workbench?.alibaba1688Addresses
    || value?.result?.addresses
    || value?.addresses;
  return Array.isArray(rows) ? rows as Alibaba1688AddressRow[] : [];
}

function firstAddressText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (!["string", "number", "boolean"].includes(typeof value)) return "";
  const text = String(value ?? "").trim();
  return text || "";
}

function findAddressValue(value: unknown, keys: string[], depth = 0): string {
  if (!value || depth > 6) return "";
  const keySet = new Set(keys.map((key) => key.toLowerCase()));
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAddressValue(item, keys, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  for (const [key, next] of Object.entries(value as Record<string, unknown>)) {
    if (keySet.has(key.toLowerCase())) {
      const text = firstAddressText(next);
      if (text) return text;
    }
  }
  for (const next of Object.values(value as Record<string, unknown>)) {
    const found = findAddressValue(next, keys, depth + 1);
    if (found) return found;
  }
  return "";
}

function addressValue(row: Alibaba1688AddressRow, ownValue: unknown, keys: string[]) {
  return (
    firstAddressText(ownValue)
    || findAddressValue(row.rawAddressParam, keys)
    || findAddressValue(row.addressParam, keys)
  );
}

const CHINA_PROVINCE_NAMES = [
  "北京市", "天津市", "上海市", "重庆市",
  "河北省", "山西省", "辽宁省", "吉林省", "黑龙江省",
  "江苏省", "浙江省", "安徽省", "福建省", "江西省", "山东省",
  "河南省", "湖北省", "湖南省", "广东省", "海南省", "四川省",
  "贵州省", "云南省", "陕西省", "甘肃省", "青海省", "台湾省",
  "内蒙古自治区", "广西壮族自治区", "西藏自治区", "宁夏回族自治区",
  "新疆维吾尔自治区", "香港特别行政区", "澳门特别行政区",
];

const CHINA_MUNICIPALITIES = new Set(["北京市", "天津市", "上海市", "重庆市"]);

function parseChineseRegionFromAddress(value: unknown) {
  const source = firstAddressText(value).replace(/\s+/g, " ").trim();
  const empty = { provinceText: "", cityText: "", areaText: "", address: "" };
  if (!source) return empty;

  const compact = source.replace(/\s+/g, "");
  let provinceText = "";
  let provinceIndex = -1;
  for (const province of CHINA_PROVINCE_NAMES) {
    const index = compact.indexOf(province);
    if (index >= 0 && (provinceIndex < 0 || index < provinceIndex)) {
      provinceText = province;
      provinceIndex = index;
    }
  }
  if (!provinceText) return empty;

  const rest = compact.slice(provinceIndex + provinceText.length);
  const match = rest.match(/^(.+?(?:自治州|地区|盟|市))?(.+?(?:区|县|市|旗))?/);
  const matchedCityText = match?.[1] || "";
  const areaText = match?.[2] || "";
  const cityText = matchedCityText || (CHINA_MUNICIPALITIES.has(provinceText) ? provinceText : "");
  let address = source;
  for (const part of [provinceText, matchedCityText, areaText].filter(Boolean)) {
    address = address.replace(part, "");
  }
  address = address.replace(/\s+/g, " ").trim();
  return { provinceText, cityText, areaText, address };
}

function get1688AddressFormValues(row: Alibaba1688AddressRow): Partial<StoreAddressValues> {
  const mobile = addressValue(row, row.mobile, [
    "mobile", "mobileNo", "mobileNumber", "mobilePhone", "phoneNumber", "phoneNum",
    "receiverMobile", "receiverMobileNo", "receiveMobile", "receiveMobileNo",
    "recipientMobile", "consigneeMobile", "contactMobile", "cellphone",
  ]);
  const rawProvinceText = addressValue(row, row.provinceText, ["provinceText", "provinceName", "province", "provName"]);
  const rawCityText = addressValue(row, row.cityText, ["cityText", "cityName", "city"]);
  const rawAreaText = addressValue(row, row.areaText, ["areaText", "areaName", "district", "districtName", "county", "countyName"]);
  const rawAddress = addressValue(row, row.address, [
    "address", "detailAddress", "addressDetail", "detailedAddress",
    "receiverAddress", "receiveAddress", "streetAddress", "fullAddress",
  ]);
  const parsedAddress = parseChineseRegionFromAddress(rawAddress);
  const parsedSummary = parseChineseRegionFromAddress([
    rawAddress,
    row.label,
    get1688AddressSummary(row),
  ].filter(Boolean).join(" "));
  return {
    selected1688AddressId: row.id,
    alibabaAddressId: addressValue(row, row.addressId, ["addressId", "addressID", "receiveAddressId", "receive_address_id", "id"]),
    label: row.label || "1688 地址",
    fullName: addressValue(row, row.fullName, ["fullName", "receiverName", "receiveName", "receiver", "consignee", "contactName", "name"]),
    mobile,
    phone: addressValue(row, row.phone, ["phone", "tel", "telephone", "receiverPhone", "receivePhone", "contactPhone"]),
    postCode: addressValue(row, row.postCode, ["postCode", "postcode", "postalCode", "zip", "zipCode", "post"]),
    provinceText: rawProvinceText || parsedAddress.provinceText || parsedSummary.provinceText,
    cityText: rawCityText || parsedAddress.cityText || parsedSummary.cityText,
    areaText: rawAreaText || parsedAddress.areaText || parsedSummary.areaText,
    townText: addressValue(row, row.townText, ["townText", "townName", "town", "streetName"]),
    address: parsedAddress.address || rawAddress,
  };
}

function buildStoreAddressPayload(values: StoreAddressValues, accountId: string, addressId?: string | null) {
  return {
    action: "save_1688_address",
    id: addressId || undefined,
    accountId,
    label: values.label,
    fullName: values.fullName,
    mobile: values.mobile,
    phone: values.phone,
    postCode: values.postCode,
    provinceText: values.provinceText,
    cityText: values.cityText,
    areaText: values.areaText,
    townText: values.townText,
    address: values.address,
    alibabaAddressId: values.alibabaAddressId,
    isDefault: true,
    status: "active",
    ...ADDRESS_WORKBENCH_PARAMS,
  };
}

function isDeleteAccountHandlerMissing(error: any) {
  return /deleteAccount is not defined/i.test(String(error?.message || error || ""));
}

function waitForSkuLoadYield() {
  return new Promise((resolve) => window.setTimeout(resolve, SKU_LOAD_YIELD_MS));
}

function createBundleComponentDraft(skuId?: string): BundleComponentDraft {
  return {
    key: `bundle_component_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    skuId,
    qty: 1,
  };
}

export default function ProductMasterData({ mode = "skus", embedded = false }: ProductMasterDataProps) {
  const auth = useErpAuth();
  const role = auth.currentUser?.role;
  const cachedData = useMemo(
    () => readPageCache<ProductMasterDataCache>(PRODUCT_MASTER_DATA_CACHE_KEY, {}),
    [],
  );
  const canManageAccounts = canRole(role, ["admin", "manager"]);
  const canManageStoreAddress = canRole(role, ["admin", "manager", "buyer"]);
  const canViewSuppliers = canRole(role, ["admin", "buyer"]);
  const canManageSuppliers = canViewSuppliers;
  const canManageSkus = canRole(role, ["admin", "manager", "operations"]);

  const [accountForm] = Form.useForm();
  const [storeAddressForm] = Form.useForm<StoreAddressValues>();
  const [supplierForm] = Form.useForm();
  const [skuForm] = Form.useForm();
  const [bundleForm] = Form.useForm<SkuBundleDialogValues>();
  const [accounts, setAccounts] = useState<ErpAccountRow[]>(() => cachedData.accounts || []);
  const [suppliers, setSuppliers] = useState<ErpSupplierRow[]>(() => cachedData.suppliers || []);
  const [skus, setSkus] = useState<ErpSkuRow[]>(() => cachedData.skus || []);
  const [alibaba1688Addresses, setAlibaba1688Addresses] = useState<Alibaba1688AddressRow[]>(() => cachedData.alibaba1688Addresses || []);
  const [loadedOnce, setLoadedOnce] = useState(() => hasPageCache(cachedData));
  const [loading, setLoading] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [skuModalOpen, setSkuModalOpen] = useState(false);
  const [editingSku, setEditingSku] = useState<ErpSkuRow | null>(null);
  const [bundleModalOpen, setBundleModalOpen] = useState(false);
  const [editingBundleSku, setEditingBundleSku] = useState<ErpSkuRow | null>(null);
  const [bundleComponents, setBundleComponents] = useState<BundleComponentDraft[]>([]);
  const [bundleLoadingComponents, setBundleLoadingComponents] = useState(false);
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<ErpSupplierRow | null>(null);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountCreateModalOpen, setAccountCreateModalOpen] = useState(false);
  const [storeAddressModalOpen, setStoreAddressModalOpen] = useState(false);
  const [editingStoreAddressAccount, setEditingStoreAddressAccount] = useState<ErpAccountRow | null>(null);
  const [skuDetailRow, setSkuDetailRow] = useState<ErpSkuRow | null>(null);
  const [costDetailRow, setCostDetailRow] = useState<ErpSkuRow | null>(null);
  const [stockDetailRow, setStockDetailRow] = useState<ErpSkuRow | null>(null);
  const [stockDetailRows, setStockDetailRows] = useState<SkuStockRecord[]>([]);
  const [stockDetailLoading, setStockDetailLoading] = useState(false);
  const [supplierDetailRow, setSupplierDetailRow] = useState<ErpSupplierRow | null>(null);
  const [skuFilters, setSkuFilters] = useState<SkuFilters>({ keyword: "" });
  const [selectedSkuRowKeys, setSelectedSkuRowKeys] = useState<Key[]>([]);
  const [supplierFilters, setSupplierFilters] = useState<SupplierFilters>({ keyword: "" });
  const mountedRef = useRef(true);
  const loadSeqRef = useRef(0);
  const accountOptions = useMemo(
    () => accounts
      .map((account) => ({ label: account.name || account.id, value: account.id }))
      // 店铺名前缀通常是数字（"028店"/"045店"），用 numeric 让自然顺序生效，避免按字符串排出 044→045→032 这种乱序。
      .sort((a, b) => String(a.label).localeCompare(String(b.label), "zh-Hans-CN", { numeric: true })),
    [accounts],
  );
  const accountNameById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name || account.id])),
    [accounts],
  );
  const addressById = useMemo(
    () => new Map(alibaba1688Addresses.map((address) => [address.id, address])),
    [alibaba1688Addresses],
  );
  const alibaba1688AddressOptions = useMemo(
    () => alibaba1688Addresses.map((address) => ({
      label: [address.label, address.fullName, get1688AddressSummary(address)].filter(Boolean).join(" / ") || address.id,
      value: address.id,
    })),
    [alibaba1688Addresses],
  );
  const skuById = useMemo(
    () => new Map(skus.map((sku) => [sku.id, sku])),
    [skus],
  );
  const normalSkuOptions = useMemo(
    () => skus
      .filter((sku) => !isBundleSku(sku) && sku.status !== "deleted")
      .map((sku) => ({
        label: [sku.internalSkuCode, sku.productName, sku.colorSpec || sku.category]
          .filter(Boolean)
          .join(" / "),
        value: sku.id,
      })),
    [skus],
  );
  const hasSkuFilters = Boolean(
    skuFilters.keyword.trim()
    || skuFilters.accountId
    || skuFilters.status
    || skuFilters.hasIssue
    || skuFilters.issue,
  );
  const skuActiveFilterTags = useMemo<SkuActiveFilterTag[]>(() => {
    const tags: SkuActiveFilterTag[] = [];
    const keyword = skuFilters.keyword.trim();
    if (keyword) {
      tags.push({
        key: "keyword",
        label: `搜索：${keyword}`,
        clear: (current) => ({ ...current, keyword: "" }),
      });
    }
    if (skuFilters.accountId) {
      tags.push({
        key: "accountId",
        label: `店铺：${accountNameById.get(skuFilters.accountId) || skuFilters.accountId}`,
        color: "blue",
        clear: (current) => ({ ...current, accountId: undefined }),
      });
    }
    if (skuFilters.status) {
      tags.push({
        key: "status",
        label: `状态：${statusLabel(skuFilters.status)}`,
        color: statusColor(skuFilters.status),
        clear: (current) => ({ ...current, status: undefined }),
      });
    }
    if (skuFilters.hasIssue) {
      tags.push({
        key: "hasIssue",
        label: "有问题",
        color: "orange",
        clear: (current) => ({ ...current, hasIssue: undefined }),
      });
    }
    if (skuFilters.issue) {
      tags.push({
        key: "issue",
        label: `问题：${SKU_ISSUE_META[skuFilters.issue].label}`,
        color: SKU_ISSUE_META[skuFilters.issue].color,
        clear: (current) => ({ ...current, issue: undefined }),
      });
    }
    return tags;
  }, [accountNameById, skuFilters]);
  const filteredSkus = useMemo(() => {
    const keyword = skuFilters.keyword.trim().toLowerCase();
    return skus.filter((sku) => {
      if (skuFilters.accountId && sku.accountId !== skuFilters.accountId) return false;
      if (skuFilters.status && sku.status !== skuFilters.status) return false;
      const issues = getSkuDataIssues(sku);
      if (skuFilters.hasIssue && !issues.length) return false;
      if (skuFilters.issue && !issues.includes(skuFilters.issue)) return false;
      if (!keyword) return true;
      const accountName = sku.accountId ? accountNameById.get(sku.accountId) : "";
      const searchableText = [
        sku.internalSkuCode,
        sku.productName,
        sku.colorSpec,
        sku.category,
        accountName,
        sku.jstSupplierName,
        getSkuWarehouseLocation(sku),
        isBundleSku(sku) ? "组合装" : "",
        issues.length ? "有问题" : "正常",
        ...issues.map((issue) => SKU_ISSUE_META[issue].label),
        sku.status ? statusLabel(sku.status) : "",
      ].filter(Boolean).join(" ").toLowerCase();
      return searchableText.includes(keyword);
    });
  }, [accountNameById, skuFilters, skus]);
  const skuQualitySummary = useMemo(() => {
    const issueCounts = Object.fromEntries(SKU_ISSUE_KEYS.map((key) => [key, 0])) as Record<SkuIssueKey, number>;
    let pendingCount = 0;
    skus.forEach((sku) => {
      const issues = getSkuDataIssues(sku);
      issues.forEach((issue) => {
        issueCounts[issue] += 1;
      });
      if (issues.length) pendingCount += 1;
    });
    return {
      total: skus.length,
      pendingCount,
      issueCounts,
    };
  }, [skus]);
  const skuQualityCards = useMemo<SkuQualityCard[]>(() => [
    { label: "商品", value: skuQualitySummary.total, tone: "#2563eb" },
    { label: "有问题", value: skuQualitySummary.pendingCount, tone: "#ea580c", hasIssue: true },
    { label: "缺成本", value: skuQualitySummary.issueCounts.missing_cost, tone: SKU_ISSUE_CARD_TONES.missing_cost, issue: "missing_cost" },
    { label: "零库存", value: skuQualitySummary.issueCounts.zero_stock, tone: SKU_ISSUE_CARD_TONES.zero_stock, issue: "zero_stock" },
  ], [skuQualitySummary]);
  const skuLogRecords = useMemo(() => (
    skuDetailRow ? getSkuLogRecords(skuDetailRow) : []
  ), [skuDetailRow]);
  const fallbackStockDetailRecords = useMemo(() => (
    stockDetailRow ? getSkuStockRecords(stockDetailRow) : []
  ), [stockDetailRow]);
  const stockDetailRecords = useMemo(() => (
    stockDetailRows.length ? stockDetailRows : fallbackStockDetailRecords
  ), [fallbackStockDetailRecords, stockDetailRows]);
  const stockDetailTotal = useMemo(() => (
    stockDetailRows.length
      ? stockDetailRows.reduce((sum, row) => sum + Number(row.qty || 0), 0)
      : (stockDetailRow ? getSkuStockQty(stockDetailRow) : 0)
  ), [stockDetailRow, stockDetailRows]);
  const stockDetailCurrentTotal = useMemo(() => (
    stockDetailRows.length
      ? stockDetailRows.reduce((sum, row) => sum + Number(row.currentQty ?? row.qty ?? 0), 0)
      : (stockDetailRow ? getSkuStockQty(stockDetailRow) : 0)
  ), [stockDetailRow, stockDetailRows]);
  const stockDetailCostedTotal = useMemo(() => (
    stockDetailRows.reduce((sum, row) => sum + Number(row.costedQty || 0), 0)
  ), [stockDetailRows]);
  const stockDetailMissingCostTotal = useMemo(() => (
    stockDetailRows.reduce((sum, row) => sum + Number(row.missingCostQty || 0), 0)
  ), [stockDetailRows]);
  const stockDetailValueTotal = useMemo(() => (
    stockDetailRows.reduce((sum, row) => sum + Number(row.stockValue || 0), 0)
  ), [stockDetailRows]);
  const stockDetailWeightedCost = stockDetailCostedTotal > 0
    ? stockDetailValueTotal / stockDetailCostedTotal
    : null;
  const costDetailRecords = useMemo(() => (
    costDetailRow ? getSkuCostRecords(costDetailRow) : []
  ), [costDetailRow]);
  const selectedSkuKeySet = useMemo(
    () => new Set(selectedSkuRowKeys.map((key) => String(key))),
    [selectedSkuRowKeys],
  );
  const selectedSkus = useMemo(
    () => skus.filter((sku) => selectedSkuKeySet.has(sku.id)),
    [selectedSkuKeySet, skus],
  );
  const selectedSkuSummary = useMemo(() => {
    let totalStock = 0;
    let pendingCount = 0;
    const stores = new Set<string>();
    selectedSkus.forEach((sku) => {
      const issues = getSkuDataIssues(sku);
      if (issues.length) pendingCount += 1;
      totalStock += getSkuStockQty(sku);
      if (sku.accountId) stores.add(sku.accountId);
    });
    return {
      totalStock,
      pendingCount,
      storeCount: stores.size,
    };
  }, [selectedSkus]);
  const bundleComponentRows = useMemo<BundleComponentView[]>(() => (
    bundleComponents.map((component) => {
      const sku = component.skuId ? skuById.get(component.skuId) : undefined;
      const unitCost = sku ? getSkuCostPrice(sku) : null;
      const qty = Number(component.qty || 0);
      return {
        ...component,
        sku,
        qty,
        unitCost,
        lineCost: sku && unitCost !== null ? unitCost * qty : null,
      };
    })
  ), [bundleComponents, skuById]);
  const bundleSelectedCount = useMemo(
    () => bundleComponentRows.filter((row) => row.skuId).length,
    [bundleComponentRows],
  );
  const bundleTotalCost = useMemo(
    () => bundleComponentRows.reduce((sum, row) => sum + (row.lineCost ?? 0), 0),
    [bundleComponentRows],
  );
  const bundleHasMissingCost = useMemo(
    () => bundleComponentRows.some((row) => row.skuId && row.unitCost === null),
    [bundleComponentRows],
  );
  const supplierDetailAttention = useMemo(() => (
    supplierDetailRow ? getSupplierAttentionKeys(supplierDetailRow) : []
  ), [supplierDetailRow]);
  const supplierDetailWorkLogItems = useMemo(() => (
    supplierDetailRow ? getSupplierWorkLogItems(supplierDetailRow) : []
  ), [supplierDetailRow]);
  const supplierCategoryOptions = useMemo(() => {
    const labels = new Set<string>();
    suppliers.forEach((supplier) => {
      (supplier.categories || []).forEach((category) => {
        if (category) labels.add(category);
      });
    });
    return Array.from(labels)
      .sort((left, right) => left.localeCompare(right, "zh-Hans-CN", { numeric: true }))
      .map((label) => ({ label, value: label }));
  }, [suppliers]);
  const hasSupplierFilters = Boolean(
    supplierFilters.keyword.trim()
    || supplierFilters.status
    || supplierFilters.supplierLevel
    || supplierFilters.category
    || supplierFilters.attention
    || supplierFilters.riskLevel
    || supplierFilters.performanceBand,
  );
  const filteredSuppliers = useMemo(() => {
    const keyword = supplierFilters.keyword.trim().toLowerCase();
    return suppliers.filter((supplier) => {
      if (supplierFilters.status && supplier.status !== supplierFilters.status) return false;
      if (supplierFilters.supplierLevel && (supplier.supplierLevel || "standard") !== supplierFilters.supplierLevel) return false;
      if (supplierFilters.category && !(supplier.categories || []).includes(supplierFilters.category)) return false;
      if (supplierFilters.attention && !getSupplierAttentionKeys(supplier).includes(supplierFilters.attention)) return false;
      if (supplierFilters.riskLevel && getSupplierRiskLevel(supplier) !== supplierFilters.riskLevel) return false;
      if (supplierFilters.performanceBand && getSupplierPerformanceBand(supplier) !== supplierFilters.performanceBand) return false;
      if (!keyword) return true;
      const riskLevel = getSupplierRiskLevel(supplier);
      const performanceBand = getSupplierPerformanceBand(supplier);
      const searchableText = [
        supplier.supplierCode,
        supplier.name,
        supplier.contactName,
        supplier.phone,
        supplier.wechat,
        supplier.address,
        ...(supplier.categories || []),
        optionLabel(SUPPLIER_LEVEL_OPTIONS, supplier.supplierLevel),
        optionLabel(PAYMENT_TERM_OPTIONS, supplier.paymentTerms),
        supplier.settlementCurrency,
        supplier.remark,
        SUPPLIER_RISK_META[riskLevel].label,
        SUPPLIER_PERFORMANCE_META[performanceBand].label,
        ...getSupplierPerformanceReasons(supplier),
        ...getSupplierRiskSignals(supplier).map((item) => item.label),
        supplier.status ? statusLabel(supplier.status) : "",
      ].filter(Boolean).join(" ").toLowerCase();
      return searchableText.includes(keyword);
    });
  }, [supplierFilters, suppliers]);
  const supplierSummary = useMemo(() => {
    let activeCount = 0;
    let blockedCount = 0;
    let missingContactCount = 0;
    let noSkuCount = 0;
    let totalSkuCount = 0;
    let totalMappedSkuCount = 0;
    let purchaseAmount = 0;
    let preferredCount = 0;
    let leadDaysTotal = 0;
    let leadDaysCount = 0;
    const riskCounts = { high: 0, medium: 0, low: 0 };
    const performanceCounts = { core: 0, growth: 0, trial: 0, governance: 0 };
    suppliers.forEach((supplier) => {
      if (supplier.status === "blocked") blockedCount += 1;
      else activeCount += 1;
      riskCounts[getSupplierRiskLevel(supplier)] += 1;
      performanceCounts[getSupplierPerformanceBand(supplier)] += 1;
      if (["strategic", "preferred"].includes(String(supplier.supplierLevel || ""))) preferredCount += 1;
      if (!supplier.contactName && !supplier.phone && !supplier.wechat) missingContactCount += 1;
      if (Number(supplier.skuCount || 0) <= 0) noSkuCount += 1;
      totalSkuCount += Number(supplier.skuCount || 0);
      totalMappedSkuCount += Number(supplier.mappedSkuCount || 0);
      purchaseAmount += Number(supplier.purchaseAmount || 0);
      if (Number.isFinite(Number(supplier.leadDays))) {
        leadDaysTotal += Number(supplier.leadDays);
        leadDaysCount += 1;
      }
    });
    return {
      total: suppliers.length,
      activeCount,
      blockedCount,
      missingContactCount,
      noSkuCount,
      totalSkuCount,
      totalMappedSkuCount,
      purchaseAmount,
      preferredCount,
      riskCounts,
      performanceCounts,
      avgLeadDays: leadDaysCount ? Math.round(leadDaysTotal / leadDaysCount) : null,
    };
  }, [suppliers]);
  const pageTitle = mode === "suppliers" ? "供应商" : mode === "stores" ? "店铺" : "商品资料";
  const pageMeta = mode === "suppliers"
    ? [hasSupplierFilters ? `供应商 ${filteredSuppliers.length}/${suppliers.length}` : `供应商 ${suppliers.length}`]
    : mode === "stores"
      ? [`店铺 ${accounts.length}`]
      : [hasSkuFilters ? `商品 ${filteredSkus.length}/${skus.length}` : `商品 ${skus.length}`];

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadSeqRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!stockDetailRow) {
      setStockDetailRows([]);
      setStockDetailLoading(false);
      return;
    }
    const stockDetails = erp?.sku?.stockDetails;
    if (!stockDetails) {
      setStockDetailRows([]);
      return;
    }
    let cancelled = false;
    setStockDetailLoading(true);
    stockDetails({
      skuId: stockDetailRow.id,
      internalSkuCode: stockDetailRow.internalSkuCode || undefined,
      limit: 1000,
    })
      .then((result: any) => {
        if (cancelled) return;
        const rows = Array.isArray(result) ? result : (Array.isArray(result?.rows) ? result.rows : []);
        setStockDetailRows(rows.map(normalizeSkuStockDetailRecord));
      })
      .catch((error: any) => {
        if (cancelled) return;
        setStockDetailRows([]);
        message.warning(error?.message || "库存明细读取失败");
      })
      .finally(() => {
        if (!cancelled) setStockDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stockDetailRow]);

  const loadAll = useCallback(async (options?: { forceFull?: boolean; silent?: boolean; deferSkuCommit?: boolean }) => {
    if (!erp) return;
    const loadSeq = loadSeqRef.current + 1;
    loadSeqRef.current = loadSeq;
    const isCurrentLoad = () => mountedRef.current && loadSeqRef.current === loadSeq;
    if (!options?.silent) setLoading(true);
    try {
      // 强刷先让页面读现有缓存/服务器分页；全量同步放后台跑，避免服务器 2 万+ SKU 时首屏一直空白。
      if (options?.forceFull) {
        void erp.sku.sync?.({ mode: "full" }).catch((error: any) => {
          console.warn("[ProductMasterData] background SKU sync failed:", error?.message || error);
        });
      }
      const loadAuxiliaryData = async () => {
        try {
          const [nextAccounts, nextSuppliers, purchaseWorkbench] = await Promise.all([
            erp.account.list({ limit: 10000 }),
            erp.supplier.list({ limit: 10000 }),
            erp.purchase.workbench(ADDRESS_WORKBENCH_PARAMS).catch(() => null),
          ]);
          if (!isCurrentLoad()) return;
          const nextAddresses = get1688AddressRows(purchaseWorkbench);
          const nextAccountRows = nextAccounts as ErpAccountRow[];
          const nextSupplierRows = nextSuppliers as ErpSupplierRow[];
          setAccounts(nextAccountRows);
          setSuppliers(nextSupplierRows);
          if (nextAddresses.length) setAlibaba1688Addresses(nextAddresses);
          setLoadedOnce(true);
          writePageCache<ProductMasterDataCache>(PRODUCT_MASTER_DATA_CACHE_KEY, {
            generatedAt: new Date().toISOString(),
            accounts: nextAccountRows,
            suppliers: nextSupplierRows,
            skus: [],
            alibaba1688Addresses: nextAddresses.length ? nextAddresses : cachedData.alibaba1688Addresses,
          });
        } catch (error: any) {
          console.warn("[ProductMasterData] auxiliary load failed:", error?.message || error);
        }
      };
      const auxiliaryLoad = loadAuxiliaryData();
      if (mode !== "skus") {
        await auxiliaryLoad;
        return;
      }
      // SKU 一次性拿全：client 模式 erp.sku.list 走本地 cache.db（秒返回，PR2），
      // host 走本地 SQL。小分片让页面切走后能尽快停止，避免继续拖慢采购/供应商页首屏。
      const allSkuRows: ErpSkuRow[] = [];
      await waitForSkuLoadYield();
      for (let offset = 0; offset < SKU_LOAD_MAX_OFFSET; offset += SKU_LOAD_CHUNK_SIZE) {
        if (!isCurrentLoad()) return;
        let rows: ErpSkuRow[] | null = null;
        for (let attempt = 0; attempt < 3 && rows === null; attempt++) {
          try {
            const page = (await erp.sku.list({ limit: SKU_LOAD_CHUNK_SIZE, offset } as any)) as ErpSkuRow[];
            if (!isCurrentLoad()) return;
            rows = Array.isArray(page) ? page : [];
          } catch {
            if (attempt < 2) await new Promise((r) => window.setTimeout(r, 800));
          }
        }
        if (rows === null || !rows.length) break;
        allSkuRows.push(...rows);
        if (!options?.deferSkuCommit) setSkus(allSkuRows.slice());
        if (rows.length < SKU_LOAD_CHUNK_SIZE) break;
        await waitForSkuLoadYield();
      }
      if (isCurrentLoad() && allSkuRows.length) {
        if (options?.deferSkuCommit) setSkus(allSkuRows);
        void writeIndexedPageCache<ProductMasterDataSkuCache>(PRODUCT_MASTER_DATA_SKUS_CACHE_KEY, {
          generatedAt: new Date().toISOString(),
          skus: allSkuRows,
        });
      }
    } catch (error: any) {
      if (isCurrentLoad()) message.error(error?.message || "商品资料读取失败");
    } finally {
      if (isCurrentLoad() && !options?.silent) setLoading(false);
    }
  }, [cachedData.alibaba1688Addresses, mode]);

  const refresh1688Addresses = useCallback(async (syncIfEmpty = false) => {
    if (!erp) return [];
    setAddressLoading(true);
    try {
      const workbench = await erp.purchase.workbench(ADDRESS_WORKBENCH_PARAMS).catch(() => null);
      let nextAddresses = get1688AddressRows(workbench);
      if (!nextAddresses.length && syncIfEmpty) {
        const result = await erp.purchase.action({ action: "sync_1688_addresses", ...ADDRESS_WORKBENCH_PARAMS });
        nextAddresses = get1688AddressRows(result);
      }
      if (nextAddresses.length) {
        setAlibaba1688Addresses(nextAddresses);
        setLoadedOnce(true);
        writePageCache<ProductMasterDataCache>(PRODUCT_MASTER_DATA_CACHE_KEY, {
          generatedAt: new Date().toISOString(),
          accounts,
          suppliers,
          skus,
          alibaba1688Addresses: nextAddresses,
        });
      }
      return nextAddresses;
    } catch (error: any) {
      if (syncIfEmpty) message.error(error?.message || "1688 地址同步失败");
      return [];
    } finally {
      setAddressLoading(false);
    }
  }, [accounts, skus, suppliers]);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      if (mode !== "skus") {
        void loadAll({ silent: hasPageCache(cachedData) });
        return;
      }
      const snapshot = await readIndexedPageCache<ProductMasterDataSkuCache>(PRODUCT_MASTER_DATA_SKUS_CACHE_KEY, {});
      if (cancelled || !mountedRef.current) return;
      const cachedSkus = snapshot.skus || [];
      if (cachedSkus.length) {
        setSkus((current) => (current.length >= cachedSkus.length ? current : cachedSkus));
        setLoadedOnce(true);
      }
      void loadAll({
        silent: cachedSkus.length > 0,
        deferSkuCommit: cachedSkus.length > 0,
      });
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [cachedData, loadAll, mode]);

  const openCreateAccountModal = () => {
    accountForm.resetFields();
    accountForm.setFieldsValue({ label: "默认地址" });
    setAccountCreateModalOpen(true);
    if (!alibaba1688Addresses.length) void refresh1688Addresses(true);
  };

  const handleCreateAccount = async () => {
    if (!erp) return;
    const values = await accountForm.validateFields() as StoreAddressValues & { name: string; status?: string };
    setSubmitting("account");
    try {
      const account = await erp.account.upsert({
        name: values.name,
        status: values.status || "online",
        source: "product_master_data",
      });
      await erp.purchase.action(buildStoreAddressPayload(values, account.id));
      accountForm.resetFields();
      setAccountCreateModalOpen(false);
      message.success("店铺和 1688 地址已保存");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "店铺保存失败");
    } finally {
      setSubmitting(null);
    }
  };

  const openStoreAddressModal = (row: ErpAccountRow) => {
    setEditingStoreAddressAccount(row);
    storeAddressForm.resetFields();
    const selectedAddress = alibaba1688Addresses.find((address) => (
      (row.alibaba1688AddressRemoteId && address.addressId === row.alibaba1688AddressRemoteId)
      || address.id === row.alibaba1688AddressId
    ));
    storeAddressForm.setFieldsValue({
      ...getStoreAddressInitialValues(row),
      selected1688AddressId: selectedAddress?.id,
    });
    setStoreAddressModalOpen(true);
    if (!alibaba1688Addresses.length) void refresh1688Addresses(true);
  };

  const applySelected1688AddressToAccountForm = (addressId?: string) => {
    const address = addressId ? addressById.get(addressId) : null;
    if (!address) {
      accountForm.setFieldsValue({ selected1688AddressId: undefined, alibabaAddressId: undefined });
      return;
    }
    accountForm.setFieldsValue(get1688AddressFormValues(address));
  };

  const applySelected1688AddressToStoreForm = (addressId?: string) => {
    const address = addressId ? addressById.get(addressId) : null;
    if (!address) {
      storeAddressForm.setFieldsValue({ selected1688AddressId: undefined, alibabaAddressId: undefined });
      return;
    }
    storeAddressForm.setFieldsValue(get1688AddressFormValues(address));
  };

  const handleSaveStoreAddress = async () => {
    if (!erp || !editingStoreAddressAccount) return;
    const values = await storeAddressForm.validateFields();
    setSubmitting(`store-address:${editingStoreAddressAccount.id}`);
    try {
      await erp.purchase.action(buildStoreAddressPayload(
        values,
        editingStoreAddressAccount.id,
        editingStoreAddressAccount.alibaba1688AddressId,
      ));
      message.success("店铺 1688 地址已保存");
      setStoreAddressModalOpen(false);
      setEditingStoreAddressAccount(null);
      storeAddressForm.resetFields();
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "店铺 1688 地址保存失败");
    } finally {
      setSubmitting(null);
    }
  };

  const handleDeleteAccount = async (row: ErpAccountRow) => {
    if (!erp) return;
    setSubmitting(`delete-account:${row.id}`);
    try {
      try {
        await erp.account.delete({ id: row.id });
      } catch (error: any) {
        if (!isDeleteAccountHandlerMissing(error)) throw error;
        await erp.account.upsert({
          id: row.id,
          name: row.name,
          phone: row.phone || undefined,
          status: "deleted",
          source: row.source || "product_master_data",
        });
      }
      message.success("店铺已删除");
      if (editingStoreAddressAccount?.id === row.id) {
        setStoreAddressModalOpen(false);
        setEditingStoreAddressAccount(null);
      }
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "店铺删除失败");
    } finally {
      setSubmitting(null);
    }
  };

  const openSupplierModal = (row?: ErpSupplierRow) => {
    const supplier = row || null;
    setEditingSupplier(supplier);
    supplierForm.resetFields();
    supplierForm.setFieldsValue(supplier ? {
      supplierCode: supplier.supplierCode,
      name: supplier.name,
      contactName: supplier.contactName,
      phone: supplier.phone,
      wechat: supplier.wechat,
      address: supplier.address,
      categories: supplier.categories || [],
      supplierLevel: supplier.supplierLevel || "standard",
      paymentTerms: supplier.paymentTerms,
      leadDays: supplier.leadDays,
      taxRate: supplier.taxRate,
      settlementCurrency: supplier.settlementCurrency || "CNY",
      remark: supplier.remark,
      status: supplier.status || "active",
    } : {
      status: "active",
      categories: [],
      supplierLevel: "standard",
      settlementCurrency: "CNY",
    });
    setSupplierModalOpen(true);
  };

  const handleSaveSupplier = async () => {
    if (!erp) return;
    const values = await supplierForm.validateFields();
    setSubmitting("supplier");
    try {
      await erp.supplier.create({
        id: editingSupplier?.id,
        supplierCode: values.supplierCode,
        name: values.name,
        contactName: values.contactName,
        phone: values.phone,
        wechat: values.wechat,
        address: values.address,
        categories: values.categories || [],
        supplierLevel: values.supplierLevel || "standard",
        paymentTerms: values.paymentTerms,
        leadDays: values.leadDays ?? null,
        taxRate: values.taxRate ?? null,
        settlementCurrency: values.settlementCurrency || "CNY",
        remark: values.remark,
        status: values.status || "active",
      });
      supplierForm.resetFields();
      setSupplierModalOpen(false);
      setEditingSupplier(null);
      message.success(editingSupplier ? "供应商已保存" : "供应商已创建");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "供应商保存失败");
    } finally {
      setSubmitting(null);
    }
  };

  const handleToggleSupplierStatus = async (row: ErpSupplierRow) => {
    if (!erp) return;
    const nextStatus = row.status === "blocked" ? "active" : "blocked";
    setSubmitting(`supplier-status:${row.id}`);
    try {
      await erp.supplier.create({
        id: row.id,
        supplierCode: row.supplierCode || "",
        name: row.name,
        contactName: row.contactName || "",
        phone: row.phone || "",
        wechat: row.wechat || "",
        address: row.address || "",
        categories: row.categories || [],
        supplierLevel: row.supplierLevel || "standard",
        paymentTerms: row.paymentTerms || "",
        leadDays: row.leadDays ?? null,
        taxRate: row.taxRate ?? null,
        settlementCurrency: row.settlementCurrency || "CNY",
        remark: row.remark || "",
        status: nextStatus,
      });
      message.success(nextStatus === "blocked" ? "供应商已停用" : "供应商已启用");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "供应商状态更新失败");
    } finally {
      setSubmitting(null);
    }
  };

  const openSkuModal = (row?: ErpSkuRow) => {
    setEditingSku(row || null);
    skuForm.setFieldsValue(row ? {
      accountId: row.accountId || undefined,
      productName: row.productName || "",
      colorSpec: row.colorSpec || row.category || "",
    } : {
      accountId: accounts.length === 1 ? accounts[0].id : undefined,
      productName: "",
      colorSpec: "",
    });
    setSkuModalOpen(true);
  };

  const handleSaveSku = async () => {
    if (!erp) return;
    const values = await skuForm.validateFields() as SkuDialogValues;
    setSubmitting("sku");
    try {
      await erp.sku.create({
        id: editingSku?.id,
        accountId: values.accountId,
        productName: values.productName,
        colorSpec: values.colorSpec,
        status: editingSku?.status || "active",
      });
      skuForm.resetFields();
      setEditingSku(null);
      setSkuModalOpen(false);
      message.success(editingSku ? "商品资料已更新" : "商品资料已创建");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "商品资料保存失败");
    } finally {
      setSubmitting(null);
    }
  };

  const resetBundleModal = () => {
    setBundleModalOpen(false);
    setEditingBundleSku(null);
    setBundleComponents([]);
    setBundleLoadingComponents(false);
    bundleForm.resetFields();
  };

  const openBundleModal = async (row?: ErpSkuRow, initialSkus: ErpSkuRow[] = []) => {
    const bundleSku = row || null;
    setEditingBundleSku(bundleSku);
    bundleForm.resetFields();
    bundleForm.setFieldsValue({
      accountId: bundleSku?.accountId || (accounts.length === 1 ? accounts[0].id : undefined),
      internalSkuCode: bundleSku?.internalSkuCode || "",
      productName: bundleSku?.productName || "",
      colorSpec: bundleSku?.colorSpec || bundleSku?.category || "",
    });
    const initialComponents = initialSkus
      .filter((sku) => !isBundleSku(sku))
      .map((sku) => createBundleComponentDraft(sku.id));
    setBundleComponents(initialComponents.length ? initialComponents : [
      createBundleComponentDraft(),
      createBundleComponentDraft(),
    ]);
    setBundleModalOpen(true);
    if (!bundleSku?.id || !erp?.sku?.bundleComponents) return;
    setBundleLoadingComponents(true);
    try {
      const rows = await erp.sku.bundleComponents({ bundleSkuId: bundleSku.id });
      const nextComponents = (rows || []).map((component: any) => ({
        key: component.id || createBundleComponentDraft().key,
        skuId: component.componentSkuId,
        qty: Number(component.qty || 1),
      }));
      setBundleComponents(nextComponents.length ? nextComponents : [
        createBundleComponentDraft(),
        createBundleComponentDraft(),
      ]);
    } catch (error: any) {
      message.error(error?.message || "组合装明细读取失败");
    } finally {
      setBundleLoadingComponents(false);
    }
  };

  const updateBundleComponent = (key: string, patch: Partial<BundleComponentDraft>) => {
    setBundleComponents((current) => current.map((item) => (
      item.key === key ? { ...item, ...patch } : item
    )));
  };

  const addBundleComponent = () => {
    setBundleComponents((current) => [...current, createBundleComponentDraft()]);
  };

  const removeBundleComponent = (key: string) => {
    setBundleComponents((current) => {
      if (current.length <= 2) return current;
      return current.filter((item) => item.key !== key);
    });
  };

  const handleSaveBundle = async () => {
    if (!erp) return;
    const values = await bundleForm.validateFields() as SkuBundleDialogValues;
    const selectedRows = bundleComponentRows.filter((row) => row.skuId);
    if (selectedRows.length < 2) {
      message.warning("组合装至少选择 2 个普通商品");
      return;
    }
    const uniqueSkuIds = new Set(selectedRows.map((row) => row.skuId));
    if (uniqueSkuIds.size !== selectedRows.length) {
      message.warning("组合装子商品不能重复");
      return;
    }
    const missingCost = selectedRows.find((row) => row.unitCost === null);
    if (missingCost) {
      message.warning(`子商品缺成本价：${missingCost.sku?.internalSkuCode || missingCost.skuId}`);
      return;
    }
    setSubmitting("sku-bundle");
    try {
      await erp.sku.saveBundle({
        id: editingBundleSku?.id,
        accountId: values.accountId,
        internalSkuCode: values.internalSkuCode,
        productName: values.productName,
        colorSpec: values.colorSpec,
        status: editingBundleSku?.status || "active",
        components: selectedRows.map((row) => ({
          skuId: row.skuId!,
          qty: Number(row.qty || 1),
          unitCost: row.unitCost,
        })),
      });
      await erp.sku.sync?.({ mode: "incremental" }).catch(() => null);
      resetBundleModal();
      setSelectedSkuRowKeys([]);
      message.success(editingBundleSku ? "组合装已保存" : "组合装已创建");
      await loadAll({ forceFull: true });
    } catch (error: any) {
      message.error(error?.message || "组合装保存失败");
    } finally {
      setSubmitting(null);
    }
  };

  const accountColumns: ColumnsType<ErpAccountRow> = [
    { title: "店铺", dataIndex: "name", key: "name", width: 180, ellipsis: true },
    { title: "状态", dataIndex: "status", key: "status", width: 92, render: (value) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
    {
      title: "1688 地址",
      key: "alibaba1688Address",
      ellipsis: true,
      render: (_value, row) => {
        const summary = storeAddressSummary(row);
        return summary ? (
          <Space direction="vertical" size={2}>
            <span>{summary}</span>
            <span style={{ color: "#667085", fontSize: 12 }}>
              {[row.alibaba1688FullName, row.alibaba1688Mobile].filter(Boolean).join(" / ") || "-"}
            </span>
          </Space>
        ) : <Tag color="warning">未绑定</Tag>;
      },
    },
    ...(canManageStoreAddress ? [{
      title: "操作",
      key: "actions",
      width: 190,
      render: (_value: unknown, row: ErpAccountRow) => (
        <Space size={6}>
          <Button
            size="small"
            icon={<EditOutlined />}
            loading={submitting === `store-address:${row.id}`}
            onClick={() => openStoreAddressModal(row)}
          >
            1688 地址
          </Button>
          {canManageAccounts ? (
            <Popconfirm
              title="删除店铺"
              description="删除后该店铺不再出现在列表和后续选择中，历史单据会保留。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDeleteAccount(row)}
            >
              <Button
                danger
                size="small"
                type="text"
                icon={<DeleteOutlined />}
                loading={submitting === `delete-account:${row.id}`}
              >
                删除
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    }] : []),
  ];

  const supplierColumns: ColumnsType<ErpSupplierRow> = [
    {
      title: "供应商资料",
      key: "supplier",
      width: 260,
      fixed: "left",
      render: (_value, row) => {
        const level = supplierLevelMeta(row.supplierLevel);
        return (
          <Space direction="vertical" size={3}>
            <Space size={6} wrap>
              <span style={{ fontWeight: 700 }}>{row.name}</span>
              <Tag color={level.color} style={{ marginInlineEnd: 0 }}>{level.label}</Tag>
            </Space>
            <span style={{ color: "#667085", fontSize: 12 }}>{row.supplierCode || row.id}</span>
          </Space>
        );
      },
    },
    {
      title: "联系方式",
      key: "contact",
      width: 230,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <span>{row.contactName || "-"}</span>
          <span style={{ color: "#667085", fontSize: 12 }}>
            {[row.phone, row.wechat].filter(Boolean).join(" / ") || "-"}
          </span>
          {row.address ? <span style={{ color: "#667085", fontSize: 12 }}>{row.address}</span> : null}
        </Space>
      ),
    },
    {
      title: "经营类目",
      dataIndex: "categories",
      key: "categories",
      width: 210,
      render: (items: string[] = []) => items.length ? (
        <Space size={[4, 4]} wrap>
          {items.slice(0, 3).map((item) => <Tag key={item} style={{ marginInlineEnd: 0 }}>{item}</Tag>)}
          {items.length > 3 ? <Tag style={{ marginInlineEnd: 0 }}>+{items.length - 3}</Tag> : null}
        </Space>
      ) : <Tag color="warning">未维护</Tag>,
    },
    {
      title: "结算规则",
      key: "terms",
      width: 170,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <span>{optionLabel(PAYMENT_TERM_OPTIONS, row.paymentTerms)}</span>
          <span style={{ color: "#667085", fontSize: 12 }}>
            交期 {row.leadDays ?? "-"} 天 · 税率 {row.taxRate ?? "-"}%
          </span>
        </Space>
      ),
    },
    {
      title: "商品/货源",
      key: "linkage",
      width: 150,
      align: "right",
      sorter: (left, right) => Number(left.skuCount || 0) - Number(right.skuCount || 0),
      render: (_value, row) => (
        <Space direction="vertical" size={2} style={{ alignItems: "flex-end" }}>
          <span style={{ fontWeight: 700 }}>{Number(row.skuCount || 0)} 个商品</span>
          <span style={{ color: "#667085", fontSize: 12 }}>{Number(row.mappedSkuCount || 0)} 个 1688 货源</span>
        </Space>
      ),
    },
    {
      title: "采购表现",
      key: "purchase",
      width: 180,
      align: "right",
      sorter: (left, right) => Number(left.purchaseAmount || 0) - Number(right.purchaseAmount || 0),
      render: (_value, row) => (
        <Space direction="vertical" size={2} style={{ alignItems: "flex-end" }}>
          <span style={{ fontWeight: 700 }}>{formatMoney(row.purchaseAmount)}</span>
          <span style={{ color: "#667085", fontSize: 12 }}>
            {Number(row.purchaseOrderCount || 0)} 单 · 最近 {formatDateTime(row.lastPurchaseAt)}
          </span>
        </Space>
      ),
    },
    {
      title: "绩效分层",
      key: "performance",
      width: 180,
      sorter: (left, right) => getSupplierPerformanceScore(left) - getSupplierPerformanceScore(right),
      render: (_value, row) => {
        const band = getSupplierPerformanceBand(row);
        const meta = SUPPLIER_PERFORMANCE_META[band];
        const score = getSupplierPerformanceScore(row);
        return (
          <Space direction="vertical" size={4}>
            <Space size={6} wrap>
              <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>
              <span style={{ color: "#64748b", fontSize: 12 }}>{score} 分</span>
            </Space>
            <Tooltip title={getSupplierPerformanceReasons(row).join("；")}>
              <span style={{ color: "#64748b", fontSize: 12 }}>
                货源覆盖 {getSupplierMappedRate(row)}% · {Number(row.purchaseOrderCount || 0)} 单
              </span>
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: "风险等级",
      key: "risk",
      width: 170,
      sorter: (left, right) => getSupplierRiskScore(left) - getSupplierRiskScore(right),
      render: (_value, row) => {
        const riskLevel = getSupplierRiskLevel(row);
        const meta = SUPPLIER_RISK_META[riskLevel];
        const score = getSupplierRiskScore(row);
        const signals = getSupplierRiskSignals(row);
        return (
          <Space direction="vertical" size={4}>
            <Space size={6} wrap>
              <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>
              <span style={{ color: "#64748b", fontSize: 12 }}>{score} 分</span>
            </Space>
            {signals.length ? (
              <Tooltip title={signals.map((item) => item.detail).join("；")}>
                <span style={{ color: "#64748b", fontSize: 12 }}>
                  {signals.slice(0, 2).map((item) => item.label).join(" / ")}
                  {signals.length > 2 ? ` +${signals.length - 2}` : ""}
                </span>
              </Tooltip>
            ) : (
              <span style={{ color: "#16a34a", fontSize: 12 }}>可正常合作</span>
            )}
          </Space>
        );
      },
    },
    {
      title: "资料健康度",
      key: "health",
      width: 180,
      render: (_value, row) => {
        const percent = getSupplierCompleteness(row);
        const attentionKeys = getSupplierAttentionKeys(row);
        return (
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            <Progress
              percent={percent}
              size="small"
              status={attentionKeys.length ? "exception" : "success"}
              strokeColor={attentionKeys.length ? undefined : "#16a34a"}
            />
            <Space size={[4, 4]} wrap>
              <Tag color={statusColor(row.status)} style={{ marginInlineEnd: 0 }}>{statusLabel(row.status)}</Tag>
              {attentionKeys.length ? <Tag color="warning" style={{ marginInlineEnd: 0 }}>待完善</Tag> : <Tag color="success" style={{ marginInlineEnd: 0 }}>完整</Tag>}
            </Space>
          </Space>
        );
      },
    },
    { title: "更新时间", dataIndex: "updatedAt", key: "updatedAt", width: 142, render: formatDateTime },
    {
      title: "操作",
      key: "actions",
      width: canManageSuppliers ? 220 : 96,
      fixed: "right" as const,
      render: (_value: unknown, row: ErpSupplierRow) => (
        <Space size={6}>
          <Button size="small" onClick={() => setSupplierDetailRow(row)}>
            日志
          </Button>
          {canManageSuppliers ? (
            <>
              <Button size="small" icon={<EditOutlined />} onClick={() => openSupplierModal(row)}>
                编辑
              </Button>
              <Button
                size="small"
                danger={row.status !== "blocked"}
                loading={submitting === `supplier-status:${row.id}`}
                onClick={() => handleToggleSupplierStatus(row)}
              >
                {row.status === "blocked" ? "启用" : "停用"}
              </Button>
            </>
          ) : null}
        </Space>
      ),
    },
  ];

  const renderSkuImage = (row: ErpSkuRow, size = 44) => row.imageUrl ? (
    <Image
      src={row.imageUrl}
      alt="商品图片"
      width={size}
      height={size}
      preview={{ mask: "查看" }}
      style={{ borderRadius: 6, objectFit: "cover", background: "#f5f7fb" }}
    />
  ) : (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        border: "1px dashed #d8dee9",
        color: "#98a2b3",
        fontSize: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fbff",
      }}
    >
      无图
    </div>
  );

  const bundleColumns: ColumnsType<BundleComponentView> = [
    {
      title: "普通商品",
      key: "sku",
      render: (_value, row) => (
        <Select
          showSearch
          optionFilterProp="label"
          options={normalSkuOptions}
          value={row.skuId}
          placeholder="选择普通商品"
          style={{ width: "100%" }}
          onChange={(value) => updateBundleComponent(row.key, { skuId: value })}
        />
      ),
    },
    {
      title: "数量",
      key: "qty",
      width: 120,
      render: (_value, row) => (
        <InputNumber
          min={1}
          precision={0}
          value={row.qty}
          style={{ width: "100%" }}
          onChange={(value) => updateBundleComponent(row.key, { qty: Number(value || 1) })}
        />
      ),
    },
    {
      title: "成本价",
      key: "unitCost",
      width: 110,
      render: (_value, row) => {
        if (!row.skuId) return "-";
        return row.unitCost === null ? <Tag color="red">缺成本</Tag> : formatMoney(row.unitCost);
      },
    },
    {
      title: "小计",
      key: "lineCost",
      width: 110,
      render: (_value, row) => (row.lineCost === null ? "-" : <strong>{formatMoney(row.lineCost)}</strong>),
    },
    {
      title: "操作",
      key: "actions",
      width: 80,
      align: "right",
      render: (_value, row) => (
        <Button
          danger
          size="small"
          type="text"
          icon={<DeleteOutlined />}
          disabled={bundleComponents.length <= 2}
          onClick={() => removeBundleComponent(row.key)}
        />
      ),
    },
  ];

  const skuColumns: ColumnsType<ErpSkuRow> = [
    {
      title: "图片",
      dataIndex: "imageUrl",
      key: "imageUrl",
      width: 72,
      render: (_value, row) => renderSkuImage(row),
    },
    {
      title: "商品",
      key: "product",
      width: 300,
      render: (_value, row) => {
        const title = row.productName || "-";
        return (
          <div
            style={{
              alignItems: "flex-start",
              display: "flex",
              gap: 6,
              maxWidth: "100%",
              minWidth: 0,
              width: "100%",
            }}
          >
            <span
              title={title}
              style={{
                color: "#0f172a",
                display: "block",
                flex: "1 1 auto",
                fontWeight: 600,
                minWidth: 0,
                lineHeight: "20px",
                whiteSpace: "normal",
                wordBreak: "break-word",
              }}
            >
              {title}
            </span>
            {isBundleSku(row) ? (
              <Tag color="purple" style={{ flex: "0 0 auto", marginInlineEnd: 0 }}>
                组合装{Number(row.bundleComponentCount || 0) > 0 ? ` ${row.bundleComponentCount}件` : ""}
              </Tag>
            ) : null}
          </div>
        );
      },
    },
    {
      title: "商品编码",
      dataIndex: "internalSkuCode",
      key: "internalSkuCode",
      width: 128,
      ellipsis: true,
      render: (value) => {
        const code = value || "-";
        return <span title={code} style={{ color: "#475569", fontSize: 12 }}>{code}</span>;
      },
    },
    { title: "规格", dataIndex: "colorSpec", key: "colorSpec", width: 190, ellipsis: true, render: (value, row) => { const text = value || row.category || "-"; return <span title={text}>{text}</span>; } },
    {
      title: "库存",
      key: "stockQty",
      width: 90,
      sorter: (left, right) => getSkuStockQty(left) - getSkuStockQty(right),
      sortDirections: ["descend", "ascend"],
      render: (_value, row) => (
        <Button
          type="link"
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            setStockDetailRow(row);
          }}
          style={{ color: "#2563eb", fontWeight: 700, height: "auto", padding: 0 }}
        >
          {getSkuStockQty(row)}
        </Button>
      ),
    },
    {
      title: "仓位",
      key: "warehouseLocation",
      width: 120,
      render: (_value, row) => {
        const location = getSkuWarehouseLocation(row) || "-";
        return (
          <span title={location} style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
            {location}
          </span>
        );
      },
    },
    {
      title: "店铺",
      dataIndex: "accountId",
      key: "accountId",
      width: 120,
      ellipsis: true,
      render: (value, row) => row.accountName || accountNameById.get(value) || "-",
    },
    {
      title: "供应商",
      dataIndex: "jstSupplierName",
      key: "supplier",
      width: 150,
      ellipsis: true,
      render: (_value, row) => getSkuSupplierText(row) || "-",
    },
    {
      title: "成本价",
      dataIndex: "costPrice",
      key: "costPrice",
      width: 100,
      render: (value, row) => {
        const hasCost = getSkuCostPrice(row) !== null;
        const missingCostQty = Number(row.missingCostStockQty || 0);
        if (!hasCost) {
          return (
            <Space size={4} wrap>
              <span>-</span>
              {missingCostQty > 0 ? <Tag color="red">缺成本 {missingCostQty}</Tag> : null}
            </Space>
          );
        }
        const costText = formatMoney(value ?? row.jstCostPrice);
        return (
          <Space size={4} wrap>
            <Button
              type="link"
              size="small"
              icon={<LineChartOutlined />}
              onClick={(event) => {
                event.stopPropagation();
                setCostDetailRow(row);
              }}
              style={{
                color: hasCost ? "#2563eb" : "#dc2626",
                fontWeight: 700,
                height: "auto",
                padding: 0,
              }}
            >
              {costText}
            </Button>
            {missingCostQty > 0 ? <Tag color="red">缺成本 {missingCostQty}</Tag> : null}
          </Space>
        );
      },
    },
    { title: "更新", dataIndex: "updatedAt", key: "updatedAt", width: 128, render: (_value, row) => formatDateTime(getSkuTouchedAt(row)) },
    {
      title: "操作",
      key: "actions",
      width: 150,
      fixed: "right",
      align: "right",
      render: (_value, row) => (
        <Space size={6}>
          <Button size="small" onClick={() => setSkuDetailRow(row)}>
            日志
          </Button>
          {canManageSkus ? (
            <Button size="small" icon={<EditOutlined />} onClick={() => (isBundleSku(row) ? openBundleModal(row) : openSkuModal(row))}>
              编辑
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];
  const skuRowSelection = {
    selectedRowKeys: selectedSkuRowKeys,
    preserveSelectedRowKeys: true,
    onChange: (nextKeys: Key[]) => setSelectedSkuRowKeys(nextKeys),
  };

  const renderAccountCreateForm = () => (
    <Form form={accountForm} layout="vertical">
      <Form.Item name="alibabaAddressId" hidden>
        <Input />
      </Form.Item>
      <Row gutter={12}>
        <Col xs={24} md={10}>
          <Form.Item name="name" label="店铺名称" rules={[{ required: true, message: "请输入店铺名称" }]}>
            <Input placeholder="例如：主店铺" />
          </Form.Item>
        </Col>
        <Col xs={24} md={14}>
          <Form.Item name="selected1688AddressId" label="选择 1688 地址">
            <Select
              allowClear
                  showSearch
                  optionFilterProp="label"
                  options={alibaba1688AddressOptions}
                  loading={addressLoading}
                  notFoundContent={addressLoading ? "正在加载 1688 地址…" : "暂无 1688 地址"}
                  placeholder="从已同步地址选择"
                  onChange={applySelected1688AddressToAccountForm}
                />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item name="label" label="地址名称" initialValue="默认地址" rules={[{ required: true, message: "请输入地址名称" }]}>
            <Input placeholder="默认地址" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="fullName" label="收件人" rules={[{ required: true, message: "请输入收件人" }]}>
            <Input placeholder="收件人姓名" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="mobile" label="手机号" rules={[{ required: true, message: "请输入手机号" }]}>
            <Input placeholder="13800000000" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="postCode" label="邮编">
            <Input placeholder="310000" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="provinceText" label="省">
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="cityText" label="市">
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="areaText" label="区">
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24}>
          <Form.Item name="address" label="详细地址" rules={[{ required: true, message: "请输入详细地址" }]}>
            <Input />
          </Form.Item>
        </Col>
      </Row>
    </Form>
  );

  const tableLoading = loading && !loadedOnce && (accounts.length + suppliers.length + skus.length > 0);

  const renderAccountManager = () => (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {canManageAccounts ? (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateAccountModal}>
            绑定店铺
          </Button>
        </div>
      ) : (
        <Alert type="info" showIcon message="当前角色仅可查看店铺。" style={{ marginBottom: 12 }} />
      )}
      <Table
        size="small"
        rowKey="id"
        loading={tableLoading}
        columns={accountColumns}
        dataSource={accounts}
        pagination={{ pageSize: 5, showSizeChanger: false }}
      />
    </Space>
  );

  if (mode === "suppliers" && !canViewSuppliers) {
    return (
      <div className={embedded ? "product-master-data-embedded" : "dashboard-shell"}>
        {!embedded ? <PageHeader compact eyebrow="系统" title={pageTitle} /> : null}
        <Alert type="warning" showIcon message="供应商资料仅采购和管理员可见" />
      </div>
    );
  }

  if (!erp) {
    return (
      <div className={embedded ? "product-master-data-embedded" : "dashboard-shell"}>
        {!embedded ? <PageHeader compact eyebrow="系统" title={pageTitle} subtitle="服务未就绪，请重启软件" /> : null}
        <Alert type="error" showIcon message="当前环境缺少本地服务接口" />
      </div>
    );
  }

  return (
    <div className={embedded ? "product-master-data-embedded" : "dashboard-shell"}>
      {!embedded ? (
        <PageHeader
          compact
          className="product-master-page-header"
          eyebrow="系统"
          title={pageTitle}
          meta={pageMeta}
          actions={[
          mode === "skus" && canManageSkus ? (
            <Button
              key="new-sku"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => openSkuModal()}
            >
              新增商品
            </Button>
          ) : null,
          mode === "skus" && canManageSkus ? (
            <Button
              key="new-bundle"
              icon={<PlusOutlined />}
              onClick={() => openBundleModal()}
            >
              新增组合装
            </Button>
          ) : null,
          mode === "suppliers" && canManageSuppliers ? (
            <Button key="new-supplier" type="primary" icon={<PlusOutlined />} onClick={() => openSupplierModal()}>
              新增供应商
            </Button>
          ) : null,
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={() => void loadAll({ forceFull: true })}>
            刷新
          </Button>,
          ].filter(Boolean)}
        />
      ) : null}

      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {mode === "skus" ? (
        <div className="app-panel product-master-data-panel product-master-data-panel--skus">
          <div className="app-panel__title">
            <div>
              <div className="app-panel__title-main">商品资料</div>
            </div>
          </div>
          {!canManageSkus ? (
            <Alert type="info" showIcon message="当前角色仅可查看商品资料。" style={{ marginBottom: 12 }} />
          ) : null}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 8,
              marginBottom: 12,
            }}
          >
            {skuQualityCards.map((item) => {
              const clickable = Boolean(item.issue || item.hasIssue);
              const active = Boolean(
                (item.issue && skuFilters.issue === item.issue)
                || (item.hasIssue && skuFilters.hasIssue && !skuFilters.issue),
              );
              const applyCardFilter = () => setSkuFilters((current) => ({
                ...current,
                issue: item.issue,
                hasIssue: item.hasIssue,
              }));
              return (
                <div
                  key={item.label}
                  role={clickable ? "button" : undefined}
                  aria-pressed={clickable ? active : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? applyCardFilter : undefined}
                  onKeyDown={clickable ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      applyCardFilter();
                    }
                  } : undefined}
                  style={{
                    border: `1px solid ${active ? item.tone : "#e5e7eb"}`,
                    borderLeft: `3px solid ${item.tone}`,
                    borderRadius: 6,
                    padding: "8px 10px",
                    background: active ? "#f8fafc" : "#fff",
                    boxShadow: active ? "0 0 0 2px rgba(37, 99, 235, 0.08)" : undefined,
                    cursor: clickable ? "pointer" : "default",
                    minWidth: 0,
                  }}
                >
                  <div style={{ color: "#64748b", fontSize: 12, lineHeight: "18px" }}>{item.label}</div>
                  <div style={{ color: "#0f172a", fontSize: 18, fontWeight: 700, lineHeight: "24px" }}>{item.value}</div>
                </div>
              );
            })}
          </div>
          <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
            <Col xs={24} md={10}>
              <Input
                allowClear
                placeholder="商品编码 / 标题 / 规格 / 供应商"
                value={skuFilters.keyword}
                onChange={(event) => setSkuFilters((current) => ({ ...current, keyword: event.target.value }))}
              />
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="店铺"
                style={{ width: "100%" }}
                value={skuFilters.accountId}
                options={accountOptions}
                onChange={(value) => setSkuFilters((current) => ({ ...current, accountId: value }))}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Select
                allowClear
                placeholder="状态"
                style={{ width: "100%" }}
                value={skuFilters.status}
                options={[
                  { label: "启用", value: "active" },
                  { label: "停用", value: "blocked" },
                ]}
                onChange={(value) => setSkuFilters((current) => ({ ...current, status: value }))}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Button block disabled={!hasSkuFilters} onClick={() => setSkuFilters({ keyword: "" })}>
                清空
              </Button>
            </Col>
          </Row>
          {skuActiveFilterTags.length ? (
            <div
              style={{
                alignItems: "center",
                background: "#f8fafc",
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                justifyContent: "space-between",
                marginBottom: 12,
                padding: "7px 10px",
              }}
            >
              <Space size={[6, 6]} wrap>
                <span style={{ color: "#64748b", fontSize: 12 }}>当前筛选</span>
                {skuActiveFilterTags.map((tag) => (
                  <Tag
                    key={tag.key}
                    closable
                    color={tag.color}
                    onClose={() => setSkuFilters(tag.clear)}
                    style={{ marginInlineEnd: 0 }}
                  >
                    {tag.label}
                  </Tag>
                ))}
              </Space>
              <Button size="small" type="text" onClick={() => setSkuFilters({ keyword: "" })}>
                清空
              </Button>
            </div>
          ) : null}
          {selectedSkus.length ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
                border: "1px solid #dbeafe",
                borderRadius: 6,
                background: "#eff6ff",
                padding: "8px 10px",
                marginBottom: 12,
              }}
            >
              <Space size={[6, 6]} wrap>
                <span style={{ color: "#0f172a", fontWeight: 700 }}>已选 {selectedSkus.length} 个</span>
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>店铺 {selectedSkuSummary.storeCount || "-"}</Tag>
                <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>库存 {selectedSkuSummary.totalStock}</Tag>
                <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                  问题 {selectedSkuSummary.pendingCount}
                </Tag>
              </Space>
              <Space size={6} wrap>
                <Button
                  size="small"
                  disabled={!selectedSkuSummary.pendingCount}
                  onClick={() => setSkuFilters((current) => ({ ...current, hasIssue: true, issue: undefined }))}
                >
                  只看问题
                </Button>
                <Button size="small" onClick={() => setSkuDetailRow(selectedSkus[0])}>
                  打开日志
                </Button>
                {canManageSkus ? (
                  <Button
                    size="small"
                    disabled={selectedSkus.filter((sku) => !isBundleSku(sku)).length < 2}
                    onClick={() => openBundleModal(undefined, selectedSkus)}
                  >
                    组合装
                  </Button>
                ) : null}
                <Button size="small" onClick={() => setSelectedSkuRowKeys([])}>
                  取消选择
                </Button>
              </Space>
            </div>
          ) : null}
          <Table
            className="product-master-data-table product-master-data-table--skus"
            size="small"
            rowKey="id"
            loading={tableLoading}
            columns={skuColumns}
            dataSource={filteredSkus}
            rowSelection={skuRowSelection}
            onRow={(row) => ({
              onDoubleClick: () => setSkuDetailRow(row),
            })}
            scroll={{ x: 1728, y: "max(220px, calc(100vh - 500px))" }}
            pagination={{
              defaultPageSize: 20,
              pageSizeOptions: [10, 20, 50, 100, 200],
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
            }}
          />
        </div>
        ) : null}

        {mode === "suppliers" ? (
        <div className="app-panel product-master-data-panel product-master-data-panel--suppliers">
          <div className="app-panel__title">
            <div>
              <div className="app-panel__title-main">供应商</div>
              <div className="app-panel__title-sub">维护供应商资料、联系方式、经营类目和采购关系。</div>
            </div>
            {embedded ? (
              <Space size={8} wrap>
                {canManageSuppliers ? (
                  <>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openSupplierModal()}>
                      新增供应商
                    </Button>
                  </>
                ) : null}
                <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadAll({ forceFull: true })}>
                  刷新
                </Button>
              </Space>
            ) : null}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: 8,
              marginBottom: 12,
            }}
          >
            {[
              { label: "供应商总数", value: supplierSummary.total, tone: "#2563eb" },
              { label: "优选/战略", value: supplierSummary.preferredCount, tone: "#16a34a" },
              { label: "核心供应商", value: supplierSummary.performanceCounts.core, tone: SUPPLIER_PERFORMANCE_META.core.tone },
              { label: "待验证", value: supplierSummary.performanceCounts.trial, tone: SUPPLIER_PERFORMANCE_META.trial.tone },
              { label: "高风险", value: supplierSummary.riskCounts.high, tone: SUPPLIER_RISK_META.high.tone },
              { label: "平均交期", value: supplierSummary.avgLeadDays === null ? "-" : `${supplierSummary.avgLeadDays} 天`, tone: "#64748b" },
              { label: "关联商品", value: supplierSummary.totalSkuCount, tone: "#0891b2" },
              { label: "1688 货源", value: supplierSummary.totalMappedSkuCount, tone: "#7c3aed" },
              { label: "采购金额", value: formatMoney(supplierSummary.purchaseAmount), tone: "#ea580c" },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  border: "1px solid #e5e7eb",
                  borderLeft: `3px solid ${item.tone}`,
                  borderRadius: 6,
                  padding: "8px 10px",
                  background: "#fff",
                  minWidth: 0,
                }}
              >
                <div style={{ color: "#64748b", fontSize: 12, lineHeight: "18px" }}>{item.label}</div>
                <div style={{ color: "#0f172a", fontSize: 18, fontWeight: 700, lineHeight: "24px" }}>{item.value}</div>
              </div>
            ))}
          </div>
          {canManageSuppliers ? (
            null
          ) : (
            <Alert type="info" showIcon message="当前角色仅可查看供应商。" style={{ marginBottom: 12 }} />
          )}
          <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
            <Col xs={24} md={5}>
              <Input
                allowClear
                placeholder="供应商 / 联系人 / 电话 / 微信 / 地址"
                value={supplierFilters.keyword}
                onChange={(event) => setSupplierFilters((current) => ({ ...current, keyword: event.target.value }))}
              />
            </Col>
            <Col xs={12} sm={8} md={3}>
              <Select
                allowClear
                placeholder="状态"
                style={{ width: "100%" }}
                value={supplierFilters.status}
                options={[
                  { label: "启用", value: "active" },
                  { label: "停用", value: "blocked" },
                ]}
                onChange={(value) => setSupplierFilters((current) => ({ ...current, status: value }))}
              />
            </Col>
            <Col xs={12} sm={8} md={3}>
              <Select
                allowClear
                placeholder="等级"
                style={{ width: "100%" }}
                value={supplierFilters.supplierLevel}
                options={SUPPLIER_LEVEL_OPTIONS}
                onChange={(value) => setSupplierFilters((current) => ({ ...current, supplierLevel: value }))}
              />
            </Col>
            <Col xs={12} sm={8} md={3}>
              <Select
                allowClear
                placeholder="绩效分层"
                style={{ width: "100%" }}
                value={supplierFilters.performanceBand}
                options={SUPPLIER_PERFORMANCE_OPTIONS}
                onChange={(value) => setSupplierFilters((current) => ({ ...current, performanceBand: value }))}
              />
            </Col>
            <Col xs={12} sm={8} md={3}>
              <Select
                allowClear
                placeholder="风险等级"
                style={{ width: "100%" }}
                value={supplierFilters.riskLevel}
                options={SUPPLIER_RISK_OPTIONS}
                onChange={(value) => setSupplierFilters((current) => ({ ...current, riskLevel: value }))}
              />
            </Col>
            <Col xs={12} sm={8} md={3}>
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="经营类目"
                style={{ width: "100%" }}
                value={supplierFilters.category}
                options={supplierCategoryOptions}
                onChange={(value) => setSupplierFilters((current) => ({ ...current, category: value }))}
              />
            </Col>
            <Col xs={12} sm={8} md={3}>
              <Select
                allowClear
                placeholder="待完善"
                style={{ width: "100%" }}
                value={supplierFilters.attention}
                options={[
                  { label: "缺联系人", value: "missing_contact" },
                  { label: "缺类目", value: "missing_category" },
                  { label: "缺结算", value: "missing_terms" },
                  { label: "无商品", value: "no_sku" },
                  { label: "无货源", value: "no_mapping" },
                ]}
                onChange={(value) => setSupplierFilters((current) => ({ ...current, attention: value }))}
              />
            </Col>
            <Col xs={24} md={2}>
              <Button block disabled={!hasSupplierFilters} onClick={() => setSupplierFilters({ keyword: "" })}>
                清空
              </Button>
            </Col>
          </Row>
          <Table
            size="small"
            rowKey="id"
            loading={tableLoading}
            columns={supplierColumns}
            dataSource={filteredSuppliers}
            scroll={{ x: 1850, y: "max(220px, calc(100vh - 540px))" }}
            pagination={{
              defaultPageSize: 20,
              pageSizeOptions: [10, 20, 50, 100, 200],
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
            }}
          />
        </div>
        ) : null}

        {mode === "stores" ? (
        <div className="app-panel">
          <div className="app-panel__title">
            <div>
              <div className="app-panel__title-main">店铺</div>
            </div>
          </div>
          {renderAccountManager()}
        </div>
        ) : null}
      </Space>

      <Modal
        title="查看商品修改日志"
        open={Boolean(skuDetailRow)}
        centered
        footer={null}
        width={1280}
        onCancel={() => setSkuDetailRow(null)}
        destroyOnClose
      >
        {skuDetailRow ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space size={8} wrap>
              <Button type="primary">按商品</Button>
              <Input value={skuDetailRow.internalSkuCode || skuDetailRow.id} readOnly style={{ width: 160 }} />
              {canManageSkus ? (
                <Button
                  icon={<EditOutlined />}
                  onClick={() => {
                    const row = skuDetailRow;
                    setSkuDetailRow(null);
                    openSkuModal(row);
                  }}
                >
                  编辑
                </Button>
              ) : null}
            </Space>
            <Table<SkuLogRecord>
              rowKey="key"
              size="small"
              pagination={{ defaultPageSize: 20, showSizeChanger: false, showTotal: (total) => `共 ${total} 条` }}
              dataSource={skuLogRecords}
              scroll={{ x: 980, y: 420 }}
              columns={[
                { title: "商品编码", dataIndex: "skuCode", key: "skuCode", width: 150, ellipsis: true },
                { title: "操作内容", dataIndex: "content", key: "content", ellipsis: true },
                { title: "操作", dataIndex: "action", key: "action", width: 180, ellipsis: true },
                { title: "操作人", dataIndex: "operator", key: "operator", width: 130, ellipsis: true },
                { title: "操作时间", dataIndex: "at", key: "at", width: 170, render: formatDateTime },
              ]}
            />
          </Space>
        ) : null}
      </Modal>

      <Modal
        title={(
          <Space size={8}>
            <span>查看库存明细-实际库存数</span>
            <Tag>{stockDetailRow?.internalSkuCode || stockDetailRow?.id || "-"}</Tag>
          </Space>
        )}
        open={Boolean(stockDetailRow)}
        centered
        width={1120}
        footer={null}
        onCancel={() => setStockDetailRow(null)}
        destroyOnClose
      >
        {stockDetailRow ? (
          <Table<SkuStockRecord>
            rowKey="key"
            size="small"
            loading={stockDetailLoading}
            pagination={{ defaultPageSize: 20, showSizeChanger: false, showTotal: (total) => `共 ${total} 条` }}
            dataSource={stockDetailRecords}
            scroll={{ x: 1600, y: 420 }}
            columns={[
              { title: "序号", width: 64, render: (_value, _row, index) => index + 1 },
              { title: "业务类型", dataIndex: "businessType", key: "businessType", width: 120 },
              { title: "日期", dataIndex: "date", key: "date", width: 160, render: formatDateTime },
              {
                title: "库存数",
                dataIndex: "qty",
                key: "qty",
                width: 110,
                align: "right",
                render: (value) => (
                  <span style={{ color: Number(value) > 0 ? "#16a34a" : "#0f172a", fontWeight: 700 }}>
                    {value}
                  </span>
                ),
              },
              { title: "当前库存", dataIndex: "currentQty", key: "currentQty", width: 100, align: "right" },
              { title: "货款单价", dataIndex: "unitCost", key: "unitCost", width: 110, align: "right", render: formatMoney },
              { title: "单件运费", dataIndex: "unitFreightCost", key: "unitFreightCost", width: 110, align: "right", render: formatMoney },
              { title: "入库成本", dataIndex: "unitLandedCost", key: "unitLandedCost", width: 110, align: "right", render: formatMoney },
              { title: "库存金额", dataIndex: "stockValue", key: "stockValue", width: 120, align: "right", render: formatMoney },
              {
                title: "成本状态",
                dataIndex: "costStatus",
                key: "costStatus",
                width: 110,
                render: (value, row) => value === "missing"
                  ? <Tag color="red">缺成本 {row.missingCostQty || row.currentQty || 0}</Tag>
                  : <Tag color="green">已确认</Tag>,
              },
              { title: "单号", dataIndex: "orderNo", key: "orderNo", width: 150, ellipsis: true },
              { title: "内部订单号", dataIndex: "poNo", key: "poNo", width: 140, ellipsis: true },
              { title: "仓位", dataIndex: "warehouse", key: "warehouse", width: 130, ellipsis: true },
              { title: "店铺", dataIndex: "store", key: "store", width: 110, ellipsis: true },
              { title: "操作人", dataIndex: "operator", key: "operator", width: 130, ellipsis: true },
            ]}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={3}>
                  <strong>小计</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">
                  <strong>{stockDetailTotal}</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  <strong>{stockDetailCurrentTotal}</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} colSpan={3}>
                  <strong>加权成本：{formatMoney(stockDetailWeightedCost)}</strong>
                  {stockDetailMissingCostTotal > 0 ? <Tag color="red" style={{ marginLeft: 8 }}>缺成本 {stockDetailMissingCostTotal}</Tag> : null}
                  {stockDetailCostedTotal > 0 ? <Tag color="green" style={{ marginLeft: 4 }}>已确认 {stockDetailCostedTotal}</Tag> : null}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={8} align="right">
                  <strong>{formatMoney(stockDetailValueTotal)}</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={9} colSpan={6} />
              </Table.Summary.Row>
            )}
          />
        ) : null}
      </Modal>

      <Modal
        title={(
          <Space size={8}>
            <span>查看历史成本价</span>
            <Tag>{costDetailRow?.internalSkuCode || costDetailRow?.id || "-"}</Tag>
          </Space>
        )}
        open={Boolean(costDetailRow)}
        centered
        width={960}
        footer={null}
        onCancel={() => setCostDetailRow(null)}
        destroyOnClose
      >
        {costDetailRow ? (
          <Table<SkuCostRecord>
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={costDetailRecords}
            locale={{ emptyText: "暂无成本明细" }}
            scroll={{ x: 840, y: 420 }}
            columns={[
              { title: "序号", width: 64, render: (_value, _row, index) => index + 1 },
              { title: "开始日期", dataIndex: "startAt", key: "startAt", width: 140, render: formatDateTime },
              { title: "截止日期", dataIndex: "endAt", key: "endAt", width: 140, render: formatDateTime },
              {
                title: "成本价",
                dataIndex: "amount",
                key: "amount",
                width: 120,
                align: "right",
                render: (value) => <strong>{formatMoney(value as number | string)}</strong>,
              },
              { title: "备注", dataIndex: "note", key: "note", width: 140, render: (value) => value || "-" },
              { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 160, render: formatDateTime },
              { title: "修改时间", dataIndex: "updatedAt", key: "updatedAt", width: 160, render: formatDateTime },
            ]}
          />
        ) : null}
      </Modal>

      <Drawer
        title="供应商工作日志"
        open={Boolean(supplierDetailRow)}
        width={620}
        onClose={() => setSupplierDetailRow(null)}
        destroyOnClose
      >
        {supplierDetailRow ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {(() => {
              const riskLevel = getSupplierRiskLevel(supplierDetailRow);
              const riskMeta = SUPPLIER_RISK_META[riskLevel];
              const riskScore = getSupplierRiskScore(supplierDetailRow);
              const riskSignals = getSupplierRiskSignals(supplierDetailRow);
              return (
                <Alert
                  type={riskLevel === "high" ? "error" : riskLevel === "medium" ? "warning" : "success"}
                  showIcon
                  message={`供应商风险：${riskMeta.label}（${riskScore} 分）`}
                  description={riskSignals.length
                    ? riskSignals.map((item) => item.detail).join("；")
                    : "资料、结算和货源关系完整，可正常进入采购履约。"}
                />
              );
            })()}
            {(() => {
              const band = getSupplierPerformanceBand(supplierDetailRow);
              const meta = SUPPLIER_PERFORMANCE_META[band];
              const score = getSupplierPerformanceScore(supplierDetailRow);
              return (
                <Alert
                  type={band === "governance" ? "warning" : band === "core" ? "success" : "info"}
                  showIcon
                  message={`ERP 绩效分层：${meta.label}（${score} 分）`}
                  description={`${meta.detail} ${getSupplierPerformanceReasons(supplierDetailRow).join("；")}。`}
                />
              );
            })()}
            <div>
              <Space size={[6, 6]} wrap>
                <span style={{ color: "#0f172a", fontSize: 18, fontWeight: 700 }}>{supplierDetailRow.name}</span>
                <Tag color={supplierLevelMeta(supplierDetailRow.supplierLevel).color}>
                  {supplierLevelMeta(supplierDetailRow.supplierLevel).label}
                </Tag>
                <Tag color={statusColor(supplierDetailRow.status)}>{statusLabel(supplierDetailRow.status)}</Tag>
              </Space>
              <div style={{ color: "#64748b", marginTop: 6 }}>{supplierDetailRow.supplierCode || supplierDetailRow.id}</div>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ color: "#0f172a", fontWeight: 600 }}>资料健康度</span>
                <span style={{ color: "#64748b" }}>{getSupplierCompleteness(supplierDetailRow)}%</span>
              </div>
              <Progress
                percent={getSupplierCompleteness(supplierDetailRow)}
                status={supplierDetailAttention.length ? "exception" : "success"}
                strokeColor={supplierDetailAttention.length ? undefined : "#16a34a"}
              />
              <Space size={[6, 6]} wrap>
                {supplierDetailAttention.length ? supplierDetailAttention.map((key) => {
                  const meta = SUPPLIER_ATTENTION_META[key];
                  return (
                    <Tooltip key={key} title={meta?.detail || key}>
                      <Tag color={meta?.color || "default"}>{meta?.label || key}</Tag>
                    </Tooltip>
                  );
                }) : (
                  <Tag color="success">资料完整</Tag>
                )}
              </Space>
            </div>

            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                background: "#fff",
                padding: 12,
              }}
            >
              <div style={{ color: "#0f172a", fontWeight: 700, marginBottom: 10 }}>工作日志</div>
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                {supplierDetailWorkLogItems.map((item) => (
                  <div
                    key={item.key}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto minmax(0, 1fr)",
                      gap: 8,
                      alignItems: "start",
                    }}
                  >
                    <Tag color={item.color} style={{ marginInlineEnd: 0 }}>
                      {item.title.startsWith("问题") ? "问题" : "记录"}
                    </Tag>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: "#0f172a", fontWeight: 600, lineHeight: "20px" }}>{item.title}</div>
                      <div style={{ color: "#64748b", fontSize: 12, lineHeight: "18px", marginTop: 2 }}>{item.description}</div>
                    </div>
                  </div>
                ))}
              </Space>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 8,
              }}
            >
              {[
                { label: "关联商品", value: Number(supplierDetailRow.skuCount || 0) },
                { label: "1688 货源", value: Number(supplierDetailRow.mappedSkuCount || 0) },
                { label: "货源覆盖", value: `${getSupplierMappedRate(supplierDetailRow)}%` },
                { label: "绩效得分", value: getSupplierPerformanceScore(supplierDetailRow) },
                { label: "采购单", value: Number(supplierDetailRow.purchaseOrderCount || 0) },
                { label: "采购金额", value: formatMoney(supplierDetailRow.purchaseAmount) },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 6,
                    padding: "10px 12px",
                    background: "#fff",
                    minWidth: 0,
                  }}
                >
                  <div style={{ color: "#64748b", fontSize: 12 }}>{item.label}</div>
                  <div style={{ color: "#0f172a", fontSize: 18, fontWeight: 700 }}>{item.value}</div>
                </div>
              ))}
            </div>

            <Descriptions
              bordered
              size="small"
              column={1}
              items={[
                { key: "code", label: "供应商编码", children: supplierDetailRow.supplierCode || "-" },
                { key: "level", label: "供应商等级", children: supplierLevelMeta(supplierDetailRow.supplierLevel).label },
                { key: "performance", label: "绩效分层", children: SUPPLIER_PERFORMANCE_META[getSupplierPerformanceBand(supplierDetailRow)].label },
                { key: "contact", label: "联系人", children: supplierDetailRow.contactName || "-" },
                { key: "phone", label: "电话", children: supplierDetailRow.phone || "-" },
                { key: "wechat", label: "微信", children: supplierDetailRow.wechat || "-" },
                { key: "address", label: "地址", children: supplierDetailRow.address || "-" },
                { key: "paymentTerms", label: "结算方式", children: optionLabel(PAYMENT_TERM_OPTIONS, supplierDetailRow.paymentTerms) },
                { key: "leadDays", label: "标准交期", children: supplierDetailRow.leadDays === null || supplierDetailRow.leadDays === undefined ? "-" : `${supplierDetailRow.leadDays} 天` },
                { key: "taxRate", label: "税率", children: supplierDetailRow.taxRate === null || supplierDetailRow.taxRate === undefined ? "-" : `${supplierDetailRow.taxRate}%` },
                { key: "currency", label: "结算币种", children: supplierDetailRow.settlementCurrency || "CNY" },
                {
                  key: "categories",
                  label: "经营类目",
                  children: supplierDetailRow.categories?.length ? (
                    <Space size={[4, 4]} wrap>
                      {supplierDetailRow.categories.map((category) => <Tag key={category}>{category}</Tag>)}
                    </Space>
                  ) : "-",
                },
                { key: "remark", label: "备注", children: supplierDetailRow.remark || "-" },
                { key: "lastPurchaseAt", label: "最近采购", children: formatDateTime(supplierDetailRow.lastPurchaseAt) },
                { key: "createdAt", label: "创建时间", children: formatDateTime(supplierDetailRow.createdAt) },
                { key: "updatedAt", label: "更新时间", children: formatDateTime(supplierDetailRow.updatedAt) },
              ]}
            />

            {canManageSuppliers ? (
              <Space>
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => {
                    const row = supplierDetailRow;
                    setSupplierDetailRow(null);
                    openSupplierModal(row);
                  }}
                >
                  编辑供应商
                </Button>
                <Button
                  danger={supplierDetailRow.status !== "blocked"}
                  loading={submitting === `supplier-status:${supplierDetailRow.id}`}
                  onClick={async () => {
                    await handleToggleSupplierStatus(supplierDetailRow);
                    setSupplierDetailRow(null);
                  }}
                >
                  {supplierDetailRow.status === "blocked" ? "启用供应商" : "停用供应商"}
                </Button>
              </Space>
            ) : null}
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title="店铺"
        open={accountModalOpen}
        footer={null}
        width={720}
        onCancel={() => setAccountModalOpen(false)}
        destroyOnClose
      >
        {renderAccountManager()}
      </Modal>

      <Modal
        title="绑定店铺"
        open={accountCreateModalOpen}
        okText="保存店铺"
        cancelText="取消"
        width={720}
        confirmLoading={submitting === "account"}
        onOk={handleCreateAccount}
        onCancel={() => setAccountCreateModalOpen(false)}
        destroyOnClose
      >
        {renderAccountCreateForm()}
      </Modal>

      <Modal
        title={editingStoreAddressAccount ? `${editingStoreAddressAccount.name} · 1688 地址` : "1688 地址"}
        open={storeAddressModalOpen}
        okText="保存"
        cancelText="取消"
        confirmLoading={editingStoreAddressAccount ? submitting === `store-address:${editingStoreAddressAccount.id}` : false}
        onOk={handleSaveStoreAddress}
        onCancel={() => {
          setStoreAddressModalOpen(false);
          setEditingStoreAddressAccount(null);
        }}
        destroyOnClose
      >
        <Form form={storeAddressForm} layout="vertical">
          <Form.Item name="alibabaAddressId" hidden>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={24}>
              <Form.Item name="selected1688AddressId" label="选择 1688 地址">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={alibaba1688AddressOptions}
                  loading={addressLoading}
                  notFoundContent={addressLoading ? "正在加载 1688 地址…" : "暂无 1688 地址"}
                  placeholder="从已同步地址选择"
                  onChange={applySelected1688AddressToStoreForm}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="label" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
                <Input placeholder="默认地址" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="fullName" label="收件人" rules={[{ required: true, message: "请输入收件人" }]}>
                <Input placeholder="收件人姓名" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="mobile" label="手机号" rules={[{ required: true, message: "请输入手机号" }]}>
                <Input placeholder="13800000000" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="postCode" label="邮编">
                <Input placeholder="310000" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="provinceText" label="省">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="cityText" label="市">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="areaText" label="区">
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="address" label="详细地址" rules={[{ required: true, message: "请输入详细地址" }]}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        title={editingSupplier ? "编辑供应商" : "新增供应商"}
        open={supplierModalOpen}
        okText="保存"
        cancelText="取消"
        width={720}
        confirmLoading={submitting === "supplier"}
        onOk={handleSaveSupplier}
        onCancel={() => {
          setSupplierModalOpen(false);
          setEditingSupplier(null);
        }}
        destroyOnClose
      >
        <Form form={supplierForm} layout="vertical">
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="name" label="供应商名称" rules={[{ required: true, message: "请输入供应商名称" }]}>
                <Input placeholder="例如：义乌某某工厂" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="status" label="状态" initialValue="active">
                <Select
                  options={[
                    { label: "启用", value: "active" },
                    { label: "停用", value: "blocked" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="supplierCode" label="供应商编码">
                <Input placeholder="例如：SUP-001" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="supplierLevel" label="供应商等级" initialValue="standard">
                <Select options={SUPPLIER_LEVEL_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="paymentTerms" label="结算方式">
                <Select allowClear options={PAYMENT_TERM_OPTIONS} placeholder="选择账期" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="leadDays" label="标准交期">
                <InputNumber min={0} precision={0} style={{ width: "100%" }} placeholder="天数" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="taxRate" label="税率(%)">
                <InputNumber min={0} max={100} precision={2} style={{ width: "100%" }} placeholder="例如 13" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="settlementCurrency" label="结算币种" initialValue="CNY">
                <Select
                  options={[
                    { label: "CNY", value: "CNY" },
                    { label: "USD", value: "USD" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="contactName" label="联系人">
                <Input placeholder="联系人姓名" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="phone" label="电话">
                <Input placeholder="手机号 / 座机" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="wechat" label="微信">
                <Input placeholder="微信号" />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="address" label="地址">
                <Input placeholder="工厂 / 仓库地址" />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="categories" label="经营类目">
                <Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入后回车" />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={3} placeholder="供应能力、合作要求或风险备注" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        title={editingBundleSku ? "编辑组合装" : "新增组合装"}
        open={bundleModalOpen}
        centered
        okText="保存"
        cancelText="取消"
        width={960}
        confirmLoading={submitting === "sku-bundle"}
        okButtonProps={{
          disabled: bundleLoadingComponents || bundleSelectedCount < 2 || bundleHasMissingCost,
        }}
        onOk={handleSaveBundle}
        onCancel={resetBundleModal}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Form form={bundleForm} layout="vertical">
            <Row gutter={12}>
              <Col xs={24} md={8}>
                <Form.Item name="internalSkuCode" label="组合商品编码">
                  <Input placeholder="留空自动生成" disabled={Boolean(editingBundleSku)} />
                </Form.Item>
              </Col>
              <Col xs={24} md={16}>
                <Form.Item name="productName" label="组合商品名称" rules={[{ required: true, message: "请输入组合商品名称" }]}>
                  <Input placeholder="例如：厨房收纳 3 件套" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="colorSpec" label="组合规格" rules={[{ required: true, message: "请输入组合规格" }]}>
                  <Input placeholder="例如：红色+蓝色 / 1+2 / 三件装" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="accountId" label="店铺" rules={[{ required: true, message: "请选择店铺" }]}>
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={accountOptions}
                    placeholder="请选择商品所属店铺"
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Space size={8}>
              <span style={{ color: "#0f172a", fontWeight: 700 }}>子商品</span>
              <Tag color="purple" style={{ marginInlineEnd: 0 }}>成本合计 {formatMoney(bundleTotalCost)}</Tag>
            </Space>
            <Button size="small" icon={<PlusOutlined />} onClick={addBundleComponent}>
              添加商品
            </Button>
          </div>

          {bundleHasMissingCost ? (
            <Alert type="warning" showIcon message="有子商品缺成本价，先维护成本价后才能保存组合装。" />
          ) : null}

          <Table
            size="small"
            rowKey="key"
            loading={bundleLoadingComponents}
            pagination={false}
            columns={bundleColumns}
            dataSource={bundleComponentRows}
            scroll={{ x: 820 }}
          />
        </Space>
      </Modal>

      <Modal
        title={editingSku ? "编辑商品资料" : "新增商品"}
        open={skuModalOpen}
        centered
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting === "sku"}
        onOk={handleSaveSku}
        onCancel={() => {
          setSkuModalOpen(false);
          setEditingSku(null);
        }}
        destroyOnClose
      >
        {accounts.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            message="还没有店铺"
            description="请先到采购中心右上角“店铺”新增店铺，再回来创建商品。"
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Form form={skuForm} layout="vertical">
          <Form.Item name="productName" label="商品名称" rules={[{ required: true, message: "请输入商品名称" }]}>
            <Input placeholder="例如：儿童保温杯" />
          </Form.Item>
          <Form.Item name="colorSpec" label="颜色/规格" rules={[{ required: true, message: "请输入颜色/规格" }]}>
            <Input placeholder="例如：蓝色 / 500ml / 单只装" />
          </Form.Item>
          <Form.Item name="accountId" label="店铺" rules={[{ required: true, message: "请选择店铺" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={accountOptions}
              placeholder="请选择商品所属店铺"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
