import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Image,
  Input,
  List,
  message,
  Modal,
  Progress,
  Radio,
  Row,
  Select,
  Segmented,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  AppstoreOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  DollarOutlined,
  EyeOutlined,
  FileTextOutlined,
  KeyOutlined,
  LineChartOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ShopOutlined,
  StarOutlined,
  UnorderedListOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLocation } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import {
  toSafeNumber,
  formatPercentText,
  parseReviewCountText,
  getErrorMessage,
  stripWorkerErrorCode,
} from "../utils/dataTransform";
import {
  autoClassifyKeyword,
  buildExecutionReport,
  buildMarketInsight,
  buildTrackedSignals,
  normalizeMyProduct,
  type ComparisonRow,
  type ExecutionReport,
  type KeywordPoolItem,
  type MarketInsight,
} from "../utils/competitorWorkbench";
import CompetitorProductWorkbench, {
  type CompetitorProductPrefill,
  type ProductWorkbenchStepState,
} from "./CompetitorProductWorkbench";

const { Text, Paragraph } = Typography;

const store = window.electronAPI?.store;
const competitor = window.electronAPI?.competitor;
const yunqiDb = window.electronAPI?.yunqiDb;

const TEMU_ORANGE = "#1a73e8";
const CARD_STYLE: React.CSSProperties = {
  borderRadius: 8,
  borderColor: "var(--google-border-soft)",
  boxShadow: "var(--shadow-card)",
};
const PRICE_COLORS = ["#ea4335", "#fbbc04", "#34a853", "#1a73e8", "#7c3aed", "#30b0c7", "#137333", "#a50e0e"];
const KEYWORD_POOL_STORE_KEY = "temu_competitor_keyword_pool";
const MAX_KEYWORD_POOL_ITEMS = 30;
const MAX_COMPETITOR_REPORTS = 20;
const COMPETITOR_TRACKED_UPDATED_EVENT = "temu:competitor-tracked-updated";
const COMPETITOR_REPORTS_UPDATED_EVENT = "temu:competitor-reports-updated";

const SORT_OPTIONS = [
  { label: "综合排序", value: "" },
  { label: "日销", value: "daily_sales" },
  { label: "周销", value: "weekly_sales" },
  { label: "月销", value: "monthly_sales" },
  { label: "价格从低到高", value: "price_asc" },
  { label: "价格从高到低", value: "price_desc" },
  { label: "上架时间", value: "created_at" },
];

const DB_SORT_OPTIONS = [
  { label: "日销", value: "daily_sales" },
  { label: "周销", value: "weekly_sales" },
  { label: "月销", value: "monthly_sales" },
  { label: "总销量", value: "total_sales" },
  { label: "GMV($)", value: "usd_gmv" },
  { label: "价格", value: "usd_price" },
  { label: "评分", value: "score" },
  { label: "评论数", value: "total_comments" },
];

interface TrackedProduct {
  url: string;
  title?: string;
  snapshots: any[];
  addedAt: string;
  sourceKeyword?: string;
  goodsId?: string;
}

type YunqiTokenStatus = "empty" | "configured" | "checking" | "valid" | "invalid";

interface YunqiTokenBannerProps {
  status: YunqiTokenStatus;
  savedToken: string;
  draftToken: string;
  loading: boolean;
  saving: boolean;
  fetchingFromBrowser: boolean;
  editing: boolean;
  style?: CSSProperties;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onFetchFromBrowser: () => void;
  onAutoLogin?: () => void;
  autoLoginLoading?: boolean;
  hasCredentials?: boolean;
  onSaveCredentials?: (account: string, password: string) => void;
}

function emitCompetitorTrackedUpdated() {
  window.dispatchEvent(new CustomEvent(COMPETITOR_TRACKED_UPDATED_EVENT));
}

function emitCompetitorReportsUpdated() {
  window.dispatchEvent(new CustomEvent(COMPETITOR_REPORTS_UPDATED_EVENT));
}

async function readArrayStoreValue(key: string) {
  const value = await store?.get(key);
  return Array.isArray(value) ? value : [];
}

function getLatestSnapshot(item: TrackedProduct) {
  return item?.snapshots?.[item.snapshots.length - 1] || null;
}

function buildFallbackSnapshotFromSearch(product: any) {
  return {
    title: product.title,
    titleZh: product.titleZh || product.title,
    price: product.price || 0,
    priceText: product.priceText || `$${toSafeNumber(product.price).toFixed(2)}`,
    marketPrice: product.marketPrice || null,
    rating: product.score || 0,
    score: product.score || 0,
    reviewCount: parseReviewCountText(product.commentNumTips),
    salesText: `日销${toSafeNumber(product.dailySales)} | 周销${toSafeNumber(product.weeklySales)} | 月销${toSafeNumber(product.monthlySales)}`,
    dailySales: product.dailySales || 0,
    weeklySales: product.weeklySales || 0,
    monthlySales: product.monthlySales || 0,
    weeklySalesPercentage: product.weeklySalesPercentage || 0,
    monthlySalesPercentage: product.monthlySalesPercentage || 0,
    videoUrl: product.videoUrl || "",
    wareHouseType: product.wareHouseType,
    goodsId: product.goodsId,
    mall: product.mall,
    mallScore: product.mallScore,
    mallTotalGoods: product.mallTotalGoods,
    commentNumTips: product.commentNumTips,
    images: Array.isArray(product.imageUrls) && product.imageUrls.length > 0
      ? product.imageUrls
      : [product.imageUrl].filter(Boolean),
    tags: product.tags || [],
    labels: product.labels || [],
    url: product.productUrl,
    productUrl: product.productUrl,
    createdAt: product.createdAt,
    scrapedAt: new Date().toISOString(),
  };
}

function mergeTrackedProducts(existing: TrackedProduct[], additions: TrackedProduct[]) {
  const merged = new Map<string, TrackedProduct>();
  existing.forEach((item) => merged.set(item.url, item));
  additions.forEach((item) => {
    const previous = merged.get(item.url);
    if (!previous) {
      merged.set(item.url, item);
      return;
    }
    merged.set(item.url, {
      ...previous,
      ...item,
      title: item.title || previous.title,
      sourceKeyword: item.sourceKeyword || previous.sourceKeyword,
      goodsId: item.goodsId || previous.goodsId,
      snapshots: [...(previous.snapshots || []), ...(item.snapshots || [])].slice(-30),
    });
  });
  return Array.from(merged.values()).sort((left, right) => (right.addedAt || "").localeCompare(left.addedAt || ""));
}

function buildDetailModel(item: any) {
  const isDbRow = Boolean(item?.title_zh || item?.goods_id);
  const imageCandidates = isDbRow
    ? [item?.main_image, ...(typeof item?.carousel_images === "string" ? item.carousel_images.split(",") : [])]
    : [...(Array.isArray(item?.imageUrls) ? item.imageUrls : []), ...(Array.isArray(item?.images) ? item.images : []), item?.imageUrl];
  const images = imageCandidates.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 10);
  const reviewCount = isDbRow ? toSafeNumber(item?.total_comments) : Math.max(toSafeNumber(item?.reviewCount), parseReviewCountText(item?.commentNumTips));

  return {
    title: isDbRow ? (item?.title_zh || item?.title_en || "未命名商品") : (item?.titleZh || item?.title || "未命名商品"),
    subtitle: isDbRow ? item?.title_en : item?.titleEn,
    goodsId: isDbRow ? item?.goods_id : item?.goodsId,
    priceText: isDbRow ? `$${toSafeNumber(item?.usd_price).toFixed(2)}` : (item?.priceText || `$${toSafeNumber(item?.price).toFixed(2)}`),
    dailySales: isDbRow ? toSafeNumber(item?.daily_sales) : toSafeNumber(item?.dailySales),
    weeklySales: isDbRow ? toSafeNumber(item?.weekly_sales) : toSafeNumber(item?.weeklySales),
    monthlySales: isDbRow ? toSafeNumber(item?.monthly_sales) : toSafeNumber(item?.monthlySales),
    totalSales: isDbRow ? toSafeNumber(item?.total_sales) : toSafeNumber(item?.totalSales),
    score: isDbRow ? toSafeNumber(item?.score) : toSafeNumber(item?.score || item?.rating),
    reviewCount,
    mall: isDbRow ? item?.mall_name : item?.mall,
    mallScore: isDbRow ? item?.mall_score : item?.mallScore,
    mallTotalGoods: isDbRow ? item?.mall_product_count : item?.mallTotalGoods,
    wareHouseType: isDbRow ? item?.mall_mode : (item?.wareHouseType === 1 ? "半托管" : "全托管"),
    videoUrl: isDbRow ? item?.video_url : item?.videoUrl,
    productUrl: isDbRow ? item?.product_url : (item?.productUrl || item?.url),
    category: isDbRow ? item?.category_zh : item?.categoryName,
    brand: isDbRow ? "-" : item?.brand,
    createdAt: isDbRow ? item?.listed_at : item?.createdAt,
    recordedAt: isDbRow ? item?.recorded_at : item?.scrapedAt,
    images,
    dailySalesList: Array.isArray(item?.dailySalesList) ? item.dailySalesList : [],
    labels: Array.isArray(item?.labels)
      ? item.labels
      : (typeof item?.labels === "string" ? item.labels.split(",").map((value: string) => value.trim()).filter(Boolean) : []),
    tags: Array.isArray(item?.tags)
      ? item.tags
      : (typeof item?.tags === "string" ? item.tags.split(",").map((value: string) => value.trim()).filter(Boolean) : []),
  };
}

function getYunqiTokenStatusMeta(status: YunqiTokenStatus) {
  switch (status) {
    case "valid":
      return {
        title: "云启数据已连接",
        description: "现在可以继续搜索和分析当前商品。",
        icon: <CheckCircleOutlined style={{ color: "#52c41a", fontSize: 16 }} />,
        background: "linear-gradient(90deg, #f0fff4, #fff)",
        tagColor: "green" as const,
        actionLabel: "修改 Token",
      };
    case "checking":
      return {
        title: "正在校验 Yunqi Token",
        description: "正在验证 Token 是否可用，请稍等。",
        icon: <KeyOutlined style={{ color: "#1a73e8", fontSize: 16 }} />,
        background: "linear-gradient(90deg, #f0f5ff, #fff)",
        tagColor: "blue" as const,
        actionLabel: "修改 Token",
      };
    case "configured":
      return {
        title: "Yunqi Token 已保存",
        description: "Token 已保存，需要时会自动验证。",
        icon: <KeyOutlined style={{ color: TEMU_ORANGE, fontSize: 16 }} />,
        background: "linear-gradient(90deg, rgba(255, 159, 10, 0.10), #fff)",
        tagColor: "orange" as const,
        actionLabel: "修改 Token",
      };
    case "invalid":
      return {
        title: "Yunqi Token 已失效",
        description: "请重新粘贴最新 Token 后继续使用。",
        icon: <KeyOutlined style={{ color: "#ea4335", fontSize: 16 }} />,
        background: "linear-gradient(90deg, #fff1f0, #fff)",
        tagColor: "red" as const,
        actionLabel: "重新填写",
      };
    default:
      return {
        title: "配置 Yunqi 数据 Token",
        description: "登录 yunqishuju.com 后复制 Token。",
        icon: <KeyOutlined style={{ color: TEMU_ORANGE, fontSize: 16 }} />,
        background: "linear-gradient(90deg, rgba(26, 115, 232, 0.08), #fff)",
        tagColor: "default" as const,
        actionLabel: "配置 Token",
      };
  }
}

function YunqiTokenBanner({
  status,
  savedToken,
  draftToken,
  loading,
  saving,
  fetchingFromBrowser,
  editing,
  style,
  onDraftChange,
  onEdit,
  onSave,
  onCancel,
  onFetchFromBrowser,
  onAutoLogin,
  autoLoginLoading,
  hasCredentials,
  onSaveCredentials,
}: YunqiTokenBannerProps) {
  if (loading) return null;

  const meta = getYunqiTokenStatusMeta(status);
  const hasSavedToken = Boolean(savedToken);
  const maskedToken = savedToken ? `${savedToken.slice(0, 18)}...${savedToken.slice(-10)}` : "";

  return (
    <Card
      size="small"
      style={{
        ...CARD_STYLE,
        background: meta.background,
        ...style,
      }}
    >
      <Space style={{ width: "100%", justifyContent: "space-between", flexWrap: "wrap" }}>
        <Space align="start">
          {meta.icon}
          <Space direction="vertical" size={2}>
            <Text strong>{meta.title}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {meta.description}
              {status === "empty" ? (
                <>
                  {" "}
                  登录 <a href="https://www.yunqishuju.com" target="_blank" rel="noopener noreferrer">yunqishuju.com</a> 后复制 Token。
                </>
              ) : null}
            </Text>
          </Space>
          {hasSavedToken && !editing ? <Tag color={meta.tagColor} style={{ fontSize: 11 }}>{maskedToken}</Tag> : null}
        </Space>
        {autoLoginLoading ? (
          <Tag color="processing">自动登录中…</Tag>
        ) : null}
      </Space>
    </Card>
  );
}

function ProductDetailDrawer({ item, open, onClose }: { item: any; open: boolean; onClose: () => void }) {
  if (!item) return null;
  const detail = buildDetailModel(item);
  const trendData = detail.dailySalesList.map((value: number, index: number) => ({
    day: `D-${detail.dailySalesList.length - index}`,
    sales: value || 0,
  }));

  return (
    <Drawer title={detail.title} open={open} onClose={onClose} width={720} styles={{ body: { padding: "16px 24px" } }}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8 }}>
          {detail.images.length > 0 ? detail.images.map((url: string, index: number) => (
            <Image
              key={`${url}-${index}`}
              src={url}
              alt={`image-${index + 1}`}
              width={120}
              height={120}
              style={{ objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
              fallback="data:image/svg+xml,<svg/>"
            />
          )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无图片" />}
        </div>

        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label="商品 ID">{detail.goodsId || "-"}</Descriptions.Item>
          <Descriptions.Item label="当前价格">
            <Text strong style={{ color: TEMU_ORANGE }}>{detail.priceText}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="月销">{detail.monthlySales.toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="评分">{detail.score || "-"}</Descriptions.Item>
          <Descriptions.Item label="评论数">{detail.reviewCount || "-"}</Descriptions.Item>
          <Descriptions.Item label="视频">{detail.videoUrl ? <Tag color="purple">有视频</Tag> : "-"}</Descriptions.Item>
          <Descriptions.Item label="店铺">{detail.mall || "-"}</Descriptions.Item>
          <Descriptions.Item label="店铺体量">{detail.mallTotalGoods || "-"}</Descriptions.Item>
          <Descriptions.Item label="履约模式">{detail.wareHouseType || "-"}</Descriptions.Item>
          <Descriptions.Item label="类目">{detail.category || "-"}</Descriptions.Item>
          <Descriptions.Item label="记录时间">{detail.recordedAt || "-"}</Descriptions.Item>
          <Descriptions.Item label="上架时间">{detail.createdAt || "-"}</Descriptions.Item>
          <Descriptions.Item label="副标题" span={2}>{detail.subtitle || "-"}</Descriptions.Item>
        </Descriptions>

        <Card size="small" title="销量概览">
          <Row gutter={[12, 12]}>
            <Col span={6}><Statistic title="日销" value={detail.dailySales} /></Col>
            <Col span={6}><Statistic title="周销" value={detail.weeklySales} /></Col>
            <Col span={6}><Statistic title="月销" value={detail.monthlySales} /></Col>
            <Col span={6}><Statistic title="总销量" value={detail.totalSales} /></Col>
          </Row>
        </Card>

        {trendData.length > 0 ? (
          <Card size="small" title="日销趋势">
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" fontSize={10} />
                <YAxis fontSize={10} />
                <RTooltip />
                <Area type="monotone" dataKey="sales" stroke={TEMU_ORANGE} fill="rgba(26, 115, 232, 0.10)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        ) : null}

        {(detail.labels.length > 0 || detail.tags.length > 0) ? (
          <Card size="small" title="标签">
            <Space wrap>
              {detail.labels.map((label: string, index: number) => <Tag key={`label-${index}`} color="blue">{label}</Tag>)}
              {detail.tags.map((tag: string, index: number) => <Tag key={`tag-${index}`} color="orange">{tag}</Tag>)}
            </Space>
          </Card>
        ) : null}

        <Space>
          {detail.productUrl ? (
            <Button type="primary" href={detail.productUrl} target="_blank" icon={<LinkOutlined />}
              style={{ background: TEMU_ORANGE, borderColor: TEMU_ORANGE }}>
              在 Temu 查看商品
            </Button>
          ) : null}
          {detail.videoUrl ? (
            <Button href={detail.videoUrl} target="_blank" icon={<VideoCameraOutlined />}>
              查看视频
            </Button>
          ) : null}
        </Space>
      </Space>
    </Drawer>
  );
}

// 旧版关键词搜索 tab，保留以便后续复用；export 以绕过 noUnusedLocals
export function _KeywordSearchTab() {
  const [keyword, setKeyword] = useState("");
  const [wareHouseType, setWareHouseType] = useState<number>(0);
  const [sortBy, setSortBy] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [keywordPool, setKeywordPool] = useState<KeywordPoolItem[]>([]);
  const [viewMode, setViewMode] = useState<string>("table");
  const [detailItem, setDetailItem] = useState<any>(null);
  const [selectedGoodsIds, setSelectedGoodsIds] = useState<string[]>([]);
  const [trackingGoodsIds, setTrackingGoodsIds] = useState<string[]>([]);
  const [savingKeyword, setSavingKeyword] = useState(false);

  useEffect(() => {
    store?.get("temu_competitor_keywords").then((data: any) => {
      if (Array.isArray(data)) setHistory(data);
    });
    store?.get(KEYWORD_POOL_STORE_KEY).then((data: any) => {
      if (Array.isArray(data)) setKeywordPool(data);
    });
  }, []);

  const saveHistory = useCallback(async (value: string) => {
    const updated = [value, ...history.filter((item) => item !== value)].slice(0, 20);
    setHistory(updated);
    await store?.set("temu_competitor_keywords", updated);
  }, [history]);

  const products = results?.products || [];
  const marketInsight = useMemo<MarketInsight | null>(() => {
    if (!results?.keyword || products.length === 0) return null;
    return buildMarketInsight(results.keyword, products, wareHouseType);
  }, [products, results, wareHouseType]);

  const saveKeywordToPool = useCallback(async (insight?: MarketInsight | null) => {
    if (!insight) return;
    setSavingKeyword(true);
    try {
      const item: KeywordPoolItem = {
        id: `${insight.keyword.toLowerCase()}::${wareHouseType}`,
        keyword: insight.keyword,
        keywordType: insight.keywordType || autoClassifyKeyword(insight.keyword),
        wareHouseType,
        updatedAt: new Date().toISOString(),
        totalFound: insight.totalProducts,
        competitionLabel: insight.competitionLabel,
        marketVerdict: insight.marketVerdict,
        opportunityScore: insight.opportunityScore,
        recommendedPriceBand: insight.recommendedPriceBand,
        primaryNeed: insight.primaryNeed,
        entryFocus: insight.entryFocus,
        nextAction: insight.nextAction,
        videoRate: insight.videoRate,
        top10SalesShare: insight.top10SalesShare,
      };
      const updated = [item, ...keywordPool.filter((current) => current.id !== item.id)].slice(0, MAX_KEYWORD_POOL_ITEMS);
      setKeywordPool(updated);
      await store?.set(KEYWORD_POOL_STORE_KEY, updated);
      message.success(`已加入关键词池：${item.keyword}`);
    } catch (error: any) {
      message.error(error?.message || "保存关键词池失败");
    } finally {
      setSavingKeyword(false);
    }
  }, [keywordPool, wareHouseType]);

  const handleSearch = async () => {
    if (!keyword.trim()) return message.warning("请输入搜索关键词");
    if (!competitor) return message.error("当前竞品分析功能暂时不可用，请稍后再试");
    setLoading(true);
    try {
      const sortField = sortBy === "price_asc" ? "price" : sortBy === "price_desc" ? "price" : sortBy;
      const sortOrder = sortBy === "price_asc" ? "asc" : "desc";
      const response = await competitor.search({ keyword: keyword.trim(), maxResults: 50, wareHouseType, sortField, sortOrder } as any);
      setResults(response);
      setSelectedGoodsIds([]);
      await saveHistory(keyword.trim());

      const existingKey = `${response.keyword.toLowerCase()}::${wareHouseType}`;
      if (keywordPool.some((item) => item.id === existingKey)) {
        const nextInsight = buildMarketInsight(response.keyword, response.products || [], wareHouseType);
        const nextItem: KeywordPoolItem = {
          id: existingKey,
          keyword: nextInsight.keyword,
          keywordType: nextInsight.keywordType,
          wareHouseType,
          updatedAt: new Date().toISOString(),
          totalFound: nextInsight.totalProducts,
          competitionLabel: nextInsight.competitionLabel,
          marketVerdict: nextInsight.marketVerdict,
          opportunityScore: nextInsight.opportunityScore,
          recommendedPriceBand: nextInsight.recommendedPriceBand,
          primaryNeed: nextInsight.primaryNeed,
          entryFocus: nextInsight.entryFocus,
          nextAction: nextInsight.nextAction,
          videoRate: nextInsight.videoRate,
          top10SalesShare: nextInsight.top10SalesShare,
        };
        const updated = [nextItem, ...keywordPool.filter((item) => item.id !== existingKey)].slice(0, MAX_KEYWORD_POOL_ITEMS);
        setKeywordPool(updated);
        await store?.set(KEYWORD_POOL_STORE_KEY, updated);
      }

      message.success(`找到 ${response.totalFound} 个商品`);
    } catch (error: any) {
      const msg = error?.message || "搜索失败";
      if (msg.includes("token") || msg.includes("Token") || msg.includes("401") || msg.includes("授权")) {
        Modal.warning({
          title: "云启数据 Token 无效",
          content: "请检查是否已正确配置云启数据 Token。Token 可能已过期，请重新登录 yunqishuju.com 获取新的 Token。",
        });
      } else {
        message.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const priceDistribution = useMemo(() => {
    if (!products.length) return [];
    const prices = products.map((product: any) => product.price).filter((price: number) => price > 0);
    if (prices.length === 0) return [];
    const min = Math.floor(Math.min(...prices));
    const max = Math.ceil(Math.max(...prices));
    const range = Math.max(1, max - min);
    const bucketSize = Math.max(1, Math.ceil(range / 8));
    const buckets: Record<string, number> = {};
    prices.forEach((price: number) => {
      const start = Math.floor((price - min) / bucketSize) * bucketSize + min;
      const label = `$${start}-${start + bucketSize}`;
      buckets[label] = (buckets[label] || 0) + 1;
    });
    return Object.entries(buckets).map(([rangeLabel, count]) => ({ range: rangeLabel, count }));
  }, [products]);

  const avgPrice = products.length
    ? (products.reduce((sum: number, product: any) => sum + (product.price || 0), 0) / products.length).toFixed(2)
    : "0";
  const totalDailySales = products.reduce((sum: number, product: any) => sum + (product.dailySales || 0), 0);
  const totalMonthlySales = products.reduce((sum: number, product: any) => sum + (product.monthlySales || 0), 0);
  const totalGmv = products.reduce((sum: number, product: any) => sum + (product.usdGmv || 0), 0);

  const handleTrackProducts = async (items: any[]) => {
    if (!competitor) return message.error("当前竞品分析功能暂时不可用，请稍后再试");
    const validItems = items.filter((item) => item?.productUrl);
    if (validItems.length === 0) return message.warning("请选择可跟踪的竞品");

    setTrackingGoodsIds(validItems.map((item) => String(item.goodsId || item.productUrl)));
    try {
      const urls = Array.from(new Set(validItems.map((item) => item.productUrl)));
      const existingTracked = await readArrayStoreValue("temu_competitor_tracked");
      const batch = await competitor.batchTrack({ urls });
      const lookup = new Map(validItems.map((item) => [item.productUrl, item]));
      const additions: TrackedProduct[] = urls.map((url) => {
        const matched = batch.results.find((result: any) => result.url === url);
        const base = lookup.get(url);
        const snapshot = matched && !matched.error ? { ...buildFallbackSnapshotFromSearch(base), ...matched } : buildFallbackSnapshotFromSearch(base);
        return {
          url,
          goodsId: base?.goodsId ? String(base.goodsId) : undefined,
          sourceKeyword: results?.keyword || keyword.trim() || undefined,
          title: snapshot.title || base?.title || url,
          snapshots: [snapshot],
          addedAt: new Date().toISOString(),
        };
      });
      const merged = mergeTrackedProducts(existingTracked as TrackedProduct[], additions);
      await store?.set("temu_competitor_tracked", merged);
      emitCompetitorTrackedUpdated();
      message.success(`已加入竞品跟踪池：${additions.length} 个商品`);
    } catch (error: any) {
      message.error(error?.message || "加入跟踪池失败");
    } finally {
      setTrackingGoodsIds([]);
    }
  };

  const keywordPoolColumns = [
    {
      title: "关键词",
      dataIndex: "keyword",
      key: "keyword",
      render: (value: string, record: KeywordPoolItem) => (
        <Space direction="vertical" size={0}>
          <Button type="link" style={{ padding: 0, height: "auto" }} onClick={() => setKeyword(value)}>{value}</Button>
          <Space size={4} wrap>
            <Tag color="blue">{record.keywordType}</Tag>
            <Tag color={record.marketVerdict === "红海硬卷盘" ? "red" : record.marketVerdict === "中度竞争盘" ? "orange" : "green"}>
              {record.marketVerdict}
            </Tag>
          </Space>
        </Space>
      ),
    },
    {
      title: "机会分",
      dataIndex: "opportunityScore",
      key: "opportunityScore",
      width: 110,
      render: (value: number) => <Progress percent={value} size="small" strokeColor={TEMU_ORANGE} />,
    },
    {
      title: "推荐价格带",
      dataIndex: "recommendedPriceBand",
      key: "recommendedPriceBand",
      width: 150,
    },
    {
      title: "下步动作",
      dataIndex: "nextAction",
      key: "nextAction",
      ellipsis: true,
    },
  ];

  const searchColumns = [
    {
      title: "图片",
      dataIndex: "imageUrl",
      key: "image",
      width: 70,
      render: (url: string) => url ? (
        <Image src={url} width={64} height={64} style={{ objectFit: "cover", borderRadius: 8 }} preview={false} fallback="data:image/svg+xml,<svg/>" />
      ) : "-",
    },
    {
      title: "商品",
      dataIndex: "title",
      key: "title",
      width: 240,
      ellipsis: true,
      render: (title: string, record: any) => (
        <Space direction="vertical" size={0}>
          <Tooltip title={title}><Text ellipsis style={{ fontSize: 14, maxWidth: 220, lineHeight: 1.6 }}>{title}</Text></Tooltip>
          <Space size={4} wrap>
            {record.mall ? <Text type="secondary" style={{ fontSize: 12 }}><ShopOutlined /> {record.mall}</Text> : null}
            {record.brand ? <Tag style={{ fontSize: 11 }}>{record.brand}</Tag> : null}
            {record.videoUrl ? <Tag color="purple" style={{ fontSize: 12 }}><VideoCameraOutlined /> 视频</Tag> : null}
          </Space>
        </Space>
      ),
    },
    {
      title: "价格",
      key: "price",
      width: 120,
      sorter: (left: any, right: any) => toSafeNumber(left.price) - toSafeNumber(right.price),
      render: (_: any, record: any) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ color: TEMU_ORANGE }}>{record.priceText}</Text>
          {record.marketPrice ? <Text delete type="secondary" style={{ fontSize: 12 }}>${record.marketPrice}</Text> : null}
        </Space>
      ),
    },
    {
      title: "日销",
      dataIndex: "dailySales",
      key: "dailySales",
      width: 80,
      sorter: (left: any, right: any) => toSafeNumber(left.dailySales) - toSafeNumber(right.dailySales),
      render: (value: number) => value > 0 ? <Text style={{ color: "#ea4335" }}>{value.toLocaleString()}</Text> : <Text type="secondary">0</Text>,
    },
    {
      title: "周销",
      dataIndex: "weeklySales",
      key: "weeklySales",
      width: 80,
      sorter: (left: any, right: any) => toSafeNumber(left.weeklySales) - toSafeNumber(right.weeklySales),
      render: (value: number) => value > 0 ? <Text style={{ color: "#fbbc04" }}>{value.toLocaleString()}</Text> : <Text type="secondary">0</Text>,
    },
    {
      title: "月销",
      dataIndex: "monthlySales",
      key: "monthlySales",
      width: 80,
      sorter: (left: any, right: any) => toSafeNumber(left.monthlySales) - toSafeNumber(right.monthlySales),
      render: (value: number) => value > 0 ? <Text style={{ color: "#1a73e8" }}>{value.toLocaleString()}</Text> : <Text type="secondary">0</Text>,
    },
    {
      title: "评分",
      dataIndex: "score",
      key: "score",
      width: 70,
      sorter: (left: any, right: any) => toSafeNumber(left.score) - toSafeNumber(right.score),
      render: (value: number) => value ? <><StarOutlined style={{ color: "#faad14", fontSize: 12 }} /> {value}</> : <Text type="secondary">-</Text>,
    },
    {
      title: "周销变化",
      dataIndex: "weeklySalesPercentage",
      key: "weeklySalesPercentage",
      width: 95,
      sorter: (left: any, right: any) => toSafeNumber(left.weeklySalesPercentage) - toSafeNumber(right.weeklySalesPercentage),
      render: (value: number) => value
        ? <Text style={{ color: value >= 0 ? "#52c41a" : "#ea4335", fontSize: 13 }}>{value >= 0 ? "+" : ""}{value}%</Text>
        : <Text type="secondary">-</Text>,
    },
    {
      title: "动作",
      key: "action",
      width: 140,
      fixed: "right" as const,
      render: (_: any, record: any) => (
        <Space>
          <Button
            size="small"
            loading={trackingGoodsIds.includes(String(record.goodsId || record.productUrl))}
            onClick={(event) => {
              event.stopPropagation();
              void handleTrackProducts([record]);
            }}
          >
            跟踪
          </Button>
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={(event) => { event.stopPropagation(); setDetailItem(record); }}>
            详情
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card style={CARD_STYLE}>
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Space wrap>
            <Input
              prefix={<SearchOutlined />}
              placeholder="输入关键词，如 makeup bag / phone case"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onPressEnter={handleSearch}
              style={{ width: 360 }}
              allowClear
            />
            <Radio.Group value={wareHouseType} onChange={(event) => setWareHouseType(event.target.value)} buttonStyle="solid" size="middle">
              <Radio.Button value={0}>全托管</Radio.Button>
              <Radio.Button value={1}>半托管</Radio.Button>
            </Radio.Group>
            <Select
              value={sortBy}
              onChange={setSortBy}
              style={{ width: 150 }}
              options={SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
            <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={handleSearch}
              style={{ background: TEMU_ORANGE, borderColor: TEMU_ORANGE }}>
              搜索竞品
            </Button>
            <Button disabled={!marketInsight} loading={savingKeyword} onClick={() => void saveKeywordToPool(marketInsight)}>
              加入关键词池
            </Button>
          </Space>

          {history.length > 0 ? (
            <Space wrap size={[4, 4]}>
              <Text type="secondary" style={{ fontSize: 12 }}>最近搜索：</Text>
              {history.slice(0, 10).map((item) => (
                <Tag key={item} style={{ cursor: "pointer" }} onClick={() => setKeyword(item)}>{item}</Tag>
              ))}
            </Space>
          ) : null}
        </Space>
      </Card>

      {results ? (
        <>
          {marketInsight ? (
            <Alert
              style={{ marginTop: 16, borderRadius: 14 }}
              type={marketInsight.marketVerdict === "红海硬卷盘" ? "warning" : marketInsight.marketVerdict === "中度竞争盘" ? "info" : "success"}
              showIcon
              message={`${marketInsight.marketVerdict} · 推荐价格带 ${marketInsight.recommendedPriceBand}`}
              description={`用户更在意${marketInsight.primaryNeed}，建议 ${marketInsight.entryFocus}。Top10 销量集中度 ${formatPercentText(marketInsight.top10SalesShare)}，视频覆盖 ${formatPercentText(marketInsight.videoRate)}。`}
            />
          ) : null}

          <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
            <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="商品数" value={results.totalFound} valueStyle={{ fontSize: 18 }} /></Card></Col>
            <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="均价" value={avgPrice} prefix="$" precision={2} valueStyle={{ fontSize: 18 }} /></Card></Col>
            <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="最低价" value={products.length ? Math.min(...products.map((product: any) => product.price || Infinity)) : 0} prefix="$" precision={2} valueStyle={{ fontSize: 18 }} /></Card></Col>
            <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="最高价" value={products.length ? Math.max(...products.map((product: any) => product.price || 0)) : 0} prefix="$" precision={2} valueStyle={{ fontSize: 18 }} /></Card></Col>
            <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="日销总量" value={totalDailySales} valueStyle={{ fontSize: 18, color: "#ea4335" }} /></Card></Col>
            <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="月销总量" value={totalMonthlySales} valueStyle={{ fontSize: 18, color: "#1a73e8" }} /></Card></Col>
            <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="GMV 总计" value={totalGmv} prefix="$" valueStyle={{ fontSize: 18 }} /></Card></Col>
            <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="有视频" value={products.filter((product: any) => product.videoUrl).length} suffix={`/${products.length}`} valueStyle={{ fontSize: 18 }} /></Card></Col>
            {marketInsight ? <Col span={6}><Card style={CARD_STYLE} size="small"><Statistic title="机会分" value={marketInsight.opportunityScore} suffix="/100" valueStyle={{ fontSize: 18, color: TEMU_ORANGE }} /></Card></Col> : null}
            {marketInsight ? <Col span={6}><Card style={CARD_STYLE} size="small"><Statistic title="Top10 销量集中度" value={(marketInsight.top10SalesShare * 100).toFixed(0)} suffix="%" valueStyle={{ fontSize: 18 }} /></Card></Col> : null}
          </Row>

          {marketInsight ? (
            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
              <Col span={14}>
                <Card title="市场层判断" style={CARD_STYLE} size="small">
                  <Descriptions column={{ xs: 1, lg: 2 }} size="small" bordered>
                    <Descriptions.Item label="盘面判断">
                      <Space wrap>
                        <Tag color={marketInsight.marketVerdict === "红海硬卷盘" ? "red" : marketInsight.marketVerdict === "中度竞争盘" ? "orange" : "green"}>
                          {marketInsight.marketVerdict}
                        </Tag>
                        <Tag color="blue">{marketInsight.keywordType}</Tag>
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="推荐价格带">{marketInsight.recommendedPriceBand}</Descriptions.Item>
                    <Descriptions.Item label="用户优先关注">{marketInsight.primaryNeed}</Descriptions.Item>
                    <Descriptions.Item label="素材门槛">
                      评分中位 {marketInsight.medianScore || "-"} / 视频覆盖 {formatPercentText(marketInsight.videoRate)}
                    </Descriptions.Item>
                    <Descriptions.Item label="履约判断">{marketInsight.warehouseInsight}</Descriptions.Item>
                    <Descriptions.Item label="切入策略">{marketInsight.entryFocus}</Descriptions.Item>
                    <Descriptions.Item label="低 / 中 / 高价格带" span={2}>
                      <Space wrap>
                        <Tag>{marketInsight.lowPriceBand}</Tag>
                        <Tag color="orange">{marketInsight.midPriceBand}</Tag>
                        <Tag color="red">{marketInsight.highPriceBand}</Tag>
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="下一步动作" span={2}>{marketInsight.nextAction}</Descriptions.Item>
                  </Descriptions>
                </Card>
              </Col>
              <Col span={10}>
                <Card title={`关键词池 (${keywordPool.length})`} style={CARD_STYLE} size="small">
                  {keywordPool.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先把高价值关键词加入作战池" />
                  ) : (
                    <Table
                      dataSource={keywordPool.slice(0, 6)}
                      columns={keywordPoolColumns}
                      rowKey="id"
                      size="small"
                      pagination={false}
                    />
                  )}
                </Card>
              </Col>
            </Row>
          ) : null}

          {priceDistribution.length > 0 ? (
            <Card title="价格分布" style={{ ...CARD_STYLE, marginTop: 16 }} size="small">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={priceDistribution}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="range" fontSize={11} />
                  <YAxis fontSize={11} />
                  <RTooltip />
                  <Bar dataKey="count" name="商品数">
                    {priceDistribution.map((_: any, index: number) => (
                      <Cell key={index} fill={PRICE_COLORS[index % PRICE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          ) : null}

          <Card
            title={`搜索结果 - "${results.keyword}" (${products.length} 条)`}
            style={{ ...CARD_STYLE, marginTop: 16 }}
            size="small"
            extra={(
              <Space>
                <Button
                  size="small"
                  disabled={selectedGoodsIds.length === 0}
                  loading={trackingGoodsIds.length > 0}
                  onClick={() => {
                    const selected = products.filter((product: any) => selectedGoodsIds.includes(String(product.goodsId || product.productUrl)));
                    void handleTrackProducts(selected);
                  }}
                >
                  加入跟踪池 ({selectedGoodsIds.length})
                </Button>
                <Text type="secondary" style={{ fontSize: 12 }}>{results.scrapedAt}</Text>
                <Segmented
                  size="small"
                  value={viewMode}
                  onChange={(value) => setViewMode(value as string)}
                  options={[
                    { value: "table", icon: <UnorderedListOutlined /> },
                    { value: "card", icon: <AppstoreOutlined /> },
                  ]}
                />
              </Space>
            )}
          >
            {viewMode === "table" ? (
              <Table
                dataSource={products}
                columns={searchColumns}
                rowKey={(record: any) => String(record.goodsId || record.productUrl)}
                size="small"
                scroll={{ x: 1280 }}
                rowSelection={{
                  selectedRowKeys: selectedGoodsIds,
                  onChange: (keys) => setSelectedGoodsIds(keys.map((key) => String(key))),
                }}
                pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
                onRow={(record) => ({ onClick: () => setDetailItem(record), style: { cursor: "pointer" } })}
              />
            ) : (
              <List
                grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 4, xl: 5 }}
                dataSource={products}
                renderItem={(item: any) => (
                  <List.Item>
                    <Card
                      hoverable
                      size="small"
                      onClick={() => setDetailItem(item)}
                      cover={item.imageUrl ? (
                        <div style={{ height: 160, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fbff" }}>
                          <Image src={item.imageUrl} alt={item.title} style={{ maxHeight: 160, objectFit: "contain" }} preview={false} fallback="data:image/svg+xml,<svg/>" />
                        </div>
                      ) : undefined}
                    >
                      <Card.Meta
                        title={(
                          <Tooltip title={item.title}>
                            <Text ellipsis style={{ fontSize: 12, maxWidth: "100%" }}>{item.title}</Text>
                          </Tooltip>
                        )}
                        description={(
                          <Space direction="vertical" size={2} style={{ width: "100%" }}>
                            <Space align="baseline">
                              <Text strong style={{ color: TEMU_ORANGE, fontSize: 16 }}>{item.priceText}</Text>
                              {item.marketPrice ? <Text delete type="secondary" style={{ fontSize: 12 }}>${item.marketPrice}</Text> : null}
                            </Space>
                            <Space size={4} wrap>
                              {item.dailySales > 0 ? <Tag color="red" style={{ fontSize: 12, margin: 0 }}>日销 {item.dailySales.toLocaleString()}</Tag> : null}
                              {item.weeklySales > 0 ? <Tag color="orange" style={{ fontSize: 12, margin: 0 }}>周销 {item.weeklySales.toLocaleString()}</Tag> : null}
                              {item.monthlySales > 0 ? <Tag color="blue" style={{ fontSize: 12, margin: 0 }}>月销 {item.monthlySales.toLocaleString()}</Tag> : null}
                            </Space>
                            {item.score > 0 ? <Text style={{ fontSize: 13 }}><StarOutlined style={{ color: "#faad14" }} /> {item.score} {item.commentNumTips ? `(${item.commentNumTips})` : ""}</Text> : null}
                            {item.mall ? <Text type="secondary" style={{ fontSize: 13 }}><ShopOutlined /> {item.mall}</Text> : null}
                            {item.usdGmv > 0 ? <Text type="secondary" style={{ fontSize: 13 }}><DollarOutlined /> GMV ${item.usdGmv.toLocaleString()}</Text> : null}
                            <Button
                              size="small"
                              loading={trackingGoodsIds.includes(String(item.goodsId || item.productUrl))}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleTrackProducts([item]);
                              }}
                            >
                              加入跟踪池
                            </Button>
                          </Space>
                        )}
                      />
                    </Card>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </>
      ) : null}

      <ProductDetailDrawer item={detailItem} open={!!detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}

function CompetitorTrackTab() {
  const [urlInput, setUrlInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tracked, setTracked] = useState<TrackedProduct[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<any>(null);

  const loadTracked = useCallback(async () => {
    const data = await readArrayStoreValue("temu_competitor_tracked");
    setTracked(data as TrackedProduct[]);
  }, []);

  useEffect(() => {
    void loadTracked();
    const listener = () => { void loadTracked(); };
    window.addEventListener(COMPETITOR_TRACKED_UPDATED_EVENT, listener);
    return () => window.removeEventListener(COMPETITOR_TRACKED_UPDATED_EVENT, listener);
  }, [loadTracked]);

  const saveTracked = useCallback(async (items: TrackedProduct[]) => {
    setTracked(items);
    await store?.set("temu_competitor_tracked", items);
    emitCompetitorTrackedUpdated();
  }, []);

  const handleAdd = async () => {
    const url = urlInput.trim();
    if (!url) return message.warning("请输入商品链接");
    if (!/temu\.com/i.test(url)) return message.warning("请输入 Temu 商品链接");
    if (tracked.some((item) => item.url === url)) return message.warning("该商品已在跟踪池中");
    if (!competitor) return message.error("当前竞品分析功能暂时不可用，请稍后再试");

    setLoading(true);
    try {
      const snapshot = await competitor.track({ url });
      const item: TrackedProduct = {
        url,
        title: snapshot.title,
        snapshots: [snapshot],
        addedAt: new Date().toISOString(),
      };
      await saveTracked([item, ...tracked]);
      setUrlInput("");
      message.success(`已加入跟踪：${snapshot.title}`);
    } catch (error: any) {
      message.error(error?.message || "抓取失败");
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshAll = async () => {
    if (tracked.length === 0) return;
    if (!competitor) return message.error("当前竞品分析功能暂时不可用，请稍后再试");
    setRefreshing(true);
    try {
      const response = await competitor.batchTrack({ urls: tracked.map((item) => item.url) });
      const updated = tracked.map((item) => {
        const nextSnapshot = response.results.find((result: any) => result.url === item.url);
        if (nextSnapshot && !nextSnapshot.error) {
          return {
            ...item,
            title: nextSnapshot.title || item.title,
            snapshots: [...item.snapshots, nextSnapshot].slice(-30),
          };
        }
        return item;
      });
      await saveTracked(updated);
      message.success(`刷新完成：${response.success}/${response.total} 成功`);
    } catch (error: any) {
      message.error(error?.message || "批量刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

  const handleDelete = async (url: string) => {
    await saveTracked(tracked.filter((item) => item.url !== url));
    if (selectedUrl === url) setSelectedUrl(null);
    message.success("已移除");
  };

  const trackedRows = useMemo(() => {
    const latestSnapshots = tracked.map((item) => getLatestSnapshot(item)).filter(Boolean);
    return tracked.map((item) => {
      const latest = getLatestSnapshot(item);
      const previous = item.snapshots[item.snapshots.length - 2] || null;
      const signal = latest ? buildTrackedSignals(latest, latestSnapshots) : null;
      return {
        ...item,
        latest,
        previous,
        signal,
        priceChange: latest && previous ? toSafeNumber(latest.price) - toSafeNumber(previous.price) : 0,
        monthlySalesChange: latest && previous ? toSafeNumber(latest.monthlySales) - toSafeNumber(previous.monthlySales) : 0,
      };
    }).filter((item) => item.latest);
  }, [tracked]);

  const selectedTracked = tracked.find((item) => item.url === selectedUrl) || null;
  const selectedTrackedRow = trackedRows.find((item) => item.url === selectedUrl) || null;
  const trendData = selectedTracked?.snapshots?.map((snapshot: any) => ({
    time: new Date(snapshot.scrapedAt || Date.now()).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }),
    price: toSafeNumber(snapshot.price),
    monthlySales: toSafeNumber(snapshot.monthlySales),
  })) || [];

  const p0Count = trackedRows.filter((item) => item.signal?.priority === "P0").length;
  const videoDrivers = trackedRows.filter((item) => item.signal?.tags.includes("视频驱动型")).length;
  const trustDrivers = trackedRows.filter((item) => item.signal?.tags.includes("高评分信任型")).length;
  const campaignDrivers = trackedRows.filter((item) => item.signal?.tags.includes("活动投流型")).length;
  const monitorRows = trackedRows.filter((item) => item.signal?.priority === "P0" || Math.abs(item.priceChange) > 0 || Math.abs(item.monthlySalesChange) > 0).slice(0, 8);

  const columns = [
    {
      title: "竞品",
      dataIndex: "title",
      key: "title",
      ellipsis: true,
      render: (_: any, record: any) => (
        <Space direction="vertical" size={0}>
          <Text ellipsis style={{ maxWidth: 260 }}>{record.title || record.url}</Text>
          <Space size={4} wrap>
            {record.sourceKeyword ? <Tag color="blue">{record.sourceKeyword}</Tag> : null}
            {record.signal?.priority ? <Tag color={record.signal.priority === "P0" ? "red" : record.signal.priority === "P1" ? "orange" : "default"}>{record.signal.priority}</Tag> : null}
          </Space>
        </Space>
      ),
    },
    {
      title: "当前价格",
      key: "price",
      width: 120,
      render: (_: any, record: any) => <Text strong style={{ color: TEMU_ORANGE }}>${toSafeNumber(record.latest?.price).toFixed(2)}</Text>,
    },
    {
      title: "月销",
      key: "monthlySales",
      width: 90,
      render: (_: any, record: any) => toSafeNumber(record.latest?.monthlySales).toLocaleString(),
    },
    {
      title: "标签",
      key: "tags",
      width: 220,
      render: (_: any, record: any) => (
        <Space wrap size={[4, 4]}>
          {(record.signal?.tags || []).map((tag: string) => <Tag key={tag} color="orange">{tag}</Tag>)}
        </Space>
      ),
    },
    {
      title: "流量来源",
      key: "trafficSource",
      width: 110,
      render: (_: any, record: any) => record.signal?.trafficSource || "-",
    },
    {
      title: "我方动作",
      key: "responseAction",
      ellipsis: true,
      render: (_: any, record: any) => <Tooltip title={record.signal?.responseAction}><Text ellipsis style={{ maxWidth: 220 }}>{record.signal?.responseAction || "-"}</Text></Tooltip>,
    },
    {
      title: "操作",
      key: "action",
      width: 150,
      render: (_: any, record: any) => (
        <Space>
          <Button size="small" icon={<LineChartOutlined />} onClick={() => setSelectedUrl(record.url)}>趋势</Button>
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => setDetailItem(record.latest)}>详情</Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void handleDelete(record.url)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card style={CARD_STYLE}>
        <Space wrap>
          <Input
            prefix={<LinkOutlined />}
            placeholder="粘贴 Temu 商品链接，如 https://www.temu.com/..."
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            onPressEnter={handleAdd}
            style={{ width: 500 }}
            allowClear
          />
          <Button type="primary" icon={<PlusOutlined />} loading={loading} onClick={handleAdd}
            style={{ background: TEMU_ORANGE, borderColor: TEMU_ORANGE }}>
            添加跟踪
          </Button>
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={handleRefreshAll} disabled={tracked.length === 0}>
            刷新全部
          </Button>
        </Space>
      </Card>

      <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
        <Col span={6}><Card style={CARD_STYLE} size="small"><Statistic title="跟踪竞品" value={trackedRows.length} /></Card></Col>
        <Col span={6}><Card style={CARD_STYLE} size="small"><Statistic title="P0 重点盯盘" value={p0Count} valueStyle={{ color: "#ea4335" }} /></Card></Col>
        <Col span={6}><Card style={CARD_STYLE} size="small"><Statistic title="视频驱动型" value={videoDrivers} valueStyle={{ color: "#722ed1" }} /></Card></Col>
        <Col span={6}><Card style={CARD_STYLE} size="small"><Statistic title="高评分信任型" value={trustDrivers} valueStyle={{ color: "#1a73e8" }} /></Card></Col>
        <Col span={6}><Card style={CARD_STYLE} size="small"><Statistic title="活动投流型" value={campaignDrivers} valueStyle={{ color: TEMU_ORANGE }} /></Card></Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={16}>
          <Card title={`跟踪列表 (${trackedRows.length})`} style={CARD_STYLE} size="small">
            {trackedRows.length === 0 ? (
              <Empty description="暂无跟踪商品，请先从搜索结果或商品链接加入竞品池" />
            ) : (
              <Table
                dataSource={trackedRows}
                columns={columns}
                rowKey="url"
                size="small"
                pagination={false}
                scroll={{ x: 1220 }}
              />
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card title="今日盯盘重点" style={CARD_STYLE} size="small">
            {monitorRows.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先刷新一次竞品池，再生成盯盘重点" />
            ) : (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                {monitorRows.map((row) => (
                  <Card key={row.url} size="small" bodyStyle={{ padding: 12 }} onClick={() => setSelectedUrl(row.url)} style={{ cursor: "pointer" }}>
                    <Space direction="vertical" size={4} style={{ width: "100%" }}>
                      <Text strong ellipsis>{row.title || row.url}</Text>
                      <Space wrap size={[4, 4]}>
                        {(row.signal?.tags || []).slice(0, 2).map((tag: string) => <Tag key={tag} color="orange">{tag}</Tag>)}
                      </Space>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {row.priceChange !== 0 ? `价格变化 $${row.priceChange.toFixed(2)} · ` : ""}
                        {row.monthlySalesChange !== 0 ? `月销变化 ${row.monthlySalesChange}` : "继续观察素材和活动动作"}
                      </Text>
                    </Space>
                  </Card>
                ))}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      {selectedTrackedRow && trendData.length > 0 ? (
        <Card
          title={`竞品趋势 - ${selectedTrackedRow.title || "未命名竞品"}`}
          style={{ ...CARD_STYLE, marginTop: 16 }}
          size="small"
          extra={<Button size="small" onClick={() => setSelectedUrl(null)}>关闭</Button>}
        >
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              type={selectedTrackedRow.signal?.priority === "P0" ? "warning" : "info"}
              showIcon
              message={`${selectedTrackedRow.signal?.trafficSource || "自然搜索"} · ${selectedTrackedRow.signal?.winningHook || "标题卖点承接"}`}
              description={selectedTrackedRow.signal?.responseAction || "继续跟踪价格、销量和素材变化。"}
            />
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" fontSize={11} />
                <YAxis yAxisId="price" fontSize={11} domain={["auto", "auto"]} />
                <YAxis yAxisId="monthlySales" orientation="right" fontSize={11} domain={["auto", "auto"]} />
                <RTooltip />
                <Line yAxisId="price" type="monotone" dataKey="price" stroke={TEMU_ORANGE} strokeWidth={2} name="价格 ($)" />
                <Line yAxisId="monthlySales" type="monotone" dataKey="monthlySales" stroke="#1a73e8" strokeWidth={2} name="月销" />
              </LineChart>
            </ResponsiveContainer>
          </Space>
        </Card>
      ) : null}

      <ProductDetailDrawer item={detailItem} open={!!detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}

function CompetitorReportTab() {
  const [tracked, setTracked] = useState<TrackedProduct[]>([]);
  const [myProducts, setMyProducts] = useState<any[]>([]);
  const [selectedMy, setSelectedMy] = useState<string | null>(null);
  const [selectedCompetitors, setSelectedCompetitors] = useState<string[]>([]);
  const [report, setReport] = useState<ExecutionReport | null>(null);
  const [savedReports, setSavedReports] = useState<ExecutionReport[]>([]);
  const [generating, setGenerating] = useState(false);

  const loadTracked = useCallback(async () => {
    const data = await readArrayStoreValue("temu_competitor_tracked");
    setTracked(data as TrackedProduct[]);
  }, []);

  const loadReports = useCallback(async () => {
    const data = await readArrayStoreValue("temu_competitor_reports");
    setSavedReports((data as any[]).filter((item) => item && typeof item === "object" && Array.isArray(item.comparisonRows)));
  }, []);

  useEffect(() => {
    void loadTracked();
    void loadReports();
    store?.get("temu_products").then((data: any) => {
      if (data?.products && Array.isArray(data.products)) {
        setMyProducts(data.products.slice(0, 100));
      } else if (Array.isArray(data)) {
        setMyProducts(data.slice(0, 100));
      }
    });

    const trackedListener = () => { void loadTracked(); };
    const reportListener = () => { void loadReports(); };
    window.addEventListener(COMPETITOR_TRACKED_UPDATED_EVENT, trackedListener);
    window.addEventListener(COMPETITOR_REPORTS_UPDATED_EVENT, reportListener);
    return () => {
      window.removeEventListener(COMPETITOR_TRACKED_UPDATED_EVENT, trackedListener);
      window.removeEventListener(COMPETITOR_REPORTS_UPDATED_EVENT, reportListener);
    };
  }, [loadReports, loadTracked]);

  const myProductOptions = useMemo(() => {
    return myProducts.map((item) => {
      const normalized = normalizeMyProduct(item);
      return {
        value: normalized.id,
        label: normalized.title,
        raw: item,
        normalized,
      };
    }).filter((item) => item.value && item.label);
  }, [myProducts]);

  const trackedOptions = useMemo(() => {
    return tracked.map((item) => {
      const latest = getLatestSnapshot(item);
      return {
        value: item.url,
        label: item.title || latest?.title || item.url,
        sourceKeyword: item.sourceKeyword,
      };
    });
  }, [tracked]);

  const handleGenerate = async () => {
    if (!selectedMy) return message.warning("请选择你的商品");
    if (selectedCompetitors.length === 0) return message.warning("请选择至少 1 个竞品");

    const myProductMatch = myProductOptions.find((option) => option.value === selectedMy);
    const selectedTrackedItems = tracked.filter((item) => selectedCompetitors.includes(item.url));
    const competitors = selectedTrackedItems.map((item) => getLatestSnapshot(item)).filter(Boolean);

    if (!myProductMatch || competitors.length === 0) return message.warning("数据不完整");

    setGenerating(true);
    try {
      const myProduct = myProductMatch.normalized;
      const keywordSeed = selectedTrackedItems.map((item) => item.sourceKeyword).find(Boolean) || myProduct.title;
      const marketInsight = buildMarketInsight(keywordSeed, competitors, 0);
      const nextReport = buildExecutionReport(myProduct, competitors, marketInsight);
      setReport(nextReport);
      const updatedReports = [nextReport, ...savedReports.filter((item) => item.id !== nextReport.id)].slice(0, MAX_COMPETITOR_REPORTS);
      setSavedReports(updatedReports);
      await store?.set("temu_competitor_reports", updatedReports);
      emitCompetitorReportsUpdated();
      message.success("竞品分析报告已生成");
    } catch (error: any) {
      message.error(error?.message || "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const comparisonColumns = [
    {
      title: "竞品",
      dataIndex: "competitorTitle",
      key: "competitorTitle",
      width: 260,
      render: (value: string, record: ComparisonRow) => (
        <Space direction="vertical" size={0}>
          <Paragraph ellipsis={{ rows: 2, tooltip: value }} style={{ marginBottom: 0, lineHeight: 1.5 }}>
            {value}
          </Paragraph>
          <Text type="secondary" style={{ fontSize: 13 }}>{record.goodsId || record.competitorUrl || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "价格",
      dataIndex: "currentPrice",
      key: "currentPrice",
      width: 130,
      render: (value: string) => <Text strong style={{ color: TEMU_ORANGE }}>{value}</Text>,
    },
    { title: "日销", dataIndex: "dailySales", key: "dailySales", width: 80 },
    { title: "周销", dataIndex: "weeklySales", key: "weeklySales", width: 80 },
    { title: "月销", dataIndex: "monthlySales", key: "monthlySales", width: 90 },
    {
      title: "评分 / 评论",
      key: "rating",
      width: 120,
      render: (_: any, record: ComparisonRow) => <Text>{record.score || "-"} / {record.reviewCount || "-"}</Text>,
    },
    {
      title: "首图 / 转化钩子",
      dataIndex: "winningHook",
      key: "winningHook",
      width: 210,
      render: (value: string) => (
        <Paragraph style={{ marginBottom: 0, lineHeight: 1.5 }}>
          {value || "-"}
        </Paragraph>
      ),
    },
    {
      title: "视频",
      dataIndex: "hasVideo",
      key: "hasVideo",
      width: 70,
      render: (value: boolean) => value ? <Tag color="purple">有</Tag> : <Tag>无</Tag>,
    },
    {
      title: "卖点标签",
      dataIndex: "tags",
      key: "tags",
      width: 200,
      render: (value: string) => (
        <Paragraph style={{ marginBottom: 0, lineHeight: 1.5 }}>
          {value || "-"}
        </Paragraph>
      ),
    },
    {
      title: "短板 / 风险",
      dataIndex: "weakness",
      key: "weakness",
      width: 220,
      render: (value: string) => (
        <Paragraph style={{ marginBottom: 0, lineHeight: 1.5 }}>
          {value || "-"}
        </Paragraph>
      ),
    },
    { title: "预计流量来源", dataIndex: "trafficSource", key: "trafficSource", width: 110 },
    {
      title: "我方差距",
      dataIndex: "gap",
      key: "gap",
      width: 220,
      render: (value: string) => (
        <Paragraph style={{ marginBottom: 0, lineHeight: 1.5 }}>
          {value || "-"}
        </Paragraph>
      ),
    },
    {
      title: "应对动作",
      dataIndex: "responseAction",
      key: "responseAction",
      width: 260,
      render: (value: string) => (
        <Paragraph style={{ marginBottom: 0, lineHeight: 1.5 }}>
          {value || "-"}
        </Paragraph>
      ),
    },
    {
      title: "优先级",
      dataIndex: "priority",
      key: "priority",
      width: 90,
      render: (value: string) => <Tag color={value === "P0" ? "red" : value === "P1" ? "orange" : "default"}>{value}</Tag>,
    },
  ];

  return (
    <div>
      <Card style={CARD_STYLE}>
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Alert
            type={selectedCompetitors.length >= 3 && selectedCompetitors.length <= 5 ? "success" : "info"}
            showIcon
            message="建议按 3-5 个真实可比竞品出报告"
            description="优先选同价格带、同履约模式、同目标人群的竞品，报告结论更适合直接指导价格、图片和选品动作。"
          />
          <div>
            <Text strong>选择你的商品</Text>
            <Select
              showSearch
              placeholder="搜索并选择你的商品"
              value={selectedMy}
              onChange={setSelectedMy}
              style={{ width: "100%", marginTop: 8 }}
              filterOption={(input, option) => (option?.label as string || "").toLowerCase().includes(input.toLowerCase())}
              options={myProductOptions.map((option) => ({ value: option.value, label: option.label }))}
            />
          </div>
          <div>
            <Text strong>选择竞品（可多选）</Text>
            <Select
              mode="multiple"
              placeholder="从竞品跟踪池中选择 3-5 个可比对象"
              value={selectedCompetitors}
              onChange={setSelectedCompetitors}
              style={{ width: "100%", marginTop: 8 }}
              options={trackedOptions.map((option) => ({
                value: option.value,
                label: option.sourceKeyword ? `${option.label} · ${option.sourceKeyword}` : option.label,
              }))}
            />
          </div>
          <Button type="primary" icon={<FileTextOutlined />} loading={generating} onClick={handleGenerate}
            style={{ background: TEMU_ORANGE, borderColor: TEMU_ORANGE }}
            disabled={!selectedMy || selectedCompetitors.length === 0}>
            生成执行报告
          </Button>
        </Space>
      </Card>

      {report ? (
        <>
          <Alert
            style={{ marginTop: 16, borderRadius: 14 }}
            type={report.summary.canCompete.includes("不建议") ? "warning" : report.summary.canCompete.includes("可以") ? "success" : "info"}
            showIcon
            message={report.summary.canCompete}
            description={`关键词判断：${report.summary.keywordDecision}`}
          />

          <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
            <Col span={6}><Card style={CARD_STYLE} size="small"><Statistic title="本次报告竞品数" value={report.competitorCount} /></Card></Col>
            <Col span={6}><Card style={CARD_STYLE} size="small"><Statistic title="市场机会分" value={report.marketInsight.opportunityScore} suffix="/100" valueStyle={{ color: TEMU_ORANGE }} /></Card></Col>
            <Col span={6}><Card style={CARD_STYLE} size="small"><Statistic title="推荐价格带" value={report.marketInsight.recommendedPriceBand} valueStyle={{ fontSize: 18 }} /></Card></Col>
            <Col span={6}><Card style={CARD_STYLE} size="small"><Statistic title="核心关注点" value={report.marketInsight.primaryNeed} valueStyle={{ fontSize: 18 }} /></Card></Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={8}>
              <Card title="我能不能做" style={CARD_STYLE} size="small">
                <Paragraph style={{ marginBottom: 0 }}>{report.summary.canCompete}</Paragraph>
              </Card>
            </Col>
            <Col span={8}>
              <Card title="我靠什么赢" style={CARD_STYLE} size="small">
                <Paragraph style={{ marginBottom: 0 }}>{report.summary.winAngle}</Paragraph>
              </Card>
            </Col>
            <Col span={8}>
              <Card title="我现在最该改什么" style={CARD_STYLE} size="small">
                <Paragraph style={{ marginBottom: 0 }}>{report.summary.immediateFocus}</Paragraph>
              </Card>
            </Col>
          </Row>

          <Card title="竞品对比表" style={{ ...CARD_STYLE, marginTop: 16 }} size="small">
            <Table
              dataSource={report.comparisonRows}
              columns={comparisonColumns}
              rowKey="key"
              size="small"
              scroll={{ x: 2100 }}
              pagination={{ defaultPageSize: 6, showSizeChanger: true }}
            />
          </Card>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={8}>
              <Card title="A. 立刻改" style={CARD_STYLE} size="small">
                <List size="small" dataSource={report.immediateActions} renderItem={(item) => <List.Item>{item}</List.Item>} />
              </Card>
            </Col>
            <Col span={8}>
              <Card title="B. 一周内验证" style={CARD_STYLE} size="small">
                <List size="small" dataSource={report.weeklyActions} renderItem={(item) => <List.Item>{item}</List.Item>} />
              </Card>
            </Col>
            <Col span={8}>
              <Card title="C. 选品 / 供应链决策" style={CARD_STYLE} size="small">
                <List size="small" dataSource={report.sourcingActions} renderItem={(item) => <List.Item>{item}</List.Item>} />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={8}>
              <Card title="为什么别人卖得更快" style={CARD_STYLE} size="small">
                <List size="small" dataSource={report.whyCompetitorsWin} renderItem={(item) => <List.Item>{item}</List.Item>} />
              </Card>
            </Col>
            <Col span={8}>
              <Card title="这个词还能不能打" style={CARD_STYLE} size="small">
                <Paragraph style={{ marginBottom: 0 }}>{report.summary.keywordDecision}</Paragraph>
              </Card>
            </Col>
            <Col span={8}>
              <Card title="下一批该上什么货" style={CARD_STYLE} size="small">
                <Paragraph style={{ marginBottom: 0 }}>{report.summary.nextProductDirection}</Paragraph>
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={8}>
              <Card title="日常盯盘" style={CARD_STYLE} size="small">
                <List size="small" dataSource={report.dailyChecklist} renderItem={(item) => <List.Item>{item}</List.Item>} />
              </Card>
            </Col>
            <Col span={8}>
              <Card title="每周复盘" style={CARD_STYLE} size="small">
                <List size="small" dataSource={report.weeklyChecklist} renderItem={(item) => <List.Item>{item}</List.Item>} />
              </Card>
            </Col>
            <Col span={8}>
              <Card title="每月调整" style={CARD_STYLE} size="small">
                <List size="small" dataSource={report.monthlyChecklist} renderItem={(item) => <List.Item>{item}</List.Item>} />
              </Card>
            </Col>
          </Row>
        </>
      ) : null}

      <Card title={`历史报告 (${savedReports.length})`} style={{ ...CARD_STYLE, marginTop: 16 }} size="small">
        {savedReports.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="生成后会自动保存最近 20 份执行报告" />
        ) : (
          <Table
            dataSource={savedReports}
            rowKey="id"
            size="small"
            pagination={false}
            columns={[
              { title: "生成时间", dataIndex: "generatedAt", key: "generatedAt", width: 180, render: (value: string) => new Date(value).toLocaleString("zh-CN") },
              { title: "商品", dataIndex: "myProductTitle", key: "myProductTitle" },
              { title: "市场判断", dataIndex: ["marketInsight", "marketVerdict"], key: "marketVerdict", width: 120 },
              { title: "推荐价格带", dataIndex: ["marketInsight", "recommendedPriceBand"], key: "recommendedPriceBand", width: 150 },
              { title: "竞品数", dataIndex: "competitorCount", key: "competitorCount", width: 90 },
              {
                title: "操作",
                key: "action",
                width: 90,
                render: (_: any, record: ExecutionReport) => <Button size="small" onClick={() => setReport(record)}>打开</Button>,
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}

function YunqiDbTab() {
  const [dbInfo, setDbInfo] = useState<{ dbPath: string; rowCount: number } | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncKeywords, setSyncKeywords] = useState("");
  const [searchParams, setSearchParams] = useState({
    keyword: "",
    mallName: "",
    mallMode: "",
    category: "",
    minPrice: undefined as number | undefined,
    maxPrice: undefined as number | undefined,
    sortBy: "daily_sales",
    sortOrder: "DESC",
    page: 1,
    pageSize: 50,
  });
  const [searchResult, setSearchResult] = useState<any>(null);
  const [detailItem, setDetailItem] = useState<any>(null);

  const loadDbInfo = useCallback(async () => {
    try {
      const info = await yunqiDb?.info();
      if (info) {
        setDbInfo(info);
        if (info.rowCount > 0) {
          const nextStats = await yunqiDb?.stats();
          if (nextStats) setStats(nextStats);
        }
      }
    } catch (error) {
      // 云启数据库未初始化 / 未连接时正常失败，下次调用会重试
      console.warn("[CompetitorAnalysis] loadDbInfo failed", error);
    }
  }, []);

  useEffect(() => {
    void loadDbInfo();
  }, [loadDbInfo]);

  const handleImport = async () => {
    const filePath = await window.electronAPI?.selectFile?.([{ name: "Excel/CSV", extensions: ["xlsx", "xls", "csv"] }]);
    if (!filePath) return;
    setImporting(true);
    try {
      const result = await yunqiDb?.import({ filePath });
      message.success(`导入完成：${result?.imported} 条成功，${result?.skipped} 条跳过`);
      await loadDbInfo();
    } catch (error: any) {
      message.error(error?.message || "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const handleSyncOnline = async () => {
    const keywords = syncKeywords.split(/[,，\n]/).map((k) => k.trim()).filter(Boolean);
    if (keywords.length === 0) return message.warning("请输入至少一个关键词（逗号或换行分隔）");
    if (!yunqiDb) return message.error("数据库功能暂不可用");
    setSyncing(true);
    try {
      const result = await yunqiDb.syncOnline({ keywords, maxPages: 5 });
      const details = result.results.map((r: any) => `「${r.keyword}」${r.imported}条`).join("，");
      message.success(`同步完成：共导入 ${result.totalImported} 条。${details}`);
      await loadDbInfo();
    } catch (error: any) {
      const msg = String(error?.message || "");
      if (msg.includes("YUNQI_AUTH_INVALID")) {
        message.error("云启 Token 已过期，请先在上方「在线搜索」标签页登录云启");
      } else {
        message.error(msg || "同步失败");
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleSearch = async (page = 1) => {
    if (!yunqiDb) return message.error("当前数据库功能暂时不可用，请稍后再试");
    setSearching(true);
    try {
      const params: any = { ...searchParams, page };
      Object.keys(params).forEach((key) => {
        if (params[key] === undefined || params[key] === "") delete params[key];
      });
      const result = await yunqiDb.search(params);
      setSearchResult(result);
      setSearchParams((prev) => ({ ...prev, page }));
    } catch (error: any) {
      message.error(error?.message || "搜索失败");
    } finally {
      setSearching(false);
    }
  };

  const dbColumns = [
    {
      title: "图片",
      dataIndex: "main_image",
      key: "img",
      width: 60,
      render: (url: string) => url ? <Image src={url} width={56} height={56} style={{ objectFit: "cover", borderRadius: 8 }} preview={false} fallback="data:image/svg+xml,<svg/>" /> : "-",
    },
    {
      title: "商品",
      dataIndex: "title_zh",
      key: "title",
      width: 260,
      render: (value: string, record: any) => (
        <Space direction="vertical" size={0}>
          <Paragraph ellipsis={{ rows: 2, tooltip: value }} style={{ fontSize: 14, marginBottom: 0, lineHeight: 1.6 }}>
            {value}
          </Paragraph>
          <Space size={4}>
            {record.mall_name ? <Text type="secondary" style={{ fontSize: 12 }}><ShopOutlined /> {record.mall_name}</Text> : null}
            <Tag style={{ fontSize: 11 }}>{record.mall_mode || "未知"}</Tag>
          </Space>
        </Space>
      ),
    },
    {
      title: "价格($)",
      dataIndex: "usd_price",
      key: "price",
      width: 90,
      render: (value: number) => <Text strong style={{ color: TEMU_ORANGE }}>${toSafeNumber(value).toFixed(2)}</Text>,
    },
    {
      title: "日销",
      dataIndex: "daily_sales",
      key: "daily_sales",
      width: 80,
      render: (value: number) => value > 0 ? <Text style={{ color: "#ea4335" }}>{value.toLocaleString()}</Text> : <Text type="secondary">0</Text>,
    },
    {
      title: "周销",
      dataIndex: "weekly_sales",
      key: "weekly_sales",
      width: 80,
      render: (value: number) => value > 0 ? <Text style={{ color: "#fbbc04" }}>{value.toLocaleString()}</Text> : <Text type="secondary">0</Text>,
    },
    {
      title: "月销",
      dataIndex: "monthly_sales",
      key: "monthly_sales",
      width: 80,
      render: (value: number) => value > 0 ? <Text style={{ color: "#1a73e8" }}>{value.toLocaleString()}</Text> : <Text type="secondary">0</Text>,
    },
    {
      title: "评分",
      dataIndex: "score",
      key: "score",
      width: 70,
      render: (value: number) => value ? <><StarOutlined style={{ color: "#faad14", fontSize: 12 }} /> {value}</> : "-",
    },
    {
      title: "评论",
      dataIndex: "total_comments",
      key: "total_comments",
      width: 80,
      render: (value: number) => value > 0 ? value.toLocaleString() : "-",
    },
    {
      title: "动作",
      key: "action",
      width: 90,
      render: (_: any, record: any) => <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => setDetailItem(record)}>详情</Button>,
    },
  ];

  return (
    <div>
      <Card style={CARD_STYLE}>
        <Space style={{ width: "100%", justifyContent: "space-between", flexWrap: "wrap" }}>
          <Space>
            <Button type="primary" icon={<PlusOutlined />} loading={importing} onClick={handleImport}
              style={{ background: TEMU_ORANGE, borderColor: TEMU_ORANGE }}>
              导入 Excel
            </Button>
            <Input.Search
              placeholder="输入关键词一键同步（逗号分隔多个）"
              value={syncKeywords}
              onChange={(e) => setSyncKeywords(e.target.value)}
              onSearch={() => void handleSyncOnline()}
              enterButton={<Button type="primary" loading={syncing} icon={<ReloadOutlined />}>一键同步</Button>}
              loading={syncing}
              style={{ width: 360 }}
              allowClear
            />
          </Space>
          <Space>
            {dbInfo ? <Tag color={dbInfo.rowCount > 0 ? "green" : "default"}>数据库：{dbInfo.rowCount.toLocaleString()} 条商品</Tag> : null}
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadDbInfo()}>刷新</Button>
          </Space>
        </Space>
      </Card>

      {stats ? (
        <Row gutter={[12, 12]} style={{ marginTop: 16 }}>
          <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="商品总数" value={stats.totalProducts} valueStyle={{ fontSize: 16 }} /></Card></Col>
          <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="店铺数" value={stats.totalMalls} valueStyle={{ fontSize: 16 }} /></Card></Col>
          <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="均价" value={stats.avgPrice} prefix="$" valueStyle={{ fontSize: 16 }} /></Card></Col>
          <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="日销总量" value={stats.totalDailySales} valueStyle={{ fontSize: 16, color: "#ea4335" }} /></Card></Col>
          <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="月销总量" value={stats.totalMonthlySales} valueStyle={{ fontSize: 16, color: "#1a73e8" }} /></Card></Col>
          <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="总 GMV" value={stats.totalGmv} prefix="$" valueStyle={{ fontSize: 16 }} /></Card></Col>
          <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="平均评分" value={stats.avgScore} valueStyle={{ fontSize: 16 }} /></Card></Col>
          <Col span={3}><Card style={CARD_STYLE} size="small"><Statistic title="有视频" value={stats.withVideo} suffix={`/${stats.totalProducts}`} valueStyle={{ fontSize: 16 }} /></Card></Col>
        </Row>
      ) : null}

      {stats?.categories?.length > 0 ? (
        <Card title="TOP 类目" size="small" style={{ ...CARD_STYLE, marginTop: 16 }}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.categories} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={11} />
              <YAxis dataKey="category_zh" type="category" width={140} fontSize={10} tick={{ width: 135 }} />
              <RTooltip />
              <Bar dataKey="count" name="商品数" fill={TEMU_ORANGE} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      ) : null}

      <Card title="数据库搜索" size="small" style={{ ...CARD_STYLE, marginTop: 16 }}>
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Row gutter={12}>
            <Col span={6}>
              <Input
                prefix={<SearchOutlined />}
                placeholder="商品关键词"
                value={searchParams.keyword}
                onChange={(event) => setSearchParams((prev) => ({ ...prev, keyword: event.target.value }))}
                onPressEnter={() => void handleSearch(1)}
                allowClear
              />
            </Col>
            <Col span={4}>
              <Input
                prefix={<ShopOutlined />}
                placeholder="店铺名"
                value={searchParams.mallName}
                onChange={(event) => setSearchParams((prev) => ({ ...prev, mallName: event.target.value }))}
                allowClear
              />
            </Col>
            <Col span={3}>
              <Select
                value={searchParams.mallMode}
                onChange={(value) => setSearchParams((prev) => ({ ...prev, mallMode: value }))}
                style={{ width: "100%" }}
                allowClear
                placeholder="履约模式"
                options={[{ value: "全托", label: "全托管" }, { value: "半托", label: "半托管" }]}
              />
            </Col>
            <Col span={4}>
              <Input
                placeholder="类目关键词"
                value={searchParams.category}
                onChange={(event) => setSearchParams((prev) => ({ ...prev, category: event.target.value }))}
                allowClear
              />
            </Col>
            <Col span={3}>
              <Space.Compact style={{ width: "100%" }}>
                <Input
                  placeholder="最低价"
                  type="number"
                  value={searchParams.minPrice}
                  onChange={(event) => setSearchParams((prev) => ({ ...prev, minPrice: event.target.value ? Number(event.target.value) : undefined }))}
                />
                <Input
                  placeholder="最高价"
                  type="number"
                  value={searchParams.maxPrice}
                  onChange={(event) => setSearchParams((prev) => ({ ...prev, maxPrice: event.target.value ? Number(event.target.value) : undefined }))}
                />
              </Space.Compact>
            </Col>
            <Col span={4}>
              <Space>
                <Select
                  value={searchParams.sortBy}
                  onChange={(value) => setSearchParams((prev) => ({ ...prev, sortBy: value }))}
                  style={{ width: 110 }}
                  options={DB_SORT_OPTIONS}
                />
                <Select
                  value={searchParams.sortOrder}
                  onChange={(value) => setSearchParams((prev) => ({ ...prev, sortOrder: value }))}
                  style={{ width: 80 }}
                  options={[{ value: "DESC", label: "降序" }, { value: "ASC", label: "升序" }]}
                />
              </Space>
            </Col>
          </Row>
          <Space>
            <Button type="primary" icon={<SearchOutlined />} loading={searching} onClick={() => void handleSearch(1)}
              style={{ background: TEMU_ORANGE, borderColor: TEMU_ORANGE }}>
              搜索数据库
            </Button>
            <Button onClick={() => setSearchParams({ keyword: "", mallName: "", mallMode: "", category: "", minPrice: undefined, maxPrice: undefined, sortBy: "daily_sales", sortOrder: "DESC", page: 1, pageSize: 50 })}>
              重置
            </Button>
          </Space>
        </Space>
      </Card>

      {searchResult ? (
        <Card title={`搜索结果 (${searchResult.total.toLocaleString()} 条)`} size="small" style={{ ...CARD_STYLE, marginTop: 16 }}>
          <Table
            dataSource={searchResult.items}
            columns={dbColumns}
            rowKey="id"
            size="small"
            scroll={{ x: 1080 }}
            pagination={{
              current: searchResult.page,
              pageSize: searchResult.pageSize,
              total: searchResult.total,
              showTotal: (total: number) => `共 ${total.toLocaleString()} 条`,
              showSizeChanger: true,
              onChange: (page, pageSize) => {
                setSearchParams((prev) => ({ ...prev, pageSize: pageSize || 50 }));
                void handleSearch(page);
              },
            }}
          />
        </Card>
      ) : null}

      {stats?.importHistory?.length > 0 ? (
        <Card title="导入历史" size="small" style={{ ...CARD_STYLE, marginTop: 16 }}>
          <Table
            dataSource={stats.importHistory}
            rowKey="id"
            size="small"
            pagination={false}
            columns={[
              { title: "文件", dataIndex: "file_name", key: "file_name" },
              { title: "总行数", dataIndex: "total_rows", key: "total_rows", render: (value: number) => value.toLocaleString() },
              { title: "成功", dataIndex: "imported_rows", key: "imported_rows", render: (value: number) => <Text style={{ color: "#52c41a" }}>{value.toLocaleString()}</Text> },
              { title: "跳过", dataIndex: "skipped_rows", key: "skipped_rows" },
              { title: "导入时间", dataIndex: "imported_at", key: "imported_at" },
            ]}
          />
        </Card>
      ) : null}

      <ProductDetailDrawer item={detailItem} open={!!detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}

export default function CompetitorAnalysis() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState("product_v2");
  const [productWorkbenchStepState, setProductWorkbenchStepState] = useState<ProductWorkbenchStepState | null>(null);
  const [productWorkbenchActiveStep, setProductWorkbenchActiveStep] = useState(0);
  const [savedYunqiToken, setSavedYunqiToken] = useState("");
  const [draftYunqiToken, setDraftYunqiToken] = useState("");
  const [yunqiTokenStatus, setYunqiTokenStatus] = useState<YunqiTokenStatus>("empty");
  const [yunqiTokenLoading, setYunqiTokenLoading] = useState(true);
  const [yunqiTokenSaving, setYunqiTokenSaving] = useState(false);
  const [yunqiTokenFetching, setYunqiTokenFetching] = useState(false);
  const [yunqiTokenEditing, setYunqiTokenEditing] = useState(false);
  const routePrefillProduct = useMemo<CompetitorProductPrefill | null>(() => {
    const state = (location.state as { prefillProduct?: CompetitorProductPrefill | null } | null) ?? null;
    if (!state?.prefillProduct || typeof state.prefillProduct !== "object") return null;
    return state.prefillProduct;
  }, [location.state]);

  const handleProductWorkbenchStepStateChange = useCallback((nextState: ProductWorkbenchStepState) => {
    setProductWorkbenchStepState((prevState) => {
      if (!prevState) return nextState;
      const sameStepItems =
        prevState.stepItems.length === nextState.stepItems.length &&
        prevState.stepItems.every((item, index) => {
          const nextItem = nextState.stepItems[index];
          return (
            nextItem &&
            item.key === nextItem.key &&
            item.title === nextItem.title &&
            item.desc === nextItem.desc &&
            item.enabled === nextItem.enabled &&
            item.completed === nextItem.completed
          );
        });

      if (
        prevState.activeStep === nextState.activeStep &&
        prevState.nextStepTarget === nextState.nextStepTarget &&
        prevState.nextStepLabel === nextState.nextStepLabel &&
        prevState.canGoNext === nextState.canGoNext &&
        prevState.currentStepMeta.key === nextState.currentStepMeta.key &&
        sameStepItems
      ) {
        return prevState;
      }

      return nextState;
    });
  }, []);

  useEffect(() => {
    if (!routePrefillProduct) return;
    setActiveTab("product_v2");
    if (typeof routePrefillProduct.activateStep === "number") {
      setProductWorkbenchActiveStep(routePrefillProduct.activateStep);
    }
  }, [routePrefillProduct?.token, routePrefillProduct?.activateStep]);

  const autoLoginTriggeredRef = useRef(false);

  useEffect(() => {
    let alive = true;
    competitor?.getYunqiToken?.().then(async (response: any) => {
      if (!alive) return;
      const nextToken = typeof response?.token === "string" ? response.token : "";
      const isExpired = Boolean(response?.isExpired);
      const needsLogin = !nextToken || isExpired;
      const nextStatus: YunqiTokenStatus = isExpired ? "invalid" : (nextToken ? "configured" : "empty");
      setSavedYunqiToken(nextToken);
      setDraftYunqiToken(nextToken);
      setYunqiTokenStatus(nextStatus);
      setYunqiTokenLoading(false);

      // 自动登录：token 为空或过期时自动触发
      if (needsLogin && !autoLoginTriggeredRef.current && competitor?.yunqiAutoLogin) {
        autoLoginTriggeredRef.current = true;
        setYunqiAutoLoginLoading(true);
        message.loading({ key: "yunqi-auto-login", content: "正在自动登录云启…", duration: 0 });
        try {
          const result = await competitor.yunqiAutoLogin();
          if (!alive) return;
          const freshToken = typeof result?.token === "string" ? result.token.trim() : "";
          if (freshToken) {
            setSavedYunqiToken(freshToken);
            setDraftYunqiToken(freshToken);
            setYunqiTokenStatus("configured");
            setYunqiTokenEditing(false);
            message.success({ key: "yunqi-auto-login", content: "云启自动登录成功" });
          }
        } catch (error) {
          if (!alive) return;
          message.error({ key: "yunqi-auto-login", content: stripWorkerErrorCode(getErrorMessage(error)) || "自动登录失败" });
        } finally {
          if (alive) setYunqiAutoLoginLoading(false);
        }
      }
    }).catch(() => {
      if (!alive) return;
      setYunqiTokenStatus("empty");
      setYunqiTokenLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const handleSaveYunqiToken = useCallback(async () => {
    const nextToken = draftYunqiToken.trim();
    if (!nextToken) {
      message.warning("请输入云启数据 Token");
      return;
    }
    if (!competitor) {
      message.error("当前无法保存 Token，请稍后再试");
      return;
    }
    setYunqiTokenSaving(true);
    try {
      await competitor.setYunqiToken(nextToken);
      setSavedYunqiToken(nextToken);
      setDraftYunqiToken(nextToken);
      setYunqiTokenStatus("configured");
      setYunqiTokenEditing(false);
      message.success("Token 已保存");
    } catch (error) {
      message.error(stripWorkerErrorCode(getErrorMessage(error)) || "保存失败");
    } finally {
      setYunqiTokenSaving(false);
    }
  }, [draftYunqiToken]);

  const handleCancelYunqiEdit = useCallback(() => {
    setDraftYunqiToken(savedYunqiToken);
    setYunqiTokenEditing(false);
  }, [savedYunqiToken]);

  const handleFetchYunqiTokenFromBrowser = useCallback(async () => {
    if (!competitor?.fetchYunqiToken) {
      message.error("当前无法从浏览器获取 Yunqi Token，请稍后再试");
      return;
    }
    setYunqiTokenFetching(true);
    message.loading({
      key: "yunqi-browser-token",
      content: "正在从浏览器同步 Yunqi Token，如未登录请在打开的云启页面完成登录…",
      duration: 0,
    });
    try {
      const result = await competitor.fetchYunqiToken();
      const nextToken = typeof result?.token === "string" ? result.token.trim() : "";
      if (!nextToken) {
        throw new Error("浏览器里暂时没有可用的 Yunqi Token");
      }
      setSavedYunqiToken(nextToken);
      setDraftYunqiToken(nextToken);
      setYunqiTokenStatus("configured");
      setYunqiTokenEditing(false);
      message.success({
        key: "yunqi-browser-token",
        content: result?.waitedForLogin ? "已从浏览器获取并保存最新 Yunqi Token" : "已从浏览器同步最新 Yunqi Token",
      });
    } catch (error) {
      message.error({
        key: "yunqi-browser-token",
        content: stripWorkerErrorCode(getErrorMessage(error)) || "从浏览器获取 Yunqi Token 失败",
      });
    } finally {
      setYunqiTokenFetching(false);
    }
  }, []);

  const [yunqiAutoLoginLoading, setYunqiAutoLoginLoading] = useState(false);
  const [yunqiHasCredentials, setYunqiHasCredentials] = useState(true);

  useEffect(() => {
    competitor?.getYunqiCredentials?.().then((res: any) => {
      setYunqiHasCredentials(Boolean(res?.hasCredentials));
    }).catch(() => {});
  }, []);

  const handleYunqiAutoLogin = useCallback(async () => {
    if (!competitor?.yunqiAutoLogin) {
      message.error("当前版本不支持自动登录");
      return;
    }
    setYunqiAutoLoginLoading(true);
    message.loading({ key: "yunqi-auto-login", content: "正在自动登录云启…", duration: 0 });
    try {
      const result = await competitor.yunqiAutoLogin();
      const nextToken = typeof result?.token === "string" ? result.token.trim() : "";
      if (!nextToken) throw new Error("自动登录后未获取到 token");
      setSavedYunqiToken(nextToken);
      setDraftYunqiToken(nextToken);
      setYunqiTokenStatus("configured");
      setYunqiTokenEditing(false);
      message.success({
        key: "yunqi-auto-login",
        content: result?.alreadyLoggedIn ? "已获取云启 Token（已登录状态）" : "云启自动登录成功",
      });
    } catch (error) {
      message.error({
        key: "yunqi-auto-login",
        content: stripWorkerErrorCode(getErrorMessage(error)) || "自动登录失败",
      });
    } finally {
      setYunqiAutoLoginLoading(false);
    }
  }, []);

  const handleSaveYunqiCredentials = useCallback(async (account: string, password: string) => {
    try {
      await competitor?.setYunqiCredentials?.({ account, password });
      setYunqiHasCredentials(true);
      message.success("云启账号已保存");
    } catch (error) {
      message.error(getErrorMessage(error) || "保存失败");
    }
  }, []);

  const handleYunqiRequestStart = useCallback(() => {
    setYunqiTokenStatus((current) => (current === "configured" ? "checking" : current));
  }, []);

  const handleYunqiRequestFinish = useCallback(() => {
    setYunqiTokenStatus((current) => {
      if (current !== "checking") return current;
      return savedYunqiToken ? "configured" : "empty";
    });
  }, [savedYunqiToken]);

  const handleYunqiRequestSuccess = useCallback(() => {
    setYunqiTokenStatus("valid");
  }, []);

  const handleYunqiAuthInvalid = useCallback(async (error?: unknown) => {
    setYunqiTokenStatus("invalid");
    // 自动重新登录
    if (competitor?.yunqiAutoLogin) {
      setYunqiAutoLoginLoading(true);
      message.loading({ key: "yunqi-auto-login", content: "Token 已失效，正在自动重新登录…", duration: 0 });
      try {
        const result = await competitor.yunqiAutoLogin();
        const freshToken = typeof result?.token === "string" ? result.token.trim() : "";
        if (freshToken) {
          setSavedYunqiToken(freshToken);
          setDraftYunqiToken(freshToken);
          setYunqiTokenStatus("configured");
          setYunqiTokenEditing(false);
          message.success({ key: "yunqi-auto-login", content: "已自动重新登录云启" });
          return;
        }
      } catch (retryError) {
        message.error({ key: "yunqi-auto-login", content: stripWorkerErrorCode(getErrorMessage(retryError)) || "自动重新登录失败" });
      } finally {
        setYunqiAutoLoginLoading(false);
      }
    }
    // 自动登录失败时回退到手动
    setYunqiTokenEditing(true);
    setDraftYunqiToken(savedYunqiToken);
  }, [savedYunqiToken]);

  const isProductTab = activeTab === "product_v2";
  const productStepState = productWorkbenchStepState ?? {
    activeStep: productWorkbenchActiveStep,
    currentStepMeta: {
      key: 0,
      title: "选商品",
      desc: "先锁定这次要分析的商品",
      enabled: true,
      completed: false,
    },
    stepItems: [
      { key: 0, title: "选商品", desc: "先锁定这次要分析的商品", enabled: true, completed: false },
      { key: 1, title: "设关键词", desc: "确认这次主打关键词", enabled: false, completed: false },
      { key: 2, title: "挑样本", desc: "从结果里选 3-5 个可比对象", enabled: false, completed: false },
      { key: 3, title: "看动作", desc: "直接看市场判断和行动建议", enabled: false, completed: false },
    ],
    nextStepTarget: null,
    nextStepLabel: "",
    canGoNext: false,
  };

  return (
    <div className="competitor-analysis-shell">
      {isProductTab ? (
        <Card
          className="competitor-analysis-hero-card"
          style={{
            ...CARD_STYLE,
            background: "linear-gradient(135deg, rgba(26, 115, 232, 0.08) 0%, #ffffff 62%, rgba(52, 168, 83, 0.05) 100%)",
            border: "1px solid rgba(26, 115, 232, 0.16)",
            marginBottom: 16,
          }}
        >
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <div>
              <div style={{ color: "#a0672a", fontSize: 12, fontWeight: 600, letterSpacing: 0.4 }}>运营</div>
              <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700, color: "#1f1f1f" }}>竞品分析</div>
            </div>

            <YunqiTokenBanner
              status={yunqiTokenStatus}
              savedToken={savedYunqiToken}
              draftToken={draftYunqiToken}
              loading={yunqiTokenLoading}
              saving={yunqiTokenSaving}
              fetchingFromBrowser={yunqiTokenFetching}
              editing={yunqiTokenEditing}
              style={{ marginBottom: 0 }}
              onDraftChange={setDraftYunqiToken}
              onEdit={() => {
                setDraftYunqiToken(savedYunqiToken);
                setYunqiTokenEditing(true);
              }}
              onSave={() => { void handleSaveYunqiToken(); }}
              onCancel={handleCancelYunqiEdit}
              onFetchFromBrowser={() => { void handleFetchYunqiTokenFromBrowser(); }}
              onAutoLogin={yunqiHasCredentials ? () => { void handleYunqiAutoLogin(); } : undefined}
              autoLoginLoading={yunqiAutoLoginLoading}
              hasCredentials={yunqiHasCredentials}
              onSaveCredentials={handleSaveYunqiCredentials}
            />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
              <div>
                <Text strong style={{ fontSize: 18 }}>按步骤做竞品分析</Text>
                <div style={{ marginTop: 6, color: "#8c8c8c" }}>
                  像 AI 出图一样，先选商品，再搜词挑样本，最后只看可执行动作。
                </div>
              </div>

              <Space wrap>
                {productStepState.activeStep > 0 ? (
                  <Button onClick={() => setProductWorkbenchActiveStep(Math.max(0, productStepState.activeStep - 1))}>上一步</Button>
                ) : null}
                {productStepState.nextStepTarget !== null ? (
                  <Button
                    type="primary"
                    disabled={!productStepState.canGoNext}
                    onClick={() => productStepState.canGoNext && setProductWorkbenchActiveStep(productStepState.nextStepTarget!)}
                    style={{ background: TEMU_ORANGE, borderColor: TEMU_ORANGE }}
                  >
                    {productStepState.nextStepLabel}
                  </Button>
                ) : (
                  <Button onClick={() => setProductWorkbenchActiveStep(2)}>继续调整样本</Button>
                )}
              </Space>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 12,
              }}
            >
              {productStepState.stepItems.map((item) => {
                const isActive = item.key === productStepState.activeStep;
                const isClickable = item.enabled || item.key <= productStepState.activeStep;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => isClickable && setProductWorkbenchActiveStep(item.key)}
                    style={{
                      textAlign: "left",
                      padding: "14px 16px",
                      borderRadius: 16,
                      border: isActive ? `1px solid ${TEMU_ORANGE}` : "1px solid #ebeef5",
                      background: isActive ? "rgba(26, 115, 232, 0.08)" : item.completed ? "rgba(26, 115, 232, 0.04)" : "#fff",
                      cursor: isClickable ? "pointer" : "not-allowed",
                      opacity: isClickable ? 1 : 0.55,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <Text strong style={{ color: isActive ? TEMU_ORANGE : "#262626" }}>{`${item.key + 1}. ${item.title}`}</Text>
                      {item.completed ? <Tag color="success" style={{ marginInlineEnd: 0 }}>已就绪</Tag> : null}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, color: "#8c8c8c", lineHeight: 1.5 }}>
                      {item.desc}
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={{ color: "#8c8c8c", lineHeight: 1.7 }}>
              当前在做：<Text strong style={{ color: "#262626" }}>{productStepState.currentStepMeta.title}</Text>。{productStepState.currentStepMeta.desc}
            </div>
          </Space>
        </Card>
      ) : (
        <>
          <PageHeader eyebrow="运营" title="竞品分析" />

          <YunqiTokenBanner
            status={yunqiTokenStatus}
            savedToken={savedYunqiToken}
            draftToken={draftYunqiToken}
            loading={yunqiTokenLoading}
            saving={yunqiTokenSaving}
            fetchingFromBrowser={yunqiTokenFetching}
            editing={yunqiTokenEditing}
            style={{ marginBottom: 16 }}
            onDraftChange={setDraftYunqiToken}
            onEdit={() => {
              setDraftYunqiToken(savedYunqiToken);
              setYunqiTokenEditing(true);
            }}
            onSave={() => { void handleSaveYunqiToken(); }}
            onCancel={handleCancelYunqiEdit}
            onFetchFromBrowser={() => { void handleFetchYunqiTokenFromBrowser(); }}
            onAutoLogin={yunqiHasCredentials ? () => { void handleYunqiAutoLogin(); } : undefined}
            autoLoginLoading={yunqiAutoLoginLoading}
          />
        </>
      )}

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        style={{ marginTop: isProductTab ? 0 : 16 }}
        items={[
          {
            key: "product",
            label: <span><SearchOutlined /> 关键词分析</span>,
            children: (
              <CompetitorProductWorkbench
                onYunqiRequestStart={handleYunqiRequestStart}
                onYunqiRequestFinish={handleYunqiRequestFinish}
                onYunqiRequestSuccess={handleYunqiRequestSuccess}
                onYunqiAuthInvalid={handleYunqiAuthInvalid}
                prefillProduct={routePrefillProduct}
              />
            ),
          },
          {
            key: "track",
            label: <span><LineChartOutlined /> 竞品跟踪</span>,
            children: <CompetitorTrackTab />,
          },
          {
            key: "report",
            label: <span><FileTextOutlined /> 执行报告</span>,
            children: <CompetitorReportTab />,
          },
          {
            key: "product_v2",
            label: <span><ShopOutlined /> 我的商品</span>,
            children: (
              <CompetitorProductWorkbench
                activeStep={productWorkbenchActiveStep}
                onActiveStepChange={setProductWorkbenchActiveStep}
                onStepStateChange={handleProductWorkbenchStepStateChange}
                hideStepShell
                onYunqiRequestStart={handleYunqiRequestStart}
                onYunqiRequestFinish={handleYunqiRequestFinish}
                onYunqiRequestSuccess={handleYunqiRequestSuccess}
                onYunqiAuthInvalid={handleYunqiAuthInvalid}
                prefillProduct={routePrefillProduct}
              />
            ),
          },
          {
            key: "database",
            label: <span><BarChartOutlined /> 数据库</span>,
            children: <YunqiDbTab />,
          },
        ].filter((item) => item.key === "product_v2")}
      />
    </div>
  );
}
