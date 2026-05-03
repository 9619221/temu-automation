import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Col, Row, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CheckCircleOutlined,
  InboxOutlined,
  ReloadOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { hasPageCache, readPageCache, writePageCache } from "../utils/pageCache";
import {
  BATCH_QC_STATUS_LABELS,
  INBOUND_STATUS_LABELS,
  canRole,
  formatDateTime,
  formatMoney,
  formatQty,
  statusTag,
} from "../utils/erpUi";

const { Text } = Typography;
const erp = window.electronAPI?.erp;
const WAREHOUSE_WORKBENCH_CACHE_KEY = "temu.warehouse.workbench.cache.v1";

interface InboundReceiptRow {
  id: string;
  receiptNo?: string;
  poNo?: string;
  poId?: string;
  supplierName?: string;
  skuSummary?: string;
  status: string;
  expectedQty?: number;
  receivedQty?: number;
  damagedQty?: number;
  shortageQty?: number;
  overQty?: number;
  lineCount?: number;
  batchLineCount?: number;
  operatorName?: string;
  receivedAt?: string | null;
  updatedAt?: string;
}

interface InventoryBatchRow {
  id: string;
  batchCode?: string;
  receiptNo?: string;
  poNo?: string;
  supplierName?: string;
  internalSkuCode?: string;
  productName?: string;
  receivedQty?: number;
  availableQty?: number;
  reservedQty?: number;
  blockedQty?: number;
  defectiveQty?: number;
  unitLandedCost?: number;
  qcStatus?: string;
  warehouseId?: string;
  locationCode?: string;
  receivedAt?: string | null;
}

interface WarehouseWorkbench {
  generatedAt?: string;
  summary?: Record<string, number>;
  inboundReceipts?: InboundReceiptRow[];
  inventoryBatches?: InventoryBatchRow[];
}

export default function WarehouseCenter() {
  const auth = useErpAuth();
  const role = auth.currentUser?.role || "";
  const cachedData = useMemo(
    () => readPageCache<WarehouseWorkbench>(WAREHOUSE_WORKBENCH_CACHE_KEY, {}),
    [],
  );
  const [data, setData] = useState<WarehouseWorkbench>(cachedData);
  const [loadedOnce, setLoadedOnce] = useState(() => hasPageCache(cachedData));
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);

  const applyWorkbench = useCallback((workbench: WarehouseWorkbench) => {
    const nextWorkbench = workbench || {};
    setData(nextWorkbench);
    setLoadedOnce(true);
    writePageCache(WAREHOUSE_WORKBENCH_CACHE_KEY, nextWorkbench);
  }, []);

  const loadData = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      applyWorkbench(await erp.warehouse.workbench({ limit: 200 }));
    } catch (error: any) {
      message.error(error?.message || "仓库中心读取失败");
    } finally {
      setLoading(false);
    }
  }, [applyWorkbench]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const runAction = async (key: string, payload: Record<string, any>, successText: string) => {
    if (!erp) return;
    setActingKey(key);
    try {
      const result = await erp.warehouse.action({ ...payload, limit: 200 });
      applyWorkbench(result?.workbench || await erp.warehouse.workbench({ limit: 200 }));
      message.success(successText);
    } catch (error: any) {
      message.error(error?.message || "操作失败");
    } finally {
      setActingKey(null);
    }
  };

  const receiptColumns = useMemo<ColumnsType<InboundReceiptRow>>(() => [
    {
      title: "入库单",
      key: "receipt",
      width: 210,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.receiptNo || row.id}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>采购单：{row.poNo || row.poId || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 130,
      render: (value) => statusTag(value, INBOUND_STATUS_LABELS),
    },
    {
      title: "供应商 / 商品",
      key: "supplier",
      ellipsis: true,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.supplierName || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.skuSummary || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "数量",
      key: "qty",
      width: 180,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{formatQty(row.receivedQty)} / {formatQty(row.expectedQty)} 已收</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            破损 {formatQty(row.damagedQty)} · 短少 {formatQty(row.shortageQty)} · 多到 {formatQty(row.overQty)}
          </Text>
        </Space>
      ),
    },
    {
      title: "批次",
      key: "batch",
      width: 130,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{formatQty(row.batchLineCount)} / {formatQty(row.lineCount)} 已建</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.operatorName || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "物流",
      key: "logistics",
      width: 200,
      render: (_value, row) => {
        const billNo = row?.logistics?.billNo;
        const company = row?.logistics?.companyName;
        if (!billNo && !company) return <Text type="secondary">-</Text>;
        return (
          <Space direction="vertical" size={2}>
            <Text style={{ fontSize: 12 }}>{company || "未知物流公司"}</Text>
            {billNo ? <Text copyable code style={{ fontSize: 12 }}>{billNo}</Text> : <Text type="secondary" style={{ fontSize: 12 }}>无运单号</Text>}
          </Space>
        );
      },
    },
    {
      title: "到仓",
      dataIndex: "receivedAt",
      width: 160,
      render: formatDateTime,
    },
    {
      title: "动作",
      key: "actions",
      width: 170,
      fixed: "right",
      render: (_value, row) => (
        <Space size={6} wrap>
          {canRole(role, ["warehouse", "manager", "admin"]) && row.status === "pending_arrival" ? (
            <Button
              size="small"
              icon={<InboxOutlined />}
              loading={actingKey === `arrival-${row.id}`}
              onClick={() => runAction(`arrival-${row.id}`, { action: "register_arrival", receiptId: row.id }, "已确认到仓")}
            >
              确认到仓
            </Button>
          ) : null}
          {canRole(role, ["warehouse", "manager", "admin"]) && row.status === "arrived" ? (
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `count-${row.id}`}
              onClick={() => runAction(`count-${row.id}`, { action: "confirm_count", receiptId: row.id }, "已确认核数")}
            >
              确认核数
            </Button>
          ) : null}
          {canRole(role, ["warehouse", "manager", "admin"]) && row.status === "counted" ? (
            <Button
              size="small"
              type="primary"
              icon={<TagsOutlined />}
              loading={actingKey === `batches-${row.id}`}
              onClick={() => runAction(`batches-${row.id}`, { action: "create_batches", receiptId: row.id }, "已创建入库批次")}
            >
              创建批次
            </Button>
          ) : null}
          {!["pending_arrival", "arrived", "counted"].includes(row.status) ? <Text type="secondary">无动作</Text> : null}
        </Space>
      ),
    },
  ], [actingKey, role]);

  const batchColumns = useMemo<ColumnsType<InventoryBatchRow>>(() => [
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
      ellipsis: true,
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
          <Text>收货 {formatQty(row.receivedQty)} · 可用 {formatQty(row.availableQty)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>预留 {formatQty(row.reservedQty)} · 锁定 {formatQty(row.blockedQty)}</Text>
        </Space>
      ),
    },
    {
      title: "质检",
      dataIndex: "qcStatus",
      width: 130,
      render: (value) => statusTag(value, BATCH_QC_STATUS_LABELS),
    },
    {
      title: "成本",
      dataIndex: "unitLandedCost",
      width: 110,
      render: formatMoney,
    },
    {
      title: "库位",
      dataIndex: "locationCode",
      width: 120,
      render: (value) => value || "-",
    },
    {
      title: "入库时间",
      dataIndex: "receivedAt",
      width: 160,
      render: formatDateTime,
    },
  ], []);

  const summary = data.summary || {};
  const tableLoading = loading
    && !loadedOnce
    && ((data.inboundReceipts?.length || 0) + (data.inventoryBatches?.length || 0) > 0);
  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="系统" title="仓库中心" subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境缺少本地服务接口" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="仓库中心"
        title="待到货、入库、库存批次"
        subtitle="仓管确认到仓、核数并创建库存批次；批次默认等待运营抽检。"
        meta={[`更新 ${formatDateTime(data.generatedAt)}`]}
        actions={[
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={loadData}>
            刷新
          </Button>,
        ]}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <StatCard title="待到货" value={summary.pendingArrivalCount || 0} color="blue" icon={<InboxOutlined />} compact />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="待核数 / 建批次" value={(summary.arrivedCount || 0) + (summary.countedCount || 0)} color="purple" icon={<CheckCircleOutlined />} compact />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="库存批次" value={summary.inventoryBatchCount || 0} suffix={`已收 ${formatQty(summary.receivedQty)}`} color="success" icon={<TagsOutlined />} compact />
        </Col>
      </Row>

      <div className="app-panel" style={{ marginBottom: 16 }}>
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">待到货 / 入库单</div>
            <div className="app-panel__title-sub">仓管按顺序确认到仓、确认核数、创建入库批次。</div>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={tableLoading}
          size="middle"
          columns={receiptColumns}
          dataSource={data.inboundReceipts || []}
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
        />
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">库存批次</div>
            <div className="app-panel__title-sub">每批货可追溯到采购单、入库单和供应商，并展示可用、预留、锁定库存。</div>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={tableLoading}
          size="middle"
          columns={batchColumns}
          dataSource={data.inventoryBatches || []}
          scroll={{ x: 980 }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
        />
      </div>
    </div>
  );
}
