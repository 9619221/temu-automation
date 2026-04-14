import { useMemo, useEffect, useState } from "react";
import { Card, Col, Row, Space, Tag, Typography, Button, Empty } from "antd";
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from "recharts";

const { Text } = Typography;

const TEMU_ORANGE = "#e55b00";
const TRAFFIC_CHART_COLORS = {
  expose: "#ff8a1f",
  clickRate: "#4e79a7",
  clickPayRate: "#f6c343",
  search: "#ff8a1f",
  recommend: "#5b7fa3",
  other: "#f6c343",
  grid: "#d9d9d9",
  axis: "#8c8c8c",
  text: "#262626",
};
// 只展示近7日/近30日两个 range(用户要求,其他删除)
const FLUX_RANGE_ORDER = ["近7日", "近30日"];

export type TrafficSiteKey = "global" | "us" | "eu";

export interface TrafficFluxTrendPoint {
  date: string;
  visitors: number;
  buyers: number;
  conversionRate: number;
}

export interface TrafficDriverSite {
  siteKey: TrafficSiteKey;
  siteLabel: string;
  summary: any;
  summaryByRange?: Record<string, any>;
  items?: any[];
  itemsByRange?: Record<string, any[]>;
  availableRanges?: string[];
  primaryRangeLabel?: string;
  activeRangeLabel?: string;
  syncedAt?: string;
  siteSummary?: any;
  trendSeries?: TrafficFluxTrendPoint[];
  recentTrendSeries?: TrafficFluxTrendPoint[];
  latestTrendPoint?: TrafficFluxTrendPoint | null;
  trendRangeText?: string;
  detailSummary?: any;
}

const FLUX_SITE_ORDER: Array<{ siteKey: TrafficSiteKey; siteLabel: string }> = [
  { siteKey: "global", siteLabel: "全球" },
  { siteKey: "us", siteLabel: "美国" },
  { siteKey: "eu", siteLabel: "欧区" },
];

function toSafeNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatTrafficNumber(value: unknown) {
  const num = toSafeNumber(value);
  if (Number.isInteger(num)) return num.toLocaleString("zh-CN");
  return num.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function formatTrafficPercentValue(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${num.toFixed(1)}%`;
}

function getRelativeChangePercent(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.abs(num) <= 1 ? num * 100 : num;
}

function formatRelativeChangeText(value: unknown) {
  const percent = getRelativeChangePercent(value);
  if (percent === null) return "暂无变化";
  const display = Math.abs(percent) >= 10
    ? percent.toFixed(0)
    : percent.toFixed(1).replace(/\.0$/, "");
  return `${percent > 0 ? "+" : ""}${display}%`;
}

function getRelativeChangeColor(value: unknown) {
  const percent = getRelativeChangePercent(value);
  if (percent === null) return "#8c8c8c";
  if (percent > 0) return "#389e0d";
  if (percent < 0) return "#cf1322";
  return "#8c8c8c";
}

export function normalizeFluxTrendSeries(trendList: unknown): TrafficFluxTrendPoint[] {
  const rawList = Array.isArray(trendList) ? trendList : [];
  return rawList
    .map((item: any) => ({
      date: String(item?.date || item?.statDate || "").trim(),
      visitors: toSafeNumber(item?.visitors ?? item?.visitorsNum),
      buyers: toSafeNumber(item?.buyers ?? item?.payBuyerNum),
      conversionRate: toSafeNumber(item?.conversionRate),
    }))
    .filter((item) => item.date)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function formatFluxTrendRange(trendSeries: TrafficFluxTrendPoint[]) {
  if (trendSeries.length === 0) return "";
  const first = trendSeries[0]?.date || "";
  const last = trendSeries[trendSeries.length - 1]?.date || "";
  if (!first) return "";
  return first === last ? first : `${first} - ${last}`;
}

function getTrafficSiteMode(site: any) {
  if (site?.summary) return "product";
  if (Array.isArray(site?.recentTrendSeries) && site.recentTrendSeries.length > 0) return "trend";
  return "empty";
}

function getTrafficModeMeta(site: any) {
  const mode = getTrafficSiteMode(site);
  if (mode === "product") return { label: "商品级数据", color: "orange" as const };
  if (mode === "trend") return { label: "站点趋势", color: "blue" as const };
  return { label: "暂无数据", color: "default" as const };
}

function getFluxSiteDisplayName(siteKey: TrafficSiteKey) {
  if (siteKey === "global") return "全球";
  if (siteKey === "us") return "美国";
  return "欧区";
}

// 把 clickPayRate / exposeClickRate 转为百分数字段,自动识别 0..1 分数 or 已是百分数
function normalizeRateToPercent(raw: unknown): number {
  const num = toSafeNumber(raw);
  if (!Number.isFinite(num) || num === 0) return 0;
  return num > 1 ? Number(num.toFixed(1)) : Number((num * 100).toFixed(1));
}

function buildTrafficPerformanceTrendData(site: any) {
  // 优先用 trendSeries (日期轴),只有在 trendSeries 为空时才回退到 rangeData (range 标签轴)
  const trendSeries = Array.isArray(site?.trendSeries) ? site.trendSeries.slice(-30) : [];
  const summary = site?.summary;

  if (trendSeries.length > 1 && summary) {
    const totalExpose = Math.max(toSafeNumber(summary?.exposeNum), 1);
    const totalClick = Math.max(toSafeNumber(summary?.clickNum), 0);
    const totalBuyers = Math.max(toSafeNumber(summary?.buyerNum), 0);
    const stationVisitorTotal = trendSeries.reduce((sum: number, p: TrafficFluxTrendPoint) => sum + toSafeNumber(p?.visitors), 0) || 1;
    return trendSeries.map((item: TrafficFluxTrendPoint) => {
      const ratio = toSafeNumber(item.visitors) / stationVisitorTotal;
      const expose = Math.max(Math.round(totalExpose * ratio), 0);
      const click = Math.round(totalClick * ratio);
      const buyers = Math.round(totalBuyers * ratio);
      return {
        label: item.date.slice(5),
        fullLabel: item.date,
        expose,
        clickRate: expose > 0 ? Number(((click / expose) * 100).toFixed(1)) : 0,
        clickPayRate: click > 0 ? Number(((buyers / click) * 100).toFixed(1)) : 0,
      };
    }).filter((item: any) => item.expose > 0 || item.clickRate > 0 || item.clickPayRate > 0);
  }

  // fallback: 按 range 标签展示
  const labels = FLUX_RANGE_ORDER.filter((label) => site?.summaryByRange?.[label]);
  return labels.map((label) => {
    const rangeSummary = site?.summaryByRange?.[label];
    const expose = toSafeNumber(rangeSummary?.exposeNum);
    return {
      label,
      fullLabel: label,
      expose,
      clickRate: normalizeRateToPercent(rangeSummary?.exposeClickRate),
      clickPayRate: normalizeRateToPercent(rangeSummary?.clickPayRate),
    };
  }).filter((item: any) => item.expose > 0 || item.clickRate > 0 || item.clickPayRate > 0);
}

function buildTrafficSourceTimelineData(site: any, days: number) {
  const trendSeries = Array.isArray(site?.trendSeries) ? site.trendSeries.slice(-(days || 7)) : [];
  const summary = site?.summary;
  const totalExpose = toSafeNumber(summary?.exposeNum);
  const searchExpose = toSafeNumber(summary?.searchExposeNum);
  const recommendExpose = toSafeNumber(summary?.recommendExposeNum);

  if (trendSeries.length > 1 && totalExpose > 0) {
    const anchorPoint = [...trendSeries].reverse().find((item: TrafficFluxTrendPoint) => item.visitors > 0) || trendSeries[trendSeries.length - 1];
    const anchorVisitors = Math.max(toSafeNumber(anchorPoint?.visitors), 1);
    const searchShare = searchExpose / Math.max(totalExpose, 1);
    const recommendShare = recommendExpose / Math.max(totalExpose, 1);

    return trendSeries.map((item: TrafficFluxTrendPoint) => {
      const estimatedTotal = Math.max(Math.round(totalExpose * (toSafeNumber(item.visitors) / anchorVisitors)), 0);
      const search = Math.round(estimatedTotal * searchShare);
      const recommend = Math.round(estimatedTotal * recommendShare);
      return {
        label: item.date.slice(5),
        fullDate: item.date,
        search,
        recommend,
        other: Math.max(estimatedTotal - search - recommend, 0),
        total: estimatedTotal,
      };
    }).filter((item: any) => item.total > 0 || item.search > 0 || item.recommend > 0 || item.other > 0);
  }

  const labels = FLUX_RANGE_ORDER.filter((label) => site?.summaryByRange?.[label]);
  return labels.map((label) => {
    const rangeSummary = site?.summaryByRange?.[label] || {};
    const search = toSafeNumber(rangeSummary.searchExposeNum);
    const recommend = toSafeNumber(rangeSummary.recommendExposeNum);
    const total = toSafeNumber(rangeSummary.exposeNum);
    return {
      label,
      search,
      recommend,
      other: Math.max(total - search - recommend, 0),
      total,
    };
  }).filter((item) => item.total > 0 || item.search > 0 || item.recommend > 0 || item.other > 0);
}

function buildTrafficFunnelSteps(site: any) {
  const summary = site?.summary;
  if (!summary) return [];

  const steps = [
    { label: "曝光", value: toSafeNumber(summary.exposeNum) },
    { label: "点击", value: toSafeNumber(summary.clickNum) },
    { label: "详情访客", value: toSafeNumber(summary.detailVisitorNum || summary.detailVisitNum) },
    { label: "加购", value: toSafeNumber(summary.addToCartUserNum) },
    { label: "支付买家", value: toSafeNumber(summary.buyerNum) },
  ];
  const maxValue = Math.max(...steps.map((item) => item.value), 1);

  return steps.map((item, index) => {
    const previousValue = index === 0 ? maxValue : Math.max(steps[index - 1]?.value || 0, 1);
    return {
      ...item,
      widthPercent: Math.max(24, Math.round((item.value / maxValue) * 100)),
      conversionText: index === 0 ? "基线" : `${((item.value / previousValue) * 100).toFixed(1)}%`,
    };
  });
}

function renderTrafficTooltipCard(title: string, rows: Array<{ color: string; label: string; value: string }>) {
  return (
    <div
      style={{
        minWidth: 132,
        borderRadius: 12,
        background: "#fff",
        boxShadow: "0 10px 28px rgba(0,0,0,0.12)",
        border: "1px solid rgba(0,0,0,0.06)",
        padding: "12px 14px",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 500, color: "#595959", marginBottom: 8 }}>{title}</div>
      <Space direction="vertical" size={6} style={{ width: "100%" }}>
        {rows.map((row) => (
          <div key={`${row.label}-${row.value}`} style={{ display: "flex", alignItems: "center", gap: 8, color: TRAFFIC_CHART_COLORS.text, fontSize: 13 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: row.color, display: "inline-block", flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{row.label}</span>
            <span style={{ fontWeight: 600 }}>{row.value}</span>
          </div>
        ))}
      </Space>
    </div>
  );
}

function renderTrafficTrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const rows = payload.map((item: any) => ({
    color: item?.color || item?.stroke || TRAFFIC_CHART_COLORS.expose,
    label: String(item?.name || ""),
    value: item?.name === "曝光" ? formatTrafficNumber(item?.value) : formatTrafficPercentValue(item?.value),
  }));
  const title = payload?.[0]?.payload?.fullLabel || String(label || "");
  return renderTrafficTooltipCard(title, rows);
}

function renderTrafficSourceTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const rows = payload.map((item: any) => ({
    color: item?.color || item?.stroke || TRAFFIC_CHART_COLORS.search,
    label: item?.name === "search" ? "搜索" : item?.name === "recommend" ? "推荐" : "其他",
    value: formatTrafficNumber(item?.value),
  }));
  const title = payload?.[0]?.payload?.fullDate || String(label || "");
  return renderTrafficTooltipCard(title, rows);
}

/** 把 ProductList 的 fluxSites (per-product) + 站点级 trendList 转成 TrafficDriverSite 数组 */
export function buildTrafficDriverSitesFromProduct(
  fluxSites: any[],
  siteTrendListBySite: Record<string, any[]>,
): TrafficDriverSite[] {
  return FLUX_SITE_ORDER.map((entry) => {
    const source = fluxSites.find((item: any) => item.siteKey === entry.siteKey);
    const trendList = siteTrendListBySite[entry.siteKey] || [];
    const trendSeries = normalizeFluxTrendSeries(trendList);
    return {
      siteKey: entry.siteKey,
      siteLabel: entry.siteLabel,
      summary: source?.summary || null,
      summaryByRange: source?.summaryByRange || {},
      items: source?.items || [],
      itemsByRange: source?.itemsByRange || {},
      availableRanges: source?.availableRanges || [],
      primaryRangeLabel: source?.primaryRangeLabel || "今日",
      activeRangeLabel: source?.primaryRangeLabel || "今日",
      syncedAt: source?.syncedAt || "",
      siteSummary: null,
      trendSeries,
      recentTrendSeries: trendSeries.slice(-7),
      latestTrendPoint: trendSeries[trendSeries.length - 1] || null,
      trendRangeText: formatFluxTrendRange(trendSeries),
      detailSummary: source?.summary || null,
    };
  });
}

interface TrafficDriverPanelProps {
  sites: TrafficDriverSite[];
  activeSiteKey: TrafficSiteKey;
  onActiveSiteKeyChange: (key: TrafficSiteKey) => void;
  rangeLabel: string;
  onRangeLabelChange: (label: string) => void;
}

export function TrafficDriverPanel({
  sites,
  activeSiteKey,
  onActiveSiteKeyChange,
  rangeLabel,
  onRangeLabelChange,
}: TrafficDriverPanelProps) {
  const activeSite = useMemo(
    () => sites.find((item) => item.siteKey === activeSiteKey) || sites[0] || null,
    [sites, activeSiteKey],
  );
  // 根据选中的 range 派生有效 site(summary 替换为对应 range 的 summary,趋势 trendSeries 截断到对应天数)
  const effectiveSite = useMemo(() => {
    if (!activeSite) return null;
    const rangeSummary = activeSite.summaryByRange?.[rangeLabel];
    const days = rangeLabel === "近30日" || rangeLabel === "本月" ? 30 : 7;
    const trendSeries = Array.isArray(activeSite.trendSeries) ? activeSite.trendSeries.slice(-days) : [];
    return {
      ...activeSite,
      summary: rangeSummary || activeSite.summary,
      trendSeries,
      recentTrendSeries: trendSeries,
      latestTrendPoint: trendSeries[trendSeries.length - 1] || activeSite.latestTrendPoint,
    };
  }, [activeSite, rangeLabel]);
  const activeModeMeta = useMemo(() => getTrafficModeMeta(effectiveSite), [effectiveSite]);
  const trendChartData = useMemo(
    () => (effectiveSite ? buildTrafficPerformanceTrendData(effectiveSite) : []),
    [effectiveSite],
  );
  const trendRangeText = useMemo(() => {
    if (effectiveSite?.trendRangeText && effectiveSite.trendSeries?.length) return effectiveSite.trendRangeText;
    if (trendChartData.length > 1) {
      const first = trendChartData[0]?.fullLabel || trendChartData[0]?.label;
      const last = trendChartData[trendChartData.length - 1]?.fullLabel || trendChartData[trendChartData.length - 1]?.label;
      return `${first} - ${last}`;
    }
    return "";
  }, [effectiveSite, trendChartData]);
  const sourceChartData = useMemo(() => {
    const rangeDays = rangeLabel === "近30日" || rangeLabel === "本月" ? 30 : 7;
    return effectiveSite ? buildTrafficSourceTimelineData(effectiveSite, rangeDays) : [];
  }, [effectiveSite, rangeLabel]);
  const funnelSteps = useMemo(
    () => (effectiveSite ? buildTrafficFunnelSteps(effectiveSite) : []),
    [effectiveSite],
  );
  const showSourceTimelineChart = sourceChartData.length > 1;
  const availableRanges = useMemo(
    () => FLUX_RANGE_ORDER.filter((label) => activeSite?.summaryByRange?.[label]),
    [activeSite],
  );
  const showRangeSwitcher = availableRanges.length > 1;
  const rangeDisplayLabel = availableRanges.length === 1 ? availableRanges[0] : "";

  const funnelDisplaySteps = useMemo(() => {
    const labels = ["曝光", "点击", "详情访客", "加购", "支付买家"];
    return funnelSteps.map((item, index) => ({ ...item, displayLabel: labels[index] || item.label }));
  }, [funnelSteps]);

  const dateLabel = useMemo(() => {
    if (effectiveSite?.summary?.dataDate) return effectiveSite.summary.dataDate;
    if (effectiveSite?.latestTrendPoint?.date) return effectiveSite.latestTrendPoint.date;
    return "";
  }, [effectiveSite]);

  const todayFallbackText = useMemo(() => {
    if (rangeLabel !== "今日" || !dateLabel) return "";
    const now = new Date();
    const todayLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (dateLabel === todayLabel) return "";
    return `今日暂未返回商品级明细，当前展示最近一个统计日（${dateLabel}）`;
  }, [dateLabel, rangeLabel]);

  const overviewSyncedAt = useMemo(
    () => sites.map((item) => item.summary?.syncedAt || item.summary?.updateTime || item.syncedAt).find(Boolean) || "",
    [sites],
  );

  useEffect(() => {
    if (availableRanges.length === 0) return;
    if (availableRanges.includes(rangeLabel)) return;
    onRangeLabelChange(activeSite?.activeRangeLabel || availableRanges[0]);
  }, [availableRanges, activeSite, rangeLabel, onRangeLabelChange]);

  const metricCards = useMemo(() => {
    if (!effectiveSite) return [];
    if (effectiveSite.summary) {
      return [
        {
          key: "expose",
          title: "曝光",
          value: formatTrafficNumber(effectiveSite.summary.exposeNum),
          caption: `较上期 ${formatRelativeChangeText(effectiveSite.summary.exposeNumChange)}`,
          captionColor: getRelativeChangeColor(effectiveSite.summary.exposeNumChange),
        },
        {
          key: "click",
          title: "点击",
          value: formatTrafficNumber(effectiveSite.summary.clickNum),
          caption: `较上期 ${formatRelativeChangeText(effectiveSite.summary.clickNumChange)}`,
          captionColor: getRelativeChangeColor(effectiveSite.summary.clickNumChange),
        },
        {
          key: "visitor",
          title: "商品访客",
          value: formatTrafficNumber(effectiveSite.summary.detailVisitorNum || effectiveSite.summary.detailVisitNum),
          caption: "进入详情页的人数",
          captionColor: "#8c8c8c",
        },
        {
          key: "cart",
          title: "加购人数",
          value: formatTrafficNumber(effectiveSite.summary.addToCartUserNum),
          caption: "更接近下单的信号",
          captionColor: "#8c8c8c",
        },
        {
          key: "buyer",
          title: "支付买家",
          value: formatTrafficNumber(effectiveSite.summary.buyerNum),
          caption: `支付买家 / 件数 ${formatTrafficNumber(effectiveSite.summary.buyerNum)} / ${formatTrafficNumber(effectiveSite.summary.payGoodsNum)}`,
          captionColor: "#8c8c8c",
        },
        {
          key: "conversion",
          title: "点击支付转化率",
          value: (() => {
            const click = toSafeNumber(effectiveSite.summary.clickNum);
            const buyers = toSafeNumber(effectiveSite.summary.buyerNum);
            if (click > 0) return formatTrafficPercentValue((buyers / click) * 100);
            return formatTrafficPercentValue(normalizeRateToPercent(effectiveSite.summary.clickPayRate));
          })(),
          caption: "判断这波流量有没有成交能力",
          captionColor: "#8c8c8c",
        },
      ];
    }
    const trendSeries = Array.isArray(effectiveSite.recentTrendSeries) ? effectiveSite.recentTrendSeries : [];
    const visitorsAverage = average(trendSeries.map((item: TrafficFluxTrendPoint) => item.visitors));
    const buyersAverage = average(trendSeries.map((item: TrafficFluxTrendPoint) => item.buyers));
    const conversionAverage = average(trendSeries.map((item: TrafficFluxTrendPoint) => item.conversionRate));
    return [
      {
        key: "visitors",
        title: "最新访客",
        value: formatTrafficNumber(effectiveSite.latestTrendPoint?.visitors || 0),
        caption: effectiveSite.latestTrendPoint?.date || "暂无日期",
        captionColor: "#8c8c8c",
      },
      {
        key: "latest-buyers",
        title: "最新支付买家",
        value: formatTrafficNumber(effectiveSite.latestTrendPoint?.buyers || 0),
        caption: "站点级最近一天",
        captionColor: "#8c8c8c",
      },
      {
        key: "latest-rate",
        title: "最新转化率",
        value: formatTrafficPercentValue((effectiveSite.latestTrendPoint?.conversionRate || 0) * 100),
        caption: "站点级最近一天",
        captionColor: "#8c8c8c",
      },
      {
        key: "avg-visitors",
        title: "近7天均访客",
        value: formatTrafficNumber(visitorsAverage),
        caption: "站点整体走势",
        captionColor: "#8c8c8c",
      },
      {
        key: "avg-buyers",
        title: "近7天均买家",
        value: formatTrafficNumber(buyersAverage),
        caption: "站点整体走势",
        captionColor: "#8c8c8c",
      },
      {
        key: "avg-rate",
        title: "近7天均转化率",
        value: formatTrafficPercentValue(conversionAverage * 100),
        caption: "站点整体走势",
        captionColor: "#8c8c8c",
      },
    ];
  }, [effectiveSite]);

  if (!activeSite) return null;

  return (
    <Card
      size="small"
      style={{ borderRadius: 16, background: "#fafafa", border: "1px solid #f0f0f0" }}
      bodyStyle={{ padding: 16 }}
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <Text strong>流量驾驶舱</Text>
          </div>
          <Space wrap size={[8, 8]}>
            <Tag color="orange">{getFluxSiteDisplayName(activeSite.siteKey)} · {activeModeMeta.label}</Tag>
            {dateLabel ? <Tag color="blue">数据日期 {dateLabel}</Tag> : null}
            {overviewSyncedAt ? <Tag>同步 {overviewSyncedAt}</Tag> : null}
          </Space>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <Space wrap size={[8, 8]}>
            {FLUX_SITE_ORDER.map((site) => {
              const siteMeta = getTrafficModeMeta(sites.find((item) => item.siteKey === site.siteKey));
              const selected = activeSiteKey === site.siteKey;
              return (
                <Button
                  key={site.siteKey}
                  size="small"
                  type={selected ? "primary" : "default"}
                  onClick={() => onActiveSiteKeyChange(site.siteKey)}
                  style={selected ? { background: TEMU_ORANGE, borderColor: TEMU_ORANGE } : undefined}
                >
                  {getFluxSiteDisplayName(site.siteKey)} · {siteMeta.label}
                </Button>
              );
            })}
          </Space>

          {showRangeSwitcher ? (
            <Space wrap size={[8, 8]}>
              {availableRanges.map((label) => (
                <Button
                  key={`range-${label}`}
                  size="small"
                  type={rangeLabel === label ? "primary" : "default"}
                  onClick={() => onRangeLabelChange(label)}
                  style={rangeLabel === label ? { background: TEMU_ORANGE, borderColor: TEMU_ORANGE } : undefined}
                >
                  {label}
                </Button>
              ))}
            </Space>
          ) : rangeDisplayLabel ? (
            <Tag>{rangeDisplayLabel}</Tag>
          ) : null}
        </div>

        {activeSite?.summary?.growDataText ? (
          <div style={{ borderRadius: 12, background: "#fff7e6", border: "1px solid #ffe7ba", padding: "10px 12px", color: "#ad4e00" }}>
            增长潜力：{activeSite.summary.growDataText}
          </div>
        ) : null}
        {todayFallbackText ? (
          <div style={{ borderRadius: 12, background: "#fffbe6", border: "1px solid #ffe58f", padding: "10px 12px", color: "#ad6800" }}>
            {todayFallbackText}
          </div>
        ) : null}

        <Row gutter={[12, 12]}>
          {metricCards.map((metric) => (
            <Col xs={12} lg={8} xl={4} key={metric.key}>
              <Card size="small" style={{ height: "100%", borderRadius: 14 }} bodyStyle={{ padding: 14 }}>
                <div style={{ color: "#8c8c8c", fontSize: 13 }}>{metric.title}</div>
                <div style={{ marginTop: 10, fontSize: 34, fontWeight: 700, lineHeight: 1.1 }}>{metric.value}</div>
                <div style={{ marginTop: 8, fontSize: 12, color: metric.captionColor }}>{metric.caption}</div>
              </Card>
            </Col>
          ))}
        </Row>

        <Row gutter={[12, 12]}>
          <Col xs={24} xl={14}>
            <Card
              size="small"
              title="曝光与转化趋势"
              extra={trendRangeText ? <Text type="secondary">{trendRangeText}</Text> : null}
              style={{ borderRadius: 14, height: "100%" }}
            >
              {trendChartData.length > 1 ? (
                <div style={{ width: "100%", height: 280 }}>
                  <ResponsiveContainer>
                    <LineChart data={trendChartData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={TRAFFIC_CHART_COLORS.grid} strokeDasharray="4 4" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: TRAFFIC_CHART_COLORS.axis, fontSize: 12 }} axisLine={{ stroke: "#d9d9d9" }} tickLine={false} />
                      <YAxis yAxisId="left" tickFormatter={(v) => formatTrafficNumber(v)} tick={{ fill: TRAFFIC_CHART_COLORS.axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} tick={{ fill: TRAFFIC_CHART_COLORS.axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                      <RTooltip content={renderTrafficTrendTooltip} cursor={{ stroke: "#d9d9d9", strokeDasharray: "4 4" }} />
                      <Legend iconType="circle" wrapperStyle={{ paddingTop: 8 }} />
                      <Line yAxisId="left" type="monotone" dataKey="expose" name="曝光" stroke={TRAFFIC_CHART_COLORS.expose} strokeWidth={3} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: TRAFFIC_CHART_COLORS.expose }} />
                      <Line yAxisId="right" type="monotone" dataKey="clickRate" name="点击率" stroke={TRAFFIC_CHART_COLORS.clickRate} strokeWidth={2.5} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: TRAFFIC_CHART_COLORS.clickRate }} />
                      <Line yAxisId="right" type="monotone" dataKey="clickPayRate" name="点击支付率" stroke={TRAFFIC_CHART_COLORS.clickPayRate} strokeWidth={2.5} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: TRAFFIC_CHART_COLORS.clickPayRate }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有可展示的多时间商品流量趋势" />
              )}
            </Card>
          </Col>

          <Col xs={24} xl={10}>
            <Card
              size="small"
              title="来源结构"
              extra={<Text type="secondary">搜索 / 推荐 / 其他</Text>}
              style={{ borderRadius: 14, height: "100%" }}
            >
              {showSourceTimelineChart ? (
                <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                  <div style={{ width: "100%", height: 240 }}>
                    <ResponsiveContainer>
                      <AreaChart data={sourceChartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={TRAFFIC_CHART_COLORS.grid} strokeDasharray="4 4" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: TRAFFIC_CHART_COLORS.axis, fontSize: 12 }} axisLine={{ stroke: "#d9d9d9" }} tickLine={false} />
                        <YAxis tick={{ fill: TRAFFIC_CHART_COLORS.axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                        <RTooltip content={renderTrafficSourceTooltip} cursor={{ stroke: "#d9d9d9", strokeDasharray: "4 4" }} />
                        <Legend
                          iconType="circle"
                          wrapperStyle={{ paddingTop: 8 }}
                          formatter={(value) => (value === "search" ? "搜索" : value === "recommend" ? "推荐" : "其他")}
                        />
                        <Area type="monotone" dataKey="search" name="search" stackId="traffic-source" stroke={TRAFFIC_CHART_COLORS.search} fill={TRAFFIC_CHART_COLORS.search} fillOpacity={0.28} strokeWidth={2} dot={false} />
                        <Area type="monotone" dataKey="recommend" name="recommend" stackId="traffic-source" stroke={TRAFFIC_CHART_COLORS.recommend} fill={TRAFFIC_CHART_COLORS.recommend} fillOpacity={0.46} strokeWidth={2} dot={false} />
                        <Area type="monotone" dataKey="other" name="other" stackId="traffic-source" stroke={TRAFFIC_CHART_COLORS.other} fill={TRAFFIC_CHART_COLORS.other} fillOpacity={0.52} strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Space>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有可用的来源走势" />
              )}
            </Card>
          </Col>
        </Row>

        <Row gutter={[12, 12]}>
          <Col xs={24} xl={14}>
            <Card size="small" title="转化漏斗" style={{ borderRadius: 14, height: "100%" }}>
              {funnelDisplaySteps.length > 0 ? (
                <Space direction="vertical" size={14} style={{ width: "100%" }}>
                  {funnelDisplaySteps.map((step, index) => (
                    <div
                      key={step.displayLabel}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "96px 1fr 128px",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <Text strong>{step.displayLabel}</Text>
                      <div style={{ height: 12, background: "#f5f5f5", borderRadius: 999, overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${step.widthPercent}%`,
                            height: "100%",
                            background: index === 0 ? "#fa8c16" : index === 1 ? "#ffb347" : index === 2 ? "#69b1ff" : index === 3 ? "#95de64" : "#36cfc9",
                            borderRadius: 999,
                          }}
                        />
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 600 }}>{formatTrafficNumber(step.value)}</div>
                        <div style={{ fontSize: 12, color: "#8c8c8c" }}>{index === 0 ? "基线" : `环节转化 ${step.conversionText}`}</div>
                      </div>
                    </div>
                  ))}
                </Space>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前站点还没有足够的商品级转化数据" />
              )}
            </Card>
          </Col>

          <Col xs={24} xl={10}>
            <Card size="small" title="站点对比" style={{ borderRadius: 14, height: "100%" }}>
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                {sites.map((site) => {
                  const modeMeta = getTrafficModeMeta(site);
                  const selected = site.siteKey === activeSiteKey;
                  return (
                    <div
                      key={site.siteKey}
                      onClick={() => onActiveSiteKeyChange(site.siteKey)}
                      style={{
                        border: selected ? `1px solid ${TEMU_ORANGE}` : "1px solid #f0f0f0",
                        background: selected ? "#fff7e6" : "#fff",
                        borderRadius: 12,
                        padding: 12,
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <Text strong>{getFluxSiteDisplayName(site.siteKey)}</Text>
                        <Tag color={modeMeta.color}>{modeMeta.label}</Tag>
                      </div>
                      <div style={{ marginTop: 8, fontWeight: 600, color: "#262626" }}>
                        {site.summary
                          ? `${formatTrafficNumber(site.summary.exposeNum)} 曝光 · ${formatTrafficNumber(site.summary.clickNum)} 点击`
                          : site.latestTrendPoint
                            ? `${formatTrafficNumber(site.latestTrendPoint.visitors)} 访客 · ${formatTrafficNumber(site.latestTrendPoint.buyers)} 买家`
                            : "当前没有可用流量数据"}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: "#8c8c8c" }}>
                        {site.summary
                          ? (() => {
                              const click = toSafeNumber(site.summary.clickNum);
                              const buyers = toSafeNumber(site.summary.buyerNum);
                              const pct = click > 0 ? (buyers / click) * 100 : normalizeRateToPercent(site.summary.clickPayRate);
                              return `点击支付转化率 ${formatTrafficPercentValue(pct)}`;
                            })()
                          : site.latestTrendPoint
                            ? `站点转化率 ${formatTrafficPercentValue((site.latestTrendPoint.conversionRate || 0) * 100)}`
                            : "等待下一次采集"}
                      </div>
                    </div>
                  );
                })}
              </Space>
            </Card>
          </Col>
        </Row>
      </Space>
    </Card>
  );
}
