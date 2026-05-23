import { useMemo } from "react";
import { Alert, Button, Card, Space, Tag, Typography } from "antd";
import { RocketOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

const { Text, Paragraph } = Typography;

export interface OperationAdvisorProduct {
  title?: string;
  category?: string;
  imageUrl?: string;
  skcId?: string;
}

interface OperationAdvisorProps {
  site: any;
  productContext?: OperationAdvisorProduct;
}

const CLICK_RATE_TARGET = 3;    // 3% (用户确认阈值)
const CLICK_PAY_RATE_TARGET = 5; // 5%

type Severity = "critical" | "warning" | "info";

interface AdvisorIssue {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  aiImagePrompt: string;         // 给 AI 出图页的建议生图类型
  recommendedImageType: string;  // main | features | lifestyle | comparison | packaging
}

interface AdvisorResult {
  healthScore: number;
  summary: string;
  issues: AdvisorIssue[];
}

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function computeAdvisor(site: any): AdvisorResult {
  const summary = site?.summary;
  if (!summary) {
    return {
      healthScore: 0,
      summary: "暂无商品级流量数据,请先采集或等数据回来",
      issues: [],
    };
  }

  const expose = toNum(summary.exposeNum);
  const clicks = toNum(summary.clickNum);
  const detailVisits = toNum(summary.detailVisitorNum || summary.detailVisitNum);
  const cartUsers = toNum(summary.addToCartUserNum);
  const buyers = toNum(summary.buyerNum);

  const clickRatePct = expose > 0 ? (clicks / expose) * 100 : 0;
  const clickPayRatePct = clicks > 0 ? (buyers / clicks) * 100 : 0;
  const cartRatePct = clicks > 0 ? (cartUsers / clicks) * 100 : 0;
  const cartToBuyerPct = cartUsers > 0 ? (buyers / cartUsers) * 100 : 0;

  // 健康分:点击率 40 + 转化率 40 + 曝光规模 20
  const clickScore = Math.min(clickRatePct / CLICK_RATE_TARGET, 1) * 40;
  const payScore = Math.min(clickPayRatePct / CLICK_PAY_RATE_TARGET, 1) * 40;
  const exposeScore = expose > 0 ? Math.min(Math.log10(expose + 1) / Math.log10(1000), 1) * 20 : 0;
  const healthScore = Math.round(clickScore + payScore + exposeScore);

  const issues: AdvisorIssue[] = [];

  // 规则 1: 主图承接力差(点击率 < 3%)
  if (expose >= 50 && clickRatePct < CLICK_RATE_TARGET) {
    issues.push({
      id: "low-ctr",
      severity: clickRatePct < CLICK_RATE_TARGET * 0.5 ? "critical" : "warning",
      title: `主图点击率只有 ${clickRatePct.toFixed(1)}% (目标 ≥${CLICK_RATE_TARGET}%)`,
      description: `曝光 ${expose.toLocaleString()} 次但只有 ${clicks.toLocaleString()} 次点击,主图吸引力不足。建议用 AI 重新生成主图——更突出商品核心卖点、对比度、构图。`,
      aiImagePrompt: `这件商品当前主图点击率只有 ${clickRatePct.toFixed(1)}%,远低于 ${CLICK_RATE_TARGET}% 目标。请生成一张新的主图:(1) 商品占画面 80% 以上,(2) 纯白背景,(3) 主视角最能体现商品核心功能,(4) 加适度对比/场景元素避免单调,(5) 无文字无 logo,吸引目标买家一眼点击。`,
      recommendedImageType: "main",
    });
  }

  // 规则 2: 点击支付转化低(点击率过关但 转化率 < 5%)
  if (clicks >= 20 && clickPayRatePct < CLICK_PAY_RATE_TARGET && clickRatePct >= CLICK_RATE_TARGET) {
    issues.push({
      id: "low-conversion",
      severity: clickPayRatePct < CLICK_PAY_RATE_TARGET * 0.5 ? "critical" : "warning",
      title: `点击支付转化率只有 ${clickPayRatePct.toFixed(1)}% (目标 ≥${CLICK_PAY_RATE_TARGET}%)`,
      description: `${clicks.toLocaleString()} 次点击只换来 ${buyers.toLocaleString()} 个买家,买家进来但没下单,通常是卖点不清晰或信任度不够。建议补一组详情页卖点图强化核心价值。`,
      aiImagePrompt: `这件商品点击进来 ${clicks.toLocaleString()} 次但只有 ${buyers.toLocaleString()} 个买家,支付转化率 ${clickPayRatePct.toFixed(1)}%,低于 ${CLICK_PAY_RATE_TARGET}% 目标。请生成一张卖点强化图:(1) 突出 3-5 个核心卖点,带图标和短英文标签,(2) 背景用品牌色或对比色块,(3) 视觉层级清晰,让买家 3 秒内看懂这商品值买。`,
      recommendedImageType: "features",
    });
  }

  // 规则 3: 加购率低(<15%) — 场景/使用感不够
  if (clicks >= 50 && cartRatePct < 15 && clickRatePct >= CLICK_RATE_TARGET) {
    issues.push({
      id: "low-cart-rate",
      severity: "warning",
      title: `加购率只有 ${cartRatePct.toFixed(1)}% (参考 ≥15%)`,
      description: `进详情页的人不愿加购,通常是看不到"自己用起来是什么样"。建议补一张真实使用场景图。`,
      aiImagePrompt: `这件商品详情访客 ${detailVisits.toLocaleString()} 但加购率只有 ${cartRatePct.toFixed(1)}%,买家对使用体验没画面感。请生成一张生活场景图:(1) 真实使用场景(家里/办公室/户外,取决于商品),(2) 有人物互动或手部特写,(3) 情绪温暖,让买家"看见自己用它",(4) 背景适度虚化突出商品。`,
      recommendedImageType: "lifestyle",
    });
  }

  // 规则 4: 加购→支付漏斗漏(加购到买家 < 30%) — 犹豫中放弃
  if (cartUsers >= 10 && cartToBuyerPct < 30) {
    issues.push({
      id: "cart-abandon",
      severity: "warning",
      title: `加购后只有 ${cartToBuyerPct.toFixed(1)}% 支付 (参考 ≥30%)`,
      description: `${cartUsers.toLocaleString()} 人加购但只有 ${buyers.toLocaleString()} 人付款,买家临门一脚犹豫了,通常是价格/规格/信任问题。建议补一张对比图或价值强调图。`,
      aiImagePrompt: `这件商品加购 ${cartUsers.toLocaleString()} 人但只有 ${buyers.toLocaleString()} 人支付,加购-支付转化率只有 ${cartToBuyerPct.toFixed(1)}%。请生成一张对比/价值图:(1) 突出相对竞品的关键差异点(材质/尺寸/功能),(2) 用数字/百分比/勾叉对比表呈现,(3) 视觉强烈让买家觉得"不买亏了",(4) 风格专业可信。`,
      recommendedImageType: "comparison",
    });
  }

  // 规则 5: 曝光太少(<100) — 流量池太浅无法判断
  if (expose > 0 && expose < 100) {
    issues.push({
      id: "low-exposure",
      severity: "info",
      title: `近期曝光只有 ${expose.toLocaleString()} 次,样本太少`,
      description: `流量池太浅,单看数据意义不大。建议做一组不同风格的主图 A/B 快速测试,抓住下一波自然流量。`,
      aiImagePrompt: `这件商品近期曝光只有 ${expose.toLocaleString()} 次,样本太少无法判断主图好坏。请生成 2-3 张风格明显不同的主图备选:(1) 一张极简白底纯商品,(2) 一张带氛围场景,(3) 一张突出功能细节特写。用于 A/B 测试。`,
      recommendedImageType: "main",
    });
  }

  // 综合判断
  let summaryText: string;
  if (healthScore >= 80) {
    summaryText = `健康分 ${healthScore}/100。流量承接和转化都在正常区间,可以专注推广放量。`;
  } else if (healthScore >= 60) {
    summaryText = `健康分 ${healthScore}/100。数据基本过得去但有 ${issues.length} 个问题需要处理。`;
  } else if (healthScore >= 40) {
    summaryText = `健康分 ${healthScore}/100。流量漏斗有明显短板,下面 ${issues.length} 条建议按优先级处理。`;
  } else {
    summaryText = `健康分 ${healthScore}/100。整体表现不佳,下面 ${issues.length} 条建议从主图和卖点开始修。`;
  }

  // 按严重度排序(critical 优先)
  const severityOrder: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return { healthScore, summary: summaryText, issues };
}

function getHealthColor(score: number): { color: string; label: string; tagColor: "success" | "processing" | "warning" | "error" } {
  if (score >= 80) return { color: "#389e0d", label: "健康", tagColor: "success" };
  if (score >= 60) return { color: "#fbbc04", label: "一般", tagColor: "processing" };
  if (score >= 40) return { color: "#d46b08", label: "有短板", tagColor: "warning" };
  return { color: "#cf1322", label: "需优化", tagColor: "error" };
}

function getSeverityTag(severity: Severity): { color: string; label: string } {
  if (severity === "critical") return { color: "#cf1322", label: "🔴 急" };
  if (severity === "warning") return { color: "#fbbc04", label: "🟡 注意" };
  return { color: "#1a73e8", label: "🔵 提示" };
}

export function OperationAdvisor({ site, productContext }: OperationAdvisorProps) {
  const navigate = useNavigate();
  const result = useMemo(() => computeAdvisor(site), [site]);
  const healthMeta = getHealthColor(result.healthScore);

  const handleGenerateImage = (issue: AdvisorIssue) => {
    navigate("/image-studio", {
      state: {
        prefill: {
          title: productContext?.title,
          category: productContext?.category,
          imageUrl: productContext?.imageUrl,
          skcId: productContext?.skcId,
        },
        advisorContext: {
          issueId: issue.id,
          issueTitle: issue.title,
          recommendedImageType: issue.recommendedImageType,
          suggestion: issue.aiImagePrompt,
        },
      },
    });
  };

  if (!site?.summary && result.issues.length === 0) {
    return (
      <Alert
        type="info"
        showIcon
        message="运营参谋: 暂无商品级流量数据"
        description="先采集流量数据后,这里会给出自动诊断和 AI 生图建议。"
      />
    );
  }

  return (
    <Card
      size="small"
      style={{
        borderRadius: 14,
        background: "linear-gradient(135deg, rgba(246,250,255,1) 0%, rgba(255,255,255,1) 58%, rgba(248,250,252,0.96) 100%)",
        border: `1px solid ${healthMeta.color}33`,
      }}
      bodyStyle={{ padding: 16 }}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <Space size={8} align="center" style={{ marginBottom: 4 }}>
              <Text strong style={{ fontSize: 15 }}>运营参谋</Text>
              <Tag color={healthMeta.tagColor}>{healthMeta.label}</Tag>
            </Space>
            <Paragraph style={{ margin: 0, fontSize: 13, color: "#595959", lineHeight: 1.8 }}>
              {result.summary}
            </Paragraph>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 100 }}>
            <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 2 }}>健康分</div>
            <div style={{ fontSize: 44, fontWeight: 800, color: healthMeta.color, lineHeight: 1 }}>
              {result.healthScore}
            </div>
            <div style={{ fontSize: 11, color: "#8c8c8c" }}>/ 100</div>
          </div>
        </div>

        {result.issues.length > 0 ? (
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            {result.issues.map((issue) => {
              const sevMeta = getSeverityTag(issue.severity);
              return (
                <div
                  key={issue.id}
                  style={{
                    background: "#fff",
                    borderRadius: 8,
                    padding: "12px 14px",
                    border: `1px solid ${sevMeta.color}22`,
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 280 }}>
                    <Space size={8} style={{ marginBottom: 4 }}>
                      <span style={{ color: sevMeta.color, fontSize: 12, fontWeight: 600 }}>{sevMeta.label}</span>
                      <Text strong style={{ fontSize: 13 }}>{issue.title}</Text>
                    </Space>
                    <div style={{ fontSize: 12, color: "#8c8c8c", lineHeight: 1.7 }}>{issue.description}</div>
                  </div>
                  <Button
                    type="primary"
                    icon={<RocketOutlined />}
                    size="small"
                    style={{ background: "#1a73e8", borderColor: "#1a73e8" }}
                    onClick={() => handleGenerateImage(issue)}
                  >
                    AI 生图修复
                  </Button>
                </div>
              );
            })}
          </Space>
        ) : (
          <Alert
            type="success"
            showIcon
            message="当前数据全部达标,没发现需要优化的点"
          />
        )}
      </Space>
    </Card>
  );
}
