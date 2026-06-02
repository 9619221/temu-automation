import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Badge, Button, Dropdown, Layout, List, Menu, Space, Tag } from "antd";
import {
  ApiOutlined,
  ArrowRightOutlined,
  BarChartOutlined,
  BellOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DollarOutlined,
  ExportOutlined,
  FundProjectionScreenOutlined,
  FileTextOutlined,
  InboxOutlined,
  LoadingOutlined,
  LogoutOutlined,
  PictureOutlined,
  PlusCircleOutlined,
  RocketOutlined,
  SearchOutlined,
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
import BrandMark from "../BrandMark";
import ExtensionInstallGuide from "../ExtensionInstallGuide";

const { Content, Header, Sider } = Layout;

const menuItems = [
  {
    key: "group-account",
    label: "账号",
    children: [
      { key: "/accounts", icon: <UserOutlined />, label: "账号管理" },
      { key: "/temu-auth", icon: <ApiOutlined />, label: "Temu 授权" },
    ],
  },
  {
    key: "group-business",
    label: "采购",
    children: [
      { key: "/product-master-data", icon: <TagsOutlined />, label: "商品资料" },
      { key: "/1688-mapping", icon: <ApiOutlined />, label: "供应商管理" },
      { key: "/sourcing-center", icon: <SearchOutlined />, label: "找品" },
      { key: "/purchase-center", icon: <ShoppingOutlined />, label: "采购单" },
      { key: "/after-sales", icon: <FileTextOutlined />, label: "售后" },
      { key: "/warehouse-center", icon: <InboxOutlined />, label: "仓库中心" },
      { key: "/qc-outbound", icon: <ExportOutlined />, label: "出库中心" },
    ],
  },
  {
    key: "group-data",
    label: "数据",
    children: [
      { key: "/collect", icon: <SyncOutlined />, label: "数据采集" },
      { key: "/temu-robots", icon: <DatabaseOutlined />, label: "TEMU 机器人" },
    ],
  },
  {
    key: "group-operations",
    label: "运营",
    children: [
      { key: "/shop", icon: <DashboardOutlined />, label: "店铺概览" },
      { key: "/multi-store-report", icon: <BarChartOutlined />, label: "多店报表" },
      { key: "/ops-workbench", icon: <FundProjectionScreenOutlined />, label: "运营工作台" },
      { key: "/products", icon: <ShoppingOutlined />, label: "商品管理" },
      { key: "/browser-multi", icon: <RocketOutlined />, label: "浏览器多开" },
    ],
  },
  {
    key: "group-tools",
    label: "工具",
    children: [
      { key: "/create-product", icon: <PlusCircleOutlined />, label: "上品管理" },
      { key: "/image-studio", icon: <PictureOutlined />, label: "AI 出图" },
      { key: "/image-studio-gpt", icon: <PictureOutlined />, label: "AI 生图 GPT 版" },
      { key: "/image-studio-agent", icon: <PictureOutlined />, label: "AI 生图 多Agent版" },
      { key: "/auto-image-swap", icon: <PictureOutlined />, label: "批量替换图片" },
      { key: "/price-review", icon: <DollarOutlined />, label: "核价筛选" },
      { key: "/logs", icon: <FileTextOutlined />, label: "日志中心" },
    ],
  },
  {
    key: "group-system",
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
  const [openKeys, setOpenKeys] = useState<string[]>([]);
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
  const isStudioRoute = location.pathname.startsWith("/image-studio");

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

  const selectedGroupKey = useMemo(() => {
    const group = visibleMenuItems.find((item) => item.children.some((child) => child.key === selectedKey));
    return group?.key || "";
  }, [selectedKey, visibleMenuItems]);

  const selectedMenuItem = useMemo(() => {
    for (const group of visibleMenuItems) {
      const child = group.children.find((item) => item.key === selectedKey);
      if (child) return { groupLabel: group.label, label: child.label };
    }
    return { groupLabel: "工作台", label: "运营助手" };
  }, [selectedKey, visibleMenuItems]);

  useEffect(() => {
    if (!selectedGroupKey || collapsed) return;
    setOpenKeys([selectedGroupKey]);
  }, [collapsed, selectedGroupKey]);

  const handleMenuOpenChange = (keys: string[]) => {
    const latestOpenKey = keys.find((key) => !openKeys.includes(key));
    setOpenKeys(latestOpenKey ? [latestOpenKey] : []);
  };

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
  const showExtensionBanner = currentRole !== "operations" && canUseCollection && location.pathname !== "/collect";

  const accountMenuItems = [
    ...accounts.map((account) => ({
      key: account.id,
      label: (
        <Space>
          {account.id === activeAccountId ? (
            <CheckCircleOutlined style={{ color: "var(--color-blue)" }} />
          ) : (
            <UserOutlined style={{ color: "#bbb" }} />
          )}
          <span style={{ fontWeight: account.id === activeAccountId ? 600 : 400 }}>{account.name}</span>
        </Space>
      ),
    })),
    { type: "divider" as const },
    { key: "__manage__", label: <span style={{ color: "#1a73e8" }}>管理账号</span> },
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
    <div className="app-notification-popover">
      <div className="app-notification-popover__title">
        采集失败记录
      </div>
      {recentErrors.length === 0 ? (
        <div className="app-notification-popover__empty">暂无失败记录</div>
      ) : (
        <List
          size="small"
          dataSource={recentErrors}
          renderItem={(item) => (
            <List.Item style={{ padding: "8px 16px", borderBottom: "none" }}>
              <Space>
                <CloseCircleOutlined style={{ color: "#ea4335", fontSize: 13 }} />
                <span style={{ fontSize: 12, color: "#555" }}>
                  {item.key}：{item.message}
                </span>
              </Space>
            </List.Item>
          )}
        />
      )}
      <div className="app-notification-popover__footer">
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
        width={236}
        collapsedWidth={72}
        style={{ zIndex: 10 }}
      >
        <div className="app-layout-sider__inner">
          <div
            className="app-layout-brand"
            style={{
              justifyContent: collapsed ? "center" : "flex-start",
              padding: collapsed ? 0 : "0 20px",
            }}
          >
            <BrandMark size={34} className="app-layout-brand__mark" />
            {!collapsed && (
              <span className="app-layout-brand__text">
                Temu Ops
              </span>
            )}
          </div>

          <div className="app-layout-menu-scroll">
            <Menu
              mode="inline"
              selectedKeys={[selectedKey]}
              openKeys={collapsed ? [] : openKeys}
              onOpenChange={handleMenuOpenChange}
              items={visibleMenuItems}
              onClick={({ key }) => navigate(key)}
              style={{ border: 0 }}
            />
          </div>
        </div>
      </Sider>

      <Layout className="app-layout-main">
        <Header className="app-layout-header">
          <div className="app-layout-header__context">
            <span>{selectedMenuItem.groupLabel}</span>
            <strong>{selectedMenuItem.label}</strong>
          </div>
          <Space size={10} wrap className="app-layout-toolbar">
            {canUseCollection ? (
            <Button
              type="text"
              onClick={() => navigate("/collect")}
              className={[
                "app-status-chip",
                collecting ? "is-processing" : "",
                !collecting && progress === 100 && errorCount === 0 ? "is-success" : "",
                !collecting && progress === 100 && errorCount > 0 ? "is-warning" : "",
              ].filter(Boolean).join(" ")}
              icon={collecting ? <LoadingOutlined spin /> : <SyncOutlined />}
            >
              {collecting ? `采集中 ${completedCount}/${COLLECT_TASKS.length}` : progress === 100 ? "采集完成" : "采集就绪"}
            </Button>
            ) : null}

            {canUseCollection ? (
            <Dropdown trigger={["click"]} popupRender={() => bellDropdown}>
              <Badge count={errorCount > 0 ? errorCount : 0} size="small" offset={[-2, 2]}>
                <Button icon={<BellOutlined />} className="app-header-button">
                  通知
                </Button>
              </Badge>
            </Dropdown>
            ) : null}

            {canManageAccounts ? (
            <Dropdown menu={{ items: accountMenuItems, onClick: handleAccountMenuClick }} trigger={["click"]}>
              <Button
                type="text"
                className={activeAccountName ? "app-account-chip is-active" : "app-account-chip"}
                icon={<UserOutlined />}
              >
                {activeAccountName ? `账号 ${activeAccountName}` : "未选择账号"}
              </Button>
            </Dropdown>
            ) : null}

            {canViewLogs ? (
              <Button
                icon={<FileTextOutlined />}
                onClick={() => navigate("/logs")}
                className="app-header-button"
                title="日志中心"
              >
                日志
              </Button>
            ) : null}

            <Tag color="blue" icon={<UserOutlined />} className="app-user-chip">
              {auth.currentUser?.name || "-"} · {roleLabel(currentRole)}
            </Tag>

            {canAccessRoute(currentRole, "/settings") ? (
              <Button icon={<SettingOutlined />} onClick={() => navigate("/settings")} className="app-header-button">
                设置
              </Button>
            ) : null}
            <Button icon={<LogoutOutlined />} onClick={handleLogout} className="app-header-button">
              退出
            </Button>
          </Space>
        </Header>

        {noAccount && canManageAccounts && (
          <div className="app-setup-banner">
            <RocketOutlined className="app-setup-banner__icon" />
            <span className="app-setup-banner__title">快速开始：</span>
            <Space size={6} wrap>
              <Tag className="app-setup-banner__step">① 添加账号</Tag>
              <ArrowRightOutlined className="app-setup-banner__arrow" />
              <Tag className="app-setup-banner__step">② 登录</Tag>
              <ArrowRightOutlined className="app-setup-banner__arrow" />
              <Tag className="app-setup-banner__step">③ 一键采集</Tag>
            </Space>
            <Button
              size="small"
              type="primary"
              onClick={() => navigate("/accounts")}
              className="app-setup-banner__action"
            >
              去添加账号
            </Button>
          </div>
        )}

        {showExtensionBanner ? (
          <ExtensionInstallGuide variant="banner" />
        ) : null}

        <Content
          className="app-layout-content"
          style={{
            margin: 0,
            padding: 0,
            overflow: "auto",
            minHeight: 280,
          }}
        >
          <div className={`app-workspace-shell${isStudioRoute ? " app-workspace-shell--studio" : ""}`}>
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
