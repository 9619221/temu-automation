// 运营工作台数据层:把原 OperationsWorkbench 里 16 个 load 函数(裸 useState+useEffect)改写成 SWR hooks。
// 收益:同 key 全局去重(多个 Tab 用同一 hook 只发一次请求=字典共享)、统一 loading/error、mutate 手动刷新。
// 行为对齐原实现:
//   - enabled 参数实现「按需加载」(等价原 activeTab 条件):enabled=false → key=null → 不请求。
//   - 首次拉满即停,不自动重验(revalidateIfStale/OnFocus 关),等同原 loaded 标记;顶部刷新走 reloadAllOpsReports()。
//   - loaded = data !== undefined(SWR 成功取过一次),供卡片「未加载显示『查看』」等原逻辑复用。
import useSWR, { type SWRConfiguration, mutate as globalMutate } from "swr";
import type {
  SkuRow, RiskRow, ActivityRow, ActProductRow, ShopHealthRow, StockOrderRow, TrendRow,
  AdMallRow, ProductPanelRow, FirstShipRow, GoodsCreatedRow, QcRow, QualityRow, QualityShopRow,
  ReviewRow, HpfRow, LifecycleRow,
} from "../types/opsWorkbench";

// 首次拉满即停,不自动重验(对齐原 loaded 标记语义);刷新统一走 mutate()。
const SWR_OPTS: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  revalidateIfStale: false,
  shouldRetryOnError: false,
  dedupingInterval: 5 * 60 * 1000,
};

type ReportsApi = NonNullable<NonNullable<typeof window.electronAPI>["erp"]>["reports"];
const reportsApi = (): ReportsApi | undefined => window.electronAPI?.erp?.reports;
// 官方开放平台记录(广告/生命周期)走 temuOpenApi.listRecords,preload 未声明强类型,沿用原 any 访问。
const openApi = (): any => (window.electronAPI as any)?.erp?.temuOpenApi;

// 通用:reports.<method>({includeTest:false}) → resp.data.rows。method 不存在则返回 []。
async function fetchRows<T>(method: keyof ReportsApi): Promise<T[]> {
  const api = reportsApi();
  const fn = api?.[method] as undefined | ((arg: { includeTest: boolean }) => Promise<any>);
  if (!fn) return [];
  const resp = await fn({ includeTest: false });
  if (resp?.ok && resp.data) return (resp.data.rows || []) as T[];
  return [];
}

// 简单 rows 型 hook 工厂:统一 enabled/loaded/reload 三件套,消除 16 处样板。
function makeRowsHook<T>(keyName: string, method: keyof ReportsApi) {
  return function useRowsHook(enabled = true) {
    const { data, isLoading, mutate } = useSWR<T[]>(enabled ? `ops:${keyName}` : null, () => fetchRows<T>(method), SWR_OPTS);
    return { rows: data ?? [], loading: isLoading, loaded: data !== undefined, reload: () => mutate() };
  };
}

export const useSkuSales = makeRowsHook<SkuRow>("skuSales", "skuSales");
export const useRiskList = makeRowsHook<RiskRow>("riskList", "riskList");
export const useShopHealth = makeRowsHook<ShopHealthRow>("shopHealth", "shopHealth");
export const useStockOrders = makeRowsHook<StockOrderRow>("stockOrders", "stockOrders");
export const useSalesTrend = makeRowsHook<TrendRow>("salesTrend", "salesTrend");
export const useProductPanel = makeRowsHook<ProductPanelRow>("productPanel", "productPanel");
export const useFirstShipToday = makeRowsHook<FirstShipRow>("firstShipToday", "firstShipToday");
export const useGoodsCreatedToday = makeRowsHook<GoodsCreatedRow>("goodsCreatedToday", "goodsCreatedToday");
export const useOpenapiQc = makeRowsHook<QcRow>("openapiQc", "openapiQc");
export const useHighPriceFlow = makeRowsHook<HpfRow>("highPriceFlow", "highPriceFlow");
export const useReviews = makeRowsHook<ReviewRow>("reviews", "reviews");

// 活动报名:后端返回 products[](概览),前端摊平成 ActivityRow[](今日待办/最小库存/报名弹窗复用)。
export function useActivityList(enabled = true) {
  const { data, isLoading, mutate } = useSWR<{ products: ActProductRow[]; rows: ActivityRow[] }>(
    enabled ? "ops:activityList" : null,
    async () => {
      const api = reportsApi();
      if (!api?.activityList) return { products: [], rows: [] };
      const resp = await api.activityList({ includeTest: false });
      if (!resp?.ok || !resp.data) return { products: [], rows: [] };
      const products = ((resp.data as { products?: ActProductRow[] }).products || []) as ActProductRow[];
      const flat: ActivityRow[] = [];
      for (const p of products) for (const a of p.activities) {
        flat.push({ mall_id: p.mall_id, store_code: p.store_code, mall_name: p.mall_name,
          kind: a.kind, title: a.title, status: a.status, activity_id: a.activity_id,
          product_id: p.product_id, activity_type: a.activity_type, sku_id: a.sku_id,
          sku_ext_code: p.sku_ext_code, skc_id: p.skc_id, color_spec: p.color_spec ?? null, product_name: p.product_name, thumb: p.thumb,
          signup_price: a.signup_price, suggested_price: a.suggested_price, price_diff: a.price_diff,
          activity_stock: a.activity_stock, cost: a.cost, end_at: a.end_at, stat_date: null, __rk: flat.length });
      }
      return { products, rows: flat };
    },
    SWR_OPTS,
  );
  return { products: data?.products ?? [], rows: data?.rows ?? [], loading: isLoading, loaded: data !== undefined, reload: () => mutate() };
}

// 商品品质看板:后端返回 rows(商品级) + shops(店铺级 90 天指标)。
export function useQualityPanel(enabled = true) {
  const { data, isLoading, mutate } = useSWR<{ rows: QualityRow[]; shops: QualityShopRow[] }>(
    enabled ? "ops:qualityPanel" : null,
    async () => {
      const api = reportsApi();
      if (!api?.qualityPanel) return { rows: [], shops: [] };
      const resp = await api.qualityPanel({ includeTest: false });
      if (!resp?.ok || !resp.data) return { rows: [], shops: [] };
      return {
        rows: ((resp.data.rows || []) as unknown as QualityRow[]),
        shops: ((resp.data.shops || []) as unknown as QualityShopRow[]),
      };
    },
    SWR_OPTS,
  );
  return { rows: data?.rows ?? [], shops: data?.shops ?? [], loading: isLoading, loaded: data !== undefined, reload: () => mutate() };
}

// 官方店铺维度广告/流量(ad_report_mall):原始指标在 raw.summary.<k>.total.val。
export function useAdReport(enabled = true) {
  const { data, isLoading, mutate } = useSWR<AdMallRow[]>(
    enabled ? "ops:adReportMall" : null,
    async () => {
      const api = openApi();
      if (!api?.listRecords) return [];
      const resp = await api.listRecords("ad_report_mall");
      return ((resp?.rows || []) as any[]).map((r) => {
        const sum = (r.raw && r.raw.summary) || {};
        const g = (k: string) => (sum[k] && sum[k].total && sum[k].total.val != null) ? Number(sum[k].total.val) : null;
        return {
          mall_id: String(r.mall_id), store: String(r.mall_id),
          imprCnt: g("imprCnt"), clkCnt: g("clkCnt"), ctr: g("ctr"), cartCnt: g("cartCnt"),
          cvr: g("cvr"), orderPayCnt: g("orderPayCnt"), orderPayAmt: g("orderPayAmt"),
          spend: g("spend"), roas: g("roas"), acos: g("acos"),
        } as AdMallRow;
      });
    },
    SWR_OPTS,
  );
  return { rows: data ?? [], loading: isLoading, loaded: data !== undefined, reload: () => mutate() };
}

// 官方生命周期/选品状态(product_lifecycle),含 mall_id 供「我的店」过滤。
export function useLifecycle(enabled = true) {
  const { data, isLoading, mutate } = useSWR<LifecycleRow[]>(
    enabled ? "ops:lifecycle" : null,
    async () => {
      const api = openApi();
      if (!api?.listRecords) return [];
      const lc = await api.listRecords("product_lifecycle");
      const rows: LifecycleRow[] = [];
      for (const r of ((lc?.rows || []) as any[])) {
        if (r?.product_skc_id != null && r?.status != null) rows.push({ mall_id: String(r.mall_id ?? ""), skc_id: String(r.product_skc_id), status: String(r.status) });
      }
      return rows;
    },
    SWR_OPTS,
  );
  return { rows: data ?? [], loading: isLoading, loaded: data !== undefined, reload: () => mutate() };
}

// 顶部「统一刷新」:让所有运营工作台 SWR key 重新验证(等价原来逐个 load())。
export function reloadAllOpsReports() {
  return globalMutate((key) => typeof key === "string" && key.startsWith("ops:"), undefined, { revalidate: true });
}
