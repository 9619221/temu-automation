import { useCallback, useEffect, useMemo, useState } from "react";
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
  ShopOutlined,
  TagsOutlined,
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
  return ROLE_OPTIONS.find((item) => item.value === role)?.label || role || "-";
}

interface ErpAccountRow {
  id: string;
  name: string;
  phone?: string | null;
  status?: string;
  source?: string;
  updatedAt?: string;
}

interface ErpSupplierRow {
  id: string;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  wechat?: string | null;
  categories?: string[];
  status?: string;
  updatedAt?: string;
}

interface ErpSkuRow {
  id: string;
  accountId: string;
  internalSkuCode: string;
  productName: string;
  category?: string | null;
  supplierId?: string | null;
  status?: string;
  updatedAt?: string;
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

function idShort(id?: string | null) {
  if (!id) return "-";
  return id.length > 18 ? `${id.slice(0, 8)}...${id.slice(-6)}` : id;
}

export default function ErpDebug() {
  const [accountForm] = Form.useForm();
  const [supplierForm] = Form.useForm();
  const [skuForm] = Form.useForm();
  const [userForm] = Form.useForm();
  const [status, setStatus] = useState<ErpStatusView | null>(null);
  const [lanStatus, setLanStatus] = useState<ErpLanStatusView | null>(null);
  const [accounts, setAccounts] = useState<ErpAccountRow[]>([]);
  const [users, setUsers] = useState<ErpUserRow[]>([]);
  const [suppliers, setSuppliers] = useState<ErpSupplierRow[]>([]);
  const [skus, setSkus] = useState<ErpSkuRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lanLoading, setLanLoading] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const accountOptions = useMemo(
    () => accounts.map((account) => ({ label: account.name || account.id, value: account.id })),
    [accounts],
  );

  const supplierOptions = useMemo(
    () => suppliers.map((supplier) => ({ label: supplier.name || supplier.id, value: supplier.id })),
    [suppliers],
  );

  const supplierNameById = useMemo(() => {
    const lookup = new Map<string, string>();
    suppliers.forEach((supplier) => lookup.set(supplier.id, supplier.name));
    return lookup;
  }, [suppliers]);

  const loadAll = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const [nextStatus, nextAccounts, nextUsers, nextSuppliers, nextSkus] = await Promise.all([
        erp.getStatus(),
        erp.account.list({ limit: 100 }),
        erp.user.list({ limit: 100 }),
        erp.supplier.list({ limit: 100 }),
        erp.sku.list({ limit: 100 }),
      ]);
      const nextLanStatus = await erp.lan.getStatus();
      setStatus(nextStatus);
      setLanStatus(nextLanStatus);
      setAccounts(nextAccounts as ErpAccountRow[]);
      setUsers(nextUsers as ErpUserRow[]);
      setSuppliers(nextSuppliers as ErpSupplierRow[]);
      setSkus(nextSkus as ErpSkuRow[]);
    } catch (error: any) {
      message.error(error?.message || "ERP 状态读取失败");
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
      message.success("Migration 检查完成");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "Migration 执行失败");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async () => {
    if (!erp) return;
    const values = await accountForm.validateFields();
    setSubmitting("account");
    try {
      await erp.account.upsert({
        name: values.name,
        phone: values.phone,
        status: values.status || "online",
        source: "debug_page",
      });
      accountForm.resetFields();
      message.success("账号已保存");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "账号保存失败");
    } finally {
      setSubmitting(null);
    }
  };

  const handleCreateSupplier = async () => {
    if (!erp) return;
    const values = await supplierForm.validateFields();
    setSubmitting("supplier");
    try {
      await erp.supplier.create({
        name: values.name,
        contactName: values.contactName,
        phone: values.phone,
        wechat: values.wechat,
        categories: values.categories || [],
        status: values.status || "active",
      });
      supplierForm.resetFields();
      message.success("供应商已创建");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "供应商创建失败");
    } finally {
      setSubmitting(null);
    }
  };

  const handleCreateSku = async () => {
    if (!erp) return;
    const values = await skuForm.validateFields();
    setSubmitting("sku");
    try {
      await erp.sku.create({
        accountId: values.accountId,
        internalSkuCode: values.internalSkuCode,
        productName: values.productName,
        category: values.category,
        supplierId: values.supplierId,
        status: values.status || "active",
      });
      skuForm.resetFields(["internalSkuCode", "productName", "category"]);
      message.success("SKU 已创建");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "SKU 创建失败");
    } finally {
      setSubmitting(null);
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

  const accountColumns: ColumnsType<ErpAccountRow> = [
    { title: "账号", dataIndex: "name", key: "name", ellipsis: true },
    { title: "电话", dataIndex: "phone", key: "phone", width: 140, render: (value) => value || "-" },
    { title: "状态", dataIndex: "status", key: "status", width: 92, render: (value) => <Tag color={statusColor(value)}>{value || "-"}</Tag> },
    { title: "来源", dataIndex: "source", key: "source", width: 120, render: (value) => value || "-" },
    { title: "更新", dataIndex: "updatedAt", key: "updatedAt", width: 170, render: formatTime },
  ];

  const supplierColumns: ColumnsType<ErpSupplierRow> = [
    { title: "供应商", dataIndex: "name", key: "name", ellipsis: true },
    { title: "联系人", dataIndex: "contactName", key: "contactName", width: 110, render: (value) => value || "-" },
    { title: "电话", dataIndex: "phone", key: "phone", width: 140, render: (value) => value || "-" },
    { title: "微信", dataIndex: "wechat", key: "wechat", width: 140, render: (value) => value || "-" },
    {
      title: "类目",
      dataIndex: "categories",
      key: "categories",
      width: 180,
      render: (items: string[] = []) => items.length ? items.map((item) => <Tag key={item}>{item}</Tag>) : "-",
    },
    { title: "状态", dataIndex: "status", key: "status", width: 92, render: (value) => <Tag color={statusColor(value)}>{value || "-"}</Tag> },
  ];

  const skuColumns: ColumnsType<ErpSkuRow> = [
    { title: "SKU", dataIndex: "internalSkuCode", key: "internalSkuCode", width: 160, ellipsis: true },
    { title: "商品", dataIndex: "productName", key: "productName", ellipsis: true },
    { title: "类目", dataIndex: "category", key: "category", width: 120, render: (value) => value || "-" },
    {
      title: "供应商",
      dataIndex: "supplierId",
      key: "supplierId",
      width: 160,
      render: (value) => supplierNameById.get(value) || idShort(value),
    },
    { title: "状态", dataIndex: "status", key: "status", width: 92, render: (value) => <Tag color={statusColor(value)}>{value || "-"}</Tag> },
  ];

  const userColumns: ColumnsType<ErpUserRow> = [
    { title: "用户", dataIndex: "name", key: "name", ellipsis: true },
    { title: "角色", dataIndex: "role", key: "role", width: 100, render: (value) => <Tag>{roleLabel(value)}</Tag> },
    { title: "访问码", dataIndex: "hasAccessCode", key: "hasAccessCode", width: 100, render: (value) => <Tag color={value ? "success" : "warning"}>{value ? "已设置" : "未设置"}</Tag> },
    { title: "状态", dataIndex: "status", key: "status", width: 92, render: (value) => <Tag color={statusColor(value)}>{value || "-"}</Tag> },
    { title: "更新", dataIndex: "updatedAt", key: "updatedAt", width: 170, render: formatTime },
  ];

  const migrationColumns: ColumnsType<{ key: string; status: string }> = [
    { title: "Migration", dataIndex: "key", key: "key", ellipsis: true },
    { title: "状态", dataIndex: "status", key: "status", width: 120, render: (value) => <Tag color={statusColor(value)}>{value}</Tag> },
  ];

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="ERP" title="ERP 调试台" subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境没有 window.electronAPI.erp" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="ERP"
        title="ERP 调试台"
        subtitle="数据状态、基础资料和团队协作入口"
        meta={[
          status?.initialized ? "数据服务已就绪" : "数据服务未就绪",
          status?.dbPath || "等待状态",
        ]}
        actions={[
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={loadAll}>
            刷新
          </Button>,
          <Button key="migration" type="primary" icon={<DatabaseOutlined />} loading={loading} onClick={handleRunMigrations}>
            检查 Migration
          </Button>,
        ]}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <StatCard title="数据服务" value={status?.initialized ? "Ready" : "Not ready"} color="blue" icon={<DatabaseOutlined />} />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="Migration" value={`${successMigrationCount}/${migrationRows.length || 5}`} color="success" icon={<CheckCircleOutlined />} />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="基础资料" value={`${accounts.length + suppliers.length + skus.length}`} suffix="条" color="purple" icon={<TagsOutlined />} />
        </Col>
      </Row>

      {status?.error?.message ? (
        <Alert type="error" showIcon message="ERP 初始化异常" description={status.error.message} style={{ marginBottom: 16 }} />
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
                        <div className="app-panel__title-sub">本机 ERP 数据库</div>
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
                        <div className="app-panel__title-main">Migration</div>
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
            key: "master-data",
            label: (
              <Space size={6}>
                <ShopOutlined />
                基础资料
              </Space>
            ),
            children: (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <div className="app-panel">
                  <div className="app-panel__title">
                    <div>
                      <div className="app-panel__title-main">账号</div>
                      <div className="app-panel__title-sub">{accounts.length} 条记录</div>
                    </div>
                  </div>
                  <Form form={accountForm} layout="vertical">
                    <Row gutter={12}>
                      <Col xs={24} md={9}>
                        <Form.Item name="name" label="账号名称" rules={[{ required: true, message: "请输入账号名称" }]}>
                          <Input placeholder="例如：主店铺" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={6}>
                        <Form.Item name="phone" label="手机号">
                          <Input placeholder="可选" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={5}>
                        <Form.Item name="status" label="状态" initialValue="online">
                          <Select
                            options={[
                              { label: "online", value: "online" },
                              { label: "offline", value: "offline" },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={4}>
                        <Form.Item label=" ">
                          <Button type="primary" block icon={<PlusOutlined />} loading={submitting === "account"} onClick={handleCreateAccount}>
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
                    columns={accountColumns}
                    dataSource={accounts}
                    pagination={{ pageSize: 5, showSizeChanger: false }}
                  />
                </div>

                <div className="app-panel">
                  <div className="app-panel__title">
                    <div>
                      <div className="app-panel__title-main">供应商</div>
                      <div className="app-panel__title-sub">{suppliers.length} 条记录</div>
                    </div>
                  </div>
                  <Form form={supplierForm} layout="vertical">
                    <Row gutter={12}>
                      <Col xs={24} md={7}>
                        <Form.Item name="name" label="供应商名称" rules={[{ required: true, message: "请输入供应商名称" }]}>
                          <Input placeholder="例如：义乌某某工厂" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={4}>
                        <Form.Item name="contactName" label="联系人">
                          <Input placeholder="可选" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={4}>
                        <Form.Item name="phone" label="电话">
                          <Input placeholder="可选" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={4}>
                        <Form.Item name="wechat" label="微信">
                          <Input placeholder="可选" />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={3}>
                        <Form.Item name="status" label="状态" initialValue="active">
                          <Select
                            options={[
                              { label: "active", value: "active" },
                              { label: "blocked", value: "blocked" },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={2}>
                        <Form.Item label=" ">
                          <Button type="primary" block icon={<PlusOutlined />} loading={submitting === "supplier"} onClick={handleCreateSupplier} />
                        </Form.Item>
                      </Col>
                      <Col xs={24}>
                        <Form.Item name="categories" label="类目">
                          <Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入后回车" />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Form>
                  <Table
                    size="small"
                    rowKey="id"
                    loading={loading}
                    columns={supplierColumns}
                    dataSource={suppliers}
                    pagination={{ pageSize: 5, showSizeChanger: false }}
                  />
                </div>

                <div className="app-panel">
                  <div className="app-panel__title">
                    <div>
                      <div className="app-panel__title-main">SKU</div>
                      <div className="app-panel__title-sub">{skus.length} 条记录</div>
                    </div>
                  </div>
                  <Form form={skuForm} layout="vertical">
                    <Row gutter={12}>
                      <Col xs={24} md={5}>
                        <Form.Item name="accountId" label="账号" rules={[{ required: true, message: "请选择账号" }]}>
                          <Select options={accountOptions} placeholder="选择账号" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={5}>
                        <Form.Item name="supplierId" label="供应商">
                          <Select options={supplierOptions} placeholder="可选" allowClear />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={5}>
                        <Form.Item name="internalSkuCode" label="内部 SKU" rules={[{ required: true, message: "请输入内部 SKU" }]}>
                          <Input placeholder="SKU-001" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={5}>
                        <Form.Item name="productName" label="商品名称" rules={[{ required: true, message: "请输入商品名称" }]}>
                          <Input placeholder="商品名称" />
                        </Form.Item>
                      </Col>
                      <Col xs={16} md={3}>
                        <Form.Item name="category" label="类目">
                          <Input placeholder="可选" />
                        </Form.Item>
                      </Col>
                      <Col xs={8} md={1}>
                        <Form.Item label=" ">
                          <Button type="primary" block icon={<PlusOutlined />} loading={submitting === "sku"} onClick={handleCreateSku} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Form>
                  <Table
                    size="small"
                    rowKey="id"
                    loading={loading}
                    columns={skuColumns}
                    dataSource={skus}
                    pagination={{ pageSize: 8, showSizeChanger: false }}
                  />
                </div>
              </Space>
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
                          <Text code>{lanStatus?.primaryUrl || "http://本机IP:19380"}</Text>
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
                        message={lanStatus?.running ? "团队协作服务已开启" : "启动服务后会开放采购、仓库、QC 和出库工作台"}
                        description="采购、仓库、QC、出库和事项工作台可供团队成员登录后使用；用户与权限由管理员统一管理。"
                      />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {(lanStatus?.routes || [
                          { path: "/purchase", label: "采购工作台" },
                          { path: "/warehouse", label: "仓库工作台" },
                          { path: "/qc", label: "QC 抽检工作台" },
                        ]).map((route) => (
                          <Tag icon={<ApiOutlined />} key={route.path}>{route.path}</Tag>
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
                                { label: "active", value: "active" },
                                { label: "blocked", value: "blocked" },
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
