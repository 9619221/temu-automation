import { useState, useEffect } from "react";
import { Table, Button, Tag, Space, DatePicker, Card, message, notification, Result } from "antd";
import { SyncOutlined, ExportOutlined, ShopOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import type { ColumnsType } from "antd/es/table";

const { RangePicker } = DatePicker;

interface Order {
  id: number;
  orderId: string;
  productTitle: string;
  quantity: number;
  amount: number;
  status: string;
  orderTime: string;
  syncedAt?: string;
}

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: "orange", text: "待处理" },
  "待处理": { color: "orange", text: "待处理" },
  shipped: { color: "blue", text: "已发货" },
  "已发货": { color: "blue", text: "已发货" },
  delivered: { color: "green", text: "已完成" },
  "已完成": { color: "green", text: "已完成" },
  cancelled: { color: "red", text: "已取消" },
  "已取消": { color: "red", text: "已取消" },
  refund: { color: "purple", text: "退款" },
  "退款": { color: "purple", text: "退款" },
};

export default function OrderList() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);

  const navigate = useNavigate();
  const api = window.electronAPI?.automation;
  const store = window.electronAPI?.store;

  useEffect(() => {
    store?.get("temu_accounts").then((accounts: any) => {
      if (!accounts || (Array.isArray(accounts) && accounts.length === 0)) {
        setHasAccount(false);
      } else {
        setHasAccount(true);
      }
    });
  }, []);

  const columns: ColumnsType<Order> = [
    { title: "订单号", dataIndex: "orderId", key: "orderId", width: 180 },
    { title: "商品", dataIndex: "productTitle", key: "productTitle", width: 250, ellipsis: true },
    { title: "数量", dataIndex: "quantity", key: "quantity", width: 80 },
    {
      title: "金额",
      dataIndex: "amount",
      key: "amount",
      width: 100,
      render: (v: number) => `$${v.toFixed(2)}`,
      sorter: (a, b) => a.amount - b.amount,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => {
        const s = statusMap[status] || { color: "default", text: status };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    { title: "下单时间", dataIndex: "orderTime", key: "orderTime", width: 160 },
  ];

  const handleSync = async () => {
    if (!api) {
      message.warning("自动化模块未连接（请在 Electron 环境中运行）");
      return;
    }

    setLoading(true);
    notification.info({
      key: "sync-orders",
      message: "正在同步订单",
      description: "正在从 Temu 卖家后台抓取订单数据...",
      duration: 0,
    });

    try {
      const result = await api.scrapeOrders();
      const now = new Date().toLocaleString();
      const scraped = (result.orders || []).map((o, i) => ({
        id: i + 1,
        orderId: o.orderId,
        productTitle: o.productTitle,
        quantity: o.quantity,
        amount: o.amount,
        status: o.status,
        orderTime: o.orderTime,
        syncedAt: now,
      }));

      setOrders(scraped);
      notification.success({
        key: "sync-orders",
        message: "同步完成",
        description: `成功同步 ${scraped.length} 个订单`,
      });
    } catch (error: any) {
      notification.error({
        key: "sync-orders",
        message: "同步失败",
        description: error?.message || "请确保已登录 Temu 卖家后台",
      });
    } finally {
      setLoading(false);
    }
  };

  if (hasAccount === false) {
    return (
      <Result
        icon={<ShopOutlined style={{ color: "#fa8c16" }} />}
        title="请先绑定店铺"
        subTitle="绑定 Temu 店铺账号后，即可同步商品数据"
        extra={
          <Button type="primary" onClick={() => navigate("/accounts")}>
            前往绑定店铺
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <RangePicker />
          <Button
            type="primary"
            icon={<SyncOutlined spin={loading} />}
            loading={loading}
            onClick={handleSync}
          >
            同步订单
          </Button>
          <Button icon={<ExportOutlined />} disabled={orders.length === 0}>
            导出
          </Button>
        </Space>
      </Card>
      <Table
        columns={columns}
        dataSource={orders}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 个订单` }}
        locale={{ emptyText: "暂无订单数据，请先登录账号后点击「同步订单」" }}
      />
    </div>
  );
}
