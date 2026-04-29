import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Col, Form, Input, Row, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EditOutlined, KeyOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, StopOutlined, SyncOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import { roleLabel } from "../utils/erpRoleAccess";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { ERP_CLOUD_SERVER_URL } from "../config/erpCloud";

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

const STATUS_OPTIONS = [
  { label: "启用", value: "active" },
  { label: "停用", value: "blocked" },
];

interface ErpUserRow {
  id: string;
  name: string;
  role: string;
  status: string;
  hasAccessCode?: boolean;
  updatedAt?: string;
}

interface UserFormValues {
  id?: string;
  name: string;
  role: string;
  status?: string;
  accessCode?: string;
}

interface ClientStatusView {
  mode: "unset" | "host" | "client";
  isClientMode: boolean;
  serverUrl?: string;
  currentUser?: ErpUserRow | null;
  connected?: boolean;
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function statusTag(status?: string) {
  if (status === "active") return <Tag color="success">启用</Tag>;
  if (status === "blocked") return <Tag color="error">停用</Tag>;
  return <Tag>{status || "-"}</Tag>;
}

export default function UserManagement() {
  const [form] = Form.useForm<UserFormValues>();
  const [cloudForm] = Form.useForm<{ login: string; accessCode: string }>();
  const auth = useErpAuth();
  const [users, setUsers] = useState<ErpUserRow[]>([]);
  const [clientStatus, setClientStatus] = useState<ClientStatusView | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cloudSubmitting, setCloudSubmitting] = useState(false);
  const editingId = Form.useWatch("id", form);

  const activeCount = useMemo(() => users.filter((user) => user.status === "active").length, [users]);
  const roleCountText = useMemo(() => {
    const roles = new Set(users.map((user) => user.role).filter(Boolean));
    return `${roles.size} 个角色`;
  }, [users]);
  const isCloudMode = Boolean(clientStatus?.isClientMode);
  const canManageUsers = isCloudMode;
  const userStoreName = "云端用户库";

  const loadUsers = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const nextClientStatus = await erp.client.getStatus().catch(() => null);
      if (nextClientStatus) {
        setClientStatus(nextClientStatus as ClientStatusView);
      }
      if (!nextClientStatus?.isClientMode) {
        setUsers([]);
        return;
      }
      const nextUsers = await erp.user.list({ limit: 200 });
      setUsers(nextUsers as ErpUserRow[]);
    } catch (error: any) {
      message.error(error?.message || "用户列表读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    const unsubscribe = erp?.events?.onUserUpdate?.(() => {
      void loadUsers();
    });
    return unsubscribe;
  }, [loadUsers]);

  const resetForm = () => {
    form.resetFields();
    form.setFieldsValue({ role: "buyer", status: "active" });
  };

  const handleConnectCloud = async () => {
    if (!erp) return;
    const values = await cloudForm.validateFields();
    setCloudSubmitting(true);
    try {
      const nextStatus = await auth.login({
        login: values.login,
        accessCode: values.accessCode,
        serverUrl: ERP_CLOUD_SERVER_URL,
      });
      message.success(`已连接云端：${nextStatus.currentUser?.name || values.login}`);
      cloudForm.resetFields(["accessCode"]);
      await loadUsers();
    } catch (error: any) {
      message.error(error?.message || "云端连接失败");
    } finally {
      setCloudSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!erp) return;
    if (!canManageUsers) {
      message.warning("请先连接云端，再创建或编辑用户");
      return;
    }
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await erp.user.upsert({
        id: values.id,
        name: values.name,
        role: values.role,
        status: values.status || "active",
        accessCode: values.accessCode,
      });
      message.success(values.id ? "用户已更新" : "用户已创建");
      resetForm();
      await loadUsers();
    } catch (error: any) {
      message.error(error?.message || "用户保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (record: ErpUserRow) => {
    form.setFieldsValue({
      id: record.id,
      name: record.name,
      role: record.role,
      status: record.status || "active",
      accessCode: "",
    });
  };

  const handleToggleStatus = async (record: ErpUserRow) => {
    if (!erp) return;
    if (!canManageUsers) {
      message.warning("请先连接云端，再停用或启用用户");
      return;
    }
    const nextStatus = record.status === "active" ? "blocked" : "active";
    if (record.id === auth.currentUser?.id && nextStatus === "blocked") {
      message.warning("不能停用当前登录用户");
      return;
    }
    setSubmitting(true);
    try {
      await erp.user.upsert({
        id: record.id,
        name: record.name,
        role: record.role,
        status: nextStatus,
      });
      message.success(nextStatus === "active" ? "用户已启用" : "用户已停用");
      await loadUsers();
    } catch (error: any) {
      message.error(error?.message || "用户状态更新失败");
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<ErpUserRow> = [
    {
      title: "用户",
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (value, record) => (
        <Space direction="vertical" size={2}>
          <Text strong>{value}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{record.id}</Text>
        </Space>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      key: "role",
      width: 120,
      render: (value) => <Tag color="blue">{roleLabel(value)}</Tag>,
    },
    {
      title: "访问码",
      dataIndex: "hasAccessCode",
      key: "hasAccessCode",
      width: 110,
      render: (value) => <Tag color={value ? "success" : "warning"}>{value ? "已设置" : "未设置"}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: statusTag,
    },
    {
      title: "更新",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: formatTime,
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_, record) => (
        <Space size={8}>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Button
            size="small"
            danger={record.status === "active"}
            icon={record.status === "active" ? <StopOutlined /> : <SafetyCertificateOutlined />}
            onClick={() => void handleToggleStatus(record)}
          >
            {record.status === "active" ? "停用" : "启用"}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="app-stack">
      <PageHeader
        eyebrow="系统"
        title="用户管理"
        subtitle="创建采购、仓库、运营和财务账号。访问码会安全保存，忘记后需要重新设置。"
        meta={[`共 ${users.length} 个用户`, `启用 ${activeCount} 个`, roleCountText]}
        actions={<Button icon={<ReloadOutlined />} onClick={() => void loadUsers()} loading={loading}>刷新</Button>}
      />

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">用户同步</div>
            <div className="app-panel__title-sub">用户管理统一同步云端服务器，避免本地和云端两套数据不一致。</div>
          </div>
          <Tag color={isCloudMode ? "success" : "warning"}>
            {isCloudMode ? "云端模式" : "未连接云端"}
          </Tag>
        </div>
        <Alert
          type={isCloudMode ? "success" : "warning"}
          showIcon
          message={isCloudMode ? "当前正在同步云端用户库" : "请先连接云端"}
          description={isCloudMode ? "创建、编辑和停用用户都会直接同步到云端服务器。" : "本地历史数据不会丢失，但用户管理以云端为准；连接后列表会显示服务器上的用户。"}
          style={{ marginBottom: 12 }}
        />
        <Form form={cloudForm} layout="vertical" initialValues={{ login: "admin" }}>
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item name="login" label="管理员" rules={[{ required: true, message: "请输入管理员用户" }]}>
                <Input placeholder="admin" />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item name="accessCode" label="访问码" rules={[{ required: true, message: "请输入访问码" }]}>
                <Input.Password placeholder="云端管理员访问码" />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label=" ">
                <Button block type="primary" icon={<SyncOutlined />} loading={cloudSubmitting} onClick={handleConnectCloud}>
                  连接
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">{editingId ? "编辑用户" : "创建用户"}</div>
            <div className="app-panel__title-sub">新用户必须设置访问码；保存后立即写入{userStoreName}。</div>
          </div>
          <KeyOutlined style={{ color: "var(--color-brand)", fontSize: 18 }} />
        </div>
        {!canManageUsers ? (
          <Alert
            type="warning"
            showIcon
            message="暂不能创建用户"
            description="请先在上方输入管理员和访问码连接云端。"
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Form form={form} layout="vertical" initialValues={{ role: "buyer", status: "active" }} disabled={!canManageUsers}>
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} md={6}>
              <Form.Item name="name" label="用户名称" rules={[{ required: true, message: "请输入用户名称" }]}>
                <Input placeholder="例如：采购小王" />
              </Form.Item>
            </Col>
            <Col xs={24} md={5}>
              <Form.Item name="role" label="角色" rules={[{ required: true, message: "请选择角色" }]}>
                <Select options={ROLE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={4}>
              <Form.Item name="status" label="状态">
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item
                name="accessCode"
                label="访问码"
                dependencies={["id"]}
                rules={[
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (getFieldValue("id") || value) return Promise.resolve();
                      return Promise.reject(new Error("请输入访问码"));
                    },
                  }),
                ]}
              >
                <Input.Password placeholder={editingId ? "留空则不修改" : "用于登录软件"} />
              </Form.Item>
            </Col>
            <Col xs={24} md={3}>
              <Form.Item label=" ">
                <Space.Compact block>
                  <Button type="primary" icon={<PlusOutlined />} loading={submitting} onClick={handleSubmit}>
                    保存
                  </Button>
                  {editingId ? <Button onClick={resetForm}>取消</Button> : null}
                </Space.Compact>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">系统用户</div>
            <div className="app-panel__title-sub">列表来自{userStoreName}；启用的用户可以按角色登录软件。</div>
          </div>
          <SafetyCertificateOutlined style={{ color: "var(--color-success)", fontSize: 18 }} />
        </div>
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={users}
          pagination={{ pageSize: 8, showSizeChanger: false }}
        />
      </div>
    </div>
  );
}
