import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Empty, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { canViewAllWorkItems, getDefaultWorkItemOwnerRole } from "../utils/erpRoleAccess";
import { hasPageCache, readPageCache, writePageCache } from "../utils/pageCache";

const { Text } = Typography;
const erp = window.electronAPI?.erp;
const WORK_ITEMS_CACHE_KEY = "temu.work-items.cache.v1";

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

const ROLE_OPTION_VALUES = new Set(ROLE_OPTIONS.map((option) => option.value));
const STATUS_OPTION_VALUES = new Set(STATUS_OPTIONS.map((option) => option.value));

const PRIORITY_COLOR: Record<string, string> = {
  P0: "red",
  P1: "orange",
  P2: "blue",
  P3: "default",
};

const PRIORITY_LABEL: Record<string, string> = {
  P0: "紧急",
  P1: "高",
  P2: "中",
  P3: "低",
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

interface WorkItemsCache {
  generatedAt?: string;
  items?: WorkItemRow[];
  stats?: WorkItemStats | null;
  lanStatus?: LanStatus | null;
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function roleLabel(role?: string) {
  return ROLE_LABEL[role || ""] || "未知角色";
}

function statusLabel(status?: string) {
  return STATUS_LABEL[status || ""] || "未知状态";
}

function priorityLabel(priority?: string) {
  return PRIORITY_LABEL[priority || ""] || "未定";
}

function relatedDocLabel(type?: string) {
  const labels: Record<string, string> = {
    purchase_request: "采购需求",
    purchase_order: "采购单",
    inbound_receipt: "入库单",
    inventory_batch: "库存批次",
    qc_inspection: "质检单",
    outbound_shipment: "发货单",
  };
  return labels[type || ""] || "关联单据";
}

function relatedPath(type?: string) {
  if (type === "purchase_request" || type === "purchase_order") return "/purchase-center";
  if (type === "inbound_receipt" || type === "inventory_batch") return "/warehouse-center";
  if (type === "qc_inspection" || type === "outbound_shipment") return "/qc-outbound";
  return "/work-items";
}

function getOptionLabel(options: Array<{ label: string; value: string }>, value: string) {
  return options.find((option) => option.value === value)?.label || value;
}

function getInitialOwnerRole(param: string | null, fallbackRole: string, canViewAll: boolean) {
  if (canViewAll && param && ROLE_OPTION_VALUES.has(param)) return param;
  return fallbackRole;
}

function getInitialStatusFilter(param: string | null) {
  if (param && STATUS_OPTION_VALUES.has(param)) return param;
  return "__active";
}

function getQueueTone(activeCount: number, p0Count: number, waitingCount: number) {
  if (p0Count > 0) return "danger";
  if (waitingCount > 0) return "warning";
  if (activeCount > 0) return "active";
  return "success";
}

function getQueueLabel(tone: string) {
  if (tone === "danger") return "有紧急事项";
  if (tone === "warning") return "等待协同";
  if (tone === "active") return "队列运行中";
  return "队列清爽";
}

export default function WorkItems() {
  const auth = useErpAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultOwnerRole = getDefaultWorkItemOwnerRole(auth.currentUser?.role);
  const canViewAll = canViewAllWorkItems(auth.currentUser?.role);
  const ownerParam = searchParams.get("owner");
  const statusParam = searchParams.get("status");
  const cachedData = useMemo(
    () => readPageCache<WorkItemsCache>(WORK_ITEMS_CACHE_KEY, {}),
    [],
  );
  const [items, setItems] = useState<WorkItemRow[]>(() => cachedData.items || []);
  const [stats, setStats] = useState<WorkItemStats | null>(() => cachedData.stats || null);
  const [lanStatus, setLanStatus] = useState<LanStatus | null>(() => cachedData.lanStatus || null);
  const [loadedOnce, setLoadedOnce] = useState(() => hasPageCache(cachedData));
  const [ownerRole, setOwnerRole] = useState(() => getInitialOwnerRole(ownerParam, defaultOwnerRole, canViewAll));
  const [statusFilter, setStatusFilter] = useState(() => getInitialStatusFilter(statusParam));
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    const nextOwnerRole = getInitialOwnerRole(ownerParam, defaultOwnerRole, canViewAll);
    setOwnerRole((prev) => (prev === nextOwnerRole ? prev : nextOwnerRole));
  }, [canViewAll, defaultOwnerRole, ownerParam]);

  useEffect(() => {
    const nextStatusFilter = getInitialStatusFilter(statusParam);
    setStatusFilter((prev) => (prev === nextStatusFilter ? prev : nextStatusFilter));
  }, [statusParam]);

  const syncFilterSearch = useCallback((nextOwnerRole: string, nextStatusFilter: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextOwnerRole === defaultOwnerRole) {
        next.delete("owner");
      } else {
        next.set("owner", nextOwnerRole);
      }
      if (nextStatusFilter === "__active") {
        next.delete("status");
      } else {
        next.set("status", nextStatusFilter);
      }
      return next;
    }, { replace: true });
  }, [defaultOwnerRole, setSearchParams]);

  const handleOwnerRoleChange = (value: string) => {
    setOwnerRole(value);
    syncFilterSearch(value, statusFilter);
  };

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    syncFilterSearch(ownerRole, value);
  };

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
      const [nextItems, nextStats, rawLanStatus] = await Promise.all([
        erp.workItem.list(params),
        erp.workItem.stats({ limit: 1 }),
        erp.lan.getStatus(),
      ]);
      const nextItemRows = nextItems as WorkItemRow[];
      const nextStatsRow = nextStats as WorkItemStats;
      const nextLanStatus = rawLanStatus as LanStatus;
      setItems(nextItemRows);
      setStats(nextStatsRow);
      setLanStatus(nextLanStatus);
      setLoadedOnce(true);
      writePageCache<WorkItemsCache>(WORK_ITEMS_CACHE_KEY, {
        generatedAt: new Date().toISOString(),
        items: nextItemRows,
        stats: nextStatsRow,
        lanStatus: nextLanStatus,
      });
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

  const openRelated = useCallback((row: WorkItemRow) => {
    const path = relatedPath(row.relatedDocType);
    if (path) {
      navigate(path);
      return;
    }
    const baseUrl = lanStatus?.primaryUrl || lanStatus?.localUrl;
    if (!baseUrl) {
      message.warning("团队协作服务尚未开启");
      return;
    }
    window.open(`${baseUrl}${path}`, "_blank", "noopener,noreferrer");
  }, [lanStatus, navigate]);

  const totalCount = stats?.total ?? items.length;
  const activeCount = stats?.active ?? items.filter((item) => !["done", "dismissed"].includes(item.status)).length;
  const p0Count = stats?.byPriority?.P0 ?? items.filter((item) => item.priority === "P0").length;
  const waitingCount = useMemo(() => (
    Object.entries(stats?.byStatus || {})
      .filter(([key]) => key.startsWith("waiting_"))
      .reduce((sum, [, count]) => sum + Number(count || 0), 0)
  ), [stats]);
  const doneCount = stats?.byStatus?.done ?? items.filter((item) => item.status === "done").length;
  const completionRate = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const queueTone = getQueueTone(activeCount, p0Count, waitingCount);
  const queueLabel = getQueueLabel(queueTone);
  const tableLoading = (loading || generating) && (!loadedOnce || items.length > 0);
  const ownerFilterLabel = getOptionLabel(ROLE_OPTIONS, ownerRole);
  const statusFilterLabel = getOptionLabel(STATUS_OPTIONS, statusFilter);
  const generatedAtLabel = cachedData.generatedAt ? formatTime(cachedData.generatedAt) : "等待生成";
  const roleQueues = useMemo(() => (
    Object.entries(stats?.byOwnerRole || {})
      .filter(([, count]) => Number(count || 0) > 0)
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .slice(0, 5)
  ), [stats]);

  const columns = useMemo<ColumnsType<WorkItemRow>>(() => [
    {
      title: "优先级",
      dataIndex: "priority",
      key: "priority",
      width: 86,
      render: (value) => (
        <Tag color={PRIORITY_COLOR[value] || "default"} className={`work-item-priority work-item-priority--${String(value || "P3").toLowerCase()}`}>
          {priorityLabel(value)}
        </Tag>
      ),
    },
    {
      title: "事项",
      dataIndex: "title",
      key: "title",
      ellipsis: true,
      render: (_value, row) => (
        <div className="work-item-title">
          <Text strong className="work-item-title__main">{row.title || "未命名事项"}</Text>
          <Text type="secondary" className="work-item-title__sub">
            {row.internalSkuCode || row.skuId || "-"} {row.productName ? `· ${row.productName}` : ""}
          </Text>
        </div>
      ),
    },
    {
      title: "负责人",
      dataIndex: "ownerRole",
      key: "ownerRole",
      width: 105,
      render: (value, row) => (
        <Space direction="vertical" size={2} className="work-item-owner">
          <Tag>{roleLabel(value)}</Tag>
          {row.ownerUserName ? <Text type="secondary" className="work-item-muted">{row.ownerUserName}</Text> : null}
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
        <Space direction="vertical" size={1} className="work-item-evidence">
          {value.slice(0, 3).map((item) => (
            <Text type="secondary" className="work-item-muted" key={item}>{item}</Text>
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
        <Space direction="vertical" size={2} className="work-item-related">
          <Text>{relatedDocLabel(row.relatedDocType)}</Text>
          <Text type="secondary" className="work-item-muted">{row.relatedDocId || "-"}</Text>
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
          <Tooltip title="打开对应工作台">
            <Button
              size="small"
              aria-label="打开对应工作台"
              className="work-item-action-button"
              icon={<LinkOutlined />}
              onClick={() => openRelated(row)}
            />
          </Tooltip>
          {row.status === "new" ? (
            <Button
              size="small"
              aria-label="开始处理事项"
              className="work-item-action-button"
              icon={<PlayCircleOutlined />}
              loading={updatingId === row.id}
              onClick={() => handleUpdateStatus(row, "in_progress")}
            />
          ) : null}
          {!["done", "dismissed"].includes(row.status) ? (
            <Button
              size="small"
              type="primary"
              aria-label="标记事项完成"
              className="work-item-action-button"
              icon={<CheckCircleOutlined />}
              loading={updatingId === row.id}
              onClick={() => handleUpdateStatus(row, "done")}
            />
          ) : null}
          {!["done", "dismissed"].includes(row.status) ? (
            <Button
              size="small"
              danger
              aria-label="关闭事项"
              className="work-item-action-button"
              icon={<CloseCircleOutlined />}
              loading={updatingId === row.id}
              onClick={() => handleUpdateStatus(row, "dismissed")}
            />
          ) : null}
        </Space>
      ),
    },
  ], [openRelated, updatingId]);

  if (!erp) {
    return (
      <div className="dashboard-shell work-items-shell">
        <PageHeader compact eyebrow="系统" title="事项中心" subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境缺少本地服务接口" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell work-items-shell">
      <PageHeader
        compact
        eyebrow="系统"
        title="事项中心"
        subtitle="从采购、付款、仓库、质检和出库状态生成今日待办"
        meta={[
          `${items.length} 条当前列表`,
          lanStatus?.running ? "协作服务已启动" : "协作服务未启动",
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

      <section className="work-items-command-grid" aria-label="事项队列概览">
        <div className={`work-items-command-panel is-${queueTone}`}>
          <div className="work-items-command-panel__head">
            <div>
              <div className="work-items-command-panel__eyebrow">Work Queue</div>
              <div className="work-items-command-panel__title">今日事项队列</div>
            </div>
            <span className={`work-items-command-status is-${queueTone}`}>{queueLabel}</span>
          </div>
          <div className="work-items-command-panel__value">{activeCount}</div>
          <div className="work-items-command-panel__meta">
            <span>当前筛选：{ownerFilterLabel} · {statusFilterLabel}</span>
            <span>上次生成：{generatedAtLabel}</span>
          </div>
          <div className="work-items-command-panel__queues">
            {roleQueues.length > 0 ? roleQueues.map(([role, count]) => (
              <span className="work-items-role-chip" key={role}>{roleLabel(role)} {count}</span>
            )) : (
              <span className="work-items-role-chip is-empty">暂无角色积压</span>
            )}
          </div>
        </div>
        <StatCard
          title="紧急风险"
          value={p0Count}
          color={p0Count > 0 ? "danger" : "success"}
          icon={<CloseCircleOutlined />}
          trend={p0Count > 0 ? "优先处理 P0" : "没有 P0 阻塞"}
          className="work-items-metric-card"
        />
        <StatCard
          title="等待协同"
          value={waitingCount}
          color="warning"
          icon={<ClockCircleOutlined />}
          trend={waitingCount > 0 ? "需要跨角色推进" : "暂无等待队列"}
          className="work-items-metric-card"
        />
        <StatCard
          title="完成率"
          value={completionRate}
          suffix="%"
          color="blue"
          icon={<CheckCircleOutlined />}
          trend={`${doneCount}/${totalCount || 0} 已完成`}
          className="work-items-metric-card"
        />
      </section>

      <div className="app-panel work-items-filter-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">当前事项</div>
            <div className="app-panel__title-sub">角色和状态筛选只影响列表，不影响生成规则</div>
          </div>
          <Space wrap>
            <Select
              aria-label="按负责人角色筛选"
              value={ownerRole}
              options={ROLE_OPTIONS}
              onChange={handleOwnerRoleChange}
              disabled={!canViewAll}
              style={{ width: 132 }}
            />
            <Select
              aria-label="按事项状态筛选"
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={handleStatusFilterChange}
              style={{ width: 132 }}
            />
          </Space>
        </div>
      </div>

      <div className="app-panel work-items-table-panel">
        <Table
          size="middle"
          rowKey="id"
          loading={tableLoading}
          columns={columns}
          dataSource={items}
          className="work-items-table"
          rowClassName={(row) => `work-items-table-row work-items-table-row--${row.priority || "P3"} work-items-table-row--${row.status}`}
          scroll={{ x: 1180 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无事项，点击生成事项后显示"
              />
            ),
          }}
          pagination={{
            pageSize: 12,
            showSizeChanger: false,
            showTotal: (total, range) => `${range[0]}-${range[1]} / ${total} 条`,
          }}
        />
      </div>
    </div>
  );
}
