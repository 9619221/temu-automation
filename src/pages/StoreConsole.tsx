import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Descriptions, Drawer, Empty, Image, Input, Progress, Row, Select, Space, Spin, Table, Tabs, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  BarChartOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  EyeOutlined,
  ReloadOutlined,
  ShopOutlined,
  TeamOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ACCOUNT_STORE_KEY, ACTIVE_ACCOUNT_ID_KEY, buildScopedStoreKey } from "../utils/multiStore";
import { parseFluxData, parseOrdersData, parseProductsData, parseSalesData } from "../utils/parseRawApis";
import { normalizeSkcRowsFromSummary } from "../utils/storeSkcDashboard";

const { Text, Title } = Typography;

interface StoreSnapshot {
  id: string;
  accountId: string;
  storeName?: string | null;
  ownerName?: string | null;
  collectedAt?: string;
  uploadedAt?: string;
  summary?: {
    totalTasks?: number;
    successCount?: number;
    errorCount?: number;
  };
  sourceCount?: number;
  payloadBytes?: number;
  status?: string;
  sources?: StoreSnapshotSource[];
  snapshotIds?: string[];
  taskSummary?: StoreTaskSummary;
  skcSummary?: any;
}

interface StoreAccount {
  id: string;
  name?: string | null;
  ownerName?: string | null;
}

interface StoreSnapshotSource {
  id: string;
  dataKey: string;
  taskKey?: string | null;
  label?: string | null;
  category?: string | null;
  recordCount?: number;
  payloadBytes?: number;
}

type StoreTaskKey = "deliveryCancel" | "returns" | "stock" | "activity" | "violation";

interface StoreTaskBucket {
  key: StoreTaskKey | string;
  label: string;
  count: number;
  signalCount?: number;
  sourceKeys?: string[];
  sourceCounts?: Record<string, number>;
}

interface StoreTaskSummary {
  total: number;
  signalTotal?: number;
  status?: "clear" | "todo";
  categories?: Record<string, StoreTaskBucket>;
}

interface SkcDashboardRow {
  id: string;
  accountId: string;
  storeName: string;
  ownerName?: string | null;
  skcId: string;
  skuIds?: string[];
  goodsId: string;
  spuId: string;
  title: string;
  imageUrl: string;
  category: string;
  status: string;
  siteLabel: string;
  price: string;
  todaySales: number;
  last7DaysSales: number;
  last30DaysSales: number;
  totalSales: number;
  exposeNum: number;
  clickNum: number;
  payGoodsNum: number;
  warehouseStock: number;
  adviceQuantity: number;
  lackQuantity: number;
  pendingOrderCount: number;
  taskFlags: string[];
  sourceCount: number;
}

interface StoreSkcSummary {
  accountId: string;
  storeName: string;
  ownerName?: string | null;
  skcCount: number;
  taskSkcCount: number;
  stockSkcCount: number;
  violationSkcCount: number;
  activitySkcCount: number;
  totalSales: number;
  lackQuantity: number;
  adviceQuantity: number;
  exposeNum: number;
}

const TASK_DEFINITIONS: Array<{ key: StoreTaskKey; label: string; color: string; chartColor: string }> = [
  { key: "deliveryCancel", label: "快递取消", color: "orange", chartColor: "#fa8c16" },
  { key: "returns", label: "退货", color: "volcano", chartColor: "#fa541c" },
  { key: "stock", label: "补货", color: "blue", chartColor: "#1677ff" },
  { key: "activity", label: "活动", color: "purple", chartColor: "#722ed1" },
  { key: "violation", label: "违规", color: "red", chartColor: "#f5222d" },
];

const SKC_STORE_KEYS = [
  "temu_products",
  "temu_sales",
  "temu_orders",
  "temu_flux",
  "temu_raw_goodsData",
  "temu_raw_lifecycle",
  "temu_raw_yunduOverall",
  "temu_raw_globalPerformance",
  "temu_raw_yunduActivityList",
  "temu_raw_imageTask",
  "temu_raw_sampleManage",
  "temu_raw_activity",
  "temu_raw_activityLog",
  "temu_raw_activityUS",
  "temu_raw_activityEU",
  "temu_raw_chanceGoods",
  "temu_raw_flowPrice",
  "temu_raw_retailPrice",
  "temu_raw_priceReport",
  "temu_raw_priceCompete",
  "temu_raw_soldout",
  "temu_raw_checkup",
  "temu_raw_governDashboard",
  "temu_raw_governProductQualification",
  "temu_raw_marketingActivity",
  "temu_raw_mallFlux",
  "temu_raw_mallFluxEU",
  "temu_raw_mallFluxUS",
  "temu_raw_fluxEU",
  "temu_raw_fluxUS",
  "temu_raw_flowGrow",
] as const;

type ProductTaskFilter = "all" | "todo" | "stock" | "violation" | "activity" | "lowSales";

const NON_STORE_NAME_PATTERNS = [
  /^(?:\u5fd8\u8bb0\u5bc6\u7801|\u627e\u56de\u5bc6\u7801|\u767b\u5f55|\u6ce8\u518c|\u9a8c\u8bc1\u7801)$/u,
  /^(?:Forgot Password|Reset Password|Login|Log In|Sign In|Register|Verification Code)$/i,
  /^(?:\u521b\u5efa\u65b0\u5e97\u94fa.*|\u5408\u89c4\u767b\u8bb0(?:\u53ca)?\u9a8c\u8bc1.*|0\u5143\u5f00\u5e97|\u514d\u8d39\u5f00\u5e97|\u6211\u8981\u5f00\u5e97|\u7acb\u5373\u5f00\u5e97|\u53bb\u5f00\u5e97)$/u,
  /^(?:\u9690\u79c1\u653f\u7b56|\u9690\u79c1\u6761\u6b3e|\u7528\u6237\u534f\u8bae|\u670d\u52a1\u6761\u6b3e|\u6cd5\u5f8b\u58f0\u660e|\u5173\u4e8e\u6211\u4eec|\u8054\u7cfb\u6211\u4eec)$/u,
  /^(0元开店|免费开店|我要开店|立即开店|去开店|未识别店铺|采集快照)$/i,
  /(开店|入驻|注册|登录|退出|刷新|通知|日志|设置|账号|业务|数据|管理|全部|搜索|验证码)/i,
  /(店铺控制台|采集|巡店|帮助|教程|下载|升级|活动报名)/i,
  /(隐私政策|隐私条款|用户协议|服务条款|法律声明|Privacy Policy|Cookie Policy|Terms of Use|Terms & Conditions|Legal Notice|About Us|Contact Us)/i,
];

function normalizeStoreNameText(value?: string | null) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[>›].*$/, "")
    .replace(/\s*(?:\u5207\u6362\u5e97\u94fa|\u5e97\u94fa\u5207\u6362|\u5207\u6362)\s*$/u, "")
    .replace(/\s*(?:Switch Store|Switch)\s*$/i, "")
    .trim();
}

function emptyTaskSummary(): StoreTaskSummary {
  return {
    total: 0,
    signalTotal: 0,
    status: "clear",
    categories: Object.fromEntries(TASK_DEFINITIONS.map((definition) => [definition.key, {
      key: definition.key,
      label: definition.label,
      count: 0,
      signalCount: 0,
      sourceKeys: [],
      sourceCounts: {},
    }])),
  };
}

function mergeTaskSummaries(summaries: Array<StoreTaskSummary | undefined>) {
  const merged = emptyTaskSummary();
  const sourceKeys = new Map<StoreTaskKey, Set<string>>(
    TASK_DEFINITIONS.map((definition) => [definition.key, new Set<string>()]),
  );
  const sourceCounts = new Map<StoreTaskKey, Map<string, number>>(
    TASK_DEFINITIONS.map((definition) => [definition.key, new Map<string, number>()]),
  );
  for (const summary of summaries) {
    const categories = summary?.categories || {};
    for (const definition of TASK_DEFINITIONS) {
      const source = categories[definition.key];
      if (!source) continue;
      const bucket = merged.categories?.[definition.key];
      if (!bucket) continue;
      bucket.signalCount = Number(bucket.signalCount || 0) + Number(source.signalCount || 0);
      const counts = source.sourceCounts || {};
      if (Object.keys(counts).length) {
        for (const [key, value] of Object.entries(counts)) {
          const textKey = String(key);
          sourceKeys.get(definition.key)?.add(textKey);
          const current = sourceCounts.get(definition.key)?.get(textKey) || 0;
          sourceCounts.get(definition.key)?.set(textKey, Math.max(current, Number(value || 0)));
        }
      } else {
        for (const key of source.sourceKeys || []) {
          const textKey = String(key);
          sourceKeys.get(definition.key)?.add(textKey);
          const current = sourceCounts.get(definition.key)?.get(textKey) || 0;
          sourceCounts.get(definition.key)?.set(textKey, Math.max(current, Number(source.count || 0)));
        }
      }
    }
  }
  for (const definition of TASK_DEFINITIONS) {
    const bucket = merged.categories?.[definition.key];
    if (!bucket) continue;
    bucket.sourceKeys = Array.from(sourceKeys.get(definition.key) || []);
    bucket.sourceCounts = Object.fromEntries(sourceCounts.get(definition.key) || []);
    bucket.count = Object.values(bucket.sourceCounts).reduce((sum, value) => sum + Number(value || 0), 0);
    merged.total += Number(bucket.count || 0);
    merged.signalTotal = Number(merged.signalTotal || 0) + Number(bucket.signalCount || 0);
  }
  merged.status = merged.total > 0 ? "todo" : "clear";
  return merged;
}

function taskBucket(snapshot: StoreSnapshot, key: StoreTaskKey) {
  return snapshot.taskSummary?.categories?.[key] || emptyTaskSummary().categories?.[key];
}

function getTaskStatus(snapshot: StoreSnapshot) {
  if (!hasSnapshot(snapshot)) return { color: "default", text: "待采集" };
  if (Number(snapshot.taskSummary?.total || 0) > 0) return { color: "warning", text: "有任务" };
  return { color: "success", text: "已采集" };
}

function renderTaskTag(snapshot: StoreSnapshot, definition: { key: StoreTaskKey; label: string; color: string }) {
  const bucket = taskBucket(snapshot, definition.key);
  const count = Number(bucket?.count || 0);
  const signalCount = Number(bucket?.signalCount || 0);
  return (
    <Tag color={count > 0 ? definition.color : "default"} style={{ marginInlineEnd: 0 }}>
      {count > 0 ? count : signalCount > 0 ? 0 : "-"}
    </Tag>
  );
}

function skcTaskColor(flag: string) {
  if (flag === "补货") return "blue";
  if (flag === "违规") return "red";
  if (flag === "活动") return "purple";
  if (flag === "价格") return "orange";
  if (flag === "备货单") return "cyan";
  return "default";
}

function renderSkcTaskFlags(flags: string[]) {
  if (!flags.length) return <Tag color="success">正常</Tag>;
  return (
    <Space size={[4, 4]} wrap>
      {flags.map((flag) => (
        <Tag key={flag} color={skcTaskColor(flag)} style={{ marginInlineEnd: 0 }}>
          {flag}
        </Tag>
      ))}
    </Space>
  );
}

function rowSearchText(row: SkcDashboardRow) {
  return [
    row.title,
    row.skcId,
    row.goodsId,
    row.spuId,
    ...(row.skuIds || []),
    row.category,
    row.status,
    row.siteLabel,
    row.storeName,
    row.ownerName,
  ].join(" ").toLowerCase();
}

function isLowSalesProduct(row: SkcDashboardRow) {
  return Number(row.last30DaysSales || row.totalSales || 0) <= 0 && Number(row.exposeNum || row.clickNum || 0) > 0;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatBytes(value?: number | null) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatNumber(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return Math.round(number).toLocaleString("zh-CN");
}

function taskTotal(snapshot: StoreSnapshot) {
  return Number(snapshot.taskSummary?.total || 0);
}

function sourceCoveragePercent(snapshot: StoreSnapshot, maxSourceCount: number) {
  if (maxSourceCount <= 0) return 0;
  return Math.round((Number(snapshot.sourceCount || 0) / maxSourceCount) * 100);
}

function normalizeTextValue(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toNumberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = normalizeTextValue(value).replace(/,/g, "");
  if (!text) return 0;
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = normalizeTextValue(value);
    if (text) return text;
  }
  return "";
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const number = toNumberValue(value);
    if (number > 0) return number;
  }
  return 0;
}

function normalizeImageUrl(value: unknown) {
  const text = firstText(value);
  if (!text) return "";
  const firstUrl = text.split(",").map((item) => item.trim()).find(Boolean) || text;
  if (/^\/\//.test(firstUrl)) return `https:${firstUrl}`;
  return firstUrl;
}

const IMAGE_FIELD_KEYS = [
  "imageUrl",
  "mainImageUrl",
  "materialUrl",
  "pictureUrl",
  "picUrl",
  "coverUrl",
  "coverPicture",
  "productImageUrl",
  "goodsImageUrl",
  "thumbUrl",
  "thumbnailUrl",
  "imgUrl",
  "image",
  "mainImage",
  "mainPicture",
  "productImage",
  "productSkcPicture",
  "goodsImage",
  "picture",
  "pic",
  "cover",
  "thumbnail",
  "thumb",
] as const;

const IMAGE_LIST_FIELD_KEYS = [
  "imageUrls",
  "imageUrlList",
  "images",
  "imageList",
  "imgUrls",
  "imgList",
  "pics",
  "picUrls",
  "picList",
  "pictures",
  "pictureList",
  "materialUrls",
  "carouselImageUrls",
  "productImageList.carouselImageUrls",
  "productImageList",
  "productImages",
  "goodsImages",
  "mainImages",
  "invitationOrderImageList",
] as const;

function readPathValue(record: any, path: string) {
  return path.split(".").reduce((current, key) => (
    current && typeof current === "object" ? current[key] : undefined
  ), record);
}

function looksLikeImageUrl(value: unknown) {
  const text = normalizeImageUrl(value);
  if (!text) return "";
  if (/^(?:https?:)?\/\//i.test(text)) return text;
  if (/^(?:data:image\/)/i.test(text)) return text;
  if (/\.(?:jpe?g|png|webp|gif|bmp|avif)(?:[?#].*)?$/i.test(text)) return text;
  return "";
}

function pickFirstImageFromValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined || depth > 4) return "";
  const direct = looksLikeImageUrl(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 30)) {
      const image = pickFirstImageFromValue(item, depth + 1);
      if (image) return image;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of IMAGE_FIELD_KEYS) {
    const image = pickFirstImageFromValue(record[key], depth + 1);
    if (image) return image;
  }
  for (const key of IMAGE_LIST_FIELD_KEYS) {
    const image = pickFirstImageFromValue(readPathValue(record, key), depth + 1);
    if (image) return image;
  }
  if (depth >= 2) return "";
  for (const [key, child] of Object.entries(record)) {
    if (!/image|img|pic|thumb|cover|picture|photo|carousel|materialUrl/i.test(key)) continue;
    const image = pickFirstImageFromValue(child, depth + 1);
    if (image) return image;
  }
  return "";
}

function pickRecordImageUrl(record: any) {
  for (const key of IMAGE_FIELD_KEYS) {
    const image = pickFirstImageFromValue(record?.[key]);
    if (image) return image;
  }
  for (const key of IMAGE_LIST_FIELD_KEYS) {
    const image = pickFirstImageFromValue(readPathValue(record, key));
    if (image) return image;
  }
  return normalizeImageUrl(pickFirstImageFromValue(record));
}

function readRecordId(record: any) {
  const skcId = firstText(record?.skcId, record?.skc_id, record?.productSkcId, record?.product_skc_id, record?.skc);
  const skuId = firstText(record?.skuId, record?.sku_id, record?.productSkuId, record?.product_sku_id, record?.sku);
  const goodsId = firstText(record?.goodsId, record?.goods_id, record?.productId, record?.product_id, record?.goodsSn);
  const spuId = firstText(record?.spuId, record?.spu_id, record?.productSpuId, record?.spu);
  const title = firstText(record?.title, record?.productName, record?.productTitle, record?.goodsName, record?.name);
  return { skcId, skuId, goodsId, spuId, title };
}

function collectSkuIds(record: any) {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    const text = firstText(value);
    if (text) ids.add(text);
  };
  add(record?.skuId);
  add(record?.sku_id);
  add(record?.productSkuId);
  add(record?.product_sku_id);
  add(record?.sku);
  const lists = [
    record?.skuQuantityDetailList,
    record?.skuQuantityList,
    record?.skuList,
    record?.skus,
  ].filter(Array.isArray);
  for (const list of lists) {
    for (const item of list) {
      add(item?.skuId);
      add(item?.sku_id);
      add(item?.productSkuId);
      add(item?.product_sku_id);
      add(item?.sku);
    }
  }
  return Array.from(ids).slice(0, 40);
}

function isProductLikeRecord(record: any) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  const { skcId, goodsId, spuId, title } = readRecordId(record);
  if (skcId || goodsId || spuId) return true;
  if (!title || title.length < 4) return false;
  return Boolean(
    pickRecordImageUrl(record)
    || record.price || record.todaySales || record.totalSales || record.exposeNum,
  );
}

function collectProductLikeRecords(value: any, depth = 0, out: any[] = []) {
  if (!value || depth > 5 || out.length > 1000) return out;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 800)) {
      collectProductLikeRecords(item, depth + 1, out);
    }
    return out;
  }
  if (typeof value !== "object") return out;
  if (isProductLikeRecord(value)) out.push(value);
  for (const child of Object.values(value).slice(0, 80)) {
    collectProductLikeRecords(child, depth + 1, out);
  }
  return out;
}

function mergeSkcValue(current: string, incoming: string) {
  return current || incoming || "";
}

function mergeSkcRow(row: SkcDashboardRow, record: any, sourceKey: string) {
  const ids = readRecordId(record);
  row.skcId = mergeSkcValue(row.skcId, ids.skcId);
  row.skuIds = Array.from(new Set([...(row.skuIds || []), ...collectSkuIds(record)])).slice(0, 40);
  row.goodsId = mergeSkcValue(row.goodsId, ids.goodsId);
  row.spuId = mergeSkcValue(row.spuId, ids.spuId);
  row.title = mergeSkcValue(row.title, ids.title);
  row.category = mergeSkcValue(row.category, firstText(record.category, record.categories, record.categoryName));
  row.imageUrl = mergeSkcValue(row.imageUrl, pickRecordImageUrl(record));
  row.status = mergeSkcValue(row.status, firstText(record.status, record.skcSiteStatus, record.removeStatus, record.flowLimitStatus));
  row.siteLabel = mergeSkcValue(row.siteLabel, firstText(record.siteLabel, record.siteName, record.regionName));
  row.price = mergeSkcValue(row.price, firstText(record.price, record.salePrice, record.retailPrice));
  row.todaySales += firstNumber(record.todaySales, record.todaySaleVolume, record.todayPayGoodsNum);
  row.last7DaysSales += firstNumber(record.last7DaysSales, record.sevenDaysSaleReference, record.recent7SaleVolume);
  row.last30DaysSales += firstNumber(record.last30DaysSales, record.monthSales, record.recent30SaleVolume);
  row.totalSales += firstNumber(record.totalSales, record.saleVolume, record.salesVolume);
  row.exposeNum += firstNumber(record.exposeNum, record.exposureNum, record.impressionNum);
  row.clickNum += firstNumber(record.clickNum, record.clickUserNum);
  row.payGoodsNum += firstNumber(record.payGoodsNum, record.payNum, record.buyerNum);
  row.warehouseStock += firstNumber(record.warehouseStock, record.stock, record.inventory, record.availableStock);
  row.adviceQuantity += firstNumber(record.adviceQuantity, record.suggestStock, record.replenishQuantity);
  row.lackQuantity += firstNumber(record.lackQuantity, record.shortageQuantity, record.lackNum);
  row.pendingOrderCount += firstNumber(record.pendingOrderCount, record.quantity);
  row.sourceCount += 1;

  const text = `${sourceKey} ${row.status} ${firstText(record.stockStatus, record.supplyStatus, record.flowLimitStatus)}`.toLowerCase();
  const flags = new Set(row.taskFlags);
  if (row.lackQuantity > 0 || row.adviceQuantity > 0 || /soldout|sold.?out|缺货|售罄|补货|shortage|lack/.test(text)) flags.add("补货");
  if (/govern|violation|checkup|quality|penalty|违规|处罚|治理|质检/.test(text)) flags.add("违规");
  if (/activity|marketing|campaign|coupon|活动|营销|报名/.test(text)) flags.add("活动");
  if (/flowprice|price|retail|价格|限价/.test(text)) flags.add("价格");
  if (row.pendingOrderCount > 0) flags.add("备货单");
  row.taskFlags = Array.from(flags);
}

function emptySkcRow(accountId: string, storeName: string, ownerName: string | null | undefined, key: string): SkcDashboardRow {
  return {
    id: `${accountId}:${key}`,
    accountId,
    storeName: reliableStoreName(storeName),
    ownerName,
    skcId: "",
    skuIds: [],
    goodsId: "",
    spuId: "",
    title: "",
    imageUrl: "",
    category: "",
    status: "",
    siteLabel: "",
    price: "",
    todaySales: 0,
    last7DaysSales: 0,
    last30DaysSales: 0,
    totalSales: 0,
    exposeNum: 0,
    clickNum: 0,
    payGoodsNum: 0,
    warehouseStock: 0,
    adviceQuantity: 0,
    lackQuantity: 0,
    pendingOrderCount: 0,
    taskFlags: [],
    sourceCount: 0,
  };
}

function buildSkcRowsForStore(accountId: string, storeName: string, ownerName: string | null | undefined, values: Record<string, any>) {
  const records: Array<{ sourceKey: string; record: any }> = [];
  const products = parseProductsData(values.temu_products);
  const sales = parseSalesData(values.temu_sales)?.items || [];
  const orders = parseOrdersData(values.temu_orders);
  const flux = parseFluxData(values.temu_flux)?.items || [];
  for (const record of products) records.push({ sourceKey: "products", record });
  for (const record of sales) records.push({ sourceKey: "sales", record });
  for (const record of orders) records.push({ sourceKey: "orders", record });
  for (const record of flux) records.push({ sourceKey: "flux", record });
  for (const key of SKC_STORE_KEYS.filter((item) => !["temu_products", "temu_sales", "temu_orders", "temu_flux"].includes(item))) {
    for (const record of collectProductLikeRecords(values[key])) {
      records.push({ sourceKey: key, record });
    }
  }

  const rows = new Map<string, SkcDashboardRow>();
  for (const { sourceKey, record } of records) {
    const ids = readRecordId(record);
    const skuKey = ids.skuId || collectSkuIds(record)[0] || "";
    const key = ids.skcId || skuKey || ids.goodsId || ids.spuId || (ids.title ? `title:${ids.title.slice(0, 40)}` : "");
    if (!key) continue;
    const row = rows.get(key) || emptySkcRow(accountId, storeName, ownerName, key);
    mergeSkcRow(row, record, sourceKey);
    rows.set(key, row);
  }

  return Array.from(rows.values())
    .filter((row) => row.skcId || row.goodsId || row.title)
    .sort((left, right) => (
      Number(right.taskFlags.length > 0) - Number(left.taskFlags.length > 0)
      || right.lackQuantity - left.lackQuantity
      || right.last30DaysSales - left.last30DaysSales
      || right.sourceCount - left.sourceCount
    ));
}

function isReliableStoreName(value?: string | null) {
  const text = normalizeStoreNameText(value);
  if (text.length < 3 || text.length > 80) return false;
  if (/^temu_ext_[a-f0-9]+$/i.test(text)) return false;
  if (/^acct[_:-]/i.test(text)) return false;
  if (/^\+?\d[\d\s*()-]{3,}$/.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  if (!/[A-Za-z\u4e00-\u9fff]/.test(text)) return false;
  if (NON_STORE_NAME_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return true;
}

function reliableStoreName(value?: string | null) {
  const text = normalizeStoreNameText(value);
  return isReliableStoreName(text) ? text : "";
}

function displayStoreName(snapshot?: StoreSnapshot | null) {
  if (!snapshot) return "采集快照";
  return reliableStoreName(snapshot.storeName) || "未识别店铺";
}

function displaySkcStoreName(row?: Pick<SkcDashboardRow | StoreSkcSummary, "storeName"> | null) {
  return reliableStoreName(row?.storeName) || "未识别店铺";
}

function skcStoreGroupKey(row: Pick<SkcDashboardRow | StoreSkcSummary, "accountId" | "storeName">) {
  return `${row.accountId || "account"}:${displaySkcStoreName(row)}`;
}

function skcSummaryMatchesStore(summary: any, storeName?: string | null) {
  const snapshotStoreName = reliableStoreName(storeName);
  if (!summary || typeof summary !== "object" || !snapshotStoreName) return true;
  const summaryStoreName = reliableStoreName(summary.storeName || summary.totals?.storeName);
  if (summaryStoreName && summaryStoreName !== snapshotStoreName) return false;
  const rowStoreNames = new Set(
    (Array.isArray(summary.rows) ? summary.rows : [])
      .map((row: any) => reliableStoreName(row?.storeName))
      .filter(Boolean),
  );
  return rowStoreNames.size === 0 || rowStoreNames.has(snapshotStoreName);
}

function isGeneratedStoreAccountId(value?: string | null) {
  return /^(temu_ext|acct)_/i.test(String(value || ""));
}

function shouldShowStoreRow(snapshot: StoreSnapshot) {
  if (isReliableStoreName(snapshot.storeName)) return true;
  const accountText = normalizeStoreNameText(snapshot.accountId);
  return !isGeneratedStoreAccountId(accountText) && isReliableStoreName(accountText);
}

function snapshotDayKey(value?: string | null) {
  if (!value) return "pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10) || "pending";
  return date.toISOString().slice(0, 10);
}

function mergeStoreSnapshots(rows: StoreSnapshot[]) {
  const groups = new Map<string, StoreSnapshot[]>();
  for (const row of rows.filter(shouldShowStoreRow)) {
    const storeName = reliableStoreName(row.storeName);
    const key = storeName ? `${snapshotDayKey(row.collectedAt || row.uploadedAt)}:${storeName}` : `${row.accountId || "acc"}:${snapshotDayKey(row.collectedAt || row.uploadedAt)}:${storeName || "unknown"}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return Array.from(groups.values()).map((items) => {
    const sorted = [...items].sort((left, right) => (
      Date.parse(right.uploadedAt || right.collectedAt || "") - Date.parse(left.uploadedAt || left.collectedAt || "")
    ));
    const latest = sorted[0];
    const bestSkcSummary = [...items]
      .map((item) => item.skcSummary)
      .filter((summary) => summary && typeof summary === "object" && skcSummaryMatchesStore(summary, latest.storeName))
      .sort((left, right) => Number(right?.rows?.length || 0) - Number(left?.rows?.length || 0))[0]
      || (skcSummaryMatchesStore(latest.skcSummary, latest.storeName) ? latest.skcSummary : undefined);
    const sourceCount = items.reduce((sum, item) => sum + Number(item.sourceCount || 0), 0);
    const payloadBytes = items.reduce((sum, item) => sum + Number(item.payloadBytes || 0), 0);
    const successCount = items.reduce((sum, item) => sum + Number(item.summary?.successCount || 0), 0);
    const errorCount = items.reduce((sum, item) => sum + Number(item.summary?.errorCount || 0), 0);
    const totalTasks = items.reduce((sum, item) => sum + Number(item.summary?.totalTasks || 0), 0);
    const taskSummary = mergeTaskSummaries(items.map((item) => item.taskSummary));
    return {
      ...latest,
      id: items.length > 1 ? `aggregate:${snapshotDayKey(latest.collectedAt || latest.uploadedAt)}:${reliableStoreName(latest.storeName) || displayStoreName(latest)}` : latest.id,
      snapshotIds: items.map((item) => item.id).filter((id) => !String(id).startsWith("account:")),
      storeName: reliableStoreName(latest.storeName) || displayStoreName(latest),
      sourceCount,
      payloadBytes,
      taskSummary,
      skcSummary: bestSkcSummary,
      summary: {
        ...(latest.summary || {}),
        totalTasks,
        successCount,
        errorCount,
      },
    };
  });
}

function todayNineClock() {
  const date = new Date();
  date.setHours(9, 0, 0, 0);
  return date;
}

function isAfterTodayPatrolTime(value?: string | null) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date >= todayNineClock();
}

function hasSnapshot(row: StoreSnapshot) {
  return Boolean(row.collectedAt && !String(row.id || "").startsWith("account:"));
}

function getPatrolStatus(snapshot: StoreSnapshot) {
  const afterMorning = isAfterTodayPatrolTime(snapshot.collectedAt);
  const errorCount = Number(snapshot.summary?.errorCount || 0);
  if (!afterMorning) {
    return { color: "default", text: new Date() < todayNineClock() ? "等待 9:00" : "今日未巡" };
  }
  if (errorCount > 0) return { color: "warning", text: "已巡，有失败" };
  return { color: "success", text: "今日已巡" };
}

function isRemoteNotFoundError(error: unknown) {
  const messageText = error instanceof Error ? error.message : String(error || "");
  return /not found/i.test(messageText) || /404/.test(messageText);
}

export default function StoreConsole() {
  const [snapshots, setSnapshots] = useState<StoreSnapshot[]>([]);
  const [skcRows, setSkcRows] = useState<SkcDashboardRow[]>([]);
  const [productKeyword, setProductKeyword] = useState("");
  const [productStoreFilter, setProductStoreFilter] = useState<string | undefined>();
  const [productOwnerFilter, setProductOwnerFilter] = useState<string | undefined>();
  const [productTaskFilter, setProductTaskFilter] = useState<ProductTaskFilter>("all");
  const [loading, setLoading] = useState(false);
  const [skcLoading, setSkcLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selected, setSelected] = useState<StoreSnapshot | null>(null);

  const loadSkcRows = useCallback(async (storeSnapshots: StoreSnapshot[]) => {
    const localStore = window.electronAPI?.store;
    const cloudRows = storeSnapshots.flatMap((snapshot) => {
      const snapshotStoreName = reliableStoreName(snapshot.storeName);
      const summaryStoreName = reliableStoreName(snapshot.skcSummary?.storeName);
      if (snapshotStoreName && summaryStoreName && summaryStoreName !== snapshotStoreName) {
        return [];
      }
      const fallbackStoreName = summaryStoreName || snapshotStoreName || displayStoreName(snapshot);
      return normalizeSkcRowsFromSummary(snapshot.skcSummary, {
        accountId: snapshot.accountId,
        storeName: fallbackStoreName,
        ownerName: snapshot.ownerName || null,
      }).map((row) => ({
        ...row,
        storeName: reliableStoreName(row.storeName) || fallbackStoreName,
      }));
    }).filter((row) => isReliableStoreName(row.storeName));
    if (!localStore?.get) {
      setSkcRows(cloudRows);
      return;
    }
    setSkcLoading(true);
    try {
      const [accountsRaw, activeAccountIdRaw] = await Promise.all([
        localStore.get(ACCOUNT_STORE_KEY).catch(() => []),
        localStore.get(ACTIVE_ACCOUNT_ID_KEY).catch(() => null),
      ]);
      const accountRows = Array.isArray(accountsRaw) ? accountsRaw as StoreAccount[] : [];
      const activeAccountId = typeof activeAccountIdRaw === "string" ? activeAccountIdRaw : "";
      const snapshotsByAccount = new Map<string, StoreSnapshot[]>();
      for (const snapshot of storeSnapshots) {
        if (!snapshot.accountId) continue;
        snapshotsByAccount.set(snapshot.accountId, [
          ...(snapshotsByAccount.get(snapshot.accountId) || []),
          snapshot,
        ]);
      }
      const accountById = new Map<string, StoreAccount>();
      for (const account of accountRows) {
        if (account?.id) accountById.set(account.id, account);
      }
      const uniqueSnapshotByAccount = (accountId: string) => {
        const items = snapshotsByAccount.get(accountId) || [];
        const reliableItems = items.filter((item) => reliableStoreName(item.storeName));
        const names = new Set(reliableItems.map((item) => reliableStoreName(item.storeName)));
        if (names.size === 1) return reliableItems[0];
        return items.length === 1 ? items[0] : undefined;
      };
      const accountIds = Array.from(new Set([
        ...storeSnapshots.map((snapshot) => snapshot.accountId).filter(Boolean),
        ...accountRows.map((account) => account.id).filter(Boolean),
        activeAccountId,
      ].filter(Boolean)));

      const scopedKeys = accountIds.flatMap((accountId) => (
        SKC_STORE_KEYS.map((key) => buildScopedStoreKey(accountId, key))
      ));
      const baseKeys = [ACTIVE_ACCOUNT_ID_KEY, ...SKC_STORE_KEYS];
      const scopedValues = localStore.getMany
        ? await localStore.getMany(scopedKeys)
        : Object.fromEntries(await Promise.all(scopedKeys.map(async (key) => [key, await localStore.get(key)] as const)));
      const baseValues = localStore.getMany
        ? await localStore.getMany(baseKeys)
        : Object.fromEntries(await Promise.all(baseKeys.map(async (key) => [key, await localStore.get(key)] as const)));

      const rows: SkcDashboardRow[] = [];
      for (const accountId of accountIds) {
        const snapshot = uniqueSnapshotByAccount(accountId);
        const account = accountById.get(accountId);
        const rawStoreName = snapshot?.storeName || account?.name || "";
        const storeName = reliableStoreName(rawStoreName);
        const ownerName = snapshot?.ownerName || account?.ownerName || null;
        const values = Object.fromEntries(SKC_STORE_KEYS.map((key) => {
          const scopedValue = scopedValues?.[buildScopedStoreKey(accountId, key)];
          const value = scopedValue !== null && scopedValue !== undefined
            ? scopedValue
            : accountId === activeAccountId
            ? baseValues?.[key]
            : null;
          return [key, value];
        }));
        rows.push(...buildSkcRowsForStore(accountId, storeName, ownerName, values)
          .filter((row) => isReliableStoreName(row.storeName)));
      }
      const localStoreKeys = new Set(rows.map((row) => skcStoreGroupKey(row)));
      setSkcRows([
        ...rows,
        ...cloudRows.filter((row) => !localStoreKeys.has(skcStoreGroupKey(row))),
      ]);
    } catch (error: any) {
      message.warning(error?.message || "加载 SKC 看板数据失败");
      setSkcRows(cloudRows);
    } finally {
      setSkcLoading(false);
    }
  }, []);

  const loadSnapshots = useCallback(async () => {
    const erp = window.electronAPI?.erp;
    const api = erp?.storeCollection;
    if (!api?.list) return;
    setLoading(true);
    try {
      const [rowsResult, accountsResult] = await Promise.allSettled([
        api.list({ latestOnly: false, limit: 500 }),
        erp?.account?.list ? erp.account.list({ limit: 500 }) : Promise.resolve([]),
      ]);
      const snapshotRows = rowsResult.status === "fulfilled" && Array.isArray(rowsResult.value)
        ? rowsResult.value as StoreSnapshot[]
        : [];
      const accountRows = accountsResult.status === "fulfilled" && Array.isArray(accountsResult.value)
        ? (accountsResult.value as StoreAccount[]).filter((account) => isReliableStoreName(account?.name))
        : [];
      if (rowsResult.status === "rejected" && !isRemoteNotFoundError(rowsResult.reason)) {
        message.warning(rowsResult.reason?.message || "加载巡店快照失败");
      }
      if (accountsResult.status === "rejected") {
        message.warning(accountsResult.reason?.message || "加载店铺账号失败");
      }
      const byAccountId = new Map(snapshotRows.map((row) => [row.accountId, row]));
      const merged = [...snapshotRows];
      for (const account of accountRows) {
        const snapshot = byAccountId.get(account.id);
        if (snapshot) {
          if (!isReliableStoreName(snapshot.storeName)) snapshot.storeName = account.name;
          if (!snapshot.ownerName) snapshot.ownerName = account.ownerName || null;
          continue;
        }
        merged.push({
          id: `account:${account.id}`,
          accountId: account.id,
          storeName: account.name || account.id,
          ownerName: account.ownerName || null,
          summary: { totalTasks: 0, successCount: 0, errorCount: 0 },
          sourceCount: 0,
          payloadBytes: 0,
          status: "pending",
        });
      }
      const nextSnapshots = mergeStoreSnapshots(merged);
      setSnapshots(nextSnapshots);
      void loadSkcRows(nextSnapshots);
    } catch (error: any) {
      message.error(error?.message || "加载店铺控制台失败");
    } finally {
      setLoading(false);
    }
  }, [loadSkcRows]);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

  const openDetail = async (snapshot: StoreSnapshot) => {
    const api = window.electronAPI?.erp?.storeCollection;
    if (!api?.detail) {
      setSelected(snapshot);
      return;
    }
    setDetailLoading(true);
    setSelected(snapshot);
    try {
      const snapshotIds = snapshot.snapshotIds?.length ? snapshot.snapshotIds : [snapshot.id];
      const details = await Promise.all(
        snapshotIds
          .filter((id) => !String(id).startsWith("aggregate:") && !String(id).startsWith("account:"))
          .map((id) => api.detail({ id, includePayload: false })),
      );
      const sources = details.flatMap((detail: any) => Array.isArray(detail?.sources) ? detail.sources : []);
      setSelected({
        ...snapshot,
        sources,
        sourceCount: sources.length || snapshot.sourceCount,
      });
    } catch (error: any) {
      message.error(error?.message || "加载快照详情失败");
    } finally {
      setDetailLoading(false);
    }
  };

  const stats = useMemo(() => {
    const total = snapshots.length;
    const todayDone = snapshots.filter((item) => isAfterTodayPatrolTime(item.collectedAt)).length;
    const withErrors = snapshots.filter((item) => Number(item.summary?.errorCount || 0) > 0).length;
    const payloadBytes = snapshots.reduce((sum, item) => sum + Number(item.payloadBytes || 0), 0);
    const sourceTotal = snapshots.reduce((sum, item) => sum + Number(item.sourceCount || 0), 0);
    const taskTotal = snapshots.reduce((sum, item) => sum + Number(item.taskSummary?.total || 0), 0);
    const withTasks = snapshots.filter((item) => Number(item.taskSummary?.total || 0) > 0).length;
    const afterMorning = new Date() >= todayNineClock();
    return {
      total,
      todayDone,
      missing: afterMorning ? Math.max(0, total - todayDone) : 0,
      withErrors,
      payloadBytes,
      sourceTotal,
      taskTotal,
      withTasks,
      percent: total > 0 ? Math.round((todayDone / total) * 100) : 0,
    };
  }, [snapshots]);

  const taskDistributionData = useMemo(() => TASK_DEFINITIONS.map((definition) => {
    const count = snapshots.reduce((sum, item) => sum + Number(taskBucket(item, definition.key)?.count || 0), 0);
    const signalCount = snapshots.reduce((sum, item) => sum + Number(taskBucket(item, definition.key)?.signalCount || 0), 0);
    return {
      key: definition.key,
      label: definition.label,
      count,
      signalCount,
      fill: definition.chartColor,
    };
  }), [snapshots]);

  const storeTaskChartData = useMemo(() => snapshots
    .map((snapshot) => {
      const row: Record<string, string | number> = {
        store: displayStoreName(snapshot),
        total: Number(snapshot.taskSummary?.total || 0),
      };
      for (const definition of TASK_DEFINITIONS) {
        row[definition.key] = Number(taskBucket(snapshot, definition.key)?.count || 0);
      }
      return row;
    })
    .sort((left, right) => Number(right.total || 0) - Number(left.total || 0))
    .slice(0, 12), [snapshots]);

  const maxSourceCount = useMemo(() => snapshots.reduce((max, snapshot) => (
    Math.max(max, Number(snapshot.sourceCount || 0))
  ), 0), [snapshots]);

  const storeDataChartData = useMemo(() => snapshots
    .map((snapshot) => ({
      store: displayStoreName(snapshot),
      sourceCount: Number(snapshot.sourceCount || 0),
      payloadKb: Math.round(Number(snapshot.payloadBytes || 0) / 1024),
      taskTotal: taskTotal(snapshot),
      coverage: sourceCoveragePercent(snapshot, maxSourceCount),
    }))
    .sort((left, right) => right.sourceCount - left.sourceCount)
    .slice(0, 12), [maxSourceCount, snapshots]);

  const ownerChartData = useMemo(() => {
    const groups = new Map<string, { owner: string; stores: number; tasks: number; sources: number }>();
    for (const snapshot of snapshots) {
      const owner = snapshot.ownerName || "未绑定负责人";
      const current = groups.get(owner) || { owner, stores: 0, tasks: 0, sources: 0 };
      current.stores += 1;
      current.tasks += taskTotal(snapshot);
      current.sources += Number(snapshot.sourceCount || 0);
      groups.set(owner, current);
    }
    return Array.from(groups.values()).sort((left, right) => right.tasks - left.tasks);
  }, [snapshots]);

  const priorityStores = useMemo(() => [...snapshots]
    .sort((left, right) => {
      const taskDiff = taskTotal(right) - taskTotal(left);
      if (taskDiff !== 0) return taskDiff;
      return Number(right.sourceCount || 0) - Number(left.sourceCount || 0);
    })
    .slice(0, 6), [snapshots]);

  const skcStats = useMemo(() => {
    const taskRows = skcRows.filter((row) => row.taskFlags.length > 0);
    return {
      total: skcRows.length,
      stores: new Set(skcRows.map((row) => skcStoreGroupKey(row))).size,
      taskTotal: taskRows.length,
      stockTotal: skcRows.filter((row) => row.taskFlags.includes("补货")).length,
      violationTotal: skcRows.filter((row) => row.taskFlags.includes("违规")).length,
      activityTotal: skcRows.filter((row) => row.taskFlags.includes("活动")).length,
      lackQuantity: skcRows.reduce((sum, row) => sum + Number(row.lackQuantity || 0), 0),
      adviceQuantity: skcRows.reduce((sum, row) => sum + Number(row.adviceQuantity || 0), 0),
      totalSales: skcRows.reduce((sum, row) => sum + Number(row.last30DaysSales || row.totalSales || 0), 0),
    };
  }, [skcRows]);

  const storeSkcSummaries = useMemo<StoreSkcSummary[]>(() => {
    const groups = new Map<string, StoreSkcSummary>();
    for (const row of skcRows) {
      const key = skcStoreGroupKey(row);
      const current = groups.get(key) || {
        accountId: row.accountId,
        storeName: displaySkcStoreName(row),
        ownerName: row.ownerName,
        skcCount: 0,
        taskSkcCount: 0,
        stockSkcCount: 0,
        violationSkcCount: 0,
        activitySkcCount: 0,
        totalSales: 0,
        lackQuantity: 0,
        adviceQuantity: 0,
        exposeNum: 0,
      };
      current.skcCount += 1;
      current.taskSkcCount += row.taskFlags.length > 0 ? 1 : 0;
      current.stockSkcCount += row.taskFlags.includes("补货") ? 1 : 0;
      current.violationSkcCount += row.taskFlags.includes("违规") ? 1 : 0;
      current.activitySkcCount += row.taskFlags.includes("活动") ? 1 : 0;
      current.totalSales += Number(row.last30DaysSales || row.totalSales || 0);
      current.lackQuantity += Number(row.lackQuantity || 0);
      current.adviceQuantity += Number(row.adviceQuantity || 0);
      current.exposeNum += Number(row.exposeNum || 0);
      if (isReliableStoreName(row.storeName)) {
        current.storeName = reliableStoreName(row.storeName);
      }
      groups.set(key, current);
    }
    return Array.from(groups.values()).sort((left, right) => (
      right.taskSkcCount - left.taskSkcCount || right.skcCount - left.skcCount
    ));
  }, [skcRows]);

  const taskSkcRows = useMemo(() => skcRows
    .filter((row) => row.taskFlags.length > 0)
    .sort((left, right) => (
      right.taskFlags.length - left.taskFlags.length
      || right.lackQuantity - left.lackQuantity
      || right.last30DaysSales - left.last30DaysSales
    )), [skcRows]);

  const storeSkcChartData = useMemo(() => storeSkcSummaries
    .map((item) => ({
      store: displaySkcStoreName(item),
      skcCount: item.skcCount,
      taskSkcCount: item.taskSkcCount,
      stockSkcCount: item.stockSkcCount,
      violationSkcCount: item.violationSkcCount,
    }))
    .slice(0, 12), [storeSkcSummaries]);

  const skcTaskDistributionData = useMemo(() => ["补货", "违规", "活动", "价格", "备货单"].map((flag) => ({
    flag,
    count: skcRows.filter((row) => row.taskFlags.includes(flag)).length,
    fill: flag === "补货" ? "#1677ff" : flag === "违规" ? "#f5222d" : flag === "活动" ? "#722ed1" : flag === "价格" ? "#fa8c16" : "#13c2c2",
  })).filter((item) => item.count > 0), [skcRows]);

  const topTaskSkcRows = useMemo(() => taskSkcRows.slice(0, 12), [taskSkcRows]);

  const productStoreOptions = useMemo(() => Array.from(new Set(
    skcRows.map((row) => displaySkcStoreName(row)).filter((name) => name && name !== "未识别店铺"),
  )).sort().map((name) => ({ label: name, value: name })), [skcRows]);

  const productOwnerOptions = useMemo(() => Array.from(new Set(
    skcRows.map((row) => row.ownerName || "未绑定负责人"),
  )).sort().map((name) => ({ label: name, value: name })), [skcRows]);

  const productRows = useMemo(() => {
    const keyword = productKeyword.trim().toLowerCase();
    return skcRows.filter((row) => {
      if (productStoreFilter && displaySkcStoreName(row) !== productStoreFilter) return false;
      if (productOwnerFilter && (row.ownerName || "未绑定负责人") !== productOwnerFilter) return false;
      if (keyword && !rowSearchText(row).includes(keyword)) return false;
      if (productTaskFilter === "todo" && row.taskFlags.length === 0) return false;
      if (productTaskFilter === "stock" && !row.taskFlags.includes("补货")) return false;
      if (productTaskFilter === "violation" && !row.taskFlags.includes("违规")) return false;
      if (productTaskFilter === "activity" && !row.taskFlags.includes("活动")) return false;
      if (productTaskFilter === "lowSales" && !isLowSalesProduct(row)) return false;
      return true;
    }).sort((left, right) => (
      Number(right.taskFlags.length > 0) - Number(left.taskFlags.length > 0)
      || right.lackQuantity - left.lackQuantity
      || right.last30DaysSales - left.last30DaysSales
      || right.exposeNum - left.exposeNum
    ));
  }, [productKeyword, productOwnerFilter, productStoreFilter, productTaskFilter, skcRows]);

  const productStats = useMemo(() => ({
    total: productRows.length,
    taskTotal: productRows.filter((row) => row.taskFlags.length > 0).length,
    stockTotal: productRows.filter((row) => row.taskFlags.includes("补货")).length,
    violationTotal: productRows.filter((row) => row.taskFlags.includes("违规")).length,
    activityTotal: productRows.filter((row) => row.taskFlags.includes("活动")).length,
    lowSalesTotal: productRows.filter(isLowSalesProduct).length,
    skuTotal: productRows.reduce((sum, row) => sum + (row.skuIds?.length || 0), 0),
  }), [productRows]);

  const columns: ColumnsType<StoreSnapshot> = [
    {
      title: "店铺",
      dataIndex: "storeName",
      render: (_, row) => (
          <Space direction="vertical" size={0}>
            <Text strong>{displayStoreName(row)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.ownerName ? `负责人：${row.ownerName}` : row.accountId}</Text>
        </Space>
      ),
    },
    {
      title: "负责人",
      dataIndex: "ownerName",
      width: 120,
      render: (value) => value || "-",
    },
    {
      title: "巡店状态",
      width: 130,
      render: (_, row) => {
        const status = getPatrolStatus(row);
        return <Tag color={status.color}>{status.text}</Tag>;
      },
    },
    {
      title: "任务状态",
      width: 110,
      render: (_, row) => {
        const status = getTaskStatus(row);
        return <Tag color={status.color}>{status.text}</Tag>;
      },
    },
    ...TASK_DEFINITIONS.map((definition) => ({
      title: definition.label,
      width: 92,
      align: "center" as const,
      render: (_: unknown, row: StoreSnapshot) => renderTaskTag(row, definition),
    })),
    {
      title: "采集结果",
      width: 160,
      render: (_, row) => {
        const total = Number(row.summary?.totalTasks || 0);
        const success = Number(row.summary?.successCount || 0);
        const error = Number(row.summary?.errorCount || 0);
        if (!total && Number(row.sourceCount || 0) > 0) {
          return <Tag color="success">{row.sourceCount} 项数据</Tag>;
        }
        return (
          <Space>
            <Tag color="success">{success} 成功</Tag>
            {error > 0 ? <Tag color="warning">{error} 失败</Tag> : null}
            {total ? <Text type="secondary">/{total}</Text> : null}
          </Space>
        );
      },
    },
    {
      title: "采集时间",
      dataIndex: "collectedAt",
      width: 190,
      render: formatDate,
    },
    {
      title: "上传时间",
      dataIndex: "uploadedAt",
      width: 190,
      render: formatDate,
    },
    {
      title: "数据包",
      width: 130,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text>{row.sourceCount || 0} 项</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{formatBytes(row.payloadBytes)}</Text>
        </Space>
      ),
    },
    {
      title: "操作",
      width: 90,
      render: (_, row) => (
        <Button
          icon={<EyeOutlined />}
          title="查看详情"
          disabled={!hasSnapshot(row)}
          onClick={() => openDetail(row)}
        />
      ),
    },
  ];

  const storeSkcSummaryColumns: ColumnsType<StoreSkcSummary> = [
    {
      title: "店铺",
      dataIndex: "storeName",
      width: 220,
      render: (value, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{displaySkcStoreName({ storeName: value })}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.ownerName || "未绑定负责人"}</Text>
        </Space>
      ),
    },
    {
      title: "SKC",
      dataIndex: "skcCount",
      width: 90,
      sorter: (left, right) => left.skcCount - right.skcCount,
      render: formatNumber,
    },
    {
      title: "任务 SKC",
      dataIndex: "taskSkcCount",
      width: 110,
      sorter: (left, right) => left.taskSkcCount - right.taskSkcCount,
      render: (value) => <Tag color={Number(value || 0) > 0 ? "warning" : "success"}>{formatNumber(value)}</Tag>,
    },
    {
      title: "任务拆分",
      width: 210,
      render: (_, row) => (
        <Space size={[4, 4]} wrap>
          <Tag color={row.stockSkcCount > 0 ? "blue" : "default"} style={{ marginInlineEnd: 0 }}>补货 {formatNumber(row.stockSkcCount)}</Tag>
          <Tag color={row.violationSkcCount > 0 ? "red" : "default"} style={{ marginInlineEnd: 0 }}>违规 {formatNumber(row.violationSkcCount)}</Tag>
          <Tag color={row.activitySkcCount > 0 ? "purple" : "default"} style={{ marginInlineEnd: 0 }}>活动 {formatNumber(row.activitySkcCount)}</Tag>
        </Space>
      ),
    },
    {
      title: "缺货/建议补货",
      width: 150,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text>{formatNumber(row.lackQuantity)} 缺货</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{formatNumber(row.adviceQuantity)} 建议补货</Text>
        </Space>
      ),
    },
    {
      title: "30日销量",
      dataIndex: "totalSales",
      width: 110,
      sorter: (left, right) => left.totalSales - right.totalSales,
      render: formatNumber,
    },
    {
      title: "曝光",
      dataIndex: "exposeNum",
      width: 110,
      sorter: (left, right) => left.exposeNum - right.exposeNum,
      render: formatNumber,
    },
  ];

  const skcColumns: ColumnsType<SkcDashboardRow> = [
    {
      title: "商品",
      dataIndex: "title",
      width: 360,
      fixed: "left",
      render: (_, row) => (
        <Space align="start" size={10}>
          {row.imageUrl ? (
            <Image
              src={row.imageUrl}
              width={48}
              height={48}
              style={{ objectFit: "cover", borderRadius: 4, border: "1px solid #f0f0f0" }}
              preview={{ mask: "预览" }}
            />
          ) : (
            <div style={{ width: 48, height: 48, border: "1px solid #f0f0f0", borderRadius: 4, background: "#fafafa" }} />
          )}
          <Space direction="vertical" size={0}>
            <Text strong ellipsis style={{ maxWidth: 270 }}>{row.title || "未命名商品"}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{row.category || row.siteLabel || "-"}</Text>
          </Space>
        </Space>
      ),
    },
    {
      title: "店铺",
      width: 190,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text>{displaySkcStoreName(row)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.ownerName || "未绑定负责人"}</Text>
        </Space>
      ),
    },
    {
      title: "SKC / Goods",
      width: 220,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text code>{row.skcId || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.goodsId ? `Goods ${row.goodsId}` : row.spuId ? `SPU ${row.spuId}` : "-"}</Text>
          {row.skuIds?.length ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              SKU {row.skuIds.slice(0, 2).join(", ")}{row.skuIds.length > 2 ? ` +${row.skuIds.length - 2}` : ""}
            </Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "任务",
      dataIndex: "taskFlags",
      width: 190,
      filters: ["补货", "违规", "活动", "价格", "备货单"].map((flag) => ({ text: flag, value: flag })),
      onFilter: (value, row) => row.taskFlags.includes(String(value)),
      render: renderSkcTaskFlags,
    },
    {
      title: "库存",
      width: 160,
      sorter: (left, right) => (left.lackQuantity + left.adviceQuantity) - (right.lackQuantity + right.adviceQuantity),
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text>库存 {formatNumber(row.warehouseStock)}</Text>
          <Text type={row.lackQuantity > 0 ? "danger" : "secondary"} style={{ fontSize: 12 }}>缺货 {formatNumber(row.lackQuantity)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>建议 {formatNumber(row.adviceQuantity)}</Text>
        </Space>
      ),
    },
    {
      title: "销量",
      width: 160,
      sorter: (left, right) => left.last30DaysSales - right.last30DaysSales,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text>30日 {formatNumber(row.last30DaysSales || row.totalSales)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>7日 {formatNumber(row.last7DaysSales)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>今日 {formatNumber(row.todaySales)}</Text>
        </Space>
      ),
    },
    {
      title: "流量",
      width: 170,
      sorter: (left, right) => left.exposeNum - right.exposeNum,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text>曝光 {formatNumber(row.exposeNum)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>点击 {formatNumber(row.clickNum)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>成交 {formatNumber(row.payGoodsNum)}</Text>
        </Space>
      ),
    },
    {
      title: "状态",
      width: 160,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text>{row.status || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.siteLabel || "-"}</Text>
          {row.price ? <Text type="secondary" style={{ fontSize: 12 }}>价格 {row.price}</Text> : null}
        </Space>
      ),
    },
    {
      title: "数据源",
      dataIndex: "sourceCount",
      width: 90,
      sorter: (left, right) => left.sourceCount - right.sourceCount,
      render: formatNumber,
    },
  ];

  const sourceColumns: ColumnsType<StoreSnapshotSource> = [
    { title: "数据项", dataIndex: "label", render: (value, row) => value || row.dataKey },
    { title: "分类", dataIndex: "category", width: 120, render: (value) => value || "-" },
    { title: "Key", dataIndex: "dataKey", width: 220, render: (value) => <Text code>{value}</Text> },
    { title: "记录数", dataIndex: "recordCount", width: 90 },
    { title: "大小", dataIndex: "payloadBytes", width: 100, render: formatBytes },
  ];

  if (!window.electronAPI?.erp?.storeCollection) {
    return <Alert type="warning" showIcon message="当前版本没有店铺控制台云端接口" />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>店铺控制台</Title>
        </div>
        <Button icon={<ReloadOutlined />} onClick={loadSnapshots} loading={loading}>
          刷新
        </Button>
      </div>

      <Row gutter={12}>
        <Col xs={24} md={6}>
          <Card size="small">
            <Space>
              <ShopOutlined style={{ color: "#1677ff", fontSize: 20 }} />
              <div>
                <Text type="secondary">店铺数</Text>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{stats.total}</div>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card size="small">
            <Space>
              <CloudUploadOutlined style={{ color: "#52c41a", fontSize: 20 }} />
              <div>
                <Text type="secondary">今日已巡</Text>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{stats.todayDone}</div>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card size="small">
            <Space>
              <WarningOutlined style={{ color: stats.missing > 0 ? "#faad14" : "#52c41a", fontSize: 20 }} />
              <div>
                <Text type="secondary">待处理任务</Text>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{stats.taskTotal}</div>
                <Text type="secondary" style={{ fontSize: 12 }}>{stats.withTasks} 家有任务，{stats.missing} 家待巡</Text>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card size="small">
            <Text type="secondary">完成率</Text>
            <Progress percent={stats.percent} size="small" status={stats.missing > 0 ? "active" : "success"} />
            <Text type="secondary" style={{ fontSize: 12 }}>云端数据 {formatBytes(stats.payloadBytes)}</Text>
          </Card>
        </Col>
      </Row>

      <div>
        <Space align="center">
          <BarChartOutlined style={{ color: "#1677ff", fontSize: 20 }} />
          <Title level={4} style={{ margin: 0 }}>店铺数据可视化面板</Title>
        </Space>
        <div>
          <Text type="secondary">按今天巡店快照聚合，展示每家店的数据覆盖、任务压力和负责人分布。</Text>
        </div>
      </div>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={8}>
          <Card size="small" title="巡店总盘">
            <Space direction="vertical" style={{ width: "100%" }} size={10}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Text type="secondary">今日巡店完成</Text>
                <Text strong>{stats.todayDone}/{stats.total}</Text>
              </div>
              <Progress percent={stats.percent} size="small" status={stats.missing > 0 ? "active" : "success"} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>待巡</Text>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{stats.missing}</div>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>有任务店铺</Text>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{stats.withTasks}</div>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>失败</Text>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{stats.withErrors}</div>
                </div>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title="采集数据规模">
            <Space direction="vertical" style={{ width: "100%" }} size={10}>
              <Space>
                <DatabaseOutlined style={{ color: "#52c41a", fontSize: 18 }} />
                <div>
                  <Text type="secondary">接口响应</Text>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNumber(stats.sourceTotal)}</div>
                </div>
              </Space>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Text type="secondary">云端数据包</Text>
                <Text strong>{formatBytes(stats.payloadBytes)}</Text>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Text type="secondary">平均每店接口</Text>
                <Text strong>{stats.total > 0 ? formatNumber(stats.sourceTotal / stats.total) : "0"}</Text>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title="重点处理店铺">
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              {priorityStores.length ? priorityStores.map((snapshot) => {
                const count = taskTotal(snapshot);
                return (
                  <div
                    key={snapshot.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 8,
                      alignItems: "center",
                      borderBottom: "1px solid #f0f0f0",
                      paddingBottom: 6,
                    }}
                  >
                    <div>
                      <Text strong>{displayStoreName(snapshot)}</Text>
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>{snapshot.ownerName || "未绑定负责人"}</Text>
                      </div>
                    </div>
                    <Tag color={count > 0 ? "warning" : "success"}>{count > 0 ? `${formatNumber(count)} 个任务` : "无任务"}</Tag>
                  </div>
                );
              }) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无店铺数据" />
              )}
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={14}>
          <Card size="small" title="店铺任务对比">
            {stats.taskTotal > 0 ? (
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={storeTaskChartData}
                    layout="vertical"
                    margin={{ top: 8, right: 20, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={formatNumber} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="store"
                      width={140}
                      tick={{ fontSize: 12 }}
                      interval={0}
                    />
                    <RechartsTooltip formatter={(value, name) => [formatNumber(value), String(name)]} />
                    <Legend />
                    {TASK_DEFINITIONS.map((definition) => (
                      <Bar
                        key={definition.key}
                        dataKey={definition.key}
                        name={definition.label}
                        stackId="tasks"
                        fill={definition.chartColor}
                        maxBarSize={34}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待处理任务" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" title="任务类型分布">
            {stats.taskTotal > 0 ? (
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={taskDistributionData} margin={{ top: 8, right: 12, left: -8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={formatNumber} allowDecimals={false} />
                    <RechartsTooltip formatter={(value, name) => [formatNumber(value), String(name)]} />
                    <Bar dataKey="count" name="任务数" radius={[4, 4, 0, 0]}>
                      {taskDistributionData.map((item) => (
                        <Cell key={item.key} fill={item.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待处理任务" />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={14}>
          <Card size="small" title="店铺采集数据量">
            {storeDataChartData.length ? (
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={storeDataChartData} margin={{ top: 8, right: 16, left: -8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="store" tick={{ fontSize: 12 }} interval={0} />
                    <YAxis yAxisId="left" tickFormatter={formatNumber} allowDecimals={false} />
                    <YAxis yAxisId="right" orientation="right" tickFormatter={formatNumber} allowDecimals={false} />
                    <RechartsTooltip formatter={(value, name) => [
                      String(name) === "数据包 KB" ? `${formatNumber(value)} KB` : formatNumber(value),
                      String(name),
                    ]} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="sourceCount" name="接口响应" fill="#13c2c2" radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="right" dataKey="payloadKb" name="数据包 KB" fill="#2f54eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无采集数据" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" title={<Space><TeamOutlined />负责人任务分布</Space>}>
            {ownerChartData.length ? (
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ownerChartData} margin={{ top: 8, right: 12, left: -8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="owner" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={formatNumber} allowDecimals={false} />
                    <RechartsTooltip formatter={(value, name) => [formatNumber(value), String(name)]} />
                    <Legend />
                    <Bar dataKey="tasks" name="待处理任务" fill="#faad14" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="stores" name="店铺数" fill="#52c41a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无负责人数据" />
            )}
          </Card>
        </Col>
      </Row>

      <div>
        <Space align="center">
          <DatabaseOutlined style={{ color: "#13c2c2", fontSize: 20 }} />
          <Title level={4} style={{ margin: 0 }}>店铺 / SKC 数据看板</Title>
        </Space>
        <div>
          <Text type="secondary">按本机采集缓存解析商品、动销、流量、备货和治理数据，支持从店铺下钻到 SKC。</Text>
        </div>
      </div>

      <Row gutter={[12, 12]}>
        <Col xs={12} md={4}>
          <Card size="small">
            <Text type="secondary">SKC 总数</Text>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNumber(skcStats.total)}</div>
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card size="small">
            <Text type="secondary">覆盖店铺</Text>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNumber(skcStats.stores)}</div>
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card size="small">
            <Text type="secondary">任务 SKC</Text>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNumber(skcStats.taskTotal)}</div>
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card size="small">
            <Text type="secondary">补货 SKC</Text>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNumber(skcStats.stockTotal)}</div>
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card size="small">
            <Text type="secondary">违规 / 活动</Text>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {formatNumber(skcStats.violationTotal)} / {formatNumber(skcStats.activityTotal)}
            </div>
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card size="small">
            <Text type="secondary">缺货 / 建议</Text>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {formatNumber(skcStats.lackQuantity)} / {formatNumber(skcStats.adviceQuantity)}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>30日销量 {formatNumber(skcStats.totalSales)}</Text>
          </Card>
        </Col>
      </Row>

      <Tabs
        items={[
          {
            key: "store",
            label: "按店铺",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Row gutter={[12, 12]}>
                  <Col xs={24} lg={12}>
                    <Card size="small" title="店铺 SKC 任务对比">
                      {storeSkcChartData.length ? (
                        <div style={{ height: 300 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={storeSkcChartData} margin={{ top: 8, right: 16, left: -8, bottom: 8 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="store" tick={{ fontSize: 12 }} interval={0} />
                              <YAxis tickFormatter={formatNumber} allowDecimals={false} />
                              <RechartsTooltip formatter={(value, name) => [formatNumber(value), String(name)]} />
                              <Legend />
                              <Bar dataKey="skcCount" name="SKC" fill="#13c2c2" radius={[4, 4, 0, 0]} />
                              <Bar dataKey="taskSkcCount" name="任务 SKC" fill="#faad14" radius={[4, 4, 0, 0]} />
                              <Bar dataKey="stockSkcCount" name="补货 SKC" fill="#1677ff" radius={[4, 4, 0, 0]} />
                              <Bar dataKey="violationSkcCount" name="违规 SKC" fill="#f5222d" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 SKC 数据" />
                      )}
                    </Card>
                  </Col>
                  <Col xs={24} lg={12}>
                    <Card size="small" title="店铺 SKC 汇总" bodyStyle={{ padding: 0 }}>
                      <Spin spinning={skcLoading}>
                        <Table
                          rowKey={(row) => skcStoreGroupKey(row)}
                          size="small"
                          columns={storeSkcSummaryColumns}
                          dataSource={storeSkcSummaries}
                          pagination={{ pageSize: 8, showSizeChanger: true }}
                          scroll={{ x: 1040 }}
                          locale={{ emptyText: "暂无店铺 SKC 数据" }}
                        />
                      </Spin>
                    </Card>
                  </Col>
                </Row>
              </Space>
            ),
          },
          {
            key: "skc",
            label: "按 SKC",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Row gutter={[12, 12]}>
                  <Col xs={24} lg={10}>
                    <Card size="small" title="SKC 任务类型分布">
                      {skcTaskDistributionData.length ? (
                        <div style={{ height: 260 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={skcTaskDistributionData} margin={{ top: 8, right: 12, left: -8, bottom: 8 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="flag" tick={{ fontSize: 12 }} />
                              <YAxis tickFormatter={formatNumber} allowDecimals={false} />
                              <RechartsTooltip formatter={(value, name) => [formatNumber(value), String(name)]} />
                              <Bar dataKey="count" name="SKC 数" radius={[4, 4, 0, 0]}>
                                {skcTaskDistributionData.map((item) => (
                                  <Cell key={item.flag} fill={item.fill} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 SKC 任务" />
                      )}
                    </Card>
                  </Col>
                  <Col xs={24} lg={14}>
                    <Card size="small" title="重点 SKC">
                      {topTaskSkcRows.length ? (
                        <div style={{ height: 260 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={topTaskSkcRows.map((row) => ({
                                name: row.title ? row.title.slice(0, 12) : row.skcId || row.goodsId || "SKC",
                                lackQuantity: row.lackQuantity,
                                adviceQuantity: row.adviceQuantity,
                                sales: row.last30DaysSales || row.totalSales,
                              }))}
                              layout="vertical"
                              margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                              <XAxis type="number" tickFormatter={formatNumber} allowDecimals={false} />
                              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} interval={0} />
                              <RechartsTooltip formatter={(value, name) => [formatNumber(value), String(name)]} />
                              <Legend />
                              <Bar dataKey="lackQuantity" name="缺货" fill="#f5222d" maxBarSize={28} />
                              <Bar dataKey="adviceQuantity" name="建议补货" fill="#1677ff" maxBarSize={28} />
                              <Bar dataKey="sales" name="30日销量" fill="#52c41a" maxBarSize={28} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无重点 SKC" />
                      )}
                    </Card>
                  </Col>
                </Row>
                <Card size="small" title="SKC 明细" bodyStyle={{ padding: 0 }}>
                  <Spin spinning={skcLoading}>
                    <Table
                      rowKey="id"
                      size="small"
                      columns={skcColumns}
                      dataSource={skcRows}
                      pagination={{ pageSize: 20, showSizeChanger: true }}
                      scroll={{ x: 1580 }}
                      locale={{ emptyText: "暂无 SKC 数据" }}
                    />
                  </Spin>
                </Card>
              </Space>
            ),
          },
          {
            key: "products",
            label: "商品资料",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Row gutter={[12, 12]}>
                  <Col xs={12} md={4}>
                    <Card size="small">
                      <Text type="secondary">商品档案</Text>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNumber(productStats.total)}</div>
                    </Card>
                  </Col>
                  <Col xs={12} md={4}>
                    <Card size="small">
                      <Text type="secondary">SKU 覆盖</Text>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNumber(productStats.skuTotal)}</div>
                    </Card>
                  </Col>
                  <Col xs={12} md={4}>
                    <Card size="small">
                      <Text type="secondary">待处理</Text>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNumber(productStats.taskTotal)}</div>
                    </Card>
                  </Col>
                  <Col xs={12} md={4}>
                    <Card size="small">
                      <Text type="secondary">补货</Text>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNumber(productStats.stockTotal)}</div>
                    </Card>
                  </Col>
                  <Col xs={12} md={4}>
                    <Card size="small">
                      <Text type="secondary">违规 / 活动</Text>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>
                        {formatNumber(productStats.violationTotal)} / {formatNumber(productStats.activityTotal)}
                      </div>
                    </Card>
                  </Col>
                  <Col xs={12} md={4}>
                    <Card size="small">
                      <Text type="secondary">低销量</Text>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNumber(productStats.lowSalesTotal)}</div>
                    </Card>
                  </Col>
                </Row>
                <Card size="small">
                  <Space wrap style={{ width: "100%" }}>
                    <Input.Search
                      allowClear
                      placeholder="搜索标题、SKC、SKU、Goods"
                      value={productKeyword}
                      onChange={(event) => setProductKeyword(event.target.value)}
                      style={{ width: 260 }}
                    />
                    <Select
                      allowClear
                      placeholder="店铺"
                      value={productStoreFilter}
                      options={productStoreOptions}
                      onChange={setProductStoreFilter}
                      style={{ width: 220 }}
                    />
                    <Select
                      allowClear
                      placeholder="负责人"
                      value={productOwnerFilter}
                      options={productOwnerOptions}
                      onChange={setProductOwnerFilter}
                      style={{ width: 180 }}
                    />
                    <Select
                      value={productTaskFilter}
                      options={[
                        { label: "全部商品", value: "all" },
                        { label: "待处理", value: "todo" },
                        { label: "补货", value: "stock" },
                        { label: "违规", value: "violation" },
                        { label: "活动", value: "activity" },
                        { label: "低销量", value: "lowSales" },
                      ]}
                      onChange={setProductTaskFilter}
                      style={{ width: 150 }}
                    />
                    <Button onClick={() => {
                      setProductKeyword("");
                      setProductStoreFilter(undefined);
                      setProductOwnerFilter(undefined);
                      setProductTaskFilter("all");
                    }}>
                      重置
                    </Button>
                  </Space>
                </Card>
                <Card size="small" title="商品资料明细" bodyStyle={{ padding: 0 }}>
                  <Spin spinning={skcLoading}>
                    <Table
                      rowKey="id"
                      size="small"
                      columns={skcColumns}
                      dataSource={productRows}
                      pagination={{ pageSize: 20, showSizeChanger: true }}
                      scroll={{ x: 1640 }}
                      locale={{ emptyText: "暂无商品资料" }}
                    />
                  </Spin>
                </Card>
              </Space>
            ),
          },
          {
            key: "task",
            label: "任务 SKC",
            children: (
              <Card size="small" title="需要运营处理的 SKC" bodyStyle={{ padding: 0 }}>
                <Spin spinning={skcLoading}>
                  <Table
                    rowKey="id"
                    size="small"
                    columns={skcColumns}
                    dataSource={taskSkcRows}
                    pagination={{ pageSize: 20, showSizeChanger: true }}
                    scroll={{ x: 1580 }}
                    locale={{ emptyText: "暂无需要处理的 SKC" }}
                  />
                </Spin>
              </Card>
            ),
          },
        ]}
      />

      <Card size="small" bodyStyle={{ padding: 0 }}>
        <Spin spinning={loading}>
          {snapshots.length === 0 ? (
            <Empty style={{ padding: 48 }} description="还没有云端巡店数据" />
          ) : (
            <Table
              rowKey="id"
              columns={columns}
              dataSource={snapshots}
              pagination={{ pageSize: 20, showSizeChanger: true }}
              scroll={{ x: 1500 }}
            />
          )}
        </Spin>
      </Card>

      <Drawer
        title={displayStoreName(selected)}
        open={Boolean(selected)}
        width={760}
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <Spin spinning={detailLoading}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="店铺">{displayStoreName(selected)}</Descriptions.Item>
              <Descriptions.Item label="负责人">{selected.ownerName || "-"}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={getPatrolStatus(selected).color}>{getPatrolStatus(selected).text}</Tag></Descriptions.Item>
              <Descriptions.Item label="任务状态"><Tag color={getTaskStatus(selected).color}>{getTaskStatus(selected).text}</Tag></Descriptions.Item>
              {TASK_DEFINITIONS.map((definition) => (
                <Descriptions.Item key={definition.key} label={definition.label}>
                  {Number(taskBucket(selected, definition.key)?.count || 0)}
                </Descriptions.Item>
              ))}
              <Descriptions.Item label="采集时间">{formatDate(selected.collectedAt)}</Descriptions.Item>
              <Descriptions.Item label="上传时间">{formatDate(selected.uploadedAt)}</Descriptions.Item>
              <Descriptions.Item label="成功任务">{selected.summary?.successCount || 0}</Descriptions.Item>
              <Descriptions.Item label="失败任务">{selected.summary?.errorCount || 0}</Descriptions.Item>
              <Descriptions.Item label="数据项">{selected.sourceCount || selected.sources?.length || 0}</Descriptions.Item>
              <Descriptions.Item label="数据量">{formatBytes(selected.payloadBytes)}</Descriptions.Item>
            </Descriptions>
            <div style={{ marginTop: 16 }}>
              <Table
                rowKey="id"
                size="small"
                columns={sourceColumns}
                dataSource={selected.sources || []}
                pagination={{ pageSize: 12 }}
                scroll={{ x: 640 }}
              />
            </div>
          </Spin>
        ) : null}
      </Drawer>
    </div>
  );
}
