import { useState, useEffect } from "react";
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Space,
  Tag,
  Popconfirm,
  message,
  notification,
} from "antd";
import { PlusOutlined, LoginOutlined, DeleteOutlined, LogoutOutlined, EyeOutlined, LoadingOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import {
  ACTIVE_ACCOUNT_CHANGED_EVENT,
  emitActiveAccountChanged,
  readActiveAccountId,
  setActiveAccountAndSync,
  syncScopedDataToGlobalStore,
  writeActiveAccountId,
} from "../utils/multiStore";

interface Account {
  id: string;
  name: string;
  phone: string;
  password: string;
  status: "online" | "offline" | "logging_in" | "error";
  lastLoginAt?: string;
}

const statusMap = {
  online: { color: "green", text: "在线" },
  offline: { color: "default", text: "离线" },
  logging_in: { color: "processing", text: "登录中..." },
  error: { color: "red", text: "异常" },
};

const STORAGE_KEY = "temu_accounts";

export default function AccountManager() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loginLoadingId, setLoginLoadingId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [form] = Form.useForm();

  const api = window.electronAPI?.automation;
  const store = (window as any).electronAPI?.store;

  const clearActiveAccount = async () => {
    if (!store) return;
    setActiveAccountId(null);
    await writeActiveAccountId(store, null);
    await syncScopedDataToGlobalStore(store, null);
    emitActiveAccountChanged(null);
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

  // 启动时从文件加载账号
  useEffect(() => {
    let cancelled = false;

    const hydrateAccounts = async () => {
      if (!store) {
        if (!cancelled) {
          setHydrated(true);
        }
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
        if (!cancelled) {
          setHydrated(true);
        }
      }
    };

    hydrateAccounts().catch(() => {
      if (!cancelled) {
        setHydrated(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [store]);

  // 账号变化时保存到文件
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

  const columns: ColumnsType<Account> = [
    {
      title: "店铺名称",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "手机号",
      dataIndex: "phone",
      key: "phone",
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (status: keyof typeof statusMap) => (
        <Space size={6}>
          <Tag color={statusMap[status]?.color}>{statusMap[status]?.text}</Tag>
        </Space>
      ),
    },
    {
      title: "上次登录",
      dataIndex: "lastLoginAt",
      key: "lastLoginAt",
      render: (text: string) => text || "-",
    },
    {
      title: "操作",
      key: "actions",
      render: (_, record) => (
        <Space>
          {record.status === "online" ? (
            <Button
              type="link"
              icon={<LogoutOutlined />}
              onClick={() => handleLogout(record.id)}
            >
              断开
            </Button>
          ) : (
            <Button
              type="link"
              icon={<LoginOutlined />}
              loading={loginLoadingId === record.id}
              onClick={() => handleLogin(record)}
            >
              登录
            </Button>
          )}
          <Button
            type="link"
            icon={<EyeOutlined />}
            disabled={activeAccountId === record.id}
            onClick={() => handleActivateAccount(record.id)}
          >
            {activeAccountId === record.id ? "当前数据" : "切换数据"}
          </Button>
          <Popconfirm
            title="确定删除此账号？"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

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
      // 表单验证失败
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
        const nextAccounts = accounts.map((a) =>
          a.id === account.id
            ? { ...a, status: "online" as const, lastLoginAt }
            : { ...a, status: "offline" as const }
        );
        setAccounts(nextAccounts);
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

    if (activeAccountId === id) {
      return;
    }

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
      try {
        await api.close();
      } catch {}
    }
    const nextAccounts = accounts.map((a) => (a.id === id ? { ...a, status: "offline" as const } : a));
    setAccounts(nextAccounts);
    const activeAccountId = await readActiveAccountId(store);
    if (activeAccountId === id) {
      await clearActiveAccount();
    }
    message.success("已断开连接");
  };

  const handleDelete = async (id: string) => {
    const target = accounts.find((account) => account.id === id);
    if (target?.status === "online" && api) {
      try {
        await api.close();
      } catch {}
    }
    const nextAccounts = accounts.filter((a) => a.id !== id);
    setAccounts(nextAccounts);
    const activeAccountId = await readActiveAccountId(store);
    if (activeAccountId === id) {
      await clearActiveAccount();
    } else {
      await restoreActiveAccountData(nextAccounts);
    }
    message.success("账号已删除");
  };

  if (!hydrated) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0" }}>
        <LoadingOutlined style={{ fontSize: 24 }} />
        <div style={{ marginTop: 12, color: "#999" }}>加载账号数据...</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
        >
          添加账号
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={accounts}
        rowKey="id"
        locale={{ emptyText: "暂无账号，请点击上方按钮添加" }}
      />

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
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="店铺名称"
            rules={[{ required: true, message: "请输入店铺名称" }]}
          >
            <Input placeholder="例：我的Temu店铺" />
          </Form.Item>
          <Form.Item
            name="phone"
            label="手机号"
            rules={[
              { required: true, message: "请输入手机号" },
              { pattern: /^1[3-9]\d{9}$/, message: "请输入有效的手机号" },
            ]}
          >
            <Input placeholder="请输入手机号" maxLength={11} />
          </Form.Item>
          <Form.Item
            name="password"
            label="登录密码"
            rules={[{ required: true, message: "请输入登录密码" }]}
          >
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
