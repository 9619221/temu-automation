/**
 * 流量分析 - 顶级运营助手面板
 *
 * 渲染：告警条 / 决策板 / 诊断分层表 / 流量来源 / 跨站可复制 / 价格弹性候选
 */
import { useMemo, useState } from "react";
import { Alert, Card, Empty, Segmented, Space, Table, Tag, Tooltip, Typography } from "antd";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip as RTooltip, XAxis, YAxis,
} from "recharts";
import {
  buildOperatorReport,
  DECISION_COLOR,
  BOTTLENECK_COLOR,
  REGION_TO_SITE,
  type DiagnosisRow,
  type OperatorReport,
  type RegionKey,
  type Decision,
  type SiteName,
} from "../utils/fluxOperator";

const { Text, Paragraph } = Typography;

interface Props {
  cache: Record<string, any> | null;
  region: RegionKey;
  onRegionChange: (region: RegionKey) => void;
}

const fmtPct = (v: number, digits = 1) => `${(v ?? 0).toFixed(digits)}%`;
const fmtInt = (v: number) => (v ?? 0).toLocaleString();

const decisionTag = (d: Decision) => (
  <Tag color={DECISION_COLOR[d]} style={{ fontWeight: 600, border: "none" }}>
    {d}
  </Tag>
);

const FluxOperatorPanel: React.FC<Props> = ({ cache, region, onRegionChange }) => {
  const report: OperatorReport = useMemo(() => buildOperatorReport(cache), [cache]);
  const [bottleneckFilter, setBottleneckFilter] = useState<string>("全部");
  const [decisionFilter, setDecisionFilter] = useState<string>("全部");

  const site: SiteName = REGION_TO_SITE[region];
  const siteRows = useMemo(
    () => report.rows.filter((r) => r.site === site),
    [report.rows, site],
  );
  const filteredRows = useMemo(() => {
    return siteRows.filter((r) => {
      if (bottleneckFilter !== "全部" && r.bottleneck !== bottleneckFilter) return false;
      if (decisionFilter !== "全部" && r.decision !== decisionFilter) return false;
      return true;
    });
  }, [siteRows, bottleneckFilter, decisionFilter]);

  const benchmark = report.benchmarks[site];
  const decisionCounts = useMemo(() => {
    const acc: Record<Decision, number> = {
      加仓: 0, 优化: 0, 维持: 0, 减仓: 0, 清退: 0, 观察: 0,
    };
    siteRows.forEach((r) => acc[r.decision]++);
    return acc;
  }, [siteRows]);

  const siteAlerts = report.alerts.filter((a) => a.site === site);
  const siteCrossSite = report.crossSite.filter(
    (c) => c.winnerSite === site || c.loserSite === site,
  );
  const sitePriceCandidates = report.priceCandidates.filter((p) => p.site === site);
  const sourceMixData = report.sourceMix;

  if (!cache || !report.rows.length) {
    return (
      <Card>
        <Empty
          description={
            <div>
              <div style={{ marginBottom: 8 }}>暂无商品级流量数据</div>
              <Text type="secondary">流量数据由浏览器扩展自动采集，请确认 Temu 后台页面已打开，稍后刷新即可。</Text>
            </div>
          }
        />
      </Card>
    );
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* ========= 区域切换 ========= */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <Space size={8} wrap>
          <Text strong style={{ fontSize: 16 }}>🧭 运营助手</Text>
          <Text type="secondary">基于 {report.rows.length} 条 商品×站点 数据，更新于 {new Date(report.generatedAt).toLocaleString("zh-CN")}</Text>
        </Space>
        <Segmented
          value={region}
          onChange={(v) => onRegionChange(v as RegionKey)}
          options={[
            { label: "🌍 全球", value: "global" },
            { label: "🇺🇸 美国", value: "us" },
            { label: "🇪🇺 欧盟", value: "eu" },
          ]}
        />
      </div>

      {/* ========= 顶部告警 ========= */}
      {siteAlerts.length > 0 && (
        <Alert
          type={siteAlerts.some((a) => a.level === "danger") ? "error" : "warning"}
          showIcon
          message={`本站点检测到 ${siteAlerts.length} 条异常`}
          description={
            <div style={{ maxHeight: 130, overflowY: "auto" }}>
              {siteAlerts.slice(0, 8).map((a, i) => (
                <div key={i} style={{ fontSize: 13, padding: "2px 0" }}>
                  <Tag color={a.level === "danger" ? "red" : "orange"}>{a.level === "danger" ? "严重" : "预警"}</Tag>
                  <span style={{ marginRight: 6 }}>【{a.title?.slice(0, 24) ?? a.goodsId}】</span>
                  {a.text}
                </div>
              ))}
            </div>
          }
        />
      )}

      {/* ========= 决策板 ========= */}
      <Card title={`📊 决策面板（${site}）`} size="small">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
          {(Object.keys(decisionCounts) as Decision[]).map((d) => (
            <Card
              key={d}
              size="small"
              hoverable
              onClick={() => setDecisionFilter(decisionFilter === d ? "全部" : d)}
              style={{
                textAlign: "center",
                borderColor: decisionFilter === d ? DECISION_COLOR[d] : "#f0f0f0",
                borderWidth: decisionFilter === d ? 2 : 1,
              }}
              styles={{ body: { padding: "12px 8px" } }}
            >
              <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 4 }}>{d}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: DECISION_COLOR[d] }}>
                {decisionCounts[d]}
              </div>
            </Card>
          ))}
        </div>
        {benchmark && (
          <div style={{ marginTop: 12, padding: "8px 12px", background: "#f8fbff", borderRadius: 8, fontSize: 12, color: "#595959" }}>
            <Text type="secondary">站点中位数基准 — </Text>
            CTR <b>{fmtPct(benchmark.ctrMedian, 2)}</b>
            <span style={{ margin: "0 8px" }}>·</span>
            点击支付率 <b>{fmtPct(benchmark.clickPayMedian)}</b>
            <span style={{ margin: "0 8px" }}>·</span>
            加购→买家 <b>{fmtPct(benchmark.cartToBuyMedian)}</b>
            <span style={{ margin: "0 8px" }}>·</span>
            曝光中位 <b>{fmtInt(benchmark.exposeMedian)}</b>
          </div>
        )}
      </Card>

      {/* ========= 流量来源拆分 ========= */}
      <Card title="🚦 流量来源结构（搜索 vs 推荐）" size="small">
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={sourceMixData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="site" />
              <YAxis tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
              <RTooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Legend />
              <Bar dataKey="search" name="搜索" stackId="a" fill="#1a73e8" />
              <Bar dataKey="recommend" name="推荐" stackId="a" fill="#1a73e8" />
              <Bar dataKey="other" name="其它" stackId="a" fill="#bfbfbf" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 4 }}>
          策略提示：搜索占比 &gt; 40% → 加大搜索词投放；推荐占比 &gt; 70% → 标题/属性需重写以激活搜索流量。
        </div>
      </Card>

      {/* ========= 诊断分层表 ========= */}
      <Card
        title={`🔬 诊断分层表 — ${site}（${filteredRows.length} / ${siteRows.length}）`}
        size="small"
        extra={
          <Space size={8} wrap>
            <Segmented
              size="small"
              value={bottleneckFilter}
              onChange={(v) => setBottleneckFilter(v as string)}
              options={["全部", "曝光不足", "点击率低", "加购率低", "支付转化低", "全链路健康"]}
            />
          </Space>
        }
      >
        <Table<DiagnosisRow>
          dataSource={filteredRows.map((r) => ({ ...r, key: `${r.goodsId}-${r.site}` }))}
          size="small"
          pagination={{ pageSize: 10, showSizeChanger: false }}
          scroll={{ x: 1300 }}
          columns={[
            {
              title: "商品",
              dataIndex: "title",
              key: "title",
              width: 220,
              ellipsis: true,
              render: (t: string, r) => (
                <Tooltip title={`${t} (ID: ${r.goodsId})`}>
                  <span style={{ fontSize: 12 }}>{t}</span>
                </Tooltip>
              ),
            },
            {
              title: "曝光",
              dataIndex: "expose",
              key: "expose",
              width: 90,
              align: "right",
              sorter: (a, b) => a.expose - b.expose,
              render: (v) => fmtInt(v),
            },
            {
              title: "点击",
              dataIndex: "click",
              key: "click",
              width: 80,
              align: "right",
              sorter: (a, b) => a.click - b.click,
              render: (v) => fmtInt(v),
            },
            {
              title: "CTR",
              dataIndex: "ctr",
              key: "ctr",
              width: 80,
              align: "right",
              sorter: (a, b) => a.ctr - b.ctr,
              render: (v: number, r) => {
                const bm = report.benchmarks[r.site];
                const low = bm && v < bm.ctrMedian * 0.6;
                return <span style={{ color: low ? "#fa541c" : undefined }}>{fmtPct(v, 2)}</span>;
              },
            },
            {
              title: "加购",
              dataIndex: "addCart",
              key: "addCart",
              width: 70,
              align: "right",
              sorter: (a, b) => a.addCart - b.addCart,
            },
            {
              title: "买家",
              dataIndex: "buyer",
              key: "buyer",
              width: 70,
              align: "right",
              sorter: (a, b) => a.buyer - b.buyer,
            },
            {
              title: "点击支付率",
              dataIndex: "clickPayRate",
              key: "clickPayRate",
              width: 110,
              align: "right",
              sorter: (a, b) => a.clickPayRate - b.clickPayRate,
              render: (v: number, r) => {
                const bm = report.benchmarks[r.site];
                const low = bm && v < bm.clickPayMedian * 0.6;
                return <span style={{ color: low ? "#fa541c" : v > 5 ? "#00b96b" : undefined, fontWeight: 600 }}>{fmtPct(v)}</span>;
              },
            },
            {
              title: "搜索/推荐",
              key: "source",
              width: 130,
              render: (_, r) => (
                <span style={{ fontSize: 12 }}>
                  <Tag color="blue" style={{ marginRight: 4 }}>搜 {fmtPct(r.searchPct, 0)}</Tag>
                  <Tag color="orange">推 {fmtPct(r.recommendPct, 0)}</Tag>
                </span>
              ),
            },
            {
              title: "曝光趋势",
              dataIndex: "exposeSlope",
              key: "exposeSlope",
              width: 100,
              align: "right",
              sorter: (a, b) => a.exposeSlope - b.exposeSlope,
              render: (v: number) => {
                const color = v >= 15 ? "#00b96b" : v <= -25 ? "#ea4335" : "#8c8c8c";
                const arrow = v >= 5 ? "↑" : v <= -5 ? "↓" : "→";
                return <span style={{ color }}>{arrow} {v >= 0 ? "+" : ""}{v.toFixed(0)}%</span>;
              },
            },
            {
              title: "瓶颈",
              dataIndex: "bottleneck",
              key: "bottleneck",
              width: 100,
              filters: ["曝光不足", "点击率低", "加购率低", "支付转化低", "全链路健康", "数据缺失"].map((b) => ({ text: b, value: b })),
              onFilter: (v, r) => r.bottleneck === v,
              render: (b) => <Tag color={BOTTLENECK_COLOR[b as keyof typeof BOTTLENECK_COLOR]} style={{ border: "none" }}>{b}</Tag>,
            },
            {
              title: "决策",
              dataIndex: "decision",
              key: "decision",
              width: 90,
              fixed: "right",
              filters: (Object.keys(DECISION_COLOR) as Decision[]).map((d) => ({ text: d, value: d })),
              onFilter: (v, r) => r.decision === v,
              render: (d: Decision) => decisionTag(d),
            },
          ]}
          expandable={{
            expandedRowRender: (r) => (
              <div style={{ padding: "8px 12px", background: "#f8fbff" }}>
                <Paragraph style={{ marginBottom: 4 }}>
                  <Text strong>建议：</Text>{r.decisionReason}
                </Paragraph>
                <div style={{ fontSize: 12, color: "#595959", display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <span>详情→加购 {fmtPct(r.visitToCartRate)}</span>
                  <span>加购→买家 {fmtPct(r.cartToBuyRate)}</span>
                  <span>曝光支付率 {fmtPct(r.exposePayRate, 3)}</span>
                  <span>点击支付率趋势 {r.clickPaySlope >= 0 ? "+" : ""}{r.clickPaySlope.toFixed(0)}%</span>
                  <span>样本天数 {r.days}</span>
                </div>
              </div>
            ),
          }}
        />
      </Card>

      {/* ========= 跨站可复制清单 ========= */}
      <Card title={`🔁 跨站可复制（赢家平移到弱站）— 涉及 ${site} 的 ${siteCrossSite.length} 条`} size="small">
        {siteCrossSite.length === 0 ? (
          <Empty description="暂无跨站机会，需多站点都有数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table
            dataSource={siteCrossSite.slice(0, 20).map((c, i) => ({ ...c, key: `${c.goodsId}-${i}` }))}
            size="small"
            pagination={false}
            columns={[
              { title: "商品", dataIndex: "title", key: "title", ellipsis: true, width: 240 },
              { title: "赢家站", dataIndex: "winnerSite", key: "winnerSite", width: 80, render: (s) => <Tag color="green">{s}</Tag> },
              { title: "赢家点击支付率", dataIndex: "winnerCpc", key: "winnerCpc", width: 130, render: (v) => <b style={{ color: "#00b96b" }}>{fmtPct(v)}</b> },
              { title: "弱站", dataIndex: "loserSite", key: "loserSite", width: 80, render: (s) => <Tag color="red">{s}</Tag> },
              { title: "弱站点击支付率", dataIndex: "loserCpc", key: "loserCpc", width: 130, render: (v) => <span style={{ color: "#fa541c" }}>{fmtPct(v)}</span> },
              { title: "差距", dataIndex: "cpcGap", key: "cpcGap", width: 80, render: (v) => `+${v.toFixed(1)}pp` },
              { title: "建议", dataIndex: "hint", key: "hint", ellipsis: true },
            ]}
          />
        )}
      </Card>

      {/* ========= 价格弹性候选 ========= */}
      <Card title={`💰 价格弹性测试候选 — ${site}（${sitePriceCandidates.length}）`} size="small">
        {sitePriceCandidates.length === 0 ? (
          <Empty description="无低于站点中位数 50% 的商品，价格结构健康" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table
            dataSource={sitePriceCandidates.slice(0, 15).map((p, i) => ({ ...p, key: `${p.goodsId}-${i}` }))}
            size="small"
            pagination={false}
            columns={[
              { title: "商品", dataIndex: "title", key: "title", ellipsis: true, width: 260 },
              { title: "点击数", dataIndex: "click", key: "click", width: 90, align: "right", render: fmtInt },
              { title: "点击支付率", dataIndex: "clickPayRate", key: "clickPayRate", width: 110, align: "right", render: (v) => <span style={{ color: "#fa541c", fontWeight: 600 }}>{fmtPct(v)}</span> },
              { title: "站点中位", dataIndex: "median", key: "median", width: 110, align: "right", render: (v) => fmtPct(v) },
              { title: "建议动作", dataIndex: "hint", key: "hint", ellipsis: true },
            ]}
          />
        )}
      </Card>
    </Space>
  );
};

export default FluxOperatorPanel;
