import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Layout, Menu, Typography, Tag, Space, Progress, Badge, Button } from "antd";
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
  PictureOutlined,
  FileTextOutlined,
  BellOutlined,
} from "@ant-design/icons";
import { useCollection, COLLECT_TASKS } from "../../contexts/CollectionContext";
import { ACTIVE_ACCOUNT_CHANGED_EVENT, readActiveAccountId } from "../../utils/multiStore";

const { Sider, Content, Header } = Layout;
const { Text } = Typography;

const menuItems = [
  {
    type: "group" as const,
    label: "运营",
    children: [
      { key: "/shop", icon: <DashboardOutlined />, label: "店铺概览" },
      { key: "/products", icon: <ShoppingOutlined />, label: "商品管理" },
    ],
  },
  {
    type: "group" as const,
    label: "工具",
    children: [
      { key: "/create-product", icon: <PlusCircleOutlined />, label: "上品管理" },
      { key: "/image-studio", icon: <PictureOutlined />, label: "AI 出图" },
    ],
  },
  {
    type: "group" as const,
    label: "系统",
    children: [
      { key: "/collect", icon: <SyncOutlined />, label: "数据采集" },
      { key: "/accounts", icon: <UserOutlined />, label: "账号管理" },
      { key: "/tasks", icon: <ScheduleOutlined />, label: "任务管理" },
    ],
  },
  {
    type: "group" as const,
    label: "其他",
    children: [
      { key: "/logs", icon: <FileTextOutlined />, label: "日志中心" },
      { key: "/settings", icon: <SettingOutlined />, label: "设置" },
    ],
  },
];

function findMenuLabel(items: any[], pathname: string): string {
  for (const item of items) {
    if (Array.isArray(item.children)) {
      const label = findMenuLabel(item.children, pathname);
      if (label) return label;
    }
    if (item.key === pathname) return item.label;
  }
  return "";
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [activeAccountName, setActiveAccountName] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const { collecting, progress, successCount, errorCount, elapsed } = useCollection();
  const completedCount = successCount + errorCount;

  let pageTitle = findMenuLabel(menuItems, location.pathname) || "";
  if (location.pathname.startsWith("/products/") && location.pathname !== "/products") {
    pageTitle = "商品详情";
  }
  if (location.pathname === "/image-studio") {
    pageTitle = "AI 商品图工作台";
  }
  if (!pageTitle) pageTitle = "店铺概览";

  let selectedKey = location.pathname;
  if (location.pathname.startsWith("/products/")) selectedKey = "/products";
  else if (location.pathname === "/dashboard") selectedKey = "/shop";

  const sidebarStatus = collecting
    ? {
        label: "采集中",
        description: `${completedCount}/${COLLECT_TASKS.length} 已完成`,
        tone: "processing" as const,
      }
    : progress === 100
      ? {
          label: errorCount > 0 ? "采集完成，部分失败" : "采集完成",
          description: `${successCount} 成功${errorCount > 0 ? `，${errorCount} 失败` : ""}`,
          tone: errorCount > 0 ? "warning" as const : "success" as const,
        }
      : {
          label: "等待开始",
          description: "进入数据采集页后可执行 65 项任务",
          tone: "default" as const,
        };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
  };

  useEffect(() => {
    const store = window.electronAPI?.store;
    if (!store) return;

    let cancelled = false;

    const loadActiveAccount = async () => {
      const [accounts, activeAccountId] = await Promise.all([
        store.get("temu_accounts"),
        readActiveAccountId(store),
      ]);
      if (cancelled) return;

      if (!Array.isArray(accounts) || !activeAccountId) {
        setActiveAccountName("");
        return;
      }

      const activeAccount = accounts.find((account: { id?: string; name?: string }) => account?.id === activeAccountId);
      setActiveAccountName(typeof activeAccount?.name === "string" ? activeAccount.name : "");
    };

    loadActiveAccount().catch(() => {
      if (!cancelled) setActiveAccountName("");
    });

    const handleActiveAccountChanged = () => {
      loadActiveAccount().catch(() => {
        if (!cancelled) setActiveAccountName("");
      });
    };

    window.addEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged as EventListener);
    };
  }, []);

  return (
    <Layout style={{ minHeight: "100vh" }} className="app-layout-root">
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
        <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <div
            style={{
              height: 64,
              display: "flex",
              alignItems: "center",
              justifyContent: collapsed ? "center" : "flex-start",
              padding: collapsed ? 0 : "0 20px",
              borderBottom: "1px solid #f5f5f5",
              flexShrink: 0,
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

          <div style={{ flex: 1, overflow: "auto", paddingTop: 8 }}>
            <Menu
              mode="inline"
              selectedKeys={[selectedKey]}
              items={menuItems}
              onClick={({ key }) => navigate(key)}
              style={{ border: 0 }}
            />
          </div>

          <div
            style={{
              padding: collapsed ? "12px 10px" : "14px 14px 16px",
              borderTop: "1px solid #f3f4f6",
              background: "#fff",
              flexShrink: 0,
            }}
          >
            {collapsed ? (
              <div
                onClick={() => navigate("/collect")}
                style={{
                  cursor: "pointer",
                  height: 42,
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: collecting ? "#fff7f0" : "#f7f8fa",
                  color: collecting ? "#e55b00" : "#8c8c8c",
                }}
              >
                {collecting ? <LoadingOutlined spin /> : <SyncOutlined />}
              </div>
            ) : (
              <div
                className="app-surface"
                onClick={() => navigate("/collect")}
                style={{
                  cursor: "pointer",
                  padding: 12,
                  background: collecting ? "#fffaf5" : "#fff",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a2e" }}>{sidebarStatus.label}</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: "#8c8c8c" }}>{sidebarStatus.description}</div>
                  </div>
                  <Tag
                    color={sidebarStatus.tone === "success" ? "success" : sidebarStatus.tone === "warning" ? "warning" : sidebarStatus.tone === "processing" ? "processing" : "default"}
                    style={{ margin: 0, borderRadius: 999 }}
                  >
                    {collecting ? formatTime(elapsed) : progress === 100 ? "完成" : "就绪"}
                  </Tag>
                </div>
                <Progress
                  percent={progress}
                  size="small"
                  showInfo={false}
                  strokeColor={{ "0%": "#e55b00", "100%": "#00b96b" }}
                  style={{ marginTop: 10 }}
                />
              </div>
            )}
          </div>
        </div>
      </Sider>

      <Layout style={{ background: "linear-gradient(180deg, #f8f9fc 0%, #f4f6fa 100%)" }}>
        {/* Header */}
        <Header
          className="app-layout-header"
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

          <Space size={12}>
            <Badge count={errorCount > 0 ? errorCount : 0} size="small" offset={[-2, 2]}>
              <Button
                icon={<BellOutlined />}
                onClick={() => navigate("/collect")}
                style={{ borderRadius: 10 }}
              />
            </Badge>

            <Tag
              color={activeAccountName ? "blue" : "default"}
              icon={<UserOutlined />}
              style={{ borderRadius: 12, padding: "4px 12px", marginInlineEnd: 0 }}
            >
              {activeAccountName || "未选择账号"}
            </Tag>

            <Button
              icon={<SettingOutlined />}
              onClick={() => navigate("/settings")}
              style={{ borderRadius: 10 }}
            />
          </Space>
        </Header>

        {/* Content */}
        <Content
          className="app-layout-content"
          style={{
            margin: 20,
            padding: 0,
            overflow: "auto",
            minHeight: 280,
          }}
        >
          <div className="app-workspace-shell">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
