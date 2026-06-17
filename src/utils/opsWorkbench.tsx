// 运营工作台共享 utils:原内联在 OperationsWorkbench.tsx 的「纯数据常量 + 纯逻辑函数」(零 JSX)。
// 批次5 阶段2 第1步抽出,供主文件 + 后续各 Tab 组件共用。仅搬运,逻辑与原文件逐字一致,不改语义。
import { Select } from "antd";
import type { SkuRow, Diag, TodoTask, ProductPanelRow, SkuChild } from "../types/opsWorkbench";

// 分页「每页条数」选择器:antd 5.25+ 默认带搜索框(聚焦冒出可编辑光标),这里强制关掉
export const NoSearchSelect = (props: Record<string, unknown>) => <Select {...props} showSearch={false} />;

// ===== (A) 纯数据常量 =====

// 站点标记 → 中文标签（cn=agentseller.temu.com 主站「全球」 / us=美区 / eu=欧区）
export const QUALITY_SITE_LABEL: Record<string, string> = { cn: "全球", us: "美区", eu: "欧区" };

// 待办「去处理」跳转目标:备货走应用内路由(/purchase-center 采购单),其余跳 Temu 卖家后台
// 后台深链路径取自 automation worker 实际用过的页;如需精确到违规/报名子页,改这里即可
export const SELLER_BASE = "https://agentseller.temu.com";
export const RESTOCK_LABELS = new Set(["已售罄", "即将断货", "建议补货", "售罄无销"]);

export const LEVEL_COLOR: Record<number, string> = { 3: "#cf1322", 2: "#d46b08", 1: "#d4b106", 0: "#3f8600" };
export const TAG_COLOR: Record<number, string> = { 3: "red", 2: "orange", 1: "gold", 0: "green" };

export const RISK_TYPE_LABEL: Record<string, string> = {
  high_price_flow: "高价限流", high_price: "高价限制", violation: "违规", appeal: "申诉",
  compliance: "合规风险", quality: "质量风险", punish: "处罚",
};
export const SEV_COLOR: Record<string, string> = { high: "red", medium: "orange", low: "gold" };
export const SEV_TEXT: Record<string, string> = { high: "高", medium: "中", low: "低" };
export const SEV_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
export const KIND_LABEL: Record<string, string> = { activity: "活动", bidding: "竞价", coupon: "优惠券" };
// 活动类型(activity_type)中文:用于报名弹窗区分同商品的多个活动
export const ACTIVITY_TYPE_LABEL: Record<number, string> = { 1: "限时秒杀", 5: "大促活动", 13: "官方大促", 14: "限时专属", 21: "超级秒杀", 27: "清仓甩卖", 101: "秒杀进阶", 127: "清仓进阶" };

export const TODO_TYPE_TAG: Record<string, { c: string; t: string }> = {
  product: { c: "orange", t: "运营" }, code: { c: "gold", t: "缺货号" }, risk: { c: "red", t: "风险" }, activity: { c: "green", t: "活动" },
};
export const TODO_LEVEL_TEXT: Record<number, string> = { 3: "急", 2: "警", 1: "注意" };

export const TREND_COLORS = ["#1a73e8", "#34a853", "#fbbc04", "#ea4335", "#a142f4", "#24c1e0", "#ff6d01", "#7c8597"];

// 建议备货自算（Temu 的 adviceQuantity 是黑盒）：
//   今日预估 = 今日销量 ×(早上<12点 ×2 / 下午12-18点 ×1.5 / 晚上≥18点 ×1.3)，把"截至现在"的今日销量预判成全天量
//   日均 = max(7天日均, 今日预估)；备货天数 = 日均>50 用 7 天、否则 10 天；建议备货 = max(0, 日均 × 天数 − 总库存)
export const RESTOCK_FAST_QTY = 50;     // 日均超过此值算畅销
export const RESTOCK_DAYS_NORMAL = 10;  // 普通品备货天数
export const RESTOCK_DAYS_FAST = 7;     // 畅销品备货天数

// 滞销判定(商品运营全景):加入站点 > 20 天,且按近 7 日均销现有可用库存还能卖 > 20 天。
//   可售天数 = 可用库存 ÷ (近7日销量 ÷ 7);无可用库存→0(没货可滞);有货但近7日0销量→∞(永远卖不动)。
//   口径与「建议备货」一致——SPU 聚合所有 SKU 的可用库存与近7日销量。
export const SLOW_MOVING_DAYS = 20;          // 可售天数阈值
export const SLOW_MOVING_ONLINE_DAYS = 20;   // 加入站点天数阈值

// ===== (B) 纯逻辑函数(零 JSX) =====

export function processTarget(t: TodoTask): { route?: string; ext?: string; label: string } {
  if (t.type === "code") return { ext: `${SELLER_BASE}/goods/list`, label: "去后台补货号" };
  if (t.type === "risk") return { ext: `${SELLER_BASE}/main/data-center`, label: "去后台处理" };
  if (t.type === "activity") return { ext: `${SELLER_BASE}/main/activity-analysis`, label: "去活动中心" };
  // product:补货类去开采购单,动销类(零动销/停销/下滑)去后台救量
  if (RESTOCK_LABELS.has(t.typeLabel)) return { route: "/purchase-center", label: "去开采购单" };
  return { ext: `${SELLER_BASE}/main/activity-analysis`, label: "去活动救量" };
}

export function diagnose(r: SkuRow): Diag[] {
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

export const fmtNum = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("zh-CN"));
export const fmtMoney = (n: number | null | undefined) => (n == null ? "—" : "¥" + n.toFixed(2));
// 评价时间戳：Temu 给的可能是秒或毫秒，统一判断后格式化为「YYYY-MM-DD HH:mm」
export const fmtReviewTime = (ts: number | null | undefined) => {
  if (ts == null) return "—";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const calcAdvice = (today: number, last7d: number, totalStock: number, hour: number) => {
  const daily = Math.max((last7d || 0) / 7, (today || 0) * (hour < 12 ? 2 : hour < 18 ? 1.5 : 1.3));
  const days = daily > RESTOCK_FAST_QTY ? RESTOCK_DAYS_FAST : RESTOCK_DAYS_NORMAL;
  return Math.max(0, Math.ceil(daily * days - (totalStock || 0)));
};

export const sellThroughDays = (r: ProductPanelRow): number => {
  const skus: SkuChild[] = r.skus_detail || [];
  const stock = skus.reduce((a, s) => a + (s.stock || 0), 0);
  if (stock <= 0) return 0;
  const daily = skus.reduce((a, s) => a + (s.last7d || 0), 0) / 7;
  if (daily <= 0) return Infinity;
  return stock / daily;
};
export const isSlowMoving = (r: ProductPanelRow): boolean =>
  (r.onsales_duration ?? 0) > SLOW_MOVING_ONLINE_DAYS && sellThroughDays(r) > SLOW_MOVING_DAYS;
