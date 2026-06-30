import { useState } from "react";
import {
  Badge, Button, Card, Col, Descriptions, Empty, Input, List, message, Modal,
  Row, Space, Spin, Statistic, Table, Tabs, Tag, Tooltip, Typography,
} from "antd";
import {
  CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined,
  PlayCircleOutlined, PauseCircleOutlined, ReloadOutlined,
  RobotOutlined, SendOutlined, ThunderboltOutlined,
  HistoryOutlined, ClockCircleOutlined, AlertOutlined,
  ShoppingCartOutlined, InboxOutlined, StarOutlined,
  LineChartOutlined, DollarOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import {
  useAgentStatus, usePendingApprovals, useRecentApprovals,
  useAgentMemory, useGlobalSnapshot, useAgentActions,
  useAgentIssues, useAgentIssueStats, useAgentRuns, useAgentRunDetail,
  useAgentFollowups,
  type ApprovalItem, type MemoryItem, type AgentIssue, type AgentRun,
} from "../hooks/useAgentDashboard";
import { toolZh } from "../hooks/useAgentSSE";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

// ─── 工具名中文映射 ───
const TOOL_LABELS: Record<string, string> = {
  "erp.purchase.create_order": "采购下单",
  "erp.purchase.confirm_order": "确认采购单",
  "erp.pricing.adjust_price": "调整价格",
  "erp.image.publish_to_live": "主图上线",
  "erp.review.reply": "回复评论",
  "erp.supplier.change": "更换供应商",
  "erp.outbound.cancel_shipment": "取消发货",
  "agent.memory.save_experience": "保存经验",
  "erp.purchase.create_draft": "创建采购草稿",
  "erp.outbound.process_normal": "常规发货",
};

function toolLabel(name: string) {
  return TOOL_LABELS[name] || toolZh(name);
}

function statusTag(s: string) {
  switch (s) {
    case "pending": return <Tag color="orange">待审批</Tag>;
    case "approved": return <Tag color="green">已通过</Tag>;
    case "rejected": return <Tag color="red">已拒绝</Tag>;
    case "timeout": return <Tag color="default">已超时</Tag>;
    default: return <Tag>{s}</Tag>;
  }
}

function issueStatusTag(s: string) {
  switch (s) {
    case "open": return <Tag color="red">待处理</Tag>;
    case "in_progress": return <Tag color="blue">进行中</Tag>;
    case "resolved": return <Tag color="green">已处理</Tag>;
    case "auto_resolved": return <Tag color="cyan">自动处理</Tag>;
    case "dismissed": return <Tag color="default">已忽略</Tag>;
    default: return <Tag>{s}</Tag>;
  }
}

function severityTag(s: string) {
  switch (s) {
    case "critical": return <Tag color="red">严重</Tag>;
    case "high": return <Tag color="orange">高</Tag>;
    case "medium": return <Tag color="blue">中</Tag>;
    case "low": return <Tag color="default">低</Tag>;
    default: return <Tag>{s}</Tag>;
  }
}

function tryParseJson(s: string): any {
  try { return JSON.parse(s); } catch { return s; }
}

const CATEGORY_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  purchase: { label: "采购", icon: <ShoppingCartOutlined />, color: "#1677ff" },
  inventory: { label: "库存", icon: <InboxOutlined />, color: "#fa8c16" },
  review: { label: "差评", icon: <StarOutlined />, color: "#ff4d4f" },
  traffic: { label: "流量", icon: <LineChartOutlined />, color: "#52c41a" },
  finance: { label: "财务", icon: <DollarOutlined />, color: "#722ed1" },
};

const SNAPSHOT_LABELS: Record<string, string> = {
  draft: "草稿",
  pending_payment: "待付款",
  paid_awaiting_arrival: "已付待到货",
  arrived_awaiting_inbound: "到货待入库",
  completed: "已完成",
  low_stock_count: "低库存数量",
  open_work_items: "待处理事项",
  draft_purchase_orders: "草稿采购单",
  pending: "待审批",
};

// ═══════════════════════════════════════════
//  顶部状态卡片 + 分类磁贴 (Marvis-style)
// ═══════════════════════════════════════════
function StatusBar() {
  const { status, loading } = useAgentStatus();
  const { startPatrol, abort } = useAgentActions();
  const { stats } = useAgentIssueStats();

  const handlePatrol = async () => {
    try {
      await startPatrol();
      message.success("巡逻已启动");
    } catch (e: any) {
      message.error(e?.message || "启动失败");
    }
  };

  const handleAbort = async () => {
    try {
      await abort();
      message.info("已发送终止信号");
    } catch (e: any) {
      message.error(e?.message || "终止失败");
    }
  };

  const allCategories = ["purchase", "inventory", "review", "traffic", "finance"];
  const totalActive = stats.reduce((s, c) => s + Number(c.active_count || 0), 0);

  return (
    <div style={{ marginBottom: 16 }}>
      {/* 顶部状态行 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="鲁米斯 状态"
              value={loading ? "加载中" : status.initialized ? (status.running ? "运行中" : "就绪") : "未初始化"}
              prefix={status.running ? <ThunderboltOutlined style={{ color: "#1677ff" }} /> : <RobotOutlined />}
              valueStyle={{ color: status.running ? "#1677ff" : status.initialized ? "#52c41a" : "#999" }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="待审批"
              value={status.pending_approvals}
              prefix={<ExclamationCircleOutlined />}
              valueStyle={{ color: status.pending_approvals > 0 ? "#fa8c16" : "#999" }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="活跃问题"
              value={totalActive}
              prefix={<AlertOutlined />}
              valueStyle={{ color: totalActive > 0 ? "#ff4d4f" : "#52c41a" }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Space>
              {status.running ? (
                <Button danger icon={<PauseCircleOutlined />} onClick={handleAbort}>
                  终止巡逻
                </Button>
              ) : (
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={handlePatrol} disabled={!status.initialized}>
                  启动巡逻
                </Button>
              )}
            </Space>
          </Card>
        </Col>
      </Row>

      {/* 分类磁贴 (Marvis-style) */}
      <Row gutter={12}>
        {allCategories.map(cat => {
          const meta = CATEGORY_META[cat];
          const stat = stats.find(s => s.category === cat);
          const active = Number(stat?.active_count || 0);
          const critical = Number(stat?.critical_count || 0);
          const health = active === 0 ? "green" : critical > 0 ? "red" : "orange";
          return (
            <Col span={Math.floor(24 / allCategories.length)} key={cat}>
              <Card
                size="small"
                hoverable
                style={{
                  borderLeft: `3px solid ${health === "green" ? "#52c41a" : health === "red" ? "#ff4d4f" : "#fa8c16"}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 20, color: meta.color }}>{meta.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, color: "#999" }}>{meta.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: health === "green" ? "#52c41a" : health === "red" ? "#ff4d4f" : "#fa8c16" }}>
                      {active}
                    </div>
                  </div>
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}

// ═══════════════════════════════════════════
//  问题列表 (Issues — 核心 Marvis 视图)
// ═══════════════════════════════════════════
function IssuesPanel() {
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const { items, loading, reload } = useAgentIssues(filter ? { status: filter } : undefined);
  const { resolveIssue } = useAgentActions();

  const handleResolve = async (id: string) => {
    try {
      await resolveIssue(id, "resolved");
      message.success("已标记处理");
      reload();
    } catch (e: any) {
      message.error(e?.message || "操作失败");
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      await resolveIssue(id, "dismissed");
      reload();
    } catch (e: any) {
      message.error(e?.message || "操作失败");
    }
  };

  const columns = [
    {
      title: "严重度", dataIndex: "severity", key: "severity", width: 80,
      render: (v: string) => severityTag(v),
    },
    {
      title: "分类", dataIndex: "category", key: "category", width: 80,
      render: (v: string) => {
        const m = CATEGORY_META[v];
        return m ? <Tag color={m.color}>{m.label}</Tag> : <Tag>{v}</Tag>;
      },
    },
    {
      title: "问题", dataIndex: "title", key: "title",
      render: (v: string, row: AgentIssue) => (
        <Tooltip title={row.description || v}>
          <Text ellipsis style={{ maxWidth: 400 }}>{v}</Text>
        </Tooltip>
      ),
    },
    {
      title: "状态", dataIndex: "status", key: "status", width: 100,
      render: (v: string) => issueStatusTag(v),
    },
    {
      title: "时间", dataIndex: "created_at", key: "time", width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString("zh-CN") : "-",
    },
    {
      title: "操作", key: "action", width: 140,
      render: (_: any, row: AgentIssue) => row.status === "open" || row.status === "in_progress" ? (
        <Space size="small">
          <Button size="small" type="primary" onClick={() => handleResolve(row.id)}>处理</Button>
          <Button size="small" onClick={() => handleDismiss(row.id)}>忽略</Button>
        </Space>
      ) : null,
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
        <Button size="small" type={!filter ? "primary" : "default"} onClick={() => setFilter(undefined)}>全部</Button>
        <Button size="small" type={filter === "open" ? "primary" : "default"} onClick={() => setFilter("open")}>待处理</Button>
        <Button size="small" type={filter === "resolved" ? "primary" : "default"} onClick={() => setFilter("resolved")}>已处理</Button>
        <div style={{ flex: 1 }} />
        <Button size="small" icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
      </div>
      <Table
        dataSource={items}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 20, size: "small" }}
        locale={{ emptyText: <Empty description="暂无问题（启动巡逻后会自动发现问题）" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />
    </>
  );
}

// ═══════════════════════════════════════════
//  审批面板
// ═══════════════════════════════════════════
function ApprovalPanel() {
  const { items: pending, loading: loadingPending, reload: reloadPending } = usePendingApprovals();
  const { items: recent, loading: loadingRecent, reload: reloadRecent } = useRecentApprovals();
  const { approveItem, rejectItem } = useAgentActions();
  const [rejectModal, setRejectModal] = useState<{ id: string; reason: string } | null>(null);

  const handleApprove = async (id: string) => {
    try {
      await approveItem(id);
      message.success("已通过");
      reloadPending();
      reloadRecent();
    } catch (e: any) {
      message.error(e?.message || "操作失败");
    }
  };

  const handleReject = async () => {
    if (!rejectModal) return;
    try {
      await rejectItem(rejectModal.id, rejectModal.reason);
      message.info("已拒绝");
      setRejectModal(null);
      reloadPending();
      reloadRecent();
    } catch (e: any) {
      message.error(e?.message || "操作失败");
    }
  };

  const columns = [
    {
      title: "操作", dataIndex: "tool_name", key: "tool",
      render: (v: string) => <Tag color="blue">{toolLabel(v)}</Tag>,
    },
    {
      title: "参数", dataIndex: "tool_input", key: "input", ellipsis: true,
      render: (v: string) => {
        const parsed = tryParseJson(v);
        if (typeof parsed === "object" && parsed !== null) {
          const { reason, remark, ...rest } = parsed;
          return (
            <Tooltip title={<pre style={{ margin: 0, fontSize: 11, maxHeight: 300, overflow: "auto" }}>{JSON.stringify(parsed, null, 2)}</pre>}>
              <Text ellipsis style={{ maxWidth: 300 }}>
                {reason || remark || JSON.stringify(rest).slice(0, 80)}
              </Text>
            </Tooltip>
          );
        }
        return <Text ellipsis style={{ maxWidth: 300 }}>{String(v).slice(0, 80)}</Text>;
      },
    },
    {
      title: "时间", dataIndex: "created_at", key: "time", width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString("zh-CN") : "-",
    },
    {
      title: "状态", dataIndex: "status", key: "status", width: 100,
      render: (v: string) => statusTag(v),
    },
  ];

  const pendingColumns = [
    ...columns.filter(c => c.key !== "status"),
    {
      title: "操作", key: "action", width: 160,
      render: (_: any, row: ApprovalItem) => (
        <Space size="small">
          <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => handleApprove(row.id)}>
            通过
          </Button>
          <Button size="small" danger icon={<CloseCircleOutlined />} onClick={() => setRejectModal({ id: row.id, reason: "" })}>
            拒绝
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Tabs
        items={[
          {
            key: "pending",
            label: <Badge count={pending.length} size="small" offset={[8, 0]}>待审批</Badge>,
            children: (
              <Table
                dataSource={pending}
                columns={pendingColumns}
                rowKey="id"
                loading={loadingPending}
                size="small"
                pagination={false}
                locale={{ emptyText: <Empty description="暂无待审批项" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              />
            ),
          },
          {
            key: "recent",
            label: "历史记录",
            children: (
              <Table
                dataSource={recent}
                columns={columns}
                rowKey="id"
                loading={loadingRecent}
                size="small"
                pagination={{ pageSize: 20, size: "small" }}
              />
            ),
          },
        ]}
        tabBarExtraContent={
          <Button size="small" icon={<ReloadOutlined />} onClick={() => { reloadPending(); reloadRecent(); }}>
            刷新
          </Button>
        }
      />
      <Modal
        title="拒绝原因"
        open={!!rejectModal}
        onOk={handleReject}
        onCancel={() => setRejectModal(null)}
        okText="确认拒绝"
        cancelText="取消"
      >
        <TextArea
          rows={3}
          placeholder="可选：说明拒绝原因"
          value={rejectModal?.reason || ""}
          onChange={(e) => setRejectModal(prev => prev ? { ...prev, reason: e.target.value } : null)}
        />
      </Modal>
    </>
  );
}

// ═══════════════════════════════════════════
//  运行历史面板
// ═══════════════════════════════════════════
function RunsPanel() {
  const { items, loading, reload } = useAgentRuns();
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const { run, events, loading: detailLoading } = useAgentRunDetail(selectedRun);

  const triggerLabel = (t: string) => {
    switch (t) {
      case "patrol": return <Tag color="blue">巡逻</Tag>;
      case "human": return <Tag color="green">对话</Tag>;
      case "event": return <Tag color="orange">事件</Tag>;
      case "followup": return <Tag color="purple">跟进</Tag>;
      default: return <Tag>{t}</Tag>;
    }
  };

  const runStatusTag = (s: string) => {
    switch (s) {
      case "running": return <Tag color="processing">运行中</Tag>;
      case "completed": return <Tag color="green">完成</Tag>;
      case "error": return <Tag color="red">失败</Tag>;
      case "aborted": return <Tag color="default">中止</Tag>;
      default: return <Tag>{s}</Tag>;
    }
  };

  const columns = [
    {
      title: "类型", dataIndex: "trigger_type", key: "type", width: 80,
      render: (v: string) => triggerLabel(v),
    },
    {
      title: "状态", dataIndex: "status", key: "status", width: 90,
      render: (v: string) => runStatusTag(v),
    },
    {
      title: "轮次", dataIndex: "turns", key: "turns", width: 60,
    },
    {
      title: "回复", dataIndex: "reply", key: "reply",
      render: (v: string) => <Text ellipsis style={{ maxWidth: 300 }}>{v?.slice(0, 100) || "-"}</Text>,
    },
    {
      title: "时间", dataIndex: "started_at", key: "time", width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString("zh-CN") : "-",
    },
    {
      title: "操作", key: "action", width: 80,
      render: (_: any, row: AgentRun) => (
        <Button size="small" onClick={() => setSelectedRun(row.id)}>详情</Button>
      ),
    },
  ];

  return (
    <>
      <Table
        dataSource={items}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 15, size: "small" }}
        locale={{ emptyText: <Empty description="暂无运行记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />
      <Modal
        title={`运行详情 — ${selectedRun?.slice(0, 20) || ""}`}
        open={!!selectedRun}
        onCancel={() => setSelectedRun(null)}
        footer={null}
        width={700}
      >
        {detailLoading ? <Spin /> : (
          <div style={{ maxHeight: 500, overflow: "auto" }}>
            {run && (
              <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
                <Descriptions.Item label="类型">{triggerLabel(run.trigger_type)}</Descriptions.Item>
                <Descriptions.Item label="状态">{runStatusTag(run.status)}</Descriptions.Item>
                <Descriptions.Item label="轮次">{run.turns}</Descriptions.Item>
                <Descriptions.Item label="时间">{new Date(run.started_at).toLocaleString("zh-CN")}</Descriptions.Item>
              </Descriptions>
            )}
            <List
              size="small"
              dataSource={events}
              renderItem={(evt) => (
                <List.Item style={{ padding: "4px 0" }}>
                  <div style={{ fontSize: 12 }}>
                    <Tag color={evt.event_type === "thinking" ? "default" : evt.event_type === "tool_call" ? "blue" : "orange"} style={{ fontSize: 11 }}>
                      {evt.event_type === "thinking" ? "思考" : evt.event_type === "tool_call" ? `工具: ${toolLabel(evt.tool_name || "")}` : evt.event_type}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                      {new Date(evt.created_at).toLocaleTimeString("zh-CN")}
                    </Text>
                    <div style={{ marginTop: 4, color: "#333", whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>
                      {evt.content?.slice(0, 500)}
                    </div>
                  </div>
                </List.Item>
              )}
              locale={{ emptyText: "暂无事件记录" }}
            />
          </div>
        )}
      </Modal>
      <div style={{ marginTop: 8, textAlign: "right" }}>
        <Button size="small" icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════
//  快照面板
// ═══════════════════════════════════════════
function SnapshotPanel() {
  const { snapshot, loading, reload } = useGlobalSnapshot();

  if (loading) return <Spin />;
  if (!snapshot) return <Empty description="快照不可用（Agent 未初始化）" />;

  const sections = snapshot.sections || {};

  return (
    <div>
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Text type="secondary">生成时间: {new Date(snapshot.generated_at).toLocaleString("zh-CN")}</Text>
        <Button size="small" icon={<ReloadOutlined />} onClick={reload}>刷新快照</Button>
      </div>
      <Row gutter={[16, 16]}>
        {Object.entries(sections).map(([key, section]) => (
          <Col span={12} key={key}>
            <Card size="small" title={section.label || key} bordered>
              {section.error ? (
                <Text type="danger">{section.error}</Text>
              ) : section.note ? (
                <Text type="secondary">{section.note}</Text>
              ) : (
                <Descriptions column={1} size="small" bordered={false}>
                  {Object.entries(section)
                    .filter(([k]) => k !== "label" && k !== "top_alerts" && k !== "rows")
                    .map(([k, v]) => (
                      <Descriptions.Item key={k} label={SNAPSHOT_LABELS[k] || k}>
                        {typeof v === "number" ? v.toLocaleString() : String(v ?? "-")}
                      </Descriptions.Item>
                    ))}
                </Descriptions>
              )}
              {section.top_alerts && Array.isArray(section.top_alerts) && section.top_alerts.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>低库存 TOP:</Text>
                  <List
                    size="small"
                    dataSource={section.top_alerts}
                    renderItem={(alert: any) => (
                      <List.Item style={{ padding: "2px 0" }}>
                        <Text style={{ fontSize: 12 }}>{alert.sku} — {alert.name}</Text>
                        <Tag color={alert.stock < 10 ? "red" : "orange"} style={{ marginLeft: 8 }}>
                          库存 {alert.stock}
                        </Tag>
                      </List.Item>
                    )}
                  />
                </div>
              )}
              {section.rows && Array.isArray(section.rows) && section.rows.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>流量数据:</Text>
                  {section.rows.map((r: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, padding: "2px 0" }}>
                      {r.store} ({r.date}): 曝光 {r.exposure?.toLocaleString()} → 点击 {r.clicks?.toLocaleString()} → 买家 {r.buyers?.toLocaleString()}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}

// ═══════════════════════════════════════════
//  对话面板
// ═══════════════════════════════════════════
function ChatPanel() {
  const { sendMessage } = useAgentActions();
  const { status } = useAgentStatus();
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    const msg = inputValue.trim();
    if (!msg) return;
    setSending(true);
    try {
      await sendMessage(msg);
      setInputValue("");
      message.success("消息已发送，Agent 开始处理");
    } catch (e: any) {
      message.error(e?.message || "发送失败");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary">
          向鲁米斯发送指令（例如："帮我看看哪些SKU快断货了"、"最近差评增多了吗"）
        </Text>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <TextArea
          rows={3}
          placeholder="输入运营指令..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); handleSend(); } }}
          disabled={!status.initialized || status.running}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={sending}
          disabled={!status.initialized || status.running || !inputValue.trim()}
          style={{ height: "auto" }}
        >
          发送
        </Button>
      </div>
      {status.running && (
        <div style={{ marginTop: 8 }}>
          <Tag color="processing" icon={<ThunderboltOutlined />}>鲁米斯正在运行中...</Tag>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
//  记忆面板
// ═══════════════════════════════════════════
function MemoryPanel() {
  const { items, loading, reload } = useAgentMemory();
  const { recallMemory } = useAgentActions();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MemoryItem[] | null>(null);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await recallMemory(searchQuery.trim());
      setSearchResults(res.items);
    } catch (e: any) {
      message.error(e?.message || "搜索失败");
    } finally {
      setSearching(false);
    }
  };

  const displayItems = searchResults ?? items;

  return (
    <div>
      <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
        <Input
          placeholder="搜索运营经验..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onPressEnter={handleSearch}
          style={{ flex: 1 }}
          allowClear
          onClear={() => setSearchResults(null)}
        />
        <Button icon={<ReloadOutlined />} onClick={handleSearch} loading={searching}>
          搜索
        </Button>
        <Button onClick={() => { setSearchResults(null); reload(); }}>
          全部
        </Button>
      </div>
      {loading ? <Spin /> : (
        <List
          dataSource={displayItems}
          locale={{ emptyText: <Empty description="暂无运营经验" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <Space>
                    <Text strong>{item.title}</Text>
                    <Tag color="blue">置信度 {(item.confidence * 100).toFixed(0)}%</Tag>
                    {item.tags && item.tags.split(",").filter(Boolean).map(t => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </Space>
                }
                description={
                  <div>
                    <Paragraph ellipsis={{ rows: 2, expandable: true }} style={{ marginBottom: 4 }}>
                      {item.content}
                    </Paragraph>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {new Date(item.created_at).toLocaleString("zh-CN")}
                    </Text>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
//  定时任务面板
// ═══════════════════════════════════════════
function FollowupsPanel() {
  const { items, loading, reload } = useAgentFollowups();
  const { cancelFollowup } = useAgentActions();

  const handleCancel = async (id: string) => {
    try {
      await cancelFollowup(String(id));
      message.info("已取消");
      reload();
    } catch (e: any) {
      message.error(e?.message || "操作失败");
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 12, textAlign: "right" }}>
        <Button size="small" icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
      </div>
      <List
        loading={loading}
        dataSource={items}
        locale={{ emptyText: <Empty description="暂无定时任务" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Button size="small" danger onClick={() => handleCancel(String(item.id))}>取消</Button>,
            ]}
          >
            <List.Item.Meta
              avatar={<ClockCircleOutlined style={{ fontSize: 20, color: "#1677ff" }} />}
              title={item.description}
              description={`触发时间: ${new Date(item.fire_at).toLocaleString("zh-CN")}`}
            />
          </List.Item>
        )}
      />
    </div>
  );
}

// ═══════════════════════════════════════════
//  主页面
// ═══════════════════════════════════════════
export default function AgentDashboard() {
  const { status } = useAgentStatus();

  return (
    <>
      <PageHeader
        title="鲁米斯 Lumis 监控台"
        actions={
          <Tag color={status.initialized ? "green" : "default"}>
            {status.initialized ? "已连接" : "未连接"}
          </Tag>
        }
      />
      <div style={{ padding: "0 24px 24px" }}>
        <StatusBar />
        <Tabs
          defaultActiveKey="issues"
          items={[
            {
              key: "issues",
              label: <span><AlertOutlined /> 问题追踪</span>,
              children: <Card><IssuesPanel /></Card>,
            },
            {
              key: "approvals",
              label: <Badge count={status.pending_approvals} size="small" offset={[8, 0]}>审批队列</Badge>,
              children: <Card><ApprovalPanel /></Card>,
            },
            {
              key: "runs",
              label: <span><HistoryOutlined /> 运行历史</span>,
              children: <Card><RunsPanel /></Card>,
            },
            {
              key: "snapshot",
              label: "运营快照",
              children: <Card><SnapshotPanel /></Card>,
            },
            {
              key: "chat",
              label: "对话指令",
              children: <Card><ChatPanel /></Card>,
            },
            {
              key: "followups",
              label: <span><ClockCircleOutlined /> 定时任务</span>,
              children: <Card><FollowupsPanel /></Card>,
            },
            {
              key: "memory",
              label: "运营记忆",
              children: <Card><MemoryPanel /></Card>,
            },
          ]}
        />
      </div>
    </>
  );
}
