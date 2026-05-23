/**
 * 单商品流量运营诊断面板
 *
 * 与下方 TrafficDriverPanel 分工：本卡片只做"决策 / 行动 / 机会 / 异常 / 跨站对比"，
 * 不重复绘制趋势 / 漏斗 / 来源 / 站点对比图。
 */
import { useMemo } from "react";
import {
  Alert, Card, Col, Empty, Progress, Row, Space, Tag, Tooltip, Typography,
} from "antd";
import {
  ArrowDownOutlined, ArrowUpOutlined, FireOutlined, RiseOutlined,
  ThunderboltOutlined, WarningOutlined, TrophyOutlined,
} from "@ant-design/icons";
import {
  buildOperatorReport,
  DECISION_COLOR,
  BOTTLENECK_COLOR,
  type DiagnosisRow,
  type SiteName,
  type DailyPoint,
} from "../utils/fluxOperator";

const { Text } = Typography;

interface Props {
  productHistoryCache: Record<string, any> | null;
  productIds: Array<string | number | undefined>;
  activeSiteLabel?: string;
}

const SITE_ORDER: SiteName[] = ["全球", "美国", "欧区"];
const fmtPct = (v: number, d = 1) => `${(v ?? 0).toFixed(d)}%`;
const fmtInt = (v: number) => Math.round(v ?? 0).toLocaleString();
const fmtCompact = (v: number) => {
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}w`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return `${Math.round(v)}`;
};

const PRIORITY_COLOR = { P0: "#ea4335", P1: "#fbbc04", P2: "#1a73e8" };
const TEMU_ORANGE = "#1a73e8";

interface ActionItem {
  priority: "P0" | "P1" | "P2";
  text: string;
  impact: string;
}

function computeHealthScore(row: DiagnosisRow, bm: any): number {
  if (!bm || row.expose === 0) return 0;
  const exposeScore = Math.min(100, (row.expose / Math.max(bm.exposeMedian, 1)) * 50);
  const ctrScore = Math.min(100, (row.ctr / Math.max(bm.ctrMedian, 0.5)) * 50);
  const cpcScore = Math.min(100, (row.clickPayRate / Math.max(bm.clickPayMedian, 1)) * 50);
  const slopeBonus = row.exposeSlope > 0 ? 10 : row.exposeSlope < -25 ? -15 : 0;
  return Math.max(0, Math.min(100, Math.round(exposeScore * 0.25 + ctrScore * 0.35 + cpcScore * 0.4 + slopeBonus)));
}

function quantifyOpportunity(row: DiagnosisRow, bm: any): { label: string; lift: number } | null {
  if (!bm || row.days < 3) return null;
  const dailyExpose = row.expose / row.days;
  const dailyClick = row.click / row.days;
  const dailyBuyers = row.buyer / row.days;
  if (bm.ctrMedian > 0 && row.ctr < bm.ctrMedian * 0.7 && row.expose > 500) {
    const targetClick = dailyExpose * (bm.ctrMedian / 100);
    const cpcRate = row.clickPayRate || bm.clickPayMedian;
    const liftBuyers = (targetClick - dailyClick) * (cpcRate / 100);
    if (liftBuyers > 0.5)
      return { label: `把 CTR 提至站点中位 ${fmtPct(bm.ctrMedian, 2)}`, lift: liftBuyers };
  }
  if (bm.clickPayMedian > 0 && row.clickPayRate < bm.clickPayMedian * 0.7 && row.click > 30) {
    const targetBuyers = dailyClick * (bm.clickPayMedian / 100);
    const liftBuyers = targetBuyers - dailyBuyers;
    if (liftBuyers > 0.5)
      return { label: `把点击支付率提至站点中位 ${fmtPct(bm.clickPayMedian)}`, lift: liftBuyers };
  }
  return null;
}

function computePercentile(value: number, all: number[]): number {
  if (!all.length) return 0;
  const better = all.filter((x) => x < value).length;
  return Math.round((better / all.length) * 100);
}

function detectAnomalies(daily: DailyPoint[]) {
  if (daily.length < 4) return [];
  const out: Array<{ date: string; field: string; text: string; level: "warning" | "danger" }> = [];
  const fields: Array<{ key: keyof DailyPoint; label: string }> = [
    { key: "exposeNum", label: "曝光" },
    { key: "clickNum", label: "点击" },
    { key: "buyerNum", label: "买家" },
  ];
  for (const f of fields) {
    const vals = daily.map((d) => Number(d[f.key] || 0));
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (avg < 5) continue;
    daily.forEach((d, i) => {
      const v = vals[i];
      const ratio = v / avg;
      if (ratio < 0.4) {
        out.push({
          date: d.date,
          field: f.label,
          text: `${d.date} ${f.label} ${fmtInt(v)}（仅 7 日均值 ${fmtInt(avg)} 的 ${(ratio * 100).toFixed(0)}%）`,
          level: ratio < 0.2 ? "danger" : "warning",
        });
      }
    });
  }
  return out.slice(0, 4);
}

function buildActionList(row: DiagnosisRow, bm: any, anomalies: any[]): ActionItem[] {
  const actions: ActionItem[] = [];
  if (row.expose > 5000 && row.buyer === 0) {
    actions.push({ priority: "P0", text: "立即下架或彻底改版（高曝光零买家）", impact: "止损" });
  }
  if (anomalies.some((a) => a.level === "danger")) {
    actions.push({ priority: "P0", text: "排查异常日：限流 / 类目错挂 / 差评", impact: "恢复流量" });
  }
  if (bm && row.ctr < bm.ctrMedian * 0.5 && row.expose > 1000) {
    actions.push({
      priority: "P1",
      text: `更换主图 + 优化标题前 12 字（CTR ${fmtPct(row.ctr, 2)} vs 中位 ${fmtPct(bm.ctrMedian, 2)}）`,
      impact: "+CTR",
    });
  }
  if (bm && row.clickPayRate < bm.clickPayMedian * 0.5 && row.click > 30) {
    actions.push({
      priority: "P1",
      text: `降价 5% 测 3 天 + 优化评价位（点击支付率 ${fmtPct(row.clickPayRate)} vs 中位 ${fmtPct(bm.clickPayMedian)}）`,
      impact: "+转化",
    });
  }
  if (row.recommendPct > 70 && row.searchPct < 5 && row.expose > 500) {
    actions.push({ priority: "P1", text: "重写标题 / 属性 / 补关键词，激活搜索流量", impact: "拓量" });
  }
  if (row.exposeSlope > 30 && row.bottleneck === "全链路健康") {
    actions.push({ priority: "P2", text: "加大广告预算 30-50% + 备货 7 天用量", impact: "放量" });
  }
  if (row.cartToBuyRate > 0 && row.cartToBuyRate < 30 && row.addCart >= 10) {
    actions.push({ priority: "P2", text: `加购转化偏低（${fmtPct(row.cartToBuyRate)}），优化价格 / 物流 / 客服`, impact: "+转化" });
  }
  if (actions.length === 0) {
    actions.push({ priority: "P2", text: "保持当前节奏，每周复盘趋势变化", impact: "维持" });
  }
  return actions.slice(0, 5);
}

const decisionTitle = (d: DiagnosisRow["decision"]) =>
  d === "加仓" ? "建议加仓"
    : d === "优化" ? "需要优化"
    : d === "维持" ? "保持节奏"
    : d === "减仓" ? "建议减仓"
    : d === "清退" ? "建议清退"
    : "继续观察";

const ProductFluxOperatorCard: React.FC<Props> = ({
  productHistoryCache, productIds, activeSiteLabel,
}) => {
  const report = useMemo(() => buildOperatorReport(productHistoryCache), [productHistoryCache]);
  const idSet = useMemo(() => {
    const s = new Set<string>();
    for (const id of productIds) {
      const v = String(id ?? "").trim();
      if (v) s.add(v);
    }
    return s;
  }, [productIds]);
  const productRows = useMemo(
    () => report.rows.filter((r) => idSet.has(r.goodsId)),
    [report.rows, idSet],
  );

  if (!productHistoryCache || idSet.size === 0 || productRows.length === 0) {
    return (
      <Card
        size="small"
        title={
          <Space size={6}>
            <ThunderboltOutlined style={{ color: TEMU_ORANGE }} />
            <span>运营诊断</span>
          </Space>
        }
        style={{ marginBottom: 12, borderRadius: 14 }}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ fontSize: 13, color: "#8c8c8c" }}>暂无该商品的日级流量缓存</span>
          }
        />
      </Card>
    );
  }

  const activeRow =
    productRows.find((r) => r.site === (activeSiteLabel as SiteName)) ||
    productRows.find((r) => r.site === "全球") ||
    productRows[0];
  const benchmark = report.benchmarks[activeRow.site];

  const sortedByCpc = [...productRows].sort((a, b) => b.clickPayRate - a.clickPayRate);
  const winner = sortedByCpc[0];
  const loser = sortedByCpc[sortedByCpc.length - 1];
  const hasCrossSiteGap = productRows.length >= 2 && winner.clickPayRate - loser.clickPayRate >= 3 && winner.click >= 30;

  const healthScore = computeHealthScore(activeRow, benchmark);
  const healthColor = healthScore >= 75 ? "#52c41a" : healthScore >= 50 ? "#1a73e8" : healthScore >= 30 ? "#faad14" : "#ea4335";
  const healthLabel = healthScore >= 75 ? "优秀" : healthScore >= 50 ? "良好" : healthScore >= 30 ? "需改进" : "亟需优化";
  const opportunity = quantifyOpportunity(activeRow, benchmark);
  const sitePool = report.rows.filter((r) => r.site === activeRow.site);
  const ctrRank = computePercentile(activeRow.ctr, sitePool.map((r) => r.ctr));
  const cpcRank = computePercentile(activeRow.clickPayRate, sitePool.map((r) => r.clickPayRate));
  const exposeRank = computePercentile(activeRow.expose, sitePool.map((r) => r.expose));
  const anomalies = detectAnomalies(activeRow.daily);
  const actions = buildActionList(activeRow, benchmark, anomalies);

  const rankColor = (p: number) => (p >= 70 ? "#52c41a" : p >= 30 ? "#1a73e8" : "#fa541c");
  const rankLabel = (p: number) => (p >= 70 ? "TOP" : p >= 30 ? "中位" : "末位");

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <ThunderboltOutlined style={{ color: TEMU_ORANGE }} />
          <span>运营诊断</span>
          <Tag color="orange" style={{ marginLeft: 4, fontWeight: 600 }}>{activeRow.site}</Tag>
        </Space>
      }
      extra={
        <Text type="secondary" style={{ fontSize: 11 }}>
          {activeRow.days} 天 · {new Date(report.generatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </Text>
      }
      style={{ marginBottom: 12, borderRadius: 14 }}
      styles={{ body: { padding: 16 } }}
    >
      {/* ===== 区块 1：决策头条 ===== */}
      <Row gutter={20} align="middle" wrap={false}>
        <Col flex="120px">
          <Tooltip title={`基于曝光×CTR×点击支付率与趋势加权（${activeRow.site}）`}>
            <div style={{ textAlign: "center" }}>
              <Progress
                type="dashboard"
                percent={healthScore}
                width={108}
                strokeColor={healthColor}
                strokeWidth={8}
                format={() => (
                  <div style={{ lineHeight: 1.15 }}>
                    <div style={{ fontSize: 26, fontWeight: 700, color: healthColor }}>{healthScore}</div>
                    <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 2 }}>{healthLabel}</div>
                  </div>
                )}
              />
              <div style={{ fontSize: 11, color: "#8c8c8c", marginTop: 4 }}>健康分</div>
            </div>
          </Tooltip>
        </Col>

        <Col flex="auto" style={{ minWidth: 0 }}>
          <Space size={8} wrap style={{ marginBottom: 10 }}>
            <Tag color={DECISION_COLOR[activeRow.decision]} style={{ fontSize: 15, fontWeight: 700, padding: "4px 14px", border: "none", borderRadius: 6 }}>
              {activeRow.decision === "加仓" && <RiseOutlined style={{ marginRight: 4 }} />}
              {activeRow.decision === "清退" && <WarningOutlined style={{ marginRight: 4 }} />}
              {decisionTitle(activeRow.decision)}
            </Tag>
            <Tag color={BOTTLENECK_COLOR[activeRow.bottleneck]} style={{ fontSize: 12, fontWeight: 600, border: "none" }}>
              瓶颈：{activeRow.bottleneck}
            </Tag>
            <Tag style={{ background: "#f8fbff", border: "none", color: "#595959", fontSize: 11 }}>
              曝光 <b style={{ color: rankColor(exposeRank) }}>{rankLabel(exposeRank)} {exposeRank}</b>
            </Tag>
            <Tag style={{ background: "#f8fbff", border: "none", color: "#595959", fontSize: 11 }}>
              CTR <b style={{ color: rankColor(ctrRank) }}>{rankLabel(ctrRank)} {ctrRank}</b>
            </Tag>
            <Tag style={{ background: "#f8fbff", border: "none", color: "#595959", fontSize: 11 }}>
              点击支付率 <b style={{ color: rankColor(cpcRank) }}>{rankLabel(cpcRank)} {cpcRank}</b>
            </Tag>
            <Tooltip title={`同站点共 ${sitePool.length} 个商品参与排名`}>
              <Text type="secondary" style={{ fontSize: 11 }}>店内分位</Text>
            </Tooltip>
          </Space>

          <div
            style={{
              padding: "10px 12px",
              background: "#fafbff",
              border: "1px solid #e6f4ff",
              borderRadius: 8,
              marginBottom: 8,
              fontSize: 13,
              color: "#262626",
              lineHeight: 1.6,
            }}
          >
            💡 {activeRow.decisionReason || "暂无具体建议"}
          </div>

          {opportunity && (
            <div style={{ background: "rgba(255, 159, 10, 0.10)", border: "1px solid rgba(255, 159, 10, 0.22)", borderRadius: 8, padding: "8px 12px" }}>
              <FireOutlined style={{ color: "#fbbc04", marginRight: 6 }} />
              <Text style={{ fontSize: 13 }}>
                <b>机会测算：</b>{opportunity.label} → 预计日新增买家
                <span style={{ color: "#fa541c", fontSize: 18, fontWeight: 700, margin: "0 6px" }}>+{opportunity.lift.toFixed(1)}</span>
                名（约 <b>{fmtInt(opportunity.lift * 30)}</b>/月）
              </Text>
            </div>
          )}
        </Col>
      </Row>

      {/* ===== 区块 2：行动优先级清单 ===== */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <Text strong style={{ fontSize: 13 }}>
            <ThunderboltOutlined style={{ color: TEMU_ORANGE, marginRight: 4 }} />
            行动优先级
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }}>P0 立即处理 · P1 本周内 · P2 节奏内</Text>
        </div>
        <div style={{ border: "1px solid #f0f0f0", borderRadius: 10, overflow: "hidden" }}>
          {actions.map((a, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "44px 1fr 70px",
                gap: 10,
                alignItems: "center",
                padding: "10px 12px",
                background: i % 2 === 0 ? "#fff" : "#f8fbff",
                borderTop: i > 0 ? "1px solid #f8fbff" : "none",
                fontSize: 13,
              }}
            >
              <Tag color={PRIORITY_COLOR[a.priority]} style={{ minWidth: 36, textAlign: "center", fontWeight: 700, border: "none", margin: 0, padding: "1px 0" }}>
                {a.priority}
              </Tag>
              <span style={{ color: "#262626", lineHeight: 1.5 }}>{a.text}</span>
              <Tag style={{ background: "#f0f5ff", border: "none", color: "#1a73e8", margin: 0, textAlign: "center" }}>
                {a.impact}
              </Tag>
            </div>
          ))}
        </div>
      </div>

      {/* ===== 区块 3：异常日 + 跨站决策快览 ===== */}
      <Row gutter={12} style={{ marginTop: 16 }}>
        <Col xs={24} xl={12}>
          <div style={{ marginBottom: 8 }}>
            <Text strong style={{ fontSize: 13 }}>
              <WarningOutlined style={{ color: anomalies.length > 0 ? "#faad14" : "#bfbfbf", marginRight: 4 }} />
              异常日检测 {anomalies.length > 0 && <Tag color="orange" style={{ marginLeft: 4 }}>{anomalies.length}</Tag>}
            </Text>
          </div>
          {anomalies.length === 0 ? (
            <div style={{ padding: "16px 12px", background: "#f6ffed", border: "1px solid #b7eb8f", borderRadius: 10, color: "#52c41a", fontSize: 12, textAlign: "center" }}>
              ✓ 近 {activeRow.days} 天无异常波动
            </div>
          ) : (
            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              {anomalies.map((a, i) => (
                <Alert
                  key={i}
                  type={a.level === "danger" ? "error" : "warning"}
                  showIcon
                  message={<span style={{ fontSize: 12 }}>{a.text}</span>}
                  style={{ padding: "6px 10px", borderRadius: 8 }}
                />
              ))}
            </Space>
          )}
        </Col>

        <Col xs={24} xl={12}>
          <div style={{ marginBottom: 8 }}>
            <Text strong style={{ fontSize: 13 }}>
              <TrophyOutlined style={{ color: TEMU_ORANGE, marginRight: 4 }} />
              跨站决策快览
            </Text>
          </div>
          <Space direction="vertical" size={6} style={{ width: "100%" }}>
            {SITE_ORDER.map((site) => {
              const row = productRows.find((r) => r.site === site);
              if (!row) {
                return (
                  <div key={site} style={{ padding: "8px 12px", border: "1px solid #f0f0f0", borderRadius: 8, color: "#bfbfbf", fontSize: 12, display: "flex", justifyContent: "space-between" }}>
                    <span>{site}</span>
                    <span>暂无数据</span>
                  </div>
                );
              }
              const isActive = row.site === activeRow.site;
              const isWinner = winner && row.site === winner.site && hasCrossSiteGap;
              const slopeColor = row.exposeSlope > 5 ? "#52c41a" : row.exposeSlope < -10 ? "#ea4335" : "#8c8c8c";
              return (
                <div
                  key={site}
                  style={{
                    padding: "8px 12px",
                    border: isActive ? `1px solid ${TEMU_ORANGE}` : "1px solid #f0f0f0",
                    background: isActive ? "rgba(26, 115, 232, 0.06)" : "#fff",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    fontSize: 12,
                  }}
                >
                  <span style={{ fontWeight: 600, minWidth: 48, fontSize: 13 }}>
                    {site}
                    {isWinner && <span style={{ marginLeft: 4 }}>🏆</span>}
                  </span>
                  <span style={{ color: "#595959" }}>
                    曝光 <b>{fmtCompact(row.expose)}</b>
                  </span>
                  <span style={{ color: "#595959" }}>
                    点击支付率 <b style={{ color: row.clickPayRate > 5 ? "#52c41a" : row.clickPayRate < 2 ? "#fa541c" : "#262626" }}>
                      {fmtPct(row.clickPayRate)}
                    </b>
                  </span>
                  <span style={{ color: slopeColor, marginLeft: "auto" }}>
                    {row.exposeSlope > 0 ? <ArrowUpOutlined /> : row.exposeSlope < 0 ? <ArrowDownOutlined /> : null}
                    {Math.abs(row.exposeSlope).toFixed(0)}%
                  </span>
                  <Tag color={DECISION_COLOR[row.decision]} style={{ border: "none", margin: 0, padding: "1px 8px", fontSize: 11, fontWeight: 600 }}>
                    {row.decision}
                  </Tag>
                </div>
              );
            })}
          </Space>

          {hasCrossSiteGap && winner && loser && (
            <Alert
              type="success"
              showIcon
              style={{ marginTop: 8, padding: "6px 10px", borderRadius: 8 }}
              message={
                <span style={{ fontSize: 12 }}>
                  把 <b>{winner.site}</b>（{fmtPct(winner.clickPayRate)}）的标题/主图/定价平移到 <b>{loser.site}</b>（{fmtPct(loser.clickPayRate)}）
                </span>
              }
            />
          )}
        </Col>
      </Row>
    </Card>
  );
};

export default ProductFluxOperatorCard;
