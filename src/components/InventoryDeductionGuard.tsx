import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Modal, Button, Table, Tag, Space } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useErpAuth } from "../contexts/ErpAuthContext";

const erp = window.electronAPI?.erp;

interface UndeductedItem {
  mall_id: string;
  so_id: string;
  product_name: string;
  sku_ext_codes: string;
  demand_qty: number;
  delivered_qty: number;
  temu_status: string;
  deliver_time: string;
  order_time: string;
  store_name: string;
  overdue: boolean;
}

interface DeductionGuardState {
  total: number;
  overdueCount: number;
  items: UndeductedItem[];
  refresh: () => void;
}

const DeductionGuardContext = createContext<DeductionGuardState>({
  total: 0,
  overdueCount: 0,
  items: [],
  refresh: () => {},
});

export function useDeductionGuard() {
  return useContext(DeductionGuardContext);
}

const POLL_INTERVAL = 5 * 60 * 1000;

const columns = [
  {
    title: "店铺",
    dataIndex: "store_name",
    width: 120,
    render: (v: string) => v || "-",
  },
  {
    title: "备货单号",
    dataIndex: "so_id",
    width: 160,
  },
  {
    title: "商品",
    dataIndex: "product_name",
    width: 180,
    ellipsis: true,
  },
  {
    title: "货号",
    dataIndex: "sku_ext_codes",
    width: 120,
    ellipsis: true,
  },
  {
    title: "备货数",
    dataIndex: "demand_qty",
    width: 80,
    align: "right" as const,
  },
  {
    title: "发货时间",
    dataIndex: "deliver_time",
    width: 160,
  },
  {
    title: "状态",
    key: "status",
    width: 100,
    render: (_: unknown, row: UndeductedItem) =>
      row.overdue ? <Tag color="red">超 3 天</Tag> : <Tag color="orange">待处理</Tag>,
  },
];

export function InventoryDeductionGuard({ children }: { children: ReactNode }) {
  const { currentUser } = useErpAuth();
  const [total, setTotal] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [items, setItems] = useState<UndeductedItem[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();

  const fetchUndeducted = useCallback(async () => {
    if (!erp?.inventory?.action) return;
    try {
      const r = await erp.inventory.action({ action: "get_undeducted_consigns" });
      setTotal(r.total ?? 0);
      setOverdueCount(r.overdueCount ?? 0);
      setItems(r.items ?? []);
    } catch {
      // 旧版后端无此 action，静默忽略
    }
  }, []);

  const isOperations = currentUser?.role === "operations";

  useEffect(() => {
    if (!currentUser || !isOperations) return;
    fetchUndeducted();
    timerRef.current = setInterval(fetchUndeducted, POLL_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentUser, isOperations, fetchUndeducted]);

  const showBlockingModal = false;

  const value = useMemo(
    () => ({ total, overdueCount, items, refresh: fetchUndeducted }),
    [total, overdueCount, items, fetchUndeducted],
  );

  return (
    <DeductionGuardContext.Provider value={value}>
      {children}
      <Modal
        open={showBlockingModal}
        closable={false}
        maskClosable={false}
        keyboard={false}
        footer={null}
        width={1100}
        styles={{ body: { padding: "24px 24px 16px" } }}
        title={
          <Space>
            <ExclamationCircleOutlined style={{ color: "#ff4d4f", fontSize: 20 }} />
            <span>{overdueCount} 笔已收货备货单超过 3 天未扣库存</span>
          </Space>
        }
      >
        <p style={{ marginBottom: 16, color: "#666" }}>
          以下备货单线上已收货，但本地库存尚未扣减且已超过 3 天。请前往出库中心逐单确认发货或忽略。
        </p>
        <Table
          dataSource={items.filter((i) => i.overdue)}
          columns={columns}
          rowKey={(r) => `${r.mall_id}_${r.so_id}`}
          size="small"
          pagination={{ pageSize: 20, size: "small", showTotal: (t) => `共 ${t} 条` }}
          scroll={{ y: 420 }}
          style={{ marginBottom: 20 }}
        />
        <div style={{ textAlign: "right" }}>
          <Button
            type="primary"
            danger
            size="large"
            onClick={() => {
              window.sessionStorage.setItem("temu.qc-outbound.onlineStatus", JSON.stringify("已收货"));
              window.sessionStorage.setItem("temu.qc-outbound.status", JSON.stringify([]));
              window.sessionStorage.setItem("temu.qc-outbound.page", JSON.stringify(1));
              navigate("/qc-outbound");
            }}
          >
            前往出库中心处理
          </Button>
        </div>
      </Modal>
    </DeductionGuardContext.Provider>
  );
}
