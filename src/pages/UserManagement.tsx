import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Col, Form, Input, Modal, Row, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EditOutlined, KeyOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, StopOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import { roleLabel } from "../utils/erpRoleAccess";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { hasPageCache, readPageCache, writePageCache } from "../utils/pageCache";
import RolePermissionPanel from "../components/RolePermissionPanel";
import UserPermissionModal from "../components/UserPermissionModal";

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

interface UserManagementCache {
  generatedAt?: string;
  users: ErpUserRow[];
  clientStatus: ClientStatusView | null;
}

const USER_MANAGEMENT_CACHE_KEY = "page-cache:user-management:v1";

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
  const auth = useErpAuth();
  const cached = useMemo(() => readPageCache<UserManagementCache>(USER_MANAGEMENT_CACHE_KEY, {
    users: [],
    clientStatus: null,
  }), []);
  const [users, setUsers] = useState<ErpUserRow[]>(() => cached.users || []);
  const [clientStatus, setClientStatus] = useState<ClientStatusView | null>(() => cached.clientStatus || null);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(() => hasPageCache(cached));
  const [submitting, setSubmitting] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [permUser, setPermUser] = useState<ErpUserRow | null>(null);
  const editingId = Form.useWatch("id", form);

  const activeCount = useMemo(() => users.filter((user) => user.status === "active").length, [users]);
  const roleCountText = useMemo(() => {
    const roles = new Set(users.map((user) => user.role).filter(Boolean));
    return `${roles.size} 个角色`;
  }, [users]);
  const isCloudMode = Boolean(clientStatus?.isClientMode);
  const canManageUsers = isCloudMode;
  const tableLoading = loading && !loadedOnce && users.length > 0;
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
        const nextCache = {
          generatedAt: new Date().toISOString(),
          users: [],
          clientStatus: nextClientStatus as ClientStatusView | null,
        };
        setLoadedOnce(true);
        writePageCache(USER_MANAGEMENT_CACHE_KEY, nextCache);
        return;
      }
      const nextUsers = await erp.user.list({ limit: 200 });
      const nextCache = {
        generatedAt: new Date().toISOString(),
        users: nextUsers as ErpUserRow[],
        clientStatus: nextClientStatus as ClientStatusView | null,
      };
      setUsers(nextCache.users);
      setLoadedOnce(true);
      writePageCache(USER_MANAGEMENT_CACHE_KEY, nextCache);
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

  const openCreate = () => {
    if (!canManageUsers) {
      message.warning("请先连接云端，再创建用户");
      return;
    }
    resetForm();
    setUserModalOpen(true);
  };

  const closeUserModal = () => {
    setUserModalOpen(false);
    resetForm();
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
      setUserModalOpen(false);
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
    setUserModalOpen(true);
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
      render: (value) => <Text strong>{value}</Text>,
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
      width: 280,
      render: (_, record) => (
        <Space size={8}>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Button size="small" icon={<KeyOutlined />} onClick={() => setPermUser(record)}>
            权限
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
            <div className="app-panel__title-main">系统用户</div>
            <div className="app-panel__title-sub">列表来自{userStoreName}；启用的用户可以按角色登录软件。</div>
          </div>
          <Space>
            <Tag color={isCloudMode ? "success" : "warning"}>{isCloudMode ? "云端模式" : "未连接云端"}</Tag>
            <Button type="primary" icon={<PlusOutlined />} disabled={!canManageUsers} onClick={openCreate}>
              新建用户
            </Button>
          </Space>
        </div>
        <Table
          size="small"
          rowKey="id"
          loading={tableLoading}
          columns={columns}
          dataSource={users}
          pagination={{ pageSize: 8, showSizeChanger: false }}
        />
      </div>

      <RolePermissionPanel disabled={!canManageUsers} />

      <Modal
        open={userModalOpen}
        title={editingId ? "编辑用户" : "新建用户"}
        width={460}
        onCancel={closeUserModal}
        onOk={handleSubmit}
        okText="保存"
        confirmLoading={submitting}
        destroyOnClose
        centered
      >
        <Form form={form} layout="vertical" initialValues={{ role: "buyer", status: "active" }}>
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="用户名称" rules={[{ required: true, message: "请输入用户名称" }]}>
            <Input placeholder="例如：采购小王" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="role" label="角色" rules={[{ required: true, message: "请选择角色" }]}>
                <Select options={ROLE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="状态">
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </Col>
          </Row>
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
        </Form>
      </Modal>

      <UserPermissionModal
        open={Boolean(permUser)}
        user={permUser}
        onClose={(changed) => {
          setPermUser(null);
          if (changed) void loadUsers();
        }}
      />
    </div>
  );
}
