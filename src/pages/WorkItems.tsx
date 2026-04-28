import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Col,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  BellOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { canViewAllWorkItems, getDefaultWorkItemOwnerRole } from "../utils/erpRoleAccess";

const { Text } = Typography;
const erp = window.electronAPI?.erp;

const ROLE_OPTIONS = [
  { label: "全部角色", value: "__all" },
  { label: "运营", value: "operations" },
  { label: "采购", value: "buyer" },
  { label: "财务", value: "finance" },
  { label: "仓库", value: "warehouse" },
  { label: "负责人", value: "manager" },
];

const STATUS_OPTIONS = [
  { label: "未完成", value: "__active" },
  { label: "新事项", value: "new" },
  { label: "处理中", value: "in_progress" },
  { label: "等待运营", value: "waiting_operations" },
  { label: "等待采购", value: "waiting_buyer" },
  { label: "等待财务", value: "waiting_finance" },
  { label: "等待仓库", value: "waiting_warehouse" },
  { label: "已完成", value: "done" },
  { label: "已关闭", value: "dismissed" },
  { label: "全部", value: "__all" },
];

const PRIORITY_COLOR: Record<string, string> = {
  P0: "red",
  P1: "orange",
  P2: "blue",
  P3: "default",
};

const STATUS_COLOR: Record<string, string> = {
  new: "processing",
  in_progress: "blue",
  waiting_operations: "gold",
  waiting_buyer: "gold",
  waiting_finance: "gold",
  waiting_warehouse: "gold",
  waiting_supplier: "gold",
  done: "success",
  dismissed: "default",
};

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  manager: "负责人",
  operations: "运营",
  buyer: "采购",
  finance: "财务",
  warehouse: "仓库",
  viewer: "只读",
};

const STATUS_LABEL: Record<string, string> = {
  new: "新事项",
  in_progress: "处理中",
  waiting_operations: "等待运营",
  waiting_buyer: "等待采购",
  waiting_finance: "等待财务",
  waiting_warehouse: "等待仓库",
  waiting_supplier: "等待供应商",
  done: "已完成",
  dismissed: "已关闭",
};

interface WorkItemRow {
  id: string;
  accountId: string;
  accountName?: string;
  type: string;
  priority: string;
  status: string;
  ownerRole: string;
  ownerUserName?: string;
  title: string;
  evidence?: string[];
  relatedDocType?: string;
  relatedDocId?: string;
  skuId?: string;
  internalSkuCode?: string;
  productName?: string;
  dueAt?: string | null;
  updatedAt?: string;
}

interface WorkItemStats {
  total?: number;
  active?: number;
  byOwnerRole?: Record<string, number>;
  byStatus?: Record<string, number>;
  byPriority?: Record<string, number>;
}

interface LanStatus {
  running?: boolean;
  primaryUrl?: string;
  localUrl?: string;
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function roleLabel(role?: string) {
  return ROLE_LABEL[role || ""] || role || "-";
}

function statusLabel(status?: string) {
  return STATUS_LABEL[status || ""] || status || "-";
}

function relatedPath(type?: string) {
  if (!type) return "/";
  if (type === "purchase_request" || type === "purchase_order") return "/purchase";
  if (type === "inbound_receipt" || type === "inventory_batch") return "/warehouse";
  if (type === "qc_inspection") return "/qc";
  if (type === "outbound_shipment") return "/outbound";
  return "/";
}

export default function WorkItems() {
  const auth = useErpAuth();
  const defaultOwnerRole = getDefaultWorkItemOwnerRole(auth.currentUser?.role);
  const canViewAll = canViewAllWorkItems(auth.currentUser?.role);
  const [items, setItems] = useState<WorkItemRow[]>([]);
  const [stats, setStats] = useState<WorkItemStats | null>(null);
  const [lanStatus, setLanStatus] = useState<LanStatus | null>(null);
  const [ownerRole, setOwnerRole] = useState(defaultOwnerRole);
  const [statusFilter, setStatusFilter] = useState("__active");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    setOwnerRole(defaultOwnerRole);
  }, [defaultOwnerRole]);

  const loadItems = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const params = {
        limit: 200,
        ownerRole: ownerRole === "__all" ? undefined : ownerRole,
        status: statusFilter.startsWith("__") ? undefined : statusFilter,
        activeOnly: statusFilter === "__active",
      };
      const [nextItems, nextStats, nextLanStatus] = await Promise.all([
        erp.workItem.list(params),
        erp.workItem.stats({ limit: 1 }),
        erp.lan.getStatus(),
      ]);
      setItems(nextItems as WorkItemRow[]);
      setStats(nextStats as WorkItemStats);
      setLanStatus(nextLanStatus as LanStatus);
    } catch (error: any) {
      message.error(error?.message || "事项读取失败");
    } finally {
      setLoading(false);
    }
  }, [ownerRole, statusFilter]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const handleGenerate = async () => {
    if (!erp) return;
    setGenerating(true);
    try {
      const result = await erp.workItem.generate({
        actor: auth.currentUser ? { id: auth.currentUser.id, role: auth.currentUser.role } : { role: "admin" },
        limit: 200,
      });
      message.success(`事项已刷新：新增 ${result?.summary?.created || 0}，更新 ${result?.summary?.updated || 0}，自动完成 ${result?.summary?.resolved || 0}`);
      await loadItems();
    } catch (error: any) {
      message.error(error?.message || "事项生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const handleUpdateStatus = async (row: WorkItemRow, status: string) => {
    if (!erp) return;
    setUpdatingId(row.id);
    try {
      await erp.workItem.updateStatus({
        id: row.id,
        status,
        actor: auth.currentUser ? { id: auth.currentUser.id, role: auth.currentUser.role } : { role: "admin" },
      });
      message.success("事项状态已更新");
      await loadItems();
    } catch (error: any) {
      message.error(error?.message || "事项状态更新失败");
    } finally {
      setUpdatingId(null);
    }
  };

  const openRelated = (row: WorkItemRow) => {
    const baseUrl = lanStatus?.primaryUrl || lanStatus?.localUrl;
    if (!baseUrl) {
      message.warning("团队协作服务尚未开启");
      return;
    }
    window.open(`${baseUrl}${relatedPath(row.relatedDocType)}`, "_blank", "noopener,noreferrer");
  };

  const activeCount = stats?.active || 0;
  const p0Count = stats?.byPriority?.P0 || 0;
  const waitingCount = useMemo(() => (
    Object.entries(stats?.byStatus || {})
      .filter(([key]) => key.startsWith("waiting_"))
      .reduce((sum, [, count]) => sum + Number(count || 0), 0)
  ), [stats]);

  const columns = useMemo<ColumnsType<WorkItemRow>>(() => [
    {
      title: "优先级",
      dataIndex: "priority",
      key: "priority",
      width: 86,
      render: (value) => <Tag color={PRIORITY_COLOR[value] || "default"}>{value}</Tag>,
    },
    {
      title: "事项",
      dataIndex: "title",
      key: "title",
      ellipsis: true,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.title}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.internalSkuCode || row.skuId || "-"} {row.productName ? `· ${row.productName}` : ""}
          </Text>
        </Space>
      ),
    },
    {
      title: "负责人",
      dataIndex: "ownerRole",
      key: "ownerRole",
      width: 105,
      render: (value, row) => (
        <Space direction="vertical" size={2}>
          <Tag>{roleLabel(value)}</Tag>
          {row.ownerUserName ? <Text type="secondary" style={{ fontSize: 12 }}>{row.ownerUserName}</Text> : null}
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 112,
      render: (value) => <Tag color={STATUS_COLOR[value] || "default"}>{statusLabel(value)}</Tag>,
    },
    {
      title: "证据",
      dataIndex: "evidence",
      key: "evidence",
      ellipsis: true,
      render: (value: string[] = []) => (
        <Space direction="vertical" size={1}>
          {value.slice(0, 3).map((item) => (
            <Text type="secondary" style={{ fontSize: 12 }} key={item}>{item}</Text>
          ))}
          {value.length === 0 ? <Text type="secondary">-</Text> : null}
        </Space>
      ),
    },
    {
      title: "关联",
      key: "related",
      width: 170,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text code>{row.relatedDocType || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.relatedDocId || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "更新",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 160,
      render: formatTime,
    },
    {
      title: "动作",
      key: "actions",
      width: 190,
      fixed: "right",
      render: (_value, row) => (
        <Space size={6} wrap>
          <Tooltip title="打开对应 LAN 工作台">
            <Button size="small" icon={<LinkOutlined />} onClick={() => openRelated(row)} />
          </Tooltip>
          {row.status === "new" ? (
            <Button
              size="small"
              icon={<PlayCircleOutlined />}
              loading={updatingId === row.id}
              onClick={() => handleUpdateStatus(row, "in_progress")}
            />
          ) : null}
          {!["done", "dismissed"].includes(row.status) ? (
            <Button
              size="small"
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={updatingId === row.id}
              onClick={() => handleUpdateStatus(row, "done")}
            />
          ) : null}
          {!["done", "dismissed"].includes(row.status) ? (
            <Button
              size="small"
              danger
              icon={<CloseCircleOutlined />}
              loading={updatingId === row.id}
              onClick={() => handleUpdateStatus(row, "dismissed")}
            />
          ) : null}
        </Space>
      ),
    },
  ], [lanStatus, updatingId]);

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="ERP" title="事项中心" subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境没有 window.electronAPI.erp" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="ERP"
        title="事项中心"
        subtitle="从采购、付款、仓库、QC 和出库状态生成今日待办"
        meta={[
          `${items.length} 条当前列表`,
          lanStatus?.running ? "LAN 已启动" : "LAN 未启动",
        ]}
        actions={[
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={loadItems}>
            刷新
          </Button>,
          <Button key="generate" type="primary" icon={<SyncOutlined />} loading={generating} onClick={handleGenerate}>
            生成事项
          </Button>,
        ]}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <StatCard title="未完成事项" value={activeCount} color="blue" icon={<BellOutlined />} />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="P0 风险" value={p0Count} color={p0Count > 0 ? "danger" : "success"} icon={<CloseCircleOutlined />} />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="等待状态" value={waitingCount} color="purple" icon={<PlayCircleOutlined />} />
        </Col>
      </Row>

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">当前事项</div>
            <div className="app-panel__title-sub">角色和状态筛选只影响列表，不影响生成规则</div>
          </div>
          <Space wrap>
            <Select
              value={ownerRole}
              options={ROLE_OPTIONS}
              onChange={setOwnerRole}
              disabled={!canViewAll}
              style={{ width: 132 }}
            />
            <Select
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={setStatusFilter}
              style={{ width: 132 }}
            />
          </Space>
        </div>
        <Table
          size="middle"
          rowKey="id"
          loading={loading || generating}
          columns={columns}
          dataSource={items}
          scroll={{ x: 1180 }}
          pagination={{ pageSize: 12, showSizeChanger: false }}
        />
      </div>
    </div>
  );
}
