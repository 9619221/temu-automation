import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Empty, Image, Input, Segmented, Select, Spin, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  RightOutlined, WarningOutlined, ShoppingCartOutlined,
  InboxOutlined, RocketOutlined, ShopOutlined, PlusOutlined, AlertOutlined,
  FireOutlined, StarOutlined, SearchOutlined,
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

/* ================================================================== */
/*  Demo data                                                          */
/* ================================================================== */

const _s = (id: string, code: string, name: string, stage: string, x: Partial<PipelineSkuRow> = {}): PipelineSkuRow => ({
  sku_id: id, sku_code: code, name, image: null, stage,
  today_sales: 0, w7_sales: 0, m30_sales: 0, warehouse_stock: 0, advice_qty: 0,
  local_available: 0, local_reserved: 0, review_count: 0, avg_score: null, bad_reviews: 0, return_count: 0, risk_tags: [], ...x,
});
const _DEMO_ERP: Record<string, PipelineSkuRow[]> = {
  selling: [
    _s("s1", "TM-SP-1001", "创意硅胶厨具套装 5件", "selling", { today_sales: 12, w7_sales: 87, m30_sales: 342, warehouse_stock: 520, review_count: 24, avg_score: 4.6 }),
    _s("s2", "TM-SP-1002", "多功能旅行收纳袋 6件套", "selling", { today_sales: 8, w7_sales: 63, m30_sales: 218, warehouse_stock: 310, review_count: 5, avg_score: 4.2 }),
    _s("s3", "TM-SP-1003", "加厚珊瑚绒浴巾 大号", "selling", { today_sales: 6, w7_sales: 45, m30_sales: 189, warehouse_stock: 200, review_count: 8, avg_score: 3.1, bad_reviews: 3, risk_tags: ["low_score", "many_bad_reviews"] }),
    _s("s4", "TM-SP-1004", "LED 护眼台灯 折叠款", "selling", { today_sales: 5, w7_sales: 38, m30_sales: 156, warehouse_stock: 150 }),
    _s("s5", "TM-SP-1005", "自动感应泡沫洗手机", "selling", { today_sales: 3, w7_sales: 29, m30_sales: 105, warehouse_stock: 88, review_count: 2, avg_score: 5.0 }),
    _s("s6", "TM-SP-1006", "便携式迷你风扇 USB充电", "selling", { today_sales: 2, w7_sales: 22, m30_sales: 91, warehouse_stock: 60 }),
  ],
  needs_restock: [
    _s("r1", "TM-SP-1007", "儿童益智磁力积木 64片", "needs_restock", { today_sales: 9, w7_sales: 52, m30_sales: 198, warehouse_stock: 12, advice_qty: 200, risk_tags: ["urgent_restock", "stock_out"] }),
    _s("r2", "TM-SP-1008", "不锈钢保温杯 500ml", "needs_restock", { today_sales: 7, w7_sales: 41, m30_sales: 163, warehouse_stock: 8, advice_qty: 150, risk_tags: ["urgent_restock"] }),
    _s("r3", "TM-SP-1009", "宠物自动喂食器", "needs_restock", { w7_sales: 18, m30_sales: 72, warehouse_stock: 5, advice_qty: 80, risk_tags: ["stock_out"] }),
  ],
  in_stock: [
    _s("i1", "TM-SP-1010", "竹纤维毛巾礼盒 3件", "in_stock", { local_available: 450 }),
    _s("i2", "TM-SP-1011", "透明收纳鞋盒 12个装", "in_stock", { local_available: 300 }),
  ],
  purchasing: [
    _s("p1", "TM-SP-1012", "无线蓝牙耳机 降噪款", "purchasing", {}),
    _s("p2", "TM-SP-1013", "车载手机支架 磁吸式", "purchasing", {}),
    _s("p3", "TM-SP-1014", "桌面整理抽屉柜 4层", "purchasing", {}),
    _s("p4", "TM-SP-1015", "电动牙刷替换头 8支", "purchasing", {}),
  ],
  inbound: [
    _s("b1", "TM-SP-1016", "户外折叠椅 便携式", "inbound", {}),
    _s("b2", "TM-SP-1017", "防水化妆包 大容量", "inbound", {}),
  ],
  created: [
    _s("c1", "TM-SP-1018", "迷你投影仪 家用", "created", {}),
    _s("c2", "TM-SP-1019", "陶瓷杯垫 隔热 4件套", "created", {}),
    _s("c3", "TM-SP-1020", "多功能开瓶器 3合1", "created", {}),
  ],
};
const _DEMO_YUNQI: YunqiSelectionItem[] = [
  { goods_id: "YQ-001", title_zh: "创意挂钟 北欧风", main_image: "", usd_price: 8.99, category_zh: "家居装饰", status: "want" },
  { goods_id: "YQ-002", title_zh: "记忆棉坐垫 办公室", main_image: "", usd_price: 12.5, category_zh: "家居日用", status: "want" },
  { goods_id: "YQ-003", title_zh: "便携榨汁杯 USB充电", main_image: "", usd_price: 15.0, category_zh: "厨房小家电", status: "want" },
  { goods_id: "YQ-004", title_zh: "水晶球音乐盒", main_image: "", usd_price: 6.8, category_zh: "创意礼品", status: "listing" },
  { goods_id: "YQ-005", title_zh: "LED 化妆镜 带灯", main_image: "", usd_price: 9.5, category_zh: "美妆工具", status: "listing" },
];

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
  const hasStock = item.stock > 0 || item.adviceQty > 0;
  // 评分只在异常区间显示(<4.0 或 ≥4.8),中等评分对运营无价值
  const showScore = item.reviewScore != null && (item.reviewScore < 4.0 || item.reviewScore >= 4.8);
  const hasContent = hasSales || hasStock || showScore;
  const hasFooter = hasRisk || !!meta?.nav;

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
        {/* 头部:图 + 名称/编码 + 阶段Tag */}
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
            <div style={{ fontSize: 13, color: "#aaa", marginTop: 2 }}>{item.code}</div>
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

        {/* 指标区 / 空态文案 */}
        {hasContent ? (
          <div style={{ display: "flex", gap: 12, padding: "8px 0", margin: "8px 0 0", borderTop: "1px solid #f5f5f5", borderBottom: hasFooter ? "1px solid #f5f5f5" : "none" }}>
            {hasSales && <SalesCell today={item.todaySales} d7={item.sales7d} d30={item.sales30d} />}
            {hasStock && <StockCell stock={item.stock} advice={item.adviceQty} />}
            {showScore && <ScoreCell score={item.reviewScore!} count={item.reviewCount} />}
          </div>
        ) : (
          <div style={{
            padding: "8px 0 2px", marginTop: 6,
            fontSize: 13, color: "#aaa", textAlign: "center",
            borderTop: "1px solid #f5f5f5",
          }}>
            {STAGE_HINT[item.stage] || meta?.label}
          </div>
        )}

        {/* 底部:风险 + 操作按钮(都没就不渲染整行) */}
        {hasFooter && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: hasContent ? 8 : 6, minHeight: 24 }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              {item.riskTags.map(t => {
                const m = RISK_LABELS[t];
                return m ? <Tag key={t} color={m.color} style={{ fontSize: 12, lineHeight: "20px", margin: 0, borderRadius: 3 }}>{m.text}</Tag> : null;
              })}
            </div>
            {meta?.nav && (
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
            )}
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

function StockCell({ stock, advice }: { stock: number; advice: number }) {
  const danger = stock === 0;
  const warn = stock > 0 && stock < 20;
  const stockColor = danger ? TONE_COLOR.danger : warn ? TONE_COLOR.warning : "#333";
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "#aaa", lineHeight: 1, marginBottom: 4 }}>
        <InboxOutlined style={{ marginRight: 3 }} />库存{advice > 0 ? " · 建议补" : ""}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap" }}>
        <span style={{ color: stockColor }}>{stock}</span>
        {advice > 0 && (
          <>
            <span style={{ color: "#ddd", margin: "0 4px" }}>·</span>
            <span style={{ color: TONE_COLOR.danger }}>+{advice}</span>
          </>
        )}
      </div>
    </div>
  );
}

function ScoreCell({ score, count }: { score: number; count: number }) {
  const danger = score < 3.5;
  const warn = score >= 3.5 && score < 4.0;
  const good = score >= 4.8;
  const color = danger ? TONE_COLOR.danger : warn ? TONE_COLOR.warning : good ? "#52c41a" : "#333";
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "#aaa", lineHeight: 1, marginBottom: 4 }}>
        <StarOutlined style={{ marginRight: 3 }} />评分{count > 0 ? ` · ${count}` : ""}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color, lineHeight: 1.2 }}>
        {score.toFixed(1)}
      </div>
    </div>
  );
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
      scroll={{ x: 1200 }}
    />
  );
}
