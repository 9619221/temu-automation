import { parseFluxData, parseOrdersData, parseProductsData, parseSalesData } from "./parseRawApis";

export const SKC_SUMMARY_SOURCE_KEY = "temu_skc_summary";

export const SKC_STORE_KEYS = [
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

export interface SkcDashboardRow {
  id: string;
  accountId: string;
  storeName: string;
  ownerName?: string | null;
  skcId: string;
  skuIds: string[];
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

export interface StoreSkcSummary {
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

export interface StoreSkcUploadSummary {
  version: number;
  accountId: string;
  storeName: string;
  ownerName?: string | null;
  generatedAt: string;
  sourceKeys: string[];
  totals: StoreSkcSummary & {
    priceSkcCount: number;
    pendingOrderSkcCount: number;
    warehouseStock: number;
    clickNum: number;
    payGoodsNum: number;
  };
  rows: SkcDashboardRow[];
}

function normalizeTextValue(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeStoreNameValue(value: unknown) {
  return normalizeTextValue(value)
    .replace(/[>›].*$/, "")
    .replace(/\s*(?:\u5207\u6362\u5e97\u94fa|\u5e97\u94fa\u5207\u6362|\u5207\u6362)\s*$/u, "")
    .replace(/\s*(?:Switch Store|Switch)\s*$/i, "")
    .trim();
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

const NON_SKC_STORE_NAME_PATTERNS = [
  /^(?:\u5fd8\u8bb0\u5bc6\u7801|\u627e\u56de\u5bc6\u7801|\u767b\u5f55|\u767b\u9304|\u6ce8\u518c|\u9a8c\u8bc1\u7801|Forgot Password|Reset Password|Login|Log In|Sign In|Register|Verification Code)$/i,
  /^(?:\u521b\u5efa\u65b0\u5e97\u94fa.*|\u5408\u89c4\u767b\u8bb0(?:\u53ca)?\u9a8c\u8bc1.*|0\u5143\u5f00\u5e97|\u514d\u8d39\u5f00\u5e97|\u6211\u8981\u5f00\u5e97|\u7acb\u5373\u5f00\u5e97|\u53bb\u5f00\u5e97)$/u,
  /^(?:\u9690\u79c1\u653f\u7b56|\u9690\u79c1\u6761\u6b3e|\u7528\u6237\u534f\u8bae|\u670d\u52a1\u6761\u6b3e|\u6cd5\u5f8b\u58f0\u660e|\u5173\u4e8e\u6211\u4eec|\u8054\u7cfb\u6211\u4eec)$/u,
  /^(0元开店|免费开店|我要开店|立即开店|去开店|未识别店铺|采集快照)$/i,
  /(开店|入驻|注册|登录|退出|刷新|通知|日志|设置|账号|业务|数据|管理|全部|搜索|验证码)/i,
  /(店铺控制台|采集|巡店|帮助|教程|下载|升级|活动报名)/i,
  /(隐私政策|隐私条款|用户协议|服务条款|法律声明|Privacy Policy|Cookie Policy|Terms of Use|Terms & Conditions|Legal Notice|About Us|Contact Us)/i,
];

export function isLikelySkcStoreName(value: unknown) {
  const text = normalizeStoreNameValue(value);
  if (text.length < 3 || text.length > 80) return false;
  if (/^temu_ext_[a-f0-9]+$/i.test(text)) return false;
  if (/^acct[_:-]/i.test(text)) return false;
  if (/^\+?\d[\d\s*()-]{3,}$/.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  if (!/[A-Za-z\u4e00-\u9fff]/.test(text)) return false;
  if (NON_SKC_STORE_NAME_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return true;
}

function reliableSkcStoreName(value: unknown) {
  const text = normalizeStoreNameValue(value);
  return isLikelySkcStoreName(text) ? text : "";
}

function readPathValue(record: any, path: string) {
  return path.split(".").reduce((current, key) => (
    current && typeof current === "object" ? current[key] : undefined
  ), record);
}

function sumSkuMetric(record: any, paths: string[]) {
  const lists = [
    record?.skuQuantityDetailList,
    record?.skuQuantityList,
    record?.skuList,
    record?.skus,
  ].filter(Array.isArray);
  let sum = 0;
  for (const list of lists) {
    for (const item of list) {
      for (const path of paths) {
        sum += toNumberValue(readPathValue(item, path));
      }
    }
  }
  return sum;
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

function emptySkcRow(accountId: string, storeName: string, ownerName: string | null | undefined, key: string): SkcDashboardRow {
  return {
    id: `${accountId}:${key}`,
    accountId,
    storeName: reliableSkcStoreName(storeName),
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

function mergeSkcRow(row: SkcDashboardRow, record: any, sourceKey: string) {
  const ids = readRecordId(record);
  const recordStoreName = reliableSkcStoreName(firstText(record?.supplierName, record?.mallName, record?.storeName, record?.shopName, record?.merchantName, record?.sellerName));
  if (recordStoreName) row.storeName = recordStoreName;
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
  const skuTodaySales = sumSkuMetric(record, ["todaySaleVolume", "predictTodaySaleVolume"]);
  const sku7DaySales = sumSkuMetric(record, ["lastSevenDaysSaleVolume", "sevenDaysSaleReference", "predictLastSevenDaysSaleVolume"]);
  const sku30DaySales = sumSkuMetric(record, ["lastThirtyDaysSaleVolume", "monthSales"]);
  const skuTotalSales = sumSkuMetric(record, ["totalSaleVolume", "saleVolume", "salesVolume"]);
  const skuWarehouseStock = sumSkuMetric(record, ["inventoryNumInfo.warehouseInventoryNum", "warehouseStock", "stock", "inventory", "sellerWhStock"]);
  const skuAdviceQuantity = sumSkuMetric(record, ["adviceQuantity", "predictSaleAdviceQuantity", "suggestPurchaseNumUp", "adviceProduceNum"]);
  const skuLackQuantity = sumSkuMetric(record, ["lackQuantity", "shortageQuantity", "lackNum"]);
  row.todaySales += firstNumber(record.todaySales, record.todaySaleVolume, record.todayPayGoodsNum, record.skuQuantityTotalInfo?.todaySaleVolume, skuTodaySales);
  row.last7DaysSales += firstNumber(record.last7DaysSales, record.sevenDaysSaleReference, record.recent7SaleVolume, record.lastSevenDaysSaleVolume, record.skuQuantityTotalInfo?.lastSevenDaysSaleVolume, record.skuQuantityTotalInfo?.sevenDaysSaleReference, sku7DaySales);
  row.last30DaysSales += firstNumber(record.last30DaysSales, record.monthSales, record.recent30SaleVolume, record.lastThirtyDaysSaleVolume, record.skuQuantityTotalInfo?.lastThirtyDaysSaleVolume, sku30DaySales);
  row.totalSales += firstNumber(record.totalSales, record.saleVolume, record.salesVolume, record.totalSaleVolume, record.skuQuantityTotalInfo?.totalSaleVolume, skuTotalSales);
  row.exposeNum += firstNumber(record.exposeNum, record.exposureNum, record.impressionNum);
  row.clickNum += firstNumber(record.clickNum, record.clickUserNum);
  row.payGoodsNum += firstNumber(record.payGoodsNum, record.payNum, record.buyerNum);
  row.warehouseStock += firstNumber(record.warehouseStock, record.stock, record.inventory, record.availableStock, record.inventoryNumInfo?.warehouseInventoryNum, record.skuQuantityTotalInfo?.inventoryNumInfo?.warehouseInventoryNum, skuWarehouseStock);
  row.adviceQuantity += firstNumber(record.adviceQuantity, record.suggestStock, record.replenishQuantity, record.predictSaleAdviceQuantity, record.skuQuantityTotalInfo?.adviceQuantity, record.skuQuantityTotalInfo?.predictSaleAdviceQuantity, skuAdviceQuantity);
  row.lackQuantity += firstNumber(record.lackQuantity, record.shortageQuantity, record.lackNum, record.skuQuantityTotalInfo?.lackQuantity, skuLackQuantity);
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

export function buildSkcRowsForStore(accountId: string, storeName: string, ownerName: string | null | undefined, values: Record<string, any>) {
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

export function buildStoreSkcSummaries(rows: SkcDashboardRow[]): StoreSkcSummary[] {
  const groups = new Map<string, StoreSkcSummary>();
  for (const row of rows) {
    const current = groups.get(row.accountId) || {
      accountId: row.accountId,
      storeName: row.storeName,
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
    groups.set(row.accountId, current);
  }
  return Array.from(groups.values()).sort((left, right) => (
    right.taskSkcCount - left.taskSkcCount || right.skcCount - left.skcCount
  ));
}

function sanitizeRow(row: SkcDashboardRow): SkcDashboardRow {
  return {
    ...row,
    title: row.title.slice(0, 240),
    imageUrl: row.imageUrl.slice(0, 1000),
    category: row.category.slice(0, 240),
    status: row.status.slice(0, 120),
    siteLabel: row.siteLabel.slice(0, 80),
    price: row.price.slice(0, 80),
    taskFlags: row.taskFlags.slice(0, 8),
  };
}

export function buildSkcUploadSummary(options: {
  accountId: string;
  storeName: string;
  ownerName?: string | null;
  generatedAt: string;
  values: Record<string, any>;
}): StoreSkcUploadSummary {
  const rows = buildSkcRowsForStore(options.accountId, options.storeName, options.ownerName, options.values)
    .slice(0, 1000)
    .map(sanitizeRow);
  const summaryStoreName = rows.find((row) => isLikelySkcStoreName(row.storeName))?.storeName
    || reliableSkcStoreName(options.storeName)
    || "";
  const storeSummary = buildStoreSkcSummaries(rows)[0] || {
    accountId: options.accountId,
    storeName: summaryStoreName,
    ownerName: options.ownerName || null,
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
  return {
    version: 1,
    accountId: options.accountId,
    storeName: summaryStoreName,
    ownerName: options.ownerName || null,
    generatedAt: options.generatedAt,
    sourceKeys: SKC_STORE_KEYS.filter((key) => options.values[key] !== null && options.values[key] !== undefined),
    totals: {
      ...storeSummary,
      priceSkcCount: rows.filter((row) => row.taskFlags.includes("价格")).length,
      pendingOrderSkcCount: rows.filter((row) => row.taskFlags.includes("备货单")).length,
      warehouseStock: rows.reduce((sum, row) => sum + Number(row.warehouseStock || 0), 0),
      clickNum: rows.reduce((sum, row) => sum + Number(row.clickNum || 0), 0),
      payGoodsNum: rows.reduce((sum, row) => sum + Number(row.payGoodsNum || 0), 0),
    },
    rows: rows.map((row) => ({
      ...row,
      skuIds: Array.isArray(row.skuIds) ? row.skuIds.slice(0, 40) : [],
      storeName: reliableSkcStoreName(row.storeName) || summaryStoreName,
    })),
  };
}

export function normalizeSkcRowsFromSummary(summary: any, fallback: {
  accountId: string;
  storeName: string;
  ownerName?: string | null;
}): SkcDashboardRow[] {
  const rows = Array.isArray(summary?.rows) ? summary.rows : [];
  const fallbackStoreName = reliableSkcStoreName(fallback.storeName);
  return rows.map((row: any, index: number) => {
    const skcId = normalizeTextValue(row?.skcId);
    const goodsId = normalizeTextValue(row?.goodsId);
    const spuId = normalizeTextValue(row?.spuId);
    const key = skcId || goodsId || spuId || normalizeTextValue(row?.title) || String(index);
    const rowStoreName = reliableSkcStoreName(row?.storeName);
    return {
      id: normalizeTextValue(row?.id) || `${fallback.accountId}:${key}`,
      accountId: normalizeTextValue(row?.accountId) || fallback.accountId,
      storeName: rowStoreName || fallbackStoreName,
      ownerName: normalizeTextValue(row?.ownerName) || fallback.ownerName || null,
      skcId,
      skuIds: Array.isArray(row?.skuIds) ? row.skuIds.map(normalizeTextValue).filter(Boolean).slice(0, 40) : [],
      goodsId,
      spuId,
      title: normalizeTextValue(row?.title),
      imageUrl: normalizeImageUrl(row?.imageUrl),
      category: normalizeTextValue(row?.category),
      status: normalizeTextValue(row?.status),
      siteLabel: normalizeTextValue(row?.siteLabel),
      price: normalizeTextValue(row?.price),
      todaySales: toNumberValue(row?.todaySales),
      last7DaysSales: toNumberValue(row?.last7DaysSales),
      last30DaysSales: toNumberValue(row?.last30DaysSales),
      totalSales: toNumberValue(row?.totalSales),
      exposeNum: toNumberValue(row?.exposeNum),
      clickNum: toNumberValue(row?.clickNum),
      payGoodsNum: toNumberValue(row?.payGoodsNum),
      warehouseStock: toNumberValue(row?.warehouseStock),
      adviceQuantity: toNumberValue(row?.adviceQuantity),
      lackQuantity: toNumberValue(row?.lackQuantity),
      pendingOrderCount: toNumberValue(row?.pendingOrderCount),
      taskFlags: Array.isArray(row?.taskFlags)
        ? row.taskFlags.map((flag: unknown) => normalizeTextValue(flag)).filter(Boolean)
        : [],
      sourceCount: toNumberValue(row?.sourceCount),
    };
  }).filter((row: SkcDashboardRow) => row.skcId || row.goodsId || row.title);
}
