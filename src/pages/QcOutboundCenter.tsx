import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CheckCircleOutlined,
  CloudSyncOutlined,
  ExportOutlined,
  FileDoneOutlined,
  InboxOutlined,
  ReloadOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { hasPageCache, readPageCache, writePageCache } from "../utils/pageCache";
import {
  fetchTemuStockOrders,
  loadCloudConfig,
  type TemuStockOrderRow,
  type TemuStockOrderSummaryRow,
} from "../utils/cloudClient";

const { Text } = Typography;
const erp = window.electronAPI?.erp;
const OUTBOUND_CACHE_KEY = "temu.qc-outbound.workbench.cache.v2";

interface AccountRow {
  id: string;
  name?: string;
  source?: string;
}

interface OutboundBatchRow {
  id: string;
  batchCode?: string;
  receiptNo?: string;
  poNo?: string;
  supplierName?: string;
  internalSkuCode?: string;
  productName?: string;
  availableQty?: number;
  reservedQty?: number;
  blockedQty?: number;
  qcStatus?: string;
  receivedAt?: string | null;
}

interface OutboundShipmentRow {
  id: string;
  accountId?: string;
  shipmentNo?: string;
  batchCode?: string;
  batchId?: string;
  internalSkuCode?: string;
  productName?: string;
  qty?: number;
  boxes?: number;
  status?: string;
  logisticsProvider?: string;
  trackingNo?: string;
  warehouseOperatorName?: string;
  confirmedByName?: string;
  temuStockOrderNo?: string | null;
  temuDeliveryOrderSn?: string | null;
  temuDeliveryBatchSn?: string | null;
  temuSyncStatus?: string | null;
  updatedAt?: string;
}

interface TemuStockOrderPreview {
  requestedQty?: number;
  demandRemainingQty?: number | null;
  existingQty?: number;
  remainingQty?: number;
  availableQty?: number;
  shortageQty?: number;
  matchedSku?: {
    id?: string;
    internalSkuCode?: string;
    productName?: string;
  };
  existingShipments?: OutboundShipmentRow[];
  allocationPlan?: Array<{
    qty: number;
    batch?: {
      id?: string;
      batchCode?: string;
      availableQty?: number;
    };
  }>;
}

interface OutboundWorkbench {
  generatedAt?: string;
  summary?: Record<string, number>;
  availableBatches?: OutboundBatchRow[];
  outboundShipments?: OutboundShipmentRow[];
}

interface OutboundCache {
  generatedAt?: string;
  outboundData?: OutboundWorkbench;
  stockOrders?: TemuStockOrderRow[];
  stockOrderSummary?: TemuStockOrderSummaryRow[];
  accounts?: AccountRow[];
}

const OUTBOUND_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  pending_warehouse: "待仓库处理",
  picking: "拣货中",
  packed: "已打包",
  shipped_out: "已发出",
  pending_ops_confirm: "待运营确认",
  confirmed: "已确认",
  exception: "异常",
  cancelled: "已取消",
};

const OUTBOUND_STATUS_COLORS: Record<string, string> = {
  draft: "default",
  pending_warehouse: "gold",
  picking: "processing",
  packed: "cyan",
  shipped_out: "blue",
  pending_ops_confirm: "gold",
  confirmed: "success",
  exception: "error",
  cancelled: "default",
};

function canRole(role: string, allowed: string[]) {
  return allowed.includes(role) || (role === "admin" && allowed.includes("manager"));
}

function formatQty(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat("zh-CN").format(number);
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function stockOrderIdentity(row: TemuStockOrderRow) {
  return row.stock_order_no || row.delivery_order_sn || row.delivery_batch_sn || row.row_key || row.id;
}

function stockOrderKeys(row: TemuStockOrderRow) {
  return [row.stock_order_no, row.delivery_order_sn, row.delivery_batch_sn]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function shipmentKeys(row: OutboundShipmentRow) {
  return [row.temuStockOrderNo, row.temuDeliveryOrderSn, row.temuDeliveryBatchSn]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function stockOrderDemand(row: TemuStockOrderRow) {
  const demand = Number(row.demand_qty || 0);
  const delivered = Number(row.delivered_qty || 0);
  return Math.max(0, demand - delivered) || demand || 1;
}

function stockStatusColor(status?: string | null) {
  const text = String(status || "");
  if (!text) return "default";
  if (/取消|cancel/i.test(text)) return "default";
  if (/完成|已发|shipped|done|complete/i.test(text)) return "success";
  if (/待|未|pending|wait/i.test(text)) return "gold";
  return "processing";
}

function outboundStatusTag(status?: string) {
  const key = String(status || "draft");
  return <Tag color={OUTBOUND_STATUS_COLORS[key] || "default"}>{OUTBOUND_STATUS_LABELS[key] || key}</Tag>;
}

export default function QcOutboundCenter() {
  const auth = useErpAuth();
  const role = auth.currentUser?.role || "";
  const cachedData = useMemo(
    () => readPageCache<OutboundCache>(OUTBOUND_CACHE_KEY, {}),
    [],
  );
  const [outboundData, setOutboundData] = useState<OutboundWorkbench>(() => cachedData.outboundData || {});
  const [stockOrders, setStockOrders] = useState<TemuStockOrderRow[]>(() => cachedData.stockOrders || []);
  const [stockOrderSummary, setStockOrderSummary] = useState<TemuStockOrderSummaryRow[]>(() => cachedData.stockOrderSummary || []);
  const [accounts, setAccounts] = useState<AccountRow[]>(() => cachedData.accounts || []);
  const [loadedOnce, setLoadedOnce] = useState(() => hasPageCache(cachedData));
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [stockStatus, setStockStatus] = useState("");
  const [stockQuery, setStockQuery] = useState("");
  const [cloudConfigured, setCloudConfigured] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [planTarget, setPlanTarget] = useState<OutboundBatchRow | null>(null);
  const [stockOrderTarget, setStockOrderTarget] = useState<TemuStockOrderRow | null>(null);
  const [stockOrderPreview, setStockOrderPreview] = useState<TemuStockOrderPreview | null>(null);
  const [stockOrderPreviewError, setStockOrderPreviewError] = useState<string | null>(null);
  const [stockOrderPreviewLoading, setStockOrderPreviewLoading] = useState(false);
  const [shipTarget, setShipTarget] = useState<OutboundShipmentRow | null>(null);
  const [planForm] = Form.useForm();
  const [stockOrderForm] = Form.useForm();
  const [shipForm] = Form.useForm();

  const canCreateOutbound = canRole(role, ["operations", "manager", "admin"]);
  const canWarehouseAction = canRole(role, ["warehouse", "manager", "admin"]);

  const applyCache = useCallback((
    nextOutbound: OutboundWorkbench,
    nextStockOrders: TemuStockOrderRow[],
    nextStockSummary: TemuStockOrderSummaryRow[],
    nextAccounts: AccountRow[],
  ) => {
    setOutboundData(nextOutbound || {});
    setStockOrders(nextStockOrders || []);
    setStockOrderSummary(nextStockSummary || []);
    setAccounts(nextAccounts || []);
    setLoadedOnce(true);
    writePageCache<OutboundCache>(OUTBOUND_CACHE_KEY, {
      generatedAt: new Date().toISOString(),
      outboundData: nextOutbound || {},
      stockOrders: nextStockOrders || [],
      stockOrderSummary: nextStockSummary || [],
      accounts: nextAccounts || [],
    });
  }, []);

  const loadData = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const [nextOutbound, nextAccounts, cfg] = await Promise.all([
        erp.outbound.workbench({ limit: 200 }),
        erp.account.list({ limit: 500 }),
        loadCloudConfig(),
      ]);
      let nextStockOrders: TemuStockOrderRow[] = [];
      let nextStockSummary: TemuStockOrderSummaryRow[] = [];
      if (cfg) {
        setCloudConfigured(true);
        try {
          const stockResult = await fetchTemuStockOrders(cfg, {
            status: stockStatus || undefined,
            q: stockQuery || undefined,
            limit: 500,
          });
          nextStockOrders = stockResult.rows || [];
          nextStockSummary = stockResult.summary || [];
          setCloudError(null);
        } catch (error: any) {
          setCloudError(error?.message || "云端备货单读取失败");
        }
      } else {
        setCloudConfigured(false);
        setCloudError("还没有配置云端连接");
      }
      const accountRows = Array.isArray(nextAccounts) ? nextAccounts : [];
      if (!selectedAccountId && accountRows[0]?.id) {
        setSelectedAccountId(accountRows[0].id);
      }
      applyCache(nextOutbound, nextStockOrders, nextStockSummary, accountRows);
    } catch (error: any) {
      message.error(error?.message || "出库中心数据读取失败");
    } finally {
      setLoading(false);
    }
  }, [applyCache, selectedAccountId, stockQuery, stockStatus]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const runOutboundAction = async (key: string, payload: Record<string, any>, successText: string) => {
    if (!erp) return;
    setActingKey(key);
    try {
      await erp.outbound.action({ ...payload, limit: 200 });
      await loadData();
      message.success(successText);
    } catch (error: any) {
      message.error(error?.message || "操作失败");
    } finally {
      setActingKey(null);
    }
  };

  const openPlanModal = (row: OutboundBatchRow) => {
    setPlanTarget(row);
    planForm.setFieldsValue({
      qty: Math.max(1, Number(row.availableQty || 1)),
      boxes: 1,
      remark: "",
    });
  };

  const submitPlan = async () => {
    if (!planTarget) return;
    const values = await planForm.validateFields();
    await runOutboundAction(
      `plan-${planTarget.id}`,
      {
        action: "create_outbound_plan",
        batchId: planTarget.id,
        qty: Number(values.qty),
        boxes: Number(values.boxes || 1),
        remark: values.remark,
      },
      "出库单已创建",
    );
    setPlanTarget(null);
    planForm.resetFields();
  };

  const openStockOrderModal = (row: TemuStockOrderRow) => {
    const accountId = selectedAccountId || accounts[0]?.id || "";
    setStockOrderTarget(row);
    setStockOrderPreview(null);
    setStockOrderPreviewError(null);
    stockOrderForm.setFieldsValue({
      accountId,
      qty: stockOrderDemand(row),
      boxes: 1,
      remark: `Temu 云端备货单 ${stockOrderIdentity(row)}`,
    });
    if (accountId) {
      void previewStockOrderPlan(row, accountId, stockOrderDemand(row));
    }
  };

  const previewStockOrderPlan = async (
    row = stockOrderTarget,
    accountId?: string,
    qty?: number,
  ) => {
    if (!erp || !row) return;
    const values = stockOrderForm.getFieldsValue();
    const nextAccountId = accountId || values.accountId || selectedAccountId || accounts[0]?.id || "";
    const nextQty = Number(qty || values.qty || stockOrderDemand(row));
    if (!nextAccountId || !nextQty) return;
    setStockOrderPreviewLoading(true);
    setStockOrderPreviewError(null);
    try {
      const response = await erp.outbound.action({
        action: "preview_temu_stock_order_outbound",
        accountId: nextAccountId,
        stockOrder: row,
        qty: nextQty,
        includeWorkbench: false,
        limit: 200,
      });
      setStockOrderPreview(response?.result || null);
    } catch (error: any) {
      setStockOrderPreview(null);
      setStockOrderPreviewError(error?.message || "预检失败");
    } finally {
      setStockOrderPreviewLoading(false);
    }
  };

  const closeStockOrderModal = () => {
    setStockOrderTarget(null);
    setStockOrderPreview(null);
    setStockOrderPreviewError(null);
    setStockOrderPreviewLoading(false);
    stockOrderForm.resetFields();
  };

  const submitStockOrderPlan = async () => {
    if (!erp || !stockOrderTarget) return;
    const values = await stockOrderForm.validateFields();
    setSelectedAccountId(values.accountId);
    setActingKey(`stock-${stockOrderTarget.id}`);
    try {
      const response = await erp.outbound.action({
        action: "create_outbound_plan_from_temu_stock_order",
        accountId: values.accountId,
        stockOrder: stockOrderTarget,
        qty: Number(values.qty),
        boxes: Number(values.boxes || 1),
        remark: values.remark,
        limit: 200,
      });
      await loadData();
      const result = response?.result || {};
      if (result.idempotent) {
        message.info("该备货单已生成本地出库单，未重复创建");
      } else {
        message.success(`已生成 ${formatQty(result.createdQty || values.qty)} 件出库单`);
      }
      closeStockOrderModal();
    } catch (error: any) {
      message.error(error?.message || "生成出库单失败");
    } finally {
      setActingKey(null);
    }
  };

  const openShipModal = (row: OutboundShipmentRow) => {
    setShipTarget(row);
    shipForm.setFieldsValue({
      logisticsProvider: row.logisticsProvider || "",
      trackingNo: row.trackingNo || "",
    });
  };

  const submitShip = async () => {
    if (!shipTarget) return;
    const values = await shipForm.validateFields();
    await runOutboundAction(
      `ship-${shipTarget.id}`,
      {
        action: "confirm_shipped_out",
        outboundId: shipTarget.id,
        logisticsProvider: values.logisticsProvider,
        trackingNo: values.trackingNo,
      },
      "已确认发出，等待运营确认",
    );
    setShipTarget(null);
    shipForm.resetFields();
  };

  const summary = outboundData.summary || {};
  const stockOrderLinkIndex = useMemo(() => {
    const index = new Map<string, { qty: number; shipments: OutboundShipmentRow[] }>();
    for (const shipment of outboundData.outboundShipments || []) {
      if (selectedAccountId && shipment.accountId && shipment.accountId !== selectedAccountId) continue;
      for (const key of shipmentKeys(shipment)) {
        const current = index.get(key) || { qty: 0, shipments: [] };
        current.qty += Number(shipment.qty || 0);
        current.shipments.push(shipment);
        index.set(key, current);
      }
    }
    return index;
  }, [outboundData.outboundShipments, selectedAccountId]);
  const resolveStockOrderLink = useCallback((row: TemuStockOrderRow) => (
    stockOrderKeys(row)
      .map((key) => stockOrderLinkIndex.get(key))
      .find(Boolean)
  ), [stockOrderLinkIndex]);
  const cloudDemandQty = useMemo(
    () => stockOrders.reduce((sum, row) => sum + Number(row.demand_qty || 0), 0),
    [stockOrders],
  );
  const stockStatusOptions = useMemo(() => {
    const options = [{ label: `全部 ${stockOrders.length}`, value: "" }];
    for (const item of stockOrderSummary) {
      const status = item.temu_status || "未标记";
      options.push({ label: `${status} ${item.count}`, value: item.temu_status || "__empty__" });
    }
    return options;
  }, [stockOrderSummary, stockOrders.length]);

  const cloudStockColumns = useMemo<ColumnsType<TemuStockOrderRow>>(() => [
    {
      title: "备货单",
      key: "order",
      width: 220,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{stockOrderIdentity(row)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            店铺 {row.mall_id || "-"} / {formatDateTime(row.order_time)}
          </Text>
        </Space>
      ),
    },
    {
      title: "商品",
      key: "product",
      width: 340,
      render: (_value, row) => (
        <Space direction="vertical" size={3}>
          <Text>{row.product_name || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.spec_name || "-"}</Text>
          <Space size={4} wrap>
            {row.skc_id ? <Tag>SKC {row.skc_id}</Tag> : null}
            {row.sku_id ? <Tag>SKU {row.sku_id}</Tag> : null}
            {row.sku_ext_code ? <Tag>{row.sku_ext_code}</Tag> : null}
          </Space>
        </Space>
      ),
    },
    {
      title: "需求",
      key: "qty",
      width: 130,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{formatQty(row.demand_qty)} 件</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>云端已发 {formatQty(row.delivered_qty)}</Text>
        </Space>
      ),
    },
    {
      title: "收货仓",
      key: "warehouse",
      width: 220,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.receive_warehouse_name || row.warehouse_group || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.urgency_info || row.receive_warehouse_id || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "状态",
      key: "status",
      width: 120,
      render: (_value, row) => (
        <Tag color={stockStatusColor(row.temu_status)}>{row.temu_status || "未标记"}</Tag>
      ),
    },
    {
      title: "本地承接",
      key: "localLink",
      width: 140,
      render: (_value, row) => {
        const localLink = resolveStockOrderLink(row);
        const localQty = Number(localLink?.qty || 0);
        const demandQty = Math.max(1, stockOrderDemand(row));
        const isDone = localQty >= demandQty;
        const isPartial = localQty > 0 && localQty < demandQty;
        return (
          <Space direction="vertical" size={2}>
            <Tag color={isDone ? "success" : isPartial ? "warning" : "default"}>
              {isDone ? "已生成" : isPartial ? "部分生成" : "未生成"}
            </Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatQty(localQty)} / {formatQty(demandQty)} 件
            </Text>
          </Space>
        );
      },
    },
    {
      title: "更新",
      key: "updated",
      width: 170,
      render: (_value, row) => formatDateTime(row.last_updated_at),
    },
    {
      title: "操作",
      key: "actions",
      width: 150,
      fixed: "right",
      render: (_value, row) => {
        const localLink = resolveStockOrderLink(row);
        const isDone = Number(localLink?.qty || 0) >= Math.max(1, stockOrderDemand(row));
        return (
          <Button
            size="small"
            type="primary"
            icon={<ExportOutlined />}
            loading={actingKey === `stock-${row.id}`}
            disabled={!canCreateOutbound || accounts.length === 0}
            onClick={() => openStockOrderModal(row)}
          >
            {isDone ? "查看承接" : "生成出库单"}
          </Button>
        );
      },
    },
  ], [accounts.length, actingKey, canCreateOutbound, resolveStockOrderLink]);

  const availableBatchColumns = useMemo<ColumnsType<OutboundBatchRow>>(() => [
    {
      title: "批次",
      key: "batch",
      width: 210,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.batchCode || row.id}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.receiptNo || row.poNo || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "商品",
      key: "sku",
      width: 300,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.productName || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.internalSkuCode || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "库存",
      key: "inventory",
      width: 180,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>可用 {formatQty(row.availableQty)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            预留 {formatQty(row.reservedQty)} / 锁定 {formatQty(row.blockedQty)}
          </Text>
        </Space>
      ),
    },
    {
      title: "供应商",
      dataIndex: "supplierName",
      width: 180,
      render: (value) => value || "-",
    },
    {
      title: "入库时间",
      dataIndex: "receivedAt",
      width: 170,
      render: formatDateTime,
    },
    {
      title: "操作",
      key: "actions",
      width: 140,
      fixed: "right",
      render: (_value, row) => (
        <Button
          size="small"
          type="primary"
          icon={<ExportOutlined />}
          loading={actingKey === `plan-${row.id}`}
          disabled={!canCreateOutbound}
          onClick={() => openPlanModal(row)}
        >
          创建出库单
        </Button>
      ),
    },
  ], [actingKey, canCreateOutbound]);

  const shipmentColumns = useMemo<ColumnsType<OutboundShipmentRow>>(() => [
    {
      title: "出库单",
      key: "shipment",
      width: 230,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.shipmentNo || row.id}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.batchCode || row.batchId || "-"}</Text>
          {row.temuStockOrderNo ? <Tag color="blue">Temu {row.temuStockOrderNo}</Tag> : null}
        </Space>
      ),
    },
    {
      title: "商品",
      key: "sku",
      width: 280,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.productName || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.internalSkuCode || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "数量",
      key: "qty",
      width: 130,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{formatQty(row.qty)} 件</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{formatQty(row.boxes)} 箱</Text>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 140,
      render: outboundStatusTag,
    },
    {
      title: "物流",
      key: "logistics",
      width: 210,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.logisticsProvider || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.trackingNo || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "更新",
      dataIndex: "updatedAt",
      width: 170,
      render: formatDateTime,
    },
    {
      title: "操作",
      key: "actions",
      width: 240,
      fixed: "right",
      render: (_value, row) => {
        const status = row.status || "";
        if (status === "pending_warehouse") {
          return (
            <Button
              size="small"
              icon={<InboxOutlined />}
              loading={actingKey === `pick-${row.id}`}
              disabled={!canWarehouseAction}
              onClick={() => runOutboundAction(`pick-${row.id}`, { action: "start_picking", outboundId: row.id }, "已开始拣货")}
            >
              开始拣货
            </Button>
          );
        }
        if (status === "picking") {
          return (
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `pack-${row.id}`}
              disabled={!canWarehouseAction}
              onClick={() => runOutboundAction(`pack-${row.id}`, { action: "mark_packed", outboundId: row.id, boxes: row.boxes || 1 }, "已打包")}
            >
              标记打包
            </Button>
          );
        }
        if (status === "packed") {
          return (
            <Button
              size="small"
              type="primary"
              icon={<ExportOutlined />}
              disabled={!canWarehouseAction}
              onClick={() => openShipModal(row)}
            >
              确认发出
            </Button>
          );
        }
        if (status === "pending_ops_confirm") {
          return (
            <Button
              size="small"
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `done-${row.id}`}
              disabled={!canCreateOutbound}
              onClick={() => runOutboundAction(`done-${row.id}`, { action: "confirm_outbound_done", outboundId: row.id }, "出库已确认完成")}
            >
              运营确认
            </Button>
          );
        }
        return <Text type="secondary">-</Text>;
      },
    },
  ], [actingKey, canCreateOutbound, canWarehouseAction]);

  if (!erp) {
    return (
      <PageHeader compact eyebrow="系统" title="出库中心" subtitle="服务未就绪，请重启软件" />
    );
  }

  return (
    <div className="app-workspace-shell">
      <PageHeader
        compact
        eyebrow="系统"
        title="出库中心"
        subtitle="云端备货单上传入库后，桌面端拉取并生成本地出库单"
        meta={[
          `更新 ${formatDateTime(outboundData.generatedAt)}`,
          `云端备货 ${stockOrders.length}`,
          `本地出库 ${summary.outboundShipmentCount || 0}`,
        ]}
        actions={[
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={() => void loadData()}>
            刷新
          </Button>,
        ]}
      />

      {!cloudConfigured || cloudError ? (
        <Alert
          style={{ marginBottom: 12 }}
          type={cloudConfigured ? "warning" : "info"}
          showIcon
          message={cloudError || "还没有配置云端连接"}
        />
      ) : null}

      <Row gutter={[12, 12]} className="material-kpi-row" style={{ marginBottom: 12 }}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="云端备货单" value={stockOrders.length} color="blue" icon={<CloudSyncOutlined />} compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="云端需求" value={formatQty(cloudDemandQty)} suffix="件" color="brand" icon={<ShoppingCartOutlined />} compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="可出库库存" value={formatQty(summary.availableQty || 0)} suffix="件" color="success" icon={<InboxOutlined />} compact />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard title="待仓库/运营" value={(summary.pendingWarehouseCount || 0) + (summary.pendingOpsConfirmCount || 0)} color="purple" icon={<FileDoneOutlined />} compact />
        </Col>
      </Row>

      <Tabs
        defaultActiveKey="cloud"
        items={[
          {
            key: "cloud",
            label: "云端备货单",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <div className="material-filter-bar material-filter-bar--search">
                  <Input.Search
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder="搜索备货单 / 商品 / SKC / SKU"
                    enterButton="搜索"
                    onSearch={(value) => setStockQuery(value.trim())}
                    style={{ maxWidth: 520 }}
                  />
                  <Segmented
                    value={stockStatus || ""}
                    options={stockStatusOptions}
                    onChange={(value) => setStockStatus(value === "__empty__" ? "" : String(value))}
                  />
                </div>
                <Table
                  className="erp-compact-table"
                  rowKey="id"
                  size="middle"
                  loading={loading && !loadedOnce}
                  columns={cloudStockColumns}
                  dataSource={stockOrders}
                  scroll={{ x: 1540 }}
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                />
              </Space>
            ),
          },
          {
            key: "inventory",
            label: "可出库库存",
            children: (
              <Table
                className="erp-compact-table"
                rowKey="id"
                size="middle"
                loading={loading && !loadedOnce}
                columns={availableBatchColumns}
                dataSource={outboundData.availableBatches || []}
                scroll={{ x: 1100 }}
                pagination={{ pageSize: 20, showSizeChanger: true }}
              />
            ),
          },
          {
            key: "shipments",
            label: "本地出库单",
            children: (
              <Table
                className="erp-compact-table"
                rowKey="id"
                size="middle"
                loading={loading && !loadedOnce}
                columns={shipmentColumns}
                dataSource={outboundData.outboundShipments || []}
                scroll={{ x: 1400 }}
                pagination={{ pageSize: 20, showSizeChanger: true }}
              />
            ),
          },
        ]}
      />

      <Modal
        title="创建出库单"
        open={Boolean(planTarget)}
        onCancel={() => setPlanTarget(null)}
        onOk={submitPlan}
        confirmLoading={actingKey === `plan-${planTarget?.id}`}
        destroyOnClose
      >
        <Form form={planForm} layout="vertical">
          <Form.Item label="出库数量" name="qty" rules={[{ required: true, message: "请输入出库数量" }]}>
            <InputNumber min={1} max={Math.max(1, Number(planTarget?.availableQty || 1))} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="箱数" name="boxes">
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="从云端备货单生成出库单"
        open={Boolean(stockOrderTarget)}
        onCancel={closeStockOrderModal}
        onOk={stockOrderPreview && Number(stockOrderPreview.remainingQty || 0) <= 0 ? closeStockOrderModal : submitStockOrderPlan}
        okText={stockOrderPreview && Number(stockOrderPreview.remainingQty || 0) <= 0 ? "关闭" : "生成出库单"}
        okButtonProps={{
          disabled: Boolean(stockOrderPreviewError) || Number(stockOrderPreview?.shortageQty || 0) > 0,
        }}
        confirmLoading={actingKey === `stock-${stockOrderTarget?.id}`}
        destroyOnClose
      >
        <Form
          form={stockOrderForm}
          layout="vertical"
          onValuesChange={() => {
            setStockOrderPreview(null);
            setStockOrderPreviewError(null);
          }}
        >
          <Form.Item label="ERP 店铺" name="accountId" rules={[{ required: true, message: "请选择 ERP 店铺" }]}>
            <Select
              options={accounts.map((account) => ({ label: account.name || account.id, value: account.id }))}
              placeholder="选择承接出库的店铺"
            />
          </Form.Item>
          <Form.Item label="出库数量" name="qty" rules={[{ required: true, message: "请输入出库数量" }]}>
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="箱数" name="boxes">
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <Button
              size="small"
              icon={<SearchOutlined />}
              loading={stockOrderPreviewLoading}
              onClick={() => void previewStockOrderPlan()}
            >
              刷新出库预检
            </Button>
            {stockOrderPreviewError ? (
              <Alert type="error" showIcon message="出库预检失败" description={stockOrderPreviewError} />
            ) : stockOrderPreview ? (
              <Alert
                type={Number(stockOrderPreview.shortageQty || 0) > 0 ? "warning" : "success"}
                showIcon
                message={Number(stockOrderPreview.shortageQty || 0) > 0 ? "库存不足，需调整数量或批次" : "库存可覆盖本次出库"}
                description={(
                  <Space direction="vertical" size={4}>
                    <Text>
                      匹配 SKU：{stockOrderPreview.matchedSku?.internalSkuCode || stockOrderPreview.matchedSku?.productName || "-"}
                    </Text>
                    <Text type="secondary">
                      需求 {formatQty(stockOrderPreview.requestedQty)} · 可用 {formatQty(stockOrderPreview.availableQty)} · 已占用 {formatQty(stockOrderPreview.existingQty)} · 缺口 {formatQty(stockOrderPreview.shortageQty)}
                    </Text>
                    {stockOrderPreview.allocationPlan?.length ? (
                      <Text type="secondary">
                        批次分配：{stockOrderPreview.allocationPlan.map((item) => `${item.batch?.batchCode || item.batch?.id || "批次"} ${formatQty(item.qty)}`).join("；")}
                      </Text>
                    ) : null}
                  </Space>
                )}
              />
            ) : (
              <Alert type="info" showIcon message="选择店铺和数量后，可先预检库存覆盖情况。" />
            )}
          </Space>
        </Form>
      </Modal>

      <Modal
        title="确认发出"
        open={Boolean(shipTarget)}
        onCancel={() => setShipTarget(null)}
        onOk={submitShip}
        confirmLoading={actingKey === `ship-${shipTarget?.id}`}
        destroyOnClose
      >
        <Form form={shipForm} layout="vertical">
          <Form.Item label="物流商" name="logisticsProvider">
            <Input />
          </Form.Item>
          <Form.Item label="运单号" name="trackingNo">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
