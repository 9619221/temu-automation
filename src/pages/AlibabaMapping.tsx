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
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, EditOutlined, LinkOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import { useErpAuth } from "../contexts/ErpAuthContext";

const { Text } = Typography;
const erp = window.electronAPI?.erp;
const appAPI = window.electronAPI?.app;

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
  systemSupplierName?: string | null;
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
  sourcePayload?: {
    marketingMixConfig?: MarketingMixConfig | null;
    marketingMixSyncedAt?: string | null;
    followedAt1688?: string | null;
    monitorProduct?: { enabled?: boolean } | null;
    [key: string]: unknown;
  } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface MarketingMixConfig {
  generalHunpi?: boolean;
  mixAmount?: number | null;
  mixNumber?: number | null;
  memberId?: string | null;
  gmtCreate?: string | null;
  gmtModified?: string | null;
}

interface MappingFormValues {
  skuId: string;
  mappingGroupId?: string;
  externalOfferId?: string;
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
}

function canManage(role?: string | null) {
  return Boolean(role && ["admin", "manager", "buyer"].includes(role));
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

async function openExternalUrl(url: string) {
  const target = url.trim();
  if (!target) return;
  try {
    if (appAPI?.openExternal) {
      await appAPI.openExternal(target);
      return;
    }
    window.open(target, "_blank", "noopener,noreferrer");
  } catch (error: any) {
    message.error(error?.message || "打开 1688 地址失败");
  }
}

function extract1688OfferId(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "";
  const offerPathMatch = text.match(/offer\/(\d+)\.html/i);
  if (offerPathMatch?.[1]) return offerPathMatch[1];
  const queryMatch = text.match(/[?&](?:offerId|offer_id|productId|productID)=(\d+)/i);
  if (queryMatch?.[1]) return queryMatch[1];
  const looseMatch = text.match(/(?:^|[^\d])(\d{8,})(?:[^\d]|$)/);
  return looseMatch?.[1] || "";
}

function mappingStatus(row: Sku1688SourceRow) {
  if (!row.supplierName || !build1688Link(row) || !row.externalOfferId) {
    return { label: "未匹配", color: "default" };
  }
  if (!row.platformSkuName && !row.externalSkuId && !row.externalSpecId) {
    return { label: "待同步", color: "warning" };
  }
  return { label: "匹配成功", color: "success" };
}

function formatMixRule(config?: MarketingMixConfig | null) {
  if (!config) return "-";
  if (!config.generalHunpi) return "不支持混批";
  const amountText = config.mixAmount !== null && config.mixAmount !== undefined
    ? `满 ${Number(config.mixAmount).toFixed(2)} 元`
    : "";
  const numberText = config.mixNumber !== null && config.mixNumber !== undefined
    ? `满 ${Number(config.mixNumber)} 件`
    : "";
  return [amountText, numberText].filter(Boolean).join(" / ") || "支持混批";
}

function getMarketingMixConfig(row: Sku1688SourceRow) {
  return row.sourcePayload?.marketingMixConfig || null;
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
  const [mixLoadingId, setMixLoadingId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const workbench = await erp.purchase.workbench({ limit: 500 });
      setSkus(Array.isArray(workbench?.skuOptions) ? workbench.skuOptions : []);
      setMappings(Array.isArray(workbench?.sku1688Sources) ? workbench.sku1688Sources : []);
    } catch (error: any) {
      message.error(error?.message || "供应商管理读取失败");
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
    });
    setModalOpen(true);
  };

  const handleSubmit = async (values: MappingFormValues) => {
    if (!erp) return;
    const sku = skus.find((item) => item.id === values.skuId);
    if (!sku?.accountId) {
      message.error("这个商品编码还没有匹配店铺，请先到采购中心维护店铺");
      return;
    }
    setSaving(true);
    try {
      const externalOfferId = values.externalOfferId || extract1688OfferId(values.productUrl);
      if (!externalOfferId) {
        message.error("请填写可识别商品号的 1688 地址，或手动补 1688 商品ID");
        return;
      }
      const productUrl = values.productUrl || build1688Link({ ...values, externalOfferId });
      await erp.purchase.action({
        action: "upsert_sku_1688_source",
        id: editingRow?.id,
        skuId: values.skuId,
        accountId: sku.accountId,
        mappingGroupId: values.mappingGroupId,
        externalOfferId,
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
        limit: 500,
      });
      message.success("供应商信息已保存");
      setModalOpen(false);
      setEditingRow(null);
      form.resetFields();
      await loadData();
    } catch (error: any) {
      message.error(error?.message || "供应商信息保存失败");
    } finally {
      setSaving(false);
    }
  };

  const queryMixConfig = useCallback(async (row: Sku1688SourceRow) => {
    if (!erp) return;
    setMixLoadingId(row.id);
    try {
      const response = await erp.purchase.action({
        action: "query_1688_mix_config",
        sourceId: row.id,
        accountId: row.accountId,
        limit: 500,
      });
      if (Array.isArray(response?.workbench?.sku1688Sources)) {
        setMappings(response.workbench.sku1688Sources);
      }
      const config = response?.result?.mixConfig as MarketingMixConfig | undefined;
      const query = (response?.result?.query || {}) as { sellerMemberId?: string; sellerLoginId?: string };
      const sellerLabel = query.sellerMemberId || query.sellerLoginId || config?.memberId || row.supplierName || "-";
      Modal.info({
        title: "卖家混批设置",
        content: (
          <Space direction="vertical" size={6}>
            <Text>卖家：{sellerLabel}</Text>
            <Text>状态：{config?.generalHunpi ? "支持混批" : "不支持混批"}</Text>
            <Text>规则：{formatMixRule(config)}</Text>
            {query.sellerLoginId ? <Text>旺旺：{query.sellerLoginId}</Text> : null}
            {config?.memberId ? <Text>MemberId：{config.memberId}</Text> : null}
          </Space>
        ),
      });
    } catch (error: any) {
      message.error(error?.message || "查询 1688 混批设置失败");
    } finally {
      setMixLoadingId(null);
    }
  }, []);

  const run1688SourceAction = useCallback(async (
    row: Sku1688SourceRow,
    action: string,
    successText: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (!erp) return null;
    const key = `${action}-${row.id}`;
    setActionLoadingId(key);
    try {
      const response = await erp.purchase.action({
        action,
        sourceId: row.id,
        accountId: row.accountId,
        externalOfferId: row.externalOfferId,
        productId: row.externalOfferId,
        externalSkuId: row.externalSkuId,
        externalSpecId: row.externalSpecId,
        keyword: row.productTitle || row.productName || row.externalOfferId,
        imageUrl: row.imageUrl,
        ...extra,
        limit: 500,
      });
      if (Array.isArray(response?.workbench?.sku1688Sources)) {
        setMappings(response.workbench.sku1688Sources);
      }
      message.success(successText);
      return response;
    } catch (error: any) {
      message.error(error?.message || "1688 操作失败");
      return null;
    } finally {
      setActionLoadingId(null);
    }
  }, []);

  const deleteMapping = useCallback((row: Sku1688SourceRow) => {
    if (!erp) return;
    Modal.confirm({
      title: "删除供应商绑定",
      content: "删除后这条 1688 规格绑定会从供应商管理移除，后续推单不会再使用；已生成的采购单和 1688 订单不会删除。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const key = `delete_sku_1688_source-${row.id}`;
        setActionLoadingId(key);
        try {
          await erp.purchase.action({
            action: "delete_sku_1688_source",
            sourceId: row.id,
            limit: 500,
          });
          message.success("供应商绑定已删除");
          await loadData();
        } catch (error: any) {
          message.error(error?.message || "供应商绑定删除失败");
          throw error;
        } finally {
          setActionLoadingId(null);
        }
      },
    });
  }, [loadData]);

  const searchRelationSuppliers = useCallback(async () => {
    if (!erp) return;
    setActionLoadingId("search_1688_relation_suppliers");
    try {
      const response = await erp.purchase.action({
        action: "search_1688_relation_suppliers",
        pageSize: 20,
        limit: 500,
      });
      const suppliers = Array.isArray(response?.result?.suppliers) ? response.result.suppliers : [];
      Modal.info({
        title: "1688 推荐供应商",
        width: 680,
        content: (
          <Space direction="vertical" size={6}>
            {suppliers.length ? suppliers.slice(0, 12).map((supplier: any, index: number) => (
              <Text key={`${supplier.memberId || supplier.loginId || index}`}>
                {supplier.companyName || supplier.shopName || supplier.loginId || supplier.memberId || "-"}
              </Text>
            )) : <Text>已调用接口，暂无可展示供应商</Text>}
          </Space>
        ),
      });
    } catch (error: any) {
      message.error(error?.message || "1688 推荐供应商查询失败");
    } finally {
      setActionLoadingId(null);
    }
  }, []);

  const queryMonitorProducts = useCallback(async () => {
    if (!erp) return;
    setActionLoadingId("query_1688_monitor_products");
    try {
      const response = await erp.purchase.action({
        action: "query_1688_monitor_products",
        pageSize: 50,
        limit: 500,
      });
      const products = Array.isArray(response?.result?.products) ? response.result.products : [];
      Modal.info({
        title: "1688 监控商品",
        width: 720,
        content: (
          <Space direction="vertical" size={6}>
            {products.length ? products.slice(0, 12).map((product: any, index: number) => (
              <Text key={`${product.externalOfferId || index}`}>
                {product.productTitle || product.externalOfferId || "-"}
              </Text>
            )) : <Text>已调用接口，暂无可展示监控商品</Text>}
          </Space>
        ),
      });
    } catch (error: any) {
      message.error(error?.message || "1688 监控商品查询失败");
    } finally {
      setActionLoadingId(null);
    }
  }, []);

  const columns = useMemo<ColumnsType<Sku1688SourceRow>>(() => [
    {
      title: "商品编码",
      key: "sku",
      width: 170,
      fixed: "left",
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.internalSkuCode || row.skuId}</Text>
        </Space>
      ),
    },
    {
      title: "商品名称",
      key: "productName",
      width: 220,
      render: (_value, row) => (
        <Space size={10} align="start">
          {row.imageUrl ? <Image src={row.imageUrl} width={54} height={54} style={{ objectFit: "cover", borderRadius: 6 }} /> : null}
          <Space direction="vertical" size={2}>
            <Text strong ellipsis style={{ maxWidth: 150 }}>{row.productTitle || row.productName || "-"}</Text>
          </Space>
        </Space>
      ),
    },
    {
      title: "颜色规格",
      key: "colorSpec",
      width: 160,
      render: (_value, row) => row.colorSpec || "-",
    },
    {
      title: "系统供应商",
      key: "systemSupplier",
      width: 150,
      render: (_value, row) => row.systemSupplierName || "-",
    },
    {
      title: "是否默认供应商",
      key: "defaultSupplier",
      width: 130,
      render: (_value, row) => (row.isDefault ? "是" : "否"),
    },
    {
      title: "基础数量",
      dataIndex: "ourQty",
      width: 100,
      render: (value) => value || 1,
    },
    {
      title: "映射数量",
      dataIndex: "platformQty",
      width: 100,
      render: (value) => value || 1,
    },
    {
      title: "1688单品货号",
      key: "externalSku",
      width: 150,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.externalSkuId || row.externalSpecId || "-"}</Text>
          {row.externalSpecId && row.externalSpecId !== row.externalSkuId ? (
            <Text type="secondary" style={{ fontSize: 12 }}>{row.externalSpecId}</Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "1688供应商旺旺名称",
      key: "supplier",
      width: 180,
      render: (_value, row) => row.supplierName || "-",
    },
    {
      title: "混批",
      key: "marketingMix",
      width: 130,
      render: (_value, row) => {
        const config = getMarketingMixConfig(row);
        if (!config) return <Tag>未查询</Tag>;
        return (
          <Tooltip title={formatMixRule(config)}>
            <Tag color={config.generalHunpi ? "success" : "default"}>
              {config.generalHunpi ? "支持" : "不支持"}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: "1688地址",
      key: "offerUrl",
      width: 230,
      ellipsis: true,
      render: (_value, row) => {
        const offerUrl = build1688Link(row);
        return offerUrl ? (
          <Tooltip title={offerUrl}>
            <a
              href={offerUrl}
              onClick={(event) => {
                event.preventDefault();
                void openExternalUrl(offerUrl);
              }}
              style={{
                alignItems: "center",
                display: "inline-flex",
                gap: 4,
                maxWidth: 206,
                overflow: "hidden",
                verticalAlign: "middle",
              }}
            >
              <LinkOutlined style={{ flex: "0 0 auto" }} />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {offerUrl}
              </span>
            </a>
          </Tooltip>
        ) : "-";
      },
    },
    {
      title: "查看线上",
      key: "online",
      width: 100,
      render: (_value, row) => (
        build1688Link(row) ? (
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => void openExternalUrl(build1688Link(row))}>
            查看线上
          </Button>
        ) : "-"
      ),
    },
    {
      title: "状态",
      key: "mappingStatus",
      width: 100,
      render: (_value, row) => {
        const state = mappingStatus(row);
        return <Tag color={state.color}>{state.label}</Tag>;
      },
    },
    {
      title: "1688规格描述",
      key: "platformSku",
      width: 220,
      render: (_value, row) => row.platformSkuName || "-",
    },
    {
      title: "1688商品起批数量",
      key: "moq",
      width: 140,
      render: (_value, row) => row.moq || 1,
    },
    {
      title: "1688商品规格ID",
      key: "externalSpecId",
      width: 150,
      render: (_value, row) => row.externalSpecId || "-",
    },
    {
      title: "品牌",
      key: "brand",
      width: 100,
      render: (_value, row) => row.accountName || "-",
    },
    {
      title: "修改时间",
      dataIndex: "updatedAt",
      width: 150,
      render: formatDateTime,
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      width: 150,
      render: formatDateTime,
    },
    {
      title: "操作",
      key: "actions",
      width: 260,
      fixed: "right",
      render: (_value, row) => (
        <Space size={6} wrap>
          {editable ? (
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
              编辑
            </Button>
          ) : null}
          <Button
            size="small"
            icon={<SearchOutlined />}
            loading={mixLoadingId === row.id}
            onClick={() => void queryMixConfig(row)}
          >
            混批
          </Button>
          <Button
            size="small"
            loading={actionLoadingId === `run_1688_deep_search_agent-${row.id}`}
            onClick={() => void run1688SourceAction(row, "run_1688_deep_search_agent", "1688深搜任务已运行")}
          >
            深搜
          </Button>
          <Button
            size="small"
            loading={actionLoadingId === `${row.sourcePayload?.monitorProduct?.enabled ? "delete_1688_monitor_product" : "add_1688_monitor_product"}-${row.id}`}
            onClick={() => void run1688SourceAction(
              row,
              row.sourcePayload?.monitorProduct?.enabled ? "delete_1688_monitor_product" : "add_1688_monitor_product",
              row.sourcePayload?.monitorProduct?.enabled ? "1688监控已取消" : "1688监控已开启",
            )}
          >
            {row.sourcePayload?.monitorProduct?.enabled ? "取消监控" : "监控"}
          </Button>
          <Button
            size="small"
            loading={actionLoadingId === `sync_1688_relation_user_info-${row.id}`}
            onClick={() => void run1688SourceAction(row, "sync_1688_relation_user_info", "1688商家信息已同步")}
          >
            商家
          </Button>
          <Button
            size="small"
            loading={actionLoadingId === `sync_1688_purchased_products-${row.id}`}
            onClick={() => void run1688SourceAction(row, "sync_1688_purchased_products", "1688已购商品已同步")}
          >
            已购
          </Button>
          <Button
            size="small"
            loading={actionLoadingId === `${row.sourcePayload?.followedAt1688 ? "unfollow_1688_product" : "follow_1688_product"}-${row.id}`}
            onClick={() => void run1688SourceAction(
              row,
              row.sourcePayload?.followedAt1688 ? "unfollow_1688_product" : "follow_1688_product",
              row.sourcePayload?.followedAt1688 ? "1688商品已取消关注" : "1688商品已关注",
            )}
          >
            {row.sourcePayload?.followedAt1688 ? "取消关注" : "关注"}
          </Button>
          <Button
            size="small"
            loading={actionLoadingId === `run_1688_supply_change_agent-${row.id}`}
            onClick={() => void run1688SourceAction(row, "run_1688_supply_change_agent", "1688供给变动任务已运行")}
          >
            供给
          </Button>
          <Button
            size="small"
            loading={actionLoadingId === `feedback_1688_supply_change_agent-${row.id}`}
            onClick={() => void run1688SourceAction(row, "feedback_1688_supply_change_agent", "1688反馈已提交", { feedbackType: "viewed", feedback: "viewed in ERP" })}
          >
            反馈
          </Button>
          {editable ? (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={actionLoadingId === `delete_sku_1688_source-${row.id}`}
              onClick={() => deleteMapping(row)}
            >
              删除
            </Button>
          ) : null}
        </Space>
      ),
    },
  ], [actionLoadingId, deleteMapping, editable, mixLoadingId, queryMixConfig, run1688SourceAction]);

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="业务" title="供应商管理" />
        <Alert type="error" showIcon message="ERP 服务未就绪，请重启软件" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="业务"
        title="供应商管理"
        meta={[`供应商 ${mappings.length}`]}
        actions={[
          editable ? (
            <Button key="new" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增供应商
            </Button>
          ) : null,
          <Button
            key="relation-supply"
            icon={<SearchOutlined />}
            loading={actionLoadingId === "search_1688_relation_suppliers"}
            onClick={searchRelationSuppliers}
          >
            推荐供应商
          </Button>,
          <Button
            key="monitor-list"
            icon={<SearchOutlined />}
            loading={actionLoadingId === "query_1688_monitor_products"}
            onClick={queryMonitorProducts}
          >
            监控列表
          </Button>,
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={loadData}>
            刷新
          </Button>,
        ].filter(Boolean)}
      />

      <section className="content-card alibaba-mapping-panel alibaba-mapping-panel--fixed-bottom">
        <Table
          className="alibaba-mapping-table alibaba-mapping-table--fixed-bottom"
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={mappings}
          scroll={{ x: 2380, y: "max(220px, calc(100vh - 430px))" }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
        />
      </section>

      <Modal
        open={modalOpen}
        title={editingRow ? "编辑供应商" : "新增供应商"}
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
              <Form.Item name="supplierName" label="1688供应商旺旺名称" rules={[{ required: true, message: "请输入 1688 供应商旺旺名称" }]}>
                <Input placeholder="1688 供应商旺旺名称" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="productUrl" label="1688 地址" rules={[{ required: true, message: "请输入 1688 地址" }]}>
                <Input placeholder="https://detail.1688.com/offer/1234567890.html" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="externalOfferId" label="1688 商品ID">
                <Input placeholder="可由 1688 地址自动识别" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="mappingGroupId" label="组合编号">
                <Input placeholder="同组规格会一起推单" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="platformSkuName" label="1688 规格描述">
                <Input placeholder="例如 蓝色 / 500ml" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="externalSkuId" label="1688单品货号">
                <Input placeholder="可选" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="externalSpecId" label="1688商品规格ID" rules={[{ required: true, message: "请填写 1688 商品规格ID" }]}>
                <Input placeholder="必须填写具体规格ID" />
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
              <Form.Item name="moq" label="1688商品起批数量">
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
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
            <Col span={12}>
              <Form.Item name="isDefault" label="默认推单供应商" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="productTitle" label="1688 商品标题">
                <Input placeholder="可选" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="imageUrl" label="图片链接">
                <Input placeholder="可选" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
