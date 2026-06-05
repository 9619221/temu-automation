// 官方 selectStatus(选品 / 上新生命周期状态)码 -> 中文。
// 已由卖家后台「上新生命周期管理」两店的状态聚合(productSkcStatusAggregation)逐码对 Tab 计数确认。
// 注:部分 Tab 由多码合并 —— 未发布={1,14,15},价格申报中={7,9}。
// 数据源:官方 OpenAPI 扩展采集 product_lifecycle(erp_temu_openapi_records),键为 product_skc_id。
// 同时被商品管理页(ProductList)与运营工作台(OperationsWorkbench)的「生命周期」列复用。
export const SELECT_STATUS_LABELS: Record<string, string> = {
  "1": "未发布", "14": "未发布", "15": "未发布",
  "3": "待寄样",
  "7": "价格申报中", "9": "价格申报中",
  "10": "待创建首单",
  "11": "已创建首单",
  "12": "已发布到站点", // 在售
  "13": "已下架/终止",
};

export function selectStatusLabel(code: string | null | undefined): string {
  if (code == null || code === "") return "—";
  return SELECT_STATUS_LABELS[String(code)] || `选品状态-${code}`;
}
