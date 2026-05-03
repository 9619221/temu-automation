import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Col,
  Empty,
  Row,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  BellOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExportOutlined,
  InboxOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  ShoppingCartOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { canViewAllWorkItems, getDefaultWorkItemOwnerRole } from "../utils/erpRoleAccess";
import {
  WORK_ITEM_OWNER_LABELS,
  WORK_ITEM_STATUS_LABELS,
  formatDateTime,
  priorityTag,
  statusTag,
} from "../utils/erpUi";
import { hasPageCache, readPageCache, writePageCache } from "../utils/pageCache";

const { Text } = Typography;
const erp = window.electronAPI?.erp;

interface WorkItemRow {
  id: string;
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

interface DailyCommandCache {
  generatedAt?: string;
  items: WorkItemRow[];
  stats: WorkItemStats | null;
}

const DAILY_COMMAND_CACHE_KEY = "page-cache:daily-command:v1";

function routeForDoc(type?: string) {
  if (type === "purchase_request" || type === "purchase_order" || type === "payment_approval") return "/purchase-center";
  if (type === "inbound_receipt" || type === "inventory_batch") return "/warehouse-center";
  if (type === "qc_inspection" || type === "outbound_shipment") return "/qc-outbound";
  return "/work-items";
}

function relatedDocLabel(type?: string) {
  const labels: Record<string, string> = {
    purchase_request: "采购需求",
    purchase_order: "采购单",
    payment_approval: "付款审批",
    inbound_receipt: "入库单",
    inventory_batch: "库存批次",
    qc_inspection: "质检单",
    outbound_shipment: "发货单",
  };
  return labels[type || ""] || "关联单据";
}

function centerCards(navigate: (path: string) => void) {
  return [
    {
      title: "采购中心",
      text: "采购需求 / 采购单 / 付款审批",
      icon: <ShoppingCartOutlined />,
      path: "/purchase-center",
    },
    {
      title: "仓库中心",
      text: "待到货 / 入库 / 批次",
      icon: <InboxOutlined />,
      path: "/warehouse-center",
    },
    {
      title: "质检发仓",
      text: "抽检 / 出库计划 / 发货",
      icon: <ExportOutlined />,
      path: "/qc-outbound",
    },
  ].map((item) => (
    <Button
      key={item.path}
      icon={item.icon}
      onClick={() => navigate(item.path)}
      style={{ height: 40 }}
    >
      {item.title}
    </Button>
  ));
}

export default function DailyCommandCenter() {
  const navigate = useNavigate();
  const auth = useErpAuth();
  const defaultOwnerRole = getDefaultWorkItemOwnerRole(auth.currentUser?.role);
  const canViewAll = canViewAllWorkItems(auth.currentUser?.role);
  const cached = useMemo(() => readPageCache<DailyCommandCache>(DAILY_COMMAND_CACHE_KEY, {
    items: [],
    stats: null,
  }), []);
  const [items, setItems] = useState<WorkItemRow[]>(() => cached.items || []);
  const [stats, setStats] = useState<WorkItemStats | null>(() => cached.stats || null);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(() => hasPageCache(cached));
  const [generating, setGenerating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!erp) return;
    setLoading(true);
    try {
      const listParams = {
        limit: 200,
        ownerRole: canViewAll ? undefined : defaultOwnerRole,
        activeOnly: true,
      };
      const [nextItems, nextStats] = await Promise.all([
        erp.workItem.list(listParams),
        erp.workItem.stats({ limit: 1 }),
      ]);
      const nextCache = {
        generatedAt: new Date().toISOString(),
        items: nextItems as WorkItemRow[],
        stats: nextStats as WorkItemStats,
      };
      setItems(nextCache.items);
      setStats(nextCache.stats);
      setLoadedOnce(true);
      writePageCache(DAILY_COMMAND_CACHE_KEY, nextCache);
    } catch (error: any) {
      message.error(error?.message || "今日事项读取失败");
    } finally {
      setLoading(false);
    }
  }, [canViewAll, defaultOwnerRole]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleGenerate = async () => {
    if (!erp) return;
    setGenerating(true);
    try {
      const result = await erp.workItem.generate({
        actor: auth.currentUser ? { id: auth.currentUser.id, role: auth.currentUser.role } : { role: "admin" },
        limit: 200,
      });
      message.success(`已生成事项：新增 ${result?.summary?.created || 0}，更新 ${result?.summary?.updated || 0}`);
      await loadData();
    } catch (error: any) {
      message.error(error?.message || "事项生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const updateStatus = async (row: WorkItemRow, status: string) => {
    if (!erp) return;
    setUpdatingId(row.id);
    try {
      await erp.workItem.updateStatus({
        id: row.id,
        status,
        actor: auth.currentUser ? { id: auth.currentUser.id, role: auth.currentUser.role } : { role: "admin" },
      });
      message.success("事项状态已更新");
      await loadData();
    } catch (error: any) {
      message.error(error?.message || "事项状态更新失败");
    } finally {
      setUpdatingId(null);
    }
  };

  const p0Items = useMemo(() => items.filter((item) => item.priority === "P0").slice(0, 6), [items]);
  const waitingCount = useMemo(() => (
    Object.entries(stats?.byStatus || {})
      .filter(([key]) => key.startsWith("waiting_"))
      .reduce((sum, [, count]) => sum + Number(count || 0), 0)
  ), [stats]);
  const myRoleCount = stats?.byOwnerRole?.[auth.currentUser?.role || ""] || 0;
  const tableLoading = (loading || generating) && !loadedOnce && items.length > 0;

  const columns = useMemo<ColumnsType<WorkItemRow>>(() => [
    {
      title: "优先级",
      dataIndex: "priority",
      width: 86,
      render: priorityTag,
    },
    {
      title: "事项",
      dataIndex: "title",
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
      width: 120,
      render: (value, row) => (
        <Space direction="vertical" size={2}>
          <Tag>{WORK_ITEM_OWNER_LABELS[value] || "未知角色"}</Tag>
          {row.ownerUserName ? <Text type="secondary" style={{ fontSize: 12 }}>{row.ownerUserName}</Text> : null}
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      render: (value) => statusTag(value, WORK_ITEM_STATUS_LABELS),
    },
    {
      title: "证据",
      dataIndex: "evidence",
      ellipsis: true,
      render: (value: string[] = []) => (
        <Space direction="vertical" size={1}>
          {value.slice(0, 3).map((item) => <Text key={item} type="secondary" style={{ fontSize: 12 }}>{item}</Text>)}
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
          <Text>{relatedDocLabel(row.relatedDocType)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.relatedDocId || "-"}</Text>
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
      title: "动作",
      key: "actions",
      width: 210,
      fixed: "right",
      render: (_value, row) => (
        <Space size={6} wrap>
          <Button size="small" onClick={() => navigate(routeForDoc(row.relatedDocType))}>
            打开
          </Button>
          {row.status === "new" ? (
            <Button
              size="small"
              icon={<PlayCircleOutlined />}
              loading={updatingId === row.id}
              onClick={() => updateStatus(row, "in_progress")}
            />
          ) : null}
          {!["done", "dismissed"].includes(row.status) ? (
            <Button
              size="small"
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={updatingId === row.id}
              onClick={() => updateStatus(row, "done")}
            />
          ) : null}
          {!["done", "dismissed"].includes(row.status) ? (
            <Button
              size="small"
              danger
              icon={<CloseCircleOutlined />}
              loading={updatingId === row.id}
              onClick={() => updateStatus(row, "dismissed")}
            />
          ) : null}
        </Space>
      ),
    },
  ], [navigate, updatingId]);

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="系统" title="今日作战台" subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境缺少本地服务接口" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="今日作战台"
        title="今天必须处理的业务事项"
        subtitle="从采购、付款、仓库、质检和出库状态生成事项，打开系统先看这里。"
        meta={[`${stats?.active || 0} 个未完成`, `紧急 ${stats?.byPriority?.P0 || 0} 个`, `等待 ${waitingCount} 个`]}
        actions={[
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={loadData}>
            刷新
          </Button>,
          <Button key="generate" type="primary" icon={<SyncOutlined />} loading={generating} onClick={handleGenerate}>
            生成事项
          </Button>,
        ]}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={6}>
          <StatCard title="未完成事项" value={stats?.active || 0} color="blue" icon={<BellOutlined />} compact />
        </Col>
        <Col xs={24} md={6}>
          <StatCard title="紧急风险" value={stats?.byPriority?.P0 || 0} color={(stats?.byPriority?.P0 || 0) > 0 ? "danger" : "success"} icon={<CloseCircleOutlined />} compact />
        </Col>
        <Col xs={24} md={6}>
          <StatCard title="等待状态" value={waitingCount} color="purple" icon={<PlayCircleOutlined />} compact />
        </Col>
        <Col xs={24} md={6}>
          <StatCard title="我的角色事项" value={myRoleCount} color="brand" icon={<CheckCircleOutlined />} compact />
        </Col>
      </Row>

      <div className="app-panel" style={{ marginBottom: 16 }}>
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">业务快速入口</div>
            <div className="app-panel__title-sub">作战台看问题，进入对应中心处理单据。</div>
          </div>
          <Space wrap>{centerCards(navigate)}</Space>
        </div>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <div className="app-panel" style={{ minHeight: 258 }}>
            <div className="app-panel__title">
              <div>
                <div className="app-panel__title-main">紧急事项</div>
                <div className="app-panel__title-sub">最高优先级事项会固定在这里，优先处理。</div>
              </div>
            </div>
            {p0Items.length > 0 ? (
              <Space direction="vertical" style={{ width: "100%" }} size={8}>
                {p0Items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      border: "1px solid #f0f0f0",
                      borderRadius: 8,
                      padding: 12,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <Space direction="vertical" size={2}>
                      <Space>
                        {priorityTag(item.priority)}
                        <Text strong>{item.title}</Text>
                      </Space>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.evidence?.[0] || item.productName || item.internalSkuCode || "-"}
                      </Text>
                    </Space>
                    <Button size="small" onClick={() => navigate(routeForDoc(item.relatedDocType))}>处理</Button>
                  </div>
                ))}
              </Space>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无紧急风险" />
            )}
          </div>
        </Col>
        <Col xs={24} lg={10}>
          <div className="app-panel" style={{ minHeight: 258 }}>
            <div className="app-panel__title">
              <div>
                <div className="app-panel__title-main">角色分布</div>
                <div className="app-panel__title-sub">用于判断今天卡在哪个环节。</div>
              </div>
            </div>
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              {Object.entries(stats?.byOwnerRole || {}).map(([roleKey, count]) => (
                <div key={roleKey} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #f5f5f5", paddingBottom: 8 }}>
                  <Text>{WORK_ITEM_OWNER_LABELS[roleKey] || "未知角色"}</Text>
                  <Text strong>{count}</Text>
                </div>
              ))}
              {Object.keys(stats?.byOwnerRole || {}).length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无事项" />
              ) : null}
            </Space>
          </div>
        </Col>
      </Row>

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">今日事项列表</div>
            <div className="app-panel__title-sub">已按优先级和更新时间排序；角色账号默认只看自己的工作事项。</div>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={tableLoading}
          size="middle"
          columns={columns}
          dataSource={items}
          scroll={{ x: 1180 }}
          pagination={{ pageSize: 12, showSizeChanger: false }}
        />
      </div>
    </div>
  );
}
