import { useState, useEffect } from "react";
import {
  Row,
  Col,
  Card,
  Button,
  Modal,
  Form,
  Input,
  Space,
  Skeleton,
  Tag,
  Popconfirm,
  message,
  notification,
  Typography,
  Divider,
} from "antd";
import {
  PlusOutlined,
  LoginOutlined,
  DeleteOutlined,
  LogoutOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  PhoneOutlined,
  ClockCircleOutlined,
  ShopOutlined,
  ShoppingOutlined,
  DatabaseOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import {
  ACTIVE_ACCOUNT_CHANGED_EVENT,
  emitActiveAccountChanged,
  readActiveAccountId,
  setActiveAccountAndSync,
  syncScopedDataToGlobalStore,
  writeActiveAccountId,
} from "../utils/multiStore";
import { getStoreValue } from "../utils/storeCompat";
import { parseProductsData } from "../utils/parseRawApis";
import { normalizeCollectionDiagnostics } from "../utils/collectionDiagnostics";

const { Text, Title } = Typography;

const TEMU_ORANGE = "#e55b00";

interface Account {
  id: string;
  name: string;
  phone: string;
  password: string;
  status: "online" | "offline" | "logging_in" | "error";
  lastLoginAt?: string;
}

const statusConfig = {
  online: { color: "#52c41a", text: "在线", dot: "#52c41a" },
  offline: { color: "default", text: "离线", dot: "#d9d9d9" },
  logging_in: { color: "processing", text: "登录中...", dot: "#1890ff" },
  error: { color: "red", text: "异常", dot: "#ff4d4f" },
};

const STORAGE_KEY = "temu_accounts";

function maskPhone(phone: string) {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0, 3) + "****" + phone.slice(-4);
}

interface AccountStats {
  productCount: number;
  collectionTotal: number;
  collectionSuccess: number;
}

export default function AccountManager() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loginLoadingId, setLoginLoadingId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [accountStats, setAccountStats] = useState<Record<string, AccountStats>>({});
  const [form] = Form.useForm();

  const api = window.electronAPI?.automation;
  const store = (window as any).electronAPI?.store;

  const clearActiveAccount = async () => {
    if (!store) return;
    const previousActiveAccountId = await readActiveAccountId(store);
    setActiveAccountId(null);
    await writeActiveAccountId(store, null);
    await syncScopedDataToGlobalStore(store, null);
    if (previousActiveAccountId) {
      emitActiveAccountChanged(null);
    }
  };

  const restoreActiveAccountData = async (nextAccounts: Account[]) => {
    if (!store) return;
    const storedActiveAccountId = await readActiveAccountId(store);
    if (storedActiveAccountId && nextAccounts.some((account) => account.id === storedActiveAccountId)) {
      setActiveAccountId(storedActiveAccountId);
      await writeActiveAccountId(store, storedActiveAccountId);
      await syncScopedDataToGlobalStore(store, storedActiveAccountId);
      return;
    }
    setActiveAccountId(null);
    await clearActiveAccount();
  };

  // 加载账号数据概览
  const loadAccountStats = async () => {
    if (!store) return;
    try {
      const [rawProducts, rawDiag] = await Promise.all([
        getStoreValue(store, "temu_products"),
        getStoreValue(store, "temu_collection_diagnostics"),
      ]);
      const products = parseProductsData(rawProducts);
      const diag = normalizeCollectionDiagnostics(rawDiag);
      const stats: AccountStats = {
        productCount: products.length,
        collectionTotal: diag.summary.totalTasks || 0,
        collectionSuccess: diag.summary.successCount || 0,
      };
      if (activeAccountId) {
        setAccountStats((prev) => ({ ...prev, [activeAccountId]: stats }));
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    let cancelled = false;
    const hydrateAccounts = async () => {
      if (!store) {
        if (!cancelled) setHydrated(true);
        return;
      }
      try {
        const data = await store.get(STORAGE_KEY);
        if (cancelled) return;
        if (data && Array.isArray(data)) {
          const nextAccounts = data.map((a: Account) => ({ ...a, status: "offline" as const }));
          setAccounts(nextAccounts);
          await restoreActiveAccountData(nextAccounts);
        } else {
          await clearActiveAccount();
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };
    hydrateAccounts().catch(() => {
      if (!cancelled) setHydrated(true);
    });
    return () => { cancelled = true; };
  }, [store]);

  useEffect(() => {
    if (!store || !hydrated) return;
    const handleActiveAccountChanged = () => {
      readActiveAccountId(store).then((id) => {
        setActiveAccountId((prev) => (prev === id ? prev : id));
      }).catch(() => {});
    };
    window.addEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged as EventListener);
    return () => {
      window.removeEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged as EventListener);
    };
  }, [hydrated, store]);

  useEffect(() => {
    if (store && hydrated) {
      store.set(STORAGE_KEY, accounts);
    }
  }, [accounts, hydrated, store]);

  // 加载活跃账号的数据概览
  useEffect(() => {
    if (hydrated && activeAccountId) {
      loadAccountStats();
    }
  }, [hydrated, activeAccountId]);

  const handleAdd = async () => {
    try {
      const values = await form.validateFields();
      const newAccount: Account = {
        id: `acc_${Date.now()}`,
        name: values.name,
        phone: values.phone,
        password: values.password,
        status: "offline",
      };
      setAccounts((prev) => [...prev, newAccount]);
      setModalOpen(false);
      form.resetFields();
      message.success("账号添加成功");
    } catch {
      // validation failed
    }
  };

  const handleLogin = async (account: Account) => {
    if (!api) {
      message.warning("自动化模块未连接（请在 Electron 环境中运行）");
      return;
    }
    setLoginLoadingId(account.id);
    setAccounts((prev) =>
      prev.map((a) => (a.id === account.id ? { ...a, status: "logging_in" as const } : a))
    );
    notification.info({
      key: "login",
      message: "正在启动浏览器",
      description: `正在为「${account.name}」启动浏览器并登录 Temu 卖家后台...`,
      duration: 0,
    });
    try {
      const result = await api.login(account.id, account.phone, account.password);
      if (result?.success) {
        const lastLoginAt = new Date().toLocaleString("zh-CN");
        let nextAccounts: Account[] = [];
        setAccounts((prev) => {
          nextAccounts = prev.map((a) =>
            a.id === account.id
              ? { ...a, status: "online" as const, lastLoginAt }
              : { ...a, status: "offline" as const }
          );
          return nextAccounts;
        });
        await setActiveAccountAndSync(store, nextAccounts, account.id);
        notification.success({
          key: "login",
          message: "登录成功",
          description: result.matchedStoreName
            ? `「${account.name}」已成功登录，当前匹配店铺：${result.matchedStoreName}`
            : `「${account.name}」已成功登录 Temu 卖家后台`,
        });
      } else {
        throw new Error("登录返回失败");
      }
    } catch (error: any) {
      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? { ...a, status: "error" as const } : a))
      );
      notification.error({
        key: "login",
        message: "登录失败",
        description: error?.message || "请检查账号密码或手动完成验证码",
      });
    } finally {
      setLoginLoadingId(null);
    }
  };

  const handleActivateAccount = async (id: string) => {
    if (!store) {
      message.warning("本地存储未连接，暂时无法切换数据视图");
      return;
    }
    if (activeAccountId === id) return;
    const target = accounts.find((account) => account.id === id);
    if (!target) {
      message.warning("目标账号不存在");
      return;
    }
    try {
      await setActiveAccountAndSync(store, accounts, id);
      setActiveAccountId(id);
      message.success(`已切换到「${target.name}」的数据视图`);
    } catch (error: any) {
      message.error(error?.message || "切换数据视图失败");
    }
  };

  const handleLogout = async (id: string) => {
    if (api) {
      try { await api.close(); } catch {}
    }
    const nextAccounts = accounts.map((a) => (a.id === id ? { ...a, status: "offline" as const } : a));
    setAccounts(nextAccounts);
    const currentActiveId = await readActiveAccountId(store);
    if (currentActiveId === id) {
      await clearActiveAccount();
    }
    message.success("已断开连接");
  };

  const handleDelete = async (id: string) => {
    const target = accounts.find((account) => account.id === id);
    if (target?.status === "online" && api) {
      try { await api.close(); } catch {}
    }
    const nextAccounts = accounts.filter((a) => a.id !== id);
    setAccounts(nextAccounts);
    const currentActiveId = await readActiveAccountId(store);
    if (currentActiveId === id) {
      await clearActiveAccount();
    } else {
      await restoreActiveAccountData(nextAccounts);
    }
    message.success("账号已删除");
  };

  if (!hydrated) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 4 }} />
      </div>
    );
  }

  const renderAccountCard = (account: Account) => {
    const isActive = activeAccountId === account.id;
    const isLoggingIn = loginLoadingId === account.id;
    const status = statusConfig[account.status] || statusConfig.offline;
    const stats = accountStats[account.id];

    return (
      <Col xs={24} md={12} xl={8} key={account.id}>
        <Card
          hoverable
          style={{
            borderRadius: 16,
            border: isActive ? `2px solid ${TEMU_ORANGE}` : "1px solid #f0f0f0",
            boxShadow: isActive
              ? `0 4px 20px rgba(255, 106, 0, 0.15)`
              : "0 2px 12px rgba(0,0,0,0.04)",
            position: "relative",
            overflow: "hidden",
          }}
          styles={{ body: { padding: "20px 24px 16px" } }}
        >
          {/* 活跃标签 */}
          {isActive && (
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                background: `linear-gradient(135deg, ${TEMU_ORANGE}, #ff8534)`,
                color: "#fff",
                fontSize: 11,
                padding: "2px 16px 2px 12px",
                borderRadius: "0 0 0 12px",
                fontWeight: 600,
              }}
            >
              <CheckCircleOutlined style={{ marginRight: 4 }} />
              当前数据
            </div>
          )}

          {/* 头部：店铺名 + 状态 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: isActive
                  ? `linear-gradient(135deg, ${TEMU_ORANGE}, #ff8534)`
                  : "#f5f5f5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <ShopOutlined style={{ fontSize: 20, color: isActive ? "#fff" : "#bbb" }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Title level={5} style={{ margin: 0, fontSize: 16 }} ellipsis>
                {account.name || "未命名店铺"}
              </Title>
              <Space size={6} style={{ marginTop: 2 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: status.dot,
                  }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>{status.text}</Text>
              </Space>
            </div>
          </div>

          {/* 信息行 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <PhoneOutlined style={{ color: "#bbb", fontSize: 13 }} />
              <Text style={{ fontSize: 13 }}>{maskPhone(account.phone)}</Text>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ClockCircleOutlined style={{ color: "#bbb", fontSize: 13 }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {account.lastLoginAt || "尚未登录"}
              </Text>
            </div>
          </div>

          {/* 数据概览（仅活跃账号） */}
          {isActive && stats && (stats.productCount > 0 || stats.collectionTotal > 0) && (
            <>
              <Divider style={{ margin: "10px 0" }} />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-around",
                  textAlign: "center",
                  marginBottom: 6,
                }}
              >
                <div>
                  <ShoppingOutlined style={{ color: TEMU_ORANGE, fontSize: 16 }} />
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a2e", lineHeight: 1.3 }}>
                    {stats.productCount}
                  </div>
                  <Text type="secondary" style={{ fontSize: 11 }}>商品</Text>
                </div>
                <div>
                  <DatabaseOutlined style={{ color: "#1890ff", fontSize: 16 }} />
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a2e", lineHeight: 1.3 }}>
                    {stats.collectionSuccess}/{stats.collectionTotal}
                  </div>
                  <Text type="secondary" style={{ fontSize: 11 }}>采集</Text>
                </div>
              </div>
            </>
          )}

          {/* 操作按钮 */}
          <Divider style={{ margin: "10px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <Space size={8} wrap>
              {!isActive ? (
                <Button
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => handleActivateAccount(account.id)}
                  style={{ borderRadius: 8 }}
                >
                  切换数据
                </Button>
              ) : null}

              {account.status === "online" ? (
                isActive ? (
                  <Button
                    size="small"
                    icon={<LogoutOutlined />}
                    onClick={() => handleLogout(account.id)}
                    style={{ borderRadius: 8 }}
                  >
                    断开
                  </Button>
                ) : null
              ) : (
                <Button
                  type="primary"
                  size="small"
                  icon={<LoginOutlined />}
                  loading={isLoggingIn}
                  onClick={() => handleLogin(account)}
                  style={{
                    borderRadius: 8,
                    background: `linear-gradient(135deg, ${TEMU_ORANGE}, #ff8534)`,
                    border: "none",
                  }}
                >
                  登录
                </Button>
              )}
            </Space>

            {/* 右侧：删除 */}
            <Popconfirm
              title="确定删除此账号？"
              description="删除后该账号的采集数据仍会保留"
              onConfirm={() => handleDelete(account.id)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} style={{ borderRadius: 8 }}>
                删除
              </Button>
            </Popconfirm>
          </div>
        </Card>
      </Col>
    );
  };

  const activeAccount = accounts.find((account) => account.id === activeAccountId) || null;
  const onlineCount = accounts.filter((account) => account.status === "online").length;
  const activeStats = activeAccountId ? accountStats[activeAccountId] : null;

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="账号工作台"
        title="账号管理"
        subtitle="把店铺登录、数据视图切换和当前账号状态放到同一个工作台里处理。"
        meta={[
          `${accounts.length} 个账号`,
          `${onlineCount} 个在线`,
          activeAccount ? `当前：${activeAccount.name}` : "未选择数据账号",
        ]}
        actions={[
          <Button
            key="add-account"
            type="primary"
            icon={<PlusOutlined />}
            size="large"
            onClick={() => setModalOpen(true)}
            style={{
              borderRadius: 14,
              height: 46,
              paddingInline: 28,
              background: `linear-gradient(135deg, ${TEMU_ORANGE}, #ff8534)`,
              border: "none",
              boxShadow: "0 8px 18px rgba(255, 106, 0, 0.22)",
            }}
          >
            添加账号
          </Button>,
        ]}
      />

      {accounts.length === 0 ? (
        <Card
          style={{
            borderRadius: 16,
            textAlign: "center",
            padding: "60px 0",
            border: "1px dashed #e0e0e0",
          }}
        >
          <ShopOutlined style={{ fontSize: 48, color: "#d9d9d9", marginBottom: 16 }} />
          <div>
            <Text type="secondary" style={{ fontSize: 15 }}>暂无账号</Text>
          </div>
          <div style={{ marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              点击上方「添加账号」按钮，添加你的 Temu 卖家账号
            </Text>
          </div>
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {/* 活跃账号排前面 */}
          {accounts
            .slice()
            .sort((a, b) => {
              if (a.id === activeAccountId) return -1;
              if (b.id === activeAccountId) return 1;
              if (a.status === "online" && b.status !== "online") return -1;
              if (b.status === "online" && a.status !== "online") return 1;
              return 0;
            })
            .map(renderAccountCard)}
        </Row>
      )}

      <Modal
        title="添加 Temu 账号"
        open={modalOpen}
        onOk={handleAdd}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        okText="添加"
        cancelText="取消"
        styles={{ body: { paddingTop: 16 } }}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="店铺名称"
            rules={[{ required: true, message: "请输入店铺名称" }]}
          >
            <Input placeholder="例：我的Temu店铺" style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item
            name="phone"
            label="手机号"
            rules={[
              { required: true, message: "请输入手机号" },
              { pattern: /^1[3-9]\d{9}$/, message: "请输入有效的手机号" },
            ]}
          >
            <Input placeholder="请输入手机号" maxLength={11} style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item
            name="password"
            label="登录密码"
            rules={[{ required: true, message: "请输入登录密码" }]}
          >
            <Input.Password placeholder="请输入密码" style={{ borderRadius: 8 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
