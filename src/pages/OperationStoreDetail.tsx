import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Card, Col, Descriptions, Empty, Row, Spin, Statistic, Table, Tag, Typography } from "antd";
import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer } from "recharts";
import { formatMallName, formatStoreNo } from "../utils/storeDisplay";
import { HIDE_RISK, HIDE_ACTIVITY } from "../utils/operationsFlags";

// 单店全景：把一家店（mall_id）散在各处的数据汇成一页。重构后由「各店概览」点店下钻进来。
// 现成接口直接用；品质退货明细 / 抽检 / 财务 / 物流逐节点轨迹 4 块待后端接口，先占位。

const fmtNum = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("zh-CN"));
const fmtMoney = (n: number | null | undefined) => (n == null ? "—" : "¥" + Number(n).toFixed(2));
const fmtTs = (v: string | number | null | undefined) => {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) && n > 1e11 ? new Date(n).toLocaleDateString("zh-CN") : String(v);
};

interface ShopRow {
  mall_id: string; store_code: string | null; mall_name: string | null; owner: string | null;
  sale_volume: number; sale_7d: number; sale_30d: number; on_sale: number; wait_online: number;
  lack_skc: number; advice_prepare_skc: number; about_to_sell_out: number; already_sold_out: number;
  high_price_limit: number; after_sale_ratio_90d: number | null;
}
interface RiskRow { mall_id: string; severity: string | null; risk_type: string | null; title: string | null; status: string | null; skc_id: string | null; quantity: number; }
interface ActRow { mall_id: string; kind: string | null; title: string | null; status: string | null; product_name: string | null; sku_ext_code: string | null; signup_price: number | null; suggested_price: number | null; activity_stock: number; end_at: string | null; }
interface StockRow { mall_id: string; store_code: string | null; sku_ext_code: string | null; product_name: string | null; demand_qty: number; delivered_qty: number; gap: number; shipping_qty: number; inbound_qty: number; latest_ship_at: string | null; warehouse: string | null; }
interface TrendRow { mall_id: string; store_code: string | null; stat_date: string; sales: number; }
interface PanelRow { mall_id: string; product_id: string; title: string | null; total_stock: number | null; lack_qty: number | null; advice: number | null; act_cnt: number; compliance: string | null; limited: boolean; expose: number | null; click: number | null; conv: number | null; }
interface AdRow { mall_id: string; imprCnt: number | null; clkCnt: number | null; ctr: number | null; cvr: number | null; orderPayCnt: number | null; orderPayAmt: number | null; spend: number | null; roas: number | null; acos: number | null; }

const SEV_COLOR: Record<string, string> = { high: "red", medium: "orange", low: "gold" };
const SEV_TEXT: Record<string, string> = { high: "高", medium: "中", low: "低" };
const RISK_TYPE_LABEL: Record<string, string> = { high_price_flow: "高价限流", high_price: "高价限制", violation: "违规", appeal: "申诉", compliance: "合规风险", quality: "质量风险", punish: "处罚" };
const KIND_LABEL: Record<string, string> = { activity: "活动", bidding: "竞价", coupon: "优惠券" };
// 活动状态码：未参加=可报；其余视为已报名/进行中（精确码值待后端确认，先按"有状态即已报"区分）
const isEnrolled = (status: string | null) => !!status && status !== "未参加活动" && status !== "0";

export default function OperationStoreDetail() {
  const { mallId = "" } = useParams<{ mallId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shop, setShop] = useState<ShopRow | null>(null);
  const [risks, setRisks] = useState<RiskRow[]>([]);
  const [acts, setActs] = useState<ActRow[]>([]);
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [panel, setPanel] = useState<PanelRow[]>([]);
  const [ad, setAd] = useState<AdRow | null>(null);

  const load = useCallback(async () => {
    const reports = (window as any).electronAPI?.erp?.reports;
    if (!reports?.shopHealth) { setError("当前版本不支持，请升级桌面端"); setLoading(false); return; }
    setLoading(true); setError(null);
    const mine = <T extends { mall_id: string }>(rows: T[]) => (rows || []).filter((r) => r.mall_id === mallId);
    const pick = async (fn: any): Promise<any[]> => { try { const r = await fn?.({ includeTest: false }); return r?.ok && r.data ? r.data.rows || [] : []; } catch { return []; } };
    try {
      const [sh, rk, ac, st, tr, pn] = await Promise.all([
        pick(reports.shopHealth), pick(reports.riskList), pick(reports.activityList),
        pick(reports.stockOrders), pick(reports.salesTrend), pick(reports.productPanel),
      ]);
      setShop((mine(sh as ShopRow[])[0]) || null);
      setRisks(mine(rk as RiskRow[])); setActs(mine(ac as ActRow[]));
      setStocks(mine(st as StockRow[])); setTrend(mine(tr as TrendRow[])); setPanel(mine(pn as PanelRow[]));
      // 广告（店铺维度，结构特殊）
      try {
        const api = (window as any).electronAPI?.erp?.temuOpenApi;
        const resp = await api?.listRecords?.("ad_report_mall");
        const row = ((resp?.rows || []) as any[]).find((r) => String(r.mall_id) === mallId);
        if (row) {
          const sum = (row.raw && row.raw.summary) || {};
          const g = (k: string) => (sum[k]?.total?.val != null ? Number(sum[k].total.val) : null);
          setAd({ mall_id: mallId, imprCnt: g("imprCnt"), clkCnt: g("clkCnt"), ctr: g("ctr"), cvr: g("cvr"), orderPayCnt: g("orderPayCnt"), orderPayAmt: g("orderPayAmt"), spend: g("spend"), roas: g("roas"), acos: g("acos") });
        } else setAd(null);
      } catch { setAd(null); }
    } catch (e: any) { setError(e?.message || String(e)); } finally { setLoading(false); }
  }, [mallId]);

  useEffect(() => { load(); }, [load]);

  const trendData = useMemo(() => [...trend].sort((a, b) => (a.stat_date < b.stat_date ? -1 : 1)).map((r) => ({ date: r.stat_date, sales: r.sales })), [trend]);
  const highRisk = useMemo(() => risks.filter((r) => r.severity === "high").length, [risks]);
  const actAvailable = useMemo(() => acts.filter((r) => r.sku_ext_code && !isEnrolled(r.status)).length, [acts]);
  const stockGap = useMemo(() => stocks.filter((r) => (r.gap || 0) > 0).length, [stocks]);

  const riskCols: ColumnsType<RiskRow> = [
    { title: "严重度", dataIndex: "severity", width: 70, render: (v: string | null) => <Tag color={SEV_COLOR[v || ""] || "default"}>{SEV_TEXT[v || ""] || v || "—"}</Tag> },
    { title: "类型", dataIndex: "risk_type", width: 90, render: (v: string | null) => RISK_TYPE_LABEL[v || ""] || v || "—" },
    { title: "标题 / 商品", dataIndex: "title", ellipsis: true, render: (v: string | null) => v || "—" },
    { title: "数量", dataIndex: "quantity", width: 70, align: "right", render: fmtNum },
  ];
  const actCols: ColumnsType<ActRow> = [
    { title: "状态", key: "st", width: 90, render: (_, r) => (isEnrolled(r.status) ? <Tag color="green">已报/进行中</Tag> : <Tag color="blue">可报</Tag>) },
    { title: "类型", dataIndex: "kind", width: 70, render: (v: string | null) => KIND_LABEL[v || ""] || v || "—" },
    { title: "商品 / 货号", key: "p", ellipsis: true, render: (_, r) => <span>{r.product_name || r.title || "—"}{r.sku_ext_code ? <Typography.Text type="secondary" style={{ fontSize: 12 }}> · {r.sku_ext_code}</Typography.Text> : null}</span> },
    { title: "原申报价", dataIndex: "signup_price", width: 90, align: "right", render: fmtMoney },
    { title: "活动参考价", dataIndex: "suggested_price", width: 100, align: "right", render: fmtMoney },
    { title: "活动库存", dataIndex: "activity_stock", width: 90, align: "right", render: fmtNum },
    { title: "截止", dataIndex: "end_at", width: 110, render: fmtTs },
  ];
  const stockCols: ColumnsType<StockRow> = [
    { title: "货号", dataIndex: "sku_ext_code", width: 120, render: (v: string | null) => v || "—" },
    { title: "商品", dataIndex: "product_name", ellipsis: true, render: (v: string | null) => v || "—" },
    { title: "需求", dataIndex: "demand_qty", width: 75, align: "right", render: fmtNum },
    { title: "已发", dataIndex: "delivered_qty", width: 75, align: "right", render: fmtNum },
    { title: "缺口", dataIndex: "gap", width: 80, align: "right", render: (v: number) => (v > 0 ? <span style={{ color: "#cf1322", fontWeight: 600 }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "在途", dataIndex: "shipping_qty", width: 75, align: "right", render: fmtNum },
    { title: "最晚发货", dataIndex: "latest_ship_at", width: 120, render: fmtTs },
    { title: "物流单号/状态", key: "logi", width: 130, render: () => <Typography.Text type="secondary" style={{ fontSize: 12 }}>待接入</Typography.Text> },
  ];
  const panelCols: ColumnsType<PanelRow> = [
    { title: "SPU", dataIndex: "product_id", width: 120, render: (v: string) => <Typography.Text style={{ fontSize: 12 }}>{v}</Typography.Text> },
    { title: "商品", dataIndex: "title", ellipsis: true, render: (v: string | null) => v || "—" },
    { title: "总库存", dataIndex: "total_stock", width: 90, align: "right", render: (v: number | null) => <span style={{ color: (v ?? 0) <= 0 ? "#cf1322" : undefined }}>{fmtNum(v)}</span> },
    { title: "缺货", dataIndex: "lack_qty", width: 80, align: "right", render: (v: number | null) => ((v ?? 0) > 0 ? <span style={{ color: "#cf1322" }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "建议备货", dataIndex: "advice", width: 90, align: "right", render: (v: number | null) => ((v ?? 0) > 0 ? <Tag color="blue">{fmtNum(v)}</Tag> : "—") },
    { title: "可报活动", dataIndex: "act_cnt", width: 90, align: "right", render: (v: number) => (v > 0 ? <span style={{ color: "#3f8600" }}>{v} 个</span> : "—") },
    { title: "合规", dataIndex: "compliance", width: 120, render: (v: string | null) => (v ? <Tag color="red">{v}</Tag> : <span style={{ color: "#3f8600" }}>正常</span>) },
    { title: "限流", dataIndex: "limited", width: 80, align: "center", render: (v: boolean) => (v ? <Tag color="volcano">限流</Tag> : "—") },
    { title: "曝光", dataIndex: "expose", width: 80, align: "right", render: (v: number | null) => (v == null ? <span style={{ color: "#ccc" }}>无</span> : fmtNum(v)) },
    { title: "转化", dataIndex: "conv", width: 80, align: "right", render: (v: number | null) => (v == null ? "—" : (v * 100).toFixed(2) + "%") },
  ];

  const placeholder = (title: string, hint: string) => (
    <Card size="small" title={title} style={{ marginBottom: 12 }}>
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ color: "#999", fontSize: 12 }}>{hint}</span>} />
    </Card>
  );

  if (loading) return <div style={{ padding: 48, textAlign: "center" }}><Spin tip="加载单店全景…" /></div>;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/ops-workbench")}>返回</Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {formatStoreNo(shop?.store_code, mallId)}
          <Typography.Text type="secondary" style={{ fontSize: 14, marginLeft: 8 }}>{formatMallName(shop?.mall_name)}</Typography.Text>
        </Typography.Title>
        {shop?.owner ? <Tag color="blue">{shop.owner}</Tag> : null}
        <Button icon={<ReloadOutlined />} onClick={load} style={{ marginLeft: "auto" }}>刷新</Button>
      </div>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}

      <Card size="small" style={{ marginBottom: 12 }}>
        <Row gutter={[16, 12]}>
          <Col span={3}><Statistic title="今日销量" value={shop?.sale_volume ?? 0} /></Col>
          <Col span={3}><Statistic title="7天销量" value={shop?.sale_7d ?? 0} /></Col>
          <Col span={3}><Statistic title="30天销量" value={shop?.sale_30d ?? 0} /></Col>
          <Col span={3}><Statistic title="缺货 SKC" value={shop?.lack_skc ?? 0} valueStyle={{ color: (shop?.lack_skc ?? 0) > 0 ? "#d46b08" : undefined }} /></Col>
          <Col span={3}><Statistic title="即将售罄" value={shop?.about_to_sell_out ?? 0} valueStyle={{ color: (shop?.about_to_sell_out ?? 0) > 0 ? "#d46b08" : undefined }} /></Col>
          <Col span={3}><Statistic title="已售罄" value={shop?.already_sold_out ?? 0} valueStyle={{ color: (shop?.already_sold_out ?? 0) > 0 ? "#cf1322" : undefined }} /></Col>
          {!HIDE_RISK && <Col span={3}><Statistic title="高风险" value={highRisk} valueStyle={{ color: highRisk > 0 ? "#cf1322" : undefined }} /></Col>}
          {!HIDE_ACTIVITY && <Col span={3}><Statistic title="可报活动" value={actAvailable} valueStyle={{ color: "#3f8600" }} /></Col>}
        </Row>
      </Card>

      <Card size="small" title="销量趋势 · 近 30 天" style={{ marginBottom: 12 }}>
        <div style={{ height: 200 }}>
          {trendData.length === 0 ? <Empty description="暂无趋势" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <RTooltip />
                <Line type="monotone" dataKey="sales" name="销量" stroke="#1a73e8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Row gutter={12}>
        <Col span={10}>
          <Card size="small" title="库存健康" style={{ marginBottom: 12 }}>
            <Descriptions column={2} size="small">
              <Descriptions.Item label="在售">{fmtNum(shop?.on_sale)}</Descriptions.Item>
              <Descriptions.Item label="待上架">{fmtNum(shop?.wait_online)}</Descriptions.Item>
              <Descriptions.Item label="缺货 SKC">{fmtNum(shop?.lack_skc)}</Descriptions.Item>
              <Descriptions.Item label="建议备货 SKC">{fmtNum(shop?.advice_prepare_skc)}</Descriptions.Item>
              <Descriptions.Item label="即将售罄">{fmtNum(shop?.about_to_sell_out)}</Descriptions.Item>
              <Descriptions.Item label="已售罄">{fmtNum(shop?.already_sold_out)}</Descriptions.Item>
              <Descriptions.Item label="高价限制">{fmtNum(shop?.high_price_limit)}</Descriptions.Item>
              <Descriptions.Item label="品质售后率">{shop?.after_sale_ratio_90d == null ? "—" : (shop.after_sale_ratio_90d * 100).toFixed(2) + "%"}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        {!HIDE_RISK && (<Col span={14}>
          <Card size="small" title={`风险与违规 · ${risks.length}`} style={{ marginBottom: 12 }}>
            <Table<RiskRow> dataSource={risks} columns={riskCols} rowKey={(_, i) => String(i)} size="small" pagination={{ pageSize: 5, hideOnSinglePage: true }} locale={{ emptyText: "无风险" }} />
          </Card>
        </Col>)}
      </Row>

      <Card size="small" title={`商品明细 & 诊断 · ${panel.length} 个 SPU`} style={{ marginBottom: 12 }}>
        <Table<PanelRow> dataSource={panel} columns={panelCols} rowKey={(r) => r.product_id} size="small" scroll={{ x: 1000 }} pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 个商品` }} />
      </Card>

      {!HIDE_ACTIVITY && (<Card size="small" title={`活动 · 可报 ${actAvailable} / 共 ${acts.filter((a) => a.sku_ext_code).length}`} style={{ marginBottom: 12 }}>
        <Table<ActRow> dataSource={acts.filter((a) => a.sku_ext_code)} columns={actCols} rowKey={(_, i) => String(i)} size="small" scroll={{ x: 900 }} pagination={{ defaultPageSize: 10, showSizeChanger: true }} locale={{ emptyText: "无活动" }} />
      </Card>)}

      <Card size="small" title={`备货 · 在途 · 缺口 ${stockGap}`} style={{ marginBottom: 12 }}>
        <Table<StockRow> dataSource={stocks} columns={stockCols} rowKey={(_, i) => String(i)} size="small" scroll={{ x: 900 }} pagination={{ defaultPageSize: 10, showSizeChanger: true }} locale={{ emptyText: "无未完成备货/发货单" }} />
      </Card>

      <Card size="small" title="流量 / 广告（近 7 天）" style={{ marginBottom: 12 }}>
        {ad ? (
          <Descriptions column={5} size="small">
            <Descriptions.Item label="曝光">{fmtNum(ad.imprCnt)}</Descriptions.Item>
            <Descriptions.Item label="点击">{fmtNum(ad.clkCnt)}</Descriptions.Item>
            <Descriptions.Item label="点击率">{ad.ctr == null ? "—" : (ad.ctr / 100).toFixed(2) + "%"}</Descriptions.Item>
            <Descriptions.Item label="转化率">{ad.cvr == null ? "—" : (ad.cvr / 100).toFixed(2) + "%"}</Descriptions.Item>
            <Descriptions.Item label="子订单">{fmtNum(ad.orderPayCnt)}</Descriptions.Item>
            <Descriptions.Item label="销售额">{ad.orderPayAmt == null ? "—" : "¥" + (ad.orderPayAmt / 100).toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="花费">{ad.spend == null ? "—" : "¥" + (ad.spend / 100).toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="ROAS">{ad.roas == null ? "—" : (ad.roas / 1000).toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="费比">{ad.acos == null ? "—" : (ad.acos / 100).toFixed(2) + "%"}</Descriptions.Item>
          </Descriptions>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该店无投放或未签广告协议" />}
      </Card>

      <Row gutter={12}>
        <Col span={12}>{placeholder("品质退货明细", "数据源 temu_after_sale_snapshot，待加后端接口")}</Col>
        <Col span={12}>{placeholder("抽检记录", "数据源 erp_qc_inspections（按 SKU→店 关联），待加后端接口")}</Col>
      </Row>
      <Row gutter={12}>
        <Col span={12}>{placeholder("财务 / 利润", "销售额·成本·毛利率，待加后端接口")}</Col>
        <Col span={12}>{placeholder("物流逐节点轨迹", "揽收→运输→签收 流水，待对接 Temu 物流轨迹采集")}</Col>
      </Row>
    </div>
  );
}
