/**
 * 从 Worker 返回的原始 API 捕获数据 { apis: [{ path, data }, ...] } 中提取结构化数据
 * 所有采集函数返回 { apis: [...] } 格式，各页面需要从中提取业务数据
 */

// 通用：在 apis 数组中查找匹配 pattern 的 API 结果
function findApi(apis: any[], pattern: string): any {
  return apis.find((a: any) => a.path?.includes(pattern))?.data?.result;
}

function findAllApis(apis: any[], pattern: string): any[] {
  return apis.filter((a: any) => a.path?.includes(pattern)).map((a: any) => a.data?.result).filter(Boolean);
}

// 判断是否为原始 API 格式
function isRawApiFormat(data: any): boolean {
  return data && Array.isArray(data.apis) && data.apis.length > 0;
}

// ============ Dashboard 仪表盘 ============
export function parseDashboardData(raw: any): any {
  if (!isRawApiFormat(raw)) return raw;
  const apis = raw.apis;

  // 统计数据 - 路径: /bg/swift/api/common/statistics/web/queryStatisticDataFullManaged
  const statsRaw = findApi(apis, "queryStatisticDataFullManaged");
  const statistics = statsRaw ? {
    onSaleProducts: statsRaw.onSaleProductNumber ?? 0,
    sevenDaysSales: statsRaw.sevenDaysSaleVolume ?? 0,
    thirtyDaysSales: statsRaw.thirtyDaysSaleVolume ?? 0,
    lackSkcNumber: statsRaw.lackSkcNumber ?? 0,
    alreadySoldOut: statsRaw.alreadySoldOutNumber ?? statsRaw.sellOutNum ?? 0,
    aboutToSellOut: statsRaw.aboutToSellOutNumber ?? statsRaw.aboutToSellOut ?? 0,
    advicePrepareSkcNumber: statsRaw.advicePrepareSkcNumber ?? 0,
    waitProductNumber: statsRaw.waitProductNumber ?? 0,
    highPriceLimit: statsRaw.adjustPrice ?? statsRaw.highPriceLimitNumber ?? 0,
  } : undefined;

  // 排名数据 - 路径: /bg/swift/api/common/statistics/queryIncomeRanking
  const rankRaw = findApi(apis, "queryIncomeRanking");
  const ranking = rankRaw ? {
    date: rankRaw.pt || "",
    overall: rankRaw.ranking ?? undefined,
    pvRank: rankRaw.mallPVRank ?? undefined,
    richnessRank: rankRaw.mallGoodsRichnessRank ?? undefined,
    saleOutRate: rankRaw.mallSaleOutRateRank ?? undefined,
  } : undefined;

  // 收入数据 - 路径: /api/merchant/front/finance/income-summary
  const incomeRaw = findApi(apis, "income-summary");
  const income = Array.isArray(incomeRaw) ? incomeRaw.map((item: any) => ({
    date: item.date,
    amount: item.incomeAmount?.digitalText || item.incomeAmount?.fullText || "0",
  })) : undefined;

  // 商品状态 - 路径: /api/kiana/mms/robin/queryProductStatusCount
  const productStatusRaw = findApi(apis, "queryProductStatusCount");
  const productStatusArr = productStatusRaw?.productSkcStatusAggregation;
  // 转换为 key-value 格式
  const productStatus = Array.isArray(productStatusArr)
    ? productStatusArr.reduce((acc: any, item: any) => {
        const statusMap: Record<number, string> = {
          1: "toSubmit", 3: "rejected", 7: "notListed", 9: "onSale",
          10: "soldOut", 11: "offShelf", 12: "inReview", 13: "toConfirm",
          14: "banned", 15: "other",
        };
        const key = statusMap[item.selectStatus] || `status_${item.selectStatus}`;
        acc[key] = item.count;
        return acc;
      }, {})
    : undefined;

  // 销售分析 - 路径: /api/sale/analysis/total
  const saleAnalysis = findApi(apis, "analysis/total");

  return { ...raw, statistics, ranking, income, productStatus, saleAnalysis, syncedAt: raw.syncedAt };
}

// ============ Products 商品列表 ============
export function parseProductsData(raw: any): any[] {
  if (Array.isArray(raw)) return raw; // 已经是数组
  if (!isRawApiFormat(raw)) return [];
  const apis = raw.apis;

  // 从 product/skc/pageQuery 提取商品列表
  const allProducts: any[] = [];
  const productResults = findAllApis(apis, "product/skc/pageQuery");
  for (const result of productResults) {
    const items = result?.pageItems || [];
    items.forEach((p: any) => {
      // categories 是对象 {cat1:{catId,catName}, cat2:...}，需要提取文本
      const catObj = p.categories;
      let categoryStr = "";
      if (typeof catObj === "string") {
        categoryStr = catObj;
      } else if (catObj && typeof catObj === "object") {
        categoryStr = Object.keys(catObj)
          .filter(k => k.startsWith("cat"))
          .sort()
          .map(k => catObj[k]?.catName || "")
          .filter(Boolean)
          .join(" > ");
      }
      const leafCatName = typeof p.leafCat === "string" ? p.leafCat :
        (p.leafCat?.catName || "");

      // 提取 SKU 货号列表
      const skuSummaries = p.productSkuSummaries;
      let skuExtCodes = "";
      if (Array.isArray(skuSummaries)) {
        skuExtCodes = skuSummaries
          .map((s: any) => s.extCode || s.skuExtCode || "")
          .filter(Boolean)
          .join(", ");
      }

      allProducts.push({
        title: p.productName || "",
        category: leafCatName || categoryStr,
        categories: categoryStr,
        spuId: String(p.productId || ""),
        skcId: String(p.productSkcId || ""),
        goodsId: String(p.goodsId || ""),
        sku: p.extCode || skuExtCodes || "",
        imageUrl: p.thumbUrl || p.mainImageUrl || "",
        price: "",
        status: p.removeStatus === 0 ? "在售" : p.removeStatus === 1 ? "已下架" : String(p.removeStatus ?? ""),
        totalSales: p.productTotalSalesVolume || 0,
        last7DaysSales: p.last7DaysSalesVolume || 0,
        skcStatus: p.skcStatus,
        skcSiteStatus: p.skcSiteStatus,
        createdAt: p.createdAt,
        syncedAt: raw.syncedAt || "",
      });
    });
  }
  return allProducts;
}

// ============ Orders 备货单 ============
export function parseOrdersData(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (!isRawApiFormat(raw)) return [];
  const apis = raw.apis;

  // 从备货单相关 API 提取 - 路径: mms/venom/api/supplier/purchase/manager/querySubOrderList
  const allOrders: any[] = [];
  const orderResults = findAllApis(apis, "querySubOrderList");
  for (const result of orderResults) {
    const items = result?.subOrderForSupplierList || result?.pageItems || result?.list || [];
    if (Array.isArray(items)) {
      items.forEach((item: any, idx: number) => {
        const firstSku = item.skuQuantityDetailList?.[0] ||
          item.skuQuantityDetailForSupplierList?.[0];
        allOrders.push({
          key: allOrders.length + 1,
          type: typeof item.categoryType === "number"
            ? (item.categoryType === 1 ? "紧急备货建议" : item.categoryType === 2 ? "普通备货建议" : String(item.categoryType))
            : (item.categoryType || ""),
          purchaseOrderNo: item.subPurchaseOrderSn || item.originalPurchaseOrderSn || "",
          parentOrderNo: item.originalPurchaseOrderSn || "",
          title: item.productName || "",
          skcId: String(item.productSkcId || ""),
          skuId: String(firstSku?.productSkuId || ""),
          skuCode: firstSku?.skuExtCode || "",
          quantity: firstSku?.purchaseQuantity ?? item.skuQuantityTotalInfo?.totalPurchaseQuantity ?? 0,
          status: typeof item.status === "number"
            ? ({ 1: "待发货", 2: "已发货", 3: "已完成", 4: "已取消", 5: "部分发货" } as Record<number, string>)[item.status] || String(item.status)
            : (item.status || ""),
          amount: firstSku?.supplierPrice ? (firstSku.supplierPrice / 100).toFixed(2) : "",
          warehouse: item.warehouseGroupName || "",
          orderTime: item.purchaseTime || "",
          urgencyInfo: item.urgencyType ? String(item.urgencyType) : "",
          attributes: firstSku?.className || "",
        });
      });
    }
  }
  return allOrders;
}

// ============ Sales 销售管理 ============
export function parseSalesData(raw: any): any {
  // 新格式：scrapeSales 直接返回 {summary, items, apis}，items 含 skuList
  if (raw?.items && Array.isArray(raw.items) && raw.items[0]?.skuList) {
    // 扁平化：每个 SKU 一行
    const flatItems = raw.items.flatMap((item: any, idx: number) =>
      (item.skuList || []).map((sku: any, si: number) => ({
        key: idx * 100 + si + 1,
        title: item.productName || "",
        category: item.category || "",
        skcId: item.skcId || "",
        spuId: item.spuId || "",
        imageUrl: item.imageUrl || "",
        skuId: sku.skuId || "",
        skuName: sku.skuName || "",
        skuCode: sku.skuCode || "",
        price: sku.price || 0,
        warehouseStock: sku.warehouseStock || 0,
        occupyStock: sku.occupyStock || 0,
        unavailableStock: sku.unavailableStock || 0,
        warehouseGroup: sku.warehouseGroup || "",
        suggestStock: sku.suggestStock || 0,
        stockStatus: sku.stockStatus || "",
      }))
    );
    return { summary: raw.summary || {}, items: flatItems, syncedAt: raw.syncedAt };
  }
  if (raw?.items && Array.isArray(raw.items)) return raw; // 旧格式已解析
  if (!isRawApiFormat(raw)) return { summary: {}, items: [] };
  const apis = raw.apis;

  // 统计概览 - 路径: mms/venom/api/supplier/sales/management/listOverall
  const overallRaw = findApi(apis, "listOverall");
  const summary = overallRaw ? {
    saleOutSkcNum: overallRaw.saleOutSkcNum ?? 0,
    soonSaleOutSkcNum: overallRaw.soonSaleOutSkcNum ?? 0,
    adviceStockSkcNum: overallRaw.adviceStockSkcNum ?? 0,
    completelySoldOutSkcNum: overallRaw.completelySoldOutSkcNum ?? 0,
    adSkcNum: overallRaw.adSkcNum ?? 0,
    shortageSkcNum: overallRaw.shortageSkcNum ?? 0,
    totalSkcNum: overallRaw.totalSkcNum ?? 0,
  } : {};

  // 销售商品列表（从 listOverall.subOrderList）
  const items: any[] = [];
  const subList = overallRaw?.subOrderList || [];
  if (Array.isArray(subList)) {
    subList.forEach((item: any, idx: number) => {
      const firstSku = item.skuQuantityDetailList?.[0];
      items.push({
        key: idx + 1,
        title: item.productName || "",
        category: typeof item.category === "object" ? (item.category?.catName || "") : String(item.category || ""),
        skcId: String(item.productSkcId || ""),
        imageUrl: item.productSkcPicture || "",
        todaySales: firstSku?.todaySaleVolume ?? 0,
        last7DaysSales: firstSku?.lastSevenDaysSaleVolume ?? 0,
        last30DaysSales: firstSku?.lastThirtyDaysSaleVolume ?? 0,
        totalSales: firstSku?.totalSaleVolume ?? 0,
        warehouseStock: firstSku?.inventoryNumInfo?.warehouseInventoryNum ?? 0,
        adviceQuantity: firstSku?.adviceQuantity ?? 0,
        lackQuantity: firstSku?.lackQuantity ?? 0,
        price: firstSku?.supplierPrice ? (firstSku.supplierPrice / 100).toFixed(2) : "",
        skuCode: firstSku?.skuExtCode || "",
        stockStatus: typeof item.stockStatus === "number" ? String(item.stockStatus) : (item.stockStatus || ""),
        supplyStatus: typeof item.supplyStatus === "number"
          ? ({ 0: "正常供货", 1: "暂时无法供货", 2: "永久停止供货" } as Record<number, string>)[item.supplyStatus] || String(item.supplyStatus)
          : (item.supplyStatus || ""),
        hotTag: typeof item.hotTag === "object" ? (item.hotTag?.tagName || "") : String(item.hotTag || ""),
        isAdProduct: item.isAdProduct ? "广告商品" : "",
        availableSaleDays: firstSku?.availableSaleDays ?? null,
      });
    });
  }

  return { summary, items, syncedAt: raw.syncedAt };
}

// ============ Flux 流量分析 ============
export function parseFluxData(raw: any): any {
  if (raw?.summary !== undefined && raw?.items !== undefined && !raw?.apis) return raw;
  if (!isRawApiFormat(raw)) return { summary: null, items: [] };
  const apis = raw.apis;

  // 店铺流量概览 - 路径: /api/seller/full/flow/analysis/mall/summary
  const mallSummaryRaw = findApi(apis, "mall/summary");
  const mallSummary = mallSummaryRaw ? {
    todayVisitors: mallSummaryRaw.todayTotalVisitorsNum ?? 0,
    todayBuyers: mallSummaryRaw.todayPayBuyerNum ?? 0,
    todayConversionRate: mallSummaryRaw.todayConversionRate ?? 0,
    updateTime: mallSummaryRaw.updateTime || "",
    trendList: Array.isArray(mallSummaryRaw.trendList)
      ? mallSummaryRaw.trendList.map((t: any) => ({
          date: t.statDate || t.date || "",
          visitors: t.visitorsNum ?? t.visitors ?? 0,
          buyers: t.payBuyerNum ?? t.buyers ?? 0,
          conversionRate: t.conversionRate ?? 0,
        }))
      : [],
  } : null;

  // 商品流量数据 - 路径: /api/seller/full/flow/analysis/goods/list (可能为 null)
  const items: any[] = [];
  const fluxResults = findAllApis(apis, "goods/list");
  for (const result of fluxResults) {
    if (!result) continue; // goods/list 可能返回 null
    const list = result?.list || result?.pageItems || [];
    if (Array.isArray(list)) {
      list.forEach((item: any, idx: number) => {
        items.push({
          key: items.length + 1,
          goodsId: String(item.goodsId || ""),
          goodsName: item.goodsName || "",
          imageUrl: item.goodsImageUrl || item.imageUrl || "",
          spuId: String(item.productSpuId || ""),
          category: typeof item.category === "object" ? (item.category?.catName || "") : String(item.category || ""),
          exposeNum: item.exposeNum || 0,
          exposeNumChange: item.exposeNumLinkRelative ?? null,
          clickNum: item.clickNum || 0,
          clickNumChange: item.clickNumLinkRelative ?? null,
          detailVisitNum: item.goodsDetailVisitNum || 0,
          detailVisitorNum: item.goodsDetailVisitorNum || 0,
          addToCartUserNum: item.addToCartUserNum || 0,
          collectUserNum: item.collectUserNum || 0,
          payGoodsNum: item.payGoodsNum || 0,
          payOrderNum: item.payOrderNum || 0,
          buyerNum: item.buyerNum || 0,
          searchExposeNum: item.searchExposeNum || 0,
          searchClickNum: item.searchClickNum || 0,
          recommendExposeNum: item.recommendExposeNum || 0,
          recommendClickNum: item.recommendClickNum || 0,
          clickPayRate: item.clickPayConversionRate || 0,
          exposeClickRate: item.exposeClickConversionRate || 0,
          growDataText: typeof item.growDataText === "string" ? item.growDataText : "",
        });
      });
    }
  }

  return { summary: mallSummary, items, syncedAt: raw.syncedAt };
}

// ============ 统一解析入口 ============
export function parseStoreData(key: string, raw: any): any {
  if (!raw || !isRawApiFormat(raw)) return raw;

  switch (key) {
    case "dashboard": return parseDashboardData(raw);
    case "products": return parseProductsData(raw);
    case "orders": return parseOrdersData(raw);
    case "sales": return parseSalesData(raw);
    case "flux": return parseFluxData(raw);
    default: return raw; // 其他数据保持原始格式
  }
}
