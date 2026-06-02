import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Image, Input, InputNumber, Modal, Segmented, Select, Statistic, Table, Tabs, Tag, Tooltip, Typography, message } from "antd";
import { EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ResponsiveContainer } from "recharts";
import { useNavigate } from "react-router-dom";

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
interface StoreMatrixRow {
  store_code: string; mall_id: string; mall_name: string | null; owner: string | null;
  sales: number; sale_7d: number; lack: number; soldout: number;
  high_risk: number; restock: number; stock_gap: number; activity: number;
}
interface SkuChild { skc_id: string | null; sku_ext_code: string | null; declared_price: number | null; today: number; last7d: number; sale_days: number | null; stock: number; occupy: number; advice_qty: number; lack_qty?: number; }
interface ProductPanelRow {
  mall_id: string; product_id: string; store_code: string | null; mall_name: string | null; title: string | null; thumb: string | null;
  skc_codes: string | null; sku_codes: string | null; declared_price: number | null; score: number | null; comments: number | null;
  stock: number | null; occupy: number | null; unavail: number | null; advice: number | null; lack: number | null; lack_qty: number | null; shipping: number | null; total_stock: number | null;
  expose: number | null; click: number | null; pay: number | null; conv: number | null; grow: string | null;
  limited: boolean; act_cnt: number; min_price: number | null; compliance: string | null; skus_detail?: SkuChild[]; __rk?: number;
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
const TREND_COLORS = ["#1a73e8", "#34a853", "#fbbc04", "#ea4335", "#a142f4", "#24c1e0", "#ff6d01", "#7c8597"];

export default function OperationsWorkbench() {
  const [activeTab, setActiveTab] = useState("overview");
  // 「我的店」视角:按负责人(owner)过滤全局,记住上次选择
  const [ownerFilter, setOwnerFilter] = useState<string>(() => { try { return localStorage.getItem("ow_owner") || "all"; } catch { return "all"; } });
  const setOwner = useCallback((v: string) => { setOwnerFilter(v); try { localStorage.setItem("ow_owner", v); } catch { /* */ } }, []);
  // 合并 Tab 内的子段切换
  const [storeSeg, setStoreSeg] = useState<string>("health");
  const [prodSeg, setProdSeg] = useState<string>("panel");
  const goProduct = useCallback((seg: string) => { setProdSeg(seg); setActiveTab("product"); }, []);
  const goStore = useCallback((seg: string) => { setStoreSeg(seg); setActiveTab("store"); }, []);
  const [skuRows, setSkuRows] = useState<SkuRow[]>([]);
  const [skuLoading, setSkuLoading] = useState(false);
  const [riskRows, setRiskRows] = useState<RiskRow[]>([]);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskLoaded, setRiskLoaded] = useState(false);
  const [actRows, setActRows] = useState<ActivityRow[]>([]);
  const [actLoading, setActLoading] = useState(false);
  const [actLoaded, setActLoaded] = useState(false);
  const [shopRows, setShopRows] = useState<ShopHealthRow[]>([]);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopLoaded, setShopLoaded] = useState(false);
  const [stockRows, setStockRows] = useState<StockOrderRow[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockLoaded, setStockLoaded] = useState(false);
  const [trendRows, setTrendRows] = useState<TrendRow[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendLoaded, setTrendLoaded] = useState(false);
  const [panelRows, setPanelRows] = useState<ProductPanelRow[]>([]);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelLoaded, setPanelLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [storeFilter, setStoreFilter] = useState("all");
  const [diagFilter, setDiagFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [todoType, setTodoType] = useState("all");
  const [todoStatus, setTodoStatus] = useState("open"); // 默认只看待处理
  const [batchPrice, setBatchPrice] = useState<number | null>(null); // 活动报名:批量填申报价
  const [batchStock, setBatchStock] = useState<number | null>(null); // 活动报名:批量填库存
  const [selActRows, setSelActRows] = useState<ActivityRow[]>([]); // 活动报名:勾选待提交行
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [actSkuOnly, setActSkuOnly] = useState(true); // 活动报名:仅看有货号的行(店铺-商品-活动维度)
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
    try { const resp = await window.electronAPI.erp.reports.activityList({ includeTest: false }); if (resp.ok && resp.data) { setActRows((resp.data.rows || []) as ActivityRow[]); setActLoaded(true); } } catch { /* */ } finally { setActLoading(false); }
  }, []);
  const loadShop = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.shopHealth) return;
    setShopLoading(true);
    try { const resp = await window.electronAPI.erp.reports.shopHealth({ includeTest: false }); if (resp.ok && resp.data) { setShopRows((resp.data.rows || []) as ShopHealthRow[]); setShopLoaded(true); } } catch { /* */ } finally { setShopLoading(false); }
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

  useEffect(() => { loadSku(); }, [loadSku]);
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
    const ov = activeTab === "overview";
    const store = activeTab === "store";
    const todo = activeTab === "todo"; // 今日待办依赖风险+活动+诊断(诊断走 skuRows,已在挂载时加载)
    // shop 始终加载:owner 映射是「我的店」全局过滤的基础
    if (!shopLoaded && !shopLoading) loadShop();
    if ((store || ov) && !trendLoaded && !trendLoading) loadTrend();
    if ((activeTab === "stock" || ov) && !stockLoaded && !stockLoading) loadStockOrders();
    if ((activeTab === "risk" || ov || todo) && !riskLoaded && !riskLoading) loadRisk();
    if ((activeTab === "activity" || ov || todo) && !actLoaded && !actLoading) loadAct();
    if (activeTab === "product" && !panelLoaded && !panelLoading) loadPanel();
  }, [activeTab, shopLoaded, shopLoading, trendLoaded, trendLoading, stockLoaded, stockLoading, riskLoaded, riskLoading, actLoaded, actLoading, panelLoaded, panelLoading, loadShop, loadTrend, loadStockOrders, loadRisk, loadAct, loadPanel]);

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
    for (const r of riskRows) {
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
    for (const r of actRows) {
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
  const skuActCount = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of actView) {
      if (!r.sku_ext_code) continue;
      const a = r.activity_id || r.title || "";
      if (!m.has(r.sku_ext_code)) m.set(r.sku_ext_code, new Set());
      m.get(r.sku_ext_code)!.add(a);
    }
    const c = new Map<string, number>();
    for (const [k, s] of m) c.set(k, s.size);
    return c;
  }, [actView]);

  const shopAgg = useMemo(() => {
    let lack = 0, soldout = 0, sales = 0;
    for (const r of shopRows) { if (!inScope(r.store_code || r.mall_id)) continue; lack += r.lack_skc || 0; soldout += r.already_sold_out || 0; sales += r.sale_volume || 0; }
    return { lack, soldout, sales };
  }, [shopRows, inScope]);
  const overviewTrend = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const r of trendRows) { if (!inScope(r.store_code || r.mall_id)) continue; byDate.set(r.stat_date, (byDate.get(r.stat_date) || 0) + r.sales); }
    return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, sales]) => ({ date, sales }));
  }, [trendRows, inScope]);
  const storeMatrix = useMemo(() => {
    const m = new Map<string, StoreMatrixRow>();
    const get = (code: string, mall_id: string, mall_name: string | null, owner: string | null) => {
      let e = m.get(code);
      if (!e) { e = { store_code: code, mall_id, mall_name, owner, sales: 0, sale_7d: 0, lack: 0, soldout: 0, high_risk: 0, restock: 0, stock_gap: 0, activity: 0 }; m.set(code, e); }
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
    return [...m.values()].sort((a, b) => (b.lack + b.soldout + b.high_risk * 5) - (a.lack + a.soldout + a.high_risk * 5));
  }, [shopRows, riskRows, skuRows, stockRows, actRows, inScope]);
  const panelView = useMemo(() => {
    let v = panelRows.filter((r) => inScope(r.store_code || r.mall_id));
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.title || "").toLowerCase().includes(q) || (r.product_id || "").includes(q));
    return v.map((r, i) => ({ ...r, __rk: i }));
  }, [panelRows, storeFilter, search, inScope]);
  const shopView = useMemo(() => {
    let v = shopRows.filter((r) => inScope(r.store_code || r.mall_id));
    if (storeFilter !== "all") v = v.filter((r) => r.store_code === storeFilter);
    const q = search.trim().toLowerCase();
    if (q) v = v.filter((r) => (r.store_code || "").toLowerCase().includes(q) || (r.mall_name || "").toLowerCase().includes(q) || (r.owner || "").toLowerCase().includes(q));
    return v.map((r, i) => ({ ...r, __rk: i }));
  }, [shopRows, storeFilter, search, inScope]);
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
  const storeCol = { title: "店号", dataIndex: "store_code", width: 76, fixed: "left" as const, render: (v: string | null) => <Typography.Text strong>{v || "—"}</Typography.Text>, sorter: (a: any, b: any) => (a.store_code || "").localeCompare(b.store_code || "") };

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
    { title: "店号", dataIndex: "store", width: 70, render: (v: string) => <Typography.Text strong>{v}</Typography.Text>, sorter: (a, b) => a.store.localeCompare(b.store) },
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
    storeCol,
    { title: "类型", dataIndex: "kind", width: 70, render: (v: string | null) => <Tag color={v === "bidding" ? "purple" : v === "coupon" ? "cyan" : "blue"}>{KIND_LABEL[v || ""] || v || "—"}</Tag> },
    { title: "商品 / SKC / 货号", key: "at", width: 360, render: (_, r) => (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {r.thumb ? <div style={{ flexShrink: 0, width: 40, height: 40 }}><Image src={r.thumb} width={40} height={40} style={{ objectFit: "cover", borderRadius: 4 }} preview={{ mask: <EyeOutlined /> }} /></div> : <div style={{ width: 40, height: 40, borderRadius: 4, background: "#f0f0f0", flexShrink: 0 }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, maxWidth: 290, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.product_name || undefined}>{r.product_name || <span style={{ color: "#bbb" }}>(无商品名)</span>}</div>
          {r.sku_ext_code ? <Typography.Text copyable={{ text: r.sku_ext_code }} style={{ fontSize: 12, fontWeight: 600 }}>{r.sku_ext_code}</Typography.Text> : <span style={{ color: "#bbb", fontSize: 12 }}>(无货号·活动表头)</span>}
          <div style={{ fontSize: 11, color: "#aaa", marginTop: 1, display: "flex", gap: 8 }}>
            {r.product_id ? <Typography.Text copyable={{ text: r.product_id }} style={{ fontSize: 11, color: "#aaa" }}>SPU {r.product_id}</Typography.Text> : null}
            {r.skc_id ? <Typography.Text copyable={{ text: r.skc_id }} style={{ fontSize: 11, color: "#aaa" }}>SKC {r.skc_id}</Typography.Text> : null}
          </div>
        </div>
      </div>
    ) },
    { title: "可报活动", key: "actcnt", width: 80, align: "center", render: (_, r) => { const n = r.sku_ext_code ? (skuActCount.get(r.sku_ext_code) || 0) : 0; return n > 0 ? <Tag color={n >= 3 ? "green" : "blue"}>{n} 个</Tag> : <span style={{ color: "#bbb" }}>—</span>; }, sorter: (a, b) => (skuActCount.get(a.sku_ext_code || "") || 0) - (skuActCount.get(b.sku_ext_code || "") || 0) },
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

  const shopColumns: ColumnsType<ShopHealthRow> = [
    { title: "店号", dataIndex: "store_code", width: 80, fixed: "left", render: (v, r) => v || r.mall_id },
    { title: "店铺", dataIndex: "mall_name", width: 140, ellipsis: true, render: (v) => v || "—" },
    { title: "负责人", dataIndex: "owner", width: 80, render: (v) => v || "—" },
    { title: "今日销量", dataIndex: "sale_volume", width: 90, align: "right", sorter: (a, b) => a.sale_volume - b.sale_volume, render: fmtNum },
    { title: "7天销量", dataIndex: "sale_7d", width: 90, align: "right", sorter: (a, b) => a.sale_7d - b.sale_7d, render: fmtNum },
    { title: "30天销量", dataIndex: "sale_30d", width: 95, align: "right", sorter: (a, b) => a.sale_30d - b.sale_30d, render: fmtNum },
    { title: "在售", dataIndex: "on_sale", width: 75, align: "right", render: fmtNum },
    { title: "缺货SKC", dataIndex: "lack_skc", width: 90, align: "right", sorter: (a, b) => a.lack_skc - b.lack_skc, render: (v: number) => (v > 0 ? <span style={{ color: "#d46b08", fontWeight: 600 }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "即将售罄", dataIndex: "about_to_sell_out", width: 90, align: "right", sorter: (a, b) => a.about_to_sell_out - b.about_to_sell_out, render: (v: number) => (v > 0 ? <span style={{ color: "#d46b08" }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "已售罄", dataIndex: "already_sold_out", width: 85, align: "right", sorter: (a, b) => a.already_sold_out - b.already_sold_out, render: (v: number) => (v > 0 ? <span style={{ color: "#cf1322", fontWeight: 600 }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "建议备货SKC", dataIndex: "advice_prepare_skc", width: 110, align: "right", render: fmtNum },
    { title: "高价限制", dataIndex: "high_price_limit", width: 90, align: "right", render: (v: number) => (v > 0 ? <span style={{ color: "#cf1322" }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "90天售后率", dataIndex: "after_sale_ratio_90d", width: 100, align: "right", sorter: (a, b) => (a.after_sale_ratio_90d ?? 0) - (b.after_sale_ratio_90d ?? 0), render: (v: number | null) => (v == null ? "—" : (v * 100).toFixed(2) + "%") },
  ];

  const SRC_LABEL: Record<string, string> = { stock_order: "备货单", shipping_list: "发货单", shipping_desk: "发货台" };
  const stockColumns: ColumnsType<StockOrderRow> = [
    { title: "店号", dataIndex: "store_code", width: 70, fixed: "left", render: (v, r) => v || r.mall_id },
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
  const storeMatrixColumns: ColumnsType<StoreMatrixRow> = [
    { title: "店号", dataIndex: "store_code", width: 70, fixed: "left" },
    { title: "店铺", dataIndex: "mall_name", width: 130, ellipsis: true, render: (v) => v || "—" },
    { title: "负责人", dataIndex: "owner", width: 70, render: (v) => v || "—" },
    { title: "今日销量", dataIndex: "sales", width: 85, align: "right", sorter: (a, b) => a.sales - b.sales, render: fmtNum },
    { title: "7天销量", dataIndex: "sale_7d", width: 85, align: "right", sorter: (a, b) => a.sale_7d - b.sale_7d, render: fmtNum },
    { title: "缺货", dataIndex: "lack", width: 70, align: "right", sorter: (a, b) => a.lack - b.lack, render: redNum("#d46b08") },
    { title: "售罄", dataIndex: "soldout", width: 70, align: "right", sorter: (a, b) => a.soldout - b.soldout, render: redNum("#cf1322") },
    { title: "高风险", dataIndex: "high_risk", width: 75, align: "right", sorter: (a, b) => a.high_risk - b.high_risk, render: redNum("#cf1322") },
    { title: "待补货", dataIndex: "restock", width: 75, align: "right", sorter: (a, b) => a.restock - b.restock, render: redNum("#d46b08") },
    { title: "备货缺口", dataIndex: "stock_gap", width: 85, align: "right", sorter: (a, b) => a.stock_gap - b.stock_gap, render: fmtNum },
    { title: "可报活动", dataIndex: "activity", width: 85, align: "right", sorter: (a, b) => a.activity - b.activity, render: (v: number) => (v > 0 ? <span style={{ color: "#3f8600" }}>{fmtNum(v)}</span> : <span style={{ color: "#bbb" }}>0</span>) },
  ];

  // SKU 堆叠单元格:把同一 SPU 下多个 SKU 竖直堆叠,各列行数一致天然对齐;total 不为空时追加合计行
  const stackCell = (skus: SkuChild[], get: (s: SkuChild) => React.ReactNode, total?: React.ReactNode) => {
    if (!skus.length) return <span style={{ color: "#bbb" }}>—</span>;
    if (skus.length === 1) return <span style={{ fontSize: 12 }}>{get(skus[0])}</span>;
    return (
      <div>
        {skus.map((s, i) => <div key={i} style={{ padding: "2px 0", borderBottom: "1px solid #f5f5f5", minHeight: 18, fontSize: 12 }}>{get(s)}</div>)}
        {total != null && <div style={{ padding: "2px 0", fontWeight: 600, fontSize: 12, color: "#1a73e8", minHeight: 18 }}>合计 {total}</div>}
      </div>
    );
  };
  const skusOf = (r: ProductPanelRow): SkuChild[] => r.skus_detail || [];

  const panelColumns: ColumnsType<ProductPanelRow> = [
    { title: "店号", dataIndex: "store_code", width: 70, fixed: "left", render: (v, r) => v || r.mall_id },
    { title: "SPU", dataIndex: "product_id", width: 120, render: (v: string) => <Typography.Text copyable={{ text: v }} style={{ fontSize: 12, fontWeight: 600 }}>{v}</Typography.Text> },
    { title: "SKC", key: "skc", width: 130, render: (_, r) => stackCell(skusOf(r), (s) => s.skc_id || <span style={{ color: "#bbb" }}>—</span>) },
    { title: "SKU货号", key: "sku_ext", width: 140, render: (_, r) => stackCell(skusOf(r), (s) => s.sku_ext_code || <span style={{ color: "#bbb" }}>—</span>) },
    { title: "商品", key: "prod", width: 340, render: (_, r) => (
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        {r.thumb ? <div style={{ flexShrink: 0, width: 40, height: 40 }}><Image src={r.thumb} width={40} height={40} style={{ objectFit: "cover", borderRadius: 4 }} preview={{ mask: <EyeOutlined />, maskClassName: "prod-thumb-mask" }} /></div> : <div style={{ width: 40, height: 40, borderRadius: 4, background: "#f0f0f0", flexShrink: 0 }} />}
        <div style={{ minWidth: 0, fontSize: 12, lineHeight: 1.45, whiteSpace: "normal", wordBreak: "break-word" }}>{r.title || "—"}</div>
      </div>
    ) },
    { title: "评价", key: "score", width: 110, align: "right", sorter: (a, b) => (a.comments ?? 0) - (b.comments ?? 0), render: (_, r) => { if (r.comments == null && r.score == null) return <span style={{ color: "#bbb" }}>—</span>; return <span>{r.score != null ? <span style={{ color: "#fadb14" }}>★{r.score.toFixed(1)} </span> : null}{r.comments != null ? <span>{fmtNum(r.comments)} 评论</span> : ""}</span>; } },
    { title: "申报价", key: "declared_price", width: 90, align: "right", render: (_, r) => { const skus = skusOf(r); const prices = skus.map((s) => s.declared_price).filter((p): p is number => p != null); const min = prices.length ? Math.min(...prices) : null; return stackCell(skus, (s) => (s.declared_price == null ? "—" : "¥" + s.declared_price.toFixed(2)), min == null ? "—" : "¥" + min.toFixed(2)); } },
    { title: "可用库存", key: "stock", width: 90, align: "right", render: (_, r) => { const skus = skusOf(r); const sum = skus.reduce((a, s) => a + (s.stock || 0), 0); return stackCell(skus, (s) => <span style={{ color: (s.stock || 0) <= 0 ? "#cf1322" : undefined }}>{fmtNum(s.stock)}</span>, fmtNum(sum)); } },
    { title: "预占用库存", key: "occupy", width: 100, align: "right", render: (_, r) => { const skus = skusOf(r); const sum = skus.reduce((a, s) => a + (s.occupy || 0), 0); return stackCell(skus, (s) => fmtNum(s.occupy), fmtNum(sum)); } },
    { title: "暂不可用库存", dataIndex: "unavail", width: 110, align: "right", render: (v: number | null) => (v == null ? "—" : v > 0 ? <span style={{ color: "#d46b08" }}>{fmtNum(v)}</span> : fmtNum(v)) },
    { title: "缺货件数", key: "lack_qty", width: 95, align: "right", sorter: (a, b) => (a.lack_qty ?? 0) - (b.lack_qty ?? 0), render: (_, r) => { const skus = skusOf(r); const sum = skus.reduce((a, s) => a + (s.lack_qty || 0), 0); return stackCell(skus, (s) => ((s.lack_qty || 0) > 0 ? <span style={{ color: "#cf1322", fontWeight: 600 }}>{fmtNum(s.lack_qty || 0)}</span> : <span style={{ color: "#bbb" }}>0</span>), sum > 0 ? <span style={{ color: "#cf1322" }}>{fmtNum(sum)}</span> : fmtNum(sum)); } },
    { title: "发货在途", dataIndex: "shipping", width: 90, align: "right", sorter: (a, b) => (a.shipping ?? 0) - (b.shipping ?? 0), render: (v: number | null) => (v == null ? "—" : v > 0 ? <span style={{ color: "#1677ff" }}>{fmtNum(v)}</span> : <span style={{ color: "#bbb" }}>0</span>) },
    { title: "总库存", dataIndex: "total_stock", width: 95, align: "right", sorter: (a, b) => (a.total_stock ?? 0) - (b.total_stock ?? 0), render: (v: number | null) => (v == null ? "—" : <span style={{ fontWeight: 700, color: v <= 0 ? "#cf1322" : "#1a73e8" }}>{fmtNum(v)}</span>) },
    { title: "建议备货", key: "advice", width: 90, align: "right", render: (_, r) => { const skus = skusOf(r); const sum = skus.reduce((a, s) => a + (s.advice_qty || 0), 0); return stackCell(skus, (s) => ((s.advice_qty || 0) > 0 ? <Tag color="blue">{fmtNum(s.advice_qty)}</Tag> : <span style={{ color: "#bbb" }}>—</span>), fmtNum(sum)); } },
    { title: "可报活动", key: "act", width: 130, align: "right", sorter: (a, b) => a.act_cnt - b.act_cnt, render: (_, r) => (r.act_cnt > 0 ? <span style={{ color: "#3f8600" }}>{r.act_cnt}个{r.min_price != null ? ` / 低¥${r.min_price.toFixed(2)}` : ""}</span> : <span style={{ color: "#bbb" }}>—</span>) },
    { title: "合规", dataIndex: "compliance", width: 170, render: (v: string | null) => (v ? <Tag color="red" style={{ whiteSpace: "normal" }}>{v}</Tag> : <span style={{ color: "#3f8600" }}>正常</span>) },
    { title: "限流", dataIndex: "limited", width: 90, align: "center", sorter: (a, b) => (a.limited ? 1 : 0) - (b.limited ? 1 : 0), render: (v: boolean) => (v ? <Tag color="volcano">高价限流</Tag> : <span style={{ color: "#bbb" }}>—</span>) },
    { title: "曝光", dataIndex: "expose", width: 80, align: "right", sorter: (a, b) => (a.expose || 0) - (b.expose || 0), render: (v: number | null) => (v == null ? <span style={{ color: "#ccc" }}>无</span> : fmtNum(v)) },
    { title: "点击", dataIndex: "click", width: 70, align: "right", render: (v: number | null) => (v == null ? "—" : fmtNum(v)) },
    { title: "支付件", dataIndex: "pay", width: 75, align: "right", render: (v: number | null) => (v == null ? "—" : fmtNum(v)) },
    { title: "曝光转化", dataIndex: "conv", width: 90, align: "right", render: (v: number | null) => (v == null ? "—" : (v * 100).toFixed(2) + "%") },
  ];

  const commonFilters = (extra?: React.ReactNode) => (
    <div style={{ padding: "12px 16px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <Select size="small" style={{ width: 130 }} value={storeFilter} onChange={setStoreFilter} options={[{ value: "all", label: "全部店铺" }, ...storeOptions.map((c) => ({ value: c, label: c }))]} />
      {extra}
      <Input.Search size="small" allowClear placeholder="搜货号 / 标题" style={{ width: 220 }} value={search} onChange={(e) => setSearch(e.target.value)} />
    </div>
  );

  const tabItems = [
    {
      key: "overview", label: "总览",
      children: (
        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            <Card size="small" hoverable onClick={() => goStore("health")}><Statistic title="今日销量(全店)" value={shopAgg.sales} /></Card>
            <Card size="small" hoverable onClick={() => goStore("health")}><Statistic title="缺货 SKC" value={shopAgg.lack} valueStyle={{ color: shopAgg.lack > 0 ? "#d46b08" : undefined }} /></Card>
            <Card size="small" hoverable onClick={() => goStore("health")}><Statistic title="已售罄" value={shopAgg.soldout} valueStyle={{ color: shopAgg.soldout > 0 ? "#cf1322" : undefined }} /></Card>
            <Card size="small" hoverable onClick={() => setActiveTab("risk")}><Statistic title="高风险待办" value={riskOverview.high} valueStyle={{ color: riskOverview.high > 0 ? "#cf1322" : undefined }} /></Card>
            <Card size="small" hoverable onClick={() => goProduct("diag")}><Statistic title="诊断 · 急" value={overview.urgent} valueStyle={{ color: overview.urgent > 0 ? "#cf1322" : undefined }} /></Card>
            <Card size="small" hoverable onClick={() => goProduct("restock")}><Statistic title="急需补货 SKU" value={restockView.length} valueStyle={{ color: restockView.length > 0 ? "#d46b08" : undefined }} /></Card>
            <Card size="small" hoverable onClick={() => setActiveTab("stock")}><Statistic title="备货缺口单" value={stockView.length} /></Card>
            <Card size="small" hoverable onClick={() => setActiveTab("activity")}><Statistic title="可报活动" value={actView.length} valueStyle={{ color: "#3f8600" }} /></Card>
          </div>
          <Card size="small" title="各店概览 · 点店查看商品明细,问题多的店排在前" style={{ marginBottom: 16 }} loading={shopLoading || riskLoading || skuLoading}>
            <Table<StoreMatrixRow> dataSource={storeMatrix} columns={storeMatrixColumns} rowKey="store_code" size="small"
              pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 店` }}
              scroll={{ x: 980 }}
              onRow={(r) => ({ onClick: () => { setStoreFilter(r.store_code); goProduct("diag"); }, style: { cursor: "pointer" } })} />
          </Card>
          <Card size="small" title="全店销量趋势 · 近 30 天" style={{ marginBottom: 16 }} loading={trendLoading}>
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
          </Card>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <Card size="small" title="高风险待办" extra={<a onClick={() => setActiveTab("risk")}>全部</a>} loading={riskLoading}>
              {riskView.filter((r) => r.severity === "high").slice(0, 6).map((r) => (
                <div key={r.__rk} style={{ padding: "4px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <Tag color="red">{r.store_code || r.mall_id}</Tag>{r.title || r.risk_type || "—"}
                </div>
              ))}
              {riskView.filter((r) => r.severity === "high").length === 0 && <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>无高风险</div>}
            </Card>
            <Card size="small" title="急需补货" extra={<a onClick={() => goProduct("restock")}>全部</a>} loading={skuLoading}>
              {restockView.slice(0, 6).map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Tag color="orange">{r.store_code || r.mall_id}</Tag>{r.title || r.sku_ext_code || "—"}</span>
                  <span style={{ color: "#d46b08", whiteSpace: "nowrap" }}>{(r.stock || 0) <= 0 ? "已断货" : `可售${r.sale_days ?? "?"}天`}</span>
                </div>
              ))}
              {restockView.length === 0 && <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>无需补货</div>}
            </Card>
            <Card size="small" title="紧急备货在途" extra={<a onClick={() => setActiveTab("stock")}>全部</a>} loading={stockLoading}>
              {stockView.slice(0, 6).map((r) => (
                <div key={r.__rk} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Tag>{r.store_code || r.mall_id}</Tag>{r.product_name || r.sku_ext_code || "—"}</span>
                  <span style={{ color: "#cf1322", whiteSpace: "nowrap" }}>缺{r.gap}</span>
                </div>
              ))}
              {stockView.length === 0 && <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>无备货缺口</div>}
            </Card>
          </div>
        </div>
      ),
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
          <div style={{ padding: "12px 16px 0" }}>
            <Segmented value={storeSeg} onChange={(v) => setStoreSeg(v as string)} options={[{ label: "健康体检", value: "health" }, { label: "销量趋势", value: "trend" }]} />
          </div>
          {storeSeg === "health" ? (
            <div>
              <div style={{ padding: "12px 16px 0", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                <Statistic title="店铺数" value={shopView.length} />
                <Statistic title="缺货SKC合计" value={shopAgg.lack} valueStyle={{ color: shopAgg.lack > 0 ? "#d46b08" : undefined }} />
                <Statistic title="已售罄合计" value={shopAgg.soldout} valueStyle={{ color: shopAgg.soldout > 0 ? "#cf1322" : undefined }} />
                <Statistic title="今日销量合计" value={shopAgg.sales} />
              </div>
              <div style={{ padding: "8px 16px 0", color: "#888", fontSize: 12 }}>各店体检:销量 / 在售 / 缺货 / 售罄 / 90天售后率,按已售罄、缺货降序。</div>
              {commonFilters()}
              <Table<ShopHealthRow> dataSource={shopView} columns={shopColumns} rowKey={(r) => String(r.__rk)} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1200 }} loading={shopLoading} />
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
          <div style={{ padding: "12px 16px 0" }}>
            <Segmented value={prodSeg} onChange={(v) => setProdSeg(v as string)} options={[{ label: "运营全景", value: "panel" }, { label: "诊断待办", value: "diag" }, { label: "补货清单", value: "restock" }]} />
          </div>
          {prodSeg === "panel" ? (
            <div>
              <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>每个商品(SPU)横向集成:可报活动 / 合规状态 / 流量(曝光·点击·转化) / 高价限流。按 限流 &gt; 违规 &gt; 活动 排序;流量「无」表示该商品暂未采到(采集覆盖待提升)。总库存 = 可用 + 暂不可用 − 缺货件数 + 发货在途。</div>
              {commonFilters()}
              <Table<ProductPanelRow> className="op-panel-table" dataSource={panelView} columns={panelColumns} rowKey={(r) => String(r.__rk)} size="small" pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 个商品` }} scroll={{ x: 1300 }} loading={panelLoading} />
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
          <div style={{ padding: "12px 16px 0", color: "#888", fontSize: 12 }}>按<b>店铺 → 商品(货号) → 活动</b>维度:同一商品的各可报活动相邻。用<b>真实成本</b>(加权均价)算每个申报价下的真实利润率;「建议申报价」默认=活动参考价,可改;申报价&lt;成本标红「亏本」。「仅有货号」滤掉活动表头噪声(显示「—」的)。提交报名(单店worker)/下发多店任务(扩展)。</div>
          {commonFilters(
            <>
              <Select size="small" style={{ width: 120 }} value={kindFilter} onChange={setKindFilter} options={[{ value: "all", label: "全部类型" }, { value: "activity", label: "活动" }, { value: "bidding", label: "竞价" }, { value: "coupon", label: "优惠券" }]} />
              <Select size="small" style={{ width: 130 }} value={actSkuOnly ? "sku" : "all"} onChange={(v) => setActSkuOnly(v === "sku")} options={[{ value: "sku", label: "仅有货号" }, { value: "all", label: "含活动表头" }]} />
            </>,
          )}
          <div style={{ padding: "0 16px 8px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>批量填写(当前 {actView.length} 行):</Typography.Text>
            <InputNumber size="small" min={0} step={0.1} precision={2} prefix="¥" placeholder="申报价" value={batchPrice ?? undefined} style={{ width: 110 }} onChange={(v) => setBatchPrice(v == null ? null : Number(v))} />
            <Button size="small" disabled={batchPrice == null} onClick={() => { const next = { ...enrollDraft }; for (const r of actView) { const k = enrollKey(r); next[k] = { ...(next[k] || {}), price: batchPrice! }; } persistDraft(next); }}>按此价填</Button>
            <Button size="small" onClick={() => { const next = { ...enrollDraft }; for (const r of actView) { const p = r.suggested_price ?? r.signup_price; if (p == null) continue; const k = enrollKey(r); next[k] = { ...(next[k] || {}), price: p }; } persistDraft(next); }}>按参考价填</Button>
            <InputNumber size="small" min={0} precision={0} placeholder="库存" value={batchStock ?? undefined} style={{ width: 90 }} onChange={(v) => setBatchStock(v == null ? null : Number(v))} />
            <Button size="small" disabled={batchStock == null} onClick={() => { const next = { ...enrollDraft }; for (const r of actView) { const k = enrollKey(r); next[k] = { ...(next[k] || {}), stock: batchStock! }; } persistDraft(next); }}>填库存</Button>
            <Button size="small" danger onClick={() => { const next = { ...enrollDraft }; for (const r of actView) delete next[enrollKey(r)]; persistDraft(next); }}>清空草稿</Button>
            <Button type="primary" size="small" loading={enrollBusy} disabled={!selActRows.length} onClick={submitEnroll}>提交报名 ({selActRows.length})</Button>
            <Tooltip title="把勾选行按(店×活动)下发到云端,由各店登录态浏览器扩展自动报名,免逐店切登(需云端+扩展已部署)">
              <Button size="small" loading={enrollBusy} disabled={!selActRows.length} onClick={submitViaExtension}>下发多店任务 ({selActRows.length})</Button>
            </Tooltip>
          </div>
          <Table<ActivityRow> dataSource={actView} columns={actColumns} rowKey={(r) => String(r.__rk)} size="small"
            rowSelection={{ selectedRowKeys: selActRows.map((r) => String(r.__rk)), onChange: (_, rows) => setSelActRows(rows as ActivityRow[]), getCheckboxProps: (r) => ({ disabled: !r.activity_id || !r.sku_ext_code }) }}
            pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], selectComponentClass: NoSearchSelect, showTotal: (t) => `共 ${t} 条` }} scroll={{ x: 1240 }} loading={actLoading} />
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
          <Button icon={<ReloadOutlined />} loading={skuLoading || riskLoading || actLoading || shopLoading || trendLoading || stockLoading || panelLoading} onClick={() => { loadSku(); setShopLoaded(false); setTrendLoaded(false); setStockLoaded(false); setRiskLoaded(false); setActLoaded(false); setPanelLoaded(false); loadShop(); if (activeTab === "store") loadTrend(); else if (activeTab === "stock") loadStockOrders(); else if (activeTab === "risk") loadRisk(); else if (activeTab === "activity") loadAct(); else if (activeTab === "product") loadPanel(); else if (activeTab === "todo") { loadRisk(); loadAct(); } else if (activeTab === "overview") { loadTrend(); loadStockOrders(); loadRisk(); loadAct(); } message.success("已刷新"); }}>刷新</Button>
        </div>}
        bodyStyle={{ padding: 0 }}
      >
        {error && <Alert type="error" showIcon message="加载失败" description={error} style={{ margin: 16 }} action={<Button size="small" onClick={loadSku}>重试</Button>} />}
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} tabBarStyle={{ paddingLeft: 16, marginBottom: 0 }} />
      </Card>
    </div>
  );
}
