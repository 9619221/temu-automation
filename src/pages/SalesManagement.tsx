import { useState, useEffect } from "react";
import { Table, Button, Space, Card, Row, Col, Statistic, notification, Tag, Input, Spin, Result } from "antd";
import { SyncOutlined, SearchOutlined, DollarOutlined, ShoppingCartOutlined, RiseOutlined, BarChartOutlined, ShopOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import type { ColumnsType } from "antd/es/table";

interface SalesItem {
  key: number;
  title: string;
  spuId: string;
  skcId: string;
  skuId: string;
  price: string;
  stock: string;
  warehouse: string;
  stockStatus: string;
  nums: number[];
  [key: string]: any;
}

interface SalesSummary {
  [key: string]: string;
}

interface SalesData {
  summary: SalesSummary;
  items: any[];
}

export default function SalesManagement() {
  const [salesData, setSalesData] = useState<SalesData | null>(null);
  const [items, setItems] = useState<SalesItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);

  const navigate = useNavigate();
  const api = window.electronAPI?.automation;
  const store = window.electronAPI?.store;

  // 启动时从文件恢复
  useEffect(() => {
    store?.get("temu_accounts").then((accounts: any) => {
      if (!accounts || (Array.isArray(accounts) && accounts.length === 0)) {
        setHasAccount(false);
      } else {
        setHasAccount(true);
      }
    });
    store?.get("temu_sales").then((data: any) => {
      if (data) {
        setSalesData(data.raw || null);
        setItems(data.items || []);
      }
    });
  }, []);

  const columns: ColumnsType<SalesItem> = [
    {
      title: "商品名称",
      dataIndex: "title",
      key: "title",
      width: 280,
      ellipsis: true,
      fixed: "left",
      render: (text: string) => <span style={{ fontWeight: 500 }}>{text || "-"}</span>,
    },
    {
      title: "SPU ID",
      dataIndex: "spuId",
      key: "spuId",
      width: 120,
      render: (text: string) => <span style={{ fontSize: 12, fontFamily: "monospace" }}>{text || "-"}</span>,
    },
    {
      title: "SKC ID",
      dataIndex: "skcId",
      key: "skcId",
      width: 120,
      render: (text: string) => <span style={{ fontSize: 12, fontFamily: "monospace" }}>{text || "-"}</span>,
    },
    {
      title: "SKU ID",
      dataIndex: "skuId",
      key: "skuId",
      width: 120,
      render: (text: string) => <span style={{ fontSize: 12, fontFamily: "monospace" }}>{text || "-"}</span>,
    },
    {
      title: "价格",
      dataIndex: "price",
      key: "price",
      width: 90,
      render: (text: string) => <span style={{ color: "#fa541c", fontWeight: 500 }}>{text || "-"}</span>,
    },
    {
      title: "库存",
      dataIndex: "stock",
      key: "stock",
      width: 80,
      render: (text: string) => {
        if (!text || text === "-") return <span style={{ color: "#999" }}>-</span>;
        return <span style={{ color: "#1890ff", fontWeight: 500 }}>{text}</span>;
      },
    },
    {
      title: "仓组",
      dataIndex: "warehouse",
      key: "warehouse",
      width: 110,
      render: (text: string) => <span style={{ fontSize: 12 }}>{text || "-"}</span>,
    },
    {
      title: "备货状态",
      dataIndex: "stockStatus",
      key: "stockStatus",
      width: 100,
      render: (status: string) => {
        if (!status) return "-";
        const colorMap: Record<string, string> = {
          "已生效": "green",
          "国内备货": "blue",
          "待生效": "orange",
          "已停售": "red",
          "缺货中": "red",
          "备货中": "processing",
        };
        return <Tag color={colorMap[status] || "default"}>{status}</Tag>;
      },
    },
    {
      title: "销量数据",
      dataIndex: "nums",
      key: "nums",
      width: 200,
      render: (nums: number[]) => {
        if (!nums || nums.length === 0) return "-";
        const total = nums.reduce((a, b) => a + b, 0);
        return (
          <span style={{ fontSize: 12, color: total > 0 ? "#52c41a" : "#999" }}>
            {nums.slice(0, 6).join(" / ")}
            {nums.length > 6 ? " ..." : ""}
          </span>
        );
      },
    },
  ];

  const handleSync = async () => {
    if (!api) {
      notification.warning({ message: "自动化模块未连接", description: "请在 Electron 环境中运行" });
      return;
    }

    setLoading(true);
    notification.info({
      key: "sync-sales",
      message: "正在同步销售数据",
      description: "正在从 Temu Seller Central 抓取销售管理数据，可能需要几分钟...",
      duration: 0,
    });

    try {
      const result = await api.scrapeSales();
      const data = result.sales;
      setSalesData(data);

      // 解析 items 为结构化数据
      const parsed: SalesItem[] = (data.items || []).map((item: any, idx: number) => ({
        key: idx + 1,
        title: item._title || "",
        spuId: item._spuId || "",
        skcId: item._skcId || "",
        skuId: item._skuId || "",
        price: item._price || "",
        stock: item._stock || "-",
        warehouse: item._warehouse || "",
        stockStatus: item._stockStatus || "",
        nums: item._nums || [],
      }));

      setItems(parsed);

      // 持久化
      store?.set("temu_sales", { raw: data, items: parsed, syncedAt: new Date().toLocaleString() });

      notification.success({
        key: "sync-sales",
        message: "同步完成",
        description: `获取到 ${parsed.length} 条销售数据，${Object.keys(data.summary || {}).length} 项汇总指标`,
      });
    } catch (error: any) {
      notification.error({
        key: "sync-sales",
        message: "同步失败",
        description: error?.message || "请确保已登录 Temu 卖家后台",
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = items.filter((item) => {
    if (!searchText) return true;
    const s = searchText.toLowerCase();
    return (
      item.title.toLowerCase().includes(s) ||
      item.spuId.includes(s) ||
      item.skcId.includes(s) ||
      item.skuId.includes(s)
    );
  });

  const summary = salesData?.summary || {};

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
      {/* 汇总指标卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {Object.entries(summary).map(([key, val]) => (
          <Col span={4} key={key}>
            <Card size="small">
              <Statistic
                title={key}
                value={val || 0}
                valueStyle={{ color: parseInt(val) > 0 ? "#fa541c" : "#999", fontSize: 20 }}
              />
            </Card>
          </Col>
        ))}
        {Object.keys(summary).length === 0 && (
          <>
            <Col span={6}>
              <Card size="small">
                <Statistic title="商品总数" value={items.length || 0} prefix={<ShoppingCartOutlined />} valueStyle={{ color: "#1890ff" }} />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Statistic title="有库存" value={items.filter(i => i.stock && i.stock !== "-").length || 0} prefix={<BarChartOutlined />} valueStyle={{ color: "#52c41a" }} />
              </Card>
            </Col>
          </>
        )}
      </Row>

      {/* 工具栏 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            placeholder="搜索商品名称/SPU/SKC/SKU"
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 300 }}
            allowClear
          />
          <Button
            type="primary"
            icon={<SyncOutlined spin={loading} />}
            onClick={handleSync}
            loading={loading}
          >
            同步销售数据
          </Button>
          {items.length > 0 && (
            <span style={{ color: "#999", fontSize: 13 }}>
              共 {items.length} 条数据
            </span>
          )}
        </Space>
      </Card>

      {/* 数据表格 */}
      <Table
        columns={columns}
        dataSource={filteredItems}
        rowKey="key"
        loading={loading}
        pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条`, showSizeChanger: true, pageSizeOptions: ["20", "50", "100"] }}
        locale={{ emptyText: "暂无销售数据，请先登录后点击「同步销售数据」" }}
        scroll={{ x: 1400 }}
        size="small"
      />
    </div>
  );
}
