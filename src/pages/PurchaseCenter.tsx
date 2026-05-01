import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClipboardEvent, UIEvent } from "react";
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
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import type { Dayjs } from "dayjs";
import {
  ApiOutlined,
  CarOutlined,
  CheckCircleOutlined,
  CloudSyncOutlined,
  CommentOutlined,
  DeleteOutlined,
  DollarOutlined,
  DownloadOutlined,
  FileSearchOutlined,
  FileDoneOutlined,
  ImportOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
  StopOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
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

const { Paragraph, Text } = Typography;
const { TextArea } = Input;
const { Dragger } = Upload;
const erp = window.electronAPI?.erp;
const MAX_REQUEST_IMAGES = 6;
const UPLOAD_IMAGE_TARGET_BYTES = 260 * 1024;

const SHOW_KEYWORD_1688_SOURCE = false;

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
  sourcePayload?: Record<string, any> | null;
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
  skuImageUrl?: string | null;
  status: string;
  reason?: string;
  requestedQty?: number;
  targetUnitCost?: number | null;
  expectedArrivalDate?: string | null;
  requestedByName?: string;
  evidence?: string[];
  candidateCount?: number;
  selectedCandidateCount?: number;
  mappingCount?: number;
  primaryMappingSupplierName?: string | null;
  primaryMappingOfferId?: string | null;
  skuSupplierId?: string | null;
  skuSupplierName?: string | null;
  unreadCount?: number;
  candidates?: SourcingCandidateRow[];
  timeline?: TimelineRow[];
  updatedAt?: string;
}

interface PurchaseOrderRow {
  id: string;
  poNo?: string;
  accountName?: string;
  supplierName?: string;
  createdByName?: string;
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
  externalPaymentUrl?: string | null;
  externalPaymentUrlSyncedAt?: string | null;
  externalOrderDetailSyncedAt?: string | null;
  externalLogisticsSyncedAt?: string | null;
  mappingCount?: number;
  refundCount?: number;
  latestRefundId?: string | null;
  latestRefundStatus?: string | null;
  latestRefundAmount?: number | null;
  createdAt?: string;
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
  sku1688Sources?: Sku1688SourceRow[];
  alibaba1688Addresses?: Alibaba1688AddressRow[];
  alibaba1688MessageSubscriptions?: Alibaba1688MessageSubscriptionRow[];
  recent1688MessageEvents?: Alibaba1688MessageEventRow[];
}

interface Sku1688SourceRow {
  id: string;
  skuId: string;
  externalOfferId: string;
  externalSkuId?: string;
  externalSpecId?: string;
  supplierName?: string;
  productTitle?: string;
  unitPrice?: number | null;
  ourQty?: number;
  platformQty?: number;
  status?: string;
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

interface Imported1688OrderRow {
  externalOrderId: string;
  status?: string | null;
  supplierName?: string | null;
  totalAmount?: number | null;
  freight?: number | null;
  createdAt?: string | null;
  localPoId?: string | null;
  localPoNo?: string | null;
  generated?: boolean;
  error?: string | null;
  lines?: Array<{
    title?: string | null;
    quantity?: number | null;
    productId?: string | null;
    skuId?: string | null;
    specId?: string | null;
  }>;
  raw?: Record<string, any>;
}

interface SkuOption {
  id: string;
  accountId?: string | null;
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

interface AccountOption {
  id: string;
  name?: string;
  status?: string;
}

interface Alibaba1688AddressRow {
  id: string;
  label?: string;
  fullName?: string;
  mobile?: string | null;
  address?: string;
  addressId?: string | null;
  isDefault?: boolean;
}

interface Alibaba1688MessageSubscriptionRow {
  id: string;
  topic?: string;
  category?: string;
  status?: string;
  lastReceivedAt?: string | null;
  processedCount?: number;
  unmatchedCount?: number;
  ignoredCount?: number;
  errorCount?: number;
}

interface Alibaba1688MessageEventRow {
  id: string;
  topic?: string | null;
  status?: string;
  receivedAt?: string;
}

interface RequestUploadImage {
  uid: string;
  fileName: string;
  dataUrl: string;
}

interface RequestFormValues {
  skuIds: string[];
  requestedQty: number;
  targetUnitCost?: number;
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

interface RefundFormValues {
  refundType?: string;
  goodsStatus?: string;
  amount?: number;
  reason?: string;
  description?: string;
  rawParams?: string;
}

interface OrderNoteFormValues {
  text?: string;
}

interface OrderNoteDialogState {
  po: PurchaseOrderRow;
  mode: "memo" | "feedback";
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

function candidateLabel(candidate: SourcingCandidateRow) {
  return `${candidate.supplierName || "未命名供应商"} · ${formatCurrency(candidate.unitPrice)} · 起订量 ${formatQty(candidate.moq || 1)}`;
}

function candidatePayload(candidate: SourcingCandidateRow) {
  return candidate.sourcePayload && typeof candidate.sourcePayload === "object" ? candidate.sourcePayload : {};
}

function candidateTitle(candidate: SourcingCandidateRow) {
  const raw = candidatePayload(candidate);
  return candidate.productTitle
    || raw.originTitle
    || raw.aiTitle
    || raw.subject
    || raw.title
    || raw.name
    || candidate.externalOfferId
    || "1688 商品";
}

function candidateImage(candidate: SourcingCandidateRow) {
  const raw = candidatePayload(candidate);
  const offerImage = raw.offerImage && typeof raw.offerImage === "object" ? raw.offerImage : {};
  return candidate.imageUrl
    || raw.originImageUrl
    || raw.aiImageUrl
    || raw.imageUrl
    || raw.imgUrl
    || offerImage.imageUrl
    || "";
}

function candidateUrl(candidate: SourcingCandidateRow) {
  const raw = candidatePayload(candidate);
  return candidate.productUrl
    || raw.detailUrl
    || raw.productUrl
    || raw.offerUrl
    || (candidate.externalOfferId ? `https://detail.1688.com/offer/${candidate.externalOfferId}.html` : "");
}

function candidateMetric(candidate: SourcingCandidateRow) {
  const raw = candidatePayload(candidate);
  const sold = raw.soldOut ?? raw.sales ?? raw.salesVolume ?? raw.saleQuantity ?? raw.soldCount;
  return sold ? `销量 ${sold}` : "";
}

function externalOrderStatusLabel(status?: string | null) {
  if (!status) return "-";
  const text = String(status);
  const labels: Record<string, string> = {
    WAIT_BUYER_PAY: "待付款",
    WAIT_SELLER_SEND: "待发货",
    WAIT_BUYER_RECEIVE: "待收货",
    TRADE_SUCCESS: "交易完成",
    SUCCESS: "交易完成",
    CANCEL: "已取消",
    TERMINATED: "已关闭",
    paid: "已付款",
    shipped: "已发货",
    partial_shipped: "部分发货",
    logistics_updated: "物流更新",
    received: "已收货",
    success: "交易完成",
    created: "已创建",
    closed: "已关闭",
    price_modified: "已改价",
    memo_modified: "备注更新",
    feedback_added: "留言已补充",
    refund_synced: "售后已同步",
    refund_requested: "已申请退款",
    refund_in_sales: "售中退款",
    refund_after_sales: "售后退款",
    refund_return_goods_submitted: "退货物流已提交",
  };
  if (labels[text]) return labels[text];
  return /[A-Za-z_]/.test(text) ? "已同步" : text;
}

function refundStatusLabel(status?: string | null) {
  if (!status) return "-";
  const labels: Record<string, string> = {
    refund_requested: "已申请",
    refund_synced: "已同步",
    refund_in_sales: "售中退款",
    refund_after_sales: "售后退款",
    refund_return_goods_submitted: "已退货",
    created: "已创建",
    success: "成功",
    closed: "关闭",
  };
  return labels[String(status)] || String(status);
}

function parseJsonObjectInput(text?: string) {
  const value = String(text || "").trim();
  if (!value) return undefined;
  return JSON.parse(value);
}

function firstPoCandidate(row?: PurchaseRequestRow | null) {
  const candidates = row?.candidates || [];
  return candidates.find((item) => item.status === "selected")
    || candidates.find((item) => item.status === "shortlisted")
    || candidates[0]
    || null;
}

type PurchaseQueueKey =
  | "all_orders"
  | "pending_requests"
  | "draft_orders"
  | "pending_payment"
  | "waiting_delivery"
  | "waiting_inbound"
  | "completed"
  | "exceptions";

interface PurchaseQueueItem {
  key: PurchaseQueueKey;
  title: string;
  count: number;
  kind: "request" | "order" | "mixed";
}

const ACTIVE_REQUEST_STATUSES = new Set(["submitted", "buyer_processing", "sourced", "waiting_ops_confirm"]);
const DRAFT_ORDER_STATUSES = new Set(["draft", "pushed_pending_price"]);
const PAYMENT_QUEUE_STATUSES = new Set(["pending_finance_approval", "approved_to_pay"]);
const DELIVERY_QUEUE_STATUSES = new Set(["paid", "supplier_processing", "shipped"]);
const INBOUND_QUEUE_STATUSES = new Set(["arrived"]);
const COMPLETED_PO_STATUSES = new Set(["inbounded", "closed"]);
const EXCEPTION_PO_STATUSES = new Set(["delayed", "exception", "cancelled"]);

function isPendingPurchaseRequest(row: PurchaseRequestRow) {
  return ACTIVE_REQUEST_STATUSES.has(row.status);
}

function isPendingPaymentOrder(row: PurchaseOrderRow) {
  return PAYMENT_QUEUE_STATUSES.has(row.status);
}

function isWaitingDeliveryOrder(row: PurchaseOrderRow) {
  return DELIVERY_QUEUE_STATUSES.has(row.status) && !isFullyReceived(row);
}

function isWaitingInboundOrder(row: PurchaseOrderRow) {
  return INBOUND_QUEUE_STATUSES.has(row.status) || (
    Number(row.totalQty || 0) > 0
    && Number(row.receivedQty || 0) < Number(row.totalQty || 0)
    && !["draft", "pushed_pending_price", "pending_finance_approval", "approved_to_pay", "cancelled", "closed", "inbounded"].includes(row.status)
  );
}

function isFullyReceived(row: PurchaseOrderRow) {
  const totalQty = Number(row.totalQty || 0);
  if (totalQty <= 0) return false;
  return Number(row.receivedQty || 0) >= totalQty;
}

function isCompletedOrder(row: PurchaseOrderRow) {
  return COMPLETED_PO_STATUSES.has(row.status) || isFullyReceived(row);
}

function isExceptionOrder(row: PurchaseOrderRow) {
  return EXCEPTION_PO_STATUSES.has(row.status);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解析失败"));
    image.src = src;
  });
}

function dataUrlByteLength(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

function isRequestBodyTooLarge(error: unknown) {
  return String((error as any)?.message || error || "").includes("Request body too large");
}

function extractFirstHttpUrl(value: unknown) {
  const match = String(value || "").match(/https?:\/\/[^\s"'<>，。；、]+/i);
  return match ? match[0].replace(/[),.;，。；、]+$/u, "") : "";
}

function getPurchaseRequestDefaultImageUrl(row?: PurchaseRequestRow | null) {
  if (!row) return "";
  for (const item of row.evidence || []) {
    const url = extractFirstHttpUrl(item);
    if (url) return url;
  }
  return row.skuImageUrl || "";
}

function imageSearchEmptyText(result: any) {
  const reason = result?.result?.emptyReason;
  if (reason) return reason;
  return "这张图没有搜到候选，可以换一张更清晰的主图再试。";
}

function latestImageSearchEmptyEvent(row?: PurchaseRequestRow | null) {
  const timeline = [...(row?.timeline || [])].reverse();
  return timeline.find((item) => (
    item.eventType === "source_1688_image"
    && /未命中|imported 0|没有搜到|0 个候选/.test(item.message || "")
  ));
}

async function prepareUploadImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("请上传图片文件");
  const originalDataUrl = await readFileAsDataUrl(file);
  const targetBytes = UPLOAD_IMAGE_TARGET_BYTES;
  if (file.size <= targetBytes && dataUrlByteLength(originalDataUrl) <= targetBytes) return originalDataUrl;

  const image = await loadImageElement(originalDataUrl);
  let maxSide = 1100;
  let quality = 0.78;
  let lastDataUrl = originalDataUrl;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("图片压缩失败");
    context.drawImage(image, 0, 0, width, height);
    lastDataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlByteLength(lastDataUrl) <= targetBytes) return lastDataUrl;
    maxSide = Math.max(520, Math.round(maxSide * 0.78));
    quality = Math.max(0.58, quality - 0.06);
  }

  if (dataUrlByteLength(lastDataUrl) > 900 * 1024) {
    throw new Error("图片太大，请换一张更小的图片");
  }
  return lastDataUrl;
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
  const [loadingMorePrId, setLoadingMorePrId] = useState<string | null>(null);
  const [imageSearchNextPageByPrId, setImageSearchNextPageByPrId] = useState<Record<string, number>>({});
  const [skus, setSkus] = useState<SkuOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [quotePrId, setQuotePrId] = useState<string | null>(null);
  const [source1688PrId, setSource1688PrId] = useState<string | null>(null);
  const [requestUploadImages, setRequestUploadImages] = useState<RequestUploadImage[]>([]);
  const [poPrId, setPoPrId] = useState<string | null>(null);
  const [detailPrId, setDetailPrId] = useState<string | null>(null);
  const [orderMatchDialog, setOrderMatchDialog] = useState<OrderMatchDialogState | null>(null);
  const [selectedExternalOrderId, setSelectedExternalOrderId] = useState<string | null>(null);
  const [refundPoId, setRefundPoId] = useState<string | null>(null);
  const [orderNoteDialog, setOrderNoteDialog] = useState<OrderNoteDialogState | null>(null);
  const [selectedPoIds, setSelectedPoIds] = useState<string[]>([]);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [imported1688Orders, setImported1688Orders] = useState<Imported1688OrderRow[]>([]);
  const [activeQueueKey, setActiveQueueKey] = useState<PurchaseQueueKey>("all_orders");

  const [requestForm] = Form.useForm<RequestFormValues>();
  const [quoteForm] = Form.useForm<QuoteFormValues>();
  const [source1688Form] = Form.useForm<Source1688FormValues>();
  const [poForm] = Form.useForm<PoFormValues>();
  const [refundForm] = Form.useForm<RefundFormValues>();
  const [orderNoteForm] = Form.useForm<OrderNoteFormValues>();

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
  const refundPo = useMemo(
    () => data.purchaseOrders?.find((item) => item.id === refundPoId) || null,
    [data.purchaseOrders, refundPoId],
  );
  const skuOptions = useMemo(
    () => skus.map((sku) => {
      const code = sku.internalSkuCode || sku.id;
      const name = sku.productName || "-";
      return {
        value: sku.id,
        label: code,
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
  const poPrHasMapping = Number(poPr?.mappingCount || 0) > 0;
  const poPrHasSkuSupplier = Boolean(poPr?.skuSupplierId || poPr?.skuSupplierName);

  const purchaseRequests = data.purchaseRequests || [];
  const purchaseOrders = data.purchaseOrders || [];

  const pendingRequestRows = useMemo(
    () => purchaseRequests.filter(isPendingPurchaseRequest),
    [purchaseRequests],
  );
  const draftOrderRows = useMemo(
    () => purchaseOrders.filter((row) => DRAFT_ORDER_STATUSES.has(row.status)),
    [purchaseOrders],
  );
  const pendingPaymentRows = useMemo(
    () => purchaseOrders.filter(isPendingPaymentOrder),
    [purchaseOrders],
  );
  const waitingDeliveryRows = useMemo(
    () => purchaseOrders.filter(isWaitingDeliveryOrder),
    [purchaseOrders],
  );
  const waitingInboundRows = useMemo(
    () => purchaseOrders.filter(isWaitingInboundOrder),
    [purchaseOrders],
  );
  const completedOrderRows = useMemo(
    () => purchaseOrders.filter(isCompletedOrder),
    [purchaseOrders],
  );
  const exceptionOrderRows = useMemo(
    () => purchaseOrders.filter(isExceptionOrder),
    [purchaseOrders],
  );

  const queueItems = useMemo<PurchaseQueueItem[]>(() => [
    {
      key: "all_orders",
      title: "全部待办",
      count: pendingRequestRows.length + purchaseOrders.length,
      kind: "mixed",
    },
    {
      key: "pending_requests",
      title: "待处理采购单",
      count: pendingRequestRows.length,
      kind: "request",
    },
    {
      key: "draft_orders",
      title: "待推单/改价",
      count: draftOrderRows.length,
      kind: "order",
    },
    {
      key: "pending_payment",
      title: "付款审批",
      count: pendingPaymentRows.length,
      kind: "order",
    },
    {
      key: "waiting_delivery",
      title: "待发货",
      count: waitingDeliveryRows.length,
      kind: "order",
    },
    {
      key: "waiting_inbound",
      title: "待入库",
      count: waitingInboundRows.length,
      kind: "order",
    },
    {
      key: "completed",
      title: "已完成",
      count: completedOrderRows.length,
      kind: "order",
    },
    {
      key: "exceptions",
      title: "异常",
      count: exceptionOrderRows.length,
      kind: "order",
    },
  ], [
    completedOrderRows,
    draftOrderRows,
    exceptionOrderRows,
    pendingPaymentRows,
    pendingRequestRows,
    purchaseOrders,
    waitingDeliveryRows,
    waitingInboundRows,
  ]);

  const activeQueue = queueItems.find((item) => item.key === activeQueueKey) || queueItems[0];

  const activeOrderRows = useMemo(() => {
    switch (activeQueueKey) {
      case "draft_orders":
        return draftOrderRows;
      case "pending_payment":
        return pendingPaymentRows;
      case "waiting_delivery":
        return waitingDeliveryRows;
      case "waiting_inbound":
        return waitingInboundRows;
      case "completed":
        return completedOrderRows;
      case "exceptions":
        return exceptionOrderRows;
      default:
        return purchaseOrders;
    }
  }, [
    activeQueueKey,
    completedOrderRows,
    draftOrderRows,
    exceptionOrderRows,
    pendingPaymentRows,
    purchaseOrders,
    waitingDeliveryRows,
    waitingInboundRows,
  ]);

  const activeRequestRows = activeQueueKey === "all_orders" || activeQueueKey === "pending_requests"
    ? pendingRequestRows
    : purchaseRequests;

  const selectedPurchaseOrders = useMemo(
    () => purchaseOrders.filter((row) => selectedPoIds.includes(row.id)),
    [purchaseOrders, selectedPoIds],
  );

  const orderRowSelection = useMemo<TableRowSelection<PurchaseOrderRow>>(() => ({
    selectedRowKeys: selectedPoIds,
    preserveSelectedRowKeys: true,
    onChange: (keys) => setSelectedPoIds(keys.map(String)),
    getCheckboxProps: (row) => ({
      disabled: !row.externalOrderId,
    }),
  }), [selectedPoIds]);

  const applyWorkbench = useCallback((nextData: PurchaseWorkbench) => {
    setData(nextData || {});
  }, []);

  const loadData = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const workbench = await erp.purchase.workbench({ limit: 200 });
      const [skuRows, supplierRows, accountRows] = await Promise.all([
        Array.isArray(workbench?.skuOptions) ? Promise.resolve(workbench.skuOptions) : erp.sku.list({ limit: 500 }),
        Array.isArray(workbench?.supplierOptions) ? Promise.resolve(workbench.supplierOptions) : erp.supplier.list({ limit: 500 }),
        erp.account.list({ limit: 500 }),
      ]);
      applyWorkbench(workbench);
      setSkus(Array.isArray(skuRows) ? skuRows : []);
      setSuppliers(Array.isArray(supplierRows) ? supplierRows : []);
      setAccounts(Array.isArray(accountRows) ? accountRows : []);
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
      return;
    }
    let refreshTimer: number | null = null;
    const unsubscribe = erp.events.onPurchaseUpdate((payload: { type?: string }) => {
      if (payload?.type !== "purchase:update") return;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
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
      if (accounts.length === 0) {
        const accountRows = await erp.account.list({ limit: 500 });
        setAccounts(Array.isArray(accountRows) ? accountRows : []);
      }
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

  const deletePurchaseRequest = async (row: PurchaseRequestRow) => {
    const result = await runAction(
      `delete-pr-${row.id}`,
      { action: "cancel_pr", prId: row.id },
      "采购单已删除",
    );
    if (!result) return;
    if (detailPrId === row.id) setDetailPrId(null);
    if (quotePrId === row.id) setQuotePrId(null);
    if (source1688PrId === row.id) setSource1688PrId(null);
    if (poPrId === row.id) setPoPrId(null);
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

  const openPoModal = (row: PurchaseRequestRow, selectedCandidate?: SourcingCandidateRow | null) => {
    const candidate = selectedCandidate || firstPoCandidate(row);
    setPoPrId(row.id);
    poForm.resetFields();
    poForm.setFieldsValue({
      candidateId: candidate?.id,
      qty: row.requestedQty,
    });
  };

  const handleCreateRequest = async (values: RequestFormValues) => {
    if (!erp) return;
    const selectedSkuIds = Array.isArray(values.skuIds) ? values.skuIds.filter(Boolean) : [];
    if (selectedSkuIds.length === 0) {
      message.error("请选择商品编码");
      return;
    }

    const selectedSkus = selectedSkuIds
      .map((skuId) => skus.find((sku) => sku.id === skuId))
      .filter((sku): sku is SkuOption => Boolean(sku));
    const missingStoreSkus = selectedSkus.filter((sku) => !sku.accountId);
    if (missingStoreSkus.length > 0) {
      message.error("有商品资料还没有匹配采购店铺，请先到商品资料补充店铺");
      return;
    }

    const imageDataUrls = requestUploadImages.map((item) => item.dataUrl);
    const imageFileNames = requestUploadImages.map((item) => item.fileName);
    let skippedImages = false;
    setActingKey("create-pr");
    try {
      for (const sku of selectedSkus) {
        const payload = {
          action: "create_pr",
          accountId: sku.accountId,
          skuId: sku.id,
          requestedQty: values.requestedQty,
          targetUnitCost: values.targetUnitCost,
          reason: "采购单",
          evidenceText: values.evidenceText,
          ...(skippedImages ? {} : {
            imageDataUrl: imageDataUrls[0],
            imageFileName: imageFileNames[0],
            imageDataUrls,
            imageFileNames,
          }),
        };
        try {
          await erp.purchase.action(payload);
        } catch (error) {
          if (!skippedImages && imageDataUrls.length > 0 && isRequestBodyTooLarge(error)) {
            skippedImages = true;
            await erp.purchase.action({
              action: "create_pr",
              accountId: sku.accountId,
              skuId: sku.id,
              requestedQty: values.requestedQty,
              targetUnitCost: values.targetUnitCost,
              reason: "采购单",
              evidenceText: values.evidenceText,
            });
          } else {
            throw error;
          }
        }
      }
      const workbench = await erp.purchase.workbench({ limit: 200 });
      applyWorkbench(workbench);
      if (Array.isArray(workbench?.skuOptions)) setSkus(workbench.skuOptions);
      if (Array.isArray(workbench?.supplierOptions)) setSuppliers(workbench.supplierOptions);
      message.success(selectedSkuIds.length > 1 ? `已创建 ${selectedSkuIds.length} 张采购单` : "采购单已创建");
      if (skippedImages) message.warning("图片过大，采购单已创建，图片未上传");
      setRequestOpen(false);
      setRequestUploadImages([]);
      requestForm.resetFields();
    } catch (error: any) {
      message.error(error?.message || "采购单创建失败");
    } finally {
      setActingKey(null);
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
    }, "1688 候选已导入");
    if (result) {
      setSource1688PrId(null);
      source1688Form.resetFields();
    }
  };

  const runImageSearchForRow = async (row: PurchaseRequestRow, beginPage = 1, silent = false) => {
    const imgUrl = getPurchaseRequestDefaultImageUrl(row);
    if (!imgUrl) {
      message.error("请先在采购单上传图片");
      return null;
    }
    const result = await runAction(`1688-image-${row.id}`, {
      action: "source_1688_image",
      prId: row.id,
      imgUrl,
      beginPage,
      importLimit: 10,
    });
    if (result) {
      const importedCount = Number(result.result?.importedCount || 0);
      setImageSearchNextPageByPrId((prev) => ({ ...prev, [row.id]: beginPage + 1 }));
      if (importedCount <= 0) {
        if (!silent) message.warning(imageSearchEmptyText(result));
        return;
      }
      const nextWorkbench = result.workbench || {};
      const nextPr = (nextWorkbench.purchaseRequests || []).find((item: PurchaseRequestRow) => item.id === row.id);
      if (nextPr?.id) {
        setDetailPrId(nextPr.id);
        setActiveQueueKey("pending_requests");
      }
      if (!silent) message.success(beginPage > 1 ? `已追加 ${importedCount} 个候选` : `已导入 ${importedCount} 个候选`);
      window.setTimeout(() => {
        void loadData();
      }, 250);
    }
    return result;
  };

  const loadMoreImageCandidates = async (row: PurchaseRequestRow) => {
    if (loadingMorePrId === row.id || actingKey === `1688-image-${row.id}`) return;
    const candidateCount = row.candidates?.length || row.candidateCount || 0;
    const nextPage = imageSearchNextPageByPrId[row.id] || Math.floor(candidateCount / 10) + 1;
    if (nextPage < 2 || nextPage > 10) return;
    setLoadingMorePrId(row.id);
    try {
      await runImageSearchForRow(row, nextPage, true);
    } finally {
      setLoadingMorePrId(null);
    }
  };

  const handleCandidateScroll = (event: UIEvent<HTMLDivElement>, row: PurchaseRequestRow) => {
    const target = event.currentTarget;
    if (target.scrollTop + target.clientHeight < target.scrollHeight - 96) return;
    void loadMoreImageCandidates(row);
  };

  const openCandidateUrl = (candidate: SourcingCandidateRow) => {
    const url = candidateUrl(candidate);
    if (!url) {
      message.warning("这个候选还没有商品链接");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const setRequestImageFiles = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const slotsLeft = Math.max(0, MAX_REQUEST_IMAGES - requestUploadImages.length);
    if (slotsLeft === 0) {
      message.warning(`最多上传 ${MAX_REQUEST_IMAGES} 张图片`);
      return;
    }
    const prepared = await Promise.all(imageFiles.slice(0, slotsLeft).map(async (file) => ({
      uid: `${file.name || "paste"}-${file.lastModified || Date.now()}-${file.size}-${Math.random().toString(36).slice(2)}`,
      fileName: file.name || "已粘贴图片",
      dataUrl: await prepareUploadImage(file),
    })));
    setRequestUploadImages((previous) => [...previous, ...prepared].slice(0, MAX_REQUEST_IMAGES));
    message.success(`已添加 ${prepared.length} 张采购图片`);
  };

  const handleRequestImageUpload = async (file: File) => {
    try {
      await setRequestImageFiles([file]);
    } catch (error: any) {
      message.error(error?.message || "图片处理失败");
    }
    return Upload.LIST_IGNORE;
  };

  const handleRequestImagePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
    const itemFiles = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const imageFiles = [...files, ...itemFiles];
    if (imageFiles.length === 0) return;
    event.preventDefault();
    void setRequestImageFiles(imageFiles);
  };

  const preview1688Order = async (row: PurchaseOrderRow) => {
    await runAction(`1688-preview-${row.id}`, {
      action: "preview_1688_order",
      poId: row.id,
    }, "1688 订单已预览");
  };

  const push1688Order = async (row: PurchaseOrderRow) => {
    await runAction(`1688-push-${row.id}`, {
      action: "push_1688_order",
      poId: row.id,
    }, "已推送 1688 订单");
  };

  const request1688PriceChange = async (row: PurchaseOrderRow) => {
    await runAction(`1688-price-request-${row.id}`, {
      action: "request_1688_price_change",
      poId: row.id,
      remark: "已发起 1688 改价沟通",
    }, "已记录改价沟通");
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

  const fetch1688OrderDetail = async (row: PurchaseOrderRow) => {
    await runAction(`1688-detail-${row.id}`, {
      action: "fetch_1688_order_detail",
      poId: row.id,
    }, "1688 订单详情已同步");
  };

  const sync1688Logistics = async (row: PurchaseOrderRow) => {
    await runAction(`1688-logistics-${row.id}`, {
      action: "sync_1688_logistics",
      poId: row.id,
    }, "1688 物流信息已同步");
  };

  const sync1688OrderPrice = async (row: PurchaseOrderRow) => {
    const result = await runAction(`1688-price-sync-${row.id}`, {
      action: "sync_1688_order_price",
      poId: row.id,
    });
    const amount = Number(result?.result?.syncedAmount);
    if (Number.isFinite(amount)) {
      message.success(`订单金额已同步为 ${formatCurrency(amount)}`);
    }
  };

  const open1688PaymentUrl = async (row: PurchaseOrderRow) => {
    const result = await runAction(`1688-pay-${row.id}`, {
      action: "get_1688_payment_url",
      poIds: [row.id],
    }, "1688 支付链接已同步");
    const paymentUrl = result?.result?.paymentUrl || row.externalPaymentUrl;
    if (paymentUrl) window.open(paymentUrl, "_blank", "noopener,noreferrer");
  };

  const openBatch1688PaymentUrl = async () => {
    const poIds = selectedPurchaseOrders
      .filter((row) => row.externalOrderId)
      .map((row) => row.id);
    if (!poIds.length) {
      message.warning("请先勾选已绑定 1688 单号的采购单");
      return;
    }
    const result = await runAction("1688-batch-pay", {
      action: "get_1688_payment_url",
      poIds,
    }, "1688 批量支付链接已同步");
    const paymentUrl = result?.result?.paymentUrl;
    if (paymentUrl) window.open(paymentUrl, "_blank", "noopener,noreferrer");
  };

  const query1688PayWays = async (row: PurchaseOrderRow) => {
    const result = await runAction(`1688-pay-ways-${row.id}`, {
      action: "query_1688_pay_ways",
      poIds: [row.id],
    }, "1688 支付渠道已同步");
    const payWays = Array.isArray(result?.result?.payWays) ? result.result.payWays : [];
    Modal.info({
      title: "1688 支付渠道",
      content: (
        <Space direction="vertical" size={6}>
          <Text>订单：{row.externalOrderId || row.poNo || row.id}</Text>
          <Text>{payWays.length ? payWays.map((item: any) => item.name || item.code).filter(Boolean).join(" / ") : "已返回原始支付渠道数据"}</Text>
        </Space>
      ),
    });
  };

  const query1688ProtocolPayStatus = async (row: PurchaseOrderRow) => {
    const result = await runAction(`1688-protocol-status-${row.id}`, {
      action: "query_1688_protocol_pay_status",
      poIds: [row.id],
    }, "1688 代扣协议状态已同步");
    const isOpen = result?.result?.isOpen;
    Modal.info({
      title: "1688 代扣协议",
      content: (
        <Space direction="vertical" size={6}>
          <Text>订单：{row.externalOrderId || row.poNo || row.id}</Text>
          <Text>状态：{isOpen === true ? "已开通" : isOpen === false ? "未开通" : "已返回原始状态"}</Text>
        </Space>
      ),
    });
  };

  const prepare1688ProtocolPay = async (row: PurchaseOrderRow) => {
    await runAction(`1688-protocol-pay-${row.id}`, {
      action: "prepare_1688_protocol_pay",
      poIds: [row.id],
    }, "1688 免密支付已发起");
  };

  const cancel1688Order = async (row: PurchaseOrderRow) => {
    await runAction(`1688-cancel-${row.id}`, {
      action: "cancel_1688_order",
      poId: row.id,
      cancelReason: "other",
      remark: "ERP取消未付款1688订单",
    }, "1688 订单已取消");
  };

  const open1688OrderNote = (row: PurchaseOrderRow, mode: OrderNoteDialogState["mode"]) => {
    if (!row.externalOrderId) {
      message.warning("请先同步或绑定 1688 订单号");
      return;
    }
    setOrderNoteDialog({ po: row, mode });
    orderNoteForm.resetFields();
    orderNoteForm.setFieldsValue({ text: "" });
  };

  const handle1688OrderNote = async (values: OrderNoteFormValues) => {
    if (!orderNoteDialog) return;
    const text = String(values.text || "").trim();
    if (!text) {
      message.warning("请填写内容");
      return;
    }
    const mode = orderNoteDialog.mode;
    const poId = orderNoteDialog.po.id;
    const result = await runAction(`1688-${mode}-${poId}`, {
      action: mode === "memo" ? "add_1688_order_memo" : "add_1688_order_feedback",
      poId,
      ...(mode === "memo" ? { memo: text } : { feedback: text }),
    }, mode === "memo" ? "1688 备忘已更新" : "1688 买家留言已补充");
    if (result) {
      setOrderNoteDialog(null);
      orderNoteForm.resetFields();
    }
  };

  const confirm1688ReceiveGoods = async (row: PurchaseOrderRow) => {
    await runAction(`1688-receive-${row.id}`, {
      action: "confirm_1688_receive_goods",
      poId: row.id,
    }, "1688 已确认收货");
  };

  const sync1688Addresses = async () => {
    const result = await runAction("1688-address-sync", {
      action: "sync_1688_addresses",
    });
    const count = Number(result?.result?.addressCount || 0);
    if (result) message.success(count ? `已同步 ${count} 个 1688 收货地址` : "1688 暂未返回收货地址");
  };

  const configure1688Messages = async () => {
    const result = await runAction("1688-message-subscribe", {
      action: "configure_1688_message_subscriptions",
    });
    const count = Number(result?.result?.count || 0);
    if (result) message.success(`已启用 ${count} 个 1688 消息订阅主题`);
  };

  const import1688Orders = async (autoGenerate = false) => {
    const result = await runAction(autoGenerate ? "1688-import-generate" : "1688-import-orders", {
      action: "import_1688_orders",
      pageSize: 50,
      autoGenerate,
    });
    const orders = Array.isArray(result?.result?.orders) ? result.result.orders : [];
    setImported1688Orders(orders);
    setImportDialogOpen(true);
    if (result) {
      const generatedCount = Number(result?.result?.generatedCount || 0);
      message.success(autoGenerate ? `已同步 ${orders.length} 个 1688 订单，生成 ${generatedCount} 张本地采购单` : `已同步 ${orders.length} 个 1688 订单`);
    }
  };

  const generatePoFromImportedOrder = async (row: Imported1688OrderRow) => {
    const result = await runAction(`1688-generate-po-${row.externalOrderId}`, {
      action: "generate_po_from_1688_order",
      order: row,
      allowPartial: false,
    }, "已生成本地采购单");
    const po = result?.result?.purchaseOrder;
    if (po?.id) {
      setImported1688Orders((previous) => previous.map((item) => (
        item.externalOrderId === row.externalOrderId
          ? { ...item, localPoId: po.id, localPoNo: po.poNo || po.id, generated: true, error: null }
          : item
      )));
    }
  };

  const openRefundModal = (row: PurchaseOrderRow) => {
    if (!row.externalOrderId) {
      message.warning("请先同步或绑定 1688 订单号");
      return;
    }
    setRefundPoId(row.id);
    refundForm.resetFields();
    refundForm.setFieldsValue({
      refundType: "refund",
      goodsStatus: "received",
      amount: row.latestRefundAmount ?? row.totalAmount,
      reason: "",
      description: "",
    });
  };

  const sync1688Refunds = async (row: PurchaseOrderRow) => {
    const result = await runAction(`1688-refund-sync-${row.id}`, {
      action: "sync_1688_refunds",
      poId: row.id,
    });
    const count = Number(result?.result?.refundCount || 0);
    if (result) message.success(count ? `已同步 ${count} 条退款售后` : "暂未查到退款售后");
  };

  const get1688MaxRefundFee = async (row: PurchaseOrderRow) => {
    const result = await runAction(`1688-refund-max-${row.id}`, {
      action: "get_1688_max_refund_fee",
      poId: row.id,
    });
    if (result) message.success("最大可退金额已查询，详情已写入接口日志");
  };

  const handleCreate1688Refund = async (values: RefundFormValues) => {
    if (!refundPo) return;
    let rawParams: Record<string, any> | undefined;
    try {
      rawParams = parseJsonObjectInput(values.rawParams);
    } catch {
      message.error("原始参数不是合法 JSON");
      return;
    }
    const result = await runAction(`1688-refund-create-${refundPo.id}`, {
      action: "create_1688_refund",
      poId: refundPo.id,
      refundType: values.refundType,
      goodsStatus: values.goodsStatus,
      amount: values.amount,
      reason: values.reason,
      description: values.description,
      ...(rawParams ? { params: rawParams } : {}),
    }, "退款售后已提交");
    if (result) {
      setRefundPoId(null);
      refundForm.resetFields();
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

  const exportActiveQueue = () => {
    if (activeQueue.kind === "mixed") {
      downloadCsv(`purchase-todos-${activeQueueKey}.csv`, [
        ["类型", "商品编码/采购单号", "商品名称/商品摘要", "状态", "数量", "金额/目标成本", "负责人"],
        ...activeRequestRows.map((row) => [
          "待处理",
          row.internalSkuCode || "",
          row.productName || "",
          PR_STATUS_LABELS[row.status] || row.status,
          row.requestedQty || 0,
          row.targetUnitCost ?? "",
          row.requestedByName || "",
        ]),
        ...activeOrderRows.map((row) => [
          "采购单",
          row.poNo || row.id,
          row.skuSummary || "",
          PO_STATUS_LABELS[row.status] || row.status,
          row.totalQty || 0,
          row.totalAmount ?? "",
          row.createdByName || "",
        ]),
      ]);
      return;
    }
    if (activeQueue.kind === "request") {
      downloadCsv(`purchase-requests-${activeQueueKey}.csv`, [
        ["商品编码", "商品名称", "状态", "采购数量", "目标成本", "发起人"],
        ...activeRequestRows.map((row) => [
          row.internalSkuCode || "",
          row.productName || "",
          PR_STATUS_LABELS[row.status] || row.status,
          row.requestedQty || 0,
          row.targetUnitCost ?? "",
          row.requestedByName || "",
        ]),
      ]);
      return;
    }
    downloadCsv(`purchase-orders-${activeQueueKey}.csv`, [
      ["采购日期", "采购单号", "采购员", "供应商", "商品摘要", "总数量", "已入库", "金额", "1688订单号", "线上状态", "状态"],
      ...activeOrderRows.map((row) => [
        formatDateTime(row.createdAt || row.updatedAt),
        row.poNo || row.id,
        row.createdByName || "",
        row.supplierName || "",
        row.skuSummary || "",
        row.totalQty || 0,
        row.receivedQty || 0,
        row.totalAmount ?? "",
        row.externalOrderId || "",
        row.externalOrderStatus || "",
        PO_STATUS_LABELS[row.status] || row.status,
      ]),
    ]);
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
      title: "采购信息",
      key: "request",
      width: 190,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{formatQty(row.requestedQty)} 件</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.requestedByName || "-"}
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
      title: "寻源",
      key: "sourcing",
      width: 120,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{formatQty(row.mappingCount)} 个映射</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {formatQty(row.candidateCount)} 个报价
          </Text>
          {row.primaryMappingSupplierName || row.primaryMappingOfferId ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.primaryMappingSupplierName || row.primaryMappingOfferId}
            </Text>
          ) : null}
          {!row.mappingCount && (row.skuSupplierName || row.skuSupplierId) ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.skuSupplierName || "商品资料供应商"}
            </Text>
          ) : null}
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
        const hasMapping = Number(row.mappingCount || 0) > 0;
        const hasSkuSupplier = Boolean(row.skuSupplierId || row.skuSupplierName);
        const canQuote = canPurchase && ["submitted", "buyer_processing", "sourced"].includes(row.status);
        const canFindSupplier = canQuote && !hasMapping && !hasSkuSupplier;
        const canGeneratePo = canPurchase
          && (hasCandidates || hasMapping || hasSkuSupplier)
          && ["submitted", "buyer_processing", "sourced", "waiting_ops_confirm"].includes(row.status);
        const canDelete = canCreateRequest && ["submitted", "buyer_processing", "sourced"].includes(row.status);
        return (
          <Space size={6} wrap>
            {row.status === "submitted" && canPurchase ? (
              <Button
                size="small"
                icon={<ShoppingCartOutlined />}
                loading={actingKey === `accept-${row.id}`}
                onClick={() => runAction(`accept-${row.id}`, { action: "accept_pr", prId: row.id }, "已接收采购单")}
              >
                接收
              </Button>
            ) : null}
            {canFindSupplier ? (
              <Button size="small" icon={<SearchOutlined />} onClick={() => openQuoteModal(row)}>
                报价反馈
              </Button>
            ) : null}
            {SHOW_KEYWORD_1688_SOURCE && canFindSupplier ? (
              <Button
                size="small"
                icon={<ApiOutlined />}
                loading={actingKey === `1688-source-${row.id}`}
                onClick={() => open1688SourceModal(row)}
              >
                1688 寻源
              </Button>
            ) : null}
            {canFindSupplier ? (
              <Button
                size="small"
                icon={<SearchOutlined />}
                loading={actingKey === `1688-image-${row.id}`}
                onClick={() => runImageSearchForRow(row)}
              >
                以图搜款
              </Button>
            ) : null}
            {canGeneratePo ? (
              <Button size="small" type="primary" icon={<FileDoneOutlined />} onClick={() => openPoModal(row)}>
                生成采购单
              </Button>
            ) : null}
            {canDelete ? (
              <Popconfirm
                title="删除采购单"
                description="删除后会从待办列表移除，已产生的历史记录保留。"
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => deletePurchaseRequest(row)}
              >
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  loading={actingKey === `delete-pr-${row.id}`}
                >
                  删除
                </Button>
              </Popconfirm>
            ) : null}
            {!canFindSupplier && !canGeneratePo && !canDelete && row.status !== "submitted" ? <Text type="secondary">无待办</Text> : null}
          </Space>
        );
      },
    },
  ], [actingKey, canCreateRequest, canPurchase, detailPrId, poPrId, quotePrId, source1688PrId]);

  const orderColumns = useMemo<ColumnsType<PurchaseOrderRow>>(() => [
    {
      title: "采购日期",
      key: "createdAt",
      width: 150,
      render: (_value, row) => formatDateTime(row.createdAt || row.updatedAt),
    },
    {
      title: "采购单号",
      key: "po",
      width: 150,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.poNo || row.id}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.accountName || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "采购员",
      dataIndex: "createdByName",
      width: 100,
      render: (value) => value || "-",
    },
    {
      title: "供应商",
      dataIndex: "supplierName",
      width: 160,
      ellipsis: true,
      render: (value) => value || "-",
    },
    {
      title: "商品摘要",
      key: "qty",
      width: 230,
      ellipsis: true,
      render: (_value, row) => row.skuSummary || "-",
    },
    {
      title: "数量",
      dataIndex: "totalQty",
      width: 88,
      align: "right",
      render: formatQty,
    },
    {
      title: "金额",
      dataIndex: "totalAmount",
      width: 110,
      align: "right",
      render: formatCurrency,
    },
    {
      title: "1688单号",
      key: "externalOrderId",
      width: 180,
      ellipsis: true,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.externalOrderId || "未绑定"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {formatDateTime(row.externalOrderSyncedAt)}
          </Text>
        </Space>
      ),
    },
    {
      title: "线上状态",
      dataIndex: "externalOrderStatus",
      width: 120,
      render: externalOrderStatusLabel,
    },
    {
      title: "售后",
      key: "refundStatus",
      width: 130,
      render: (_value, row) => {
        const count = Number(row.refundCount || 0);
        if (!count && !row.latestRefundStatus) return "-";
        return (
          <Space direction="vertical" size={2}>
            <Text>{count ? `${count} 条` : "已同步"}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {refundStatusLabel(row.latestRefundStatus)}
              {row.latestRefundAmount ? ` · ${formatCurrency(row.latestRefundAmount)}` : ""}
            </Text>
          </Space>
        );
      },
    },
    {
      title: "入库数",
      key: "receivedQty",
      width: 110,
      align: "right",
      render: (_value, row) => `${formatQty(row.receivedQty)} / ${formatQty(row.totalQty)}`,
    },
    {
      title: "付款",
      dataIndex: "paymentStatus",
      width: 120,
      render: (value) => statusTag(value, PAYMENT_STATUS_LABELS),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 130,
      render: (value) => statusTag(value, PO_STATUS_LABELS),
    },
    {
      title: "预计到货",
      dataIndex: "expectedDeliveryDate",
      width: 120,
      render: formatDate,
    },
    {
      title: "动作",
      key: "actions",
      width: 260,
      fixed: "right",
      render: (_value, row) => (
        <Space size={6} wrap style={{ maxWidth: 236 }}>
          {row.status === "draft" && canPurchase && Number(row.mappingCount || 0) > 0 ? (
            <Button
              size="small"
              icon={<ApiOutlined />}
              loading={actingKey === `1688-preview-${row.id}`}
              onClick={() => preview1688Order(row)}
            >
              1688 预览
            </Button>
          ) : null}
          {row.status === "draft" && canPurchase && Number(row.mappingCount || 0) > 0 ? (
            <Button
              size="small"
              type="primary"
              icon={<ShoppingCartOutlined />}
              loading={actingKey === `1688-push-${row.id}`}
              onClick={() => push1688Order(row)}
            >
              1688 推单
            </Button>
          ) : null}
          {row.status === "draft" && canPurchase && Number(row.mappingCount || 0) === 0 ? (
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
          {!row.externalOrderId && canPurchase && row.status !== "draft" && Number(row.mappingCount || 0) > 0 ? (
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={actingKey === `1688-sync-${row.id}`}
              onClick={() => sync1688Order(row)}
            >
              同步订单
            </Button>
          ) : null}
          {row.externalOrderId && (canPurchase || canFinance) ? (
            <Button
              size="small"
              icon={<FileSearchOutlined />}
              loading={actingKey === `1688-detail-${row.id}`}
              onClick={() => fetch1688OrderDetail(row)}
            >
              详情
            </Button>
          ) : null}
          {row.externalOrderId && canPurchase ? (
            <Button
              size="small"
              icon={<CarOutlined />}
              loading={actingKey === `1688-logistics-${row.id}`}
              onClick={() => sync1688Logistics(row)}
            >
              物流
            </Button>
          ) : null}
          {row.externalOrderId && (canPurchase || canFinance) ? (
            <Button
              size="small"
              icon={<LinkOutlined />}
              loading={actingKey === `1688-pay-${row.id}`}
              onClick={() => open1688PaymentUrl(row)}
            >
              支付链接
            </Button>
          ) : null}
          {row.externalOrderId && (canPurchase || canFinance) ? (
            <Button
              size="small"
              icon={<DollarOutlined />}
              loading={actingKey === `1688-pay-ways-${row.id}`}
              onClick={() => query1688PayWays(row)}
            >
              支付渠道
            </Button>
          ) : null}
          {row.externalOrderId && (canPurchase || canFinance) ? (
            <Button
              size="small"
              icon={<FileSearchOutlined />}
              loading={actingKey === `1688-protocol-status-${row.id}`}
              onClick={() => query1688ProtocolPayStatus(row)}
            >
              代扣
            </Button>
          ) : null}
          {row.externalOrderId && canFinance ? (
            <Popconfirm
              title="发起 1688 免密支付"
              description="会调用 1688 代扣/免密支付接口，扣款结果以后续 1688 消息或订单详情为准。"
              okText="发起支付"
              cancelText="返回"
              onConfirm={() => prepare1688ProtocolPay(row)}
            >
              <Button
                size="small"
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={actingKey === `1688-protocol-pay-${row.id}`}
              >
                免密支付
              </Button>
            </Popconfirm>
          ) : null}
          {row.externalOrderId && canPurchase ? (
            <Button
              size="small"
              icon={<DollarOutlined />}
              loading={actingKey === `1688-price-sync-${row.id}`}
              onClick={() => sync1688OrderPrice(row)}
            >
              同步金额
            </Button>
          ) : null}
          {row.externalOrderId && canPurchase ? (
            <Button
              size="small"
              icon={<ApiOutlined />}
              loading={actingKey === `1688-refund-sync-${row.id}`}
              onClick={() => openRefundModal(row)}
            >
              售后
            </Button>
          ) : null}
          {row.externalOrderId && canPurchase ? (
            <Button
              size="small"
              icon={<CommentOutlined />}
              loading={actingKey === `1688-memo-${row.id}`}
              onClick={() => open1688OrderNote(row, "memo")}
            >
              备忘
            </Button>
          ) : null}
          {row.externalOrderId && canPurchase ? (
            <Button
              size="small"
              icon={<CommentOutlined />}
              loading={actingKey === `1688-feedback-${row.id}`}
              onClick={() => open1688OrderNote(row, "feedback")}
            >
              留言
            </Button>
          ) : null}
          {row.externalOrderId && canPurchase && ["paid", "shipped", "arrived"].includes(row.status) ? (
            <Popconfirm
              title="确认 1688 收货"
              description="会在 1688 买家侧确认收货，并同步本地采购单状态。"
              okText="确认收货"
              cancelText="返回"
              onConfirm={() => confirm1688ReceiveGoods(row)}
            >
              <Button
                size="small"
                icon={<CheckCircleOutlined />}
                loading={actingKey === `1688-receive-${row.id}`}
              >
                确认收货
              </Button>
            </Popconfirm>
          ) : null}
          {row.externalOrderId && canPurchase && ["pushed_pending_price", "pending_finance_approval", "approved_to_pay"].includes(row.status) ? (
            <Popconfirm
              title="取消 1688 订单"
              description="只适合取消未付款的 1688 订单，本地采购单会同步为已取消。"
              okText="取消订单"
              cancelText="返回"
              okButtonProps={{ danger: true }}
              onConfirm={() => cancel1688Order(row)}
            >
              <Button
                danger
                size="small"
                icon={<StopOutlined />}
                loading={actingKey === `1688-cancel-${row.id}`}
              >
                取消1688
              </Button>
            </Popconfirm>
          ) : null}
          {row.status === "pushed_pending_price" && canPurchase ? (
            <Button
              size="small"
              icon={<CommentOutlined />}
              loading={actingKey === `1688-price-request-${row.id}`}
              onClick={() => request1688PriceChange(row)}
            >
              改价留言
            </Button>
          ) : null}
          {row.status === "pushed_pending_price" && canPurchase ? (
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
          {row.status === "approved_to_pay" && canFinance && (row.externalOrderId || Number(row.mappingCount || 0) === 0) ? (
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
          {!["draft", "pushed_pending_price", "pending_finance_approval", "approved_to_pay"].includes(row.status) && !(row.externalOrderId && canPurchase) ? <Text type="secondary">无待办</Text> : null}
        </Space>
      ),
    },
  ], [actingKey, canFinance, canPurchase]);

  const importedOrderColumns = useMemo<ColumnsType<Imported1688OrderRow>>(() => [
    {
      title: "1688单号",
      dataIndex: "externalOrderId",
      width: 180,
      ellipsis: true,
      render: (value) => <Text strong>{value || "-"}</Text>,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 130,
      render: externalOrderStatusLabel,
    },
    {
      title: "供应商",
      dataIndex: "supplierName",
      width: 180,
      ellipsis: true,
      render: (value) => value || "-",
    },
    {
      title: "金额",
      dataIndex: "totalAmount",
      width: 110,
      align: "right",
      render: formatCurrency,
    },
    {
      title: "商品",
      key: "lines",
      ellipsis: true,
      render: (_value, row) => {
        const lines = Array.isArray(row.lines) ? row.lines : [];
        if (!lines.length) return "-";
        return lines.slice(0, 2).map((line) => `${line.title || line.productId || "商品"} x${formatQty(line.quantity || 1)}`).join(" / ");
      },
    },
    {
      title: "本地采购单",
      key: "localPo",
      width: 150,
      render: (_value, row) => row.localPoNo || (row.localPoId ? row.localPoId : <Tag color="warning">未生成</Tag>),
    },
    {
      title: "操作",
      key: "actions",
      width: 150,
      fixed: "right",
      render: (_value, row) => (
        <Space size={6}>
          {row.localPoId ? (
            <Tag color="success">已关联</Tag>
          ) : (
            <Button
              size="small"
              type="primary"
              icon={<FileDoneOutlined />}
              loading={actingKey === `1688-generate-po-${row.externalOrderId}`}
              onClick={() => generatePoFromImportedOrder(row)}
            >
              生成采购单
            </Button>
          )}
        </Space>
      ),
    },
  ], [actingKey]);

  const summary = data.summary || {};

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="系统" title="采购中心" subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境缺少本地服务接口" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="系统"
        title="采购中心"
        meta={[
          `更新 ${formatDateTime(data.generatedAt)}`,
          `采购单 ${purchaseOrders.length}`,
          `待处理 ${pendingRequestRows.length}`,
          `付款 ${summary.paymentQueueCount || pendingPaymentRows.length}`,
        ]}
        actions={[
          canCreateRequest ? (
            <Button
              key="new"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                requestForm.resetFields();
                setRequestUploadImages([]);
                requestForm.setFieldsValue({
                  requestedQty: 1,
                });
                setRequestOpen(true);
              }}
            >
              新建采购单
            </Button>
          ) : null,
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={loadData}>
            刷新
          </Button>,
        ].filter(Boolean)}
      />

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">{activeQueue.title}</div>
          </div>
          <Space size={8} wrap>
            {canPurchase ? (
              <Button
                icon={<ImportOutlined />}
                loading={actingKey === "1688-import-orders"}
                onClick={() => import1688Orders(false)}
              >
                同步1688订单
              </Button>
            ) : null}
            {canPurchase ? (
              <Button
                icon={<CloudSyncOutlined />}
                loading={actingKey === "1688-import-generate"}
                onClick={() => import1688Orders(true)}
              >
                同步并生成
              </Button>
            ) : null}
            {canPurchase ? (
              <Button
                icon={<ApiOutlined />}
                loading={actingKey === "1688-address-sync"}
                onClick={sync1688Addresses}
              >
                同步地址
              </Button>
            ) : null}
            {canPurchase ? (
              <Button
                icon={<CloudSyncOutlined />}
                loading={actingKey === "1688-message-subscribe"}
                onClick={configure1688Messages}
              >
                消息订阅
              </Button>
            ) : null}
            {canPurchase || canFinance ? (
              <Button
                icon={<LinkOutlined />}
                disabled={!selectedPurchaseOrders.some((row) => row.externalOrderId)}
                loading={actingKey === "1688-batch-pay"}
                onClick={openBatch1688PaymentUrl}
              >
                批量支付
              </Button>
            ) : null}
            <Button icon={<DownloadOutlined />} onClick={exportActiveQueue}>
              导出
            </Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={loadData}>
              刷新
            </Button>
          </Space>
        </div>
        <Space size={[8, 8]} wrap style={{ marginBottom: 12 }}>
          {queueItems.map((item) => (
            <Button
              key={item.key}
              size="small"
              type={activeQueue.key === item.key ? "primary" : "default"}
              onClick={() => setActiveQueueKey(item.key)}
            >
              {item.title} {item.count}
            </Button>
          ))}
        </Space>
        {activeQueue.kind === "mixed" ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {activeRequestRows.length ? (
              <div>
                <Text strong>待处理</Text>
                <Table
                  rowKey="id"
                  loading={loading}
                  size="middle"
                  columns={requestColumns}
                  dataSource={activeRequestRows}
                  scroll={{ x: 1220 }}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  style={{ marginTop: 8 }}
                />
              </div>
            ) : null}
            {activeOrderRows.length ? (
              <div>
                <Text strong>采购单</Text>
                <Table
                  rowKey="id"
                  loading={loading}
                  size="middle"
                  columns={orderColumns}
                  dataSource={activeOrderRows}
                  rowSelection={orderRowSelection}
                  scroll={{ x: 2300 }}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  style={{ marginTop: 8 }}
                />
              </div>
            ) : null}
            {!activeRequestRows.length && !activeOrderRows.length ? (
              <Table
                rowKey="id"
                loading={loading}
                size="middle"
                columns={orderColumns}
                dataSource={[]}
                rowSelection={orderRowSelection}
                scroll={{ x: 2300 }}
                pagination={false}
              />
            ) : null}
          </Space>
        ) : activeQueue.kind === "request" ? (
          <Table
            rowKey="id"
            loading={loading}
            size="middle"
            columns={requestColumns}
            dataSource={activeRequestRows}
            scroll={{ x: 1220 }}
            pagination={{ pageSize: 10, showSizeChanger: false }}
          />
        ) : (
          <Table
            rowKey="id"
            loading={loading}
            size="middle"
            columns={orderColumns}
            dataSource={activeOrderRows}
            rowSelection={orderRowSelection}
            scroll={{ x: 2300 }}
            pagination={{ pageSize: 10, showSizeChanger: false }}
          />
        )}
      </div>

      <Modal
        open={importDialogOpen}
        title="1688 后台订单"
        width={980}
        footer={[
          <Button key="close" onClick={() => setImportDialogOpen(false)}>
            关闭
          </Button>,
          canPurchase ? (
            <Button
              key="refresh"
              icon={<ImportOutlined />}
              loading={actingKey === "1688-import-orders"}
              onClick={() => import1688Orders(false)}
            >
              重新同步
            </Button>
          ) : null,
          canPurchase ? (
            <Button
              key="generate"
              type="primary"
              icon={<CloudSyncOutlined />}
              loading={actingKey === "1688-import-generate"}
              onClick={() => import1688Orders(true)}
            >
              同步并生成
            </Button>
          ) : null,
        ].filter(Boolean)}
        onCancel={() => setImportDialogOpen(false)}
        destroyOnClose
      >
        <Table<Imported1688OrderRow>
          rowKey="externalOrderId"
          size="small"
          columns={importedOrderColumns}
          dataSource={imported1688Orders}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          scroll={{ x: 980 }}
        />
      </Modal>

      <Modal
        open={requestOpen}
        title="新建采购单"
        okText="创建采购单"
        cancelText="取消"
        confirmLoading={actingKey === "create-pr"}
        onCancel={() => {
          setRequestOpen(false);
          setRequestUploadImages([]);
        }}
        onOk={() => requestForm.submit()}
        destroyOnClose
      >
        {skuOptions.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            message="还没有商品资料"
            description="请先到左侧商品资料创建商品编码，再回来新建采购单。"
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <div onPaste={handleRequestImagePaste}>
        <Form form={requestForm} layout="vertical" onFinish={handleCreateRequest} initialValues={{ requestedQty: 1 }}>
          <Form.Item name="skuIds" label="商品编码" rules={[{ required: true, message: "请选择商品编码" }]}>
            <Select
              mode="multiple"
              showSearch
              maxTagCount="responsive"
              optionFilterProp="searchText"
              options={skuOptions}
              placeholder="选择/搜索商品编码，可多选"
              notFoundContent="暂无商品资料，请先到左侧商品资料创建"
            />
          </Form.Item>
          <Form.Item label="采购图片">
            <Dragger
                accept="image/png,image/jpeg,image/webp"
                multiple
                maxCount={MAX_REQUEST_IMAGES}
                showUploadList={false}
                beforeUpload={handleRequestImageUpload}
                style={{ minHeight: 156, borderRadius: 8, padding: "12px 14px" }}
              >
              {requestUploadImages.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 10, width: "100%" }}>
                  {requestUploadImages.map((item) => (
                    <div key={item.uid} style={{ position: "relative", minWidth: 0 }}>
                      <img
                        src={item.dataUrl}
                        alt={item.fileName}
                        style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 8, background: "#f5f7fb" }}
                      />
                      <Button
                        size="small"
                        danger
                        type="text"
                        icon={<DeleteOutlined />}
                        onClick={(event) => {
                          event.stopPropagation();
                          setRequestUploadImages((previous) => previous.filter((image) => image.uid !== item.uid));
                        }}
                        style={{ position: "absolute", right: 4, top: 4, background: "rgba(255,255,255,0.9)" }}
                      />
                      <Text type="secondary" ellipsis style={{ display: "block", marginTop: 4, fontSize: 12 }}>
                        {item.fileName}
                      </Text>
                    </div>
                  ))}
                </div>
              ) : (
                <Space size={12} align="center" style={{ width: "100%", justifyContent: "center" }}>
                  <UploadOutlined style={{ fontSize: 28, color: "#e55b00" }} />
                  <Space direction="vertical" size={2} style={{ textAlign: "left" }}>
                    <Text strong>上传 / 拖入 / 粘贴图片</Text>
                    <Text type="secondary">最多 {MAX_REQUEST_IMAGES} 张，支持 JPG、PNG、WebP</Text>
                  </Space>
                </Space>
              )}
              {requestUploadImages.length > 0 ? (
                <Text type="secondary" style={{ display: "block", marginTop: 10 }}>
                  已添加 {requestUploadImages.length}/{MAX_REQUEST_IMAGES} 张，继续拖入或粘贴可追加
                </Text>
              ) : null}
            </Dragger>
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="requestedQty" label="采购数量" rules={[{ required: true, message: "请输入采购数量" }]}>
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="targetUnitCost" label="目标单价">
                <InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="evidenceText" label="证据 / 链接">
            <TextArea rows={3} placeholder="每行一条：销量截图、竞品链接、站内数据结论等" />
          </Form.Item>
        </Form>
        </div>
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
            message={quotePr ? `${quotePr.productName || quotePr.internalSkuCode || "采购单"} · ${formatQty(quotePr.requestedQty)} 件` : ""}
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
        title="1688 寻源"
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
            message={source1688Pr ? `${source1688Pr.productName || source1688Pr.internalSkuCode || "采购单"} · ${formatQty(source1688Pr.requestedQty)} 件` : ""}
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
            message={poPr ? `${poPr.productName || poPr.internalSkuCode || "采购单"} · 默认数量 ${formatQty(poPr.requestedQty)}` : ""}
          />
          {poCandidateOptions.length > 0 ? (
            <Form.Item
              name="candidateId"
              label="选择报价"
              rules={poPrHasMapping || poPrHasSkuSupplier ? [] : [{ required: true, message: "请选择报价" }]}
            >
              <Select
                allowClear={poPrHasMapping || poPrHasSkuSupplier}
                options={poCandidateOptions}
                placeholder={poPrHasMapping
                  ? "不选则使用供应商管理"
                  : poPrHasSkuSupplier
                    ? "不选则使用商品资料供应商"
                    : "选择一个报价生成采购单"}
              />
            </Form.Item>
          ) : (
            <Alert
              type={poPrHasMapping || poPrHasSkuSupplier ? "success" : "warning"}
              showIcon
              style={{ marginBottom: 16 }}
              message={poPrHasMapping
                ? "将使用供应商管理生成采购单"
                : poPrHasSkuSupplier
                  ? "将使用商品资料供应商生成采购单"
                  : "请先报价、绑定供应商管理记录或维护商品资料供应商"}
              description={poPrHasMapping
                ? "后续推单会按映射总表里的链接、规格和采购比例下单。"
                : poPrHasSkuSupplier
                  ? "这张采购单不会进入 1688 推单，会走普通供应商采购。"
                  : "没有报价、映射和供应商时，采购单还不能生成。"}
            />
          )}
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
        open={Boolean(orderNoteDialog)}
        title={orderNoteDialog?.mode === "memo" ? "修改 1688 订单备忘" : "补充 1688 买家留言"}
        okText={orderNoteDialog?.mode === "memo" ? "保存备忘" : "提交留言"}
        cancelText="取消"
        confirmLoading={orderNoteDialog ? actingKey === `1688-${orderNoteDialog.mode}-${orderNoteDialog.po.id}` : false}
        onCancel={() => setOrderNoteDialog(null)}
        onOk={() => orderNoteForm.submit()}
        destroyOnClose
      >
        <Form form={orderNoteForm} layout="vertical" onFinish={handle1688OrderNote}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={orderNoteDialog ? `采购单 ${orderNoteDialog.po.poNo || orderNoteDialog.po.id} · 1688订单 ${orderNoteDialog.po.externalOrderId || "-"}` : ""}
          />
          <Form.Item
            name="text"
            label={orderNoteDialog?.mode === "memo" ? "订单备忘" : "买家留言"}
            rules={[{ required: true, message: "请填写内容" }]}
          >
            <TextArea rows={4} placeholder={orderNoteDialog?.mode === "memo" ? "写入 1688 买家侧订单备忘" : "补充给卖家的订单留言"} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(refundPo)}
        title="1688 退款售后"
        okText="提交退款"
        cancelText="关闭"
        width={720}
        confirmLoading={refundPo ? actingKey === `1688-refund-create-${refundPo.id}` : false}
        onCancel={() => setRefundPoId(null)}
        onOk={() => refundForm.submit()}
        destroyOnClose
      >
        {refundPo ? (
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              message={`采购单 ${refundPo.poNo || refundPo.id} · 1688订单 ${refundPo.externalOrderId || "-"}`}
              description={`当前线上状态：${externalOrderStatusLabel(refundPo.externalOrderStatus)}；售后：${refundPo.refundCount ? `${refundPo.refundCount} 条` : "暂无记录"}${refundPo.latestRefundStatus ? `，${refundStatusLabel(refundPo.latestRefundStatus)}` : ""}`}
            />
            <Space wrap>
              <Button
                icon={<ReloadOutlined />}
                loading={actingKey === `1688-refund-sync-${refundPo.id}`}
                onClick={() => sync1688Refunds(refundPo)}
              >
                同步售后
              </Button>
              <Button
                icon={<DollarOutlined />}
                loading={actingKey === `1688-refund-max-${refundPo.id}`}
                onClick={() => get1688MaxRefundFee(refundPo)}
              >
                查最大可退
              </Button>
            </Space>
            <Form form={refundForm} layout="vertical" onFinish={handleCreate1688Refund}>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="refundType" label="退款类型" rules={[{ required: true, message: "请选择退款类型" }]}>
                    <Select
                      options={[
                        { label: "仅退款", value: "refund" },
                        { label: "退货退款", value: "return_goods" },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="goodsStatus" label="货物状态" rules={[{ required: true, message: "请选择货物状态" }]}>
                    <Select
                      options={[
                        { label: "已收货", value: "received" },
                        { label: "未收货", value: "not_received" },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="amount" label="退款金额" rules={[{ required: true, message: "请输入退款金额" }]}>
                    <InputNumber min={0} precision={2} style={{ width: "100%" }} placeholder="0.00" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="reason" label="退款原因" rules={[{ required: true, message: "请输入退款原因" }]}>
                    <Input placeholder="例如：缺货、质量问题、协商退款" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="description" label="说明">
                <TextArea rows={3} placeholder="补充售后说明" />
              </Form.Item>
              <Form.Item name="rawParams" label="原始参数 JSON（可选）">
                <TextArea rows={4} placeholder='例如：{"refundReasonId":"123"}' />
              </Form.Item>
            </Form>
          </Space>
        ) : null}
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
              render: externalOrderStatusLabel,
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
        title="采购单协作"
        width={1080}
        onClose={() => setDetailPrId(null)}
      >
        {detailPr ? (
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <div>
              {skuText(detailPr)}
              <div style={{ marginTop: 8 }}>{statusTag(detailPr.status, PR_STATUS_LABELS)}</div>
              <Text type="secondary">
                数量 {formatQty(detailPr.requestedQty)} 件 · 目标 {formatCurrency(detailPr.targetUnitCost)}
              </Text>
            </div>

            <div>
              <Space align="baseline" size={8}>
                <Text strong>候选商品</Text>
                <Text type="secondary">{formatQty((detailPr.candidates || []).length)} 个候选</Text>
              </Space>
              {!(detailPr.candidates || []).length ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 8, marginBottom: 8 }}
                  message={latestImageSearchEmptyEvent(detailPr)?.message || "还没有候选商品"}
                />
              ) : null}
              <div
                onScroll={(event) => handleCandidateScroll(event, detailPr)}
                style={{
                  maxHeight: 620,
                  overflowY: "auto",
                  paddingRight: 6,
                  marginTop: 12,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(188px, 1fr))",
                    gap: 16,
                  }}
                >
                  {(detailPr.candidates || []).map((candidate, index) => {
                  const image = candidateImage(candidate);
                  const title = candidateTitle(candidate);
                  const metric = candidateMetric(candidate);
                  const url = candidateUrl(candidate);
                  const freightText = Number(candidate.logisticsFee || 0) > 0
                    ? `运费 ${formatCurrency(candidate.logisticsFee)}`
                    : "包邮";
                  return (
                    <div
                      key={candidate.id}
                      style={{
                        position: "relative",
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        padding: 10,
                        minHeight: 342,
                        background: "#fff",
                        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: 8,
                          left: 8,
                          zIndex: 1,
                          minWidth: 24,
                          height: 24,
                          borderRadius: 12,
                          background: "rgba(255, 255, 255, 0.92)",
                          border: "1px solid #e5e7eb",
                          color: "#64748b",
                          fontSize: 12,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {index + 1}
                      </div>
                      <div
                        style={{
                          width: "100%",
                          aspectRatio: "1 / 1",
                          borderRadius: 8,
                          background: "#f8fafc",
                          overflow: "hidden",
                        }}
                      >
                        {image ? (
                          <img
                            src={image}
                            alt={title}
                            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                          />
                        ) : null}
                      </div>
                      <div style={{ minWidth: 0, marginTop: 10 }}>
                        <Paragraph
                          ellipsis={{ rows: 2, tooltip: title }}
                          style={{
                            marginBottom: 0,
                            minHeight: 44,
                            lineHeight: "22px",
                            fontSize: 14,
                            color: "#111827",
                          }}
                        >
                          {title}
                        </Paragraph>
                        <div style={{ marginTop: 8, minHeight: 30 }}>
                          <Text style={{ color: "#ea580c", fontSize: 20, fontWeight: 700 }}>
                            {formatCurrency(candidate.unitPrice)}
                          </Text>
                          <Text style={{ color: "#ea580c", marginLeft: 6, fontSize: 12 }}>{freightText}</Text>
                        </div>
                        <Space size={8} wrap style={{ marginTop: 4 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>起订 {formatQty(candidate.moq || 1)}</Text>
                          {metric ? <Text type="secondary">{metric}</Text> : null}
                        </Space>
                        <Text
                          type="secondary"
                          ellipsis={{ tooltip: candidate.supplierName || "供应商" }}
                          style={{ display: "block", marginTop: 8, fontSize: 12 }}
                        >
                          {candidate.supplierName || "供应商"}
                        </Text>
                        <Space size={6} wrap style={{ marginTop: 10 }}>
                          <Button size="small" icon={<SearchOutlined />} disabled={!url} onClick={() => openCandidateUrl(candidate)}>
                            打开1688
                          </Button>
                          <Button size="small" type="primary" icon={<FileDoneOutlined />} onClick={() => openPoModal(detailPr, candidate)}>
                            生成采购单
                          </Button>
                        </Space>
                      </div>
                    </div>
                  );
                  })}
                </div>
                {loadingMorePrId === detailPr.id ? (
                  <div style={{ padding: "18px 0", textAlign: "center" }}>
                    <Text type="secondary">加载中</Text>
                  </div>
                ) : null}
              </div>
            </div>

          </Space>
        ) : (
          <Alert type="warning" showIcon message="当前采购单不存在或已刷新" />
        )}
      </Drawer>
    </div>
  );
}
