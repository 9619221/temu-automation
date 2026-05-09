export type TemuApiEvidenceLevel = "confirmed-local-extension" | "inferred-page";

export type TemuApiTaskCategory =
  | "商品资料"
  | "销量"
  | "补货"
  | "活动"
  | "违规"
  | "退货"
  | "快递取消"
  | "流量"
  | "资金"
  | "类目"
  | "接口响应";

export interface TemuApiDictionaryEntry {
  id: string;
  label: string;
  category: TemuApiTaskCategory;
  dataKeyPrefix: string;
  methods: string[];
  domains: string[];
  pathPatterns: string[];
  urlExamples: string[];
  patrolPages: string[];
  requestHints: string[];
  responseFieldHints: string[];
  panelUsage: string[];
  captureMode: "capture-and-replay" | "capture-only" | "observe-only";
  evidence: {
    level: TemuApiEvidenceLevel;
    source: string;
    notes: string[];
  };
}

export const TEMU_API_DICTIONARY_VERSION = "2026-05-08";

export const TEMU_API_DICTIONARY_ENTRIES: TemuApiDictionaryEntry[] = [
  {
    id: "sales_management_list_overall",
    label: "销售管理总览 / SKU 履约列表",
    category: "销量",
    dataKeyPrefix: "temu_ext_sales",
    methods: ["POST"],
    domains: ["agentseller.temu.com"],
    pathPatterns: ["/mms/venom/api/supplier/sales/management/listOverall"],
    urlExamples: ["https://agentseller.temu.com/mms/venom/api/supplier/sales/management/listOverall"],
    patrolPages: ["/stock/fully-mgt/sale-manage/main", "/stock/fully-mgt/sale-manage/board/sku-sale-out"],
    requestHints: [
      "Header: mallid",
      "Header: anti-content",
      "Body: pageNo, pageSize, isLack, orderByParam, orderByDesc, priceAdjustRecentDays, selectStatusList",
    ],
    responseFieldHints: [
      "result.subOrderList / result.pageItems / result.list",
      "saleOutSkcNum, soonSaleOutSkcNum, adviceStockSkcNum, shortageSkcNum",
      "productSkcId, productSkuId, productName, productSkcPicture",
      "lastSevenDaysSaleVolume, lastThirtyDaysSaleVolume, totalSaleVolume",
      "inventoryNumInfo.availableInventoryNum, skuQuantityTotalInfo.adviceQuantity",
    ],
    panelUsage: ["商品资料面板", "SKC 摘要", "销量看板", "补货任务"],
    captureMode: "capture-and-replay",
    evidence: {
      level: "confirmed-local-extension",
      source: "咕噜噜 background.js 字面 URL 与函数 fetchSalesManagementList / fetchProfitEstimationList",
      notes: [
        "本地扩展代码中出现完整 URL。",
        "同一片段里可见 mallid、anti-content、pageNo、pageSize、selectStatusList 等请求字段。",
      ],
    },
  },
  {
    id: "skc_sales_data",
    label: "SKC 分站点销售数据",
    category: "销量",
    dataKeyPrefix: "temu_ext_sales",
    methods: ["POST"],
    domains: ["agentseller.temu.com"],
    pathPatterns: ["/bg-brando-mms/supplier/data/center/skc/sales/data"],
    urlExamples: ["https://agentseller.temu.com/bg-brando-mms/supplier/data/center/skc/sales/data"],
    patrolPages: ["/newon/goods-data", "/main/flux-analysis-full"],
    requestHints: ["Header: mallid", "Header: anti-content", "Body: SKC / 商品 / 日期范围参数"],
    responseFieldHints: ["result.list", "country", "confirmGoodsQuantity", "changeRate"],
    panelUsage: ["SKC 销售趋势", "商品资料面板", "分站点销量"],
    captureMode: "capture-and-replay",
    evidence: {
      level: "confirmed-local-extension",
      source: "咕噜噜 background.js 字面 URL",
      notes: ["本地扩展代码中出现完整 URL，并在附近读取 result 中的国家、订单量、变化率。"],
    },
  },
  {
    id: "activity_feedback_query_valid_offline",
    label: "商品可报名活动查询",
    category: "活动",
    dataKeyPrefix: "temu_ext_activity",
    methods: ["POST"],
    domains: ["agentseller.temu.com"],
    pathPatterns: ["/api/kiana/gamblers/marketing/enroll/feedback/queryValidActivity4FeedBackOffline"],
    urlExamples: [
      "https://agentseller.temu.com/api/kiana/gamblers/marketing/enroll/feedback/queryValidActivity4FeedBackOffline",
    ],
    patrolPages: ["/activity/marketing-activity", "/main/act/data-full"],
    requestHints: ["Header: anti-content", "Body: productId"],
    responseFieldHints: ["可报名活动列表", "活动状态", "活动反馈"],
    panelUsage: ["活动任务", "商品活动状态"],
    captureMode: "capture-and-replay",
    evidence: {
      level: "confirmed-local-extension",
      source: "咕噜噜 background.js 字面 URL",
      notes: ["本地扩展代码中出现完整 URL，附近可见 productId 请求体。"],
    },
  },
  {
    id: "ads_detail",
    label: "广告活动明细",
    category: "活动",
    dataKeyPrefix: "temu_ext_activity",
    methods: ["POST"],
    domains: ["ads.temu.com"],
    pathPatterns: ["/api/v1/coconut/ad/ads_detail"],
    urlExamples: ["https://ads.temu.com/api/v1/coconut/ad/ads_detail"],
    patrolPages: ["/activity/marketing-activity"],
    requestHints: [
      "Body: ad_status, ad_advice_types, page_size, page_number, specific_query_info",
      "Body: start_time, end_time, need_calculate_goods_summary, list_id, ad_phase",
    ],
    responseFieldHints: ["广告列表", "曝光", "点击", "加购", "成交", "ACOS"],
    panelUsage: ["活动任务", "广告商品状态", "商品资料面板"],
    captureMode: "capture-and-replay",
    evidence: {
      level: "confirmed-local-extension",
      source: "咕噜噜 background.js 字面 URL",
      notes: ["本地扩展代码中出现完整 URL，附近可见 ads_detail 请求体字段。"],
    },
  },
  {
    id: "deliver_goods_page_query_sub_purchase_order",
    label: "备货/发货子采购单查询",
    category: "快递取消",
    dataKeyPrefix: "temu_ext_delivery",
    methods: ["POST"],
    domains: ["seller.kuajingmaihuo.com"],
    pathPatterns: ["/bgSongbird-api/supplier/deliverGoods/platform/pageQuerySubPurchaseOrder"],
    urlExamples: [
      "https://seller.kuajingmaihuo.com/bgSongbird-api/supplier/deliverGoods/platform/pageQuerySubPurchaseOrder",
    ],
    patrolPages: ["/stock/fully-mgt/order-manage-urgency"],
    requestHints: ["Header: anti-content", "Body: 发货/采购单筛选条件"],
    responseFieldHints: ["result.subOrderForSupplierList", "pageItems", "skuQuantityDetailList", "status"],
    panelUsage: ["快递取消任务", "补货任务", "备货单"],
    captureMode: "capture-and-replay",
    evidence: {
      level: "confirmed-local-extension",
      source: "咕噜噜 background.js 字面 URL",
      notes: ["本地扩展代码中出现完整 URL，并在附近读取查询结果后构造发货单数据。"],
    },
  },
  {
    id: "deliver_goods_create_order_group_simple_by_address",
    label: "创建发货单动作接口",
    category: "快递取消",
    dataKeyPrefix: "temu_ext_delivery",
    methods: ["POST"],
    domains: ["seller.kuajingmaihuo.com"],
    pathPatterns: ["/bgSongbird-api/supplier/deliverGoods/platform/createDeliveryOrderGroupSimpleByAddress"],
    urlExamples: [
      "https://seller.kuajingmaihuo.com/bgSongbird-api/supplier/deliverGoods/platform/createDeliveryOrderGroupSimpleByAddress",
    ],
    patrolPages: ["/stock/fully-mgt/order-manage-urgency"],
    requestHints: ["Header: anti-content", "Body: 创建发货单参数"],
    responseFieldHints: ["success", "发货单创建结果"],
    panelUsage: ["只做运行时证据记录，不应由巡店自动重放"],
    captureMode: "observe-only",
    evidence: {
      level: "confirmed-local-extension",
      source: "咕噜噜 background.js 字面 URL",
      notes: ["这是有副作用的动作接口，只允许记录证据，不放进自动后台重放。"],
    },
  },
  {
    id: "fund_detail_page_search",
    label: "资金明细查询",
    category: "资金",
    dataKeyPrefix: "temu_ext_fund",
    methods: ["POST"],
    domains: ["seller.kuajingmaihuo.com"],
    pathPatterns: ["/api/merchant/fund/detail/pageSearch"],
    urlExamples: ["https://seller.kuajingmaihuo.com/api/merchant/fund/detail/pageSearch"],
    patrolPages: ["/"],
    requestHints: ["Body: fundChangeTypeList, beginTime, endTime, pageSize, pageNum"],
    responseFieldHints: ["资金流水列表", "金额", "时间", "变动类型"],
    panelUsage: ["经营数据", "后续财务看板"],
    captureMode: "capture-only",
    evidence: {
      level: "confirmed-local-extension",
      source: "咕噜噜 background.js 字面 URL",
      notes: ["本地扩展代码中出现完整 URL。"],
    },
  },
  {
    id: "category_children_list",
    label: "类目子节点列表",
    category: "类目",
    dataKeyPrefix: "temu_ext_category",
    methods: ["POST"],
    domains: ["agentseller.temu.com"],
    pathPatterns: ["/anniston-agent-seller/category/children/list"],
    urlExamples: ["https://agentseller.temu.com/anniston-agent-seller/category/children/list"],
    patrolPages: ["/goods/list"],
    requestHints: ["Header: mallid", "Body: 类目查询参数"],
    responseFieldHints: ["类目树", "catId", "catName", "children"],
    panelUsage: ["商品资料", "类目映射"],
    captureMode: "capture-only",
    evidence: {
      level: "confirmed-local-extension",
      source: "咕噜噜 background.js 字面 URL",
      notes: ["本地扩展代码中出现完整 URL。"],
    },
  },
  {
    id: "category_template_query",
    label: "类目模板属性查询",
    category: "类目",
    dataKeyPrefix: "temu_ext_category",
    methods: ["POST"],
    domains: ["agentseller.temu.com"],
    pathPatterns: ["/anniston-agent-seller/category/template/query"],
    urlExamples: ["https://agentseller.temu.com/anniston-agent-seller/category/template/query"],
    patrolPages: ["/goods/list"],
    requestHints: ["Body: catId, langList"],
    responseFieldHints: ["result.properties", "property name", "lang2Value"],
    panelUsage: ["商品资料", "类目属性"],
    captureMode: "capture-only",
    evidence: {
      level: "confirmed-local-extension",
      source: "咕噜噜 background.js 字面 URL",
      notes: ["本地扩展代码中出现完整 URL，附近可见 catId、langList 请求体。"],
    },
  },
  {
    id: "flow_analysis_goods_list",
    label: "商品流量分析列表",
    category: "流量",
    dataKeyPrefix: "temu_ext_flow",
    methods: ["POST"],
    domains: ["agentseller-eu.temu.com", "agentseller-us.temu.com", "agentseller.temu.com"],
    pathPatterns: ["/api/seller/full/flow/analysis/goods/list"],
    urlExamples: ["https://agentseller-eu.temu.com/api/seller/full/flow/analysis/goods/list"],
    patrolPages: ["/main/flux-analysis-full"],
    requestHints: ["Body: 日期范围", "Body: 商品/SKC 查询条件", "Header: anti-content"],
    responseFieldHints: ["goods/list", "exposeNum", "clickNum", "buyerNum", "payGoodsNum"],
    panelUsage: ["流量看板", "低销量/低转化筛选"],
    captureMode: "capture-and-replay",
    evidence: {
      level: "confirmed-local-extension",
      source: "咕噜噜 background.js 字面 URL",
      notes: ["本地扩展代码中出现 EU 域名完整 URL，代码语义为三地区流量数据。"],
    },
  },
];

export function findTemuApiDictionaryEntry(url: string): TemuApiDictionaryEntry | null {
  const text = String(url || "").toLowerCase();
  if (!text) return null;
  return TEMU_API_DICTIONARY_ENTRIES.find((entry) =>
    entry.pathPatterns.some((pattern) => text.includes(pattern.toLowerCase())),
  ) || null;
}

export function getTemuApiCategory(url: string): TemuApiTaskCategory {
  return findTemuApiDictionaryEntry(url)?.category || "接口响应";
}
