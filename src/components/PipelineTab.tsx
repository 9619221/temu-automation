import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Empty, Image, Input, Segmented, Select, Spin, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  RightOutlined, WarningOutlined, ShoppingCartOutlined,
  InboxOutlined, RocketOutlined, ShopOutlined, PlusOutlined, AlertOutlined,
  FireOutlined, SearchOutlined, EyeOutlined, RiseOutlined, FallOutlined,
  AppstoreOutlined, UnorderedListOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

interface PipelineSkuRow {
  sku_id: string;
  sku_code: string;
  name: string | null;
  image: string | null;
  stage: string;
  today_sales: number | null;
  w7_sales: number | null;
  m30_sales: number | null;
  warehouse_stock: number | null;
  advice_qty: number | null;
  local_available: number;
  local_reserved: number;
  review_count: number;
  avg_score: number | null;
  bad_reviews: number;
  return_count: number;
  risk_tags: string[];
  // ── 体检卡扩展字段(后端 buildPipelineOverviewFast) ──
  product_id?: string;
  store_code?: string | null;
  mall_name?: string | null;
  occupy?: number | null;
  unavail?: number | null;
  shipping?: number | null;
  total_stock?: number | null;
  lack_qty?: number | null;
  hot_tag?: boolean;
  has_hot_sku?: boolean;
  onsales_duration?: number | null;
  expose?: number | null;
  click?: number | null;
  conv?: number | null;
  grow?: string | null;
  limited?: boolean;
  act_cnt?: number | null;
  act_min_price?: number | null;
  declared_price?: number | null;
  compliance?: string | null;
  lifecycle_status?: string | null;
  qc_bad?: number | null;
  qc_defective?: number | null;
}

interface YunqiSelectionItem {
  goods_id: string;
  title_zh: string;
  main_image: string;
  usd_price: number;
  category_zh: string;
  status: string;
}

type UnifiedItem = {
  id: string;
  name: string;
  image: string | null;
  code: string;
  stage: string;
  stageIdx: number;
  source: "erp" | "yunqi";
  todaySales: number;
  sales7d: number;
  sales30d: number;
  stock: number;
  riskTags: string[];
  adviceQty: number;
  reviewScore: number | null;
  reviewCount: number;
  badReviews: number;
  returnCount: number;
  // ── 体检卡扩展(erp 源填充,yunqi 源留空) ──
  store?: string | null;
  occupy?: number;
  unavail?: number;
  shipping?: number;
  totalStock?: number | null;
  lackQty?: number;
  hotTag?: boolean;
  hasHotSku?: boolean;
  onsalesDuration?: number | null;
  expose?: number | null;
  click?: number | null;
  conv?: number | null;
  grow?: string | null;
  limited?: boolean;
  actCnt?: number;
  actMinPrice?: number | null;
  declaredPrice?: number | null;
  compliance?: string | null;
  lifecycleStatus?: string | null;
  qcBad?: number;
  qcDefective?: number;
};

/* ================================================================== */
/*  Stage / tone metadata                                              */
/* ================================================================== */

const STAGES = [
  { key: "selected",      label: "选品",   color: "#8c8c8c", icon: <PlusOutlined /> },
  { key: "listing",       label: "上品中", color: "#722ed1", icon: <RocketOutlined /> },
  { key: "pricing",       label: "核价",   color: "#fa8c16", icon: <AlertOutlined />,        nav: "/price-review",     navLabel: "去核价" },
  { key: "created",       label: "已建品", color: "#1890ff", icon: <PlusOutlined />,         nav: "/purchase-center",  navLabel: "去采购" },
  { key: "purchasing",    label: "采购中", color: "#13c2c2", icon: <ShoppingCartOutlined /> },
  { key: "inbound",       label: "入库中", color: "#52c41a", icon: <InboxOutlined /> },
  { key: "in_stock",      label: "有库存", color: "#2f54eb", icon: <InboxOutlined />,        nav: "/qc-outbound",      navLabel: "去出库" },
  { key: "selling",       label: "在售",   color: "#52c41a", icon: <ShopOutlined /> },
  { key: "needs_restock", label: "需补货", color: "#f5222d", icon: <WarningOutlined />,      nav: "/auto-purchase",    navLabel: "去备货" },
];

type StageDef = { key: string; label: string; color: string; icon: React.ReactNode; nav?: string; navLabel?: string };
const STAGE_IDX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));
const STAGE_META: Record<string, StageDef> = Object.fromEntries(STAGES.map(s => [s.key, s]));

// 三色语义系统:danger=必须处理 / warning=关注 / neutral=正常 / progress=流转中
type Tone = "danger" | "warning" | "neutral" | "progress";
const STAGE_TONE: Record<string, Tone> = {
  needs_restock: "danger",
  pricing:       "warning",
  in_stock:      "warning",  // 有库存=可出库,提示性
  selling:       "neutral",
  inbound:       "progress",
  purchasing:    "progress",
  created:       "progress",
  listing:       "progress",
  selected:      "neutral",
};
const TONE_COLOR: Record<Tone, string> = {
  danger:   "#f5222d",
  warning:  "#fa8c16",
  neutral:  "#8c8c8c",
  progress: "#1677ff",
};

// 待处理 = 有操作入口的阶段
const TODO_STAGES = new Set(STAGES.filter(s => s.nav).map(s => s.key));

// 空态阶段提示文案(没销量/没库存时显示,避免卡片留白)
const STAGE_HINT: Record<string, string> = {
  selected:      "已加入选品池,待上架",
  listing:       "正在上品,处理中",
  pricing:       "等待核价",
  created:       "商品已建立,等待采购下单",
  purchasing:    "采购单已下,等待发货",
  inbound:       "在途/入库中",
  in_stock:      "本地有库存,等待出库",
  selling:       "在售中",
  needs_restock: "库存不足,需要补货",
};

const RISK_LABELS: Record<string, { text: string; color: string }> = {
  low_score:        { text: "低评分",   color: "red" },
  many_bad_reviews: { text: "差评多",   color: "red" },
  high_return_rate: { text: "退货率高", color: "volcano" },
  stock_out:        { text: "缺货",     color: "orange" },
  urgent_restock:   { text: "紧急补货", color: "red" },
  limited:          { text: "高价限流", color: "volcano" },
  qc_fail:          { text: "抽检不合格", color: "red" },
  compliance:       { text: "合规风险", color: "gold" },
};

const SORT_OPTIONS = [
  { value: "priority",   label: "按优先级" },
  { value: "sales7d",    label: "按7日销量" },
  { value: "sales30d",   label: "按30日销量" },
  { value: "stock_asc",  label: "按库存(低→高)" },
  { value: "advice",     label: "按建议补货量" },
  { value: "score_asc",  label: "按评分(低→高)" },
];

const PRIORITY: Record<string, number> = {
  needs_restock: 0, selling: 1, in_stock: 2, inbound: 3,
  purchasing: 4, created: 5, pricing: 6, listing: 7, selected: 8,
};

/* 演示数据已移除:本组件直接读后端 pipelineOverview + 云栖选品,无需占位数据 */

/* ================================================================== */
/*  Main component                                                     */
/* ================================================================== */

export default function PipelineTab({ reloadSignal }: { reloadSignal?: number } = {}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [erpStages, setErpStages] = useState<Record<string, PipelineSkuRow[]>>({});
  const [yunqiItems, setYunqiItems] = useState<YunqiSelectionItem[]>([]);
  const [filter, setFilter] = useState<string>("all");           // all | risk | todo | <stageKey>
  const [stageFilter, setStageFilter] = useState<string>("");    // 二级:单选阶段
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("priority");
  const [view, setView] = useState<"card" | "table">("card");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [erpResp, yunqiResp] = await Promise.all([
        window.electronAPI?.erp?.reports?.pipelineOverview?.({ force: false }).catch(() => null),
        window.electronAPI?.yunqiDb?.selectionList?.({ status: "" }).catch(() => null),
      ]);
      setErpStages(erpResp?.ok && erpResp.data ? (erpResp.data.stages || {}) : {});
      const yr = Array.isArray(yunqiResp) ? yunqiResp : yunqiResp?.rows || [];
      setYunqiItems(yr as YunqiSelectionItem[]);
    } catch {
      setErpStages({});
      setYunqiItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // 顶部页面级「刷新」触发:reloadSignal 变化时重新加载(初始为 0,跳过)
  useEffect(() => { if (reloadSignal) load(); }, [reloadSignal, load]);

  const unified = useMemo<UnifiedItem[]>(() => {
    const items: UnifiedItem[] = [];
    for (const [stage, rows] of Object.entries(erpStages)) {
      for (const r of rows) {
        items.push({
          id: r.sku_id, name: r.name || r.sku_code, image: r.image, code: r.sku_code,
          stage, stageIdx: STAGE_IDX[stage] ?? 99, source: "erp",
          todaySales: r.today_sales || 0, sales7d: r.w7_sales || 0, sales30d: r.m30_sales || 0,
          stock: r.warehouse_stock || r.local_available || 0,
          riskTags: r.risk_tags || [], adviceQty: r.advice_qty || 0,
          reviewScore: r.avg_score, reviewCount: r.review_count || 0,
          badReviews: r.bad_reviews || 0, returnCount: r.return_count || 0,
          store: r.store_code || r.mall_name || null,
          occupy: r.occupy || 0, unavail: r.unavail || 0, shipping: r.shipping || 0,
          totalStock: r.total_stock ?? null, lackQty: r.lack_qty || 0,
          hotTag: !!r.hot_tag, hasHotSku: !!r.has_hot_sku, onsalesDuration: r.onsales_duration ?? null,
          expose: r.expose ?? null, click: r.click ?? null, conv: r.conv ?? null, grow: r.grow ?? null,
          limited: !!r.limited, actCnt: r.act_cnt || 0, actMinPrice: r.act_min_price ?? null,
          declaredPrice: r.declared_price ?? null, compliance: r.compliance ?? null,
          lifecycleStatus: r.lifecycle_status ?? null,
          qcBad: r.qc_bad || 0, qcDefective: r.qc_defective || 0,
        });
      }
    }
    for (const y of yunqiItems) {
      if (y.status === "listed" || y.status === "dropped") continue;
      const stage = y.status === "listing" ? "listing" : "selected";
      items.push({
        id: y.goods_id, name: y.title_zh || y.goods_id, image: y.main_image || null, code: y.goods_id,
        stage, stageIdx: STAGE_IDX[stage] ?? 99, source: "yunqi",
        todaySales: 0, sales7d: 0, sales30d: 0, stock: 0,
        riskTags: [], adviceQty: 0, reviewScore: null, reviewCount: 0, badReviews: 0, returnCount: 0,
      });
    }
    return items;
  }, [erpStages, yunqiItems]);

  const stageCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of STAGES) m[s.key] = 0;
    for (const item of unified) m[item.stage] = (m[item.stage] || 0) + 1;
    return m;
  }, [unified]);

  const stats = useMemo(() => {
    let todaySales = 0, riskCount = 0, restockCount = 0, stockOutCount = 0, todoCount = 0;
    for (const item of unified) {
      todaySales += item.todaySales;
      if (item.riskTags.length > 0) riskCount++;
      if (item.stage === "needs_restock") restockCount++;
      if (item.riskTags.includes("stock_out")) stockOutCount++;
      if (TODO_STAGES.has(item.stage)) todoCount++;
    }
    return { total: unified.length, todaySales, riskCount, restockCount, stockOutCount, todoCount };
  }, [unified]);

  const displayed = useMemo(() => {
    let list: UnifiedItem[];
    if (filter === "all") list = [...unified];
    else if (filter === "risk") list = unified.filter(i => i.riskTags.length > 0);
    else if (filter === "todo") list = unified.filter(i => TODO_STAGES.has(i.stage));
    else list = unified.filter(i => i.stage === filter);

    if (stageFilter) list = list.filter(i => i.stage === stageFilter);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q));
    }

    const cmp: Record<string, (a: UnifiedItem, b: UnifiedItem) => number> = {
      priority:  (a, b) => (PRIORITY[a.stage] ?? 99) - (PRIORITY[b.stage] ?? 99) || b.sales7d - a.sales7d,
      sales7d:   (a, b) => b.sales7d - a.sales7d,
      sales30d:  (a, b) => b.sales30d - a.sales30d,
      stock_asc: (a, b) => a.stock - b.stock,
      advice:    (a, b) => b.adviceQty - a.adviceQty,
      score_asc: (a, b) => (a.reviewScore ?? 99) - (b.reviewScore ?? 99),
    };
    list.sort(cmp[sortBy] || cmp.priority);
    return list;
  }, [unified, filter, stageFilter, search, sortBy]);

  return (
    <div style={{ padding: "12px 16px" }}>
      {/* ── 顶部 KPI 条(扁平,36px) ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 24, padding: "8px 14px", marginBottom: 10, background: "#fafbfc", border: "1px solid #f0f0f0", borderRadius: 6 }}>
        <MiniKpi label="在管商品"  value={stats.total}        tone="neutral" />
        <Divider />
        <MiniKpi label="今日销量"  value={stats.todaySales}   tone="neutral" />
        <Divider />
        <MiniKpi label="待处理"    value={stats.todoCount}    tone="progress" alert={stats.todoCount > 0} onClick={() => { setFilter("todo"); setStageFilter(""); }} />
        <Divider />
        <MiniKpi label="需补货"    value={stats.restockCount} tone="danger"   alert={stats.restockCount > 0} onClick={() => { setFilter("needs_restock"); setStageFilter(""); }} />
        <Divider />
        <MiniKpi label="缺货"      value={stats.stockOutCount} tone="danger"  alert={stats.stockOutCount > 0} />
        <Divider />
        <MiniKpi label="有风险"    value={stats.riskCount}    tone="warning"  alert={stats.riskCount > 0} onClick={() => { setFilter("risk"); setStageFilter(""); }} />
      </div>

      {/* ── 阶段进度条(总览) ── */}
      <div style={{ display: "flex", borderRadius: 4, overflow: "hidden", marginBottom: 12, height: 4, background: "#f0f0f0" }}>
        {STAGES.map(s => {
          const cnt = stageCounts[s.key] || 0;
          if (!cnt) return null;
          const pct = stats.total > 0 ? Math.max(cnt / stats.total * 100, 2) : 0;
          return (
            <Tooltip key={s.key} title={`${s.label}: ${cnt}`}>
              <div style={{ width: `${pct}%`, background: s.color, transition: "width 0.3s" }} />
            </Tooltip>
          );
        })}
      </div>

      {/* ── 工具栏:两层筛选 + 视图切换 + 搜索 + 排序 ── */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <Segmented
          size="small"
          value={filter === "all" || filter === "risk" || filter === "todo" ? filter : "all"}
          onChange={(v) => { setFilter(String(v)); setStageFilter(""); }}
          options={[
            { label: `全部 ${stats.total}`,        value: "all" },
            { label: `待处理 ${stats.todoCount}`,  value: "todo" },
            { label: `风险 ${stats.riskCount}`,    value: "risk" },
          ]}
        />
        <Select
          size="small"
          style={{ width: 140 }}
          allowClear
          placeholder="按阶段筛选"
          value={stageFilter || undefined}
          onChange={(v) => setStageFilter(v || "")}
          options={STAGES.filter(s => stageCounts[s.key] > 0).map(s => ({ value: s.key, label: `${s.label} (${stageCounts[s.key]})` }))}
        />
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <Input
            placeholder="搜索商品名/编码"
            prefix={<SearchOutlined style={{ color: "#bbb" }} />}
            size="small"
            style={{ width: 180 }}
            allowClear
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <Select size="small" style={{ width: 140 }} value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />
          <Segmented
            size="small"
            value={view}
            onChange={(v) => setView(v as "card" | "table")}
            options={[
              { value: "card",  icon: <AppstoreOutlined /> },
              { value: "table", icon: <UnorderedListOutlined /> },
            ]}
          />
        </div>
      </div>

      {/* ── 内容区 ── */}
      <Spin spinning={loading}>
        {displayed.length === 0 ? (
          <Empty description={search ? "无匹配结果" : "该范围暂无商品"} style={{ padding: "40px 0" }} />
        ) : view === "card" ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
              {displayed.slice(0, 120).map(item => (
                <ProductCard key={item.id} item={item} navigate={navigate} />
              ))}
            </div>
            {displayed.length > 120 && (
              <div style={{ textAlign: "center", color: "#999", marginTop: 12, fontSize: 12 }}>
                仅显示前 120 个,请使用筛选或搜索缩小范围
              </div>
            )}
            <div style={{ textAlign: "right", color: "#bbb", fontSize: 11, marginTop: 8 }}>
              共 {displayed.length} 个商品
            </div>
          </>
        ) : (
          <ProductTable items={displayed} navigate={navigate} />
        )}
      </Spin>
    </div>
  );
}

/* ================================================================== */
/*  MiniKpi — 顶部紧凑指标                                              */
/* ================================================================== */

function MiniKpi({ label, value, tone, alert, onClick }: {
  label: string; value: number; tone: Tone; alert?: boolean; onClick?: () => void;
}) {
  const color = alert ? TONE_COLOR[tone] : "#333";
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "baseline", gap: 6,
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
      }}
    >
      <span style={{ fontSize: 13, color: "#888" }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 18, background: "#e8e8e8" }} />;
}

/* ================================================================== */
/*  ProductCard                                                        */
/* ================================================================== */

function ProductCard({ item, navigate }: { item: UnifiedItem; navigate: ReturnType<typeof useNavigate> }) {
  const meta = STAGE_META[item.stage];
  const tone = STAGE_TONE[item.stage] || "neutral";
  const toneColor = TONE_COLOR[tone];
  const hasRisk = item.riskTags.length > 0;
  const isUrgent = item.stage === "needs_restock";

  const hasSales = (item.todaySales + item.sales7d + item.sales30d) > 0;
  const hasStock = item.stock > 0 || item.adviceQty > 0 || (item.lackQty || 0) > 0 || (item.shipping || 0) > 0;
  const hasFlow = item.expose != null && item.expose > 0;
  const hasAct = (item.actCnt || 0) > 0;
  const hasTags = hasRisk || hasAct || !!item.hotTag;
  const hasMetrics = hasSales || hasStock;

  return (
    <div style={{
      background: "#fff",
      border: isUrgent ? `1px solid ${TONE_COLOR.danger}` : hasRisk ? "1px solid #ffd591" : "1px solid #f0f0f0",
      borderRadius: 8,
      overflow: "hidden",
      transition: "box-shadow 0.2s, transform 0.15s",
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.08)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "none"; }}
    >
      <div style={{ padding: "16px 18px" }}>
        {/* 头部:图 + 名称/编码/店铺 + 阶段Tag */}
        <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
          {item.image ? (
            <Image src={item.image} width={88} height={88} style={{ borderRadius: 8, objectFit: "cover", flexShrink: 0 }} preview={false} fallback="data:image/svg+xml,<svg/>" />
          ) : (
            <div style={{ width: 88, height: 88, background: "#fafafa", borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#bbb", fontSize: 32 }}>
              {meta?.icon || <ShopOutlined />}
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 }}>
              {item.name}
            </div>
            <div style={{ fontSize: 13, color: "#aaa", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.code}
              {item.store ? <span style={{ marginLeft: 6, color: "#ccc" }}>· {item.store}</span> : null}
              {item.onsalesDuration != null && item.onsalesDuration > 0 ? <span style={{ marginLeft: 6, color: "#ccc" }}>· 上新{item.onsalesDuration}天</span> : null}
            </div>
          </div>
          {/* 阶段Tag:仅 danger 显式着色,其它走 ghost 样式 */}
          <span style={{
            height: 24, lineHeight: "22px", fontSize: 12, padding: "0 9px", borderRadius: 4,
            flexShrink: 0, whiteSpace: "nowrap",
            border: `1px solid ${tone === "danger" ? toneColor : "#e0e0e0"}`,
            background: tone === "danger" ? toneColor : "#fff",
            color: tone === "danger" ? "#fff" : "#666",
            fontWeight: tone === "danger" ? 600 : 400,
          }}>
            {meta?.label || item.stage}
          </span>
        </div>

        {/* 阶段进度条(仅进度,无文字) */}
        <StageBar current={item.stageIdx} color={meta?.color || "#1890ff"} />

        {/* ── 主指标:销量 + 库存(可用/在途/建议补/缺货件数) ── */}
        {hasMetrics ? (
          <div style={{ display: "flex", gap: 12, padding: "8px 0 6px", margin: "8px 0 0", borderTop: "1px solid #f5f5f5" }}>
            {hasSales && <SalesCell today={item.todaySales} d7={item.sales7d} d30={item.sales30d} />}
            {hasStock && <StockCell stock={item.stock} occupy={item.occupy || 0} shipping={item.shipping || 0} advice={item.adviceQty} lack={item.lackQty || 0} />}
          </div>
        ) : (
          <div style={{ padding: "8px 0 2px", marginTop: 6, fontSize: 13, color: "#aaa", textAlign: "center", borderTop: "1px solid #f5f5f5" }}>
            {STAGE_HINT[item.stage] || meta?.label}
          </div>
        )}

        {/* ── 流量行(有抓包数据才显示) ── */}
        {hasFlow && (
          <div style={{ borderTop: "1px solid #f5f5f5", paddingTop: 6, marginTop: 2 }}>
            <FlowCell expose={item.expose!} click={item.click ?? null} conv={item.conv ?? null} grow={item.grow ?? null} />
          </div>
        )}

        {/* ── 诊断/机会标签行:热品 + 可报活动 + 风险(限流/抽检/合规/缺货/差评) ── */}
        {hasTags && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            {item.hotTag && <Tag color="volcano" style={{ fontSize: 12, lineHeight: "20px", margin: 0, borderRadius: 3 }}><FireOutlined style={{ marginRight: 2 }} />热品</Tag>}
            {hasAct && (
              <Tag color="blue" style={{ fontSize: 12, lineHeight: "20px", margin: 0, borderRadius: 3 }}>
                可报活动 {item.actCnt}{item.actMinPrice != null ? ` · 参考¥${item.actMinPrice}` : ""}
              </Tag>
            )}
            {item.riskTags.map(t => {
              const m = RISK_LABELS[t];
              return m ? <Tag key={t} color={m.color} style={{ fontSize: 12, lineHeight: "20px", margin: 0, borderRadius: 3 }}>{m.text}</Tag> : null;
            })}
          </div>
        )}

        {/* ── 底部操作按钮 ── */}
        {meta?.nav && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <Button
              type="primary"
              ghost={!isUrgent}
              danger={isUrgent}
              size="small"
              style={{ borderRadius: 4, fontSize: 13, fontWeight: isUrgent ? 600 : 400 }}
              onClick={() => navigate(meta.nav!)}
            >
              {meta.navLabel} <RightOutlined />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  StageBar — 9 段位进度,纯视觉无文字                                  */
/* ================================================================== */

function StageBar({ current, color }: { current: number; color: string }) {
  return (
    <div style={{ display: "flex", gap: 2, marginTop: 2 }}>
      {STAGES.map((_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 3,
            borderRadius: 1,
            background: i <= current ? color : "#f0f0f0",
            transition: "background 0.3s",
          }}
        />
      ))}
    </div>
  );
}

/* ================================================================== */
/*  Metric cells — 紧凑双值格式                                         */
/* ================================================================== */

function SalesCell({ today, d7, d30 }: { today: number; d7: number; d30: number }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "#aaa", lineHeight: 1, marginBottom: 4 }}>
        <FireOutlined style={{ marginRight: 3 }} />销量 今/7/30
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "#333", lineHeight: 1.2, whiteSpace: "nowrap" }}>
        <span style={{ color: today > 0 ? "#fa541c" : "#bbb" }}>{today || "—"}</span>
        <span style={{ color: "#ddd", margin: "0 4px" }}>/</span>
        <span style={{ color: d7 > 0 ? "#333" : "#bbb" }}>{d7 || "—"}</span>
        <span style={{ color: "#ddd", margin: "0 4px" }}>/</span>
        <span style={{ color: "#888" }}>{d30 || "—"}</span>
      </div>
    </div>
  );
}

function StockCell({ stock, occupy, shipping, advice, lack }: { stock: number; occupy: number; shipping: number; advice: number; lack: number }) {
  const danger = stock === 0;
  const warn = stock > 0 && stock < 20;
  const stockColor = danger ? TONE_COLOR.danger : warn ? TONE_COLOR.warning : "#333";
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "#aaa", lineHeight: 1, marginBottom: 4 }}>
        <InboxOutlined style={{ marginRight: 3 }} />库存 可用/占用/在途
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap" }}>
        <span style={{ color: stockColor }}>{stock}</span>
        <span style={{ color: "#ddd", margin: "0 4px" }}>/</span>
        <span style={{ color: "#999" }}>{occupy || "—"}</span>
        <span style={{ color: "#ddd", margin: "0 4px" }}>/</span>
        <span style={{ color: "#999" }}>{shipping || "—"}</span>
      </div>
      {(advice > 0 || lack > 0) && (
        <div style={{ fontSize: 12, marginTop: 3, whiteSpace: "nowrap" }}>
          {advice > 0 && <span style={{ color: TONE_COLOR.danger, fontWeight: 600 }}>建议补 +{advice}</span>}
          {advice > 0 && lack > 0 && <span style={{ color: "#ddd", margin: "0 5px" }}>·</span>}
          {lack > 0 && <span style={{ color: TONE_COLOR.warning, fontWeight: 600 }}>缺货 {lack}</span>}
        </div>
      )}
    </div>
  );
}

// 流量行:曝光/点击/转化 + 增长趋势(箭头)。conv 沿用商品面板口径(比率→百分比)。
function FlowCell({ expose, click, conv, grow }: { expose: number; click: number | null; conv: number | null; grow: string | null }) {
  const convPct = conv == null ? null : (conv <= 1 ? conv * 100 : conv);
  const down = grow != null && /(down|decline|下滑|下降|减)/i.test(grow);
  const up = grow != null && /(up|grow|增|上升|上涨)/i.test(grow);
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: "#aaa", whiteSpace: "nowrap" }}><EyeOutlined style={{ marginRight: 3 }} />流量</span>
      <span style={{ fontSize: 13, color: "#666", whiteSpace: "nowrap" }}>曝光 <b style={{ color: "#333" }}>{fmtNum(expose)}</b></span>
      {click != null && <span style={{ fontSize: 13, color: "#666", whiteSpace: "nowrap" }}>点击 <b style={{ color: "#333" }}>{fmtNum(click)}</b></span>}
      {convPct != null && <span style={{ fontSize: 13, color: "#666", whiteSpace: "nowrap" }}>转化 <b style={{ color: "#333" }}>{convPct.toFixed(1)}%</b></span>}
      {down && <FallOutlined style={{ color: TONE_COLOR.danger }} />}
      {up && <RiseOutlined style={{ color: "#52c41a" }} />}
    </div>
  );
}

function fmtNum(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + "w";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

/* ================================================================== */
/*  ProductTable — 表格视图                                             */
/* ================================================================== */

function ProductTable({ items, navigate }: { items: UnifiedItem[]; navigate: ReturnType<typeof useNavigate> }) {
  const columns: ColumnsType<UnifiedItem> = [
    {
      title: "商品", dataIndex: "name", key: "name", width: 280, fixed: "left",
      render: (_, r) => (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {r.image ? (
            <Image src={r.image} width={32} height={32} style={{ borderRadius: 4, objectFit: "cover" }} preview={false} fallback="data:image/svg+xml,<svg/>" />
          ) : (
            <div style={{ width: 32, height: 32, background: "#fafafa", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", color: "#bbb", fontSize: 14 }}>
              <ShopOutlined />
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{r.name}</div>
            <div style={{ fontSize: 11, color: "#aaa" }}>{r.code}</div>
          </div>
        </div>
      ),
    },
    {
      title: "阶段", dataIndex: "stage", key: "stage", width: 100,
      render: (_, r) => {
        const meta = STAGE_META[r.stage];
        const tone = STAGE_TONE[r.stage] || "neutral";
        return (
          <Tag color={tone === "danger" ? "red" : tone === "warning" ? "orange" : tone === "progress" ? "blue" : "default"} style={{ margin: 0 }}>
            {meta?.label || r.stage}
          </Tag>
        );
      },
      filters: STAGES.map(s => ({ text: s.label, value: s.key })),
      onFilter: (v, r) => r.stage === v,
    },
    { title: "今日", dataIndex: "todaySales", key: "today", width: 70, align: "right",
      render: v => v > 0 ? <span style={{ color: "#fa541c", fontWeight: 600 }}>{v}</span> : <span style={{ color: "#ccc" }}>—</span>,
      sorter: (a, b) => a.todaySales - b.todaySales,
    },
    { title: "7日", dataIndex: "sales7d", key: "d7", width: 70, align: "right",
      render: v => v > 0 ? v : <span style={{ color: "#ccc" }}>—</span>,
      sorter: (a, b) => a.sales7d - b.sales7d,
    },
    { title: "30日", dataIndex: "sales30d", key: "d30", width: 70, align: "right",
      render: v => v > 0 ? v : <span style={{ color: "#ccc" }}>—</span>,
      sorter: (a, b) => a.sales30d - b.sales30d,
    },
    { title: "库存", dataIndex: "stock", key: "stock", width: 80, align: "right",
      render: v => {
        if (v === 0) return <span style={{ color: TONE_COLOR.danger, fontWeight: 600 }}>0</span>;
        if (v < 20) return <span style={{ color: TONE_COLOR.warning, fontWeight: 600 }}>{v}</span>;
        return v;
      },
      sorter: (a, b) => a.stock - b.stock,
    },
    { title: "建议补", dataIndex: "adviceQty", key: "advice", width: 80, align: "right",
      render: v => v > 0 ? <span style={{ color: TONE_COLOR.danger, fontWeight: 600 }}>+{v}</span> : <span style={{ color: "#ccc" }}>—</span>,
      sorter: (a, b) => a.adviceQty - b.adviceQty,
    },
    { title: "缺货件数", dataIndex: "lackQty", key: "lackQty", width: 90, align: "right",
      render: (v?: number) => (v && v > 0) ? <span style={{ color: TONE_COLOR.warning, fontWeight: 600 }}>{v}</span> : <span style={{ color: "#ccc" }}>—</span>,
      sorter: (a, b) => (a.lackQty || 0) - (b.lackQty || 0),
    },
    { title: "在途", dataIndex: "shipping", key: "shipping", width: 70, align: "right",
      render: (v?: number) => (v && v > 0) ? v : <span style={{ color: "#ccc" }}>—</span>,
      sorter: (a, b) => (a.shipping || 0) - (b.shipping || 0),
    },
    { title: "曝光", dataIndex: "expose", key: "expose", width: 80, align: "right",
      render: (v?: number | null) => (v != null && v > 0) ? fmtNum(v) : <span style={{ color: "#ccc" }}>—</span>,
      sorter: (a, b) => (a.expose || 0) - (b.expose || 0),
    },
    { title: "转化", dataIndex: "conv", key: "conv", width: 80, align: "right",
      render: (v?: number | null) => { if (v == null) return <span style={{ color: "#ccc" }}>—</span>; const p = v <= 1 ? v * 100 : v; return p.toFixed(1) + "%"; },
      sorter: (a, b) => (a.conv || 0) - (b.conv || 0),
    },
    { title: "可报活动", dataIndex: "actCnt", key: "actCnt", width: 90, align: "right",
      render: (v?: number) => (v && v > 0) ? <span style={{ color: "#1677ff" }}>{v}</span> : <span style={{ color: "#ccc" }}>—</span>,
      sorter: (a, b) => (a.actCnt || 0) - (b.actCnt || 0),
    },
    { title: "评分", dataIndex: "reviewScore", key: "score", width: 80, align: "right",
      render: (v, r) => {
        if (v == null) return <span style={{ color: "#ccc" }}>—</span>;
        const color = v < 3.5 ? TONE_COLOR.danger : v < 4 ? TONE_COLOR.warning : v >= 4.8 ? "#52c41a" : "#333";
        return <span style={{ color, fontWeight: 600 }}>{v.toFixed(1)}<span style={{ fontSize: 10, color: "#aaa", marginLeft: 3 }}>({r.reviewCount})</span></span>;
      },
      sorter: (a, b) => (a.reviewScore ?? 99) - (b.reviewScore ?? 99),
    },
    { title: "风险", dataIndex: "riskTags", key: "risk", width: 160,
      render: (tags: string[]) => (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {tags.map(t => {
            const m = RISK_LABELS[t];
            return m ? <Tag key={t} color={m.color} style={{ fontSize: 11, margin: 0, borderRadius: 3 }}>{m.text}</Tag> : null;
          })}
        </div>
      ),
    },
    { title: "操作", key: "action", width: 100, fixed: "right",
      render: (_, r) => {
        const meta = STAGE_META[r.stage];
        if (!meta?.nav) return <span style={{ color: "#ccc" }}>—</span>;
        const isUrgent = r.stage === "needs_restock";
        return (
          <Button type="primary" ghost={!isUrgent} danger={isUrgent} size="small" onClick={() => navigate(meta.nav!)}>
            {meta.navLabel}
          </Button>
        );
      },
    },
  ];
  return (
    <Table
      rowKey="id"
      size="small"
      columns={columns}
      dataSource={items}
      pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200], size: "small" }}
      scroll={{ x: 1700 }}
    />
  );
}
