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
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { useErpAuth } from "../contexts/ErpAuthContext";
import {
  BATCH_QC_STATUS_LABELS,
  OUTBOUND_STATUS_LABELS,
  QC_STATUS_LABELS,
  canRole,
  formatDateTime,
  formatPercent,
  formatQty,
  statusTag,
} from "../utils/erpUi";

const { Text } = Typography;
const erp = window.electronAPI?.erp;

interface QcBatchRow {
  id: string;
  batchCode?: string;
  receiptNo?: string;
  poNo?: string;
  supplierName?: string;
  internalSkuCode?: string;
  productName?: string;
  receivedQty?: number;
  availableQty?: number;
  blockedQty?: number;
  qcStatus?: string;
  qcId?: string;
  qcStatusValue?: string;
  suggestedSampleQty?: number;
  actualSampleQty?: number;
  qcDefectiveQty?: number;
  defectRate?: number;
  releaseQty?: number;
  qcBlockedQty?: number;
  inspectorName?: string;
}

interface QcInspectionRow {
  id: string;
  batchId?: string;
  batchCode?: string;
  internalSkuCode?: string;
  productName?: string;
  status?: string;
  actualSampleQty?: number;
  defectiveQty?: number;
  defectRate?: number;
  releaseQty?: number;
  blockedQty?: number;
  batchQcStatus?: string;
  inspectorName?: string;
  updatedAt?: string;
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

interface QcWorkbench {
  generatedAt?: string;
  summary?: Record<string, number>;
  pendingBatches?: QcBatchRow[];
  inspections?: QcInspectionRow[];
}

interface OutboundWorkbench {
  generatedAt?: string;
  summary?: Record<string, number>;
  availableBatches?: OutboundBatchRow[];
  outboundShipments?: OutboundShipmentRow[];
}

export default function QcOutboundCenter() {
  const auth = useErpAuth();
  const role = auth.currentUser?.role || "";
  const [qcData, setQcData] = useState<QcWorkbench>({});
  const [outboundData, setOutboundData] = useState<OutboundWorkbench>({});
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [qcTarget, setQcTarget] = useState<QcBatchRow | null>(null);
  const [planTarget, setPlanTarget] = useState<OutboundBatchRow | null>(null);
  const [shipTarget, setShipTarget] = useState<OutboundShipmentRow | null>(null);
  const [qcForm] = Form.useForm();
  const [planForm] = Form.useForm();
  const [shipForm] = Form.useForm();

  const loadData = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const [nextQc, nextOutbound] = await Promise.all([
        erp.qc.workbench({ limit: 200 }),
        erp.outbound.workbench({ limit: 200 }),
      ]);
      setQcData(nextQc);
      setOutboundData(nextOutbound);
    } catch (error: any) {
      message.error(error?.message || "QC 发仓读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const runQcAction = async (key: string, payload: Record<string, any>, successText: string) => {
    if (!erp) return;
    setActingKey(key);
    try {
      await erp.qc.action({ ...payload, limit: 200 });
      await loadData();
      message.success(successText);
    } catch (error: any) {
      message.error(error?.message || "操作失败");
    } finally {
      setActingKey(null);
    }
  };

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

  const openQcModal = (row: QcBatchRow) => {
    setQcTarget(row);
    qcForm.setFieldsValue({
      actualSampleQty: row.actualSampleQty || row.suggestedSampleQty || Math.min(Number(row.receivedQty || 0), 20) || 1,
      defectiveQty: row.qcDefectiveQty || 0,
      remark: "",
    });
  };

  const submitQc = async () => {
    if (!qcTarget) return;
    const values = await qcForm.validateFields();
    await runQcAction(
      `qc-submit-${qcTarget.id}`,
      {
        action: "submit_qc_percent",
        batchId: qcTarget.id,
        qcId: qcTarget.qcId,
        actualSampleQty: Number(values.actualSampleQty),
        defectiveQty: Number(values.defectiveQty),
        remark: values.remark,
      },
      "抽检结果已提交",
    );
    setQcTarget(null);
    qcForm.resetFields();
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

  const qcBatchColumns = useMemo<ColumnsType<QcBatchRow>>(() => [
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
      title: "SKU",
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
          <Text>收货 {formatQty(row.receivedQty)} · 可用 {formatQty(row.availableQty)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>锁定 {formatQty(row.blockedQty)}</Text>
        </Space>
      ),
    },
    {
      title: "批次 QC",
      dataIndex: "qcStatus",
      width: 130,
      render: (value) => statusTag(value, BATCH_QC_STATUS_LABELS),
    },
    {
      title: "QC 单",
      key: "qc",
      width: 170,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.qcId || "未创建"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.inspectorName || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "抽检 / 不良",
      key: "sample",
      width: 120,
      render: (_value, row) => `${formatQty(row.actualSampleQty)} / ${formatQty(row.qcDefectiveQty)}`,
    },
    {
      title: "操作",
      key: "actions",
      width: 200,
      fixed: "right",
      render: (_value, row) => (
        <Space size={6} wrap>
          {canRole(role, ["operations", "manager", "admin"]) && !row.qcId ? (
            <Button
              size="small"
              icon={<SafetyCertificateOutlined />}
              loading={actingKey === `qc-start-${row.id}`}
              onClick={() => runQcAction(`qc-start-${row.id}`, { action: "start_qc", batchId: row.id }, "已开始抽检")}
            >
              开始抽检
            </Button>
          ) : null}
          {canRole(role, ["operations", "manager", "admin"]) ? (
            <Button
              size="small"
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `qc-submit-${row.id}`}
              onClick={() => openQcModal(row)}
            >
              录入结果
            </Button>
          ) : null}
        </Space>
      ),
    },
  ], [actingKey, role]);

  const inspectionColumns = useMemo<ColumnsType<QcInspectionRow>>(() => [
    {
      title: "QC 单",
      key: "qc",
      width: 210,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.id}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.batchCode || row.batchId || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "SKU",
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
      title: "状态",
      dataIndex: "status",
      width: 120,
      render: (value) => statusTag(value, QC_STATUS_LABELS),
    },
    {
      title: "抽检 / 不良",
      key: "sample",
      width: 120,
      render: (_value, row) => `${formatQty(row.actualSampleQty)} / ${formatQty(row.defectiveQty)}`,
    },
    {
      title: "不良率",
      dataIndex: "defectRate",
      width: 100,
      render: formatPercent,
    },
    {
      title: "释放 / 锁定",
      key: "release",
      width: 140,
      render: (_value, row) => `${formatQty(row.releaseQty)} / ${formatQty(row.blockedQty)}`,
    },
    {
      title: "批次状态",
      dataIndex: "batchQcStatus",
      width: 130,
      render: (value) => statusTag(value, BATCH_QC_STATUS_LABELS),
    },
    {
      title: "更新",
      dataIndex: "updatedAt",
      width: 160,
      render: formatDateTime,
    },
  ], []);

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
      title: "SKU",
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
      title: "QC",
      dataIndex: "qcStatus",
      width: 130,
      render: (value) => statusTag(value, BATCH_QC_STATUS_LABELS),
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
      title: "SKU / 批次",
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

  const qcSummary = qcData.summary || {};
  const outboundSummary = outboundData.summary || {};

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="ERP" title="QC 发仓" subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境没有 window.electronAPI.erp" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="QC 发仓"
        title="抽检、锁定/释放库存、出库计划"
        subtitle="运营录入抽检数和不良数；QC 放行后运营创建出库计划，仓库拣货打包发出。"
        meta={[`QC 更新 ${formatDateTime(qcData.generatedAt)}`, `出库更新 ${formatDateTime(outboundData.generatedAt)}`]}
        actions={[
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={loadData}>
            刷新
          </Button>,
        ]}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={6}>
          <StatCard title="待抽检批次" value={qcSummary.pendingBatchCount || 0} color="blue" icon={<SafetyCertificateOutlined />} compact />
        </Col>
        <Col xs={24} md={6}>
          <StatCard title="锁定库存" value={qcSummary.blockedQty || 0} color="danger" icon={<InboxOutlined />} compact />
        </Col>
        <Col xs={24} md={6}>
          <StatCard title="可出库库存" value={outboundSummary.availableQty || 0} color="success" icon={<ExportOutlined />} compact />
        </Col>
        <Col xs={24} md={6}>
          <StatCard title="待仓库/运营" value={(outboundSummary.pendingWarehouseCount || 0) + (outboundSummary.pendingOpsConfirmCount || 0)} color="purple" icon={<CheckCircleOutlined />} compact />
        </Col>
      </Row>

      <div className="app-panel" style={{ marginBottom: 16 }}>
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">待抽检批次</div>
            <div className="app-panel__title-sub">按简单百分比录入抽检数和不良数，系统自动释放或锁定库存。</div>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          size="middle"
          columns={qcBatchColumns}
          dataSource={qcData.pendingBatches || []}
          scroll={{ x: 1080 }}
          pagination={{ pageSize: 8, showSizeChanger: false }}
        />
      </div>

      <div className="app-panel" style={{ marginBottom: 16 }}>
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">QC 记录</div>
            <div className="app-panel__title-sub">记录每次抽检的判定结果、释放数量和锁定数量。</div>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          size="middle"
          columns={inspectionColumns}
          dataSource={qcData.inspections || []}
          scroll={{ x: 980 }}
          pagination={{ pageSize: 8, showSizeChanger: false }}
        />
      </div>

      <div className="app-panel" style={{ marginBottom: 16 }}>
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">可出库批次</div>
            <div className="app-panel__title-sub">运营从 QC 已放行批次创建出库计划，系统会预留库存给仓库处理。</div>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={loading}
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
          loading={loading}
          size="middle"
          columns={shipmentColumns}
          dataSource={outboundData.outboundShipments || []}
          scroll={{ x: 1180 }}
          pagination={{ pageSize: 8, showSizeChanger: false }}
        />
      </div>

      <Modal
        title="录入抽检结果"
        open={!!qcTarget}
        onCancel={() => setQcTarget(null)}
        onOk={submitQc}
        confirmLoading={actingKey === `qc-submit-${qcTarget?.id}`}
        destroyOnClose
      >
        <Form form={qcForm} layout="vertical">
          <Form.Item label="抽检数量" name="actualSampleQty" rules={[{ required: true, message: "请输入抽检数量" }]}>
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="不良数量" name="defectiveQty" rules={[{ required: true, message: "请输入不良数量" }]}>
            <InputNumber min={0} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={3} placeholder="可填写主要不良现象" />
          </Form.Item>
        </Form>
      </Modal>

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
