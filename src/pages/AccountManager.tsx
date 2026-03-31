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
import { PlusOutlined, LoginOutlined, DeleteOutlined, LogoutOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

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
  const [modalOpen, setModalOpen] = useState(false);
  const [loginLoadingId, setLoginLoadingId] = useState<string | null>(null);
  const [form] = Form.useForm();

  const api = window.electronAPI?.automation;
  const store = (window as any).electronAPI?.store;

  // 启动时从文件加载账号
  useEffect(() => {
    if (store) {
      store.get(STORAGE_KEY).then((data: Account[] | null) => {
        if (data && Array.isArray(data)) {
          setAccounts(data.map((a: Account) => ({ ...a, status: "offline" as const })));
        }
      });
    }
  }, []);

  // 账号变化时保存到文件
  useEffect(() => {
    if (store && accounts.length > 0) {
      store.set(STORAGE_KEY, accounts);
    }
  }, [accounts]);

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
        <Tag color={statusMap[status]?.color}>{statusMap[status]?.text}</Tag>
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
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === account.id
              ? { ...a, status: "online" as const, lastLoginAt: new Date().toLocaleString() }
              : a
          )
        );
        notification.success({
          key: "login",
          message: "登录成功",
          description: `「${account.name}」已成功登录 Temu 卖家后台`,
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

  const handleLogout = async (id: string) => {
    if (api) {
      try {
        await api.close();
      } catch {}
    }
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "offline" as const } : a))
    );
    message.success("已断开连接");
  };

  const handleDelete = (id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    message.success("账号已删除");
  };

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
