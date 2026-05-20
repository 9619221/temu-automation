import { useEffect, useState } from "react";
import { Form, Input, InputNumber, Switch, Button, Tag, Progress, Space, Typography, message } from "antd";
import { CloudDownloadOutlined, CheckCircleOutlined, SyncOutlined, ReloadOutlined, LinkOutlined, ApiOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { clearCloudConfig, loadCloudConfig, saveCloudConfig } from "../utils/cloudClient";
import { normalizeExtensionInstallUrl, openExternalUrl } from "../utils/extensionInstall";

const { Text } = Typography;

const appAPI = window.electronAPI?.app;
const store = window.electronAPI?.store;

export default function Settings() {
  const [form] = Form.useForm();
  const [version, setVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<any>({ status: "idle", message: "" });
  useEffect(() => {
    appAPI?.getVersion().then(setVersion).catch(() => {});
    appAPI?.getUpdateStatus?.().then(setUpdateStatus).catch(() => {});
    const unsub = window.electronAPI?.onUpdateStatus?.((data: any) => setUpdateStatus(data));
    return () => { unsub?.(); };
  }, []);

  useEffect(() => {
    store?.get("temu_app_settings").then((data: any) => {
      if (data && typeof data === "object") form.setFieldsValue(data);
    }).catch(() => {});
    loadCloudConfig().then((cfg) => {
      if (cfg) {
        form.setFieldsValue({
          cloudEndpoint: cfg.endpoint,
          cloudToken: cfg.token,
        });
      }
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    const values = form.getFieldsValue();
    await store?.set("temu_app_settings", values);
    if (values.cloudEndpoint && values.cloudToken) {
      await saveCloudConfig({
        endpoint: values.cloudEndpoint,
        token: values.cloudToken,
      });
    } else if (!values.cloudEndpoint && !values.cloudToken) {
      await clearCloudConfig();
    }
    message.success("设置已保存");
  };

  const handleOpenExtensionInstall = async () => {
    const url = normalizeExtensionInstallUrl(form.getFieldValue("extensionPackageUrl"))
      || normalizeExtensionInstallUrl(form.getFieldValue("extensionInstallUrl"));
    if (!url) {
      message.warning("请先填写有效的扩展文件或 Chrome Web Store 安装链接");
      return;
    }
    try {
      await openExternalUrl(url);
    } catch (e: any) {
      message.error(e?.message || "打开扩展链接失败");
    }
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

          {updateStatus.feedUrl ? (
            <Text type="secondary" style={{ fontSize: 12, wordBreak: "break-all" }}>
              更新源：<code>{updateStatus.feedUrl}</code>
              {updateStatus.proxyRules ? <> · 代理：<code>{updateStatus.proxyRules}</code></> : null}
            </Text>
          ) : null}

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

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          operationDelay: 1500,
          maxRetries: 3,
          headless: false,
          autoLoginRetry: true,
          screenshotOnError: true,
          updateFeedUrl: "",
          updateProxyRules: "",
        }}
      >
        <div className="app-panel" style={{ marginBottom: 16 }}>
          <div className="app-panel__title">
            <div>
              <div className="app-panel__title-main">更新网络</div>
              <div className="app-panel__title-sub">更新下载专用，不影响采集浏览器。</div>
            </div>
          </div>
          <Form.Item
            name="updateFeedUrl"
            label="更新源 URL"
            help="留空使用默认 GitHub Release 镜像。自定义源需要是包含 latest.yml 的 generic feed 目录。"
          >
            <Input placeholder="https://gh-proxy.com/https://github.com/9619221/temu-automation/releases/latest/download/" />
          </Form.Item>
          <Form.Item
            name="updateProxyRules"
            label="更新代理"
            help="可填 http://127.0.0.1:7890 或 socks5://127.0.0.1:7890；留空使用系统代理/VPN。"
          >
            <Input placeholder="http://127.0.0.1:7890" />
          </Form.Item>
        </div>

        <div className="app-panel" style={{ marginBottom: 16 }}>
          <div className="app-panel__title">
            <div>
              <div className="app-panel__title-main">浏览器扩展安装</div>
              <div className="app-panel__title-sub">用于在数据采集页引导用户安装 Chrome 采集助手，并检测扩展心跳状态。</div>
            </div>
          </div>
          <Space direction="vertical" style={{ width: "100%" }} size={10}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              正式分发建议用 Chrome Web Store 非公开链接；内测或临时分发可以填扩展文件下载链接，让用户下载压缩包后手动“加载已解压的扩展程序”。
            </Text>
            <Form.Item name="extensionPackageUrl" label="扩展文件下载链接" help="指向 .zip 压缩包；用户下载后需要先解压，再在 Chrome 扩展管理页加载解压后的目录。">
              <Input placeholder="https://your-cloud.example.com/downloads/temu-monitor-extension.zip" />
            </Form.Item>
            <Form.Item name="extensionInstallUrl" label="扩展安装链接" help="示例：https://chromewebstore.google.com/detail/...">
              <Input placeholder="https://chromewebstore.google.com/detail/..." />
            </Form.Item>
            <Form.Item name="cloudEndpoint" label="云端地址" help="用于读取 /api/dashboard/agent 心跳状态">
              <Input placeholder="https://your-cloud.example.com" />
            </Form.Item>
            <Form.Item name="cloudToken" label="云端 Token">
              <Input.Password placeholder="粘贴云端 JWT" />
            </Form.Item>
            <Space wrap>
              <Button icon={<LinkOutlined />} onClick={handleOpenExtensionInstall}>
                测试打开扩展链接
              </Button>
            </Space>
          </Space>
        </div>

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
