import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Col, Form, Input, Modal, Row, Select, Space, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, ReloadOutlined, ShopOutlined, TagsOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { useErpAuth } from "../contexts/ErpAuthContext";

const erp = window.electronAPI?.erp;

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
  accountId?: string | null;
  internalSkuCode: string;
  productName: string;
  category?: string | null;
  supplierId?: string | null;
  status?: string;
  updatedAt?: string;
}

interface SkuDialogValues {
  productName: string;
  colorSpec: string;
  accountId?: string;
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

function canRole(role: string | undefined, roles: string[]) {
  return Boolean(role && roles.includes(role));
}

function createAutoSkuCode() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SKU-${stamp}-${suffix}`;
}

export default function ProductMasterData() {
  const auth = useErpAuth();
  const role = auth.currentUser?.role;
  const canManageAccounts = canRole(role, ["admin", "manager"]);
  const canManageSuppliers = canRole(role, ["admin", "manager", "buyer"]);
  const canManageSkus = canRole(role, ["admin", "manager", "operations"]);

  const [accountForm] = Form.useForm();
  const [supplierForm] = Form.useForm();
  const [skuForm] = Form.useForm();
  const [accounts, setAccounts] = useState<ErpAccountRow[]>([]);
  const [suppliers, setSuppliers] = useState<ErpSupplierRow[]>([]);
  const [skus, setSkus] = useState<ErpSkuRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [skuModalOpen, setSkuModalOpen] = useState(false);

  const accountOptions = useMemo(
    () => accounts.map((account) => ({ label: account.name || account.id, value: account.id })),
    [accounts],
  );

  const accountNameById = useMemo(() => {
    const lookup = new Map<string, string>();
    accounts.forEach((account) => lookup.set(account.id, account.name));
    return lookup;
  }, [accounts]);

  const loadAll = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const [nextAccounts, nextSuppliers, nextSkus] = await Promise.all([
        erp.account.list({ limit: 500 }),
        erp.supplier.list({ limit: 500 }),
        erp.sku.list({ limit: 500 }),
      ]);
      setAccounts(nextAccounts as ErpAccountRow[]);
      setSuppliers(nextSuppliers as ErpSupplierRow[]);
      setSkus(nextSkus as ErpSkuRow[]);
    } catch (error: any) {
      message.error(error?.message || "商品资料读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleCreateAccount = async () => {
    if (!erp) return;
    const values = await accountForm.validateFields();
    setSubmitting("account");
    try {
      await erp.account.upsert({
        name: values.name,
        phone: values.phone,
        status: values.status || "online",
        source: "product_master_data",
      });
      accountForm.resetFields();
      message.success("店铺已保存");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "店铺保存失败");
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
    const values = await skuForm.validateFields() as SkuDialogValues;
    setSubmitting("sku");
    try {
      await erp.sku.create({
        accountId: values.accountId,
        internalSkuCode: createAutoSkuCode(),
        productName: values.productName,
        category: values.colorSpec,
        status: "active",
      });
      skuForm.resetFields();
      setSkuModalOpen(false);
      message.success("商品资料已创建");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "商品资料创建失败");
    } finally {
      setSubmitting(null);
    }
  };

  const accountColumns: ColumnsType<ErpAccountRow> = [
    { title: "店铺", dataIndex: "name", key: "name", ellipsis: true },
    { title: "电话", dataIndex: "phone", key: "phone", width: 140, render: (value) => value || "-" },
    { title: "状态", dataIndex: "status", key: "status", width: 92, render: (value) => <Tag color={statusColor(value)}>{value || "-"}</Tag> },
    { title: "来源", dataIndex: "source", key: "source", width: 160, render: (value) => value || "-" },
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
    { title: "商品编码", dataIndex: "internalSkuCode", key: "internalSkuCode", width: 160, ellipsis: true },
    { title: "商品名称", dataIndex: "productName", key: "productName", ellipsis: true },
    { title: "颜色/规格", dataIndex: "category", key: "category", width: 180, render: (value) => value || "-" },
    {
      title: "店铺",
      dataIndex: "accountId",
      key: "accountId",
      width: 150,
      render: (value?: string | null) => accountNameById.get(value || "") || (value ? idShort(value) : "公司级"),
    },
    { title: "状态", dataIndex: "status", key: "status", width: 92, render: (value) => <Tag color={statusColor(value)}>{value || "-"}</Tag> },
  ];

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="ERP" title="商品资料" subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境没有 window.electronAPI.erp" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="ERP"
        title="商品资料"
        subtitle="维护公司级商品名称、颜色/规格和可选店铺归属。"
        actions={(
          <Button icon={<ReloadOutlined />} loading={loading} onClick={loadAll}>
            刷新
          </Button>
        )}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <StatCard title="商品编码" value={skus.length} suffix="条" color="brand" icon={<TagsOutlined />} />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="供应商" value={suppliers.length} suffix="条" color="blue" icon={<ShopOutlined />} />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="店铺" value={accounts.length} suffix="条" color="success" icon={<ShopOutlined />} />
        </Col>
      </Row>

      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div className="app-panel">
          <div className="app-panel__title">
            <div>
              <div className="app-panel__title-main">商品资料</div>
              <div className="app-panel__title-sub">新增时只填写商品名称、颜色/规格和店铺；商品编码自动生成</div>
            </div>
            {canManageSkus ? (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  skuForm.resetFields();
                  setSkuModalOpen(true);
                }}
              >
                新增商品
              </Button>
            ) : null}
          </div>
          {!canManageSkus ? (
            <Alert type="info" showIcon message="当前角色可查看商品资料，创建商品编码需要运营、负责人或管理员权限。" style={{ marginBottom: 12 }} />
          ) : null}
          <Table
            size="small"
            rowKey="id"
            loading={loading}
            columns={skuColumns}
            dataSource={skus}
            pagination={{ pageSize: 8, showSizeChanger: false }}
          />
        </div>

        <div className="app-panel">
          <div className="app-panel__title">
            <div>
              <div className="app-panel__title-main">供应商</div>
              <div className="app-panel__title-sub">采购寻源、报价和商品编码可关联供应商</div>
            </div>
          </div>
          {canManageSuppliers ? (
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
          ) : (
            <Alert type="info" showIcon message="当前角色可查看供应商资料，维护供应商需要采购、负责人或管理员权限。" style={{ marginBottom: 12 }} />
          )}
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
              <div className="app-panel__title-main">店铺</div>
              <div className="app-panel__title-sub">可选销售店铺资料，采购建档不再依赖店铺</div>
            </div>
          </div>
          {canManageAccounts ? (
            <Form form={accountForm} layout="vertical">
              <Row gutter={12}>
                <Col xs={24} md={9}>
                  <Form.Item name="name" label="店铺名称" rules={[{ required: true, message: "请输入店铺名称" }]}>
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
          ) : (
            <Alert type="info" showIcon message="账号资料由负责人或管理员维护。" style={{ marginBottom: 12 }} />
          )}
          <Table
            size="small"
            rowKey="id"
            loading={loading}
            columns={accountColumns}
            dataSource={accounts}
            pagination={{ pageSize: 5, showSizeChanger: false }}
          />
        </div>
      </Space>

      <Modal
        title="新增商品"
        open={skuModalOpen}
        okText="创建"
        cancelText="取消"
        confirmLoading={submitting === "sku"}
        onOk={handleCreateSku}
        onCancel={() => setSkuModalOpen(false)}
        destroyOnClose
      >
        <Form form={skuForm} layout="vertical">
          <Form.Item name="productName" label="商品名称" rules={[{ required: true, message: "请输入商品名称" }]}>
            <Input placeholder="例如：儿童保温杯" />
          </Form.Item>
          <Form.Item name="colorSpec" label="颜色/规格" rules={[{ required: true, message: "请输入颜色/规格" }]}>
            <Input placeholder="例如：蓝色 / 500ml / 单只装" />
          </Form.Item>
          <Form.Item name="accountId" label="店铺">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={accountOptions}
              placeholder="可选；不选则为公司级商品"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
