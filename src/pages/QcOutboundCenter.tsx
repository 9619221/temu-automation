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
  Space,
  Table,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CheckCircleOutlined,
  ExportOutlined,
  InboxOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { hasPageCache, readPageCache, writePageCache } from "../utils/pageCache";
import {
  OUTBOUND_STATUS_LABELS,
  canRole,
  formatDateTime,
  formatQty,
  statusTag,
} from "../utils/erpUi";

const { Text } = Typography;
const erp = window.electronAPI?.erp;
const OUTBOUND_CACHE_KEY = "temu.qc-outbound.workbench.cache.v1";

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
  updatedAt?: string;
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
}

export default function QcOutboundCenter() {
  const auth = useErpAuth();
  const role = auth.currentUser?.role || "";
  const cachedData = useMemo(
    () => readPageCache<OutboundCache>(OUTBOUND_CACHE_KEY, {}),
    [],
  );
  const [outboundData, setOutboundData] = useState<OutboundWorkbench>(() => cachedData.outboundData || {});
  const [loadedOnce, setLoadedOnce] = useState(() => hasPageCache(cachedData));
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [planTarget, setPlanTarget] = useState<OutboundBatchRow | null>(null);
  const [shipTarget, setShipTarget] = useState<OutboundShipmentRow | null>(null);
  const [planForm] = Form.useForm();
  const [shipForm] = Form.useForm();

  const applyWorkbench = useCallback((nextOutbound: OutboundWorkbench) => {
    const outboundWorkbench = nextOutbound || {};
    setOutboundData(outboundWorkbench);
    setLoadedOnce(true);
    writePageCache<OutboundCache>(OUTBOUND_CACHE_KEY, {
      generatedAt: new Date().toISOString(),
      outboundData: outboundWorkbench,
    });
  }, []);

  const loadData = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const nextOutbound = await erp.outbound.workbench({ limit: 200 });
      applyWorkbench(nextOutbound);
    } catch (error: any) {
      message.error(error?.message || "出库数据读取失败");
    } finally {
      setLoading(false);
    }
  }, [applyWorkbench]);

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
      qty: row.availableQty || 1,
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
      "出库计划已创建",
    );
    setPlanTarget(null);
    planForm.resetFields();
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
      "已确认发出，等待运营确认完成",
    );
    setShipTarget(null);
    shipForm.resetFields();
  };

  const availableBatchColumns = useMemo<ColumnsType<OutboundBatchRow>>(() => [
    {
      title: "批次",
      key: "batch",
      width: 200,
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
      width: 170,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>可用 {formatQty(row.availableQty)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>预留 {formatQty(row.reservedQty)} · 锁定 {formatQty(row.blockedQty)}</Text>
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
      title: "动作",
      key: "actions",
      width: 150,
      fixed: "right",
      render: (_value, row) => (
        canRole(role, ["operations", "manager", "admin"]) ? (
          <Button
            size="small"
            type="primary"
            icon={<ExportOutlined />}
            loading={actingKey === `plan-${row.id}`}
            onClick={() => openPlanModal(row)}
          >
            创建计划
          </Button>
        ) : <Text type="secondary">无权限</Text>
      ),
    },
  ], [actingKey, role]);

  const shipmentColumns = useMemo<ColumnsType<OutboundShipmentRow>>(() => [
    {
      title: "发货单",
      key: "shipment",
      width: 210,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.shipmentNo || row.id}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.id}</Text>
        </Space>
      ),
    },
    {
      title: "商品 / 批次",
      key: "sku",
      ellipsis: true,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.productName || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.internalSkuCode || "-"} · {row.batchCode || row.batchId || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "数量",
      key: "qty",
      width: 120,
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
      width: 130,
      render: (value) => statusTag(value, OUTBOUND_STATUS_LABELS),
    },
    {
      title: "物流",
      key: "logistics",
      width: 180,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.logisticsProvider || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.trackingNo || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "处理人",
      key: "operator",
      width: 160,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text type="secondary">仓库：{row.warehouseOperatorName || "-"}</Text>
          <Text type="secondary">运营：{row.confirmedByName || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "动作",
      key: "actions",
      width: 210,
      fixed: "right",
      render: (_value, row) => (
        <Space size={6} wrap>
          {row.status === "pending_warehouse" && canRole(role, ["warehouse", "manager", "admin"]) ? (
            <Button
              size="small"
              icon={<InboxOutlined />}
              loading={actingKey === `pick-${row.id}`}
              onClick={() => runOutboundAction(`pick-${row.id}`, { action: "start_picking", outboundId: row.id }, "已开始拣货")}
            >
              开始拣货
            </Button>
          ) : null}
          {row.status === "picking" && canRole(role, ["warehouse", "manager", "admin"]) ? (
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `pack-${row.id}`}
              onClick={() => runOutboundAction(`pack-${row.id}`, { action: "mark_packed", outboundId: row.id, boxes: row.boxes || 1 }, "已打包")}
            >
              打包完成
            </Button>
          ) : null}
          {row.status === "packed" && canRole(role, ["warehouse", "manager", "admin"]) ? (
            <Button
              size="small"
              type="primary"
              icon={<ExportOutlined />}
              loading={actingKey === `ship-${row.id}`}
              onClick={() => openShipModal(row)}
            >
              确认发出
            </Button>
          ) : null}
          {row.status === "pending_ops_confirm" && canRole(role, ["operations", "manager", "admin"]) ? (
            <Button
              size="small"
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `done-${row.id}`}
              onClick={() => runOutboundAction(`done-${row.id}`, { action: "confirm_outbound_done", outboundId: row.id }, "出库已确认完成")}
            >
              运营确认
            </Button>
          ) : null}
          {!["pending_warehouse", "picking", "packed", "pending_ops_confirm"].includes(row.status || "") ? <Text type="secondary">等待</Text> : null}
        </Space>
      ),
    },
  ], [actingKey, role]);

  const outboundSummary = outboundData.summary || {};
  const tableLoading = loading
    && !loadedOnce
    && (
      (outboundData.availableBatches?.length || 0)
      + (outboundData.outboundShipments?.length || 0)
      > 0
    );

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="系统" title="出库中心" subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境缺少本地服务接口" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="出库中心"
        title="可出库批次与发货单"
        subtitle="入库批次直接可出库；运营创建出库计划，仓库拣货打包发出，运营确认完成。"
        meta={[`出库更新 ${formatDateTime(outboundData.generatedAt)}`]}
        actions={[
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={loadData}>
            刷新
          </Button>,
        ]}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <StatCard title="可出库库存" value={outboundSummary.availableQty || 0} color="success" icon={<ExportOutlined />} compact />
        </Col>
        <Col xs={24} md={12}>
          <StatCard title="待仓库/运营" value={(outboundSummary.pendingWarehouseCount || 0) + (outboundSummary.pendingOpsConfirmCount || 0)} color="purple" icon={<CheckCircleOutlined />} compact />
        </Col>
      </Row>

      <div className="app-panel" style={{ marginBottom: 16 }}>
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">可出库批次</div>
            <div className="app-panel__title-sub">运营从可用库存批次创建出库计划，系统会预留库存给仓库处理。</div>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={tableLoading}
          size="middle"
          columns={availableBatchColumns}
          dataSource={outboundData.availableBatches || []}
          scroll={{ x: 940 }}
          pagination={{ pageSize: 8, showSizeChanger: false }}
        />
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">出库 / 发货单</div>
            <div className="app-panel__title-sub">仓库拣货、打包、确认发出后，由运营确认出库完成。</div>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={tableLoading}
          size="middle"
          columns={shipmentColumns}
          dataSource={outboundData.outboundShipments || []}
          scroll={{ x: 1180 }}
          pagination={{ pageSize: 8, showSizeChanger: false }}
        />
      </div>

      <Modal
        title="创建出库计划"
        open={!!planTarget}
        onCancel={() => setPlanTarget(null)}
        onOk={submitPlan}
        confirmLoading={actingKey === `plan-${planTarget?.id}`}
        destroyOnClose
      >
        <Form form={planForm} layout="vertical">
          <Form.Item label="出库数量" name="qty" rules={[{ required: true, message: "请输入出库数量" }]}>
            <InputNumber min={1} max={Number(planTarget?.availableQty || 1)} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="箱数" name="boxes">
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={3} placeholder="可填写发仓说明" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="确认发出"
        open={!!shipTarget}
        onCancel={() => setShipTarget(null)}
        onOk={submitShip}
        confirmLoading={actingKey === `ship-${shipTarget?.id}`}
        destroyOnClose
      >
        <Form form={shipForm} layout="vertical">
          <Form.Item label="物流商" name="logisticsProvider">
            <Input placeholder="例如：顺丰 / 德邦 / 其他" />
          </Form.Item>
          <Form.Item label="物流单号" name="trackingNo">
            <Input placeholder="填写发货单号" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
