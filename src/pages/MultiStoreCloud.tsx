import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, DatePicker, Empty, Image, Input, Select, Space, Table, Tabs, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ApiOutlined,
  ChromeOutlined,
  CloudSyncOutlined,
  CopyOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  ShopOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import {
  fetchAgentHeartbeats,
  fetchCaptureEvents,
  fetchCloudStats,
  fetchSkcList,
  fetchTemuSales,
  loadCloudConfig,
  type AgentHeartbeat,
  type CaptureEventRow,
  type CloudConsoleConfig,
  type CloudDashboardStats,
  type CloudEndpointStat,
  type CloudMall,
  type SkcRow,
  type TemuSalesRow,
} from "../utils/cloudClient";

const { Text } = Typography;
const ONLINE_WINDOW_MS = 90_000;

interface CloudPageState {
  loading: boolean;
  cfg: CloudConsoleConfig | null;
  stats: CloudDashboardStats | null;
  agents: AgentHeartbeat[];
  events: CaptureEventRow[];
  skcRows: SkcRow[];
  skcTotal: number;
  salesDate: string;
  salesRows: TemuSalesRow[];
  error: string;
}

interface StoreOption {
  value: string;
  label: string;
  mallName: string;
  mallId: string;
  sites: string[];
  lastSeen: string | null;
}

function getLocalDate() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function formatDateTime(ts?: number | string | null) {
  if (!ts) return "-";
  const time = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(time)) return "-";
  return new Date(time).toLocaleString("zh-CN", { hour12: false });
}

function formatMoney(cents?: number | null, currency?: string | null) {
  if (cents == null) return "-";
  return `${(cents / 100).toFixed(2)}${currency || ""}`;
}

function getLatestAgents(agents: AgentHeartbeat[]) {
  const byDevice = new Map<string, AgentHeartbeat>();
  for (const agent of agents) {
    const key = agent.device_uuid || agent.device_id || "unknown";
    const current = byDevice.get(key);
    if (!current || Number(agent.ts || 0) > Number(current.ts || 0)) {
      byDevice.set(key, agent);
    }
  }
  return Array.from(byDevice.values()).sort((left, right) => Number(right.ts || 0) - Number(left.ts || 0));
}

function isAgentOnline(agent: AgentHeartbeat) {
  const ts = Number(agent.ts || 0);
  return Number.isFinite(ts) && Date.now() - ts < ONLINE_WINDOW_MS;
}

function mallTime(mall: CloudMall) {
  const time = mall.last_seen ? Date.parse(mall.last_seen) : 0;
  return Number.isFinite(time) ? time : 0;
}

function isDiagnosticMall(mall: CloudMall) {
  const id = String(mall.mall_id || "");
  const site = String(mall.site || "");
  return id.startsWith("MALL-DBG") || id.startsWith("MALL-EXT-E2E") || site === "debug" || site === "local-e2e" || site.startsWith("127.0.0.1");
}

function buildStoreOptions(malls: CloudMall[]): StoreOption[] {
  const grouped = new Map<string, StoreOption & { lastSeenTime: number }>();
  for (const mall of malls) {
    if (!mall.mall_id || isDiagnosticMall(mall)) continue;
    const id = String(mall.mall_id);
    const time = mallTime(mall);
    const current = grouped.get(id);
    if (!current) {
      grouped.set(id, {
        value: id,
        label: mall.mall_name || id,
        mallName: mall.mall_name || id,
        mallId: id,
        sites: mall.site ? [mall.site] : [],
        lastSeen: mall.last_seen,
        lastSeenTime: time,
      });
      continue;
    }
    if (mall.site && !current.sites.includes(mall.site)) current.sites.push(mall.site);
    if (time > current.lastSeenTime) {
      current.lastSeen = mall.last_seen;
      current.lastSeenTime = time;
      current.mallName = mall.mall_name || current.mallName;
      current.label = current.mallName;
    }
  }
  return Array.from(grouped.values())
    .sort((left, right) => right.lastSeenTime - left.lastSeenTime)
    .map(({ lastSeenTime: _lastSeenTime, ...option }) => ({
      ...option,
      label: `${option.mallName} / ${option.mallId}`,
    }));
}

export default function MultiStoreCloud() {
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [mallId, setMallId] = useState<string | undefined>();
  const [mallTouched, setMallTouched] = useState(false);
  const [activeTab, setActiveTab] = useState("skc");
  const [salesDate, setSalesDate] = useState(getLocalDate());
  const [extensionDir, setExtensionDir] = useState("");
  const [state, setState] = useState<CloudPageState>({
    loading: true,
    cfg: null,
    stats: null,
    agents: [],
    events: [],
    skcRows: [],
    skcTotal: 0,
    salesDate: getLocalDate(),
    salesRows: [],
    error: "",
  });

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const cfg = await loadCloudConfig();
      if (!cfg) {
        setState((prev) => ({
          ...prev,
          loading: false,
          cfg: null,
          stats: null,
          agents: [],
          events: [],
          skcRows: [],
          skcTotal: 0,
          salesRows: [],
          error: "",
        }));
        return true;
      }

      const [stats, agents, events, skc, sales] = await Promise.all([
        fetchCloudStats(cfg),
        fetchAgentHeartbeats(cfg, { limit: 200 }),
        fetchCaptureEvents(cfg, { limit: 160 }),
        fetchSkcList(cfg, { mall_id: mallId, q: query.trim() || undefined, limit: 200 }),
        fetchTemuSales(cfg, { date: salesDate, mall_id: mallId }),
      ]);

      setState({
        loading: false,
        cfg,
        stats,
        agents,
        events,
        skcRows: skc.rows || [],
        skcTotal: skc.total || 0,
        salesDate: sales.date,
        salesRows: sales.rows || [],
        error: "",
      });
      return true;
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error?.message || "读取云端采集数据失败",
      }));
      return false;
    }
  }, [mallId, query, salesDate]);

  useEffect(() => {
    refresh(true).catch(() => {});
  }, [refresh]);

  useEffect(() => {
    window.electronAPI?.app?.getExtensionDirectory?.()
      .then((dir: string) => setExtensionDir(dir))
      .catch(() => {});
  }, []);

  const latestAgents = useMemo(() => getLatestAgents(state.agents), [state.agents]);
  const onlineAgents = latestAgents.filter(isAgentOnline);
  const queueDepth = onlineAgents.reduce((sum, agent) => sum + Number(agent.queue_depth || 0), 0);
  const storeOptions = useMemo(() => buildStoreOptions(state.stats?.malls || []), [state.stats?.malls]);
  const activeStore = useMemo(() => (
    storeOptions.find((option) => option.value === mallId) || null
  ), [mallId, storeOptions]);

  useEffect(() => {
    if (mallTouched || mallId || !storeOptions.length) return;
    setMallId(storeOptions[0].value);
  }, [mallId, mallTouched, storeOptions]);

  const agentColumns: ColumnsType<AgentHeartbeat> = [
    {
      title: "设备",
      dataIndex: "device_uuid",
      width: 190,
      render: (value: string | null, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{value ? value.slice(0, 12) : row.device_id?.slice(0, 12) || "-"}</Text>
          <Tag color={isAgentOnline(row) ? "success" : "default"} style={{ width: "fit-content", margin: 0 }}>
            {isAgentOnline(row) ? "在线" : "离线"}
          </Tag>
        </Space>
      ),
    },
    { title: "捕获", dataIndex: "captured_count", width: 90 },
    { title: "已上报", dataIndex: "total_sent", width: 90 },
    { title: "队列", dataIndex: "queue_depth", width: 80 },
    {
      title: "Hook",
      dataIndex: "hook_xhr_alive",
      width: 100,
      render: (value: number | null) => (
        value === 1 ? <Tag color="success">正常</Tag> : value === 0 ? <Tag color="error">异常</Tag> : <Tag>等待</Tag>
      ),
    },
    {
      title: "最近页面",
      dataIndex: "page_url",
      ellipsis: true,
      render: (value: string | null) => value || "-",
    },
    {
      title: "心跳",
      dataIndex: "ts",
      width: 180,
      render: formatDateTime,
    },
  ];

  const endpointColumns: ColumnsType<CloudEndpointStat> = [
    { title: "接口", dataIndex: "url_path", ellipsis: true },
    { title: "站点", dataIndex: "site", width: 140, render: (value) => value || "-" },
    { title: "方法", dataIndex: "method", width: 80 },
    { title: "次数", dataIndex: "count_total", width: 90, sorter: (a, b) => a.count_total - b.count_total },
    { title: "最近命中", dataIndex: "last_seen", width: 180, render: formatDateTime },
  ];

  const eventColumns: ColumnsType<CaptureEventRow> = [
    { title: "时间", dataIndex: "ts", width: 180, render: formatDateTime },
    { title: "店铺", dataIndex: "mall_id", width: 140, render: (value) => value || "-" },
    { title: "站点", dataIndex: "site", width: 130, render: (value) => value || "-" },
    { title: "方法", dataIndex: "method", width: 80 },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (value: number | null) => value == null ? "-" : (
        <Tag color={value >= 200 && value < 400 ? "success" : "warning"}>{value}</Tag>
      ),
    },
    { title: "接口", dataIndex: "url_path", ellipsis: true },
    { title: "大小", dataIndex: "body_size", width: 100, render: (value) => value ? `${Math.round(Number(value) / 1024)} KB` : "-" },
  ];

  const skcColumns: ColumnsType<SkcRow> = [
    {
      title: "商品",
      dataIndex: "title",
      width: 340,
      render: (_value, row) => (
        <div className="product-list-product-cell">
          <div className="product-list-product-thumb">
            {row.thumb_url ? <Image src={row.thumb_url} preview={false} /> : <DatabaseOutlined />}
          </div>
          <div className="product-list-product-meta">
            <div className="product-list-product-title app-line-clamp-2">{row.title || "-"}</div>
            <div className="app-table-meta">
              <Tag>SKC {row.skc_id}</Tag>
              {row.product_id ? <Tag>SPU {row.product_id}</Tag> : null}
              {row.mall_id ? <Tag color="blue">{row.mall_id}</Tag> : null}
            </div>
          </div>
        </div>
      ),
    },
    { title: "类目", dataIndex: "category_name", width: 160, render: (value) => value || "-" },
    { title: "状态", dataIndex: "status", width: 110, render: (value) => value ? <Tag>{value}</Tag> : "-" },
    { title: "申报价", dataIndex: "declared_price_cents", width: 120, render: (value, row) => formatMoney(value, row.price_currency) },
    { title: "建议价", dataIndex: "suggested_price_cents", width: 120, render: (value, row) => formatMoney(value, row.price_currency) },
    { title: "销量", dataIndex: "sales_total", width: 90, render: (value) => value ?? "-" },
    { title: "库存", dataIndex: "stock_available", width: 90, render: (value) => value ?? "-" },
    { title: "更新", dataIndex: "last_updated_at", width: 180, render: formatDateTime },
  ];

  const salesColumns: ColumnsType<TemuSalesRow> = [
    {
      title: "SKC",
      dataIndex: "skc_id",
      width: 260,
      render: (value: string, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{value}</Text>
          <Text type="secondary" className="app-line-clamp-2">{row.title || "-"}</Text>
        </Space>
      ),
    },
    { title: "今日", dataIndex: "today_sales", width: 90, render: (value) => value ?? "-" },
    { title: "7日", dataIndex: "last7d_sales", width: 90, render: (value) => value ?? "-" },
    { title: "30日", dataIndex: "last30d_sales", width: 90, render: (value) => value ?? "-" },
    { title: "累计", dataIndex: "total_sales", width: 90, render: (value) => value ?? "-" },
    { title: "仓库库存", dataIndex: "warehouse_stock", width: 110, render: (value) => value ?? "-" },
    { title: "建议备货", dataIndex: "advice_qty", width: 110, render: (value) => value ?? "-" },
    { title: "可售天数", dataIndex: "available_sale_days", width: 110, render: (value) => value ?? "-" },
    { title: "申报价", dataIndex: "declared_price_cents", width: 120, render: (value, row) => formatMoney(value, row.price_currency) },
    { title: "更新", dataIndex: "last_updated_at", width: 180, render: formatDateTime },
  ];

  const handleRefresh = async () => {
    const ok = await refresh(false);
    if (ok) message.success("云端采集数据已刷新");
  };

  const copyText = async (value: string, successText = "已复制") => {
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
      message.success(successText);
    } catch {
      message.error("复制失败");
    }
  };

  const handleOpenExtensionDir = async () => {
    try {
      const dir = await window.electronAPI?.app?.openExtensionDirectory?.();
      if (dir) setExtensionDir(dir);
    } catch (e: any) {
      message.error(e?.message || "打开扩展目录失败");
    }
  };

  const handleApplyFilters = () => {
    const nextQuery = searchText.trim();
    if (nextQuery === query) {
      void refresh(false);
    } else {
      setQuery(nextQuery);
    }
  };

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="数据"
        title="云端采集"
        subtitle="浏览器扩展上报、服务器入仓、桌面端读取同一套云端数据"
        meta={[
          state.cfg?.endpoint || "未配置云端",
          state.stats ? `24小时 ${state.stats.last24h} 条` : "等待连接",
        ]}
        actions={[
          <Button key="settings" icon={<ApiOutlined />} onClick={() => navigate("/settings")}>
            云端设置
          </Button>,
          <Button key="refresh" type="primary" icon={<ReloadOutlined />} loading={state.loading} onClick={handleRefresh}>
            刷新
          </Button>,
        ]}
      />

      {!state.cfg ? (
        <Alert
          type="warning"
          showIcon
          message="云端地址或 Token 未配置"
          description="到系统设置里保存云端地址和 Token 后，这里会显示扩展心跳、上报事件、SKC 聚合与销售快照。"
          action={<Button size="small" onClick={() => navigate("/settings")}>去设置</Button>}
        />
      ) : null}

      {state.error ? <Alert type="error" showIcon message="读取失败" description={state.error} /> : null}

      {state.cfg && !state.loading && latestAgents.length === 0 && (state.stats?.total ?? 0) === 0 ? (
        <Alert
          type="warning"
          showIcon
          message="还没有收到浏览器扩展心跳"
          description={
            <Space direction="vertical" size={6}>
              <Text>
                云端已连接，但服务器还没有收到扩展上报。请在 Chrome 扩展管理页加载本机扩展目录，配置同一个云端地址和 Token，然后刷新 Temu 卖家中心。
              </Text>
              {extensionDir ? <Text code copyable={{ text: extensionDir }}>{extensionDir}</Text> : null}
            </Space>
          }
          action={
            <Space wrap>
              <Button size="small" icon={<FolderOpenOutlined />} onClick={handleOpenExtensionDir}>
                打开扩展目录
              </Button>
              <Button size="small" icon={<CopyOutlined />} disabled={!extensionDir} onClick={() => copyText(extensionDir, "扩展目录已复制")}>
                复制目录
              </Button>
              <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(state.cfg?.endpoint || "", "云端地址已复制")}>
                复制地址
              </Button>
              <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(state.cfg?.token || "", "Token 已复制")}>
                复制 Token
              </Button>
            </Space>
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {state.cfg ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <StatCard compact title="店铺" value={storeOptions.length} icon={<ShopOutlined />} color="blue" footer={activeStore ? activeStore.label : "请选择店铺"} />
            <StatCard compact title="商品 SKC" value={state.skcTotal} icon={<DatabaseOutlined />} color="purple" footer={`当前显示 ${state.skcRows.length} 条`} />
            <StatCard compact title="销售快照" value={state.salesRows.length} icon={<CloudSyncOutlined />} color="brand" footer={state.salesDate || salesDate} />
            <StatCard compact title="上报事件" value={state.stats?.total ?? 0} icon={<ApiOutlined />} color="neutral" footer={`24小时 ${state.stats?.last24h ?? 0} 条`} />
            <StatCard compact title="在线设备" value={onlineAgents.length} icon={<ChromeOutlined />} color="success" footer={`总设备 ${latestAgents.length}`} />
            <StatCard compact title="待上报队列" value={queueDepth} icon={<ApiOutlined />} color={queueDepth > 0 ? "danger" : "neutral"} footer={queueDepth > 0 ? "等待扩展 flush" : "队列清空"} />
          </div>

          <div className="app-panel">
            <div className="app-panel__title">
              <div>
                <div className="app-panel__title-main">店铺商品</div>
                <div className="app-panel__title-sub">以店铺为范围，按商品 SKC 查看云端入仓后的实时数据</div>
              </div>
            </div>
            <div className="app-toolbar" style={{ gridTemplateColumns: "minmax(260px, 0.9fr) minmax(240px, 1fr) minmax(180px, 0.5fr) auto" }}>
              <Select
                allowClear
                placeholder="全部店铺"
                value={mallId}
                options={storeOptions.map(({ value, label }) => ({ value, label }))}
                onChange={(value) => {
                  setMallTouched(true);
                  setMallId(value);
                }}
              />
              <Input.Search
                allowClear
                placeholder="搜索 SKC、SPU、标题"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                onSearch={handleApplyFilters}
              />
              <DatePicker
                value={dayjs(salesDate)}
                onChange={(value) => setSalesDate(value ? value.format("YYYY-MM-DD") : getLocalDate())}
                style={{ width: "100%" }}
              />
              <Button icon={<ReloadOutlined />} loading={state.loading} onClick={handleApplyFilters}>
                应用
              </Button>
            </div>
            {activeStore ? (
              <div className="app-table-meta" style={{ marginTop: 12 }}>
                <Tag color="blue">当前店铺 {activeStore.mallName}</Tag>
                <Tag>店铺 ID {activeStore.mallId}</Tag>
                <Tag>{activeStore.sites.join(" / ") || "-"}</Tag>
                <Tag>最近采集 {formatDateTime(activeStore.lastSeen)}</Tag>
              </div>
            ) : null}
          </div>

          <div className="app-panel">
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: "skc",
                  label: `商品/SKC ${state.skcTotal}`,
                  children: (
                    <Table
                      rowKey={(row) => `${row.mall_id || "-"}-${row.skc_id}`}
                      size="small"
                      loading={state.loading}
                      columns={skcColumns}
                      dataSource={state.skcRows}
                      pagination={{ pageSize: 10 }}
                      scroll={{ x: 1260 }}
                      locale={{ emptyText: <Empty description="暂无店铺 SKC 数据" /> }}
                    />
                  ),
                },
                {
                  key: "sales",
                  label: `销售快照 ${state.salesRows.length}`,
                  children: (
                    <Table
                      rowKey={(row) => `${row.stat_date}-${row.mall_supplier_id || "-"}-${row.skc_id}`}
                      size="small"
                      loading={state.loading}
                      columns={salesColumns}
                      dataSource={state.salesRows}
                      pagination={{ pageSize: 10 }}
                      scroll={{ x: 1280 }}
                      locale={{ emptyText: <Empty description={`${state.salesDate} 暂无销售快照`} /> }}
                    />
                  ),
                },
                {
                  key: "events",
                  label: `采集事件 ${state.events.length}`,
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      loading={state.loading}
                      columns={eventColumns}
                      dataSource={state.events}
                      pagination={{ pageSize: 12 }}
                      scroll={{ x: 980 }}
                      locale={{ emptyText: <Empty description="暂无上报事件" /> }}
                    />
                  ),
                },
              ]}
            />
          </div>

          <div className="app-two-column">
            <div className="app-panel">
              <div className="app-panel__title">
                <div className="app-panel__title-main">扩展心跳</div>
              </div>
              <Table
                rowKey={(row) => row.id || `${row.device_uuid}-${row.ts}`}
                size="small"
                loading={state.loading}
                columns={agentColumns}
                dataSource={latestAgents}
                pagination={{ pageSize: 5 }}
                scroll={{ x: 900 }}
                locale={{ emptyText: <Empty description="暂无扩展心跳" /> }}
              />
            </div>

            <div className="app-panel">
              <div className="app-panel__title">
                <div className="app-panel__title-main">Top 接口</div>
              </div>
              <Table
                rowKey={(row) => `${row.site}-${row.method}-${row.url_path}`}
                size="small"
                loading={state.loading}
                columns={endpointColumns}
                dataSource={state.stats?.topEndpoints || []}
                pagination={{ pageSize: 5 }}
                scroll={{ x: 760 }}
                locale={{ emptyText: <Empty description="暂无接口统计" /> }}
              />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
