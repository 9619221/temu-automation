// 运营工作台共享类型:原内联在 OperationsWorkbench.tsx,批次5 重构抽出供数据 hook 层 + 各 Tab 组件共用。
// 仅搬运,字段定义与原文件逐字一致,不改语义。

export interface SkuRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  skc_id: string | null; sku_ext_code: string | null; product_id: string | null;
  title: string | null; category: string | null;
  today: number; last7d: number; last30d: number;
  stock: number; occupy: number; advice_qty: number;
  sale_days: number | null; declared_price: number | null; stat_date: string | null;
}
export interface RiskRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  risk_type: string | null; severity: string | null; title: string | null; status: string | null;
  product_id: string | null; skc_id: string | null; quantity: number; stat_date: string | null;
  __rk?: number;
}
export interface ActivityRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  kind: string | null; title: string | null; status: string | null;
  activity_id: string | null; product_id: string | null; activity_type: number | null; sku_id: string | null;
  sku_ext_code: string | null; skc_id: string | null; color_spec: string | null;
  product_name: string | null; thumb: string | null;
  signup_price: number | null; suggested_price: number | null; price_diff: number | null;
  activity_stock: number; cost: number | null; end_at: string | null; stat_date: string | null;
  __rk?: number;
}
export interface ActivityDetail {
  activity_id: string | null; kind: string | null; title: string | null; status: string | null;
  activity_type: number | null; sku_id: string | null;
  signup_price: number | null; suggested_price: number | null; price_diff: number | null;
  activity_stock: number; cost: number | null; end_at: string | null;
}
export interface ActProductRow {
  key: string; mall_id: string; store_code: string | null; mall_name: string | null;
  sku_ext_code: string; product_id: string | null; skc_id: string | null; color_spec: string | null;
  product_name: string | null; thumb: string | null;
  act_count: number; pending_count: number;
  best_margin: number | null; best_profit: number | null;
  enrolled_count: number; kinds: string[]; activities: ActivityDetail[];
}
export interface ShopHealthRow {
  mall_id: string; store_code: string | null; mall_name: string | null; owner: string | null;
  sale_volume: number; sale_7d: number; sale_30d: number;
  on_sale: number; wait_online: number; lack_skc: number; advice_prepare_skc: number;
  about_to_sell_out: number; already_sold_out: number; high_price_limit: number;
  after_sale_ratio_90d: number | null; stat_date: string | null; __rk?: number;
}
export interface StockOrderRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  sku_ext_code: string | null; product_name: string | null; spec_name: string | null;
  source_type: string | null; demand_qty: number; delivered_qty: number; gap: number;
  shipping_qty: number; inbound_qty: number; latest_ship_at: string | null; warehouse: string | null; order_no: string | null;
  __rk?: number;
}
export interface TrendRow { mall_id: string; store_code: string | null; mall_name: string | null; stat_date: string; sales: number; }
export interface AdMallRow {
  mall_id: string; store: string;
  imprCnt: number | null; clkCnt: number | null; ctr: number | null; cartCnt: number | null;
  cvr: number | null; orderPayCnt: number | null; orderPayAmt: number | null;
  spend: number | null; roas: number | null; acos: number | null;
}
export interface StoreMatrixRow {
  store_code: string; mall_id: string; mall_name: string | null; owner: string | null;
  sales: number; sale_7d: number; lack: number; soldout: number;
  high_risk: number; restock: number; stock_gap: number; activity: number;
  lc: Record<string, number>;
  first_ship: number;
  goods_created: number;
}
export interface SkuChild { skc_id: string | null; sku_ext_code: string | null; spec_name?: string | null; declared_price: number | null; today: number; last7d: number; last30d: number; sale_days: number | null; stock: number; occupy: number; unavail_stock?: number; shipping?: number; advice_qty: number; lack_qty?: number; }
export interface FirstShipRow { mall_id: string; store_code: string | null; mall_name: string | null; sub_purchase_order_sn: string; delivery_order_sn: string | null; product_skc_id: string | null; ext_code: string | null; deliver_time: number | null; }
export interface QcRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  qc_bill_id: string; product_sku_id: string | null; product_skc_id: string | null; spu_id: string | null;
  ext_code: string | null; sku_name: string | null; spec: string | null; cat_name: string | null;
  purchase_no: string | null; thumb_url: string | null;
  qc_result: number | null; qc_result_update_time: string | null; finish_time: string | null;
  expect_qty: number | null; defective_qty: number | null; qc_group_name: string | null; receipt_no: string | null;
  flaw_summary: string | null;
  flaws: Array<{ name: string | null; type: string | null; degree: string | null; degreeId: number | null; remark: string | null; images: string[] }>;
  flaw_image_count: number;
  flaw_thumb: string | null;
}
export interface QualityRow {
  mall_id: string; site: string; store_code: string | null; mall_name: string | null; owner: string | null;
  product_id: string | null; goods_id: string | null; product_name: string | null;
  image_url: string | null; category_name: string | null;
  afs_score: number | null;
  afs_order_rate: number | null;
  afs_order_cnt: number | null;
  afs_problems: string | null;
  rev_cnt: number | null;
  avg_rev_score: number | null;
  rev_problems: string | null;
  captured_at: number | null;
}
export interface QualityShopRow {
  mall_id: string; site: string; store_code: string | null; mall_name: string | null; owner: string | null;
  afs_rate_90d: number | null; avg_score_90d: number | null; expect_loss: number | null; captured_at: number | null;
}
export interface ReviewRow {
  mall_id: string; site: string | null; store_code: string | null; mall_name: string | null;
  review_id: string; product_id: string | null; product_skc_id: string | null;
  goods_id: string | null; goods_name: string | null;
  score: number | null; comment: string | null; comment_zh: string | null; spec_summary: string | null; category_path: string | null;
  status: number | null; on_sale: number | null; created_at_ts: number | null;
  is_benefit: boolean; pictures: string[];
}
export interface ProductPanelRow {
  mall_id: string; product_id: string; store_code: string | null; mall_name: string | null; title: string | null; thumb: string | null;
  skc_codes: string | null; sku_codes: string | null; declared_price: number | null; score: number | null; comments: number | null;
  stock: number | null; occupy: number | null; unavail: number | null; advice: number | null; lack: number | null; lack_qty: number | null; shipping: number | null; total_stock: number | null;
  expose: number | null; click: number | null; pay: number | null; conv: number | null; grow: string | null; onsales_duration: number | null; hot_tag?: boolean; has_hot_sku?: boolean;
  limited: boolean; act_cnt: number; min_price: number | null; compliance: string | null; skus_detail?: SkuChild[]; __rk?: number;
}
export interface HpfRow {
  mall_id: string; store_code: string | null; mall_name: string | null; owner: string | null;
  product_id: string; skc_id: string | null; title: string | null; thumb: string | null;
  sku_codes: string | null; decline_rate: number | null; last_seen_date: string | null;
  declared_price: number | null; current_price: number | null; target_price: number | null; stock: number | null; today_sales: number | null; last7d_sales: number | null;
  __rk?: number;
}
export interface GoodsCreatedRow { mall_id: string; store_code: string | null; }
export interface LifecycleRow { mall_id: string; skc_id: string; status: string; }

export interface Diag { label: string; action: string; level: number }
export interface DiagnosedRow extends SkuRow { _level: number; _issues: Diag[] }

export interface TodoTask {
  key: string; type: "product" | "code" | "risk" | "activity"; typeLabel: string;
  level: number; store: string; mall_id: string;
  object: string; sub: string | null; metric: string; action: string;
  status?: "done" | "ignored" | null; __rk?: number;
}
