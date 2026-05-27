import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, Key, MouseEvent, PointerEvent, UIEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Col,
  DatePicker,
  Drawer,
  Form,
  Image as AntdImage,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Popover,
  Progress,
  Row,
  Select,
  Segmented,
  Skeleton,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import { useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  ApiOutlined,
  CheckCircleOutlined,
  CommentOutlined,
  DeleteOutlined,
  DollarOutlined,
  DownloadOutlined,
  EditOutlined,
  FileDoneOutlined,
  HolderOutlined,
  ImportOutlined,
  LinkOutlined,
  CloseOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  RollbackOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
  ShopOutlined,
  StopOutlined,
  SyncOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StoreManager from "../components/StoreManager";
import { useErpAuth } from "../contexts/ErpAuthContext";
import {
  PAYMENT_STATUS_LABELS,
  PO_STATUS_LABELS,
  PO_ROLLBACK_BUTTON_LABELS,
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
const { RangePicker } = DatePicker;
const erp = window.electronAPI?.erp;
const MAX_REQUEST_IMAGES = 6;
const UPLOAD_IMAGE_TARGET_BYTES = 260 * 1024;

const SHOW_KEYWORD_1688_SOURCE = false;
const PURCHASE_ORDER_CREATE_ROLES = ["operations", "buyer", "manager", "admin"];
const AUTO_1688_ORDER_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const PAYMENT_URL_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const IMAGE_SEARCH_PAGE_SIZE = 10;
const IMAGE_SEARCH_MAX_PAGE = 10;
const AUTO_INQUIRY_LIMIT = 5;
const MAX_COMMENT_IMAGES = 6;
const CANDIDATE_SCROLL_BOTTOM_PX = 96;
const CANDIDATE_SCROLL_REARM_PX = 220;
const MINIMIZED_IMAGE_SEARCH_WIDTH = 132;
const MINIMIZED_IMAGE_SEARCH_HEIGHT = 58;
const MINIMIZED_IMAGE_SEARCH_MARGIN = 8;
const PURCHASE_WORKBENCH_CACHE_KEY = "temu.purchase.workbench.cache.v3";
const PURCHASE_ORDER_DEFAULT_PAGE_SIZE = 20;
const PURCHASE_REQUEST_REASON_SOURCING = "找品";
const PURCHASE_REQUEST_REASON_OPTIMIZATION = "优化";
const FAST_PURCHASE_WORKBENCH_PARAMS = {
  limit: 2000,
  purchaseOrderLimit: PURCHASE_ORDER_DEFAULT_PAGE_SIZE,
  includeRequestDetails: false,
  includeOptions: false,
  include1688Meta: false,
};
const FULL_PURCHASE_WORKBENCH_PARAMS = {
  limit: 2000,
  purchaseOrderLimit: PURCHASE_ORDER_DEFAULT_PAGE_SIZE,
  includePurchaseOrders: false,
  includeRequestDetails: false,
  // 性能：跨海 client mode 下，options（skuOptions/supplierOptions/sku1688Sources 各 500 条带长字段）
  // 把响应体撑到 3MB+，下载 1-3 秒。SKU 选择器已改服务端搜索（handleSkuSearch），
  // supplier 下拉也走 erp.supplier.list 按需拉，主页不再需要这一坨。
  includeOptions: false,
  include1688Meta: true,
};
const TABLE_IDENTIFIER_TEXT_STYLE = {
  fontFamily: "inherit",
  fontWeight: 500,
  color: "#0f172a",
};
const STORE_NAME_COLLATOR = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });
const QUICK_PURCHASE_ACTIONS = new Set([
  "accept_pr",
  "mark_read",
  "mark_sourced",
  "cancel_pr",
  "delete_pr",
  "generate_po",
  "delete_po",
  "rollback_po_status",
  "submit_payment_approval",
  "approve_payment",
  "confirm_paid",
  "request_1688_price_change",
  "get_1688_payment_url",
  "query_1688_pay_ways",
  "query_1688_protocol_pay_status",
  "prepare_1688_protocol_pay",
  "sync_1688_order_price",
  "sync_1688_refunds",
  "sync_1688_refund_detail",
  "get_1688_refund_reasons",
  "get_1688_max_refund_fee",
  "upload_1688_refund_voucher",
  "create_1688_refund",
  "cancel_1688_order",
  "add_1688_order_memo",
  "add_1688_order_feedback",
  "confirm_1688_receive_goods",
  "link_1688_order_to_po",
]);
const DEFAULT_PURCHASE_INQUIRY_TEMPLATE = [
  "商品包装方式是什么？商品需要提供哪些资质文件？可以优惠吗？",
  "整箱包装尺寸和重量是多少？下单需要注意什么？",
].join("");
const PURCHASE_INQUIRY_TEMPLATE_VARIABLES = [
  "{商品名称}",
  "{商品编码}",
  "{采购数量}",
  "{目标成本}",
  "{候选商品标题}",
  "{供应商}",
  "{1688链接}",
];
let lastAuto1688OrderSyncAt = 0;
let auto1688OrderSyncPromise: Promise<void> | null = null;
let initialPurchaseWorkbenchCache: PurchaseWorkbench | null | undefined;
type PurchaseRequestDrawerMode = "collaboration" | "imageSearch";

interface ExternalSkuOptionRow {
  externalSkuId?: string | null;
  externalSpecId?: string | null;
  specText?: string | null;
  imageUrl?: string | null;
  price?: number | null;
  stock?: number | null;
}

interface BindingSpecRow extends ExternalSkuOptionRow {
  key: string;
  externalSpecId: string;
}

interface SpecBindingDialogState {
  candidate: SourcingCandidateRow;
  prId?: string | null;
}

interface SourcingCandidateRow {
  id: string;
  prId?: string;
  accountId?: string | null;
  purchaseSource?: string;
  sourcingMethod?: string;
  supplierName?: string;
  productTitle?: string | null;
  productUrl?: string | null;
  imageUrl?: string | null;
  externalOfferId?: string | null;
  externalSkuId?: string | null;
  externalSpecId?: string | null;
  externalSkuOptions?: ExternalSkuOptionRow[];
  externalPriceRanges?: Array<{ startQuantity?: number; price?: number }>;
  externalDetailFetchedAt?: string | null;
  sourcePayload?: Record<string, any> | null;
  unitPrice?: number;
  moq?: number;
  leadDays?: number | null;
  logisticsFee?: number | null;
  remark?: string | null;
  inquiryStatus?: string | null;
  inquiryMessage?: string | null;
  inquirySentAt?: string | null;
  inquiryResult?: Record<string, any> | null;
  status?: string;
  createdByName?: string;
  updatedAt?: string;
}

interface TimelineRow {
  id: string;
  kind: "event" | "comment";
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  message?: string;
  eventType?: string;
  createdAt?: string;
}

interface PurchaseRequestRow {
  id: string;
  accountId?: string | null;
  accountName?: string | null;
  skuId?: string | null;
  internalSkuCode?: string;
  productName?: string;
  colorSpec?: string | null;
  specText?: string | null;
  skuImageUrl?: string | null;
  status: string;
  reason?: string;
  requestedQty?: number;
  targetUnitCost?: number | null;
  buyerUnitCost?: number | null;
  buyerRemark?: string | null;
  buyerFeedbackByName?: string | null;
  buyerFeedbackAt?: string | null;
  expectedArrivalDate?: string | null;
  requestedByName?: string;
  evidence?: string[];
  candidateCount?: number;
  selectedCandidateCount?: number;
  mappingCount?: number;
  primaryMappingSupplierName?: string | null;
  primaryMappingOfferId?: string | null;
  primaryMappingUnitPrice?: number | null;
  primaryCandidateUnitPrice?: number | null;
  primaryCandidateSupplierName?: string | null;
  skuSupplierId?: string | null;
  skuSupplierName?: string | null;
  unreadCount?: number;
  candidates?: SourcingCandidateRow[];
  timeline?: TimelineRow[];
  updatedAt?: string;
}

const PURCHASE_EVENT_TYPE_LABELS: Record<string, string> = {
  create_request: "新建需求",
  accept_request: "接收需求",
  mark_sourced: "找到货源",
  buyer_feedback: "采购回填",
  quote_feedback: "报价反馈",
  source_1688_keyword: "1688 找款",
  source_1688_image: "1688 图搜",
  refresh_1688_product_detail: "解析规格",
  bind_1688_candidate_spec: "绑定规格",
  generate_po: "生成采购单",
  update_offline_po: "更新线下单",
  convert_po_to_offline: "转线下采购",
  delete_po: "删除采购单",
  preview_1688_order: "1688 预览",
  push_1688_order: "1688 推单",
  sync_1688_orders: "同步 1688",
  request_1688_price_change: "申请改价",
  sync_1688_order_price: "同步金额",
  submit_payment_approval: "提交付款",
  approve_payment: "确认付款申请",
  confirm_paid: "确认已付款",
  auto_create_inbound_receipt: "生成入库单",
  register_arrival: "确认到仓",
  confirm_count: "确认实收",
  create_batches: "创建批次",
  mark_arrived: "采购到仓",
  mark_inbounded: "完成入库",
  create_outbound_plan: "创建出库计划",
  submit_outbound: "提交出库",
  start_picking: "开始拣货",
  mark_packed: "打包完成",
  confirm_shipped_out: "确认发出",
  request_ops_confirm: "等待运营确认",
  confirm_outbound_done: "运营确认出库",
};

function purchaseEventTypeLabel(eventType?: string | null) {
  if (!eventType) return null;
  return PURCHASE_EVENT_TYPE_LABELS[eventType] || eventType;
}

function purchaseLogTitle(row: TimelineRow) {
  if (row.kind === "comment") return "协作留言";
  return purchaseEventTypeLabel(row.eventType) || "操作记录";
}

function purchaseLogActor(row: TimelineRow) {
  return row.actorName || row.actorId || row.actorRole || "系统";
}

interface PurchaseOrderRow {
  id: string;
  prId?: string | null;
  poNo?: string;
  accountId?: string | null;
  accountName?: string;
  supplierId?: string | null;
  supplierName?: string;
  createdByName?: string;
  status: string;
  paymentStatus?: string;
  paidAt?: string | null;
  skuSummary?: string;
  skuImageUrl?: string | null;
  skuCodes?: string | null;
  productNames?: string | null;
  totalQty?: number;
  receivedQty?: number;
  totalAmount?: number;
  paidAmount?: number | null;
  freightAmount?: number | null;
  unitCost?: number | null;
  logisticsFee?: number | null;
  expectedDeliveryDate?: string | null;
  externalOrderId?: string | null;
  externalOrderStatus?: string | null;
  externalOrderSyncedAt?: string | null;
  externalOrderPreviewedAt?: string | null;
  externalPaymentUrl?: string | null;
  externalPaymentUrlSyncedAt?: string | null;
  externalOrderDetailSyncedAt?: string | null;
  externalLogisticsSyncedAt?: string | null;
  externalLogisticsJson?: string | object | null;
  mappingCount?: number;
  deliveryAddressCount?: number;
  refundCount?: number;
  latestRefundId?: string | null;
  latestRefundStatus?: string | null;
  latestRefundAmount?: number | null;
  lineItems?: PurchaseOrderLineDetail[];
  createdAt?: string;
  updatedAt?: string;
}

interface PurchaseOrderLineDetail {
  id?: string;
  skuId?: string | null;
  skuCode?: string | null;
  skuCodes?: string[];
  productName?: string | null;
  specText?: string | null;
  qty?: number | null;
  receivedQty?: number | null;
  unitCost?: number | null;
  logisticsFee?: number | null;
  amount?: number | null;
  paidAmount?: number | null;
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
  paidAmount?: number | null;
  freightAmount?: number | null;
  requestedByName?: string;
  approvedByName?: string;
  updatedAt?: string;
}

interface PurchaseSettings {
  id?: string;
  companyId?: string;
  inquiryTemplate?: string;
  alphaShopAccessKey?: string;
  hasAlphaShopSecretKey?: boolean;
  hasAlphaShopCredentials?: boolean;
  updatedAt?: string | null;
}

interface PurchaseOrderCounts {
  all?: number;
  draft?: number;
  pendingPayment?: number;
  paid?: number;
  completed?: number;
  cancelled?: number;
  exception?: number;
  open?: number;
}

interface PurchaseOrderPageMeta {
  limit?: number;
  offset?: number;
  total?: number;
  queue?: string;
  search?: string;
  productCode?: string;
  sortField?: string;
  sortDirection?: PurchaseOrderSortDirection;
}

type PurchaseOrderSortDirection = "ascend" | "descend" | null;

interface PurchaseOrderSortState {
  field: string;
  direction: PurchaseOrderSortDirection;
}

interface PurchaseOrderFilterDraft {
  keyword: string;
  poNo: string;
  dateRange: any;
  purchaser: string;
  accountId: string;
  supplier: string;
  paymentState: string;
  sourceState: string;
  riskState: string;
  productCode: string;
  amountMin: number | null;
  amountMax: number | null;
}

interface PurchaseOrderFilters {
  keyword: string;
  poNo: string;
  dateFrom: string;
  dateTo: string;
  purchaser: string;
  accountId: string;
  supplier: string;
  paymentState: string;
  sourceState: string;
  riskState: string;
  productCode: string;
  amountMin: number | null;
  amountMax: number | null;
}

interface PurchaseWorkbench {
  generatedAt?: string;
  summary?: Record<string, number>;
  purchaseRequests?: PurchaseRequestRow[];
  purchaseOrders?: PurchaseOrderRow[];
  purchaseOrderCounts?: PurchaseOrderCounts;
  purchaseOrderPage?: PurchaseOrderPageMeta;
  paymentQueue?: PaymentQueueRow[];
  skuOptions?: SkuOption[];
  supplierOptions?: SupplierOption[];
  sku1688Sources?: Sku1688SourceRow[];
  purchaseSettings?: PurchaseSettings;
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
  imageUrl?: string | null;
  colorSpec?: string | null;
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
  costPrice?: number | null;
  actualStockQty?: number | null;
  warehouseLocation?: string | null;
  jstMainBin?: string | null;
  systemSupplierName?: string | null;
  jstCostPrice?: number | null;
  jstSupplierName?: string | null;
  jstActualStockQty?: number | null;
}

interface SupplierOption {
  id: string;
  name?: string;
}

interface AccountOption {
  id: string;
  name?: string;
  status?: string;
  // 店铺默认的 1688 采购账号（推单时作为预选值），erp.account.list 返回带这个字段
  default1688PurchaseAccountId?: string | null;
}

function storeAccountSortLabel(account: Pick<AccountOption, "id" | "name">) {
  return String(account.name || account.id || "").trim();
}

function sortStoreAccounts<T extends Pick<AccountOption, "id" | "name">>(rows: T[]) {
  return [...rows].sort((left, right) => {
    const byName = STORE_NAME_COLLATOR.compare(storeAccountSortLabel(left), storeAccountSortLabel(right));
    if (byName !== 0) return byName;
    return STORE_NAME_COLLATOR.compare(String(left.id || ""), String(right.id || ""));
  });
}

// 1688 采购账号（用于推单时让用户选哪个买家账号下单）
// list_1688_purchase_accounts action 返回的 accounts 数组元素结构
interface Purchase1688Account {
  id: string;
  label?: string | null;
  memberId?: string | null;
  appKey?: string;
  status?: string;
  configured?: boolean;
  authorized?: boolean;
}

interface Alibaba1688AddressRow {
  id: string;
  label?: string;
  fullName?: string;
  mobile?: string | null;
  address?: string;
  addressId?: string | null;
  address_id?: string | null;
  isDefault?: boolean;
  purchase1688AccountId?: string | null;
}

function get1688AddressRemoteId(address?: Alibaba1688AddressRow | null) {
  return String(address?.addressId || address?.address_id || "").trim();
}

function isUsable1688Address(address?: Alibaba1688AddressRow | null) {
  return Boolean(get1688AddressRemoteId(address));
}

function pickDefaultUsable1688Address<T extends Alibaba1688AddressRow>(addresses: T[]) {
  const usable = addresses.filter(isUsable1688Address);
  return usable.find((address) => address.isDefault) || usable[0] || null;
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

interface PurchaseCenterProps {
  initialStoreManagerOpen?: boolean;
  workArea?: PurchaseWorkArea;
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
  specText?: string;
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

interface BuyerFeedbackFormValues {
  buyerUnitCost?: number;
  buyerRemark?: string;
}

interface OfflinePoFormValues {
  supplierId?: string;
  supplierName?: string;
  unitPrice: number;
  logisticsFee?: number;
  qty: number;
}

interface DirectPoLineFormValues {
  skuIds?: string[];
  qty?: number;
}

interface DirectPoFormValues {
  items: DirectPoLineFormValues[];
}

interface Source1688FormValues {
  keyword: string;
  pageSize?: number;
  priceStart?: number;
  priceEnd?: number;
}

interface RefundFormValues {
  refundType?: string;
  goodsStatus?: string;
  amount?: number;
  refundReasonId?: string;
  reason?: string;
  description?: string;
  rawParams?: string;
}

interface RefundReasonOption {
  label: string;
  value: string;
  refundReasonId?: string | null;
}

interface OrderNoteFormValues {
  text?: string;
}

interface PurchaseSettingsFormValues {
  inquiryTemplate?: string;
}

interface InquiryDialogFormValues {
  inquiryMessage?: string;
}

interface OrderNoteDialogState {
  po: PurchaseOrderRow;
  mode: "memo" | "feedback";
}

function compactPurchaseWorkbenchForCache(workbench: PurchaseWorkbench): PurchaseWorkbench {
  const purchaseRequests = Array.isArray(workbench.purchaseRequests)
    ? workbench.purchaseRequests.map((row) => {
      const { candidates: _candidates, timeline: _timeline, comments: _comments, events: _events, ...rest } = row as any;
      return rest as PurchaseRequestRow;
    })
    : undefined;
  return {
    ...workbench,
    purchaseRequests,
  };
}

function readCachedPurchaseWorkbench(): PurchaseWorkbench {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PURCHASE_WORKBENCH_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as PurchaseWorkbench : {};
  } catch {
    return {};
  }
}

function getInitialPurchaseWorkbenchCache(): PurchaseWorkbench {
  if (initialPurchaseWorkbenchCache === undefined) {
    initialPurchaseWorkbenchCache = readCachedPurchaseWorkbench();
  }
  return initialPurchaseWorkbenchCache || {};
}

function writeCachedPurchaseWorkbench(workbench: PurchaseWorkbench) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PURCHASE_WORKBENCH_CACHE_KEY,
      JSON.stringify(compactPurchaseWorkbenchForCache(workbench)),
    );
  } catch {
    // Cache is only a speed hint; ignore quota or privacy-mode failures.
  }
}

function hasWorkbenchSnapshot(workbench: PurchaseWorkbench) {
  return Boolean(
    workbench.generatedAt
    || (Array.isArray(workbench.purchaseRequests) && workbench.purchaseRequests.length)
    || (Array.isArray(workbench.purchaseOrders) && workbench.purchaseOrders.length)
  );
}

function formatCurrency(value?: number | string | null) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "-";
  return `¥${number.toFixed(2)}`;
}

function formatOptionalCurrency(value?: number | string | null) {
  if (value === null || value === undefined || value === "") return "-";
  return formatCurrency(value);
}

function renderSkuSelectOption(option: any, onPreview?: (preview: { src: string; alt: string }) => void) {
  const d = option?.data || option || {};
  const displayCode = String(d?.label || d?.value || "");
  const costText = d?.skuCost === null || d?.skuCost === undefined || d?.skuCost === "" ? "-" : `¥${d.skuCost}`;
  const stockText = d?.skuStock === null || d?.skuStock === undefined || d?.skuStock === "" ? "-" : d.skuStock;
  const warehouseText = d?.skuWarehouse || "-";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "72px minmax(0, 1fr)",
        gap: 12,
        alignItems: "start",
        lineHeight: 1.35,
        padding: "4px 0",
      }}
    >
      <div
        role={d?.skuImage ? "button" : undefined}
        tabIndex={d?.skuImage ? 0 : undefined}
        title={d?.skuImage ? "点击放大图片" : undefined}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (d?.skuImage) onPreview?.({ src: d.skuImage, alt: d?.skuName || displayCode || "商品图片" });
        }}
        onKeyDown={(event) => {
          if (!d?.skuImage || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          event.stopPropagation();
          onPreview?.({ src: d.skuImage, alt: d?.skuName || displayCode || "商品图片" });
        }}
        style={{
          width: 60,
          height: 60,
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          overflow: "hidden",
          background: "#f8fafc",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#9ca3af",
          cursor: d?.skuImage ? "zoom-in" : "default",
          fontSize: 12,
        }}
      >
        {d?.skuImage ? (
          <img
            src={d.skuImage}
            alt=""
            style={{ width: 60, height: 60, objectFit: "cover", display: "block" }}
          />
        ) : (
          "无图"
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 650, color: "#111827" }}>{displayCode}</div>
        <div
          style={{
            color: "#374151",
            whiteSpace: "normal",
            wordBreak: "break-word",
            marginTop: 2,
          }}
        >
          {d?.skuName || "-"}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "2px 10px",
            marginTop: 4,
            fontSize: 12,
            color: "#6b7280",
          }}
        >
          <span>成本 {costText}</span>
          <span>库存 {stockText}</span>
          <span>仓位 {warehouseText}</span>
        </div>
      </div>
    </div>
  );
}

function toFiniteNumber(value?: number | string | null) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function purchaseOrderPayableAmount(row: PurchaseOrderRow) {
  const paidAmount = optionalFiniteNumber(row.paidAmount);
  if (paidAmount !== null && paidAmount > 0) return paidAmount;
  return toFiniteNumber(row.totalAmount) + toFiniteNumber(row.freightAmount);
}

function purchaseOrderIsPaid(row: PurchaseOrderRow) {
  const status = String(row.status || "").toLowerCase();
  const paymentStatus = String(row.paymentStatus || "").toLowerCase();
  return ["paid", "supplier_processing", "shipped", "arrived", "inbounded", "closed"].includes(status)
    || ["paid", "confirmed", "success"].includes(paymentStatus)
    || Boolean(row.paidAt);
}

function purchaseOrderReceiptPercent(row: PurchaseOrderRow) {
  const totalQty = toFiniteNumber(row.totalQty);
  if (totalQty <= 0) return 0;
  return Math.min(100, Math.round((toFiniteNumber(row.receivedQty) / totalQty) * 100));
}

function readFocusPoFromHash() {
  try {
    const hash = window.location.hash || "";
    const qIdx = hash.indexOf("?");
    if (qIdx === -1) return "";
    const qs = new URLSearchParams(hash.slice(qIdx + 1));
    return qs.get("focusPo") || "";
  } catch {
    return "";
  }
}

function formatFilterDate(value: any) {
  return value && typeof value.format === "function" ? value.format("YYYY-MM-DD") : "";
}

function normalizeMoneyFilter(value: unknown) {
  const number = optionalFiniteNumber(value);
  return number === null || number < 0 ? null : number;
}

function toPurchaseOrderFilters(draft: PurchaseOrderFilterDraft): PurchaseOrderFilters {
  const range = Array.isArray(draft.dateRange) ? draft.dateRange : [];
  return {
    keyword: draft.keyword.trim(),
    poNo: draft.poNo.trim(),
    dateFrom: formatFilterDate(range[0]),
    dateTo: formatFilterDate(range[1]),
    purchaser: draft.purchaser.trim(),
    accountId: draft.accountId.trim(),
    supplier: draft.supplier.trim(),
    paymentState: draft.paymentState.trim(),
    sourceState: draft.sourceState.trim(),
    riskState: draft.riskState.trim(),
    productCode: draft.productCode.trim(),
    amountMin: normalizeMoneyFilter(draft.amountMin),
    amountMax: normalizeMoneyFilter(draft.amountMax),
  };
}

function skuText(row: { internalSkuCode?: string; productName?: string }) {
  return (
    <Space direction="vertical" size={2}>
      <Text strong>{row.internalSkuCode || "-"}</Text>
      <Text type="secondary" style={{ fontSize: 12 }}>{row.productName || "-"}</Text>
    </Space>
  );
}

function candidatePayload(candidate: SourcingCandidateRow): Record<string, any> {
  const payload = candidate.sourcePayload;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
}

function normalizeImageUrl(value: unknown): string {
  const text = String(value || "").trim();
  if (!text || text === "[object Object]") return "";
  return text.startsWith("//") ? `https:${text}` : text;
}

function imageValue(value: unknown): string {
  if (!value) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = imageValue(item);
      if (url) return url;
    }
    return "";
  }
  if (typeof value === "object") {
    const item = value as Record<string, any>;
    return imageValue(
      item.imgUrl
      || item.imageUrl
      || item.url
      || item.src
      || item.pictureUrl
      || item.originImageUrl
      || item.fullPath,
    );
  }
  return normalizeImageUrl(value);
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
  const payload = candidatePayload(candidate);
  const raw = payload.raw && typeof payload.raw === "object" && !Array.isArray(payload.raw) ? payload.raw : payload;
  return imageValue([
    candidate.imageUrl,
    payload.originImageUrl,
    payload.aiImageUrl,
    payload.imageUrl,
    payload.imgUrl,
    payload.image_url,
    payload.pictureUrl,
    payload.picture_url,
    payload.offerImage,
    payload.image,
    payload.imageUrls,
    raw.originImageUrl,
    raw.aiImageUrl,
    raw.imageUrl,
    raw.imgUrl,
    raw.image_url,
    raw.pictureUrl,
    raw.picture_url,
    raw.offerImage,
    raw.image,
    raw.imageUrls,
  ]);
}

function candidateUrl(candidate: SourcingCandidateRow) {
  const raw = candidatePayload(candidate);
  return candidate.productUrl
    || raw.detailUrl
    || raw.productUrl
    || raw.offerUrl
    || (candidate.externalOfferId ? `https://detail.1688.com/offer/${candidate.externalOfferId}.html` : "");
}

function buildLocal1688InquiryCandidate(candidate: SourcingCandidateRow) {
  return {
    candidateId: candidate.id,
    id: candidate.id,
    externalOfferId: candidate.externalOfferId,
    productUrl: candidateUrl(candidate),
    productTitle: candidateTitle(candidate),
    supplierName: candidate.supplierName,
    imageUrl: candidateImage(candidate),
  };
}

function candidateMetric(candidate: SourcingCandidateRow) {
  const raw = candidatePayload(candidate);
  const sold = raw.soldOut ?? raw.sales ?? raw.salesVolume ?? raw.saleQuantity ?? raw.soldCount;
  return sold ? `销量 ${sold}` : "";
}

function candidateRawPayload(candidate: SourcingCandidateRow): Record<string, any> {
  const raw = candidatePayload(candidate);
  return raw.raw && typeof raw.raw === "object" && !Array.isArray(raw.raw) ? raw.raw as Record<string, any> : raw;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (value === null || value === undefined || value === false) continue;
    if (Array.isArray(value)) {
      const nested: string = firstText(...value);
      if (nested) return nested;
      continue;
    }
    if (typeof value === "object") {
      const item = value as Record<string, any>;
      const nested: string = firstText(item.text, item.label, item.name, item.title, item.value, item.displayName);
      if (nested) return nested;
      continue;
    }
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function compactMetricValue(value: unknown) {
  const text = firstText(value);
  if (!text) return "";
  if (/[wW万+]/.test(text)) return text.replace(/[wW]/g, "万");
  const number = Number(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(number) || number <= 0) return text;
  if (number >= 10000) {
    const compact = (number / 10000).toFixed(number >= 100000 ? 0 : 1).replace(/\.0$/, "");
    return `${compact}万+`;
  }
  return `${Math.floor(number)}+`;
}

function metricWithLabel(label: string, value: unknown) {
  const text = compactMetricValue(value);
  if (!text) return "";
  return /[销量成交起批揽收发货理由复购]/.test(text) ? text : `${label}${text}`;
}

function normalizePercentText(value: unknown) {
  const text = firstText(value);
  if (!text) return "";
  if (text.includes("%")) return text;
  const number = Number(text);
  if (!Number.isFinite(number) || number <= 0) return text;
  const percent = number <= 1 ? number * 100 : number;
  return `${percent.toFixed(percent >= 10 ? 0 : 1).replace(/\.0$/, "")}%`;
}

function candidateSalesText(candidate: SourcingCandidateRow) {
  const raw = candidateRawPayload(candidate);
  const tradeQuantity = raw.tradeQuantity || {};
  const labels = collectCandidateLabels(raw);
  const annualSales = firstText(
    tradeQuantity.sales360Fuzzify,
    tradeQuantity.saleQuantity,
    tradeQuantity.bookedCount,
    raw.sales360Fuzzify,
    raw.saleQuantity,
    raw.salesVolume,
    raw.soldOut,
    raw.sales,
    raw.soldCount,
  );
  const recentSales = firstText(
    tradeQuantity.payOrderCount30d,
    tradeQuantity.payItemCount30d,
    tradeQuantity.vaSales90,
    raw.payOrderCount30d,
    raw.payItemCount30d,
    raw.vaSales90,
    raw.fxOrderCount30d,
  );
  return firstText(
    metricWithLabel("年销量", annualSales),
    metricWithLabel("30天成交", recentSales),
    labels.find((label) => /销量|成交/.test(label)),
    candidateMetric(candidate),
  );
}

function candidateServiceTexts(candidate: SourcingCandidateRow) {
  const raw = candidateRawPayload(candidate);
  const information = raw.information || {};
  const tradeService = raw.tradeService || {};
  const labels = collectCandidateLabels(raw);
  const deliveryRate = normalizePercentText(firstText(
    tradeService.deliveryRate48h,
    tradeService.delivery48hRate,
    tradeService.deliveryHours48Rate,
    tradeService.deliveryRate,
    raw.deliveryRate48h,
    raw.delivery48hRate,
    raw.deliveryHours48Rate,
  ));
  const deliveryHours = Number(firstText(tradeService.deliveryHours, raw.deliveryHours, information.deliveryHours));
  const pickupText = deliveryRate
    ? `48h揽收${deliveryRate}`
    : (labels.find((label) => /48h|24h|揽收|发货/.test(label))
      || (Number.isFinite(deliveryHours) && deliveryHours > 0 && deliveryHours <= 48 ? "48h发货" : ""));
  const returnText = labels.find((label) => /7天|七天|无理由|退货/.test(label))
    || (firstText(
      tradeService.sevenDaysReturn,
      tradeService.sevenDaysRefund,
      tradeService.supportSevenDaysReturn,
      tradeService.support7DaysRefund,
      raw.sevenDaysReturn,
    ) ? "7天无理由" : "");
  const repurchaseText = normalizePercentText(information.rePurchaseRate || raw.rePurchaseRate)
    ? `复购${normalizePercentText(information.rePurchaseRate || raw.rePurchaseRate)}`
    : "";
  return [pickupText, returnText, repurchaseText].filter(Boolean).slice(0, 3);
}

function candidateLocationText(candidate: SourcingCandidateRow) {
  const raw = candidateRawPayload(candidate);
  const company = raw.company || {};
  const information = raw.information || {};
  const province = firstText(company.province, information.sendProvince, raw.province, raw.sendProvince);
  const city = firstText(company.city, information.sendCity, raw.city, raw.sendCity);
  return [province, city].filter(Boolean).join(" ");
}

function collectCandidateLabels(raw: Record<string, any>) {
  const values: unknown[] = [
    raw.position_labels,
    raw.positionLabels,
    raw.tags,
    raw.labels,
    raw.offerTags,
    raw.featureTags,
    raw.features?.tags,
    raw.features?.featureTags,
    raw.commonPositionLabels?.beforeTitle,
    raw.commonPositionLabels?.offerMiddle,
    raw.commonPositionLabels?.afterTitle,
  ];
  const labels: string[] = [];
  const pushLabel = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(pushLabel);
      return;
    }
    const text = firstText(value);
    if (!text || text.length > 12 || /^\d+$/.test(text)) return;
    if (!labels.includes(text)) labels.push(text);
  };
  values.forEach(pushLabel);
  return labels;
}

function candidateSupplierLabelValues(candidate: SourcingCandidateRow) {
  const raw = candidateRawPayload(candidate);
  const company = raw.company || {};
  const shop = raw.shop || {};
  const values = [
    candidate.supplierName,
    raw.supplierName,
    raw.shopName,
    raw.shop_name,
    raw.storeName,
    raw.sellerName,
    raw.sellerLoginId,
    raw.companyName,
    company.name,
    company.shopName,
    company.companyName,
    company.sellerName,
    shop.name,
    shop.shopName,
  ];
  return values
    .map((value) => firstText(value).replace(/\s+/g, ""))
    .filter(Boolean);
}

function candidateBadgeTexts(candidate: SourcingCandidateRow) {
  const raw = candidateRawPayload(candidate);
  const supplierLabels = candidateSupplierLabelValues(candidate);
  const labels = collectCandidateLabels(raw).filter((label) => {
    const normalizedLabel = label.replace(/\s+/g, "");
    if (!normalizedLabel) return false;
    if (!/(1688|严选|先采后付|7[xX×*]?24.*响应|深度验厂|实力商家|源头工厂)/.test(normalizedLabel)) return false;
    return !supplierLabels.some((supplierLabel) => (
      supplierLabel === normalizedLabel
      || supplierLabel.includes(normalizedLabel)
      || normalizedLabel.includes(supplierLabel)
    ));
  });
  return labels.slice(0, 2);
}

function candidateInquirySent(candidate: SourcingCandidateRow) {
  return String(candidate.inquiryStatus || "").toLowerCase() === "sent"
    && Boolean(String(candidate.inquiryResult?.taskId || "").trim());
}

function candidateInquiryStatusInfo(candidate: SourcingCandidateRow) {
  const status = String(candidate.inquiryStatus || "").toLowerCase();
  if (status === "replied" || status === "finished") return { label: "已回复", color: "green" };
  if (status === "sent") {
    return String(candidate.inquiryResult?.taskId || "").trim()
      ? { label: "已询盘", color: "blue" }
      : null;
  }
  if (status === "sending" || status === "pending") return { label: "询盘中", color: "processing" };
  if (status === "failed" || status === "error") return { label: "询盘失败", color: "red" };
  if (status) return { label: status, color: "default" };
  return null;
}

function candidateInquiryFailureReason(candidate: SourcingCandidateRow) {
  const result = candidate.inquiryResult || {};
  const reason = firstText(
    result.failureReason,
    result.failReason,
    result.errorMessage,
    result.error,
    result.message,
    result.reason,
  );
  if (reason) return reason;
  const status = String(candidate.inquiryStatus || "").toLowerCase();
  return status === "failed" || status === "error" ? "未记录失败原因" : "-";
}

function candidateInquiryExecutedAt(candidate: SourcingCandidateRow) {
  const result = candidate.inquiryResult || {};
  return candidate.inquirySentAt || firstText(result.recordedAt, result.sentAt, result.executedAt, result.createdAt);
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

function normalizeRefundReasonOptions(rows: any[] = []): RefundReasonOption[] {
  const seen = new Set<string>();
  const options: RefundReasonOption[] = [];
  for (const row of rows) {
    const label = String(row?.label || row?.reason || row?.value || row?.name || row?.refundReason || "").trim();
    const refundReasonId = String(row?.refundReasonId || row?.reasonId || row?.id || "").trim();
    const value = label || refundReasonId;
    if (!value) continue;
    const key = `${refundReasonId}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ label: value, value, refundReasonId: refundReasonId || null });
  }
  return options;
}

function optionalFiniteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanRemoteErrorMessage(error: any) {
  return String(error?.message || error || "")
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
}

function is1688AclDeniedError(error: any, message: string) {
  if (error?.code === "1688_APP_ACL_DENIED") return true;
  return /AppKey is not allowed\(acl\)|not allowed\(acl\)|当前 1688 AppKey 没有接口权限/i.test(message);
}

// 1688 业务错误码 → 用户友好中文。匹配 `errorCode:XXX` 子串即翻译。
// 注：code 字段最终走的是 `msg.includes(code)` 子串匹配，所以也可以塞中文片段
// 用来兜 1688 那种不带 errorCode、只回一句中文的业务错误。
const ALIBABA_1688_BUSINESS_ERROR_HINTS: Array<{ code: string; hint: string }> = [
  { code: "AddressId invalid", hint: "1688 收货地址 ID 无效，请到「询盘设置」点「同步 1688 地址」后重新选择地址再推单。" },
  { code: "ADDRESS_ID_INVALID", hint: "1688 收货地址 ID 无效，请到「询盘设置」点「同步 1688 地址」后重新选择地址再推单。" },
  { code: "ADDRESS_INACTIVE", hint: "该 1688 收货地址已失效（远端可能已被删除），请到「询盘设置」点「同步 1688 地址」后重新选择再推单。" },
  { code: "ADDRESS_REMOTE_ID_MISSING", hint: "该收货地址还没有 1688 远端 ID，请到「询盘设置」点「同步 1688 地址」拉一份完整数据后重新选择再推单。" },
  { code: "does not belong to this store", hint: "选的 1688 收货地址不属于当前店铺/采购账号。请重新选地址（picker 会按当前 1688 采购账号过滤），或到「询盘设置」用对应 1688 账号同步一次地址。" },
  { code: "ORDER_NOT_EXIST", hint: "1688 找不到这个订单号；可能已被卖家取消、超时关闭或绑错了账号。建议先在 1688 后台确认订单状态，或在采购单上点「取消1688」后重新推送。" },
  { code: "ORDER_NOT_PAY", hint: "1688 订单不在「待支付」状态；可能已付款或已关闭。" },
  { code: "ORDER_HAS_PAID", hint: "1688 订单已经付款过了。在系统上点「确认付款」推进本地状态。" },
  { code: "ORDER_HAS_CANCELED", hint: "1688 订单已被取消。在采购单上点「取消1688」同步本地，再重新推送。" },
  { code: "ORDER_NOT_FOUND", hint: "1688 找不到这个订单。检查 OAuth 账号是否跟下单账号一致。" },
  { code: "PAY_NOT_OPEN", hint: "1688 代扣协议未开通，无法用免密支付；请到 1688 后台签约后重试。" },
  { code: "INVALID_ACCESS_TOKEN", hint: "1688 OAuth 已过期，请到「设置」重新授权。" },
  { code: "ACCESS_TOKEN_EXPIRED", hint: "1688 OAuth 已过期，请到「设置」重新授权。" },
  { code: "ISP_BACK_SERVICE_TIMEOUT", hint: "1688 服务超时，稍后重试。" },
  { code: "SYSTEM_ERROR", hint: "1688 系统错误，稍后重试；多次出现请检查 OAuth 凭据或换网络环境。" },
  // 1688 没有给 errorCode、只回了中文「没有权限取消该订单」这种业务拒绝：通常是当前 OAuth 授权的
  // 1688 账号 ≠ 该订单下单账号，或订单状态已不可取消（已付款/已发货/已完结/卖家已确认）。
  { code: "没有权限取消", hint: "1688 拒绝取消该订单：通常是当前授权的 1688 账号跟订单下单账号不一致，或订单当前状态已不可取消（已付款/已发货/已完结）。请到 1688 后台核对订单归属和状态，或在「设置」检查 OAuth 是否换过账号。" },
];

function translate1688BusinessError(rawMessage: string): string | null {
  const msg = rawMessage || "";
  for (const { code, hint } of ALIBABA_1688_BUSINESS_ERROR_HINTS) {
    if (msg.includes(`errorCode:${code}`) || msg.includes(`"errorCode":"${code}"`) || msg.includes(code)) {
      return hint;
    }
  }
  return null;
}

function purchaseActionErrorMessage(error: any, action?: string) {
  const message = cleanRemoteErrorMessage(error);
  if (action === "generate_po" && /Transition denied: purchase_request .* via generate_po/i.test(message)) {
    return "采购单已生成，请刷新后在采购单列表查看";
  }
  if (is1688AclDeniedError(error, message)) {
    if (action === "refresh_1688_product_detail") {
      return message || "1688 官方商品详情接口没有权限，已无法从官方接口同步规格；请确认遨虾 productDetailQuery 密钥配置后重试。";
    }
    if (action === "preview_1688_order" || action === "push_1688_order") {
      return "当前 1688 AppKey 没有下单接口权限，暂时不能推送 1688；请在 1688 开放平台开通对应交易接口权限。";
    }
    return "当前 1688 AppKey 没有这个接口权限，请在 1688 开放平台开通对应 ACL 后重试。";
  }
  const businessHint = translate1688BusinessError(message);
  if (businessHint) return businessHint;
  if (message.includes("Client network socket disconnected before secure TLS connection was established")) {
    return "1688 网络连接中断，TLS 握手未完成，请稍后重试";
  }
  if (/1688 API request failed with HTTP 200/i.test(message)) {
    if (action === "get_1688_payment_url") {
      return "1688 没有返回付款链接，订单可能已取消、已付款或当前账号无权限";
    }
    if (action === "query_1688_pay_ways" || action === "query_1688_protocol_pay_status" || action === "prepare_1688_protocol_pay") {
      return "当前 1688 订单状态不支持付款操作，请先确认订单是否已取消或已付款";
    }
    if (action === "confirm_1688_receive_goods") {
      return "当前 1688 订单状态不支持确认收货：通常需要订单已付款 → 卖家发货 → 物流妥投后才能确认收货。";
    }
    if (action === "create_1688_refund") {
      return "当前 1688 订单状态不支持退款：通常需要订单至少处于已付款 / 已发货状态。";
    }
    return "1688 返回业务失败，系统已保留当前数据，请稍后重试";
  }
  return message || "操作失败";
}

function canUse1688PaymentActions(row: PurchaseOrderRow) {
  if (!row.externalOrderId) return false;
  const localStatus = String(row.status || "").toLowerCase();
  const paymentStatus = String(row.paymentStatus || "").toLowerCase();
  const externalStatus = String(row.externalOrderStatus || "").toLowerCase();
  // 审核通过(进入 approved_to_pay 待付款)之后才能点 1688 支付,避免审核中状态就放出付款入口。
  if (localStatus !== "approved_to_pay") return false;
  if (["paid", "confirmed", "success"].includes(paymentStatus)) return false;
  if (externalOrderIndicatesPaid(row.externalOrderStatus)) return false;
  if (/cancel|close|terminat|success/.test(externalStatus)) return false;
  return true;
}

function externalOrderIndicatesPaid(status?: string | null) {
  const text = String(status || "").toUpperCase();
  return /WAIT_?SELLER_?SEND|WAIT_?BUYER_?RECEIVE|PAID|PAYED|SUCCESS|SELLER_?SEND|SHIPPED/.test(text);
}

function externalPaymentNeedsFinanceConfirm(row: PurchaseOrderRow) {
  return Boolean(row.externalOrderId)
    && externalOrderIndicatesPaid(row.externalOrderStatus)
    && !purchaseOrderIsPaid(row);
}

const REFUND_READY_LOCAL_STATUSES = new Set(["paid", "shipped", "arrived", "received", "success", "completed"]);
const REFUND_READY_PAYMENT_STATUSES = new Set(["paid", "confirmed", "success"]);

function canUse1688RefundActions(row: PurchaseOrderRow) {
  if (!row.externalOrderId) return false;
  const localStatus = String(row.status || "").toLowerCase();
  const paymentStatus = String(row.paymentStatus || "").toLowerCase();
  const externalStatus = String(row.externalOrderStatus || "");
  const externalUpper = externalStatus.toUpperCase();
  if (["cancelled", "canceled", "closed"].includes(localStatus)) return false;
  if (/CANCEL|CLOSE|TERMINAT/.test(externalUpper)) return false;
  if (REFUND_READY_PAYMENT_STATUSES.has(paymentStatus)) return true;
  if (REFUND_READY_LOCAL_STATUSES.has(localStatus)) return true;
  if (/WAIT_BUYER_PAY|WAITSELLERPUSH|WAIT_SELLER_PUSH|UNPAID|CREATED|PREVIEW/.test(externalUpper)) return false;
  return /WAIT_SELLER_SEND|WAIT_BUYER_RECEIVE|SELLER_SEND|SENDGOODS|SHIPPED|RECEIVE|RECEIVED|SUCCESS|PAID|PAYED/.test(externalUpper);
}

function getCached1688PaymentUrl(row: PurchaseOrderRow) {
  const value = typeof row.externalPaymentUrl === "string" ? row.externalPaymentUrl.trim() : "";
  if (!value) return null;
  const syncedAt = row.externalPaymentUrlSyncedAt ? Date.parse(row.externalPaymentUrlSyncedAt) : NaN;
  if (Number.isFinite(syncedAt) && Date.now() - syncedAt > PAYMENT_URL_CACHE_MAX_AGE_MS) return null;
  return value;
}

function get1688PaymentResultPayload(result: any) {
  return result?.result && typeof result.result === "object" ? result.result : result;
}

function get1688PaymentUrlFromResult(result: any) {
  const payload = get1688PaymentResultPayload(result);
  const value = typeof payload?.paymentUrl === "string" ? payload.paymentUrl.trim() : "";
  return value || null;
}

function get1688PaymentUrlSourceFromResult(result: any) {
  const payload = get1688PaymentResultPayload(result);
  return typeof payload?.paymentUrlSource === "string" ? payload.paymentUrlSource : "";
}

function get1688PaymentUrlsFromResult(result: any): Array<{ orderId: string; paymentUrl: string }> {
  const payload = get1688PaymentResultPayload(result);
  if (!Array.isArray(payload?.paymentUrls)) return [];
  return payload.paymentUrls
    .map((item: any) => ({
      orderId: String(item?.orderId || "").trim(),
      paymentUrl: String(item?.paymentUrl || "").trim(),
    }))
    .filter((item: any) => item.orderId && item.paymentUrl);
}

function get1688PayableOrderIdsFromResult(result: any): string[] {
  const payload = get1688PaymentResultPayload(result);
  if (!Array.isArray(payload?.payableOrderIds)) return [];
  return payload.payableOrderIds.map((item: any) => String(item || "").trim()).filter(Boolean);
}

function get1688PaymentFailuresFromResult(result: any): Array<{ orderId: string; error: string }> {
  const payload = get1688PaymentResultPayload(result);
  if (!Array.isArray(payload?.partialPaymentFailures)) return [];
  return payload.partialPaymentFailures
    .map((item: any) => ({
      orderId: String(item?.orderId || "").trim(),
      error: String(item?.error || "不可付款").trim(),
    }))
    .filter((item: any) => item.orderId);
}

async function openExternalUrl(url: string) {
  const externalOpener = (window as any)?.electronAPI?.app?.openExternal;
  if (typeof externalOpener === "function") {
    try {
      await externalOpener(url);
      return;
    } catch {
      // Fall through to the browser fallback below.
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function canSubmitPaymentApprovalAction(row: PurchaseOrderRow) {
  const localStatus = String(row.status || "").toLowerCase();
  const paymentStatus = String(row.paymentStatus || "").toLowerCase();
  if (["paid", "confirmed", "success"].includes(paymentStatus)) return false;
  return localStatus === "draft" || localStatus === "pushed_pending_price";
}

function canConfirmPaidAction(row: PurchaseOrderRow) {
  const localStatus = String(row.status || "").toLowerCase();
  const paymentStatus = String(row.paymentStatus || "").toLowerCase();
  if (["paid", "confirmed", "success"].includes(paymentStatus)) return false;
  return localStatus === "approved_to_pay";
}

function purchaseOrderRiskTags(row: PurchaseOrderRow, hasUsable1688Address: boolean) {
  const tags: Array<{ key: string; label: string; color: string }> = [];
  const mappingCount = Number(row.mappingCount || 0);
  const deliveryAddressCount = Number(row.deliveryAddressCount || 0);
  // mappingCount=0 is a normal offline purchase order path. Only warn when a
  // 1688-capable order has mappings but no usable delivery address.
  if (!row.externalOrderId && mappingCount > 0 && deliveryAddressCount === 0 && !hasUsable1688Address) {
    tags.push({ key: "address", label: "缺1688地址", color: "orange" });
  }
  if (canSubmitPaymentApprovalAction(row)) {
    tags.push({ key: "submit-pay", label: "待提交付款", color: "blue" });
  } else if (canUse1688PaymentActions(row) || canConfirmPaidAction(row)) {
    tags.push({ key: "pay", label: "待付款确认", color: "gold" });
  }
  if (externalPaymentNeedsFinanceConfirm(row)) {
    tags.push({ key: "external-paid", label: "1688已付待财务", color: "gold" });
  }
  if (purchaseOrderIsPaid(row) && !isCompletedOrder(row)) {
    tags.push({ key: "inbound", label: "待入库", color: "cyan" });
  }
  if (row.status === "delayed" || row.status === "exception") {
    tags.push({ key: "exception", label: "履约异常", color: "red" });
  }
  if (Number(row.refundCount || 0) > 0 || row.latestRefundStatus) {
    tags.push({ key: "refund", label: "售后跟进", color: "purple" });
  }
  return tags;
}

function purchaseOrderRowClassName(row: PurchaseOrderRow) {
  const classes: string[] = ["purchase-order-row--clickable"];
  if (row.status === "delayed" || row.status === "exception") classes.push("purchase-order-row--exception");
  if (canUse1688PaymentActions(row) || canConfirmPaidAction(row) || externalPaymentNeedsFinanceConfirm(row)) classes.push("purchase-order-row--payment");
  if (isCompletedOrder(row)) classes.push("purchase-order-row--completed");
  return classes.join(" ");
}

function shouldIgnorePurchaseOrderRowClick(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest([
    "a",
    "button",
    "input",
    "textarea",
    "select",
    "[role='button']",
    "[role='checkbox']",
    ".ant-checkbox",
    ".ant-checkbox-wrapper",
    ".ant-dropdown",
    ".ant-picker",
    ".ant-popover",
    ".ant-select",
    ".ant-table-cell-fix-right",
    ".ant-table-column-sorter",
    ".ant-table-filter-trigger",
    ".ant-table-selection-column",
    ".purchase-action-grid",
    ".purchase-order-column-menu",
    ".purchase-order-number-link",
  ].join(",")));
}

function candidateSpecRows(candidate?: SourcingCandidateRow | null): BindingSpecRow[] {
  const options = Array.isArray(candidate?.externalSkuOptions) ? candidate.externalSkuOptions : [];
  return options
    .filter((item) => item.externalSpecId)
    .map((item, index) => ({
      ...item,
      externalSpecId: String(item.externalSpecId),
      key: `${item.externalSpecId || ""}:${item.externalSkuId || ""}:${index}`,
    }));
}

function specRowSearchText(row: ExternalSkuOptionRow) {
  return [
    row.specText,
    row.externalSkuId,
    row.externalSpecId,
  ].map((value) => String(value ?? "")).join(" ");
}

function specRowImageUrl(row?: ExternalSkuOptionRow | null, candidate?: SourcingCandidateRow | null) {
  const raw = row && (row as any).raw && typeof (row as any).raw === "object" ? (row as any).raw : {};
  return imageValue([
    row?.imageUrl,
    raw.imageUrl,
    raw.imgUrl,
    raw.picUrl,
    raw.pictureUrl,
    raw.thumbUrl,
    raw.skuImageUrl,
    raw.skuImage,
    raw.image,
    raw.images,
    raw.imageUrls,
    candidate ? candidateImage(candidate) : "",
  ]);
}

type PurchaseQueueKey =
  | "all"
  | "request_pending_sourcing"
  | "request_sourced"
  | "request_pending_optimization"
  | "request_optimized"
  | "po_draft"
  | "po_pending_payment"
  | "po_paid"
  | "po_completed"
  | "po_cancelled"
  | "po_exception";

type PurchaseWorkArea = "sourcing" | "orders";
type RequestCreateMode = "sourcing" | "optimization";

interface PurchaseQueueItem {
  key: PurchaseQueueKey;
  title: string;
  count: number;
  kind: "request" | "order" | "mixed";
}

const ACTIVE_REQUEST_STATUSES = new Set(["submitted", "buyer_processing", "sourced", "waiting_ops_confirm"]);
const COMPLETED_PO_STATUSES = new Set(["inbounded", "closed"]);
const PURCHASE_ORDER_PAYMENT_FILTER_OPTIONS = [
  { label: "付款：全部", value: "" },
  { label: "未付款", value: "unpaid" },
  { label: "待付款确认", value: "pending" },
  { label: "已付款", value: "paid" },
];
const PURCHASE_ORDER_SOURCE_FILTER_OPTIONS = [
  { label: "来源：全部", value: "" },
  { label: "1688 已绑定", value: "1688_bound" },
  { label: "待推 1688", value: "1688_pushable" },
  { label: "线下采购", value: "offline" },
  { label: "未绑定", value: "unbound" },
];
const PURCHASE_ORDER_RISK_FILTER_OPTIONS = [
  { label: "风险：全部", value: "" },
  { label: "缺 1688 地址", value: "missing_address" },
  { label: "待付款确认", value: "pending_payment" },
  { label: "待入库", value: "pending_inbound" },
  { label: "售后跟进", value: "refund" },
  { label: "履约异常", value: "exception" },
];
const PURCHASE_ORDER_COLUMN_MENU_WIDTH = 280;
const PURCHASE_ORDER_COLUMN_MENU_EDGE_GAP = 12;
const PURCHASE_ORDER_COLUMN_MENU_OFFSET = 8;
const PURCHASE_ORDER_COLUMN_MENU_CHROME_HEIGHT = 96;
const PURCHASE_ORDER_COLUMN_MENU_MIN_BODY_HEIGHT = 180;
const PURCHASE_ORDER_COLUMN_MENU_MAX_BODY_HEIGHT = 430;
const PURCHASE_WORKFLOW_STEP_ITEMS = [
  { title: "找品", description: "提交需求并找货源" },
  { title: "已找品", description: "采购确认完成找品" },
  { title: "创建采购单", description: "线上 1688 或线下采购" },
  { title: "采购单", description: "确认供应商和金额" },
  { title: "付款", description: "提交付款并支付" },
  { title: "入库", description: "发货到货后入库" },
];
const PURCHASE_ORDER_COLUMN_ORDER_STORAGE_KEY = "temu.purchase.order.columnOrder.v1";
const PURCHASE_ORDER_CONFIGURABLE_COLUMN_KEYS = [
  "createdAt",
  "po",
  "status",
  "paymentStatus",
  "riskTags",
  "paidAt",
  "createdByName",
  "accountName",
  "supplierName",
  "skuImage",
  "skuCodes",
  "productNames",
  "totalQty",
  "totalAmount",
  "freightAmount",
  "paidAmount",
  "externalOrderId",
  "externalOrderStatus",
  "logistics",
  "refundStatus",
  "receivedQty",
  "expectedDeliveryDate",
];
const PURCHASE_ORDER_CONFIGURABLE_COLUMN_KEY_SET = new Set(PURCHASE_ORDER_CONFIGURABLE_COLUMN_KEYS);
const PURCHASE_ORDER_COLUMN_LABELS: Record<string, string> = {
  createdAt: "采购日期",
  po: "采购单号",
  status: "状态",
  paymentStatus: "付款",
  riskTags: "ERP校验",
  paidAt: "付款时间",
  createdByName: "采购员",
  accountName: "店铺",
  supplierName: "供应商",
  skuImage: "商品图片",
  skuCodes: "商品编码",
  productNames: "商品名称",
  totalQty: "数量",
  totalAmount: "商品金额",
  freightAmount: "运费",
  paidAmount: "实付总金额",
  externalOrderId: "1688单号",
  externalOrderStatus: "线上状态",
  logistics: "物流",
  refundStatus: "售后",
  receivedQty: "入库数",
  expectedDeliveryDate: "预计到货",
};

interface PurchaseOrderColumnConfig {
  order: string[];
  visible: string[];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function purchaseOrderColumnMenuPosition(clientX: number, clientY: number) {
  const maxLeft = Math.max(
    PURCHASE_ORDER_COLUMN_MENU_EDGE_GAP,
    window.innerWidth - PURCHASE_ORDER_COLUMN_MENU_WIDTH - PURCHASE_ORDER_COLUMN_MENU_EDGE_GAP,
  );
  const maxTop = Math.max(
    PURCHASE_ORDER_COLUMN_MENU_EDGE_GAP,
    window.innerHeight
      - PURCHASE_ORDER_COLUMN_MENU_CHROME_HEIGHT
      - PURCHASE_ORDER_COLUMN_MENU_MIN_BODY_HEIGHT
      - PURCHASE_ORDER_COLUMN_MENU_EDGE_GAP,
  );
  const x = clampNumber(
    clientX + PURCHASE_ORDER_COLUMN_MENU_OFFSET,
    PURCHASE_ORDER_COLUMN_MENU_EDGE_GAP,
    maxLeft,
  );
  const y = clampNumber(
    clientY + PURCHASE_ORDER_COLUMN_MENU_OFFSET,
    PURCHASE_ORDER_COLUMN_MENU_EDGE_GAP,
    maxTop,
  );
  const availableBodyHeight = window.innerHeight
    - y
    - PURCHASE_ORDER_COLUMN_MENU_CHROME_HEIGHT
    - PURCHASE_ORDER_COLUMN_MENU_EDGE_GAP;
  return {
    x,
    y,
    bodyMaxHeight: clampNumber(
      availableBodyHeight,
      PURCHASE_ORDER_COLUMN_MENU_MIN_BODY_HEIGHT,
      PURCHASE_ORDER_COLUMN_MENU_MAX_BODY_HEIGHT,
    ),
  };
}

function normalizePurchaseOrderColumnOrder(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const ordered = source
    .map((item) => String(item || ""))
    .filter((key) => {
      if (!PURCHASE_ORDER_CONFIGURABLE_COLUMN_KEY_SET.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return [
    ...ordered,
    ...PURCHASE_ORDER_CONFIGURABLE_COLUMN_KEYS.filter((key) => !seen.has(key)),
  ];
}

function defaultPurchaseOrderColumnConfig(): PurchaseOrderColumnConfig {
  return {
    order: [...PURCHASE_ORDER_CONFIGURABLE_COLUMN_KEYS],
    visible: [...PURCHASE_ORDER_CONFIGURABLE_COLUMN_KEYS],
  };
}

function normalizePurchaseOrderColumnConfig(value: unknown): PurchaseOrderColumnConfig {
  const raw = value && typeof value === "object" ? value as { order?: unknown; visible?: unknown } : null;
  const order = normalizePurchaseOrderColumnOrder(raw?.order || value);
  const visibleSource = Array.isArray(raw?.visible) ? raw.visible : order;
  const visible = Array.from(new Set(visibleSource.map((item) => String(item || "")).filter((key) => (
    PURCHASE_ORDER_CONFIGURABLE_COLUMN_KEY_SET.has(key)
  ))));
  return {
    order,
    visible: visible.length ? visible : ["po"],
  };
}

function readPurchaseOrderColumnConfig() {
  if (typeof window === "undefined") return defaultPurchaseOrderColumnConfig();
  try {
    return normalizePurchaseOrderColumnConfig(JSON.parse(window.localStorage.getItem(PURCHASE_ORDER_COLUMN_ORDER_STORAGE_KEY) || "[]"));
  } catch {
    return defaultPurchaseOrderColumnConfig();
  }
}

function purchaseOrderQueueForWorkbench(key: PurchaseQueueKey) {
  return key.startsWith("po_") || key === "all" ? key : "all";
}

function isPendingPurchaseRequest(row: PurchaseRequestRow) {
  return ACTIVE_REQUEST_STATUSES.has(row.status);
}

function purchaseRequestMode(row: PurchaseRequestRow): RequestCreateMode {
  const reason = String(row.reason || "").trim();
  return /优化|optim/i.test(reason) ? "optimization" : "sourcing";
}

function isSourcingPurchaseRequest(row: PurchaseRequestRow) {
  return purchaseRequestMode(row) === "sourcing";
}

function isOptimizationPurchaseRequest(row: PurchaseRequestRow) {
  return purchaseRequestMode(row) === "optimization";
}

function isCompletedRequestStage(row: PurchaseRequestRow) {
  return row.status === "sourced" || row.status === "waiting_ops_confirm";
}

// 是否已有任意可用货源：只用于货源信息展示和采购单路径，不再决定找品/优化分组。
function purchaseRequestHasSource(row: PurchaseRequestRow) {
  return Number(row.mappingCount || 0) > 0
    || Boolean(row.candidates?.length || row.candidateCount)
    || Boolean(row.primaryMappingSupplierName || row.primaryMappingOfferId || row.primaryCandidateSupplierName)
    || Boolean(row.skuSupplierId || row.skuSupplierName);
}

function purchaseRequestIsOptimized(row: PurchaseRequestRow) {
  if (!isOptimizationPurchaseRequest(row)) return false;
  if (isCompletedRequestStage(row)) return true;
  if (Number(row.selectedCandidateCount || 0) > 0) return true;

  const targetUnitCost = optionalFiniteNumber(row.targetUnitCost);
  const foundUnitPrice = optionalFiniteNumber(row.buyerUnitCost ?? getPurchaseRequestFoundUnitPrice(row));
  return targetUnitCost !== null
    && targetUnitCost > 0
    && foundUnitPrice !== null
    && foundUnitPrice <= targetUnitCost;
}

function purchaseRequestNeedsOptimization(row: PurchaseRequestRow) {
  return isPendingPurchaseRequest(row)
    && isOptimizationPurchaseRequest(row)
    && !purchaseRequestIsOptimized(row);
}

function purchaseRequestTaskStage(row: PurchaseRequestRow) {
  if (isOptimizationPurchaseRequest(row)) {
    return purchaseRequestIsOptimized(row)
      ? { label: "已优化", color: "green" }
      : { label: "待优化", color: "gold" };
  }
  return isCompletedRequestStage(row)
    ? { label: "已找品", color: "cyan" }
    : { label: "待找品", color: "orange" };
}

// PR 早期阶段（还没流转到 sourced）：运营刚提交 / 采购处理中。
function isEarlyStagePurchaseRequest(row: PurchaseRequestRow) {
  return row.status === "submitted" || row.status === "buyer_processing";
}

function isFullyReceived(row: PurchaseOrderRow) {
  const totalQty = Number(row.totalQty || 0);
  if (totalQty <= 0) return false;
  return Number(row.receivedQty || 0) >= totalQty;
}

function isCompletedOrder(row: PurchaseOrderRow) {
  return COMPLETED_PO_STATUSES.has(row.status) || isFullyReceived(row);
}

function has1688OrderTrace(row?: PurchaseOrderRow | null) {
  if (!row) return false;
  if (row.externalOrderId) return true;
  const status = row.externalOrderStatus || "";
  return Boolean(status && !["previewed", "price_change_requested"].includes(status));
}

function canDeletePurchaseOrder(row?: PurchaseOrderRow | null) {
  if (!row) return false;
  // 三类可删：
  // 1) 草稿且没付款 / 没推 1688（原始安全场景）
  // 2) 已取消（cancelled）—— 单子流程已结束
  // 3) 死单清理（external_order_status=orphan_cleared）—— 1688 远端已不存在
  if (Number(row.receivedQty || 0) > 0) return false;
  if (row.status === "cancelled") return true;
  if (String(row.externalOrderStatus || "") === "orphan_cleared") return true;
  const paymentStatus = String(row.paymentStatus || "unpaid").toLowerCase();
  return row.status === "draft"
    && paymentStatus === "unpaid"
    && !has1688OrderTrace(row);
}

function getPurchaseOrderRollbackTarget(row?: PurchaseOrderRow | null) {
  if (!row) return null;
  switch (row.status) {
    case "pushed_pending_price":
      return has1688OrderTrace(row) ? null : "draft";
    case "pending_finance_approval":
      return has1688OrderTrace(row) ? "pushed_pending_price" : "draft";
    case "approved_to_pay":
      return "pushed_pending_price";
    case "paid":
      return "approved_to_pay";
    case "supplier_processing":
      return "paid";
    case "shipped":
      return "supplier_processing";
    case "arrived":
      return Number(row.receivedQty || 0) > 0 ? null : "shipped";
    default:
      return null;
  }
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

function extractFirstImageUrl(value: unknown) {
  const text = String(value || "").trim();
  const dataUrlMatch = text.match(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/i);
  if (dataUrlMatch) return dataUrlMatch[0];
  return extractFirstHttpUrl(text);
}

function getPurchaseRequestDefaultImageUrl(row?: PurchaseRequestRow | null) {
  if (!row) return "";
  for (const item of row.evidence || []) {
    const url = extractFirstImageUrl(item);
    if (url) return url;
  }
  return row.skuImageUrl || "";
}

function getPurchaseRequestSpecText(row?: PurchaseRequestRow | null) {
  return String(row?.specText || row?.colorSpec || "").trim();
}

function getPurchaseRequestFoundUnitPrice(row?: PurchaseRequestRow | null) {
  return row?.primaryCandidateUnitPrice ?? row?.primaryMappingUnitPrice ?? null;
}

function splitGroupedText(value?: string | null) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getPurchaseOrderSkuCodes(row: PurchaseOrderRow) {
  const explicit = splitGroupedText(row.skuCodes);
  if (explicit.length) return explicit;
  return splitGroupedText(row.skuSummary)
    .map((item) => item.split(/\s+/)[0])
    .filter(Boolean);
}

function getPurchaseOrderProductNames(row: PurchaseOrderRow) {
  const explicit = splitGroupedText(row.productNames);
  if (explicit.length) return explicit;
  return splitGroupedText(row.skuSummary)
    .map((item) => item.replace(/^\S+\s+/, "").trim())
    .filter(Boolean);
}

function joinGroupedText(items: string[]) {
  return items.filter(Boolean).join(" / ");
}

function roundCurrency(value?: number | string | null) {
  const number = optionalFiniteNumber(value);
  if (number === null) return 0;
  return Math.round(number * 100) / 100;
}

function allocateCurrencyByWeight(total: number, weights: number[]) {
  const amount = roundCurrency(total);
  if (!weights.length || amount <= 0) return weights.map(() => 0);
  const normalizedWeights = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const weightSum = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
  const effectiveWeights = weightSum > 0 ? normalizedWeights : weights.map(() => 1);
  const effectiveSum = weightSum > 0 ? weightSum : effectiveWeights.length;
  let allocated = 0;
  return effectiveWeights.map((weight, index) => {
    if (index === effectiveWeights.length - 1) return roundCurrency(amount - allocated);
    const share = roundCurrency((amount * weight) / effectiveSum);
    allocated = roundCurrency(allocated + share);
    return share;
  });
}

function splitPurchaseOrderDetailText(value?: string | null) {
  return String(value || "")
    .split(/\s*(?:\/|,|，|、|;|；)\s*/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePurchaseOrderDetailLine(
  row: PurchaseOrderRow,
  line: PurchaseOrderLineDetail,
  index: number,
): PurchaseOrderLineDetail {
  const qty = toFiniteNumber(line.qty);
  const amount = roundCurrency(
    optionalFiniteNumber(line.amount) ?? (qty > 0 ? qty * toFiniteNumber(line.unitCost) : 0),
  );
  const logisticsFee = roundCurrency(line.logisticsFee);
  const paidAmount = roundCurrency(optionalFiniteNumber(line.paidAmount)
    ?? amount + logisticsFee);
  return {
    ...line,
    id: line.id || `${row.id}-line-${index}`,
    qty,
    logisticsFee,
    amount,
    paidAmount,
  };
}

function allocatePurchaseOrderDetailLineFreight(
  row: PurchaseOrderRow,
  lines: PurchaseOrderLineDetail[],
) {
  if (!lines.length) return lines;
  const lineFreightTotal = roundCurrency(lines.reduce((sum, line) => sum + roundCurrency(line.logisticsFee), 0));
  if (lineFreightTotal > 0) return lines;

  const explicitFreight = optionalFiniteNumber(row.freightAmount);
  const lineAmountTotal = roundCurrency(lines.reduce((sum, line) => sum + roundCurrency(line.amount), 0));
  const paidAmount = optionalFiniteNumber(row.paidAmount);
  const inferredFreight = paidAmount !== null && paidAmount > lineAmountTotal
    ? roundCurrency(paidAmount - lineAmountTotal)
    : 0;
  const freightToAllocate = explicitFreight !== null && explicitFreight > 0
    ? explicitFreight
    : inferredFreight;
  if (!freightToAllocate) return lines;

  const weights = lines.map((line) => roundCurrency(line.amount) || toFiniteNumber(line.qty));
  const allocatedFreight = allocateCurrencyByWeight(freightToAllocate, weights);
  return lines.map((line, index) => {
    const logisticsFee = allocatedFreight[index] ?? 0;
    const amount = roundCurrency(line.amount);
    return {
      ...line,
      logisticsFee,
      paidAmount: roundCurrency(amount + logisticsFee),
    };
  });
}

function purchaseOrderDetailTotals(lines: PurchaseOrderLineDetail[]) {
  return lines.reduce<{ qty: number; amount: number; logisticsFee: number; paidAmount: number }>(
    (totals, line) => ({
      qty: totals.qty + toFiniteNumber(line.qty),
      amount: roundCurrency(totals.amount + roundCurrency(line.amount)),
      logisticsFee: roundCurrency(totals.logisticsFee + roundCurrency(line.logisticsFee)),
      paidAmount: roundCurrency(totals.paidAmount + roundCurrency(line.paidAmount)),
    }),
    { qty: 0, amount: 0, logisticsFee: 0, paidAmount: 0 },
  );
}

function purchaseOrderDetailLines(row: PurchaseOrderRow): PurchaseOrderLineDetail[] {
  const explicitLines = Array.isArray(row.lineItems)
    ? row.lineItems.filter((line) => line && typeof line === "object")
    : [];
  if (explicitLines.length) {
    return allocatePurchaseOrderDetailLineFreight(
      row,
      explicitLines.map((line, index) => normalizePurchaseOrderDetailLine(row, line, index)),
    );
  }

  const codes = getPurchaseOrderSkuCodes(row);
  const names = getPurchaseOrderProductNames(row);
  return [{
    id: `${row.id}-summary`,
    skuCode: joinGroupedText(codes) || row.skuSummary || "-",
    skuCodes: codes,
    productName: joinGroupedText(names) || row.skuSummary || "-",
    specText: "-",
    qty: row.totalQty ?? 0,
    logisticsFee: row.freightAmount ?? null,
    amount: row.totalAmount ?? 0,
    paidAmount: purchaseOrderPayableAmount(row),
  }];
}

function purchaseOrderDetailLineCodes(line: PurchaseOrderLineDetail) {
  if (Array.isArray(line.skuCodes) && line.skuCodes.length) {
    return line.skuCodes.map((code) => String(code || "").trim()).filter(Boolean);
  }
  return splitPurchaseOrderDetailText(line.skuCode);
}

function extractMessageImageUrls(value?: string | null) {
  const text = String(value || "");
  const urls: string[] = [];
  const pushUrl = (url: string) => {
    const normalized = url.trim().replace(/[),.;，。；、]+$/u, "");
    if (normalized && !urls.includes(normalized)) urls.push(normalized);
  };
  for (const line of text.split(/\r?\n/)) {
    const imageLine = line.match(/^\s*图片\s*[：:]\s*(\S+)/);
    if (imageLine) pushUrl(imageLine[1]);
  }
  const dataUrls = text.match(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi) || [];
  dataUrls.forEach(pushUrl);
  return urls.slice(0, MAX_COMMENT_IMAGES);
}

function stripMessageImageLines(value?: string | null) {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*图片\s*[：:]\s*\S+/.test(line))
    .join("\n")
    .trim();
}

function imageSearchEmptyText(result: any) {
  const duplicateSkippedCount = Number(result?.result?.duplicateSkippedCount || 0);
  const totalFound = Number(result?.result?.totalFound || 0);
  if (duplicateSkippedCount > 0 || totalFound > 0) return "本页搜到的商品已存在，未新增重复候选。";
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

function normalizePurchaseSearch(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function buildPurchaseRequestSearchText(row: PurchaseRequestRow) {
  return [
    row.id,
    row.internalSkuCode,
    row.productName,
    row.specText,
    row.colorSpec,
    row.status,
    PR_STATUS_LABELS[row.status],
    row.reason,
    row.requestedByName,
    row.primaryMappingSupplierName,
    row.primaryMappingOfferId,
    row.primaryCandidateSupplierName,
    row.skuSupplierName,
    ...(row.evidence || []),
    ...(row.candidates || []).flatMap((candidate) => [
      candidate.supplierName,
      candidate.productTitle,
      candidate.productUrl,
      candidate.externalOfferId,
      candidate.externalSkuId,
      candidate.externalSpecId,
    ]),
  ].map((item) => String(item ?? "")).join(" ");
}

function purchaseOrderBelongsToRequest(row: PurchaseOrderRow, prId: string) {
  return row.prId === prId || (row as any).pr_id === prId;
}

function filterPurchaseRows<T>(rows: T[], keyword: string, buildSearchText: (row: T) => string) {
  const needle = normalizePurchaseSearch(keyword);
  if (!needle) return rows;
  return rows.filter((row) => normalizePurchaseSearch(buildSearchText(row)).includes(needle));
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

export default function PurchaseCenter({ initialStoreManagerOpen = false, workArea }: PurchaseCenterProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useErpAuth();
  const role = auth.currentUser?.role || "";
  const canCreateRequest = canRole(role, ["operations", "manager", "admin"]);
  const canPurchase = canRole(role, ["buyer", "manager", "admin"]);
  const canCreatePurchaseOrder = canRole(role, PURCHASE_ORDER_CREATE_ROLES);
  const canFinance = canRole(role, ["finance", "manager", "admin"]);
  const canWarehouse = canRole(role, ["warehouse", "manager", "admin"]);
  const initialWorkbench = getInitialPurchaseWorkbenchCache();

  // 不用缓存快照播种可见列表，避免进页面闪一下旧行；缓存仅保留给下拉选项。
  // 用 localStorage 缓存的 workbench 做初始值:含上次同步的 alibaba1688Addresses,
  // 这样推单 Modal 切账号时能立即看到该账号已经同步过的地址,无需再触发自动同步。
  const [data, setData] = useState<PurchaseWorkbench>(() => getInitialPurchaseWorkbenchCache());
  // 初始即 true：挂载首帧就进骨架，避免「空表格/计数 0」闪一帧后才进加载态。
  const [loading, setLoading] = useState(true);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [loadingMorePrId, setLoadingMorePrId] = useState<string | null>(null);
  const [imageSearchNextPageByPrId, setImageSearchNextPageByPrId] = useState<Record<string, number>>({});
  const candidateScrollLockRef = useRef<Record<string, boolean>>({});
  const pendingCandidateScrollRestoreRef = useRef<{ prId: string; scrollTop: number; scrollHeight: number } | null>(null);
  const candidateScrollElRef = useRef<HTMLDivElement | null>(null);
  const auto1688OrderSupplementKeysRef = useRef<Set<string>>(new Set());
  const supplementalWorkbenchPromiseRef = useRef<Promise<void> | null>(null);
  const purchaseWorkbenchAutoLoadRef = useRef(false);
  const [skus, setSkus] = useState<SkuOption[]>(() => (
    Array.isArray(initialWorkbench.skuOptions) ? initialWorkbench.skuOptions : []
  ));
  const [skuSearching, setSkuSearching] = useState(false);
  // 0.3.25 性能：FULL_PURCHASE_WORKBENCH_PARAMS 关 includeOptions 后 skus 初始为空，
  // 不能再用 skus.length === 0 当「数据库没数据」信号；改成「搜过且无结果」才提示新建商品资料。
  const [hasAttemptedSkuSearch, setHasAttemptedSkuSearch] = useState(false);
  const skuSearchTimerRef = useRef<number | null>(null);
  const skuSearchSeqRef = useRef(0);
  const handleSkuSearch = (keyword: string) => {
    const term = String(keyword || "").trim();
    // 空 term 直接返回，不要 clearTimeout 掉正在 pending 的上一次搜索。
    // mode="tags" 下用户输入编码后回车，antd 会清空搜索框触发 onSearch("")，
    // 若在这里 clearTimeout 会把刚排的后端搜索取消，skus 永远拿不到这条，
    // 提交时本地 find 落空误报「未找到」。
    if (!term) return;
    if (skuSearchTimerRef.current) window.clearTimeout(skuSearchTimerRef.current);
    const seq = ++skuSearchSeqRef.current;
    skuSearchTimerRef.current = window.setTimeout(async () => {
      setSkuSearching(true);
      setHasAttemptedSkuSearch(true);
      try {
        // 0.3.25 bug fix：erp_skus 表里 22560/22614 条都是 jst:skuprofile: 前缀（聚水潭导入是主力）。
        // 旧版加 excludeJst:true 等于屏蔽 99% SKU，搜不到任何聚水潭来源商品。下面 1520-1538 行
        // 的客户端 dedup 已经处理同 code 双胞胎（优先 ERP 原生），不需要服务端再排除。
        const list = await erp?.sku?.list?.({ search: term, limit: 50 } as any);
        if (seq !== skuSearchSeqRef.current) return;
        // 同一个 internal_sku_code 有时会同时存在两条：纯数字 id 的 ERP 原生 + jst:skuprofile: 前缀的聚水潭副本。
        // 搜索框只想露一条，按 internal_sku_code 去重，纯数字那条优先（不带 jst:skuprofile: 前缀的更原生）。
        const rawRows: SkuOption[] = Array.isArray(list) ? list : [];
        const rows: SkuOption[] = (() => {
          const byCode = new Map<string, SkuOption>();
          for (const row of rawRows) {
            const code = String(row?.internalSkuCode || row?.id || "");
            if (!code) continue;
            const existing = byCode.get(code);
            if (!existing) {
              byCode.set(code, row);
              continue;
            }
            // 已有同 code 的记录：只在「现有是 jst:skuprofile: 副本、当前是纯数字」时替换
            const existingIsJst = String(existing.id || "").startsWith("jst:skuprofile:");
            const currentIsJst = String(row.id || "").startsWith("jst:skuprofile:");
            if (existingIsJst && !currentIsJst) byCode.set(code, row);
          }
          return Array.from(byCode.values());
        })();
        // 替换式：只显示当前搜索结果 + 已选中的项（防 Select tag 变 raw ID）
        // 不再累积历史搜索结果，避免不相关 SKU 一直挂在下拉里
        setSkus((prev) => {
          const selectedIds: string[] = requestForm.getFieldValue("skuIds") || [];
          const map = new Map<string, SkuOption>();
          for (const row of rows) map.set(row.id, row);
          for (const sku of prev) {
            // form value 现在用 internal_sku_code（见下方 skuOptions），按 id 或 code 任一命中都算已选中
            const isSelected = selectedIds.includes(sku.id)
              || (sku.internalSkuCode != null && selectedIds.includes(sku.internalSkuCode));
            if (isSelected && !map.has(sku.id)) map.set(sku.id, sku);
          }
          return Array.from(map.values());
        });
      } catch {
        /* 忽略搜索失败,沿用已加载选项 */
      } finally {
        if (seq === skuSearchSeqRef.current) setSkuSearching(false);
      }
      // PR2 后 client 模式 erp.sku.list 走本地 cache.db 搜索（毫秒级），debounce 从
      // 跨海时代的 300ms 降到 120ms，搜索更跟手；仍留少量防抖避免每字符一次查询。
    }, 120);
  };
  const [suppliers, setSuppliers] = useState<SupplierOption[]>(() => (
    Array.isArray(initialWorkbench.supplierOptions) ? initialWorkbench.supplierOptions : []
  ));
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const sortedAccounts = useMemo(() => sortStoreAccounts(accounts), [accounts]);
  // 1688 采购账号列表（推单 Modal 用）。loadData 时随店铺列表一起 fire-and-forget 预拉，
  // 让用户点「推送1688下单」时直接 0 RTT 弹 Modal。state 空时各调用处会回退到现拉。
  const [purchase1688Accounts, setPurchase1688Accounts] = useState<Purchase1688Account[]>([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestCreateMode, setRequestCreateMode] = useState<RequestCreateMode>("sourcing");
  const [directPoOpen, setDirectPoOpen] = useState(false);
  const [quotePrId, setQuotePrId] = useState<string | null>(null);
  const [buyerFeedbackPrId, setBuyerFeedbackPrId] = useState<string | null>(null);
  const [offlinePoTarget, setOfflinePoTarget] = useState<
    | { mode: "create"; pr: PurchaseRequestRow }
    | { mode: "edit"; po: PurchaseOrderRow }
    | { mode: "convert"; po: PurchaseOrderRow }
    | null
  >(null);
  const [source1688PrId, setSource1688PrId] = useState<string | null>(null);
  const [requestUploadImages, setRequestUploadImages] = useState<RequestUploadImage[]>([]);
  const [requestImagePreview, setRequestImagePreview] = useState<{ src: string; alt: string } | null>(null);
  const [detailPrId, setDetailPrId] = useState<string | null>(null);
  const [detailDrawerMode, setDetailDrawerMode] = useState<PurchaseRequestDrawerMode>("collaboration");
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [minimizedImageSearchPrId, setMinimizedImageSearchPrId] = useState<string | null>(null);
  const [minimizedImageSearchPosition, setMinimizedImageSearchPosition] = useState(() => ({
    left: 220,
    top: typeof window === "undefined" ? 280 : Math.round(window.innerHeight * 0.42),
  }));
  const minimizedImageSearchDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    moved: boolean;
  } | null>(null);
  const [orderMatchDialog, setOrderMatchDialog] = useState<OrderMatchDialogState | null>(null);
  const [selectedExternalOrderId, setSelectedExternalOrderId] = useState<string | null>(null);
  const [refundPoId, setRefundPoId] = useState<string | null>(null);
  const [refundAutoLoadingPoId, setRefundAutoLoadingPoId] = useState<string | null>(null);
  const [refundReasonOptions, setRefundReasonOptions] = useState<RefundReasonOption[]>([]);
  const [refundMaxAmount, setRefundMaxAmount] = useState<number | null>(null);
  const [orderNoteDialog, setOrderNoteDialog] = useState<OrderNoteDialogState | null>(null);
  const [selectedPoIds, setSelectedPoIds] = useState<string[]>([]);
  const [expandedPoIds, setExpandedPoIds] = useState<string[]>([]);
  const [purchaseOrderColumnConfig, setPurchaseOrderColumnConfig] = useState<PurchaseOrderColumnConfig>(readPurchaseOrderColumnConfig);
  const [purchaseOrderColumnDraft, setPurchaseOrderColumnDraft] = useState<PurchaseOrderColumnConfig | null>(null);
  const [purchaseOrderColumnMenu, setPurchaseOrderColumnMenu] = useState({ open: false, x: 0, y: 0, bodyMaxHeight: PURCHASE_ORDER_COLUMN_MENU_MAX_BODY_HEIGHT });
  const [purchaseOrderDraggedColumn, setPurchaseOrderDraggedColumn] = useState<string | null>(null);
  // 推 1688 单时让用户先确认 / 切换收货地址，避免默认地址跑错
  const [pushAddressPicker, setPushAddressPicker] = useState<{ po: PurchaseOrderRow; addressId: string; purchase1688AccountId?: string } | null>(null);
  const [pushAccountPicker, setPushAccountPicker] = useState<{
    po: PurchaseOrderRow;
    accountId: string;
    addressId?: string | null;
    defaultAccountId?: string | null;
    accounts: Array<{ id: string; label?: string | null; memberId?: string | null; appKey?: string; status?: string; configured?: boolean; authorized?: boolean }>;
  } | null>(null);
  // 切账号时自动同步该账号的地址(每个账号本 Modal 周期内最多自动同步一次,避免循环)。
  const pickerAutoSyncedRef = useRef<Set<string>>(new Set());
  const addressPickerAutoSyncedRef = useRef<Set<string>>(new Set());
  // 批量推 1688：按店铺分组，每组共用 1688 采购账号；地址全局共一份。
  const [batchPushPicker, setBatchPushPicker] = useState<{
    addressId: string | null;
    groups: Array<{
      accountId: string;
      accountName: string;
      pos: PurchaseOrderRow[];
      selectedPurchaseAccountId: string | null;
      defaultPurchaseAccountId: string | null;
    }>;
    accounts: Array<{ id: string; label?: string | null; configured?: boolean; authorized?: boolean; status?: string }>;
    fallbackMode: boolean;
    running: boolean;
    progress: { done: number; total: number; ok: number; fail: number };
  } | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [imported1688Orders, setImported1688Orders] = useState<Imported1688OrderRow[]>([]);
  const [activeWorkArea, setActiveWorkArea] = useState<PurchaseWorkArea>(() => workArea || "sourcing");
  const [activeQueueKey, setActiveQueueKey] = useState<PurchaseQueueKey>("all");
  const [purchaseOrderPageSize, setPurchaseOrderPageSize] = useState(() => (
    Math.max(1, Number(initialWorkbench.purchaseOrderPage?.limit || PURCHASE_ORDER_DEFAULT_PAGE_SIZE))
  ));
  const [purchaseOrderPage, setPurchaseOrderPage] = useState(() => (
    Math.floor(Number(initialWorkbench.purchaseOrderPage?.offset || 0) / Math.max(1, Number(initialWorkbench.purchaseOrderPage?.limit || PURCHASE_ORDER_DEFAULT_PAGE_SIZE))) + 1
  ));
  const [purchaseOrderTotal, setPurchaseOrderTotal] = useState(() => (
    Number(initialWorkbench.purchaseOrderPage?.total ?? initialWorkbench.summary?.purchaseOrderCount ?? initialWorkbench.purchaseOrders?.length ?? 0)
  ));
  const [purchaseOrderCounts, setPurchaseOrderCounts] = useState<PurchaseOrderCounts>(() => initialWorkbench.purchaseOrderCounts || {});
  const [purchaseOrderPageLoading, setPurchaseOrderPageLoading] = useState(false);
  const initialFocusPo = readFocusPoFromHash();
  const [purchaseOrderFilterDraft, setPurchaseOrderFilterDraft] = useState<PurchaseOrderFilterDraft>(() => ({
    keyword: "",
    poNo: activeWorkArea === "orders" ? initialFocusPo : "",
    dateRange: null,
    purchaser: "",
    accountId: "",
    supplier: "",
    paymentState: "",
    sourceState: "",
    riskState: "",
    productCode: "",
    amountMin: null,
    amountMax: null,
  }));
  const [purchaseOrderFilters, setPurchaseOrderFilters] = useState<PurchaseOrderFilters>(() => ({
    keyword: "",
    poNo: activeWorkArea === "orders" ? initialFocusPo : "",
    dateFrom: "",
    dateTo: "",
    purchaser: "",
    accountId: "",
    supplier: "",
    paymentState: "",
    sourceState: "",
    riskState: "",
    productCode: "",
    amountMin: null,
    amountMax: null,
  }));
  const [purchaseOrderSort, setPurchaseOrderSort] = useState<PurchaseOrderSortState>(() => ({
    field: initialWorkbench.purchaseOrderPage?.sortField || "",
    direction: initialWorkbench.purchaseOrderPage?.sortDirection || null,
  }));
  const [purchaseSearchText, setPurchaseSearchText] = useState(() => {
    return activeWorkArea === "sourcing" ? initialFocusPo : "";
  });
  const [selectedInquiryCandidateIds, setSelectedInquiryCandidateIds] = useState<string[]>([]);
  const [inquiryDialogPrId, setInquiryDialogPrId] = useState<string | null>(null);
  const [inquiryDialogCandidateIds, setInquiryDialogCandidateIds] = useState<string[]>([]);
  const [collaborationDraft, setCollaborationDraft] = useState("");
  const [collaborationUploadImages, setCollaborationUploadImages] = useState<RequestUploadImage[]>([]);
  const [storeManagerOpen, setStoreManagerOpen] = useState(initialStoreManagerOpen);
  const [purchaseSettingsOpen, setPurchaseSettingsOpen] = useState(false);
  const [purchaseFlowOpen, setPurchaseFlowOpen] = useState(false);
  const [specBindingDialog, setSpecBindingDialog] = useState<SpecBindingDialogState | null>(null);
  const [selectedBindingSpecId, setSelectedBindingSpecId] = useState<string | null>(null);
  const [specBindingSearchText, setSpecBindingSearchText] = useState("");
  const [bindingOurQty, setBindingOurQty] = useState(1);
  const [bindingPlatformQty, setBindingPlatformQty] = useState(1);

  const [requestForm] = Form.useForm<RequestFormValues>();
  const [directPoForm] = Form.useForm<DirectPoFormValues>();
  const [quoteForm] = Form.useForm<QuoteFormValues>();
  const [buyerFeedbackForm] = Form.useForm<BuyerFeedbackFormValues>();
  const [offlinePoForm] = Form.useForm<OfflinePoFormValues>();
  const [source1688Form] = Form.useForm<Source1688FormValues>();
  const [refundForm] = Form.useForm<RefundFormValues>();
  const [orderNoteForm] = Form.useForm<OrderNoteFormValues>();

  const switchWorkArea = useCallback((nextWorkArea: PurchaseWorkArea) => {
    setActiveWorkArea(nextWorkArea);
    setActiveQueueKey("all");
    setSelectedPoIds([]);
    setPurchaseOrderPage(1);
  }, []);

  const routeFocusPo = useMemo(() => {
    const fromSearch = new URLSearchParams(location.search || "").get("focusPo");
    return String(fromSearch || readFocusPoFromHash() || "").trim();
  }, [location.search, location.key]);

  const focusPurchaseOrder = useCallback((po?: PurchaseOrderRow | null, fallbackId?: string | null) => {
    const focusPo = String(po?.poNo || po?.id || fallbackId || "").trim();
    if (workArea === "sourcing") {
      navigate(`/purchase-center${focusPo ? `?focusPo=${encodeURIComponent(focusPo)}` : ""}`);
      return;
    }
    switchWorkArea("orders");
    setActiveQueueKey("all");
    if (focusPo) {
      setPurchaseOrderFilterDraft((prev) => ({ ...prev, keyword: "", poNo: focusPo }));
      setPurchaseOrderFilters((prev) => ({ ...prev, keyword: "", poNo: focusPo }));
    }
  }, [navigate, switchWorkArea, workArea]);

  useEffect(() => {
    if (!workArea) return;
    switchWorkArea(workArea);
  }, [switchWorkArea, workArea]);

  useEffect(() => {
    if (activeWorkArea !== "orders" || !routeFocusPo) return;
    setActiveQueueKey("all");
    setPurchaseOrderPage(1);
    setPurchaseOrderFilterDraft((prev) => (
      prev.poNo === routeFocusPo && !prev.keyword ? prev : { ...prev, keyword: "", poNo: routeFocusPo }
    ));
    setPurchaseOrderFilters((prev) => (
      prev.poNo === routeFocusPo && !prev.keyword ? prev : { ...prev, keyword: "", poNo: routeFocusPo }
    ));
  }, [activeWorkArea, routeFocusPo]);

  const [purchaseSettingsForm] = Form.useForm<PurchaseSettingsFormValues>();
  const [inquiryDialogForm] = Form.useForm<InquiryDialogFormValues>();

  const quotePr = useMemo(
    () => data.purchaseRequests?.find((item) => item.id === quotePrId) || null,
    [data.purchaseRequests, quotePrId],
  );
  const buyerFeedbackPr = useMemo(
    () => data.purchaseRequests?.find((item) => item.id === buyerFeedbackPrId) || null,
    [buyerFeedbackPrId, data.purchaseRequests],
  );
  const source1688Pr = useMemo(
    () => data.purchaseRequests?.find((item) => item.id === source1688PrId) || null,
    [data.purchaseRequests, source1688PrId],
  );
  const detailPr = useMemo(
    () => data.purchaseRequests?.find((item) => item.id === detailPrId) || null,
    [data.purchaseRequests, detailPrId],
  );
  const inquiryDialogPr = useMemo(
    () => data.purchaseRequests?.find((item) => item.id === inquiryDialogPrId) || null,
    [data.purchaseRequests, inquiryDialogPrId],
  );
  const inquiryDialogCandidates = useMemo(
    () => (inquiryDialogPr?.candidates || []).filter((candidate) => inquiryDialogCandidateIds.includes(candidate.id)),
    [inquiryDialogPr, inquiryDialogCandidateIds],
  );
  const minimizedImageSearchPr = useMemo(
    () => data.purchaseRequests?.find((item) => item.id === minimizedImageSearchPrId) || null,
    [data.purchaseRequests, minimizedImageSearchPrId],
  );
  const detailCandidateCount = detailPr?.candidates?.length || 0;
  const selectableInquiryCandidateIds = useMemo(
    () => (detailPr?.candidates || [])
      .filter((candidate) => !candidateInquirySent(candidate))
      .map((candidate) => candidate.id),
    [detailPr],
  );
  const selectedInquiryCandidateIdSet = useMemo(
    () => new Set(selectedInquiryCandidateIds),
    [selectedInquiryCandidateIds],
  );
  const selectedInquiryCount = selectedInquiryCandidateIds.length;
  const allInquiryCandidatesSelected = selectableInquiryCandidateIds.length > 0
    && selectedInquiryCount === selectableInquiryCandidateIds.length;
  const someInquiryCandidatesSelected = selectedInquiryCount > 0
    && selectedInquiryCount < selectableInquiryCandidateIds.length;
  const detailEventRows = useMemo(
    () => [...(detailPr?.timeline || [])]
      .filter((item) => item.kind === "event")
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
      .slice(0, 120),
    [detailPr],
  );
  const detailCommentRows = useMemo(
    () => [...(detailPr?.timeline || [])]
      .filter((item) => item.kind === "comment")
      .reverse()
      .slice(0, 80),
    [detailPr],
  );
  const detailLogColumns = useMemo<ColumnsType<TimelineRow>>(() => [
    {
      title: "标题(最长30字符)",
      dataIndex: "eventType",
      width: 180,
      render: (_value, row) => (
        <Text className="purchase-log-table__title" title={purchaseLogTitle(row)}>
          {purchaseLogTitle(row)}
        </Text>
      ),
    },
    {
      title: "备注",
      dataIndex: "message",
      render: (value) => (
        <Text className="purchase-log-table__remark" title={String(value || "已记录操作")}>
          {String(value || "已记录操作")}
        </Text>
      ),
    },
    {
      title: "操作人",
      dataIndex: "actorName",
      width: 120,
      render: (_value, row) => purchaseLogActor(row),
    },
    {
      title: "操作时间",
      dataIndex: "createdAt",
      width: 170,
      render: (value) => formatDateTime(value),
    },
  ], []);
  const detailImageSearchLoading = detailDrawerMode === "imageSearch"
    && Boolean(detailPr && actingKey === `1688-image-${detailPr.id}`);
  const refundPo = useMemo(
    () => data.purchaseOrders?.find((item) => item.id === refundPoId) || null,
    [data.purchaseOrders, refundPoId],
  );
  const renderSkuOption = useCallback(
    (option: any) => renderSkuSelectOption(option, setRequestImagePreview),
    [],
  );
  const skuOptions = useMemo(
    () => skus.map((sku) => {
      const code = sku.internalSkuCode || sku.id;
      const name = sku.productName || "-";
      const cost = sku.jstCostPrice ?? sku.costPrice ?? null;
      const stock = sku.jstActualStockQty ?? sku.actualStockQty ?? null;
      const warehouse = sku.warehouseLocation || sku.jstMainBin || (sku as any).mainBin || (sku as any).bin || (sku as any).locationCode || "";
      return {
        // value 用 internal_sku_code（纯数字），跟用户输入的 keyword 对齐，
        // antd mode="tags" 才不会再插一条「新建标签」虚拟项。
        // 下游 handleCreateRequest 用 `sku.id === skuId || sku.internalSkuCode === skuId` 双匹配，兼容。
        value: code,
        label: code,
        searchText: `${code} ${name} ${sku.primary1688Source?.externalOfferId || ""}`,
        skuName: name,
        skuImage: sku.imageUrl || "",
        skuCost: cost,
        skuSupplier: sku.jstSupplierName || sku.systemSupplierName || sku.primary1688Source?.supplierName || "",
        skuStock: stock,
        skuWarehouse: warehouse,
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
  const specBindingCandidate = useMemo(() => {
    if (!specBindingDialog) return null;
    const candidates = (data.purchaseRequests || []).flatMap((request) => request.candidates || []);
    return candidates.find((candidate) => candidate.id === specBindingDialog.candidate.id) || specBindingDialog.candidate;
  }, [data.purchaseRequests, specBindingDialog]);
  const specBindingRows = useMemo(
    () => candidateSpecRows(specBindingCandidate),
    [specBindingCandidate],
  );
  const filteredSpecBindingRows = useMemo(() => {
    const needle = normalizePurchaseSearch(specBindingSearchText);
    if (!needle) return specBindingRows;
    return specBindingRows.filter((row) => normalizePurchaseSearch(specRowSearchText(row)).includes(needle));
  }, [specBindingRows, specBindingSearchText]);
  const selectedBindingSpec = useMemo(
    () => specBindingRows.find((row) => row.externalSpecId === selectedBindingSpecId) || null,
    [selectedBindingSpecId, specBindingRows],
  );
  const specBindingColumns = useMemo<ColumnsType<BindingSpecRow>>(() => [
    {
      title: "图片",
      dataIndex: "imageUrl",
      width: 72,
      render: (_value: string | null | undefined, row) => {
        const imageUrl = specRowImageUrl(row, specBindingCandidate);
        return imageUrl ? (
          <div onClick={(event) => event.stopPropagation()}>
            <AntdImage
              src={imageUrl}
              width={44}
              height={44}
              style={{ objectFit: "cover", borderRadius: 6, display: "block" }}
              preview={{ mask: false }}
            />
          </div>
        ) : <Text type="secondary">无图</Text>;
      },
    },
    {
      title: "规格",
      dataIndex: "specText",
      render: (text: string | null | undefined, row) => text || row.externalSpecId,
    },
    {
      title: "SKU ID",
      dataIndex: "externalSkuId",
      width: 150,
      render: (value: string | null | undefined) => value || "-",
    },
    {
      title: "Spec ID",
      dataIndex: "externalSpecId",
      width: 150,
    },
    {
      title: "价格",
      dataIndex: "price",
      width: 110,
      render: (value: number | null | undefined) => value === null || value === undefined ? "-" : formatCurrency(value),
    },
    {
      title: "库存",
      dataIndex: "stock",
      width: 100,
      render: (value: number | null | undefined) => value === null || value === undefined ? "-" : formatQty(value),
    },
  ], [specBindingCandidate]);
  const purchaseRequests = data.purchaseRequests || [];
  const purchaseOrders = data.purchaseOrders || [];
  const pendingRequestRows = useMemo(
    () => purchaseRequests.filter(isPendingPurchaseRequest),
    [purchaseRequests],
  );
  // 找品/优化按新建时写入的 reason 区分，不再用是否绑定映射来改业务阶段。
  const pendingSourcingRequestRows = useMemo(
    () => purchaseRequests.filter((row) => isSourcingPurchaseRequest(row) && isEarlyStagePurchaseRequest(row)),
    [purchaseRequests],
  );
  const sourcedRequestRows = useMemo(
    () => purchaseRequests.filter((row) =>
      isSourcingPurchaseRequest(row) && isCompletedRequestStage(row),
    ),
    [purchaseRequests],
  );
  const pendingOptimizationRequestRows = useMemo(
    () => purchaseRequests.filter(purchaseRequestNeedsOptimization),
    [purchaseRequests],
  );
  const optimizedRequestRows = useMemo(
    () => purchaseRequests.filter((row) => isPendingPurchaseRequest(row) && purchaseRequestIsOptimized(row)),
    [purchaseRequests],
  );
  // 待提交 = 还没提交付款的：草稿(draft，含线下手工单) + 已推 1688 待提交付款(pushed_pending_price)。
  const unsubmittedOrderRows = useMemo(
    () => purchaseOrders.filter((row) =>
      row.status === "draft" || row.status === "pushed_pending_price"),
    [purchaseOrders],
  );
  // 已提交付款、待支付（含历史财审 pending_finance_approval、已批待付 approved_to_pay）。
  // pushed_pending_price(已推但还没提交付款)已移到「待提交」tab。
  const confirmedPendingPaymentOrderRows = useMemo(
    () => purchaseOrders.filter((row) =>
      row.status === "pending_finance_approval"
      || row.status === "approved_to_pay",
    ),
    [purchaseOrders],
  );
  // 已付款到入库前的中间态全归这里
  const paidOrderRows = useMemo(
    () => purchaseOrders.filter((row) =>
      row.status === "paid"
      || row.status === "supplier_processing"
      || row.status === "shipped"
      || row.status === "arrived",
    ),
    [purchaseOrders],
  );
  const completedOrderRows = useMemo(
    () => purchaseOrders.filter(isCompletedOrder),
    [purchaseOrders],
  );
  const cancelledOrderRows = useMemo(
    () => purchaseOrders.filter((row) => row.status === "cancelled"),
    [purchaseOrders],
  );
  // 已取消 tab 是 mixed kind：PR 段含已取消+已驳回，PO 段含已取消
  const cancelledRequestRows = useMemo(
    () => purchaseRequests.filter((row) => row.status === "cancelled" || row.status === "rejected"),
    [purchaseRequests],
  );
  // 异常 tab：仅 PO 的延期+异常状态
  const exceptionOrderRows = useMemo(
    () => purchaseOrders.filter((row) => row.status === "delayed" || row.status === "exception"),
    [purchaseOrders],
  );
  const orderCountAll = Number(purchaseOrderCounts.all ?? data.summary?.purchaseOrderCount ?? purchaseOrderTotal ?? purchaseOrders.length);
  const orderCountDraft = Number(purchaseOrderCounts.draft ?? unsubmittedOrderRows.length);
  const orderCountPendingPayment = Number(purchaseOrderCounts.pendingPayment ?? confirmedPendingPaymentOrderRows.length);
  const orderCountPaid = Number(purchaseOrderCounts.paid ?? paidOrderRows.length);
  const orderCountCompleted = Number(purchaseOrderCounts.completed ?? completedOrderRows.length);
  const orderCountCancelled = Number(purchaseOrderCounts.cancelled ?? cancelledOrderRows.length);
  const orderCountException = Number(purchaseOrderCounts.exception ?? exceptionOrderRows.length);

  const queueItems = useMemo<PurchaseQueueItem[]>(() => {
    if (activeWorkArea === "sourcing") {
      return [
        { key: "all", title: "全部", count: pendingRequestRows.length, kind: "request" },
        { key: "request_pending_sourcing", title: "待找品", count: pendingSourcingRequestRows.length, kind: "request" },
        { key: "request_sourced", title: "已找品", count: sourcedRequestRows.length, kind: "request" },
        { key: "request_pending_optimization", title: "待优化", count: pendingOptimizationRequestRows.length, kind: "request" },
        { key: "request_optimized", title: "已优化", count: optimizedRequestRows.length, kind: "request" },
        { key: "po_cancelled", title: "已取消", count: cancelledRequestRows.length, kind: "request" },
      ];
    }
    return [
      { key: "all", title: "全部", count: orderCountAll, kind: "order" },
      { key: "po_draft", title: "待提交", count: orderCountDraft, kind: "order" },
      { key: "po_pending_payment", title: "待付款", count: orderCountPendingPayment, kind: "order" },
      { key: "po_paid", title: "已付款", count: orderCountPaid, kind: "order" },
      { key: "po_completed", title: "已完成", count: orderCountCompleted, kind: "order" },
      { key: "po_cancelled", title: "已取消", count: orderCountCancelled, kind: "order" },
      { key: "po_exception", title: "异常", count: orderCountException, kind: "order" },
    ];
  }, [
    activeWorkArea,
    cancelledOrderRows,
    cancelledRequestRows,
    completedOrderRows,
    confirmedPendingPaymentOrderRows,
    unsubmittedOrderRows,
    exceptionOrderRows,
    paidOrderRows,
    pendingRequestRows,
    pendingOptimizationRequestRows,
    pendingSourcingRequestRows,
    orderCountAll,
    orderCountCancelled,
    orderCountCompleted,
    orderCountDraft,
    orderCountException,
    orderCountPaid,
    orderCountPendingPayment,
    optimizedRequestRows,
    sourcedRequestRows,
  ]);

  const activeQueue = queueItems.find((item) => item.key === activeQueueKey) || queueItems[0];

  const activeOrderRows = useMemo(() => {
    if (activeWorkArea !== "orders") return [];
    switch (activeQueueKey) {
      case "po_draft":
        return unsubmittedOrderRows;
      case "po_pending_payment":
        return confirmedPendingPaymentOrderRows;
      case "po_paid":
        return paidOrderRows;
      case "po_completed":
        return completedOrderRows;
      case "po_cancelled":
        return cancelledOrderRows;
      case "po_exception":
        return exceptionOrderRows;
      default:
        return purchaseOrders;
    }
  }, [
    activeWorkArea,
    activeQueueKey,
    cancelledOrderRows,
    completedOrderRows,
    confirmedPendingPaymentOrderRows,
    unsubmittedOrderRows,
    exceptionOrderRows,
    paidOrderRows,
    purchaseOrders,
  ]);

  const activeRequestRows = useMemo(() => {
    if (activeWorkArea !== "sourcing") return [];
    switch (activeQueueKey) {
      case "request_pending_sourcing":
        return pendingSourcingRequestRows;
      case "request_sourced":
        return sourcedRequestRows;
      case "request_pending_optimization":
        return pendingOptimizationRequestRows;
      case "request_optimized":
        return optimizedRequestRows;
      case "all":
        // "全部" 只显示活跃 PR（converted_to_po 已变身为 PO，看 PO 即可）
        return pendingRequestRows;
      case "po_cancelled":
        // 已取消 tab 上段：被取消 + 被驳回的 PR
        return cancelledRequestRows;
      default:
        return pendingRequestRows;
    }
  }, [
    activeWorkArea,
    activeQueueKey,
    cancelledRequestRows,
    optimizedRequestRows,
    pendingRequestRows,
    pendingOptimizationRequestRows,
    pendingSourcingRequestRows,
    sourcedRequestRows,
  ]);

  const filteredActiveRequestRows = useMemo(
    () => filterPurchaseRows(activeRequestRows, purchaseSearchText, buildPurchaseRequestSearchText),
    [activeRequestRows, purchaseSearchText],
  );
  const filteredActiveOrderRows = activeOrderRows;
  const hasPurchaseSearch = activeWorkArea === "sourcing" && Boolean(purchaseSearchText.trim());
  const activeOrderTotal = activeWorkArea === "orders" ? Number(purchaseOrderTotal || filteredActiveOrderRows.length) : 0;
  const purchaseSearchResultCount = filteredActiveRequestRows.length;
  const hasUsable1688Address = useMemo(
    () => (data.alibaba1688Addresses || []).some(isUsable1688Address),
    [data.alibaba1688Addresses],
  );
  const orderTablePagination = useMemo(() => ({
    current: purchaseOrderPage,
    pageSize: purchaseOrderPageSize,
    total: activeOrderTotal,
    showSizeChanger: true,
    pageSizeOptions: [20, 25, 50, 100, 200],
    showTotal: (total: number, range: [number, number]) => `显示 ${range[0]}-${range[1]} / ${total} 条`,
  }), [activeOrderTotal, purchaseOrderPage, purchaseOrderPageSize]);

  const handlePurchaseOrderTableChange = useCallback((pagination: any, _filters: any, sorter: any, extra: any) => {
    const nextPageSize = Number(pagination?.pageSize || purchaseOrderPageSize);
    const nextPage = Number(pagination?.current || 1);
    const activeSorter = Array.isArray(sorter) ? sorter.find((item) => item?.order) : sorter;
    const nextField = String(activeSorter?.columnKey || activeSorter?.field || "");
    const nextDirection = activeSorter?.order === "ascend" || activeSorter?.order === "descend"
      ? activeSorter.order as PurchaseOrderSortDirection
      : null;
    setSelectedPoIds([]);
    if (nextPageSize !== purchaseOrderPageSize) {
      setPurchaseOrderPageSize(nextPageSize);
      setPurchaseOrderPage(1);
      return;
    }
    if (extra?.action === "sort") {
      setPurchaseOrderSort({ field: nextDirection ? nextField : "", direction: nextDirection });
      setPurchaseOrderPage(1);
      return;
    }
    setPurchaseOrderPage(nextPage);
  }, [purchaseOrderPageSize]);

  const applyPurchaseOrderFilters = useCallback(() => {
    setSelectedPoIds([]);
    setPurchaseOrderPage(1);
    setPurchaseOrderFilters(toPurchaseOrderFilters(purchaseOrderFilterDraft));
  }, [purchaseOrderFilterDraft]);

  const resetPurchaseOrderFilters = useCallback(() => {
    const emptyDraft = {
      keyword: "",
      poNo: "",
      dateRange: null,
      purchaser: "",
      accountId: "",
      supplier: "",
      paymentState: "",
      sourceState: "",
      riskState: "",
      productCode: "",
      amountMin: null,
      amountMax: null,
    };
    setSelectedPoIds([]);
    setPurchaseOrderPage(1);
    setPurchaseOrderSort({ field: "", direction: null });
    setPurchaseOrderFilterDraft(emptyDraft);
    setPurchaseOrderFilters(toPurchaseOrderFilters(emptyDraft));
  }, []);

  const selectedPurchaseOrders = useMemo(
    () => purchaseOrders.filter((row) => selectedPoIds.includes(row.id)),
    [purchaseOrders, selectedPoIds],
  );

  // 批量推 1688 用：把"还能推"的单子筛出来。条件与单行 canPushTo1688（约 4099 行）一致。
  const selectedPushableOrders = useMemo(
    () => selectedPurchaseOrders.filter((row) =>
      !row.externalOrderId
      && canPurchase
      && Number(row.mappingCount || 0) > 0
      && (Number(row.deliveryAddressCount || 0) > 0 || hasUsable1688Address),
    ),
    [selectedPurchaseOrders, canPurchase, hasUsable1688Address],
  );

  const orderRowSelection = useMemo<TableRowSelection<PurchaseOrderRow>>(() => ({
    selectedRowKeys: selectedPoIds,
    preserveSelectedRowKeys: true,
    onChange: (keys) => setSelectedPoIds(keys.map(String)),
  }), [selectedPoIds]);

  const togglePurchaseOrderExpanded = useCallback((poId: string) => {
    setExpandedPoIds((prev) => (
      prev.includes(poId) ? prev.filter((id) => id !== poId) : [...prev, poId]
    ));
  }, []);

  const purchaseOrderTableRowProps = useCallback((row: PurchaseOrderRow) => ({
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (shouldIgnorePurchaseOrderRowClick(event.target)) return;
      togglePurchaseOrderExpanded(row.id);
    },
  }), [togglePurchaseOrderExpanded]);

  const openPurchaseOrderColumnMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const position = purchaseOrderColumnMenuPosition(event.clientX, event.clientY);
    setPurchaseOrderColumnDraft({
      order: [...purchaseOrderColumnConfig.order],
      visible: [...purchaseOrderColumnConfig.visible],
    });
    setPurchaseOrderColumnMenu({
      open: true,
      ...position,
    });
  }, [purchaseOrderColumnConfig]);

  const reorderPurchaseOrderDraftColumn = useCallback((sourceField: string, targetField: string) => {
    if (!sourceField || !targetField || sourceField === targetField) return;
    setPurchaseOrderColumnDraft((prev) => {
      const current = normalizePurchaseOrderColumnConfig(prev || purchaseOrderColumnConfig);
      const sourceIndex = current.order.indexOf(sourceField);
      const targetIndex = current.order.indexOf(targetField);
      if (sourceIndex === -1 || targetIndex === -1) return current;
      const nextOrder = current.order.slice();
      const [movedField] = nextOrder.splice(sourceIndex, 1);
      nextOrder.splice(targetIndex, 0, movedField);
      return {
        ...current,
        order: nextOrder,
        visible: nextOrder.filter((key) => current.visible.includes(key)),
      };
    });
  }, [purchaseOrderColumnConfig]);

  const handlePurchaseOrderColumnDragStart = useCallback((event: DragEvent<HTMLDivElement>, field: string) => {
    setPurchaseOrderDraggedColumn(field);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", field);
  }, []);

  const handlePurchaseOrderColumnDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handlePurchaseOrderColumnDrop = useCallback((event: DragEvent<HTMLDivElement>, targetField: string) => {
    event.preventDefault();
    const sourceField = purchaseOrderDraggedColumn || event.dataTransfer.getData("text/plain");
    reorderPurchaseOrderDraftColumn(sourceField, targetField);
    setPurchaseOrderDraggedColumn(null);
  }, [purchaseOrderDraggedColumn, reorderPurchaseOrderDraftColumn]);

  const handlePurchaseOrderColumnDragEnd = useCallback(() => {
    setPurchaseOrderDraggedColumn(null);
  }, []);

  const togglePurchaseOrderDraftColumn = useCallback((field: string, checked: boolean) => {
    setPurchaseOrderColumnDraft((prev) => {
      const current = normalizePurchaseOrderColumnConfig(prev || purchaseOrderColumnConfig);
      const visible = new Set(current.visible);
      if (checked) {
        visible.add(field);
      } else if (visible.size > 1) {
        visible.delete(field);
      }
      return { ...current, visible: current.order.filter((key) => visible.has(key)) };
    });
  }, [purchaseOrderColumnConfig]);

  const savePurchaseOrderColumnConfig = useCallback(() => {
    const next = normalizePurchaseOrderColumnConfig(purchaseOrderColumnDraft || purchaseOrderColumnConfig);
    setPurchaseOrderColumnConfig(next);
    try {
      window.localStorage.setItem(PURCHASE_ORDER_COLUMN_ORDER_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage is a convenience only; table layout still works without it.
    }
    setPurchaseOrderColumnMenu((prev) => ({ ...prev, open: false }));
  }, [purchaseOrderColumnConfig, purchaseOrderColumnDraft]);

  const restorePurchaseOrderColumnConfig = useCallback(() => {
    setPurchaseOrderColumnDraft(defaultPurchaseOrderColumnConfig());
  }, []);

  useEffect(() => {
    if (!purchaseOrderColumnMenu.open) return undefined;
    const close = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(".purchase-order-column-menu")) return;
      setPurchaseOrderColumnMenu((prev) => ({ ...prev, open: false }));
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPurchaseOrderColumnMenu((prev) => ({ ...prev, open: false }));
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [purchaseOrderColumnMenu.open]);

  // 乐观更新：立刻把指定 PO 行的状态改成预期值，让 UI 不等 IPC 来回就刷新。
  // 后续 broadcast/loadData 会用真实数据覆盖；失败时上层应用调用 revert 回滚。
  const patchPurchaseOrderRow = useCallback((poId: string, patch: Partial<PurchaseOrderRow>) => {
    let snapshot: PurchaseOrderRow | null = null;
    setData((prev) => {
      const list = prev.purchaseOrders || [];
      const idx = list.findIndex((row) => row.id === poId);
      if (idx === -1) return prev;
      snapshot = list[idx];
      const nextRow = { ...list[idx], ...patch };
      const nextList = list.slice();
      nextList[idx] = nextRow;
      return { ...prev, purchaseOrders: nextList };
    });
    return snapshot;
  }, []);

  const patchPurchaseOrderFromResult = useCallback((result: any) => {
    const purchaseOrder = result?.result?.purchaseOrder || result?.purchaseOrder;
    if (purchaseOrder?.id) {
      patchPurchaseOrderRow(purchaseOrder.id, purchaseOrder);
    }
  }, [patchPurchaseOrderRow]);

  const upsertPurchaseRequestRow = useCallback((row?: PurchaseRequestRow | null) => {
    if (!row?.id) return;
    setData((prev) => {
      const previousRows = prev.purchaseRequests || [];
      const index = previousRows.findIndex((item) => item.id === row.id);
      const purchaseRequests = index >= 0
        ? previousRows.map((item, itemIndex) => (itemIndex === index ? { ...item, ...row } : item))
        : [row, ...previousRows];
      return { ...prev, purchaseRequests };
    });
  }, []);

  const upsertGeneratedPurchaseOrder = useCallback((prId: string, generatedPo?: PurchaseOrderRow | null) => {
    if (!generatedPo?.id) return;
    setData((prev) => {
      const resolvedPrId = generatedPo.prId ?? (generatedPo as any).pr_id ?? prId;
      const poWithRequest = {
        ...generatedPo,
        ...(resolvedPrId ? { prId: resolvedPrId } : {}),
      };
      const previousOrders = prev.purchaseOrders || [];
      const orderIndex = previousOrders.findIndex((item) => item.id === poWithRequest.id);
      const purchaseOrders = orderIndex >= 0
        ? previousOrders.map((item, index) => (index === orderIndex ? { ...item, ...poWithRequest } : item))
        : [poWithRequest, ...previousOrders];
      const purchaseRequests = resolvedPrId && Array.isArray(prev.purchaseRequests)
        ? prev.purchaseRequests.map((item) => (
          item.id === resolvedPrId ? { ...item, status: "converted_to_po" } : item
        ))
        : prev.purchaseRequests;
      const merged = { ...prev, purchaseOrders, purchaseRequests };
      writeCachedPurchaseWorkbench(merged);
      return merged;
    });
  }, []);

  const syncPurchaseOrderPageMeta = useCallback((workbench: PurchaseWorkbench) => {
    if (workbench?.purchaseOrderPage) {
      setPurchaseOrderTotal(Number(workbench.purchaseOrderPage.total || 0));
    }
    if (workbench?.purchaseOrderCounts) {
      setPurchaseOrderCounts(workbench.purchaseOrderCounts);
    }
  }, []);

  const applyWorkbench = useCallback((nextData: PurchaseWorkbench) => {
    syncPurchaseOrderPageMeta(nextData || {});
    setData((prevData) => {
      const nextWorkbench = nextData || {};
      if (!Array.isArray(nextWorkbench.purchaseRequests)) {
        const merged = { ...prevData, ...nextWorkbench };
        writeCachedPurchaseWorkbench(merged);
        return merged;
      }
      const previousById = new Map((prevData.purchaseRequests || []).map((row) => [row.id, row]));
      const purchaseRequests = nextWorkbench.purchaseRequests.map((row) => {
        const previous = previousById.get(row.id);
        if (!previous) return row;
        return {
          ...row,
          candidates: Array.isArray(row.candidates) ? row.candidates : previous.candidates,
          timeline: Array.isArray(row.timeline) ? row.timeline : previous.timeline,
        };
      });
      const merged = { ...prevData, ...nextWorkbench, purchaseRequests };
      writeCachedPurchaseWorkbench(merged);
      return merged;
    });
  }, [syncPurchaseOrderPageMeta]);

  const syncWorkbenchOptions = useCallback((workbench: PurchaseWorkbench) => {
    if (Array.isArray(workbench?.skuOptions)) setSkus(workbench.skuOptions);
    if (Array.isArray(workbench?.supplierOptions)) setSuppliers(workbench.supplierOptions);
  }, []);

  const buildPurchaseWorkbenchParams = useCallback(() => ({
    ...FAST_PURCHASE_WORKBENCH_PARAMS,
    purchaseOrderLimit: purchaseOrderPageSize,
    purchaseOrderOffset: Math.max(0, purchaseOrderPage - 1) * purchaseOrderPageSize,
    purchaseOrderQueue: activeWorkArea === "orders" ? purchaseOrderQueueForWorkbench(activeQueueKey) : "all",
    purchaseOrderSearch: activeWorkArea === "orders" ? purchaseOrderFilters.keyword : "",
    purchaseOrderNo: activeWorkArea === "orders" ? purchaseOrderFilters.poNo : "",
    purchaseOrderDateFrom: activeWorkArea === "orders" ? purchaseOrderFilters.dateFrom : "",
    purchaseOrderDateTo: activeWorkArea === "orders" ? purchaseOrderFilters.dateTo : "",
    purchaseOrderPurchaser: activeWorkArea === "orders" ? purchaseOrderFilters.purchaser : "",
    purchaseOrderAccountId: activeWorkArea === "orders" ? purchaseOrderFilters.accountId : "",
    purchaseOrderSupplier: activeWorkArea === "orders" ? purchaseOrderFilters.supplier : "",
    purchaseOrderPaymentState: activeWorkArea === "orders" ? purchaseOrderFilters.paymentState : "",
    purchaseOrderSourceState: activeWorkArea === "orders" ? purchaseOrderFilters.sourceState : "",
    purchaseOrderRiskState: activeWorkArea === "orders" ? purchaseOrderFilters.riskState : "",
    purchaseOrderProductCode: activeWorkArea === "orders" ? purchaseOrderFilters.productCode : "",
    purchaseOrderAmountMin: activeWorkArea === "orders" ? purchaseOrderFilters.amountMin : null,
    purchaseOrderAmountMax: activeWorkArea === "orders" ? purchaseOrderFilters.amountMax : null,
    purchaseOrderSortField: activeWorkArea === "orders" ? purchaseOrderSort.field : "",
    purchaseOrderSortDirection: activeWorkArea === "orders" ? purchaseOrderSort.direction : null,
  }), [activeQueueKey, activeWorkArea, purchaseOrderFilters, purchaseOrderPage, purchaseOrderPageSize, purchaseOrderSort]);

  const loadSupplementalWorkbenchData = useCallback(async () => {
    if (!erp) return;
    if (supplementalWorkbenchPromiseRef.current) {
      await supplementalWorkbenchPromiseRef.current;
      return;
    }
    const promise = (async () => {
      try {
        const workbench = await erp.purchase.workbench(FULL_PURCHASE_WORKBENCH_PARAMS);
        applyWorkbench(workbench);
        syncWorkbenchOptions(workbench);
      } catch {
        // Supplemental options and 1688 metadata should never block the purchase list.
      } finally {
        supplementalWorkbenchPromiseRef.current = null;
      }
    })();
    supplementalWorkbenchPromiseRef.current = promise;
    await promise;
  }, [applyWorkbench, syncWorkbenchOptions]);

  // 推单 Modal:切到一个还没本地地址的 1688 账号时,自动触发一次同步,
  // 用 pickerAutoSyncedRef 限制每个账号本周期最多自动同步一次,避免循环。
  useEffect(() => {
    if (!pushAccountPicker) {
      pickerAutoSyncedRef.current = new Set();
      return;
    }
    const acctId = pushAccountPicker.accountId;
    if (!acctId || pickerAutoSyncedRef.current.has(acctId)) return;
    const filtered = (data.alibaba1688Addresses || []).filter((a) => String((a as any).purchase1688AccountId || "") === acctId);
    if (filtered.length > 0) return;
    pickerAutoSyncedRef.current.add(acctId);
    const poAcctId = pushAccountPicker.po.accountId;
    (async () => {
      try {
        await erp?.purchase?.action?.({
          action: "sync_1688_addresses",
          accountId: poAcctId,
          purchase1688AccountId: acctId,
          includeWorkbench: false,
        }, { timeoutMs: 120000 });
        await loadSupplementalWorkbenchData();
      } catch {
        // 自动同步失败保持安静,用户可点 Alert 里的按钮手动重试
      }
    })();
  }, [pushAccountPicker, data.alibaba1688Addresses, loadSupplementalWorkbenchData]);

  useEffect(() => {
    if (!pushAddressPicker) {
      addressPickerAutoSyncedRef.current = new Set();
      return;
    }
    const acctId = pushAddressPicker.purchase1688AccountId || "";
    const scopeKey = acctId || `account:${pushAddressPicker.po.accountId || ""}`;
    if (!scopeKey || addressPickerAutoSyncedRef.current.has(scopeKey)) return;
    const filtered = (data.alibaba1688Addresses || []).filter((a) => {
      if (!acctId) return true;
      return String((a as any).purchase1688AccountId || "") === acctId;
    });
    if (filtered.some(isUsable1688Address)) return;
    addressPickerAutoSyncedRef.current.add(scopeKey);
    (async () => {
      try {
        await erp?.purchase?.action?.({
          action: "sync_1688_addresses",
          accountId: pushAddressPicker.po.accountId,
          purchase1688AccountId: acctId || undefined,
          includeWorkbench: false,
        }, { timeoutMs: 120000 });
        await loadSupplementalWorkbenchData();
      } catch {
        // 保持弹窗可见，用户仍可从询盘设置手动同步。
      }
    })();
  }, [pushAddressPicker, data.alibaba1688Addresses, loadSupplementalWorkbenchData]);

  const loadData = useCallback(async (options: { silent?: boolean; withSupplemental?: boolean; sideLoads?: boolean } = {}) => {
    if (!erp) return;
    const silent = Boolean(options?.silent);
    const sideLoads = options?.sideLoads !== false;
    if (!silent) setLoading(true);
    else setPurchaseOrderPageLoading(true);
    try {
      const workbench = await erp.purchase.workbench(buildPurchaseWorkbenchParams());
      applyWorkbench(workbench);
      syncWorkbenchOptions(workbench);
      if (sideLoads) {
        void erp.account.list({ limit: 500 })
          .then((accountRows: unknown) => setAccounts(Array.isArray(accountRows) ? sortStoreAccounts(accountRows as AccountOption[]) : []))
          .catch(() => {});
      }
      // 0.3.25 性能：FULL_PURCHASE_WORKBENCH_PARAMS 关掉了 includeOptions（详见 86 行注释），
      // suppliers 不再随 workbench 返回，这里 fire-and-forget 单独拉一次给新建采购单 Modal 用。
      if (sideLoads) {
        void erp.supplier.list({ limit: 500 })
          .then((supplierRows: unknown) => {
            if (Array.isArray(supplierRows) && supplierRows.length) setSuppliers(supplierRows as SupplierOption[]);
          })
          .catch(() => {});
      }
      // 预拉 1688 采购账号列表（推单按钮要用）。失败/旧主控 Unsupported 都静默，
      // 推单时若 state 仍为空会兜底再拉一次（保留 fallback 分支）。
      if (sideLoads) {
        void erp.purchase.action({ action: "list_1688_purchase_accounts" })
          .then((res: any) => {
            const list = Array.isArray(res?.result?.accounts) ? (res.result.accounts as Purchase1688Account[]) : [];
            setPurchase1688Accounts(list);
          })
          .catch(() => {});
      }
      if (options?.withSupplemental !== false) {
        void loadSupplementalWorkbenchData();
      }
    } catch (error: any) {
      if (!silent) {
        message.error(error?.message || "采购中心读取失败");
      }
    } finally {
      if (!silent) setLoading(false);
      else setPurchaseOrderPageLoading(false);
    }
  }, [applyWorkbench, buildPurchaseWorkbenchParams, loadSupplementalWorkbenchData, syncWorkbenchOptions]);

  const runAuto1688OrderSync = useCallback(async () => {
    if (!erp || !canPurchase) return;

    const now = Date.now();
    if (auto1688OrderSyncPromise) {
      await auto1688OrderSyncPromise;
      return;
    }
    if (now - lastAuto1688OrderSyncAt < AUTO_1688_ORDER_SYNC_INTERVAL_MS) return;

    lastAuto1688OrderSyncAt = now;
    const syncPromise = (async () => {
      try {
        const result = await erp.purchase.action({
          action: "import_1688_orders",
          pageSize: 50,
          autoGenerate: false,
          limit: 200,
          includeRequestDetails: false,
          includeOptions: false,
          include1688Meta: false,
        });
        const workbench = result?.workbench || await erp.purchase.workbench(buildPurchaseWorkbenchParams());
        applyWorkbench(workbench);
        syncWorkbenchOptions(workbench);
      } catch {
        // Keep background 1688 sync quiet when auth is missing or the network is unavailable.
      } finally {
        auto1688OrderSyncPromise = null;
      }
    })();
    auto1688OrderSyncPromise = syncPromise;
    await syncPromise;
  }, [applyWorkbench, buildPurchaseWorkbenchParams, canPurchase, syncWorkbenchOptions]);

  useEffect(() => {
    // 首屏统一走非 silent：先显示加载态（不渲染旧快照），新数据到了再一次性渲染。
    if (!purchaseWorkbenchAutoLoadRef.current) {
      purchaseWorkbenchAutoLoadRef.current = true;
      void loadData();
      return;
    }
    void loadData({ silent: true, withSupplemental: false, sideLoads: false });
  }, [loadData]);

  useEffect(() => {
    // 采购页挂载即预热商品资料缓存（client 模式 fire-and-forget；host 模式 no-op）。
    // 让 SKU 选择器首次搜索也走本地 cache.db、不卡跨海建基线。单飞锁防重复。
    void erp?.sku?.sync?.({ mode: "incremental" }).catch(() => {});
  }, []);

  useEffect(() => {
    candidateScrollLockRef.current = {};
    pendingCandidateScrollRestoreRef.current = null;
    setCollaborationDraft("");
    setCollaborationUploadImages([]);
    setSelectedInquiryCandidateIds([]);
  }, [detailPrId]);

  useEffect(() => {
    if (minimizedImageSearchPrId && !minimizedImageSearchPr) {
      setMinimizedImageSearchPrId(null);
    }
  }, [minimizedImageSearchPrId, minimizedImageSearchPr]);

  useEffect(() => {
    const restore = pendingCandidateScrollRestoreRef.current;
    if (!restore || restore.prId !== detailPrId) return;
    const frame = window.requestAnimationFrame(() => {
      const scrollElement = candidateScrollElRef.current;
      if (!scrollElement) return;
      scrollElement.scrollTop = Math.min(
        restore.scrollTop,
        Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight),
      );
      pendingCandidateScrollRestoreRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detailPrId, detailCandidateCount]);

  useEffect(() => {
    // 已禁用前端的自动 import_1688_orders 轮询：服务器侧调度器已经接管这件事
    // (runScheduledOrderSync 每 10 分钟自动同步 + 失败指数退避)，
    // 前端再轮一次只会重复打 1688 API + 拖慢 UI。
    // 想手动同步的随时点顶部「同步询盘结果」按钮。
    return () => {};
  }, [canPurchase, runAuto1688OrderSync]);

  useEffect(() => {
    if (!erp) return;
    const canSyncDetail = canPurchase || canFinance || canWarehouse;
    const canSyncLogistics = canPurchase || canWarehouse;
    if (!canSyncDetail && !canSyncLogistics) return;

    // 跳过已结束 / 死单 / 异常的 PO，避免把后台 IPC 浪费在永远拉不到的订单上拖慢 UI。
    const SKIP_PO_STATUSES = new Set(["cancelled", "closed", "inbounded", "exception"]);
    const SKIP_EXTERNAL_STATUSES = new Set(["cancelled", "orphan_cleared", "closed", "success"]);

    const jobs: Array<{ key: string; payload: Record<string, unknown> }> = [];
    for (const row of data.purchaseOrders || []) {
      if (!row.externalOrderId) continue;
      if (SKIP_PO_STATUSES.has(String(row.status || ""))) continue;
      if (SKIP_EXTERNAL_STATUSES.has(String(row.externalOrderStatus || ""))) continue;
      if (canSyncDetail && !row.externalOrderDetailSyncedAt) {
        jobs.push({
          key: `detail-${row.id}`,
          payload: { action: "fetch_1688_order_detail", poId: row.id },
        });
      }
      if (canSyncLogistics && !row.externalLogisticsSyncedAt) {
        jobs.push({
          key: `logistics-${row.id}`,
          payload: { action: "sync_1688_logistics", poId: row.id },
        });
      }
    }

    // 单 tick 仅取 1 个任务，串行节流，让 UI 响应不被一阵 IPC 抢完。
    const pendingJobs = jobs
      .filter((job) => !auto1688OrderSupplementKeysRef.current.has(job.key))
      .slice(0, 1);
    if (!pendingJobs.length) return;

    let cancelled = false;
    pendingJobs.forEach((job) => {
      // 不论成功失败都标记为"试过"，避免对死单 / 一直没物流的单循环重试。
      auto1688OrderSupplementKeysRef.current.add(job.key);
      void (async () => {
        try {
          const result = await erp.purchase.action({
            ...job.payload,
            limit: 200,
            includeRequestDetails: false,
            includeOptions: false,
            include1688Meta: false,
          });
          if (cancelled) return;
          const workbench = result?.workbench || await erp.purchase.workbench(buildPurchaseWorkbenchParams());
          if (cancelled) return;
          applyWorkbench(workbench);
          syncWorkbenchOptions(workbench);
        } catch {
          // Background 1688 order maintenance stays quiet; manual payment/sales actions still surface errors.
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [applyWorkbench, buildPurchaseWorkbenchParams, canFinance, canPurchase, canWarehouse, data.purchaseOrders, syncWorkbenchOptions]);

  useEffect(() => {
    if (!erp?.events?.onPurchaseUpdate) {
      return;
    }
    // 大幅延后 broadcast 触发的全量 loadData：从 180ms 延到 1500ms。
    // 用户操作产生的 broadcast 通常在乐观更新已经把 UI 推到目标状态之后到达，
    // 紧跟一次全量重拉只是把"还在路上的服务器返回"覆盖掉，徒增 IPC 往返。
    let refreshTimer: number | null = null;
    const unsubscribe = erp.events.onPurchaseUpdate((payload: { type?: string }) => {
      if (payload?.type !== "purchase:update") return;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void loadData({ silent: true, withSupplemental: false });
      }, 1500);
    });
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [loadData]);

  const runAction = async (
    key: string,
    payload: Record<string, any>,
    successText?: string,
    options?: { timeoutMs?: number; onAddressFailure?: () => void | Promise<void> },
  ) => {
    if (!erp) return null;
    setActingKey(key);
    try {
      const workbenchParams = {
        limit: 200,
        includeRequestDetails: payload.includeRequestDetails,
        includeOptions: payload.includeOptions ?? false,
        include1688Meta: payload.include1688Meta ?? false,
        detailPrId: payload.detailPrId || payload.prId,
      };
      const shouldRefreshWorkbench = payload.refreshWorkbench === true
        || (
          payload.refreshWorkbench !== false
          && payload.includeWorkbench !== false
          && !QUICK_PURCHASE_ACTIONS.has(String(payload.action || ""))
        );
      // 所有含外部 1688 / alphashop 网络调用的 action 都用更长 IPC 超时（120s）；
      // 本地 DB 写动作走默认 60s。命中名字里有 1688/alphashop 即视为慢动作。
      const actionName = String(payload.action || "");
      const isSlowAction = /1688|alphashop/i.test(actionName)
        || actionName === "preview_1688_url_specs"  // 显式列表保险
        || actionName === "refresh_1688_product_detail";
      const explicitTimeoutMs = Number.isFinite(options?.timeoutMs) ? options!.timeoutMs : null;
      const inferredTimeoutMs = isSlowAction ? 120000 : null;
      const finalTimeoutMs = explicitTimeoutMs ?? inferredTimeoutMs ?? undefined;
      // 性能优化：action 不带 workbench（减小 response body 3.4 MB → ~几 KB），
      // 按钮 IPC 立即返回，UI 即时反馈。workbench 在后台 lazy refresh（fire-and-forget），
      // 1-2 秒后 PO 状态/tab 计数自动更新。避免「按钮等 3-5 秒 SQL + 跨海传 3.4 MB」感觉慢。
      const result = await erp.purchase.action({
        ...payload,
        ...workbenchParams,
        includeWorkbench: false,
      }, finalTimeoutMs ? { timeoutMs: finalTimeoutMs } : undefined);
      // 如果服务器还是把 workbench 顺手返了（不该），用它，省一次后台拉
      if (result?.workbench) {
        applyWorkbench(result.workbench);
        syncWorkbenchOptions(result.workbench);
      } else if (shouldRefreshWorkbench) {
        // 后台异步刷新，不阻塞 UI
        void erp.purchase.workbench(workbenchParams).then((workbench: any) => {
          applyWorkbench(workbench);
          syncWorkbenchOptions(workbench);
        }).catch(() => {});
      }
      if (accounts.length === 0) {
        void erp.account.list({ limit: 500 })
          .then((accountRows: unknown) => setAccounts(Array.isArray(accountRows) ? sortStoreAccounts(accountRows as AccountOption[]) : []))
          .catch(() => {});
      }
      if (successText) message.success(successText);
      return result;
    } catch (error: any) {
      const errorMessage = purchaseActionErrorMessage(error, payload.action);
      const rawErrorString = String(error?.message || error || "");
      const errorCode = String(error?.code || "");
      const isAddressFailure = (payload.action === "push_1688_order" || payload.action === "preview_1688_order")
        && (
          /errorCode:(?:AddressId invalid|ADDRESS_ID_INVALID|ADDRESS_INACTIVE|ADDRESS_REMOTE_ID_MISSING)/i.test(rawErrorString)
          || /(?:^|[^A-Z_])(?:ADDRESS_INACTIVE|ADDRESS_REMOTE_ID_MISSING|ADDRESS_ID_INVALID)(?:$|[^A-Z_])/.test(rawErrorString)
          // 兜底：1688 有时不带 errorCode: 前缀，只回裸字串「AddressId invalid」/「Address id invalid」之类
          || /\baddress\s*id\s+invalid\b/i.test(rawErrorString)
          || ["ADDRESS_INACTIVE", "ADDRESS_REMOTE_ID_MISSING", "ADDRESS_ID_INVALID"].includes(errorCode)
        );
      if (payload.action === "rollback_po_status" && errorMessage.includes("Unsupported purchase action")) {
        message.error("当前主控端还没更新/重启，暂不支持采购单回退");
      } else if (payload.action === "delete_po" && errorMessage.includes("Unsupported purchase action")) {
        message.error("当前主控端还没更新/重启，暂不支持删除采购单");
      } else if (payload.action === "delete_po" && /Purchase order not found/i.test(errorMessage)) {
        await loadData({ silent: true });
        if (successText) message.success(successText);
        return {
          deleted: true,
          alreadyMissing: true,
          poId: payload.poId,
        };
      } else if (isAddressFailure) {
        // 推单/预览撞到 1688 地址相关错误：自动同步一遍把失效地址打掉，刷新本地数据，
        // 然后通过 onAddressFailure 回调让调用方（push1688Order）重新弹出地址选择 Modal，
        // 用户只用挑一条新地址即可。透传 purchase1688AccountId / accountId 给 sync，
        // 让后端按本次实际推单的 1688 账号去拉地址，而不是回落到公司默认账号——
        // 否则跨账号同步出来对不上号，失效地址清不掉。
        message.error(errorMessage || "1688 收货地址无效，正在自动同步…");
        const syncPayload: any = { action: "sync_1688_addresses" };
        if ((payload as any).purchase1688AccountId) syncPayload.purchase1688AccountId = (payload as any).purchase1688AccountId;
        if ((payload as any).accountId) syncPayload.accountId = (payload as any).accountId;
        try {
          const syncResult: any = await erp.purchase.action(syncPayload, { timeoutMs: 120000 });
          const summary = syncResult?.result || syncResult || {};
          const deactivated = Number(summary.deactivatedCount || 0);
          const total = Number(summary.addressCount || 0);
          if (deactivated > 0) {
            message.warning(`已自动同步 1688 地址：清理了 ${deactivated} 条失效，当前可用 ${total} 条，请重新选择地址`);
          } else if (total > 0) {
            message.info(`已自动同步 1688 地址：当前可用 ${total} 条，请重新选择地址`);
          } else {
            message.warning("1688 没返回该买家账号的地址，请先到 1688 后台维护好收货地址再重试");
          }
          await loadData({ silent: true }).catch(() => {});
        } catch (syncError: any) {
          const syncMsg = cleanRemoteErrorMessage(syncError) || "未知错误";
          message.error(`1688 地址自动同步失败：${syncMsg}`);
        }
        if (typeof options?.onAddressFailure === "function") {
          try {
            await options.onAddressFailure();
          } catch {
            // 重弹 picker 失败不致命，至少前面的 toast 已经把信息告诉用户了
          }
        }
      } else {
        message.error(errorMessage || "操作失败");
      }
      return null;
    } finally {
      setActingKey(null);
    }
  };

  // 乐观跑：先把行 patch 成预期状态，再发 IPC，失败时回滚。
  const runActionOptimistic = async (
    key: string,
    payload: Record<string, any>,
    successText: string | undefined,
    optimistic: { poId: string; patch: Partial<PurchaseOrderRow> },
  ) => {
    const snapshot = patchPurchaseOrderRow(optimistic.poId, optimistic.patch);
    const result = await runAction(key, { includeWorkbench: false, ...payload }, successText);
    if (!result && snapshot) {
      // runAction 失败时已弹出错误提示且返回 null，把行复位回去。
      patchPurchaseOrderRow(optimistic.poId, snapshot);
    } else {
      patchPurchaseOrderFromResult(result);
    }
    return result;
  };

  const canRollbackPurchaseOrder = (row: PurchaseOrderRow) => {
    const target = getPurchaseOrderRollbackTarget(row);
    if (!target) return false;
    // pending_finance_approval 是历史遗留状态（财审环节已合并进「提交付款」一步），
    // 新单不会进；旧单上的回退按钮（原「取消财审」）已无业务价值，直接隐藏，
    // 历史单只露「提交付款」一个推进入口即可。
    if (row.status === "pending_finance_approval") return false;
    // 没有了财务审批环节，approved_to_pay 退回 pushed_pending_price 由采购操作；
    // paid 状态的回退仍由财务（撤销付款确认）。
    if (row.status === "approved_to_pay") return canPurchase || canFinance;
    if (row.status === "paid") return canFinance;
    if (row.status === "arrived") return canWarehouse;
    return canPurchase;
  };

  const closeDetailDrawer = () => {
    if (detailDrawerMode === "imageSearch" && detailPrId) {
      setMinimizedImageSearchPrId(detailPrId);
      setDetailDrawerOpen(false);
      return;
    }
    setDetailDrawerOpen(false);
    setDetailPrId(null);
  };

  const reopenMinimizedImageSearch = () => {
    if (!minimizedImageSearchPrId) return;
    setDetailDrawerMode("imageSearch");
    setDetailPrId(minimizedImageSearchPrId);
    setDetailDrawerOpen(true);
    setMinimizedImageSearchPrId(null);
  };

  const clampMinimizedImageSearchPosition = useCallback((position: { left: number; top: number }) => {
    if (typeof window === "undefined") return position;
    const maxLeft = Math.max(
      MINIMIZED_IMAGE_SEARCH_MARGIN,
      window.innerWidth - MINIMIZED_IMAGE_SEARCH_WIDTH - MINIMIZED_IMAGE_SEARCH_MARGIN,
    );
    const maxTop = Math.max(
      MINIMIZED_IMAGE_SEARCH_MARGIN,
      window.innerHeight - MINIMIZED_IMAGE_SEARCH_HEIGHT - MINIMIZED_IMAGE_SEARCH_MARGIN,
    );
    return {
      left: Math.min(Math.max(MINIMIZED_IMAGE_SEARCH_MARGIN, position.left), maxLeft),
      top: Math.min(Math.max(MINIMIZED_IMAGE_SEARCH_MARGIN, position.top), maxTop),
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setMinimizedImageSearchPosition((position) => clampMinimizedImageSearchPosition(position));
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampMinimizedImageSearchPosition, minimizedImageSearchPrId]);

  const handleMinimizedImageSearchPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    minimizedImageSearchDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: minimizedImageSearchPosition.left,
      originTop: minimizedImageSearchPosition.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleMinimizedImageSearchPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = minimizedImageSearchDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      drag.moved = true;
    }
    if (!drag.moved) return;
    event.preventDefault();
    setMinimizedImageSearchPosition(clampMinimizedImageSearchPosition({
      left: drag.originLeft + deltaX,
      top: drag.originTop + deltaY,
    }));
  };

  const handleMinimizedImageSearchPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = minimizedImageSearchDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    minimizedImageSearchDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.moved) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    reopenMinimizedImageSearch();
  };

  const handleMinimizedImageSearchPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    const drag = minimizedImageSearchDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    minimizedImageSearchDragRef.current = null;
  };

  const rollbackPurchaseOrder = async (row: PurchaseOrderRow) => {
    const target = getPurchaseOrderRollbackTarget(row);
    const targetLabel = target ? (PO_STATUS_LABELS[target] || target) : "上一状态";
    if (target) {
      await runActionOptimistic(
        `rollback-po-${row.id}`,
        { action: "rollback_po_status", poId: row.id },
        `已回退到${targetLabel}`,
        { poId: row.id, patch: { status: target } },
      );
    } else {
      await runAction(
        `rollback-po-${row.id}`,
        { action: "rollback_po_status", poId: row.id },
        `已回退到${targetLabel}`,
      );
    }
  };

  const deletePurchaseOrder = async (row: PurchaseOrderRow) => {
    // 乐观删除：UI 立即移除该行，IPC 失败再回滚（一并取消未刷新的列表加载）
    let snapshot: PurchaseOrderRow | null = null;
    setData((prev) => {
      const list = prev.purchaseOrders || [];
      const idx = list.findIndex((r) => r.id === row.id);
      if (idx === -1) return prev;
      snapshot = list[idx];
      return { ...prev, purchaseOrders: list.filter((r) => r.id !== row.id) };
    });
    setSelectedPoIds((previous) => previous.filter((id) => id !== row.id));
    const result = await runAction(
      `delete-po-${row.id}`,
      { action: "delete_po", poId: row.id, includeWorkbench: false },
      "采购单已删除",
    );
    if (!result && snapshot) {
      // IPC 失败：把行加回去
      setData((prev) => ({ ...prev, purchaseOrders: [snapshot!, ...(prev.purchaseOrders || [])] }));
    } else {
      upsertPurchaseRequestRow(result?.result?.purchaseRequest || result?.purchaseRequest);
    }
  };

  const openDetail = async (row: PurchaseRequestRow) => {
    setDetailDrawerMode("collaboration");
    setDetailPrId(row.id);
    setDetailDrawerOpen(true);
    setMinimizedImageSearchPrId(null);
    await runAction(`read-${row.id}`, {
      action: "mark_read",
      prId: row.id,
      includeRequestDetails: false,
      detailPrId: row.id,
    });
  };

  const openPurchaseSettings = () => {
    purchaseSettingsForm.setFieldsValue({
      inquiryTemplate: data.purchaseSettings?.inquiryTemplate || DEFAULT_PURCHASE_INQUIRY_TEMPLATE,
    });
    setPurchaseSettingsOpen(true);
  };

  const savePurchaseSettings = async (values: PurchaseSettingsFormValues) => {
    const template = String(values.inquiryTemplate || "").trim();
    const result = await runAction(
      "save-purchase-settings",
      {
        action: "save_purchase_settings",
        inquiryTemplate: template || DEFAULT_PURCHASE_INQUIRY_TEMPLATE,
      },
      "询盘设置已保存",
    );
    if (result) setPurchaseSettingsOpen(false);
  };

  const sync1688Addresses = async () => {
    const result = await runAction("sync-1688-addresses", { action: "sync_1688_addresses" });
    if (!result) return result;
    const summary = result?.result || result || {};
    const added = Number(summary.addedCount || 0);
    const updated = Number(summary.updatedCount || 0);
    const deactivated = Number(summary.deactivatedCount || 0);
    const total = Number(summary.addressCount || 0);
    if (added || deactivated) {
      message.success(`1688 地址已同步：新增 ${added}、更新 ${updated}、失效 ${deactivated}（共 ${total} 条）`);
    } else if (total) {
      message.info(`1688 地址已是最新（共 ${total} 条）`);
    } else {
      message.warning("未拉到 1688 收货地址，请到 1688 后台先维护一条收货地址再同步");
    }
    return result;
  };

  const open1688AddressBackend = () => {
    window.open("https://work.1688.com/", "_blank", "noopener,noreferrer");
  };

  const syncInquiryResults = async () => {
    const result = await runAction(
      "sync-inquiry-results",
      {
        action: "sync_1688_inquiry_results",
        limit: 50,
      },
    );
    if (!result) return;
    const syncedCount = Number(result?.result?.syncedCount || 0);
    const failedCount = Number(result?.result?.failedCount || 0);
    if (syncedCount || failedCount) {
      message.success(`询盘结果已同步 ${syncedCount} 个，失败 ${failedCount} 个`);
    } else {
      message.info("没有待同步的询盘结果");
    }
  };

  const openRequestCreateModal = (mode: RequestCreateMode) => {
    setRequestCreateMode(mode);
    requestForm.resetFields();
    setRequestUploadImages([]);
    requestForm.setFieldsValue({
      requestedQty: 1,
    });
    setRequestOpen(true);
  };

  const openDirectPoCreateModal = () => {
    directPoForm.resetFields();
    directPoForm.setFieldsValue({ items: [{ qty: 1 }] });
    setDirectPoOpen(true);
  };

  const openInquiryDialog = (row: PurchaseRequestRow, candidateIds: string[] = []) => {
    const selectableIds = (row.candidates || [])
      .filter((candidate) => !candidateInquirySent(candidate))
      .map((candidate) => candidate.id);
    const selectedIds = (candidateIds.length ? candidateIds : selectableIds.slice(0, AUTO_INQUIRY_LIMIT))
      .filter((id) => selectableIds.includes(id));
    if (!selectedIds.length) {
      message.warning("没有可询盘的候选商品");
      return;
    }
    setInquiryDialogPrId(row.id);
    setInquiryDialogCandidateIds(selectedIds);
    setSelectedInquiryCandidateIds(selectedIds);
    inquiryDialogForm.setFieldsValue({
      inquiryMessage: data.purchaseSettings?.inquiryTemplate || DEFAULT_PURCHASE_INQUIRY_TEMPLATE,
    });
  };

  const closeInquiryDialog = () => {
    setInquiryDialogPrId(null);
    setInquiryDialogCandidateIds([]);
  };

  const submitCollaborationComment = async () => {
    const body = collaborationDraft.trim();
    if (!detailPr || (!body && collaborationUploadImages.length === 0)) return;
    const result = await runAction(
      `comment-${detailPr.id}`,
      {
        action: "add_comment",
        prId: detailPr.id,
        body: body || "图片",
        imageDataUrls: collaborationUploadImages.map((item) => item.dataUrl),
        imageFileNames: collaborationUploadImages.map((item) => item.fileName),
      },
      "协作留言已发送",
    );
    if (result) {
      setCollaborationDraft("");
      setCollaborationUploadImages([]);
    }
  };

  const deletePurchaseRequest = async (row: PurchaseRequestRow) => {
    // 乐观删除 PR
    let snapshot: PurchaseRequestRow | null = null;
    setData((prev) => {
      const list = prev.purchaseRequests || [];
      const idx = list.findIndex((r) => r.id === row.id);
      if (idx === -1) return prev;
      snapshot = list[idx];
      return { ...prev, purchaseRequests: list.filter((r) => r.id !== row.id) };
    });
    if (detailPrId === row.id) {
      setDetailDrawerOpen(false);
      setDetailPrId(null);
    }
    if (minimizedImageSearchPrId === row.id) setMinimizedImageSearchPrId(null);
    if (quotePrId === row.id) setQuotePrId(null);
    if (source1688PrId === row.id) setSource1688PrId(null);
    const result = await runAction(
      `delete-pr-${row.id}`,
      { action: "cancel_pr", prId: row.id },
      "找品已删除",
    );
    if (!result && snapshot) {
      setData((prev) => ({ ...prev, purchaseRequests: [snapshot!, ...(prev.purchaseRequests || [])] }));
    }
  };

  const open1688SourceModal = (row: PurchaseRequestRow) => {
    setSource1688PrId(row.id);
    source1688Form.resetFields();
    source1688Form.setFieldsValue({
      keyword: row.productName || row.internalSkuCode || "",
      pageSize: 10,
    });
  };

  const resolveSkuForPurchaseInput = async (skuInput: string) => {
    const value = String(skuInput || "").trim();
    if (!value) return null;
    let found = skus.find((sku) => sku.id === value || sku.internalSkuCode === value) || null;
    if (!found) {
      try {
        const list = await erp?.sku?.list?.({ search: value, limit: 50 } as any);
        const rows: SkuOption[] = Array.isArray(list) ? list : [];
        found = rows.find((sku) => sku.id === value || sku.internalSkuCode === value) || null;
        if (found) {
          setSkus((previous) => {
            const map = new Map(previous.map((sku) => [sku.id, sku]));
            map.set(found!.id, found!);
            return Array.from(map.values());
          });
        }
      } catch {
        found = null;
      }
    }
    return found;
  };

  const handleCreateRequest = async (values: RequestFormValues) => {
    if (!erp) return;
    const selectedSkuIds = Array.isArray(values.skuIds)
      ? values.skuIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    if (selectedSkuIds.length === 0) {
      message.error("请选择商品编码");
      return;
    }

    // mode="tags" 允许用户输入编码后立即回车成 tag，此时 handleSkuSearch 的
    // 异步搜索结果可能还没进 skus（跨海 client 模式 RTT 1-2s），本地 find 会落空。
    // 对本地找不到的 code 按编码同步兜底查一次后端，避免明明有商品资料却误报「未找到」。
    const selectedSkus: SkuOption[] = [];
    const missingSkuIds: string[] = [];
    for (const skuId of selectedSkuIds) {
      let found = skus.find((sku) => sku.id === skuId || sku.internalSkuCode === skuId);
      if (!found) {
        try {
          const list = await erp?.sku?.list?.({ search: skuId, limit: 50 } as any);
          const rows: SkuOption[] = Array.isArray(list) ? list : [];
          found = rows.find((sku) => sku.id === skuId || sku.internalSkuCode === skuId);
        } catch { /* 兜底查询失败按未找到处理 */ }
      }
      if (found) selectedSkus.push(found);
      else missingSkuIds.push(skuId);
    }
    if (missingSkuIds.length > 0) {
      message.error(`未找到商品编码：${missingSkuIds.slice(0, 3).join("、")}`);
      return;
    }
    const uniqueSelectedSkus = Array.from(new Map(selectedSkus.map((sku) => [sku.id, sku])).values());
    const missingStoreSkus = uniqueSelectedSkus.filter((sku) => !sku.accountId);
    if (missingStoreSkus.length > 0) {
      message.error("有商品资料还没有选择所属店铺，请先在商品资料里补齐");
      return;
    }

    const imageDataUrls = requestUploadImages.map((item) => item.dataUrl);
    const imageFileNames = requestUploadImages.map((item) => item.fileName);
    const isOptimizationCreate = requestCreateMode === "optimization";
    const requestReason = isOptimizationCreate ? PURCHASE_REQUEST_REASON_OPTIMIZATION : PURCHASE_REQUEST_REASON_SOURCING;
    let skippedImages = false;
    setActingKey("create-pr");
    let lastResult: any = null;
    const createdPrIds: string[] = [];
    try {
      for (let i = 0; i < uniqueSelectedSkus.length; i++) {
        const sku = uniqueSelectedSkus[i];
        const isLast = i === uniqueSelectedSkus.length - 1;
        const payload = {
          ...FAST_PURCHASE_WORKBENCH_PARAMS,
          action: "create_pr",
          accountId: sku.accountId,
          skuId: sku.id,
          requestedQty: values.requestedQty,
          targetUnitCost: values.targetUnitCost,
          specText: values.specText,
          reason: requestReason,
          evidenceText: values.evidenceText,
          // 只在最后一笔请求里要 workbench，省掉中间多余的全量刷新
          includeWorkbench: isLast,
          ...(skippedImages ? {} : {
            imageDataUrl: imageDataUrls[0],
            imageFileName: imageFileNames[0],
            imageDataUrls,
            imageFileNames,
          }),
        };
        try {
          lastResult = await erp.purchase.action(payload);
        } catch (error) {
          if (!skippedImages && imageDataUrls.length > 0 && isRequestBodyTooLarge(error)) {
            skippedImages = true;
            lastResult = await erp.purchase.action({
              ...FAST_PURCHASE_WORKBENCH_PARAMS,
              action: "create_pr",
              accountId: sku.accountId,
              skuId: sku.id,
              requestedQty: values.requestedQty,
              targetUnitCost: values.targetUnitCost,
              specText: values.specText,
              reason: requestReason,
              evidenceText: values.evidenceText,
              includeWorkbench: isLast,
            });
          } else {
            throw error;
          }
        }
        // 收集刚创建的 PR id，等 workbench 同步后用于自动触发 generate PO + 推 1688
        const newPrId = String(
          lastResult?.result?.purchaseRequest?.id
          || lastResult?.purchaseRequest?.id
          || lastResult?.result?.id
          || "",
        );
        if (newPrId) createdPrIds.push(newPrId);
      }
      // 关 Modal + 提示先行；workbench 用 create_pr 接口自带的，
      // 没有再回退去拉一次（旧后端兼容）
      message.success(uniqueSelectedSkus.length > 1 ? `已提交 ${uniqueSelectedSkus.length} 条${requestReason}` : `${requestReason}已提交`);
      if (skippedImages) message.warning(`图片过大，${requestReason}已提交，图片未上传`);
      setRequestOpen(false);
      setRequestUploadImages([]);
      requestForm.resetFields();
      setActiveQueueKey(isOptimizationCreate ? "request_pending_optimization" : "request_pending_sourcing");
      const wb = lastResult?.workbench;
      if (wb && typeof wb === "object") {
        applyWorkbench(wb);
        if (Array.isArray(wb.skuOptions)) setSkus(wb.skuOptions);
        if (Array.isArray(wb.supplierOptions)) setSuppliers(wb.supplierOptions);
      } else {
        // 后端没返 workbench 时再补一次（不阻塞 modal 关闭）
        void erp.purchase.workbench(buildPurchaseWorkbenchParams()).then((wb2: any) => {
          applyWorkbench(wb2);
          if (Array.isArray(wb2?.skuOptions)) setSkus(wb2.skuOptions);
          if (Array.isArray(wb2?.supplierOptions)) setSuppliers(wb2.supplierOptions);
        }).catch(() => {});
      }
      // 单条找品创建时：有映射 / 候选 / SKU 供应商才自动 generate PO + 自动推 1688。
      // 优化需求只进入优化队列，避免刚新建就因为历史映射被直接转成采购单。
      // 多 PR 不自动触发推单 Modal，避免多个 Modal 互相覆盖；用户去列表逐个推。
      if (!isOptimizationCreate && createdPrIds.length === 1) {
        const targetPrId = createdPrIds[0];
        const refreshedRequests = wb && Array.isArray((wb as any).purchaseRequests)
          ? ((wb as any).purchaseRequests as any[])
          : [];
        const row = refreshedRequests.find((r: any) => String(r?.id || "") === targetPrId);
        if (row) {
          const hasMapping = Number(row.mappingCount || 0) > 0;
          const hasCandidates = Boolean(row.candidates?.length || row.candidateCount);
          const hasSkuSupplier = Boolean(row.skuSupplierId || row.skuSupplierName);
          if (hasMapping || hasCandidates || hasSkuSupplier) {
            // setTimeout 0：先让 Modal close + workbench apply 渲染稳定，再触发后续 Modal
            setTimeout(() => {
              void generatePurchaseOrderForRow(row as PurchaseRequestRow, { silent: true });
            }, 0);
          }
        }
      }
    } catch (error: any) {
      message.error(error?.message || "采购单创建失败");
    } finally {
      setActingKey(null);
    }
  };

  const handleDirectPoSubmit = async (values: DirectPoFormValues) => {
    if (!erp) return;
    const rawItems = Array.isArray(values.items) ? values.items : [];
    if (!rawItems.length) {
      message.error("请至少添加一条采购明细");
      return;
    }

    const lineItems: Array<{
      skuId: string;
      qty: number;
    }> = [];
    let accountId = "";

    for (let index = 0; index < rawItems.length; index += 1) {
      const item = rawItems[index];
      const skuInput = Array.isArray(item.skuIds)
        ? String(item.skuIds[0] || "").trim()
        : "";
      if (!skuInput) {
        message.error(`第 ${index + 1} 行请选择商品编码`);
        return;
      }
      const sku = await resolveSkuForPurchaseInput(skuInput);
      if (!sku) {
        message.error(`未找到商品编码：${skuInput}`);
        return;
      }
      if (!sku.accountId) {
        message.error(`商品 ${sku.internalSkuCode || sku.id} 还没有选择所属店铺，请先在商品资料里补齐`);
        return;
      }
      if (accountId && sku.accountId !== accountId) {
        message.error("同一张采购单里的商品必须属于同一个店铺");
        return;
      }
      accountId = sku.accountId;
      const qty = Number(item.qty || 0);
      if (!Number.isInteger(qty) || qty <= 0) {
        message.error(`第 ${index + 1} 行请输入采购数量`);
        return;
      }
      lineItems.push({
        skuId: sku.id,
        qty,
      });
    }

    const createResult = await runAction("direct-po", {
      ...FAST_PURCHASE_WORKBENCH_PARAMS,
      action: "create_direct_po",
      accountId,
      lines: lineItems,
      offlinePurchase: true,
      includeWorkbench: false,
      refreshWorkbench: false,
    }, "采购单已创建");
    if (!createResult) return;
    const generatedPo = createResult?.result?.purchaseOrder as PurchaseOrderRow | undefined;
    setDirectPoOpen(false);
    directPoForm.resetFields();
    if (generatedPo?.id) {
      upsertGeneratedPurchaseOrder(generatedPo.prId || "", generatedPo);
      focusPurchaseOrder(generatedPo, generatedPo.prId || undefined);
    } else {
      void loadData({ silent: true, withSupplemental: false });
    }
  };

  const offlinePoInitialValues = useMemo<Partial<OfflinePoFormValues>>(() => {
    if (!offlinePoTarget) return {};
    if (offlinePoTarget.mode === "create") {
      const pr = offlinePoTarget.pr;
      return { unitPrice: pr.targetUnitCost ?? undefined, qty: pr.requestedQty ?? 1 };
    }
    const po = offlinePoTarget.po;
    return {
      supplierId: po.supplierId ?? undefined,
      supplierName: po.supplierName || undefined,
      unitPrice: po.unitCost ?? undefined,
      logisticsFee: po.logisticsFee ?? undefined,
      qty: po.totalQty ?? 1,
    };
  }, [offlinePoTarget]);

  const offlinePoSubmitting = offlinePoTarget
    ? (offlinePoTarget.mode === "create"
      ? actingKey === `po-${offlinePoTarget.pr.id}`
      : offlinePoTarget.mode === "edit"
        ? actingKey === `edit-po-${offlinePoTarget.po.id}`
        : actingKey === `convert-po-${offlinePoTarget.po.id}`)
    : false;

  const openOfflinePoCreate = (pr: PurchaseRequestRow) => setOfflinePoTarget({ mode: "create", pr });
  const openOfflinePoEdit = (po: PurchaseOrderRow) => setOfflinePoTarget({ mode: "edit", po });
  const openOfflinePoConvert = (po: PurchaseOrderRow) => setOfflinePoTarget({ mode: "convert", po });

  const handleOfflinePoSubmit = async (values: OfflinePoFormValues) => {
    if (!offlinePoTarget) return;
    const supplierId = values.supplierId || undefined;
    const supplierName = values.supplierName?.trim() || undefined;
    if (offlinePoTarget.mode === "create") {
      const pr = offlinePoTarget.pr;
      const result = await runAction(`po-${pr.id}`, {
        action: "generate_po",
        prId: pr.id,
        qty: values.qty,
        offlinePurchase: true,
        supplierId,
        supplierName,
        unitPrice: values.unitPrice,
        logisticsFee: values.logisticsFee,
      }, "线下采购单已生成");
      if (!result) return;
      const generatedPo = result?.result?.purchaseOrder as PurchaseOrderRow | undefined;
      if (generatedPo?.id) {
        upsertGeneratedPurchaseOrder(pr.id, generatedPo);
        focusPurchaseOrder(generatedPo, pr.id);
      }
    } else if (offlinePoTarget.mode === "edit") {
      const po = offlinePoTarget.po;
      const result = await runAction(`edit-po-${po.id}`, {
        action: "update_offline_po",
        poId: po.id,
        qty: values.qty,
        supplierId,
        supplierName,
        unitPrice: values.unitPrice,
        logisticsFee: values.logisticsFee,
      }, "采购单已更新");
      if (!result) return;
    } else {
      const po = offlinePoTarget.po;
      const result = await runAction(`convert-po-${po.id}`, {
        action: "convert_po_to_offline",
        poId: po.id,
        qty: values.qty,
        supplierId,
        supplierName,
        unitPrice: values.unitPrice,
        logisticsFee: values.logisticsFee,
      }, po.externalOrderId ? "已取消 1688 原单并转为线下采购" : "已转为线下采购");
      if (!result) return;
    }
    setOfflinePoTarget(null);
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

  const openBuyerFeedback = useCallback((row: PurchaseRequestRow) => {
    setBuyerFeedbackPrId(row.id);
    buyerFeedbackForm.setFieldsValue({
      buyerUnitCost: row.buyerUnitCost ?? getPurchaseRequestFoundUnitPrice(row) ?? row.targetUnitCost ?? undefined,
      buyerRemark: row.buyerRemark || "",
    });
  }, [buyerFeedbackForm]);

  const handleBuyerFeedback = async (values: BuyerFeedbackFormValues) => {
    if (!buyerFeedbackPr) return;
    const result = await runAction(`buyer-feedback-${buyerFeedbackPr.id}`, {
      action: "update_purchase_request_feedback",
      prId: buyerFeedbackPr.id,
      buyerUnitCost: values.buyerUnitCost,
      buyerRemark: values.buyerRemark,
    }, "采购回填已保存");
    if (result) {
      setBuyerFeedbackPrId(null);
      buyerFeedbackForm.resetFields();
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
      importLimit: IMAGE_SEARCH_PAGE_SIZE,
      includeWorkbench: false,
    }, undefined, { timeoutMs: 105000 });
    if (result) {
      const importedCount = Number(result.result?.importedCount || 0);
      setImageSearchNextPageByPrId((prev) => ({ ...prev, [row.id]: beginPage + 1 }));
      if (importedCount <= 0) {
        void loadData({ silent: true, withSupplemental: false });
        if (!silent) message.warning(imageSearchEmptyText(result));
        return result;
      }
      const nextWorkbench = result.workbench || await erp.purchase.workbench({
        ...buildPurchaseWorkbenchParams(),
        detailPrId: row.id,
      }, { timeoutMs: 120000 }).catch(() => null) || {};
      if (hasWorkbenchSnapshot(nextWorkbench)) {
        applyWorkbench(nextWorkbench);
        syncWorkbenchOptions(nextWorkbench);
      }
      const nextPr = (nextWorkbench.purchaseRequests || []).find((item: PurchaseRequestRow) => item.id === row.id);
      if (nextPr?.id) {
        setDetailDrawerMode("imageSearch");
        setDetailPrId(nextPr.id);
        setDetailDrawerOpen(true);
        setMinimizedImageSearchPrId(null);
        setActiveQueueKey("all");
      }
      if (!silent) message.success(beginPage > 1 ? `已追加 ${importedCount} 个候选` : `已导入 ${importedCount} 个候选`);
    }
    return result;
  };

  const handleAutoInquiryForRow = async (row: PurchaseRequestRow, candidateIds: string[] = [], inquiryMessage?: string) => {
    let searchResult: any = null;
    const hasCandidates = Boolean(row.candidates?.length || row.candidateCount);
    const selectedCandidateIds = candidateIds.filter(Boolean);
    if (!selectedCandidateIds.length && !hasCandidates) {
      searchResult = await runImageSearchForRow(
        row,
        Math.min(nextImageSearchPageForRow(row), IMAGE_SEARCH_MAX_PAGE),
        true,
      );
      const importedCount = Number(searchResult?.result?.importedCount || 0);
      if (!searchResult || importedCount <= 0) {
        message.warning(searchResult ? imageSearchEmptyText(searchResult) : "没有可询盘的候选商品");
        return null;
      }
    }

    const nextWorkbench = searchResult?.workbench || {};
    const sourcePr = (nextWorkbench.purchaseRequests || []).find((item: PurchaseRequestRow) => item.id === row.id)
      || data.purchaseRequests?.find((item) => item.id === row.id)
      || row;
    const availableCandidates = (sourcePr.candidates || []).filter((candidate: SourcingCandidateRow) => !candidateInquirySent(candidate));
    const selectedSet = new Set(selectedCandidateIds);
    const inquiryCandidates = selectedCandidateIds.length
      ? availableCandidates.filter((candidate: SourcingCandidateRow) => selectedSet.has(candidate.id))
      : availableCandidates.slice(0, AUTO_INQUIRY_LIMIT);

    if (!inquiryCandidates.length) {
      message.warning("没有可询盘的候选商品");
      return null;
    }
    if (!erp?.purchase?.local1688Inquiry) {
      message.error("本地 1688 浏览器询盘需要在桌面软件执行，请更新并重启桌面端");
      return null;
    }

    const actionKey = `1688-inquiry-${row.id}`;
    const finalInquiryMessage = inquiryMessage?.trim()
      || data.purchaseSettings?.inquiryTemplate
      || DEFAULT_PURCHASE_INQUIRY_TEMPLATE;
    let localResult: any = null;
    setActingKey(actionKey);
    try {
      localResult = await erp.purchase.local1688Inquiry({
        prId: row.id,
        candidates: inquiryCandidates.map(buildLocal1688InquiryCandidate),
        inquiryMessage: finalInquiryMessage,
      });
    } catch (error: any) {
      message.error(error?.message || "本地 1688 浏览器询盘失败");
      return null;
    } finally {
      setActingKey(null);
    }

    const returnedCandidateIds = Array.isArray(localResult?.results)
      ? localResult.results.map((item: any) => String(item?.candidateId || "")).filter(Boolean)
      : [];
    const recordCandidateIds = returnedCandidateIds.length
      ? returnedCandidateIds
      : inquiryCandidates.map((candidate: SourcingCandidateRow) => candidate.id);
    const result = await runAction(actionKey, {
      action: "record_local_1688_inquiry_results",
      prId: row.id,
      candidateIds: recordCandidateIds,
      browserResults: localResult?.results || [],
      localResult,
      inquiryMessage: finalInquiryMessage,
      inquiryTemplate: data.purchaseSettings?.inquiryTemplate || DEFAULT_PURCHASE_INQUIRY_TEMPLATE,
    });
    if (!result) return null;
    const inquiryCount = Number(result?.result?.inquiryCount || 0);
    const failedCount = Number(result?.result?.failedCount || 0);
    if (inquiryCount > 0) {
      message.success(failedCount
        ? `已发起询盘 ${inquiryCount} 个，失败 ${failedCount} 个`
        : (selectedCandidateIds.length ? `已批量询盘 ${inquiryCount} 个候选` : `已自动询盘 ${inquiryCount} 个候选`));
      const nextWorkbench = result.workbench || searchResult?.workbench || {};
      const nextPr = (nextWorkbench.purchaseRequests || []).find((item: PurchaseRequestRow) => item.id === row.id);
      if (nextPr?.id) {
        setDetailDrawerMode("imageSearch");
        setDetailPrId(nextPr.id);
        setDetailDrawerOpen(true);
        setMinimizedImageSearchPrId(null);
        setActiveQueueKey("all");
      }
      setSelectedInquiryCandidateIds([]);
    } else {
      message.warning(failedCount ? `询盘失败 ${failedCount} 个，点候选商品的询盘状态查看原因` : "没有新的候选商品需要询盘");
    }
    return result;
  };

  const submitInquiryDialog = async (values: InquiryDialogFormValues) => {
    if (!inquiryDialogPr) return;
    const result = await handleAutoInquiryForRow(
      inquiryDialogPr,
      inquiryDialogCandidateIds,
      values.inquiryMessage || DEFAULT_PURCHASE_INQUIRY_TEMPLATE,
    );
    if (result) closeInquiryDialog();
  };

  const openImageSearch = async (row: PurchaseRequestRow) => {
    setDetailDrawerMode("imageSearch");
    setDetailPrId(row.id);
    setDetailDrawerOpen(true);
    setMinimizedImageSearchPrId(null);
    setSelectedInquiryCandidateIds([]);
    await runImageSearchForRow(row, Math.min(nextImageSearchPageForRow(row), IMAGE_SEARCH_MAX_PAGE));
  };

  const toggleInquiryCandidate = (candidateId: string, checked: boolean) => {
    setSelectedInquiryCandidateIds((current) => {
      if (checked) return current.includes(candidateId) ? current : [...current, candidateId];
      return current.filter((id) => id !== candidateId);
    });
  };

  const toggleAllInquiryCandidates = (checked: boolean) => {
    setSelectedInquiryCandidateIds(checked ? selectableInquiryCandidateIds : []);
  };

  const loadMoreImageCandidates = async (row: PurchaseRequestRow, scrollElement?: HTMLDivElement) => {
    if (loadingMorePrId === row.id || actingKey === `1688-image-${row.id}`) return;
    const candidateCount = row.candidates?.length || row.candidateCount || 0;
    const nextPage = imageSearchNextPageByPrId[row.id] || Math.floor(candidateCount / IMAGE_SEARCH_PAGE_SIZE) + 1;
    if (nextPage < 2 || nextPage > IMAGE_SEARCH_MAX_PAGE) return;
    if (scrollElement) {
      pendingCandidateScrollRestoreRef.current = {
        prId: row.id,
        scrollTop: scrollElement.scrollTop,
        scrollHeight: scrollElement.scrollHeight,
      };
    }
    setLoadingMorePrId(row.id);
    try {
      const result = await runImageSearchForRow(row, nextPage, true);
      if (!Number(result?.result?.importedCount || 0)) {
        pendingCandidateScrollRestoreRef.current = null;
      }
    } finally {
      setLoadingMorePrId(null);
    }
  };

  const nextImageSearchPageForRow = (row: PurchaseRequestRow) => {
    const candidateCount = row.candidates?.length || row.candidateCount || 0;
    return imageSearchNextPageByPrId[row.id] || Math.floor(candidateCount / IMAGE_SEARCH_PAGE_SIZE) + 1;
  };

  const handleCandidateScroll = (event: UIEvent<HTMLDivElement>, row: PurchaseRequestRow) => {
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom > CANDIDATE_SCROLL_REARM_PX) {
      candidateScrollLockRef.current[row.id] = false;
    }
    if (distanceToBottom > CANDIDATE_SCROLL_BOTTOM_PX) return;
    if (candidateScrollLockRef.current[row.id]) return;
    candidateScrollLockRef.current[row.id] = true;
    void loadMoreImageCandidates(row, target);
  };

  const openCandidateUrl = async (candidate: SourcingCandidateRow) => {
    const url = candidateUrl(candidate);
    if (!url) {
      message.warning("这个候选还没有商品链接");
      return;
    }

    if (erp?.purchase?.open1688Detail) {
      try {
        const result = await erp.purchase.open1688Detail({ url });
        if (result?.ok) return;
        message.warning(result?.reason ? `1688 浏览器打开失败：${result.reason}` : "1688 浏览器打开失败，已改用普通窗口打开");
      } catch (error: any) {
        message.warning(error?.message ? `1688 浏览器打开失败：${error.message}` : "1688 浏览器打开失败，已改用普通窗口打开");
      }
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

  const setCollaborationImageFiles = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const slotsLeft = Math.max(0, MAX_COMMENT_IMAGES - collaborationUploadImages.length);
    if (slotsLeft === 0) {
      message.warning(`最多添加 ${MAX_COMMENT_IMAGES} 张图片`);
      return;
    }
    const prepared = await Promise.all(imageFiles.slice(0, slotsLeft).map(async (file) => ({
      uid: `${file.name || "paste"}-${file.lastModified || Date.now()}-${file.size}-${Math.random().toString(36).slice(2)}`,
      fileName: file.name || "已粘贴图片",
      dataUrl: await prepareUploadImage(file),
    })));
    setCollaborationUploadImages((previous) => [...previous, ...prepared].slice(0, MAX_COMMENT_IMAGES));
    message.success(`已添加 ${prepared.length} 张图片`);
  };

  const handleCollaborationImageUpload = async (file: File) => {
    try {
      await setCollaborationImageFiles([file]);
    } catch (error: any) {
      message.error(error?.message || "图片处理失败");
    }
    return Upload.LIST_IGNORE;
  };

  const handleCollaborationPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
    const itemFiles = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const imageFiles = [...files, ...itemFiles];
    if (imageFiles.length === 0) return;
    event.preventDefault();
    void setCollaborationImageFiles(imageFiles);
  };

  const preview1688Order = async (
    row: PurchaseOrderRow,
    options: { quiet?: boolean; deliveryAddressId?: string; purchase1688AccountId?: string; onAddressFailure?: () => void | Promise<void> } = {},
  ) => {
    return runAction(`1688-preview-${row.id}`, {
      action: "preview_1688_order",
      poId: row.id,
      ...(options.deliveryAddressId ? { deliveryAddressId: options.deliveryAddressId } : {}),
      ...(options.purchase1688AccountId ? { purchase1688AccountId: options.purchase1688AccountId } : {}),
    }, options.quiet ? undefined : "1688 订单已预览", { onAddressFailure: options.onAddressFailure });
  };

  const validate1688OrderPush = async (row: PurchaseOrderRow, quiet = false) => {
    const result = await runAction(`1688-validate-${row.id}`, {
      action: "validate_1688_order_push",
      poId: row.id,
    });
    const validation = result?.result;
    if (validation?.ready) {
      if (!quiet) message.success("1688 下单校验通过");
      return validation;
    }
    if (validation?.message && !quiet) message.warning(validation.message);
    return validation || null;
  };

  const push1688Order = async (
    row: PurchaseOrderRow,
    options: { skipValidation?: boolean; deliveryAddressId?: string; purchase1688AccountId?: string } = {},
  ) => {
    if (!options.skipValidation) {
      const validation = await validate1688OrderPush(row, true);
      if (!validation?.ready) {
        if (validation?.message) message.warning(validation.message);
        return null;
      }
    }
    // 地址失效自救：sync 完后重新弹地址选择 Modal，保留刚选过的 1688 采购账号，
    // 用户只需挑一条新地址再按确认即可，不用从头再点一次「推送1688下单」。
    const reopenPickerAfterSync = () => startPush1688Order(row, options.purchase1688AccountId);
    const previewResult = await preview1688Order(row, {
      quiet: true,
      deliveryAddressId: options.deliveryAddressId,
      purchase1688AccountId: options.purchase1688AccountId,
      onAddressFailure: reopenPickerAfterSync,
    });
    if (!previewResult) return null;
    // 推单后进「已推送 1688,待提交付款」状态(配合 workflow:DRAFT→PUSHED_PENDING_PRICE)。
    const snapshot = patchPurchaseOrderRow(row.id, { status: "pushed_pending_price" });
    const result = await runAction(`1688-push-${row.id}`, {
      action: "push_1688_order",
      poId: row.id,
      ...(options.deliveryAddressId ? { deliveryAddressId: options.deliveryAddressId } : {}),
      ...(options.purchase1688AccountId ? { purchase1688AccountId: options.purchase1688AccountId } : {}),
    }, undefined, { onAddressFailure: reopenPickerAfterSync });
    if (!result && snapshot) {
      patchPurchaseOrderRow(row.id, snapshot);
    }
    const externalOrderId = result?.result?.externalOrderId;
    if (externalOrderId) {
      message.success(`已推送 1688 下单：${externalOrderId}`);
    } else if (result) {
      message.warning("1688 已接收下单请求，但暂未返回订单号，请稍后同步订单");
    }
    return result;
  };

  // 推送1688下单流程（按用户要求：每次都让我选，不再走"有默认就跳过"的捷径）：
  //  - 没地址 → 直接走 push（后端报缺地址错误，引导去同步）
  //  - 否则一律弹 Modal 让用户挑收货地址；默认/单地址只做预选不绕过
  // purchase1688AccountId 由前置的 1688 采购账号选择流程决定。
  const startPush1688Order = (row: PurchaseOrderRow, purchase1688AccountId?: string) => {
    const allAddrs = data.alibaba1688Addresses || [];
    // 按当前选定的 1688 采购账号过滤——跨 OAuth 选地址(比如默认地址恰好属于另一个 OAuth) 1688
    // 那边会报 AddressId invalid。只保留同 OAuth 的地址参与预选和 picker 展示。
    const addresses = purchase1688AccountId
      ? allAddrs.filter((a) => String((a as any).purchase1688AccountId || "") === purchase1688AccountId)
      : allAddrs;
    if (!addresses.length) {
      setPushAddressPicker({ po: row, addressId: "", purchase1688AccountId });
      return;
    }
    const preselect = pickDefaultUsable1688Address(addresses)?.id || "";
    setPushAddressPicker({ po: row, addressId: preselect, purchase1688AccountId });
  };

  // 入口：先解决「用哪个 1688 采购账号推单」，再走 startPush1688Order
  // - 0 个账号 → 报错引导去配置
  // - 1 个账号 → 直接用，不弹
  // - 多账号 → 一律弹 Modal 让用户选；店铺默认账号只作为预选值
  const initiatePush1688Order = async (row: PurchaseOrderRow) => {
    if (!erp) return;
    // 按钮立即转圈：state 命中时几乎瞬间弹 Modal；state 空（首次/拉失败）时需要现拉，
    // 这一步走云端 HTTP，不上 loading 用户会以为没反应。
    // 用与 pushLoading 共用的 key，复用既有判断逻辑（参见上方 pushLoading 定义）。
    setActingKey(`1688-push-${row.id}`);
    try {
      // 优先用 loadData 已预拉的 state；为空才现拉（含旧主控 Unsupported 回落）
      let all: Purchase1688Account[] = purchase1688Accounts;
      if (!all.length) {
        let listResult: any;
        try {
          listResult = await erp.purchase.action({ action: "list_1688_purchase_accounts" });
        } catch (error: any) {
          // 主控端旧版本不支持多账号 action — 静默回落到旧行为（用 company 默认 1688 凭据推单）
          const msg = String(error?.message || "");
          if (/Unsupported purchase action|unsupported.*action|不支持.*操作/i.test(msg)) {
            startPush1688Order(row);
            return;
          }
          message.error(msg || "读取 1688 采购账号失败");
          return;
        }
        all = (listResult?.result?.accounts || []) as Purchase1688Account[];
        if (all.length) setPurchase1688Accounts(all);
      }
      const active = all.filter((a) => a.status !== "disabled" && a.configured && a.authorized);
      if (active.length === 0) {
        message.error("还没有可用的 1688 采购账号，请到「设置 → 1688 授权管理」绑定");
        return;
      }
      if (active.length === 1) {
        startPush1688Order(row, active[0].id);
        return;
      }
      // 店铺默认 1688 账号优先读已加载的 accounts state（loadData 进页面时已拉过）；
      // 仅在 state 还没回填（用户刚进页就立即点）时现拉一次兜底，避免多花一个云端 RTT。
      let accountList: AccountOption[] = accounts;
      if (!accountList.length) {
        try {
          const fetched = await erp.account.list({ limit: 500 });
          accountList = Array.isArray(fetched) ? (fetched as AccountOption[]) : [];
          if (accountList.length) setAccounts(sortStoreAccounts(accountList));
        } catch {
          // 拉店铺失败不致命，回落到弹窗手选
          accountList = [];
        }
      }
      const accountRow = accountList.find((acct) => acct.id === row.accountId);
      const defaultId: string | null = accountRow?.default1688PurchaseAccountId || null;
      const validDefaultId = defaultId && active.find((a) => a.id === defaultId) ? defaultId : null;
      const initialAcctId = validDefaultId || active[0].id;
      // 初始地址必须按选中的 1688 买家账号过滤,避免落到别的 buyer 的地址(推单时 1688 报 ADDRESS_ID_INVALID)
      const filteredForBuyer = (data.alibaba1688Addresses || []).filter(
        (addr) => String((addr as any).purchase1688AccountId || "") === initialAcctId,
      );
      const defaultAddress = pickDefaultUsable1688Address(filteredForBuyer);
      setPushAccountPicker({
        po: row,
        accountId: initialAcctId,
        addressId: defaultAddress?.id || null,
        defaultAccountId: validDefaultId,
        accounts: active,
      });
    } finally {
      setActingKey(null);
    }
  };

  const request1688PriceChange = async (row: PurchaseOrderRow) => {
    const result = await runAction(`1688-price-request-${row.id}`, {
      action: "request_1688_price_change",
      poId: row.id,
      includeWorkbench: false,
      remark: "已发起 1688 改价沟通",
    }, "已记录改价沟通");
    patchPurchaseOrderFromResult(result);
  };

  const openBatch1688PaymentUrl = async () => {
    const poIds = selectedPurchaseOrders
      .filter((row) => row.externalOrderId)
      .map((row) => row.id);
    const orderIds = selectedPurchaseOrders
      .map((row) => row.externalOrderId)
      .filter(Boolean)
      .map(String);
    if (!poIds.length) {
      message.warning("请先勾选已绑定 1688 单号的采购单");
      return;
    }
    const result = await runAction("1688-batch-pay", {
      action: "get_1688_payment_url",
      poIds,
      includeWorkbench: false,
    });
    if (!result) return;
    const paymentUrlSource = get1688PaymentUrlSourceFromResult(result);
    const paymentUrls = get1688PaymentUrlsFromResult(result);
    const partialFailures = get1688PaymentFailuresFromResult(result);
    if (paymentUrlSource === "individual" && paymentUrls.length) {
      const uniquePaymentUrlMap = new Map<string, { orderId: string; paymentUrl: string }>();
      paymentUrls.forEach((item) => uniquePaymentUrlMap.set(item.paymentUrl, item));
      const uniquePaymentUrls = Array.from(uniquePaymentUrlMap.values());
      for (const item of uniquePaymentUrls) {
        await openExternalUrl(item.paymentUrl);
      }
      selectedPurchaseOrders.forEach((row) => {
        const match = paymentUrls.find((item) => item.orderId === String(row.externalOrderId || ""));
        if (!match) return;
        patchPurchaseOrderRow(row.id, {
          externalPaymentUrl: match.paymentUrl,
          externalPaymentUrlSyncedAt: new Date().toISOString(),
        });
      });
      if (partialFailures.length) {
        message.warning(`已打开 ${uniquePaymentUrls.length} 个可付款订单；${partialFailures.length} 个订单不在待付款或账号不匹配`);
      } else {
        message.success(`已打开 ${uniquePaymentUrls.length} 个 1688 支付页`);
      }
      return;
    }
    const paymentUrl = get1688PaymentUrlFromResult(result);
    if (paymentUrl) {
      await openExternalUrl(paymentUrl);
      const payableOrderIds = get1688PayableOrderIdsFromResult(result);
      const payableOrderIdSet = new Set(payableOrderIds);
      selectedPurchaseOrders.forEach((row) => {
        if (!row.externalOrderId) return;
        if (payableOrderIdSet.size && !payableOrderIdSet.has(String(row.externalOrderId))) return;
        patchPurchaseOrderRow(row.id, {
          externalPaymentUrl: paymentUrl,
          externalPaymentUrlSyncedAt: new Date().toISOString(),
        });
      });
      if (partialFailures.length) {
        message.warning(`已打开可付款订单的 1688 支付页；${partialFailures.length} 个订单不在待付款或账号不匹配`);
      } else {
        message.success("已打开 1688 批量支付页");
      }
      return;
    }
    navigator.clipboard?.writeText(orderIds.join("\n")).catch(() => {});
    await openExternalUrl("https://work.1688.com/");
    message.warning("API 没拿到批量付款链接，已打开 1688 工作台；已复制所选 1688 订单号，登录后可粘贴搜索");
  };

  // 批量推 1688：按店铺分组，每组共用 1688 采购账号；地址全局共一份。
  // 串行执行（避免账号撞频被风控）；推完不自动关 Modal，让用户看汇总。
  const openBatchPush1688Picker = async () => {
    if (!erp) return;
    if (!selectedPushableOrders.length) {
      message.warning("没有可推送 1688 的采购单（要求：未推过、有 1688 映射、有收货地址）");
      return;
    }

    let activeAccounts: Purchase1688Account[] = [];
    let fallbackMode = false;
    // 优先用 loadData 已预拉的 state；为空才现拉（含旧主控 Unsupported 回落）
    if (purchase1688Accounts.length) {
      activeAccounts = purchase1688Accounts.filter((a) => a.status !== "disabled" && a.configured && a.authorized);
      if (!activeAccounts.length) {
        message.error("还没有可用的 1688 采购账号，请到「设置 → 1688 授权管理」绑定");
        return;
      }
    } else {
      try {
        const listResult: any = await erp.purchase.action({ action: "list_1688_purchase_accounts" });
        const all = (listResult?.result?.accounts || []) as Purchase1688Account[];
        if (all.length) setPurchase1688Accounts(all);
        activeAccounts = all.filter((a) => a.status !== "disabled" && a.configured && a.authorized);
        if (!activeAccounts.length) {
          message.error("还没有可用的 1688 采购账号，请到「设置 → 1688 授权管理」绑定");
          return;
        }
      } catch (error: any) {
        const msg = String(error?.message || "");
        if (/Unsupported purchase action|unsupported.*action|不支持.*操作/i.test(msg)) {
          // 旧版主控不返回账号列表，回落到 company 默认 1688 凭据
          fallbackMode = true;
        } else {
          message.error(msg || "读取 1688 采购账号失败");
          return;
        }
      }
    }

    // 店铺列表优先复用已加载的 accounts state（loadData 进页面时已拉过）；
    // state 为空时才现拉一次兜底，避免多花一个云端 RTT。
    const shopDefaultAccountMap = new Map<string, string | null>();
    let accountList: AccountOption[] = sortedAccounts;
    if (!accountList.length) {
      try {
        const fetched = await erp.account.list({ limit: 500 });
        accountList = Array.isArray(fetched) ? (fetched as AccountOption[]) : [];
        if (accountList.length) setAccounts(sortStoreAccounts(accountList));
      } catch {
        accountList = [];
      }
    }
    accountList.forEach((acct) => {
      shopDefaultAccountMap.set(String(acct.id), acct.default1688PurchaseAccountId || null);
    });

    const groupMap = new Map<string, { accountId: string; accountName: string; pos: PurchaseOrderRow[] }>();
    for (const po of selectedPushableOrders) {
      const key = String(po.accountId || "");
      const name = po.accountName || "未关联店铺";
      if (!groupMap.has(key)) groupMap.set(key, { accountId: key, accountName: name, pos: [] });
      groupMap.get(key)!.pos.push(po);
    }

    const groups = Array.from(groupMap.values()).map((g) => {
      const defaultId = shopDefaultAccountMap.get(g.accountId) || null;
      const validDefault = !fallbackMode && defaultId && activeAccounts.find((a) => a.id === defaultId)
        ? defaultId
        : null;
      return {
        accountId: g.accountId,
        accountName: g.accountName,
        pos: g.pos,
        selectedPurchaseAccountId: fallbackMode ? null : (validDefault || activeAccounts[0]?.id || null),
        defaultPurchaseAccountId: validDefault,
      };
    });

    const addresses = data.alibaba1688Addresses || [];
    const oauthsInPlay = fallbackMode
      ? []
      : Array.from(new Set(groups.map((group) => group.selectedPurchaseAccountId).filter(Boolean) as string[]));
    const filteredAddresses = addresses.filter((addr) => {
      if (!oauthsInPlay.length) return true;
      return oauthsInPlay.includes(String((addr as any).purchase1688AccountId || ""));
    });
    const defaultAddress = pickDefaultUsable1688Address(filteredAddresses);

    setBatchPushPicker({
      addressId: defaultAddress?.id || null,
      groups,
      accounts: activeAccounts,
      fallbackMode,
      running: false,
      progress: { done: 0, total: selectedPushableOrders.length, ok: 0, fail: 0 },
    });
  };

  const runBatchPush1688 = async () => {
    if (!batchPushPicker) return;
    if (!batchPushPicker.fallbackMode) {
      const missing = batchPushPicker.groups.find((g) => !g.selectedPurchaseAccountId);
      if (missing) {
        message.warning(`店铺「${missing.accountName}」还没选 1688 采购账号`);
        return;
      }
    }
    if (!batchPushPicker.addressId) {
      message.warning("请选择收货地址后再批量推送");
      return;
    }
    setBatchPushPicker((prev) => prev ? { ...prev, running: true, progress: { ...prev.progress, done: 0, ok: 0, fail: 0 } } : prev);
    let ok = 0;
    let fail = 0;
    const addressId = batchPushPicker.addressId || undefined;
    for (const group of batchPushPicker.groups) {
      for (const po of group.pos) {
        const result = await push1688Order(po, {
          purchase1688AccountId: group.selectedPurchaseAccountId || undefined,
          ...(addressId ? { deliveryAddressId: addressId } : {}),
        });
        if (result) ok += 1; else fail += 1;
        setBatchPushPicker((prev) => prev ? { ...prev, progress: { ...prev.progress, done: prev.progress.done + 1, ok, fail } } : prev);
      }
    }
    setBatchPushPicker((prev) => prev ? { ...prev, running: false } : prev);
    if (fail === 0) {
      message.success(`批量推送完成：成功 ${ok} 单`);
    } else {
      message.warning(`批量推送完成：成功 ${ok} 单 / 失败 ${fail} 单（失败详情见单条提示）`);
    }
    void loadData();
    setSelectedPoIds([]);
  };

  // 一键 1688 支付：先调 API 拿付款 URL，拿到就走系统默认浏览器（默认全屏 / 用户上次的窗口状态）；
  // 拿不到（订单不在待支付 / API 失败）就 fallback 到买家工作台并把订单号复制到剪贴板。
  const pay1688Combined = async (row: PurchaseOrderRow) => {
    const orderId = row.externalOrderId;
    if (!orderId) { message.warning("PO 未绑定 1688 订单号"); return; }
    navigator.clipboard?.writeText(orderId).catch(() => {});
    const cachedPaymentUrl = getCached1688PaymentUrl(row);
    if (cachedPaymentUrl) {
      void openExternalUrl(cachedPaymentUrl);
      message.success("\u5df2\u6253\u5f00 1688 \u652f\u4ed8\u9875");
      void erp?.purchase?.action?.({
        action: "get_1688_payment_url",
        poIds: [row.id],
        includeWorkbench: false,
      }, { timeoutMs: 120000 }).then((result: any) => {
        const nextPaymentUrl = get1688PaymentUrlFromResult(result);
        if (nextPaymentUrl) {
          patchPurchaseOrderRow(row.id, {
            externalPaymentUrl: nextPaymentUrl,
            externalPaymentUrlSyncedAt: new Date().toISOString(),
          });
        }
      }).catch(() => {});
      return;
    }
    let paymentUrl: string | null = null;
    try {
      const result = await runAction(`1688-pay-${row.id}`, {
        action: "get_1688_payment_url",
        poIds: [row.id],
        includeWorkbench: false,
      });
      paymentUrl = get1688PaymentUrlFromResult(result) || row.externalPaymentUrl || null;
      if (paymentUrl) {
        patchPurchaseOrderRow(row.id, {
          externalPaymentUrl: paymentUrl,
          externalPaymentUrlSyncedAt: new Date().toISOString(),
        });
      }
    } catch {
      // runAction 已弹错误 toast，进 fallback。
    }
    const targetUrl = paymentUrl || "https://work.1688.com/";
    await openExternalUrl(targetUrl);
    if (paymentUrl) {
      message.success("已在默认浏览器打开 1688 支付页");
    } else {
      message.warning(`API 没拿到付款链接，已打开 1688 工作台；订单号 ${orderId} 已复制，登录后粘贴搜索这单`);
    }
  };

  const cancel1688Order = async (row: PurchaseOrderRow) => {
    const result = await runAction(`1688-cancel-${row.id}`, {
      action: "cancel_1688_order",
      poId: row.id,
      includeWorkbench: false,
      cancelReason: "other",
      remark: "ERP取消未付款1688订单",
    });
    if (!result) return;
    patchPurchaseOrderFromResult(result);
    if (result?.result?.orphanCleared) {
      message.warning("1688 远端已无此订单，已在本地强制清绑（标记为 orphan_cleared）");
    } else {
      message.success("1688 订单已取消");
    }
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
      includeWorkbench: false,
      ...(mode === "memo" ? { memo: text } : { feedback: text }),
    }, mode === "memo" ? "1688 备忘已更新" : "1688 买家留言已补充");
    if (result) {
      patchPurchaseOrderFromResult(result);
      setOrderNoteDialog(null);
      orderNoteForm.resetFields();
    }
  };

  const confirm1688ReceiveGoods = async (row: PurchaseOrderRow) => {
    await runActionOptimistic(
      `1688-receive-${row.id}`,
      { action: "confirm_1688_receive_goods", poId: row.id },
      "1688 已确认收货",
      { poId: row.id, patch: { status: "arrived" } },
    );
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
      setImportDialogOpen(false);
      focusPurchaseOrder(po as PurchaseOrderRow, po.id);
    }
  };

  const openRefundModal = (row: PurchaseOrderRow) => {
    if (!row.externalOrderId) {
      message.warning("请先同步或绑定 1688 订单号");
      return;
    }
    if (!canUse1688RefundActions(row)) {
      if (canUse1688PaymentActions(row)) {
        message.info("未付款的 1688 订单请使用「取消1688」，付款后才可以发起退款售后。");
      } else {
        message.warning("当前 1688 订单状态不支持退款售后。");
      }
      return;
    }
    setRefundPoId(row.id);
    setRefundReasonOptions([]);
    setRefundMaxAmount(null);
    refundForm.resetFields();
    refundForm.setFieldsValue({
      refundType: "refund",
      goodsStatus: "received",
      amount: row.latestRefundAmount ?? row.paidAmount ?? row.totalAmount,
      reason: "",
      refundReasonId: "",
      description: "",
    });
    void loadRefundAutomation(row, { refundType: "refund", goodsStatus: "received" });
  };

  const sync1688Refunds = async (row: PurchaseOrderRow, silent = false) => {
    const result = await runAction(`1688-refund-sync-${row.id}`, {
      action: "sync_1688_refunds",
      poId: row.id,
      includeWorkbench: false,
    });
    patchPurchaseOrderFromResult(result);
    const count = Number(result?.result?.refundCount || 0);
    if (result && !silent) message.success(count ? `已同步 ${count} 条退款售后` : "暂未查到退款售后");
    return result;
  };

  const get1688MaxRefundFee = async (row: PurchaseOrderRow, overrides: Partial<RefundFormValues> = {}) => {
    const result = await runAction(`1688-refund-max-${row.id}`, {
      action: "get_1688_max_refund_fee",
      poId: row.id,
      includeWorkbench: false,
      refundType: overrides.refundType || refundForm.getFieldValue("refundType"),
      goodsStatus: overrides.goodsStatus || refundForm.getFieldValue("goodsStatus"),
    });
    const amount = optionalFiniteNumber(result?.result?.maxRefundFee);
    if (amount !== null) {
      setRefundMaxAmount(amount);
      refundForm.setFieldsValue({ amount });
    }
    return amount;
  };

  const load1688RefundReasons = async (row: PurchaseOrderRow, overrides: Partial<RefundFormValues> = {}) => {
    const result = await runAction(`1688-refund-reasons-${row.id}`, {
      action: "get_1688_refund_reasons",
      poId: row.id,
      includeWorkbench: false,
      refundType: overrides.refundType || refundForm.getFieldValue("refundType"),
      goodsStatus: overrides.goodsStatus || refundForm.getFieldValue("goodsStatus"),
    });
    const options = normalizeRefundReasonOptions(result?.result?.refundReasons || []);
    setRefundReasonOptions(options);
    const first = options[0];
    if (first && !refundForm.getFieldValue("reason")) {
      refundForm.setFieldsValue({
        reason: first.value,
        refundReasonId: first.refundReasonId || "",
      });
    }
    return options;
  };

  const loadRefundAutomation = async (row: PurchaseOrderRow, overrides: Partial<RefundFormValues> = {}) => {
    setRefundAutoLoadingPoId(row.id);
    try {
      await sync1688Refunds(row, true);
      await get1688MaxRefundFee(row, overrides);
      await load1688RefundReasons(row, overrides);
    } finally {
      setRefundAutoLoadingPoId(null);
    }
  };

  const refreshRefundComputedFields = async (row: PurchaseOrderRow, overrides: Partial<RefundFormValues> = {}) => {
    setRefundAutoLoadingPoId(row.id);
    try {
      await get1688MaxRefundFee(row, overrides);
      await load1688RefundReasons(row, overrides);
    } finally {
      setRefundAutoLoadingPoId(null);
    }
  };

  const handleRefundReasonChange = (value: string, option: any) => {
    refundForm.setFieldsValue({
      reason: value,
      refundReasonId: option?.refundReasonId || "",
    });
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
      includeWorkbench: false,
      refundType: values.refundType,
      goodsStatus: values.goodsStatus,
      amount: values.amount,
      refundReasonId: values.refundReasonId,
      reason: values.reason,
      description: values.description,
      ...(rawParams ? { params: rawParams } : {}),
    }, "退款售后已提交");
    if (result) {
      patchPurchaseOrderFromResult(result);
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

  const openSpecBindingDialog = (candidate: SourcingCandidateRow, prId?: string | null) => {
    const rows = candidateSpecRows(candidate);
    setSpecBindingDialog({ candidate, prId: prId || candidate.prId || detailPr?.id || null });
    setSelectedBindingSpecId(candidate.externalSpecId || rows[0]?.externalSpecId || null);
    setSpecBindingSearchText("");
    setBindingOurQty(1);
    setBindingPlatformQty(1);
  };

  const refreshCandidate1688Specs = async (candidate: SourcingCandidateRow) => {
    const result = await runAction(
      `1688-detail-${candidate.id}`,
      {
        action: "refresh_1688_product_detail",
        candidateId: candidate.id,
        offerId: candidate.externalOfferId || undefined,
        bindMapping: false,
        includeRequestDetails: true,
        detailPrId: candidate.prId || detailPr?.id,
      },
      "1688规格已同步，请选择要绑定的规格",
    );
    if (!result) return;
    const activePrId = detailPr?.id || candidate.prId;
    const nextPr = result?.workbench?.purchaseRequests?.find((item: PurchaseRequestRow) => item.id === activePrId);
    const nextCandidate = nextPr?.candidates?.find((item: SourcingCandidateRow) => item.id === candidate.id)
      || result?.result?.candidate
      || candidate;
    if (candidateSpecRows(nextCandidate).length === 0) {
      message.warning("已同步商品详情，但没有返回可绑定的 1688 规格");
      return;
    }
    openSpecBindingDialog(nextCandidate, activePrId);
  };

  const confirmBindCandidate1688Spec = async () => {
    if (!specBindingCandidate || !selectedBindingSpec) {
      message.warning("请先选择一个 1688 规格");
      return;
    }
    const ourQty = Math.max(1, Math.floor(Number(bindingOurQty || 1)));
    const platformQty = Math.max(1, Math.floor(Number(bindingPlatformQty || 1)));
    const bindingPr = [detailPr].find((item) => item?.id === specBindingDialog?.prId)
      || detailPr
      || null;
    const result = await runAction(
      `1688-bind-spec-${specBindingCandidate.id}`,
      {
        action: "bind_1688_candidate_spec",
        candidateId: specBindingCandidate.id,
        offerId: specBindingCandidate.externalOfferId || undefined,
        skuId: bindingPr?.skuId || undefined,
        externalSkuId: selectedBindingSpec.externalSkuId || undefined,
        externalSpecId: selectedBindingSpec.externalSpecId,
        unitPrice: selectedBindingSpec.price ?? specBindingCandidate.unitPrice,
        supplierName: specBindingCandidate.supplierName || undefined,
        productTitle: specBindingCandidate.productTitle || undefined,
        moq: specBindingCandidate.moq || undefined,
        ourQty,
        platformQty,
        includeRequestDetails: true,
        detailPrId: specBindingDialog?.prId || specBindingCandidate.prId || detailPr?.id,
      },
      "1688规格映射已绑定",
    );
    if (!result) return;
    setSpecBindingDialog(null);
  };

  const generatePurchaseOrderForRow = async (row: PurchaseRequestRow, options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    const existingPo = purchaseOrders.find((item) => purchaseOrderBelongsToRequest(item, row.id));
    if (row.status === "converted_to_po" || existingPo) {
      focusPurchaseOrder(existingPo, row.id);
      if (!silent) {
        message.info(existingPo ? `采购单已生成：${existingPo.poNo || existingPo.id}` : "采购单已生成，请刷新后查看采购单列表");
      }
      return;
    }
    const hasMapping = Number(row.mappingCount || 0) > 0;
    const hasCandidates = Boolean(row.candidates?.length || row.candidateCount);
    const hasSkuSupplier = Boolean(row.skuSupplierId || row.skuSupplierName);
    // 三者都没有时走线下采购：后端用空候选生成 placeholder PO，
    // 用户后续在采购单详情里手工补供应商 / 价格。
    const offlinePurchase = !hasMapping && !hasCandidates && !hasSkuSupplier;
    // 线下采购：弹框让用户填供应商/单价/数量，提交后才建单（避免直接生成 ¥0.00 空壳）。
    if (offlinePurchase && !silent) {
      openOfflinePoCreate(row);
      return;
    }
    const result = await runAction(`po-${row.id}`, {
      action: "generate_po",
      prId: row.id,
      qty: row.requestedQty,
      preferSku1688Source: hasMapping,
      offlinePurchase,
    }, offlinePurchase ? "线下采购单已生成" : (hasMapping ? undefined : "手工采购单已生成"));
    if (!result) return;
    const generatedPo = result?.result?.purchaseOrder as PurchaseOrderRow | undefined;
    if (generatedPo?.id) {
      upsertGeneratedPurchaseOrder(row.id, generatedPo);
      focusPurchaseOrder(generatedPo, row.id);
    }
    if (result?.result?.alreadyGenerated) {
      if (generatedPo?.id) {
        focusPurchaseOrder(generatedPo, row.id);
      }
      if (!silent) {
        message.info(generatedPo?.id ? `采购单已生成：${generatedPo.poNo || generatedPo.id}` : "采购单已生成，请刷新后查看采购单列表");
      }
      if (!hasMapping || generatedPo?.status !== "draft" || has1688OrderTrace(generatedPo)) return;
    }
    if (!hasMapping || !canPurchase) return;
    if (!generatedPo?.id) {
      if (!silent) message.warning("采购单已生成，但没有拿到可推送的采购单号，请刷新后手动推单");
      return;
    }
    // 生成采购单成功后自动调 initiatePush1688Order，走多账号/地址选择入口
    // 静默模式（PR 新建时自动触发）validation 失败不弹 warning，让用户去找品/手工处理
    const validation = await validate1688OrderPush(generatedPo, true);
    if (validation?.ready) {
      await initiatePush1688Order(generatedPo);
    } else if (!silent) {
      message.warning(validation?.message || "采购单已生成，但当前映射还不满足 1688 自动推单条件");
    }
  };

  const exportActiveQueue = () => {
    if (activeQueue.kind === "mixed") {
      downloadCsv(`purchase-todos-${activeQueueKey}.csv`, [
        ["类型", "商品编码/采购单号", "商品名称", "规格", "商品图片", "状态", "数量", "商品金额/目标成本", "采购单价", "采购回填成本", "采购回填备注", "运费", "实付总金额", "负责人"],
        ...activeRequestRows.map((row) => [
          "待处理",
          row.internalSkuCode || "",
          row.productName || "",
          getPurchaseRequestSpecText(row),
          getPurchaseRequestDefaultImageUrl(row),
          PR_STATUS_LABELS[row.status] || row.status,
          row.requestedQty || 0,
          row.targetUnitCost ?? "",
          getPurchaseRequestFoundUnitPrice(row) ?? "",
          row.buyerUnitCost ?? "",
          row.buyerRemark || "",
          "",
          "",
          row.requestedByName || "",
        ]),
        ...activeOrderRows.map((row) => [
          "采购单",
          row.poNo || row.id,
          joinGroupedText(getPurchaseOrderProductNames(row)),
          "",
          row.skuImageUrl || "",
          PO_STATUS_LABELS[row.status] || row.status,
          row.totalQty || 0,
          row.totalAmount ?? "",
          "",
          "",
          "",
          row.freightAmount ?? "",
          row.paidAmount ?? "",
          row.createdByName || "",
        ]),
      ]);
      return;
    }
    if (activeQueue.kind === "request") {
      downloadCsv(`purchase-requests-${activeQueueKey}.csv`, [
        ["商品编码", "商品名称", "规格", "状态", "采购数量", "目标成本", "采购单价", "采购回填成本", "采购回填备注", "发起人"],
        ...activeRequestRows.map((row) => [
          row.internalSkuCode || "",
          row.productName || "",
          getPurchaseRequestSpecText(row),
          PR_STATUS_LABELS[row.status] || row.status,
          row.requestedQty || 0,
          row.targetUnitCost ?? "",
          getPurchaseRequestFoundUnitPrice(row) ?? "",
          row.buyerUnitCost ?? "",
          row.buyerRemark || "",
          row.requestedByName || "",
        ]),
      ]);
      return;
    }
    downloadCsv(`purchase-orders-${activeQueueKey}.csv`, [
      ["采购日期", "采购单号", "付款状态", "付款时间", "采购员", "供应商", "商品图片", "商品编码", "商品名称", "总数量", "已入库", "商品金额", "运费", "实付总金额", "1688订单号", "线上状态", "状态"],
      ...activeOrderRows.map((row) => [
        formatDateTime(row.createdAt || row.updatedAt),
        row.poNo || row.id,
        PAYMENT_STATUS_LABELS[row.paymentStatus || ""] || row.paymentStatus || "",
        formatDateTime(row.paidAt),
        row.createdByName || "",
        row.supplierName || "",
        row.skuImageUrl || "",
        joinGroupedText(getPurchaseOrderSkuCodes(row)),
        joinGroupedText(getPurchaseOrderProductNames(row)),
        row.totalQty || 0,
        row.receivedQty || 0,
        row.totalAmount ?? "",
        row.freightAmount ?? "",
        row.paidAmount ?? "",
        row.externalOrderId || "",
        row.externalOrderStatus || "",
        PO_STATUS_LABELS[row.status] || row.status,
      ]),
    ]);
  };

  const requestColumns = useMemo<ColumnsType<PurchaseRequestRow>>(() => {
    const showBuyerFeedbackColumns = filteredActiveRequestRows.some((row) =>
      optionalFiniteNumber(row.buyerUnitCost) !== null
      || Boolean(String(row.buyerRemark || "").trim())
      || Boolean(row.buyerFeedbackByName),
    );
    const showRequestActionColumn = filteredActiveRequestRows.some((row) => {
      const existingPo = purchaseOrders.find((item) => purchaseOrderBelongsToRequest(item, row.id));
      const canQuote = canPurchase && ["submitted", "buyer_processing", "sourced"].includes(row.status);
      const canBuyerFeedback = (canPurchase || canCreateRequest) && ["submitted", "buyer_processing", "sourced", "waiting_ops_confirm"].includes(row.status);
      const canGeneratePo = canCreatePurchaseOrder
        && !existingPo
        && ["submitted", "buyer_processing", "sourced", "waiting_ops_confirm"].includes(row.status);
      const canDelete = canCreateRequest && ["submitted", "buyer_processing", "sourced"].includes(row.status);
      return Boolean(
        (SHOW_KEYWORD_1688_SOURCE && canQuote)
        || canQuote
        || canBuyerFeedback
        || canGeneratePo
        || existingPo
        || row.status === "converted_to_po"
        || canDelete,
      );
    });
    const columns: ColumnsType<PurchaseRequestRow> = [
    {
      title: "图片",
      key: "image",
      width: 76,
      render: (_value, row) => {
        const imageUrl = getPurchaseRequestDefaultImageUrl(row);
        return (
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 6,
              overflow: "hidden",
              background: "#f8fbff",
              border: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {imageUrl ? (
              <button
                type="button"
                onClick={() => setRequestImagePreview({
                  src: imageUrl,
                  alt: row.productName || row.internalSkuCode || "商品图片",
                })}
                style={{
                  border: 0,
                  padding: 0,
                  margin: 0,
                  width: "100%",
                  height: "100%",
                  background: "transparent",
                  cursor: "zoom-in",
                }}
              >
                <img
                  src={imageUrl}
                  alt={row.productName || row.internalSkuCode || "商品图片"}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </button>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>无图</Text>
            )}
          </div>
        );
      },
    },
    {
      title: "商品编码",
      key: "sku",
      width: 260,
      render: (_value, row) => skuText(row),
    },
    {
      title: "规格",
      key: "spec",
      width: 180,
      render: (_value, row) => {
        const spec = getPurchaseRequestSpecText(row);
        return spec ? (
          <Text style={{ fontSize: 12 }} ellipsis={{ tooltip: spec }}>{spec}</Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>-</Text>
        );
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 130,
      render: (value) => statusTag(value, PR_STATUS_LABELS),
    },
    {
      title: "采购数量",
      key: "request",
      width: 110,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{formatQty(row.requestedQty)} 件</Text>
        </Space>
      ),
    },
    {
      title: "创建人",
      dataIndex: "requestedByName",
      width: 100,
      render: (value) => value || "-",
    },
    {
      title: "店铺",
      dataIndex: "accountName",
      width: 130,
      ellipsis: true,
      render: (value) => value || "-",
    },
    {
      title: "目标成本",
      dataIndex: "targetUnitCost",
      width: 110,
      align: "right",
      render: formatCurrency,
    },
    {
      title: "采购成本",
      key: "buyerUnitCost",
      width: 110,
      align: "right",
      render: (_value, row) => {
        const unitCost = optionalFiniteNumber(row.buyerUnitCost);
        return unitCost === null ? <Text type="secondary">-</Text> : <Text strong>{formatCurrency(unitCost)}</Text>;
      },
    },
    {
      title: "备注",
      key: "buyerRemark",
      width: 180,
      render: (_value, row) => {
        const remark = String(row.buyerRemark || "").trim();
        if (!remark && !row.buyerFeedbackByName) return <Text type="secondary">-</Text>;
        return (
          <Space direction="vertical" size={2} style={{ width: "100%" }}>
            {remark ? (
              <Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: remark }}>
                {remark}
              </Text>
            ) : null}
            {row.buyerFeedbackByName ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {row.buyerFeedbackByName}
              </Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: "采购单价",
      key: "candidatePrice",
      width: 120,
      align: "right",
      render: (_value, row) => {
        const unitPrice = getPurchaseRequestFoundUnitPrice(row);
        const supplierName = row.primaryCandidateSupplierName || row.primaryMappingSupplierName || "";
        return (
          <Space direction="vertical" size={2} style={{ width: "100%" }}>
            <Text>{unitPrice == null ? "-" : formatCurrency(unitPrice)}</Text>
            {supplierName ? (
              <Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: supplierName }}>
                {supplierName}
              </Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: "货源",
      key: "sourcing",
      width: 120,
      render: (_value, row) => {
        const taskStage = purchaseRequestTaskStage(row);
        return (
          <Space direction="vertical" size={2}>
            <Tag color={taskStage.color} style={{ marginInlineEnd: 0 }}>{taskStage.label}</Tag>
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
        );
      },
    },
    {
      title: "日志",
      key: "collaboration",
      width: 110,
      render: (_value, row) => (
        <Badge count={row.unreadCount || 0} size="small">
          <Button size="small" icon={<CommentOutlined />} onClick={() => openDetail(row)}>
            日志/协作
          </Button>
        </Badge>
      ),
    },
    {
      title: "动作",
      key: "actions",
      width: 300,
      fixed: "right",
      align: "right",
      render: (_value, row) => {
        const hasAnySource = purchaseRequestHasSource(row);
        const existingPo = purchaseOrders.find((item) => purchaseOrderBelongsToRequest(item, row.id));
        const canQuote = canPurchase && ["submitted", "buyer_processing", "sourced"].includes(row.status);
        const canBuyerFeedback = (canPurchase || canCreateRequest) && ["submitted", "buyer_processing", "sourced", "waiting_ops_confirm"].includes(row.status);
        const canFindSupplier = canQuote;
        const canImageSearch = canQuote;
        // 即使还没绑定货源也允许生成采购单，后端会走线下采购单占位路径。
        const canGeneratePo = canCreatePurchaseOrder
          && !existingPo
          && ["submitted", "buyer_processing", "sourced", "waiting_ops_confirm"].includes(row.status);
        const canDelete = canCreateRequest && ["submitted", "buyer_processing", "sourced"].includes(row.status);
        return (
          <div className="purchase-action-grid">
            {SHOW_KEYWORD_1688_SOURCE && canFindSupplier ? (
              <Button
                size="small"
                icon={<ApiOutlined />}
                loading={actingKey === `1688-source-${row.id}`}
                onClick={() => open1688SourceModal(row)}
              >
                1688 找货源
              </Button>
            ) : null}
            {canImageSearch ? (
              <Button
                size="small"
                icon={<SearchOutlined />}
                loading={actingKey === `1688-image-${row.id}`}
                onClick={() => void openImageSearch(row)}
              >
                以图搜款
              </Button>
            ) : null}
            {canBuyerFeedback ? (
              <Button
                size="small"
                icon={<EditOutlined />}
                loading={actingKey === `buyer-feedback-${row.id}`}
                onClick={() => openBuyerFeedback(row)}
              >
                编辑
              </Button>
            ) : null}
            {canGeneratePo ? (
              <Button
                size="small"
                type="primary"
                icon={<FileDoneOutlined />}
                loading={actingKey === `po-${row.id}`}
                onClick={() => void generatePurchaseOrderForRow(row)}
              >
                {hasAnySource ? "创建采购单" : "线下采购单"}
              </Button>
            ) : null}
            {canGeneratePo && hasAnySource ? (
              // 已绑映射/有货源时也允许走线下采购：弹框填价生成手工单，不推 1688。
              <Button
                size="small"
                icon={<DollarOutlined />}
                onClick={() => openOfflinePoCreate(row)}
              >
                线下采购
              </Button>
            ) : null}
            {existingPo || row.status === "converted_to_po" ? (
              <Button
                size="small"
                icon={<FileDoneOutlined />}
                onClick={() => {
                  focusPurchaseOrder(existingPo, row.id);
                  message.info(existingPo ? `采购单已生成：${existingPo.poNo || existingPo.id}` : "采购单已生成");
                }}
              >
                已生成
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
            {!canImageSearch && !canBuyerFeedback && !canGeneratePo && !existingPo && row.status !== "converted_to_po" && !canDelete && row.status !== "submitted" ? <Text type="secondary">无待办</Text> : null}
          </div>
        );
      },
    },
    ];
    return columns.filter((column) => {
      const key = (column as any).key;
      if (!showBuyerFeedbackColumns && (key === "buyerUnitCost" || key === "buyerRemark")) return false;
      if (!showRequestActionColumn && key === "actions") return false;
      return true;
    });
  }, [actingKey, canCreatePurchaseOrder, canCreateRequest, canPurchase, detailPrId, filteredActiveRequestRows, focusPurchaseOrder, openBuyerFeedback, purchaseOrders, source1688PrId]);

  const renderPurchaseOrderErpDetail = useCallback((row: PurchaseOrderRow) => {
    const risks = purchaseOrderRiskTags(row, hasUsable1688Address);
    const payableAmount = purchaseOrderPayableAmount(row);
    const receiptPercent = purchaseOrderReceiptPercent(row);
    const grossAmount = toFiniteNumber(row.totalAmount) + toFiniteNumber(row.freightAmount);
    const detailLines = purchaseOrderDetailLines(row);
    const detailTotals = purchaseOrderDetailTotals(detailLines);
    const stages = [
      { key: "created", label: "建单", done: true, meta: formatDateTime(row.createdAt || row.updatedAt) },
      {
        key: "source",
        label: row.externalOrderId ? "1688 已绑定" : "线下 / 待推",
        done: Boolean(row.externalOrderId) || Number(row.mappingCount || 0) === 0,
        meta: row.externalOrderId || (Number(row.mappingCount || 0) > 0 ? "可推送 1688" : "线下采购单"),
      },
      {
        key: "pay",
        label: "付款",
        done: purchaseOrderIsPaid(row),
        meta: purchaseOrderIsPaid(row) ? formatDateTime(row.paidAt) : (canUse1688PaymentActions(row) ? "待 1688 支付" : "待提交/确认"),
      },
      {
        key: "warehouse",
        label: "入库",
        done: isCompletedOrder(row),
        meta: `${formatQty(row.receivedQty)} / ${formatQty(row.totalQty)}`,
      },
      {
        key: "close",
        label: "结案",
        done: row.status === "closed",
        meta: PO_STATUS_LABELS[row.status] || row.status || "-",
      },
    ];
    return (
      <div className="purchase-order-detail">
        <div className="purchase-order-detail__flow">
          {stages.map((stage) => (
            <div
              key={stage.key}
              className={`purchase-order-detail__stage${stage.done ? " is-done" : ""}`}
            >
              <span className="purchase-order-detail__stage-dot" />
              <span className="purchase-order-detail__stage-label">{stage.label}</span>
              <span className="purchase-order-detail__stage-meta">{stage.meta || "-"}</span>
            </div>
          ))}
        </div>
        <div className="purchase-order-detail__items">
          <table>
            <thead>
              <tr>
                <th>商品编码</th>
                <th>商品名称</th>
                <th>规格</th>
                <th className="col-numeric">数量</th>
                <th className="col-numeric">金额</th>
                <th className="col-numeric">运费</th>
                <th className="col-numeric">实付金额</th>
              </tr>
            </thead>
            <tbody>
              {detailLines.map((line) => {
                const codes = purchaseOrderDetailLineCodes(line);
                const codeText = codes.join("\n");
                const productName = line.productName || "-";
                const specText = line.specText || "-";
                return (
                  <tr key={line.id || `${codeText || line.skuId || "line"}-${line.qty || 0}`}>
                    <td>
                      <Text
                        copyable={codes.length ? { text: codeText } : false}
                        className="purchase-order-detail__code-list"
                        title={codeText || undefined}
                      >
                        <span className="purchase-order-detail__code-stack">
                          {codes.length ? codes.map((code) => (
                            <span key={code} className="purchase-order-detail__code-chip">{code}</span>
                          )) : <span className="purchase-order-detail__code-chip is-empty">-</span>}
                        </span>
                      </Text>
                    </td>
                    <td>
                      <div className="purchase-order-detail__items-name" title={productName}>
                        {productName}
                      </div>
                    </td>
                    <td>
                      <div className="purchase-order-detail__items-spec" title={specText}>
                        {specText}
                      </div>
                    </td>
                    <td className="col-numeric">{formatQty(line.qty)}</td>
                    <td className="col-numeric">{formatCurrency(line.amount)}</td>
                    <td className="col-numeric">{formatOptionalCurrency(line.logisticsFee)}</td>
                    <td className="col-numeric">{formatCurrency(line.paidAmount)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>合计</td>
                <td className="col-numeric">{formatQty(detailTotals.qty)}</td>
                <td className="col-numeric">{formatCurrency(detailTotals.amount)}</td>
                <td className="col-numeric">{formatOptionalCurrency(detailTotals.logisticsFee)}</td>
                <td className="col-numeric">{formatCurrency(detailTotals.paidAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="purchase-order-detail__grid">
          <div className="purchase-order-detail__section">
            <div className="purchase-order-detail__section-title">单据信息</div>
            <div className="purchase-order-detail__row"><span>采购单号</span><Text copyable>{row.poNo || row.id}</Text></div>
            <div className="purchase-order-detail__row"><span>店铺</span><strong>{row.accountName || "-"}</strong></div>
            <div className="purchase-order-detail__row"><span>供应商</span><strong>{row.supplierName || "-"}</strong></div>
            <div className="purchase-order-detail__row"><span>采购员</span><strong>{row.createdByName || "-"}</strong></div>
          </div>
          <div className="purchase-order-detail__section">
            <div className="purchase-order-detail__section-title">金额与付款</div>
            <div className="purchase-order-detail__row"><span>商品金额</span><strong>{formatCurrency(row.totalAmount)}</strong></div>
            <div className="purchase-order-detail__row"><span>运费</span><strong>{formatOptionalCurrency(row.freightAmount)}</strong></div>
            <div className="purchase-order-detail__row"><span>应付估算</span><strong>{formatCurrency(grossAmount)}</strong></div>
            <div className="purchase-order-detail__row"><span>实付总额</span><strong>{formatCurrency(payableAmount)}</strong></div>
          </div>
          <div className="purchase-order-detail__section">
            <div className="purchase-order-detail__section-title">1688 与售后</div>
            <div className="purchase-order-detail__row"><span>1688 单号</span><strong>{row.externalOrderId || "未绑定"}</strong></div>
            <div className="purchase-order-detail__row"><span>线上状态</span><strong>{externalOrderStatusLabel(row.externalOrderStatus)}</strong></div>
            <div className="purchase-order-detail__row"><span>退款记录</span><strong>{formatQty(row.refundCount)} 条</strong></div>
            <div className="purchase-order-detail__row"><span>最近售后</span><strong>{refundStatusLabel(row.latestRefundStatus)}</strong></div>
          </div>
          <div className="purchase-order-detail__section">
            <div className="purchase-order-detail__section-title">入库与风险</div>
            <Progress percent={receiptPercent} size="small" status={receiptPercent >= 100 ? "success" : "active"} />
            <div className="purchase-order-detail__row"><span>预计到货</span><strong>{formatDate(row.expectedDeliveryDate)}</strong></div>
            <div className="purchase-order-detail__row"><span>入库数量</span><strong>{formatQty(row.receivedQty)} / {formatQty(row.totalQty)}</strong></div>
            <div className="purchase-order-detail__tags">
              {risks.length ? risks.map((risk) => (
                <Tag key={risk.key} color={risk.color}>{risk.label}</Tag>
              )) : <Tag color="green">校验通过</Tag>}
            </div>
          </div>
        </div>
      </div>
    );
  }, [hasUsable1688Address]);

  const purchaseOrderExpandable = useMemo(() => ({
    expandedRowKeys: expandedPoIds,
    expandedRowRender: renderPurchaseOrderErpDetail,
    showExpandColumn: false,
    rowExpandable: () => true,
    onExpandedRowsChange: (keys: readonly Key[]) => setExpandedPoIds(keys.map(String)),
  }), [expandedPoIds, renderPurchaseOrderErpDetail]);

  const orderColumns = useMemo<ColumnsType<PurchaseOrderRow>>(() => {
    const sortableOrderFields = new Set([
      "createdAt",
      "po",
      "paidAt",
      "totalQty",
      "totalAmount",
      "freightAmount",
      "paidAmount",
      "receivedQty",
      "expectedDeliveryDate",
    ]);
    const sortOrderFor = (field: string) => (
      purchaseOrderSort.field === field ? purchaseOrderSort.direction : null
    );
    const columnField = (column: ColumnsType<PurchaseOrderRow>[number]) => {
      const rawField = (column as any).key ?? (column as any).dataIndex;
      return Array.isArray(rawField) ? rawField.join(".") : String(rawField || "");
    };
    const buildColumnMenuHeaderProps = () => ({
      title: "右键配置列",
      className: "purchase-order-column-configurable",
      onContextMenu: openPurchaseOrderColumnMenu,
    });
    const columns: ColumnsType<PurchaseOrderRow> = [
    {
      title: "采购日期",
      key: "createdAt",
      width: 150,
      render: (_value, row) => formatDateTime(row.createdAt || row.updatedAt),
    },
    {
      title: "采购单号",
      key: "po",
      width: 138,
      render: (_value, row) => (
        <Typography.Link
          className={expandedPoIds.includes(row.id) ? "purchase-order-number-link is-expanded" : "purchase-order-number-link"}
          title={expandedPoIds.includes(row.id) ? "收起采购单明细" : "展开采购单明细"}
          onClick={(event) => {
            event.stopPropagation();
            togglePurchaseOrderExpanded(row.id);
          }}
        >
          {row.poNo || row.id}
        </Typography.Link>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (value) => statusTag(value, PO_STATUS_LABELS),
    },
    {
      title: "付款",
      dataIndex: "paymentStatus",
      width: 120,
      render: (value) => statusTag(value, PAYMENT_STATUS_LABELS),
    },
    {
      title: "ERP校验",
      key: "riskTags",
      width: 150,
      render: (_value, row) => {
        const risks = purchaseOrderRiskTags(row, hasUsable1688Address);
        if (!risks.length) return <Tag color="green">正常</Tag>;
        return (
          <Space size={[4, 4]} wrap>
            {risks.slice(0, 2).map((risk) => (
              <Tag key={risk.key} color={risk.color}>{risk.label}</Tag>
            ))}
            {risks.length > 2 ? <Tag color="default">+{risks.length - 2}</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: "付款时间",
      dataIndex: "paidAt",
      width: 150,
      render: formatDateTime,
    },
    {
      title: "采购员",
      dataIndex: "createdByName",
      width: 100,
      render: (value) => value || "-",
    },
    {
      title: "店铺",
      dataIndex: "accountName",
      width: 130,
      ellipsis: true,
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
      title: "商品图片",
      key: "skuImage",
      width: 86,
      render: (_value, row) => {
        const imageUrl = row.skuImageUrl || "";
        return imageUrl ? (
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 6,
              overflow: "hidden",
              background: "#f8fbff",
              border: "1px solid #e5e7eb",
            }}
          >
            <img
              src={imageUrl}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </div>
        ) : (
          <Text type="secondary">-</Text>
        );
      },
    },
    {
      title: "商品编码",
      key: "skuCodes",
      width: 150,
      render: (_value, row) => {
        const codes = getPurchaseOrderSkuCodes(row);
        if (!codes.length) return "-";
        return (
          <Space direction="vertical" size={2}>
            {codes.slice(0, 2).map((code) => (
              <Text key={code} style={TABLE_IDENTIFIER_TEXT_STYLE}>
                {code}
              </Text>
            ))}
            {codes.length > 2 ? <Text type="secondary" style={{ fontSize: 12 }}>等 {codes.length} 个</Text> : null}
          </Space>
        );
      },
    },
    {
      title: "商品名称",
      key: "productNames",
      width: 240,
      render: (_value, row) => {
        const names = getPurchaseOrderProductNames(row);
        return (
          <Paragraph
            ellipsis={{ rows: 2, tooltip: joinGroupedText(names) || row.skuSummary || "-" }}
            style={{ marginBottom: 0, lineHeight: 1.5 }}
          >
            {joinGroupedText(names) || row.skuSummary || "-"}
          </Paragraph>
        );
      },
    },
    {
      title: "数量",
      dataIndex: "totalQty",
      width: 88,
      align: "right",
      render: formatQty,
    },
    {
      title: "商品金额",
      dataIndex: "totalAmount",
      width: 110,
      align: "right",
      render: formatCurrency,
    },
    {
      title: "运费",
      dataIndex: "freightAmount",
      width: 92,
      align: "right",
      render: formatOptionalCurrency,
    },
    {
      title: "实付总金额",
      dataIndex: "paidAmount",
      width: 116,
      align: "right",
      render: formatOptionalCurrency,
    },
    {
      title: "1688单号",
      key: "externalOrderId",
      width: 230,
      ellipsis: true,
      render: (_value, row) => {
        const mappingCount = Number(row.mappingCount || 0);
        const deliveryAddressCount = Number(row.deliveryAddressCount || 0);
        const orderId = row.externalOrderId;
        return (
          <Space direction="vertical" size={2}>
            {orderId ? (
              <a
                className="erp-link"
                title="点击直接打开 1688 订单详情页（同时复制订单号，万一直链失效可在我的订单里粘贴搜索）"
                onClick={(e) => {
                  e.stopPropagation();
                  // 复制兜底，万一直链 404 用户能直接在 1688「我的订单」粘贴搜索
                  navigator.clipboard?.writeText(String(orderId)).catch(() => {});
                  const externalOpener = (window as any)?.electronAPI?.app?.openExternal;
                  // 1688 买家订单详情直链（验证过：登录后能直接进订单详情页）
                  const url = `https://trade.1688.com/order/order_detail.htm?orderId=${encodeURIComponent(String(orderId))}`;
                  if (typeof externalOpener === "function") externalOpener(url).catch(() => window.open(url, "_blank"));
                  else window.open(url, "_blank", "noopener,noreferrer");
                  message.success(`已打开 1688 订单详情 (${orderId})`);
                }}
              >
                {orderId}
              </a>
            ) : (
              <Text strong>未绑定</Text>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDateTime(row.externalOrderSyncedAt)}
            </Text>
            {!row.externalOrderId && canPurchase && mappingCount > 0 && deliveryAddressCount === 0 && !hasUsable1688Address ? (
              <Text type="warning" style={{ fontSize: 12 }}>缺店铺1688地址</Text>
            ) : null}
            {!row.externalOrderId && canPurchase && mappingCount === 0 ? (
              <Text type="secondary" style={{ fontSize: 12 }}>线下采购</Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: "线上状态",
      dataIndex: "externalOrderStatus",
      width: 120,
      render: externalOrderStatusLabel,
    },
    {
      title: "物流",
      key: "logistics",
      width: 200,
      render: (_value, row) => {
        // externalLogisticsJson 来自 sync_1688_logistics 接口，结构嵌套较深，
        // 这里做一次浅解析提取物流公司名 + 运单号；解析失败显示 -。
        const raw = row.externalLogisticsJson;
        if (!raw) return <Text type="secondary">-</Text>;
        let obj: any = raw;
        if (typeof raw === "string") {
          try { obj = JSON.parse(raw); } catch { return <Text type="secondary">-</Text>; }
        }
        const findDeep = (o: any, keys: string[]): string => {
          if (!o || typeof o !== "object") return "";
          for (const k of keys) if (o[k]) return String(o[k]);
          for (const v of Object.values(o)) {
            if (Array.isArray(v)) {
              for (const item of v) {
                const r = findDeep(item, keys);
                if (r) return r;
              }
            } else if (typeof v === "object") {
              const r = findDeep(v, keys);
              if (r) return r;
            }
          }
          return "";
        };
        const company = findDeep(obj, ["logisticsCompanyName", "companyName", "logisticsName"]);
        const billNo = findDeep(obj, ["logisticsBillNo", "mailNo", "trackingNo", "billNo"]);
        if (!company && !billNo) return <Text type="secondary">无物流</Text>;
        return (
          <Space direction="vertical" size={2}>
            <Text style={{ fontSize: 12 }}>{company || "未知物流公司"}</Text>
            {billNo ? <Text copyable code style={{ fontSize: 12 }}>{billNo}</Text> : <Text type="secondary" style={{ fontSize: 12 }}>无运单号</Text>}
          </Space>
        );
      },
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
      title: "预计到货",
      dataIndex: "expectedDeliveryDate",
      width: 120,
      render: formatDate,
    },
    {
      title: "动作",
      key: "actions",
      width: 330,
      fixed: "right",
      align: "right",
      render: (_value, row) => {
        const rollbackTarget = getPurchaseOrderRollbackTarget(row);
        const rollbackTargetLabel = rollbackTarget ? (PO_STATUS_LABELS[rollbackTarget] || rollbackTarget) : "";
        const rollbackButtonLabel = PO_ROLLBACK_BUTTON_LABELS[row.status] || (rollbackTargetLabel ? `回退到${rollbackTargetLabel}` : "回退");
        const rollbackVisible = canRollbackPurchaseOrder(row);
        const mappingCount = Number(row.mappingCount || 0);
        const deliveryAddressCount = Number(row.deliveryAddressCount || 0);
        const canPushTo1688 = !row.externalOrderId
          && canPurchase
          && mappingCount > 0
          && (deliveryAddressCount > 0 || hasUsable1688Address);
        const pushLoading = actingKey === `1688-push-${row.id}`
          || actingKey === `1688-validate-${row.id}`
          || actingKey === `1688-preview-${row.id}`;
        const canUse1688Payment = canUse1688PaymentActions(row);
        const canSubmitPaymentApproval = canPurchase && canSubmitPaymentApprovalAction(row);
        const canConfirmPaid = canFinance && canConfirmPaidAction(row);
        const canDeletePo = canPurchase && canDeletePurchaseOrder(row);
        return (
          <div className="purchase-action-grid">
          {canPushTo1688 ? (
            <Button
              size="small"
              type="primary"
              icon={<ShoppingCartOutlined />}
              loading={pushLoading}
              onClick={() => { void initiatePush1688Order(row); }}
            >
              推送1688下单
            </Button>
          ) : null}
          {rollbackVisible ? (
            <Button
              size="small"
              icon={<RollbackOutlined />}
              loading={actingKey === `rollback-po-${row.id}`}
              onClick={() => rollbackPurchaseOrder(row)}
              title={rollbackTargetLabel ? `回退到「${rollbackTargetLabel}」` : undefined}
            >
              {rollbackButtonLabel}
            </Button>
          ) : null}
          {canDeletePo ? (
            <Popconfirm
              title="删除采购单"
              description="只会删除未推送、未付款、未入库的本地草稿采购单。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => deletePurchaseOrder(row)}
            >
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                loading={actingKey === `delete-po-${row.id}`}
              >
                删除
              </Button>
            </Popconfirm>
          ) : null}
          {row.status === "draft" && Number(row.mappingCount || 0) === 0 && canPurchase ? (
            <Button
              size="small"
              icon={<EditOutlined />}
              loading={actingKey === `edit-po-${row.id}`}
              onClick={() => openOfflinePoEdit(row)}
            >
              编辑
            </Button>
          ) : null}
          {canPurchase && ["draft", "pushed_pending_price", "pending_finance_approval", "approved_to_pay"].includes(row.status) ? (
            <Button
              size="small"
              icon={<ShopOutlined />}
              loading={actingKey === `convert-po-${row.id}`}
              onClick={() => {
                if (row.externalOrderId) {
                  Modal.confirm({
                    title: "转为线下采购",
                    content: `将先调 1688 取消订单 ${row.externalOrderId}，再把此采购单改为线下。是否继续？`,
                    okText: "继续",
                    cancelText: "取消",
                    onOk: () => openOfflinePoConvert(row),
                  });
                } else {
                  openOfflinePoConvert(row);
                }
              }}
            >
              线下采购
            </Button>
          ) : null}
          {row.status === "draft" && canSubmitPaymentApproval && Number(row.mappingCount || 0) === 0 ? (
            <Button
              size="small"
              type="primary"
              icon={<DollarOutlined />}
              loading={actingKey === `pay-submit-${row.id}`}
              onClick={() => runActionOptimistic(
                `pay-submit-${row.id}`,
                { action: "submit_payment_approval", poId: row.id, amount: row.paidAmount ?? row.totalAmount },
                "已进入待付款",
                { poId: row.id, patch: { status: "approved_to_pay" } },
              )}
            >
              提交付款
            </Button>
          ) : null}
          {canUse1688Payment && canFinance ? (
            <Button
              size="small"
              type="primary"
              icon={<DollarOutlined />}
              loading={actingKey === `1688-pay-${row.id}`}
              onClick={() => pay1688Combined(row)}
            >
              1688 支付
            </Button>
          ) : null}
          {row.externalOrderId && canPurchase && canUse1688RefundActions(row) ? (
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
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `1688-receive-${row.id}`}
              onClick={() => confirm1688ReceiveGoods(row)}
            >
              确认收货
            </Button>
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
          {row.status === "pushed_pending_price" && canSubmitPaymentApproval ? (
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
              onClick={() => runActionOptimistic(
                `pay-submit-${row.id}`,
                { action: "submit_payment_approval", poId: row.id, amount: row.paidAmount ?? row.totalAmount },
                "已进入待付款",
                { poId: row.id, patch: { status: "approved_to_pay" } },
              )}
            >
              提交付款
            </Button>
          ) : null}
          {/* 没有审核环节:推单→提交付款→待付款→1688 支付/线下付款→确认付款。
              仅给历史卡在 pending_finance_approval 的旧数据留兜底:财务点一下推到待付款。
              按钮名跟正常单的「提交付款」保持一致——对用户都是"推到待付款"，
              底层 action 不同（这里走 approve_payment，正常单走 submit_payment_approval）。 */}
          {row.status === "pending_finance_approval" && canFinance ? (
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `pay-approve-po-${row.id}`}
              onClick={() => runActionOptimistic(
                `pay-approve-po-${row.id}`,
                { action: "approve_payment", poId: row.id },
                "已进入待付款",
                { poId: row.id, patch: { status: "approved_to_pay" } },
              )}
            >
              提交付款
            </Button>
          ) : null}
          {canConfirmPaid && (row.externalOrderId || Number(row.mappingCount || 0) === 0) ? (
            <Button
              size="small"
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `paid-po-${row.id}`}
              onClick={() => runActionOptimistic(
                `paid-po-${row.id}`,
                { action: "confirm_paid", poId: row.id },
                "已确认付款",
                { poId: row.id, patch: { status: "paid" } },
              )}
            >
              确认付款
            </Button>
          ) : null}
          {!["draft", "pushed_pending_price", "pending_finance_approval", "approved_to_pay"].includes(row.status) && !(row.externalOrderId && canPurchase) && !rollbackVisible && !canDeletePo ? <Text type="secondary">无待办</Text> : null}
        </div>
        );
      },
    },
    ];
    const visibleColumns = (canPurchase || canFinance || canWarehouse)
      ? columns
      : columns.filter((column) => columnField(column) !== "actions");
    const columnsByField = new Map(visibleColumns.map((column) => [columnField(column), column]));
    const visibleColumnKeys = new Set(purchaseOrderColumnConfig.visible);
    const orderedColumns = [
      ...purchaseOrderColumnConfig.order
        .filter((field) => visibleColumnKeys.has(field))
        .map((field) => columnsByField.get(field))
        .filter(Boolean),
      ...visibleColumns.filter((column) => !PURCHASE_ORDER_CONFIGURABLE_COLUMN_KEY_SET.has(columnField(column))),
    ] as ColumnsType<PurchaseOrderRow>;

    return orderedColumns.map((column) => {
      const field = columnField(column);
      const withSort = sortableOrderFields.has(field)
        ? { ...column, sorter: true, sortOrder: sortOrderFor(field) }
        : column;
      if (!PURCHASE_ORDER_CONFIGURABLE_COLUMN_KEY_SET.has(field)) return withSort;
      return {
        ...withSort,
        onHeaderCell: buildColumnMenuHeaderProps,
      };
    });
  }, [
    actingKey,
    canFinance,
    canPurchase,
    canWarehouse,
    expandedPoIds,
    hasUsable1688Address,
    openPurchaseOrderColumnMenu,
    purchaseOrderColumnConfig,
    purchaseOrderSort,
    togglePurchaseOrderExpanded,
  ]);

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
      align: "right",
      render: (_value, row) => (
        <Space size={6} style={{ width: "100%", justifyContent: "flex-end" }}>
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

  // 首屏（无快照）加载时显示加载态；已有数据的手动刷新保持原内容，不空屏闪烁。
  const tableLoading = loading && !hasWorkbenchSnapshot(data);
  const tableBusy = tableLoading || purchaseOrderPageLoading;
  const workAreaTitle = activeWorkArea === "sourcing" ? "找品" : "采购单";
  const workAreaUpdatedText = tableLoading ? "更新 —" : `更新 ${formatDateTime(data.generatedAt)}`;
  const workAreaActions = [
    <Button key="workflow" icon={<FileDoneOutlined />} onClick={() => setPurchaseFlowOpen(true)}>
      流程
    </Button>,
    <Button key="stores" icon={<ShopOutlined />} onClick={() => setStoreManagerOpen(true)}>
      店铺
    </Button>,
    canPurchase ? (
      <Button key="inquiry-template" icon={<CommentOutlined />} onClick={openPurchaseSettings}>
        询盘设置
      </Button>
    ) : null,
    activeWorkArea === "orders" && canCreatePurchaseOrder ? (
      <Button
        key="new-po"
        type="primary"
        icon={<PlusOutlined />}
        onClick={openDirectPoCreateModal}
      >
        创建采购单
      </Button>
    ) : null,
    activeWorkArea === "sourcing" && canCreateRequest ? (
      <Button
        key="new-optimization"
        icon={<PlusOutlined />}
        onClick={() => openRequestCreateModal("optimization")}
      >
        新建优化
      </Button>
    ) : null,
    activeWorkArea === "sourcing" && canCreateRequest ? (
      <Button
        key="new"
        type="primary"
        icon={<PlusOutlined />}
        onClick={() => openRequestCreateModal("sourcing")}
      >
        新建找品
      </Button>
    ) : null,
  ].filter(Boolean);
  const queueActions = [
    activeWorkArea === "sourcing" && canPurchase ? (
      <Button
        key="sync-inquiry-results"
        icon={<CommentOutlined />}
        loading={actingKey === "sync-inquiry-results"}
        onClick={() => void syncInquiryResults()}
      >
        同步询盘结果
      </Button>
    ) : null,
    activeWorkArea === "orders" && canPurchase ? (
      <Button
        key="batch-push-1688"
        icon={<ShoppingCartOutlined />}
        disabled={!selectedPushableOrders.length}
        onClick={() => void openBatchPush1688Picker()}
      >
        批量推送 1688{selectedPushableOrders.length ? ` (${selectedPushableOrders.length})` : ""}
      </Button>
    ) : null,
    activeWorkArea === "orders" && (canPurchase || canFinance) ? (
      <Button
        key="batch-pay"
        icon={<LinkOutlined />}
        disabled={!selectedPurchaseOrders.some((row) => row.externalOrderId)}
        loading={actingKey === "1688-batch-pay"}
        onClick={openBatch1688PaymentUrl}
      >
        批量支付
      </Button>
    ) : null,
    <Button key="export" icon={<DownloadOutlined />} onClick={exportActiveQueue}>
      导出
    </Button>,
    <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={() => void loadData()}>
      刷新
    </Button>,
  ].filter(Boolean);
  const activePurchaseOrderColumnConfig = purchaseOrderColumnDraft || purchaseOrderColumnConfig;

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="系统" title={workAreaTitle} subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境缺少本地服务接口" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <Drawer
        title="采购流程"
        open={purchaseFlowOpen}
        onClose={() => setPurchaseFlowOpen(false)}
        width={520}
        className="purchase-flow-drawer"
      >
        <Steps
          direction="vertical"
          current={-1}
          progressDot
          items={PURCHASE_WORKFLOW_STEP_ITEMS}
        />
      </Drawer>

      <div className="app-panel purchase-workbench-panel">
        <div className="purchase-workbench-head">
          <div className="purchase-workbench-statusline purchase-workbench-statusline--primary">
            <span className="purchase-workbench-name">{workAreaTitle}</span>
            <span className="purchase-workbench-meta__pill">{workAreaUpdatedText}</span>
            <Text strong>{activeWorkArea === "sourcing" ? "找品状态" : "采购单状态"}</Text>
            <Space size={[8, 8]} wrap>
              {queueItems.map((item) => (
                <Button
                  key={item.key}
                  size="small"
                  type={activeQueue.key === item.key ? "primary" : "default"}
                  onClick={() => {
                    setSelectedPoIds([]);
                    setPurchaseOrderPage(1);
                    setActiveQueueKey(item.key);
                  }}
                >
                  {item.title} {tableLoading ? "—" : item.count}
                </Button>
              ))}
            </Space>
          </div>
          <Space size={8} wrap className="purchase-workbench-actions">
            {workAreaActions}
            {queueActions.length ? <span className="purchase-workbench-action-divider" aria-hidden="true" /> : null}
            {queueActions}
          </Space>
        </div>

        {!workArea ? (
          <Segmented
            value={activeWorkArea}
            onChange={(value) => switchWorkArea(value as PurchaseWorkArea)}
            options={[
              { label: `找品 ${pendingRequestRows.length}`, value: "sourcing" },
              { label: `采购单 ${orderCountAll}`, value: "orders" },
            ]}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        {activeWorkArea === "orders" ? (
          <div className="material-filter-bar">
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="综合搜索：单号 / 供应商 / 1688 / 商品"
              value={purchaseOrderFilterDraft.keyword}
              onChange={(event) => setPurchaseOrderFilterDraft((prev) => ({ ...prev, keyword: event.target.value }))}
              onPressEnter={applyPurchaseOrderFilters}
              style={{ width: 280 }}
            />
            <Input
              allowClear
              placeholder="采购单 / 1688 单号"
              value={purchaseOrderFilterDraft.poNo}
              onChange={(event) => setPurchaseOrderFilterDraft((prev) => ({ ...prev, poNo: event.target.value }))}
              onPressEnter={applyPurchaseOrderFilters}
              style={{ width: 170 }}
            />
            <RangePicker
              value={purchaseOrderFilterDraft.dateRange}
              onChange={(dates) => setPurchaseOrderFilterDraft((prev) => ({ ...prev, dateRange: dates }))}
              allowClear
              placeholder={["开始日期", "结束日期"]}
              style={{ width: 260 }}
            />
            <Input
              allowClear
              placeholder="采购员"
              value={purchaseOrderFilterDraft.purchaser}
              onChange={(event) => setPurchaseOrderFilterDraft((prev) => ({ ...prev, purchaser: event.target.value }))}
              onPressEnter={applyPurchaseOrderFilters}
              style={{ width: 160 }}
            />
            <Select
              allowClear
              showSearch
              placeholder="店铺"
              value={purchaseOrderFilterDraft.accountId || undefined}
              optionFilterProp="label"
              options={sortedAccounts.map((account) => ({
                label: account.name || account.id,
                value: account.id,
              }))}
              onChange={(value) => setPurchaseOrderFilterDraft((prev) => ({ ...prev, accountId: value || "" }))}
              style={{ width: 150 }}
            />
            <Input
              allowClear
              placeholder="供应商"
              value={purchaseOrderFilterDraft.supplier}
              onChange={(event) => setPurchaseOrderFilterDraft((prev) => ({ ...prev, supplier: event.target.value }))}
              onPressEnter={applyPurchaseOrderFilters}
              style={{ width: 170 }}
            />
            <Select
              value={purchaseOrderFilterDraft.paymentState}
              options={PURCHASE_ORDER_PAYMENT_FILTER_OPTIONS}
              onChange={(value) => setPurchaseOrderFilterDraft((prev) => ({ ...prev, paymentState: value }))}
              style={{ width: 140 }}
            />
            <Select
              value={purchaseOrderFilterDraft.sourceState}
              options={PURCHASE_ORDER_SOURCE_FILTER_OPTIONS}
              onChange={(value) => setPurchaseOrderFilterDraft((prev) => ({ ...prev, sourceState: value }))}
              style={{ width: 150 }}
            />
            <Select
              value={purchaseOrderFilterDraft.riskState}
              options={PURCHASE_ORDER_RISK_FILTER_OPTIONS}
              onChange={(value) => setPurchaseOrderFilterDraft((prev) => ({ ...prev, riskState: value }))}
              style={{ width: 150 }}
            />
            <Input
              allowClear
              placeholder="商品编码"
              value={purchaseOrderFilterDraft.productCode}
              onChange={(event) => setPurchaseOrderFilterDraft((prev) => ({ ...prev, productCode: event.target.value }))}
              onPressEnter={applyPurchaseOrderFilters}
              style={{ width: 160 }}
            />
            <InputNumber
              min={0}
              precision={2}
              placeholder="金额下限"
              value={purchaseOrderFilterDraft.amountMin}
              onChange={(value) => setPurchaseOrderFilterDraft((prev) => ({ ...prev, amountMin: typeof value === "number" ? value : null }))}
              style={{ width: 120 }}
            />
            <InputNumber
              min={0}
              precision={2}
              placeholder="金额上限"
              value={purchaseOrderFilterDraft.amountMax}
              onChange={(value) => setPurchaseOrderFilterDraft((prev) => ({ ...prev, amountMax: typeof value === "number" ? value : null }))}
              style={{ width: 120 }}
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={applyPurchaseOrderFilters}>
              查询
            </Button>
            <Button icon={<CloseOutlined />} onClick={resetPurchaseOrderFilters}>
              重置
            </Button>
          </div>
        ) : (
          <div className="material-filter-bar material-filter-bar--search">
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索商品编码 / 标题规格 / 找品发起人 / 店铺 / 货源"
              value={purchaseSearchText}
              onChange={(event) => setPurchaseSearchText(event.target.value)}
            />
            {hasPurchaseSearch ? (
              <Text type="secondary" style={{ whiteSpace: "nowrap" }}>
                找到 {purchaseSearchResultCount} 条
              </Text>
            ) : null}
          </div>
        )}
        {tableLoading ? (
          <Skeleton active paragraph={{ rows: 8 }} title={false} style={{ padding: "12px 0" }} />
        ) : activeQueue.kind === "mixed" ? (
          // "全部" tab：上下两段表同屏排列，空段不显示
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {filteredActiveRequestRows.length ? (
              <div>
                <Text strong>找品 {filteredActiveRequestRows.length}</Text>
                <Table
                  rowKey="id"
                  loading={tableLoading}
                  size="small"
                  className="erp-compact-table"
                  columns={requestColumns}
                  dataSource={filteredActiveRequestRows}
                  scroll={{ x: 1800 }}
                  pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
                  style={{ marginTop: 8 }}
                />
              </div>
            ) : null}
            {(filteredActiveOrderRows.length || activeOrderTotal || purchaseOrderPageLoading) ? (
              <div>
                <Text strong>采购单 {activeOrderTotal}</Text>
                <Table
                  rowKey="id"
                  loading={tableBusy}
                  size="small"
                  className="erp-compact-table"
                  columns={orderColumns}
                  dataSource={filteredActiveOrderRows}
                  rowSelection={orderRowSelection}
                  rowClassName={purchaseOrderRowClassName}
                  onRow={purchaseOrderTableRowProps}
                  expandable={purchaseOrderExpandable}
                  scroll={{ x: 2720 }}
                  pagination={orderTablePagination}
                  onChange={handlePurchaseOrderTableChange}
                  style={{ marginTop: 8 }}
                />
              </div>
            ) : null}
            {!filteredActiveRequestRows.length && !filteredActiveOrderRows.length && !activeOrderTotal && !purchaseOrderPageLoading ? (
              <Table
                rowKey="id"
                loading={tableBusy}
                size="small"
                className="erp-compact-table"
                columns={orderColumns}
                dataSource={[]}
                rowSelection={orderRowSelection}
                rowClassName={purchaseOrderRowClassName}
                onRow={purchaseOrderTableRowProps}
                expandable={purchaseOrderExpandable}
                scroll={{ x: 2720 }}
                pagination={false}
                onChange={handlePurchaseOrderTableChange}
              />
            ) : null}
          </Space>
        ) : activeQueue.kind === "request" ? (
          <Table
            rowKey="id"
            loading={tableLoading}
            size="small"
            className="erp-compact-table"
            columns={requestColumns}
            dataSource={filteredActiveRequestRows}
            scroll={{ x: 1800 }}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          />
        ) : (
          <Table
            rowKey="id"
            loading={tableBusy}
            size="small"
            className="erp-compact-table"
            columns={orderColumns}
            dataSource={filteredActiveOrderRows}
            rowSelection={orderRowSelection}
            rowClassName={purchaseOrderRowClassName}
            onRow={purchaseOrderTableRowProps}
            expandable={purchaseOrderExpandable}
            scroll={{ x: 2720 }}
            pagination={orderTablePagination}
            onChange={handlePurchaseOrderTableChange}
          />
        )}
        {activeWorkArea === "orders" && selectedPoIds.length ? (
          <div className="erp-bulk-bar">
            <span className="selected">已选 {selectedPoIds.length} 单</span>
            <span>可推 1688 {selectedPushableOrders.length} 单</span>
            <span>可批量支付 {selectedPurchaseOrders.filter((row) => row.externalOrderId).length} 单</span>
            <Button
              size="small"
              type="primary"
              icon={<ShoppingCartOutlined />}
              disabled={!selectedPushableOrders.length}
              onClick={() => void openBatchPush1688Picker()}
            >
              批量推送
            </Button>
            <Button
              size="small"
              icon={<LinkOutlined />}
              disabled={!selectedPurchaseOrders.some((row) => row.externalOrderId)}
              loading={actingKey === "1688-batch-pay"}
              onClick={openBatch1688PaymentUrl}
            >
              批量支付
            </Button>
            <Button size="small" icon={<CloseOutlined />} onClick={() => setSelectedPoIds([])}>
              清空
            </Button>
          </div>
        ) : null}
        {purchaseOrderColumnMenu.open && typeof document !== "undefined" ? createPortal(
          <div
            className="purchase-order-column-menu"
            style={{ left: purchaseOrderColumnMenu.x, top: purchaseOrderColumnMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="purchase-order-column-menu__head">自定义字段显示信息</div>
            <div className="purchase-order-column-menu__body" style={{ maxHeight: purchaseOrderColumnMenu.bodyMaxHeight }}>
              {activePurchaseOrderColumnConfig.order.map((field) => {
                const checked = activePurchaseOrderColumnConfig.visible.includes(field);
                return (
                  <div
                    key={field}
                    className={purchaseOrderDraggedColumn === field ? "purchase-order-column-menu__item is-dragging" : "purchase-order-column-menu__item"}
                    draggable
                    onDragStart={(event) => handlePurchaseOrderColumnDragStart(event, field)}
                    onDragOver={handlePurchaseOrderColumnDragOver}
                    onDrop={(event) => handlePurchaseOrderColumnDrop(event, field)}
                    onDragEnd={handlePurchaseOrderColumnDragEnd}
                  >
                    <span className="purchase-order-column-menu__drag" aria-hidden="true">
                      <HolderOutlined />
                    </span>
                    <span>{PURCHASE_ORDER_COLUMN_LABELS[field] || field}</span>
                    <Checkbox
                      checked={checked}
                      disabled={checked && activePurchaseOrderColumnConfig.visible.length <= 1}
                      onChange={(event) => togglePurchaseOrderDraftColumn(field, event.target.checked)}
                    />
                  </div>
                );
              })}
            </div>
            <div className="purchase-order-column-menu__foot">
              <Button size="small" type="primary" onClick={savePurchaseOrderColumnConfig}>保存</Button>
              <Button size="small" onClick={restorePurchaseOrderColumnConfig}>还原</Button>
            </div>
          </div>,
          document.body,
        ) : null}
      </div>

      <Modal
        open={Boolean(requestImagePreview)}
        title={requestImagePreview?.alt || "商品图片"}
        footer={null}
        centered
        width="92vw"
        onCancel={() => setRequestImagePreview(null)}
        destroyOnClose
        styles={{ body: { padding: 0 } }}
      >
        {requestImagePreview ? (
          <div
            style={{
              height: "82vh",
              padding: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#0f172a",
              borderRadius: "0 0 8px 8px",
            }}
          >
            <img
              src={requestImagePreview.src}
              alt={requestImagePreview.alt}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: "block",
              }}
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!pushAddressPicker}
        title={pushAddressPicker ? `推送 1688 下单 · 选择收货地址（${pushAddressPicker.po.poNo || pushAddressPicker.po.id}）` : "选择收货地址"}
        okText="确认推送"
        cancelText="取消"
        confirmLoading={actingKey === `1688-push-${pushAddressPicker?.po.id}`}
        okButtonProps={{
          disabled: !pushAddressPicker || !(data.alibaba1688Addresses || []).some((addr) => (
            addr.id === pushAddressPicker.addressId
            && isUsable1688Address(addr)
            && (!pushAddressPicker.purchase1688AccountId || String((addr as any).purchase1688AccountId || "") === pushAddressPicker.purchase1688AccountId)
          )),
        }}
        width={680}
        onCancel={() => setPushAddressPicker(null)}
        onOk={async () => {
          if (!pushAddressPicker) return;
          const { po, addressId, purchase1688AccountId } = pushAddressPicker;
          setPushAddressPicker(null);
          await push1688Order(po, { deliveryAddressId: addressId, purchase1688AccountId });
        }}
        destroyOnClose
      >
        {pushAddressPicker ? (() => {
          // 跨 OAuth 选地址 1688 会报 AddressId invalid——按当前 purchase1688AccountId 过滤
          const pickerOAuth = pushAddressPicker.purchase1688AccountId;
          const filtered = (data.alibaba1688Addresses || []).filter((addr) => {
            if (!pickerOAuth) return true;
            return String((addr as any).purchase1688AccountId || "") === pickerOAuth;
          });
          const hasRemoteAddress = filtered.some(isUsable1688Address);
          return (
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                选择推到 1688 的收货地址。没有合适的去「店铺 / 1688 设置」维护。
              </Text>
              {filtered.length > 0 ? (
                <Select
                  style={{ width: "100%" }}
                  value={pushAddressPicker.addressId || undefined}
                  placeholder="请选择带 1688 远端 ID 的收货地址"
                  onChange={(newId: string) => setPushAddressPicker((prev) => prev ? { ...prev, addressId: newId } : null)}
                  options={filtered.map((addr, i) => {
                    const remoteId = get1688AddressRemoteId(addr);
                    const display = addr.fullName || addr.label || `地址 ${i + 1}`;
                    const summary = [
                      display,
                      addr.mobile || "",
                      (addr.address || "-").slice(0, 30),
                    ].filter(Boolean).join(" · ");
                    return {
                      value: addr.id,
                      label: summary + (addr.isDefault ? "（默认）" : "") + (remoteId ? "" : "（未绑 1688，不可推单）"),
                      disabled: !remoteId,
                    };
                  })}
                />
              ) : (
                <div style={{ padding: 16, background: "rgba(234, 67, 53, 0.08)", border: "1px solid rgba(234, 67, 53, 0.22)", borderRadius: 6, color: "var(--color-danger)", fontSize: 13 }}>
                  当前 1688 采购账号下还没有可用收货地址。请去「店铺 / 1688 设置」点「同步 1688 地址」拉一份，再回来选择。
                </div>
              )}
              {filtered.length > 0 && !hasRemoteAddress ? (
                <Alert
                  type="warning"
                  showIcon
                  message="这些地址还缺 1688 远端 ID"
                  description="请先点「同步 1688 地址」拉取远端完整地址；只有带远端 ID 的地址才能推送 1688 下单。"
                />
              ) : null}
            </Space>
          );
        })() : null}
      </Modal>

      <Modal
        open={!!pushAccountPicker}
        title={(
          <Space direction="vertical" size={2}>
            <Text strong style={{ fontSize: 18 }}>确认下单信息</Text>
            {pushAccountPicker ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                采购单 {pushAccountPicker.po.poNo || pushAccountPicker.po.id}
              </Text>
            ) : null}
          </Space>
        )}
        okText="确认使用"
        cancelText="取消"
        confirmLoading={actingKey === `1688-push-${pushAccountPicker?.po.id}`}
        okButtonProps={{
          disabled: !pushAccountPicker || !(data.alibaba1688Addresses || []).some((addr) => (
            addr.id === pushAccountPicker.addressId
            && isUsable1688Address(addr)
            && String((addr as any).purchase1688AccountId || "") === pushAccountPicker.accountId
          )),
        }}
        width={680}
        onCancel={() => setPushAccountPicker(null)}
        onOk={async () => {
          if (!pushAccountPicker) return;
          const { po, accountId, addressId } = pushAccountPicker;
          setPushAccountPicker(null);
          await push1688Order(po, {
            purchase1688AccountId: accountId,
            ...(addressId ? { deliveryAddressId: addressId } : {}),
          });
        }}
        destroyOnClose
      >
        {pushAccountPicker ? (() => {
          // 按当前选定 OAuth 过滤地址（跨 OAuth 1688 那边会报 AddressId invalid）
          const filteredAddrs = (data.alibaba1688Addresses || []).filter(
            (a) => String((a as any).purchase1688AccountId || "") === pushAccountPicker.accountId,
          );
          const hasRemoteAddress = filteredAddrs.some(isUsable1688Address);
          return (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <div>
                <Text strong style={{ fontSize: 13 }}>1688 采购账号</Text>
                <Select
                  style={{ width: "100%", marginTop: 6 }}
                  value={pushAccountPicker.accountId}
                  onChange={(newId: string) => {
                    setPushAccountPicker((prev) => {
                      if (!prev) return null;
                      const matched = (data.alibaba1688Addresses || []).filter(
                        (a) => String((a as any).purchase1688AccountId || "") === newId,
                      );
                      const nextAddrId = pickDefaultUsable1688Address(matched)?.id || null;
                      return { ...prev, accountId: newId, addressId: nextAddrId };
                    });
                  }}
                  options={pushAccountPicker.accounts.map((acct, i) => ({
                    value: acct.id,
                    label: (acct.label || `采购账号 ${i + 1}`)
                      + (acct.id === pushAccountPicker.defaultAccountId ? "（店铺默认）" : ""),
                  }))}
                />
              </div>
              <div>
                <Text strong style={{ fontSize: 13 }}>收货地址</Text>
                {filteredAddrs.length > 0 ? (
                  <>
                    <Select
                      style={{ width: "100%", marginTop: 6 }}
                      value={pushAccountPicker.addressId || undefined}
                      placeholder="请选择收货地址"
                      onChange={(newId: string) => setPushAccountPicker((prev) => prev ? { ...prev, addressId: newId } : null)}
                      options={filteredAddrs.map((addr, i) => {
                        const remoteId = get1688AddressRemoteId(addr);
                        const display = addr.fullName || addr.label || `地址 ${i + 1}`;
                        const summary = [
                          display,
                          addr.mobile || "",
                          (addr.address || "-").slice(0, 30),
                        ].filter(Boolean).join(" · ");
                        return {
                          value: addr.id,
                          label: summary + (addr.isDefault ? "（默认）" : "") + (remoteId ? "" : "（未绑 1688，不可推单）"),
                          disabled: !remoteId,
                        };
                      })}
                    />
                    {filteredAddrs.length > 0 && !hasRemoteAddress ? (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginTop: 8 }}
                        message="这些地址还缺 1688 远端 ID"
                        description="请点下面「同步地址」重新从 1688 拉取完整地址；只有带远端 ID 的地址才能推送下单。"
                      />
                    ) : null}
                  </>
                ) : (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 6 }}
                    message="该 1688 账号下还没同步过地址"
                    description={(
                      <Space direction="vertical" size={6}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          点下面按钮从 1688 拉一次该买家账号的地址簿,完成后再选地址点「确认使用」。
                        </Text>
                        <Button
                          size="small"
                          type="primary"
                          onClick={async () => {
                            if (!erp || !pushAccountPicker) return;
                            try {
                              const r: any = await erp.purchase.action({
                                action: "sync_1688_addresses",
                                accountId: pushAccountPicker.po.accountId,
                                purchase1688AccountId: pushAccountPicker.accountId,
                                includeWorkbench: false,
                              }, { timeoutMs: 120000 });
                              const n = Number(r?.result?.addressCount || 0);
                              await loadSupplementalWorkbenchData();
                              if (n > 0) message.success(`已同步 ${n} 条地址`);
                              else message.warning("1688 没返回地址数据,请先在 1688 后台维护好该账号的收货地址(work.1688.com → 个人中心 → 收货地址簿)");
                            } catch (e: any) {
                              message.error(e?.message || "1688 地址同步失败");
                            }
                          }}
                        >
                          从该账号同步地址
                        </Button>
                      </Space>
                    )}
                  />
                )}
              </div>
            </Space>
          );
        })() : null}
      </Modal>

      <Modal
        open={!!batchPushPicker}
        title={(
          <Space direction="vertical" size={2}>
            <Text strong style={{ fontSize: 18 }}>批量推送 1688</Text>
            {batchPushPicker ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {batchPushPicker.progress.total} 单 · 按店铺分组 {batchPushPicker.groups.length} 组
                {batchPushPicker.fallbackMode ? "（主控不支持多账号，将用 company 默认 1688 凭据推送）" : ""}
              </Text>
            ) : null}
          </Space>
        )}
        okText={batchPushPicker?.running
          ? `推送中 ${batchPushPicker.progress.done}/${batchPushPicker.progress.total}`
          : "开始批量推送"}
        cancelText="取消"
        confirmLoading={!!batchPushPicker?.running}
        okButtonProps={{
          disabled: !batchPushPicker?.groups.length
            || !batchPushPicker?.addressId
            || !(data.alibaba1688Addresses || []).some((addr) =>
              addr.id === batchPushPicker?.addressId && isUsable1688Address(addr)),
        }}
        width={760}
        maskClosable={false}
        onCancel={() => {
          if (batchPushPicker?.running) {
            message.info("正在推送中，请等一会儿");
            return;
          }
          setBatchPushPicker(null);
        }}
        onOk={() => void runBatchPush1688()}
        destroyOnClose
      >
        {batchPushPicker ? (() => {
          // 按所选 1688 采购账号（OAuth）过滤地址——跨 OAuth 1688 会报 AddressId invalid。
          // 多组时取并集（所有组当前选的 OAuth 下的地址），用户在地址下拉只能选有效的。
          const oauthsInPlay = Array.from(new Set(
            batchPushPicker.groups.map((g) => g.selectedPurchaseAccountId).filter(Boolean) as string[],
          ));
          const filteredAddrs = (data.alibaba1688Addresses || []).filter((a) => {
            if (oauthsInPlay.length === 0) return true;
            return oauthsInPlay.includes(String((a as any).purchase1688AccountId || ""));
          });
          return (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              {batchPushPicker.progress.done > 0 ? (
                <div style={{ padding: "8px 12px", background: "#f9fafb", border: "1px solid #e5e9f0", borderRadius: 8, fontSize: 13 }}>
                  已推送 {batchPushPicker.progress.done}/{batchPushPicker.progress.total}
                  {" · 成功 "}<Text strong style={{ color: "#16a34a" }}>{batchPushPicker.progress.ok}</Text>
                  {" · 失败 "}<Text strong style={{ color: "#dc2626" }}>{batchPushPicker.progress.fail}</Text>
                </div>
              ) : null}

              {/* 顺序跟单推 Modal 一致：账号在上、地址在下 */}
              {!batchPushPicker.fallbackMode ? (
                <div>
                  <Text strong style={{ fontSize: 13 }}>1688 采购账号（按店铺分组 {batchPushPicker.groups.length} 组）</Text>
                  {batchPushPicker.groups.map((group) => (
                    <div key={group.accountId || "unknown"} style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
                        {group.accountName}（{group.pos.length} 单：{group.pos.slice(0, 3).map((po) => po.poNo || po.id).join("、")}{group.pos.length > 3 ? ` 等 ${group.pos.length} 单` : ""}）
                      </div>
                      <Select
                        style={{ width: "100%" }}
                        value={group.selectedPurchaseAccountId || undefined}
                        onChange={(value) => setBatchPushPicker((prev) => {
                          if (!prev) return prev;
                          // 切换账号后,如果当前选的地址不在新账号下,重置 addressId 为新账号下的默认
                          const newOauths = Array.from(new Set(
                            prev.groups.map((g) => g.accountId === group.accountId ? (value || null) : g.selectedPurchaseAccountId)
                              .filter(Boolean) as string[],
                          ));
                          const newFiltered = (data.alibaba1688Addresses || []).filter((a) =>
                            !newOauths.length || newOauths.includes(String((a as any).purchase1688AccountId || "")),
                          );
                          const currentAddrStillValid = prev.addressId
                            && newFiltered.some((a) => a.id === prev.addressId && isUsable1688Address(a));
                          const nextAddrId = currentAddrStillValid ? prev.addressId : (pickDefaultUsable1688Address(newFiltered)?.id || null);
                          return {
                            ...prev,
                            addressId: nextAddrId,
                            groups: prev.groups.map((item) => item.accountId === group.accountId
                              ? { ...item, selectedPurchaseAccountId: value || null }
                              : item),
                          };
                        })}
                        placeholder="选 1688 采购账号"
                        options={batchPushPicker.accounts.map((acct) => ({
                          value: acct.id,
                          label: `${acct.label || acct.id}${acct.id === group.defaultPurchaseAccountId ? "（店铺默认）" : ""}`,
                        }))}
                        disabled={batchPushPicker.running}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>使用 company 默认 1688 凭据推送（主控不支持多账号）</Text>
              )}

              <div>
                <Text strong style={{ fontSize: 13 }}>收货地址（所有组共用）</Text>
                {filteredAddrs.length ? (
                  <Select
                    style={{ width: "100%", marginTop: 6 }}
                    value={batchPushPicker.addressId || undefined}
                    onChange={(value) => setBatchPushPicker((prev) => prev ? { ...prev, addressId: value || null } : prev)}
                    placeholder="请选择收货地址"
                    options={filteredAddrs.map((addr, i) => {
                      const remoteId = get1688AddressRemoteId(addr);
                      const display = addr.fullName || addr.label || `地址 ${i + 1}`;
                      const summary = [
                        display,
                        addr.mobile || "",
                        (addr.address || "-").slice(0, 30),
                      ].filter(Boolean).join(" · ");
                      return {
                        value: addr.id,
                        label: summary + (addr.isDefault ? "（默认）" : "") + (remoteId ? "" : "（未绑 1688，不可推单）"),
                        disabled: !remoteId,
                      };
                    })}
                    disabled={batchPushPicker.running}
                  />
                ) : (
                  <div style={{ marginTop: 6, padding: 12, background: "rgba(234, 67, 53, 0.08)", border: "1px solid rgba(234, 67, 53, 0.22)", borderRadius: 6, color: "var(--color-danger)", fontSize: 12 }}>
                    所选 1688 采购账号下还没有可用收货地址。请去「店铺 / 1688 设置」点「同步 1688 地址」拉一份后再推。
                  </div>
                )}
              </div>
            </Space>
          );
        })() : null}
      </Modal>

      <Modal
        open={storeManagerOpen}
        title="店铺"
        footer={null}
        width={860}
        onCancel={() => setStoreManagerOpen(false)}
        destroyOnClose
      >
        <StoreManager onChanged={loadData} />
      </Modal>

      <Modal
        open={purchaseSettingsOpen}
        title="询盘设置"
        okText="保存设置"
        cancelText="取消"
        width={720}
        confirmLoading={actingKey === "save-purchase-settings"}
        onCancel={() => setPurchaseSettingsOpen(false)}
        onOk={() => purchaseSettingsForm.submit()}
        destroyOnClose
      >
        <Form
          form={purchaseSettingsForm}
          layout="vertical"
          onFinish={savePurchaseSettings}
          initialValues={{
            inquiryTemplate: data.purchaseSettings?.inquiryTemplate || DEFAULT_PURCHASE_INQUIRY_TEMPLATE,
          }}
        >
          <Alert
            type={data.purchaseSettings?.hasAlphaShopCredentials ? "success" : "warning"}
            showIcon
            style={{ marginBottom: 16 }}
            message={data.purchaseSettings?.hasAlphaShopCredentials ? "询盘会复用图搜同款配置" : "需要先配置图搜同款密钥才能真实发起 1688 询盘"}
            description="这里只设置发给 1688 商家的默认询盘话术，AlphaShop 密钥默认使用图搜同款保存的本地配置。"
          />
          <Form.Item
            name="inquiryTemplate"
            label="默认询盘话术"
            rules={[
              { required: true, message: "请输入询盘话术" },
              { max: 2000, message: "询盘话术不能超过 2000 字" },
            ]}
          >
            <Input.TextArea
              rows={7}
              showCount
              maxLength={2000}
              placeholder={DEFAULT_PURCHASE_INQUIRY_TEMPLATE}
            />
          </Form.Item>
          <Space size={[6, 6]} wrap>
            {PURCHASE_INQUIRY_TEMPLATE_VARIABLES.map((variable) => (
              <Tag key={variable} color="default" style={{ marginInlineEnd: 0 }}>
                {variable}
              </Tag>
            ))}
          </Space>
          <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
            保存后，采购中心里的批量询盘会自动使用这段话术；变量会按当前采购单和候选商品自动替换。
          </Text>
        </Form>
        <div style={{ borderTop: "1px solid var(--color-border)", marginTop: 16, paddingTop: 16 }}>
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Text strong>1688 收货地址</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              地址只能在 1688 后台维护（开放平台未提供创建接口）。在 1688 后台建好后回到这里点「同步 1688 地址」拉回最新数据；已不存在于远端的本地地址会被自动标记为失效。当前本地共 {data.alibaba1688Addresses?.length || 0} 条。
            </Text>
            <Space wrap>
              <Button
                icon={<SyncOutlined />}
                loading={actingKey === "sync-1688-addresses"}
                onClick={sync1688Addresses}
              >
                同步 1688 地址
              </Button>
              <Button
                icon={<LinkOutlined />}
                onClick={open1688AddressBackend}
              >
                打开 1688 后台
              </Button>
            </Space>
          </Space>
        </div>
      </Modal>

      <Modal
        open={Boolean(inquiryDialogPrId)}
        title="发起批量询盘"
        okText="发起询盘"
        cancelText="取消"
        width={820}
        confirmLoading={Boolean(inquiryDialogPr && actingKey === `1688-inquiry-${inquiryDialogPr.id}`)}
        okButtonProps={{ disabled: inquiryDialogCandidates.length === 0 }}
        onCancel={closeInquiryDialog}
        onOk={() => inquiryDialogForm.submit()}
        destroyOnClose
      >
        <Space direction="vertical" size={18} style={{ width: "100%" }}>
          <div
            style={{
              display: "flex",
              gap: 12,
              overflowX: "auto",
              padding: 12,
              background: "#f8fbff",
              borderRadius: 8,
            }}
          >
            {inquiryDialogCandidates.map((candidate) => {
              const image = candidateImage(candidate);
              const title = candidateTitle(candidate);
              return (
                <div
                  key={candidate.id}
                  style={{
                    width: 116,
                    flex: "0 0 116px",
                    borderRadius: 8,
                    background: "#fff",
                    padding: 6,
                    border: "1px solid #eef2f7",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "1 / 1",
                      borderRadius: 6,
                      background: "#f1f5f9",
                      overflow: "hidden",
                    }}
                  >
                    {image ? (
                      <img src={image} alt={title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    ) : null}
                  </div>
                  <Paragraph ellipsis={{ rows: 1, tooltip: title }} style={{ margin: "6px 0 2px", fontSize: 12 }}>
                    {title}
                  </Paragraph>
                  <Text style={{ color: "#ea580c", fontSize: 12, fontWeight: 700 }}>
                    {formatCurrency(candidate.unitPrice)}
                  </Text>
                </div>
              );
            })}
          </div>

          <Form
            form={inquiryDialogForm}
            layout="vertical"
            onFinish={submitInquiryDialog}
            initialValues={{ inquiryMessage: data.purchaseSettings?.inquiryTemplate || DEFAULT_PURCHASE_INQUIRY_TEMPLATE }}
          >
            <Form.Item
              name="inquiryMessage"
              label="询盘诉求"
              extra="可以在发送前临时修改，本次会按这里的内容记录到候选商品询盘记录。"
              rules={[
                { required: true, message: "请输入询盘诉求" },
                { max: 1000, message: "询盘诉求不能超过 1000 字" },
              ]}
            >
              <Input.TextArea
                rows={7}
                showCount
                maxLength={1000}
                placeholder={DEFAULT_PURCHASE_INQUIRY_TEMPLATE}
              />
            </Form.Item>
          </Form>
        </Space>
      </Modal>

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
        open={directPoOpen}
        title="创建采购单"
        okText="创建采购单"
        cancelText="取消"
        centered
        width={620}
        confirmLoading={actingKey === "direct-po"}
        onCancel={() => setDirectPoOpen(false)}
        onOk={() => directPoForm.submit()}
        destroyOnClose
      >
        {hasAttemptedSkuSearch && !skuSearching && skuOptions.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            message="还没有商品资料"
            description="请先到左侧商品资料创建商品编码，再回来创建采购单。"
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Form
          form={directPoForm}
          layout="vertical"
          initialValues={{ items: [{ qty: 1 }] }}
          onFinish={handleDirectPoSubmit}
        >
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <div className="direct-po-lines">
                <div className="direct-po-lines__head" aria-hidden>
                  <span>商品编码</span>
                  <span>采购数量</span>
                  <span />
                </div>
                {fields.map((field) => (
                  <div className="direct-po-lines__row" key={field.key}>
                    <Form.Item
                      name={[field.name, "skuIds"]}
                      rules={[{ required: true, message: "请选择商品编码" }]}
                    >
                      <Select
                        mode="tags"
                        showSearch
                        filterOption={false}
                        onSearch={handleSkuSearch}
                        onChange={(values) => {
                          directPoForm.setFieldValue(
                            ["items", field.name, "skuIds"],
                            Array.isArray(values) ? values.slice(-1) : [],
                          );
                        }}
                        loading={skuSearching}
                        maxTagCount={1}
                        optionFilterProp="searchText"
                        options={skuOptions}
                        optionRender={renderSkuOption}
                        suffixIcon={<SearchOutlined />}
                        tokenSeparators={[",", "，", " ", "\n"]}
                        notFoundContent={skuSearching ? "搜索中…" : "输入编码或名称搜索"}
                        placeholder="输入商品编码或名称搜索"
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "qty"]}
                      rules={[{ required: true, message: "请输入采购数量" }]}
                    >
                      <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                    <Button
                      className="direct-po-lines__remove"
                      icon={<DeleteOutlined />}
                      onClick={() => remove(field.name)}
                      disabled={fields.length <= 1}
                      aria-label="删除商品行"
                    />
                  </div>
                ))}
                <Button
                  className="direct-po-lines__add"
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ qty: 1 })}
                >
                  添加商品行
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        open={requestOpen}
        title={requestCreateMode === "optimization" ? "新建优化" : "新建找品"}
        okText={requestCreateMode === "optimization" ? "提交优化" : "提交找品"}
        cancelText="取消"
        confirmLoading={actingKey === "create-pr"}
        onCancel={() => {
          setRequestOpen(false);
          setRequestUploadImages([]);
        }}
        onOk={() => requestForm.submit()}
        destroyOnClose
      >
        {hasAttemptedSkuSearch && !skuSearching && skuOptions.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            message="还没有商品资料"
            description={`请先到左侧商品资料创建商品编码，再回来新建${requestCreateMode === "optimization" ? "优化" : "找品"}。`}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <div onPaste={handleRequestImagePaste}>
        <Form form={requestForm} layout="vertical" onFinish={handleCreateRequest} initialValues={{ requestedQty: 1 }}>
          <Form.Item name="skuIds" label="商品编码" rules={[{ required: true, message: "请选择商品编码" }]}>
            <Select
              mode="tags"
              showSearch
              filterOption={false}
              onSearch={handleSkuSearch}
              loading={skuSearching}
              maxTagCount="responsive"
              optionFilterProp="searchText"
              options={skuOptions}
              optionRender={renderSkuOption}
              suffixIcon={<SearchOutlined />}
              tokenSeparators={[",", "，", " ", "\n"]}
              notFoundContent={skuSearching ? "搜索中…" : "输入编码或名称搜索"}
              placeholder="输入商品编码或名称搜索，回车添加，可多选"
            />
          </Form.Item>
          <Form.Item name="specText" label={requestCreateMode === "optimization" ? "优化规格" : "找品规格"}>
            <Input
              placeholder={requestCreateMode === "optimization"
                ? "要优化的颜色 / 尺寸 / 包装 / 成本目标"
                : "颜色 / 尺寸 / 几个装，例如：蓝色 30cm 2个装"}
              allowClear
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
                  <UploadOutlined style={{ fontSize: 28, color: "#1a73e8" }} />
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
          <Form.Item name="evidenceText" label={requestCreateMode === "optimization" ? "优化诉求 / 链接" : "证据 / 链接"}>
            <TextArea
              rows={3}
              placeholder={requestCreateMode === "optimization"
                ? "每行一条：现有货源问题、目标价格、竞品链接、需要替换的供应商等"
                : "每行一条：销量截图、竞品链接、站内数据结论等"}
            />
          </Form.Item>
        </Form>
        </div>
      </Modal>

      <Modal
        open={Boolean(offlinePoTarget)}
        title={
          offlinePoTarget?.mode === "edit"
            ? "编辑采购单"
            : offlinePoTarget?.mode === "convert"
              ? "转为线下采购"
              : "线下采购单"
        }
        okText={
          offlinePoTarget?.mode === "edit"
            ? "保存"
            : offlinePoTarget?.mode === "convert"
              ? "确认转线下"
              : "创建采购单"
        }
        cancelText="取消"
        confirmLoading={offlinePoSubmitting}
        onCancel={() => setOfflinePoTarget(null)}
        onOk={() => offlinePoForm.submit()}
        destroyOnClose
      >
        <Form
          form={offlinePoForm}
          layout="vertical"
          initialValues={offlinePoInitialValues}
          onFinish={handleOfflinePoSubmit}
        >
          {offlinePoTarget?.mode === "convert" ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={
                offlinePoTarget.po.externalOrderId
                  ? `将取消 1688 原单 ${offlinePoTarget.po.externalOrderId}，并把此采购单改为线下采购`
                  : "将把此采购单改为线下采购，状态回到草稿"
              }
              description="提交后不可自动恢复线上单，1688 后台请自行确认取消状态"
            />
          ) : null}
          <Form.Item name="supplierId" label="已有供应商">
            <Select allowClear showSearch optionFilterProp="label" options={supplierOptions} placeholder="可选；没有就在下面手填供应商名称" />
          </Form.Item>
          <Form.Item name="supplierName" label="供应商名称">
            <Input placeholder="手填供应商或平台店铺名称（线下采购可不绑已有供应商）" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="unitPrice" label="采购单价" rules={[{ required: true, message: "请输入采购单价" }]}>
                <InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="logisticsFee" label="运费">
                <InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="qty" label="采购数量" rules={[{ required: true, message: "请输入采购数量" }]}>
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        open={Boolean(buyerFeedbackPr)}
        title="采购员回填"
        okText="保存回填"
        cancelText="取消"
        confirmLoading={buyerFeedbackPr ? actingKey === `buyer-feedback-${buyerFeedbackPr.id}` : false}
        onCancel={() => setBuyerFeedbackPrId(null)}
        onOk={() => buyerFeedbackForm.submit()}
        destroyOnClose
      >
        <Form form={buyerFeedbackForm} layout="vertical" onFinish={handleBuyerFeedback}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={buyerFeedbackPr ? `${buyerFeedbackPr.productName || buyerFeedbackPr.internalSkuCode || "采购需求"} · ${formatQty(buyerFeedbackPr.requestedQty)} 件` : ""}
          />
          <Form.Item name="buyerUnitCost" label="采购成本" rules={[{ required: true, message: "请输入采购成本" }]}>
            <InputNumber min={0} precision={2} prefix="¥" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="buyerRemark" label="备注">
            <TextArea rows={4} maxLength={500} showCount placeholder="供应商情况、成本口径、替代方案或风险说明" />
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
      title="1688 找货源"
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
        open={Boolean(specBindingDialog)}
        title="选择并绑定 1688 规格"
        okText="绑定规格"
        cancelText="取消"
        width={980}
        confirmLoading={specBindingCandidate ? actingKey === `1688-bind-spec-${specBindingCandidate.id}` : false}
        okButtonProps={{ disabled: !selectedBindingSpec }}
        onCancel={() => {
          setSpecBindingDialog(null);
          setSpecBindingSearchText("");
        }}
        onOk={() => void confirmBindCandidate1688Spec()}
        destroyOnClose
      >
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索规格 / SKU ID / Spec ID"
            value={specBindingSearchText}
            onChange={(event) => setSpecBindingSearchText(event.target.value)}
          />
          <Table<BindingSpecRow>
            size="small"
            rowKey="externalSpecId"
            columns={specBindingColumns}
            dataSource={filteredSpecBindingRows}
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            locale={{ emptyText: specBindingSearchText.trim() ? "没有匹配的 1688 规格" : "暂无可绑定规格" }}
            rowSelection={{
              type: "radio",
              selectedRowKeys: selectedBindingSpecId ? [selectedBindingSpecId] : [],
              onChange: (keys) => setSelectedBindingSpecId(String(keys[0] || "")),
            }}
            onRow={(row) => ({
              onClick: () => setSelectedBindingSpecId(row.externalSpecId),
            })}
          />
          <Row gutter={12}>
            <Col span={12}>
              <Text type="secondary" style={{ display: "block", marginBottom: 6 }}>本地数量</Text>
              <InputNumber
                min={1}
                precision={0}
                value={bindingOurQty}
                style={{ width: "100%" }}
                addonBefore="本地"
                addonAfter="件"
                onChange={(value) => setBindingOurQty(Math.max(1, Math.floor(Number(value || 1))))}
              />
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ display: "block", marginBottom: 6 }}>1688 数量</Text>
              <InputNumber
                min={1}
                precision={0}
                value={bindingPlatformQty}
                style={{ width: "100%" }}
                addonBefore="1688"
                addonAfter="件"
                onChange={(value) => setBindingPlatformQty(Math.max(1, Math.floor(Number(value || 1))))}
              />
            </Col>
          </Row>
        </Space>
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
            {refundAutoLoadingPoId === refundPo.id ? (
              <Text type="secondary">正在自动读取售后、可退金额和退款原因…</Text>
            ) : null}
            <Form form={refundForm} layout="vertical" onFinish={handleCreate1688Refund}>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="refundType" label="退款类型" rules={[{ required: true, message: "请选择退款类型" }]}>
                    <Select
                      onChange={(value) => {
                        if (refundPo) {
                          void refreshRefundComputedFields(refundPo, {
                            refundType: value,
                            goodsStatus: refundForm.getFieldValue("goodsStatus"),
                          });
                        }
                      }}
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
                      onChange={(value) => {
                        if (refundPo) {
                          void refreshRefundComputedFields(refundPo, {
                            refundType: refundForm.getFieldValue("refundType"),
                            goodsStatus: value,
                          });
                        }
                      }}
                      options={[
                        { label: "已收货", value: "received" },
                        { label: "未收货", value: "not_received" },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="amount"
                    label="退款金额"
                    extra={refundMaxAmount !== null ? `1688最大可退：${formatCurrency(refundMaxAmount)}` : undefined}
                    rules={[{ required: true, message: "请输入退款金额" }]}
                  >
                    <InputNumber min={0} precision={2} style={{ width: "100%" }} placeholder="0.00" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="reason" label="退款原因" rules={[{ required: true, message: "请输入退款原因" }]}>
                    {refundReasonOptions.length ? (
                      <Select
                        showSearch
                        options={refundReasonOptions}
                        optionFilterProp="label"
                        placeholder="选择退款原因"
                        onChange={handleRefundReasonChange}
                      />
                    ) : (
                      <Input placeholder="例如：缺货、质量问题、协商退款" />
                    )}
                  </Form.Item>
                  <Form.Item name="refundReasonId" hidden>
                    <Input />
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

      {minimizedImageSearchPr ? (() => {
        const previewImage = getPurchaseRequestDefaultImageUrl(minimizedImageSearchPr);
        const candidateCount = minimizedImageSearchPr.candidates?.length || minimizedImageSearchPr.candidateCount || 0;
        return (
          <div
            role="button"
            tabIndex={0}
            title="拖动调整位置，点击恢复图搜"
            onPointerDown={handleMinimizedImageSearchPointerDown}
            onPointerMove={handleMinimizedImageSearchPointerMove}
            onPointerUp={handleMinimizedImageSearchPointerUp}
            onPointerCancel={handleMinimizedImageSearchPointerCancel}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                reopenMinimizedImageSearch();
              }
            }}
            style={{
              position: "fixed",
              left: minimizedImageSearchPosition.left,
              top: minimizedImageSearchPosition.top,
              zIndex: 1100,
              width: MINIMIZED_IMAGE_SEARCH_WIDTH,
              height: MINIMIZED_IMAGE_SEARCH_HEIGHT,
              borderRadius: 8,
              background: "rgba(15, 23, 42, 0.78)",
              boxShadow: "0 10px 28px rgba(15, 23, 42, 0.22)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 10px 7px 8px",
              cursor: "grab",
              userSelect: "none",
              touchAction: "none",
              backdropFilter: "blur(6px)",
            }}
          >
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setMinimizedImageSearchPrId(null);
              }}
              style={{
                position: "absolute",
                top: -8,
                right: -8,
                width: 18,
                height: 18,
                minWidth: 18,
                borderRadius: 9,
                padding: 0,
                color: "#64748b",
                background: "#fff",
                boxShadow: "0 2px 8px rgba(15, 23, 42, 0.16)",
              }}
            />
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 6,
                background: "#fff",
                overflow: "hidden",
                flex: "0 0 auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {previewImage ? (
                <img
                  src={previewImage}
                  alt="以图搜款"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <SearchOutlined style={{ color: "#ea580c", fontSize: 18 }} />
              )}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Text style={{ display: "block", color: "#fff", fontWeight: 700, lineHeight: "18px" }}>图搜</Text>
              <Text style={{ display: "block", color: "rgba(255, 255, 255, 0.72)", fontSize: 11, lineHeight: "16px" }}>
                {formatQty(candidateCount)} 候选
              </Text>
            </div>
            <RightOutlined style={{ color: "#fff", fontSize: 14, flex: "0 0 auto" }} />
          </div>
        );
      })() : null}

      <Drawer
        open={detailDrawerOpen && Boolean(detailPrId)}
        title={detailDrawerMode === "imageSearch" ? "以图搜款" : "采购单日志与协作"}
        width={1080}
        onClose={closeDetailDrawer}
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

            {detailDrawerMode === "collaboration" ? (
            <div className="purchase-log-panel" onPaste={handleCollaborationPaste}>
              <div className="purchase-log-tabs" aria-label="采购单日志视图">
                {["采购明细", "跟单信息", "入库&退货", "采购质检", "付款记录", "操作日志"].map((item) => (
                  <span key={item} className={item === "操作日志" ? "purchase-log-tabs__item is-active" : "purchase-log-tabs__item"}>
                    {item}
                  </span>
                ))}
              </div>
              <Table<TimelineRow>
                rowKey="id"
                size="small"
                className="erp-compact-table purchase-log-table"
                columns={detailLogColumns}
                dataSource={detailEventRows}
                pagination={false}
                locale={{ emptyText: "暂无操作日志" }}
                scroll={{ y: 300 }}
              />
              <div className="purchase-log-chat">
                <div className="purchase-log-chat__head">
                  <Text strong>协作记录</Text>
                  <Text type="secondary">可发送文字、添加图片，也可以直接粘贴截图</Text>
                </div>
                <div className="purchase-log-chat__list">
                  {detailCommentRows.map((item) => {
                    const imageUrls = extractMessageImageUrls(item.message);
                    const strippedText = stripMessageImageLines(item.message);
                    const text = imageUrls.length && strippedText === "图片" ? "" : strippedText;
                    return (
                      <div key={item.id} className="purchase-log-chat__item">
                        <div className="purchase-log-chat__meta">
                          <Text strong>{purchaseLogActor(item)}</Text>
                          {item.actorRole ? <Tag>{item.actorRole}</Tag> : null}
                          <Text type="secondary">{formatDateTime(item.createdAt)}</Text>
                        </div>
                        {text ? (
                          <Paragraph className="purchase-log-chat__text">
                            {text}
                          </Paragraph>
                        ) : null}
                        {imageUrls.length ? (
                          <div className="purchase-log-chat__images">
                            {imageUrls.map((url) => (
                              <a key={url} href={url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                                <img src={url} alt="聊天图片" />
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {!detailCommentRows.length ? (
                    <Text type="secondary">暂无聊天记录</Text>
                  ) : null}
                </div>
                <div className="purchase-log-chat__composer">
                  <Input.TextArea
                    value={collaborationDraft}
                    onChange={(event) => setCollaborationDraft(event.target.value)}
                    placeholder="输入报价反馈、供应商沟通、价格建议，或直接粘贴截图"
                    rows={3}
                    maxLength={500}
                  />
                  {collaborationUploadImages.length > 0 ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                      {collaborationUploadImages.map((item) => (
                        <div key={item.uid} style={{ position: "relative" }}>
                          <img
                            src={item.dataUrl}
                            alt={item.fileName}
                            style={{
                              width: 72,
                              height: 72,
                              objectFit: "cover",
                              borderRadius: 8,
                              border: "1px solid #e5e7eb",
                              background: "#f8fbff",
                            }}
                          />
                          <Button
                            size="small"
                            danger
                            type="text"
                            icon={<DeleteOutlined />}
                            onClick={() => setCollaborationUploadImages((previous) => previous.filter((image) => image.uid !== item.uid))}
                            style={{ position: "absolute", right: 2, top: 2, background: "rgba(255,255,255,0.92)" }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginTop: 12 }}>
                    <Space size={8} wrap>
                      <Upload
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        showUploadList={false}
                        beforeUpload={handleCollaborationImageUpload}
                      >
                        <Button icon={<UploadOutlined />}>添加图片</Button>
                      </Upload>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        已添加 {collaborationUploadImages.length}/{MAX_COMMENT_IMAGES} 张
                      </Text>
                    </Space>
                    <Space size={10} align="center">
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {collaborationDraft.length}/500
                      </Text>
                      <Button
                        type="primary"
                        icon={<CommentOutlined />}
                        loading={Boolean(detailPr && actingKey === `comment-${detailPr.id}`)}
                        disabled={!collaborationDraft.trim() && collaborationUploadImages.length === 0}
                        onClick={submitCollaborationComment}
                      >
                        发送
                      </Button>
                    </Space>
                  </div>
                </div>
              </div>
            </div>
            ) : null}

            {detailDrawerMode === "imageSearch" ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <Space align="baseline" size={8}>
                  <Text strong>候选商品</Text>
                  <Text type="secondary">{formatQty(detailCandidateCount)} 个候选</Text>
                  <Text type="secondary">{selectedInquiryCount ? `已勾选 ${selectedInquiryCount}` : "未勾选"}</Text>
                </Space>
                <Space size={8} wrap>
                  <Checkbox
                    checked={allInquiryCandidatesSelected}
                    indeterminate={someInquiryCandidatesSelected}
                    disabled={!selectableInquiryCandidateIds.length}
                    onChange={(event) => toggleAllInquiryCandidates(event.target.checked)}
                  >
                    全选未询盘
                  </Checkbox>
                  <Button
                    type="primary"
                    icon={<CommentOutlined />}
                    disabled={!selectedInquiryCount}
                    loading={Boolean(detailPr && actingKey === `1688-inquiry-${detailPr.id}`)}
                    onClick={() => openInquiryDialog(detailPr!, selectedInquiryCandidateIds)}
                  >
                    批量询盘
                  </Button>
                </Space>
              </div>
              {detailImageSearchLoading && !detailCandidateCount ? (
                <div
                  style={{
                    minHeight: "calc(100vh - 260px)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    color: "#475569",
                  }}
                >
                  <Spin size="large" />
                  <Text strong>正在以图搜款</Text>
                  <Text type="secondary">正在从 1688 拉取候选商品，结果回来后会自动展示。</Text>
                </div>
              ) : (
                <>
                  {!detailCandidateCount ? (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginTop: 8, marginBottom: 8 }}
                      message={latestImageSearchEmptyEvent(detailPr!)?.message || "还没有候选商品"}
                    />
                  ) : null}
                  <div
                    ref={candidateScrollElRef}
                    onScroll={(event) => handleCandidateScroll(event, detailPr!)}
                    style={{
                      maxHeight: "calc(100vh - 260px)",
                      overflowY: "auto",
                      overscrollBehavior: "contain",
                      paddingRight: 6,
                      marginTop: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(184px, 1fr))",
                        gap: 16,
                      }}
                    >
                      {(detailPr!.candidates || []).map((candidate, index) => {
                  const image = candidateImage(candidate);
                  const title = candidateTitle(candidate);
                  const url = candidateUrl(candidate);
                  const badges = candidateBadgeTexts(candidate);
                  const inquiryStatusInfo = candidateInquiryStatusInfo(candidate);
                  const salesText = candidateSalesText(candidate);
                  const serviceTexts = candidateServiceTexts(candidate);
                  const locationText = candidateLocationText(candidate);
                  const supplierText = [locationText, candidate.supplierName || "供应商"].filter(Boolean).join(" · ");
                  const freightText = Number(candidate.logisticsFee || 0) > 0
                    ? `运费 ${formatCurrency(candidate.logisticsFee)}`
                    : "包邮";
                  const inquirySent = candidateInquirySent(candidate);
                  const inquirySelected = selectedInquiryCandidateIdSet.has(candidate.id);
                  const inquiryExecutedAt = candidateInquiryExecutedAt(candidate);
                  const inquiryFailureReason = candidateInquiryFailureReason(candidate);
                  return (
                    <div
                      key={candidate.id}
                      role={url ? "button" : undefined}
                      tabIndex={url ? 0 : undefined}
                      onClick={() => {
                        if (url) void openCandidateUrl(candidate);
                      }}
                      onKeyDown={(event) => {
                        if (!url) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void openCandidateUrl(candidate);
                        }
                      }}
                      style={{
                        position: "relative",
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        padding: 10,
                        minHeight: 404,
                        background: "#fff",
                        cursor: url ? "pointer" : "default",
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
                      <button
                        type="button"
                        aria-pressed={inquirySelected}
                        aria-label={inquirySelected ? "取消选择候选商品" : "选择候选商品"}
                        disabled={inquirySent}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!inquirySent) toggleInquiryCandidate(candidate.id, !inquirySelected);
                        }}
                        style={{
                          position: "absolute",
                          top: 10,
                          right: 10,
                          zIndex: 2,
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          border: inquirySelected ? "1px solid #ea580c" : "1px solid rgba(148, 163, 184, 0.45)",
                          background: inquirySelected ? "#ea580c" : "rgba(255, 255, 255, 0.68)",
                          color: inquirySelected ? "#fff" : "transparent",
                          boxShadow: inquirySelected ? "0 2px 8px rgba(234, 88, 12, 0.22)" : "none",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: inquirySent ? "not-allowed" : "pointer",
                          opacity: inquirySent ? 0.32 : 1,
                          padding: 0,
                        }}
                      >
                        <CheckCircleOutlined style={{ fontSize: 15 }} />
                      </button>
                      <div
                        style={{
                          width: "100%",
                          aspectRatio: "1 / 1",
                          borderRadius: 8,
                          background: "#f8fbff",
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
                        <Space size={4} wrap style={{ marginTop: 6, minHeight: 22 }}>
                          {badges.map((badge) => (
                            <Tag key={badge} color="green" style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: "18px" }}>
                              {badge}
                            </Tag>
                          ))}
                          {inquiryStatusInfo ? (
                            <Popover
                              trigger="click"
                              title="询盘记录"
                              content={(
                                <Space direction="vertical" size={8} style={{ width: 300 }}>
                                  <div>
                                    <Text type="secondary" style={{ display: "block", fontSize: 12 }}>执行询盘时间</Text>
                                    <Text>{inquiryExecutedAt ? formatDateTime(inquiryExecutedAt) : "-"}</Text>
                                  </div>
                                  <div>
                                    <Text type="secondary" style={{ display: "block", fontSize: 12 }}>询盘话术</Text>
                                    <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
                                      {candidate.inquiryMessage || "-"}
                                    </Paragraph>
                                  </div>
                                  <div>
                                    <Text type="secondary" style={{ display: "block", fontSize: 12 }}>询盘状态</Text>
                                    <Tag color={inquiryStatusInfo.color} style={{ marginInlineEnd: 0 }}>
                                      {inquiryStatusInfo.label}
                                    </Tag>
                                  </div>
                                  <div>
                                    <Text type="secondary" style={{ display: "block", fontSize: 12 }}>失败原因</Text>
                                    <Text type={inquiryFailureReason === "-" ? "secondary" : "danger"}>
                                      {inquiryFailureReason}
                                    </Text>
                                  </div>
                                </Space>
                              )}
                            >
                              <span onClick={(event) => event.stopPropagation()}>
                                <Tag
                                  color={inquiryStatusInfo.color}
                                  style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: "18px", cursor: "pointer" }}
                                >
                                  {inquiryStatusInfo.label}
                                </Tag>
                              </span>
                            </Popover>
                          ) : null}
                        </Space>
                        <div style={{ marginTop: 8, minHeight: 30 }}>
                          <Text style={{ color: "#ea580c", fontSize: 20, fontWeight: 700 }}>
                            {formatCurrency(candidate.unitPrice)}
                          </Text>
                          <Text style={{ color: "#ea580c", marginLeft: 6, fontSize: 12 }}>{freightText}</Text>
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: "3px 8px",
                            marginTop: 4,
                            minHeight: 48,
                          }}
                        >
                          <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                            {salesText || "-"}
                          </Text>
                          <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                            起批 {formatQty(candidate.moq || 1)}
                          </Text>
                          <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                            {serviceTexts[0] || "-"}
                          </Text>
                          <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                            {serviceTexts[1] || serviceTexts[2] || "-"}
                          </Text>
                        </div>
                        <Text
                          type="secondary"
                          ellipsis={{ tooltip: supplierText }}
                          style={{ display: "block", marginTop: 8, fontSize: 12, minHeight: 20 }}
                        >
                          {supplierText}
                        </Text>
                        <Space size={6} wrap style={{ marginTop: 10 }}>
                          <Button
                            size="small"
                            icon={<ReloadOutlined />}
                            disabled={!candidate.externalOfferId}
                            loading={actingKey === `1688-detail-${candidate.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              void refreshCandidate1688Specs(candidate);
                            }}
                          >
                            同步规格
                          </Button>
                        </Space>
                      </div>
                    </div>
                  );
                  })}
                    </div>
                    {loadingMorePrId === detailPr!.id ? (
                      <div style={{ padding: "18px 0", textAlign: "center" }}>
                        <Space align="center" size={8}>
                          <Spin size="small" />
                          <Text type="secondary">正在加载下一页候选</Text>
                        </Space>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
            ) : null}

          </Space>
        ) : (
          <Alert type="warning" showIcon message="当前采购单不存在或已刷新" />
        )}
      </Drawer>
    </div>
  );
}
