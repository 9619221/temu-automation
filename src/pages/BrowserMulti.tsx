import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from "antd";
import {
  CheckCircleFilled,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  PlayCircleFilled,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import type { BrowserMultiAccount, BrowserMultiConfig } from "../types/electron";

const ACCOUNTS_STORAGE_KEY = "temu_browser_profiles";
const CONFIG_STORAGE_KEY = "temu_browser_profiles_config";

function uid() {
  return "bm" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function lineListToArray(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function BrowserMulti() {
  const api = window.electronAPI;
  const store = api?.store;
  const browserMulti = api?.browserMulti;

  const [accounts, setAccounts] = useState<BrowserMultiAccount[]>([]);
  const [config, setConfig] = useState<BrowserMultiConfig>({ chromePath: "", sharedExtensions: [] });
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [accountForm] = Form.useForm<BrowserMultiAccount & { extraExtensionsText?: string }>();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm] = Form.useForm<{ chromePath: string; sharedExtensionsText: string }>();

  const refreshRunningTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshRunning = useCallback(async () => {
    if (!browserMulti) return;
    try {
      const ids = await browserMulti.listRunning();
      setRunning((prev) => {
        const next = new Set<string>(ids);
        if (prev.size === next.size && [...prev].every((v) => next.has(v))) {
          return prev;
        }
        return next;
      });
    } catch (e) {
      console.warn("[BrowserMulti] listRunning failed", e);
    }
  }, [browserMulti]);

  useEffect(() => {
    if (!store) return;
    (async () => {
      const [savedAccounts, savedConfig] = await Promise.all([
        store.get(ACCOUNTS_STORAGE_KEY),
        store.get(CONFIG_STORAGE_KEY),
      ]);
      if (Array.isArray(savedAccounts)) setAccounts(savedAccounts as BrowserMultiAccount[]);
      if (savedConfig && typeof savedConfig === "object") {
        setConfig({
          chromePath: typeof savedConfig.chromePath === "string" ? savedConfig.chromePath : "",
          sharedExtensions: Array.isArray(savedConfig.sharedExtensions) ? savedConfig.sharedExtensions : [],
        });
      } else if (browserMulti) {
        const auto = await browserMulti.findChrome();
        if (auto) setConfig((prev) => ({ ...prev, chromePath: auto }));
      }
      setHydrated(true);
    })();
  }, [store, browserMulti]);

  useEffect(() => {
    refreshRunning();
    refreshRunningTimer.current = setInterval(refreshRunning, 2500);
    return () => {
      if (refreshRunningTimer.current) clearInterval(refreshRunningTimer.current);
    };
  }, [refreshRunning]);

  const persistAccounts = useCallback(
    async (next: BrowserMultiAccount[]) => {
      setAccounts(next);
      if (store) await store.set(ACCOUNTS_STORAGE_KEY, next);
    },
    [store],
  );

  const persistConfig = useCallback(
    async (next: BrowserMultiConfig) => {
      setConfig(next);
      if (store) await store.set(CONFIG_STORAGE_KEY, next);
    },
    [store],
  );

  const openEditor = useCallback(
    (acc: BrowserMultiAccount | null) => {
      setEditingId(acc?.id ?? null);
      accountForm.resetFields();
      accountForm.setFieldsValue({
        id: acc?.id || "",
        name: acc?.name || "",
        group: acc?.group || "",
        startUrl: acc?.startUrl || "",
        proxy: acc?.proxy || "",
        userAgent: acc?.userAgent || "",
        note: acc?.note || "",
        extraExtensionsText: (acc?.extraExtensions || []).join("\n"),
      });
      setEditorOpen(true);
    },
    [accountForm],
  );

  const submitAccount = useCallback(async () => {
    const values = await accountForm.validateFields();
    const payload: BrowserMultiAccount = {
      id: editingId || uid(),
      name: (values.name || "").trim(),
      group: (values.group || "").trim() || undefined,
      startUrl: (values.startUrl || "").trim() || undefined,
      proxy: (values.proxy || "").trim() || undefined,
      userAgent: (values.userAgent || "").trim() || undefined,
      note: (values.note || "").trim() || undefined,
      extraExtensions: lineListToArray(values.extraExtensionsText || ""),
    };
    let next: BrowserMultiAccount[];
    if (editingId) {
      next = accounts.map((a) => (a.id === editingId ? payload : a));
    } else {
      next = [...accounts, payload];
    }
    await persistAccounts(next);
    setEditorOpen(false);
    message.success(editingId ? "已更新" : "已新增");
  }, [accountForm, editingId, accounts, persistAccounts]);

  const handleLaunch = useCallback(
    async (acc: BrowserMultiAccount) => {
      if (!browserMulti) return;
      try {
        await browserMulti.launch(acc, config);
        message.success(`已启动「${acc.name}」`);
        setTimeout(refreshRunning, 1500);
      } catch (e: any) {
        message.error(e?.message || String(e));
      }
    },
    [browserMulti, config, refreshRunning],
  );

  const handleClose = useCallback(
    async (acc: BrowserMultiAccount) => {
      if (!browserMulti) return;
      await browserMulti.close(acc.id);
      message.success(`已关闭「${acc.name}」`);
      setTimeout(refreshRunning, 800);
    },
    [browserMulti, refreshRunning],
  );

  const handleDelete = useCallback(
    async (acc: BrowserMultiAccount) => {
      if (!browserMulti) return;
      const next = accounts.filter((a) => a.id !== acc.id);
      await persistAccounts(next);
      const result = await browserMulti.deleteProfile(acc.id);
      if (result && result.ok === false) {
        message.warning(
          `账号已删除，但数据目录清理失败（Chrome 可能仍在运行）。可关掉 Chrome 后手动删除：${result.dir || ""}`,
        );
      } else {
        message.success("已删除");
      }
    },
    [accounts, browserMulti, persistAccounts],
  );

  const batchLaunch = useCallback(async () => {
    if (!browserMulti) return;
    if (selectedIds.length === 0) {
      message.info("请先勾选要启动的账号");
      return;
    }
    let ok = 0;
    let fail = 0;
    for (const id of selectedIds) {
      const acc = accounts.find((a) => a.id === id);
      if (!acc) continue;
      if (running.has(id)) continue;
      try {
        await browserMulti.launch(acc, config);
        ok++;
      } catch {
        fail++;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    message.success(`批量启动完成：成功 ${ok}${fail ? `，失败 ${fail}` : ""}`);
    setTimeout(refreshRunning, 1500);
  }, [accounts, browserMulti, config, refreshRunning, running, selectedIds]);

  const openSettings = useCallback(() => {
    settingsForm.setFieldsValue({
      chromePath: config.chromePath || "",
      sharedExtensionsText: (config.sharedExtensions || []).join("\n"),
    });
    setSettingsOpen(true);
  }, [config, settingsForm]);

  const submitSettings = useCallback(async () => {
    const values = await settingsForm.validateFields();
    await persistConfig({
      chromePath: (values.chromePath || "").trim(),
      sharedExtensions: lineListToArray(values.sharedExtensionsText || ""),
    });
    setSettingsOpen(false);
    message.success("已保存");
  }, [settingsForm, persistConfig]);

  const pickChromePath = useCallback(async () => {
    if (!browserMulti) return;
    const p = await browserMulti.pickFile({
      filters: [{ name: "可执行文件", extensions: ["exe"] }],
    });
    if (p) settingsForm.setFieldsValue({ chromePath: p });
  }, [browserMulti, settingsForm]);

  const filteredAccounts = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) =>
      [a.name, a.group, a.note, a.proxy].filter(Boolean).some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [accounts, searchText]);

  const columns = useMemo(
    () => [
      {
        title: "名称",
        dataIndex: "name",
        key: "name",
        render: (text: string, record: BrowserMultiAccount) => (
          <div>
            <div style={{ fontWeight: 600 }}>{text}</div>
            {record.note ? (
              <div style={{ color: "#888", fontSize: 12, marginTop: 2 }}>{record.note}</div>
            ) : null}
          </div>
        ),
      },
      {
        title: "分组",
        dataIndex: "group",
        key: "group",
        width: 120,
        render: (g?: string) => (g ? <Tag>{g}</Tag> : <span style={{ color: "#bbb" }}>—</span>),
      },
      {
        title: "状态",
        key: "status",
        width: 120,
        render: (_: unknown, record: BrowserMultiAccount) =>
          running.has(record.id) ? (
            <Tag icon={<CheckCircleFilled />} color="success">
              运行中
            </Tag>
          ) : (
            <Tag>未启动</Tag>
          ),
      },
      {
        title: "代理",
        dataIndex: "proxy",
        key: "proxy",
        width: 200,
        ellipsis: true,
        render: (p?: string) => p || <span style={{ color: "#bbb" }}>—</span>,
      },
      {
        title: "操作",
        key: "actions",
        width: 320,
        render: (_: unknown, record: BrowserMultiAccount) => (
          <Space size="small">
            {running.has(record.id) ? (
              <Button
                size="small"
                danger
                icon={<StopOutlined />}
                onClick={() => handleClose(record)}
              >
                关闭
              </Button>
            ) : (
              <Button
                size="small"
                type="primary"
                icon={<PlayCircleFilled />}
                onClick={() => handleLaunch(record)}
              >
                启动
              </Button>
            )}
            <Button size="small" icon={<EditOutlined />} onClick={() => openEditor(record)}>
              编辑
            </Button>
            <Tooltip title="打开 user-data-dir">
              <Button
                size="small"
                icon={<FolderOpenOutlined />}
                onClick={() => browserMulti?.openProfileDir(record.id)}
              />
            </Tooltip>
            <Popconfirm
              title="删除该账号？"
              description="包含浏览器数据目录（cookies / 历史）"
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={() => handleDelete(record)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [browserMulti, handleClose, handleDelete, handleLaunch, openEditor, running],
  );

  if (!api) {
    return <div style={{ padding: 24 }}>未运行在 Electron 环境，无法使用浏览器多开。</div>;
  }

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Space>
          <Input.Search
            placeholder="搜索名称 / 分组 / 备注 / 代理"
            allowClear
            style={{ width: 320 }}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <Button icon={<ReloadOutlined />} onClick={refreshRunning}>
            刷新状态
          </Button>
        </Space>
        <Space>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => openEditor(null)}>
            新增账号
          </Button>
          <Button onClick={batchLaunch}>批量启动</Button>
          <Button icon={<SettingOutlined />} onClick={openSettings}>
            设置
          </Button>
        </Space>
      </Space>

      <Table
        rowKey="id"
        loading={!hydrated}
        columns={columns as any}
        dataSource={filteredAccounts}
        size="middle"
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as string[]),
        }}
        locale={{ emptyText: hydrated ? "暂无账号，点【新增账号】开始" : "加载中..." }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }}
      />

      <Modal
        title={editingId ? "编辑账号" : "新增账号"}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={submitAccount}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        <Form form={accountForm} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入账号名称" }]}>
            <Input placeholder="如：温州主店" />
          </Form.Item>
          <Form.Item label="分组" name="group">
            <Input placeholder="如：北京仓 / 广州仓（可空）" />
          </Form.Item>
          <Form.Item label="启动 URL" name="startUrl">
            <Input placeholder="如：https://seller.kuajingmaihuo.com/（可空）" />
          </Form.Item>
          <Form.Item label="代理" name="proxy">
            <Input placeholder="socks5://127.0.0.1:1080 或 http://user:pass@host:port（可空）" />
          </Form.Item>
          <Form.Item label="User-Agent" name="userAgent">
            <Input placeholder="留空使用 Chrome 默认" />
          </Form.Item>
          <Form.Item
            label="该账号专属扩展（每行一个解压后的目录路径）"
            name="extraExtensionsText"
            extra="通用扩展请到【设置】里配全局共享"
          >
            <Input.TextArea rows={2} placeholder="C:\path\to\ext1" />
          </Form.Item>
          <Form.Item label="备注" name="note">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title="浏览器多开 — 全局设置"
        width={520}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setSettingsOpen(false)}>取消</Button>
            <Button type="primary" onClick={submitSettings}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={settingsForm} layout="vertical">
          <Form.Item
            label="Chrome / Edge 路径"
            name="chromePath"
            extra="留空 = 自动检测系统已装的 Chrome/Edge"
          >
            <Input
              placeholder="自动检测"
              addonAfter={
                <Button size="small" type="link" onClick={pickChromePath} style={{ padding: 0 }}>
                  浏览
                </Button>
              }
            />
          </Form.Item>
          <Form.Item
            label="共享扩展（每行一个解压后的目录路径）"
            name="sharedExtensionsText"
            extra="所有账号公用的扩展，比如指纹切换、cookie 管理器等。更新一处即可。"
          >
            <Input.TextArea rows={6} placeholder="C:\path\to\shared-ext1" />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
