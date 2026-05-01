import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Badge, Button, Dropdown, Layout, List, Menu, Space, Tag } from "antd";
import {
  ApiOutlined,
  ArrowRightOutlined,
  BellOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DollarOutlined,
  FileTextOutlined,
  InboxOutlined,
  LoadingOutlined,
  LogoutOutlined,
  PictureOutlined,
  PlusCircleOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ShoppingOutlined,
  SyncOutlined,
  TagsOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { ACTIVE_ACCOUNT_CHANGED_EVENT, readActiveAccountId } from "../../utils/multiStore";
import { COLLECT_TASKS, useCollection } from "../../contexts/CollectionContext";
import { useErpAuth } from "../../contexts/ErpAuthContext";
import { canAccessRoute, roleLabel } from "../../utils/erpRoleAccess";

const { Content, Header, Sider } = Layout;

const menuItems = [
  {
    type: "group" as const,
    label: "账号",
    children: [{ key: "/accounts", icon: <UserOutlined />, label: "账号管理" }],
  },
  {
    type: "group" as const,
    label: "业务",
    children: [
      { key: "/daily-command", icon: <BellOutlined />, label: "今日作战台" },
      { key: "/product-master-data", icon: <TagsOutlined />, label: "商品资料" },
      { key: "/1688-mapping", icon: <ApiOutlined />, label: "供应商管理" },
      { key: "/purchase-center", icon: <ShoppingOutlined />, label: "采购中心" },
      { key: "/warehouse-center", icon: <InboxOutlined />, label: "仓库中心" },
      { key: "/qc-outbound", icon: <SafetyCertificateOutlined />, label: "质检发仓" },
    ],
  },
  {
    type: "group" as const,
    label: "数据",
    children: [{ key: "/collect", icon: <SyncOutlined />, label: "数据采集" }],
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
      { key: "/image-studio-gpt", icon: <PictureOutlined />, label: "AI 生图 GPT 版" },
      { key: "/price-review", icon: <DollarOutlined />, label: "核价筛选" },
      { key: "/logs", icon: <FileTextOutlined />, label: "日志中心" },
    ],
  },
  {
    type: "group" as const,
    label: "系统",
    children: [
      { key: "/work-items", icon: <BellOutlined />, label: "事项中心" },
      { key: "/users", icon: <UserOutlined />, label: "用户管理" },
      { key: "/erp-debug", icon: <DatabaseOutlined />, label: "调试台" },
      { key: "/settings", icon: <SettingOutlined />, label: "设置" },
    ],
  },
];

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [activeAccountName, setActiveAccountName] = useState("");
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useErpAuth();
  const currentRole = auth.currentUser?.role || "";
  const { collecting, progress, successCount, errorCount, taskStates } = useCollection();
  const completedCount = successCount + errorCount;
  const canUseCollection = canAccessRoute(currentRole, "/collect");
  const canManageAccounts = canAccessRoute(currentRole, "/accounts");
  const canViewLogs = canAccessRoute(currentRole, "/logs");

  const visibleMenuItems = useMemo(() => (
    menuItems
      .map((group) => ({
        ...group,
        children: group.children.filter((item) => canAccessRoute(currentRole, item.key)),
      }))
      .filter((group) => group.children.length > 0)
  ), [currentRole]);

  const recentErrors = Object.entries(taskStates)
    .filter(([, state]) => state.status === "error")
    .slice(0, 6)
    .map(([key, state]) => ({ key, message: state.message || "采集失败" }));

  let selectedKey = location.pathname;
  if (location.pathname.startsWith("/products/")) {
    selectedKey = "/products";
  } else if (location.pathname === "/dashboard") {
    selectedKey = "/shop";
  } else if (location.pathname === "/tasks") {
    selectedKey = "/collect";
  }

  useEffect(() => {
    const store = window.electronAPI?.store;
    if (!store) return;

    let cancelled = false;

    const loadActiveAccount = async () => {
      const [rawAccounts, activeId] = await Promise.all([store.get("temu_accounts"), readActiveAccountId(store)]);
      if (cancelled) return;

      const list = Array.isArray(rawAccounts) ? rawAccounts : [];
      setAccounts(list.map((account: any) => ({ id: account.id, name: account.name || "" })));
      setActiveAccountId(activeId ?? null);

      if (!list.length || !activeId) {
        setActiveAccountName("");
        return;
      }

      const active = list.find((account: any) => account?.id === activeId);
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

  const accountMenuItems = [
    ...accounts.map((account) => ({
      key: account.id,
      label: (
        <Space>
          {account.id === activeAccountId ? (
            <CheckCircleOutlined style={{ color: "#e55b00" }} />
          ) : (
            <UserOutlined style={{ color: "#bbb" }} />
          )}
          <span style={{ fontWeight: account.id === activeAccountId ? 600 : 400 }}>{account.name}</span>
        </Space>
      ),
    })),
    { type: "divider" as const },
    { key: "__manage__", label: <span style={{ color: "#1677ff" }}>管理账号</span> },
  ];

  const handleAccountMenuClick = async ({ key }: { key: string }) => {
    if (key === "__manage__") {
      navigate("/accounts");
      return;
    }

    const store = window.electronAPI?.store;
    if (!store) return;
    const { setActiveAccountAndSync } = await import("../../utils/multiStore");
    await setActiveAccountAndSync(store, accounts as any[], key);
  };

  const handleLogout = async () => {
    await auth.logout();
    navigate("/login", { replace: true });
  };

  const bellDropdown = (
    <div
      style={{
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        minWidth: 280,
        padding: "12px 0",
      }}
    >
      <div
        style={{
          padding: "0 16px 10px",
          fontWeight: 700,
          fontSize: 13,
          color: "#1a1a2e",
          borderBottom: "1px solid #f0f0f0",
        }}
      >
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
                <span style={{ fontSize: 12, color: "#555" }}>
                  {item.key}：{item.message}
                </span>
              </Space>
            </List.Item>
          )}
        />
      )}
      <div style={{ padding: "8px 16px 0", borderTop: "1px solid #f0f0f0" }}>
        <Button size="small" type="link" style={{ padding: 0 }} onClick={() => navigate("/collect")}>
          查看全部采集任务
        </Button>
      </div>
    </div>
  );

  return (
    <Layout style={{ minHeight: "100vh" }} className="app-layout-root">
      <Sider
        className="app-layout-sider"
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
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "linear-gradient(135deg, #e55b00, #ff8534)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <RocketOutlined style={{ fontSize: 18, color: "#fff" }} />
            </div>
            {!collapsed && (
              <span
                style={{
                  marginLeft: 12,
                  fontSize: 16,
                  fontWeight: 700,
                  background: "linear-gradient(135deg, #e55b00, #ff8534)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  whiteSpace: "nowrap",
                }}
              >
                Temu 运营助手
              </span>
            )}
          </div>

          <div style={{ flex: 1, overflow: "auto", paddingTop: 8 }}>
            <Menu
              mode="inline"
              selectedKeys={[selectedKey]}
              items={visibleMenuItems}
              onClick={({ key }) => navigate(key)}
              style={{ border: 0 }}
            />
          </div>
        </div>
      </Sider>

      <Layout className="app-layout-main" style={{ background: "linear-gradient(180deg, #f8f9fc 0%, #f4f6fa 100%)" }}>
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
            {canUseCollection ? (
            <Tag
              onClick={() => navigate("/collect")}
              color={collecting ? "processing" : progress === 100 ? (errorCount > 0 ? "warning" : "success") : "default"}
              icon={collecting ? <LoadingOutlined spin /> : <SyncOutlined />}
              style={{ cursor: "pointer", borderRadius: 999, margin: 0, padding: "2px 10px" }}
            >
              {collecting ? `${completedCount}/${COLLECT_TASKS.length}` : progress === 100 ? "采集完成" : "就绪"}
            </Tag>
            ) : null}

            {canUseCollection ? (
            <Dropdown trigger={["click"]} dropdownRender={() => bellDropdown}>
              <Badge count={errorCount > 0 ? errorCount : 0} size="small" offset={[-2, 2]}>
                <Button icon={<BellOutlined />} style={{ borderRadius: 10 }} />
              </Badge>
            </Dropdown>
            ) : null}

            {canManageAccounts ? (
            <Dropdown menu={{ items: accountMenuItems, onClick: handleAccountMenuClick }} trigger={["click"]}>
              <Tag
                color={activeAccountName ? "blue" : "default"}
                icon={<UserOutlined />}
                style={{ borderRadius: 12, padding: "4px 12px", marginInlineEnd: 0, cursor: "pointer" }}
              >
                {activeAccountName || "未选择账号"}
              </Tag>
            </Dropdown>
            ) : null}

            {canViewLogs ? (
              <Button
                icon={<FileTextOutlined />}
                onClick={() => navigate("/logs")}
                style={{ borderRadius: 10 }}
                title="日志中心"
              />
            ) : null}

            <Tag color="blue" icon={<UserOutlined />} style={{ borderRadius: 12, padding: "4px 12px", marginInlineEnd: 0 }}>
              {auth.currentUser?.name || "-"} · {roleLabel(currentRole)}
            </Tag>

            {canAccessRoute(currentRole, "/settings") ? (
              <Button icon={<SettingOutlined />} onClick={() => navigate("/settings")} style={{ borderRadius: 10 }} />
            ) : null}
            <Button icon={<LogoutOutlined />} onClick={handleLogout} style={{ borderRadius: 10 }} />
          </Space>
        </Header>

        {noAccount && canManageAccounts && (
          <div
            style={{
              background: "linear-gradient(90deg, #fff7f0, #fff)",
              borderBottom: "1px solid #ffd9b8",
              padding: "10px 28px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
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

        <Content
          className="app-layout-content"
          style={{
            margin: 0,
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
