/**
 * 采集任务注册表 — 配置驱动，替代 50+ 重复的 scrapeXxx() 函数
 *
 * 用法：
 *   import { SCRAPE_TASKS, getScrapeFunction } from "./scrape-registry.mjs";
 *   const fn = getScrapeFunction("products");  // 返回 () => scrapePageCaptureAll("/goods/list")
 */

// ============ 任务定义 ============
// type: "page" → scrapePageCaptureAll(path, opts)
// type: "sidebar" → scrapeSidebarCaptureAll(label)
// type: "listener" → scrapePageWithListener(path, matchers)
// type: "govern" → scrapeGovernPage(subPath)
// type: "custom" → 有特殊逻辑，不生成工厂函数

export const SCRAPE_TASKS = {
  // ---- 核心数据 ----
  products:       { type: "page", path: "/goods/list" },
  orders:         { type: "page", path: "/stock/fully-mgt/order-manage" },
  flux:           { type: "page", path: "/main/flux-analysis-full" },
  dashboard:      { type: "page", path: "/", opts: { waitTime: 12000 } },
  aftersales:     { type: "page", path: "/main/aftersales/information" },
  soldout:        { type: "page", path: "/stock/fully-mgt/sale-manage/board/sku-sale-out" },
  goodsData:      { type: "page", path: "/newon/goods-data" },
  activity:       { type: "page", path: "/main/act/data-full" },
  performance:    { type: "page", path: "/stock/fully-mgt/sale-manage/board/count" },
  mainPages:      { type: "page", path: "/" },

  // ---- 商品管理 ----
  lifecycle:      { type: "page", path: "/newon/product-select" },
  checkup:        { type: "page", path: "/goods/checkup-center" },
  usRetrieval:    { type: "page", path: "/goods/retrieval-board" },
  retailPrice:    { type: "page", path: "/goods/recommended-retail-price" },
  sampleManage:   { type: "page", path: "/main/sample-manage" },
  imageTask:      { type: "page", path: "/material/image-task" },
  highPrice:      { type: "page", path: "/main/adjust-price-manage/high-price" },

  // ---- 带 listener 的页面（matchers 与原始函数完全一致）----
  bidding:        { type: "listener", path: "/newon/invite-bids/list", matchers: [
    { key: "isAutoBidding", pattern: "isAutoBiddingOpen" },
    { key: "recommendProducts", pattern: "recommendBiddingProducts" },
    { key: "biddingWindows", pattern: "queryAutoBiddingOrderWindows" },
    { key: "tabCount", pattern: "queryBiddingTabCount" },
    { key: "invitationList", pattern: "queryBiddingInvitationOrderList" },
  ]},
  priceCompete:   { type: "listener", path: "/newon/compete-manager", matchers: [
    { key: "priceCompete", pattern: "PriceComparingOrderSupplierRpcService/searchForSupplier" },
  ]},
  hotPlan:        { type: "listener", path: "/newon/hot-prop-plan-home", matchers: [
    { key: "hotPlanHome", pattern: "bsr/query/homepage" },
  ]},
  checkupCenter:  { type: "listener", path: "/goods/checkup-center", matchers: [
    { key: "checkScore", pattern: "lucina-agent-seller/check/score" },
  ]},
  delivery:       { type: "listener", path: "/wms/deliver-examine-board", matchers: [
    { key: "forwardSummary", pattern: "querySupplierForwardSummary" },
    { key: "period", pattern: "queryDeliveryAssessmentPeriod" },
    { key: "record", pattern: "queryDeliveryAssessmentRecord" },
    { key: "rightPunish", pattern: "queryAssessmentRightPunish" },
    { key: "recordDetail", pattern: "queryDeliveryAssessmentRecordDetail" },
  ]},
  marketAnalysis: { type: "listener", path: "/main/market-analysis", matchers: [
    { key: "categoryList", pattern: "category/index/listV2" },
    { key: "publishCategories", pattern: "category/supplier/publish/list" },
    { key: "siteList", pattern: "common/site/semi/list" },
    { key: "siteConfig", pattern: "common/site/config" },
  ]},
  labelCode:      { type: "listener", path: "/goods/label", matchers: [
    { key: "labelList", pattern: "labelcode/pageQuery" },
    { key: "countdown", pattern: "labelcode/newStyle/countdown" },
    { key: "certConfig", pattern: "label/cert/config/query" },
  ]},
  vacuumPumping:  { type: "listener", path: "/goods/stocking-vacuum", matchers: [
    { key: "vacuumList", pattern: "vacuumPumping/pageQuery" },
  ]},
  urgentOrders:   { type: "listener", path: "/stock/fully-mgt/order-manage-urgency", matchers: [
    { key: "orderList", pattern: "purchase/manager/querySubOrderList" },
    { key: "popUpNotice", pattern: "purchase/manager/queryPopUpNotice" },
    { key: "enumData", pattern: "management/common/queryEnum" },
    { key: "mergeConfig", pattern: "merge/operate/queryMergeOperateConfig" },
    { key: "businessConfig", pattern: "business/config/queryBusinessConfig" },
    { key: "protocolSigned", pattern: "queryProtocolSigned" },
    { key: "suggestCloseJit", pattern: "querySuggestCloseJitSkc" },
  ]},
  goodsDraft:     { type: "listener", path: "/goods/draft", matchers: [
    { key: "draftList", pattern: "product/draft" },
  ], opts: { waitTime: 8000 }},
  bondedGoods:    { type: "listener", path: "/goods/bonded", matchers: [
    { key: "bondedList", pattern: "bonded" },
  ], opts: { waitTime: 8000 }},
  receiveAbnormal:{ type: "listener", path: "/stock/fully-mgt/sale-manage/board/receive-abnormal", matchers: [
    { key: "weekInfo", pattern: "queryPastSeveralWeekInfo" },
    { key: "exceptionDetail", pattern: "queryWeekReceiveExceptionDetailInfo" },
    { key: "totalInfo", pattern: "queryPast12WeekReceiveExceptionTotalInfo" },
  ]},

  // ---- 侧边栏导航 ----
  shippingDesk:   { type: "sidebar", label: "发货台" },
  shippingList:   { type: "sidebar", label: "发货单列表" },
  addressManage:  { type: "sidebar", label: "司机/地址管理" },
  exceptionNotice:{ type: "sidebar", label: "收货/入库异常处..." },
  returnDetail:   { type: "sidebar", label: "退货明细" },
  returnOrders:   { type: "sidebar", label: "退货包裹管理" },
  returnReceipt:  { type: "sidebar", label: "退货单管理" },

  // ---- 直接路径页面 ----
  salesReturn:    { type: "page", path: "/activity/sales-return" },
  priceDeclaration:{ type: "page", path: "/main/adjust-price-manage/order-price" },
  priceReport:    { type: "page", path: "/main/adjust-price-manage/order-price" },
  qualityDashboard:{ type: "page", path: "/main/quality/dashboard" },
  mallFlux:       { type: "page", path: "/main/mall-flux-analysis-full" },
  activityLog:    { type: "page", path: "/activity/marketing-activity/log" },
  chanceGoods:    { type: "page", path: "/activity/marketing-activity/chance-goods" },
  marketingActivity:{ type: "page", path: "/activity/marketing-activity" },
  flowGrow:       { type: "page", path: "/main/flow-grow" },

  // ---- 多区域站点 ----
  activityUS:     { type: "page", path: null, opts: { fullUrl: "https://agentseller-us.temu.com/main/act/data-full" } },
  activityEU:     { type: "page", path: null, opts: { fullUrl: "https://agentseller-eu.temu.com/main/act/data-full" } },
  mallFluxUS:     { type: "page", path: null, opts: { fullUrl: "https://agentseller-us.temu.com/main/mall-flux-analysis-full" } },
  fluxUS:         { type: "page", path: null, opts: { fullUrl: "https://agentseller-us.temu.com/main/flux-analysis-full" } },
  fluxEU:         { type: "page", path: null, opts: { fullUrl: "https://agentseller-eu.temu.com/main/flux-analysis-full" } },
  mallFluxEU:     { type: "page", path: null, opts: { fullUrl: "https://agentseller-eu.temu.com/main/mall-flux-analysis-full" } },
  qualityDashboardEU:{ type: "page", path: null, opts: { fullUrl: "https://agentseller-eu.temu.com/main/quality/dashboard" } },

  // ---- 合规中心子页面 ----
  governProductQualification:   { type: "govern", subPath: "product-qualification" },
  governQualificationAppeal:    { type: "govern", subPath: "qualification-appeal" },
  governEprQualification:       { type: "govern", subPath: "epr-qualification" },
  governProductPhoto:           { type: "govern", subPath: "product-photo" },
  governComplianceInfo:         { type: "govern", subPath: "compliance-info" },
  governResponsiblePerson:      { type: "govern", subPath: "responsible-person" },
  governManufacturer:           { type: "govern", subPath: "manufacturer" },
  governComplaint:              { type: "govern", subPath: "complaint" },
  governViolationAppeal:        { type: "govern", subPath: "violation-appeal" },
  governMerchantAppeal:         { type: "govern", subPath: "merchant-appeal" },
  governTro:                    { type: "govern", subPath: "tro" },
  governEprBilling:             { type: "govern", subPath: "epr-billing" },
  governComplianceReference:    { type: "govern", subPath: "compliance-reference" },
  governCustomsAttribute:       { type: "govern", subPath: "customs-attribute" },
  governCategoryCorrection:     { type: "govern", subPath: "category-correction" },
};

/**
 * 获取采集函数（需要传入实际的 scrape 执行器）
 * @param {string} taskKey - 任务键名
 * @param {Object} executors - { scrapePageCaptureAll, scrapeSidebarCaptureAll, scrapePageWithListener, scrapeGovernPage }
 * @returns {Function|null}
 */
export function getScrapeFunction(taskKey, executors) {
  const task = SCRAPE_TASKS[taskKey];
  if (!task) return null;

  switch (task.type) {
    case "page":
      return () => executors.scrapePageCaptureAll(task.path, task.opts || {});
    case "sidebar":
      return () => executors.scrapeSidebarCaptureAll(task.label);
    case "listener":
      return () => executors.scrapePageWithListener(task.path, task.matchers, task.opts || {});
    case "govern":
      return () => executors.scrapeGovernPage(task.subPath);
    default:
      return null;
  }
}

/**
 * 生成 handleRequest 中的 case 处理器映射
 * @param {Object} executors
 * @returns {Object} { "scrape_products": async () => {...}, ... }
 */
export function buildScrapeHandlers(executors) {
  const handlers = {};
  for (const [key, task] of Object.entries(SCRAPE_TASKS)) {
    // 转换 camelCase → snake_case 作为命令名
    const cmdName = "scrape_" + key.replace(/([A-Z])/g, "_$1").toLowerCase();
    const fn = getScrapeFunction(key, executors);
    if (fn) {
      handlers[cmdName] = async () => {
        await executors.ensureBrowser();
        return { [key]: await fn() };
      };
    }
  }
  return handlers;
}
