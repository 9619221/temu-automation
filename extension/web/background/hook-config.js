// 共享配置：Service Worker 与 page world hook 都读取同一份白名单。
// page world hook 通过 chrome.runtime.sendMessage 拉取这份配置（见 sw.js）。

// 218 个 endpoint 按业务分组。匹配方式：path 子串包含。
// 修改这份白名单不需要重发版扩展，下次注入时就生效。
export const URL_WHITELIST = [
  // === 鉴权 / 菜单 / 用户 ===
  "/api/seller/auth/userInfo",
  "/api/seller/auth/menu",
  "/api/seller/auth/redDot",
  "/bg/quiet/api/mms/userInfo",
  "/bg/quiet/api/mms/account/menu",
  "/api/merchant/agreement/not/sign/query",

  // === Jushuitan ERP (capture real XHR/fetch responses, not visible table DOM) ===
  "erp321.com/",
  "jushuitan.com/",
  "scm121.com/",

  // === Feishu Base：供应商档案一次性接入（浏览器登录态内采集） ===
  "feishu.cn/base/",
  "/space/api/bitable/",
  "/space/api/base/",
  "/space/api/box/",
  "/base/api/",
  "/bitable/",

  // === 商品 / SKC / SKU ===
  "/visage-agent-seller/product/skc/pageQuery",
  "/visage-agent-seller/product/draft/pageQuery",
  "/visage-agent-seller/product/skc/listForCrueltyFree",
  "/visage-agent-seller/product/skc/countStatus",
  "/visage-agent-seller/product/skc/certTypeEnum",
  "/visage-agent-seller/product/skc/bom/batchQuery",
  "/visage-agent-seller/product/statisticsData",
  "/visage-agent-seller/product/notAllEu/pageQuery",
  "/visage-agent-seller/product/origin/todo/pageQuery",
  "/visage-agent-seller/product/prop/adjust/task/pageQuery",
  "/visage-agent-seller/product/prop/adjust/task/count",
  "/visage-agent-seller/product/de/hot/addProduct/result/pageQuery",
  "/visage-agent-seller/product/import/semiManagedCopyProduct/pageQuery",
  "/visage-agent-seller/product/fullyManaged/copyProgress/query",
  "/visage-agent-seller/home/page/product/page/stat",
  "/visage-agent-seller/home/page/query/cert/status/count",
  "/visage-agent-seller/compliance/realPicture/todoList/query",
  "/lich-mms/product/sku/accessories/toFill/stat",
  "/lich-mms/product/sku/accessories/pg/toFill/stat",
  "/lich-mms/product/sku/packing/quality/opt/task/pageQuery",
  "/lich-mms/product/sku/packingOptTask/pageQuery",
  "/lich-mms/product/sku/classification/adjust/stat",
  "/lich-mms/product/vehicle/recommend/count",
  "/lich-mms/product/guideFile/todoTotal",
  "/lich-mms/audit/edit/task/product/pageQuery",
  "/lich-mms/todo/product/stat",
  "/lich-mms/todo/video/realtime/top/query",
  "/lich-mms/todo/video/wait-upload/count",
  "/phoenix-mms/picture/task/pageQuery",
  "/phoenix-mms/picture/task/status/count",
  "/darwin-mms/api/kiana/foredawn/sales/stock/queryMmsProductStockBaseInfo",
  "/darwin-mms/api/kiana/sunspot/mmsGoodsReplacementHttpService/queryMallReplacement",

  // === 订单 / 备货 / 采购 ===
  "/mms/venom/api/supplier/purchase/manager/querySubOrderList",
  "/mms/venom/api/supplier/purchase/manager/querySubOrderExtInfoBySubOrderSnList",
  "/mms/venom/api/supplier/purchase/manager/queryProtocolSigned",
  "/mms/venom/api/supplier/purchase/manager/queryPopUpNotice",
  "/mms/venom/api/supplier/merge/operate/queryMergeOperateConfig",
  "/mms/venom/api/supplier/agreement/queryAgreement",
  "/mms/venom/api/supplier/agreement/querySignedAgreement",
  "/mms/venom/api/management/common/queryEnum",
  "/mms/scp/sale/manage/supplier/api/activity/queryActivityLimitInfo",
  "/mms/scp/sale/strategy/api/supplier/awards/isMatchSpringReturnAwards",
  "/mms/scp/sale/strategy/api/supplier/awards/queryInTransit2VirtualStatus",
  "/mms/turbo/supplier/pick/out/config/judgeIfUserHasReadPromptInfo",
  "/mms/turbo/supplier/pick/out/config/showEditExpectReceiveAreaButton",
  "/bgSongbird-api/supplier/deliverGoods/platform/pageQuerySubPurchaseOrder",
  "/bgSongbird-api/supplier/deliverGoods/management/pageQueryDeliveryBatch",
  "/bgSongbird-api/supplier/deliverGoods/management/pageQueryDeliveryOrders",
  "/bgSongbird-api/supplier/deliverGoods/management/queryReceiveSubWarehouseList",
  "/bgSongbird-api/supplier/deliverGoods/management/queryPlatformExpressStaticInfo",
  "/bgSongbird-api/supplier/deliverGoods/management/pageQueryPlatformExpressRejectInfo",
  "/bgSongbird-api/supplier/deliverGoods/management/deliveryOrderPurchaseCancelPopup",
  "/bgSongbird-api/supplier/deliverGoods/platform/querySupplierAddressInfo",
  "/bgSongbird-api/supplier/deliverGoods/platform/queryRecommendExpressCompanyV3",
  "/bgSongbird-api/supplier/delivery/confirm/pageQueryProblemWaybills",
  "/bgSongbird-api/supplier/delivery/feedback/queryAllFeedbackRecordInfo",
  "/bgSongbird-api/supplier/config/queryDeliveryProcessDisplayConfig",
  "/bgSongbird-api/supplier/address/pageQuerySupplierDriverInfoList",
  "/oms/bg/venom/api/supplier/sales/management/queryRedNotice",
  "/marvel-mms/cn/api/kiana/venom/purchase/order/queryRedNotice",
  "/marvel-mms/cn/api/kiana/songbird/DeliveryOrderHttpService/queryRedNotice",
  "/bg-supplier-delivery-api/supplier/config/respondent/queryDeliveryEntityAcceptConfig",

  // === Phase B 送仓发货逆向：按前缀加宽，覆盖加入发货台/创建发货单/装箱发货等写操作 ===
  // 子串包含匹配；与上方具体 deliverGoods 读接口重叠无害，目的是把写接口请求体也抓到。
  "/bgSongbird-api/supplier/deliverGoods/",
  "/bgSongbird-api/supplier/delivery/",
  "/bgSongbird-api/supplier/address/",
  "/bg-supplier-delivery-api/supplier/",

  // === 销售 / 售罄 / 履约 ===
  "/mms/venom/api/supplier/sales/management/listOverall",
  "/mms/venom/api/supplier/sales/management/listWarehouse",
  "/mms/venom/api/supplier/sales/management/querySkuSalesNumber",
  "/mms/venom/api/supplier/sales/management/queryFulfilmentFormStatistic",
  "/mms/venom/api/supplier/sales/management/exportShow",
  "/mms/venom/api/supplier/sales/management/cmall/queryMall",
  "/mms/venom/api/supplier/sales/management/querySuggestCloseJitSkc",
  "/bg-brando-mms/supplier/data/center/skc/sales/data",
  "/marvel-mms/cn/api/kiana/venom/sales/management/queryMallFollowerNum",
  "/scp/purchase/web/board/sold/out/querySoldOutOverview",
  "/scp/purchase/web/board/sold/out/querySoldOutDetail",
  "/scp/purchase/web/board/sold/out/querySoldOutSoldTrendPack",
  "/scp/purchase/web/board/sold/out/querySoldOutPerform",
  "/scp/purchase/web/board/sold/out/querySoldOut7Loss",

  // === 售后 / 退货 ===
  "/mms/api/appalachian/afs/queryPageV3",
  "/dunland/api/gmp/returnSupplier/package/pageQueryReturnSupplierPackage",
  "/dunland/api/gmp/returnSupplier/package/pageReturnPackageSkuDetailList",
  "/dunland/api/gmp/returnSupplier/package/queryDeliveryDetail",
  "/dunland/api/gmp/returnSupplier/package/countToPickUpSupplierPackage",
  "/dunland/api/gmp/returnSupplier/popup/countRedPointForCollectPackage",
  "/dunland/api/gmp/returnSupplier/popup/countToBeCollectPackage",
  "/dunland/api/gmp/return/Supplier/confirm/countSupplierConfirmOrder",
  "/dunland/api/gmp/returnSupplier/supplierException/querySupplierFeedBack",

  // === 评价 / 口碑 ===
  "/bg-luna-agent-seller/review/pageQuery",

  // === 物流 / 发货考核 ===
  "/mms/api/andes/delivery/assessment/queryDeliveryAssessmentPeriod",
  "/mms/api/andes/delivery/assessment/queryDeliveryAssessmentRecord",
  "/mms/api/andes/delivery/assessment/queryDeliveryAssessmentRecordDetail",
  "/mms/api/andes/delivery/assessment/queryAssessmentRightPunish",
  "/bg/khand/mms/supplierForward/querySupplierForwardSummary",

  // === 流量 / 数据分析 ===
  "/api/seller/full/flow/analysis/goods/list",
  "/api/seller/full/flow/analysis/goods/detail",
  "/api/seller/full/flow/analysis/goods/trend",
  "/api/seller/full/flow/analysis/mall/summary",
  "/bg-anniston-agent-seller/category/index/listV2",
  "/bg-anniston-agent-seller/category/supplier/publish/list",
  "/bg/swift/api/common/statistics/web/queryStatisticDataFullManaged",
  "/bg/swift/api/common/statistics/queryIncomeRanking",

  // === 活动 / 营销 / 优惠券 / 竞价 ===
  "/api/activity/data/query-activity-theme-info",
  "/api/activity/data/market/trend",
  "/api/activity/data/market/monitor",
  "/api/activity/data/goods/detail",
  "/api/kiana/gamblers/marketing/enroll/activity/list",
  "/api/kiana/gamblers/marketing/enroll/list",
  "/api/kiana/gamblers/marketing/enroll/scroll/match",
  "/api/kiana/gamblers/marketing/enroll/submit",
  "/api/kiana/gamblers/marketing/enroll/cancel",
  "/api/kiana/gamblers/marketing/enroll/activity/list/for/home",
  "/api/kiana/gamblers/web/marketing/enroll/activityAmbience",
  "/api/kiana/gamblers/marketing/coupon/page/query",
  "/api/kiana/gamblers/marketing/coupon/queryInvitationGoodsCouponCount",
  "/api/kiana/gamblers/marketing/coupon/invite/query",
  "/api/kiana/gamblers/marketing/coupon/invalid/popup",
  "/api/kiana/gamblers/activity/tool/home/picksGoods",
  "/api/kiana/colossus/bsr/query/homepage",
  "/api/kiana/ace/biddingInvitationSupplierRpcService/pageQueryBiddingInvitationOrderList",
  "/api/kiana/mms/ace/biddingInvitationSupplierRpcService/queryBiddingInvitationOrderList",
  "/api/kiana/mms/ace/biddingInvitationSupplierRpcService/queryBiddingInvitationTopicList",
  "/api/kiana/mms/ace/biddingInvitationSupplierRpcService/queryBiddingTabCount",
  "/api/kiana/mms/ace/biddingInvitationSupplierRpcService/queryChanceBiddingInvitationOrderList",
  "/api/kiana/mms/ace/bidingRpcService/isAutoBiddingOpen",
  "/api/kiana/mms/ace/bidingRpcService/recommendBiddingProducts",
  "/marvel-mms/cn/api/kiana/gambit/marketing/activity/product/count",
  "/marvel-mms/cn/api/kiana/gambit/marketing/coupon/queryInvitationGoodsCouponCount",
  "/gambit/api/entity/transfer/goods/bind/queryTransferStatus",

  // === 价格 / 改价 ===
  "/api/kiana/mms/magneto/price-adjust/page-query",
  "/api/kiana/mms/magneto/batch-price-adjust/latest-task",
  "/api/kiana/mms/gmp/bg/magneto/api/price-adjust/adjust-banner",
  "/api/kiana/mms/gmp/bg/magneto/api/price-adjust/query-delivery-privilege-status-and-remain-quota",
  "/api/kiana/mms/gmp/bg/magneto/api/price/assessment/high/show",
  "/api/kiana/mms/magneto/api/price-review-order/no-bom/review",
  "/api/kiana/mms/magneto/api/price-review-order/no-bom/batch-reject-remark",
  "/api/kiana/mms/magneto/api/price/purchase-adjust/review",
  "/api/kiana/mms/magneto/price/bargain-no-bom",
  "/api/kiana/zoro/PriceComparingOrderSupplierRpcService/searchForSupplier",
  "/marvel-mms/cn/api/kiana/zoro/PriceComparingOrderSupplierRpcService/queryWaitingInvitationItemsCount",
  "/marvel-mms/cn/api/kiana/magneto/price-adjust/status-count-4point",
  "/marvel-mms/us/api/kiana/direnjie/high/price/flow/reduce/queryFullHighPriceFlowReduceOverview",
  "/marvel-mms/us/api/kiana/direnjie/high/price/flow/reduce/queryFullHighPriceFlowReduceList",
  "/api/kiana/direnjie/high/price/flow/reduce/full/queryCompetitor",
  "/marvel-mms/us/api/kiana/direnjie/high/price/flow/reduce/full/querySiteTargetPrice",
  "/marvel-mms/us/api/kiana/gmp/bg/magneto/api/customer/query/limit/batchQueryCustomerQueryLimitV2",
  "/visage-agent-seller/product/sku/site/suggestedPrice/pageQuery",
  "/visage-agent-seller/product/sku/site/suggestedPrice/statQuery",
  "/visage-agent-seller/product/sku/site/suggestedPrice/supplier/status/query",
  "/visage-agent-seller/supplier/suggestedPrice/flush/msgBox/query",

  // === 任务 / 待办 / 课程 ===
  "/api/kiana/mms/robin/queryFullyOtherMessage",
  "/api/kiana/mms/robin/queryFullyGrayMallSiteTeamDongZao",
  "/api/kiana/mms/robin/querySupplierTodoCount",
  "/api/kiana/mms/robin/querySupplierQuickFilterCount",
  "/api/kiana/mms/robin/searchForChainSupplier",
  "/api/kiana/mms/robin/queryProductStatusCount",
  "/api/kiana/mms/robin/common/queryAllSiteBasicInfo",
  "/hawk/mms/course/exam/queryTotalExam",
  "/hawk/mms/course/page-query",
  "/marvel-mms/cn/api/kiana/gmp/bg/spiderman/api/sample/manage/toDoCount",
  "/oms/bg/venom/api/supplier/purchase/manager/querySubOrderList",
  "/marvel-mms/cn/api/kiana/wolverine/OmsQcTransferInSupplierCenterGatewayHttpService/searchQcSubBill",
  "/marvel-mms/cn/api/kiana/wolverine/OmsQcTransferInSupplierCenterGatewayHttpService/searchQcSubBillHistory",
  "/scp/purchase/board/supplier/exception/queryWeekInboundExceptionDetailInfo",

  // === 消息 / 客服 / 工单 ===
  "/bg/cute/api/merchantService/chat/queryMessage",
  "/bg/cute/api/merchantService/chat/sendMessage",
  "/bg/quick/api/merchant/msgBox/totalUnreadMsgNum",
  "/bg/quick/api/merchant/msgBox/unreadMsgDetail",
  "/bg/quick/api/kj/merchant/msgBox/totalUnreadMsgNum",
  "/bg/quick/api/merchant/msgBox/read",
  "/bg/quick/api/merchant/rule/unreadNum",
  "/bg/detroit/api/infoTicket/searchTicket",
  "/agora/conv/needReplyCount",

  // === 财务 ===
  "/api/merchant/front/finance/income-summary",
  "/api/merchant/fund/detail/item/semi/download",

  // === 合规 / 美国巡查 / 体检 ===
  "/bg-brando-agent-seller/retrieval/board/pageQuery",
  "/bg-brando-agent-seller/retrieval/board/countProduct",
  "/bg-brando-agent-seller/retrieval/board/retrieval/reason/list",
  "/bg-brando-agent-seller/retrieval/board/supplierRetrievedEvaluationInfo",
  "/bg-luna-mms/goods/quality/optimize/order/wait/optimize/count",
  "/mms/tmod_punish/agent/merchant_appeal/entrance/list",

  // === 灰度 / 配置 ===
  "/api/kiana/direnjie/common/gray/match",
  "/api/kiana/direnjie/common/gray/matchSubGroup",
  "/lollipop/gray/agent/seller/batchMatchBySupplierIdsWithMulGray",
  "/lollipop/gray/batchMatchBySupplierIdsWithMulGray",
  "/visage-agent-seller/config/common/site/query",
  "/visage-agent-seller/config/common/region/query",
  "/visage-agent-seller/config/common/supplier/query",
  "/anniston-agent-seller/category/children/list",
  "/bg-anniston-agent-seller/category/children/list",
  "/anniston-agent-seller/config/common/size/query",

  // === 翻译（咕噜噜源码出现） ===
  "/bg-anniston-mms/translation/batchQuery",
  "/bg-visage-mms/config/common/site/query",
];

// 反爬 / 埋点 / phantom 路径默认不上报，避免噪音
export const URL_BLACKLIST = [
  "/api/phantom/",
  "/api/server/_stm",
  "/pmm/api/pmm/",
  "/b/th",
  "/bert/api/page/info/",
  "/bg/quiet/api/titan/token/",
  "/token/",
  "/login",
  "/logout",
  "/temu-sca-config/",
  "/bgb-sc-leo/",
  "/bgb-oversea-similar-common-main/",
  "/lgst-faas-util/",
  "/main-entry",
  "/goods-entry",
  "/stock-entry",
  "/newon-entry",
  "/wms-entry",
  "/material-entry",
];

// page world hook 与扩展之间的事件名（CustomEvent 总线）
// Discovery mode only runs on Temu seller pages. It uploads small samples of
// business-looking APIs that are not in URL_WHITELIST, so we can find useful
// endpoints the reference extension never captured.
export const URL_DISCOVERY_ALLOWLIST = [
  "/api/",
  "/mms/",
  "/bg/",
  "/bgSongbird-api/",
  "/bg-supplier-delivery-api/",
  "/marvel-mms/",
  "/visage-agent-seller/",
  "/darwin-mms/",
  "/lich-mms/",
  "/phoenix-mms/",
  "/scp/",
  "/oms/",
  "/dunland/",
  "/gambit/",
  "/hawk/",
  "/anniston-agent-seller/",
  "/bg-anniston-agent-seller/",
  "/bg-brando-",
  "/bg-luna-",
];

export const DISCOVERY_MAX_BODY_CHARS = 60000;

export const EVENT_NAME = "temu-monitor.captured";

// page world hook 自调时用的 bypass key（Symbol）
// hook 看到 init[BYPASS_SYMBOL] === true 就跳过拦截，避免无限递归
export const BYPASS_SYMBOL_KEY = "temu-monitor.fetch.bypass";

// IndexedDB 配置
export const DB_NAME = "temu-monitor";
export const DB_VERSION = 1;
export const STORE_QUEUE = "ingest_queue";
