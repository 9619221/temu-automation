import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import listingTaskStore from "../stores/listingTaskStore";
import {
  Alert,
  Badge,
  Button,
  Card,
  Cascader,
  Checkbox,
  Col,
  Drawer,
  Empty,
  Image,
  Input,
  InputNumber,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  CheckCircleFilled,
  ClearOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  DollarOutlined,
  EditOutlined,
  FireOutlined,
  LinkOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  RiseOutlined,
  RocketOutlined,
  SearchOutlined,
  ShoppingOutlined,
  StarFilled,
  AppstoreOutlined,
  UploadOutlined,
  WarningOutlined,
  GiftOutlined,
} from "@ant-design/icons";
import { readPageCache, writePageCache } from "../utils/pageCache";

const { Text, Paragraph } = Typography;
const api = window.electronAPI?.yunqiDb;

const BLUE = "#1a73e8";
const CARD_STYLE: React.CSSProperties = { borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)" };
const PRODUCT_GRID_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(232px, 1fr))",
  gap: 12,
  alignItems: "stretch",
};
const SELECTION_RESULT_CACHE_KEY = "temu.selection-plaza.result.v1";

const STATUS_META: Record<string, { label: string; color: string; hex: string }> = {
  want: { label: "想上", color: "blue", hex: "#1677ff" },
  sourcing: { label: "找货源中", color: "orange", hex: "#fa8c16" },
  sourced: { label: "已找到货源", color: "cyan", hex: "#13c2c2" },
  listing: { label: "上架中", color: "purple", hex: "#722ed1" },
  listed: { label: "已上架", color: "green", hex: "#52c41a" },
  dropped: { label: "已弃用", color: "default", hex: "#8c8c8c" },
};

const SORT_OPTIONS = [
  { value: "daily_sales", label: "日销量" },
  { value: "weekly_sales", label: "周销量" },
  { value: "monthly_sales", label: "月销量" },
  { value: "total_sales", label: "总销量" },
  { value: "usd_gmv", label: "GMV" },
  { value: "score", label: "评分" },
  { value: "usd_price", label: "价格" },
];

const QUICK_FILTERS: Array<{ key: string; label: string; icon: React.ReactNode; ov: Record<string, any> }> = [
  { key: "hotSales", label: "销量优先", icon: <FireOutlined />, ov: { minDailySales: 50, sortBy: "daily_sales", sortOrder: "DESC" } },
  { key: "highScore", label: "高评分", icon: <StarFilled />, ov: { sortBy: "score", sortOrder: "DESC" } },
  { key: "highGmv", label: "高 GMV", icon: <RiseOutlined />, ov: { sortBy: "usd_gmv", sortOrder: "DESC" } },
  { key: "lowPrice", label: "低价潜力", icon: <DollarOutlined />, ov: { maxPrice: 10, minDailySales: 20, sortBy: "daily_sales", sortOrder: "DESC" } },
];

const MODE_MAP: Record<string, string> = { "0": "全托管", "1": "半托管", 全托管: "全托管", 半托管: "半托管" };
const normMode = (m: any) => MODE_MAP[String(m ?? "")] || (m ? String(m) : "");
const usd = (v: any) => `$${(Number(v) || 0).toFixed(2)}`;
const intFmt = (v: any) => (Number(v) || 0).toLocaleString("en-US");
const usdCompact = (v: any) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return usd(n);
};

// 迷你 SVG 折线图
function MiniSparkline({ data, width = 120, height = 28, color = "#1a73e8" }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / Math.max(data.length - 1, 1)) * width},${height - 2 - ((v - min) / range) * (height - 4)}`).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

interface Signal { text: string; color: string }

function computeSignals(item: ProductRow): { opp?: Signal; risk?: Signal } {
  const ds = Number(item.daily_sales) || 0;
  const gmv = Number(item.usd_gmv) || 0;
  const sc = Number(item.score) || 0;
  const same = Number(item.same_num) || 0;

  let opp: Signal | undefined;
  if (ds >= 100) opp = { text: "爆款", color: "red" };
  else if (gmv >= 10000) opp = { text: "高 GMV", color: "green" };
  else if (ds >= 30) opp = { text: "热销", color: "volcano" };
  else if (sc >= 4.7 && ds > 0) opp = { text: "高口碑", color: "gold" };
  else if (ds > 0 && same > 0 && same < 5) opp = { text: "竞争少", color: "cyan" };

  let risk: Signal | undefined;
  if (same >= 100) risk = { text: "同款多", color: "orange" };
  else if (sc > 0 && sc < 3.8) risk = { text: "评分低", color: "red" };
  else if (ds === 0) risk = { text: "近期无销", color: "default" };

  return { opp, risk };
}

function computeOpportunityScore(item: ProductRow) {
  const dailySales = Number(item.daily_sales) || 0;
  const gmv = Number(item.usd_gmv) || 0;
  const score = Number(item.score) || 0;
  const sameNum = Number(item.same_num) || 0;
  const price = Number(item.usd_price) || 0;

  const demandScore = Math.min(38, Math.log10(dailySales + 1) * 10);
  const gmvScore = Math.min(24, Math.log10(gmv + 1) * 4.2);
  const ratingScore = score > 0 ? Math.min(16, Math.max(0, score - 3) * 8) : 6;
  const priceScore = price > 0 && price <= 10 ? 10 : price <= 20 ? 7 : 4;
  const competitionPenalty = sameNum >= 100 ? 16 : sameNum >= 30 ? 9 : sameNum >= 10 ? 5 : 0;
  const value = Math.max(0, Math.min(100, Math.round(demandScore + gmvScore + ratingScore + priceScore + 12 - competitionPenalty)));
  const tone = value >= 80 ? "#137333" : value >= 65 ? "#b06000" : "#5f6368";
  return { value, tone };
}

interface DailySalesPoint { date: number; sales: number; total_sales?: number; usd_gmv?: number }
interface RegionPrice { region: string; price: number; currency: string; market_price?: number; date?: number }
interface RegionComment { area: string; goods_score?: number | null; comment_num_tips?: number | null }

interface ProductRow {
  goods_id: string;
  sku_id?: string;
  title_zh?: string;
  title_en?: string;
  main_image?: string;
  image_urls?: string[];
  product_url?: string;
  usd_price?: number;
  eur_price?: number;
  daily_sales?: number;
  weekly_sales?: number;
  monthly_sales?: number;
  total_sales?: number;
  usd_gmv?: number;
  eur_gmv?: number;
  score?: number;
  total_comments?: number;
  region_comments?: RegionComment[];
  category_zh?: string;
  mall_name?: string;
  mall_logo?: string;
  mall_mode?: string;
  listed_at?: string;
  same_num?: number;
  daily_sales_list?: DailySalesPoint[];
  prices?: RegionPrice[];
  sold_out?: boolean | null;
  video_url?: string;
  brand?: string;
  opt_ids?: string[];
  status?: string;
  note?: string;
}

const PAGE_SIZE = 100; // API 最大返回量

// ---------- 商品卡片（memo 避免列表重绘） ----------

interface CardProps {
  item: ProductRow;
  inPool: boolean;
  pool?: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onOpen: () => void;
  onStatusChange?: (status: string) => void;
  onNoteUpdate?: (note: string) => void;
}

const ProductCard = memo(function ProductCard({ item, inPool, pool, onAdd, onRemove, onOpen, onStatusChange, onNoteUpdate }: CardProps) {
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState(item.note || "");

  useEffect(() => { setNoteText(item.note || ""); }, [item.note]);

  const mode = normMode(item.mall_mode);
  const listedDate = item.listed_at ? String(item.listed_at).slice(0, 10) : "";
  const { risk } = computeSignals(item);
  const { opp } = computeSignals(item);
  const dailySales = Number(item.daily_sales) || 0;
  const weeklySales = Number(item.weekly_sales) || 0;
  const monthlySales = Number(item.monthly_sales) || 0;
  const score = Number(item.score) || 0;
  const comments = Number(item.total_comments) || 0;
  const sameNum = Number(item.same_num) || 0;
  const title = item.title_zh || item.title_en || "（无标题）";
  const quietSignal = risk || (opp?.text === "竞争少" ? opp : undefined);
  const opportunity = computeOpportunityScore(item);

  const saveNote = () => {
    onNoteUpdate?.(noteText);
    setEditingNote(false);
  };

  return (
    <Card
      hoverable
      className="sp-card"
      style={{ ...CARD_STYLE, height: "100%", overflow: "hidden", borderColor: "#e8eaed" }}
      styles={{ body: { padding: 10 } }}
      cover={
        <div style={{ height: 172, position: "relative", overflow: "hidden", background: "#f7f8fa", cursor: "pointer" }} onClick={onOpen}>
          <Image
            src={item.main_image}
            alt={title}
            width="100%"
            height={172}
            style={{ objectFit: "contain" }}
            preview={false}
            fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23eee'/%3E%3C/svg%3E"
          />
          {item.sold_out === true && (
            <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.72)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, letterSpacing: 1 }}>
              已售罄
            </div>
          )}
          {item.video_url && (
            <div style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.6)", color: "#fff", borderRadius: 12, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="3,1 11,6 3,11" fill="#fff" /></svg>
            </div>
          )}
        </div>
      }
    >
      {/* 价格 + 信号 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          {item.prices?.length ? (
            <Tooltip title={<div style={{ fontSize: 12 }}>{item.prices.map((p) => <div key={p.region}>{p.region}: {p.currency}{p.price.toFixed(2)}{p.market_price ? ` (原${p.currency}${p.market_price.toFixed(2)})` : ""}</div>)}</div>}>
              <span style={{ fontSize: 16, fontWeight: 800, color: "#d93025", cursor: "help", borderBottom: "1px dashed #d93025" }}>{usd(item.usd_price)}</span>
            </Tooltip>
          ) : (
            <span style={{ fontSize: 16, fontWeight: 800, color: "#d93025" }}>{usd(item.usd_price)}</span>
          )}
          {(item.eur_price ?? 0) > 0 && <span style={{ fontSize: 11, color: "#8c8c8c" }}>&euro;{(item.eur_price!).toFixed(2)}</span>}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {opp && opp.text !== "竞争少" && (
            <Tag color={opp.color} style={{ marginInlineEnd: 0, borderRadius: 6, lineHeight: "18px", fontSize: 11 }}>{opp.text}</Tag>
          )}
        </div>
      </div>
      {/* 标签行 */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, minHeight: 22, marginBottom: 6, overflow: "hidden", flexWrap: "wrap" }}>
        <Tag color={opportunity.value >= 80 ? "green" : opportunity.value >= 65 ? "gold" : "default"} style={{ marginInlineEnd: 0, borderRadius: 6, lineHeight: "18px", fontSize: 11 }}>
          {opportunity.value}分
        </Tag>
        {quietSignal && <Tag color={quietSignal.color} style={{ marginInlineEnd: 0, borderRadius: 6, lineHeight: "18px", fontSize: 11 }}>{quietSignal.text}</Tag>}
        {mode && <Tag color={mode === "全托管" ? "blue" : "cyan"} style={{ marginInlineEnd: 0, borderRadius: 6, lineHeight: "18px", fontSize: 11 }}>{mode}</Tag>}
        {pool && item.status && (
          <Tag color={STATUS_META[item.status]?.color || "default"} style={{ marginInlineEnd: 0, borderRadius: 6, lineHeight: "18px", fontSize: 11 }}>
            {STATUS_META[item.status]?.label || item.status}
          </Tag>
        )}
      </div>

      {/* 标题 */}
      <Tooltip title="点击打开商品页">
        <Paragraph ellipsis={{ rows: 2 }} onClick={onOpen} style={{ marginBottom: 8, minHeight: 38, fontSize: 13, lineHeight: 1.45, fontWeight: 600, color: "#202124", cursor: "pointer" }}>
          {title}
        </Paragraph>
      </Tooltip>

      {/* 数据格 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, overflow: "hidden", border: "1px solid #edf0f2", borderRadius: 8, background: "#edf0f2", marginBottom: 8 }}>
        <div style={{ padding: "5px 7px", background: "#fff", minWidth: 0 }}>
          <div style={{ color: "#8c8c8c", fontSize: 10, lineHeight: 1.1 }}>日销</div>
          <div style={{ color: dailySales > 0 ? "#d93025" : "#9aa0a6", fontSize: 13, lineHeight: 1.35, fontWeight: 800 }}>{dailySales > 0 ? intFmt(dailySales) : "-"}</div>
        </div>
        <div style={{ padding: "5px 7px", background: "#fff", minWidth: 0 }}>
          <div style={{ color: "#8c8c8c", fontSize: 10, lineHeight: 1.1 }}>周销</div>
          <div style={{ color: weeklySales > 0 ? "#d93025" : "#9aa0a6", fontSize: 13, lineHeight: 1.35, fontWeight: 800 }}>{weeklySales > 0 ? intFmt(weeklySales) : "-"}</div>
        </div>
        <div style={{ padding: "5px 7px", background: "#fff", minWidth: 0 }}>
          <div style={{ color: "#8c8c8c", fontSize: 10, lineHeight: 1.1 }}>月销</div>
          <div style={{ color: monthlySales > 0 ? "#d93025" : "#9aa0a6", fontSize: 13, lineHeight: 1.35, fontWeight: 800 }}>{monthlySales > 0 ? intFmt(monthlySales) : "-"}</div>
        </div>
        <div style={{ padding: "5px 7px", background: "#fff", minWidth: 0 }}>
          <div style={{ color: "#8c8c8c", fontSize: 10, lineHeight: 1.1 }}>GMV</div>
          <Tooltip title={usd(item.usd_gmv)}>
            <div style={{ color: "#137333", fontSize: 13, lineHeight: 1.35, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{usdCompact(item.usd_gmv)}</div>
          </Tooltip>
        </div>
        <div style={{ padding: "5px 7px", background: "#fff", minWidth: 0 }}>
          <div style={{ color: "#8c8c8c", fontSize: 10, lineHeight: 1.1 }}>评分</div>
          <div style={{ color: score > 0 ? "#b06000" : "#9aa0a6", fontSize: 13, lineHeight: 1.35, fontWeight: 800 }}>{score > 0 ? score.toFixed(1) : "-"}</div>
        </div>
        <div style={{ padding: "5px 7px", background: "#fff", minWidth: 0 }}>
          <div style={{ color: "#8c8c8c", fontSize: 10, lineHeight: 1.1 }}>评论</div>
          <div style={{ color: comments > 0 ? "#1a73e8" : "#9aa0a6", fontSize: 13, lineHeight: 1.35, fontWeight: 800 }}>{comments > 0 ? intFmt(comments) : "-"}</div>
        </div>
      </div>

      {/* 销量趋势 + 总销 + 品牌 */}
      {(item.daily_sales_list?.length || (item.total_sales ?? 0) > 0 || item.brand) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, minHeight: 28 }}>
          {item.daily_sales_list?.length ? (
            <Tooltip title={<div style={{ fontSize: 12 }}>近{item.daily_sales_list.length}天日销趋势</div>}>
              <div style={{ flex: "0 0 auto" }}><MiniSparkline data={item.daily_sales_list.map((d) => d.sales)} /></div>
            </Tooltip>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
            {(item.total_sales ?? 0) > 0 && (
              <div style={{ fontSize: 11, color: "#5f6368", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <span style={{ fontWeight: 700, color: "#d93025" }}>{intFmt(item.total_sales)}</span> <span style={{ color: "#8c8c8c" }}>总销</span>
              </div>
            )}
            {item.brand && (
              <div style={{ fontSize: 11, color: "#5f6368", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {item.brand}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 分区域评论 */}
      {item.region_comments?.length && item.region_comments.length > 1 ? (
        <Tooltip title={<div style={{ fontSize: 12 }}>{item.region_comments.map((rc) => <div key={rc.area}>{rc.area}: {rc.goods_score ?? "-"}分 / {rc.comment_num_tips ?? 0}条</div>)}</div>}>
          <div style={{ display: "flex", gap: 4, marginBottom: 6, flexWrap: "wrap" }}>
            {item.region_comments.filter((rc) => rc.area !== "global").slice(0, 4).map((rc) => (
              <span key={rc.area} style={{ fontSize: 10, color: "#5f6368", background: "#f4f5f7", borderRadius: 4, padding: "1px 5px" }}>
                {rc.area} {rc.goods_score != null ? `${Number(rc.goods_score).toFixed(1)}` : "-"}
              </span>
            ))}
          </div>
        </Tooltip>
      ) : null}

      {/* 机会分进度条 */}
      <Tooltip title="综合日销、GMV、评分、价格与同款竞争的选品参考分">
        <div style={{ display: "grid", gridTemplateColumns: "42px minmax(0, 1fr)", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ color: opportunity.tone, fontSize: 11, fontWeight: 700 }}>机会分</span>
          <span style={{ height: 6, overflow: "hidden", borderRadius: 999, background: "#edf0f2" }}>
            <span style={{ display: "block", width: `${opportunity.value}%`, height: "100%", borderRadius: 999, background: opportunity.tone, transition: "width .3s ease" }} />
          </span>
        </div>
      </Tooltip>

      {/* 元信息行 */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", color: "#5f6368", fontSize: 11, marginBottom: 8, minWidth: 0, whiteSpace: "nowrap" }}>
        {item.mall_logo && <img src={item.mall_logo} alt="" style={{ width: 16, height: 16, borderRadius: 8, objectFit: "cover", flex: "0 0 auto" }} />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{!item.mall_logo && <ShoppingOutlined style={{ marginRight: 3 }} />}{item.mall_name || "-"}</span>
        {sameNum > 0 && <span style={{ flex: "0 0 auto" }}>{intFmt(sameNum)} 同款</span>}
        {listedDate && <span style={{ marginLeft: "auto", color: "#bfbfbf" }}>{listedDate}</span>}
      </div>

      {/* 选品池备注 */}
      {pool && (
        <div style={{ marginBottom: 8 }}>
          {editingNote ? (
            <Space.Compact style={{ width: "100%" }}>
              <Input
                size="small"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="添加备注..."
                onPressEnter={saveNote}
                autoFocus
                style={{ fontSize: 12 }}
              />
              <Button size="small" type="primary" onClick={saveNote}>保存</Button>
            </Space.Compact>
          ) : (
            <div
              onClick={() => setEditingNote(true)}
              style={{
                fontSize: 11, color: item.note ? "#595959" : "#bfbfbf", cursor: "pointer",
                padding: "3px 6px", borderRadius: 4, background: item.note ? "#f6f8fa" : "transparent",
                border: "1px dashed transparent", transition: "all .15s",
              }}
              onMouseEnter={(e) => { (e.currentTarget.style.borderColor = "#d9d9d9"); }}
              onMouseLeave={(e) => { (e.currentTarget.style.borderColor = "transparent"); }}
            >
              <EditOutlined style={{ marginRight: 4, fontSize: 10 }} />
              {item.note || "点击添加备注"}
            </div>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      {pool ? (
        <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
          <Tooltip title="打开商品页">
            <Button size="small" type="text" icon={<LinkOutlined />} onClick={onOpen} />
          </Tooltip>
          <Popconfirm title="移出选品池？" onConfirm={onRemove} okText="移出" cancelText="取消">
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "nowrap" }}>
          <Button
            size="small"
            type={inPool ? "default" : "primary"}
            icon={inPool ? <CheckCircleFilled /> : <PlusOutlined />}
            disabled={inPool}
            onClick={onAdd}
            style={{ flex: 1, minWidth: 0 }}
          >
            {inPool ? "已加入" : "加入选品池"}
          </Button>
          <Tooltip title="打开商品页">
            <Button size="small" icon={<LinkOutlined />} onClick={onOpen} />
          </Tooltip>
        </div>
      )}
    </Card>
  );
});

// ---------- 主页面 ----------

export default function SelectionPlaza() {
  const [keyword, setKeyword] = useState("");
  const [optIdPath, setOptIdPath] = useState<string[]>([]);
  const [categories, setCategories] = useState<Array<{ cat_id: number; cat_name: string; cat_level: number; parent_cat_id: number }>>([]);
  const [minPrice, setMinPrice] = useState<number | undefined>(undefined);
  const [maxPrice, setMaxPrice] = useState<number | undefined>(undefined);
  const [minDailySales, setMinDailySales] = useState<number | undefined>(undefined);
  const [sortBy, setSortBy] = useState("daily_sales");
  const [sortOrder, setSortOrder] = useState("DESC");
  const [nextFrom, setNextFrom] = useState(0);
  const [result, setResult] = useState<{ items: ProductRow[]; total: number }>(
    () => readPageCache(SELECTION_RESULT_CACHE_KEY, { items: [] as ProductRow[], total: 0 }),
  );
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const hasMore = result.items.length < result.total;
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [refreshingToken, setRefreshingToken] = useState(false);

  const [poolRows, setPoolRows] = useState<ProductRow[]>([]);
  const [poolSummary, setPoolSummary] = useState<Record<string, number>>({});
  const [poolIds, setPoolIds] = useState<Set<string>>(new Set());
  const poolStatusFilter = "";

  const [activeTab, setActiveTab] = useState("plaza");
  const [selectedPoolIds, setSelectedPoolIds] = useState<Set<string>>(new Set());

  // ---- 上品 Drawer 状态（全局 store 驱动）----
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [comboDrawerOpen, setComboDrawerOpen] = useState(false);
  const taskState = useSyncExternalStore(
    listingTaskStore.subscribe,
    listingTaskStore.getState,
  );
  const listingMode = taskState.mode;
  const drawerProducts = taskState.products;
  const listingExporting = taskState.exporting;
  const listingRunning = taskState.running;
  const listingPaused = taskState.paused;
  const listingProgress = taskState.progress;
  const listingResults = taskState.results;

  // ---- 数据加载 ----

  const loadCategories = useCallback(async () => {
    try {
      const cats = await api?.categories();
      if (Array.isArray(cats)) setCategories(cats as any);
    } catch { /* ignore */ }
  }, []);

  const loadPoolIds = useCallback(async () => {
    try {
      const ids = await api?.selectionIds();
      if (Array.isArray(ids)) setPoolIds(new Set(ids.map(String)));
    } catch { /* ignore */ }
  }, []);

  const loadPool = useCallback(async () => {
    try {
      const r = await api?.selectionList({ status: poolStatusFilter || undefined });
      if (r) {
        setPoolRows(r.rows || []);
        setPoolSummary(r.summary || {});
      }
    } catch { /* ignore */ }
  }, [poolStatusFilter]);

  // ---- 搜索 ----

  const doSearch = useCallback(
    async (fromOffset = 0, overrides: Record<string, any> = {}) => {
      if (!api) return message.error("选品功能暂不可用");
      const eff = { keyword, optIdPath, minPrice, maxPrice, minDailySales, sortBy, sortOrder, ...overrides };
      const isNew = fromOffset === 0;
      if (isNew) setSearching(true); else setLoadingMore(true);
      try {
        const params: any = { sortBy: eff.sortBy, sortOrder: eff.sortOrder, page: Math.floor(fromOffset / PAGE_SIZE) + 1, pageSize: PAGE_SIZE };
        if (String(eff.keyword || "").trim()) params.keyword = String(eff.keyword).trim();
        if (eff.optIdPath?.length) params.optId = String(eff.optIdPath[eff.optIdPath.length - 1]);
        if (eff.minPrice != null) params.minPrice = eff.minPrice;
        if (eff.maxPrice != null) params.maxPrice = eff.maxPrice;
        if (eff.minDailySales != null) params.minDailySales = eff.minDailySales;
        const r = await api.search(params);
        const newItems = r.items || [];
        if (isNew) {
          setResult({ items: newItems, total: r.total || 0 });
          writePageCache(SELECTION_RESULT_CACHE_KEY, { items: newItems, total: r.total || 0 });
        } else {
          setResult((prev) => ({ items: [...prev.items, ...newItems], total: r.total || prev.total }));
        }
        setNextFrom(fromOffset + newItems.length);
        setTokenExpired(false);
      } catch (e: any) {
        if (String(e?.message || "").includes("过期")) setTokenExpired(true);
        else message.error(e?.message || "搜索失败");
      } finally {
        if (isNew) setSearching(false); else setLoadingMore(false);
      }
    },
    [keyword, optIdPath, minPrice, maxPrice, minDailySales, sortBy, sortOrder],
  );

  const applyQuick = (ov: Record<string, any>) => {
    if ("minDailySales" in ov) setMinDailySales(ov.minDailySales);
    if ("maxPrice" in ov) setMaxPrice(ov.maxPrice);
    if ("minPrice" in ov) setMinPrice(ov.minPrice);
    if ("sortBy" in ov) setSortBy(ov.sortBy);
    if ("sortOrder" in ov) setSortOrder(ov.sortOrder);
    void doSearch(0, ov);
  };

  const clearFilters = () => {
    setKeyword("");
    setOptIdPath([]);
    setMinPrice(undefined);
    setMaxPrice(undefined);
    setMinDailySales(undefined);
    setSortBy("daily_sales");
    setSortOrder("DESC");
    void doSearch(0, { keyword: "", optIdPath: [], minPrice: undefined, maxPrice: undefined, minDailySales: undefined, sortBy: "daily_sales", sortOrder: "DESC" });
  };

  // ---- 刷新登录（触发服务器重新抓取 token） ----

  const refreshToken = async () => {
    if (!api) return message.error("选品功能暂不可用");
    setRefreshingToken(true);
    try {
      const res: any = await api.syncOnline({ keywords: [], maxPages: 1 });
      if (res?.triggered) {
        message.success("已触发登录刷新，约 30 秒后重新搜索");
        window.setTimeout(() => { setTokenExpired(false); void doSearch(0); }, 35000);
      }
    } catch (e: any) {
      message.error(e?.message || "刷新登录失败");
    } finally {
      setRefreshingToken(false);
    }
  };

  // ---- 选品池操作 ----

  const addToPool = async (item: ProductRow) => {
    try {
      const r = await api?.selectionAdd({
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
        opt_ids: item.opt_ids || [],
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
    const gid = String(goodsId);
    setPoolIds((prev) => { const n = new Set(prev); n.delete(gid); return n; });
    setPoolRows((prev) => prev.filter((r) => String(r.goods_id) !== gid));
    try {
      await api?.selectionRemove({ goodsId });
      message.success("已移出选品池");
    } catch (e: any) {
      message.error(e?.message || "移除失败");
      void loadPool();
      void loadPoolIds();
    }
  };

  const changeStatus = async (goodsId: string, status: string) => {
    setPoolRows((prev) => prev.map((r) => String(r.goods_id) === String(goodsId) ? { ...r, status } : r));
    try {
      await api?.selectionUpdate({ goodsId, status });
    } catch (e: any) {
      message.error(e?.message || "更新状态失败");
      void loadPool();
    }
  };

  const updateNote = async (goodsId: string, note: string) => {
    try {
      await api?.selectionUpdate({ goodsId, note });
      void loadPool();
    } catch (e: any) {
      message.error(e?.message || "更新备注失败");
    }
  };

  const openProduct = (item: ProductRow) => {
    const url = item.product_url || (item.goods_id ? `https://www.temu.com/goods.html?goods_id=${item.goods_id}` : "");
    if (url) window.open(url, "_blank");
  };

  // 切换选品池卡片的选中状态
  const togglePoolSelect = useCallback((goodsId: string) => {
    setSelectedPoolIds((prev) => {
      const next = new Set(prev);
      if (next.has(goodsId)) next.delete(goodsId);
      else next.add(goodsId);
      return next;
    });
  }, []);

  // 全选 / 取消全选（仅限可上品的 want / sourced 状态）
  const eligiblePoolRows = poolRows;

  const toggleSelectAll = useCallback(() => {
    if (selectedPoolIds.size >= eligiblePoolRows.length && eligiblePoolRows.length > 0) {
      setSelectedPoolIds(new Set());
    } else {
      setSelectedPoolIds(new Set(eligiblePoolRows.map((r) => r.goods_id)));
    }
  }, [selectedPoolIds.size, eligiblePoolRows]);

  // ---- 上品 Drawer 逻辑（通过全局 store）----

  useEffect(() => {
    listingTaskStore.setOnComplete(() => {
      void loadPool();
      void loadPoolIds();
    });
  }, [loadPool, loadPoolIds]);

  const openListingDrawer = useCallback(() => {
    if (listingRunning) {
      setDrawerOpen(true);
      return;
    }
    const products = poolRows.filter((r) => selectedPoolIds.has(r.goods_id));
    listingTaskStore.setProducts(products);
    listingTaskStore.reset();
    listingTaskStore.setProducts(products);
    setDrawerOpen(true);
  }, [listingRunning, poolRows, selectedPoolIds]);

  const removeDrawerProduct = useCallback((goodsId: string) => {
    listingTaskStore.removeProduct(goodsId);
  }, []);

  const resetListingDrawer = useCallback(() => {
    const products = poolRows.filter((r) => selectedPoolIds.has(r.goods_id));
    listingTaskStore.reset();
    listingTaskStore.setProducts(products);
  }, [poolRows, selectedPoolIds]);

  const handleStartListing = useCallback(async () => {
    if (!drawerProducts.length) return;
    listingTaskStore.setOnComplete(() => {
      void loadPool();
      void loadPoolIds();
    });

    try {
      const goodsIds = drawerProducts.map((p: any) => p.goods_id);
      const exportResult = await api?.exportForListing?.({ goodsIds });
      if (!exportResult?.ok) {
        message.error(exportResult?.reason || exportResult?.error || "导出失败");
        return;
      }

      const csvPath = exportResult.csvPath!;
      const count = exportResult.count!;

      if (listingMode === "classic") {
        const result = await listingTaskStore.startClassic(csvPath, count);
        if (!result.ok) {
          message.warning(result.message);
        } else {
          message.success("AI 生图上品已开始");
        }
      } else {
        const result = await listingTaskStore.startWorkflow(csvPath, count);
        if (result.ok) {
          message.success(result.message || "新上品流程完成");
        } else {
          message.error(result.message || "新上品流程失败");
        }
      }

      setSelectedPoolIds(new Set());
    } catch (e: any) {
      message.error(e?.message || "上品失败");
      listingTaskStore.reset();
    }
  }, [drawerProducts, listingMode, loadPool, loadPoolIds]);

  const handleToggleListingPause = useCallback(async () => {
    try {
      await listingTaskStore.togglePause();
      message.success(listingPaused ? "已继续" : "暂停请求已发送");
    } catch (e: any) {
      message.error(e?.message || "操作失败");
    }
  }, [listingPaused]);

  const handleBatchExport = useCallback(() => {
    if (!selectedPoolIds.size) return;
    openListingDrawer();
  }, [selectedPoolIds.size, openListingDrawer]);

  const handleOpenCombo = useCallback(() => {
    if (selectedPoolIds.size < 2) {
      message.warning("请至少选择 2 个商品来创建套装");
      return;
    }
    setComboDrawerOpen(true);
  }, [selectedPoolIds.size]);

  const handleStartCombo = useCallback(async () => {
    const comboProducts = poolRows.filter((r) => selectedPoolIds.has(r.goods_id));
    if (comboProducts.length < 2) {
      message.warning("请至少选择 2 个商品");
      return;
    }
    listingTaskStore.setOnComplete(() => {
      void loadPool();
      void loadPoolIds();
    });
    try {
      const result = await listingTaskStore.startCombo(comboProducts);
      if (result.ok) {
        message.success(result.message || "套装草稿已创建");
        setSelectedPoolIds(new Set());
      } else {
        message.error(result.message || "套装上品失败");
      }
    } catch (e: any) {
      message.error(e?.message || "套装上品失败");
    }
  }, [poolRows, selectedPoolIds, loadPool, loadPoolIds]);

  useEffect(() => {
    void loadCategories();
    void loadPoolIds();
    void doSearch(0);
    void loadPool();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // 触底自动加载更多
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) void doSearch(nextFrom); },
      { rootMargin: "400px" },
    );
    if (hasMore && !loadingMore && !searching && result.items.length > 0) ob.observe(el);
    return () => ob.disconnect();
  }, [hasMore, loadingMore, searching, nextFrom, result.items.length, doSearch]);

  // ---- 派生数据 ----

  const categoryOptions = useMemo(() => {
    const l1 = categories.filter((c) => c.cat_level === 1).map((c) => ({ value: String(c.cat_id), label: c.cat_name, children: [] as any[] }));
    const byParent: Record<string, any[]> = {};
    for (const c of categories.filter((c) => c.cat_level === 2)) {
      (byParent[String(c.parent_cat_id)] ||= []).push({ value: String(c.cat_id), label: c.cat_name });
    }
    for (const o of l1) { const kids = byParent[o.value]; if (kids && kids.length) o.children = kids; else delete (o as any).children; }
    return l1;
  }, [categories]);

  const catNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) m[String(c.cat_id)] = c.cat_name;
    return m;
  }, [categories]);

  const activeFilters = useMemo(() => {
    const arr: Array<{ key: string; label: string; clear: () => void }> = [];
    if (keyword.trim()) arr.push({ key: "kw", label: `关键词：${keyword.trim()}`, clear: () => { setKeyword(""); void doSearch(0, { keyword: "" }); } });
    if (optIdPath.length) {
      const last = optIdPath[optIdPath.length - 1];
      arr.push({ key: "cat", label: `类目：${catNameMap[String(last)] || last}`, clear: () => { setOptIdPath([]); void doSearch(0, { optIdPath: [] }); } });
    }
    if (minPrice != null || maxPrice != null) {
      const lbl = `价格：${minPrice != null ? `$${minPrice}` : "0"} ~ ${maxPrice != null ? `$${maxPrice}` : "∞"}`;
      arr.push({ key: "price", label: lbl, clear: () => { setMinPrice(undefined); setMaxPrice(undefined); void doSearch(0, { minPrice: undefined, maxPrice: undefined }); } });
    }
    if (minDailySales != null) arr.push({ key: "ds", label: `日销 ≥ ${minDailySales}`, clear: () => { setMinDailySales(undefined); void doSearch(0, { minDailySales: undefined }); } });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, optIdPath, minPrice, maxPrice, minDailySales, catNameMap]);

  const currentSortLabel = useMemo(() => {
    const sort = SORT_OPTIONS.find((o) => o.value === sortBy)?.label || "日销量";
    return `${sort} ${sortOrder === "DESC" ? "高→低" : "低→高"}`;
  }, [sortBy, sortOrder]);

  const isQuickActive = (ov: Record<string, any>) => Object.entries(ov).every(([key, value]) => {
    if (key === "minDailySales") return minDailySales === value;
    if (key === "minPrice") return minPrice === value;
    if (key === "maxPrice") return maxPrice === value;
    if (key === "sortBy") return sortBy === value;
    if (key === "sortOrder") return sortOrder === value;
    return false;
  });

  // ---- 渲染 ----

  const metricSummary = (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <Metric icon={<SearchOutlined />} color="#16a34a" label="搜索结果" value={intFmt(result.total)} />
      <Metric icon={<StarFilled />} color="#fa8c16" label="选品池" value={intFmt(poolSummary.total || 0)} />
      <div style={{ display: "flex", gap: 6 }}>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => { void loadPoolIds(); void loadPool(); void doSearch(0); }}
        >
          刷新
        </Button>
        {tokenExpired && (
          <Button
            size="small"
            type="primary"
            danger
            icon={<WarningOutlined />}
            loading={refreshingToken}
            onClick={refreshToken}
          >
            刷新登录
          </Button>
        )}
      </div>
    </div>
  );

  const plazaTab = (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <style>{`
        .sp-card{transition:transform .18s ease,box-shadow .22s ease}
        .sp-card:hover{transform:translateY(-3px);box-shadow:0 4px 12px rgba(0,0,0,0.08),0 12px 28px rgba(0,0,0,0.1)!important}
        @keyframes listingBubblePulse{0%,100%{box-shadow:0 4px 16px rgba(22,119,255,0.35)}50%{box-shadow:0 4px 24px rgba(22,119,255,0.55)}}
      `}</style>

      {/* 筛选区 */}
      <Card style={CARD_STYLE} styles={{ body: { padding: "14px 16px" } }}>
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          {metricSummary}

          <div style={{ height: 1, background: "#f0f0f0", margin: "2px 0" }} />

          {/* 搜索行 */}
          <Row gutter={[10, 10]} align="middle">
            <Col xs={24} sm={12} md={7}>
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索商品标题关键词"
                prefix={<SearchOutlined style={{ color: "#bfbfbf" }} />}
                onPressEnter={() => void doSearch(0)}
                allowClear
                size="middle"
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
            <Col xs={12} sm={8} md={4}>
              <Space.Compact style={{ width: "100%" }}>
                <InputNumber value={minPrice} onChange={(v) => setMinPrice(v ?? undefined)} placeholder="最低价$" min={0} style={{ width: "50%" }} />
                <InputNumber value={maxPrice} onChange={(v) => setMaxPrice(v ?? undefined)} placeholder="最高价$" min={0} style={{ width: "50%" }} />
              </Space.Compact>
            </Col>
            <Col xs={8} sm={6} md={3}>
              <InputNumber value={minDailySales} onChange={(v) => setMinDailySales(v ?? undefined)} placeholder="日销≥" min={0} style={{ width: "100%" }} />
            </Col>
            <Col xs={10} sm={8} md={4}>
              <Space.Compact style={{ width: "100%" }}>
                <Select value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} style={{ width: "62%" }} />
                <Select
                  value={sortOrder}
                  onChange={setSortOrder}
                  style={{ width: "38%" }}
                  options={[{ value: "DESC", label: "降序" }, { value: "ASC", label: "升序" }]}
                />
              </Space.Compact>
            </Col>
            <Col xs={6} sm={4} md={2} style={{ minWidth: 80 }}>
              <Button type="primary" block loading={searching} icon={<SearchOutlined />} onClick={() => void doSearch(0)}>
                搜索
              </Button>
            </Col>
          </Row>

          {/* 快捷筛选 + 清空 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <Space size={6} wrap>
              <Text type="secondary" style={{ fontSize: 12 }}>快捷：</Text>
              {QUICK_FILTERS.map((q) => (
                <Button key={q.key} size="small" type={isQuickActive(q.ov) ? "primary" : "default"} icon={q.icon} onClick={() => applyQuick(q.ov)}>
                  {q.label}
                </Button>
              ))}
            </Space>
            <Button size="small" type="text" icon={<ClearOutlined />} disabled={!activeFilters.length} onClick={clearFilters}>
              清空筛选
            </Button>
          </div>

          {/* 活跃筛选标签 */}
          {activeFilters.length > 0 && (
            <Space size={6} wrap>
              <Text type="secondary" style={{ fontSize: 12 }}>已选：</Text>
              {activeFilters.map((f) => (
                <Tag key={f.key} closable color="blue" onClose={(e) => { e.preventDefault(); f.clear(); }} style={{ marginInlineEnd: 0 }}>
                  {f.label}
                </Tag>
              ))}
            </Space>
          )}
        </Space>
      </Card>

      {/* token 过期提示 */}
      {tokenExpired && (
        <Alert
          showIcon
          type="warning"
          icon={<WarningOutlined />}
          message="搜索登录已过期"
          description="实时搜索需要有效的登录凭证。点击「刷新登录」重新获取，约 30 秒后即可恢复搜索。"
          action={
            <Button size="small" type="primary" loading={refreshingToken} onClick={refreshToken}>
              刷新登录
            </Button>
          }
          style={{ borderRadius: 10 }}
        />
      )}

      {/* 结果头 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Space size={8} wrap>
          <Text strong>候选商品</Text>
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>共 {intFmt(result.total)} 件</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>排序：{currentSortLabel}</Text>
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>已加载 {result.items.length} 件</Text>
      </div>

      {/* 商品网格 */}
      {result.items.length === 0 ? (
        <Card style={CARD_STYLE}>
          <Empty description={tokenExpired ? "搜索登录已过期，请先「刷新登录」" : "没有符合条件的商品，换个关键词或筛选条件试试"} />
        </Card>
      ) : (
        <>
          <div style={PRODUCT_GRID_STYLE}>
            {result.items.map((item) => (
              <div key={item.goods_id} style={{ minWidth: 0 }}>
                <ProductCard
                  item={item}
                  inPool={poolIds.has(String(item.goods_id))}
                  onAdd={() => addToPool(item)}
                  onRemove={() => removeFromPool(item.goods_id)}
                  onOpen={() => openProduct(item)}
                />
              </div>
            ))}
          </div>
          <div ref={sentinelRef} style={{ textAlign: "center", padding: "16px 0" }}>
            {loadingMore && <Spin size="small" />}
            {!hasMore && result.items.length > 0 && <Text type="secondary" style={{ fontSize: 12 }}>已加载全部 {intFmt(result.total)} 件</Text>}
          </div>
        </>
      )}
    </Space>
  );

  const poolTab = (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <style>{`
        .sp-card{transition:transform .18s ease,box-shadow .22s ease}
        .sp-card:hover{transform:translateY(-3px);box-shadow:0 4px 12px rgba(0,0,0,0.08),0 12px 28px rgba(0,0,0,0.1)!important}
      `}</style>

      {/* 批量上品工具栏 */}
      {poolRows.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <Space size={8}>
            <Checkbox
              checked={selectedPoolIds.size > 0 && selectedPoolIds.size >= eligiblePoolRows.length && eligiblePoolRows.length > 0}
              indeterminate={selectedPoolIds.size > 0 && selectedPoolIds.size < eligiblePoolRows.length}
              onChange={toggleSelectAll}
            >
              全选可上品
            </Checkbox>
            {selectedPoolIds.size > 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                已选 {selectedPoolIds.size} 件
              </Text>
            )}
          </Space>
          <Space size={8}>
            <Popconfirm
              title={`确定移出选中的 ${selectedPoolIds.size} 件商品？`}
              onConfirm={async () => {
                const ids = [...selectedPoolIds];
                setPoolIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
                setPoolRows((prev) => prev.filter((r) => !selectedPoolIds.has(String(r.goods_id))));
                setSelectedPoolIds(new Set());
                try {
                  await Promise.all(ids.map((id) => api?.selectionRemove({ goodsId: id })));
                  message.success(`已移出 ${ids.length} 件商品`);
                } catch {
                  message.error("部分移出失败");
                  void loadPool();
                  void loadPoolIds();
                }
              }}
              disabled={selectedPoolIds.size === 0}
            >
              <Button
                danger
                icon={<DeleteOutlined />}
                disabled={selectedPoolIds.size === 0}
              >
                批量删除{selectedPoolIds.size > 0 ? `(${selectedPoolIds.size})` : ""}
              </Button>
            </Popconfirm>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              disabled={selectedPoolIds.size === 0}
              onClick={handleBatchExport}
            >
              {selectedPoolIds.size > 0 ? `批量上品(${selectedPoolIds.size})` : "批量上品"}
            </Button>
            <Button
              icon={<GiftOutlined />}
              disabled={selectedPoolIds.size < 2}
              onClick={handleOpenCombo}
              style={{ borderColor: selectedPoolIds.size >= 2 ? "#722ed1" : undefined, color: selectedPoolIds.size >= 2 ? "#722ed1" : undefined }}
            >
              {selectedPoolIds.size >= 2 ? `创建套装(${selectedPoolIds.size})` : "创建套装"}
            </Button>
          </Space>
        </div>
      )}

      {/* 选品池网格 */}
      {poolRows.length === 0 ? (
        <Card style={CARD_STYLE}>
          <Empty description={poolStatusFilter ? `「${STATUS_META[poolStatusFilter]?.label || ""}」状态下暂无商品` : "选品池还是空的，去「商品广场」把想上的品加进来"} />
        </Card>
      ) : (
        <div style={PRODUCT_GRID_STYLE}>
          {poolRows.map((item) => {
            const isSelected = selectedPoolIds.has(item.goods_id);
            return (
              <div
                key={item.goods_id}
                style={{
                  minWidth: 0,
                  position: "relative",
                  borderRadius: 10,
                  outline: isSelected ? `2px solid ${BLUE}` : "none",
                  outlineOffset: -1,
                  transition: "outline .15s ease",
                }}
              >
                <Checkbox
                  checked={isSelected}
                  onChange={() => togglePoolSelect(item.goods_id)}
                  style={{
                    position: "absolute",
                    top: 8,
                    left: 8,
                    zIndex: 2,
                  }}
                />
                <ProductCard
                  item={item}
                  inPool
                  pool
                  onAdd={() => {}}
                  onRemove={() => removeFromPool(item.goods_id)}
                  onOpen={() => openProduct(item)}
                  onStatusChange={(s) => changeStatus(item.goods_id, s)}
                  onNoteUpdate={(n) => updateNote(item.goods_id, n)}
                />
              </div>
            );
          })}
        </div>
      )}
    </Space>
  );

  return (
    <div style={{ padding: 16 }}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
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
      </Space>

      {/* 上品 Drawer */}
      <ListingDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        mode={listingMode === "combo" ? "workflow" : listingMode}
        onModeChange={(m: "classic" | "workflow") => listingTaskStore.setMode(m)}
        products={drawerProducts}
        onRemoveProduct={removeDrawerProduct}
        exporting={listingExporting}
        running={listingRunning}
        paused={listingPaused}
        progress={listingProgress}
        results={listingResults}
        onStart={handleStartListing}
        onTogglePause={handleToggleListingPause}
        onReset={resetListingDrawer}
      />

      {/* 套装 Drawer */}
      <ComboDrawer
        open={comboDrawerOpen}
        onClose={() => setComboDrawerOpen(false)}
        products={poolRows.filter((r) => selectedPoolIds.has(r.goods_id))}
        running={listingRunning && listingMode === "combo"}
        progress={listingMode === "combo" ? listingProgress : null}
        results={listingMode === "combo" ? listingResults : []}
        onStart={handleStartCombo}
      />

      {/* 浮动进度卡片：任务运行中且 Drawer 已关闭时显示 */}
      {listingRunning && !drawerOpen && !comboDrawerOpen && (() => {
        const isCombo = listingMode === "combo";
        const t = Number(listingProgress?.total) || 0;
        const c = Number(listingProgress?.completed) || 0;
        const pct = t > 0 ? Math.round((c / t) * 100) : 0;
        const ok = listingResults.filter((r: any) => r.success).length;
        const fail = listingResults.filter((r: any) => !r.success).length;
        const step = listingProgress?.step || "处理中";
        return (
          <div
            onClick={() => isCombo ? setComboDrawerOpen(true) : setDrawerOpen(true)}
            style={{
              position: "fixed", bottom: 32, right: 32, zIndex: 1050,
              background: "#fff", borderRadius: 14,
              padding: "14px 18px", cursor: "pointer",
              boxShadow: "0 6px 24px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)",
              display: "flex", alignItems: "center", gap: 14,
              minWidth: 220, border: "1px solid #f0f0f0",
              transition: "box-shadow 0.2s",
            }}
          >
            <Progress type="circle" percent={pct} size={44} strokeWidth={6}
              strokeColor={isCombo ? { '0%': '#722ed1', '100%': '#b37feb' } : { '0%': '#1677ff', '100%': '#36cfc9' }}
              format={() => <span style={{ fontSize: 12, fontWeight: 700, color: isCombo ? "#722ed1" : "#1677ff" }}>{pct}%</span>}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#262626", display: "flex", alignItems: "center", gap: 6 }}>
                {isCombo ? "套装上品中" : `上品中 ${c}/${t}`}
                {listingPaused && <Tag color="warning" style={{ margin: 0, fontSize: 11, lineHeight: "18px", padding: "0 4px" }}>暂停</Tag>}
              </div>
              <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {step}
              </div>
              {(ok > 0 || fail > 0) && (
                <div style={{ display: "flex", gap: 8, marginTop: 4, fontSize: 12 }}>
                  {ok > 0 && <span style={{ color: "#52c41a" }}><CheckCircleFilled style={{ marginRight: 2 }} />{ok}</span>}
                  {fail > 0 && <span style={{ color: "#ff4d4f" }}><CloseCircleOutlined style={{ marginRight: 2 }} />{fail}</span>}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ---------- 上品 Drawer ----------

function ListingDrawer({
  open, onClose, mode, onModeChange, products, onRemoveProduct,
  exporting, running, paused, progress, results,
  onStart, onTogglePause, onReset,
}: {
  open: boolean;
  onClose: () => void;
  mode: "classic" | "workflow";
  onModeChange: (m: "classic" | "workflow") => void;
  products: ProductRow[];
  onRemoveProduct: (goodsId: string) => void;
  exporting: boolean;
  running: boolean;
  paused: boolean;
  progress: any;
  results: any[];
  onStart: () => void;
  onTogglePause: () => void;
  onReset: () => void;
}) {
  const isDone = !running && progress && ["completed", "failed", "interrupted"].includes(progress.status);
  const isActive = running || exporting;
  const showSetup = !isActive && !isDone;

  const total = Number(progress?.total) || products.length || 0;
  const completed = Number(progress?.completed) || 0;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Drawer
      title={<span><RocketOutlined style={{ marginRight: 8 }} />批量上品</span>}
      placement="right"
      width={480}
      open={open}
      onClose={onClose}
      destroyOnClose={false}
    >
      {showSetup ? (
        <Space direction="vertical" size={20} style={{ width: "100%" }}>
          {/* 模式切换 */}
          <div>
            <Text strong style={{ display: "block", marginBottom: 8 }}>上品模式</Text>
            <div style={{ display: "flex", gap: 12 }}>
              {([
                { key: "classic" as const, icon: <PictureOutlined />, title: "AI 生图上品", desc: "AI 生成商品图 → 上传 → 创建草稿" },
                { key: "workflow" as const, icon: <AppstoreOutlined />, title: "新上品流程", desc: "2/3/4PCS 白底组合图 → 素材中心 → 草稿" },
              ] as const).map((opt) => {
                const selected = mode === opt.key;
                return (
                  <div
                    key={opt.key}
                    onClick={() => onModeChange(opt.key)}
                    style={{
                      flex: 1,
                      padding: "12px 14px",
                      borderRadius: 10,
                      cursor: "pointer",
                      border: selected ? "2px solid #1677ff" : "2px solid #f0f0f0",
                      background: selected ? "#e6f4ff" : "#fafafa",
                      transition: "all 0.2s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 18, color: selected ? "#1677ff" : "#8c8c8c" }}>{opt.icon}</span>
                      <span style={{ fontWeight: 600, fontSize: 14, color: selected ? "#1677ff" : "#262626" }}>{opt.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#8c8c8c", lineHeight: 1.4 }}>{opt.desc}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 商品清单 */}
          <div>
            <Text strong>已选商品 ({products.length})</Text>
            <div style={{ marginTop: 8, maxHeight: 400, overflowY: "auto" }}>
              {products.map((p) => (
                <div
                  key={p.goods_id}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                    borderBottom: "1px solid #f5f5f5",
                  }}
                >
                  <img
                    src={p.main_image}
                    alt=""
                    style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", background: "#f5f5f5", flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.title_zh || p.title_en || "（无标题）"}
                    </div>
                    <div style={{ fontSize: 12, color: "#8c8c8c" }}>
                      {usd(p.usd_price)} · {p.category_zh || "未分类"}
                    </div>
                  </div>
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => onRemoveProduct(p.goods_id)}
                  />
                </div>
              ))}
              {products.length === 0 && (
                <Empty description="没有已选商品" style={{ padding: "24px 0" }} />
              )}
            </div>
          </div>

          {/* 开始按钮 */}
          <Button
            type="primary"
            block
            size="large"
            icon={<RocketOutlined />}
            disabled={!products.length}
            onClick={onStart}
          >
            开始上品（{products.length} 个商品）
          </Button>
        </Space>
      ) : (
        <Space direction="vertical" size={20} style={{ width: "100%" }}>
          {/* 进度 */}
          <div>
            {exporting ? (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <Spin indicator={<LoadingOutlined style={{ fontSize: 28 }} />} />
                <div style={{ marginTop: 12, color: "#8c8c8c" }}>正在准备商品数据...</div>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>
                  {isDone
                    ? (progress?.status === "completed" ? "上品已完成" : "上品未完成")
                    : paused
                      ? "已暂停"
                      : `正在处理第 ${Math.min(completed + 1, total)} / ${total} 个商品`}
                </div>
                <Progress
                  percent={percent}
                  status={
                    isDone
                      ? (progress?.status === "completed" ? "success" : "exception")
                      : paused ? "normal" : "active"
                  }
                  strokeColor={paused ? "#faad14" : undefined}
                />
                {isDone && (
                  <div style={{ marginTop: 8 }}>
                    <Tag color="green">
                      成功 {results.filter((r) => r.success).length}
                    </Tag>
                    <Tag color="red">
                      失败 {results.filter((r) => !r.success).length}
                    </Tag>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 结果列表 */}
          {results.length > 0 && (
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              {results.map((item: any, i: number) => (
                <div
                  key={i}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0",
                    borderBottom: "1px solid #f5f5f5",
                  }}
                >
                  {item.success ? (
                    <CheckCircleFilled style={{ color: "#52c41a", fontSize: 16, marginTop: 2, flexShrink: 0 }} />
                  ) : (
                    <CloseCircleOutlined style={{ color: "#ff4d4f", fontSize: 16, marginTop: 2, flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.name || item.title || item.productName || `商品 ${i + 1}`}
                    </div>
                    <div style={{ fontSize: 12, color: item.success ? "#52c41a" : "#ff4d4f" }}>
                      {item.message || (item.success ? "草稿已创建" : "处理失败")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 操作按钮 */}
          <div style={{ display: "flex", gap: 8 }}>
            {running && !exporting && (
              <Button
                block
                icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                onClick={onTogglePause}
              >
                {paused ? "继续" : "暂停"}
              </Button>
            )}
            {isDone && (
              <>
                <Button block onClick={onReset}>
                  新一批
                </Button>
                <Button block type="primary" onClick={onClose}>
                  完成
                </Button>
              </>
            )}
          </div>
        </Space>
      )}
    </Drawer>
  );
}

function ComboDrawer({
  open, onClose, products, running, progress, results, onStart,
}: {
  open: boolean;
  onClose: () => void;
  products: ProductRow[];
  running: boolean;
  progress: any;
  results: any[];
  onStart: () => void;
}) {
  const count = products.length;
  const totalUsd = products.reduce((s, p) => s + (Number(p.usd_price) || 0), 0);
  const comboCny = Math.ceil(totalUsd * 7 * 100) / 100;

  const isDone = !running && progress && ["completed", "failed", "interrupted"].includes(progress.status);

  return (
    <Drawer
      title={<span><GiftOutlined style={{ marginRight: 8, color: "#722ed1" }} />创建套装</span>}
      placement="right"
      width={480}
      open={open}
      onClose={onClose}
      destroyOnClose={false}
    >
      <Space direction="vertical" size={20} style={{ width: "100%" }}>
        {/* 套装信息 */}
        <div>
          <Text strong style={{ display: "block", marginBottom: 8 }}>套装商品 ({count} 件)</Text>
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {products.map((p) => (
              <div
                key={p.goods_id}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                  borderBottom: "1px solid #f5f5f5",
                }}
              >
                <img
                  src={p.main_image}
                  alt=""
                  style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", background: "#f5f5f5", flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.title_zh || p.title_en || "（无标题）"}
                  </div>
                  <div style={{ fontSize: 12, color: "#8c8c8c" }}>
                    {usd(p.usd_price)} · {p.category_zh || "未分类"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 定价预览 */}
        <Card size="small" style={{ background: "#f9f0ff", border: "1px solid #d3adf7", borderRadius: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12, color: "#8c8c8c" }}>单品总价(USD)</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{usd(totalUsd)}</div>
            </div>
            <div style={{ fontSize: 20, color: "#d3adf7" }}>→</div>
            <div>
              <div style={{ fontSize: 12, color: "#8c8c8c" }}>申报价(CNY)</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#722ed1" }}>¥{comboCny.toFixed(2)}</div>
            </div>
          </div>
        </Card>

        {/* 进度/结果 */}
        {running && (() => {
          const steps = [
            { key: "下载商品图片", label: "下载商品图片" },
            { key: "AI生图中", label: "AI 生成 9 张详情图" },
            { key: "上传素材", label: "上传素材到平台" },
            { key: "创建草稿", label: "创建商品草稿" },
          ];
          const currentStep = progress?.step || "";
          const currentIdx = steps.findIndex((s) => s.key === currentStep);
          return (
            <div style={{ padding: "8px 0" }}>
              {steps.map((s, i) => {
                const done = currentIdx > i;
                const active = currentIdx === i;
                return (
                  <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
                    {done ? (
                      <CheckCircleFilled style={{ color: "#52c41a", fontSize: 18 }} />
                    ) : active ? (
                      <LoadingOutlined style={{ color: "#722ed1", fontSize: 18 }} />
                    ) : (
                      <div style={{ width: 18, height: 18, borderRadius: 9, border: "2px solid #d9d9d9" }} />
                    )}
                    <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: done ? "#52c41a" : active ? "#722ed1" : "#bfbfbf" }}>
                      {s.label}
                    </span>
                  </div>
                );
              })}
              {progress?.message && (
                <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 8, paddingLeft: 28 }}>{progress.message}</div>
              )}
            </div>
          );
        })()}

        {isDone && results.length > 0 && (
          <div>
            {results.map((item: any, i: number) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
                {item.success ? (
                  <CheckCircleFilled style={{ color: "#52c41a", fontSize: 18 }} />
                ) : (
                  <CloseCircleOutlined style={{ color: "#ff4d4f", fontSize: 18 }} />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{item.name || "套装商品"}</div>
                  <div style={{ fontSize: 12, color: item.success ? "#52c41a" : "#ff4d4f" }}>
                    {item.message || (item.success ? "草稿已创建" : "处理失败")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 操作按钮 */}
        {!running && !isDone && (
          <Button
            type="primary"
            block
            size="large"
            icon={<GiftOutlined />}
            disabled={count < 2}
            onClick={onStart}
            style={{ background: "#722ed1", borderColor: "#722ed1" }}
          >
            生成套装（{count} 件商品）
          </Button>
        )}
        {isDone && (
          <Button block type="primary" onClick={() => { listingTaskStore.reset(); onClose(); }}>
            完成
          </Button>
        )}
      </Space>
    </Drawer>
  );
}

function Metric({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, background: `${color}12`, color, fontSize: 15 }}>
        {icon}
      </span>
      <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.15 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "#262626" }}>{value}</span>
        <span style={{ fontSize: 11, color: "#8c8c8c" }}>{label}</span>
      </span>
    </span>
  );
}
