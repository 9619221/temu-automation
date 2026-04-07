import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Layout, Menu, Typography, Tag, Space, Badge, Button, Dropdown, List } from "antd";
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
  ArrowRightOutlined,
  CloseCircleOutlined,
  GlobalOutlined,
} from "@ant-design/icons";
import { useCollection, COLLECT_TASKS } from "../../contexts/CollectionContext";
import { ACTIVE_ACCOUNT_CHANGED_EVENT, readActiveAccountId } from "../../utils/multiStore";

const { Sider, Content, Header } = Layout;
const { Text } = Typography;

const menuItems = [
  {
    type: "group" as const,
    label: "账号",
    children: [
      { key: "/accounts", icon: <UserOutlined />, label: "账号管理" },
    ],
  },
  {
    type: "group" as const,
    label: "数据",
    children: [
      { key: "/collect", icon: <SyncOutlined />, label: "数据采集" },
      { key: "/tasks", icon: <ScheduleOutlined />, label: "任务管理" },
    ],
  },
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
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { collecting, progress, successCount, errorCount, elapsed, taskStates } = useCollection();
  const completedCount = successCount + errorCount;

  const recentErrors = Object.entries(taskStates)
    .filter(([, s]) => s.status === "error")
    .slice(0, 6)
    .map(([key, s]) => ({ key, message: s.message || "采集失败" }));

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
      const [rawAccounts, activeId] = await Promise.all([
        store.get("temu_accounts"),
        readActiveAccountId(store),
      ]);
      if (cancelled) return;

      const list = Array.isArray(rawAccounts) ? rawAccounts : [];
      setAccounts(list.map((a: any) => ({ id: a.id, name: a.name || "" })));
      setActiveAccountId(activeId ?? null);

      if (!list.length || !activeId) {
        setActiveAccountName("");
        return;
      }
      const active = list.find((a: any) => a?.id === activeId);
      setActiveAccountName(typeof active?.name === "string" ? active.name : "");
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

  const noAccount = accounts.length === 0;

  // 账号切换下拉菜单
  const accountMenuItems = [
    ...accounts.map((a) => ({
      key: a.id,
      label: (
        <Space>
          {a.id === activeAccountId ? <CheckCircleOutlined style={{ color: "#e55b00" }} /> : <UserOutlined style={{ color: "#bbb" }} />}
          <span style={{ fontWeight: a.id === activeAccountId ? 600 : 400 }}>{a.name}</span>
        </Space>
      ),
    })),
    { type: "divider" as const },
    { key: "__manage__", label: <span style={{ color: "#1677ff" }}>管理账号</span> },
  ];

  const handleAccountMenuClick = async ({ key }: { key: string }) => {
    if (key === "__manage__") { navigate("/accounts"); return; }
    const store = window.electronAPI?.store;
    if (!store) return;
    const { setActiveAccountAndSync } = await import("../../utils/multiStore");
    await setActiveAccountAndSync(store, accounts as any[], key);
  };

  // 铃铛通知下拉
  const bellDropdown = (
    <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 280, padding: "12px 0" }}>
      <div style={{ padding: "0 16px 10px", fontWeight: 700, fontSize: 13, color: "#1a1a2e", borderBottom: "1px solid #f0f0f0" }}>
        采集失败记录
      </div>
      {recentErrors.length === 0 ? (
        <div style={{ padding: "20px 16px", color: "#8c8c8c", fontSize: 13, textAlign: "center" }}>暂无失败记录</div>
      ) : (
        <List
          size="small"
          dataSource={recentErrors}
          renderItem={(item) => (
            <List.Item style={{ padding: "8px 16px", borderBottom: "none" }}>
              <Space>
                <CloseCircleOutlined style={{ color: "#ff4d4f", fontSize: 13 }} />
                <span style={{ fontSize: 12, color: "#555" }}>{item.key}：{item.message}</span>
              </Space>
            </List.Item>
          )}
        />
      )}
      <div style={{ padding: "8px 16px 0", borderTop: "1px solid #f0f0f0" }}>
        <Button size="small" type="link" style={{ padding: 0 }} onClick={() => navigate("/collect")}>查看全部采集任务</Button>
      </div>
    </div>
  );

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
            justifyContent: "flex-end",
            height: 64,
            boxShadow: "0 1px 4px rgba(0,0,0,0.03)",
            zIndex: 5,
          }}
        >
          <Space size={12}>
            <Tag
              onClick={() => navigate("/collect")}
              color={collecting ? "processing" : progress === 100 ? (errorCount > 0 ? "warning" : "success") : "default"}
              icon={collecting ? <LoadingOutlined spin /> : <SyncOutlined />}
              style={{ cursor: "pointer", borderRadius: 999, margin: 0, padding: "2px 10px" }}
            >
              {collecting ? `${completedCount}/${COLLECT_TASKS.length}` : progress === 100 ? "采集完成" : "就绪"}
            </Tag>

            <Dropdown
              trigger={["click"]}
              dropdownRender={() => bellDropdown}
            >
              <Badge count={errorCount > 0 ? errorCount : 0} size="small" offset={[-2, 2]}>
                <Button icon={<BellOutlined />} style={{ borderRadius: 10 }} />
              </Badge>
            </Dropdown>

            <Dropdown
              menu={{ items: accountMenuItems, onClick: handleAccountMenuClick }}
              trigger={["click"]}
            >
              <Tag
                color={activeAccountName ? "blue" : "default"}
                icon={<UserOutlined />}
                style={{ borderRadius: 12, padding: "4px 12px", marginInlineEnd: 0, cursor: "pointer" }}
              >
                {activeAccountName || "未选择账号"}
              </Tag>
            </Dropdown>

            <Button
              icon={<SettingOutlined />}
              onClick={() => navigate("/settings")}
              style={{ borderRadius: 10 }}
            />
          </Space>
        </Header>

        {/* 首次使用引导条 */}
        {noAccount && (
          <div style={{
            background: "linear-gradient(90deg, #fff7f0, #fff)",
            borderBottom: "1px solid #ffd9b8",
            padding: "10px 28px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}>
            <RocketOutlined style={{ color: "#e55b00", fontSize: 16 }} />
            <span style={{ fontWeight: 600, color: "#1a1a2e", fontSize: 13 }}>快速开始：</span>
            <Space size={6} wrap>
              <Tag style={{ borderRadius: 999, padding: "2px 10px" }}>① 添加账号</Tag>
              <ArrowRightOutlined style={{ color: "#bbb", fontSize: 11 }} />
              <Tag style={{ borderRadius: 999, padding: "2px 10px" }}>② 登录</Tag>
              <ArrowRightOutlined style={{ color: "#bbb", fontSize: 11 }} />
              <Tag style={{ borderRadius: 999, padding: "2px 10px" }}>③ 一键采集</Tag>
            </Space>
            <Button
              size="small"
              type="primary"
              onClick={() => navigate("/accounts")}
              style={{ marginLeft: "auto", borderRadius: 8, background: "#e55b00", border: "none" }}
            >
              去添加账号
            </Button>
          </div>
        )}

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
