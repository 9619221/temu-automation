import { useEffect, useState } from "react";
import { Alert, Button, Card, Image, Input, Select, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  AppstoreOutlined,
  EyeOutlined,
  RiseOutlined,
  SearchOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import EmptyGuide from "../components/EmptyGuide";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { parseOrdersData, parseProductsData, parseSalesData } from "../utils/parseRawApis";
import {
  COLLECTION_DIAGNOSTICS_KEY,
  getCollectionDataIssue,
  normalizeCollectionDiagnostics,
  type CollectionDiagnostics,
} from "../utils/collectionDiagnostics";
import { getStoreValue } from "../utils/storeCompat";
import { ACTIVE_ACCOUNT_CHANGED_EVENT } from "../utils/multiStore";

const store = window.electronAPI?.store;

interface ProductItem {
  title: string;
  category: string;
  categories: string;
  spuId: string;
  skcId: string;
  goodsId: string;
  sku: string;
  imageUrl: string;
  status: string;
  totalSales: number;
  last7DaysSales: number;
  syncedAt: string;
  stockStatus: string;
  supplyStatus: string;
  pendingOrderCount: number;
}

interface ProductSourceState {
  products: boolean;
  sales: boolean;
  orders: boolean;
}

type StatusFilter = "all" | "在售" | "已下架" | "other";

const EMPTY_SOURCES: ProductSourceState = {
  products: false,
  sales: false,
  orders: false,
};

const EMPTY_IMAGE_FALLBACK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

function normalizeLookupValue(value: string) {
  return (value || "").replace(/\s+/g, "").trim().toLowerCase().slice(0, 30);
}

function buildLookupKeys(source: Partial<ProductItem>) {
  const titleKey = normalizeLookupValue(source.title || "");
  return [
    source.skcId ? `skc:${source.skcId}` : "",
    source.goodsId ? `goods:${source.goodsId}` : "",
    source.spuId ? `spu:${source.spuId}` : "",
    titleKey ? `title:${titleKey}` : "",
  ].filter(Boolean);
}

function getPrimaryCategory(product: ProductItem) {
  return product.category || product.categories || "";
}

function formatSyncedAt(value?: string | null) {
  return value ? `最近同步：${value}` : "等待首次采集";
}

function getLatestSyncedAt(products: ProductItem[], diagnostics: CollectionDiagnostics | null) {
  if (diagnostics?.syncedAt) return diagnostics.syncedAt;
  for (const product of products) {
    if (product.syncedAt) return product.syncedAt;
  }
  return "";
}

export default function ProductList() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);
  const [diagnostics, setDiagnostics] = useState<CollectionDiagnostics | null>(null);
  const [sourceState, setSourceState] = useState<ProductSourceState>(EMPTY_SOURCES);
  const navigate = useNavigate();

  useEffect(() => {
    void loadProducts();
    const handleActiveAccountChanged = () => {
      void loadProducts();
    };
    window.addEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    return () => {
      window.removeEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
    };
  }, []);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const [accounts, rawProducts, rawSales, rawOrders, diagnosticsRaw] = await Promise.all([
        store?.get("temu_accounts"),
        getStoreValue(store, "temu_products"),
        getStoreValue(store, "temu_sales"),
        getStoreValue(store, "temu_orders"),
        getStoreValue(store, COLLECTION_DIAGNOSTICS_KEY),
      ]);

      setHasAccount(Array.isArray(accounts) && accounts.length > 0);
      setDiagnostics(normalizeCollectionDiagnostics(diagnosticsRaw));

      const parsedProducts = parseProductsData(rawProducts);
      const parsedSales = parseSalesData(rawSales);
      const salesItems = Array.isArray(parsedSales?.items) ? parsedSales.items : [];
      const parsedOrders = parseOrdersData(rawOrders);

      setSourceState({
        products: parsedProducts.length > 0,
        sales: salesItems.length > 0,
        orders: parsedOrders.length > 0,
      });

      const lookup = new Map<string, ProductItem>();

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

        const product: ProductItem = {
          title: source.title || "",
          category: source.category || "",
          categories: source.categories || "",
          spuId: source.spuId || "",
          skcId: source.skcId || "",
          goodsId: source.goodsId || "",
          sku: source.sku || "",
          imageUrl: source.imageUrl || "",
          status: source.status || "",
          totalSales: source.totalSales || 0,
          last7DaysSales: source.last7DaysSales || 0,
          syncedAt: source.syncedAt || "",
          stockStatus: source.stockStatus || "",
          supplyStatus: source.supplyStatus || "",
          pendingOrderCount: source.pendingOrderCount || 0,
        };
        register(product);
        return product;
      };

      parsedProducts.forEach((item: any) => {
        const product = ensureProduct({
          title: item.title || "",
          category: item.category || "",
          categories: item.categories || "",
          spuId: String(item.spuId || ""),
          skcId: String(item.skcId || ""),
          goodsId: String(item.goodsId || ""),
          sku: item.sku || "",
          imageUrl: item.imageUrl || "",
          status: item.status || "",
          totalSales: item.totalSales || 0,
          last7DaysSales: item.last7DaysSales || 0,
          syncedAt: item.syncedAt || "",
        });
        product.title = item.title || product.title;
        product.category = item.category || product.category;
        product.categories = item.categories || product.categories;
        product.spuId = String(item.spuId || "") || product.spuId;
        product.skcId = String(item.skcId || "") || product.skcId;
        product.goodsId = String(item.goodsId || "") || product.goodsId;
        product.sku = item.sku || product.sku;
        product.imageUrl = item.imageUrl || product.imageUrl;
        product.status = item.status || product.status;
        product.totalSales = item.totalSales || product.totalSales;
        product.last7DaysSales = item.last7DaysSales || product.last7DaysSales;
        product.syncedAt = item.syncedAt || product.syncedAt;
        register(product);
      });

      salesItems.forEach((item: any) => {
        const product = ensureProduct({
          title: item.title || "",
          category: item.category || "",
          spuId: String(item.spuId || ""),
          skcId: String(item.skcId || ""),
          sku: item.skuCode || "",
          imageUrl: item.imageUrl || "",
          totalSales: item.totalSales || 0,
          last7DaysSales: item.last7DaysSales || 0,
          syncedAt: parsedSales?.syncedAt || "",
          stockStatus: item.stockStatus || "",
          supplyStatus: item.supplyStatus || "",
        });
        product.title = product.title || item.title || "";
        product.category = product.category || item.category || "";
        product.spuId = product.spuId || String(item.spuId || "");
        product.skcId = product.skcId || String(item.skcId || "");
        product.sku = product.sku || item.skuCode || "";
        product.imageUrl = product.imageUrl || item.imageUrl || "";
        product.totalSales = item.totalSales || product.totalSales || 0;
        product.last7DaysSales = item.last7DaysSales || product.last7DaysSales || 0;
        product.syncedAt = product.syncedAt || parsedSales?.syncedAt || "";
        product.stockStatus = item.stockStatus || product.stockStatus;
        product.supplyStatus = item.supplyStatus || product.supplyStatus;
        register(product);
      });

      parsedOrders.forEach((item: any) => {
        const product = ensureProduct({
          title: item.title || "",
          skcId: String(item.skcId || ""),
          sku: item.skuCode || "",
          pendingOrderCount: 0,
        });
        product.title = product.title || item.title || "";
        product.skcId = product.skcId || String(item.skcId || "");
        product.sku = product.sku || item.skuCode || "";
        product.pendingOrderCount += 1;
        register(product);
      });

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

      setProducts(mergedProducts);
    } catch (error) {
      console.error("加载商品失败", error);
      setProducts([]);
      setDiagnostics(null);
      setSourceState(EMPTY_SOURCES);
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter((product) => {
    const keyword = searchText.trim().toLowerCase();
    const matchKeyword = !keyword || (
      (product.title || "").toLowerCase().includes(keyword)
      || (product.skcId || "").includes(keyword)
      || (product.goodsId || "").includes(keyword)
      || (product.spuId || "").includes(keyword)
      || (getPrimaryCategory(product) || "").toLowerCase().includes(keyword)
      || (product.sku || "").toLowerCase().includes(keyword)
    );

    const matchStatus = statusFilter === "all"
      || (statusFilter === "other" ? !["在售", "已下架"].includes(product.status || "") : product.status === statusFilter);

    return matchKeyword && matchStatus;
  });

  const totalProducts = products.length;
  const total7dSales = products.reduce((sum, product) => sum + (product.last7DaysSales || 0), 0);
  const totalSales = products.reduce((sum, product) => sum + (product.totalSales || 0), 0);
  const onSaleCount = products.filter((product) => product.status === "在售").length;
  const pendingOrderProducts = products.filter((product) => product.pendingOrderCount > 0).length;
  const latestSyncedAt = getLatestSyncedAt(products, diagnostics);

  const dataIssues = [
    getCollectionDataIssue(diagnostics, "products", "商品列表", sourceState.products),
    getCollectionDataIssue(diagnostics, "sales", "销售数据", sourceState.sales),
    getCollectionDataIssue(diagnostics, "orders", "备货单数据", sourceState.orders),
  ].filter((issue): issue is string => Boolean(issue));

  const columns: ColumnsType<ProductItem> = [
    {
      title: "商品",
      dataIndex: "title",
      key: "product",
      width: 340,
      fixed: "left",
      render: (_: string, record: ProductItem) => (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          {record.imageUrl ? (
            <Image
              src={record.imageUrl}
              width={72}
              height={72}
              style={{ objectFit: "cover", borderRadius: 8, flexShrink: 0, border: "1px solid #f0f0f0" }}
              preview={{ mask: "查看大图" }}
              fallback={EMPTY_IMAGE_FALLBACK}
            />
          ) : (
            <div style={{ width: 72, height: 72, borderRadius: 8, background: "#f2f4f7", flexShrink: 0, border: "1px solid #f0f0f0" }} />
          )}
          <div style={{ minWidth: 0 }}>
            <Tooltip title={record.title || "-"}>
              <div className="app-line-clamp-2" style={{ fontWeight: 700, color: "var(--color-text)", lineHeight: 1.6 }}>
                {record.title || "未命名商品"}
              </div>
            </Tooltip>
            <div className="app-table-meta">
              {getPrimaryCategory(record) ? <Tag color="default">{getPrimaryCategory(record)}</Tag> : null}
              {record.sku ? <Tag color="blue">SKU {record.sku}</Tag> : null}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "标识",
      key: "ids",
      width: 220,
      render: (_: string, record: ProductItem) => (
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ fontFamily: "Consolas, monospace", fontSize: 12 }}>SKC: {record.skcId || "-"}</div>
          {record.spuId && record.spuId !== "-" ? (
            <div style={{ fontFamily: "Consolas, monospace", fontSize: 12, color: "#8c8c8c" }}>SPU: {record.spuId}</div>
          ) : null}
        </div>
      ),
    },
    {
      title: "销量",
      key: "sales",
      width: 160,
      sorter: (a, b) => (a.totalSales || 0) - (b.totalSales || 0),
      render: (_: string, record: ProductItem) => (
        <div style={{ display: "grid", gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--color-text-sec)" }}>7日销量</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-blue)" }}>{record.last7DaysSales || 0}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--color-text-sec)" }}>累计销量</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}>{record.totalSales || 0}</div>
          </div>
        </div>
      ),
    },
    {
      title: "库存与备货",
      key: "inventory",
      width: 240,
      render: (_: string, record: ProductItem) => (
        <div style={{ display: "grid", gap: 8 }}>
          <div className="app-table-meta">
            {record.stockStatus ? <Tag color="default">{record.stockStatus}</Tag> : <Tag>库存待同步</Tag>}
            {record.supplyStatus ? (
              <Tag color={record.supplyStatus === "正常供货" ? "success" : record.supplyStatus.includes("停止") ? "error" : "warning"}>
                {record.supplyStatus}
              </Tag>
            ) : (
              <Tag>供货待同步</Tag>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-sec)" }}>
            备货单 {record.pendingOrderCount > 0 ? `${record.pendingOrderCount} 单` : "暂无"}
          </div>
        </div>
      ),
    },
    {
      title: "状态",
      key: "status",
      width: 130,
      render: (_: string, record: ProductItem) => (
        <div style={{ display: "grid", gap: 8 }}>
          <div>{record.status ? <Tag color={record.status === "在售" ? "success" : "default"}>{record.status}</Tag> : <Tag>待同步</Tag>}</div>
          <div style={{ fontSize: 12, color: "var(--color-text-sec)" }}>{record.syncedAt ? record.syncedAt : "等待首次采集"}</div>
        </div>
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 110,
      fixed: "right",
      render: (_: string, record: ProductItem) => (
        <div className="app-table-actions">
          <Button type="link" style={{ padding: 0, color: "var(--color-brand)", fontWeight: 600 }} onClick={() => navigate(`/products/${record.skcId || record.goodsId || record.spuId}`)}>
            查看详情
          </Button>
        </div>
      ),
    },
  ];

  const emptyState = !loading && products.length === 0;
  const filteredEmptyState = !loading && products.length > 0 && filteredProducts.length === 0;

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="商品数据"
        title="商品管理"
        subtitle="集中查看商品、销量、库存与备货状态。"
        meta={[
          formatSyncedAt(latestSyncedAt),
          totalProducts > 0 ? `${totalProducts} 个商品` : "等待首次采集",
          `在售 ${onSaleCount}`,
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
          description="如果你需要最新状态，先重新绑定店铺账号，再执行一次数据采集即可。"
        />
      ) : null}

      {dataIssues.length > 0 ? (
        <Alert
          className="friendly-alert"
          type="warning"
          showIcon
          message="部分商品数据还没有准备好"
          description={(
            <div className="friendly-alert__summary">
              {dataIssues.slice(0, 3).join("；")}
              {dataIssues.length > 3 ? `；另有 ${dataIssues.length - 3} 个数据源也需要补采。` : ""}
              <div className="friendly-alert__details">
                可以直接前往数据采集页执行“商品列表 / 销售数据 / 备货单”三项采集。
              </div>
            </div>
          )}
          action={(
            <Button type="link" onClick={() => navigate("/collect")}>
              前往采集
            </Button>
          )}
        />
      ) : null}

      {emptyState ? (
        <div className="app-panel">
          <EmptyGuide
            icon={<AppstoreOutlined />}
            title={hasAccount === false ? "先绑定店铺账号" : "先执行一次数据采集"}
            description={hasAccount === false
              ? "绑定 Temu 店铺账号后，商品列表会自动汇总商品、销量和库存数据。"
              : "执行商品列表、销售数据和备货单采集后，这里会自动出现统计卡、筛选工具和商品表格。"}
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
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <StatCard compact title="商品总数" value={totalProducts} icon={<ShopOutlined />} color="brand" trend="当前账号下已识别商品" />
            <StatCard compact title="在售商品" value={onSaleCount} icon={<ShoppingCartOutlined />} color="success" trend="当前在售状态商品数" />
            <StatCard compact title="7日总销量" value={total7dSales} icon={<RiseOutlined />} color="blue" trend="近 7 日销量汇总" />
            <StatCard compact title="待跟进备货" value={pendingOrderProducts} icon={<EyeOutlined />} color="purple" trend={`累计销量 ${totalSales}`} />
          </div>

          <div className="app-panel" style={{ marginBottom: 16 }}>
            <div className="app-panel__title">
              <div>
                <div className="app-panel__title-main">筛选</div>
                <div className="app-panel__title-sub">按关键词和状态快速定位商品。</div>
              </div>
            </div>

            <div
              className="app-toolbar"
              style={{
                gridTemplateColumns: "minmax(260px, 1.4fr) minmax(160px, 0.7fr) auto auto",
              }}
            >
              <Input
                allowClear
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                prefix={<SearchOutlined />}
                placeholder="搜索商品名称 / SKC / SPU / SKU"
              />
              <Select
                value={statusFilter}
                onChange={(value) => setStatusFilter(value)}
                options={[
                  { label: "全部状态", value: "all" },
                  { label: "在售", value: "在售" },
                  { label: "已下架", value: "已下架" },
                  { label: "其他状态", value: "other" },
                ]}
              />
              <Button icon={<SyncOutlined />} onClick={loadProducts} loading={loading}>
                刷新当前页
              </Button>
              <div className="app-toolbar__count">
                显示 {filteredProducts.length} / {products.length}
              </div>
            </div>
          </div>

          <div className="app-panel">
            <div className="app-panel__title">
              <div>
                <div className="app-panel__title-main">商品列表</div>
                <div className="app-panel__title-sub">按销量优先排序，支持直接进入商品详情。</div>
              </div>
            </div>

            {filteredEmptyState ? (
              <EmptyGuide
                icon={<SearchOutlined />}
                title="没有符合当前筛选条件的商品"
                description="可以清空关键词或切回全部状态，快速回到完整商品列表。"
                action={(
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                    <Button type="primary" onClick={() => { setSearchText(""); setStatusFilter("all"); }}>
                      清空筛选
                    </Button>
                    <Button onClick={loadProducts}>重新检查</Button>
                  </div>
                )}
              />
            ) : (
              <Table
                rowKey={(record, index) => record.skcId || record.goodsId || record.spuId || `${record.title}-${index}`}
                dataSource={filteredProducts}
                columns={columns}
                size="small"
                loading={loading}
                pagination={{
                  pageSize: 20,
                  showSizeChanger: true,
                  pageSizeOptions: [20, 50, 100],
                  showTotal: (total) => `共 ${total} 个商品`,
                }}
                scroll={{ x: 1180 }}
                locale={{ emptyText: "暂无商品数据" }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
