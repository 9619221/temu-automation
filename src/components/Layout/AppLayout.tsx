import { useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Layout, Menu, Typography, Tag, Space, Progress } from "antd";
import {
  DashboardOutlined,
  UserOutlined,
  ShoppingOutlined,
  ScheduleOutlined,
  SettingOutlined,
  RocketOutlined,
  SyncOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  PlusCircleOutlined,
} from "@ant-design/icons";
import { useCollection, COLLECT_TASKS } from "../../contexts/CollectionContext";

const { Sider, Content, Header } = Layout;
const { Text } = Typography;

const menuItems = [
  { key: "/shop", icon: <DashboardOutlined />, label: "店铺概览" },
  { key: "/products", icon: <ShoppingOutlined />, label: "商品管理" },
  { key: "/create-product", icon: <PlusCircleOutlined />, label: "上品管理" },
  { key: "/collect", icon: <SyncOutlined />, label: "数据采集" },
  { key: "/accounts", icon: <UserOutlined />, label: "账号管理" },
  { key: "/tasks", icon: <ScheduleOutlined />, label: "任务管理" },
  { key: "/settings", icon: <SettingOutlined />, label: "设置" },
];

function findMenuLabel(items: any[], pathname: string): string {
  for (const item of items) {
    if (item.key === pathname) return item.label;
  }
  return "";
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { collecting, progress, successCount, errorCount, elapsed } = useCollection();

  let pageTitle = findMenuLabel(menuItems, location.pathname) || "";
  if (location.pathname.startsWith("/products/") && location.pathname !== "/products") {
    pageTitle = "商品详情";
  }
  if (!pageTitle) pageTitle = "店铺概览";

  let selectedKey = location.pathname;
  if (location.pathname.startsWith("/products/")) selectedKey = "/products";
  else if (location.pathname === "/dashboard") selectedKey = "/shop";

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {/* Sidebar */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="light"
        width={220}
        style={{
          borderRight: "none",
          boxShadow: "2px 0 12px rgba(0,0,0,0.04)",
          background: "#fff",
          zIndex: 10,
        }}
      >
        {/* Logo */}
        <div
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            padding: collapsed ? 0 : "0 20px",
            borderBottom: "1px solid #f5f5f5",
          }}
        >
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #e55b00, #ff8534)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <RocketOutlined style={{ fontSize: 18, color: "#fff" }} />
          </div>
          {!collapsed && (
            <span style={{
              marginLeft: 12, fontSize: 16, fontWeight: 700,
              background: "linear-gradient(135deg, #e55b00, #ff8534)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              whiteSpace: "nowrap",
            }}>
              Temu 运营助手
            </span>
          )}
        </div>

        {/* Menu */}
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ border: 0, marginTop: 8 }}
        />
      </Sider>

      <Layout style={{ background: "#f0f2f5" }}>
        {/* Header */}
        <Header
          style={{
            background: "#fff",
            padding: "0 28px",
            borderBottom: "1px solid #f0f0f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 64,
            boxShadow: "0 1px 4px rgba(0,0,0,0.03)",
            zIndex: 5,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: 600, color: "#1a1a2e" }}>
            {pageTitle}
          </Text>

          {/* 采集状态指示器 */}
          {collecting ? (
            <div
              onClick={() => navigate("/collect")}
              style={{
                cursor: "pointer",
                display: "flex", alignItems: "center", gap: 10,
                padding: "6px 16px",
                background: "linear-gradient(135deg, #fff7f0, #fff2e8)",
                borderRadius: 20,
                border: "1px solid #ffd8bf",
                transition: "all 0.2s",
              }}
            >
              <LoadingOutlined spin style={{ color: "#e55b00", fontSize: 14 }} />
              <Progress
                percent={progress} size="small"
                style={{ width: 80, margin: 0 }}
                strokeColor={{ "0%": "#e55b00", "100%": "#00b96b" }}
                format={() => `${successCount}/${COLLECT_TASKS.length}`}
              />
              <Text style={{ fontSize: 12, color: "#e55b00", fontWeight: 500 }}>
                {formatTime(elapsed)}
              </Text>
            </div>
          ) : progress === 100 ? (
            <Tag
              icon={<CheckCircleOutlined />}
              color="success"
              style={{ cursor: "pointer", borderRadius: 12, padding: "2px 12px" }}
              onClick={() => navigate("/collect")}
            >
              采集完成 {successCount}✓{errorCount > 0 ? ` ${errorCount}✗` : ""}
            </Tag>
          ) : (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              color: "#bfbfbf", fontSize: 13,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: 3, background: "#d9d9d9" }} />
              就绪
            </div>
          )}
        </Header>

        {/* Content */}
        <Content
          style={{
            margin: 20,
            padding: 0,
            overflow: "auto",
            minHeight: 280,
          }}
        >
          <div style={{
            background: "#fff",
            borderRadius: 12,
            padding: 24,
            minHeight: "calc(100vh - 124px)",
            boxShadow: "0 1px 6px rgba(0,0,0,0.03)",
          }}>
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
