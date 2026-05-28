import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

interface ReportStore {
  mall_id: string;
  mall_name: string | null;
  site: string | null;
  mall_last_seen: string | null;
  store_code: string | null;
  store_status: string;
  dict_remark: string | null;
  sales: { today_qty: number; last7d_qty: number; last30d_qty: number; sku_count: number };
  stock_orders: { total: number; pending: number; demand_qty: number; delivered_qty: number };
  activities: { count: number; unique: number; skc_count: number };
  shop_stats: {
    stat_date: string | null;
    sale_volume: number;
    sale_7d: number;
    sale_30d: number;
    on_sale_skc: number;
    wait_skc: number;
    lack_skc: number;
    advice_prepare_skc: number;
    about_to_sell_out_skc: number;
    already_sold_out_skc: number;
    high_price_limit_skc: number;
    after_sale_ratio_90d: string | number | null;
    last_updated_at: string | null;
  };
  after_sales: { count: number };
  health: { last_capture_at: number | null; captures_total: number; lag_seconds: number | null };
}

interface ReportData {
  generated_at: number;
  cloud_tenant_id: string | null;
  store_count: number;
  stores: ReportStore[];
  unmapped: ReportStore[];
}

interface MultiStoreResponse {
  ok: boolean;
  error?: string;
  data?: ReportData;
}

const REFRESH_MS = 5 * 60 * 1000; // 5 分钟自动刷新一次
const STALE_THRESHOLD_SECONDS = 2 * 60 * 60; // 2 小时无数据视为掉线

function fmtNum(n: number | null | undefined) {
  if (n == null) return "-";
  return n.toLocaleString("zh-CN");
}

function fmtLag(seconds: number | null) {
  if (seconds == null) return "未上传";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function lagColor(seconds: number | null): string {
  if (seconds == null) return "default";
  if (seconds < 600) return "success"; // 10min 内
  if (seconds < STALE_THRESHOLD_SECONDS) return "processing"; // 2h 内
  return "error"; // 超 2h
}

function StoreCell({ store }: { store: ReportStore }) {
  return (
    <div>
      <Typography.Text strong>{store.store_code || "—"}</Typography.Text>
      <div style={{ color: "#888", fontSize: 12, lineHeight: 1.4 }}>{store.mall_name || "(未命名)"}</div>
    </div>
  );
}

export default function MultiStoreReport() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("daily");

  const load = useCallback(async () => {
    if (!window.electronAPI?.erp?.reports?.multiStore) {
      setError("当前版本不支持多店报表（IPC 未注册），请升级桌面端");
      return;
    }
    setLoading(true);
    try {
      const resp = (await window.electronAPI.erp.reports.multiStore({ includeTest: false })) as MultiStoreResponse;
      if (!resp.ok || !resp.data) {
        setError(resp.error || "未知错误");
        setData(null);
      } else {
        setData(resp.data);
        setError(null);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const stores = data?.stores || [];

  const summary = useMemo(() => {
    if (!stores.length) return null;
    const onlineCount = stores.filter((s: ReportStore) => s.health.lag_seconds != null && s.health.lag_seconds < STALE_THRESHOLD_SECONDS).length;
    const totalSales7d = stores.reduce((acc: number, s: ReportStore) => acc + (s.sales.last7d_qty || 0), 0);
    const totalPending = stores.reduce((acc: number, s: ReportStore) => acc + (s.stock_orders.pending || 0), 0);
    const totalActivities = stores.reduce((acc: number, s: ReportStore) => acc + (s.activities.count || 0), 0);
    return { onlineCount, totalSales7d, totalPending, totalActivities };
  }, [stores]);

  // === Tab 1: 运营日报 ===
  const dailyColumns: ColumnsType<ReportStore> = [
    {
      title: "店号 / 店铺",
      key: "store",
      width: 180,
      fixed: "left",
      render: (_, store) => <StoreCell store={store} />,
      sorter: (a, b) => (a.store_code || "").localeCompare(b.store_code || ""),
      defaultSortOrder: "ascend",
    },
    {
      title: "今日销量",
      dataIndex: ["sales", "today_qty"],
      width: 100,
      align: "right",
      render: (v) => fmtNum(v),
      sorter: (a, b) => (a.sales.today_qty || 0) - (b.sales.today_qty || 0),
    },
    {
      title: "近 7 天",
      dataIndex: ["sales", "last7d_qty"],
      width: 100,
      align: "right",
      render: (v) => fmtNum(v),
      sorter: (a, b) => (a.sales.last7d_qty || 0) - (b.sales.last7d_qty || 0),
    },
    {
      title: "待发备货",
      dataIndex: ["stock_orders", "pending"],
      width: 100,
      align: "right",
      render: (v: number) => v > 0 ? <Tag color="orange">{fmtNum(v)}</Tag> : <span>—</span>,
      sorter: (a, b) => (a.stock_orders.pending || 0) - (b.stock_orders.pending || 0),
    },
    {
      title: "活动报名",
      dataIndex: ["activities", "count"],
      width: 100,
      align: "right",
      render: (v) => fmtNum(v),
      sorter: (a, b) => (a.activities.count || 0) - (b.activities.count || 0),
    },
    {
      title: "SKU 数",
      dataIndex: ["sales", "sku_count"],
      width: 100,
      align: "right",
      render: (v) => fmtNum(v),
      sorter: (a, b) => (a.sales.sku_count || 0) - (b.sales.sku_count || 0),
    },
    {
      title: "数据上报",
      key: "lag",
      width: 120,
      render: (_, s) => (
        <Tag color={lagColor(s.health.lag_seconds)}>
          {fmtLag(s.health.lag_seconds)}前
        </Tag>
      ),
      sorter: (a, b) => (a.health.lag_seconds ?? Infinity) - (b.health.lag_seconds ?? Infinity),
    },
  ];

  // === Tab 2: 老板周/月报（横向对比）===
  const monthlyColumns: ColumnsType<ReportStore> = [
    {
      title: "店号 / 店铺",
      key: "store",
      width: 180,
      fixed: "left",
      render: (_, store) => <StoreCell store={store} />,
      sorter: (a, b) => (a.store_code || "").localeCompare(b.store_code || ""),
    },
    {
      title: "近 7 天销量",
      dataIndex: ["sales", "last7d_qty"],
      width: 110,
      align: "right",
      render: (v) => fmtNum(v),
      sorter: (a, b) => (a.sales.last7d_qty || 0) - (b.sales.last7d_qty || 0),
      defaultSortOrder: "descend",
    },
    {
      title: "近 30 天销量",
      dataIndex: ["sales", "last30d_qty"],
      width: 110,
      align: "right",
      render: (v) => fmtNum(v),
      sorter: (a, b) => (a.sales.last30d_qty || 0) - (b.sales.last30d_qty || 0),
    },
    {
      title: "在售 SKC",
      dataIndex: ["shop_stats", "on_sale_skc"],
      width: 100,
      align: "right",
      render: (v) => fmtNum(v),
      sorter: (a, b) => (a.shop_stats.on_sale_skc || 0) - (b.shop_stats.on_sale_skc || 0),
    },
    {
      title: "已售罄",
      dataIndex: ["shop_stats", "already_sold_out_skc"],
      width: 100,
      align: "right",
      render: (v: number) => v > 0 ? <Tag color="red">{fmtNum(v)}</Tag> : <span>—</span>,
      sorter: (a, b) => (a.shop_stats.already_sold_out_skc || 0) - (b.shop_stats.already_sold_out_skc || 0),
    },
    {
      title: "缺货中",
      dataIndex: ["shop_stats", "lack_skc"],
      width: 100,
      align: "right",
      render: (v: number) => v > 0 ? <Tag color="orange">{fmtNum(v)}</Tag> : <span>—</span>,
      sorter: (a, b) => (a.shop_stats.lack_skc || 0) - (b.shop_stats.lack_skc || 0),
    },
    {
      title: "活动 SKC",
      dataIndex: ["activities", "skc_count"],
      width: 100,
      align: "right",
      render: (v) => fmtNum(v),
      sorter: (a, b) => (a.activities.skc_count || 0) - (b.activities.skc_count || 0),
    },
    {
      title: "售后率 90d",
      dataIndex: ["shop_stats", "after_sale_ratio_90d"],
      width: 110,
      align: "right",
      render: (v) => (v == null || v === "" ? "—" : String(v)),
    },
  ];

  // === Tab 3: 运维监控 ===
  const opsColumns: ColumnsType<ReportStore> = [
    {
      title: "店号 / 店铺",
      key: "store",
      width: 200,
      fixed: "left",
      render: (_, store) => <StoreCell store={store} />,
      sorter: (a, b) => (a.store_code || "").localeCompare(b.store_code || ""),
    },
    {
      title: "状态",
      key: "status",
      width: 100,
      render: (_, s) => {
        const sec = s.health.lag_seconds;
        if (sec == null) return <Badge status="default" text="从未上报" />;
        if (sec < 600) return <Badge status="success" text="实时" />;
        if (sec < STALE_THRESHOLD_SECONDS) return <Badge status="processing" text="活跃" />;
        return <Badge status="error" text="滞后" />;
      },
      sorter: (a, b) => (a.health.lag_seconds ?? Infinity) - (b.health.lag_seconds ?? Infinity),
      defaultSortOrder: "descend",
    },
    {
      title: "最近上报",
      key: "last_capture",
      width: 180,
      render: (_, s) => {
        if (!s.health.last_capture_at) return <span style={{ color: "#999" }}>无</span>;
        const date = new Date(s.health.last_capture_at);
        return (
          <Tooltip title={date.toLocaleString("zh-CN")}>
            <span>{fmtLag(s.health.lag_seconds)}前</span>
          </Tooltip>
        );
      },
      sorter: (a, b) => (a.health.last_capture_at || 0) - (b.health.last_capture_at || 0),
    },
    {
      title: "累计抓取",
      dataIndex: ["health", "captures_total"],
      width: 100,
      align: "right",
      render: (v) => fmtNum(v),
      sorter: (a, b) => (a.health.captures_total || 0) - (b.health.captures_total || 0),
    },
    {
      title: "店铺数据日期",
      dataIndex: ["shop_stats", "stat_date"],
      width: 120,
      render: (v) => v || <span style={{ color: "#999" }}>—</span>,
    },
    {
      title: "mall_id",
      dataIndex: "mall_id",
      width: 180,
      render: (v) => <Typography.Text type="secondary" copyable={{ text: v }}>{v}</Typography.Text>,
    },
    {
      title: "站点",
      dataIndex: "site",
      width: 140,
      render: (v) => v || "—",
    },
  ];

  const tabItems = [
    {
      key: "daily",
      label: "运营日报",
      children: (
        <Table<ReportStore>
          dataSource={stores}
          columns={dailyColumns}
          rowKey="mall_id"
          size="small"
          pagination={false}
          scroll={{ x: 900 }}
          loading={loading}
        />
      ),
    },
    {
      key: "monthly",
      label: "老板周/月",
      children: (
        <Table<ReportStore>
          dataSource={stores}
          columns={monthlyColumns}
          rowKey="mall_id"
          size="small"
          pagination={false}
          scroll={{ x: 1000 }}
          loading={loading}
        />
      ),
    },
    {
      key: "ops",
      label: "运维监控",
      children: (
        <>
          {data?.unmapped && data.unmapped.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={`检测到 ${data.unmapped.length} 个店铺在云端有数据，但本地字典未登记`}
              description={
                <div style={{ fontSize: 12 }}>
                  {data.unmapped.map((u: ReportStore) => (
                    <div key={u.mall_id}>
                      {u.mall_id} · {u.mall_name || "(未命名)"}
                    </div>
                  ))}
                  <div style={{ marginTop: 6, color: "#888" }}>
                    跑 <code>scripts/seed-temu-malls.cjs</code> 时把它们加上 store_code。
                  </div>
                </div>
              }
            />
          )}
          <Table<ReportStore>
            dataSource={stores}
            columns={opsColumns}
            rowKey="mall_id"
            size="small"
            pagination={false}
            scroll={{ x: 1100 }}
            loading={loading}
          />
        </>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card
        title="多店数据报表"
        extra={
          <Space>
            {data?.generated_at && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                生成于 {new Date(data.generated_at).toLocaleString("zh-CN")}
              </Typography.Text>
            )}
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => { load(); message.success("已刷新"); }}>
              刷新
            </Button>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        {summary && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            <Statistic title="店铺总数" value={data?.store_count || 0} suffix={`/ ${summary.onlineCount} 实时`} />
            <Statistic title="近 7 天销量合计" value={summary.totalSales7d} />
            <Statistic title="待发备货合计" value={summary.totalPending} valueStyle={summary.totalPending > 0 ? { color: "#fa8c16" } : undefined} />
            <Statistic title="活动报名合计" value={summary.totalActivities} />
          </div>
        )}
      </Card>

      {error && (
        <Alert
          type="error"
          showIcon
          message="加载失败"
          description={error}
          style={{ marginBottom: 16 }}
          action={<Button onClick={load} size="small">重试</Button>}
        />
      )}

      {!error && stores.length === 0 && !loading && (
        <Card>
          <Empty description="暂无店铺数据 —— 请先在主控端跑 scripts/seed-temu-malls.cjs" />
        </Card>
      )}

      {!error && stores.length > 0 && (
        <Card bodyStyle={{ padding: 0 }}>
          <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} tabBarStyle={{ paddingLeft: 16, marginBottom: 0 }} />
        </Card>
      )}
    </div>
  );
}
