/**
 * 从 Worker 返回的原始 API 捕获数据 { apis: [{ path, data }, ...] } 中提取结构化数据
 * 各页面依赖这些解析函数拿到稳定字段，尽量避免接口轻微漂移后整页空白。
 */

type RawApiEntry = {
  path?: string;
  data?: any;
};

function getRawApis(data: any): RawApiEntry[] {
  if (Array.isArray(data?.apis)) return data.apis;
  if (Array.isArray(data?.data?.apis)) return data.data.apis;
  return [];
}

function unwrapApiPayload(entry: RawApiEntry | any): any {
  return entry?.data?.result ?? entry?.data?.data ?? entry?.data ?? entry?.result ?? entry ?? null;
}

function findApi(apis: RawApiEntry[], pattern: string): any {
  const matched = apis.find((item) => item?.path?.includes(pattern));
  return matched ? unwrapApiPayload(matched) : null;
}

function findAllApis(apis: RawApiEntry[], pattern: string): any[] {
  return apis
    .filter((item) => item?.path?.includes(pattern))
    .map((item) => unwrapApiPayload(item))
    .filter((item) => item !== null && item !== undefined);
}

function isRawApiFormat(data: any): boolean {
  return getRawApis(data).length > 0;
}

function toArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? value : [];
}

function toStringValue(value: any): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function toNumberValue(value: any, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function pickFirst<T>(...values: T[]): T | undefined {
  return values.find((value) => value !== null && value !== undefined && value !== "");
}

const CATEGORY_TEXT_KEYS = ["catName", "categoryName", "name", "label", "title", "text"] as const;

function cleanCategoryText(value: any): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text && text !== "[object Object]" ? text : "";
}

function dedupeTexts(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const text = cleanCategoryText(value);
    if (!text || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

function getCategoryKeyOrder(key: string): number {
  const catLevel = key.match(/^cat(\d+)$/i);
  if (catLevel) return Number(catLevel[1]);
  const nameLevel = key.match(/^(first|second|third|fourth|fifth)Category/i)?.[1]?.toLowerCase();
  if (nameLevel) {
    return ({ first: 1, second: 2, third: 3, fourth: 4, fifth: 5 } as Record<string, number>)[nameLevel] || 500;
  }
  if (/^leafCat$/i.test(key)) return 999;
  return 500;
}

function extractCategoryTexts(value: any, seen = new WeakSet<object>()): string[] {
  if (!value) return [];
  if (typeof value === "string") return dedupeTexts([value]);
  if (Array.isArray(value)) {
    return dedupeTexts(value.flatMap((item) => extractCategoryTexts(item, seen)));
  }
  if (typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);

  const objectValue = value as Record<string, any>;
  const orderedCategoryKeys = Object.keys(objectValue)
    .filter((key) => /^cat\d+$/i.test(key) || /^(first|second|third|fourth|fifth)Category/i.test(key) || /^leafCat$/i.test(key))
    .sort((a, b) => getCategoryKeyOrder(a) - getCategoryKeyOrder(b));
  const orderedCategoryTexts = dedupeTexts(
    orderedCategoryKeys.flatMap((key) => extractCategoryTexts(objectValue[key], seen)),
  );
  if (orderedCategoryTexts.length > 0) return orderedCategoryTexts;

  const nestedPathTexts = dedupeTexts(
    ["categories", "categoryPath", "categoryTree", "categoryNodeVOS", "path", "children", "list"]
      .flatMap((key) => extractCategoryTexts(objectValue[key], seen)),
  );
  const directTexts = dedupeTexts(
    CATEGORY_TEXT_KEYS
      .map((key) => cleanCategoryText(objectValue[key]))
      .filter(Boolean),
  );
  if (nestedPathTexts.length > 0 || directTexts.length > 0) {
    return dedupeTexts([...nestedPathTexts, ...directTexts]);
  }

  return dedupeTexts(
    Object.values(objectValue)
      .filter((nested) => nested && typeof nested === "object")
      .flatMap((nested) => extractCategoryTexts(nested, seen)),
  );
}

function normalizeCategoryPath(value: any): string {
  return extractCategoryTexts(value).join(" > ");
}

function normalizeCategoryLeaf(value: any): string {
  const parts = extractCategoryTexts(value);
  return parts[parts.length - 1] || "";
}

function formatFenPrice(value: any): string {
  if (value === null || value === undefined || value === "") return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return toStringValue(value);
  return (num / 100).toFixed(2);
}

function normalizeSupplyStatus(value: any): string {
  if (typeof value === "number") {
    return (
      {
        0: "正常供货",
        1: "暂时无法供货",
        2: "永久停止供货",
      } as Record<number, string>
    )[value] || String(value);
  }
  return toStringValue(value);
}

function normalizeProductStatus(value: any): string {
  if (typeof value === "number") {
    return value === 0 ? "在售" : value === 1 ? "已下架" : String(value);
  }
  return toStringValue(value);
}

function normalizeProductsFromList(items: any[], syncedAt = ""): any[] {
  return items.map((item: any) => {
    const categories = normalizeCategoryPath(
      pickFirst(
        item.categories,
        item.categoryPath,
        item.categoryTree,
        item.category,
        item.categoryName,
        item.leafCat,
      ),
    );
    const leafCategory = normalizeCategoryLeaf(
      pickFirst(
        item.leafCatName,
        item.leafCat,
        item.categoryName,
        item.category,
        item.categories,
        item.categoryPath,
        item.categoryTree,
      ),
    );
    const skuExtCodes = toArray(item.productSkuSummaries || item.skuList)
      .map((sku: any) => toStringValue(pickFirst(sku.extCode, sku.skuExtCode, sku.skuCode)))
      .filter(Boolean)
      .join(", ");

    return {
      title: toStringValue(pickFirst(item.productName, item.title, item.goodsName)),
      category: leafCategory || categories,
      categories,
      spuId: toStringValue(pickFirst(item.productId, item.spuId, item.productSpuId)),
      skcId: toStringValue(pickFirst(item.productSkcId, item.skcId, item.skcExtId)),
      goodsId: toStringValue(item.goodsId),
      sku: toStringValue(pickFirst(item.extCode, item.skuExtCode, item.skuCode, skuExtCodes)),
      imageUrl: toStringValue(pickFirst(item.thumbUrl, item.mainImageUrl, item.goodsImageUrl, item.imageUrl)),
      price: toStringValue(item.price),
      status: normalizeProductStatus(pickFirst(item.removeStatus, item.status)),
      totalSales: toNumberValue(pickFirst(item.productTotalSalesVolume, item.totalSales)),
      last7DaysSales: toNumberValue(pickFirst(item.last7DaysSalesVolume, item.lastSevenDaysSalesVolume, item.last7DaysSales)),
      skcStatus: item.skcStatus,
      skcSiteStatus: item.skcSiteStatus,
      createdAt: pickFirst(item.createdAt, item.createTime),
      syncedAt,
    };
  });
}

function dedupeByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  items.forEach((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function normalizeSalesFlatItem(item: any, syncedAt = "") {
  const inventoryInfo = item.inventoryNumInfo || item.inventoryInfo || {};
  return {
    key: toStringValue(pickFirst(item.key, item.skuId, item.productSkcId, item.skcId, item.spuId)),
    title: toStringValue(pickFirst(item.productName, item.title, item.goodsName)),
    category: normalizeCategoryPath(pickFirst(item.category, item.categories, item.categoryTree)),
    skcId: toStringValue(pickFirst(item.productSkcId, item.skcId, item.skcExtId)),
    spuId: toStringValue(pickFirst(item.productId, item.spuId, item.productSpuId)),
    imageUrl: toStringValue(pickFirst(item.productSkcPicture, item.imageUrl, item.goodsImageUrl)),
    todaySales: toNumberValue(pickFirst(item.todaySaleVolume, item.todaySales)),
    last7DaysSales: toNumberValue(pickFirst(item.lastSevenDaysSaleVolume, item.last7DaysSales)),
    last30DaysSales: toNumberValue(pickFirst(item.lastThirtyDaysSaleVolume, item.last30DaysSales)),
    totalSales: toNumberValue(pickFirst(item.totalSaleVolume, item.totalSales)),
    warehouseStock: toNumberValue(pickFirst(inventoryInfo.warehouseInventoryNum, item.warehouseStock)),
    adviceQuantity: toNumberValue(pickFirst(item.adviceQuantity, item.suggestStock)),
    lackQuantity: toNumberValue(item.lackQuantity),
    price: pickFirst(
      item.price,
      item.supplierPrice !== undefined ? formatFenPrice(item.supplierPrice) : "",
    ) || "",
    skuCode: toStringValue(pickFirst(item.skuExtCode, item.skuCode, item.extCode)),
    stockStatus: toStringValue(pickFirst(item.stockStatusName, item.stockStatus)),
    supplyStatus: normalizeSupplyStatus(pickFirst(item.supplyStatusName, item.supplyStatus)),
    hotTag: toStringValue(pickFirst(item.hotTag?.tagName, item.hotTag, item.hotSaleTag)),
    isAdProduct: item.isAdProduct ? "广告商品" : toStringValue(item.isAdProduct),
    availableSaleDays: pickFirst(item.availableSaleDays, inventoryInfo.availableSaleDays, null),
    syncedAt,
  };
}

function normalizeSalesItemsFromSkuList(items: any[], syncedAt = ""): any[] {
  return items.flatMap((item: any, itemIndex: number) =>
    toArray(item.skuList).map((sku: any, skuIndex: number) => ({
      key: `${itemIndex}-${skuIndex}`,
      title: toStringValue(pickFirst(item.productName, item.title)),
      category: normalizeCategoryPath(item.category),
      skcId: toStringValue(pickFirst(item.skcId, item.productSkcId)),
      spuId: toStringValue(pickFirst(item.spuId, item.productId)),
      imageUrl: toStringValue(pickFirst(item.imageUrl, item.productSkcPicture)),
      skuId: toStringValue(sku.skuId),
      skuName: toStringValue(pickFirst(sku.skuName, sku.name)),
      skuCode: toStringValue(pickFirst(sku.skuCode, sku.extCode, sku.skuExtCode)),
      price: toNumberValue(sku.price),
      warehouseStock: toNumberValue(sku.warehouseStock),
      occupyStock: toNumberValue(sku.occupyStock),
      unavailableStock: toNumberValue(sku.unavailableStock),
      warehouseGroup: toStringValue(sku.warehouseGroup),
      suggestStock: toNumberValue(sku.suggestStock),
      stockStatus: toStringValue(sku.stockStatus),
      syncedAt,
    })),
  );
}

function normalizeFluxTrendItem(item: any) {
  return {
    date: toStringValue(pickFirst(item.statDate, item.date)),
    visitors: toNumberValue(pickFirst(item.visitorsNum, item.visitors)),
    buyers: toNumberValue(pickFirst(item.payBuyerNum, item.buyers)),
    conversionRate: toNumberValue(item.conversionRate),
  };
}

function normalizeFluxSummary(summaryRaw: any) {
  if (!summaryRaw) return null;
  return {
    todayVisitors: toNumberValue(pickFirst(summaryRaw.todayTotalVisitorsNum, summaryRaw.todayVisitors)),
    todayBuyers: toNumberValue(pickFirst(summaryRaw.todayPayBuyerNum, summaryRaw.todayBuyers)),
    todayConversionRate: toNumberValue(summaryRaw.todayConversionRate),
    updateTime: toStringValue(summaryRaw.updateTime),
    trendList: toArray(summaryRaw.trendList).map(normalizeFluxTrendItem),
  };
}

function normalizeFluxItems(items: any[]): any[] {
  return items.map((item: any, index: number) => ({
    key: toStringValue(pickFirst(item.key, item.goodsId, `${index}`)),
    goodsId: toStringValue(item.goodsId),
    goodsName: toStringValue(pickFirst(item.goodsName, item.productName, item.title)),
    imageUrl: toStringValue(pickFirst(item.goodsImageUrl, item.imageUrl, item.mainImageUrl)),
    spuId: toStringValue(pickFirst(item.productSpuId, item.spuId, item.productId)),
    category: normalizeCategoryPath(pickFirst(item.category, item.categories)),
    exposeNum: toNumberValue(item.exposeNum),
    exposeNumChange: pickFirst(item.exposeNumLinkRelative, item.exposeNumChange, null),
    clickNum: toNumberValue(item.clickNum),
    clickNumChange: pickFirst(item.clickNumLinkRelative, item.clickNumChange, null),
    detailVisitNum: toNumberValue(pickFirst(item.goodsDetailVisitNum, item.detailVisitNum)),
    detailVisitorNum: toNumberValue(pickFirst(item.goodsDetailVisitorNum, item.detailVisitorNum)),
    addToCartUserNum: toNumberValue(item.addToCartUserNum),
    collectUserNum: toNumberValue(item.collectUserNum),
    payGoodsNum: toNumberValue(item.payGoodsNum),
    payOrderNum: toNumberValue(item.payOrderNum),
    buyerNum: toNumberValue(item.buyerNum),
    searchExposeNum: toNumberValue(item.searchExposeNum),
    searchClickNum: toNumberValue(item.searchClickNum),
    recommendExposeNum: toNumberValue(item.recommendExposeNum),
    recommendClickNum: toNumberValue(item.recommendClickNum),
    clickPayRate: toNumberValue(pickFirst(item.clickPayConversionRate, item.clickPayRate)),
    exposeClickRate: toNumberValue(pickFirst(item.exposeClickConversionRate, item.exposeClickRate)),
    growDataText: toStringValue(item.growDataText),
  }));
}

// ============ Dashboard 仪表盘 ============
export function parseDashboardData(raw: any): any {
  if (!isRawApiFormat(raw)) return raw;
  const apis = getRawApis(raw);

  const statsRaw = findApi(apis, "queryStatisticDataFullManaged");
  const statistics = statsRaw ? {
    onSaleProducts: toNumberValue(statsRaw.onSaleProductNumber),
    sevenDaysSales: toNumberValue(statsRaw.sevenDaysSaleVolume),
    thirtyDaysSales: toNumberValue(statsRaw.thirtyDaysSaleVolume),
    lackSkcNumber: toNumberValue(statsRaw.lackSkcNumber),
    alreadySoldOut: toNumberValue(pickFirst(statsRaw.alreadySoldOutNumber, statsRaw.sellOutNum)),
    aboutToSellOut: toNumberValue(pickFirst(statsRaw.aboutToSellOutNumber, statsRaw.aboutToSellOut)),
    advicePrepareSkcNumber: toNumberValue(statsRaw.advicePrepareSkcNumber),
    waitProductNumber: toNumberValue(statsRaw.waitProductNumber),
    highPriceLimit: toNumberValue(pickFirst(statsRaw.adjustPrice, statsRaw.highPriceLimitNumber)),
  } : undefined;

  const rankRaw = findApi(apis, "queryIncomeRanking");
  const ranking = rankRaw ? {
    date: toStringValue(rankRaw.pt),
    overall: pickFirst(rankRaw.ranking, undefined),
    pvRank: pickFirst(rankRaw.mallPVRank, undefined),
    richnessRank: pickFirst(rankRaw.mallGoodsRichnessRank, undefined),
    saleOutRate: pickFirst(rankRaw.mallSaleOutRateRank, undefined),
  } : undefined;

  const incomeRaw = findApi(apis, "income-summary");
  const income = Array.isArray(incomeRaw) ? incomeRaw.map((item: any) => ({
    date: toStringValue(item.date),
    amount: toStringValue(pickFirst(item.incomeAmount?.digitalText, item.incomeAmount?.fullText, item.amount, "0")),
  })) : undefined;

  const productStatusRaw = findApi(apis, "queryProductStatusCount");
  const productStatusArr = toArray(productStatusRaw?.productSkcStatusAggregation);
  const productStatus = productStatusArr.length > 0
    ? productStatusArr.reduce((acc: any, item: any) => {
        const statusMap: Record<number, string> = {
          1: "toSubmit",
          3: "rejected",
          7: "notListed",
          9: "onSale",
          10: "soldOut",
          11: "offShelf",
          12: "inReview",
          13: "toConfirm",
          14: "banned",
          15: "other",
        };
        const key = statusMap[item.selectStatus] || `status_${item.selectStatus}`;
        acc[key] = toNumberValue(item.count);
        return acc;
      }, {})
    : undefined;

  const saleAnalysis = findApi(apis, "analysis/total");

  return { ...raw, statistics, ranking, income, productStatus, saleAnalysis, syncedAt: raw.syncedAt };
}

// ============ Products 商品列表 ============
export function parseProductsData(raw: any): any[] {
  if (Array.isArray(raw)) {
    return normalizeProductsFromList(raw);
  }
  if (Array.isArray(raw?.items)) {
    return normalizeProductsFromList(raw.items, raw.syncedAt || "");
  }
  if (!isRawApiFormat(raw)) return [];

  const apis = getRawApis(raw);
  const productResults = findAllApis(apis, "product/skc/pageQuery");
  const products = productResults.flatMap((result) =>
    normalizeProductsFromList(
      toArray(result?.pageItems).length > 0 ? result.pageItems : toArray(result?.list),
      raw.syncedAt || "",
    ),
  );

  return dedupeByKey(products, (item) => [item.skcId, item.goodsId, item.spuId, item.title].filter(Boolean).join("|"));
}

// ============ Orders 备货单 ============
export function parseOrdersData(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (!isRawApiFormat(raw)) return [];

  const apis = getRawApis(raw);
  const orderResults = findAllApis(apis, "querySubOrderList");
  const allOrders: any[] = [];

  orderResults.forEach((result) => {
    const items = toArray(
      pickFirst(
        result?.subOrderForSupplierList,
        result?.pageItems,
        result?.list,
      ),
    );

    items.forEach((item: any) => {
      const firstSku = pickFirst(
        toArray(item.skuQuantityDetailList)[0],
        toArray(item.skuQuantityDetailForSupplierList)[0],
        item.skuInfo,
      ) || {};

      allOrders.push({
        key: allOrders.length + 1,
        type: typeof item.categoryType === "number"
          ? (item.categoryType === 1 ? "紧急备货建议" : item.categoryType === 2 ? "普通备货建议" : String(item.categoryType))
          : toStringValue(item.categoryType),
        purchaseOrderNo: toStringValue(pickFirst(item.subPurchaseOrderSn, item.purchaseOrderNo, item.originalPurchaseOrderSn)),
        parentOrderNo: toStringValue(item.originalPurchaseOrderSn),
        title: toStringValue(pickFirst(item.productName, item.title)),
        skcId: toStringValue(pickFirst(item.productSkcId, item.skcId)),
        skuId: toStringValue(pickFirst(firstSku.productSkuId, firstSku.skuId)),
        skuCode: toStringValue(pickFirst(firstSku.skuExtCode, firstSku.skuCode)),
        quantity: toNumberValue(pickFirst(firstSku.purchaseQuantity, item.skuQuantityTotalInfo?.totalPurchaseQuantity)),
        status: typeof item.status === "number"
          ? ({ 1: "待发货", 2: "已发货", 3: "已完成", 4: "已取消", 5: "部分发货" } as Record<number, string>)[item.status] || String(item.status)
          : toStringValue(item.status),
        amount: firstSku.supplierPrice !== undefined ? formatFenPrice(firstSku.supplierPrice) : "",
        warehouse: toStringValue(item.warehouseGroupName),
        orderTime: toStringValue(pickFirst(item.purchaseTime, item.orderTime)),
        urgencyInfo: toStringValue(item.urgencyType),
        attributes: toStringValue(pickFirst(firstSku.className, firstSku.attribute)),
      });
    });
  });

  return allOrders;
}

// ============ Sales 销售管理 ============
export function parseSalesData(raw: any): any {
  if (Array.isArray(raw?.items) && raw.items.some((item: any) => Array.isArray(item?.skuList))) {
    return {
      summary: raw.summary || {},
      items: normalizeSalesItemsFromSkuList(raw.items, raw.syncedAt),
      syncedAt: raw.syncedAt,
    };
  }

  if (Array.isArray(raw?.items)) {
    return {
      summary: raw.summary || {},
      items: raw.items.map((item: any) => normalizeSalesFlatItem(item, raw.syncedAt)),
      syncedAt: raw.syncedAt,
    };
  }

  if (!isRawApiFormat(raw)) return { summary: {}, items: [] };
  const apis = getRawApis(raw);

  const overallRaw = pickFirst(
    findApi(apis, "listOverall"),
    findApi(apis, "sales/management/overall"),
  ) || {};

  const summary = {
    saleOutSkcNum: toNumberValue(overallRaw.saleOutSkcNum),
    soonSaleOutSkcNum: toNumberValue(overallRaw.soonSaleOutSkcNum),
    adviceStockSkcNum: toNumberValue(overallRaw.adviceStockSkcNum),
    completelySoldOutSkcNum: toNumberValue(overallRaw.completelySoldOutSkcNum),
    adSkcNum: toNumberValue(overallRaw.adSkcNum),
    shortageSkcNum: toNumberValue(overallRaw.shortageSkcNum),
    totalSkcNum: toNumberValue(overallRaw.totalSkcNum),
  };

  const itemSources = [
    ...toArray(overallRaw?.subOrderList),
    ...toArray(overallRaw?.pageItems),
    ...toArray(overallRaw?.list),
  ];
  const items = itemSources.map((item: any) => {
    const firstSku = pickFirst(
      toArray(item.skuQuantityDetailList)[0],
      toArray(item.skuQuantityDetailForSupplierList)[0],
      item.skuInfo,
      item,
    ) || {};
    return normalizeSalesFlatItem(
      {
        ...item,
        ...firstSku,
        productSkcPicture: pickFirst(item.productSkcPicture, item.imageUrl),
      },
      raw.syncedAt,
    );
  });

  return { summary, items, syncedAt: raw.syncedAt };
}

// ============ Flux 流量分析 ============
export function parseFluxData(raw: any): any {
  if (raw?.summary !== undefined && raw?.items !== undefined && !raw?.apis) {
    return {
      summary: normalizeFluxSummary(raw.summary),
      items: normalizeFluxItems(toArray(raw.items)),
      syncedAt: raw.syncedAt,
    };
  }

  if (!isRawApiFormat(raw)) return { summary: null, items: [] };
  const apis = getRawApis(raw);

  const mallSummary = normalizeFluxSummary(findApi(apis, "mall/summary"));
  const fluxResults = findAllApis(apis, "goods/list");
  const items = fluxResults.flatMap((result) =>
    normalizeFluxItems(
      toArray(pickFirst(result?.list, result?.pageItems, result?.items)),
    ),
  );

  return { summary: mallSummary, items, syncedAt: raw.syncedAt };
}

// ============ 统一解析入口 ============
export function parseStoreData(key: string, raw: any): any {
  if (!raw || !isRawApiFormat(raw)) return raw;

  switch (key) {
    case "dashboard":
      return parseDashboardData(raw);
    case "products":
      return parseProductsData(raw);
    case "orders":
      return parseOrdersData(raw);
    case "sales":
      return parseSalesData(raw);
    case "flux":
      return parseFluxData(raw);
    default:
      return raw;
  }
}
