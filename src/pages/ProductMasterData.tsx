import { useCallback, useEffect, useMemo, useRef, useState, type Key } from "react";
import { Alert, Button, Col, Descriptions, Drawer, Form, Image, Input, InputNumber, Modal, Popconfirm, Progress, Row, Select, Space, Table, Tag, Tooltip, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { hasPageCache, readPageCache, writePageCache } from "../utils/pageCache";

const erp = window.electronAPI?.erp;
const PRODUCT_MASTER_DATA_CACHE_KEY = "temu.product-master-data.cache.v2";
const JST_ACCOUNT_ID = "jst:account:default";
const ADDRESS_WORKBENCH_PARAMS = {
  limit: 20,
  includeRequestDetails: false,
  includeOptions: false,
  include1688Meta: true,
};
const SKU_LOAD_CHUNK_SIZE = 1000;
const SKU_LOAD_MAX_OFFSET = 200000;
const SKU_LOAD_YIELD_MS = 60;

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
  warehouseLocation?: string | null;
  costPrice?: number | null;
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

type SkuIssueKey = "missing_image" | "missing_spec" | "missing_cost" | "zero_stock" | "missing_supplier";
type SkuWorkState = "pending" | "ready";

interface SkuFilters {
  keyword: string;
  accountId?: string;
  status?: string;
  workState?: SkuWorkState;
  issue?: SkuIssueKey;
}

interface SkuQualityCard {
  label: string;
  value: number | string;
  tone: string;
  issue?: SkuIssueKey;
  workState?: SkuWorkState;
}

interface SupplierFilters {
  keyword: string;
  status?: string;
  supplierLevel?: string;
  source?: string;
  category?: string;
  attention?: string;
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
}

interface ProductMasterDataCache {
  generatedAt?: string;
  accounts?: ErpAccountRow[];
  suppliers?: ErpSupplierRow[];
  skus?: ErpSkuRow[];
  alibaba1688Addresses?: Alibaba1688AddressRow[];
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

function inferMasterDataSource(row?: { source?: string | null; id?: string | null; accountId?: string | null }) {
  if (row?.source) return row.source;
  if (row?.accountId === JST_ACCOUNT_ID || String(row?.id || "").startsWith("jst:")) return "jushuitan";
  return null;
}

const SKU_ISSUE_META: Record<SkuIssueKey, { label: string; color: string }> = {
  missing_image: { label: "缺图片", color: "orange" },
  missing_spec: { label: "缺规格", color: "gold" },
  missing_cost: { label: "缺成本", color: "red" },
  zero_stock: { label: "零库存", color: "volcano" },
  missing_supplier: { label: "未绑供应商", color: "purple" },
};

const SKU_ISSUE_KEYS = Object.keys(SKU_ISSUE_META) as SkuIssueKey[];

const SKU_ISSUE_CARD_TONES: Record<SkuIssueKey, string> = {
  missing_image: "#f97316",
  missing_spec: "#d97706",
  missing_cost: "#dc2626",
  zero_stock: "#7c3aed",
  missing_supplier: "#9333ea",
};

const SKU_ISSUE_OPTIONS = SKU_ISSUE_KEYS.map((key) => ({
  value: key,
  label: SKU_ISSUE_META[key].label,
}));

const SKU_WORK_STATE_META: Record<SkuWorkState, { label: string; color: string }> = {
  pending: { label: "待处理", color: "orange" },
  ready: { label: "可流转", color: "green" },
};

const SKU_WORK_STATE_OPTIONS = (Object.keys(SKU_WORK_STATE_META) as SkuWorkState[]).map((key) => ({
  value: key,
  label: SKU_WORK_STATE_META[key].label,
}));

const SUPPLIER_ATTENTION_META: Record<string, { label: string; color: string; detail: string }> = {
  missing_contact: { label: "缺联系人", color: "orange", detail: "联系人、电话、微信至少维护一项" },
  missing_category: { label: "缺类目", color: "gold", detail: "补充经营类目后更方便采购筛选" },
  no_sku: { label: "无商品", color: "purple", detail: "还没有关联商品资料" },
  no_mapping: { label: "无货源", color: "volcano", detail: "还没有绑定 1688 货源" },
  missing_terms: { label: "缺结算", color: "red", detail: "缺少账期、交期或税率信息" },
};

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

function getSkuStockQty(row: ErpSkuRow) {
  const actualStockQty = toOptionalNumber(row.actualStockQty);
  const jstActualStockQty = toOptionalNumber(row.jstActualStockQty);
  if (actualStockQty !== null && actualStockQty !== 0) return actualStockQty;
  if (jstActualStockQty !== null) return jstActualStockQty;
  return actualStockQty ?? 0;
}

function getSkuCostPrice(row: ErpSkuRow) {
  const cost = row.costPrice ?? row.jstCostPrice;
  return toOptionalNumber(cost);
}

function getSkuSupplierText(row: ErpSkuRow) {
  return row.jstSupplierName || row.supplierId || "";
}

function getSkuDataIssues(row: ErpSkuRow): SkuIssueKey[] {
  const issues: SkuIssueKey[] = [];
  if (!row.imageUrl) issues.push("missing_image");
  if (!(row.colorSpec || row.category)) issues.push("missing_spec");
  if (getSkuCostPrice(row) === null) issues.push("missing_cost");
  if (getSkuStockQty(row) <= 0) issues.push("zero_stock");
  if (!getSkuSupplierText(row)) issues.push("missing_supplier");
  return issues;
}

function getSkuWorkState(row: ErpSkuRow): SkuWorkState {
  return getSkuDataIssues(row).length ? "pending" : "ready";
}

function getSkuCompleteness(row: ErpSkuRow) {
  const total = 6;
  const filled = [
    row.productName,
    row.internalSkuCode,
    row.imageUrl,
    row.colorSpec || row.category,
    getSkuCostPrice(row) !== null ? "cost" : "",
    getSkuSupplierText(row),
  ].filter(Boolean).length;
  return Math.round((filled / total) * 100);
}

function getSupplierSourceLabel(row: ErpSupplierRow) {
  const source = inferMasterDataSource(row);
  if (source === "jushuitan") return "聚水潭";
  if (source) return source;
  return "本地";
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

const SKU_ISSUE_ACTIONS: Record<SkuIssueKey, string> = {
  missing_image: "补商品主图；没有图时，采购、仓库和运营都很难快速确认是不是同一个货。",
  missing_spec: "补颜色、尺寸、数量组合或关键规格；否则下单和拣货容易看错。",
  missing_cost: "补成本价；没有成本，运营看利润和采购比价都会失真。",
  zero_stock: "确认库存或补采购计划；实际库存为 0 的商品要么等入库，要么先暂停继续推。",
  missing_supplier: "绑定供应商；没有供应商，后续采购、售后追责和补货都接不上。",
};

const SKU_ISSUE_PRIORITY: Record<SkuIssueKey, number> = {
  missing_cost: 40,
  missing_supplier: 35,
  zero_stock: 30,
  missing_spec: 25,
  missing_image: 15,
};

function getSkuWorkPriority(row: ErpSkuRow) {
  const issues = getSkuDataIssues(row);
  if (!issues.length) return 0;
  return issues.reduce((score, issue) => score + SKU_ISSUE_PRIORITY[issue], 0) + issues.length;
}

function getSkuWorkPriorityMeta(row: ErpSkuRow) {
  const score = getSkuWorkPriority(row);
  if (score >= 70) return { label: "高优先级", color: "red" };
  if (score >= 35) return { label: "中优先级", color: "orange" };
  if (score > 0) return { label: "低优先级", color: "gold" };
  return { label: "可流转", color: "green" };
}

function getSkuWorkLogItems(row: ErpSkuRow) {
  const issues = getSkuDataIssues(row);
  const stockQty = getSkuStockQty(row);
  const costPrice = getSkuCostPrice(row);
  const supplierText = getSkuSupplierText(row);
  const location = row.warehouseLocation || row.jstMainBin;
  const items = issues.map((issue) => ({
    key: `issue:${issue}`,
    color: SKU_ISSUE_META[issue].color,
    title: `待处理：${SKU_ISSUE_META[issue].label}`,
    description: SKU_ISSUE_ACTIONS[issue],
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
    description: formatDateTime(row.jstModifiedAt || row.updatedAt || row.jstCreatedAt || row.createdAt),
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

function getSkuPrimaryWorkAction(row: ErpSkuRow) {
  const issues = getSkuDataIssues(row);
  const priority = getSkuWorkPriorityMeta(row);
  if (issues.length) {
    const issue = issues[0];
    return {
      color: SKU_ISSUE_META[issue].color,
      label: SKU_ISSUE_META[issue].label,
      priority,
      title: `先处理${SKU_ISSUE_META[issue].label}`,
      description: SKU_ISSUE_ACTIONS[issue],
    };
  }

  const stockQty = getSkuStockQty(row);
  const costPrice = getSkuCostPrice(row);
  const supplierText = getSkuSupplierText(row);
  return {
    color: "green",
    label: "可流转",
    priority,
    title: "资料可继续流转",
    description: [
      `库存 ${stockQty}`,
      `成本 ${formatMoney(costPrice)}`,
      `供应商 ${supplierText || "-"}`,
    ].join(" · "),
  };
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

export default function ProductMasterData({ mode = "skus" }: ProductMasterDataProps) {
  const auth = useErpAuth();
  const role = auth.currentUser?.role;
  const cachedData = useMemo(
    () => readPageCache<ProductMasterDataCache>(PRODUCT_MASTER_DATA_CACHE_KEY, {}),
    [],
  );
  const canManageAccounts = canRole(role, ["admin", "manager"]);
  const canManageStoreAddress = canRole(role, ["admin", "manager", "buyer"]);
  const canManageSuppliers = canRole(role, ["admin", "manager", "buyer"]);
  const canManageSkus = canRole(role, ["admin", "manager", "operations"]);

  const [accountForm] = Form.useForm();
  const [storeAddressForm] = Form.useForm<StoreAddressValues>();
  const [supplierForm] = Form.useForm();
  const [skuForm] = Form.useForm();
  const [accounts, setAccounts] = useState<ErpAccountRow[]>(() => cachedData.accounts || []);
  const [suppliers, setSuppliers] = useState<ErpSupplierRow[]>(() => cachedData.suppliers || []);
  const [skus, setSkus] = useState<ErpSkuRow[]>(() => cachedData.skus || []);
  const [alibaba1688Addresses, setAlibaba1688Addresses] = useState<Alibaba1688AddressRow[]>(() => cachedData.alibaba1688Addresses || []);
  const [loadedOnce, setLoadedOnce] = useState(() => hasPageCache(cachedData));
  const [loading, setLoading] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [skuModalOpen, setSkuModalOpen] = useState(false);
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<ErpSupplierRow | null>(null);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountCreateModalOpen, setAccountCreateModalOpen] = useState(false);
  const [storeAddressModalOpen, setStoreAddressModalOpen] = useState(false);
  const [editingStoreAddressAccount, setEditingStoreAddressAccount] = useState<ErpAccountRow | null>(null);
  const [skuDetailRow, setSkuDetailRow] = useState<ErpSkuRow | null>(null);
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
  const hasSkuFilters = Boolean(
    skuFilters.keyword.trim()
    || skuFilters.accountId
    || skuFilters.status
    || skuFilters.workState
    || skuFilters.issue,
  );
  const filteredSkus = useMemo(() => {
    const keyword = skuFilters.keyword.trim().toLowerCase();
    return skus.filter((sku) => {
      if (skuFilters.accountId && sku.accountId !== skuFilters.accountId) return false;
      if (skuFilters.status && sku.status !== skuFilters.status) return false;
      if (skuFilters.workState && getSkuWorkState(sku) !== skuFilters.workState) return false;
      if (skuFilters.issue && !getSkuDataIssues(sku).includes(skuFilters.issue)) return false;
      if (!keyword) return true;
      const accountName = sku.accountId ? accountNameById.get(sku.accountId) : "";
      const searchableText = [
        sku.internalSkuCode,
        sku.productName,
        sku.colorSpec,
        sku.category,
        accountName,
        sku.jstSupplierName,
        sku.warehouseLocation,
        sku.jstMainBin,
        SKU_WORK_STATE_META[getSkuWorkState(sku)].label,
        ...getSkuDataIssues(sku).map((issue) => SKU_ISSUE_META[issue].label),
        sku.status ? statusLabel(sku.status) : "",
      ].filter(Boolean).join(" ").toLowerCase();
      return searchableText.includes(keyword);
    });
  }, [accountNameById, skuFilters, skus]);
  const skuQualitySummary = useMemo(() => {
    const issueCounts = Object.fromEntries(SKU_ISSUE_KEYS.map((key) => [key, 0])) as Record<SkuIssueKey, number>;
    let completionTotal = 0;
    let completeCount = 0;
    let pendingCount = 0;
    let readyCount = 0;
    skus.forEach((sku) => {
      const issues = getSkuDataIssues(sku);
      issues.forEach((issue) => {
        issueCounts[issue] += 1;
      });
      const completeness = getSkuCompleteness(sku);
      completionTotal += completeness;
      if (issues.length) pendingCount += 1;
      else readyCount += 1;
      if (completeness >= 90 && issues.length === 0) completeCount += 1;
    });
    const avgCompleteness = skus.length ? Math.round(completionTotal / skus.length) : 0;
    return {
      total: skus.length,
      avgCompleteness,
      completeCount,
      pendingCount,
      readyCount,
      issueCounts,
    };
  }, [skus]);
  const skuQualityCards = useMemo<SkuQualityCard[]>(() => [
    { label: "商品总数", value: skuQualitySummary.total, tone: "#2563eb", issue: undefined },
    { label: "平均完整度", value: `${skuQualitySummary.avgCompleteness}%`, tone: "#16a34a", issue: undefined },
    { label: "资料完整", value: skuQualitySummary.completeCount, tone: "#0891b2", issue: undefined },
    { label: "待处理", value: skuQualitySummary.pendingCount, tone: "#ea580c", workState: "pending" },
    { label: "可流转", value: skuQualitySummary.readyCount, tone: "#16a34a", workState: "ready" },
    ...SKU_ISSUE_KEYS.map((issue) => ({
      label: SKU_ISSUE_META[issue].label,
      value: skuQualitySummary.issueCounts[issue],
      tone: SKU_ISSUE_CARD_TONES[issue],
      issue,
    })),
  ], [skuQualitySummary]);
  const skuDetailIssues = useMemo(() => (
    skuDetailRow ? getSkuDataIssues(skuDetailRow) : []
  ), [skuDetailRow]);
  const skuDetailWorkLogItems = useMemo(() => (
    skuDetailRow ? getSkuWorkLogItems(skuDetailRow) : []
  ), [skuDetailRow]);
  const selectedSkuKeySet = useMemo(
    () => new Set(selectedSkuRowKeys.map((key) => String(key))),
    [selectedSkuRowKeys],
  );
  const selectedSkus = useMemo(
    () => skus.filter((sku) => selectedSkuKeySet.has(sku.id)),
    [selectedSkuKeySet, skus],
  );
  const selectedSkuSummary = useMemo(() => {
    const issueCounts = Object.fromEntries(SKU_ISSUE_KEYS.map((key) => [key, 0])) as Record<SkuIssueKey, number>;
    let totalStock = 0;
    let pendingCount = 0;
    let readyCount = 0;
    const stores = new Set<string>();
    selectedSkus.forEach((sku) => {
      const issues = getSkuDataIssues(sku);
      issues.forEach((issue) => {
        issueCounts[issue] += 1;
      });
      if (issues.length) pendingCount += 1;
      else readyCount += 1;
      totalStock += getSkuStockQty(sku);
      if (sku.accountId) stores.add(sku.accountId);
    });
    return {
      issueCounts,
      totalStock,
      pendingCount,
      readyCount,
      storeCount: stores.size,
    };
  }, [selectedSkus]);
  const supplierDetailAttention = useMemo(() => (
    supplierDetailRow ? getSupplierAttentionKeys(supplierDetailRow) : []
  ), [supplierDetailRow]);
  const supplierSourceOptions = useMemo(() => {
    const labels = new Set(suppliers.map(getSupplierSourceLabel).filter(Boolean));
    return Array.from(labels)
      .sort((left, right) => left.localeCompare(right, "zh-Hans-CN", { numeric: true }))
      .map((label) => ({ label, value: label }));
  }, [suppliers]);
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
    || supplierFilters.source
    || supplierFilters.category
    || supplierFilters.attention,
  );
  const filteredSuppliers = useMemo(() => {
    const keyword = supplierFilters.keyword.trim().toLowerCase();
    return suppliers.filter((supplier) => {
      if (supplierFilters.status && supplier.status !== supplierFilters.status) return false;
      if (supplierFilters.supplierLevel && (supplier.supplierLevel || "standard") !== supplierFilters.supplierLevel) return false;
      if (supplierFilters.source && getSupplierSourceLabel(supplier) !== supplierFilters.source) return false;
      if (supplierFilters.category && !(supplier.categories || []).includes(supplierFilters.category)) return false;
      if (supplierFilters.attention && !getSupplierAttentionKeys(supplier).includes(supplierFilters.attention)) return false;
      if (!keyword) return true;
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
        getSupplierSourceLabel(supplier),
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
    suppliers.forEach((supplier) => {
      if (supplier.status === "blocked") blockedCount += 1;
      else activeCount += 1;
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
      avgLeadDays: leadDaysCount ? Math.round(leadDaysTotal / leadDaysCount) : null,
    };
  }, [suppliers]);
  const jushuitanSupplierCount = suppliers.filter((row) => inferMasterDataSource(row) === "jushuitan").length;
  const jushuitanSkuCount = skus.filter((row) => inferMasterDataSource(row) === "jushuitan").length;
  const pageTitle = mode === "suppliers" ? "供应商" : mode === "stores" ? "店铺" : "商品资料";
  const pageMeta = mode === "suppliers"
    ? [hasSupplierFilters ? `供应商 ${filteredSuppliers.length}/${suppliers.length}` : `供应商 ${suppliers.length}`, `聚水潭 ${jushuitanSupplierCount}`]
    : mode === "stores"
      ? [`店铺 ${accounts.length}`]
      : [hasSkuFilters ? `商品 ${filteredSkus.length}/${skus.length}` : `商品 ${skus.length}`, `聚水潭 ${jushuitanSkuCount}`];

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadSeqRef.current += 1;
    };
  }, []);

  const loadAll = useCallback(async (options?: { forceFull?: boolean }) => {
    if (!erp) return;
    const loadSeq = loadSeqRef.current + 1;
    loadSeqRef.current = loadSeq;
    const isCurrentLoad = () => mountedRef.current && loadSeqRef.current === loadSeq;
    setLoading(true);
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
        setSkus(allSkuRows.slice());
        if (rows.length < SKU_LOAD_CHUNK_SIZE) break;
        await waitForSkuLoadYield();
      }
    } catch (error: any) {
      if (isCurrentLoad()) message.error(error?.message || "商品资料读取失败");
    } finally {
      if (isCurrentLoad()) setLoading(false);
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
    void loadAll();
  }, [loadAll]);

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

  const handleCreateSku = async () => {
    if (!erp) return;
    const values = await skuForm.validateFields() as SkuDialogValues;
    setSubmitting("sku");
    try {
      await erp.sku.create({
        accountId: values.accountId,
        productName: values.productName,
        colorSpec: values.colorSpec,
        status: "active",
      });
      skuForm.resetFields();
      setSkuModalOpen(false);
      message.success("商品资料已创建");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "商品资料创建失败");
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
      title: "供应商档案",
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
              <Tag color={getSupplierSourceLabel(row) === "聚水潭" ? "blue" : "default"} style={{ marginInlineEnd: 0 }}>
                {getSupplierSourceLabel(row)}
              </Tag>
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
      title: "档案健康度",
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
            档案
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

  const skuColumns: ColumnsType<ErpSkuRow> = [
    {
      title: "图片",
      dataIndex: "imageUrl",
      key: "imageUrl",
      width: 72,
      render: (_value, row) => renderSkuImage(row),
    },
    { title: "标题", dataIndex: "productName", key: "productName", width: 220, ellipsis: true },
    { title: "商品编码", dataIndex: "internalSkuCode", key: "internalSkuCode", width: 138, ellipsis: true },
    {
      title: "资料完整度",
      key: "dataQuality",
      width: 170,
      render: (_value, row) => {
        const percent = getSkuCompleteness(row);
        const issues = getSkuDataIssues(row);
        return (
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            <Progress
              percent={percent}
              size="small"
              status={issues.length ? "exception" : "success"}
              strokeColor={issues.length ? undefined : "#16a34a"}
            />
            <Space size={[4, 4]} wrap>
              {issues.length ? issues.slice(0, 2).map((issue) => (
                <Tag key={issue} color={SKU_ISSUE_META[issue].color} style={{ marginInlineEnd: 0 }}>
                  {SKU_ISSUE_META[issue].label}
                </Tag>
              )) : (
                <Tag color="success" style={{ marginInlineEnd: 0 }}>资料完整</Tag>
              )}
              {issues.length > 2 ? (
                <Tooltip title={issues.slice(2).map((issue) => SKU_ISSUE_META[issue].label).join("、")}>
                  <Tag style={{ marginInlineEnd: 0 }}>+{issues.length - 2}</Tag>
                </Tooltip>
              ) : null}
            </Space>
          </Space>
        );
      },
    },
    {
      title: "处理建议",
      key: "workAction",
      width: 240,
      sorter: (left, right) => getSkuWorkPriority(left) - getSkuWorkPriority(right),
      defaultSortOrder: "descend",
      sortDirections: ["descend", "ascend"],
      render: (_value, row) => {
        const action = getSkuPrimaryWorkAction(row);
        return (
          <Space direction="vertical" size={3} style={{ width: "100%" }}>
            <Space size={6} wrap>
              <Tag color={action.priority.color} style={{ marginInlineEnd: 0 }}>
                {action.priority.label}
              </Tag>
              <Tag color={action.color} style={{ marginInlineEnd: 0 }}>
                {action.label}
              </Tag>
              <span style={{ color: "#0f172a", fontWeight: 600 }}>{action.title}</span>
            </Space>
            <span style={{ color: "#64748b", fontSize: 12, lineHeight: "18px" }}>
              {action.description}
            </span>
          </Space>
        );
      },
    },
    {
      title: "实际库存数",
      dataIndex: "actualStockQty",
      key: "actualStockQty",
      width: 112,
      sorter: (left, right) => getSkuStockQty(left) - getSkuStockQty(right),
      sortDirections: ["descend", "ascend"],
      render: (_value, row) => getSkuStockQty(row),
    },
    {
      title: "仓位",
      dataIndex: "warehouseLocation",
      key: "warehouseLocation",
      width: 140,
      ellipsis: true,
      render: (value, row) => value || row.jstMainBin || "-",
    },
    { title: "颜色及规格", dataIndex: "colorSpec", key: "colorSpec", width: 200, ellipsis: true, render: (value, row) => { const t = value || row.category || "-"; return <span title={t}>{t}</span>; } },
    {
      title: "店铺",
      dataIndex: "accountId",
      key: "accountId",
      width: 140,
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
      width: 112,
      render: (value, row) => formatMoney(value ?? row.jstCostPrice),
    },
    { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 142, render: (_value, row) => formatDateTime(row.jstCreatedAt || row.createdAt) },
    { title: "修改时间", dataIndex: "updatedAt", key: "updatedAt", width: 142, render: (_value, row) => formatDateTime(row.jstModifiedAt || row.updatedAt) },
    { title: "创建人", dataIndex: "createdByName", key: "createdByName", width: 120, ellipsis: true, render: (value, row) => value || row.jstCreator || "-" },
    {
      title: "操作",
      key: "actions",
      width: 88,
      fixed: "right",
      align: "right",
      render: (_value, row) => (
        <Button size="small" onClick={() => setSkuDetailRow(row)}>
          日志
        </Button>
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

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="系统" title={pageTitle} subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境缺少本地服务接口" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="系统"
        title={pageTitle}
        meta={pageMeta}
        actions={[
          mode === "skus" && canManageSkus ? (
            <Button
              key="new-sku"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                skuForm.resetFields();
                if (accounts.length === 1) {
                  skuForm.setFieldsValue({ accountId: accounts[0].id });
                }
                setSkuModalOpen(true);
              }}
            >
              新增商品
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
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: 8,
              marginBottom: 12,
            }}
          >
            {skuQualityCards.map((item) => {
              const clickable = Boolean(item.issue || item.workState);
              const applyCardFilter = () => setSkuFilters((current) => ({
                ...current,
                issue: item.issue,
                workState: item.workState,
              }));
              return (
                <div
                  key={item.label}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? applyCardFilter : undefined}
                  onKeyDown={clickable ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      applyCardFilter();
                    }
                  } : undefined}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderLeft: `3px solid ${item.tone}`,
                    borderRadius: 6,
                    padding: "8px 10px",
                    background: "#fff",
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
            <Col xs={24} md={6}>
              <Input
                allowClear
                placeholder="商品编码 / 标题 / 规格 / 供应商"
                value={skuFilters.keyword}
                onChange={(event) => setSkuFilters((current) => ({ ...current, keyword: event.target.value }))}
              />
            </Col>
            <Col xs={24} sm={12} md={4}>
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
            <Col xs={12} sm={8} md={3}>
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
            <Col xs={12} sm={8} md={3}>
              <Select
                allowClear
                placeholder="工作状态"
                style={{ width: "100%" }}
                value={skuFilters.workState}
                options={SKU_WORK_STATE_OPTIONS}
                onChange={(value) => setSkuFilters((current) => ({ ...current, workState: value, issue: undefined }))}
              />
            </Col>
            <Col xs={24} sm={8} md={4}>
              <Select
                allowClear
                placeholder="资料问题"
                style={{ width: "100%" }}
                value={skuFilters.issue}
                options={SKU_ISSUE_OPTIONS}
                onChange={(value) => setSkuFilters((current) => ({ ...current, issue: value, workState: undefined }))}
              />
            </Col>
            <Col xs={24} md={3}>
              <Button block disabled={!hasSkuFilters} onClick={() => setSkuFilters({ keyword: "" })}>
                清空
              </Button>
            </Col>
          </Row>
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
                <Tag color={SKU_WORK_STATE_META.pending.color} style={{ marginInlineEnd: 0 }}>
                  待处理 {selectedSkuSummary.pendingCount}
                </Tag>
                <Tag color={SKU_WORK_STATE_META.ready.color} style={{ marginInlineEnd: 0 }}>
                  可流转 {selectedSkuSummary.readyCount}
                </Tag>
                {SKU_ISSUE_KEYS.map((issue) => (
                  <Tag key={issue} color={SKU_ISSUE_META[issue].color} style={{ marginInlineEnd: 0 }}>
                    {SKU_ISSUE_META[issue].label} {selectedSkuSummary.issueCounts[issue]}
                  </Tag>
                ))}
              </Space>
              <Space size={6} wrap>
                <Button
                  size="small"
                  disabled={!selectedSkuSummary.pendingCount}
                  onClick={() => setSkuFilters((current) => ({ ...current, workState: "pending", issue: undefined }))}
                >
                  筛待处理
                </Button>
                <Button
                  size="small"
                  disabled={!selectedSkuSummary.readyCount}
                  onClick={() => setSkuFilters((current) => ({ ...current, workState: "ready", issue: undefined }))}
                >
                  筛可流转
                </Button>
                {SKU_ISSUE_KEYS.map((issue) => (
                  <Button
                    key={issue}
                    size="small"
                    disabled={!selectedSkuSummary.issueCounts[issue]}
                    onClick={() => setSkuFilters((current) => ({ ...current, issue, workState: undefined }))}
                  >
                    筛{SKU_ISSUE_META[issue].label}
                  </Button>
                ))}
                <Button size="small" onClick={() => setSkuDetailRow(selectedSkus[0])}>
                  打开首个日志
                </Button>
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
            scroll={{ x: 2240, y: "max(220px, calc(100vh - 520px))" }}
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
              <div className="app-panel__title-sub">维护供应商档案、联系方式、经营类目和采购关系。</div>
            </div>
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
                placeholder="来源"
                style={{ width: "100%" }}
                value={supplierFilters.source}
                options={supplierSourceOptions}
                onChange={(value) => setSupplierFilters((current) => ({ ...current, source: value }))}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
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
            <Col xs={24} md={3}>
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
            scroll={{ x: 1500, y: "max(220px, calc(100vh - 540px))" }}
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

      <Drawer
        title="商品工作日志"
        open={Boolean(skuDetailRow)}
        width={620}
        onClose={() => setSkuDetailRow(null)}
        destroyOnClose
      >
        {skuDetailRow ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Space align="start" size={12}>
              {renderSkuImage(skuDetailRow, 72)}
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "#0f172a", fontSize: 16, fontWeight: 700, lineHeight: "24px" }}>
                  {skuDetailRow.productName || "-"}
                </div>
                <div style={{ color: "#64748b", marginTop: 4 }}>
                  {skuDetailRow.internalSkuCode || skuDetailRow.id}
                </div>
                <Space size={[4, 4]} wrap style={{ marginTop: 8 }}>
                  <Tag color={statusColor(skuDetailRow.status)}>{statusLabel(skuDetailRow.status)}</Tag>
                </Space>
              </div>
            </Space>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ color: "#0f172a", fontWeight: 600 }}>资料完整度</span>
                <span style={{ color: "#64748b" }}>{getSkuCompleteness(skuDetailRow)}%</span>
              </div>
              <Progress
                percent={getSkuCompleteness(skuDetailRow)}
                status={skuDetailIssues.length ? "exception" : "success"}
                strokeColor={skuDetailIssues.length ? undefined : "#16a34a"}
              />
              <Space size={[6, 6]} wrap>
                {skuDetailIssues.length ? skuDetailIssues.map((issue) => (
                  <Tag key={issue} color={SKU_ISSUE_META[issue].color}>
                    {SKU_ISSUE_META[issue].label}
                  </Tag>
                )) : (
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
                {skuDetailWorkLogItems.map((item) => (
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
                      {item.title.startsWith("待处理") ? "待办" : "记录"}
                    </Tag>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: "#0f172a", fontWeight: 600, lineHeight: "20px" }}>{item.title}</div>
                      <div style={{ color: "#64748b", fontSize: 12, lineHeight: "18px", marginTop: 2 }}>{item.description}</div>
                    </div>
                  </div>
                ))}
              </Space>
            </div>

            <Descriptions
              bordered
              size="small"
              column={1}
              items={[
                { key: "spec", label: "颜色/规格", children: skuDetailRow.colorSpec || skuDetailRow.category || "-" },
                { key: "store", label: "店铺", children: skuDetailRow.accountName || accountNameById.get(skuDetailRow.accountId || "") || "-" },
                { key: "supplier", label: "供应商", children: getSkuSupplierText(skuDetailRow) || "-" },
                { key: "stock", label: "实际库存", children: getSkuStockQty(skuDetailRow) },
                { key: "location", label: "仓位", children: skuDetailRow.warehouseLocation || skuDetailRow.jstMainBin || "-" },
                { key: "cost", label: "成本价", children: formatMoney(skuDetailRow.costPrice ?? skuDetailRow.jstCostPrice) },
                { key: "creator", label: "创建人", children: skuDetailRow.createdByName || skuDetailRow.jstCreator || "-" },
                { key: "created", label: "创建时间", children: formatDateTime(skuDetailRow.jstCreatedAt || skuDetailRow.createdAt) },
                { key: "updated", label: "修改时间", children: formatDateTime(skuDetailRow.jstModifiedAt || skuDetailRow.updatedAt) },
              ]}
            />
          </Space>
        ) : null}
      </Drawer>

      <Drawer
        title="供应商档案"
        open={Boolean(supplierDetailRow)}
        width={620}
        onClose={() => setSupplierDetailRow(null)}
        destroyOnClose
      >
        {supplierDetailRow ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <div>
              <Space size={[6, 6]} wrap>
                <span style={{ color: "#0f172a", fontSize: 18, fontWeight: 700 }}>{supplierDetailRow.name}</span>
                <Tag color={supplierLevelMeta(supplierDetailRow.supplierLevel).color}>
                  {supplierLevelMeta(supplierDetailRow.supplierLevel).label}
                </Tag>
                <Tag color={getSupplierSourceLabel(supplierDetailRow) === "聚水潭" ? "blue" : "default"}>
                  {getSupplierSourceLabel(supplierDetailRow)}
                </Tag>
                <Tag color={statusColor(supplierDetailRow.status)}>{statusLabel(supplierDetailRow.status)}</Tag>
              </Space>
              <div style={{ color: "#64748b", marginTop: 6 }}>{supplierDetailRow.supplierCode || supplierDetailRow.id}</div>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ color: "#0f172a", fontWeight: 600 }}>档案健康度</span>
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
                  <Tag color="success">档案完整</Tag>
                )}
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
        title="新增商品"
        open={skuModalOpen}
        okText="创建"
        cancelText="取消"
        confirmLoading={submitting === "sku"}
        onOk={handleCreateSku}
        onCancel={() => setSkuModalOpen(false)}
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
