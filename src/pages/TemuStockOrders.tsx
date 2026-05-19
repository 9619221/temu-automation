import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Col, Modal, Row, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckCircleOutlined, ExportOutlined, InboxOutlined, ReloadOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { hasPageCache, readPageCache, writePageCache } from "../utils/pageCache";
import { canRole, formatQty } from "../utils/erpUi";

const { Text } = Typography;
const erp = window.electronAPI?.erp;
const TEMU_STOCK_ORDERS_CACHE_KEY = "temu.stock-orders.cache.v1";

interface ErpAccountRow {
  id: string;
  name: string;
}

interface TemuStockOrderRow {
  id: string;
  accountId: string;
  temuPurchaseOrderNo?: string | null;
  parentOrderNo?: string | null;
  categoryType?: string | null;
  temuSkcId?: string | null;
  temuSkuId?: string | null;
  skuCode?: string | null;
  productName?: string | null;
  demandQty?: number | string | null;
  temuStatus?: string | null;
  warehouseGroup?: string | null;
  urgencyInfo?: string | null;
  orderTime?: string | null;
  mappedErpSkuId?: string | null;
  syncStatus?: string | null;
  syncedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface TemuStockOrderApi {
  list: (params: { accountId: string; status?: string; limit?: number }) => Promise<TemuStockOrderRow[]>;
  createOutbound: (payload: { stockOrderId: string }) => Promise<{ shipment?: any }>;
}

interface TemuStockOrdersCache {
  generatedAt?: string;
  accounts?: ErpAccountRow[];
  selectedAccountId?: string;
  rows?: TemuStockOrderRow[];
}

const STATUS_OPTIONS = [
  { label: "全部", value: "" },
  { label: "待匹配", value: "pending" },
  { label: "已匹配", value: "matched" },
  { label: "未匹配", value: "unmatched" },
  { label: "已转出库", value: "outbound_created" },
  { label: "库存不足", value: "unfulfillable" },
];

const SYNC_STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: "待匹配", color: "default" },
  matched: { label: "已匹配", color: "green" },
  unmatched: { label: "未匹配", color: "orange" },
  outbound_created: { label: "已转出库", color: "blue" },
  unfulfillable: { label: "库存不足", color: "red" },
};

function getTemuStockOrderApi() {
  return (erp as { temuStockOrder?: TemuStockOrderApi } | undefined)?.temuStockOrder;
}

function syncStatusTag(value?: string | null) {
  const meta = SYNC_STATUS_META[value || ""] || { label: value || "-", color: "default" };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

export default function TemuStockOrders() {
  const auth = useErpAuth();
  const role = auth.currentUser?.role || "";
  const cachedData = useMemo(
    () => readPageCache<TemuStockOrdersCache>(TEMU_STOCK_ORDERS_CACHE_KEY, {}),
    [],
  );
  const [accounts, setAccounts] = useState<ErpAccountRow[]>(() => cachedData.accounts || []);
  const [selectedAccountId, setSelectedAccountId] = useState(() => cachedData.selectedAccountId || cachedData.accounts?.[0]?.id || "");
  const [statusFilter, setStatusFilter] = useState("");
  const [rows, setRows] = useState<TemuStockOrderRow[]>(() => cachedData.rows || []);
  const [loadedOnce, setLoadedOnce] = useState(() => hasPageCache(cachedData));
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);

  const accountOptions = useMemo(
    () => accounts.map((account) => ({ label: account.name || account.id, value: account.id })),
    [accounts],
  );
  const accountNameById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name || account.id])),
    [accounts],
  );

  const persistCache = useCallback((nextRows: TemuStockOrderRow[], nextAccounts = accounts, nextSelectedAccountId = selectedAccountId) => {
    writePageCache<TemuStockOrdersCache>(TEMU_STOCK_ORDERS_CACHE_KEY, {
      generatedAt: new Date().toISOString(),
      accounts: nextAccounts,
      selectedAccountId: nextSelectedAccountId,
      rows: nextRows,
    });
  }, [accounts, selectedAccountId]);

  const loadData = useCallback(async (accountId = selectedAccountId, status = statusFilter, nextAccounts = accounts) => {
    if (!erp || !accountId) return;
    const stockOrderApi = getTemuStockOrderApi();
    if (!stockOrderApi) return;

    setLoading(true);
    try {
      const nextRows = await stockOrderApi.list({
        accountId,
        status: status || undefined,
        limit: 500,
      });
      setRows(nextRows);
      setLoadedOnce(true);
      persistCache(nextRows, nextAccounts, accountId);
    } catch (error: any) {
      message.error(error?.message || "备货单加载失败");
    } finally {
      setLoading(false);
    }
  }, [accounts, persistCache, selectedAccountId, statusFilter]);

  useEffect(() => {
    if (!erp) return;
    const stockOrderApi = getTemuStockOrderApi();
    if (!stockOrderApi) return;

    let cancelled = false;

    const loadInitialData = async () => {
      setLoading(true);
      try {
        const nextAccounts = (await erp.account.list({ limit: 500 })) as ErpAccountRow[];
        if (cancelled) return;

        setAccounts(nextAccounts);
        const nextSelectedAccountId = (
          selectedAccountId && nextAccounts.some((account) => account.id === selectedAccountId)
        )
          ? selectedAccountId
          : nextAccounts[0]?.id || "";
        setSelectedAccountId(nextSelectedAccountId);

        if (!nextSelectedAccountId) {
          setRows([]);
          setLoadedOnce(true);
          persistCache([], nextAccounts, "");
          return;
        }

        const nextRows = await stockOrderApi.list({
          accountId: nextSelectedAccountId,
          status: statusFilter || undefined,
          limit: 500,
        });
        if (cancelled) return;

        setRows(nextRows);
        setLoadedOnce(true);
        persistCache(nextRows, nextAccounts, nextSelectedAccountId);
      } catch (error: any) {
        if (!cancelled) message.error(error?.message || "备货单加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadInitialData();
    return () => {
      cancelled = true;
    };
  }, []);

  const statusCounts = useMemo(() => (
    rows.reduce<Record<string, number>>((counts, row) => {
      const status = row.syncStatus || "pending";
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {})
  ), [rows]);

  const handleCreateOutbound = async (row: TemuStockOrderRow) => {
    if (!erp) return;
    const stockOrderApi = getTemuStockOrderApi();
    if (!stockOrderApi) return;

    setActingKey(row.id);
    try {
      await stockOrderApi.createOutbound({ stockOrderId: row.id });
      message.success("已生成出库单");
      await loadData();
    } catch (error: any) {
      message.error(error?.message || "转出库失败");
    } finally {
      setActingKey(null);
    }
  };

  const openCreateOutboundConfirm = (row: TemuStockOrderRow) => {
    Modal.confirm({
      title: "确认转出库",
      content: (
        <Space direction="vertical" size={4}>
          <Text>备货单号：{row.temuPurchaseOrderNo || row.id}</Text>
          <Text>需求数：{formatQty(row.demandQty)}</Text>
        </Space>
      ),
      okText: "确认转出库",
      cancelText: "取消",
      onOk: () => handleCreateOutbound(row),
    });
  };

  const columns = useMemo<ColumnsType<TemuStockOrderRow>>(() => [
    {
      title: "备货单",
      key: "stockOrder",
      width: 220,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.temuPurchaseOrderNo || row.id}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.parentOrderNo || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "商品",
      key: "product",
      ellipsis: true,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.productName || "-"}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.skuCode || "-"} / {row.temuSkcId || "-"}
          </Text>
        </Space>
      ),
    },
    {
      title: "需求数",
      dataIndex: "demandQty",
      width: 100,
      render: formatQty,
    },
    {
      title: "Temu 状态",
      dataIndex: "temuStatus",
      width: 130,
      render: (value) => value || "-",
    },
    {
      title: "仓库组",
      dataIndex: "warehouseGroup",
      width: 140,
      render: (value) => value || "-",
    },
    {
      title: "同步状态",
      dataIndex: "syncStatus",
      width: 120,
      render: syncStatusTag,
    },
    {
      title: "操作",
      key: "actions",
      width: 130,
      fixed: "right",
      render: (_value, row) => {
        if (row.syncStatus === "outbound_created") return <Text type="secondary">已转出库</Text>;
        if (row.syncStatus === "unmatched") return <Text type="secondary">未匹配 SKU</Text>;
        if (row.syncStatus === "unfulfillable") return <Text type="secondary">库存不足</Text>;
        if (row.syncStatus !== "matched") return <Text type="secondary">待匹配</Text>;
        if (!canRole(role, ["operations", "manager", "admin"])) return <Text type="secondary">无权限</Text>;

        return (
          <Button
            size="small"
            type="primary"
            icon={<ExportOutlined />}
            loading={actingKey === row.id}
            onClick={() => openCreateOutboundConfirm(row)}
          >
            转出库
          </Button>
        );
      },
    },
  ], [actingKey, role]);

  const tableLoading = loading && !loadedOnce;

  if (!erp) {
    return (
      <div className="dashboard-shell">
        <PageHeader compact eyebrow="备货单" title="Temu 备货单" subtitle="服务未就绪，请重启软件" />
        <Alert type="error" showIcon message="当前环境未暴露 ERP 服务，请重启软件" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="备货单"
        title="Temu 备货单"
        subtitle="查看 Temu 备货单镜像表，将已匹配 SKU 的备货单一键生成出库单"
        meta={[
          selectedAccountId ? `账号 ${accountNameById.get(selectedAccountId) || selectedAccountId}` : "未选择账号",
          `备货单 ${rows.length}`,
        ]}
        actions={[
          <Select
            key="account"
            value={selectedAccountId || undefined}
            placeholder="选择账号"
            options={accountOptions}
            onChange={(value) => {
              setSelectedAccountId(value);
              void loadData(value, statusFilter);
            }}
            style={{ width: 180 }}
          />,
          <Select
            key="status"
            value={statusFilter}
            options={STATUS_OPTIONS}
            onChange={(value) => {
              setStatusFilter(value);
              void loadData(selectedAccountId, value);
            }}
            style={{ width: 140 }}
          />,
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={() => loadData()}>
            刷新
          </Button>,
        ]}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <StatCard title="已匹配" value={statusCounts.matched || 0} color="success" icon={<CheckCircleOutlined />} compact />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="未匹配" value={statusCounts.unmatched || 0} color="purple" icon={<InboxOutlined />} compact />
        </Col>
        <Col xs={24} md={8}>
          <StatCard title="已转出库" value={statusCounts.outbound_created || 0} color="blue" icon={<ExportOutlined />} compact />
        </Col>
      </Row>

      <div className="app-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">备货单列表</div>
            <div className="app-panel__title-sub">按账号与同步状态查看镜像表数据，已匹配的备货单可直接转出库</div>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={tableLoading}
          size="middle"
          columns={columns}
          dataSource={rows}
          scroll={{ x: 980 }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
        />
      </div>
    </div>
  );
}
