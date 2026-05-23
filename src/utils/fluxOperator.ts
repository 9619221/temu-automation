/**
 * 流量分析运营助手 - 核心分析器
 *
 * 输入：temu_flux_product_history_cache（按 goodsId × site × daily[] 组织）
 * 输出：诊断行、决策标签、跨站机会、价格弹性候选、告警等
 *
 * 字段说明（每天）：
 *  exposeNum 曝光  clickNum 点击  searchExposeNum 搜索曝光  recommendExposeNum 推荐曝光
 *  detailVisitNum 详情访问  detailVisitorNum 详情访客  addToCartUserNum 加购人数
 *  payGoodsNum 支付件数  payOrderNum 订单数  buyerNum 买家数
 *  exposePayConversionRate 曝光支付率  exposeClickConversionRate 曝光点击率(CTR)
 *  clickPayConversionRate 点击支付率
 */

export type SiteName = "全球" | "美国" | "欧区";
export type RegionKey = "global" | "us" | "eu";

export const REGION_TO_SITE: Record<RegionKey, SiteName> = {
  global: "全球",
  us: "美国",
  eu: "欧区",
};

export const SITE_TO_REGION: Record<SiteName, RegionKey> = {
  "全球": "global",
  "美国": "us",
  "欧区": "eu",
};

export interface DailyPoint {
  date: string;
  exposeNum?: number;
  clickNum?: number;
  searchExposeNum?: number;
  recommendExposeNum?: number;
  detailVisitNum?: number;
  detailVisitorNum?: number;
  addToCartUserNum?: number;
  collectUserNum?: number;
  payGoodsNum?: number;
  payOrderNum?: number;
  buyerNum?: number;
  exposePayConversionRate?: number;
  exposeClickConversionRate?: number;
  clickPayConversionRate?: number;
}

export interface ProductCacheEntry {
  goodsId?: string | number;
  productId?: string | number;
  productSkcId?: string | number;
  productSkuId?: string | number;
  title?: string;
  stations?: Record<string, { daily?: DailyPoint[]; cachedAt?: string }>;
}

export type Bottleneck =
  | "曝光不足"
  | "点击率低"
  | "加购率低"
  | "支付转化低"
  | "全链路健康"
  | "数据缺失";

export type Decision = "加仓" | "优化" | "维持" | "减仓" | "清退" | "观察";

export interface DiagnosisRow {
  goodsId: string;
  title: string;
  site: SiteName;
  region: RegionKey;
  days: number;
  // 累计指标
  expose: number;
  click: number;
  detailVisit: number;
  addCart: number;
  buyer: number;
  payGoods: number;
  searchExpose: number;
  recommendExpose: number;
  // 漏斗（百分比 0-100）
  ctr: number; // 点击率
  visitToCartRate: number; // 详情→加购
  cartToBuyRate: number; // 加购→买家
  clickPayRate: number; // 点击支付率
  exposePayRate: number; // 曝光支付率（万分比直观看百分比）
  // 来源
  searchPct: number;
  recommendPct: number;
  // 趋势（最近 3 天 vs 之前 3 天的环比，% 变化）
  exposeSlope: number;
  clickPaySlope: number;
  // 标签
  bottleneck: Bottleneck;
  decision: Decision;
  decisionReason: string;
  daily: DailyPoint[];
}

export interface SiteBenchmark {
  site: SiteName;
  region: RegionKey;
  ctrMedian: number;
  clickPayMedian: number;
  cartToBuyMedian: number;
  exposeMedian: number;
}

export interface CrossSiteOpportunity {
  goodsId: string;
  title: string;
  winnerSite: SiteName;
  winnerCpc: number;
  loserSite: SiteName;
  loserCpc: number;
  cpcGap: number; // 百分点差
  hint: string;
}

export interface PriceElasticityCandidate {
  goodsId: string;
  title: string;
  site: SiteName;
  region: RegionKey;
  clickPayRate: number;
  median: number;
  click: number;
  hint: string;
}

export interface OperatorAlert {
  level: "danger" | "warning" | "info";
  goodsId?: string;
  title?: string;
  site?: SiteName;
  text: string;
}

export interface SourceMixSlice {
  site: SiteName;
  search: number;
  recommend: number;
  other: number;
}

export interface OperatorReport {
  rows: DiagnosisRow[];
  benchmarks: Record<SiteName, SiteBenchmark | null>;
  crossSite: CrossSiteOpportunity[];
  priceCandidates: PriceElasticityCandidate[];
  alerts: OperatorAlert[];
  sourceMix: SourceMixSlice[];
  decisionCounts: Record<Decision, number>;
  generatedAt: string;
}

// ---------- 工具 ----------

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const pct = (a: number, b: number): number => (b > 0 ? (a / b) * 100 : 0);

const median = (arr: number[]): number => {
  const xs = arr.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
};

const sum = (arr: number[]): number => arr.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);

// 最近 3 天 vs 之前 3 天 的环比 % 变化
const recentSlopePct = (values: number[]): number => {
  if (values.length < 4) return 0;
  const n = values.length;
  const recentLen = Math.min(3, Math.floor(n / 2));
  const recent = values.slice(n - recentLen);
  const prev = values.slice(Math.max(0, n - recentLen * 2), n - recentLen);
  const a = sum(recent) / recent.length;
  const b = sum(prev) / Math.max(prev.length, 1);
  if (b <= 0) return a > 0 ? 100 : 0;
  return ((a - b) / b) * 100;
};

// ---------- 主分析 ----------

export function buildOperatorReport(
  cache: Record<string, ProductCacheEntry> | null | undefined,
): OperatorReport {
  const rows: DiagnosisRow[] = [];
  const sourceAccum: Record<SiteName, { s: number; r: number; o: number }> = {
    "全球": { s: 0, r: 0, o: 0 },
    "美国": { s: 0, r: 0, o: 0 },
    "欧区": { s: 0, r: 0, o: 0 },
  };

  if (!cache || typeof cache !== "object") {
    return emptyReport();
  }

  for (const [gid, entry] of Object.entries(cache)) {
    if (!entry?.stations) continue;
    const goodsId = String(entry.goodsId ?? gid);
    const title = String(entry.title ?? "").trim() || `商品 ${goodsId}`;
    for (const [siteRaw, sdata] of Object.entries(entry.stations)) {
      const site = siteRaw as SiteName;
      if (site !== "全球" && site !== "美国" && site !== "欧区") continue;
      const daily = Array.isArray(sdata?.daily) ? sdata!.daily!.filter(Boolean) : [];
      if (!daily.length) continue;

      const expose = sum(daily.map((d) => num(d.exposeNum)));
      const click = sum(daily.map((d) => num(d.clickNum)));
      const detailVisit = sum(daily.map((d) => num(d.detailVisitNum ?? d.detailVisitorNum)));
      const addCart = sum(daily.map((d) => num(d.addToCartUserNum)));
      const buyer = sum(daily.map((d) => num(d.buyerNum)));
      const payGoods = sum(daily.map((d) => num(d.payGoodsNum)));
      const searchExp = sum(daily.map((d) => num(d.searchExposeNum)));
      const recExp = sum(daily.map((d) => num(d.recommendExposeNum)));
      const otherExp = Math.max(0, expose - searchExp - recExp);

      sourceAccum[site].s += searchExp;
      sourceAccum[site].r += recExp;
      sourceAccum[site].o += otherExp;

      const ctr = pct(click, expose);
      const visitToCart = pct(addCart, detailVisit);
      const cartToBuy = pct(buyer, addCart);
      const clickPay = pct(buyer, click);
      const exposePay = pct(buyer, expose);
      const searchPct = pct(searchExp, expose);
      const recommendPct = pct(recExp, expose);

      const exposeSlope = recentSlopePct(daily.map((d) => num(d.exposeNum)));
      const clickPaySlope = recentSlopePct(
        daily.map((d) => {
          const c = num(d.clickNum);
          const b = num(d.buyerNum);
          return c > 0 ? (b / c) * 100 : 0;
        }),
      );

      rows.push({
        goodsId,
        title,
        site,
        region: SITE_TO_REGION[site],
        days: daily.length,
        expose, click, detailVisit, addCart, buyer, payGoods,
        searchExpose: searchExp, recommendExpose: recExp,
        ctr, visitToCartRate: visitToCart, cartToBuyRate: cartToBuy,
        clickPayRate: clickPay, exposePayRate: exposePay,
        searchPct, recommendPct,
        exposeSlope, clickPaySlope,
        bottleneck: "全链路健康",
        decision: "维持",
        decisionReason: "",
        daily,
      });
    }
  }

  // ---------- 站点基准（中位数） ----------
  const benchmarks: Record<SiteName, SiteBenchmark | null> = {
    "全球": null, "美国": null, "欧区": null,
  };
  (Object.keys(benchmarks) as SiteName[]).forEach((s) => {
    const sub = rows.filter((r) => r.site === s && r.expose > 0);
    if (!sub.length) return;
    benchmarks[s] = {
      site: s,
      region: SITE_TO_REGION[s],
      ctrMedian: median(sub.map((r) => r.ctr)),
      clickPayMedian: median(sub.map((r) => r.clickPayRate)),
      cartToBuyMedian: median(sub.map((r) => r.cartToBuyRate)),
      exposeMedian: median(sub.map((r) => r.expose)),
    };
  });

  // ---------- 打瓶颈 + 决策标签 ----------
  for (const r of rows) {
    const bm = benchmarks[r.site];
    r.bottleneck = labelBottleneck(r, bm);
    const d = labelDecision(r, bm);
    r.decision = d.decision;
    r.decisionReason = d.reason;
  }

  // ---------- 跨站可复制 ----------
  const crossSite: CrossSiteOpportunity[] = [];
  const byGid = new Map<string, DiagnosisRow[]>();
  for (const r of rows) {
    if (!byGid.has(r.goodsId)) byGid.set(r.goodsId, []);
    byGid.get(r.goodsId)!.push(r);
  }
  for (const [, group] of byGid) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => b.clickPayRate - a.clickPayRate);
    const winner = sorted[0];
    const loser = sorted[sorted.length - 1];
    if (winner.clickPayRate <= 0 || winner.click < 30) continue;
    const gap = winner.clickPayRate - loser.clickPayRate;
    if (gap < 3) continue;
    crossSite.push({
      goodsId: winner.goodsId,
      title: winner.title,
      winnerSite: winner.site,
      winnerCpc: winner.clickPayRate,
      loserSite: loser.site,
      loserCpc: loser.clickPayRate,
      cpcGap: gap,
      hint: `${winner.site} 点击支付率 ${winner.clickPayRate.toFixed(1)}%，${loser.site} 仅 ${loser.clickPayRate.toFixed(1)}%，可平移 ${winner.site} 的标题/主图/定价策略`,
    });
  }
  crossSite.sort((a, b) => b.cpcGap - a.cpcGap);

  // ---------- 价格弹性候选 ----------
  const priceCandidates: PriceElasticityCandidate[] = [];
  for (const r of rows) {
    const bm = benchmarks[r.site];
    if (!bm || bm.clickPayMedian <= 0) continue;
    if (r.click < 30) continue;
    if (r.clickPayRate < bm.clickPayMedian * 0.5) {
      priceCandidates.push({
        goodsId: r.goodsId,
        title: r.title,
        site: r.site,
        region: r.region,
        clickPayRate: r.clickPayRate,
        median: bm.clickPayMedian,
        click: r.click,
        hint: `点击支付率 ${r.clickPayRate.toFixed(1)}%，仅为站点中位数 ${bm.clickPayMedian.toFixed(1)}% 的 ${((r.clickPayRate / bm.clickPayMedian) * 100).toFixed(0)}%。建议先降价 5% 跑 3 天测试`,
      });
    }
  }
  priceCandidates.sort((a, b) => b.click - a.click);

  // ---------- 告警 ----------
  const alerts: OperatorAlert[] = [];
  for (const r of rows) {
    if (r.expose >= 1000 && r.exposeSlope <= -30) {
      alerts.push({
        level: "warning",
        goodsId: r.goodsId,
        title: r.title,
        site: r.site,
        text: `曝光环比下滑 ${Math.abs(r.exposeSlope).toFixed(0)}%（${r.site}）`,
      });
    }
    if (r.click >= 50 && r.clickPaySlope <= -50) {
      alerts.push({
        level: "danger",
        goodsId: r.goodsId,
        title: r.title,
        site: r.site,
        text: `点击支付率断崖：环比 -${Math.abs(r.clickPaySlope).toFixed(0)}%（${r.site}）`,
      });
    }
    if (r.expose >= 5000 && r.click === 0) {
      alerts.push({
        level: "danger",
        goodsId: r.goodsId,
        title: r.title,
        site: r.site,
        text: `${r.site} 高曝光零点击：曝光 ${r.expose} / 点击 0`,
      });
    }
  }
  alerts.sort((a, b) => severityRank(a.level) - severityRank(b.level));

  // ---------- 来源占比 ----------
  const sourceMix: SourceMixSlice[] = (Object.keys(sourceAccum) as SiteName[]).map((s) => {
    const t = sourceAccum[s];
    const total = t.s + t.r + t.o;
    return {
      site: s,
      search: total > 0 ? (t.s / total) * 100 : 0,
      recommend: total > 0 ? (t.r / total) * 100 : 0,
      other: total > 0 ? (t.o / total) * 100 : 0,
    };
  });

  // ---------- 决策汇总 ----------
  const decisionCounts: Record<Decision, number> = {
    加仓: 0, 优化: 0, 维持: 0, 减仓: 0, 清退: 0, 观察: 0,
  };
  for (const r of rows) decisionCounts[r.decision]++;

  return {
    rows, benchmarks, crossSite, priceCandidates, alerts, sourceMix, decisionCounts,
    generatedAt: new Date().toISOString(),
  };
}

function severityRank(level: OperatorAlert["level"]): number {
  return level === "danger" ? 0 : level === "warning" ? 1 : 2;
}

function labelBottleneck(r: DiagnosisRow, bm: SiteBenchmark | null): Bottleneck {
  if (r.expose === 0) return "数据缺失";
  if (bm && r.expose < bm.exposeMedian * 0.3) return "曝光不足";
  if (bm && r.ctr < Math.max(0.5, bm.ctrMedian * 0.6) && r.expose >= 500) return "点击率低";
  if (r.detailVisit > 0 && r.visitToCartRate < 5 && r.click >= 30) return "加购率低";
  if (bm && r.clickPayRate < bm.clickPayMedian * 0.6 && r.click >= 30) return "支付转化低";
  return "全链路健康";
}

function labelDecision(r: DiagnosisRow, bm: SiteBenchmark | null): { decision: Decision; reason: string } {
  // 数据太少 → 观察
  if (r.expose < 200 || r.days < 4) {
    return { decision: "观察", reason: "样本不足，继续观察" };
  }
  const healthy = r.bottleneck === "全链路健康";
  // 加仓：曝光在涨 + 健康
  if (healthy && r.exposeSlope > 15 && r.clickPayRate > 0) {
    return { decision: "加仓", reason: `曝光环比 +${r.exposeSlope.toFixed(0)}%，承接健康，可加广告/备货` };
  }
  // 减仓：曝光在跌且支付转化也跌
  if (r.exposeSlope < -25 && r.clickPaySlope < -20) {
    return { decision: "减仓", reason: `曝光与支付率双降（曝光 ${r.exposeSlope.toFixed(0)}% / 支付率 ${r.clickPaySlope.toFixed(0)}%）` };
  }
  // 清退：高曝光极低转化（撑了一段时间还没起来）
  if (r.expose > 5000 && r.buyer === 0) {
    return { decision: "清退", reason: `曝光 ${r.expose} 但 0 买家，长期无承接` };
  }
  // 优化：有明显瓶颈
  if (r.bottleneck !== "全链路健康" && r.bottleneck !== "数据缺失") {
    const map: Record<string, string> = {
      "曝光不足": "曝光低于站点 30 分位，需补属性/参加活动/做搜索词优化",
      "点击率低": `CTR ${r.ctr.toFixed(2)}%${bm ? `（站点中位 ${bm.ctrMedian.toFixed(2)}%）` : ""}，优先换主图/降价测试`,
      "加购率低": `详情→加购仅 ${r.visitToCartRate.toFixed(1)}%，优化详情页/卖点/SKU`,
      "支付转化低": `点击支付率 ${r.clickPayRate.toFixed(1)}%${bm ? `（站点中位 ${bm.clickPayMedian.toFixed(1)}%）` : ""}，检查价格/物流/评论`,
    };
    return { decision: "优化", reason: map[r.bottleneck] || "存在瓶颈，需优化" };
  }
  return { decision: "维持", reason: "全链路指标正常，保持现有节奏" };
}

function emptyReport(): OperatorReport {
  return {
    rows: [],
    benchmarks: { "全球": null, "美国": null, "欧区": null },
    crossSite: [],
    priceCandidates: [],
    alerts: [],
    sourceMix: [],
    decisionCounts: { 加仓: 0, 优化: 0, 维持: 0, 减仓: 0, 清退: 0, 观察: 0 },
    generatedAt: new Date().toISOString(),
  };
}

export const DECISION_COLOR: Record<Decision, string> = {
  加仓: "#00b96b",
  优化: "#1a73e8",
  维持: "#8c8c8c",
  减仓: "#faad14",
  清退: "#ea4335",
  观察: "#bfbfbf",
};

export const BOTTLENECK_COLOR: Record<Bottleneck, string> = {
  "曝光不足": "#faad14",
  "点击率低": "#fbbc04",
  "加购率低": "#13c2c2",
  "支付转化低": "#eb2f96",
  "全链路健康": "#00b96b",
  "数据缺失": "#bfbfbf",
};
