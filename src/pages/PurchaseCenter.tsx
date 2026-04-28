import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Col,
  Row,
  Space,
  Table,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CheckCircleOutlined,
  DollarOutlined,
  FileDoneOutlined,
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
  formatMoney,
  formatQty,
  statusTag,
} from "../utils/erpUi";

const { Text } = Typography;
const erp = window.electronAPI?.erp;

interface PurchaseRequestRow {
  id: string;
  internalSkuCode?: string;
  productName?: string;
  status: string;
  reason?: string;
  requestedQty?: number;
  targetUnitCost?: number;
  expectedArrivalDate?: string | null;
  requestedByName?: string;
  evidence?: string[];
  candidateCount?: number;
  selectedCandidateCount?: number;
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
}

function skuText(row: { internalSkuCode?: string; productName?: string }) {
  return (
    <Space direction="vertical" size={2}>
      <Text strong>{row.productName || "-"}</Text>
      <Text type="secondary" style={{ fontSize: 12 }}>{row.internalSkuCode || "-"}</Text>
    </Space>
  );
}

export default function PurchaseCenter() {
  const auth = useErpAuth();
  const role = auth.currentUser?.role || "";
  const [data, setData] = useState<PurchaseWorkbench>({});
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      setData(await erp.purchase.workbench({ limit: 200 }));
    } catch (error: any) {
      message.error(error?.message || "采购中心读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const runAction = async (key: string, payload: Record<string, any>, successText: string) => {
    if (!erp) return;
    setActingKey(key);
    try {
      const result = await erp.purchase.action({ ...payload, limit: 200 });
      setData(result?.workbench || await erp.purchase.workbench({ limit: 200 }));
      message.success(successText);
    } catch (error: any) {
      message.error(error?.message || "操作失败");
    } finally {
      setActingKey(null);
    }
  };

  const requestColumns = useMemo<ColumnsType<PurchaseRequestRow>>(() => [
    {
      title: "SKU",
      key: "sku",
      width: 260,
      render: (_value, row) => skuText(row),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      render: (value) => statusTag(value, PR_STATUS_LABELS),
    },
    {
      title: "申请",
      key: "request",
      width: 150,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{formatQty(row.requestedQty)} 件</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.reason || "-"} · {row.requestedByName || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "目标成本",
      dataIndex: "targetUnitCost",
      width: 110,
      render: formatMoney,
    },
    {
      title: "期望到货",
      dataIndex: "expectedArrivalDate",
      width: 120,
      render: formatDate,
    },
    {
      title: "证据",
      dataIndex: "evidence",
      ellipsis: true,
      render: (value: string[] = []) => (
        <Space direction="vertical" size={1}>
          {value.slice(0, 2).map((item) => <Text key={item} type="secondary" style={{ fontSize: 12 }}>{item}</Text>)}
          {value.length === 0 ? <Text type="secondary">-</Text> : null}
        </Space>
      ),
    },
    {
      title: "寻源",
      key: "sourcing",
      width: 110,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{formatQty(row.candidateCount)} 个候选</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>已选 {formatQty(row.selectedCandidateCount)}</Text>
        </Space>
      ),
    },
    {
      title: "动作",
      key: "actions",
      width: 170,
      fixed: "right",
      render: (_value, row) => (
        <Space size={6} wrap>
          {row.status === "submitted" && canRole(role, ["buyer", "manager", "admin"]) ? (
            <Button
              size="small"
              icon={<ShoppingCartOutlined />}
              loading={actingKey === `accept-${row.id}`}
              onClick={() => runAction(`accept-${row.id}`, { action: "accept_pr", prId: row.id }, "已接收 PR")}
            >
              接收 PR
            </Button>
          ) : null}
          {row.status === "buyer_processing" && canRole(role, ["buyer", "manager", "admin"]) ? (
            <Button
              size="small"
              icon={<SearchOutlined />}
              loading={actingKey === `sourced-${row.id}`}
              onClick={() => runAction(`sourced-${row.id}`, { action: "mark_sourced", prId: row.id }, "已标记寻源")}
            >
              已寻源
            </Button>
          ) : null}
          {!["submitted", "buyer_processing"].includes(row.status) ? <Text type="secondary">无动作</Text> : null}
        </Space>
      ),
    },
  ], [actingKey, role]);

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
      title: "SKU / 数量",
      key: "qty",
      ellipsis: true,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.skuSummary || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{formatQty(row.receivedQty)} / {formatQty(row.totalQty)} 已收</Text>
        </Space>
      ),
    },
    {
      title: "金额",
      dataIndex: "totalAmount",
      width: 120,
      render: formatMoney,
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
      title: "动作",
      key: "actions",
      width: 180,
      fixed: "right",
      render: (_value, row) => (
        <Space size={6} wrap>
          {row.status === "draft" && canRole(role, ["buyer", "manager", "admin"]) ? (
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
          {row.status === "pending_finance_approval" && canRole(role, ["finance", "manager", "admin"]) ? (
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `pay-approve-po-${row.id}`}
              onClick={() => runAction(`pay-approve-po-${row.id}`, { action: "approve_payment", poId: row.id }, "财务已批准")}
            >
              财务批准
            </Button>
          ) : null}
          {row.status === "approved_to_pay" && canRole(role, ["finance", "manager", "admin"]) ? (
            <Button
              size="small"
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={actingKey === `paid-po-${row.id}`}
              onClick={() => runAction(`paid-po-${row.id}`, { action: "confirm_paid", poId: row.id }, "已确认付款")}
            >
              已付款
            </Button>
          ) : null}
          {!["draft", "pending_finance_approval", "approved_to_pay"].includes(row.status) ? <Text type="secondary">无动作</Text> : null}
        </Space>
      ),
    },
  ], [actingKey, role]);

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
      render: (_value, row) => formatMoney(row.paymentAmount ?? row.totalAmount),
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
      width: 170,
      fixed: "right",
      render: (_value, row) => (
        <Space size={6} wrap>
          {(row.paymentApprovalStatus === "pending" || row.poStatus === "pending_finance_approval") && canRole(role, ["finance", "manager", "admin"]) ? (
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
          {(row.paymentApprovalStatus === "approved" || row.poStatus === "approved_to_pay") && canRole(role, ["finance", "manager", "admin"]) ? (
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
            <Text type="secondary">无动作</Text>
          ) : null}
        </Space>
      ),
    },
  ], [actingKey, role]);

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
        title="采购申请、采购单、付款审批"
        subtitle="运营提交 PR 后，采购接收和寻源；PO 进入财务审批和付款链路。"
        meta={[`更新 ${formatDateTime(data.generatedAt)}`]}
        actions={[
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={loadData}>
            刷新
          </Button>,
        ]}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <StatCard title="待处理 PR" value={summary.pendingPurchaseRequestCount || 0} color="blue" icon={<ShoppingCartOutlined />} compact />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="未关闭 PO" value={summary.openPurchaseOrderCount || 0} color="purple" icon={<FileDoneOutlined />} compact />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="付款审批" value={summary.paymentQueueCount || 0} suffix={`/${formatMoney(summary.paymentQueueAmount)}`} color="danger" icon={<DollarOutlined />} compact />
        </Col>
      </Row>

      <div className="app-panel" style={{ marginBottom: 16 }}>
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">采购申请列表</div>
            <div className="app-panel__title-sub">采购角色处理接收 PR 和标记已寻源。</div>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          size="middle"
          columns={requestColumns}
          dataSource={data.purchaseRequests || []}
          scroll={{ x: 1120 }}
          pagination={{ pageSize: 8, showSizeChanger: false }}
        />
      </div>

      <div className="app-panel" style={{ marginBottom: 16 }}>
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">采购单列表</div>
            <div className="app-panel__title-sub">采购单跟踪财务审批、付款、供应商备货、到仓和入库状态。</div>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          size="middle"
          columns={orderColumns}
          dataSource={data.purchaseOrders || []}
          scroll={{ x: 1120 }}
          pagination={{ pageSize: 8, showSizeChanger: false }}
        />
      </div>

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">付款审批入口</div>
            <div className="app-panel__title-sub">财务批准后再确认付款，系统会把 PO 推到后续备货链路。</div>
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
    </div>
  );
}
