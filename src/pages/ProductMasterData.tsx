import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Col, Form, Image, Input, Modal, Popconfirm, Row, Select, Space, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
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
  colorSpec?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  supplierId?: string | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface SkuDialogValues {
  productName: string;
  colorSpec: string;
  imageUrl?: string;
  accountId?: string;
}

type MasterDataMode = "skus" | "suppliers" | "stores";

interface ProductMasterDataProps {
  mode?: MasterDataMode;
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

function statusLabel(status?: string | null) {
  if (!status) return "-";
  return STATUS_LABELS[status] || "未知状态";
}

function sourceLabel(source?: string | null) {
  if (!source) return "-";
  const labels: Record<string, string> = {
    product_master_data: "商品资料",
  };
  return labels[source] || "其他来源";
}

function canRole(role: string | undefined, roles: string[]) {
  return Boolean(role && roles.includes(role));
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function ProductMasterData({ mode = "skus" }: ProductMasterDataProps) {
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
  const pageTitle = mode === "suppliers" ? "供应商" : mode === "stores" ? "店铺" : "商品资料";
  const pageMeta = mode === "suppliers"
    ? [`供应商 ${suppliers.length}`]
    : mode === "stores"
      ? [`店铺 ${accounts.length}`]
      : [`商品 ${skus.length}`];

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
        productName: values.productName,
        colorSpec: values.colorSpec,
        imageUrl: values.imageUrl,
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

  const handleDeleteSku = async (row: ErpSkuRow) => {
    if (!erp) return;
    setSubmitting(`delete-sku:${row.id}`);
    try {
      await erp.sku.delete({ id: row.id });
      message.success("商品资料已删除");
      await loadAll();
    } catch (error: any) {
      message.error(error?.message || "商品资料删除失败");
    } finally {
      setSubmitting(null);
    }
  };

  const accountColumns: ColumnsType<ErpAccountRow> = [
    { title: "店铺", dataIndex: "name", key: "name", ellipsis: true },
    { title: "电话", dataIndex: "phone", key: "phone", width: 140, render: (value) => value || "-" },
    { title: "状态", dataIndex: "status", key: "status", width: 92, render: (value) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
    { title: "来源", dataIndex: "source", key: "source", width: 160, render: sourceLabel },
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
    { title: "状态", dataIndex: "status", key: "status", width: 92, render: (value) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
  ];

  const skuColumns: ColumnsType<ErpSkuRow> = [
    {
      title: "图片",
      dataIndex: "imageUrl",
      key: "imageUrl",
      width: 72,
      render: (value: string | null | undefined) => value ? (
        <Image
          src={value}
          alt="商品图片"
          width={44}
          height={44}
          preview={{ mask: "查看" }}
          style={{ borderRadius: 6, objectFit: "cover", background: "#f5f7fb" }}
        />
      ) : (
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 6,
            border: "1px dashed #d8dee9",
            color: "#98a2b3",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f8fafc",
          }}
        >
          无图
        </div>
      ),
    },
    { title: "商品编码", dataIndex: "internalSkuCode", key: "internalSkuCode", width: 128, ellipsis: true },
    { title: "商品名称", dataIndex: "productName", key: "productName", ellipsis: true },
    { title: "颜色/规格", dataIndex: "colorSpec", key: "colorSpec", width: 180, render: (value, row) => value || row.category || "-" },
    {
      title: "店铺",
      dataIndex: "accountId",
      key: "accountId",
      width: 150,
      render: (value) => accounts.find((account) => account.id === value)?.name || "-",
    },
    { title: "状态", dataIndex: "status", key: "status", width: 92, render: (value) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
    { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 142, render: formatDateTime },
    ...(canManageSkus ? [{
      title: "操作",
      key: "actions",
      width: 96,
      render: (_value: unknown, row: ErpSkuRow) => (
        <Popconfirm
          title="删除商品资料"
          description="未被采购、库存等单据引用时才会删除。"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => handleDeleteSku(row)}
        >
          <Button
            danger
            size="small"
            type="text"
            icon={<DeleteOutlined />}
            loading={submitting === `delete-sku:${row.id}`}
          >
            删除
          </Button>
        </Popconfirm>
      ),
    }] : []),
  ];

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="系统" title={pageTitle} subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境缺少本地服务接口" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="系统"
        title={pageTitle}
        meta={pageMeta}
        actions={[
          mode === "skus" && canManageSkus ? (
            <Button
              key="new-sku"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                skuForm.resetFields();
                if (accounts.length === 1) {
                  skuForm.setFieldsValue({ accountId: accounts[0].id });
                }
                setSkuModalOpen(true);
              }}
            >
              新增商品
            </Button>
          ) : null,
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={loadAll}>
            刷新
          </Button>,
        ].filter(Boolean)}
      />

      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {mode === "skus" ? (
        <div className="app-panel">
          <div className="app-panel__title">
            <div>
              <div className="app-panel__title-main">商品资料</div>
            </div>
          </div>
          {!canManageSkus ? (
            <Alert type="info" showIcon message="当前角色仅可查看商品资料。" style={{ marginBottom: 12 }} />
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
        ) : null}

        {mode === "suppliers" ? (
        <div className="app-panel">
          <div className="app-panel__title">
            <div>
              <div className="app-panel__title-main">供应商</div>
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
                        { label: "启用", value: "active" },
                        { label: "停用", value: "blocked" },
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
            <Alert type="info" showIcon message="当前角色仅可查看供应商。" style={{ marginBottom: 12 }} />
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
        ) : null}

        {mode === "stores" ? (
        <div className="app-panel">
          <div className="app-panel__title">
            <div>
              <div className="app-panel__title-main">店铺</div>
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
                        { label: "在线", value: "online" },
                        { label: "下线", value: "offline" },
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
            <Alert type="info" showIcon message="当前角色仅可查看店铺。" style={{ marginBottom: 12 }} />
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
        ) : null}
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
        {accounts.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            message="还没有店铺"
            description="请先到左侧店铺新增店铺，再回来创建商品。"
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Form form={skuForm} layout="vertical">
          <Form.Item name="productName" label="商品名称" rules={[{ required: true, message: "请输入商品名称" }]}>
            <Input placeholder="例如：儿童保温杯" />
          </Form.Item>
          <Form.Item name="colorSpec" label="颜色/规格" rules={[{ required: true, message: "请输入颜色/规格" }]}>
            <Input placeholder="例如：蓝色 / 500ml / 单只装" />
          </Form.Item>
          <Form.Item name="imageUrl" label="商品图片链接" rules={[{ type: "url", message: "请输入完整图片链接" }]}>
            <Input placeholder="可选；用于商品识别和以图搜款" />
          </Form.Item>
          <Form.Item name="accountId" label="店铺" rules={[{ required: true, message: "请选择店铺" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={accounts.map((account) => ({ label: account.name || account.id, value: account.id }))}
              placeholder="请选择商品所属店铺"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
