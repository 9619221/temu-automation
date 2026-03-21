import { useState, useEffect } from "react";
import { Table, Button, Space, Tag, Input, Card, Result, message, notification, Image } from "antd";
import { SyncOutlined, SearchOutlined, ExportOutlined, ShopOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import type { ColumnsType } from "antd/es/table";

interface Product {
  id: number;
  title: string;
  category: string;
  spuId: string;
  skcId: string;
  skuId: string;
  sku: string;
  attributes: string;
  imageUrl?: string;
  price: string;
  spec: string;
  productCode: string;
  status: string;
  salesInfo: string;
  todaySales: string;
  sales7d: string;
  createdAt: string;
  syncedAt?: string;
}

export default function ProductList() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);
  const navigate = useNavigate();

  const api = window.electronAPI?.automation;
  const store = window.electronAPI?.store;

  useEffect(() => {
    // 检查是否有绑定的店铺
    store?.get("temu_accounts").then((data: any[] | null) => {
      if (data && Array.isArray(data) && data.length > 0) {
        setHasAccount(true);
        // 有店铺才加载商品数据
        store?.get("temu_products").then((products: Product[] | null) => {
          if (products && Array.isArray(products) && products.length > 0) {
            setProducts(products);
          }
        });
      } else {
        setHasAccount(false);
      }
    });
  }, []);

  const columns: ColumnsType<Product> = [
    {
      title: "商品图片",
      dataIndex: "imageUrl",
      key: "imageUrl",
      width: 70,
      render: (url: string) =>
        url ? (
          <Image src={url} width={50} height={50} style={{ objectFit: "cover", borderRadius: 4 }} fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==" />
        ) : (
          <div style={{ width: 50, height: 50, background: "#f0f0f0", borderRadius: 4 }} />
        ),
    },
    {
      title: "商品名称",
      dataIndex: "title",
      key: "title",
      width: 260,
      ellipsis: true,
      fixed: "left",
      render: (text: string, record: Product) => (
        <div>
          <div style={{ fontWeight: 500, marginBottom: 2 }}>{text || "-"}</div>
          {record.category && (
            <div style={{ fontSize: 11, color: "#999" }}>类目：{record.category}</div>
          )}
        </div>
      ),
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
      title: "SKU货号",
      dataIndex: "sku",
      key: "sku",
      width: 110,
      render: (text: string) => <span style={{ fontSize: 12 }}>{text || "-"}</span>,
    },
    {
      title: "价格",
      dataIndex: "price",
      key: "price",
      width: 90,
      render: (text: string) => <span style={{ color: "#fa541c", fontWeight: 500 }}>{text || "-"}</span>,
    },
    {
      title: "商品规格",
      dataIndex: "spec",
      key: "spec",
      width: 160,
      ellipsis: true,
      render: (text: string) => <span style={{ fontSize: 12 }}>{text || "-"}</span>,
    },
    {
      title: "商品属性",
      dataIndex: "attributes",
      key: "attributes",
      width: 200,
      ellipsis: true,
      render: (text: string) => <span style={{ fontSize: 12, color: "#666" }}>{text || "-"}</span>,
    },
    {
      title: "商品编码",
      dataIndex: "productCode",
      key: "productCode",
      width: 110,
      render: (text: string) => <span style={{ fontSize: 12 }}>{text || "-"}</span>,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (status: string) => {
        if (!status) return <span style={{ color: "#999" }}>-</span>;
        const colorMap: Record<string, string> = {
          "在售": "green", "已上架": "green", "已生效": "green",
          "待生效": "orange", "审核中": "orange", "待审核": "orange",
          "已下架": "default", "已驳回": "red", "已停售": "red", "缺货": "red",
        };
        return <Tag color={colorMap[status] || "default"}>{status}</Tag>;
      },
    },
    {
      title: "销售信息",
      dataIndex: "salesInfo",
      key: "salesInfo",
      width: 100,
      render: (text: string) => <span style={{ fontSize: 12 }}>{text || "-"}</span>,
    },
    {
      title: "今日销量",
      dataIndex: "todaySales",
      key: "todaySales",
      width: 90,
      render: (text: string) => <span style={{ fontSize: 12 }}>{text || "-"}</span>,
    },
    {
      title: "7天销量",
      dataIndex: "sales7d",
      key: "sales7d",
      width: 90,
      render: (text: string) => <span style={{ fontSize: 12 }}>{text || "-"}</span>,
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 160,
      render: (text: string) => <span style={{ fontSize: 12 }}>{text || "-"}</span>,
    },
  ];

  const handleSync = async () => {
    if (!api) {
      message.warning("自动化模块未连接（请在 Electron 环境中运行）");
      return;
    }

    setLoading(true);
    notification.info({
      key: "sync-products",
      message: "正在同步商品",
      description: "正在从 Temu Seller Central 抓取商品数据，可能需要几分钟...",
      duration: 0,
    });

    try {
      const result = await api.scrapeProducts();
      const now = new Date().toLocaleString();
      const scraped = (result.products || []).map((p: any, i: number) => ({
        id: i + 1,
        title: p.title || "",
        category: p.category || "",
        spuId: p.spuId || "",
        skcId: p.skcId || "",
        skuId: p.skuId || "",
        sku: p.sku || "",
        attributes: p.attributes || "",
        imageUrl: p.imageUrl || "",
        price: p.price || "",
        spec: p.spec || "",
        productCode: p.productCode || "",
        status: p.status || "",
        salesInfo: p.salesInfo || "",
        todaySales: p.todaySales || "",
        sales7d: p.sales7d || "",
        createdAt: p.createdAt || "",
        syncedAt: now,
      }));

      setProducts(scraped);
      store?.set("temu_products", scraped);
      notification.success({
        key: "sync-products",
        message: "同步完成",
        description: `成功同步 ${scraped.length} 件商品`,
      });
    } catch (error: any) {
      notification.error({
        key: "sync-products",
        message: "同步失败",
        description: error?.message || "请确保已登录 Temu 卖家后台",
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter((p) => {
    if (!searchText) return true;
    const s = searchText.toLowerCase();
    return (
      p.title.toLowerCase().includes(s) ||
      p.spuId.includes(searchText) ||
      p.skcId.includes(searchText) ||
      (p.skuId || "").includes(searchText) ||
      (p.sku || "").toLowerCase().includes(s)
    );
  });

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
      {products.length > 0 && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <span>总商品数：<strong style={{ color: "#1890ff", fontSize: 18 }}>{products.length}</strong></span>
        </Card>
      )}

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
            同步商品
          </Button>
          <Button icon={<ExportOutlined />} disabled={products.length === 0}>
            导出
          </Button>
          {filteredProducts.length > 0 && filteredProducts.length !== products.length && (
            <span style={{ color: "#999", fontSize: 13 }}>
              显示 {filteredProducts.length} / {products.length} 件商品
            </span>
          )}
        </Space>
      </Card>

      <Table
        columns={columns}
        dataSource={filteredProducts}
        rowKey="id"
        loading={loading}
        pagination={{
          pageSize: 20,
          showTotal: (total) => `共 ${total} 件商品`,
          showSizeChanger: true,
          pageSizeOptions: ["20", "50", "100"],
        }}
        locale={{ emptyText: "暂无商品数据，请先登录账号后点击「同步商品」" }}
        scroll={{ x: 2000 }}
        size="small"
      />
    </div>
  );
}
