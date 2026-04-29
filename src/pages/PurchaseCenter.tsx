import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Col,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Switch,
  Space,
  Table,
  Timeline,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import {
  ApiOutlined,
  CheckCircleOutlined,
  CommentOutlined,
  DollarOutlined,
  FileDoneOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { useErpAuth } from "../contexts/ErpAuthContext";
import {
  PAYMENT_STATUS_LABELS,
  PO_STATUS_LABELS,
  PR_STATUS_LABELS,
  canRole,
  formatDate,
  formatDateTime,
  formatQty,
  statusTag,
} from "../utils/erpUi";

const { Text } = Typography;
const { TextArea } = Input;
const erp = window.electronAPI?.erp;

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  manager: "负责人",
  operations: "运营",
  buyer: "采购",
  finance: "财务",
  warehouse: "仓库",
  viewer: "只读",
};

interface SourcingCandidateRow {
  id: string;
  purchaseSource?: string;
  sourcingMethod?: string;
  supplierName?: string;
  productTitle?: string | null;
  productUrl?: string | null;
  imageUrl?: string | null;
  externalOfferId?: string | null;
  externalSkuId?: string | null;
  externalSpecId?: string | null;
  externalSkuOptions?: Array<{ externalSkuId?: string | null; externalSpecId?: string | null; specText?: string; price?: number | null }>;
  externalPriceRanges?: Array<{ startQuantity?: number; price?: number }>;
  externalDetailFetchedAt?: string | null;
  unitPrice?: number;
  moq?: number;
  leadDays?: number | null;
  logisticsFee?: number | null;
  remark?: string | null;
  status?: string;
  createdByName?: string;
  updatedAt?: string;
}

interface TimelineRow {
  id: string;
  kind: "event" | "comment";
  actorName?: string | null;
  actorRole?: string | null;
  message?: string;
  eventType?: string;
  createdAt?: string;
}

interface PurchaseRequestRow {
  id: string;
  internalSkuCode?: string;
  productName?: string;
  status: string;
  reason?: string;
  requestedQty?: number;
  targetUnitCost?: number | null;
  expectedArrivalDate?: string | null;
  requestedByName?: string;
  evidence?: string[];
  candidateCount?: number;
  selectedCandidateCount?: number;
  unreadCount?: number;
  candidates?: SourcingCandidateRow[];
  timeline?: TimelineRow[];
  updatedAt?: string;
}

interface PurchaseOrderRow {
  id: string;
  poNo?: string;
  supplierName?: string;
  status: string;
  paymentStatus?: string;
  skuSummary?: string;
  totalQty?: number;
  receivedQty?: number;
  totalAmount?: number;
  expectedDeliveryDate?: string | null;
  externalOrderId?: string | null;
  externalOrderStatus?: string | null;
  externalOrderSyncedAt?: string | null;
  externalOrderPreviewedAt?: string | null;
  updatedAt?: string;
}

interface PaymentQueueRow {
  poId: string;
  poNo?: string;
  supplierName?: string;
  poStatus?: string;
  paymentApprovalId?: string;
  paymentApprovalStatus?: string;
  paymentAmount?: number;
  totalAmount?: number;
  requestedByName?: string;
  approvedByName?: string;
  updatedAt?: string;
}

interface PurchaseWorkbench {
  generatedAt?: string;
  summary?: Record<string, number>;
  purchaseRequests?: PurchaseRequestRow[];
  purchaseOrders?: PurchaseOrderRow[];
  paymentQueue?: PaymentQueueRow[];
  skuOptions?: SkuOption[];
  supplierOptions?: SupplierOption[];
  alibaba1688Addresses?: Alibaba1688AddressRow[];
}

interface Alibaba1688AddressRow {
  id: string;
  label?: string;
  fullName?: string;
  mobile?: string;
  provinceText?: string;
  cityText?: string;
  areaText?: string;
  address?: string;
  isDefault?: boolean;
}

interface OrderMatchCandidate {
  externalOrderId: string;
  status?: string | null;
  supplierName?: string | null;
  totalAmount?: number | null;
  createdAt?: string | null;
  matchScore?: number;
  matchReasons?: string[];
}

interface OrderMatchDialogState {
  po: PurchaseOrderRow;
  query?: Record<string, any>;
  matches: OrderMatchCandidate[];
}

interface SkuOption {
  id: string;
  internalSkuCode?: string;
  productName?: string;
  procurementSourceCount?: number;
  primary1688Source?: {
    externalOfferId?: string;
    externalSkuId?: string;
    externalSpecId?: string;
    supplierName?: string;
    productTitle?: string;
    unitPrice?: number | null;
    moq?: number | null;
  } | null;
}

interface SupplierOption {
  id: string;
  name?: string;
}

interface RequestFormValues {
  skuId: string;
  requestedQty: number;
  targetUnitCost?: number;
  expectedArrivalDate?: Dayjs | null;
  reason: string;
  evidenceText?: string;
}

interface QuoteFormValues {
  supplierId?: string;
  supplierName?: string;
  unitPrice: number;
  logisticsFee?: number;
  moq?: number;
  leadDays?: number;
  productTitle?: string;
  productUrl?: string;
  remark?: string;
}

interface Source1688FormValues {
  keyword: string;
  pageSize?: number;
  priceStart?: number;
  priceEnd?: number;
}

interface PoFormValues {
  candidateId?: string;
  qty?: number;
  expectedDeliveryDate?: Dayjs | null;
  remark?: string;
}

interface Address1688FormValues {
  label: string;
  fullName: string;
  mobile?: string;
  phone?: string;
  provinceText?: string;
  cityText?: string;
  areaText?: string;
  townText?: string;
  address: string;
  postCode?: string;
  isDefault?: boolean;
}

function formatCurrency(value?: number | string | null) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "-";
  return `¥${number.toFixed(2)}`;
}

function toApiDate(value?: Dayjs | string | null) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.format("YYYY-MM-DD");
}

function skuText(row: { internalSkuCode?: string; productName?: string }) {
  return (
    <Space direction="vertical" size={2}>
      <Text strong>{row.internalSkuCode || "-"}</Text>
      <Text type="secondary" style={{ fontSize: 12 }}>{row.productName || "-"}</Text>
    </Space>
  );
}

function actorText(item: TimelineRow) {
  const roleText = ROLE_LABELS[item.actorRole || ""] || item.actorRole || "";
  return [item.actorName || "系统", roleText].filter(Boolean).join(" · ");
}

function candidateLabel(candidate: SourcingCandidateRow) {
  return `${candidate.supplierName || "未命名供应商"} · ${formatCurrency(candidate.unitPrice)} · MOQ ${formatQty(candidate.moq || 1)}`;
}

function firstPoCandidate(row?: PurchaseRequestRow | null) {
  const candidates = row?.candidates || [];
  return candidates.find((item) => item.status === "selected")
    || candidates.find((item) => item.status === "shortlisted")
    || candidates[0]
    || null;
}

export default function PurchaseCenter() {
  const auth = useErpAuth();
  const role = auth.currentUser?.role || "";
  const canCreateRequest = canRole(role, ["operations", "manager", "admin"]);
  const canPurchase = canRole(role, ["buyer", "manager", "admin"]);
  const canFinance = canRole(role, ["finance", "manager", "admin"]);

  const [data, setData] = useState<PurchaseWorkbench>({});
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [skus, setSkus] = useState<SkuOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [quotePrId, setQuotePrId] = useState<string | null>(null);
  const [source1688PrId, setSource1688PrId] = useState<string | null>(null);
  const [address1688Open, setAddress1688Open] = useState(false);
  const [poPrId, setPoPrId] = useState<string | null>(null);
  const [detailPrId, setDetailPrId] = useState<string | null>(null);
  const [orderMatchDialog, setOrderMatchDialog] = useState<OrderMatchDialogState | null>(null);
  const [selectedExternalOrderId, setSelectedExternalOrderId] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<"connected" | "updated" | "unavailable">("unavailable");

  const [requestForm] = Form.useForm<RequestFormValues>();
  const [quoteForm] = Form.useForm<QuoteFormValues>();
  const [source1688Form] = Form.useForm<Source1688FormValues>();
  const [address1688Form] = Form.useForm<Address1688FormValues>();
  const [poForm] = Form.useForm<PoFormValues>();
  const [commentForm] = Form.useForm<{ body: string }>();

  const quotePr = useMemo(
    () => data.purchaseRequests?.find((item) => item.id === quotePrId) || null,
    [data.purchaseRequests, quotePrId],
  );
  const source1688Pr = useMemo(
    () => data.purchaseRequests?.find((item) => item.id === source1688PrId) || null,
    [data.purchaseRequests, source1688PrId],
  );
  const poPr = useMemo(
    () => data.purchaseRequests?.find((item) => item.id === poPrId) || null,
    [data.purchaseRequests, poPrId],
  );
  const detailPr = useMemo(
    () => data.purchaseRequests?.find((item) => item.id === detailPrId) || null,
    [data.purchaseRequests, detailPrId],
  );

  const skuOptions = useMemo(
    () => skus.map((sku) => {
      const code = sku.internalSkuCode || sku.id;
      const name = sku.productName || "-";
      const sourceLabel = sku.procurementSourceCount
        ? ` · 1688已绑${sku.procurementSourceCount}`
        : "";
      return {
        value: sku.id,
        label: `${code} · ${name}${sourceLabel}`,
        searchText: `${code} ${name} ${sku.primary1688Source?.externalOfferId || ""}`,
      };
    }),
    [skus],
  );
  const supplierOptions = useMemo(
    () => suppliers.map((supplier) => ({
      value: supplier.id,
      label: supplier.name || supplier.id,
    })),
    [suppliers],
  );
  const poCandidateOptions = useMemo(
    () => (poPr?.candidates || []).map((candidate) => ({
      value: candidate.id,
      label: candidateLabel(candidate),
    })),
    [poPr],
  );

  const applyWorkbench = useCallback((nextData: PurchaseWorkbench) => {
    setData(nextData || {});
  }, []);

  const loadData = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const workbench = await erp.purchase.workbench({ limit: 200 });
      const [skuRows, supplierRows] = await Promise.all([
        Array.isArray(workbench?.skuOptions) ? Promise.resolve(workbench.skuOptions) : erp.sku.list({ limit: 500 }),
        Array.isArray(workbench?.supplierOptions) ? Promise.resolve(workbench.supplierOptions) : erp.supplier.list({ limit: 500 }),
      ]);
      applyWorkbench(workbench);
      setSkus(Array.isArray(skuRows) ? skuRows : []);
      setSuppliers(Array.isArray(supplierRows) ? supplierRows : []);
    } catch (error: any) {
      message.error(error?.message || "采购中心读取失败");
    } finally {
      setLoading(false);
    }
  }, [applyWorkbench]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!erp?.events?.onPurchaseUpdate) {
      setRealtimeStatus("unavailable");
      return;
    }
    let refreshTimer: number | null = null;
    setRealtimeStatus("connected");
    const unsubscribe = erp.events.onPurchaseUpdate((payload: { type?: string }) => {
      if (payload?.type !== "purchase:update") return;
      setRealtimeStatus("updated");
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        setRealtimeStatus("connected");
        void loadData();
      }, 180);
    });
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [loadData]);

  const runAction = async (key: string, payload: Record<string, any>, successText?: string) => {
    if (!erp) return null;
    setActingKey(key);
    try {
      const result = await erp.purchase.action({ ...payload, limit: 200 });
      const workbench = result?.workbench || await erp.purchase.workbench({ limit: 200 });
      applyWorkbench(workbench);
      if (Array.isArray(workbench?.skuOptions)) setSkus(workbench.skuOptions);
      if (Array.isArray(workbench?.supplierOptions)) setSuppliers(workbench.supplierOptions);
      if (successText) message.success(successText);
      return result;
    } catch (error: any) {
      message.error(error?.message || "操作失败");
      return null;
    } finally {
      setActingKey(null);
    }
  };

  const openDetail = async (row: PurchaseRequestRow) => {
    setDetailPrId(row.id);
    await runAction(`read-${row.id}`, { action: "mark_read", prId: row.id });
  };

  const openQuoteModal = (row: PurchaseRequestRow) => {
    setQuotePrId(row.id);
    quoteForm.resetFields();
    quoteForm.setFieldsValue({ moq: 1, logisticsFee: 0 });
  };

  const open1688SourceModal = (row: PurchaseRequestRow) => {
    setSource1688PrId(row.id);
    source1688Form.resetFields();
    source1688Form.setFieldsValue({
      keyword: row.productName || row.internalSkuCode || "",
      pageSize: 10,
    });
  };

  const openPoModal = (row: PurchaseRequestRow) => {
    const candidate = firstPoCandidate(row);
    setPoPrId(row.id);
    poForm.resetFields();
    poForm.setFieldsValue({
      candidateId: candidate?.id,
      qty: row.requestedQty,
    });
  };

  const handleCreateRequest = async (values: RequestFormValues) => {
    const result = await runAction("create-pr", {
      action: "create_pr",
      skuId: values.skuId,
      requestedQty: values.requestedQty,
      targetUnitCost: values.targetUnitCost,
      expectedArrivalDate: toApiDate(values.expectedArrivalDate),
      reason: values.reason,
      evidenceText: values.evidenceText,
    }, "采购需求已提交给采购端");
    if (result) {
      setRequestOpen(false);
      requestForm.resetFields();
    }
  };

  const handleQuoteFeedback = async (values: QuoteFormValues) => {
    if (!quotePr) return;
    const result = await runAction(`quote-${quotePr.id}`, {
      action: "quote_feedback",
      prId: quotePr.id,
      supplierId: values.supplierId,
      supplierName: values.supplierName,
      unitPrice: values.unitPrice,
      logisticsFee: values.logisticsFee,
      moq: values.moq,
      leadDays: values.leadDays,
      productTitle: values.productTitle,
      productUrl: values.productUrl,
      remark: values.remark,
      feedback: values.remark,
    }, "报价反馈已同步给运营");
    if (result) {
      setQuotePrId(null);
      quoteForm.resetFields();
    }
  };

  const handleSource1688 = async (values: Source1688FormValues) => {
    if (!source1688Pr) return;
    const result = await runAction(`1688-source-${source1688Pr.id}`, {
      action: "source_1688_keyword",
      prId: source1688Pr.id,
      keyword: values.keyword,
      pageSize: values.pageSize,
      importLimit: values.pageSize,
      priceStart: values.priceStart,
      priceEnd: values.priceEnd,
    }, "1688 API候选已导入");
    if (result) {
      setSource1688PrId(null);
      source1688Form.resetFields();
    }
  };

  const handleSave1688Address = async (values: Address1688FormValues) => {
    const result = await runAction("1688-address", {
      action: "save_1688_address",
      ...values,
      isDefault: values.isDefault !== false,
    }, "1688 address saved");
    if (result) {
      setAddress1688Open(false);
      address1688Form.resetFields();
    }
  };

  const refresh1688CandidateDetail = async (candidate: SourcingCandidateRow) => {
    await runAction(`1688-detail-${candidate.id}`, {
      action: "refresh_1688_product_detail",
      candidateId: candidate.id,
    }, "1688详情已刷新，并已绑定到商品编码");
  };

  const preview1688Order = async (row: PurchaseOrderRow) => {
    await runAction(`1688-preview-${row.id}`, {
      action: "preview_1688_order",
      poId: row.id,
    }, "1688 order preview finished");
  };

  const sync1688Order = async (row: PurchaseOrderRow) => {
    const result = await runAction(`1688-sync-${row.id}`, {
      action: "sync_1688_orders",
      poId: row.id,
    });
    const matchStatus = result?.result?.matchStatus;
    if (matchStatus === "bound") {
      message.success(`已绑定 1688 订单：${result.result.externalOrderId}`);
    } else if (matchStatus === "needs_confirmation") {
      const matches = Array.isArray(result?.result?.matches) ? result.result.matches : [];
      setOrderMatchDialog({
        po: row,
        query: result?.result?.query || {},
        matches,
      });
      setSelectedExternalOrderId(matches[0]?.externalOrderId || null);
      message.warning("找到多个可能订单，请选择一个绑定");
    } else if (matchStatus === "not_found") {
      message.warning("暂未匹配到 1688 订单，请稍后再同步");
    }
  };

  const confirm1688OrderBind = async () => {
    if (!orderMatchDialog || !selectedExternalOrderId) return;
    const result = await runAction(`1688-bind-${orderMatchDialog.po.id}`, {
      action: "sync_1688_orders",
      poId: orderMatchDialog.po.id,
      ...(orderMatchDialog.query || {}),
      externalOrderId: selectedExternalOrderId,
    });
    if (result?.result?.matchStatus === "bound") {
      message.success(`已绑定 1688 订单：${result.result.externalOrderId}`);
      setOrderMatchDialog(null);
      setSelectedExternalOrderId(null);
    } else {
      message.warning("绑定失败：未能重新匹配到所选订单，请稍后重试");
    }
  };

  const handleGeneratePo = async (values: PoFormValues) => {
    if (!poPr) return;
    const result = await runAction(`po-${poPr.id}`, {
      action: "generate_po",
      prId: poPr.id,
      candidateId: values.candidateId,
      qty: values.qty,
      expectedDeliveryDate: toApiDate(values.expectedDeliveryDate),
      remark: values.remark,
    }, "采购单已生成");
    if (result) {
      setPoPrId(null);
      poForm.resetFields();
    }
  };

  const handleAddComment = async (values: { body: string }) => {
    if (!detailPr) return;
    const result = await runAction(`comment-${detailPr.id}`, {
      action: "add_comment",
      prId: detailPr.id,
      body: values.body,
    }, "留言已发送");
    if (result) commentForm.resetFields();
  };

  const requestColumns = useMemo<ColumnsType<PurchaseRequestRow>>(() => [
    {
      title: "商品编码",
      key: "sku",
      width: 260,
      render: (_value, row) => skuText(row),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 130,
      render: (value) => statusTag(value, PR_STATUS_LABELS),
    },
    {
      title: "需求",
      key: "request",
      width: 190,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{formatQty(row.requestedQty)} 件</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.reason || "-"} · {row.requestedByName || "-"}
          </Text>
        </Space>
      ),
    },
    {
      title: "目标成本",
      dataIndex: "targetUnitCost",
      width: 110,
      render: formatCurrency,
    },
    {
      title: "期望到货",
      dataIndex: "expectedArrivalDate",
      width: 120,
      render: formatDate,
    },
    {
      title: "寻源",
      key: "sourcing",
      width: 120,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{formatQty(row.candidateCount)} 个报价</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>已选 {formatQty(row.selectedCandidateCount)}</Text>
        </Space>
      ),
    },
    {
      title: "协作",
      key: "collaboration",
      width: 110,
      render: (_value, row) => (
        <Badge count={row.unreadCount || 0} size="small">
          <Button size="small" icon={<CommentOutlined />} onClick={() => openDetail(row)}>
            详情
          </Button>
        </Badge>
      ),
    },
    {
      title: "动作",
      key: "actions",
      width: 260,
      fixed: "right",
      render: (_value, row) => {
        const hasCandidates = Boolean(row.candidates?.length || row.candidateCount);
        const canQuote = canPurchase && ["submitted", "buyer_processing", "sourced"].includes(row.status);
        const canGeneratePo = canPurchase
          && hasCandidates
          && ["submitted", "buyer_processing", "sourced", "waiting_ops_confirm"].includes(row.status);
        return (
          <Space size={6} wrap>
            {row.status === "submitted" && canPurchase ? (
              <Button
                size="small"
                icon={<ShoppingCartOutlined />}
                loading={actingKey === `accept-${row.id}`}
                onClick={() => runAction(`accept-${row.id}`, { action: "accept_pr", prId: row.id }, "已接收采购需求")}
              >
                接收
              </Button>
            ) : null}
            {canQuote ? (
              <Button size="small" icon={<SearchOutlined />} onClick={() => openQuoteModal(row)}>
                报价反馈
              </Button>
            ) : null}
            {canQuote ? (
              <Button
                size="small"
                icon={<ApiOutlined />}
                loading={actingKey === `1688-source-${row.id}`}
                onClick={() => open1688SourceModal(row)}
              >
                1688 API
              </Button>
            ) : null}
            {canGeneratePo ? (
              <Button size="small" type="primary" icon={<FileDoneOutlined />} onClick={() => openPoModal(row)}>
                生成采购单
              </Button>
            ) : null}
            {!canQuote && !canGeneratePo && row.status !== "submitted" ? <Text type="secondary">无待办</Text> : null}
          </Space>
        );
      },
    },
  ], [actingKey, canPurchase]);

  const orderColumns = useMemo<ColumnsType<PurchaseOrderRow>>(() => [
    {
      title: "采购单",
      key: "po",
      width: 210,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.poNo || row.id}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.supplierName || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 130,
      render: (value) => statusTag(value, PO_STATUS_LABELS),
    },
    {
      title: "商品编码 / 数量",
      key: "qty",
      ellipsis: true,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.skuSummary || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            已收 {formatQty(row.receivedQty)} / {formatQty(row.totalQty)}
          </Text>
        </Space>
      ),
    },
    {
      title: "金额",
      dataIndex: "totalAmount",
      width: 120,
      render: formatCurrency,
    },
    {
      title: "付款",
      dataIndex: "paymentStatus",
      width: 120,
      render: (value) => statusTag(value, PAYMENT_STATUS_LABELS),
    },
    {
      title: "预计到货",
      dataIndex: "expectedDeliveryDate",
      width: 120,
      render: formatDate,
    },
    {
      title: "1688订单",
      key: "externalOrder",
      width: 190,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.externalOrderId || "未绑定"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.externalOrderStatus || "-"} · {formatDateTime(row.externalOrderSyncedAt)}
          </Text>
        </Space>
      ),
    },
    {
      title: "动作",
      key: "actions",
      width: 250,
      fixed: "right",
      render: (_value, row) => (
        <Space size={6} wrap>
          {row.status === "draft" && canPurchase ? (
            <Button
              size="small"
              icon={<ApiOutlined />}
              loading={actingKey === `1688-preview-${row.id}`}
              onClick={() => preview1688Order(row)}
            >
              1688 Preview
            </Button>
          ) : null}
          {!row.externalOrderId && canPurchase ? (
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={actingKey === `1688-sync-${row.id}`}
              onClick={() => sync1688Order(row)}
            >
              同步订单
            </Button>
          ) : null}
          {row.status === "draft" && canPurchase ? (
            <Button
              size="small"
              type="primary"
              icon={<DollarOutlined />}
              loading={actingKey === `pay-submit-${row.id}`}
              onClick={() => runAction(
                `pay-submit-${row.id}`,
                { action: "submit_payment_approval", poId: row.id, amount: row.totalAmount },
                "已提交付款审批",
              )}
            >
              提交付款
            </Button>
          ) : null}
          {row.status === "pending_finance_approval" && canFinance ? (
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `pay-approve-po-${row.id}`}
              onClick={() => runAction(`pay-approve-po-${row.id}`, { action: "approve_payment", poId: row.id }, "财务已批准")}
            >
              财务批准
            </Button>
          ) : null}
          {row.status === "approved_to_pay" && canFinance ? (
            <Button
              size="small"
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `paid-po-${row.id}`}
              onClick={() => runAction(`paid-po-${row.id}`, { action: "confirm_paid", poId: row.id }, "已确认付款")}
            >
              确认付款
            </Button>
          ) : null}
          {!["draft", "pending_finance_approval", "approved_to_pay"].includes(row.status) && (row.externalOrderId || !canPurchase) ? <Text type="secondary">无待办</Text> : null}
        </Space>
      ),
    },
  ], [actingKey, canFinance, canPurchase]);

  const paymentColumns = useMemo<ColumnsType<PaymentQueueRow>>(() => [
    {
      title: "付款入口",
      key: "entry",
      width: 210,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.paymentApprovalId || row.poNo || row.poId}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>PO：{row.poNo || row.poId}</Text>
        </Space>
      ),
    },
    {
      title: "供应商",
      dataIndex: "supplierName",
      width: 160,
      render: (value) => value || "-",
    },
    {
      title: "金额",
      key: "amount",
      width: 120,
      render: (_value, row) => formatCurrency(row.paymentAmount ?? row.totalAmount),
    },
    {
      title: "审批状态",
      key: "status",
      width: 140,
      render: (_value, row) => statusTag(row.paymentApprovalStatus || row.poStatus, {
        ...PAYMENT_STATUS_LABELS,
        ...PO_STATUS_LABELS,
      }),
    },
    {
      title: "申请 / 审批",
      key: "people",
      width: 160,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text type="secondary">申请：{row.requestedByName || "-"}</Text>
          <Text type="secondary">审批：{row.approvedByName || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "更新",
      dataIndex: "updatedAt",
      width: 160,
      render: formatDateTime,
    },
    {
      title: "下一步",
      key: "actions",
      width: 180,
      fixed: "right",
      render: (_value, row) => (
        <Space size={6} wrap>
          {(row.paymentApprovalStatus === "pending" || row.poStatus === "pending_finance_approval") && canFinance ? (
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `pay-approve-${row.paymentApprovalId || row.poId}`}
              onClick={() => runAction(
                `pay-approve-${row.paymentApprovalId || row.poId}`,
                { action: "approve_payment", poId: row.poId, paymentApprovalId: row.paymentApprovalId },
                "财务已批准",
              )}
            >
              财务批准
            </Button>
          ) : null}
          {(row.paymentApprovalStatus === "approved" || row.poStatus === "approved_to_pay") && canFinance ? (
            <Button
              size="small"
              type="primary"
              icon={<FileDoneOutlined />}
              loading={actingKey === `pay-confirm-${row.paymentApprovalId || row.poId}`}
              onClick={() => runAction(
                `pay-confirm-${row.paymentApprovalId || row.poId}`,
                { action: "confirm_paid", poId: row.poId, paymentApprovalId: row.paymentApprovalId },
                "已确认付款",
              )}
            >
              确认付款
            </Button>
          ) : null}
          {!["pending", "approved"].includes(row.paymentApprovalStatus || "") && !["pending_finance_approval", "approved_to_pay"].includes(row.poStatus || "") ? (
            <Text type="secondary">无待办</Text>
          ) : null}
        </Space>
      ),
    },
  ], [actingKey, canFinance]);

  const summary = data.summary || {};

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="ERP" title="采购中心" subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境没有 window.electronAPI.erp" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="采购中心"
        title="采购需求、报价协作、采购单"
        subtitle="运营新建采购需求，采购接收后寻源报价并生成采购单；双方通过留言、时间线和未读提醒持续同步。"
        meta={[
          `更新 ${formatDateTime(data.generatedAt)}`,
          realtimeStatus === "updated"
            ? "实时推送：收到更新"
            : realtimeStatus === "connected"
              ? "实时推送：已启用"
              : "实时推送：不可用",
        ]}
        actions={[
          canCreateRequest ? (
            <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => setRequestOpen(true)}>
              新建采购需求
            </Button>
          ) : null,
          canPurchase ? (
            <Button key="1688-address" icon={<ApiOutlined />} onClick={() => {
              const current = data.alibaba1688Addresses?.[0];
              address1688Form.setFieldsValue({
                label: current?.label || "Default",
                fullName: current?.fullName || "",
                mobile: current?.mobile || "",
                provinceText: current?.provinceText || "",
                cityText: current?.cityText || "",
                areaText: current?.areaText || "",
                address: current?.address || "",
                isDefault: current?.isDefault ?? true,
              });
              setAddress1688Open(true);
            }}>
              1688 Address
            </Button>
          ) : null,
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={loadData}>
            刷新
          </Button>,
        ].filter(Boolean)}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <StatCard title="待处理需求" value={summary.pendingPurchaseRequestCount || 0} color="blue" icon={<ShoppingCartOutlined />} compact />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="未读协作" value={summary.unreadPurchaseRequestCount || 0} color="purple" icon={<CommentOutlined />} compact />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="付款审批" value={summary.paymentQueueCount || 0} suffix={`/${formatCurrency(summary.paymentQueueAmount)}`} color="danger" icon={<DollarOutlined />} compact />
        </Col>
      </Row>

      <div className="app-panel" style={{ marginBottom: 16 }}>
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">采购需求列表</div>
            <div className="app-panel__title-sub">运营发起需求后，采购在这里接收、寻源、反馈报价并转成采购单。</div>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          size="middle"
          columns={requestColumns}
          dataSource={data.purchaseRequests || []}
          scroll={{ x: 1220 }}
          pagination={{ pageSize: 8, showSizeChanger: false }}
        />
      </div>

      <div className="app-panel" style={{ marginBottom: 16 }}>
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">采购单列表</div>
            <div className="app-panel__title-sub">采购单用于跟踪付款审批、供应商备货、到货与后续入库链路。</div>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          size="middle"
          columns={orderColumns}
          dataSource={data.purchaseOrders || []}
          scroll={{ x: 1350 }}
          pagination={{ pageSize: 8, showSizeChanger: false }}
        />
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">付款审批入口</div>
            <div className="app-panel__title-sub">采购提交付款后，财务在这里批准并确认付款。</div>
          </div>
        </div>
        <Table
          rowKey={(row) => row.paymentApprovalId || row.poId}
          loading={loading}
          size="middle"
          columns={paymentColumns}
          dataSource={data.paymentQueue || []}
          scroll={{ x: 980 }}
          pagination={{ pageSize: 8, showSizeChanger: false }}
        />
      </div>

      <Modal
        open={address1688Open}
        title="1688 Address"
        okText="Save"
        cancelText="Cancel"
        confirmLoading={actingKey === "1688-address"}
        onCancel={() => setAddress1688Open(false)}
        onOk={() => address1688Form.submit()}
      >
        <Form form={address1688Form} layout="vertical" onFinish={handleSave1688Address} initialValues={{ isDefault: true }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="label" label="Label" rules={[{ required: true, message: "Label is required" }]}>
                <Input placeholder="Default warehouse" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="fullName" label="Receiver" rules={[{ required: true, message: "Receiver is required" }]}>
                <Input placeholder="Receiver name" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="mobile" label="Mobile" rules={[{ required: true, message: "Mobile is required" }]}>
                <Input placeholder="13800000000" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="postCode" label="Post code">
                <Input placeholder="310000" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="provinceText" label="Province">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="cityText" label="City">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="areaText" label="Area">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="address" label="Address" rules={[{ required: true, message: "Address is required" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="isDefault" label="Default" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={requestOpen}
        title="新建采购需求"
        okText="提交给采购"
        cancelText="取消"
        confirmLoading={actingKey === "create-pr"}
        onCancel={() => setRequestOpen(false)}
        onOk={() => requestForm.submit()}
        destroyOnClose
      >
        <Form form={requestForm} layout="vertical" onFinish={handleCreateRequest} initialValues={{ requestedQty: 1 }}>
          <Form.Item name="skuId" label="商品编码" rules={[{ required: true, message: "请选择商品编码" }]}>
            <Select
              showSearch
              optionFilterProp="searchText"
              options={skuOptions}
              placeholder="选择/搜索商品编码或商品名"
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="requestedQty" label="需求数量" rules={[{ required: true, message: "请输入需求数量" }]}>
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="targetUnitCost" label="目标单价">
                <InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="expectedArrivalDate" label="期望到货">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="reason" label="需求原因" rules={[{ required: true, message: "请输入需求原因" }]}>
            <TextArea rows={3} placeholder="例如：活动备货、断货补采、新品打样、价格复核后采购" />
          </Form.Item>
          <Form.Item name="evidenceText" label="证据 / 链接">
            <TextArea rows={3} placeholder="每行一条：销量截图、竞品链接、站内数据结论等" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(quotePr)}
        title="报价反馈"
        okText="同步报价"
        cancelText="取消"
        confirmLoading={quotePr ? actingKey === `quote-${quotePr.id}` : false}
        onCancel={() => setQuotePrId(null)}
        onOk={() => quoteForm.submit()}
        destroyOnClose
      >
        <Form form={quoteForm} layout="vertical" onFinish={handleQuoteFeedback}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={quotePr ? `${quotePr.productName || quotePr.internalSkuCode || "采购需求"} · ${formatQty(quotePr.requestedQty)} 件` : ""}
          />
          <Form.Item name="supplierId" label="已有供应商">
            <Select allowClear showSearch optionFilterProp="label" options={supplierOptions} placeholder="可选；没有就手填供应商名称" />
          </Form.Item>
          <Form.Item name="supplierName" label="供应商名称">
            <Input placeholder="手动供应商或平台店铺名称" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="unitPrice" label="报价单价" rules={[{ required: true, message: "请输入报价单价" }]}>
                <InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="logisticsFee" label="运费">
                <InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="moq" label="起订量">
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="leadDays" label="交期天数">
                <InputNumber min={0} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="productTitle" label="供应商商品标题">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item name="productUrl" label="报价链接">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item name="remark" label="反馈说明">
            <TextArea rows={3} placeholder="价格有效期、材质差异、交期风险、建议等" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(source1688Pr)}
        title="1688 API寻源"
        okText="导入候选"
        cancelText="取消"
        confirmLoading={source1688Pr ? actingKey === `1688-source-${source1688Pr.id}` : false}
        onCancel={() => setSource1688PrId(null)}
        onOk={() => source1688Form.submit()}
        destroyOnClose
      >
        <Form form={source1688Form} layout="vertical" onFinish={handleSource1688}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={source1688Pr ? `${source1688Pr.productName || source1688Pr.internalSkuCode || "PR"} · ${formatQty(source1688Pr.requestedQty)} pcs` : ""}
          />
          <Form.Item name="keyword" label="关键词" rules={[{ required: true, message: "请输入1688搜索关键词" }]}>
            <Input placeholder="商品名、类目词或供应商常用词" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="pageSize" label="导入数量">
                <InputNumber min={1} max={20} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="priceStart" label="最低价">
                <InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="priceEnd" label="最高价">
                <InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        open={Boolean(poPr)}
        title="生成采购单"
        okText="生成采购单"
        cancelText="取消"
        confirmLoading={poPr ? actingKey === `po-${poPr.id}` : false}
        onCancel={() => setPoPrId(null)}
        onOk={() => poForm.submit()}
        destroyOnClose
      >
        <Form form={poForm} layout="vertical" onFinish={handleGeneratePo}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={poPr ? `${poPr.productName || poPr.internalSkuCode || "采购需求"} · 默认数量 ${formatQty(poPr.requestedQty)}` : ""}
          />
          <Form.Item name="candidateId" label="选择报价" rules={[{ required: true, message: "请选择报价" }]}>
            <Select options={poCandidateOptions} placeholder="选择一个报价生成采购单" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="qty" label="采购数量" rules={[{ required: true, message: "请输入采购数量" }]}>
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="expectedDeliveryDate" label="预计到货">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="remark" label="采购单备注">
            <TextArea rows={3} placeholder="对供应商、付款或入库的补充说明" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(orderMatchDialog)}
        title="选择 1688 订单"
        okText="确认绑定"
        cancelText="取消"
        width={760}
        confirmLoading={orderMatchDialog ? actingKey === `1688-bind-${orderMatchDialog.po.id}` : false}
        okButtonProps={{ disabled: !selectedExternalOrderId }}
        onCancel={() => {
          setOrderMatchDialog(null);
          setSelectedExternalOrderId(null);
        }}
        onOk={confirm1688OrderBind}
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={orderMatchDialog ? `采购单 ${orderMatchDialog.po.poNo || orderMatchDialog.po.id} 找到多个可能的 1688 订单，请人工确认。` : ""}
        />
        <Table<OrderMatchCandidate>
          rowKey="externalOrderId"
          size="small"
          pagination={false}
          dataSource={orderMatchDialog?.matches || []}
          rowSelection={{
            type: "radio",
            selectedRowKeys: selectedExternalOrderId ? [selectedExternalOrderId] : [],
            onChange: (keys) => setSelectedExternalOrderId(String(keys[0] || "")),
          }}
          columns={[
            {
              title: "1688订单号",
              dataIndex: "externalOrderId",
              width: 180,
              render: (value) => <Text strong>{value}</Text>,
            },
            {
              title: "供应商",
              dataIndex: "supplierName",
              render: (value) => value || "-",
            },
            {
              title: "金额",
              dataIndex: "totalAmount",
              width: 100,
              render: formatCurrency,
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 120,
              render: (value) => value || "-",
            },
            {
              title: "匹配",
              key: "match",
              width: 160,
              render: (_value, row) => (
                <Space direction="vertical" size={2}>
                  <Text>{row.matchScore || 0} 分</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {(row.matchReasons || []).join(", ") || "-"}
                  </Text>
                </Space>
              ),
            },
          ]}
        />
      </Modal>

      <Drawer
        open={Boolean(detailPrId)}
        title="采购需求协作"
        width={620}
        onClose={() => setDetailPrId(null)}
      >
        {detailPr ? (
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <div>
              {skuText(detailPr)}
              <div style={{ marginTop: 8 }}>{statusTag(detailPr.status, PR_STATUS_LABELS)}</div>
              <Text type="secondary">
                数量 {formatQty(detailPr.requestedQty)} 件 · 目标 {formatCurrency(detailPr.targetUnitCost)} · 期望 {formatDate(detailPr.expectedArrivalDate)}
              </Text>
            </div>

            <div>
              <Text strong>需求原因</Text>
              <div style={{ marginTop: 6 }}>{detailPr.reason || "-"}</div>
            </div>

            <div>
              <Text strong>报价记录</Text>
              <Table
                rowKey="id"
                size="small"
                style={{ marginTop: 8 }}
                pagination={false}
                dataSource={detailPr.candidates || []}
                columns={[
                  { title: "来源", width: 90, render: (_value, row) => (row.sourcingMethod === "official_api" ? "1688 API" : "手动") },
                  { title: "供应商", dataIndex: "supplierName", render: (value) => value || "-" },
                  { title: "单价", dataIndex: "unitPrice", width: 90, render: formatCurrency },
                  { title: "MOQ", dataIndex: "moq", width: 70, render: formatQty },
                  { title: "交期", dataIndex: "leadDays", width: 80, render: (value) => (value ? `${value} 天` : "-") },
                  {
                    title: "1688",
                    width: 110,
                    render: (_value, row) => row.sourcingMethod === "official_api" ? (
                      <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        loading={actingKey === `1688-detail-${row.id}`}
                        onClick={() => refresh1688CandidateDetail(row)}
                      >
                        Detail
                      </Button>
                    ) : "-",
                  },
                ]}
              />
            </div>

            <div>
              <Text strong>状态时间线 / 留言记录</Text>
              <Timeline
                style={{ marginTop: 16 }}
                items={(detailPr.timeline || []).map((item) => ({
                  key: item.id,
                  color: item.kind === "comment" ? "green" : "blue",
                  children: (
                    <div>
                      <div>{item.message || "-"}</div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {actorText(item)} · {formatDateTime(item.createdAt)}
                      </Text>
                    </div>
                  ),
                }))}
              />
            </div>

            <Form form={commentForm} layout="vertical" onFinish={handleAddComment}>
              <Form.Item name="body" label="新增留言" rules={[{ required: true, message: "请输入留言内容" }]}>
                <TextArea rows={3} placeholder="运营和采购都可以在这里补充信息" />
              </Form.Item>
              <Button
                type="primary"
                icon={<CommentOutlined />}
                loading={actingKey === `comment-${detailPr.id}`}
                onClick={() => commentForm.submit()}
              >
                发送留言
              </Button>
            </Form>
          </Space>
        ) : (
          <Alert type="warning" showIcon message="当前需求不存在或已刷新" />
        )}
      </Drawer>
    </div>
  );
}
