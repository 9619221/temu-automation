import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Cascader,
  Col,
  Empty,
  Image,
  Input,
  InputNumber,
  Pagination,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  CheckCircleFilled,
  DeleteOutlined,
  FireOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ShoppingOutlined,
  StarFilled,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { readPageCache, writePageCache } from "../utils/pageCache";

const { Text, Paragraph } = Typography;
const yunqiDb = window.electronAPI?.yunqiDb;

const BLUE = "#1a73e8";
const CARD_STYLE: React.CSSProperties = { borderRadius: 10, boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.05)" };
// 选品搜索结果缓存（仅首页）：挂载时先显上次结果不空白，后台再刷新（stale-while-revalidate）。
const SELECTION_RESULT_CACHE_KEY = "temu.selection-plaza.result.v1";

// 选品池状态：流转链路 想上 → 找货源 → 已找到 → 上架中 → 已上架（或弃用）
const STATUS_META: Record<string, { label: string; color: string }> = {
  want: { label: "想上", color: "blue" },
  sourcing: { label: "找货源中", color: "orange" },
  sourced: { label: "已找到货源", color: "cyan" },
  listing: { label: "上架中", color: "purple" },
  listed: { label: "已上架", color: "green" },
  dropped: { label: "已弃用", color: "default" },
};
const STATUS_KEYS = ["want", "sourcing", "sourced", "listing", "listed", "dropped"];

const SORT_OPTIONS = [
  { value: "daily_sales", label: "日销量" },
  { value: "weekly_sales", label: "周销量" },
  { value: "monthly_sales", label: "月销量" },
  { value: "total_sales", label: "总销量" },
  { value: "usd_gmv", label: "GMV" },
  { value: "score", label: "评分" },
  { value: "usd_price", label: "价格" },
];

const MODE_MAP: Record<string, string> = { "0": "全托管", "1": "半托管", 全托管: "全托管", 半托管: "半托管" };
const normMode = (m: any) => MODE_MAP[String(m ?? "")] || (m ? String(m) : "");
const usd = (v: any) => `$${(Number(v) || 0).toFixed(2)}`;
const intFmt = (v: any) => (Number(v) || 0).toLocaleString("en-US");

interface ProductRow {
  goods_id: string;
  sku_id?: string;
  title_zh?: string;
  title_en?: string;
  main_image?: string;
  product_url?: string;
  usd_price?: number;
  daily_sales?: number;
  weekly_sales?: number;
  monthly_sales?: number;
  usd_gmv?: number;
  score?: number;
  total_comments?: number;
  category_zh?: string;
  mall_name?: string;
  mall_mode?: string;
  listed_at?: string;
  same_num?: number;
  total_sales?: number;
  status?: string;
  note?: string;
}

const PAGE_SIZE = 24;

export default function SelectionPlaza() {
  const [dbRowCount, setDbRowCount] = useState(0);
  const [stats, setStats] = useState<any>(null);

  // 筛选
  const [keyword, setKeyword] = useState("");
  // 类目筛：optIdPath 是 Cascader 选中路径（[一级optId] 或 [一级,二级]），取最后一个最具体的 opt_id 传给后端按商品 opt_ids 筛
  const [optIdPath, setOptIdPath] = useState<string[]>([]);
  const [categories, setCategories] = useState<Array<{ cat_id: number; cat_name: string; cat_level: number; parent_cat_id: number }>>([]);
  const [minPrice, setMinPrice] = useState<number | undefined>(undefined);
  const [maxPrice, setMaxPrice] = useState<number | undefined>(undefined);
  const [minDailySales, setMinDailySales] = useState<number | undefined>(undefined);
  const [sortBy, setSortBy] = useState("daily_sales");
  const [sortOrder, setSortOrder] = useState("DESC");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: ProductRow[]; total: number; page: number; totalPages: number }>(
    () => readPageCache(SELECTION_RESULT_CACHE_KEY, { items: [] as ProductRow[], total: 0, page: 1, totalPages: 0 }),
  );
  const [searching, setSearching] = useState(false);

  // 抓一批
  const [syncKeywords, setSyncKeywords] = useState("");
  const [syncMaxPages, setSyncMaxPages] = useState(5);
  const [syncing, setSyncing] = useState(false);

  // 选品池
  const [poolRows, setPoolRows] = useState<ProductRow[]>([]);
  const [poolSummary, setPoolSummary] = useState<Record<string, number>>({});
  const [poolIds, setPoolIds] = useState<Set<string>>(new Set());
  const [poolStatusFilter, setPoolStatusFilter] = useState<string>("");

  const [activeTab, setActiveTab] = useState("plaza");

  const loadDbInfo = useCallback(async () => {
    try {
      const info = await yunqiDb?.info();
      if (info) setDbRowCount(info.rowCount || 0);
      const s = await yunqiDb?.stats();
      if (s) setStats(s);
    } catch {
      /* ignore */
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const cats = await yunqiDb?.categories();
      if (Array.isArray(cats)) setCategories(cats as any);
    } catch {
      /* ignore */
    }
  }, []);

  const loadPoolIds = useCallback(async () => {
    try {
      const ids = await yunqiDb?.selectionIds();
      if (Array.isArray(ids)) setPoolIds(new Set(ids.map(String)));
    } catch {
      /* ignore */
    }
  }, []);

  const loadPool = useCallback(async () => {
    try {
      const r = await yunqiDb?.selectionList({ status: poolStatusFilter || undefined });
      if (r) {
        setPoolRows(r.rows || []);
        setPoolSummary(r.summary || {});
      }
    } catch {
      /* ignore */
    }
  }, [poolStatusFilter]);

  const doSearch = useCallback(
    async (toPage = 1) => {
      if (!yunqiDb) return message.error("数据库功能暂不可用");
      setSearching(true);
      try {
        const params: any = { sortBy, sortOrder, page: toPage, pageSize: PAGE_SIZE };
        if (keyword.trim()) params.keyword = keyword.trim();
        if (optIdPath.length) params.optId = String(optIdPath[optIdPath.length - 1]);
        if (minPrice != null) params.minPrice = minPrice;
        if (maxPrice != null) params.maxPrice = maxPrice;
        if (minDailySales != null) params.minDailySales = minDailySales;
        const r = await yunqiDb.search(params);
        setResult(r);
        setPage(toPage);
        if (toPage === 1) writePageCache(SELECTION_RESULT_CACHE_KEY, r); // 仅缓存首页，挂载先显旧结果
      } catch (e: any) {
        message.error(e?.message || "搜索失败");
      } finally {
        setSearching(false);
      }
    },
    [keyword, optIdPath, minPrice, maxPrice, minDailySales, sortBy, sortOrder],
  );

  const doSync = async () => {
    const kws = syncKeywords.split(/[,，\n]/).map((k) => k.trim()).filter(Boolean);
    if (!yunqiDb) return message.error("数据库功能暂不可用");
    setSyncing(true);
    try {
      const res: any = await yunqiDb.syncOnline({ keywords: kws, maxPages: syncMaxPages });
      if (res?.triggered) {
        // 全云端：服务器后台无头登录云启 + 抓取，约 30-60 秒，到点自动刷新一次
        message.success(res.message || "已触发服务器抓取，约 1 分钟后自动刷新");
        window.setTimeout(() => { void loadDbInfo(); void doSearch(1); }, 50000);
      } else {
        // 本地 worker 模式（非全云端时的兜底）
        const details = (res?.results || []).map((r: any) => `「${r.keyword}」${r.imported}条`).join("，");
        message.success(`抓取完成：新增/更新 ${res?.totalImported || 0} 条。${details}`);
        await loadDbInfo();
        await doSearch(1);
      }
    } catch (e: any) {
      message.error(e?.message || "抓取失败");
    } finally {
      setSyncing(false);
    }
  };

  const addToPool = async (item: ProductRow) => {
    try {
      const r = await yunqiDb?.selectionAdd({
        goods_id: item.goods_id,
        sku_id: item.sku_id,
        title_zh: item.title_zh,
        title_en: item.title_en,
        main_image: item.main_image,
        product_url: item.product_url,
        usd_price: item.usd_price,
        daily_sales: item.daily_sales,
        weekly_sales: item.weekly_sales,
        monthly_sales: item.monthly_sales,
        usd_gmv: item.usd_gmv,
        score: item.score,
        category_zh: item.category_zh,
        mall_name: item.mall_name,
        mall_mode: item.mall_mode,
        source_keyword: keyword || "",
      });
      if (r?.ok) {
        message.success("已加入选品池");
        setPoolIds((prev) => new Set(prev).add(String(item.goods_id)));
        void loadPool();
      } else {
        message.error(r?.reason || "加入失败");
      }
    } catch (e: any) {
      message.error(e?.message || "加入失败");
    }
  };

  const removeFromPool = async (goodsId: string) => {
    try {
      await yunqiDb?.selectionRemove({ goodsId });
      message.success("已移出选品池");
      setPoolIds((prev) => {
        const n = new Set(prev);
        n.delete(String(goodsId));
        return n;
      });
      void loadPool();
    } catch (e: any) {
      message.error(e?.message || "移除失败");
    }
  };

  const changeStatus = async (goodsId: string, status: string) => {
    try {
      await yunqiDb?.selectionUpdate({ goodsId, status });
      void loadPool();
    } catch (e: any) {
      message.error(e?.message || "更新状态失败");
    }
  };

  const openProduct = (item: ProductRow) => {
    const url = item.product_url || (item.goods_id ? `https://www.temu.com/goods.html?goods_id=${item.goods_id}` : "");
    if (url) window.open(url, "_blank");
  };

  useEffect(() => {
    void loadDbInfo();
    void loadCategories();
    void loadPoolIds();
    void doSearch(1);
    void loadPool();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadPool();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolStatusFilter]);

  const renderCard = (item: ProductRow, opts: { pool?: boolean } = {}) => {
    const inPool = poolIds.has(String(item.goods_id));
    const mode = normMode(item.mall_mode);
    const listedDate = item.listed_at ? String(item.listed_at).slice(0, 10) : "";
    return (
      <Card
        key={item.goods_id}
        hoverable
        className="sp-card"
        style={{ ...CARD_STYLE, height: "100%", overflow: "hidden", borderRadius: 12 }}
        styles={{ body: { padding: 12 } }}
        cover={
          <div style={{ height: 190, overflow: "hidden", background: "#f7f8fa", cursor: "pointer" }} onClick={() => openProduct(item)}>
            <Image
              src={item.main_image}
              alt={item.title_zh}
              width="100%"
              height={190}
              style={{ objectFit: "cover" }}
              preview={false}
              fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23eee'/%3E%3C/svg%3E"
            />
          </div>
        }
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, marginTop: 2 }}>
          {Number(item.daily_sales) > 0 ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#f5222d", fontSize: 14, fontWeight: 700 }}>
              <FireOutlined /> 日销 {intFmt(item.daily_sales)}
            </span>
          ) : <span />}
          <span style={{ fontSize: 15, fontWeight: 700, color: "#262626" }}>{usd(item.usd_price)}</span>
        </div>
        <Tooltip title="点击打开 Temu 商品页">
          <Paragraph ellipsis={{ rows: 2 }} onClick={() => openProduct(item)} style={{ marginBottom: 8, minHeight: 38, fontSize: 13, lineHeight: 1.45, fontWeight: 500, cursor: "pointer" }}>
            {item.title_zh || item.title_en || "（无标题）"}
          </Paragraph>
        </Tooltip>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
          <div>
            <span style={{ fontSize: 11, color: "#8c8c8c" }}>GMV </span>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#16a34a" }}>{usd(item.usd_gmv)}</span>
          </div>
          {Number(item.score) > 0 && (
            <span style={{ fontSize: 12, color: "#faad14", fontWeight: 600 }}>
              <StarFilled /> {Number(item.score).toFixed(1)}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#8c8c8c", marginBottom: 8 }}>
          <span>周销 <b style={{ color: "#595959" }}>{intFmt(item.weekly_sales)}</b></span>
          <span>月销 <b style={{ color: "#595959" }}>{intFmt(item.monthly_sales)}</b></span>
          {Number(item.same_num) > 0 && <span style={{ marginLeft: "auto" }}>{intFmt(item.same_num)} 同款</span>}
        </div>
        <div style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 10, display: "flex", alignItems: "center", gap: 5, overflow: "hidden", whiteSpace: "nowrap" }}>
          <ShoppingOutlined />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 88 }}>{item.mall_name || "-"}</span>
          {mode && <Tag color={mode === "全托管" ? "blue" : "cyan"} style={{ margin: 0, fontSize: 10, lineHeight: "15px", padding: "0 5px" }}>{mode}</Tag>}
          {listedDate && <span style={{ marginLeft: "auto", color: "#bfbfbf" }}>{listedDate}</span>}
        </div>
        {opts.pool ? (
          <Space size={4} style={{ width: "100%", justifyContent: "space-between" }}>
            <Select
              size="small"
              value={item.status || "want"}
              style={{ width: 116 }}
              onChange={(v) => changeStatus(item.goods_id, v)}
              options={STATUS_KEYS.map((k) => ({ value: k, label: STATUS_META[k].label }))}
            />
            <Space size={2}>
              <Tooltip title="打开商品页">
                <Button size="small" type="text" icon={<LinkOutlined />} onClick={() => openProduct(item)} />
              </Tooltip>
              <Popconfirm title="移出选品池？" onConfirm={() => removeFromPool(item.goods_id)} okText="移出" cancelText="取消">
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          </Space>
        ) : (
          <Space size={4} style={{ width: "100%", justifyContent: "space-between" }}>
            <Button
              size="small"
              type={inPool ? "default" : "primary"}
              icon={inPool ? <CheckCircleFilled /> : <PlusOutlined />}
              disabled={inPool}
              onClick={() => addToPool(item)}
              style={{ flex: 1 }}
            >
              {inPool ? "已加入" : "加入选品池"}
            </Button>
            <Tooltip title="打开商品页">
              <Button size="small" icon={<LinkOutlined />} onClick={() => openProduct(item)} />
            </Tooltip>
          </Space>
        )}
      </Card>
    );
  };

  // 把扁平 categories（cat_id=opt_id、parent_cat_id=父 opt_id）组装成 Cascader 两级树
  const categoryOptions = useMemo(() => {
    const l1 = categories.filter((c) => c.cat_level === 1).map((c) => ({ value: String(c.cat_id), label: c.cat_name, children: [] as any[] }));
    const byParent: Record<string, any[]> = {};
    for (const c of categories.filter((c) => c.cat_level === 2)) {
      (byParent[String(c.parent_cat_id)] ||= []).push({ value: String(c.cat_id), label: c.cat_name });
    }
    for (const o of l1) { const kids = byParent[o.value]; if (kids && kids.length) o.children = kids; else delete (o as any).children; }
    return l1;
  }, [categories]);

  const poolSegOptions = useMemo(() => {
    const total = poolSummary.total || 0;
    return [
      { value: "", label: `全部 ${total}` },
      ...STATUS_KEYS.map((k) => ({ value: k, label: `${STATUS_META[k].label} ${poolSummary[k] || 0}` })),
    ];
  }, [poolSummary]);

  const plazaTab = (
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <style>{`.sp-card{transition:transform .18s ease,box-shadow .22s ease} .sp-card:hover{transform:translateY(-5px)}`}</style>
      {/* 抓一批 + 库存概览 */}
      <Card style={CARD_STYLE} styles={{ body: { padding: 16 } }}>
        <Row gutter={[16, 12]} align="middle">
          <Col flex="auto">
            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              <Text strong>
                <ThunderboltOutlined style={{ color: BLUE }} /> 从云启抓一批商品进库
              </Text>
              <Space.Compact style={{ width: "100%", maxWidth: 760 }}>
                <Input
                  value={syncKeywords}
                  onChange={(e) => setSyncKeywords(e.target.value)}
                  placeholder="输入关键词，逗号或换行分隔多个（如：手机壳, 宠物玩具, 收纳盒）"
                  onPressEnter={() => void doSync()}
                  allowClear
                />
                <Tooltip title="每个关键词抓取的页数（每页约 100 条）">
                  <InputNumber min={1} max={10} value={syncMaxPages} onChange={(v) => setSyncMaxPages(Number(v) || 5)} addonBefore="页数" style={{ width: 130 }} />
                </Tooltip>
                <Button type="primary" loading={syncing} icon={<ThunderboltOutlined />} onClick={() => void doSync()}>
                  抓一批
                </Button>
              </Space.Compact>
              <Text type="secondary" style={{ fontSize: 12 }}>
                抓取按日销量倒序拉取；若云启登录过期，会自动打开云启页面让你登录后重试。
              </Text>
            </Space>
          </Col>
          <Col>
            <Space size={24}>
              <Statistic title="库内商品" value={dbRowCount} valueStyle={{ color: BLUE }} prefix={<ShoppingOutlined />} />
              <Statistic title="涉及店铺" value={stats?.totalMalls || 0} />
              <Button icon={<ReloadOutlined />} onClick={() => void loadDbInfo()}>
                刷新
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 筛选条 */}
      <Card style={CARD_STYLE} styles={{ body: { padding: 16 } }}>
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} sm={12} md={6}>
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="商品标题关键词"
              prefix={<SearchOutlined />}
              onPressEnter={() => void doSearch(1)}
              allowClear
            />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Cascader
              options={categoryOptions}
              value={optIdPath}
              onChange={(val) => setOptIdPath((val as string[]) || [])}
              placeholder={categoryOptions.length ? "选类目" : "类目加载中"}
              changeOnSelect
              allowClear
              showSearch={{ filter: (input, path) => path.some((o) => String(o.label).toLowerCase().includes(input.toLowerCase())) }}
              style={{ width: "100%" }}
            />
          </Col>
          <Col xs={12} sm={8} md={5}>
            <Space.Compact style={{ width: "100%" }}>
              <InputNumber value={minPrice} onChange={(v) => setMinPrice(v ?? undefined)} placeholder="最低价$" min={0} style={{ width: "50%" }} />
              <InputNumber value={maxPrice} onChange={(v) => setMaxPrice(v ?? undefined)} placeholder="最高价$" min={0} style={{ width: "50%" }} />
            </Space.Compact>
          </Col>
          <Col xs={12} sm={8} md={3}>
            <InputNumber value={minDailySales} onChange={(v) => setMinDailySales(v ?? undefined)} placeholder="日销≥" min={0} style={{ width: "100%" }} />
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Space.Compact style={{ width: "100%" }}>
              <Select value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} style={{ width: "62%" }} />
              <Select
                value={sortOrder}
                onChange={setSortOrder}
                style={{ width: "38%" }}
                options={[
                  { value: "DESC", label: "高→低" },
                  { value: "ASC", label: "低→高" },
                ]}
              />
            </Space.Compact>
          </Col>
          <Col xs={12} sm={8} md={2}>
            <Button type="primary" block loading={searching} icon={<SearchOutlined />} onClick={() => void doSearch(1)}>
              筛选
            </Button>
          </Col>
        </Row>
      </Card>

      {/* 商品墙 */}
      {result.items.length === 0 ? (
        <Card style={CARD_STYLE}>
          <Empty description={dbRowCount === 0 ? "选品库还是空的——先在上方「抓一批」拉点商品进来" : "没有符合条件的商品，换个筛选条件试试"} />
        </Card>
      ) : (
        <>
          <Row gutter={[12, 12]}>
            {result.items.map((item) => (
              <Col key={item.goods_id} xs={12} sm={8} md={6} lg={4} xl={4}>
                {renderCard(item)}
              </Col>
            ))}
          </Row>
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <Pagination
              current={page}
              total={result.total}
              pageSize={PAGE_SIZE}
              showSizeChanger={false}
              showTotal={(t) => `共 ${t} 件`}
              onChange={(p) => void doSearch(p)}
            />
          </div>
        </>
      )}
    </Space>
  );

  const poolTab = (
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <Card style={CARD_STYLE} styles={{ body: { padding: 16 } }}>
        <Segmented value={poolStatusFilter} onChange={(v) => setPoolStatusFilter(String(v))} options={poolSegOptions} />
      </Card>
      {poolRows.length === 0 ? (
        <Card style={CARD_STYLE}>
          <Empty description="选品池还是空的——去「商品广场」把想上的品加进来" />
        </Card>
      ) : (
        <Row gutter={[12, 12]}>
          {poolRows.map((item) => (
            <Col key={item.goods_id} xs={12} sm={8} md={6} lg={4} xl={4}>
              {renderCard(item, { pool: true })}
            </Col>
          ))}
        </Row>
      )}
    </Space>
  );

  return (
    <div style={{ padding: 16 }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: "plaza", label: <span><ShoppingOutlined /> 商品广场</span>, children: plazaTab },
          {
            key: "pool",
            label: (
              <span>
                <Badge count={poolSummary.total || 0} size="small" offset={[8, -2]} color={BLUE}>
                  <StarFilled /> 我的选品池
                </Badge>
              </span>
            ),
            children: poolTab,
          },
        ]}
      />
    </div>
  );
}
