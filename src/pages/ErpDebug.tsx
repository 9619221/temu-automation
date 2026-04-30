import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ApiOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";

const { Text } = Typography;
const erp = window.electronAPI?.erp;

const ROLE_OPTIONS = [
  { label: "管理员", value: "admin" },
  { label: "负责人", value: "manager" },
  { label: "运营", value: "operations" },
  { label: "采购", value: "buyer" },
  { label: "财务", value: "finance" },
  { label: "仓库", value: "warehouse" },
];

function roleLabel(role?: string) {
  return ROLE_OPTIONS.find((item) => item.value === role)?.label || "未知角色";
}

interface ErpUserRow {
  id: string;
  name: string;
  role: string;
  status: string;
  hasAccessCode?: boolean;
  updatedAt?: string;
}

interface ErpStatusView {
  initialized: boolean;
  dbPath: string | null;
  backupPath?: string | null;
  migrations?: Array<{ key: string; status: string }>;
  error?: { message?: string } | null;
}

interface ErpLanStatusView {
  running: boolean;
  port: number;
  bindAddress: string;
  startedAt: string | null;
  localUrl: string;
  primaryUrl: string;
  lanUrls: string[];
  routes: Array<{ path: string; label: string }>;
  authMode: string;
  lastError?: string | null;
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function statusColor(status?: string) {
  switch (status) {
    case "active":
    case "online":
    case "success":
      return "success";
    case "offline":
    case "skipped":
      return "default";
    case "blocked":
    case "failed":
      return "error";
    default:
      return "processing";
  }
}

const STATUS_LABELS: Record<string, string> = {
  active: "启用",
  blocked: "停用",
  online: "在线",
  offline: "下线",
  success: "成功",
  skipped: "跳过",
  failed: "失败",
};

function statusLabel(status?: string) {
  return STATUS_LABELS[status || ""] || status || "-";
}

function migrationLabel(key?: string) {
  if (!key) return "-";
  const labels: Record<string, string> = {
    "001_erp_core.sql": "基础数据结构",
  };
  return labels[key] || "数据结构检查项";
}

export default function ErpDebug() {
  const [userForm] = Form.useForm();
  const [status, setStatus] = useState<ErpStatusView | null>(null);
  const [lanStatus, setLanStatus] = useState<ErpLanStatusView | null>(null);
  const [users, setUsers] = useState<ErpUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lanLoading, setLanLoading] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const [nextStatus, nextUsers] = await Promise.all([
        erp.getStatus(),
        erp.user.list({ limit: 100 }),
      ]);
      const nextLanStatus = await erp.lan.getStatus();
      setStatus(nextStatus);
      setLanStatus(nextLanStatus);
      setUsers(nextUsers as ErpUserRow[]);
    } catch (error: any) {
      message.error(error?.message || "系统状态读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleRunMigrations = async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const nextStatus = await erp.runMigrations();
      setStatus(nextStatus);
      message.success("数据结构检查完成");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "数据结构检查失败");
    } finally {
      setLoading(false);
    }
  };

  const handleUpsertUser = async () => {
    if (!erp) return;
    const values = await userForm.validateFields();
    setSubmitting("user");
    try {
      await erp.user.upsert({
        name: values.name,
        role: values.role,
        status: values.status || "active",
        accessCode: values.accessCode,
      });
      userForm.resetFields(["name", "accessCode"]);
      message.success("系统用户已保存");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "系统用户保存失败");
    } finally {
      setSubmitting(null);
    }
  };

  const handleToggleLan = async (checked: boolean) => {
    if (!erp) return;
    setLanLoading(true);
    try {
      const nextStatus = checked
        ? await erp.lan.start({
          port: lanStatus?.port || 19380,
          bindAddress: lanStatus?.bindAddress || "0.0.0.0",
        })
        : await erp.lan.stop();
      setLanStatus(nextStatus);
      message.success(checked ? "团队协作服务已开启" : "团队协作服务已关闭");
    } catch (error: any) {
      message.error(error?.message || "团队协作服务操作失败");
      const nextStatus = await erp.lan.getStatus().catch(() => null);
      if (nextStatus) setLanStatus(nextStatus);
    } finally {
      setLanLoading(false);
    }
  };

  const handleChangeLanPort = async (port: number | null) => {
    if (!port || !erp || lanStatus?.running) return;
    const nextStatus = await erp.lan.getStatus();
    setLanStatus({
      ...nextStatus,
      port,
    });
  };

  const openLanUrl = (url?: string) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const migrationRows = status?.migrations || [];
  const successMigrationCount = migrationRows.filter((item) => item.status === "success" || item.status === "skipped").length;

  const userColumns: ColumnsType<ErpUserRow> = [
    { title: "用户", dataIndex: "name", key: "name", ellipsis: true },
    { title: "角色", dataIndex: "role", key: "role", width: 100, render: (value) => <Tag>{roleLabel(value)}</Tag> },
    { title: "访问码", dataIndex: "hasAccessCode", key: "hasAccessCode", width: 100, render: (value) => <Tag color={value ? "success" : "warning"}>{value ? "已设置" : "未设置"}</Tag> },
    { title: "状态", dataIndex: "status", key: "status", width: 92, render: (value) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
    { title: "更新", dataIndex: "updatedAt", key: "updatedAt", width: 170, render: formatTime },
  ];

  const migrationColumns: ColumnsType<{ key: string; status: string }> = [
    { title: "检查项", dataIndex: "key", key: "key", ellipsis: true, render: migrationLabel },
    { title: "状态", dataIndex: "status", key: "status", width: 120, render: (value) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
  ];

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="系统" title="调试台" subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境缺少本地服务接口" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="系统"
        title="调试台"
        subtitle="数据状态、团队协作服务和系统用户入口。商品、供应商、店铺资料已拆分为独立入口。"
        meta={[
          status?.initialized ? "数据服务已就绪" : "数据服务未就绪",
          status?.dbPath || "等待状态",
        ]}
        actions={[
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={loadAll}>
            刷新
          </Button>,
          <Button key="migration" type="primary" icon={<DatabaseOutlined />} loading={loading} onClick={handleRunMigrations}>
            检查数据结构
          </Button>,
        ]}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <StatCard title="数据服务" value={status?.initialized ? "已就绪" : "未就绪"} color="blue" icon={<DatabaseOutlined />} />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="数据结构" value={`${successMigrationCount}/${migrationRows.length || 5}`} color="success" icon={<CheckCircleOutlined />} />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="系统用户" value={users.length} suffix="个" color="purple" icon={<UserOutlined />} />
        </Col>
      </Row>

      {status?.error?.message ? (
        <Alert type="error" showIcon message="系统初始化异常" description={status.error.message} style={{ marginBottom: 16 }} />
      ) : null}

      <Tabs
        type="card"
        items={[
          {
            key: "status",
            label: (
              <Space size={6}>
                <DatabaseOutlined />
                数据库状态
              </Space>
            ),
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24} xl={12}>
                  <div className="app-panel">
                    <div className="app-panel__title">
                      <div>
                        <div className="app-panel__title-main">数据服务</div>
                        <div className="app-panel__title-sub">本机业务数据库</div>
                      </div>
                      <Tag color={status?.initialized ? "success" : "error"}>
                        {status?.initialized ? "已连接" : "未连接"}
                      </Tag>
                    </div>
                    <Descriptions size="small" column={1} bordered>
                      <Descriptions.Item label="数据库">{status?.dbPath || "-"}</Descriptions.Item>
                      <Descriptions.Item label="备份">{status?.backupPath || "-"}</Descriptions.Item>
                    </Descriptions>
                  </div>
                </Col>
                <Col xs={24} xl={12}>
                  <div className="app-panel">
                    <div className="app-panel__title">
                      <div>
                        <div className="app-panel__title-main">数据结构</div>
                        <div className="app-panel__title-sub">启动时自动检查</div>
                      </div>
                      <Tag>{migrationRows.length} 条</Tag>
                    </div>
                    <Table
                      size="small"
                      rowKey="key"
                      loading={loading}
                      columns={migrationColumns}
                      dataSource={migrationRows}
                      pagination={false}
                    />
                  </div>
                </Col>
              </Row>
            ),
          },
          {
            key: "lan",
            label: (
              <Space size={6}>
                <CloudServerOutlined />
                团队协作服务
              </Space>
            ),
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={12}>
                  <div className="app-panel">
                    <div className="app-panel__title">
                      <div>
                        <div className="app-panel__title-main">服务开关</div>
                        <div className="app-panel__title-sub">开启后，团队成员可在同一网络内访问业务工作台</div>
                      </div>
                      <Switch
                        checked={Boolean(lanStatus?.running)}
                        loading={lanLoading}
                        onChange={handleToggleLan}
                      />
                    </div>
                    <Space direction="vertical" size={12} style={{ width: "100%", marginBottom: 12 }}>
                      <Row gutter={12}>
                        <Col xs={24} md={12}>
                          <Text type="secondary">绑定地址</Text>
                          <Input value={lanStatus?.bindAddress || "0.0.0.0"} disabled style={{ marginTop: 6 }} />
                        </Col>
                        <Col xs={24} md={12}>
                          <Text type="secondary">端口</Text>
                          <InputNumber
                            min={1024}
                            max={65535}
                            value={lanStatus?.port || 19380}
                            disabled={Boolean(lanStatus?.running)}
                            onChange={handleChangeLanPort}
                            style={{ width: "100%", marginTop: 6 }}
                          />
                        </Col>
                      </Row>
                    </Space>
                    <Descriptions size="small" column={1} bordered>
                      <Descriptions.Item label="状态">
                        <Tag color={lanStatus?.running ? "success" : "default"}>
                          {lanStatus?.running ? "运行中" : "未启用"}
                        </Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="入口">
                        <Space direction="vertical" size={4}>
                          <Text code>{lanStatus?.primaryUrl || "http://本机地址:19380"}</Text>
                          {lanStatus?.running ? (
                            <Button size="small" onClick={() => openLanUrl(lanStatus.primaryUrl)}>
                              打开入口
                            </Button>
                          ) : null}
                        </Space>
                      </Descriptions.Item>
                      <Descriptions.Item label="本机">
                        <Text code>{lanStatus?.localUrl || "http://127.0.0.1:19380"}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="服务地址">
                        {(lanStatus?.lanUrls || []).length > 0
                          ? (
                            <Space direction="vertical" size={4}>
                              {lanStatus?.lanUrls.map((url) => <Text code key={url}>{url}</Text>)}
                            </Space>
                          )
                          : <Text type="secondary">未检测到可用网络地址</Text>}
                      </Descriptions.Item>
                    </Descriptions>
                    {lanStatus?.lastError ? (
                      <Alert type="error" showIcon message={lanStatus.lastError} style={{ marginTop: 12 }} />
                    ) : null}
                  </div>
                </Col>
                <Col xs={24} lg={12}>
                  <div className="app-panel">
                    <div className="app-panel__title">
                      <div>
                        <div className="app-panel__title-main">访问控制</div>
                        <div className="app-panel__title-sub">团队成员共用同一套用户与权限</div>
                      </div>
                      <SafetyCertificateOutlined style={{ color: "var(--color-success)", fontSize: 18 }} />
                    </div>
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      <Alert
                        type={lanStatus?.running ? "success" : "info"}
                        showIcon
                        message={lanStatus?.running ? "团队协作服务已开启" : "启动服务后会开放采购、仓库、质检和出库工作台"}
                        description="采购、仓库、质检、出库和事项工作台可供团队成员登录后使用；用户与权限由管理员统一管理。"
                      />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {(lanStatus?.routes || [
                          { path: "/purchase", label: "采购工作台" },
                          { path: "/warehouse", label: "仓库工作台" },
                          { path: "/qc", label: "质检抽检工作台" },
                        ]).map((route) => (
                          <Tag icon={<ApiOutlined />} key={route.path}>{route.label}</Tag>
                        ))}
                      </div>
                    </Space>
                  </div>
                </Col>
                <Col xs={24}>
                  <div className="app-panel">
                    <div className="app-panel__title">
                      <div>
                        <div className="app-panel__title-main">系统用户</div>
                        <div className="app-panel__title-sub">创建可登录软件和团队工作台的用户，访问码会安全保存</div>
                      </div>
                      <KeyOutlined style={{ color: "var(--color-brand)", fontSize: 18 }} />
                    </div>
                    <Form form={userForm} layout="vertical">
                      <Row gutter={12}>
                        <Col xs={24} md={6}>
                          <Form.Item name="name" label="用户名称" rules={[{ required: true, message: "请输入用户名称" }]}>
                            <Input placeholder="例如：采购小王" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={5}>
                          <Form.Item name="role" label="角色" initialValue="buyer" rules={[{ required: true, message: "请选择角色" }]}>
                            <Select options={ROLE_OPTIONS} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={5}>
                          <Form.Item name="status" label="状态" initialValue="active">
                            <Select
                              options={[
                                { label: "启用", value: "active" },
                                { label: "停用", value: "blocked" },
                              ]}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={5}>
                          <Form.Item name="accessCode" label="访问码" rules={[{ required: true, message: "请输入访问码" }]}>
                            <Input.Password placeholder="用于登录软件" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={3}>
                          <Form.Item label=" ">
                            <Button type="primary" block icon={<PlusOutlined />} loading={submitting === "user"} onClick={handleUpsertUser}>
                              保存
                            </Button>
                          </Form.Item>
                        </Col>
                      </Row>
                    </Form>
                    <Table
                      size="small"
                      rowKey="id"
                      loading={loading}
                      columns={userColumns}
                      dataSource={users}
                      pagination={{ pageSize: 5, showSizeChanger: false }}
                    />
                  </div>
                </Col>
              </Row>
            ),
          },
        ]}
      />
    </div>
  );
}
