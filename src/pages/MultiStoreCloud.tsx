/**
 * 多店云监控 — 桌面端控制台
 * 连接 cloud server 看 20+ 家店运营浏览器扩展上报的真实数据
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Badge, Button, Card, Col, Drawer, Empty, Form, Input, Modal, Row,
  Space, Statistic, Table, Tabs, Tag, Tooltip, message,
} from "antd";
import {
  ApiOutlined, AreaChartOutlined, BarChartOutlined, CheckCircleOutlined, CloseCircleOutlined, CloudServerOutlined,
  DesktopOutlined, EyeOutlined, PieChartOutlined, ReloadOutlined, SettingOutlined, ShopOutlined,
} from "@ant-design/icons";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend,
  Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from "recharts";
import {
  AgentHeartbeat, CaptureEvent, CategoryBucket, CloudConsoleConfig, MallSummary,
  Stats, StatusBucket, TimelinePoint,
  clearCloudConfig, fetchAgent, fetchByCategory, fetchByMall, fetchEventBody, fetchEvents,
  fetchStats, fetchStatusBreakdown, fetchTimeline,
  loadCloudConfig, login as cloudLogin, ping, saveCloudConfig,
} from "../utils/cloudClient";

// 别名让上面 useEffect 里的 login 调用清晰
const login = cloudLogin;

const REFRESH_MS = 5000;

export default function MultiStoreCloud() {
  const [cfg, setCfg] = useState<CloudConsoleConfig | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [agents, setAgents] = useState<AgentHeartbeat[]>([]);
  const [events, setEvents] = useState<CaptureEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bodyOpen, setBodyOpen] = useState<{ id: string; body: any } | null>(null);

  // 启动时加载配置；如果没配置，尝试用 cloud 默认 admin/changeme123 自动登录
  useEffect(() => {
    (async () => {
      const c = await loadCloudConfig();
      if (c) { setCfg(c); return; }
      // 自动尝试：如果环境里能猜到 cloud URL（之前用户配过又被清的话不重复），尝试 admin/changeme123
      // 失败就打开手动配置 Drawer
      const guessUrl = "http://43.156.121.172:8788";
      try {
        const r = await login(guessUrl, "admin", "changeme123");
        const auto = { endpoint: guessUrl, token: r.token };
        await saveCloudConfig(auto);
        setCfg(auto);
        message.success("已自动连接 cloud 默认管理员（admin）");
      } catch {
        setCfgOpen(true);
      }
    })();
  }, []);

  const refresh = useCallback(async () => {
    if (!cfg) return;
    setLoading(true);
    setError(null);
    try {
      const [s, a, e] = await Promise.all([fetchStats(cfg), fetchAgent(cfg), fetchEvents(cfg, 100)]);
      setStats(s);
      setAgents(a);
      setEvents(e);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [cfg]);

  // 自动刷新
  useEffect(() => {
    if (!cfg) return;
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [cfg, refresh]);

  // 按 device_uuid 取最新心跳
  const latestAgents = useMemo(() => {
    const map = new Map<string, AgentHeartbeat>();
    for (const a of agents) if (!map.has(a.device_uuid)) map.set(a.device_uuid, a);
    return Array.from(map.values());
  }, [agents]);

  if (!cfg) {
    return (
      <div style={{ padding: 24 }}>
        <Card>
          <Empty
            image={<CloudServerOutlined style={{ fontSize: 60, color: "#0969da" }} />}
            description={<span>未配置云端</span>}
          >
            <Button type="primary" icon={<SettingOutlined />} onClick={() => setCfgOpen(true)}>
              配置云端 URL 和 Token
            </Button>
          </Empty>
        </Card>
        <ConfigDrawer open={cfgOpen} onClose={() => setCfgOpen(false)} cfg={cfg} onSaved={(c) => { setCfg(c); setCfgOpen(false); }} />
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
        <Col>
          <Space size="small">
            <CloudServerOutlined style={{ color: "#0969da" }} />
            <strong>多店云监控</strong>
            <Tag>{cfg.endpoint}</Tag>
            {error
              ? <Badge status="error" text={<span style={{ color: "#cf222e" }}>连接失败</span>} />
              : <Badge status="processing" text={`每 ${REFRESH_MS / 1000}s 自动刷新`} />}
          </Space>
        </Col>
        <Col>
          <Space>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={refresh}>立即刷新</Button>
            <Button icon={<SettingOutlined />} onClick={() => setCfgOpen(true)}>配置</Button>
          </Space>
        </Col>
      </Row>

      {error && <Alert type="error" message={error} closable onClose={() => setError(null)} style={{ marginBottom: 12 }} />}

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={5}><Card size="small"><Statistic title="总事件" value={stats?.total ?? 0} /></Card></Col>
        <Col span={5}><Card size="small"><Statistic title="最近 24h" value={stats?.last24h ?? 0} /></Card></Col>
        <Col span={5}><Card size="small"><Statistic title="设备数" value={(stats?.devices || []).length} prefix={<DesktopOutlined />} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="店铺数" value={(stats?.malls || []).length} prefix={<ShopOutlined />} /></Card></Col>
        <Col span={5}><Card size="small"><Statistic title="不同 endpoint" value={(stats?.topEndpoints || []).length} prefix={<ApiOutlined />} /></Card></Col>
      </Row>

      <Tabs
        defaultActiveKey="charts"
        items={[
          {
            key: "charts",
            label: <span><AreaChartOutlined /> 可视化</span>,
            children: <Charts cfg={cfg} stats={stats} />,
          },
          {
            key: "agents",
            label: <span><DesktopOutlined /> 设备心跳 ({latestAgents.length})</span>,
            children: <AgentsTable agents={latestAgents} />,
          },
          {
            key: "malls",
            label: <span><ShopOutlined /> 店铺 ({(stats?.malls || []).length})</span>,
            children: <MallsTable malls={stats?.malls || []} />,
          },
          {
            key: "endpoints",
            label: <span><ApiOutlined /> 接口排行 ({(stats?.topEndpoints || []).length})</span>,
            children: <EndpointsTable endpoints={stats?.topEndpoints || []} />,
          },
          {
            key: "events",
            label: <span><EyeOutlined /> 最近事件 ({events.length})</span>,
            children: <EventsTable events={events} cfg={cfg} onView={setBodyOpen} />,
          },
        ]}
      />

      <ConfigDrawer open={cfgOpen} onClose={() => setCfgOpen(false)} cfg={cfg} onSaved={(c) => { setCfg(c); setCfgOpen(false); refresh(); }} />

      <Modal
        open={!!bodyOpen}
        onCancel={() => setBodyOpen(null)}
        title={`事件 body: ${bodyOpen?.id?.slice(0, 8) || ""}`}
        footer={null}
        width={800}
      >
        <pre style={{ maxHeight: 500, overflow: "auto", background: "#f6f8fa", padding: 12, borderRadius: 6, fontSize: 12 }}>
          {JSON.stringify(bodyOpen?.body, null, 2)}
        </pre>
      </Modal>
    </div>
  );
}

// ============== 子组件 ==============

function fmtAgo(ts: number | string | null) {
  if (!ts) return "—";
  const d = new Date(typeof ts === "string" ? ts : Number(ts));
  if (isNaN(d.getTime())) return "—";
  const ago = (Date.now() - d.getTime()) / 1000;
  if (ago < 60) return `${Math.round(ago)}秒前`;
  if (ago < 3600) return `${Math.round(ago / 60)}分钟前`;
  if (ago < 86400) return `${Math.round(ago / 3600)}小时前`;
  return d.toLocaleString();
}

// 调色板（颜色复用）
const CAT_COLORS = ["#0969da", "#1f883d", "#bf8700", "#cf222e", "#8250df", "#0a3069", "#bc4c00", "#3192aa", "#a40e26", "#8c959f", "#dafbe1", "#ffd8b5"];
const STATUS_COLORS: Record<string, string> = { "2xx": "#1f883d", "3xx": "#0969da", "4xx": "#bf8700", "5xx": "#cf222e", other: "#8c959f" };

function Charts({ cfg, stats }: { cfg: CloudConsoleConfig; stats: Stats | null }) {
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [byMall, setByMall] = useState<MallSummary[]>([]);
  const [byStatus, setByStatus] = useState<StatusBucket[]>([]);
  const [byCategory, setByCategory] = useState<CategoryBucket[]>([]);
  const [bucketGran, setBucketGran] = useState<"hour" | "day">("hour");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const since = bucketGran === "hour" ? Date.now() - 24 * 3600 * 1000 : Date.now() - 30 * 86400 * 1000;
      const [t, m, s, c] = await Promise.all([
        fetchTimeline(cfg, bucketGran, since),
        fetchByMall(cfg, since),
        fetchStatusBreakdown(cfg, since),
        fetchByCategory(cfg, since),
      ]);
      setTimeline(t.points);
      setByMall(m);
      setByStatus(s);
      setByCategory(c);
    } catch {} finally { setLoading(false); }
  }, [cfg, bucketGran]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [refresh]);

  // timeline 数据：转 X 轴可读时间
  const tlData = useMemo(() => timeline.map((p) => ({
    label: new Date(p.bucket_ts).toLocaleString("zh-CN", bucketGran === "hour" ? { hour: "2-digit", minute: "2-digit" } : { month: "2-digit", day: "2-digit" }),
    成功: p.ok,
    "4xx": p.err4,
    "5xx": p.err5,
  })), [timeline, bucketGran]);

  const totalEvents = byStatus.reduce((s, x) => s + x.n, 0);
  const errorRate = totalEvents > 0
    ? Math.round((byStatus.filter(x => x.bucket === "4xx" || x.bucket === "5xx").reduce((s, x) => s + x.n, 0) / totalEvents) * 1000) / 10
    : 0;

  return (
    <div>
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={6}><Card size="small"><Statistic title={`${bucketGran === "hour" ? "近 24h" : "近 30d"} 事件`} value={totalEvents} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="错误率 (4xx+5xx)" value={errorRate} suffix="%" valueStyle={{ color: errorRate > 5 ? "#cf222e" : "#1f883d" }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="活跃店铺" value={byMall.filter(m => m.mall_id !== "(unknown)").length} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="业务大类" value={byCategory.length} /></Card></Col>
      </Row>

      <Card size="small" style={{ marginBottom: 12 }}
        title={<span><AreaChartOutlined /> 调用量时序 ({bucketGran === "hour" ? "最近 24h，按小时" : "最近 30d，按天"})</span>}
        extra={
          <Space>
            <Button size="small" type={bucketGran === "hour" ? "primary" : "default"} onClick={() => setBucketGran("hour")}>按小时</Button>
            <Button size="small" type={bucketGran === "day" ? "primary" : "default"} onClick={() => setBucketGran("day")}>按天</Button>
          </Space>
        }
      >
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={tlData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <RTooltip />
            <Legend />
            <Area type="monotone" dataKey="成功" stackId="1" stroke="#1f883d" fill="#1f883d" fillOpacity={0.5} />
            <Area type="monotone" dataKey="4xx" stackId="1" stroke="#bf8700" fill="#bf8700" fillOpacity={0.6} />
            <Area type="monotone" dataKey="5xx" stackId="1" stroke="#cf222e" fill="#cf222e" fillOpacity={0.7} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={12}>
          <Card size="small" title={<span><BarChartOutlined /> 各店铺调用量</span>}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byMall.slice(0, 10).map((m) => ({
                label: m.mall_id === "(unknown)" ? `${m.site || "?"} (未识别)` : `${m.site}/${m.mall_id.slice(0, 8)}`,
                调用数: m.total,
                错误: m.errors,
              }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} />
                <RTooltip />
                <Legend />
                <Bar dataKey="调用数" fill="#0969da" />
                <Bar dataKey="错误" fill="#cf222e" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title={<span><PieChartOutlined /> 业务分类占比</span>}>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={byCategory}
                  dataKey="n"
                  nameKey="category"
                  cx="50%" cy="50%"
                  outerRadius={90}
                  label={(e) => `${e.category}: ${e.n}`}
                  labelLine
                >
                  {byCategory.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                </Pie>
                <RTooltip />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      <Row gutter={12}>
        <Col span={12}>
          <Card size="small" title={<span><PieChartOutlined /> HTTP 状态码分布</span>}>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={byStatus}
                  dataKey="n" nameKey="bucket"
                  cx="50%" cy="50%"
                  outerRadius={80}
                  label={(e) => `${e.bucket}: ${e.n}`}
                >
                  {byStatus.map((s, i) => <Cell key={i} fill={STATUS_COLORS[s.bucket] || "#8c959f"} />)}
                </Pie>
                <RTooltip />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title={<span><BarChartOutlined /> Top 10 接口</span>}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                layout="vertical"
                data={(stats?.topEndpoints || []).slice(0, 10).map((e) => ({
                  label: e.url_path.split("/").slice(-2).join("/").slice(0, 30),
                  调用数: e.count_total,
                }))}
                margin={{ left: 100 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={120} />
                <RTooltip />
                <Bar dataKey="调用数" fill="#0969da" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      {loading && <div style={{ textAlign: "center", color: "#8c959f", marginTop: 8, fontSize: 12 }}>刷新中...</div>}
    </div>
  );
}

function AgentsTable({ agents }: { agents: AgentHeartbeat[] }) {
  return (
    <Table
      size="small"
      rowKey="device_uuid"
      dataSource={agents}
      pagination={false}
      locale={{ emptyText: "尚无设备心跳" }}
      columns={[
        { title: "设备", dataIndex: "device_uuid", render: (v) => <code>{v?.slice(0, 8) || "—"}</code> },
        {
          title: "状态",
          dataIndex: "ts",
          render: (ts) => {
            const fresh = ts && Date.now() - Number(ts) < 90000;
            return (
              <Space>
                {fresh ? <Tag color="green">在线</Tag> : <Tag>离线</Tag>}
                <span style={{ color: "#8c959f", fontSize: 12 }}>{fmtAgo(ts)}</span>
              </Space>
            );
          },
        },
        {
          title: "抓取/上报",
          render: (_, r) => (
            <Space>
              <span>{r.captured_count ?? 0} / {r.total_sent ?? 0}</span>
              {r.last_flush_ok === 1 && <Tag color="green" icon={<CheckCircleOutlined />}>flush</Tag>}
              {r.last_flush_ok === 0 && <Tooltip title={r.last_flush_reason}><Tag color="red" icon={<CloseCircleOutlined />}>flush 失败</Tag></Tooltip>}
            </Space>
          ),
        },
        { title: "队列", dataIndex: "queue_depth", width: 80 },
        {
          title: "Hook",
          render: (_, r) => {
            if (r.hook_xhr_alive == null) return <Tag>无 tab</Tag>;
            return r.hook_xhr_alive
              ? <Tag color="green">XHR ✓</Tag>
              : <Tag color="red">XHR ✗</Tag>;
          },
        },
        {
          title: "当前页面",
          dataIndex: "page_url",
          ellipsis: true,
          render: (v) => v ? <Tooltip title={v}><code style={{ fontSize: 11 }}>{v.slice(0, 60)}</code></Tooltip> : <span style={{ color: "#8c959f" }}>—</span>,
        },
        {
          title: "最近抓到",
          dataIndex: "last_capture_url",
          ellipsis: true,
          render: (v) => v ? <Tooltip title={v}><code style={{ fontSize: 11 }}>{v.slice(0, 50)}</code></Tooltip> : <span style={{ color: "#8c959f" }}>—</span>,
        },
      ]}
    />
  );
}

function MallsTable({ malls }: { malls: Stats["malls"] }) {
  return (
    <Table
      size="small"
      rowKey={(r) => `${r.site}-${r.mall_id}`}
      dataSource={malls}
      pagination={false}
      locale={{ emptyText: "尚未识别到店铺（fetch 路径无 body 时无法解析 mallId，等 v0.3 fetch hook 启用）" }}
      columns={[
        { title: "站点", dataIndex: "site" },
        { title: "店铺 ID", dataIndex: "mall_id", render: (v) => <code>{v}</code> },
        { title: "店铺名", dataIndex: "mall_name", render: (v) => v || <span style={{ color: "#8c959f" }}>—</span> },
        { title: "最近活跃", dataIndex: "last_seen", render: fmtAgo },
      ]}
    />
  );
}

function EndpointsTable({ endpoints }: { endpoints: Stats["topEndpoints"] }) {
  return (
    <Table
      size="small"
      rowKey={(r) => `${r.site}|${r.method}|${r.url_path}`}
      dataSource={endpoints}
      pagination={{ pageSize: 30, showSizeChanger: false }}
      locale={{ emptyText: "尚无数据" }}
      columns={[
        { title: "站点", dataIndex: "site", width: 140 },
        { title: "方法", dataIndex: "method", width: 80, render: (v) => <code>{v}</code> },
        { title: "路径", dataIndex: "url_path", render: (v) => <code style={{ fontSize: 12 }}>{v}</code> },
        { title: "调用数", dataIndex: "count_total", width: 100, sorter: (a, b) => a.count_total - b.count_total, defaultSortOrder: "descend" as const },
        { title: "最近", dataIndex: "last_seen", width: 120, render: fmtAgo },
      ]}
    />
  );
}

function EventsTable({ events, cfg, onView }: { events: CaptureEvent[]; cfg: CloudConsoleConfig; onView: (v: { id: string; body: any }) => void }) {
  const [loadingId, setLoadingId] = useState("");
  const view = async (id: string) => {
    setLoadingId(id);
    try {
      const body = await fetchEventBody(cfg, id);
      onView({ id, body });
    } catch (e: any) {
      message.error("拉取 body 失败：" + e.message);
    } finally {
      setLoadingId("");
    }
  };
  return (
    <Table
      size="small"
      rowKey="id"
      dataSource={events}
      pagination={{ pageSize: 50, showSizeChanger: false }}
      locale={{ emptyText: "尚无事件" }}
      columns={[
        { title: "时间", dataIndex: "ts", render: fmtAgo, width: 110 },
        { title: "方法", dataIndex: "method", width: 70, render: (v) => <code>{v}</code> },
        { title: "路径", dataIndex: "url_path", render: (v) => <code style={{ fontSize: 12 }}>{v}</code>, ellipsis: true },
        {
          title: "状态",
          dataIndex: "status",
          width: 90,
          render: (v) => v == null ? <Tag>—</Tag>
            : v >= 200 && v < 300 ? <Tag color="green">{v}</Tag>
            : v >= 400 ? <Tag color="red">{v}</Tag>
            : <Tag>{v}</Tag>,
        },
        { title: "大小", dataIndex: "body_size", width: 90, align: "right" as const },
        { title: "店铺", dataIndex: "mall_id", width: 100, render: (v) => v ? <code>{v}</code> : <span style={{ color: "#8c959f" }}>—</span> },
        { title: "页面", dataIndex: "page", width: 180, ellipsis: true, render: (v) => v ? <code style={{ fontSize: 11 }}>{v}</code> : "—" },
        {
          title: "操作",
          width: 80,
          render: (_, r) => (
            <Button
              size="small"
              type="link"
              loading={loadingId === r.id}
              onClick={() => view(r.id)}
              disabled={!r.body_size}
            >
              查看
            </Button>
          ),
        },
      ]}
    />
  );
}

function ConfigDrawer({
  open, onClose, cfg, onSaved,
}: { open: boolean; onClose: () => void; cfg: CloudConsoleConfig | null; onSaved: (c: CloudConsoleConfig) => void; }) {
  const [endpoint, setEndpoint] = useState(cfg?.endpoint || "http://43.156.121.172:8788");
  const [pinging, setPinging] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setEndpoint(cfg?.endpoint || "http://43.156.121.172:8788");
  }, [open, cfg]);

  const doPing = async () => {
    setPinging(true);
    try {
      const ok = await ping(endpoint);
      message[ok ? "success" : "error"](ok ? "云端连通正常" : "无法连通云端");
    } finally { setPinging(false); }
  };

  // 保存 = ping + 自动登拿 token + 写 store。整个 cloud 账号概念对用户透明。
  const doSave = async () => {
    if (!endpoint) return message.warning("云端 URL 必填");
    setSaving(true);
    try {
      const ok = await ping(endpoint);
      if (!ok) { message.error("无法连通该 URL，请检查"); return; }
      const r = await login(endpoint, "admin", "changeme123");
      const newCfg = { endpoint: endpoint.replace(/\/$/, ""), token: r.token };
      await saveCloudConfig(newCfg);
      onSaved(newCfg);
      message.success("已连接 cloud server");
    } catch (e: any) {
      message.error("连接失败：" + e.message);
    } finally { setSaving(false); }
  };

  const doClear = async () => {
    Modal.confirm({
      title: "断开当前云端连接？",
      content: "之后这个桌面端会无法访问云端，需要 admin 重新输入 URL。",
      onOk: async () => {
        await clearCloudConfig();
        onClose();
        location.reload();
      },
    });
  };

  return (
    <Drawer title="多店云监控 · 云端连接" open={open} onClose={onClose} width={520}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="多店云监控是公司级看板，admin 配置一次大家共享"
        description={
          <div style={{ fontSize: 12 }}>
            填入你部署的 cloud server 地址，桌面端会自动连接。<b>所有进入这个页面的 ERP 用户</b>看到的是同一份云端数据，不用各自再登。
          </div>
        }
      />
      <Form layout="vertical">
        <Form.Item label="云端 URL（cloud server 地址）" required help="例：http://43.156.121.172:8788 — 即你部署 cloud 时控制台输出的那个公网地址">
          <Input placeholder="http://43.156.121.172:8788" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
        </Form.Item>
        <Space>
          <Button type="primary" loading={saving} onClick={doSave}>连接并保存</Button>
          <Button loading={pinging} onClick={doPing}>仅测试连通</Button>
          {cfg && <Button danger onClick={doClear}>断开</Button>}
        </Space>
      </Form>
    </Drawer>
  );
}
