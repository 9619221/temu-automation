import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Col,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { ApiOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import { useErpAuth } from "../contexts/ErpAuthContext";

const { Text } = Typography;
const { TextArea } = Input;
const erp = window.electronAPI?.erp;

interface SkuOptionRow {
  id: string;
  accountId?: string | null;
  internalSkuCode?: string;
  productName?: string;
  colorSpec?: string | null;
  imageUrl?: string | null;
}

interface Sku1688SourceRow {
  id: string;
  accountId?: string | null;
  accountName?: string | null;
  skuId: string;
  mappingGroupId?: string | null;
  internalSkuCode?: string;
  productName?: string;
  colorSpec?: string | null;
  externalOfferId?: string | null;
  externalSkuId?: string | null;
  externalSpecId?: string | null;
  platformSkuName?: string | null;
  supplierName?: string | null;
  productTitle?: string | null;
  productUrl?: string | null;
  imageUrl?: string | null;
  unitPrice?: number | null;
  moq?: number | null;
  ourQty?: number | null;
  platformQty?: number | null;
  ratioText?: string | null;
  status?: string | null;
  isDefault?: boolean;
  remark?: string | null;
  updatedAt?: string | null;
}

interface MappingFormValues {
  skuId: string;
  mappingGroupId?: string;
  externalOfferId: string;
  externalSkuId?: string;
  externalSpecId?: string;
  platformSkuName?: string;
  supplierName?: string;
  productTitle?: string;
  productUrl?: string;
  imageUrl?: string;
  unitPrice?: number;
  moq?: number;
  ourQty: number;
  platformQty: number;
  status: string;
  isDefault?: boolean;
  remark?: string;
}

const STATUS_LABELS: Record<string, string> = {
  active: "启用",
  disabled: "停用",
};

function canManage(role?: string | null) {
  return Boolean(role && ["admin", "manager", "buyer"].includes(role));
}

function formatCurrency(value?: number | string | null) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "-";
  return `¥${number.toFixed(2)}`;
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

function build1688Link(row: Sku1688SourceRow | MappingFormValues) {
  if (row.productUrl) return row.productUrl;
  if (row.externalOfferId) return `https://detail.1688.com/offer/${row.externalOfferId}.html`;
  return "";
}

function mappingLabel(row: Sku1688SourceRow) {
  const group = row.mappingGroupId || row.id;
  return group.replace(/^map_/, "");
}

export default function AlibabaMapping() {
  const auth = useErpAuth();
  const editable = canManage(auth.currentUser?.role);
  const [form] = Form.useForm<MappingFormValues>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<Sku1688SourceRow | null>(null);
  const [skus, setSkus] = useState<SkuOptionRow[]>([]);
  const [mappings, setMappings] = useState<Sku1688SourceRow[]>([]);

  const loadData = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const workbench = await erp.purchase.workbench({ limit: 500 });
      setSkus(Array.isArray(workbench?.skuOptions) ? workbench.skuOptions : []);
      setMappings(Array.isArray(workbench?.sku1688Sources) ? workbench.sku1688Sources : []);
    } catch (error: any) {
      message.error(error?.message || "1688 映射读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const skuOptions = useMemo(
    () => skus.map((sku) => {
      const code = sku.internalSkuCode || sku.id;
      const name = sku.productName || "";
      const spec = sku.colorSpec || "";
      return {
        value: sku.id,
        label: code,
        searchText: `${code} ${name} ${spec}`,
      };
    }),
    [skus],
  );

  const openCreate = () => {
    setEditingRow(null);
    form.resetFields();
    form.setFieldsValue({
      status: "active",
      isDefault: true,
      ourQty: 1,
      platformQty: 1,
      moq: 1,
    });
    setModalOpen(true);
  };

  const openEdit = (row: Sku1688SourceRow) => {
    setEditingRow(row);
    form.resetFields();
    form.setFieldsValue({
      skuId: row.skuId,
      mappingGroupId: row.mappingGroupId || "",
      externalOfferId: row.externalOfferId || "",
      externalSkuId: row.externalSkuId || "",
      externalSpecId: row.externalSpecId || "",
      platformSkuName: row.platformSkuName || "",
      supplierName: row.supplierName || "",
      productTitle: row.productTitle || "",
      productUrl: row.productUrl || build1688Link(row),
      imageUrl: row.imageUrl || "",
      unitPrice: row.unitPrice ?? undefined,
      moq: row.moq ?? 1,
      ourQty: row.ourQty || 1,
      platformQty: row.platformQty || 1,
      status: row.status || "active",
      isDefault: Boolean(row.isDefault),
      remark: row.remark || "",
    });
    setModalOpen(true);
  };

  const handleSubmit = async (values: MappingFormValues) => {
    if (!erp) return;
    const sku = skus.find((item) => item.id === values.skuId);
    if (!sku?.accountId) {
      message.error("这个商品编码还没有匹配店铺，先到商品资料补店铺");
      return;
    }
    setSaving(true);
    try {
      const productUrl = values.productUrl || build1688Link(values);
      await erp.purchase.action({
        action: "upsert_sku_1688_source",
        id: editingRow?.id,
        skuId: values.skuId,
        accountId: sku.accountId,
        mappingGroupId: values.mappingGroupId,
        externalOfferId: values.externalOfferId,
        externalSkuId: values.externalSkuId,
        externalSpecId: values.externalSpecId,
        platformSkuName: values.platformSkuName,
        supplierName: values.supplierName,
        productTitle: values.productTitle,
        productUrl,
        imageUrl: values.imageUrl,
        unitPrice: values.unitPrice,
        moq: values.moq,
        ourQty: values.ourQty,
        platformQty: values.platformQty,
        status: values.status,
        isDefault: values.isDefault,
        remark: values.remark,
        limit: 500,
      });
      message.success("1688 映射已保存");
      setModalOpen(false);
      setEditingRow(null);
      form.resetFields();
      await loadData();
    } catch (error: any) {
      message.error(error?.message || "1688 映射保存失败");
    } finally {
      setSaving(false);
    }
  };

  const columns = useMemo<ColumnsType<Sku1688SourceRow>>(() => [
    {
      title: "商品编码",
      key: "sku",
      width: 190,
      fixed: "left",
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.internalSkuCode || row.skuId}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.productName || "-"}</Text>
          {row.colorSpec ? <Text type="secondary" style={{ fontSize: 12 }}>{row.colorSpec}</Text> : null}
        </Space>
      ),
    },
    {
      title: "1688 商品",
      key: "offer",
      width: 320,
      render: (_value, row) => (
        <Space size={10} align="start">
          {row.imageUrl ? <Image src={row.imageUrl} width={54} height={54} style={{ objectFit: "cover", borderRadius: 6 }} /> : null}
          <Space direction="vertical" size={2}>
            <Text strong ellipsis style={{ maxWidth: 230 }}>{row.productTitle || row.externalOfferId || "-"}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>商品号 {row.externalOfferId || "-"}</Text>
            {row.supplierName ? <Text type="secondary" style={{ fontSize: 12 }}>{row.supplierName}</Text> : null}
          </Space>
        </Space>
      ),
    },
    {
      title: "1688 规格",
      key: "platformSku",
      width: 180,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.platformSkuName || row.externalSkuId || row.externalSpecId || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.externalSpecId || row.externalSkuId || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "采购比例",
      key: "ratio",
      width: 140,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.ourQty || 1} : {row.platformQty || 1}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{mappingLabel(row)}</Text>
        </Space>
      ),
    },
    {
      title: "价格",
      key: "price",
      width: 130,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{formatCurrency(row.unitPrice)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>起订 {row.moq || 1}</Text>
        </Space>
      ),
    },
    {
      title: "店铺",
      dataIndex: "accountName",
      width: 140,
      render: (value) => value || "-",
    },
    {
      title: "状态",
      key: "status",
      width: 120,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Tag color={row.status === "active" ? "success" : "default"}>{STATUS_LABELS[row.status || ""] || row.status || "-"}</Tag>
          {row.isDefault ? <Tag color="processing">默认</Tag> : null}
        </Space>
      ),
    },
    {
      title: "更新",
      dataIndex: "updatedAt",
      width: 150,
      render: formatDateTime,
    },
    {
      title: "操作",
      key: "actions",
      width: 150,
      fixed: "right",
      render: (_value, row) => (
        <Space size={6}>
          {row.externalOfferId ? (
            <Button size="small" icon={<ApiOutlined />} onClick={() => window.open(build1688Link(row), "_blank")}>
              打开
            </Button>
          ) : null}
          {editable ? (
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
              编辑
            </Button>
          ) : null}
        </Space>
      ),
    },
  ], [editable]);

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="业务" title="1688 映射" />
        <Alert type="error" showIcon message="ERP 服务未就绪，请重启软件" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="业务"
        title="1688 映射"
        meta={[`映射 ${mappings.length}`]}
        actions={[
          editable ? (
            <Button key="new" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增映射
            </Button>
          ) : null,
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={loadData}>
            刷新
          </Button>,
        ].filter(Boolean)}
      />

      <section className="content-card">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={mappings}
          scroll={{ x: 1550 }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
        />
      </section>

      <Modal
        open={modalOpen}
        title={editingRow ? "编辑 1688 映射" : "新增 1688 映射"}
        okText="保存"
        cancelText="取消"
        width={860}
        confirmLoading={saving}
        onOk={() => form.submit()}
        onCancel={() => {
          setModalOpen(false);
          setEditingRow(null);
        }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="skuId" label="商品编码" rules={[{ required: true, message: "请选择商品编码" }]}>
                <Select
                  showSearch
                  disabled={Boolean(editingRow)}
                  options={skuOptions}
                  placeholder="选择商品编码"
                  optionFilterProp="searchText"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="mappingGroupId" label="组合编号">
                <Input placeholder="同组规格会一起推单" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="externalOfferId" label="1688 商品号" rules={[{ required: true, message: "请输入 1688 商品号" }]}>
                <Input placeholder="例如 1234567890" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="platformSkuName" label="1688 规格名称">
                <Input placeholder="例如 蓝色 / 500ml" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="externalSkuId" label="1688 规格号">
                <Input placeholder="可选" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="externalSpecId" label="1688 子规格号">
                <Input placeholder="可选" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="ourQty" label="我方数量" rules={[{ required: true, message: "请输入我方数量" }]}>
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="platformQty" label="1688 数量" rules={[{ required: true, message: "请输入 1688 数量" }]}>
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="unitPrice" label="单价">
                <InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="moq" label="起订量">
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="supplierName" label="供应商">
                <Input placeholder="1688 供应商名称" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="状态" rules={[{ required: true, message: "请选择状态" }]}>
                <Select
                  options={[
                    { value: "active", label: "启用" },
                    { value: "disabled", label: "停用" },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="productTitle" label="1688 商品标题">
                <Input placeholder="可选" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="productUrl" label="1688 链接">
                <Input placeholder="不填会按商品号生成" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="imageUrl" label="图片链接">
                <Input placeholder="可选" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="isDefault" label="默认映射" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="remark" label="备注">
                <TextArea rows={3} placeholder="例如：一个商品对应 1688 两个规格；或 1 件对应 5 件下单" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
