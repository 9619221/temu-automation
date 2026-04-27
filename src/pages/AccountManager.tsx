import { useState, useEffect, useMemo } from "react";
import {
  Alert,
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
  Progress,
  Tooltip,
  Empty,
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
  SyncOutlined,
  WarningOutlined,
  ThunderboltOutlined,
  DashboardOutlined,
  ExclamationCircleOutlined,
  KeyOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
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
import {
  normalizeCollectionDiagnostics,
  type CollectionDiagnostics,
} from "../utils/collectionDiagnostics";
import { useCollection, COLLECT_TASKS } from "../contexts/CollectionContext";

const { Text, Title } = Typography;

const TEMU_ORANGE = "#e55b00";

interface Account {
  id: string;
  name: string;
  phone: string;
  password: string;
  status: "online" | "offline" | "logging_in" | "error";
  lastLoginAt?: string;
  passwordState?: "ready" | "missing" | "decrypt_failed";
  passwordRepairRequired?: boolean;
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

function accountNeedsPasswordRepair(account?: Account | null) {
  if (!account) return false;
  return Boolean(account.passwordRepairRequired || !account.password);
}

function getPasswordRepairMessage(account?: Account | null) {
  if (!account) return "";
  if (account.passwordState === "decrypt_failed") {
    return "当前保存的密码密文已失效，需要重新录入密码后才能继续自动登录。";
  }
  return "当前账号还没有可用密码，请先补录密码。";
}

/** 计算数据新鲜度 */
function getDataFreshness(syncedAt: string | null): {
  label: string;
  color: string;
  level: "fresh" | "stale" | "expired" | "none";
} {
  if (!syncedAt) return { label: "未采集", color: "#d9d9d9", level: "none" };
  const diff = Date.now() - new Date(syncedAt).getTime();
  const hours = diff / (1000 * 60 * 60);
  if (hours < 6) return { label: `${hours < 1 ? "刚刚" : Math.floor(hours) + "小时前"}`, color: "#52c41a", level: "fresh" };
  if (hours < 24) return { label: `${Math.floor(hours)}小时前`, color: "#faad14", level: "stale" };
  const days = Math.floor(hours / 24);
  return { label: `${days}天前`, color: "#ff4d4f", level: "expired" };
}

interface AccountStats {
  productCount: number;
  collectionTotal: number;
  collectionSuccess: number;
  collectionError: number;
  diagnostics: CollectionDiagnostics;
}

export default function AccountManager() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loginLoadingId, setLoginLoadingId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [accountsDirty, setAccountsDirty] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordModalAccountId, setPasswordModalAccountId] = useState<string | null>(null);
  const [passwordModalAutoLogin, setPasswordModalAutoLogin] = useState(false);
  const [accountStats, setAccountStats] = useState<Record<string, AccountStats>>({});
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const navigate = useNavigate();

  const api = window.electronAPI?.automation;
  const store = (window as any).electronAPI?.store;

  // 从 CollectionContext 获取实时采集状态
  const { collecting, successCount, errorCount } = useCollection();

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
  const loadAccountStats = async (targetAccountId: string) => {
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
        collectionError: diag.summary.errorCount || 0,
        diagnostics: diag,
      };
      setAccountStats((prev) => ({ ...prev, [targetAccountId]: stats }));
    } catch (error) {
      // 统计读取失败只影响该账号卡片展示，不阻塞其他账号加载
      console.warn("[AccountManager] loadAccountStats failed", error);
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
          const nextAccounts = data.map((a: Account) => ({
            ...a,
            status: a.status === "online" ? "online" as const : a.status === "logging_in" ? "offline" as const : (a.status || "offline"),
          }));
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
    if (store && hydrated && accountsDirty) {
      Promise.resolve(store.set(STORAGE_KEY, accounts)).catch((e: unknown) => {
        console.error("[AccountManager] persist accounts failed:", e);
      });
    }
  }, [accounts, accountsDirty, hydrated, store]);

  // 初始化选中账号
  useEffect(() => {
    if (hydrated && accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(activeAccountId || accounts[0].id);
    }
  }, [hydrated, accounts, activeAccountId, selectedAccountId]);

  // 加载活跃账号的数据概览
  useEffect(() => {
    if (!hydrated || !activeAccountId || !store) return;
    let cancelled = false;
    (async () => {
      try {
        const [rawProducts, rawDiag] = await Promise.all([
          getStoreValue(store, "temu_products"),
          getStoreValue(store, "temu_collection_diagnostics"),
        ]);
        if (cancelled) return;
        const products = parseProductsData(rawProducts);
        const diag = normalizeCollectionDiagnostics(rawDiag);
        const stats: AccountStats = {
          productCount: products.length,
          collectionTotal: diag.summary.totalTasks || 0,
          collectionSuccess: diag.summary.successCount || 0,
          collectionError: diag.summary.errorCount || 0,
          diagnostics: diag,
        };
        setAccountStats((prev) => ({ ...prev, [activeAccountId]: stats }));
      } catch (e) {
        if (!cancelled) console.error("[AccountManager] loadAccountStats failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, activeAccountId, store]);

  // 采集完成后刷新数据
  useEffect(() => {
    if (!collecting && activeAccountId && hydrated) {
      loadAccountStats(activeAccountId);
    }
  }, [collecting]);

  const closePasswordModal = () => {
    setPasswordModalOpen(false);
    setPasswordModalAccountId(null);
    setPasswordModalAutoLogin(false);
    passwordForm.resetFields();
  };

  const openPasswordModal = (account: Account, autoLogin = false) => {
    setPasswordModalAccountId(account.id);
    setPasswordModalAutoLogin(autoLogin);
    setPasswordModalOpen(true);
    passwordForm.resetFields();
  };

  const updateAccountPassword = (accountId: string, password: string) => {
    let updatedAccount: Account | null = null;
    setAccounts((prev) =>
      prev.map((account) => {
        if (account.id !== accountId) return account;
        updatedAccount = {
          ...account,
          password,
          passwordState: "ready",
          passwordRepairRequired: false,
        };
        return updatedAccount;
      })
    );
    setAccountsDirty(true);
    return updatedAccount;
  };

  const handleAdd = async () => {
    try {
      const values = await form.validateFields();
      const newAccount: Account = {
        id: `acc_${Date.now()}`,
        name: values.name,
        phone: values.phone,
        password: values.password,
        status: "offline",
        passwordState: "ready",
        passwordRepairRequired: false,
      };
      setAccounts((prev) => [...prev, newAccount]);
      setAccountsDirty(true);
      setSelectedAccountId(newAccount.id);
      setModalOpen(false);
      form.resetFields();
      message.success("账号添加成功");
    } catch (error) {
      // AntD form.validateFields 校验失败时抛错，错误提示已由表单组件展示
      console.warn("[AccountManager] add account validation failed", error);
    }
  };

  const performLogin = async (account: Account) => {
    if (!api) {
      message.warning("自动化模块未连接（请在 Electron 环境中运行）");
      return;
    }
    setLoginLoadingId(account.id);
    setAccounts((prev) =>
      prev.map((a) => (a.id === account.id ? { ...a, status: "logging_in" as const } : a))
    );
    setAccountsDirty(true);
    notification.info({
      key: "login",
      message: "正在启动浏览器",
      description: `正在为「${account.name}」启动浏览器并登录 Temu 卖家后台...`,
      duration: 0,
    });
    try {
      const result: any = await api.login(account.id, account.phone, account.password);
      const loginOk = !!(
        result &&
        (result.success === true ||
          (typeof result.success === "object" && result.success?.success === true))
      );
      if (loginOk) {
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
        setAccountsDirty(true);
        await setActiveAccountAndSync(store, nextAccounts, account.id);
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === account.id
              ? { ...a, status: "online" as const, lastLoginAt }
              : a
          )
        );
        setAccountsDirty(true);
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
      setAccountsDirty(true);
      notification.error({
        key: "login",
        message: "登录失败",
        description: error?.message || "请检查账号密码或手动完成验证码",
      });
    } finally {
      setLoginLoadingId(null);
    }
  };

  const handleLogin = async (account: Account) => {
    if (accountNeedsPasswordRepair(account)) {
      message.warning(getPasswordRepairMessage(account));
      openPasswordModal(account, true);
      return;
    }
    await performLogin(account);
  };

  const handleRepairPassword = async () => {
    try {
      const values = await passwordForm.validateFields();
      const accountId = passwordModalAccountId;
      if (!accountId) return;
      const targetAccount = accounts.find((account) => account.id === accountId) || null;
      const updatedAccount = updateAccountPassword(accountId, values.password);
      const shouldAutoLogin = passwordModalAutoLogin;
      closePasswordModal();
      message.success(
        targetAccount?.passwordState === "decrypt_failed"
          ? "密码已重新加密保存"
          : "密码已保存"
      );
      if (shouldAutoLogin && updatedAccount) {
        await performLogin(updatedAccount);
      }
    } catch (error) {
      console.warn("[AccountManager] repair password validation failed", error);
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
      try { await api.close(); } catch { /* 浏览器窗口关闭可容错忽略 */ }
    }
    const nextAccounts = accounts.map((a) => (a.id === id ? { ...a, status: "offline" as const } : a));
    setAccounts(nextAccounts);
    setAccountsDirty(true);
    const currentActiveId = await readActiveAccountId(store);
    if (currentActiveId === id) {
      await clearActiveAccount();
    }
    message.success("已断开连接");
  };

  const handleDelete = async (id: string) => {
    const target = accounts.find((account) => account.id === id);
    if (target?.status === "online" && api) {
      try { await api.close(); } catch { /* 浏览器窗口关闭可容错忽略 */ }
    }
    const nextAccounts = accounts.filter((a) => a.id !== id);
    setAccounts(nextAccounts);
    setAccountsDirty(true);
    if (selectedAccountId === id) {
      setSelectedAccountId(nextAccounts.length > 0 ? nextAccounts[0].id : null);
    }
    const currentActiveId = await readActiveAccountId(store);
    if (currentActiveId === id) {
      await clearActiveAccount();
    } else {
      await restoreActiveAccountData(nextAccounts);
    }
    message.success("账号已删除");
  };

  // 排序账号：活跃 > 在线 > 其它
  const sortedAccounts = useMemo(() =>
    accounts.slice().sort((a, b) => {
      if (a.id === activeAccountId) return -1;
      if (b.id === activeAccountId) return 1;
      if (a.status === "online" && b.status !== "online") return -1;
      if (b.status === "online" && a.status !== "online") return 1;
      return 0;
    }),
  [accounts, activeAccountId]);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || null;
  const selectedAccountNeedsPasswordRepair = accountNeedsPasswordRepair(selectedAccount);
  const passwordModalAccount = accounts.find((account) => account.id === passwordModalAccountId) || null;
  const selectedStats = selectedAccountId ? accountStats[selectedAccountId] : null;
  const isSelectedActive = selectedAccountId === activeAccountId;

  // 采集状态统一：活跃账号实时状态 + 持久化诊断合并
  const collectionDisplay = useMemo(() => {
    if (!selectedStats) {
      return { total: COLLECT_TASKS.length, success: 0, error: 0, syncedAt: null, isRealtime: false };
    }
    // 如果选中的是活跃账号且正在采集，用实时数据
    if (isSelectedActive && collecting) {
      return {
        total: COLLECT_TASKS.length,
        success: successCount,
        error: errorCount,
        syncedAt: selectedStats.diagnostics.syncedAt,
        isRealtime: true,
      };
    }
    // 否则用持久化的诊断数据
    return {
      total: selectedStats.collectionTotal || COLLECT_TASKS.length,
      success: selectedStats.collectionSuccess,
      error: selectedStats.collectionError,
      syncedAt: selectedStats.diagnostics.syncedAt,
      isRealtime: false,
    };
  }, [selectedStats, isSelectedActive, collecting, successCount, errorCount]);

  const freshness = getDataFreshness(collectionDisplay.syncedAt);

  // 按类别分组统计采集任务状态
  const taskCategories = useMemo(() => {
    if (!selectedStats?.diagnostics?.tasks) return [];
    const tasks = selectedStats.diagnostics.tasks;
    const categories: Record<string, { label: string; success: number; error: number; total: number }> = {
      core: { label: "核心数据", success: 0, error: 0, total: 0 },
      goods: { label: "商品", success: 0, error: 0, total: 0 },
      sales: { label: "销售/活动", success: 0, error: 0, total: 0 },
      shipping: { label: "物流", success: 0, error: 0, total: 0 },
      returns: { label: "退货", success: 0, error: 0, total: 0 },
      quality: { label: "质量", success: 0, error: 0, total: 0 },
      pricing: { label: "价格", success: 0, error: 0, total: 0 },
      flux: { label: "流量", success: 0, error: 0, total: 0 },
      govern: { label: "合规", success: 0, error: 0, total: 0 },
      ads: { label: "广告", success: 0, error: 0, total: 0 },
      other: { label: "其它", success: 0, error: 0, total: 0 },
    };
    const classify = (key: string): string => {
      if (["dashboard", "products", "orders", "sales", "flux"].includes(key)) return "core";
      if (key.startsWith("goods") || key.startsWith("lifecycle") || key.startsWith("image") || key.startsWith("sample")) return "goods";
      if (key.startsWith("activity") || key.startsWith("chance") || key.startsWith("marketing")) return "sales";
      if (key.startsWith("shipping") || key.startsWith("urgent") || key.startsWith("address")) return "shipping";
      if (key.startsWith("return") || key.startsWith("salesReturn") || key.startsWith("exception")) return "returns";
      if (key.startsWith("quality") || key.startsWith("checkup") || key.startsWith("afterSales") || key.startsWith("qc")) return "quality";
      if (key.startsWith("price") || key.startsWith("flow_price") || key.startsWith("retail") || key.startsWith("flowPrice")) return "pricing";
      if (key.startsWith("flux") || key.startsWith("mall") || key.startsWith("flow") || key.startsWith("retrieval")) return "flux";
      if (key.startsWith("govern")) return "govern";
      if (key.startsWith("ads")) return "ads";
      return "other";
    };
    for (const [key, task] of Object.entries(tasks)) {
      const cat = classify(key);
      categories[cat].total++;
      if (task.status === "success") categories[cat].success++;
      else categories[cat].error++;
    }
    return Object.entries(categories)
      .filter(([, v]) => v.total > 0)
      .map(([key, v]) => ({ key, ...v }));
  }, [selectedStats]);

  if (!hydrated) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 4 }} />
      </div>
    );
  }

  const onlineCount = accounts.filter((account) => account.status === "online").length;
  const activeAccount = accounts.find((account) => account.id === activeAccountId) || null;

  // ====== 左侧账号列表项 ======
  const renderAccountListItem = (account: Account) => {
    const isActive = activeAccountId === account.id;
    const isSelected = selectedAccountId === account.id;
    const status = statusConfig[account.status] || statusConfig.offline;

    return (
      <div
        key={account.id}
        onClick={() => setSelectedAccountId(account.id)}
        style={{
          padding: "14px 16px",
          cursor: "pointer",
          borderRadius: 12,
          marginBottom: 6,
          background: isSelected ? "#fff7f0" : "transparent",
          border: isSelected ? `1.5px solid ${TEMU_ORANGE}` : "1.5px solid transparent",
          transition: "all 0.2s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: isActive
                ? `linear-gradient(135deg, ${TEMU_ORANGE}, #ff8534)`
                : "#f5f5f5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <ShopOutlined style={{ fontSize: 17, color: isActive ? "#fff" : "#bbb" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Text strong ellipsis style={{ fontSize: 14, maxWidth: 120 }}>
                {account.name || "未命名店铺"}
              </Text>
              {isActive && (
                <Tag
                  color="orange"
                  style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px", borderRadius: 4, margin: 0 }}
                >
                  当前
                </Tag>
              )}
            </div>
            <Space size={4} style={{ marginTop: 2 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: status.dot,
                }}
              />
              <Text type="secondary" style={{ fontSize: 11 }}>{status.text}</Text>
            </Space>
          </div>
        </div>
      </div>
    );
  };

  // ====== 右侧详情面板 ======
  const renderDetailPanel = () => {
    if (!selectedAccount) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 400 }}>
          <Empty description="请选择一个账号查看详情" />
        </div>
      );
    }

    const status = statusConfig[selectedAccount.status] || statusConfig.offline;
    const isLoggingIn = loginLoadingId === selectedAccount.id;
    const completedCount = collectionDisplay.success + collectionDisplay.error;
    const progressPercent = collectionDisplay.total > 0 ? Math.round((completedCount / collectionDisplay.total) * 100) : 0;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 账号信息头部 */}
        <Card
          style={{ borderRadius: 16, border: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}
          styles={{ body: { padding: "24px 28px" } }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: isSelectedActive
                    ? `linear-gradient(135deg, ${TEMU_ORANGE}, #ff8534)`
                    : "#f5f5f5",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <ShopOutlined style={{ fontSize: 26, color: isSelectedActive ? "#fff" : "#bbb" }} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Title level={4} style={{ margin: 0 }}>
                    {selectedAccount.name || "未命名店铺"}
                  </Title>
                  <Tag
                    color={status.color as string}
                    style={{ borderRadius: 999, margin: 0 }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: status.dot,
                        marginRight: 4,
                      }}
                    />
                    {status.text}
                  </Tag>
                  {isSelectedActive && (
                    <Tag color="orange" style={{ borderRadius: 999, margin: 0 }}>
                      <CheckCircleOutlined style={{ marginRight: 4 }} />
                      当前数据视图
                    </Tag>
                  )}
                  {selectedAccountNeedsPasswordRepair && (
                    <Tag color="volcano" style={{ borderRadius: 999, margin: 0 }}>
                      <WarningOutlined style={{ marginRight: 4 }} />
                      {"\u9700\u8865\u5f55\u5bc6\u7801"}
                    </Tag>
                  )}
                </div>
                <Space size={16} style={{ marginTop: 8 }}>
                  <Space size={4}>
                    <PhoneOutlined style={{ color: "#bbb", fontSize: 13 }} />
                    <Text type="secondary">{maskPhone(selectedAccount.phone)}</Text>
                  </Space>
                  <Space size={4}>
                    <ClockCircleOutlined style={{ color: "#bbb", fontSize: 13 }} />
                    <Text type="secondary">
                      登录：{selectedAccount.lastLoginAt || "尚未登录"}
                    </Text>
                  </Space>
                </Space>
              </div>
            </div>

            {/* 操作按钮区 */}
            {selectedAccountNeedsPasswordRepair && (
              <Alert
                showIcon
                type={selectedAccount?.passwordState === "decrypt_failed" ? "warning" : "info"}
                message={getPasswordRepairMessage(selectedAccount)}
                action={
                  <Button size="small" icon={<KeyOutlined />} onClick={() => openPasswordModal(selectedAccount)}>
                    {"\u8865\u5f55\u5bc6\u7801"}
                  </Button>
                }
                style={{ flex: 1, minWidth: 320 }}
              />
            )}

            <Space size={8} wrap>
              {!isSelectedActive && (
                <Button
                  icon={<EyeOutlined />}
                  onClick={() => handleActivateAccount(selectedAccount.id)}
                  style={{ borderRadius: 10 }}
                >
                  {"\u5207\u6362\u6570\u636e\u89c6\u56fe"}
                </Button>
              )}
              <Button
                icon={<KeyOutlined />}
                onClick={() => openPasswordModal(selectedAccount)}
                style={{ borderRadius: 10 }}
              >
                {selectedAccountNeedsPasswordRepair ? "\u8865\u5f55\u5bc6\u7801" : "\u66f4\u65b0\u5bc6\u7801"}
              </Button>
              {selectedAccount.status === "online" ? (
                <Button
                  icon={<LogoutOutlined />}
                  onClick={() => handleLogout(selectedAccount.id)}
                  style={{ borderRadius: 10 }}
                >
                  {"\u65ad\u5f00\u8fde\u63a5"}
                </Button>
              ) : (
                <Button
                  type="primary"
                  icon={<LoginOutlined />}
                  loading={isLoggingIn}
                  onClick={() => handleLogin(selectedAccount)}
                  style={{
                    borderRadius: 10,
                    background: `linear-gradient(135deg, ${TEMU_ORANGE}, #ff8534)`,
                    border: "none",
                  }}
                >
                  {selectedAccountNeedsPasswordRepair ? "\u8865\u5f55\u5bc6\u7801\u5e76\u767b\u5f55" : "\u767b\u5f55"}
                </Button>
              )}
              <Popconfirm
                title={"\u786e\u5b9a\u5220\u9664\u6b64\u8d26\u53f7\uff1f"}
                description={"\u5220\u9664\u540e\u8be5\u8d26\u53f7\u7684\u91c7\u96c6\u6570\u636e\u4ecd\u4f1a\u4fdd\u7559"}
                onConfirm={() => handleDelete(selectedAccount.id)}
              >
                <Button danger icon={<DeleteOutlined />} style={{ borderRadius: 10 }}>
                  {"\u5220\u9664"}
                </Button>
              </Popconfirm>
            </Space>
          </div>
        </Card>

        {/* 数据概览 4 卡片 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {/* 商品数 */}
          <Card
            size="small"
            style={{ borderRadius: 12, border: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
            styles={{ body: { padding: "16px 20px" } }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: "#fff7f0",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <ShoppingOutlined style={{ color: TEMU_ORANGE, fontSize: 17 }} />
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>商品数</Text>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#1a1a2e", lineHeight: 1.2 }}>
                  {selectedStats?.productCount ?? "—"}
                </div>
              </div>
            </div>
          </Card>

          {/* 采集任务 — 统一数据源 */}
          <Card
            size="small"
            style={{ borderRadius: 12, border: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
            styles={{ body: { padding: "16px 20px" } }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: "#f0f5ff",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <DatabaseOutlined style={{ color: "#1890ff", fontSize: 17 }} />
              </div>
              <div style={{ flex: 1 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  采集{collectionDisplay.isRealtime ? "（进行中）" : ""}
                </Text>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#1a1a2e", lineHeight: 1.2 }}>
                  {collectionDisplay.success}
                  <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
                    /{collectionDisplay.total}
                  </Text>
                </div>
              </div>
            </div>
          </Card>

          {/* 失败任务 */}
          <Card
            size="small"
            style={{ borderRadius: 12, border: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
            styles={{ body: { padding: "16px 20px" } }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: collectionDisplay.error > 0 ? "#fff2f0" : "#f6ffed",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {collectionDisplay.error > 0
                  ? <ExclamationCircleOutlined style={{ color: "#ff4d4f", fontSize: 17 }} />
                  : <SafetyCertificateOutlined style={{ color: "#52c41a", fontSize: 17 }} />
                }
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {collectionDisplay.error > 0 ? "失败任务" : "健康状态"}
                </Text>
                <div style={{
                  fontSize: 22, fontWeight: 700, lineHeight: 1.2,
                  color: collectionDisplay.error > 0 ? "#ff4d4f" : "#52c41a",
                }}>
                  {collectionDisplay.error > 0 ? collectionDisplay.error : "正常"}
                </div>
              </div>
            </div>
          </Card>

          {/* 数据新鲜度 */}
          <Card
            size="small"
            style={{ borderRadius: 12, border: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
            styles={{ body: { padding: "16px 20px" } }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: freshness.level === "fresh" ? "#f6ffed"
                  : freshness.level === "stale" ? "#fffbe6"
                  : freshness.level === "expired" ? "#fff2f0" : "#f5f5f5",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <ClockCircleOutlined style={{ color: freshness.color, fontSize: 17 }} />
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>数据更新</Text>
                <div style={{ fontSize: freshness.level === "none" ? 14 : 22, fontWeight: 700, color: freshness.color, lineHeight: 1.2 }}>
                  {freshness.label}
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* 采集进度 + 分类健康度 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* 采集总览 */}
          <Card
            title={
              <Space>
                <SyncOutlined />
                <span>采集总览</span>
                {collectionDisplay.isRealtime && (
                  <Tag color="processing" style={{ borderRadius: 999, fontSize: 11 }}>实时</Tag>
                )}
              </Space>
            }
            size="small"
            style={{ borderRadius: 14, border: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
            styles={{ header: { borderBottom: "1px solid #f5f5f5" } }}
          >
            <div style={{ padding: "8px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  完成进度
                </Text>
                <Text strong style={{ fontSize: 12 }}>
                  {completedCount}/{collectionDisplay.total}
                </Text>
              </div>
              <Progress
                percent={progressPercent}
                strokeColor={collectionDisplay.error > 0 ? { "0%": TEMU_ORANGE, "100%": "#ff4d4f" } : TEMU_ORANGE}
                size="small"
                status={collectionDisplay.isRealtime ? "active" : undefined}
              />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
                <Space size={4}>
                  <CheckCircleOutlined style={{ color: "#52c41a", fontSize: 13 }} />
                  <Text style={{ fontSize: 12, color: "#52c41a" }}>{collectionDisplay.success} 成功</Text>
                </Space>
                <Space size={4}>
                  <ExclamationCircleOutlined style={{ color: collectionDisplay.error > 0 ? "#ff4d4f" : "#d9d9d9", fontSize: 13 }} />
                  <Text style={{ fontSize: 12, color: collectionDisplay.error > 0 ? "#ff4d4f" : "#8c8c8c" }}>
                    {collectionDisplay.error} 失败
                  </Text>
                </Space>
              </div>
              {collectionDisplay.syncedAt && (
                <div style={{ marginTop: 12, padding: "8px 12px", background: "#fafafa", borderRadius: 8 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    上次采集时间：{collectionDisplay.syncedAt}
                  </Text>
                </div>
              )}
            </div>
          </Card>

          {/* 分类健康度 */}
          <Card
            title={
              <Space>
                <ThunderboltOutlined />
                <span>数据健康度</span>
              </Space>
            }
            size="small"
            style={{ borderRadius: 14, border: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
            styles={{ header: { borderBottom: "1px solid #f5f5f5" } }}
          >
            {taskCategories.length === 0 ? (
              <div style={{ padding: "20px 0", textAlign: "center" }}>
                <Text type="secondary" style={{ fontSize: 12 }}>暂无采集数据</Text>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
                {taskCategories.map((cat) => (
                  <div key={cat.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 12, width: 64, flexShrink: 0 }}>{cat.label}</Text>
                    <div style={{ flex: 1 }}>
                      <Progress
                        percent={Math.round((cat.success / cat.total) * 100)}
                        size="small"
                        strokeColor={cat.error > 0 ? "#faad14" : "#52c41a"}
                        showInfo={false}
                        style={{ marginBottom: 0 }}
                      />
                    </div>
                    <Text
                      style={{
                        fontSize: 11,
                        color: cat.error > 0 ? "#faad14" : "#52c41a",
                        width: 36,
                        textAlign: "right",
                        flexShrink: 0,
                      }}
                    >
                      {cat.success}/{cat.total}
                    </Text>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* 快捷操作 */}
        <Card
          title={
            <Space>
              <ThunderboltOutlined />
              <span>快捷操作</span>
            </Space>
          }
          size="small"
          style={{ borderRadius: 14, border: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
          styles={{ header: { borderBottom: "1px solid #f5f5f5" } }}
        >
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "8px 0" }}>
            <Button
              icon={<SyncOutlined />}
              onClick={() => navigate("/collect")}
              style={{ borderRadius: 10 }}
              disabled={selectedAccount.status !== "online"}
            >
              一键采集
            </Button>
            <Button
              icon={<DashboardOutlined />}
              onClick={() => navigate("/shop")}
              style={{ borderRadius: 10 }}
            >
              查看店铺概览
            </Button>
            <Button
              icon={<ShoppingOutlined />}
              onClick={() => navigate("/products")}
              style={{ borderRadius: 10 }}
            >
              查看商品
            </Button>
            {freshness.level === "expired" && (
              <Tooltip title="数据已超过24小时未更新，建议重新采集">
                <Tag
                  color="error"
                  icon={<WarningOutlined />}
                  style={{ borderRadius: 8, display: "flex", alignItems: "center", height: 32 }}
                >
                  数据过期，建议重新采集
                </Tag>
              </Tooltip>
            )}
          </div>
        </Card>
      </div>
    );
  };

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
        <div style={{ display: "flex", gap: 16, minHeight: 500 }}>
          {/* 左侧账号列表 */}
          <div
            style={{
              width: 240,
              flexShrink: 0,
              background: "#fff",
              borderRadius: 16,
              padding: "12px 10px",
              boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
              overflowY: "auto",
              maxHeight: "calc(100vh - 260px)",
            }}
          >
            <Text
              type="secondary"
              style={{ fontSize: 11, padding: "4px 8px", display: "block", marginBottom: 4 }}
            >
              全部账号 ({accounts.length})
            </Text>
            {sortedAccounts.map(renderAccountListItem)}
            <Divider style={{ margin: "8px 0" }} />
            <div
              onClick={() => setModalOpen(true)}
              style={{
                padding: "10px 16px",
                cursor: "pointer",
                borderRadius: 10,
                textAlign: "center",
                border: "1px dashed #e0e0e0",
                color: "#8c8c8c",
                fontSize: 13,
                transition: "all 0.2s",
              }}
            >
              <PlusOutlined style={{ marginRight: 4 }} />
              添加账号
            </div>
          </div>

          {/* 右侧详情面板 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {renderDetailPanel()}
          </div>
        </div>
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

      <Modal
        title={passwordModalAccount ? `\u8865\u5f55\u300c${passwordModalAccount.name}\u300d\u7684\u767b\u5f55\u5bc6\u7801` : "\u8865\u5f55\u767b\u5f55\u5bc6\u7801"}
        open={passwordModalOpen}
        onOk={handleRepairPassword}
        onCancel={closePasswordModal}
        okText={passwordModalAutoLogin ? "\u4fdd\u5b58\u5e76\u767b\u5f55" : "\u4fdd\u5b58"}
        cancelText="\u53d6\u6d88"
        styles={{ body: { paddingTop: 16 } }}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            showIcon
            type={passwordModalAccount?.passwordState === "decrypt_failed" ? "warning" : "info"}
            message={getPasswordRepairMessage(passwordModalAccount)}
          />
          {passwordModalAccount && (
            <Text type="secondary">
              {`\u8d26\u53f7\uff1a${passwordModalAccount.name} | \u624b\u673a\u53f7\uff1a${maskPhone(passwordModalAccount.phone)}`}
            </Text>
          )}
          <Form form={passwordForm} layout="vertical">
            <Form.Item
              name="password"
              label="\u767b\u5f55\u5bc6\u7801"
              rules={[{ required: true, message: "\u8bf7\u8f93\u5165\u767b\u5f55\u5bc6\u7801" }]}
            >
              <Input.Password placeholder="\u8bf7\u8f93\u5165\u6700\u65b0\u767b\u5f55\u5bc6\u7801" style={{ borderRadius: 8 }} />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </div>
  );
}
