import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Alert, Button, Card, Empty, Image, Input, InputNumber, Modal, Segmented, Select, Statistic, Table, Tabs, Tag, Tooltip, Typography, message } from "antd";
import { EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ResponsiveContainer } from "recharts";
import { useNavigate } from "react-router-dom";
import { formatStoreNo, formatMallName } from "../utils/storeDisplay";
import { HIDE_RISK, HIDE_ACTIVITY, HIDE_REVIEW, OFFICIAL_SOURCE, HIDE_DIAG, HIDE_RESTOCK, HIDE_STOCK } from "../utils/operationsFlags";
import { useSessionState } from "../hooks/useSessionState";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { selectStatusLabel } from "../utils/temuSelectStatus";
import PipelineTab from "../components/PipelineTab";

// 分页「每页条数」选择器:antd 5.25+ 默认带搜索框(聚焦冒出可编辑光标),这里强制关掉
const NoSearchSelect = (props: Record<string, unknown>) => <Select {...props} showSearch={false} />;

interface SkuRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  skc_id: string | null; sku_ext_code: string | null; product_id: string | null;
  title: string | null; category: string | null;
  today: number; last7d: number; last30d: number;
  stock: number; occupy: number; advice_qty: number;
  sale_days: number | null; declared_price: number | null; stat_date: string | null;
}
interface RiskRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  risk_type: string | null; severity: string | null; title: string | null; status: string | null;
  product_id: string | null; skc_id: string | null; quantity: number; stat_date: string | null;
  __rk?: number;
}
interface ActivityRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  kind: string | null; title: string | null; status: string | null;
  activity_id: string | null; product_id: string | null; activity_type: number | null; sku_id: string | null;
  sku_ext_code: string | null; skc_id: string | null;
  product_name: string | null; thumb: string | null;
  signup_price: number | null; suggested_price: number | null; price_diff: number | null;
  activity_stock: number; cost: number | null; end_at: string | null; stat_date: string | null;
  __rk?: number;
}
// 活动报名「概览」行:按(店×货号)聚合的商品维度,actIds=可提交活动 pendingIds=缺ID待采集
interface ActProductRow {
  key: string; mall_id: string; store_code: string | null; mall_name: string | null;
  sku_ext_code: string; product_id: string | null; skc_id: string | null;
  product_name: string | null; thumb: string | null;
  actIds: Set<string>; pendingIds: Set<string>;
  bestMargin: number | null; bestProfit: number | null;
  enrolledCount: number;
}
interface ShopHealthRow {
  mall_id: string; store_code: string | null; mall_name: string | null; owner: string | null;
  sale_volume: number; sale_7d: number; sale_30d: number;
  on_sale: number; wait_online: number; lack_skc: number; advice_prepare_skc: number;
  about_to_sell_out: number; already_sold_out: number; high_price_limit: number;
  after_sale_ratio_90d: number | null; stat_date: string | null; __rk?: number;
}
interface StockOrderRow {
  mall_id: string; store_code: string | null; mall_name: string | null;
  sku_ext_code: string | null; product_name: string | null; spec_name: string | null;
  source_type: string | null; demand_qty: number; delivered_qty: number; gap: number;
  shipping_qty: number; inbound_qty: number; latest_ship_at: string | null; warehouse: string | null; order_no: string | null;
  __rk?: number;
}
interface TrendRow { mall_id: string; store_code: string | null; mall_name: string | null; stat_date: string; sales: number; }
// 官方店铺维度广告/流量(ad_report_mall)：原始指标值 rate×100(%)、金额=分、roas=×1000
interface AdMallRow {
  mall_id: string; store: string;
  imprCnt: number | null; clkCnt: number | null; ctr: number | null; cartCnt: number | null;
  cvr: number | null; orderPayCnt: number | null; orderPayAmt: number | null;
  spend: number | null; roas: number | null; acos: number | null;
}
interface StoreMatrixRow {
  store_code: string; mall_id: string; mall_name: string | null; owner: string | null;
  sales: number; sale_7d: number; lack: number; soldout: number;
  high_risk: number; restock: number; stock_gap: number; activity: number;
  lc: Record<string, number>; // 各上新生命周期阶段(中文标签)的 SKC 数
  first_ship: number;         // 今日(北京)发出的首单数(按 WB 去重)
  goods_created: number;      // 今日(北京)创建的商品 SKC 数
}
interface SkuChild { skc_id: string | null; sku_ext_code: string | null; spec_name?: string | null; declared_price: number | null; today: number; last7d: number; last30d: number; sale_days: number | null; stock: number; occupy: number; advice_qty: number; lack_qty?: number; }
interface FirstShipRow { mall_id: string; store_code: string | null; mall_name: string | null; sub_purchase_order_sn: string; delivery_order_sn: string | null; product_skc_id: string | null; ext_code: string | null; deliver_time: number | null; }
interface QcRow {
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
// 商品品质看板(Temu 后台「商品品质看板」抓包):一行 = 一个商品
interface QualityRow {
  mall_id: string; site: string; store_code: string | null; mall_name: string | null; owner: string | null;
  product_id: string | null; goods_id: string | null; product_name: string | null;
  image_url: string | null; category_name: string | null;
  afs_score: number | null;        // 品质分(goodsAfsScore,0-100,越低越差)
  afs_order_rate: number | null;   // 品质售后订单率
  afs_order_cnt: number | null;    // 品质售后订单数
  afs_problems: string | null;     // 售后问题分布摘要
  rev_cnt: number | null;          // 评价数
  avg_rev_score: number | null;    // 平均评分(5分制)
  rev_problems: string | null;     // 差评问题分布摘要
  captured_at: number | null;      // 抓包时间(epoch ms)
}
// 商品品质看板 - 店铺级 90 天指标
interface QualityShopRow {
  mall_id: string; site: string; store_code: string | null; mall_name: string | null; owner: string | null;
  afs_rate_90d: number | null; avg_score_90d: number | null; expect_loss: number | null; captured_at: number | null;
}
// 站点标记 → 中文标签（cn=agentseller.temu.com 主站「全球」 / us=美区 / eu=欧区）
const QUALITY_SITE_LABEL: Record<string, string> = { cn: "全球", us: "美区", eu: "欧区" };

interface ReviewRow {
  mall_id: string; site: string | null; store_code: string | null; mall_name: string | null;
  review_id: string; product_id: string | null; product_skc_id: string | null;
  goods_id: string | null; goods_name: string | null;
  score: number | null; comment: string | null; comment_zh: string | null; spec_summary: string | null; category_path: string | null;
  status: number | null; on_sale: number | null; created_at_ts: number | null;
  is_benefit: boolean; pictures: string[];
}

interface ProductPanelRow {
  mall_id: string; product_id: string; store_code: string | null; mall_name: string | null; title: string | null; thumb: string | null;
  skc_codes: string | null; sku_codes: string | null; declared_price: number | null; score: number | null; comments: number | null;
  stock: number | null; occupy: number | null; unavail: number | null; advice: number | null; lack: number | null; lack_qty: number | null; shipping: number | null; total_stock: number | null;
  expose: number | null; click: number | null; pay: number | null; conv: number | null; grow: string | null; onsales_duration: number | null; hot_tag?: boolean; has_hot_sku?: boolean;
  limited: boolean; act_cnt: number; min_price: number | null; compliance: string | null; skus_detail?: SkuChild[]; __rk?: number;
}

// 高价限流清单行(SPU 级):被 Temu「高价流量受限」的商品;数据=抓包,官方 API 无
interface HpfRow {
  mall_id: string; store_code: string | null; mall_name: string | null; owner: string | null;
  product_id: string; skc_id: string | null; title: string | null; thumb: string | null;
  sku_codes: string | null; decline_rate: number | null; last_seen_date: string | null;
  declared_price: number | null; current_price: number | null; target_price: number | null; stock: number | null; today_sales: number | null; last7d_sales: number | null;
  __rk?: number;
}

interface Diag { label: string; action: string; level: number }
interface DiagnosedRow extends SkuRow { _level: number; _issues: Diag[] }

// 今日待办:跨「商品/风险/活动」维度汇成的统一任务项;key 为稳定标识,供后续闭环(标记已处理)复用
interface TodoTask {
  key: string; type: "product" | "code" | "risk" | "activity"; typeLabel: string;
  level: number; store: string; mall_id: string;
  object: string; sub: string | null; metric: string; action: string;
  status?: "done" | "ignored" | null; __rk?: number;
}
const TODO_TYPE_TAG: Record<string, { c: string; t: string }> = {
  product: { c: "orange", t: "运营" }, code: { c: "gold", t: "缺货号" }, risk: { c: "red", t: "风险" }, activity: { c: "green", t: "活动" },
};
const TODO_LEVEL_TEXT: Record<number, string> = { 3: "急", 2: "警", 1: "注意" };

// 待办「去处理」跳转目标:备货走应用内路由(/purchase-center 采购单),其余跳 Temu 卖家后台
// 后台深链路径取自 automation worker 实际用过的页;如需精确到违规/报名子页,改这里即可
const SELLER_BASE = "https://agentseller.temu.com";
const RESTOCK_LABELS = new Set(["已售罄", "即将断货", "建议补货", "售罄无销"]);
function processTarget(t: TodoTask): { route?: string; ext?: string; label: string } {
  if (t.type === "code") return { ext: `${SELLER_BASE}/goods/list`, label: "去后台补货号" };
  if (t.type === "risk") return { ext: `${SELLER_BASE}/main/data-center`, label: "去后台处理" };
  if (t.type === "activity") return { ext: `${SELLER_BASE}/main/activity-analysis`, label: "去活动中心" };
  // product:补货类去开采购单,动销类(零动销/停销/下滑)去后台救量
  if (RESTOCK_LABELS.has(t.typeLabel)) return { route: "/purchase-center", label: "去开采购单" };
  return { ext: `${SELLER_BASE}/main/activity-analysis`, label: "去活动救量" };
}

const LEVEL_COLOR: Record<number, string> = { 3: "#cf1322", 2: "#d46b08", 1: "#d4b106", 0: "#3f8600" };
const TAG_COLOR: Record<number, string> = { 3: "red", 2: "orange", 1: "gold", 0: "green" };

const RISK_TYPE_LABEL: Record<string, string> = {
  high_price_flow: "高价限流", high_price: "高价限制", violation: "违规", appeal: "申诉",
  compliance: "合规风险", quality: "质量风险", punish: "处罚",
};
const SEV_COLOR: Record<string, string> = { high: "red", medium: "orange", low: "gold" };
const SEV_TEXT: Record<string, string> = { high: "高", medium: "中", low: "低" };
const SEV_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
const KIND_LABEL: Record<string, string> = { activity: "活动", bidding: "竞价", coupon: "优惠券" };
// 活动类型(activity_type)中文:用于报名弹窗区分同商品的多个活动
const ACTIVITY_TYPE_LABEL: Record<number, string> = { 1: "限时秒杀", 5: "大促活动", 13: "官方大促", 14: "限时专属", 21: "超级秒杀", 27: "清仓甩卖", 101: "秒杀进阶", 127: "清仓进阶" };

function diagnose(r: SkuRow): Diag[] {
  const issues: Diag[] = [];
  const hasSales = (r.last30d || 0) > 0 || (r.last7d || 0) > 0;
  if ((r.stock || 0) <= 0) {
    if (hasSales) issues.push({ label: "已售罄", action: "近期有销量却断货 → 立即补货", level: 3 });
    else issues.push({ label: "售罄无销", action: "长期断货且无销量 → 确认是否下架/清理", level: 1 });
  } else {
    if (r.sale_days != null && r.sale_days < 7) issues.push({ label: "即将断货", action: `仅可售约 ${r.sale_days} 天 → 尽快备货`, level: 2 });
    else if ((r.advice_qty || 0) > 0) issues.push({ label: "建议补货", action: `系统建议备货 ${r.advice_qty.toLocaleString("zh-CN")} 件`, level: 1 });
    if ((r.last30d || 0) === 0) issues.push({ label: "零动销", action: "30 天无销量但有库存 → 清仓/优化标题/报活动", level: 2 });
    else if ((r.last7d || 0) === 0) issues.push({ label: "近期停销", action: "30 天有销、近 7 天 0 → 查原因/报活动救量", level: 2 });
    else {
      const d7 = (r.last7d || 0) / 7, d30 = (r.last30d || 0) / 30;
      if (d30 > 0 && d7 < d30 * 0.5) issues.push({ label: "销量下滑", action: "近 7 天日均不足 30 天一半 → 关注/报活动/比价", level: 1 });
    }
  }
  if (!r.sku_ext_code) issues.push({ label: "缺货号", action: "Temu 后台未回填 SKU 货号,无法与 ERP 绑定 → 去卖家后台补货号", level: 1 });
  return issues;
}

const fmtNum = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("zh-CN"));
const fmtMoney = (n: number | null | undefined) => (n == null ? "—" : "¥" + n.toFixed(2));
// 评价时间戳：Temu 给的可能是秒或毫秒，统一判断后格式化为「YYYY-MM-DD HH:mm」
const fmtReviewTime = (ts: number | null | undefined) => {
  if (ts == null) return "—";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const TREND_COLORS = ["#1a73e8", "#34a853", "#fbbc04", "#ea4335", "#a142f4", "#24c1e0", "#ff6d01", "#7c8597"];
// 建议备货自算（Temu 的 adviceQuantity 是黑盒）：
//   今日预估 = 今日销量 ×(早上<12点 ×2 / 下午12-18点 ×1.5 / 晚上≥18点 ×1.3)，把"截至现在"的今日销量预判成全天量
//   日均 = max(7天日均, 今日预估)；备货天数 = 日均>50 用 7 天、否则 10 天；建议备货 = max(0, 日均 × 天数 − 总库存)
const RESTOCK_FAST_QTY = 50;     // 日均超过此值算畅销
const RESTOCK_DAYS_NORMAL = 10;  // 普通品备货天数
const RESTOCK_DAYS_FAST = 7;     // 畅销品备货天数
const calcAdvice = (today: number, last7d: number, totalStock: number, hour: number) => {
  const daily = Math.max((last7d || 0) / 7, (today || 0) * (hour < 12 ? 2 : hour < 18 ? 1.5 : 1.3));
  const days = daily > RESTOCK_FAST_QTY ? RESTOCK_DAYS_FAST : RESTOCK_DAYS_NORMAL;
  return Math.max(0, Math.ceil(daily * days - (totalStock || 0)));
};
// 滞销判定(商品运营全景):加入站点 > 20 天,且按近 7 日均销现有可用库存还能卖 > 20 天。
//   可售天数 = 可用库存 ÷ (近7日销量 ÷ 7);无可用库存→0(没货可滞);有货但近7日0销量→∞(永远卖不动)。
//   口径与「建议备货」一致——SPU 聚合所有 SKU 的可用库存与近7日销量。
const SLOW_MOVING_DAYS = 20;          // 可售天数阈值
const SLOW_MOVING_ONLINE_DAYS = 20;   // 加入站点天数阈值
const sellThroughDays = (r: ProductPanelRow): number => {
  const skus = r.skus_detail || [];
  const stock = skus.reduce((a, s) => a + (s.stock || 0), 0);
  if (stock <= 0) return 0;
  const daily = skus.reduce((a, s) => a + (s.last7d || 0), 0) / 7;
  if (daily <= 0) return Infinity;
  return stock / daily;
};
const isSlowMoving = (r: ProductPanelRow): boolean =>
  (r.onsales_duration ?? 0) > SLOW_MOVING_ONLINE_DAYS && sellThroughDays(r) > SLOW_MOVING_DAYS;

export default function OperationsWorkbench() {
  const owViewKey = (suffix: string) => `temu.ops-workbench.${suffix}`;
  const [activeTab, setActiveTab] = useSessionState(owViewKey("tab"), "overview");
  // 「商品全景」Tab(PipelineTab)自管数据,顶部统一刷新通过递增此信号触发它重新加载
  const [pipelineReloadSignal, setPipelineReloadSignal] = useState(0);
  // 「我的店」视角:按负责人(owner)过滤全局,记住上次选择
  const [ownerFilter, setOwnerFilter] = useState<string>(() => { try { return localStorage.getItem("ow_owner") || "all"; } catch { return "all"; } });
  const setOwner = useCallback((v: string) => { setOwnerFilter(v); try { localStorage.setItem("ow_owner", v); } catch { /* */ } }, []);
  // 合并 Tab 内的子段切换
  const [storeSeg, setStoreSeg] = useSessionState<string>(owViewKey("storeSeg"), "ad");
  const [prodSeg, setProdSeg] = useSessionState<string>(owViewKey("prodSeg"), "panel");
  const goProduct = useCallback((seg: string) => { setProdSeg(seg); setActiveTab("product"); }, []);
  const [skuRows, setSkuRows] = useState<SkuRow[]>([]);
  const [skuLoading, setSkuLoading] = useState(false);
  const [riskRows, setRiskRows] = useState<RiskRow[]>([]);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskLoaded, setRiskLoaded] = useState(false);
  const [actRows, setActRows] = useState<ActivityRow[]>([]);
  const [actLoading, setActLoading] = useState(false);
  const [actLoaded, setActLoaded] = useState(false);
  const [actEnrolled, setActEnrolled] = useState<Map<string, number>>(new Map()); // 已报活动数:`mall_id|货号`→数量
  const [shopRows, setShopRows] = useState<ShopHealthRow[]>([]);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopLoaded, setShopLoaded] = useState(false);
  const [adRows, setAdRows] = useState<AdMallRow[]>([]);
  const [adLoading, setAdLoading] = useState(false);
  const [adLoaded, setAdLoaded] = useState(false);
  const [stockRows, setStockRows] = useState<StockOrderRow[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockLoaded, setStockLoaded] = useState(false);
  const [trendRows, setTrendRows] = useState<TrendRow[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendLoaded, setTrendLoaded] = useState(false);
  const [panelRows, setPanelRows] = useState<ProductPanelRow[]>([]);
  const [trendOf, setTrendOf] = useState<{ productId: string; title: string } | null>(null);
  const [trendModalRows, setTrendModalRows] = useState<Array<{ date: string; qty: number; revenue: number }>>([]);
  const [trendModalLoading, setTrendModalLoading] = useState(false);
  const [flawPreviewVisible, setFlawPreviewVisible] = useState(false);
  const [flawPreviewImages, setFlawPreviewImages] = useState<string[]>([]);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelLoaded, setPanelLoaded] = useState(false);
  const [firstShipRows, setFirstShipRows] = useState<FirstShipRow[]>([]);
  const [firstShipLoaded, setFirstShipLoaded] = useState(false);
  const [firstShipLoading, setFirstShipLoading] = useState(false);
  const [goodsCreatedRows, setGoodsCreatedRows] = useState<Array<{ mall_id: string; store_code: string | null }>>([]);
  const [goodsCreatedLoaded, setGoodsCreatedLoaded] = useState(false);
  const [goodsCreatedLoading, setGoodsCreatedLoading] = useState(false);
  const [qcRows, setQcRows] = useState<QcRow[]>([]);
  const [qcLoaded, setQcLoaded] = useState(false);
  const [qcLoading, setQcLoading] = useState(false);
  const [qualityRows, setQualityRows] = useState<QualityRow[]>([]);
  const [qualityShops, setQualityShops] = useState<QualityShopRow[]>([]);
  const [qualityLoaded, setQualityLoaded] = useState(false);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [reviewLoaded, setReviewLoaded] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [hpfRows, setHpfRows] = useState<HpfRow[]>([]);
  const [hpfLoaded, setHpfLoaded] = useState(false);
  const [hpfLoading, setHpfLoading] = useState(false);
  // 官方生命周期 / 选品状态行(含 mall_id),供总览「上新生命周期分布」按「我的店」过滤统计
  const [lifecycleRows, setLifecycleRows] = useState<Array<{ mall_id: string; skc_id: string; status: string }>>([]);
  const [lifecycleLoaded, setLifecycleLoaded] = useState(false);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [storeFilter, setStoreFilter] = useSessionState(owViewKey("storeFilter"), "all");
  const [diagFilter, setDiagFilter] = useSessionState(owViewKey("diagFilter"), "all");
  const [searchInput, setSearchInput] = useSessionState(owViewKey("search"), "");
  // 搜索框防抖：输入框绑 searchInput 跟手，下游多个视图过滤用防抖后的 search（变量名不变，下游无需改）。
  const search = useDebouncedValue(searchInput, 250);
  const [scoreFilter, setScoreFilter] = useSessionState(owViewKey("scoreFilter"), "all");
  const [regionFilter, setRegionFilter] = useSessionState(owViewKey("reviewRegion"), "all");
  const [slowFilter, setSlowFilter] = useSessionState(owViewKey("slowFilter"), "all"); // 商品运营全景:全部 / 仅看滞销
  const [sevFilter, setSevFilter] = useSessionState(owViewKey("sevFilter"), "all");
  const [kindFilter, setKindFilter] = useSessionState(owViewKey("kindFilter"), "all");
  const [todoType, setTodoType] = useSessionState(owViewKey("todoType"), "all");
  const [todoStatus, setTodoStatus] = useSessionState(owViewKey("todoStatus"), "open"); // 默认只看待处理
  const [batchPrice, setBatchPrice] = useState<number | null>(null); // 活动报名:批量填申报价
  const [batchStock, setBatchStock] = useState<number | null>(null); // 活动报名:批量填库存
  const [selActRows, setSelActRows] = useState<ActivityRow[]>([]); // 活动报名:勾选待提交行
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [actSkuOnly, setActSkuOnly] = useSessionState(owViewKey("actSkuOnly"), true); // 活动报名:仅看有货号的行(店铺-商品-活动维度)
  const [, startJumpTransition] = useTransition();
  const jumpWorkbench = useCallback((tab: string, query: string, before?: () => void) => {
    before?.();
    setActiveTab(tab);
    if (query) startJumpTransition(() => setSearchInput(query));
  }, [setActiveTab, setSearchInput, startJumpTransition]);
  const goPipelineRiskTag = useCallback((tag: string, item: { code?: string; name?: string; productId?: string | null }) => {
    const codeQuery = String(item.code || "").trim();
    const productQuery = String(item.productId || "").trim();
    const nameQuery = String(item.name || "").trim();
    if (tag === "qc_fail") {
      jumpWorkbench("qc", codeQuery || nameQuery || productQuery);
      return;
    }
    if (tag === "compliance") {
      jumpWorkbench("product", productQuery || nameQuery || codeQuery, () => setProdSeg("panel"));
      return;
    }
    if (tag === "limited") {
      jumpWorkbench("hpf", productQuery || nameQuery || codeQuery);
      return;
    }
    if (tag === "stock_out" || tag === "urgent_restock") {
      jumpWorkbench("product", codeQuery || nameQuery || productQuery, () => setProdSeg("restock"));
      return;
    }
    if (tag === "quality_score" || tag === "low_score" || tag === "many_bad_reviews" || tag === "high_return_rate" || tag === "quality" || tag === "quality_risk") {
      jumpWorkbench("quality", productQuery || nameQuery || codeQuery);
      return;
    }

    jumpWorkbench("risk", nameQuery || codeQuery || productQuery);
  }, [jumpWorkbench, setProdSeg]);
  const [enrollModalSku, setEnrollModalSku] = useState<{ mall_id: string; store_code: string | null; sku_ext_code: string; product_name: string | null } | null>(null); // 报名弹窗:当前商品(null=关闭)
  // 待办闭环(第一版落 localStorage,零后端撞车;task key 稳定,后续可平滑迁 op_task_state 表)
  const [todoState, setTodoState] = useState<Record<string, "done" | "ignored">>(() => {
    try { return JSON.parse(localStorage.getItem("ow_todo_state") || "{}"); } catch { return {}; }
  });
  const markTask = useCallback((key: string, status: "done" | "ignored" | null) => {
    setTodoState((prev) => {
      const next = { ...prev };
      if (status === null) delete next[key]; else next[key] = status;
      try { localStorage.setItem("ow_todo_state", JSON.stringify(next)); } catch { /* */ }
      return next;
    });
    // 写后端(跨设备/跨用户共享);后端不可用时静默,localStorage 已兜底
    try { window.electronAPI?.erp?.opTask?.set?.({ taskKey: key, status }); } catch { /* */ }
  }, []);
  const navigate = useNavigate();
  // 待办「去处理」:备货跳应用内采购单页,其余跳 Temu 卖家后台对应页(openExternal 已存在)
  const goProcess = useCallback((t: TodoTask) => {
    const tgt = processTarget(t);
    if (tgt.route) { navigate(tgt.route); return; }
    if (tgt.ext) {
      const open = window.electronAPI?.app?.openExternal;
      if (open) open(tgt.ext); else window.open(tgt.ext, "_blank");
    }
  }, [navigate]);

  // 活动报名决策表:每行(店×活动×SKU)的「建议申报价/活动库存」草稿,默认申报价=活动参考价,落 localStorage(不提交)
  const [enrollDraft, setEnrollDraft] = useState<Record<string, { price?: number; stock?: number }>>(() => {
    try { return JSON.parse(localStorage.getItem("ow_enroll_draft") || "{}"); } catch { return {}; }
  });
  const enrollKey = useCallback((r: ActivityRow) => `${r.mall_id}|${r.activity_id || r.kind || ""}|${r.sku_ext_code || r.skc_id || ""}`, []);
  const persistDraft = useCallback((next: Record<string, { price?: number; stock?: number }>) => {
    setEnrollDraft(next);
    try { localStorage.setItem("ow_enroll_draft", JSON.stringify(next)); } catch { /* */ }
  }, []);
  const setDraft = useCallback((key: string, patch: { price?: number | null; stock?: number | null }) => {
    setEnrollDraft((prev) => {
      const cur = { ...(prev[key] || {}) };
      if ("price" in patch) { if (patch.price == null) delete cur.price; else cur.price = patch.price; }
      if ("stock" in patch) { if (patch.stock == null) delete cur.stock; else cur.stock = patch.stock; }
      const next = { ...prev, [key]: cur };
      try { localStorage.setItem("ow_enroll_draft", JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  }, []);
  // 生效申报价/库存:草稿优先,否则默认参考价(无则原申报价)/快照库存
  const effPrice = useCallback((r: ActivityRow): number | null => {
    const d = enrollDraft[enrollKey(r)]?.price;
    return d != null ? d : (r.suggested_price != null ? r.suggested_price : r.signup_price);
  }, [enrollDraft, enrollKey]);
  // 每货号「活动最小库存」:该商品所有可报活动里最小的正 activity_stock(避免过量承诺)
  const skuMinStock = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of actRows) {
      const s = Number(r.activity_stock);
      if (!r.sku_ext_code || !Number.isFinite(s) || s <= 0) continue;
      const cur = m.get(r.sku_ext_code);
      if (cur == null || s < cur) m.set(r.sku_ext_code, s);
    }
    return m;
  }, [actRows]);
  const effStock = useCallback((r: ActivityRow): number => {
    const d = enrollDraft[enrollKey(r)]?.stock;
    if (d != null) return d;
    if (r.sku_ext_code && skuMinStock.has(r.sku_ext_code)) return skuMinStock.get(r.sku_ext_code)!; // 默认取活动最小值
    return r.activity_stock || 0;
  }, [enrollDraft, enrollKey, skuMinStock]);

  // 提交报名:勾选行→按活动分组→worker live match 解析权威 ID(dryRun 预演)→二次确认→真提交
  const submitEnroll = useCallback(async () => {
    const rows = selActRows;
    if (!rows.length) { message.warning("请先勾选要报名的商品行"); return; }
    const api = window.electronAPI?.automation?.yunduEnrollPriced;
    if (!api) { message.error("当前桌面端不支持(请重启/更新应用)"); return; }
    const noId = rows.filter((r) => !r.activity_id);
    if (noId.length) { message.error(`有 ${noId.length} 行缺活动ID(快照未透出),无法提交;请刷新数据或换有ID的活动`); return; }
    // 按活动(thematicId+type)分组
    const groups = new Map<string, { thId: string; type: number | null; rows: ActivityRow[] }>();
    for (const r of rows) {
      const k = `${r.activity_id}|${r.activity_type ?? ""}`;
      if (!groups.has(k)) groups.set(k, { thId: r.activity_id!, type: r.activity_type, rows: [] });
      groups.get(k)!.rows.push(r);
    }
    const lossRows = rows.filter((r) => { const p = effPrice(r); return p != null && r.cost != null && p < r.cost; });
    const noPrice = rows.filter((r) => effPrice(r) == null);
    if (noPrice.length) { message.error(`有 ${noPrice.length} 行没有申报价,先填价再提交`); return; }
    setEnrollBusy(true);
    try {
      // 1) 逐组 dryRun 预演,拿权威解析 + 未匹配
      const previews: Array<{ thId: string; type: number | null; n: number; resp: any }> = [];
      for (const g of groups.values()) {
        const items = g.rows.map((r) => ({ extCode: r.sku_ext_code || "", activityPriceYuan: effPrice(r)!, activityStock: effStock(r) }));
        const resp = await api({ activityType: g.type ?? undefined, activityThematicId: Number(g.thId), items, dryRun: true });
        previews.push({ thId: g.thId, type: g.type, n: g.rows.length, resp });
      }
      const totalResolved = previews.reduce((a, p) => a + (p.resp?.resolved?.length || 0), 0);
      const allMissing = previews.flatMap((p) => p.resp?.missing || []);
      // 2) 二次确认
      Modal.confirm({
        title: "确认提交活动报名",
        width: 560,
        content: (
          <div style={{ fontSize: 13 }}>
            <p>共 <b>{rows.length}</b> 行 / {groups.size} 个活动;live 解析成功 <b style={{ color: "#3f8600" }}>{totalResolved}</b> 个 SKU。</p>
            {allMissing.length > 0 && <p style={{ color: "#d46b08" }}>⚠️ {allMissing.length} 个货号在活动里没匹配到(将跳过):{allMissing.slice(0, 8).join(", ")}{allMissing.length > 8 ? "…" : ""}</p>}
            {lossRows.length > 0 && <p style={{ color: "#cf1322", fontWeight: 600 }}>🔴 {lossRows.length} 行申报价低于成本(亏本):{lossRows.slice(0, 5).map((r) => r.sku_ext_code).join(", ")}{lossRows.length > 5 ? "…" : ""}</p>}
            <p style={{ color: "#888" }}>申报价将按你填的值(元×100=分)真实提交到 Temu,确认后不可撤销。</p>
          </div>
        ),
        okText: lossRows.length > 0 ? "仍然提交(含亏本)" : "确认提交",
        okButtonProps: { danger: lossRows.length > 0 },
        cancelText: "取消",
        onOk: async () => {
          let ok = 0, fail = 0;
          for (const g of groups.values()) {
            const items = g.rows.map((r) => ({ extCode: r.sku_ext_code || "", activityPriceYuan: effPrice(r)!, activityStock: effStock(r) }));
            try {
              const resp = await api({ activityType: g.type ?? undefined, activityThematicId: Number(g.thId), items, dryRun: false });
              if (resp?.ok) ok += resp.submittedProducts || 0; else fail += 1;
            } catch { fail += 1; }
          }
          if (fail === 0) { message.success(`已提交 ${ok} 个商品报名`); setSelActRows([]); }
          else message.warning(`提交完成:成功组若干、失败 ${fail} 组,详见各活动报名记录`);
        },
      });
    } catch (e: any) {
      message.error("预演失败:" + (e?.message || String(e)));
    } finally { setEnrollBusy(false); }
  }, [selActRows, effPrice, effStock]);

  // 多店·扩展路:把勾选行按(店×活动)拼成任务下发云端,各店登录态的浏览器扩展自动报名(免逐店切登)
  const submitViaExtension = useCallback(async () => {
    const rows = selActRows;
    if (!rows.length) { message.warning("请先勾选要报名的商品行"); return; }
    const api = window.electronAPI?.erp?.enroll?.create;
    if (!api) { message.error("当前桌面端不支持(请重启/更新应用)"); return; }
    const bad = rows.filter((r) => !r.product_id || !r.skc_id || !r.sku_id || !r.activity_id);
    if (bad.length) { message.error(`有 ${bad.length} 行缺 ID(快照未透出 product/skc/sku/activity),走扩展路需完整 ID`); return; }
    const noPrice = rows.filter((r) => effPrice(r) == null);
    if (noPrice.length) { message.error(`有 ${noPrice.length} 行没填申报价`); return; }
    // 分组:mall → (activity_id,type) → product → skc → sku
    const groups = new Map<string, { mall_id: string; activity_type: number | null; activity_thematic_id: string; prod: Map<string, { productId: number; activityStock: number; skc: Map<string, Map<string, number>> }> }>();
    for (const r of rows) {
      const k = `${r.mall_id}|${r.activity_id}|${r.activity_type ?? ""}`;
      if (!groups.has(k)) groups.set(k, { mall_id: r.mall_id, activity_type: r.activity_type, activity_thematic_id: r.activity_id!, prod: new Map() });
      const g = groups.get(k)!;
      if (!g.prod.has(r.product_id!)) g.prod.set(r.product_id!, { productId: Number(r.product_id), activityStock: effStock(r), skc: new Map() });
      const pe = g.prod.get(r.product_id!)!;
      pe.activityStock = effStock(r);
      if (!pe.skc.has(r.skc_id!)) pe.skc.set(r.skc_id!, new Map());
      pe.skc.get(r.skc_id!)!.set(r.sku_id!, Math.round(effPrice(r)! * 100));
    }
    const tasks = [...groups.values()].map((g) => ({
      mall_id: g.mall_id, site: "agentseller", activity_type: g.activity_type, activity_thematic_id: g.activity_thematic_id,
      product_list: [...g.prod.values()].map((pe) => ({
        productId: pe.productId, activityStock: pe.activityStock,
        skcList: [...pe.skc.entries()].map(([skcId, skuMap]) => ({ skcId: Number(skcId), skuList: [...skuMap.entries()].map(([skuId, activityPrice]) => ({ skuId: Number(skuId), activityPrice })) })),
      })),
    }));
    const lossRows = rows.filter((r) => { const p = effPrice(r); return p != null && r.cost != null && p < r.cost; });
    Modal.confirm({
      title: "下发报名任务(多店·扩展执行)",
      width: 560,
      content: (
        <div style={{ fontSize: 13 }}>
          <p>共 <b>{rows.length}</b> 行 → <b>{tasks.length}</b> 个(店×活动)任务,下发到云端,由各店<b>登录态的浏览器扩展</b>自动报名(免逐店切登)。</p>
          {lossRows.length > 0 && <p style={{ color: "#cf1322", fontWeight: 600 }}>🔴 {lossRows.length} 行申报价低于成本(亏本)</p>}
          <p style={{ color: "#888" }}>需对应店铺的 Chrome 开着(装了扩展)才会执行;结果稍后在「报名记录」或刷新可见。</p>
        </div>
      ),
      okText: lossRows.length > 0 ? "仍然下发(含亏本)" : "下发任务",
      okButtonProps: { danger: lossRows.length > 0 },
      cancelText: "取消",
      onOk: async () => {
        setEnrollBusy(true);
        try {
          const resp = await api({ tasks });
          const out = resp?.data?.rows || [];
          const ok = out.filter((x: { ok: boolean }) => x.ok).length;
          if (ok) { message.success(`已下发 ${ok}/${out.length} 个报名任务,等扩展执行`); setSelActRows([]); }
          else message.error("下发失败:" + (out[0]?.error || resp?.error || "未知"));
        } catch (e: any) { message.error("下发失败:" + (e?.message || String(e))); }
        finally { setEnrollBusy(false); }
      },
    });
  }, [selActRows, effPrice, effStock]);

  const loadSku = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.skuSales) { setError("当前版本不支持运营工作台，请升级桌面端"); return; }
    setSkuLoading(true);
    try {
      const resp = await window.electronAPI.erp.reports.skuSales({ includeTest: false });
      if (resp.ok && resp.data) { setSkuRows((resp.data.rows || []) as SkuRow[]); setError(null); }
      else setError(resp.error || "加载失败");
    } catch (e: any) { setError(e?.message || String(e)); } finally { setSkuLoading(false); }
  }, []);
  const loadRisk = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.riskList) return;
    setRiskLoading(true);
    try { const resp = await window.electronAPI.erp.reports.riskList({ includeTest: false }); if (resp.ok && resp.data) { setRiskRows((resp.data.rows || []) as RiskRow[]); setRiskLoaded(true); } } catch { /* */ } finally { setRiskLoading(false); }
  }, []);
  const loadAct = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.activityList) return;
    setActLoading(true);
    try { const resp = await window.electronAPI.erp.reports.activityList({ includeTest: false }); if (resp.ok && resp.data) { setActRows((resp.data.rows || []) as ActivityRow[]); const em = new Map<string, number>(); for (const en of ((resp.data as { enrolled?: { mall_id: string; sku_ext_code: string | null; count: number }[] }).enrolled || [])) { if (en.sku_ext_code) em.set(`${en.mall_id}|${en.sku_ext_code}`, en.count); } setActEnrolled(em); setActLoaded(true); } } catch { /* */ } finally { setActLoading(false); }
  }, []);
  const loadShop = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.shopHealth) return;
    setShopLoading(true);
    try { const resp = await window.electronAPI.erp.reports.shopHealth({ includeTest: false }); if (resp.ok && resp.data) { setShopRows((resp.data.rows || []) as ShopHealthRow[]); setShopLoaded(true); } } catch { /* */ } finally { setShopLoading(false); }
  }, []);

  // 官方店铺维度广告/流量(近7天)：来自 ad_report_mall 快照
  const loadAd = useCallback(async () => {
    const api = (window.electronAPI as any)?.erp?.temuOpenApi;
    if (!api?.listRecords) return;
    setAdLoading(true);
    try {
      const resp = await api.listRecords("ad_report_mall");
      const rows: AdMallRow[] = ((resp?.rows || []) as any[]).map((r) => {
        const sum = (r.raw && r.raw.summary) || {};
        const g = (k: string) => (sum[k] && sum[k].total && sum[k].total.val != null) ? Number(sum[k].total.val) : null;
        return {
          mall_id: String(r.mall_id), store: String(r.mall_id),
          imprCnt: g("imprCnt"), clkCnt: g("clkCnt"), ctr: g("ctr"), cartCnt: g("cartCnt"),
          cvr: g("cvr"), orderPayCnt: g("orderPayCnt"), orderPayAmt: g("orderPayAmt"),
          spend: g("spend"), roas: g("roas"), acos: g("acos"),
        };
      });
      setAdRows(rows); setAdLoaded(true);
    } catch { /* */ } finally { setAdLoading(false); }
  }, []);
  const loadStockOrders = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.stockOrders) return;
    setStockLoading(true);
    try { const resp = await window.electronAPI.erp.reports.stockOrders({ includeTest: false }); if (resp.ok && resp.data) { setStockRows((resp.data.rows || []) as StockOrderRow[]); setStockLoaded(true); } } catch { /* */ } finally { setStockLoading(false); }
  }, []);
  const loadTrend = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.salesTrend) return;
    setTrendLoading(true);
    try { const resp = await window.electronAPI.erp.reports.salesTrend({ includeTest: false }); if (resp.ok && resp.data) { setTrendRows((resp.data.rows || []) as TrendRow[]); setTrendLoaded(true); } } catch { /* */ } finally { setTrendLoading(false); }
  }, []);

  const loadPanel = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.productPanel) return;
    setPanelLoading(true);
    try { const resp = await window.electronAPI.erp.reports.productPanel({ includeTest: false }); if (resp.ok && resp.data) { setPanelRows((resp.data.rows || []) as ProductPanelRow[]); setPanelLoaded(true); } } catch { /* */ } finally { setPanelLoading(false); }
  }, []);

  // 官方「生命周期 / 选品状态」(含 mall_id),供总览「上新生命周期分布」按「我的店」过滤统计;与商品管理页同源
  const loadLifecycle = useCallback(async () => {
    const api = (window.electronAPI as any)?.erp?.temuOpenApi;
    if (!api?.listRecords) return;
    setLifecycleLoading(true);
    try {
      const lc = await api.listRecords("product_lifecycle");
      const rows: Array<{ mall_id: string; skc_id: string; status: string }> = [];
      for (const r of ((lc?.rows || []) as any[])) {
        if (r?.product_skc_id != null && r?.status != null) rows.push({ mall_id: String(r.mall_id ?? ""), skc_id: String(r.product_skc_id), status: String(r.status) });
      }
      setLifecycleRows(rows); setLifecycleLoaded(true);
    } catch { /* 生命周期非关键,失败不影响其它统计 */ } finally { setLifecycleLoading(false); }
  }, []);

  const loadFirstShip = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.firstShipToday) return;
    setFirstShipLoading(true);
    try { const resp = await window.electronAPI.erp.reports.firstShipToday({ includeTest: false }); if (resp.ok && resp.data) { setFirstShipRows((resp.data.rows || []) as unknown as FirstShipRow[]); setFirstShipLoaded(true); } } catch { /* */ } finally { setFirstShipLoading(false); }
  }, []);

  const loadGoodsCreated = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.goodsCreatedToday) return;
    setGoodsCreatedLoading(true);
    try { const resp = await window.electronAPI.erp.reports.goodsCreatedToday({ includeTest: false }); if (resp.ok && resp.data) { setGoodsCreatedRows((resp.data.rows || []) as unknown as Array<{ mall_id: string; store_code: string | null }>); setGoodsCreatedLoaded(true); } } catch { /* */ } finally { setGoodsCreatedLoading(false); }
  }, []);

  const loadQc = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.openapiQc) return;
    setQcLoading(true);
    try { const resp = await window.electronAPI.erp.reports.openapiQc({ includeTest: false }); if (resp.ok && resp.data) { setQcRows((resp.data.rows || []) as unknown as QcRow[]); setQcLoaded(true); } } catch { /* */ } finally { setQcLoading(false); }
  }, []);

  const loadQuality = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.qualityPanel) return;
    setQualityLoading(true);
    try { const resp = await window.electronAPI.erp.reports.qualityPanel({ includeTest: false }); if (resp.ok && resp.data) { setQualityRows((resp.data.rows || []) as unknown as QualityRow[]); setQualityShops((resp.data.shops || []) as unknown as QualityShopRow[]); setQualityLoaded(true); } } catch { /* */ } finally { setQualityLoading(false); }
  }, []);

  const loadReviews = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.reviews) return;
    setReviewLoading(true);
    try { const resp = await window.electronAPI.erp.reports.reviews({ includeTest: false }); if (resp.ok && resp.data) { setReviewRows((resp.data.rows || []) as unknown as ReviewRow[]); setReviewLoaded(true); } } catch { /* */ } finally { setReviewLoading(false); }
  }, []);

  const loadHpf = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.highPriceFlow) return;
    setHpfLoading(true);
    try { const resp = await window.electronAPI.erp.reports.highPriceFlow({ includeTest: false }); if (resp.ok && resp.data) { setHpfRows((resp.data.rows || []) as unknown as HpfRow[]); setHpfLoaded(true); } } catch { /* */ } finally { setHpfLoading(false); }
  }, []);

  // 点击疵点图:实时去 Temu 拉(私有图签名会失效,不能用存的 URL),后端带 referer 拉成 base64 返回
  const openFlawImages = useCallback(async (mallId: string, qcBillId: string) => {
    if (!window.electronAPI?.erp?.reports?.qcFlawImages) return;
    const hide = message.loading("加载疵点照片…", 0);
    try {
      const resp = await window.electronAPI.erp.reports.qcFlawImages({ mallId, qcBillId });
      hide();
      const imgs = (resp.ok && resp.data && resp.data.images) || [];
      if (imgs.length) { setFlawPreviewImages(imgs); setFlawPreviewVisible(true); } else message.info("未取到疵点照片");
    } catch { hide(); message.error("加载疵点照片失败"); }
  }, []);

  useEffect(() => { loadSku(); }, [loadSku]);
  // 商品销量趋势弹窗:打开时按 product_id 拉逐日数据(走 cloud 抓包快照)
  useEffect(() => {
    if (!trendOf) return;
    let alive = true;
    setTrendModalLoading(true); setTrendModalRows([]);
    (async () => {
      try {
        const resp = await window.electronAPI.erp.reports.productTrend({ productId: trendOf.productId });
        if (alive && resp?.ok && resp.data) setTrendModalRows(resp.data.rows || []);
      } catch { /* */ } finally { if (alive) setTrendModalLoading(false); }
    })();
    return () => { alive = false; };
  }, [trendOf]);
  // 挂载时从后端加载待办状态;本地有、后端没有的首次推上去(localStorage → 后端迁移);后端不可用则保持本地
  useEffect(() => {
    const api = window.electronAPI?.erp?.opTask;
    if (!api?.list) return;
    (async () => {
      try {
        const resp = await api.list();
        if (!resp?.ok || !resp.data?.rows) return;
        const backend: Record<string, "done" | "ignored"> = {};
        for (const r of resp.data.rows) backend[r.task_key] = r.status;
        let local: Record<string, "done" | "ignored"> = {};
        try { local = JSON.parse(localStorage.getItem("ow_todo_state") || "{}"); } catch { /* */ }
        for (const k of Object.keys(local)) if (!(k in backend)) api.set?.({ taskKey: k, status: local[k] });
        const merged = { ...local, ...backend };
        setTodoState(merged);
        try { localStorage.setItem("ow_todo_state", JSON.stringify(merged)); } catch { /* */ }
      } catch { /* 后端不可用,保持 localStorage */ }
    })();
  }, []);
  useEffect(() => {
    const store = activeTab === "store";
    const todo = activeTab === "todo"; // 今日待办依赖风险+活动+诊断(诊断走 skuRows,已在挂载时加载)
    // shop 始终加载:owner 映射是「我的店」全局过滤的基础
    if (!shopLoaded && !shopLoading) loadShop();
    if (!OFFICIAL_SOURCE && store && !trendLoaded && !trendLoading) loadTrend();
    if (store && !adLoaded && !adLoading) loadAd();
    if (activeTab === "stock" && !stockLoaded && !stockLoading) loadStockOrders();
    if ((activeTab === "risk" || todo) && !riskLoaded && !riskLoading) loadRisk();
    if ((activeTab === "activity" || todo) && !actLoaded && !actLoading) loadAct();
    if (activeTab === "product" && !panelLoaded && !panelLoading) loadPanel();
    // 生命周期分布在「总览」展示,也供「商品」复用;两处任一激活即拉(独立 loading,不阻塞首屏其它统计)
    if ((activeTab === "overview" || activeTab === "product") && !lifecycleLoaded && !lifecycleLoading) loadLifecycle();
    // 今日首单发货:在总览展示,首屏拉(独立 loading,数据小不阻塞其它统计)
    if (activeTab === "overview" && !firstShipLoaded && !firstShipLoading) loadFirstShip();
    if (activeTab === "overview" && !goodsCreatedLoaded && !goodsCreatedLoading) loadGoodsCreated();
    if (activeTab === "qc" && !qcLoaded && !qcLoading) loadQc();
    if (activeTab === "quality" && !qualityLoaded && !qualityLoading) loadQuality();
    if (activeTab === "review" && !reviewLoaded && !reviewLoading) loadReviews();
    if (activeTab === "hpf" && !hpfLoaded && !hpfLoading) loadHpf();
  }, [activeTab, shopLoaded, shopLoading, trendLoaded, trendLoading, adLoaded, adLoading, stockLoaded, stockLoading, riskLoaded, riskLoading, actLoaded, actLoading, panelLoaded, panelLoading, lifecycleLoaded, lifecycleLoading, firstShipLoaded, firstShipLoading, goodsCreatedLoaded, goodsCreatedLoading, qcLoaded, qcLoading, qualityLoaded, qualityLoading, reviewLoaded, reviewLoading, hpfLoaded, hpfLoading, loadShop, loadTrend, loadAd, loadStockOrders, loadRisk, loadAct, loadPanel, loadLifecycle, loadFirstShip, loadGoodsCreated, loadQc, loadQuality, loadReviews, loadHpf]);

  useEffect(() => {
    if (activeTab !== "pipeline") return;
    const lightTimer = window.setTimeout(() => {
      if (!riskLoaded && !riskLoading) loadRisk();
      if (!qcLoaded && !qcLoading) loadQc();
      if (!qualityLoaded && !qualityLoading) loadQuality();
      if (!hpfLoaded && !hpfLoading) loadHpf();
    }, 700);
    const panelTimer = window.setTimeout(() => {
      if (!panelLoaded && !panelLoading) loadPanel();
    }, 1600);
    return () => {
      window.clearTimeout(lightTimer);
      window.clearTimeout(panelTimer);
    };
  }, [activeTab, riskLoaded, riskLoading, panelLoaded, panelLoading, qcLoaded, qcLoading, qualityLoaded, qualityLoading, hpfLoaded, hpfLoading, loadRisk, loadPanel, loadQc, loadQuality, loadHpf]);

  const diagnosed: DiagnosedRow[] = useMemo(() => skuRows.map((r) => {
    const issues = diagnose(r);
    return { ...r, _issues: issues, _level: issues.length ? Math.max(...issues.map((i) => i.level)) : 0 };
  }), [skuRows]);

  // store_code / mall_id → owner 映射(来自店铺健康),用于「我的店」过滤
  const storeOwnerMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of shopRows) {
      if (!r.owner) continue;
      if (r.store_code) m.set(r.store_code, r.owner);
      if (r.mall_id) m.set(r.mall_id, r.owner);
    }
    return m;
  }, [shopRows]);
  const ownerOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of shopRows) if (r.owner) s.add(r.owner);
    return Array.from(s).sort();
  }, [shopRows]);
  // 当前 owner 视角下该店是否可见;选了具体 owner 但映射还没到(shop未加载)时不误杀,放行
  const inScope = useCallback((code: string | null | undefined) => {
    if (ownerFilter === "all") return true;
    if (storeOwnerMap.size === 0) return true;
    return storeOwnerMap.get(code || "") === ownerFilter;
  }, [ownerFilter, storeOwnerMap]);
  const isPipelineStoreInScope = useCallback((storeCode?: string | null, mallId?: string | null) => {
    return inScope(storeCode || mallId);
  }, [inScope]);

  const storeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of skuRows) if (r.store_code && inScope(r.store_code || r.mall_id)) s.add(r.store_code);
    return Array.from(s).sort();
  }, [skuRows, inScope]);

  const overview = useMemo(() => {
    let urgent = 0, warn = 0, note = 0, healthy = 0;
    const byLabel: Record<string, number> = {};
    for (const r of diagnosed) {
      if (!inScope(r.store_code || r.mall_id)) continue;
      if (r._level === 3) urgent++; else if (r._level === 2) warn++; else if (r._level === 1) note++; else healthy++;
      for (const i of r._issues) byLabel[i.label] = (byLabel[i.label] || 0) + 1;
    }
    return { urgent, warn, note, healthy, byLabel };
  }, [diagnosed, inScope]);

  const diagView = useMemo(() => {
    let v = diagnosed.filter((r) => inScope(r.store_code || r.mall_id));
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    if (diagFilter === "urgent") v = v.filter((r) => r._level === 3);
    else if (diagFilter === "warn") v = v.filter((r) => r._level === 2);
    else if (diagFilter === "note") v = v.filter((r) => r._level === 1);
    else if (diagFilter === "issues") v = v.filter((r) => r._level > 0);
    else if (diagFilter !== "all") v = v.filter((r) => r._issues.some((i) => i.label === diagFilter));
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.sku_ext_code || "").toLowerCase().includes(q) || (r.title || "").toLowerCase().includes(q));
    return [...v].sort((a, b) => b._level - a._level || b.last7d - a.last7d);
  }, [diagnosed, storeFilter, diagFilter, search, inScope]);

  // 今日待办:把商品诊断 issues + 中高风险 + 可报活动汇成统一任务流(仅「我的店」范围)
  const todoTasks = useMemo<TodoTask[]>(() => {
    const out: TodoTask[] = [];
    for (const r of diagnosed) {
      if (!inScope(r.store_code || r.mall_id)) continue;
      const store = r.store_code || r.mall_id;
      for (const it of r._issues) {
        const isCode = it.label === "缺货号";
        out.push({
          key: `${r.mall_id}|${r.skc_id}|${r.sku_ext_code}|${it.label}`,
          type: isCode ? "code" : "product", typeLabel: it.label, level: it.level,
          store, mall_id: r.mall_id,
          object: r.title || r.sku_ext_code || "—", sub: r.sku_ext_code || r.skc_id || null,
          metric: (r.stock || 0) <= 0 ? "已断货" : (r.sale_days != null ? `可售${r.sale_days}天` : `库存${fmtNum(r.stock)}`),
          action: it.action,
        });
      }
    }
    if (!HIDE_RISK) for (const r of riskRows) {
      if (!inScope(r.store_code || r.mall_id) || r.severity === "low") continue; // 待办只收中高风险
      out.push({
        key: `risk|${r.mall_id}|${r.skc_id}|${r.risk_type}|${r.title}`,
        type: "risk", typeLabel: RISK_TYPE_LABEL[r.risk_type || ""] || r.risk_type || "风险",
        level: SEV_RANK[r.severity || ""] || 1, store: r.store_code || r.mall_id, mall_id: r.mall_id,
        object: r.title || r.risk_type || "—", sub: r.skc_id || null,
        metric: (SEV_TEXT[r.severity || ""] || "") + "风险" + (r.quantity ? ` ·${fmtNum(r.quantity)}` : ""),
        action: "去卖家后台处理违规 / 申诉",
      });
    }
    if (!HIDE_ACTIVITY) for (const r of actRows) {
      if (!inScope(r.store_code || r.mall_id)) continue;
      const gp = (r.signup_price != null && r.cost != null) ? r.signup_price - r.cost : null;
      out.push({
        key: `act|${r.mall_id}|${r.skc_id}|${r.sku_ext_code}|${r.title}`,
        type: "activity", typeLabel: KIND_LABEL[r.kind || ""] || "活动", level: 1,
        store: r.store_code || r.mall_id, mall_id: r.mall_id,
        object: r.title || r.sku_ext_code || "(未命名活动)", sub: r.sku_ext_code || null,
        metric: gp != null ? (gp < 0 ? `亏${fmtMoney(gp)}` : `毛利${fmtMoney(gp)}`) : (r.signup_price != null ? `报名${fmtMoney(r.signup_price)}` : "—"),
        action: gp != null && gp < 0 ? "亏本慎报 / 调价后再报" : "可报名冲量",
      });
    }
    return out;
  }, [diagnosed, riskRows, actRows, inScope]);
  const todoCount = useMemo(() => {
    const c = { product: 0, code: 0, risk: 0, activity: 0, urgent: 0, done: 0 };
    for (const t of todoTasks) {
      const st = todoState[t.key];
      if (st === "done") { c.done++; continue; }
      if (st === "ignored") continue;
      c[t.type]++; if (t.level >= 3) c.urgent++;
    }
    return c;
  }, [todoTasks, todoState]);
  const todoView = useMemo(() => {
    let v = todoTasks.map((t) => ({ ...t, status: todoState[t.key] || null }));
    if (storeFilter !== "all") v = v.filter((t) => t.store === storeFilter);
    if (todoType !== "all") v = v.filter((t) => t.type === todoType);
    if (todoStatus === "open") v = v.filter((t) => !t.status);
    else if (todoStatus !== "all") v = v.filter((t) => t.status === todoStatus);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((t) => t.object.toLowerCase().includes(q) || (t.sub || "").toLowerCase().includes(q));
    return [...v].sort((a, b) => b.level - a.level).map((t, i) => ({ ...t, __rk: i }));
  }, [todoTasks, storeFilter, todoType, todoStatus, search, todoState]);

  // 库存补货：需补货 SKU（售罄/即将断货/有建议备货），紧急度排序
  const restockView = useMemo(() => {
    const need = (r: SkuRow) => (r.stock || 0) <= 0 || (r.sale_days != null && r.sale_days < 14) || (r.advice_qty || 0) > 0;
    const urg = (r: SkuRow) => {
      if ((r.stock || 0) <= 0 && ((r.last30d || 0) > 0 || (r.last7d || 0) > 0)) return 3;
      if (r.sale_days != null && r.sale_days < 7) return 2;
      if ((r.advice_qty || 0) > 0 || (r.sale_days != null && r.sale_days < 14)) return 1;
      return 0;
    };
    let v = skuRows.filter((r) => need(r) && inScope(r.store_code || r.mall_id));
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.sku_ext_code || "").toLowerCase().includes(q) || (r.title || "").toLowerCase().includes(q));
    return [...v].sort((a, b) => urg(b) - urg(a) || (a.sale_days ?? Infinity) - (b.sale_days ?? Infinity) || b.advice_qty - a.advice_qty);
  }, [skuRows, storeFilter, search, inScope]);

  const riskStoreReady = riskRows;
  const riskOverview = useMemo(() => {
    let high = 0, medium = 0, low = 0;
    for (const r of riskRows) { if (!inScope(r.store_code || r.mall_id)) continue; if (r.severity === "high") high++; else if (r.severity === "medium") medium++; else low++; }
    return { high, medium, low };
  }, [riskRows, inScope]);
  const riskView = useMemo(() => {
    let v = riskStoreReady.filter((r) => inScope(r.store_code || r.mall_id));
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    if (sevFilter !== "all") v = v.filter((r) => r.severity === sevFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.title || "").toLowerCase().includes(q) || (r.risk_type || "").toLowerCase().includes(q) || (r.skc_id || "").includes(q));
    return [...v].sort((a, b) => (SEV_RANK[b.severity || ""] || 0) - (SEV_RANK[a.severity || ""] || 0)).map((r, i) => ({ ...r, __rk: i }));
  }, [riskStoreReady, storeFilter, sevFilter, search, inScope]);

  const actView = useMemo(() => {
    let v = actRows.filter((r) => inScope(r.store_code || r.mall_id));
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    if (kindFilter !== "all") v = v.filter((r) => r.kind === kindFilter);
    if (actSkuOnly) v = v.filter((r) => r.sku_ext_code); // 仅看有货号的行(滤掉活动表头噪声)
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.product_name || r.title || "").toLowerCase().includes(q) || (r.sku_ext_code || "").toLowerCase().includes(q));
    // 去重:同 货号+活动+申报价+参考价 的完全重复行只留一条
    const seen = new Set<string>();
    v = v.filter((r) => {
      const k = `${r.store_code || r.mall_id}|${r.sku_ext_code || ""}|${r.activity_id || r.title || ""}|${r.signup_price ?? ""}|${r.suggested_price ?? ""}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    });
    // 店铺 → 商品(货号) → 活动 维度排序;无货号的表头行沉底
    const sc = (r: ActivityRow) => r.store_code || r.mall_id || "";
    return [...v].sort((a, b) => {
      const s = sc(a).localeCompare(sc(b)); if (s) return s;
      const ah = a.sku_ext_code ? 0 : 1, bh = b.sku_ext_code ? 0 : 1; if (ah !== bh) return ah - bh;
      const sk = (a.sku_ext_code || "").localeCompare(b.sku_ext_code || ""); if (sk) return sk;
      return (a.title || "").localeCompare(b.title || "");
    }).map((r, i) => ({ ...r, __rk: i }));
  }, [actRows, storeFilter, kindFilter, search, inScope, actSkuOnly]);

  // 每货号可报活动数(去重后,按 activity_id||活动名 区分)
  // 活动报名「概览」:把逐行 actView 按(店×货号)聚合成每商品一行,算可报活动数/待补ID/最优参考利润率
  const actProductView = useMemo<ActProductRow[]>(() => {
    const m = new Map<string, ActProductRow>();
    for (const r of actView) {
      if (!r.sku_ext_code) continue;
      const key = `${r.store_code || r.mall_id}|${r.sku_ext_code}`;
      let e = m.get(key);
      if (!e) {
        e = { key, mall_id: r.mall_id, store_code: r.store_code, mall_name: r.mall_name,
          sku_ext_code: r.sku_ext_code, product_id: r.product_id, skc_id: r.skc_id,
          product_name: r.product_name || r.title, thumb: r.thumb,
          actIds: new Set(), pendingIds: new Set(), bestMargin: null, bestProfit: null, enrolledCount: 0 };
        m.set(key, e);
      }
      if (!e.product_name && (r.product_name || r.title)) e.product_name = r.product_name || r.title;
      if (!e.thumb && r.thumb) e.thumb = r.thumb;
      if (!e.product_id && r.product_id) e.product_id = r.product_id;
      if (!e.skc_id && r.skc_id) e.skc_id = r.skc_id;
      if (r.activity_id) e.actIds.add(r.activity_id);
      else e.pendingIds.add(r.title || "");
      const ref = r.suggested_price ?? r.signup_price; // 参考价:优先活动参考价,无则原申报价
      if (ref != null && r.cost != null && ref > 0) {
        const margin = (ref - r.cost) / ref;
        if (e.bestMargin == null || margin > e.bestMargin) { e.bestMargin = margin; e.bestProfit = ref - r.cost; }
      }
    }
    const arr = [...m.values()];
    for (const e of arr) e.enrolledCount = actEnrolled.get(`${e.mall_id}|${e.sku_ext_code}`) || 0; // 填已报活动数
    return arr.sort((a, b) => {
      const s = (a.store_code || a.mall_id).localeCompare(b.store_code || b.mall_id); if (s) return s;
      return b.actIds.size - a.actIds.size; // 可报活动多的在前
    });
  }, [actView, actEnrolled]);

  // 活动概览顶部汇总(我的店范围):在售商品数 + 有活动可报商品数 + 可报活动机会总数
  const actSummary = useMemo(() => {
    let onSale = 0;
    for (const r of shopRows) { if (!inScope(r.store_code || r.mall_id)) continue; onSale += r.on_sale || 0; }
    let opp = 0, withAct = 0, enrolled = 0;
    for (const p of actProductView) { opp += p.actIds.size; if (p.actIds.size > 0) withAct++; enrolled += p.enrolledCount; }
    return { onSale, withAct, opp, enrolled };
  }, [shopRows, inScope, actProductView]);

  // 报名弹窗:当前商品的可报活动行(actView 里同店同货号,逐个活动一行)
  const modalActRows = useMemo(() => {
    if (!enrollModalSku) return [];
    return actView.filter((r) => r.sku_ext_code === enrollModalSku.sku_ext_code && r.mall_id === enrollModalSku.mall_id);
  }, [enrollModalSku, actView]);

  const shopAgg = useMemo(() => {
    let lack = 0, soldout = 0, sales = 0;
    for (const r of shopRows) { if (!inScope(r.store_code || r.mall_id)) continue; lack += r.lack_skc || 0; soldout += r.already_sold_out || 0; sales += r.sale_volume || 0; }
    return { lack, soldout, sales };
  }, [shopRows, inScope]);
  // 上新生命周期阶段展示顺序(中文,与 selectStatusLabel 输出一致);「未发布」「价格申报中」各自合并多个状态码;各店概览按此顺序出列
  const LIFECYCLE_STAGE_ORDER = ["未发布", "待寄样", "价格申报中", "待创建首单", "已创建首单", "已发布到站点", "已下架/终止"];
  const overviewTrend = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const r of trendRows) { if (!inScope(r.store_code || r.mall_id)) continue; byDate.set(r.stat_date, (byDate.get(r.stat_date) || 0) + r.sales); }
    return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, sales]) => ({ date, sales }));
  }, [trendRows, inScope]);
  const storeMatrix = useMemo(() => {
    const m = new Map<string, StoreMatrixRow>();
    const get = (code: string, mall_id: string, mall_name: string | null, owner: string | null) => {
      let e = m.get(code);
      if (!e) { e = { store_code: code, mall_id, mall_name, owner, sales: 0, sale_7d: 0, lack: 0, soldout: 0, high_risk: 0, restock: 0, stock_gap: 0, activity: 0, lc: {}, first_ship: 0, goods_created: 0 }; m.set(code, e); }
      if (mall_name && !e.mall_name) e.mall_name = mall_name;
      if (owner && !e.owner) e.owner = owner;
      return e;
    };
    for (const r of shopRows) { if (!inScope(r.store_code || r.mall_id)) continue; const e = get(r.store_code || r.mall_id, r.mall_id, r.mall_name, r.owner); e.sales = r.sale_volume; e.sale_7d = r.sale_7d; e.lack = r.lack_skc; e.soldout = r.already_sold_out; }
    for (const r of riskRows) if (r.severity === "high" && inScope(r.store_code || r.mall_id)) get(r.store_code || r.mall_id, r.mall_id, r.mall_name, null).high_risk++;
    const need = (r: SkuRow) => (r.stock || 0) <= 0 || (r.sale_days != null && r.sale_days < 14) || (r.advice_qty || 0) > 0;
    for (const r of skuRows) if (need(r) && inScope(r.store_code || r.mall_id)) get(r.store_code || r.mall_id, r.mall_id, r.mall_name, null).restock++;
    for (const r of stockRows) { if (!inScope(r.store_code || r.mall_id)) continue; get(r.store_code || r.mall_id, r.mall_id, r.mall_name, null).stock_gap++; }
    for (const r of actRows) { if (!inScope(r.store_code || r.mall_id)) continue; get(r.store_code || r.mall_id, r.mall_id, r.mall_name, null).activity++; }
    // 各店上新生命周期阶段数:按 mall_id 匹配已建档店,(mall|skc) 去重后按中文阶段累加到该店
    const byMall = new Map<string, StoreMatrixRow>();
    for (const e of m.values()) byMall.set(e.mall_id, e);
    const seenSkc = new Map<string, string>();
    for (const r of lifecycleRows) { if (!r.skc_id || !r.status || !inScope(r.mall_id)) continue; seenSkc.set(r.mall_id + "|" + r.skc_id, r.status); }
    for (const [k, status] of seenSkc) { const e = byMall.get(k.split("|")[0]); if (e) { const label = selectStatusLabel(status); e.lc[label] = (e.lc[label] || 0) + 1; } }
    // 今日首单发货:按 mall_id 累加到该店(firstShipRows 每行 = 一个已去重首单)
    for (const r of firstShipRows) { if (!inScope(r.store_code || r.mall_id)) continue; const e = byMall.get(r.mall_id); if (e) e.first_ship += 1; }
    // 今日创建商品:按 mall_id 累加到该店(goodsCreatedRows 每行 = 今天创建的一个 SKC)
    for (const r of goodsCreatedRows) { if (!inScope(r.store_code || r.mall_id)) continue; const e = byMall.get(r.mall_id); if (e) e.goods_created += 1; }
    // 各店概览只显示已建档的店（有真实店号）；没建档的店 store_code 被 mall_id 顶替，过滤掉
    return [...m.values()].filter((e) => e.store_code !== e.mall_id).sort((a, b) => (b.lack + b.soldout + b.high_risk * 5) - (a.lack + a.soldout + a.high_risk * 5));
  }, [shopRows, riskRows, skuRows, stockRows, actRows, lifecycleRows, firstShipRows, goodsCreatedRows, inScope]);
  const panelBase = useMemo(() => {
    let v = panelRows.filter((r) => inScope(r.store_code || r.mall_id));
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.title || "").toLowerCase().includes(q) || (r.product_id || "").includes(q));
    return v;
  }, [panelRows, storeFilter, search, inScope]);
  const slowCount = useMemo(() => panelBase.filter(isSlowMoving).length, [panelBase]);
  const panelView = useMemo(() => {
    const v = slowFilter === "slow" ? panelBase.filter(isSlowMoving) : panelBase;
    return v.map((r, i) => ({ ...r, __rk: i }));
  }, [panelBase, slowFilter]);
  // 官方流量(店铺维度)：用 shopRows 把 mall_id 映射成店名/store_code，沿用 owner/store 过滤
  const mallInfoMap = useMemo(() => {
    const m = new Map<string, { name: string; code: string | null }>();
    for (const s of shopRows) m.set(s.mall_id, { name: s.mall_name || s.store_code || s.mall_id, code: s.store_code });
    return m;
  }, [shopRows]);
  const adView = useMemo(() => {
    let v = adRows.map((r) => { const info = mallInfoMap.get(r.mall_id); return { ...r, store: info?.name || r.mall_id, store_code: info?.code || null }; });
    v = v.filter((r) => inScope(r.store_code || r.mall_id));
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    return v.sort((a, b) => (b.spend || 0) - (a.spend || 0)).map((r, i) => ({ ...r, __rk: i }));
  }, [adRows, mallInfoMap, storeFilter, inScope]);
  const adAgg = useMemo(() => {
    const sum = (k: keyof AdMallRow) => adView.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    return { impr: sum("imprCnt"), clk: sum("clkCnt"), spend: sum("spend"), amt: sum("orderPayAmt"), ord: sum("orderPayCnt") };
  }, [adView]);
  const stockView = useMemo(() => {
    let v = stockRows.filter((r) => inScope(r.store_code || r.mall_id));
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.sku_ext_code || "").toLowerCase().includes(q) || (r.product_name || "").toLowerCase().includes(q) || (r.order_no || "").toLowerCase().includes(q));
    return v.map((r, i) => ({ ...r, __rk: i }));
  }, [stockRows, storeFilter, search, inScope]);
  const trendChart = useMemo(() => {
    const scoped = trendRows.filter((r) => inScope(r.store_code || r.mall_id));
    const dates = [...new Set(scoped.map((r) => r.stat_date))].sort();
    const totals = new Map<string, number>();
    for (const r of scoped) { const k = r.store_code || r.mall_id; totals.set(k, (totals.get(k) || 0) + r.sales); }
    let stores: string[];
    if (storeFilter !== "all") stores = [storeFilter];
    else stores = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map((e) => e[0]);
    const byDate = new Map<string, Record<string, number | string>>();
    for (const d of dates) byDate.set(d, { date: d });
    for (const r of scoped) {
      const k = r.store_code || r.mall_id;
      if (!stores.includes(k)) continue;
      const row = byDate.get(r.stat_date);
      if (row) row[k] = r.sales;
    }
    return { data: dates.map((d) => byDate.get(d)!), stores };
  }, [trendRows, storeFilter, inScope]);

  const skuTitleCol = {
    title: "商品 · SKU / SKC / SPU", key: "sku", width: 300,
    render: (_: any, r: SkuRow) => (
      <div>
        <Typography.Text copyable={{ text: r.sku_ext_code || "" }} style={{ fontSize: 12, fontWeight: 600 }}>{r.sku_ext_code || "(无货号)"}</Typography.Text>
        <Tooltip title={r.title || ""}><div style={{ color: "#888", fontSize: 12, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "—"}</div></Tooltip>
        <div style={{ fontSize: 11, color: "#aaa" }}>
          {r.skc_id ? <span>SKC&nbsp;{r.skc_id}</span> : null}
          {r.product_id ? <span style={{ marginLeft: 8 }}>SPU&nbsp;{r.product_id}</span> : null}
        </div>
      </div>
    ),
  };
  const storeCol = { title: "店号", dataIndex: "store_code", width: 88, fixed: "left" as const, render: (v: string | null) => <Typography.Text strong>{formatStoreNo(v)}</Typography.Text>, sorter: (a: any, b: any) => (a.store_code || "").localeCompare(b.store_code || "") };

  const diagColumns: ColumnsType<DiagnosedRow> = [
    storeCol, skuTitleCol,
    { title: "诊断", key: "diag", width: 150, render: (_, r) => r._issues.length ? <span>{r._issues.map((i) => <Tag key={i.label} color={TAG_COLOR[i.level]} style={{ marginBottom: 2 }}>{i.label}</Tag>)}</span> : <Tag color="green">健康</Tag>, sorter: (a, b) => a._level - b._level, defaultSortOrder: "descend" },
    { title: "建议动作", key: "action", width: 290, render: (_, r) => r._issues.length ? <div style={{ fontSize: 12 }}>{r._issues.map((i) => <div key={i.label} style={{ color: LEVEL_COLOR[i.level] }}>· {i.action}</div>)}</div> : <span style={{ color: "#aaa" }}>正常在售</span> },
    { title: "近7天", dataIndex: "last7d", width: 75, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.last7d - b.last7d },
    { title: "近30天", dataIndex: "last30d", width: 80, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.last30d - b.last30d },
    { title: "库存", dataIndex: "stock", width: 80, align: "right", render: (v: number) => <span style={{ color: v <= 0 ? "#cf1322" : undefined }}>{fmtNum(v)}</span>, sorter: (a, b) => a.stock - b.stock },
    { title: "可售天数", dataIndex: "sale_days", width: 85, align: "right", render: (v: number | null) => (v == null ? "—" : <span style={{ color: v < 7 ? "#d46b08" : undefined }}>{v}天</span>) },
  ];

  const todoColumns: ColumnsType<TodoTask> = [
    { title: "紧急度", dataIndex: "level", width: 76, fixed: "left" as const, render: (v: number) => <Tag color={TAG_COLOR[v]}>{TODO_LEVEL_TEXT[v] || "—"}</Tag>, sorter: (a, b) => a.level - b.level, defaultSortOrder: "descend" },
    { title: "类型", key: "type", width: 90, render: (_, t) => { const tg = TODO_TYPE_TAG[t.type]; return <Tag color={tg?.c}>{tg?.t}·{t.typeLabel}</Tag>; }, filters: [{ text: "运营", value: "product" }, { text: "缺货号", value: "code" }, { text: "风险", value: "risk" }, { text: "活动", value: "activity" }], onFilter: (val, t) => t.type === val },
    { title: "店号", dataIndex: "store", width: 88, render: (v: string, t) => <Typography.Text strong>{formatStoreNo(v === t.mall_id ? null : v, t.mall_id)}</Typography.Text>, sorter: (a, b) => a.store.localeCompare(b.store) },
    { title: "对象 · 商品 / SKU", key: "obj", width: 320, render: (_, t) => (
      <div>
        <Tooltip title={t.object}><div style={{ fontSize: 12, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.object}</div></Tooltip>
        {t.sub ? <div style={{ color: "#999", fontSize: 11 }}>{t.sub}</div> : null}
      </div>
    ) },
    { title: "关键指标", dataIndex: "metric", width: 120, render: (v: string) => <span style={{ fontSize: 12 }}>{v}</span> },
    { title: "建议动作", dataIndex: "action", width: 280, render: (v: string, t) => <span style={{ fontSize: 12, color: LEVEL_COLOR[t.level] }}>{v}</span> },
    { title: "处理", key: "ops", width: 200, fixed: "right" as const, render: (_, t) => (
      t.status ? (
        <span style={{ fontSize: 12 }}><Tag color={t.status === "done" ? "green" : "default"}>{t.status === "done" ? "已处理" : "已忽略"}</Tag><a onClick={() => markTask(t.key, null)}>恢复</a></span>
      ) : (
        <span style={{ fontSize: 12 }}>
          <a style={{ color: "#1677ff" }} onClick={() => goProcess(t)}>{processTarget(t).label}</a>
          <a style={{ marginLeft: 10, color: "#3f8600" }} onClick={() => markTask(t.key, "done")}>完成</a>
          <a style={{ marginLeft: 10, color: "#999" }} onClick={() => markTask(t.key, "ignored")}>忽略</a>
        </span>
      )
    ) },
  ];

  const restockColumns: ColumnsType<SkuRow> = [
    storeCol, skuTitleCol,
    { title: "库存", dataIndex: "stock", width: 90, align: "right", render: (v: number, r) => <span style={{ color: v <= 0 ? "#cf1322" : undefined }}>{fmtNum(v)}{r.occupy > 0 ? <span style={{ color: "#aaa", fontSize: 11 }}> /占{fmtNum(r.occupy)}</span> : null}</span>, sorter: (a, b) => a.stock - b.stock },
    { title: "可售天数", dataIndex: "sale_days", width: 90, align: "right", render: (v: number | null) => (v == null ? "—" : <span style={{ color: v < 7 ? "#cf1322" : v < 14 ? "#d46b08" : undefined }}>{v}天</span>), sorter: (a, b) => (a.sale_days ?? Infinity) - (b.sale_days ?? Infinity) },
    { title: "建议备货", dataIndex: "advice_qty", width: 100, align: "right", render: (v: number) => (v > 0 ? <Tag color="blue">{fmtNum(v)}</Tag> : "—"), sorter: (a, b) => a.advice_qty - b.advice_qty, defaultSortOrder: "descend" },
    { title: "近7天", dataIndex: "last7d", width: 75, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.last7d - b.last7d },
    { title: "近30天", dataIndex: "last30d", width: 80, align: "right", render: (v) => fmtNum(v) },
    { title: "申报价", dataIndex: "declared_price", width: 80, align: "right", render: (v: number | null) => (v == null ? "—" : "¥" + v.toFixed(2)) },
  ];

  const riskColumns: ColumnsType<RiskRow> = [
    storeCol,
    { title: "严重度", dataIndex: "severity", width: 80, render: (v: string | null) => <Tag color={SEV_COLOR[v || ""] || "default"}>{SEV_TEXT[v || ""] || v || "—"}</Tag>, sorter: (a, b) => (SEV_RANK[a.severity || ""] || 0) - (SEV_RANK[b.severity || ""] || 0), defaultSortOrder: "descend" },
    { title: "风险类型", dataIndex: "risk_type", width: 120, render: (v: string | null) => RISK_TYPE_LABEL[v || ""] || v || "—" },
    { title: "标题 / 商品", dataIndex: "title", width: 360, render: (v: string | null) => <Tooltip title={v || ""}><div style={{ maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v || "—"}</div></Tooltip> },
    { title: "数量", dataIndex: "quantity", width: 80, align: "right", render: (v) => fmtNum(v), sorter: (a, b) => a.quantity - b.quantity },
    { title: "SKC", dataIndex: "skc_id", width: 130, render: (v: string | null) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v || "—"}</Typography.Text> },
  ];

  const actColumns: ColumnsType<ActivityRow> = [
    { title: "活动", key: "act", width: 230, render: (_, r) => (
      <div>
        <Tag color={r.kind === "bidding" ? "purple" : r.kind === "coupon" ? "cyan" : "blue"}>{(r.activity_type != null && ACTIVITY_TYPE_LABEL[r.activity_type]) || KIND_LABEL[r.kind || ""] || "活动"}</Tag>
        {r.title ? <span style={{ fontSize: 12 }}>{r.title}</span> : (r.activity_id ? <span style={{ fontSize: 11, color: "#aaa" }}>ID {r.activity_id}</span> : null)}
        {!r.activity_id && <Tooltip title="缺活动ID(扩展只采到列表、没采到可报名场次),需扩展逛该店活动后台采集后才能报"><span style={{ color: "#d46b08", fontSize: 11, marginLeft: 6 }}>待补ID</span></Tooltip>}
      </div>
    ) },
    { title: "原申报价", dataIndex: "signup_price", width: 80, align: "right", render: (v) => fmtMoney(v) },
    { title: "活动参考价", dataIndex: "suggested_price", width: 90, align: "right", render: (v: number | null) => (v == null ? <span style={{ color: "#bbb" }}>—</span> : fmtMoney(v)) },
    { title: "真实成本", dataIndex: "cost", width: 85, align: "right", render: (v: number | null) => (v == null ? <Tooltip title="无成本台账（未采购入库/未绑定）"><span style={{ color: "#bbb" }}>—</span></Tooltip> : fmtMoney(v)) },
    { title: "建议申报价", key: "bid", width: 116, align: "right", render: (_, r) => {
      const v = effPrice(r); const loss = v != null && r.cost != null && v < r.cost;
      return <InputNumber size="small" min={0} step={0.1} precision={2} value={v ?? undefined} status={loss ? "error" : undefined} style={{ width: 100 }} prefix="¥" onChange={(val) => setDraft(enrollKey(r), { price: val == null ? null : Number(val) })} />;
    } },
    { title: "真实利润 / 率", key: "realmargin", width: 120, align: "right", render: (_, r) => {
      const p = effPrice(r); if (p == null || r.cost == null) return <span style={{ color: "#bbb" }}>—</span>;
      const gp = p - r.cost; const rate = p > 0 ? gp / p : 0; const color = gp < 0 ? "#cf1322" : "#3f8600";
      return <span style={{ color, fontWeight: 600 }}>{gp < 0 ? "亏 " : ""}{fmtMoney(gp)}<span style={{ fontSize: 11, marginLeft: 4 }}>{(rate * 100).toFixed(1)}%</span></span>;
    }, sorter: (a, b) => ((effPrice(a) ?? 0) - (a.cost ?? 0)) - ((effPrice(b) ?? 0) - (b.cost ?? 0)) },
    { title: "活动库存", key: "astock", width: 96, align: "right", render: (_, r) => <InputNumber size="small" min={0} precision={0} value={effStock(r)} style={{ width: 80 }} onChange={(val) => setDraft(enrollKey(r), { stock: val == null ? null : Number(val) })} /> },
    { title: "截止", dataIndex: "end_at", width: 110, render: (v: string | null) => { if (!v) return "—"; const n = Number(v); return Number.isFinite(n) && n > 1e11 ? new Date(n).toLocaleDateString("zh-CN") : String(v); } },
  ];

  // 活动报名「概览」商品维度列
  const actProductColumns: ColumnsType<ActProductRow> = [
    storeCol,
    { title: "商品 / 货号", key: "ap", width: 340, render: (_, r) => (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {r.thumb ? <div style={{ flexShrink: 0, width: 40, height: 40 }}><Image src={r.thumb} width={40} height={40} style={{ objectFit: "cover", borderRadius: 4 }} preview={{ mask: <EyeOutlined /> }} /></div> : <div style={{ width: 40, height: 40, borderRadius: 4, background: "#f0f0f0", flexShrink: 0 }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, maxWidth: 270, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.product_name || undefined}>{r.product_name || <span style={{ color: "#bbb" }}>(无商品名)</span>}</div>
          <Typography.Text copyable={{ text: r.sku_ext_code }} style={{ fontSize: 12, fontWeight: 600 }}>{r.sku_ext_code}</Typography.Text>
          {r.product_id ? <span style={{ fontSize: 11, color: "#aaa", marginLeft: 8 }}>SPU {r.product_id}</span> : null}
        </div>
      </div>
    ) },
    { title: "可报活动", key: "canact", width: 90, align: "center", render: (_, r) => r.actIds.size > 0 ? <Tag color={r.actIds.size >= 3 ? "green" : "blue"}>{r.actIds.size} 个</Tag> : <span style={{ color: "#bbb" }}>—</span>, sorter: (a, b) => a.actIds.size - b.actIds.size, defaultSortOrder: "descend" },
    { title: "待补ID", key: "pending", width: 88, align: "center", render: (_, r) => r.pendingIds.size > 0 ? <Tooltip title="这些活动缺活动ID(扩展只采到列表、没采到可报名场次),需用扩展逛该店活动后台采集后才能报"><span style={{ color: "#d46b08" }}>{r.pendingIds.size} 个</span></Tooltip> : <span style={{ color: "#bbb" }}>—</span> },
    { title: "已报活动", key: "enrolled", width: 88, align: "center", render: (_, r) => r.enrolledCount > 0 ? <Tag color="green">{r.enrolledCount} 个</Tag> : <span style={{ color: "#bbb" }}>—</span>, sorter: (a, b) => a.enrolledCount - b.enrolledCount },
    { title: "最优参考利润", key: "bestm", width: 132, align: "right", render: (_, r) => {
      if (r.bestProfit == null || r.bestMargin == null) return <span style={{ color: "#bbb" }}>—</span>;
      const color = r.bestProfit < 0 ? "#cf1322" : "#3f8600";
      return <span style={{ color, fontWeight: 600 }}>{r.bestProfit < 0 ? "亏 " : ""}{fmtMoney(r.bestProfit)}<span style={{ fontSize: 11, marginLeft: 4 }}>{(r.bestMargin * 100).toFixed(1)}%</span></span>;
    }, sorter: (a, b) => (a.bestProfit ?? -1e9) - (b.bestProfit ?? -1e9) },
    { title: "操作", key: "op", width: 96, align: "center", render: (_, r) => <Button size="small" type="link" disabled={r.actIds.size === 0} onClick={() => { setSelActRows([]); setEnrollModalSku({ mall_id: r.mall_id, store_code: r.store_code, sku_ext_code: r.sku_ext_code, product_name: r.product_name }); }}>去报名</Button> },
  ];


  const SRC_LABEL: Record<string, string> = { stock_order: "备货单", shipping_list: "发货单", shipping_desk: "发货台" };
  const stockColumns: ColumnsType<StockOrderRow> = [
    { title: "店号", dataIndex: "store_code", width: 88, fixed: "left", render: (v, r) => formatStoreNo(v === r.mall_id ? null : v, r.mall_id) },
    { title: "货号", dataIndex: "sku_ext_code", width: 120, render: (v) => v || "—" },
    { title: "商品", dataIndex: "product_name", width: 200, ellipsis: true, render: (v, r) => <span>{v || "—"}{r.spec_name ? <span style={{ color: "#999" }}> / {r.spec_name}</span> : null}</span> },
    { title: "类型", dataIndex: "source_type", width: 80, render: (v: string | null) => (v ? SRC_LABEL[v] || v : "—") },
    { title: "需求量", dataIndex: "demand_qty", width: 80, align: "right", sorter: (a, b) => a.demand_qty - b.demand_qty, render: fmtNum },
    { title: "已发", dataIndex: "delivered_qty", width: 75, align: "right", render: fmtNum },
    { title: "缺口", dataIndex: "gap", width: 80, align: "right", sorter: (a, b) => a.gap - b.gap, defaultSortOrder: "descend", render: (v: number) => (v > 0 ? <span style={{ color: "#cf1322", fontWeight: 600 }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "已入库", dataIndex: "inbound_qty", width: 80, align: "right", render: fmtNum },
    { title: "最晚发货", dataIndex: "latest_ship_at", width: 130, render: (v: string | null) => { if (!v) return "—"; const n = Number(v); return Number.isFinite(n) && n > 1e11 ? new Date(n).toLocaleDateString("zh-CN") : String(v); } },
    { title: "收货仓", dataIndex: "warehouse", width: 140, ellipsis: true, render: (v) => v || "—" },
  ];

  const redNum = (color: string) => (v: number) => (v > 0 ? <span style={{ color, fontWeight: 600 }}>{fmtNum(v)}</span> : <span style={{ color: "#bbb" }}>0</span>);
  const LC_SHORT: Record<string, string> = { "已发布到站点": "在售", "未发布": "未发布", "待寄样": "待寄样", "价格申报中": "申报中", "待创建首单": "待首单", "已创建首单": "已首单", "已下架/终止": "已下架" };
  const storeMatrixColumns: ColumnsType<StoreMatrixRow> = [
    { title: "店号", dataIndex: "store_code", width: 88, fixed: "left", render: (v, r) => formatStoreNo(v === r.mall_id ? null : v, r.mall_id) },
    { title: "店铺", dataIndex: "mall_name", width: 130, ellipsis: true, render: (v: string | null) => formatMallName(v) },
    { title: "负责人", dataIndex: "owner", width: 70, render: (v) => v || "—" },
    { title: "今日销量", dataIndex: "sales", width: 95, align: "right", sorter: (a, b) => a.sales - b.sales, defaultSortOrder: "descend", render: fmtNum },
    { title: "7天销量", dataIndex: "sale_7d", width: 95, align: "right", sorter: (a, b) => a.sale_7d - b.sale_7d, render: fmtNum },
    { title: "缺货", dataIndex: "lack", width: 70, align: "right", sorter: (a, b) => a.lack - b.lack, render: redNum("#d46b08") },
    { title: "售罄", dataIndex: "soldout", width: 70, align: "right", sorter: (a, b) => a.soldout - b.soldout, render: redNum("#cf1322") },
    { title: "高风险", dataIndex: "high_risk", width: 75, align: "right", sorter: (a, b) => a.high_risk - b.high_risk, render: redNum("#cf1322") },
    { title: "待补货", dataIndex: "restock", width: 75, align: "right", sorter: (a, b) => a.restock - b.restock, render: redNum("#d46b08") },
    { title: "备货缺口", dataIndex: "stock_gap", width: 95, align: "right", sorter: (a, b) => a.stock_gap - b.stock_gap, render: fmtNum },
    { title: "可报活动", dataIndex: "activity", width: 95, align: "right", sorter: (a, b) => a.activity - b.activity, render: (v: number) => (v > 0 ? <span style={{ color: "#3f8600" }}>{fmtNum(v)}</span> : <span style={{ color: "#bbb" }}>0</span>) },
    { title: "今日首单", dataIndex: "first_ship", width: 90, align: "right", sorter: (a, b) => a.first_ship - b.first_ship, render: (v: number) => (v > 0 ? <span style={{ color: "#1a73e8", fontWeight: 600 }}>{fmtNum(v)}</span> : <span style={{ color: "#bbb" }}>0</span>) },
    { title: "今日创建", dataIndex: "goods_created", width: 90, align: "right", sorter: (a, b) => a.goods_created - b.goods_created, render: (v: number) => (v > 0 ? <span style={{ color: "#13c2c2", fontWeight: 600 }}>{fmtNum(v)}</span> : <span style={{ color: "#bbb" }}>0</span>) },
    ...LIFECYCLE_STAGE_ORDER.map((label): ColumnsType<StoreMatrixRow>[number] => ({
      title: LC_SHORT[label] || label, key: "lc_" + label, width: 88, align: "right",
      sorter: (a, b) => (a.lc?.[label] || 0) - (b.lc?.[label] || 0),
      render: (_, r) => { const n = r.lc?.[label] || 0; const color = label === "已发布到站点" ? "#3f8600" : label === "已下架/终止" ? "#8c8c8c" : "#d46b08"; return n > 0 ? <span style={{ color }}>{fmtNum(n)}</span> : <span style={{ color: "#bbb" }}>0</span>; },
    })),
  ];

  // 估算文本在规格列(宽~150,可用~138px)的像素宽:中文/全角按12px,空格4px,其余(数字/字母/标点)7px
  const estTextW = (t: string | null | undefined) => { let w = 0; for (const ch of String(t ?? "")) w += /[一-龥＀-￯]/.test(ch) ? 13 : ch === " " ? 4 : 7.5; return w; };
  // SKU 堆叠单元格:把同一 SPU 下多个 SKU 竖直堆叠,数据撑满整行高度(消除 SKU 少、商品图+标题较高时右侧数据下方的留白)。
  // 关键:每列都渲染 N 个数据行 + 1 个合计行(无 total 的列渲染空白占位行),保证各列行数一致;每行 flex:1 等分撑满。
  // 外层 height:100% 依赖 CSS .op-panel-table td{height:1px} 让百分比生效;minHeight 兜底——td 不够高时按内容紧凑、不挤压。
  const stackCell = (skus: SkuChild[], get: (s: SkuChild) => React.ReactNode, total?: React.ReactNode) => {
    if (!skus.length) return <span style={{ color: "#bbb" }}>—</span>;
    const lineH = 19;
    if (skus.length === 1) return <div style={{ height: "100%", minHeight: lineH + 4, display: "flex", flexDirection: "column", justifyContent: "center", fontSize: 13 }}>{get(skus[0])}</div>;
    const rowMin = (s: SkuChild) => Math.max(1, Math.ceil(estTextW(s.spec_name) / 128)) * lineH + 4;
    const rowBase: React.CSSProperties = { boxSizing: "border-box", padding: "2px 0", overflow: "hidden", fontSize: 13, lineHeight: `${lineH}px`, display: "flex", flexDirection: "column", justifyContent: "center", flex: "1 1 0" };
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: (skus.length + 1) * (lineH + 4) }}>
        {skus.map((s, i) => <div key={i} style={{ ...rowBase, minHeight: rowMin(s), borderBottom: "1px solid #f5f5f5" }}>{get(s)}</div>)}
        <div style={{ ...rowBase, minHeight: lineH + 4, fontWeight: total != null ? 600 : 400, color: total != null ? "#1a73e8" : undefined }}>{total != null ? <>合计 {total}</> : null}</div>
      </div>
    );
  };
  const skusOf = (r: ProductPanelRow): SkuChild[] => r.skus_detail || [];
  const nowHour = new Date().getHours();
  const adviceOf = (r: ProductPanelRow) => { const skus = skusOf(r); return calcAdvice(skus.reduce((a, s) => a + (s.today || 0), 0), skus.reduce((a, s) => a + (s.last7d || 0), 0), r.total_stock || 0, nowHour); };

  const qcColumns: ColumnsType<QcRow> = [
    { title: "店号", dataIndex: "store_code", width: 78, fixed: "left", render: (v, r) => formatStoreNo(v === r.mall_id ? null : v, r.mall_id) },
    { title: "商品", key: "prod", width: 280, render: (_, r) => (<div style={{ display: "flex", gap: 8, alignItems: "center" }}>{r.thumb_url ? <div style={{ flexShrink: 0, width: 64, height: 64 }}><Image src={r.thumb_url} width={64} height={64} style={{ objectFit: "cover", borderRadius: 4 }} /></div> : <div style={{ width: 64, height: 64, background: "#f0f0f0", borderRadius: 4, flexShrink: 0 }} />}<div style={{ minWidth: 0 }}><div style={{ fontSize: 12, lineHeight: 1.4, maxHeight: 34, overflow: "hidden" }}>{r.sku_name || "—"}</div><div style={{ fontSize: 11, color: "#8c8c8c" }}>{r.spec || ""}{r.ext_code ? ` · ${r.ext_code}` : ""}</div></div></div>) },
    { title: "采购单", dataIndex: "purchase_no", width: 150, render: (v) => v ? <Typography.Text copyable={{ text: String(v) }} style={{ fontSize: 12 }}>{v}</Typography.Text> : "—" },
    { title: "结果", dataIndex: "qc_result", width: 76, align: "center", render: (v) => v === 2 ? <span style={{ color: "#cf1322", fontWeight: 600 }}>不合格</span> : v === 1 ? <span style={{ color: "#3f8600" }}>合格</span> : "—" },
    { title: "疵点原因", dataIndex: "flaw_summary", width: 320, render: (v) => v ? <span style={{ color: "#cf1322", fontSize: 12 }}>{v}</span> : <span style={{ color: "#bbb" }}>—</span> },
    { title: "疵点图", key: "flaw", width: 86, align: "center", render: (_, r) => {
      if (!r.flaw_image_count) return <span style={{ color: "#bbb" }}>—</span>;
      if (!r.flaw_thumb) return <a onClick={() => openFlawImages(r.mall_id, r.qc_bill_id)}>{r.flaw_image_count} 张</a>;
      return <a onClick={() => openFlawImages(r.mall_id, r.qc_bill_id)} style={{ position: "relative", display: "inline-block", lineHeight: 0 }} title={`${r.flaw_image_count} 张疵点照片,点击查看`}>
        <img src={r.flaw_thumb} width={64} height={64} style={{ objectFit: "cover", borderRadius: 4, border: "1px solid #f0f0f0" }} alt="" />
        <span style={{ position: "absolute", right: 2, bottom: 2, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10, padding: "0 4px", borderRadius: 3, lineHeight: "15px" }}>{r.flaw_image_count}</span>
      </a>;
    } },
    { title: "次品/应检", key: "qty", width: 92, align: "right", render: (_, r) => `${r.defective_qty ?? "—"} / ${r.expect_qty ?? "—"}` },
    { title: "收货单", dataIndex: "receipt_no", width: 150, render: (v) => v || "—" },
    { title: "类目", dataIndex: "cat_name", width: 120, ellipsis: true, render: (v) => v || "—" },
    { title: "质检时间", dataIndex: "qc_result_update_time", width: 150, render: (v) => v ? String(v).slice(0, 19).replace("T", " ") : "—", sorter: (a, b) => String(a.qc_result_update_time || "").localeCompare(String(b.qc_result_update_time || "")), defaultSortOrder: "descend" },
  ];

  const qualityColumns: ColumnsType<QualityRow> = [
    { title: "店号", dataIndex: "store_code", width: 78, fixed: "left", render: (v, r) => formatStoreNo(v === r.mall_id ? null : v, r.mall_id) },
    { title: "站点", dataIndex: "site", width: 64, fixed: "left", align: "center", render: (v: string) => <Tag color={v === "us" ? "blue" : v === "eu" ? "purple" : "default"}>{QUALITY_SITE_LABEL[v] || v || "—"}</Tag> },
    { title: "商品", key: "prod", width: 300, render: (_, r) => (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {r.image_url ? <div style={{ flexShrink: 0, width: 64, height: 64 }}><Image src={r.image_url} width={64} height={64} style={{ objectFit: "cover", borderRadius: 4 }} /></div> : <div style={{ width: 64, height: 64, background: "#f0f0f0", borderRadius: 4, flexShrink: 0 }} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, lineHeight: 1.4, maxHeight: 50, overflow: "hidden" }}>{r.product_name || "—"}</div>
          <div style={{ fontSize: 11, color: "#8c8c8c" }}>{r.category_name || ""}{r.product_id ? ` · ${r.product_id}` : ""}</div>
        </div>
      </div>
    ) },
    { title: "品质分", dataIndex: "afs_score", width: 90, align: "center", defaultSortOrder: "ascend", sorter: (a, b) => (a.afs_score ?? 999) - (b.afs_score ?? 999), render: (v: number | null) => {
      if (v == null) return <span style={{ color: "#bbb" }}>—</span>;
      const color = v < 60 ? "#cf1322" : v < 75 ? "#d46b08" : "#3f8600";
      return <span style={{ color, fontWeight: 600, fontSize: 16 }}>{v.toFixed(1)}</span>;
    } },
    { title: "售后率", dataIndex: "afs_order_rate", width: 116, align: "right", sorter: (a, b) => (a.afs_order_rate ?? 0) - (b.afs_order_rate ?? 0), render: (v: number | null, r) => {
      if (v == null) return <span style={{ color: "#bbb" }}>—</span>;
      const pct = v * 100;
      const color = pct >= 3 ? "#cf1322" : pct >= 1.5 ? "#d46b08" : "#595959";
      return <span style={{ color }}>{pct.toFixed(2)}%{r.afs_order_cnt != null ? <span style={{ color: "#8c8c8c", fontSize: 11 }}> / {r.afs_order_cnt}单</span> : null}</span>;
    } },
    { title: "售后问题", dataIndex: "afs_problems", width: 240, render: (v: string | null) => v ? <span style={{ color: "#cf1322", fontSize: 12 }}>{v}</span> : <span style={{ color: "#bbb" }}>—</span> },
    { title: "评分", dataIndex: "avg_rev_score", width: 116, align: "center", sorter: (a, b) => (a.avg_rev_score ?? 0) - (b.avg_rev_score ?? 0), render: (v: number | null, r) => {
      if (v == null) return <span style={{ color: "#bbb" }}>—</span>;
      const color = v <= 3 ? "#cf1322" : v >= 4 ? "#3f8600" : "#d4b106";
      return <span style={{ color, whiteSpace: "nowrap" }}>★{v.toFixed(2)}{r.rev_cnt != null ? <span style={{ color: "#8c8c8c", fontSize: 11 }}> / {r.rev_cnt}评</span> : null}</span>;
    } },
    { title: "差评问题", dataIndex: "rev_problems", width: 200, render: (v: string | null) => v ? <span style={{ color: "#d46b08", fontSize: 12 }}>{v}</span> : <span style={{ color: "#bbb" }}>—</span> },
    { title: "抓包时间", dataIndex: "captured_at", width: 150, sorter: (a, b) => (a.captured_at ?? 0) - (b.captured_at ?? 0), render: (v: number | null) => v ? new Date(v).toLocaleString("zh-CN", { hour12: false }) : "—" },
  ];

  const reviewColumns: ColumnsType<ReviewRow> = [
    { title: "店号", dataIndex: "store_code", width: 78, fixed: "left", render: (v, r) => formatStoreNo(v === r.mall_id ? null : v, r.mall_id) },
    { title: "区域", dataIndex: "site", width: 60, align: "center", render: (v: string | null) => { const m: Record<string, string> = { agentseller: "全球", "agentseller-us": "美区", "agentseller-eu": "欧区" }; return v ? <Tag color={v === "agentseller-us" ? "blue" : v === "agentseller-eu" ? "purple" : "green"}>{m[v] || v}</Tag> : <span style={{ color: "#bbb" }}>—</span>; } },
    { title: "评分", dataIndex: "score", width: 96, align: "center", sorter: (a, b) => (a.score ?? 0) - (b.score ?? 0), render: (v: number | null) => {
      if (v == null) return <span style={{ color: "#bbb" }}>—</span>;
      const n = Math.max(0, Math.min(5, v));
      const color = v <= 3 ? "#cf1322" : v >= 4 ? "#3f8600" : "#d4b106";
      return <span style={{ color, fontWeight: 600, whiteSpace: "nowrap" }}>{"★".repeat(n)}<span style={{ color: "#999", fontWeight: 400, marginLeft: 2 }}>{v}</span></span>;
    } },
    { title: "评论内容", dataIndex: "comment", width: 440, render: (v: string | null, r) => (
      <div>
        <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", color: r.score != null && r.score <= 3 ? "#cf1322" : undefined }}>{(r.comment_zh || v) || <span style={{ color: "#bbb" }}>（仅评分,无文字）</span>}</div>
        {r.is_benefit ? <Tag color="orange" style={{ marginTop: 4 }}>福利评价</Tag> : null}
      </div>
    ) },
    { title: "晒图", key: "pics", width: 80, align: "center", render: (_, r) => {
      if (!r.pictures || !r.pictures.length) return <span style={{ color: "#bbb" }}>—</span>;
      return (
        <Image.PreviewGroup items={r.pictures}>
          <div style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>
            <Image src={r.pictures[0]} width={56} height={56} style={{ objectFit: "cover", borderRadius: 4 }} />
            {r.pictures.length > 1 ? <span style={{ position: "absolute", right: 2, bottom: 2, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10, padding: "0 4px", borderRadius: 3, lineHeight: "15px" }}>{r.pictures.length}</span> : null}
          </div>
        </Image.PreviewGroup>
      );
    } },
    { title: "商品", key: "goods", width: 240, render: (_, r) => (
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, lineHeight: 1.4, maxHeight: 34, overflow: "hidden" }}>{r.goods_name || "—"}</div>
        <div style={{ fontSize: 11, color: "#8c8c8c" }}>{r.spec_summary || ""}</div>
      </div>
    ) },
    { title: "类目", dataIndex: "category_path", width: 150, ellipsis: true, render: (v: string | null) => v || "—" },
    { title: "评价时间", dataIndex: "created_at_ts", width: 140, sorter: (a, b) => (a.created_at_ts ?? 0) - (b.created_at_ts ?? 0), defaultSortOrder: "descend", render: (v: number | null) => fmtReviewTime(v) },
  ];

  const panelColumns: ColumnsType<ProductPanelRow> = [
    { title: "店号", dataIndex: "store_code", width: 88, fixed: "left", render: (v, r) => <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>{formatStoreNo(v === r.mall_id ? null : v, r.mall_id)}</div> },
    { title: "商品", key: "prod", width: 410, render: (_, r) => {
      const codes = (r.skc_codes || "").split(",").map((c) => c.trim()).filter(Boolean);
      return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {r.thumb ? <div style={{ flexShrink: 0, width: 56, height: 56 }}><Image src={r.thumb} width={56} height={56} style={{ objectFit: "cover", borderRadius: 4 }} preview={{ mask: <EyeOutlined />, maskClassName: "prod-thumb-mask" }} /></div> : <div style={{ width: 56, height: 56, borderRadius: 4, background: "#f0f0f0", flexShrink: 0 }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, lineHeight: 1.45, whiteSpace: "normal", wordBreak: "break-word" }}>{r.title || "—"}</div>
          <div style={{ marginTop: 4, fontSize: 13, color: "#8c8c8c", display: "flex", flexWrap: "wrap", gap: "0 10px" }}>
            <span>SPU <Typography.Text copyable={{ text: String(r.product_id) }} style={{ fontSize: 13, color: "#8c8c8c" }}>{r.product_id}</Typography.Text></span>
            {codes.map((c, i) => <span key={i}>SKC <Typography.Text copyable={{ text: c }} style={{ fontSize: 13, color: "#8c8c8c" }}>{c}</Typography.Text></span>)}
            {!OFFICIAL_SOURCE && <a onClick={(e) => { e.stopPropagation(); setTrendOf({ productId: String(r.product_id), title: r.title || String(r.product_id) }); }} style={{ fontSize: 11 }}>销量趋势</a>}
          </div>
          {(r.hot_tag || r.has_hot_sku || (r.onsales_duration && r.onsales_duration > 0)) ? <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {r.hot_tag ? <Tag color="red" style={{ fontSize: 12, marginInlineEnd: 0, lineHeight: "20px", padding: "0 8px", fontWeight: 500, borderRadius: 10 }}>热销款</Tag> : null}
            {r.has_hot_sku ? <Tag color="volcano" style={{ fontSize: 12, marginInlineEnd: 0, lineHeight: "20px", padding: "0 8px", fontWeight: 500, borderRadius: 10 }}>爆旺SKU</Tag> : null}
            {r.onsales_duration && r.onsales_duration > 0 ? <Tag color="blue" style={{ fontSize: 12, marginInlineEnd: 0, lineHeight: "20px", padding: "0 8px", fontWeight: 500, borderRadius: 10 }}>加入站点 {fmtNum(r.onsales_duration)} 天</Tag> : null}
          </div> : null}
        </div>
      </div>
      </div>
      );
    } },
    { title: "SKU货号", key: "sku_ext", width: 130, render: (_, r) => stackCell(skusOf(r), (s) => s.sku_ext_code || <span style={{ color: "#bbb" }}>—</span>) },
    { title: "规格", key: "spec", width: 150, render: (_, r) => stackCell(skusOf(r), (s) => s.spec_name ? <span style={{ color: "#595959" }}>{s.spec_name}</span> : <span style={{ color: "#bbb" }}>—</span>) },
    { title: "评价", key: "score", width: 110, align: "right", sorter: (a, b) => (a.comments ?? 0) - (b.comments ?? 0), render: (_, r) => { if (r.comments == null && r.score == null) return <span style={{ color: "#bbb" }}>—</span>; return <span>{r.score != null ? <span style={{ color: "#fadb14" }}>★{r.score.toFixed(1)} </span> : null}{r.comments != null ? <span>{fmtNum(r.comments)} 评论</span> : ""}</span>; } },
    { title: "申报价", key: "declared_price", width: 90, align: "right", render: (_, r) => { const skus = skusOf(r); const prices = skus.map((s) => s.declared_price).filter((p): p is number => p != null); const min = prices.length ? Math.min(...prices) : null; return stackCell(skus, (s) => (s.declared_price == null ? "—" : "¥" + s.declared_price.toFixed(2)), min == null ? "—" : "¥" + min.toFixed(2)); } },
    { title: "今日销量", key: "today_sales", width: 90, align: "right", sorter: (a, b) => skusOf(a).reduce((x, s) => x + (s.today || 0), 0) - skusOf(b).reduce((x, s) => x + (s.today || 0), 0), defaultSortOrder: "descend", render: (_, r) => { const skus = skusOf(r); const sum = skus.reduce((a, s) => a + (s.today || 0), 0); return stackCell(skus, (s) => fmtNum(s.today), fmtNum(sum)); } },
    { title: "7天销量", key: "sales_7d", width: 95, align: "right", sorter: (a, b) => skusOf(a).reduce((x, s) => x + (s.last7d || 0), 0) - skusOf(b).reduce((x, s) => x + (s.last7d || 0), 0), render: (_, r) => { const skus = skusOf(r); const sum = skus.reduce((a, s) => a + (s.last7d || 0), 0); return stackCell(skus, (s) => fmtNum(s.last7d), fmtNum(sum)); } },
    { title: "30天销量", key: "sales_30d", width: 95, align: "right", sorter: (a, b) => skusOf(a).reduce((x, s) => x + (s.last30d || 0), 0) - skusOf(b).reduce((x, s) => x + (s.last30d || 0), 0), render: (_, r) => { const skus = skusOf(r); const sum = skus.reduce((a, s) => a + (s.last30d || 0), 0); return stackCell(skus, (s) => fmtNum(s.last30d), fmtNum(sum)); } },
    { title: "可用库存", key: "stock", width: 108, align: "right", sorter: (a, b) => skusOf(a).reduce((x, s) => x + (s.stock || 0), 0) - skusOf(b).reduce((x, s) => x + (s.stock || 0), 0), render: (_, r) => { const skus = skusOf(r); const sum = skus.reduce((a, s) => a + (s.stock || 0), 0); return stackCell(skus, (s) => <span style={{ color: (s.stock || 0) <= 0 ? "#cf1322" : undefined }}>{fmtNum(s.stock)}</span>, fmtNum(sum)); } },
    { title: "预占用库存", key: "occupy", width: 116, align: "right", sorter: (a, b) => skusOf(a).reduce((x, s) => x + (s.occupy || 0), 0) - skusOf(b).reduce((x, s) => x + (s.occupy || 0), 0), render: (_, r) => { const skus = skusOf(r); const sum = skus.reduce((a, s) => a + (s.occupy || 0), 0); return stackCell(skus, (s) => fmtNum(s.occupy), fmtNum(sum)); } },
    { title: "暂不可用库存", dataIndex: "unavail", width: 130, align: "right", sorter: (a, b) => (a.unavail ?? 0) - (b.unavail ?? 0), render: (v: number | null) => (v == null ? "—" : v > 0 ? <span style={{ color: "#d46b08" }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "缺货件数", key: "lack_qty", width: 110, align: "right", sorter: (a, b) => (a.lack_qty ?? 0) - (b.lack_qty ?? 0), render: (_, r) => { const skus = skusOf(r); const sum = skus.reduce((a, s) => a + (s.lack_qty || 0), 0); return stackCell(skus, (s) => ((s.lack_qty || 0) > 0 ? <span style={{ color: "#cf1322", fontWeight: 600 }}>{fmtNum(s.lack_qty || 0)}</span> : <span style={{ color: "#bbb" }}>0</span>), sum > 0 ? <span style={{ color: "#cf1322" }}>{fmtNum(sum)}</span> : fmtNum(sum)); } },
    { title: "在途库存", dataIndex: "shipping", width: 108, align: "right", sorter: (a, b) => (a.shipping ?? 0) - (b.shipping ?? 0), render: (v: number | null) => (v == null ? "—" : v > 0 ? <span style={{ color: "#1677ff" }}>{fmtNum(v)}</span> : <span style={{ color: "#bbb" }}>0</span>) },
    { title: "总库存", dataIndex: "total_stock", width: 104, align: "right", sorter: (a, b) => (a.total_stock ?? 0) - (b.total_stock ?? 0), render: (v: number | null) => (v == null ? "—" : <span style={{ fontWeight: 700, color: v <= 0 ? "#cf1322" : "#1a73e8" }}>{fmtNum(v)}</span>) },
    { title: "建议备货", key: "advice", width: 108, align: "right", sorter: (a, b) => adviceOf(a) - adviceOf(b), render: (_, r) => { const v = adviceOf(r); return v > 0 ? <Tag color="blue">{fmtNum(v)}</Tag> : <span style={{ color: "#bbb" }}>—</span>; } },
    { title: "可售天数", key: "sellthrough", width: 112, align: "right", sorter: (a, b) => { const x = sellThroughDays(a), y = sellThroughDays(b); return (x === Infinity ? 1e9 : x) - (y === Infinity ? 1e9 : y); }, render: (_, r) => { const d = sellThroughDays(r); if (d === 0) return <span style={{ color: "#bbb" }}>—</span>; const txt = d === Infinity ? "∞" : Math.round(d) + " 天"; return isSlowMoving(r) ? <Tag color="orange">{txt} · 滞销</Tag> : <span style={{ color: d > 14 ? "#d46b08" : "#595959" }}>{txt}</span>; } },
    { title: "可报活动", key: "act", width: 130, align: "right", sorter: (a, b) => a.act_cnt - b.act_cnt, render: (_, r) => (r.act_cnt > 0 ? <span style={{ color: "#3f8600" }}>{r.act_cnt}个{r.min_price != null ? ` / 低¥${r.min_price.toFixed(2)}` : ""}</span> : <span style={{ color: "#bbb" }}>—</span>) },
    { title: "合规", dataIndex: "compliance", width: 170, render: (v: string | null) => (v ? <Tag color="red" style={{ whiteSpace: "normal" }}>{v}</Tag> : <span style={{ color: "#3f8600" }}>正常</span>) },
    { title: "限流", dataIndex: "limited", width: 90, align: "center", sorter: (a, b) => (a.limited ? 1 : 0) - (b.limited ? 1 : 0), render: (v: boolean) => (v ? <Tag color="volcano">高价限流</Tag> : <span style={{ color: "#bbb" }}>—</span>) },
    { title: "曝光", dataIndex: "expose", width: 80, align: "right", sorter: (a, b) => (a.expose || 0) - (b.expose || 0), render: (v: number | null) => (v == null ? <span style={{ color: "#ccc" }}>无</span> : fmtNum(v)) },
    { title: "点击", dataIndex: "click", width: 70, align: "right", render: (v: number | null) => (v == null ? "—" : fmtNum(v)) },
    { title: "支付件", dataIndex: "pay", width: 75, align: "right", render: (v: number | null) => (v == null ? "—" : fmtNum(v)) },
    { title: "曝光转化", dataIndex: "conv", width: 90, align: "right", render: (v: number | null) => (v == null ? "—" : (v * 100).toFixed(2) + "%") },
  ];

  const hpfColumns: ColumnsType<HpfRow> = [
    { title: "店号", dataIndex: "store_code", width: 78, fixed: "left", render: (v, r) => formatStoreNo(v === r.mall_id ? null : v, r.mall_id) },
    { title: "店铺", dataIndex: "mall_name", width: 120, ellipsis: true, render: (v: string | null) => formatMallName(v) },
    { title: "商品", key: "prod", width: 360, render: (_, r) => (
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {r.thumb ? <div style={{ flexShrink: 0, width: 52, height: 52 }}><Image src={r.thumb} width={52} height={52} style={{ objectFit: "cover", borderRadius: 4 }} preview={{ mask: <EyeOutlined /> }} /></div> : <div style={{ width: 52, height: 52, borderRadius: 4, background: "#f0f0f0", flexShrink: 0 }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, lineHeight: 1.4, whiteSpace: "normal", wordBreak: "break-word" }}>{r.title || "—"}</div>
          <div style={{ marginTop: 3, fontSize: 12, color: "#8c8c8c", display: "flex", flexWrap: "wrap", gap: "0 10px" }}>
            <span>SPU <Typography.Text copyable={{ text: String(r.product_id) }} style={{ fontSize: 12, color: "#8c8c8c" }}>{r.product_id}</Typography.Text></span>
            {r.skc_id ? <span>SKC <Typography.Text copyable={{ text: String(r.skc_id) }} style={{ fontSize: 12, color: "#8c8c8c" }}>{r.skc_id}</Typography.Text></span> : null}
            <a onClick={(e) => { e.stopPropagation(); setTrendOf({ productId: String(r.product_id), title: r.title || String(r.product_id) }); }} style={{ fontSize: 11 }}>销量趋势</a>
          </div>
        </div>
      </div>
    ) },
    { title: "货号", dataIndex: "sku_codes", width: 140, ellipsis: true, render: (v: string | null) => v ? <span style={{ fontSize: 12 }}>{v}</span> : <span style={{ color: "#bbb" }}>—</span> },
    { title: "流量下降率", dataIndex: "decline_rate", width: 124, align: "right", defaultSortOrder: "descend", sorter: (a, b) => (a.decline_rate || 0) - (b.decline_rate || 0), render: (v: number | null) => v == null ? <span style={{ color: "#bbb" }}>—</span> : <Tag color={v >= 50 ? "red" : v >= 20 ? "orange" : "gold"} style={{ fontWeight: 600 }}>↓ {v.toFixed(1)}%</Tag> },
    { title: "建议调价(降价)", key: "advise_price", width: 168, align: "right", render: (_, r) => { const cur = r.current_price != null ? r.current_price : r.declared_price; if (r.target_price == null) return cur != null ? <span>¥{cur.toFixed(2)}</span> : <span style={{ color: "#bbb" }}>—</span>; const cut = cur && cur > 0 ? Math.round((1 - r.target_price / cur) * 100) : null; return <span style={{ fontSize: 12 }}>{cur != null ? <span style={{ color: "#888" }}>¥{cur.toFixed(2)} </span> : null}<span style={{ color: "#cf1322", fontWeight: 700 }}>→¥{r.target_price.toFixed(2)}</span>{cut != null ? <span style={{ color: "#cf1322" }}> -{cut}%</span> : null}</span>; } },
    { title: "可用库存", dataIndex: "stock", width: 100, align: "right", sorter: (a, b) => (a.stock || 0) - (b.stock || 0), render: (v: number | null) => v == null ? "—" : <span style={{ color: v <= 0 ? "#cf1322" : undefined }}>{fmtNum(v)}</span> },
    { title: "7天销量", dataIndex: "last7d_sales", width: 92, align: "right", sorter: (a, b) => (a.last7d_sales || 0) - (b.last7d_sales || 0), render: (v: number | null) => v == null ? "—" : fmtNum(v) },
    { title: "最近限流日", dataIndex: "last_seen_date", width: 110, render: (v: string | null) => v || "—" },
  ];

  const commonFilters = (extra?: React.ReactNode) => (
    <div style={{ padding: "12px 16px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <Select size="small" style={{ width: 130 }} value={storeFilter} onChange={setStoreFilter} options={[{ value: "all", label: "全部店铺" }, ...storeOptions.map((c) => ({ value: c, label: c }))]} />
      {extra}
      <Input.Search size="small" allowClear placeholder="搜货号 / 标题" style={{ width: 220 }} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
    </div>
  );

  const qcView = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return qcRows.filter((r) => {
      if (!inScope(r.store_code || r.mall_id)) return false;
      if (storeFilter !== "all" && r.store_code !== storeFilter) return false;
      if (!kw) return true;
      return [r.sku_name, r.ext_code, r.purchase_no, r.cat_name, r.flaw_summary, r.store_code, r.receipt_no].some((x) => String(x || "").toLowerCase().includes(kw));
    });
  }, [qcRows, search, storeFilter, inScope]);

  const [qualitySiteFilter, setQualitySiteFilter] = useSessionState(owViewKey("qualitySite"), "all");
  const qualityView = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return qualityRows.filter((r) => {
      if (!inScope(r.store_code || r.mall_id)) return false;
      if (storeFilter !== "all" && r.store_code !== storeFilter) return false;
      if (qualitySiteFilter !== "all" && r.site !== qualitySiteFilter) return false;
      if (!kw) return true;
      return [r.product_name, r.product_id, r.goods_id, r.category_name, r.afs_problems, r.rev_problems, r.store_code].some((x) => String(x || "").toLowerCase().includes(kw));
    });
  }, [qualityRows, search, storeFilter, qualitySiteFilter, inScope]);

  const qualityShopsView = useMemo(() => qualityShops.filter((s) => inScope(s.store_code || s.mall_id)), [qualityShops, inScope]);

  const hpfView = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return hpfRows.filter((r) => {
      if (!inScope(r.store_code || r.mall_id)) return false;
      if (storeFilter !== "all" && r.store_code !== storeFilter) return false;
      if (!kw) return true;
      return [r.title, r.product_id, r.skc_id, r.sku_codes, r.store_code].some((x) => String(x || "").toLowerCase().includes(kw));
    }).map((r, i) => ({ ...r, __rk: i }));
  }, [hpfRows, search, storeFilter, inScope]);
  const hpfAgg = useMemo(() => {
    let sum = 0, cnt = 0, severe = 0; const shops = new Set<string>();
    for (const r of hpfView) {
      if (r.decline_rate != null) { sum += r.decline_rate; cnt += 1; if (r.decline_rate >= 50) severe += 1; }
      shops.add(r.store_code || r.mall_id);
    }
    return { total: hpfView.length, avg: cnt ? Number((sum / cnt).toFixed(1)) : null, severe, shops: shops.size };
  }, [hpfView]);

  const reviewView = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return reviewRows.filter((r) => {
      if (!inScope(r.store_code || r.mall_id)) return false;
      if (storeFilter !== "all" && r.store_code !== storeFilter) return false;
      if (scoreFilter === "bad" && !(r.score != null && r.score <= 3)) return false;
      if (scoreFilter === "good" && !(r.score != null && r.score >= 4)) return false;
      if (scoreFilter === "pic" && !(r.pictures && r.pictures.length)) return false;
      if (regionFilter !== "all" && r.site !== regionFilter) return false;
      if (!kw) return true;
      return [r.goods_name, r.comment, r.spec_summary, r.category_path, r.store_code].some((x) => String(x || "").toLowerCase().includes(kw));
    });
  }, [reviewRows, search, storeFilter, scoreFilter, regionFilter, inScope]);

  const reviewAgg = useMemo(() => {
    let sum = 0, scored = 0, bad = 0, pic = 0;
    for (const r of reviewView) {
      if (r.score != null) { sum += r.score; scored += 1; if (r.score <= 3) bad += 1; }
      if (r.pictures && r.pictures.length) pic += 1;
    }
    return { total: reviewView.length, avg: scored ? Number((sum / scored).toFixed(2)) : null, bad, pic };
  }, [reviewView]);

  const tabItems = [
    {
      key: "overview", label: "总览",
      children: (
        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            <Card size="small"><Statistic title="今日销量(全店)" value={shopAgg.sales} /></Card>
            <Card size="small"><Statistic title="缺货 SKC" value={shopAgg.lack} valueStyle={{ color: shopAgg.lack > 0 ? "#d46b08" : undefined }} /></Card>
            <Card size="small"><Statistic title="已售罄" value={shopAgg.soldout} valueStyle={{ color: shopAgg.soldout > 0 ? "#cf1322" : undefined }} /></Card>
            {!HIDE_RISK && <Card size="small" hoverable onClick={() => setActiveTab("risk")}><Statistic title="高风险待办" value={riskOverview.high} valueStyle={{ color: riskOverview.high > 0 ? "#cf1322" : undefined }} /></Card>}
            {!HIDE_DIAG && <Card size="small" hoverable onClick={() => goProduct("diag")}><Statistic title="诊断 · 急" value={overview.urgent} valueStyle={{ color: overview.urgent > 0 ? "#cf1322" : undefined }} /></Card>}
            {!HIDE_RESTOCK && <Card size="small" hoverable onClick={() => goProduct("restock")}><Statistic title="急需补货 SKU" value={restockView.length} valueStyle={{ color: restockView.length > 0 ? "#d46b08" : undefined }} /></Card>}
            {!HIDE_STOCK && <Card size="small" hoverable onClick={() => setActiveTab("stock")}><Statistic title="备货缺口单" value={stockLoaded ? stockView.length : "查看"} valueStyle={!stockLoaded ? { fontSize: 16, color: "#1677ff" } : undefined} /></Card>}
            {!HIDE_ACTIVITY && <Card size="small" hoverable onClick={() => setActiveTab("activity")}><Statistic title="可报活动" value={actView.length} valueStyle={{ color: "#3f8600" }} /></Card>}
          </div>
          <Card size="small" title="各店概览 · 点店看明细,问题多的店排前;后段列为各店上新生命周期阶段(SKC)" style={{ marginBottom: 16 }} loading={shopLoading || riskLoading || skuLoading || lifecycleLoading}>
            <Table<StoreMatrixRow> dataSource={storeMatrix} rowKey="store_code" size="small"
              pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 店` }}
              scroll={{ x: 1740 }}
              columns={storeMatrixColumns.filter((c) => !(HIDE_RISK && (c as { dataIndex?: string }).dataIndex === "high_risk") && !(HIDE_ACTIVITY && (c as { dataIndex?: string }).dataIndex === "activity"))}
              onRow={(r) => ({ onClick: () => navigate(`/ops-workbench/store/${r.mall_id}`), style: { cursor: "pointer" } })} />
          </Card>
          {!OFFICIAL_SOURCE && (<Card size="small" title="全店销量趋势 · 近 30 天" style={{ marginBottom: 16 }} loading={trendLoading}>
            <div style={{ height: 200 }}>
              {overviewTrend.length === 0 ? <Empty description="暂无趋势数据" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={overviewTrend} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <RTooltip />
                    <Line type="monotone" dataKey="sales" name="全店销量" stroke="#1a73e8" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>)}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {!HIDE_RISK && (<Card size="small" title="高风险待办" extra={<a onClick={() => setActiveTab("risk")}>全部</a>} loading={riskLoading}>
              {riskView.filter((r) => r.severity === "high").slice(0, 6).map((r) => (
                <div key={r.__rk} style={{ padding: "4px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <Tag color="red">{r.store_code || r.mall_id}</Tag>{r.title || r.risk_type || "—"}
                </div>
              ))}
              {riskView.filter((r) => r.severity === "high").length === 0 && <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>无高风险</div>}
            </Card>)}
            {!HIDE_RESTOCK && (<Card size="small" title="急需补货" extra={<a onClick={() => goProduct("restock")}>全部</a>} loading={skuLoading}>
              {restockView.slice(0, 6).map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Tag color="orange">{r.store_code || r.mall_id}</Tag>{r.title || r.sku_ext_code || "—"}</span>
                  <span style={{ color: "#d46b08", whiteSpace: "nowrap" }}>{(r.stock || 0) <= 0 ? "已断货" : `可售${r.sale_days ?? "?"}天`}</span>
                </div>
              ))}
              {restockView.length === 0 && <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>无需补货</div>}
            </Card>)}
            {!HIDE_STOCK && (<Card size="small" title="紧急备货在途" extra={<a onClick={() => setActiveTab("stock")}>全部</a>} loading={stockLoading}>
              {stockView.slice(0, 6).map((r) => (
                <div key={r.__rk} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Tag>{r.store_code || r.mall_id}</Tag>{r.product_name || r.sku_ext_code || "—"}</span>
                  <span style={{ color: "#cf1322", whiteSpace: "nowrap" }}>缺{r.gap}</span>
                </div>
              ))}
              {stockView.length === 0 && <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>无备货缺口</div>}
            </Card>)}
          </div>
        </div>
      ),
    },
    {
      key: "pipeline", label: "商品全景",
      children: <PipelineTab reloadSignal={pipelineReloadSignal} isStoreInScope={isPipelineStoreInScope} onRiskTagClick={goPipelineRiskTag} />,
    },
    {
      key: "todo", label: "今日待办",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
            <Statistic title="待处理" value={todoCount.product + todoCount.code + todoCount.risk + todoCount.activity} valueStyle={{ color: "#d46b08" }} />
            <Statistic title="急" value={todoCount.urgent} valueStyle={{ color: todoCount.urgent > 0 ? "#cf1322" : undefined }} />
            <Statistic title="运营/补货" value={todoCount.product} valueStyle={{ color: todoCount.product > 0 ? "#d46b08" : undefined }} />
            <Statistic title="风险" value={todoCount.risk} valueStyle={{ color: todoCount.risk > 0 ? "#cf1322" : undefined }} />
            <Statistic title="已处理" value={todoCount.done} valueStyle={{ color: "#3f8600" }} />
          </div>
          <div style={{ padding: "8px 16px 0", color: "#888", fontSize: 12 }}>把「商品诊断 / 中高风险 / 可报活动」里要动手的事汇成一条清单,按紧急度降序;「完成 / 忽略」后从待处理列表消失(记在本机,可切「已处理 / 已忽略」回看或恢复)。顶部切「我的店」只看自己负责的店。</div>
          {commonFilters(
            <>
              <Select size="small" style={{ width: 120 }} value={todoStatus} onChange={setTodoStatus} options={[{ value: "open", label: "待处理" }, { value: "done", label: "已处理" }, { value: "ignored", label: "已忽略" }, { value: "all", label: "全部" }]} />
              <Select size="small" style={{ width: 130 }} value={todoType} onChange={setTodoType} options={[{ value: "all", label: "全部类型" }, { value: "product", label: "运营/补货" }, { value: "code", label: "缺货号" }, { value: "risk", label: "风险" }, { value: "activity", label: "活动" }]} />
            </>,
          )}
          <Table<TodoTask> dataSource={todoView} columns={todoColumns} rowKey={(t) => t.key} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 项` }} scroll={{ x: 1256 }} loading={skuLoading || riskLoading || actLoading} />
        </div>
      ),
    },
    {
      key: "store", label: "店铺",
      children: (
        <div>
          {!OFFICIAL_SOURCE && (
          <div style={{ padding: "12px 16px 0" }}>
            <Segmented value={storeSeg} onChange={(v) => setStoreSeg(v as string)} options={[{ label: "销量趋势", value: "trend" }, { label: "流量投放", value: "ad" }]} />
          </div>
          )}
          {storeSeg === "ad" ? (
            <div>
              <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
                <Statistic title="曝光合计" value={adAgg.impr} />
                <Statistic title="点击合计" value={adAgg.clk} />
                <Statistic title="花费合计(¥)" value={(adAgg.spend / 100).toFixed(2)} />
                <Statistic title="申报价销售额(¥)" value={(adAgg.amt / 100).toFixed(2)} />
                <Statistic title="子订单合计" value={adAgg.ord} />
              </div>
              <div style={{ padding: "8px 16px 0", color: "#888", fontSize: 12 }}>官方店铺维度广告/流量(近7天，bg.glo.searchrec.ad.reports.mall)。率为全店口径，金额单位元，ROAS=销售额/花费。空白店表示该店无投放或未签广告协议。</div>
              {commonFilters()}
              <Table<AdMallRow & { __rk: number; store_code: string | null }>
                dataSource={adView}
                rowKey={(r) => String(r.__rk)}
                size="small"
                loading={adLoading}
                scroll={{ x: 1100 }}
                pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }}
                columns={[
                  { title: "店号", dataIndex: "store_code", key: "store_code", fixed: "left", width: 88, render: (v: string | null, r) => formatStoreNo(v, r.mall_id) },
                  { title: "店铺", dataIndex: "store", key: "store", fixed: "left", width: 160, ellipsis: true, render: (v: string) => formatMallName(v, v) },
                  { title: "曝光", dataIndex: "imprCnt", key: "imprCnt", width: 90, align: "right", sorter: (a, b) => (a.imprCnt || 0) - (b.imprCnt || 0), render: (v) => v == null ? "—" : Number(v).toLocaleString("zh-CN") },
                  { title: "点击", dataIndex: "clkCnt", key: "clkCnt", width: 80, align: "right", sorter: (a, b) => (a.clkCnt || 0) - (b.clkCnt || 0), render: (v) => v == null ? "—" : Number(v).toLocaleString("zh-CN") },
                  { title: "点击率", dataIndex: "ctr", key: "ctr", width: 80, align: "right", render: (v) => v == null ? "—" : (v / 100).toFixed(2) + "%" },
                  { title: "加购", dataIndex: "cartCnt", key: "cartCnt", width: 80, align: "right", render: (v) => v == null ? "—" : Number(v).toLocaleString("zh-CN") },
                  { title: "转化率", dataIndex: "cvr", key: "cvr", width: 80, align: "right", render: (v) => v == null ? "—" : (v / 100).toFixed(2) + "%" },
                  { title: "子订单", dataIndex: "orderPayCnt", key: "orderPayCnt", width: 80, align: "right", render: (v) => v == null ? "—" : Number(v).toLocaleString("zh-CN") },
                  { title: "申报价销售额", dataIndex: "orderPayAmt", key: "orderPayAmt", width: 120, align: "right", sorter: (a, b) => (a.orderPayAmt || 0) - (b.orderPayAmt || 0), render: (v) => v == null ? "—" : "¥" + (v / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
                  { title: "花费", dataIndex: "spend", key: "spend", width: 100, align: "right", sorter: (a, b) => (a.spend || 0) - (b.spend || 0), render: (v) => v == null ? "—" : "¥" + (v / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
                  { title: "ROAS", dataIndex: "roas", key: "roas", width: 80, align: "right", sorter: (a, b) => (a.roas || 0) - (b.roas || 0), render: (v) => v == null ? "—" : (v / 1000).toFixed(2) },
                  { title: "费比", dataIndex: "acos", key: "acos", width: 80, align: "right", render: (v) => v == null ? "—" : (v / 100).toFixed(2) + "%" },
                ]}
              />
            </div>
          ) : (
            <div>
              <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>各店近 30 天每日销量走势(已排除预测值)。全部店时显示销量 Top 8;选具体店看单店曲线。</div>
              {commonFilters()}
              <div style={{ padding: "8px 16px 16px", height: 440 }}>
                {trendLoading ? (
                  <div style={{ textAlign: "center", color: "#999", paddingTop: 170 }}>加载中…</div>
                ) : trendChart.data.length === 0 ? (
                  <Empty description="暂无趋势数据" style={{ paddingTop: 140 }} />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendChart.data} margin={{ top: 10, right: 24, bottom: 4, left: -12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={20} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <RTooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {trendChart.stores.map((s, i) => (
                        <Line key={s} type="monotone" dataKey={s} name={s} stroke={TREND_COLORS[i % TREND_COLORS.length]} dot={false} strokeWidth={2} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      key: "product", label: "商品",
      children: (
        <div>
          {!(HIDE_DIAG && HIDE_RESTOCK) && (
          <div style={{ padding: "12px 16px 0" }}>
            <Segmented value={prodSeg} onChange={(v) => setProdSeg(v as string)} options={[{ label: "运营全景", value: "panel" }, ...(HIDE_DIAG ? [] : [{ label: "诊断待办", value: "diag" }]), ...(HIDE_RESTOCK ? [] : [{ label: "补货清单", value: "restock" }])]} />
          </div>
          )}
          {(prodSeg === "panel" || (HIDE_DIAG && HIDE_RESTOCK)) ? (
            <div>
              <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>每个商品(SPU)横向集成:可报活动 / 合规状态 / 流量(曝光·点击·转化) / 高价限流。按 限流 &gt; 违规 &gt; 活动 排序;流量「无」表示该商品暂未采到(采集覆盖待提升)。总库存 = 可用 + 暂不可用 − 缺货件数 + 在途库存。滞销 = 加入站点&gt;20天 且 可售天数(可用库存÷近7日均销)&gt;20天。</div>
              {commonFilters(
                <Select size="small" style={{ width: 150 }} value={slowFilter} onChange={setSlowFilter} options={[{ value: "all", label: "全部商品" }, { value: "slow", label: `仅看滞销 (${slowCount})` }]} />,
              )}
              <Table<ProductPanelRow> className="op-panel-table" dataSource={panelView} columns={panelColumns.filter((c) => { const k = String(c.key ?? ""); const di = String((c as { dataIndex?: string }).dataIndex ?? ""); if (HIDE_REVIEW && k === "score") return false; if (HIDE_ACTIVITY && k === "act") return false; if (OFFICIAL_SOURCE && (k === "declared_price" || ["limited", "compliance", "expose", "click", "pay", "conv"].includes(di))) return false; return true; })} rowKey={(r) => String(r.__rk)} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 个商品` }} scroll={{ x: 1560 }} loading={panelLoading} />
            </div>
          ) : prodSeg === "diag" ? (
            <div>
              <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
                <Statistic title="待诊断 SKU" value={overview.urgent + overview.warn + overview.note + overview.healthy} />
                <Statistic title="急" value={overview.urgent} valueStyle={{ color: overview.urgent > 0 ? "#cf1322" : undefined }} />
                <Statistic title="警" value={overview.warn} valueStyle={{ color: overview.warn > 0 ? "#d46b08" : undefined }} />
                <Statistic title="注意" value={overview.note} valueStyle={{ color: overview.note > 0 ? "#d4b106" : undefined }} />
                <Statistic title="健康" value={overview.healthy} valueStyle={{ color: "#3f8600" }} />
              </div>
              {commonFilters(
                <Select size="small" style={{ width: 140 }} value={diagFilter} onChange={setDiagFilter} options={[{ value: "all", label: "全部" }, { value: "issues", label: "仅有问题" }, { value: "urgent", label: "急" }, { value: "warn", label: "警" }, { value: "note", label: "注意" }, { value: "缺货号", label: "缺货号" }]} />,
              )}
              <Table<DiagnosedRow> dataSource={diagView} columns={diagColumns} rowKey={(r) => `${r.mall_id}|${r.skc_id}|${r.sku_ext_code}`} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1120 }} loading={skuLoading} />
            </div>
          ) : (
            <div>
              <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>需补货 SKU（已售罄 / 可售&lt;14天 / 有建议备货量），按紧急度排序。</div>
              {commonFilters()}
              <Table<SkuRow> dataSource={restockView} columns={restockColumns} rowKey={(r) => `${r.mall_id}|${r.skc_id}|${r.sku_ext_code}`} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1080 }} loading={skuLoading} />
            </div>
          )}
        </div>
      ),
    },
    {
      key: "qc", label: "平台质检",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>Temu 平台仓质检结果(官方采集),默认只列<b>不合格</b>:疵点原因 + 次品数 + 关联采购单,用于跟进补合规标签 / 改进生产。数据每 3 小时刷新。</div>
          {commonFilters()}
          <Table<QcRow> dataSource={qcView} columns={qcColumns} rowKey={(r) => `${r.mall_id}|${r.qc_bill_id}`} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条不合格` }} scroll={{ x: 1300 }} loading={qcLoading} />
        </div>
      ),
    },
    {
      key: "quality", label: "商品品质",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>Temu 后台「商品品质看板」数据(扩展抓包):每个商品的<b>品质分</b>(0-100,越低越差) + 品质售后率 + 售后/差评问题分布,默认按品质分升序(最差排前)。⚠️被动抓包:仅覆盖在后台打开过品质看板的店,其余店暂无数据。</div>
          {qualityShopsView.length > 0 && (
            <div style={{ padding: "8px 16px 0", display: "flex", flexWrap: "wrap", gap: 8 }}>
              {qualityShopsView.map((s) => (
                <Tooltip key={s.mall_id} title={`近90天 · 均分 ${s.avg_score_90d != null ? s.avg_score_90d.toFixed(2) : "—"}${s.expect_loss ? " · 预计损失 " + s.expect_loss : ""}`}>
                  <Tag color="blue">{formatStoreNo(s.store_code === s.mall_id ? null : s.store_code, s.mall_id)} 售后率 {s.afs_rate_90d != null ? (s.afs_rate_90d * 100).toFixed(2) + "%" : "—"}</Tag>
                </Tooltip>
              ))}
            </div>
          )}
          {commonFilters(
            <Select size="small" style={{ width: 110 }} value={qualitySiteFilter} onChange={setQualitySiteFilter} options={[{ value: "all", label: "全部站点" }, { value: "cn", label: "全球" }, { value: "us", label: "美区" }, { value: "eu", label: "欧区" }]} />,
          )}
          <Table<QualityRow> dataSource={qualityView} columns={qualityColumns} rowKey={(r) => `${r.mall_id}|${r.site}|${r.product_id || r.goods_id}`} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 个商品` }} scroll={{ x: 1360 }} loading={qualityLoading} />
        </div>
      ),
    },
    {
      key: "hpf", label: "高价限流",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            <Statistic title="被限流商品(当前筛选)" value={hpfAgg.total} valueStyle={{ color: hpfAgg.total > 0 ? "#cf1322" : undefined }} />
            <Statistic title="平均流量降幅" value={hpfAgg.avg ?? "—"} suffix={hpfAgg.avg != null ? "%" : ""} valueStyle={{ color: "#d46b08" }} />
            <Statistic title="重度限流(降幅≥50%)" value={hpfAgg.severe} valueStyle={{ color: hpfAgg.severe > 0 ? "#cf1322" : undefined }} />
            <Statistic title="涉及店铺" value={hpfAgg.shops} />
          </div>
          <div style={{ padding: "8px 16px 0", color: "#888", fontSize: 12 }}>被 Temu「高价流量受限」的商品(申报价偏高→流量被压制)。数据来自<b>抓包</b>(运营逛 Temu 限流页时顺手采),覆盖取决于访问情况,只列<b>近 14 天</b>出现过的,按流量下降率降序。降价建议 / 目标价 Temu 未开放采集,暂不提供。</div>
          {commonFilters()}
          <Table<HpfRow> dataSource={hpfView} columns={hpfColumns} rowKey={(r) => String(r.__rk)} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 个被限流商品` }} scroll={{ x: 1100 }} loading={hpfLoading} />
        </div>
      ),
    },
    {
      key: "review", label: "评价",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            <Statistic title="评价数(当前筛选)" value={reviewAgg.total} />
            <Statistic title="平均分" value={reviewAgg.avg ?? "—"} valueStyle={{ color: reviewAgg.avg != null && reviewAgg.avg < 4 ? "#cf1322" : "#3f8600" }} suffix={reviewAgg.avg != null ? "★" : ""} />
            <Statistic title="差评 ≤3★" value={reviewAgg.bad} valueStyle={{ color: reviewAgg.bad > 0 ? "#cf1322" : undefined }} />
            <Statistic title="带图评价" value={reviewAgg.pic} />
          </div>
          <div style={{ padding: "8px 16px 0", color: "#888", fontSize: 12 }}>商品评价:运营在 Temu 后台翻看评价页时,扩展自动抓取累积(非官方 API,覆盖取决于访问情况)。默认全部评价按<b>时间倒序</b>,差评(≤3★)标红。<b>福利评价</b>是商家给返利换的好评,单独标注。</div>
          {commonFilters(
            <>
              <Select size="small" style={{ width: 120 }} value={regionFilter} onChange={setRegionFilter} options={[{ value: "all", label: "全部区域" }, { value: "agentseller", label: "全球" }, { value: "agentseller-us", label: "美区" }, { value: "agentseller-eu", label: "欧区" }]} />
              <Select size="small" style={{ width: 130 }} value={scoreFilter} onChange={setScoreFilter} options={[{ value: "all", label: "全部评分" }, { value: "bad", label: "差评 ≤3★" }, { value: "good", label: "好评 ≥4★" }, { value: "pic", label: "带图评价" }]} />
            </>,
          )}
          <Table<ReviewRow> dataSource={reviewView} columns={reviewColumns} rowKey={(r) => `${r.mall_id}|${r.review_id}`} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条评价` }} scroll={{ x: 1180 }} loading={reviewLoading} />
        </div>
      ),
    },
    {
      key: "stock", label: "备货在途",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>未完成的备货 / 发货单(需求量 &gt; 已发量),按最晚发货时间升序(越紧急越靠前);缺口 = 需求 − 已发。</div>
          {commonFilters()}
          <Table<StockOrderRow> dataSource={stockView} columns={stockColumns} rowKey={(r) => String(r.__rk)} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1050 }} loading={stockLoading} />
        </div>
      ),
    },
    {
      key: "risk", label: "风险待办",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            <Statistic title="风险总数" value={riskRows.length} />
            <Statistic title="高" value={riskOverview.high} valueStyle={{ color: riskOverview.high > 0 ? "#cf1322" : undefined }} />
            <Statistic title="中" value={riskOverview.medium} valueStyle={{ color: riskOverview.medium > 0 ? "#d46b08" : undefined }} />
            <Statistic title="低" value={riskOverview.low} valueStyle={{ color: "#d4b106" }} />
          </div>
          {commonFilters(
            <Select size="small" style={{ width: 110 }} value={sevFilter} onChange={setSevFilter} options={[{ value: "all", label: "全部严重度" }, { value: "high", label: "高" }, { value: "medium", label: "中" }, { value: "low", label: "低" }]} />,
          )}
          <Table<RiskRow> dataSource={riskView} columns={riskColumns} rowKey={(r) => String(r.__rk)} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 880 }} loading={riskLoading} />
        </div>
      ),
    },
    {
      key: "activity", label: "活动报名",
      children: (
        <div>
          <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>按<b>商品</b>看活动报名:每个商品能报几个活动、最优参考利润率、已报几个。点<b>「去报名」</b>弹窗逐个填价提交(单店worker)/下发多店任务(扩展)。</div>

          <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            <Statistic title="在售商品(我的店)" value={actSummary.onSale} />
            <Statistic title="有活动可报商品" value={actSummary.withAct} valueStyle={{ color: "#3f8600" }} />
            <Statistic title="可报活动机会" value={actSummary.opp} valueStyle={{ color: "#3f8600" }} />
            <Statistic title="已报活动" value={actSummary.enrolled} valueStyle={{ color: actSummary.enrolled > 0 ? "#3f8600" : "#bbb" }} />
          </div>
          {commonFilters(
            <>
              <Select size="small" style={{ width: 120 }} value={kindFilter} onChange={setKindFilter} options={[{ value: "all", label: "全部类型" }, { value: "activity", label: "活动" }, { value: "bidding", label: "竞价" }, { value: "coupon", label: "优惠券" }]} />
              <Select size="small" style={{ width: 130 }} value={actSkuOnly ? "sku" : "all"} onChange={(v) => setActSkuOnly(v === "sku")} options={[{ value: "sku", label: "仅有货号" }, { value: "all", label: "含活动表头" }]} />
            </>,
          )}
          <Table<ActProductRow> dataSource={actProductView} columns={actProductColumns} rowKey={(r) => r.key} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 个商品` }} scroll={{ x: 1000 }} loading={actLoading} />
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card
        title="运营工作台"
        extra={<div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>我的店</Typography.Text>
          <Select size="small" style={{ width: 140 }} value={ownerFilter} onChange={setOwner} options={[{ value: "all", label: "全部负责人" }, ...ownerOptions.map((o) => ({ value: o, label: o }))]} disabled={ownerOptions.length === 0} placeholder="负责人" />
          <Button icon={<ReloadOutlined />} loading={skuLoading || riskLoading || actLoading || shopLoading || trendLoading || adLoading || stockLoading || panelLoading} onClick={() => { loadSku(); setShopLoaded(false); setTrendLoaded(false); setAdLoaded(false); setStockLoaded(false); setRiskLoaded(false); setActLoaded(false); setPanelLoaded(false); setQcLoaded(false); setQualityLoaded(false); setReviewLoaded(false); loadShop(); if (activeTab === "store") { loadTrend(); loadAd(); } else if (activeTab === "stock") loadStockOrders(); else if (activeTab === "risk") loadRisk(); else if (activeTab === "activity") loadAct(); else if (activeTab === "product") loadPanel(); else if (activeTab === "qc") loadQc(); else if (activeTab === "quality") loadQuality(); else if (activeTab === "review") loadReviews(); else if (activeTab === "todo") { loadRisk(); loadAct(); } else if (activeTab === "overview") { loadTrend(); loadStockOrders(); loadRisk(); loadAct(); } else if (activeTab === "pipeline") setPipelineReloadSignal((n) => n + 1); message.success("已刷新"); }}>刷新</Button>
        </div>}
        bodyStyle={{ padding: 0 }}
      >
        {error && <Alert type="error" showIcon message="加载失败" description={error} style={{ margin: 16 }} action={<Button size="small" onClick={loadSku}>重试</Button>} />}
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems.filter((t) => !(HIDE_RISK && t.key === "risk") && !(HIDE_ACTIVITY && t.key === "activity") && !(HIDE_STOCK && t.key === "stock"))} tabBarStyle={{ paddingLeft: 16, marginBottom: 0 }} />
      </Card>
      <div style={{ display: "none" }}>
        <Image.PreviewGroup items={flawPreviewImages} preview={{ visible: flawPreviewVisible, onVisibleChange: (v) => setFlawPreviewVisible(v) }} />
      </div>
      <Modal open={!!enrollModalSku} onCancel={() => { setEnrollModalSku(null); setSelActRows([]); }} width={1180} destroyOnClose
        title={enrollModalSku ? `报名活动 · ${enrollModalSku.product_name || enrollModalSku.sku_ext_code}` : ""}
        footer={[
          <Button key="cancel" size="small" onClick={() => { setEnrollModalSku(null); setSelActRows([]); }}>取消</Button>,
          <Button key="ext" size="small" loading={enrollBusy} disabled={!selActRows.length} onClick={submitViaExtension}>下发多店任务 ({selActRows.length})</Button>,
          <Button key="submit" type="primary" size="small" loading={enrollBusy} disabled={!selActRows.length} onClick={submitEnroll}>提交报名 ({selActRows.length})</Button>,
        ]}>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>货号 {enrollModalSku?.sku_ext_code}。勾选要报的活动 →「建议申报价」默认=活动参考价可改(低于成本标红亏本)→ 提交报名(单店)/下发多店(扩展)。缺活动ID的报不了(需扩展采集)。</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <Button size="small" onClick={() => { const next = { ...enrollDraft }; for (const r of modalActRows) { const p = r.suggested_price ?? r.signup_price; if (p == null) continue; next[enrollKey(r)] = { ...(next[enrollKey(r)] || {}), price: p }; } persistDraft(next); }}>按参考价填全部</Button>
          <InputNumber size="small" min={0} step={0.1} precision={2} prefix="¥" placeholder="批量申报价" value={batchPrice ?? undefined} style={{ width: 120 }} onChange={(v) => setBatchPrice(v == null ? null : Number(v))} />
          <Button size="small" disabled={batchPrice == null} onClick={() => { const next = { ...enrollDraft }; for (const r of modalActRows) { next[enrollKey(r)] = { ...(next[enrollKey(r)] || {}), price: batchPrice! }; } persistDraft(next); }}>填全部</Button>
          <InputNumber size="small" min={0} precision={0} placeholder="批量库存" value={batchStock ?? undefined} style={{ width: 110 }} onChange={(v) => setBatchStock(v == null ? null : Number(v))} />
          <Button size="small" disabled={batchStock == null} onClick={() => { const next = { ...enrollDraft }; for (const r of modalActRows) { next[enrollKey(r)] = { ...(next[enrollKey(r)] || {}), stock: batchStock! }; } persistDraft(next); }}>填库存</Button>
        </div>
        <Table<ActivityRow> dataSource={modalActRows.filter((r) => r.activity_id)} columns={actColumns} rowKey={(r) => String(r.__rk)} size="small"
          rowSelection={{ selectedRowKeys: selActRows.map((r) => String(r.__rk)), onChange: (_, rows) => setSelActRows(rows as ActivityRow[]) }}
          pagination={false} scroll={{ x: 1240 }} locale={{ emptyText: "该商品暂无可报名的活动(缺活动ID,需扩展采集)" }} />
        {modalActRows.some((r) => !r.activity_id) && <div style={{ fontSize: 12, color: "#d46b08", marginTop: 8 }}>另有 {modalActRows.filter((r) => !r.activity_id).length} 个活动缺活动ID(扩展只采到列表、没采到可报名场次),暂时报不了——用扩展逛该店活动后台采集后才会出现在上面。</div>}
      </Modal>
      <Modal open={!!trendOf} onCancel={() => setTrendOf(null)} footer={null} width={680} title={trendOf ? `销量趋势 · ${trendOf.title}` : ""} destroyOnClose>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>逐日销量(抓包采集,覆盖近 2 周、部分店);SPU {trendOf?.productId}</div>
        {trendModalLoading ? <div style={{ textAlign: "center", padding: 80, color: "#999" }}>加载中…</div>
          : trendModalRows.length === 0 ? <Empty description="该商品暂无逐日数据(采集可能未覆盖其店铺)" style={{ padding: 40 }} />
          : <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendModalRows} margin={{ top: 10, right: 20, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={16} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <RTooltip />
                <Line type="monotone" dataKey="qty" name="销量" stroke="#1a73e8" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>}
      </Modal>
    </div>
  );
}
