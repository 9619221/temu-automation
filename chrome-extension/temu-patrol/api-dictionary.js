const TEMU_API_DICTIONARY_VERSION = "2026-05-08";

const TEMU_API_DICTIONARY_ENTRIES = [
  {
    id: "sales_management_list_overall",
    label: "销售管理总览 / SKU 履约列表",
    category: "销量",
    dataKeyPrefix: "temu_ext_sales",
    pathPatterns: ["/mms/venom/api/supplier/sales/management/listOverall"],
    captureMode: "capture-and-replay",
  },
  {
    id: "skc_sales_data",
    label: "SKC 分站点销售数据",
    category: "销量",
    dataKeyPrefix: "temu_ext_sales",
    pathPatterns: ["/bg-brando-mms/supplier/data/center/skc/sales/data"],
    captureMode: "capture-and-replay",
  },
  {
    id: "activity_feedback_query_valid_offline",
    label: "商品可报名活动查询",
    category: "活动",
    dataKeyPrefix: "temu_ext_activity",
    pathPatterns: ["/api/kiana/gamblers/marketing/enroll/feedback/queryValidActivity4FeedBackOffline"],
    captureMode: "capture-and-replay",
  },
  {
    id: "ads_detail",
    label: "广告活动明细",
    category: "活动",
    dataKeyPrefix: "temu_ext_activity",
    pathPatterns: ["/api/v1/coconut/ad/ads_detail"],
    captureMode: "capture-and-replay",
  },
  {
    id: "deliver_goods_page_query_sub_purchase_order",
    label: "备货/发货子采购单查询",
    category: "快递取消",
    dataKeyPrefix: "temu_ext_delivery",
    pathPatterns: ["/bgSongbird-api/supplier/deliverGoods/platform/pageQuerySubPurchaseOrder"],
    captureMode: "capture-and-replay",
  },
  {
    id: "deliver_goods_create_order_group_simple_by_address",
    label: "创建发货单动作接口",
    category: "快递取消",
    dataKeyPrefix: "temu_ext_delivery",
    pathPatterns: ["/bgSongbird-api/supplier/deliverGoods/platform/createDeliveryOrderGroupSimpleByAddress"],
    captureMode: "observe-only",
  },
  {
    id: "fund_detail_page_search",
    label: "资金明细查询",
    category: "资金",
    dataKeyPrefix: "temu_ext_fund",
    pathPatterns: ["/api/merchant/fund/detail/pageSearch"],
    captureMode: "capture-only",
  },
  {
    id: "category_children_list",
    label: "类目子节点列表",
    category: "类目",
    dataKeyPrefix: "temu_ext_category",
    pathPatterns: ["/anniston-agent-seller/category/children/list"],
    captureMode: "capture-only",
  },
  {
    id: "category_template_query",
    label: "类目模板属性查询",
    category: "类目",
    dataKeyPrefix: "temu_ext_category",
    pathPatterns: ["/anniston-agent-seller/category/template/query"],
    captureMode: "capture-only",
  },
  {
    id: "flow_analysis_goods_list",
    label: "商品流量分析列表",
    category: "流量",
    dataKeyPrefix: "temu_ext_flow",
    pathPatterns: ["/api/seller/full/flow/analysis/goods/list"],
    captureMode: "capture-and-replay",
  },
];

function findTemuApiDictionaryEntry(url) {
  const text = String(url || "").toLowerCase();
  if (!text) return null;
  return TEMU_API_DICTIONARY_ENTRIES.find((entry) =>
    (entry.pathPatterns || []).some((pattern) => text.includes(String(pattern || "").toLowerCase())),
  ) || null;
}
