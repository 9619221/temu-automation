import { useEffect, useState } from "react";
import { Form, Input, InputNumber, Switch, Button, Tag, Progress, Space, Typography, message } from "antd";
import { CloudDownloadOutlined, CheckCircleOutlined, SyncOutlined, ReloadOutlined, LinkOutlined, ApiOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import { useErpAuth } from "../contexts/ErpAuthContext";
import { clearCloudConfig, loadCloudConfig, saveCloudConfig } from "../utils/cloudClient";
import { normalizeExtensionInstallUrl, openExternalUrl } from "../utils/extensionInstall";

const { Text } = Typography;

type ProbeRow = {
  name: string;
  url: string;
  elapsedMs: number;
  status: number;
  ok: boolean;
  antiBot?: boolean;
  bodyPreview?: string;
  error?: string;
  causeError?: string;
};
type ProbeResult = {
  runtime?: { node?: string; platform?: string; arch?: string };
  timestamp?: string;
  probes: ProbeRow[];
};
const appAPI = window.electronAPI?.app;
const erp = window.electronAPI?.erp;
const store = window.electronAPI?.store;

export default function Settings() {
  const [form] = Form.useForm();
  const [version, setVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<any>({ status: "idle", message: "" });
  const [clientStatus, setClientStatus] = useState<{ isClientMode?: boolean; serverUrl?: string } | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagResult, setDiagResult] = useState<ProbeResult | null>(null);
  const auth = useErpAuth();
  const isAdmin = auth.currentUser?.role === "admin";

  const runMtopDiagnostic = async () => {
    setDiagRunning(true);
    setDiagResult(null);
    try {
      const result = await (erp as any)?.diagnostics?.probe1688Mtop?.({ stepTimeoutMs: 12000 });
      setDiagResult(result || null);
    } catch (e: any) {
      message.error(e?.message || "诊断失败");
    } finally {
      setDiagRunning(false);
    }
  };

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

      <div className="app-panel" style={{ marginBottom: 16 }}>
        <div className="app-panel__title">
          <div className="app-panel__title-main">1688 网络诊断</div>
        </div>
        <Space direction="vertical" style={{ width: "100%" }} size={10}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            「以图搜款」如果在某台电脑上一直转圈/超时，点这个按钮会从本机依次探 4 个 1688 mtop 端点，每步打耗时和状态。把结果截图发给开发就能定位是哪一步、哪个端点的问题。
          </Text>
          <Space>
            <Button icon={<ApiOutlined />} onClick={runMtopDiagnostic} loading={diagRunning} disabled={diagRunning}>
              开始 1688 网络诊断
            </Button>
            {diagResult?.timestamp ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {new Date(diagResult.timestamp).toLocaleTimeString()} · {diagResult.runtime?.platform || ""} {diagResult.runtime?.arch || ""} · node {diagResult.runtime?.node || "-"}
              </Text>
            ) : null}
          </Space>
          {diagResult?.probes?.length ? (
            <div style={{ background: "#f6f7f9", padding: 10, borderRadius: 6, fontFamily: "Consolas, Menlo, monospace", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {diagResult.probes.map((row) => {
                const slow = row.elapsedMs > 5000;
                const tone = !row.ok ? "#c62828" : (slow ? "#ef6c00" : "#2e7d32");
                return (
                  <div key={row.name} style={{ marginBottom: 8 }}>
                    <div style={{ color: tone, fontWeight: 600 }}>
                      [{row.elapsedMs}ms] {row.ok ? "OK" : (row.antiBot ? "ANTI-BOT" : "FAIL")} · {row.name}
                      {slow ? "  *** SLOW ***" : ""}
                    </div>
                    <div style={{ color: "#5f6368" }}>HTTP {row.status || "-"} · {row.url}</div>
                    {row.error ? <div style={{ color: "#c62828" }}>error: {row.error}</div> : null}
                    {row.causeError ? <div style={{ color: "#c62828" }}>cause: {row.causeError}</div> : null}
                    {row.antiBot ? <div style={{ color: "#c62828" }}>!!! 命中反爬：响应里出现 rgv587_flag / deny_h5 / punish</div> : null}
                    {row.bodyPreview ? <div style={{ color: "#5f6368" }}>body: {row.bodyPreview}</div> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
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
        }}
      >
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
