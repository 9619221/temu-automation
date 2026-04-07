import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Divider, Drawer, Empty, Image, Input, Modal, Popover, Radio, Row, Segmented, Space, Spin, Statistic, Table, Tabs, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  AppstoreOutlined,
  FireOutlined,
  PictureOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
  StopOutlined,
  SyncOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLocation, useNavigate } from "react-router-dom";
import EmptyGuide from "../components/EmptyGuide";
import PageHeader from "../components/PageHeader";
import {
  parseOrdersData,
  parseProductCountSummary,
  parseProductsData,
  parseSalesData,
} from "../utils/parseRawApis";
import {
  COLLECTION_DIAGNOSTICS_KEY,
  getCollectionDataIssue,
  normalizeCollectionDiagnostics,
  type CollectionDiagnostics,
} from "../utils/collectionDiagnostics";
import { getStoreValue } from "../utils/storeCompat";
import { ACTIVE_ACCOUNT_CHANGED_EVENT, STORE_VALUE_UPDATED_EVENT } from "../utils/multiStore";

const store = window.electronAPI?.store;

type StatusFilter = "all" | "在售" | "已下架" | "未发布" | "other" | "saleOut" | "soonSaleOut" | "shortage" | "advice";

type ProductSkuSpec = {
  parentSpecName: string;
  specName: string;
  unitSpecName: string;
};

type ProductSkuSummary = {
  productSkuId: string;
  thumbUrl: string;
  productSkuSpecList: ProductSkuSpec[];
  specText: string;
  specName: string;
  extCode: string;
};

interface ProductItem {
  title: string;
  category: string;
  categories: string;
  spuId: string;
  skcId: string;
  goodsId: string;
  sku: string;
  extCode: string;
  skuId: string;
  skuName: string;
  imageUrl: string;
  siteLabel: string;
  productType: string;
  sourceType: string;
  removeStatus: string;
  status: string;
  skcSiteStatus: string;
  flowLimitStatus: string;
  skuSummaries: ProductSkuSummary[];
  todaySales: number;
  last30DaysSales: number;
  totalSales: number;
  last7DaysSales: number;
  syncedAt: string;
  warehouseStock: number;
  occupyStock: number;
  unavailableStock: number;
  lackQuantity: number;
  price: string | number;
  stockStatus: string;
  supplyStatus: string;
  pendingOrderCount: number;
  hotTag?: string;
  availableSaleDays?: string | number | null;
  asfScore?: string | number;
  buyerName?: string;
  buyerUid?: string;
  operatorContact?: string;
  operatorNick?: string;
  highPriceFlowLimit?: boolean;
  highPriceFlowInfo?: any;
  commentNum?: number;
  inBlackList?: string;
  pictureAuditStatus?: string;
  qualityAfterSalesRate?: string | number;
  predictTodaySaleVolume?: number;
  sevenDaysSaleReference?: number;
  sevenDaysAddCartNum?: number;
  hasSalesSnapshot?: boolean;
  salesRaw?: any;
  salesRawSku?: any;
  trendDaily?: Array<{ date: string; salesNumber: number }>;
}

interface ProductSourceState {
  products: boolean;
  sales: boolean;
  orders: boolean;
}

interface ProductCountSummary {
  totalCount: number;
  onSaleCount: number;
  notPublishedCount: number;
  offSaleCount: number;
}

const EMPTY_SOURCES: ProductSourceState = {
  products: false,
  sales: false,
  orders: false,
};

const EMPTY_COUNT_SUMMARY: ProductCountSummary = {
  totalCount: 0,
  onSaleCount: 0,
  notPublishedCount: 0,
  offSaleCount: 0,
};

const EMPTY_IMAGE_FALLBACK =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

function normalizeLookupValue(value: string) {
  return (value || "").replace(/\s+/g, "").trim().toLowerCase();
}

function normalizeImageUrl(value: unknown): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeImageUrl(item);
      if (normalized) return normalized;
    }
    return "";
  }

  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw || raw === "null" || raw === "undefined" || raw === "[object Object]") return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("data:image/")) return raw;
  const remoteMatch = raw.match(/https?:\/\/[^\s"'\\]+/i);
  return remoteMatch?.[0] || raw;
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function formatTextValue(value: unknown) {
  const text = normalizeText(value);
  return text || "-";
}

function formatSourceType(value: unknown) {
  const text = normalizeText(value);
  const sourceTypeMap: Record<string, string> = {
    "0": "普通发布",
  };
  if (!text) return "-";
  return sourceTypeMap[text] || `来源类型 ${text}`;
}

function toNumberValue(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeStatusText(value: unknown) {
  const text = normalizeText(value);
  const statusMap: Record<string, string> = {
    "0": "在售",
    "1": "已下架",
    "100": "在售",
    "200": "未发布到站点",
    "300": "已下架/已终止",
  };
  return statusMap[text] || text;
}

function getPrimaryCategory(product: ProductItem) {
  return product.category || product.categories || "";
}

function formatSyncedAt(value?: string | null) {
  return value ? `最近同步：${value}` : "等待首次采集";
}

function renderSnapshotField(label: string, value: unknown, accent = false) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div style={{ fontSize: 12, color: "var(--color-text-sec)" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: accent ? 700 : 500, color: accent ? "var(--color-brand)" : "var(--color-text)" }}>
        {formatTextValue(value)}
      </div>
    </div>
  );
}

function hasMeaningfulSnapshotValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return true;
  const text = String(value).trim();
  return Boolean(text);
}

function buildLookupKeys(source: Partial<ProductItem>) {
  const titleKey = normalizeLookupValue(source.title || "");
  const idKeys = [
    source.skcId ? `skc:${source.skcId}` : "",
    source.goodsId ? `goods:${source.goodsId}` : "",
    source.spuId ? `spu:${source.spuId}` : "",
  ].filter(Boolean);

  if (idKeys.length > 0) return idKeys;
  return titleKey ? [`title:${titleKey}`] : [];
}

function getLatestSyncedAt(products: ProductItem[], diagnostics: CollectionDiagnostics | null) {
  if (diagnostics?.syncedAt) return diagnostics.syncedAt;
  for (const product of products) {
    if (product.syncedAt) return product.syncedAt;
  }
  return "";
}

function mergeTextValue(current: unknown, next: unknown) {
  const values = [current, next]
    .flatMap((value) => String(value ?? "").split(/\s*[,/|]\s*/))
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(values)).join(" / ");
}

function mergeAvailableSaleDays(current: unknown, next: unknown) {
  const currentNum = Number(current);
  const nextNum = Number(next);
  if (Number.isFinite(currentNum) && Number.isFinite(nextNum)) return Math.max(currentNum, nextNum);
  if (Number.isFinite(nextNum)) return nextNum;
  return normalizeText(next) || normalizeText(current);
}

function normalizeSkuSummaryList(value: unknown): ProductSkuSummary[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();

  return value
    .map((item: any) => {
      const specList: ProductSkuSpec[] = Array.isArray(item?.productSkuSpecList)
        ? item.productSkuSpecList.map((spec: any) => ({
            parentSpecName: normalizeText(spec?.parentSpecName),
            specName: normalizeText(spec?.specName),
            unitSpecName: normalizeText(spec?.unitSpecName),
          }))
        : [];

      const specText = normalizeText(item?.specText)
        || specList
          .map((spec) => {
            const label = spec.parentSpecName || "规格";
            const valueText = spec.specName || spec.unitSpecName;
            return valueText ? `${label}: ${valueText}` : "";
          })
          .filter(Boolean)
          .join(" / ");

      return {
        productSkuId: normalizeText(item?.productSkuId),
        thumbUrl: normalizeImageUrl(item?.thumbUrl),
        productSkuSpecList: specList,
        specText,
        specName: normalizeText(item?.specName || specList[0]?.specName),
        extCode: normalizeText(item?.extCode),
      };
    })
    .filter((item) => {
      const key = [item.productSkuId, item.extCode, item.specText].filter(Boolean).join("|");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildSearchIndex(product: ProductItem) {
  const skuTexts = product.skuSummaries.flatMap((sku) => [
    sku.productSkuId,
    sku.extCode,
    sku.specText,
    ...sku.productSkuSpecList.map((spec: ProductSkuSpec) => spec.specName),
  ]);

  return [
    product.title,
    product.skcId,
    product.goodsId,
    product.spuId,
    product.sku,
    product.extCode,
    product.productType,
    product.sourceType,
    product.removeStatus,
    product.skcSiteStatus,
    product.flowLimitStatus,
    product.siteLabel,
    product.category,
    product.categories,
    product.skuId,
    product.skuName,
    product.hotTag,
    product.buyerName,
    product.buyerUid,
    ...skuTexts,
  ]
    .map((item) => normalizeLookupValue(String(item || "")))
    .filter(Boolean)
    .join(" ");
}

function renderStatusTag(text: string, color: "default" | "success" | "warning" | "error" = "default") {
  if (!text) return <Tag>待同步</Tag>;
  return <Tag color={color}>{text}</Tag>;
}

export default function ProductList() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [salesSummary, setSalesSummary] = useState<any>(null);
  const [countSummary, setCountSummary] = useState<ProductCountSummary>(EMPTY_COUNT_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);
  const [diagnostics, setDiagnostics] = useState<CollectionDiagnostics | null>(null);
  const [sourceState, setSourceState] = useState<ProductSourceState>(EMPTY_SOURCES);
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);
  const [drawerTab, setDrawerTab] = useState<string>("overview");
  const [gpDetailOpen, setGpDetailOpen] = useState(false);
  const [gpDetailLoading, setGpDetailLoading] = useState(false);
  const [gpDetailRow, setGpDetailRow] = useState<{ productId: number | null; productName?: string; skcId?: any } | null>(null);
  const [gpDetailData, setGpDetailData] = useState<any>(null);
  const [gpDetailRange, setGpDetailRange] = useState<"1d" | "7d" | "30d">("7d");

  const openGpDetail = async (record: any, range?: "1d" | "7d" | "30d") => {
    const gp = record?.gp;
    const pid = gp?.productId;
    if (!pid) { message.error("该商品缺少 productId，请先在 数据采集 页运行 全球销量+地区明细"); return; }
    const r = range || gpDetailRange;
    setGpDetailRange(r);
    setGpDetailRow({ productId: pid, productName: gp.productName || record.title, skcId: record.skcId });
    setGpDetailOpen(true);
    setGpDetailData(null);
    setGpDetailLoading(true);
    try {
      const api = (window as any).electronAPI?.automation;
      const res = await api?.scrapeSkcRegionDetail?.(pid, r);
      if (res && typeof res === "object") {
        setGpDetailData(res);
        if (res.error) message.warning(res.error);
      }
    } catch (e: any) {
      message.error(`查询失败：${e?.message || e}`);
    } finally {
      setGpDetailLoading(false);
    }
  };
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    void loadProducts();
    const handleActiveAccountChanged = () => {
      void loadProducts();
    };
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const handleStoreValueUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ baseKey?: string | null }>)?.detail;
      if (!detail?.baseKey || !["temu_products", "temu_sales", "temu_orders", COLLECTION_DIAGNOSTICS_KEY].includes(detail.baseKey)) {
        return;
      }
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        void loadProducts();
      }, 120);
    };
    window.addEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    window.addEventListener(STORE_VALUE_UPDATED_EVENT, handleStoreValueUpdated as EventListener);
    return () => {
      window.removeEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
      window.removeEventListener(STORE_VALUE_UPDATED_EVENT, handleStoreValueUpdated as EventListener);
      if (reloadTimer) clearTimeout(reloadTimer);
    };
  }, []);

  useEffect(() => {
    if (location.pathname === "/products") {
      void loadProducts();
    }
  }, [location.pathname]);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const [accounts, rawProducts, rawSales, rawOrders, diagnosticsRaw, rawLifecycle, rawFlowPrice, rawYunduOverall, rawGlobalPerf] = await Promise.all([
        store?.get("temu_accounts"),
        getStoreValue(store, "temu_products"),
        getStoreValue(store, "temu_sales"),
        getStoreValue(store, "temu_orders"),
        getStoreValue(store, COLLECTION_DIAGNOSTICS_KEY),
        getStoreValue(store, "temu_raw_lifecycle"),
        getStoreValue(store, "temu_raw_flowPrice"),
        getStoreValue(store, "temu_raw_yunduOverall"),
        getStoreValue(store, "temu_raw_globalPerformance"),
      ]);

      // 全球业务表现：按 skcId 索引
      const gpSkcMap = new Map<string, { sales: number; changeRate: number; trend: any[]; productId: number | null; productName?: string }>();
      try {
        const skcSales: any[] = (rawGlobalPerf as any)?.skcSales || [];
        for (const r of skcSales) {
          const k = r?.skcId != null ? String(r.skcId) : "";
          if (!k) continue;
          gpSkcMap.set(k, {
            sales: Number(r.sales) || 0,
            changeRate: Number(r.changeRate) || 0,
            trend: Array.isArray(r.trend) ? r.trend : [],
            productId: r.productId ?? null,
            productName: r.productName,
          });
        }
      } catch (e) { console.warn("[ProductList] globalPerf parse error", e); }

      // 云舵 listOverall: 按 skcId 索引（提供「已加站点列表」「处罚原因」）
      const yunduSkcMap = new Map<string, any>();
      try {
        const yList: any[] = (rawYunduOverall as any)?.list || [];
        for (const it of yList) {
          const skc = it?.skcId != null ? String(it.skcId) : "";
          if (!skc) continue;
          yunduSkcMap.set(skc, it);
        }
        console.log("[ProductList] yunduSkcMap size:", yunduSkcMap.size);
      } catch (e) { console.warn("[ProductList] yundu parse error", e); }

      // Build SKC/goodsId/productId -> contact(对接运营) maps from lifecycle searchForChainSupplier
      const operatorMap = new Map<string, string>();
      const operatorByGoodsId = new Map<string, string>();
      const operatorByProductId = new Map<string, string>();
      const operatorNickMap = new Map<string, string>();
      const operatorNickByGoodsId = new Map<string, string>();
      const operatorNickByProductId = new Map<string, string>();
      // Also collect highPriceProductSearchLimit from skcList for 高价限流
      const skcLimitMap = new Map<string, any>();
      try {
        const lc: any = rawLifecycle;
        const lcApis = lc?.apis || lc?.value?.apis || lc?.lifecycle?.apis || lc?.data?.apis || [];
        const processItems = (items: any[]) => {
          if (!Array.isArray(items)) return;
          for (const it of items) {
            const contact = String(it?.contact ?? "").trim();
            const nick = String(it?.nickContact ?? "").trim();
            if (!contact && !nick) continue;
            const gid = it?.goodsId != null ? String(it.goodsId) : "";
            const pid = it?.productId != null ? String(it.productId) : "";
            if (gid) { if (contact) operatorByGoodsId.set(gid, contact); if (nick) operatorNickByGoodsId.set(gid, nick); }
            if (pid) { if (contact) operatorByProductId.set(pid, contact); if (nick) operatorNickByProductId.set(pid, nick); }
            const skcs = Array.isArray(it?.skcList) ? it.skcList : [];
            for (const s of skcs) {
              const skc = s?.skcId != null ? String(s.skcId) : "";
              if (skc) {
                if (contact) operatorMap.set(skc, contact);
                if (nick) operatorNickMap.set(skc, nick);
                if (s?.highPriceProductSearchLimit != null || s?.highPriceProductSearchLimitBeginTime || s?.highPriceProductSearchLimitEndTime) {
                  skcLimitMap.set(skc, s);
                }
              }
            }
            // also try top-level skc fields just in case
            const topSkc = String(it?.skcId ?? it?.productSkcId ?? "").trim();
            if (topSkc) { if (contact) operatorMap.set(topSkc, contact); if (nick) operatorNickMap.set(topSkc, nick); }
          }
        };
        if (Array.isArray(lcApis)) {
          for (const api of lcApis) {
            const path = String(api?.path || "");
            if (!path.includes("searchForChainSupplier")) continue;
            const r = api?.data?.result || api?.data || {};
            processItems(r?.dataList || r?.items || r?.list || r?.data || r?.pageItems || []);
          }
        }
        console.log("[ProductList] lc top keys:", lc ? Object.keys(lc) : null, "lcApis len:", Array.isArray(lcApis) ? lcApis.length : "n/a");
        console.log("[ProductList] operatorMap sizes - skc:", operatorMap.size, "goodsId:", operatorByGoodsId.size, "productId:", operatorByProductId.size);
        if (operatorMap.size > 0) console.log("[ProductList] operator sample skc:", [...operatorMap.entries()].slice(0,3));
      } catch (e) { console.warn("[ProductList] lifecycle parse error", e); }

      setHasAccount(Array.isArray(accounts) && accounts.length > 0);
      setDiagnostics(normalizeCollectionDiagnostics(diagnosticsRaw));

      const parsedProducts = parseProductsData(rawProducts);
      const parsedSales = parseSalesData(rawSales);
      const parsedOrders = parseOrdersData(rawOrders);
      const productCounts = parseProductCountSummary(rawProducts);
      const salesItems = Array.isArray(parsedSales?.items) ? parsedSales.items : [];

      setSalesSummary(parsedSales?.summary || null);
      setCountSummary(productCounts);
      setSourceState({
        products: parsedProducts.length > 0,
        sales: salesItems.length > 0,
        orders: parsedOrders.length > 0,
      });

      const lookup = new Map<string, ProductItem>();
      const salesMergedProducts = new WeakSet<ProductItem>();

      const register = (product: ProductItem) => {
        buildLookupKeys(product).forEach((key) => {
          lookup.set(key, product);
        });
      };

      const findExisting = (source: Partial<ProductItem>) => {
        const keys = buildLookupKeys(source);
        for (const key of keys) {
          const found = lookup.get(key);
          if (found) return found;
        }
        return null;
      };

      const ensureProduct = (source: Partial<ProductItem>) => {
        const existing = findExisting(source);
        if (existing) return existing;

        const skuSummaries = normalizeSkuSummaryList(source.skuSummaries);
        const product: ProductItem = {
          title: source.title || "",
          category: source.category || "",
          categories: source.categories || "",
          spuId: source.spuId || "",
          skcId: source.skcId || "",
          goodsId: source.goodsId || "",
          sku: source.sku || "",
          extCode: source.extCode || "",
          skuId: source.skuId || "",
          skuName: source.skuName || "",
          imageUrl: normalizeImageUrl(source.imageUrl) || skuSummaries[0]?.thumbUrl || "",
          siteLabel: source.siteLabel || "",
          productType: source.productType || "",
          sourceType: source.sourceType || "",
          removeStatus: source.removeStatus || "",
          status: source.status || "",
          skcSiteStatus: source.skcSiteStatus || "",
          flowLimitStatus: source.flowLimitStatus || "",
          skuSummaries,
          todaySales: source.todaySales || 0,
          last30DaysSales: source.last30DaysSales || 0,
          totalSales: source.totalSales || 0,
          last7DaysSales: source.last7DaysSales || 0,
          syncedAt: source.syncedAt || "",
          warehouseStock: source.warehouseStock || 0,
          occupyStock: source.occupyStock || 0,
          unavailableStock: source.unavailableStock || 0,
          lackQuantity: source.lackQuantity || 0,
          price: source.price || "",
          stockStatus: source.stockStatus || "",
          supplyStatus: source.supplyStatus || "",
          pendingOrderCount: source.pendingOrderCount || 0,
          hotTag: source.hotTag || "",
          availableSaleDays: source.availableSaleDays ?? "",
          asfScore: source.asfScore,
          buyerName: source.buyerName || "",
          buyerUid: source.buyerUid || "",
          commentNum: source.commentNum ?? 0,
          inBlackList: source.inBlackList || "",
          pictureAuditStatus: source.pictureAuditStatus || "",
          qualityAfterSalesRate: source.qualityAfterSalesRate ?? "",
          predictTodaySaleVolume: source.predictTodaySaleVolume ?? 0,
          sevenDaysSaleReference: source.sevenDaysSaleReference ?? 0,
          hasSalesSnapshot: Boolean(source.hasSalesSnapshot),
        };
        register(product);
        return product;
      };

      parsedProducts.forEach((item: any) => {
        const normalizedSkuSummaries = normalizeSkuSummaryList(item.skuSummaries);
        const product = ensureProduct({
          title: item.title || "",
          category: item.category || "",
          categories: item.categories || "",
          spuId: normalizeText(item.spuId),
          skcId: normalizeText(item.skcId),
          goodsId: normalizeText(item.goodsId),
          sku: item.sku || "",
          extCode: item.extCode || "",
          imageUrl: normalizeImageUrl(item.imageUrl),
          siteLabel: item.siteLabel || "",
          productType: item.productType || "",
          sourceType: item.sourceType || "",
          removeStatus: normalizeText(item.removeStatus),
          status: item.status || "",
          skcSiteStatus: normalizeText(item.skcSiteStatus),
          flowLimitStatus: normalizeText(item.flowLimitStatus),
          skuSummaries: normalizedSkuSummaries,
          todaySales: item.todaySales || 0,
          totalSales: item.totalSales || 0,
          last7DaysSales: item.last7DaysSales || 0,
          syncedAt: item.syncedAt || "",
        });

        product.title = item.title || product.title;
        product.category = item.category || product.category;
        product.categories = item.categories || product.categories;
        product.spuId = normalizeText(item.spuId) || product.spuId;
        product.skcId = normalizeText(item.skcId) || product.skcId;
        product.goodsId = normalizeText(item.goodsId) || product.goodsId;
        product.sku = item.sku || product.sku;
        product.extCode = item.extCode || product.extCode || product.sku;
        product.imageUrl = normalizeImageUrl(item.imageUrl) || product.imageUrl || normalizedSkuSummaries[0]?.thumbUrl || "";
        product.siteLabel = item.siteLabel || product.siteLabel;
        product.productType = item.productType || product.productType;
        product.sourceType = item.sourceType || product.sourceType;
        product.removeStatus = normalizeText(item.removeStatus) || product.removeStatus;
        product.status = item.status || product.status;
        product.skcSiteStatus = normalizeText(item.skcSiteStatus) || product.skcSiteStatus;
        product.flowLimitStatus = normalizeText(item.flowLimitStatus) || product.flowLimitStatus;
        product.skuSummaries = normalizeSkuSummaryList([
          ...product.skuSummaries,
          ...normalizedSkuSummaries,
        ]);
        product.todaySales = toNumberValue(item.todaySales) || product.todaySales;
        product.totalSales = toNumberValue(item.totalSales) || product.totalSales;
        product.last7DaysSales = toNumberValue(item.last7DaysSales) || product.last7DaysSales;
        product.syncedAt = item.syncedAt || product.syncedAt;
        register(product);
      });

      salesItems.forEach((item: any) => {
        const product = ensureProduct({
          title: item.title || "",
          category: item.category || "",
          spuId: normalizeText(item.spuId),
          skcId: normalizeText(item.skcId),
          goodsId: normalizeText(item.goodsId),
          sku: item.skuCode || "",
          extCode: item.skuCode || "",
          skuId: normalizeText(item.skuId),
          skuName: item.skuName || "",
          imageUrl: normalizeImageUrl(item.imageUrl),
          siteLabel: item.siteLabel || "",
          todaySales: item.todaySales || 0,
          last30DaysSales: item.last30DaysSales || 0,
          totalSales: item.totalSales || 0,
          last7DaysSales: item.last7DaysSales || 0,
          warehouseStock: item.warehouseStock || 0,
          occupyStock: item.occupyStock || 0,
          unavailableStock: item.unavailableStock || 0,
          lackQuantity: item.lackQuantity || 0,
          price: item.price || "",
          syncedAt: parsedSales?.syncedAt || "",
          stockStatus: item.stockStatus || "",
          supplyStatus: item.supplyStatus || "",
          hotTag: item.hotTag || "",
          availableSaleDays: item.availableSaleDays ?? "",
          asfScore: item.asfScore,
          buyerName: item.buyerName || "",
          buyerUid: item.buyerUid || "",
          commentNum: item.commentNum ?? 0,
          inBlackList: item.inBlackList || "",
          pictureAuditStatus: item.pictureAuditStatus || "",
          qualityAfterSalesRate: item.qualityAfterSalesRate ?? "",
          predictTodaySaleVolume: item.predictTodaySaleVolume ?? 0,
          sevenDaysSaleReference: item.sevenDaysSaleReference ?? 0,
          sevenDaysAddCartNum: item.sevenDaysAddCartNum ?? 0,
          hasSalesSnapshot: true,
        });

        const firstSalesRow = !salesMergedProducts.has(product);
        if (firstSalesRow) salesMergedProducts.add(product);

        product.title = product.title || item.title || "";
        product.category = product.category || item.category || "";
        product.spuId = product.spuId || normalizeText(item.spuId);
        product.skcId = product.skcId || normalizeText(item.skcId);
        product.goodsId = product.goodsId || normalizeText(item.goodsId);
        product.sku = mergeTextValue(product.sku, item.skuCode);
        product.extCode = mergeTextValue(product.extCode, item.skuCode || item.extCode);
        product.skuId = mergeTextValue(product.skuId, item.skuId);
        product.skuName = mergeTextValue(product.skuName, item.skuName);
        product.imageUrl = product.imageUrl || normalizeImageUrl(item.imageUrl);
        product.siteLabel = product.siteLabel || item.siteLabel || "";
        product.todaySales = firstSalesRow ? toNumberValue(item.todaySales) : product.todaySales + toNumberValue(item.todaySales);
        product.last7DaysSales = firstSalesRow ? toNumberValue(item.last7DaysSales) : product.last7DaysSales + toNumberValue(item.last7DaysSales);
        product.last30DaysSales = firstSalesRow ? toNumberValue(item.last30DaysSales) : product.last30DaysSales + toNumberValue(item.last30DaysSales);
        product.totalSales = firstSalesRow ? toNumberValue(item.totalSales) : product.totalSales + toNumberValue(item.totalSales);
        product.warehouseStock = firstSalesRow ? toNumberValue(item.warehouseStock) : product.warehouseStock + toNumberValue(item.warehouseStock);
        product.occupyStock = firstSalesRow ? toNumberValue(item.occupyStock) : product.occupyStock + toNumberValue(item.occupyStock);
        product.unavailableStock = firstSalesRow ? toNumberValue(item.unavailableStock) : product.unavailableStock + toNumberValue(item.unavailableStock);
        product.lackQuantity = firstSalesRow ? toNumberValue(item.lackQuantity) : product.lackQuantity + toNumberValue(item.lackQuantity);
        product.price = mergeTextValue(product.price, item.price);
        product.syncedAt = parsedSales?.syncedAt || product.syncedAt;
        product.stockStatus = item.stockStatus || product.stockStatus;
        product.supplyStatus = item.supplyStatus || product.supplyStatus;
        product.hotTag = mergeTextValue(product.hotTag, item.hotTag);
        product.availableSaleDays = mergeAvailableSaleDays(product.availableSaleDays, item.availableSaleDays);
        product.asfScore = item.asfScore ?? product.asfScore ?? "";
        product.buyerName = item.buyerName ?? product.buyerName ?? "";
        product.buyerUid = item.buyerUid ?? product.buyerUid ?? "";
        product.commentNum = Math.max(toNumberValue(product.commentNum), toNumberValue(item.commentNum));
        product.inBlackList = item.inBlackList || product.inBlackList || "";
        product.pictureAuditStatus = item.pictureAuditStatus ?? product.pictureAuditStatus ?? "";
        product.qualityAfterSalesRate = item.qualityAfterSalesRate ?? product.qualityAfterSalesRate ?? "";
        product.predictTodaySaleVolume = firstSalesRow
          ? toNumberValue(item.predictTodaySaleVolume)
          : (product.predictTodaySaleVolume ?? 0) + toNumberValue(item.predictTodaySaleVolume);
        product.sevenDaysSaleReference = firstSalesRow
          ? toNumberValue(item.sevenDaysSaleReference)
          : (product.sevenDaysSaleReference ?? 0) + toNumberValue(item.sevenDaysSaleReference);
        product.sevenDaysAddCartNum = firstSalesRow
          ? toNumberValue(item.sevenDaysAddCartNum)
          : (product.sevenDaysAddCartNum ?? 0) + toNumberValue(item.sevenDaysAddCartNum);
        product.hasSalesSnapshot = true;
        product.salesRaw = item.rawItem || product.salesRaw;
        product.salesRawSku = item.rawFirstSku || product.salesRawSku;
        if (Array.isArray(item.trendDaily) && item.trendDaily.length > 0) {
          product.trendDaily = item.trendDaily;
        }
        register(product);
      });

      parsedOrders.forEach((item: any) => {
        const product = ensureProduct({
          title: item.title || "",
          skcId: normalizeText(item.skcId),
          sku: item.skuCode || "",
          extCode: item.skuCode || "",
          imageUrl: normalizeImageUrl(item.imageUrl),
          pendingOrderCount: 0,
        });
        product.title = product.title || item.title || "";
        product.skcId = product.skcId || normalizeText(item.skcId);
        product.sku = product.sku || item.skuCode || "";
        product.extCode = product.extCode || item.skuCode || "";
        product.imageUrl = product.imageUrl || normalizeImageUrl(item.imageUrl);
        product.pendingOrderCount += 1;
        register(product);
      });

      // Build SKC -> high-price flow-limit map from flowPrice raw store
      // Shape can be either { flowPriceList: {result:{pageItems:[...]}} } (listener)
      // or { apis: [{path, data}] } (page-capture)
      const flowLimitMap = new Map<string, any>();
      try {
        const fp: any = rawFlowPrice;
        let items: any[] = [];
        const extractList = (node: any) => {
          const r = node?.result || node;
          return r?.pageItems || r?.list || r?.items || (Array.isArray(r) ? r : []);
        };
        if (fp?.flowPriceList) items = extractList(fp.flowPriceList);
        if ((!items || !items.length) && fp?.flowPriceOverview) items = extractList(fp.flowPriceOverview);
        if ((!items || !items.length) && Array.isArray(fp?.apis)) {
          for (const api of fp.apis) {
            const p = String(api?.path || "");
            if (p.includes("queryFullHighPriceFlowReduceList") || p.includes("highPriceFlowReduce") || p.includes("high/price")) {
              items = extractList(api.data);
              if (items?.length) break;
            }
          }
        }
        // Deep scan fallback
        if (!items || !items.length) {
          const walk = (obj: any, depth = 0) => {
            if (!obj || depth > 4 || items.length) return;
            if (Array.isArray(obj)) { obj.forEach((v) => walk(v, depth + 1)); return; }
            if (typeof obj === "object") {
              if (Array.isArray(obj.pageItems) && obj.pageItems.some((x: any) => x?.productSkcId || x?.skcId)) {
                items = obj.pageItems; return;
              }
              Object.values(obj).forEach((v) => walk(v, depth + 1));
            }
          };
          walk(fp);
        }
        if (Array.isArray(items)) {
          for (const it of items) {
            const skc = String(it?.productSkcId ?? it?.skcId ?? "").trim();
            if (skc) flowLimitMap.set(skc, it);
          }
        }
        console.log("[ProductList] flowLimitMap size:", flowLimitMap.size, "sample:", items?.[0]);
      } catch (e) { console.warn("[ProductList] flowPrice parse error", e); }

      // Apply operator(对接运营) from lifecycle + high-price flow limit
      const sampleProd = [...lookup.values()][0];
      if (sampleProd) console.log("[ProductList] sample product keys:", { skcId: sampleProd.skcId, goodsId: (sampleProd as any).goodsId, productId: (sampleProd as any).productId });
      let opHits = 0;
      for (const product of lookup.values()) {
        const skc = product.skcId ? String(product.skcId) : "";
        const gid = (product as any).goodsId ? String((product as any).goodsId) : "";
        const pid = (product as any).productId ? String((product as any).productId) : "";
        const contact =
          (skc && operatorMap.get(skc)) ||
          (gid && operatorByGoodsId.get(gid)) ||
          (pid && operatorByProductId.get(pid)) ||
          "";
        const nick =
          (skc && operatorNickMap.get(skc)) ||
          (gid && operatorNickByGoodsId.get(gid)) ||
          (pid && operatorNickByProductId.get(pid)) ||
          "";
        if (contact) { product.operatorContact = contact; opHits++; }
        if (nick) { product.operatorNick = nick; }
        if (skc && flowLimitMap.has(skc)) {
          product.highPriceFlowLimit = true;
          product.highPriceFlowInfo = flowLimitMap.get(skc);
        } else if (skc && skcLimitMap.has(skc)) {
          product.highPriceFlowLimit = true;
          product.highPriceFlowInfo = skcLimitMap.get(skc);
        }
      }

      console.log("[ProductList] operator hits:", opHits, "/", lookup.size);
      const mergedProducts: ProductItem[] = [];
      const seen = new Set<ProductItem>();
      for (const item of lookup.values()) {
        if (seen.has(item)) continue;
        seen.add(item);
        if (!item.title && !item.skcId && !item.goodsId && !item.spuId) continue;
        mergedProducts.push(item);
      }

      mergedProducts.sort((a, b) => {
        if ((b.totalSales || 0) !== (a.totalSales || 0)) return (b.totalSales || 0) - (a.totalSales || 0);
        if ((b.last7DaysSales || 0) !== (a.last7DaysSales || 0)) return (b.last7DaysSales || 0) - (a.last7DaysSales || 0);
        return (a.title || "").localeCompare(b.title || "", "zh-CN");
      });

      // 把云舵 listOverall 数据按 skcId 注入到每个 product 上
      if (yunduSkcMap.size > 0) {
        for (const p of mergedProducts) {
          const key = p.skcId ? String(p.skcId) : "";
          if (key && yunduSkcMap.has(key)) {
            (p as any).yundu = yunduSkcMap.get(key);
          }
        }
      }

      // 全球业务表现 注入
      if (gpSkcMap.size > 0) {
        for (const p of mergedProducts) {
          const key = p.skcId ? String(p.skcId) : "";
          if (key && gpSkcMap.has(key)) {
            (p as any).gp = gpSkcMap.get(key);
          }
        }
      }

      setProducts(mergedProducts);
    } catch (error) {
      console.error("加载商品失败", error);
      setProducts([]);
      setSalesSummary(null);
      setCountSummary(EMPTY_COUNT_SUMMARY);
      setDiagnostics(null);
      setSourceState(EMPTY_SOURCES);
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const keyword = normalizeLookupValue(searchText);
    return products.filter((product) => {
      const matchKeyword = !keyword || buildSearchIndex(product).includes(keyword);
      const statusText = product.status || normalizeStatusText(product.removeStatus);
      const siteStatus = normalizeStatusText(product.skcSiteStatus);
      let matchStatus = true;
      if (statusFilter === "在售") matchStatus = Boolean(product.hasSalesSnapshot);
      else if (statusFilter === "已下架") matchStatus = statusText === "已下架" || statusText === "已下架/已终止";
      else if (statusFilter === "未发布") matchStatus = siteStatus === "未发布到站点" || statusText === "未发布到站点";
      else if (statusFilter === "other") matchStatus = !["在售", "已下架", "已下架/已终止", "未发布到站点"].includes(statusText || "");
      else if (statusFilter === "saleOut") {
        const raw = (product.salesRaw || {}) as any;
        matchStatus = Boolean(raw.isSaleOut || raw.isCompletelySoldOut || (product.warehouseStock || 0) === 0);
      } else if (statusFilter === "soonSaleOut") {
        const days = Number(product.availableSaleDays);
        matchStatus = Number.isFinite(days) && days > 0 && days < 7;
      } else if (statusFilter === "shortage") {
        matchStatus = (product.lackQuantity || 0) > 0;
      } else if (statusFilter === "advice") {
        const raw = (product.salesRaw || {}) as any;
        matchStatus = Boolean(raw.isAdviceStock);
      }
      return matchKeyword && matchStatus;
    });
  }, [products, searchText, statusFilter]);

  // 优先用合并后的真实 products 数（含 sales-only 条目），countSummary 仅作 fallback
  const totalProducts = Math.max(products.length, countSummary.totalCount || 0);
  const total7dSales = products.reduce((sum, product) => sum + (product.last7DaysSales || 0), 0);
  const totalSales = products.reduce((sum, product) => sum + (product.totalSales || 0), 0);
  const onSaleCount = salesSummary?.addedToSiteSkcNum || products.filter((product) => product.hasSalesSnapshot).length;
  const latestSyncedAt = getLatestSyncedAt(products, diagnostics);
  const salesAttachedCount = products.filter((product) => product.hasSalesSnapshot).length;

  const dataIssues = [
    getCollectionDataIssue(diagnostics, "products", "商品列表", sourceState.products),
    getCollectionDataIssue(diagnostics, "sales", "销售数据", sourceState.sales),
    getCollectionDataIssue(diagnostics, "orders", "备货单数据", sourceState.orders),
  ].filter((issue): issue is string => Boolean(issue));

  const numColor = (val: number, base = "#52c41a") => ({ color: val > 0 ? base : "#999", fontWeight: val > 0 ? 500 : 400 });

  const columns: ColumnsType<ProductItem> = [
    {
      title: "商品图片",
      key: "imageUrl",
      width: 60,
      render: (_: any, record: ProductItem) => {
        const url = normalizeImageUrl(record.imageUrl);
        return url ? (
          <div onClick={(e) => e.stopPropagation()} style={{ display: "inline-block" }}>
            <Image src={url} width={45} height={45} style={{ objectFit: "cover", borderRadius: 4 }} preview={{ mask: false }} fallback={EMPTY_IMAGE_FALLBACK} />
          </div>
        ) : (
          <div style={{ width: 45, height: 45, background: "#f0f0f0", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center" }}><PictureOutlined /></div>
        );
      },
    },
    {
      title: "商品信息",
      dataIndex: "title",
      key: "title",
      width: 320,
      ellipsis: true,
      fixed: "left",
      render: (text: string, record: ProductItem) => {
        const raw = record.salesRaw || {};
        const score = raw.productReviewScore ?? raw.goodsScore ?? raw.score ?? raw.avgScore;
        const comment = record.commentNum ?? raw.commentNum;
        const productDays = raw.productDays ?? raw.onSalesDurationOffline ?? raw.addSiteDays ?? raw.addedToSiteDays ?? raw.onSiteDays ?? raw.onShelfDays ?? raw.listedDays ?? raw.siteOnlineDays ?? raw.launchDays ?? raw.daysSinceAdd;
        const seasonTag = raw.festivalSeasonTag || raw.seasonTag || raw.festivalTag;
        const stockOut = (record.stockStatus || "").includes("断货") || raw.stockStatus === "SOLD_OUT";
        return (
          <div style={{ fontSize: 11, lineHeight: 1.55 }}>
            <Tooltip title={text || "-"} placement="topLeft">
              <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {text || "-"}
              </div>
            </Tooltip>
            {getPrimaryCategory(record) && <div style={{ color: "#999" }}>类目：{getPrimaryCategory(record)}</div>}
            {(score != null || comment != null) && (
              <div style={{ color: "#faad14" }}>
                {score != null && <span>★ {score}分</span>}
                {score != null && comment != null && <span style={{ color: "#999" }}> | </span>}
                {comment != null && <span style={{ color: "#999" }}>评论数:{comment}</span>}
              </div>
            )}
            {record.skcId && <div style={{ color: "#999" }}>SKC：<span style={{ fontFamily: "monospace" }}>{record.skcId}</span></div>}
            {productDays != null && productDays !== "" && <div style={{ color: "#999" }}>加入站点时长：{productDays}天</div>}
            {record.spuId && <div style={{ color: "#999" }}>SPU：<span style={{ fontFamily: "monospace" }}>{record.spuId}</span></div>}
            {(record.operatorContact || record.operatorNick) && <div style={{ color: "#999" }}>买手：<span style={{ color: "#1890ff" }}>{record.operatorContact || ""}{record.operatorNick ? `（${record.operatorNick}）` : ""}</span></div>}
            {seasonTag && <div style={{ color: "#999" }}>节日/季节标签：{seasonTag}</div>}
            <div style={{ marginTop: 2 }}>
              {stockOut && <Tag color="red" style={{ fontSize: 10, marginRight: 4 }}>已断货</Tag>}
              {(record.hotTag === "true" || raw.hotTag === true) && <Tag color="volcano" style={{ fontSize: 10, marginRight: 4 }}>🔥 热销款</Tag>}
              {record.hotTag && record.hotTag !== "true" && record.hotTag !== "false" && <Tag color="volcano" style={{ fontSize: 10, marginRight: 4 }}>{record.hotTag}</Tag>}
              {raw.isAdProduct && <Tag color="blue" style={{ fontSize: 10, marginRight: 4 }}>广告</Tag>}
              {Array.isArray(raw.purchaseLabelList) && raw.purchaseLabelList.map((lbl: any, i: number) => (
                <Tag key={`p${i}`} color="gold" style={{ fontSize: 10, marginRight: 4 }}>{typeof lbl === "object" ? (lbl.name || lbl.label || JSON.stringify(lbl)) : String(lbl)}</Tag>
              ))}
              {Array.isArray(raw.adTypeList) && raw.adTypeList.filter((v: any) => v && v !== 0 && v !== "0").map((t: any, i: number) => (
                <Tag key={`ad${i}`} color="geekblue" style={{ fontSize: 10, marginRight: 4 }}>{typeof t === "object" ? (t.name || t.label || JSON.stringify(t)) : String(t)}</Tag>
              ))}
            </div>
          </div>
        );
      },
    },
    {
      title: "SKC ID",
      dataIndex: "skcId",
      key: "skcId",
      width: 120,
      render: (text: string) => <span style={{ fontSize: 12, fontFamily: "monospace" }}>{text || "-"}</span>,
    },
    {
      title: "云舵卡",
      key: "yunduCard",
      width: 130,
      render: (_: any, record: any) => {
        const y = record.yundu;
        const gp = record.gp;
        if (!y && !gp) return <span style={{ color: "#bbb" }}>-</span>;
        const tags: string[] = y?.tagList || [];
        const statusTags: string[] = y?.statusTags || [];
        const sites: any[] = y?.addedSiteList || [];
        const offSites: any[] = y?.onceAddSiteList || [];
        const trend = (gp?.trend || []).map((t: any) => ({ day: String(t.day || "").slice(5), v: t.quantity }));
        const changeRate = gp?.changeRate || 0;
        const up = changeRate >= 0;
        const siteName = (s: any) => s?.siteName || s?.regionName || s?.name || s?.code || (typeof s === "string" ? s : "?");

        const content = (
          <div style={{ width: 320, fontSize: 12 }}>
            {y?.buyerName && (
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "#888" }}>买手：</span>
                <Tag color="orange">{y.buyerName}</Tag>
              </div>
            )}
            {tags.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "#888" }}>标签：</span>
                {tags.map((t, i) => <Tag key={i} color="red" style={{ marginBottom: 2 }}>{t}</Tag>)}
              </div>
            )}
            {y?.category && (
              <div style={{ marginBottom: 6, display: "flex", alignItems: "flex-start", gap: 6 }}>
                <span style={{ color: "#888", flexShrink: 0 }}>类目：</span>
                <span style={{ flex: 1, lineHeight: 1.4 }}>{y.category}</span>
                <Button size="small" type="link" style={{ padding: 0, fontSize: 11 }} onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(y.category); message.success("已复制"); }}>复制</Button>
              </div>
            )}
            {sites.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "#888" }}>销售：</span>
                <span>{sites.slice(0, 5).map(siteName).join("，")}{sites.length > 5 ? `… 共 ${sites.length} 站` : ""}</span>
              </div>
            )}
            {offSites.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "#888" }}>下架：</span>
                <span>{offSites.slice(0, 5).map(siteName).join("，")}{offSites.length > 5 ? `…` : ""}</span>
              </div>
            )}
            {statusTags.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                {statusTags.map((t, i) => <Tag key={i} color="volcano" style={{ marginBottom: 2 }}>{t}</Tag>)}
              </div>
            )}
            {(y?.punishList?.length || 0) > 0 && (
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: "#888" }}>处罚：</span>
                {y.punishList.slice(0, 3).map((p: any, i: number) => (
                  <Tag key={i} color="red" style={{ marginBottom: 2, whiteSpace: "normal" }}>{p.reason || p.type || "处罚"}</Tag>
                ))}
              </div>
            )}
            {gp && (
              <>
                <Divider style={{ margin: "8px 0" }} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: "#888" }}>近期销量</span>
                  <Typography.Text strong style={{ fontSize: 14 }}>{gp.sales}</Typography.Text>
                  <Typography.Text style={{ color: up ? "#52c41a" : "#f5222d", fontSize: 12 }}>
                    {up ? "↑" : "↓"} {Math.abs(changeRate).toFixed(2)}%
                  </Typography.Text>
                </div>
                {trend.length > 0 && (
                  <ResponsiveContainer width="100%" height={40}>
                    <AreaChart data={trend}>
                      <Area type="monotone" dataKey="v" stroke="#1677ff" fill="#1677ff33" strokeWidth={1.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
                <Button
                  block
                  size="small"
                  type="primary"
                  style={{ marginTop: 6 }}
                  disabled={!gp.productId}
                  onClick={(e) => { e.stopPropagation(); openGpDetail(record); }}
                >
                  查看详细站点销售数据
                </Button>
              </>
            )}
          </div>
        );

        return (
          <Popover content={content} placement="left" trigger="hover" overlayStyle={{ maxWidth: 360 }}>
            <div style={{ cursor: "pointer", fontSize: 11, lineHeight: 1.5 }} onClick={(e) => e.stopPropagation()}>
              {tags.slice(0, 2).map((t, i) => <Tag key={i} color="red" style={{ margin: 0, marginRight: 2, marginBottom: 2 }}>{t}</Tag>)}
              {sites.length > 0 && <Tag color="blue" style={{ margin: 0, marginBottom: 2 }}>{sites.length} 站</Tag>}
              {gp && (
                <div>
                  <Typography.Text strong style={{ fontSize: 13 }}>{gp.sales}</Typography.Text>
                  <Typography.Text style={{ color: up ? "#52c41a" : "#f5222d", fontSize: 11, marginLeft: 4 }}>
                    {up ? "↑" : "↓"}{Math.abs(changeRate).toFixed(1)}%
                  </Typography.Text>
                </div>
              )}
              {statusTags.length > 0 && <Tag color="volcano" style={{ margin: 0, fontSize: 10 }}>{statusTags[0]}</Tag>}
            </div>
          </Popover>
        );
      },
    },
    {
      title: "SKU/规格",
      key: "skuInfo",
      width: 150,
      render: (_: any, record: ProductItem) => (
        <div style={{ fontSize: 12 }}>
          <div style={{ fontFamily: "monospace" }}>{record.skuId || "-"}</div>
          {record.skuName && <div style={{ color: "#666" }}>{record.skuName}</div>}
          {record.extCode && <div style={{ color: "#999" }}>货号：{record.extCode}</div>}
        </div>
      ),
    },
    {
      title: "申报价格",
      dataIndex: "price",
      key: "price",
      width: 90,
      render: (text: any) => <span style={{ color: "#fa541c", fontWeight: 500 }}>{formatTextValue(text)}</span>,
    },
    {
      title: "今日销量",
      dataIndex: "todaySales",
      key: "todaySales",
      width: 85,
      sorter: (a, b) => (a.todaySales || 0) - (b.todaySales || 0),
      render: (val: number) => <span style={numColor(val || 0)}>{val || 0}</span>,
    },
    {
      title: "7天销量",
      dataIndex: "last7DaysSales",
      key: "last7DaysSales",
      width: 85,
      sorter: (a, b) => (a.last7DaysSales || 0) - (b.last7DaysSales || 0),
      render: (val: number) => <span style={numColor(val || 0)}>{val || 0}</span>,
    },
    {
      title: "30天销量",
      dataIndex: "last30DaysSales",
      key: "last30DaysSales",
      width: 90,
      sorter: (a, b) => (a.last30DaysSales || 0) - (b.last30DaysSales || 0),
      defaultSortOrder: "descend",
      render: (val: number) => <span style={numColor(val || 0)}>{val || 0}</span>,
    },
    {
      title: "总销量",
      dataIndex: "totalSales",
      key: "totalSales",
      width: 85,
      sorter: (a, b) => (a.totalSales || 0) - (b.totalSales || 0),
      render: (val: number) => <span style={numColor(val || 0, "#1890ff")}>{val || 0}</span>,
    },
    {
      title: "仓内可用库存",
      dataIndex: "warehouseStock",
      key: "warehouseStock",
      width: 120,
      sorter: (a, b) => (a.warehouseStock || 0) - (b.warehouseStock || 0),
      render: (val: number) => <span style={{ color: (val || 0) > 0 ? "#1890ff" : "#ff4d4f", fontWeight: 500 }}>{val || 0}</span>,
    },
    {
      title: "暂不可用库存",
      dataIndex: "unavailableStock",
      key: "unavailableStock",
      width: 120,
      sorter: (a, b) => (a.unavailableStock || 0) - (b.unavailableStock || 0),
      render: (val: number) => <span style={{ color: (val || 0) > 0 ? "#fa8c16" : "#999", fontWeight: (val || 0) > 0 ? 500 : 400 }}>{val || 0}</span>,
    },
    {
      title: "预占用库存",
      dataIndex: "occupyStock",
      key: "occupyStock",
      width: 115,
      sorter: (a, b) => (a.occupyStock || 0) - (b.occupyStock || 0),
      render: (val: number) => <span style={{ color: (val || 0) > 0 ? "#13c2c2" : "#999", fontWeight: (val || 0) > 0 ? 500 : 400 }}>{val || 0}</span>,
    },
    {
      title: "缺货",
      dataIndex: "lackQuantity",
      key: "lackQuantity",
      width: 75,
      render: (val: number) => <span style={{ color: (val || 0) > 0 ? "#ff4d4f" : "#999", fontWeight: (val || 0) > 0 ? 500 : 400 }}>{val || 0}</span>,
    },
    {
      title: "7日加购",
      dataIndex: "sevenDaysAddCartNum",
      key: "sevenDaysAddCartNum",
      width: 85,
      sorter: (a, b) => (a.sevenDaysAddCartNum || 0) - (b.sevenDaysAddCartNum || 0),
      render: (val: number) => (
        <span style={{ color: (val || 0) > 0 ? "#722ed1" : "#999", fontWeight: (val || 0) > 0 ? 500 : 400 }}>
          {val || 0}
        </span>
      ),
    },
    {
      title: "建议备货",
      key: "advice",
      width: 90,
      render: (_: any, r: ProductItem) => {
        const v = r.salesRaw?.skuQuantityTotalInfo?.adviceQuantity;
        return <span style={{ color: v > 0 ? "#fa541c" : "#999", fontWeight: v > 0 ? 500 : 400 }}>{v || "-"}</span>;
      },
    },
    {
      title: "高价限流",
      key: "highPriceFlowLimit",
      width: 150,
      filters: [
        { text: "限流中", value: "on" },
        { text: "正常", value: "off" },
      ],
      onFilter: (value, record) => (value === "on" ? !!record.highPriceFlowLimit : !record.highPriceFlowLimit),
      render: (_: any, r: ProductItem) => {
        if (!r.highPriceFlowLimit) return <span style={{ color: "#999" }}>-</span>;
        const info = r.highPriceFlowInfo || {};
        const fmt = (v: any) => {
          if (v == null || v === "") return null;
          const n = Number(v);
          if (!Number.isFinite(n)) return String(v);
          // Temu 价格通常以分为单位
          return (n > 1000 ? n / 100 : n).toFixed(2);
        };
        const current = fmt(info.currentPrice ?? info.supplierPrice ?? info.price ?? info.salePrice);
        const suggest = fmt(info.suggestPrice ?? info.targetPrice ?? info.expectPrice ?? info.reducePrice ?? info.lowPrice);
        const tip = (
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            {Object.entries(info).slice(0, 14).map(([k, v]) => (
              <div key={k}>{k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}</div>
            ))}
          </div>
        );
        return (
          <Tooltip title={tip}>
            <Space direction="vertical" size={0}>
              <Tag color="red" style={{ marginRight: 0 }}>限流</Tag>
              {(current || suggest) && (
                <span style={{ fontSize: 11, color: "#666" }}>
                  {current && <span style={{ color: "#ff4d4f" }}>¥{current}</span>}
                  {current && suggest && " → "}
                  {suggest && <span style={{ color: "#52c41a" }}>¥{suggest}</span>}
                </span>
              )}
            </Space>
          </Tooltip>
        );
      },
    },
    {
      title: "供货状态",
      dataIndex: "supplyStatus",
      key: "supplyStatus",
      width: 110,
      render: (status: string) => {
        if (!status) return "-";
        const colorMap: Record<string, string> = {
          "正常供货": "green",
          "暂时无法供货": "orange",
          "永久停止供货": "red",
        };
        return <Tag color={colorMap[status] || "default"}>{status}</Tag>;
      },
    },
    {
      title: "状态",
      key: "status",
      width: 100,
      render: (_: string, record: ProductItem) => {
        const status = record.status || normalizeStatusText(record.removeStatus);
        const color: any = status === "在售" ? "success" : status.includes("下架") ? "error" : "default";
        return renderStatusTag(status || "待同步", color);
      },
    },
  ];

  // ============ Drawer 渲染 ============
  const renderDrawer = () => {
    if (!selectedProduct) return null;
    const record = selectedProduct;
    const raw: any = record.salesRaw || {};
    const sku: any = record.salesRawSku || {};
    const qty: any = raw.skuQuantityTotalInfo || {};
    const inv: any = qty.inventoryNumInfo || raw.inventoryNumInfo || {};
    const trend = record.trendDaily || [];

    const renderMetric = (label: string, value: any, accent?: boolean) => (
      <div style={{ padding: "8px 12px", background: "var(--color-bg-1, #fafafa)", borderRadius: 8 }}>
        <div style={{ fontSize: 11, color: "var(--color-text-sec)" }}>{label}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: accent ? "var(--color-brand)" : "var(--color-text)" }}>
          {formatTextValue(value)}
        </div>
      </div>
    );

    const overviewTab = (
      <div style={{ display: "grid", gap: 16 }}>
        {trend.length > 0 ? (
          <div className="app-surface" style={{ padding: 12, borderRadius: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "var(--color-brand)" }}>
              销售趋势 · 共 {trend.length} 天
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e55b00" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#e55b00" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <ReTooltip />
                <Area type="monotone" dataKey="salesNumber" stroke="#e55b00" strokeWidth={2} fill="url(#trendFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Alert type="info" showIcon message="暂无销售趋势数据" description="如需查看销售趋势曲线，请重新采集销售数据。" />
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
          {renderMetric("今日销量", qty.todaySaleVolume ?? record.todaySales, true)}
          {renderMetric("7日销量", qty.lastSevenDaysSaleVolume ?? record.last7DaysSales, true)}
          {renderMetric("30日销量", qty.lastThirtyDaysSaleVolume ?? record.last30DaysSales, true)}
          {renderMetric("总销量", qty.totalSaleVolume ?? record.totalSales)}
          {renderMetric("仓库库存", inv.warehouseInventoryNum ?? record.warehouseStock, true)}
          {renderMetric("缺货", qty.lackQuantity ?? record.lackQuantity)}
          {renderMetric("建议备货", qty.adviceQuantity)}
          {renderMetric("可售天数", qty.availableSaleDays ?? record.availableSaleDays)}
          {renderMetric("申报价", record.price)}
          {renderMetric("买手", record.buyerName)}
          {renderMetric("ASF评分", record.asfScore)}
          {renderMetric("评论数", record.commentNum)}
        </div>
      </div>
    );

    // ----- SKU 明细 Tab：核心列 + 更多 -----
    const skuList = Array.isArray(raw.skuQuantityDetailList) ? raw.skuQuantityDetailList : [];
    const skuTab = skuList.length > 0 ? (
      <Table
        size="small"
        rowKey={(s: any, i) => `${s.productSkuId || i}`}
        dataSource={skuList}
        pagination={false}
        scroll={{ x: 900 }}
        columns={[
          { title: "SKU ID", dataIndex: "productSkuId", width: 120, render: (v) => <span style={{ fontFamily: "Consolas, monospace", fontSize: 11 }}>{formatTextValue(v)}</span> },
          { title: "规格", dataIndex: "className", width: 120 },
          { title: "货号", dataIndex: "skuExtCode", width: 120 },
          { title: "今日", width: 70, align: "right", render: (_: any, s: any) => s.todaySaleVolume ?? 0 },
          { title: "7日", width: 70, align: "right", render: (_: any, s: any) => s.lastSevenDaysSaleVolume ?? 0 },
          { title: "30日", width: 70, align: "right", render: (_: any, s: any) => s.lastThirtyDaysSaleVolume ?? 0 },
          { title: "缺货", dataIndex: "lackQuantity", width: 70, align: "right" },
          { title: "建议", dataIndex: "adviceQuantity", width: 70, align: "right" },
          { title: "卖家库存", dataIndex: "sellerWhStock", width: 90, align: "right" },
          { title: "申报价", dataIndex: "supplierPrice", width: 90, align: "right" },
        ]}
      />
    ) : record.skuSummaries.length > 0 ? (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
        {record.skuSummaries.map((s) => (
          <div key={`${s.productSkuId}-${s.extCode}`} style={{ display: "flex", gap: 8, alignItems: "center", padding: 8, background: "var(--color-bg-1, #fafafa)", borderRadius: 8 }}>
            {s.thumbUrl ? <Image src={s.thumbUrl} width={36} height={36} preview={false} fallback={EMPTY_IMAGE_FALLBACK} /> : <Tag>无图</Tag>}
            <div style={{ display: "grid", gap: 2, fontSize: 11 }}>
              <div style={{ fontFamily: "Consolas, monospace" }}>{s.productSkuId || "-"}</div>
              <div style={{ color: "var(--color-text-sec)" }}>{s.specText || s.specName || "-"}</div>
              <div style={{ color: "var(--color-text-sec)" }}>{s.extCode || "-"}</div>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <Alert type="info" showIcon message="暂无 SKU 明细" />
    );

    // ----- 全部字段 Tab -----
    const groups: { title: string; fields: Array<{ label: string; value: any; accent?: boolean }> }[] = [
      {
        title: "基础信息",
        fields: [
          { label: "商品标题", value: record.title, accent: true },
          { label: "商品分类", value: record.category || record.categories },
          { label: "商品类型", value: record.productType },
          { label: "商品来源", value: formatSourceType(record.sourceType) },
          { label: "JIT模式", value: raw.productJitMode ?? raw.purchaseStockType },
          { label: "站点", value: record.siteLabel },
          { label: "SKC ID", value: record.skcId },
          { label: "SPU ID", value: record.spuId },
          { label: "Goods ID", value: record.goodsId },
          { label: "Product ID", value: raw.productId },
          { label: "SKC 货号", value: raw.skcExtCode || record.extCode },
          { label: "创建时间", value: raw.createdAtStr || raw.createdAt },
          { label: "上架时长", value: raw.onSalesDurationOffline },
          { label: "商品周期", value: raw.productCycleDays },
        ],
      },
      {
        title: "库存信息",
        fields: [
          { label: "仓库库存", value: inv.warehouseInventoryNum ?? record.warehouseStock, accent: true },
          { label: "缺货数量", value: qty.lackQuantity ?? record.lackQuantity, accent: true },
          { label: "建议备货量", value: qty.adviceQuantity },
          { label: "可售天数", value: qty.availableSaleDays },
          { label: "仓内可售天数", value: qty.warehouseAvailableSaleDays },
          { label: "预测可售天数", value: qty.predictSaleAvailableDays },
          { label: "待 QC 数", value: inv.waitQcNum },
          { label: "待上架", value: inv.waitOnShelfNum },
          { label: "待入库", value: inv.waitInStock },
          { label: "待收货", value: inv.waitReceiveNum },
          { label: "待发货", value: inv.waitDeliveryInventoryNum },
          { label: "待审核库存", value: inv.waitApproveInventoryNum },
          { label: "不可用库存", value: inv.unavailableWarehouseInventoryNum },
          { label: "预占库存", value: inv.expectedOccupiedInventoryNum },
          { label: "正常锁定", value: inv.normalLockNumber },
          { label: "库存区域", value: raw.inventoryRegion },
          { label: "仓库分组", value: Array.isArray(raw.warehouseGroupList) ? raw.warehouseGroupList.join("/") : raw.warehouseGroupList },
        ],
      },
      {
        title: "运营/买手",
        fields: [
          { label: "买手", value: record.buyerName, accent: true },
          { label: "买手 ID", value: record.buyerUid },
          { label: "供应商 ID", value: raw.supplierId },
          { label: "供应商名称", value: raw.supplierName },
          { label: "结算类型", value: raw.settlementType },
          { label: "ASF 评分", value: record.asfScore },
          { label: "评论数", value: record.commentNum },
          { label: "品质售后率", value: record.qualityAfterSalesRate },
          { label: "图片审核状态", value: record.pictureAuditStatus },
          { label: "微瑕疵", value: raw.minorFlaw },
          { label: "热卖标签", value: record.hotTag },
          { label: "广告商品", value: raw.isAdProduct ? "是" : "" },
          { label: "广告类型", value: Array.isArray(raw.adTypeList) ? raw.adTypeList.join("/") : raw.adTypeList },
          { label: "店铺履约率", value: raw.mallDeliverRate },
        ],
      },
      {
        title: "供货/备货",
        fields: [
          { label: "库存状态", value: raw.stockStatus },
          { label: "供货状态", value: raw.supplyStatus },
          { label: "供货状态备注", value: raw.supplyStatusRemark },
          { label: "正常供货预计时间", value: raw.expectNormalSupplyTime },
          { label: "缺货", value: raw.isLack ? "是" : "" },
          { label: "库存充足", value: raw.isEnoughStock ? "是" : "" },
          { label: "建议备货", value: raw.isAdviceStock ? "是" : "" },
          { label: "今日已申请备货", value: raw.isApplyStockToday ? "是" : "" },
          { label: "今日申请备货数", value: raw.todayApplyStockNum },
          { label: "建议关闭 JIT", value: raw.suggestCloseJit ? "是" : "" },
          { label: "JIT 关闭状态", value: raw.closeJitStatus },
          { label: "首采等待", value: qty.waitFirstPurchaseSkcNum },
          { label: "首采未发", value: qty.firstPurchaseNotShippedSkcNum },
        ],
      },
      {
        title: "状态/合规",
        fields: [
          { label: "商品状态", value: record.status || normalizeStatusText(record.removeStatus) },
          { label: "SKC 站点状态", value: normalizeStatusText(record.skcSiteStatus) },
          { label: "下架状态", value: record.removeStatus },
          { label: "限流状态", value: record.flowLimitStatus },
          { label: "黑名单", value: record.inBlackList },
          { label: "违规影响类型", value: raw.illegalImpactType },
          { label: "违规原因", value: raw.illegalReason },
          { label: "停售类型", value: raw.haltSalesType },
          { label: "停售开始时间", value: raw.haltSalesStartTime },
          { label: "停售结束时间", value: raw.haltSalesEndTime },
        ],
      },
    ];

    const allFieldsTab = (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {groups.map((group) => {
          const visibleFields = group.fields.filter((f) => hasMeaningfulSnapshotValue(f.value));
          if (visibleFields.length === 0) return null;
          return (
            <div key={group.title} className="app-surface" style={{ padding: 12, borderRadius: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "var(--color-brand)" }}>{group.title}</div>
              <div style={{ display: "grid", gap: 8 }}>
                {visibleFields.map((field) => (
                  <div key={field.label}>
                    {renderSnapshotField(field.label, field.value, field.accent)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );

    // ----- 标签 Tab -----
    const labelGroups: { title: string; items: any }[] = [
      { title: "SKC 标签", items: raw.skcLabels },
      { title: "节日/季节标签", items: raw.holidayLabelList },
      { title: "自定义标签", items: raw.customLabelList },
      { title: "采购标签", items: raw.purchaseLabelList },
      { title: "广告类型", items: raw.adTypeList },
      { title: "命中规则", items: raw.hitRuleDetailList },
      { title: "商品属性", items: raw.productProperties },
    ].filter((g) => Array.isArray(g.items) && g.items.length > 0);

    const labelTab = labelGroups.length > 0 ? (
      <div style={{ display: "grid", gap: 12 }}>
        {labelGroups.map((g) => (
          <div key={g.title} className="app-surface" style={{ padding: 12, borderRadius: 12 }}>
            <div style={{ fontSize: 12, color: "var(--color-text-sec)", marginBottom: 6 }}>{g.title}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {g.items.map((item: any, idx: number) => {
                const text = typeof item === "string" ? item
                  : item?.tagName || item?.labelName || item?.name || item?.text || JSON.stringify(item);
                return <Tag key={idx}>{String(text).slice(0, 40)}</Tag>;
              })}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <Alert type="info" showIcon message="暂无标签数据" />
    );

    return (
      <Drawer
        width={Math.min(1080, typeof window !== "undefined" ? window.innerWidth - 80 : 1080)}
        open={Boolean(selectedProduct)}
        onClose={() => setSelectedProduct(null)}
        title={(
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {record.imageUrl ? (
              <Image src={record.imageUrl} width={48} height={48} preview={{ mask: "查看大图" }} fallback={EMPTY_IMAGE_FALLBACK} />
            ) : null}
            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{record.title || "未命名商品"}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-sec)", fontFamily: "Consolas, monospace" }}>
                SKC {formatTextValue(record.skcId)} · 货号 {formatTextValue(record.extCode || record.sku)}
              </div>
            </div>
          </div>
        )}
        destroyOnClose
      >
        <Tabs
          activeKey={drawerTab}
          onChange={setDrawerTab}
          items={[
            { key: "overview", label: "概览", children: overviewTab },
            { key: "all", label: "全部字段", children: allFieldsTab },
          ]}
        />
      </Drawer>
    );
  };

  const emptyState = !loading && products.length === 0;
  const filteredEmptyState = !loading && products.length > 0 && filteredProducts.length === 0;

  // 顶部 4 个核心指标 + 可点击筛选标签
  const saleOutCount = salesSummary?.saleOutSkcNum || 0;
  const shortageCount = salesSummary?.shortageSkcNum || 0;
  const adviceCount = salesSummary?.adviceStockSkcNum || 0;

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="商品数据"
        title="商品管理"
        subtitle="紧凑表格 + 详情抽屉，集中查看商品基础资料、销量趋势和 SKU 字段。"
        meta={[
          formatSyncedAt(latestSyncedAt),
          hasAccount === false ? "本地历史数据" : null,
        ].filter(Boolean)}
        actions={(
          <Button type="primary" icon={<SyncOutlined />} loading={loading} onClick={loadProducts}>
            刷新数据
          </Button>
        )}
      />
      {hasAccount === false && products.length > 0 ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message="当前没有绑定账号，正在展示本地历史数据"
        />
      ) : null}

      {dataIssues.length > 0 ? (
        <Alert
          className="friendly-alert"
          type="warning"
          showIcon
          message="部分商品数据还没有准备好"
          description={dataIssues.slice(0, 3).join("；")}
          action={(
            <Button type="link" onClick={() => navigate("/collect")}>前往采集</Button>
          )}
        />
      ) : null}

      {emptyState ? (
        <div className="app-panel">
          <EmptyGuide
            icon={<AppstoreOutlined />}
            title={hasAccount === false ? "先绑定店铺账号" : "先执行一次数据采集"}
            description={
              hasAccount === false
                ? "绑定 Temu 店铺账号后，商品列表会自动汇总商品、销量和库存数据。"
                : "执行商品列表、销售数据和备货单采集后，这里会自动出现统计指标和商品表格。"
            }
            action={(
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                {hasAccount === false ? (
                  <Button type="primary" onClick={() => navigate("/accounts")}>前往绑定店铺</Button>
                ) : (
                  <Button type="primary" onClick={() => navigate("/collect")}>前往数据采集</Button>
                )}
                <Button onClick={loadProducts}>重新检查</Button>
              </div>
            )}
          />
        </div>
      ) : (
        <>
          {/* 汇总指标卡片 - SalesManagement 风格 */}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col span={4}>
              <Card size="small">
                <Statistic title="商品总数" value={totalProducts} prefix={<ShoppingCartOutlined />} valueStyle={{ color: "#1890ff" }} />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="售罄" value={saleOutCount} prefix={<StopOutlined />} valueStyle={{ color: "#ff4d4f" }} />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="即将售罄" value={salesSummary?.soonSaleOutSkcNum || 0} prefix={<WarningOutlined />} valueStyle={{ color: "#fa8c16" }} />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="缺货" value={shortageCount} valueStyle={{ color: "#fa541c" }} />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="建议备货" value={adviceCount} valueStyle={{ color: "#fa541c" }} />
              </Card>
            </Col>
            <Col span={4}>
              <Card size="small">
                <Statistic title="广告商品" value={salesSummary?.adSkcNum || 0} prefix={<FireOutlined />} valueStyle={{ color: "#722ed1" }} />
              </Card>
            </Col>
          </Row>

          {/* 工具栏 - SalesManagement 风格 */}
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space wrap>
              <Input
                placeholder="搜索商品名称/SKC/SKU/货号/买手"
                prefix={<SearchOutlined />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                style={{ width: 320 }}
                allowClear
              />
              <Radio.Group
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                size="middle"
                options={[
                  { label: `全部 ${products.length}`, value: "all" },
                  { label: `在售 ${onSaleCount}`, value: "在售" },
                  { label: "已下架", value: "已下架" },
                  { label: "未发布", value: "未发布" },
                  { label: "售罄", value: "saleOut" },
                  { label: "即将售罄", value: "soonSaleOut" },
                  { label: "缺货", value: "shortage" },
                  { label: "建议备货", value: "advice" },
                ]}
              />
              <Button type="primary" icon={<SyncOutlined spin={loading} />} loading={loading} onClick={loadProducts}>
                刷新数据
              </Button>
              <span style={{ color: "#999", fontSize: 13 }}>
                共 {products.length} 条 · 已接销售 {salesAttachedCount}
              </span>
              {filteredProducts.length !== products.length && (
                <span style={{ color: "#999", fontSize: 13 }}>
                  显示 {filteredProducts.length} / {products.length}
                </span>
              )}
            </Space>
          </Card>

          {/* 紧凑表格 */}
          <div className="app-panel">
            {filteredEmptyState ? (
              <EmptyGuide
                icon={<SearchOutlined />}
                title="没有符合当前筛选条件的商品"
                description="可以清空关键词或切回全部状态，快速回到完整商品列表。"
                action={(
                  <Button type="primary" onClick={() => { setSearchText(""); setStatusFilter("all"); }}>
                    清空筛选
                  </Button>
                )}
              />
            ) : (
              <Table
                rowKey={(record, index) => record.skcId || record.goodsId || record.spuId || `${record.title}-${index}`}
                dataSource={filteredProducts}
                columns={columns}
                size="small"
                loading={loading}
                expandable={{
                  expandedRowRender: (record) => {
                    const raw: any = record.salesRaw || {};
                    const skuList: any[] = Array.isArray(raw.skuQuantityDetailList) ? raw.skuQuantityDetailList : [];
                    if (skuList.length > 0) {
                      return (
                        <Table
                          size="small"
                          rowKey={(s: any, i) => `${s.productSkuId || i}`}
                          dataSource={skuList}
                          pagination={false}
                          scroll={{ x: 1100 }}
                          columns={[
                            { title: "SKU ID", dataIndex: "productSkuId", width: 120, render: (v) => <span style={{ fontFamily: "monospace", fontSize: 11 }}>{formatTextValue(v)}</span> },
                            { title: "规格", dataIndex: "className", width: 120 },
                            { title: "货号", dataIndex: "skuExtCode", width: 120 },
                            { title: "今日", width: 70, align: "right", render: (_: any, s: any) => s.todaySaleVolume ?? 0 },
                            { title: "7天", width: 70, align: "right", render: (_: any, s: any) => s.lastSevenDaysSaleVolume ?? 0 },
                            { title: "30天", width: 70, align: "right", render: (_: any, s: any) => s.lastThirtyDaysSaleVolume ?? 0 },
                            { title: "缺货", dataIndex: "lackQuantity", width: 70, align: "right" },
                            { title: "建议", dataIndex: "adviceQuantity", width: 70, align: "right" },
                            { title: "卖家库存", dataIndex: "sellerWhStock", width: 90, align: "right" },
                            { title: "申报价", dataIndex: "supplierPrice", width: 90, align: "right" },
                            { title: "采购配置", dataIndex: "purchaseConfig", width: 100 },
                            { title: "安全库存天", dataIndex: "safeInventoryDays", width: 100, align: "right" },
                          ]}
                        />
                      );
                    }
                    if (record.skuSummaries.length > 0) {
                      return (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, padding: 8 }}>
                          {record.skuSummaries.map((s) => (
                            <div key={`${s.productSkuId}-${s.extCode}`} style={{ display: "flex", gap: 8, alignItems: "center", padding: 8, background: "#fafafa", borderRadius: 8 }}>
                              {s.thumbUrl ? <Image src={s.thumbUrl} width={36} height={36} preview={false} fallback={EMPTY_IMAGE_FALLBACK} /> : <Tag>无图</Tag>}
                              <div style={{ display: "grid", gap: 2, fontSize: 11 }}>
                                <div style={{ fontFamily: "monospace" }}>{s.productSkuId || "-"}</div>
                                <div style={{ color: "#999" }}>{s.specText || s.specName || "-"}</div>
                                <div style={{ color: "#999" }}>{s.extCode || "-"}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    }
                    return <div style={{ padding: 12, color: "#999" }}>暂无 SKU 明细</div>;
                  },
                  rowExpandable: (record) =>
                    (Array.isArray(record.salesRaw?.skuQuantityDetailList) && record.salesRaw.skuQuantityDetailList.length > 0)
                    || record.skuSummaries.length > 0,
                }}
                onRow={(record) => ({
                  onClick: (e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest(".ant-table-row-expand-icon")) return;
                    setSelectedProduct(record);
                    setDrawerTab("overview");
                  },
                  style: { cursor: "pointer" },
                })}
                pagination={{
                  pageSize: 30,
                  showSizeChanger: true,
                  pageSizeOptions: [20, 30, 50, 100],
                  showTotal: (total) => `共 ${total} 个商品`,
                }}
                scroll={{ x: 2000 }}
                locale={{ emptyText: "暂无商品数据" }}
              />
            )}
          </div>

          {renderDrawer()}

          <Modal
            title={`动销详情 (ID: ${gpDetailRow?.productId || "-"})`}
            open={gpDetailOpen}
            onCancel={() => setGpDetailOpen(false)}
            footer={null}
            width={1100}
            destroyOnClose
          >
            <div style={{ marginBottom: 12, color: "#888", fontSize: 12 }}>
              {gpDetailRow?.productName} {gpDetailRow?.skcId ? `· SKC ${gpDetailRow.skcId}` : ""}
            </div>
            <Space style={{ marginBottom: 12 }}>
              <Typography.Text strong>时间段：</Typography.Text>
              <Segmented
                value={gpDetailRange}
                options={[{ label: "30天", value: "30d" }, { label: "近7天", value: "7d" }, { label: "昨天", value: "1d" }]}
                onChange={(val) => {
                  const r = val as "1d" | "7d" | "30d";
                  if (gpDetailRow) openGpDetail({ gp: { productId: gpDetailRow.productId, productName: gpDetailRow.productName }, title: gpDetailRow.productName, skcId: gpDetailRow.skcId }, r);
                }}
                disabled={gpDetailLoading}
              />
            </Space>
            {gpDetailLoading ? (
              <div style={{ height: 240, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Spin tip="按地区查询中..." />
              </div>
            ) : gpDetailData && gpDetailData.rows?.length > 0 ? (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Statistic title="总销量" value={gpDetailData.total} suffix="件" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
                  {(["欧洲", "亚洲", "美洲", "非洲", "大洋洲"] as const).map((c) => {
                    const rows = gpDetailData.grouped?.[c] || [];
                    return (
                      <Card key={c} size="small" title={c} bodyStyle={{ padding: 8 }}>
                        {rows.length === 0 ? (
                          <div style={{ textAlign: "center", color: "#bbb", padding: "12px 0" }}>-</div>
                        ) : (
                          <table style={{ width: "100%", fontSize: 12 }}>
                            <thead>
                              <tr style={{ color: "#888" }}>
                                <th style={{ textAlign: "left", padding: "4px 6px" }}>站点</th>
                                <th style={{ textAlign: "right", padding: "4px 6px" }}>销量</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r: any) => (
                                <tr key={r.regionId}>
                                  <td style={{ padding: "4px 6px" }}>{r.regionName}</td>
                                  <td style={{ padding: "4px 6px", textAlign: "right", color: "#1677ff", fontWeight: 600 }}>{r.sales}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </>
            ) : (
              <Empty description={gpDetailData?.error || "暂无数据"} />
            )}
          </Modal>
        </>
      )}
    </div>
  );
}
