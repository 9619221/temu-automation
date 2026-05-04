import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Col, Descriptions, InputNumber, Modal, Row, Space, Table, Tabs, Typography, message } from "antd";
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
  inboundReceiptId?: string | null;
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
  const navigate = useNavigate();
  const cachedData = useMemo(
    () => readPageCache<WarehouseWorkbench>(WAREHOUSE_WORKBENCH_CACHE_KEY, {}),
    [],
  );
  const [data, setData] = useState<WarehouseWorkbench>(cachedData);
  const [loadedOnce, setLoadedOnce] = useState(() => hasPageCache(cachedData));
  const [loading, setLoading] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [partialReceiveModal, setPartialReceiveModal] = useState<{
    receiptId: string;
    receiptNo: string;
    lines: Array<{ id: string; skuCode?: string; productName?: string; expectedQty: number; receivedQty: number; damagedQty: number }>;
    loading: boolean;
  } | null>(null);

  const applyWorkbench = useCallback((workbench: WarehouseWorkbench) => {
    const nextWorkbench = workbench || {};
    setData(nextWorkbench);
    setLoadedOnce(true);
    writePageCache(WAREHOUSE_WORKBENCH_CACHE_KEY, nextWorkbench);
  }, []);

  const loadData = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!erp) return;
    if (!options.silent) setLoading(true);
    try {
      applyWorkbench(await erp.warehouse.workbench({ limit: 200 }));
    } catch (error: any) {
      if (!options.silent) message.error(error?.message || "仓库中心读取失败");
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [applyWorkbench]);

  useEffect(() => {
    // 异步加载：缓存有就 silent，无 spinner / 不闪屏；缓存空才显示加载状态。
    void loadData({ silent: hasPageCache(cachedData) });
  }, [loadData, cachedData]);

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
          <Text type="secondary" style={{ fontSize: 12 }}>
            采购单：
            {row.poNo ? (
              <a
                className="erp-link"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard?.writeText(String(row.poNo)).catch(() => {});
                  navigate(`/purchase-center?focusPo=${encodeURIComponent(String(row.poNo))}`);
                }}
              >
                {row.poNo}
              </a>
            ) : (row.poId || "-")}
          </Text>
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
      align: "right",
      render: (_value, row) => (
        <Space direction="vertical" size={2} style={{ alignItems: "flex-end" }}>
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
      align: "right",
      render: (_value, row) => (
        <Space direction="vertical" size={2} style={{ alignItems: "flex-end" }}>
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
      render: (_value, row) => {
        const allowedStatuses = ["pending_arrival", "arrived", "counted"];
        if (!allowedStatuses.includes(row.status) || !canRole(role, ["warehouse", "manager", "admin"])) {
          return <Text type="secondary">无动作</Text>;
        }
        // 单按钮接力：不论当前在 pending_arrival / arrived / counted 哪一步，
        // 后端 register_arrival / confirm_count / create_batches 任意 action 都会
        // 自动接力到 inbounded_pending_qc 并建批次（缺数量按 PO 自动填）。
        // 选当前状态对应的合法 action 即可。
        const action = row.status === "pending_arrival"
          ? "register_arrival"
          : row.status === "arrived"
            ? "confirm_count"
            : "create_batches";
        const loading = actingKey === `inbound-${row.id}`;
        return (
          <Space size={6} wrap>
            <Button
              size="small"
              type="primary"
              icon={<InboxOutlined />}
              loading={loading}
              onClick={() => runAction(`inbound-${row.id}`, { action, receiptId: row.id }, "已入库，库存已更新")}
            >
              入库
            </Button>
            <Button
              size="small"
              loading={partialReceiveModal?.receiptId === row.id && partialReceiveModal.loading}
              onClick={async () => {
                // 拉这单的明细行，弹"按实数入库"Modal
                setPartialReceiveModal({ receiptId: row.id, receiptNo: row.receiptNo || row.id, lines: [], loading: true });
                try {
                  const result = await erp?.warehouse?.action({ action: "get_inbound_lines", receiptId: row.id });
                  const lines = (result?.result?.lines || []).map((l: any) => ({
                    id: String(l.id),
                    skuCode: l.internalSkuCode,
                    productName: l.productName,
                    expectedQty: Number(l.expectedQty || 0),
                    receivedQty: Number(l.receivedQty || 0) || Number(l.expectedQty || 0),
                    damagedQty: Number(l.damagedQty || 0),
                  }));
                  setPartialReceiveModal({ receiptId: row.id, receiptNo: row.receiptNo || row.id, lines, loading: false });
                } catch (e: any) {
                  message.error(e?.message || "拉取入库行失败");
                  setPartialReceiveModal(null);
                }
              }}
            >
              按实数入库
            </Button>
          </Space>
        );
      },
    },
  ], [actingKey, role, partialReceiveModal]);

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
      align: "right",
      render: (_value, row) => (
        <Space direction="vertical" size={2} style={{ alignItems: "flex-end" }}>
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
      align: "right",
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
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={() => loadData()}>
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
          size="small"
          className="erp-compact-table"
          columns={receiptColumns}
          dataSource={data.inboundReceipts || []}
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          rowClassName={(record) => (record.id === selectedReceiptId ? "ant-table-row-selected" : "")}
          onRow={(record) => ({
            onClick: () => setSelectedReceiptId((prev) => (prev === record.id ? null : record.id)),
            style: { cursor: "pointer" },
          })}
        />
        {selectedReceiptId ? (() => {
          const sel = (data.inboundReceipts || []).find((r) => r.id === selectedReceiptId);
          if (!sel) return null;
          const relatedBatches = (data.inventoryBatches || []).filter((b) => b.inboundReceiptId === selectedReceiptId);
          return (
            <div style={{ marginTop: 12, border: "1px solid #e5e9f0", borderRadius: 6, padding: 8, background: "#fafbfc" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px 8px" }}>
                <Text strong>入库单明细：{sel.receiptNo}</Text>
                <Button size="small" type="text" onClick={() => setSelectedReceiptId(null)}>收起 ✕</Button>
              </div>
              <Tabs
                size="small"
                items={[
                  {
                    key: "batches",
                    label: `库存批次 (${relatedBatches.length})`,
                    children: relatedBatches.length ? (
                      <Table
                        rowKey="id"
                        size="small"
                        className="erp-compact-table"
                        columns={batchColumns}
                        dataSource={relatedBatches}
                        pagination={false}
                        scroll={{ x: 980 }}
                      />
                    ) : <Text type="secondary">还没有批次（点「入库」按钮一键创建）</Text>,
                  },
                  {
                    key: "logistics",
                    label: "物流",
                    children: sel.logistics ? (
                      <Descriptions size="small" column={2}>
                        <Descriptions.Item label="物流公司">{sel.logistics.companyName || "-"}</Descriptions.Item>
                        <Descriptions.Item label="运单号">{sel.logistics.billNo || "-"}</Descriptions.Item>
                      </Descriptions>
                    ) : <Text type="secondary">无物流信息（卖家未发货 / 未同步 1688 物流）</Text>,
                  },
                  {
                    key: "meta",
                    label: "操作信息",
                    children: (
                      <Descriptions size="small" column={2}>
                        <Descriptions.Item label="入库单号">{sel.receiptNo}</Descriptions.Item>
                        <Descriptions.Item label="状态">{sel.status}</Descriptions.Item>
                        <Descriptions.Item label="采购单">{sel.poNo || sel.poId || "-"}</Descriptions.Item>
                        <Descriptions.Item label="供应商">{sel.supplierName || "-"}</Descriptions.Item>
                        <Descriptions.Item label="操作员">{sel.operatorName || "-"}</Descriptions.Item>
                        <Descriptions.Item label="到仓时间">{formatDateTime(sel.receivedAt)}</Descriptions.Item>
                        <Descriptions.Item label="期望数量">{formatQty(sel.expectedQty)}</Descriptions.Item>
                        <Descriptions.Item label="实收数量">{formatQty(sel.receivedQty)}</Descriptions.Item>
                        <Descriptions.Item label="破损">{formatQty(sel.damagedQty)}</Descriptions.Item>
                        <Descriptions.Item label="短少">{formatQty(sel.shortageQty)}</Descriptions.Item>
                      </Descriptions>
                    ),
                  },
                ]}
              />
            </div>
          );
        })() : null}
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
          size="small"
          className="erp-compact-table"
          columns={batchColumns}
          dataSource={data.inventoryBatches || []}
          scroll={{ x: 980 }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        />
      </div>

      <Modal
        open={!!partialReceiveModal}
        title={partialReceiveModal ? `按实数入库 · ${partialReceiveModal.receiptNo}` : "按实数入库"}
        okText="确认入库"
        cancelText="取消"
        width={760}
        confirmLoading={partialReceiveModal?.loading}
        onCancel={() => setPartialReceiveModal(null)}
        onOk={async () => {
          if (!partialReceiveModal) return;
          const linesPayload = partialReceiveModal.lines.map((l) => ({
            id: l.id,
            received_qty: l.receivedQty,
            damaged_qty: l.damagedQty,
          }));
          setPartialReceiveModal({ ...partialReceiveModal, loading: true });
          await runAction(
            `inbound-partial-${partialReceiveModal.receiptId}`,
            { action: "confirm_count", receiptId: partialReceiveModal.receiptId, lines: linesPayload },
            "已按实际数量入库",
          );
          setPartialReceiveModal(null);
        }}
        destroyOnClose
      >
        {partialReceiveModal ? (
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              系统会按你填的"实收"建库存批次。短少 / 多到自动算（实收 vs 期望差），破损独立填，
              系统不算可用库存。
            </Text>
            <Table
              rowKey="id"
              size="small"
              className="erp-compact-table"
              pagination={false}
              dataSource={partialReceiveModal.lines}
              columns={[
                { title: "SKU", dataIndex: "skuCode", width: 120 },
                { title: "商品", dataIndex: "productName", ellipsis: true },
                { title: "期望", dataIndex: "expectedQty", width: 70, align: "right" },
                {
                  title: "实收",
                  width: 110,
                  align: "right",
                  render: (_v, r: any) => (
                    <InputNumber
                      size="small"
                      min={0}
                      value={r.receivedQty}
                      onChange={(v) => setPartialReceiveModal({
                        ...partialReceiveModal,
                        lines: partialReceiveModal.lines.map((l) => l.id === r.id ? { ...l, receivedQty: Number(v || 0) } : l),
                      })}
                    />
                  ),
                },
                {
                  title: "破损",
                  width: 90,
                  align: "right",
                  render: (_v, r: any) => (
                    <InputNumber
                      size="small"
                      min={0}
                      value={r.damagedQty}
                      onChange={(v) => setPartialReceiveModal({
                        ...partialReceiveModal,
                        lines: partialReceiveModal.lines.map((l) => l.id === r.id ? { ...l, damagedQty: Number(v || 0) } : l),
                      })}
                    />
                  ),
                },
                {
                  title: "差异",
                  width: 110,
                  render: (_v, r: any) => {
                    const diff = (r.receivedQty || 0) - (r.expectedQty || 0);
                    if (diff > 0) return <Text style={{ color: "#1677ff" }}>多到 +{diff}</Text>;
                    if (diff < 0) return <Text type="warning">短少 {-diff}</Text>;
                    return <Text type="secondary">符合</Text>;
                  },
                },
              ]}
            />
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
