import { useEffect, useState } from "react";
import { Form, InputNumber, Switch, Button, Tag, Progress, Space, Typography, message } from "antd";
import { CloudDownloadOutlined, CheckCircleOutlined, SyncOutlined, ReloadOutlined, LinkOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import { useErpAuth } from "../contexts/ErpAuthContext";

const { Text } = Typography;
const appAPI = window.electronAPI?.app;
const erp = window.electronAPI?.erp;
const store = window.electronAPI?.store;

export default function Settings() {
  const [form] = Form.useForm();
  const [version, setVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<any>({ status: "idle", message: "" });
  const [clientStatus, setClientStatus] = useState<{ isClientMode?: boolean; serverUrl?: string } | null>(null);
  const auth = useErpAuth();
  const isAdmin = auth.currentUser?.role === "admin";

  useEffect(() => {
    appAPI?.getVersion().then(setVersion).catch(() => {});
    appAPI?.getUpdateStatus?.().then(setUpdateStatus).catch(() => {});
    erp?.client?.getStatus?.().then((status: any) => setClientStatus(status || null)).catch(() => {});
    const unsub = window.electronAPI?.onUpdateStatus?.((data: any) => setUpdateStatus(data));
    return () => { unsub?.(); };
  }, []);

  const open1688AuthPage = async () => {
    const serverUrl = String(clientStatus?.serverUrl || "").replace(/\/+$/, "");
    if (!serverUrl) {
      message.warning("当前不是客户端模式，或主控端地址未配置，请先在登录页连接到主控端。");
      return;
    }
    const target = `${serverUrl}/1688`;
    try {
      await appAPI?.openExternal?.(target);
      message.info("已在浏览器打开 1688 授权管理页面，请用 admin 账号登录后操作。");
    } catch (e: any) {
      message.error(e?.message || "打开 1688 授权页面失败");
    }
  };

  useEffect(() => {
    store?.get("temu_app_settings").then((data: any) => {
      if (data && typeof data === "object") form.setFieldsValue(data);
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    const values = form.getFieldsValue();
    await store?.set("temu_app_settings", values);
    message.success("设置已保存");
  };

  const handleCheckUpdate = async () => {
    try {
      const result = await appAPI?.checkForUpdates?.();
      if (result) setUpdateStatus(result);
    } catch (e: any) {
      message.error(e?.message || "检查更新失败");
    }
  };

  const handleDownloadUpdate = async () => {
    try {
      await appAPI?.downloadUpdate?.();
    } catch (e: any) {
      message.error(e?.message || "下载失败");
    }
  };

  const handleInstall = () => {
    appAPI?.quitAndInstallUpdate?.();
  };

  const handleManualDownload = async () => {
    const url = updateStatus.manualDownloadUrl;
    if (!url) return;
    try {
      await appAPI?.openExternal?.(url);
    } catch (e: any) {
      message.error(e?.message || "打开下载链接失败");
    }
  };

  return (
    <div className="dashboard-shell" style={{ maxWidth: 680 }}>
      <PageHeader
        compact
        eyebrow="系统"
        title="设置"
        subtitle="浏览器参数与账号配置"
        meta={[version ? `v${version}` : "开发模式"]}
      />

      <div className="app-panel" style={{ marginBottom: 16 }}>
        <div className="app-panel__title">
          <div className="app-panel__title-main">版本与更新</div>
        </div>
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Text>当前版本</Text>
            <Text strong>{version || "开发模式"}</Text>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Text>更新状态</Text>
            {updateStatus.status === "up-to-date" && <Tag icon={<CheckCircleOutlined />} color="success">已是最新</Tag>}
            {updateStatus.status === "available" && <Tag color="blue">发现新版本 {updateStatus.releaseVersion}</Tag>}
            {updateStatus.status === "downloading" && <Tag icon={<SyncOutlined spin />} color="processing">下载中</Tag>}
            {updateStatus.status === "downloaded" && <Tag icon={<CloudDownloadOutlined />} color="orange">更新已就绪</Tag>}
            {updateStatus.status === "error" && <Tag color="error" title={updateStatus.message}>更新失败：{updateStatus.message || "未知错误"}</Tag>}
            {(updateStatus.status === "idle" || updateStatus.status === "dev") && <Tag>{updateStatus.message || "未检查"}</Tag>}
          </div>

          {updateStatus.status === "downloading" && updateStatus.progressPercent != null && (
            <Progress percent={updateStatus.progressPercent} strokeColor="var(--color-brand)" size="small" />
          )}

          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={handleCheckUpdate} disabled={updateStatus.status === "downloading"}>
              检查更新
            </Button>
            {updateStatus.status === "available" && (
              <Button type="primary" icon={<CloudDownloadOutlined />} onClick={handleDownloadUpdate}>
                下载更新
              </Button>
            )}
            {updateStatus.status === "downloaded" && (
              <Button type="primary" icon={<CloudDownloadOutlined />} onClick={handleInstall}>
                立即安装更新
              </Button>
            )}
            {updateStatus.status === "error" && updateStatus.manualDownloadUrl && (
              <Button
                icon={<CloudDownloadOutlined />}
                onClick={handleManualDownload}
              >
                手动下载最新版
              </Button>
            )}
          </Space>

          {updateStatus.status === "error" && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              若自动更新多次失败,可点击"手动下载最新版"从镜像站点直接下载安装包。
            </Text>
          )}
        </Space>
      </div>

      {isAdmin && clientStatus?.isClientMode && clientStatus?.serverUrl ? (
        <div className="app-panel" style={{ marginBottom: 16 }}>
          <div className="app-panel__title">
            <div className="app-panel__title-main">1688 授权管理</div>
          </div>
          <Space direction="vertical" style={{ width: "100%" }} size={10}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              切换 1688 买家账号、刷新 access_token、重新走 OAuth 授权 — 全部在主控端 web 页完成。
              点下面按钮会在浏览器打开主控端的 1688 授权管理页面（需要用 admin 账号登录主控端）。
            </Text>
            <Space>
              <Button icon={<LinkOutlined />} onClick={open1688AuthPage}>
                打开 1688 授权管理页面
              </Button>
              <Text type="secondary" style={{ fontSize: 12 }}>
                目标：<code>{clientStatus.serverUrl}/1688</code>
              </Text>
            </Space>
          </Space>
        </div>
      ) : null}

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          operationDelay: 1500,
          maxRetries: 3,
          headless: false,
          autoLoginRetry: true,
          screenshotOnError: true,
        }}
      >
        <div className="app-panel" style={{ marginBottom: 16 }}>
          <div className="app-panel__title">
            <div className="app-panel__title-main">浏览器设置</div>
          </div>
          <Form.Item name="operationDelay" label="操作间隔（毫秒）" help="每次操作之间的随机等待时间基准值，越大越安全但越慢">
            <InputNumber min={500} max={10000} step={100} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="maxRetries" label="最大重试次数" help="操作失败后的重试次数">
            <InputNumber min={1} max={10} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="headless" label="无头模式" valuePropName="checked" help="开启后浏览器在后台运行，不显示窗口">
            <Switch />
          </Form.Item>
          <Form.Item name="screenshotOnError" label="错误截图" valuePropName="checked" help="操作出错时自动截图保存，便于排查问题">
            <Switch />
          </Form.Item>
        </div>

        <div className="app-panel" style={{ marginBottom: 16 }}>
          <div className="app-panel__title">
            <div className="app-panel__title-main">账号设置</div>
          </div>
          <Form.Item name="autoLoginRetry" label="自动重新登录" valuePropName="checked" help="登录态过期时自动重新登录">
            <Switch />
          </Form.Item>
        </div>

        <Button type="primary" onClick={handleSave}>
          保存设置
        </Button>
      </Form>
    </div>
  );
}
