import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Space, Tag, Typography, message } from "antd";
import {
  ApiOutlined,
  CheckCircleOutlined,
  ChromeOutlined,
  CloudSyncOutlined,
  DownloadOutlined,
  ReloadOutlined,
  SettingOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import {
  fetchAgentHeartbeats,
  loadCloudConfig,
  type AgentHeartbeat,
  type CloudConsoleConfig,
} from "../utils/cloudClient";
import { loadExtensionInstallConfig, openExternalUrl } from "../utils/extensionInstall";

const { Text } = Typography;
const ONLINE_WINDOW_MS = 90_000;

type GuideVariant = "panel" | "banner";

interface ExtensionInstallGuideProps {
  variant?: GuideVariant;
}

interface ExtensionGuideState {
  loading: boolean;
  installUrl: string;
  packageUrl: string;
  cloudConfig: CloudConsoleConfig | null;
  agents: AgentHeartbeat[];
  error: string;
}

function formatRelativeTime(ts?: number | null) {
  if (!ts) return "暂无心跳";
  const time = Number(ts);
  if (!Number.isFinite(time)) return "暂无心跳";
  const diff = Math.max(0, Date.now() - time);
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))} 秒前`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
  return new Date(time).toLocaleString("zh-CN");
}

function getLatestAgents(agents: AgentHeartbeat[]) {
  const byDevice = new Map<string, AgentHeartbeat>();
  for (const agent of agents) {
    const key = agent.device_uuid || agent.device_id || "unknown";
    const current = byDevice.get(key);
    if (!current || Number(agent.ts || 0) > Number(current.ts || 0)) {
      byDevice.set(key, agent);
    }
  }
  return Array.from(byDevice.values()).sort((left, right) => Number(right.ts || 0) - Number(left.ts || 0));
}

function isAgentOnline(agent: AgentHeartbeat) {
  const ts = Number(agent.ts || 0);
  return Number.isFinite(ts) && Date.now() - ts < ONLINE_WINDOW_MS;
}

export default function ExtensionInstallGuide({ variant = "panel" }: ExtensionInstallGuideProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<ExtensionGuideState>({
    loading: true,
    installUrl: "",
    packageUrl: "",
    cloudConfig: null,
    agents: [],
    error: "",
  });

  const refresh = useCallback(async (silent = false) => {
    if (!silent) {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
    }
    try {
      const [installConfig, cloudConfig] = await Promise.all([
        loadExtensionInstallConfig(),
        loadCloudConfig(),
      ]);
      const agents = cloudConfig ? await fetchAgentHeartbeats(cloudConfig, { limit: 160 }) : [];
      setState({
        loading: false,
        installUrl: installConfig.storeUrl,
        packageUrl: installConfig.packageUrl,
        cloudConfig,
        agents,
        error: "",
      });
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error?.message || "检测扩展状态失败",
      }));
    }
  }, []);

  useEffect(() => {
    refresh(true).catch(() => {});
    const id = window.setInterval(() => {
      refresh(true).catch(() => {});
    }, 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const latestAgents = useMemo(() => getLatestAgents(state.agents), [state.agents]);
  const onlineAgents = latestAgents.filter(isAgentOnline);
  const newestAgent = latestAgents[0] || null;
  const hasOnlineAgent = onlineAgents.length > 0;
  const hasAnyAgent = latestAgents.length > 0;
  const queueDepth = onlineAgents.reduce((sum, agent) => sum + Number(agent.queue_depth || 0), 0);

  const status = !state.cloudConfig
    ? { label: "云端未配置", color: "warning" as const, icon: <WarningOutlined /> }
    : hasOnlineAgent
      ? { label: "采集助手已连接", color: "success" as const, icon: <CheckCircleOutlined /> }
      : hasAnyAgent
        ? { label: "采集助手离线", color: "warning" as const, icon: <WarningOutlined /> }
        : { label: "未检测到采集助手", color: "warning" as const, icon: <WarningOutlined /> };

  const hasPackageUrl = Boolean(state.packageUrl);
  const hasStoreUrl = Boolean(state.installUrl);
  const primaryInstallLabel = hasPackageUrl ? "下载扩展文件" : "安装采集助手";
  const primaryInstallDisabled = !hasPackageUrl && !hasStoreUrl;
  const openPrimaryInstall = async () => {
    const targetUrl = state.packageUrl || state.installUrl;
    if (!targetUrl) {
      message.warning("请先在设置里配置扩展文件或 Chrome Web Store 安装链接");
      navigate("/settings");
      return;
    }
    try {
      await openExternalUrl(targetUrl);
    } catch (error: any) {
      message.error(error?.message || "打开扩展链接失败");
    }
  };

  const openStoreInstall = async () => {
    if (!state.installUrl) {
      message.warning("请先在设置里配置 Chrome Web Store 安装链接");
      navigate("/settings");
      return;
    }
    try {
      await openExternalUrl(state.installUrl);
    } catch (error: any) {
      message.error(error?.message || "打开商店安装页失败");
    }
  };

  const copyExtensionsUrl = async () => {
    try {
      await navigator.clipboard.writeText("chrome://extensions");
      message.success("已复制 chrome://extensions");
    } catch {
      message.info("请手动在 Chrome 地址栏输入 chrome://extensions");
    }
  };

  const openTemuSeller = async () => {
    try {
      await openExternalUrl("https://agentseller.temu.com/");
    } catch (error: any) {
      message.error(error?.message || "打开 Temu 卖家后台失败");
    }
  };

  if (variant === "banner" && hasOnlineAgent) return null;

  if (variant === "banner") {
    return (
      <div className="extension-install-banner">
        <ChromeOutlined style={{ color: "#1677ff", fontSize: 16 }} />
        <span style={{ fontWeight: 700, color: "var(--color-text)", fontSize: 13 }}>安装采集助手：</span>
        <Text type="secondary" style={{ fontSize: 13 }}>
          需要安装 Chrome 扩展并打开 Temu 卖家后台，系统才会持续收到店铺数据。
        </Text>
        <Tag color={status.color} icon={status.icon} style={{ borderRadius: 999, margin: 0 }}>
          {status.label}
        </Tag>
        <Space size={8} wrap style={{ marginLeft: "auto" }}>
          <Button size="small" icon={<DownloadOutlined />} onClick={openPrimaryInstall} disabled={primaryInstallDisabled}>
            {primaryInstallLabel}
          </Button>
          <Button size="small" type="link" onClick={() => navigate("/collect")} style={{ paddingInline: 0 }}>
            查看指引
          </Button>
        </Space>
      </div>
    );
  }

  return (
    <div
      className="app-panel"
      style={{
        borderColor: hasOnlineAgent ? "rgba(0, 185, 107, 0.24)" : "#ffd9b8",
        background: hasOnlineAgent ? "linear-gradient(135deg, #f5fffa, #ffffff)" : "linear-gradient(135deg, #fff7f0, #ffffff)",
      }}
    >
      <div className="app-panel__title">
        <div>
          <div className="app-panel__title-main">浏览器采集助手</div>
          <div className="app-panel__title-sub">
            安装扩展后，在 Temu 卖家后台正常浏览页面，接口数据会自动进入云端队列。
          </div>
        </div>
        <Space size={8} wrap>
          <Tag color={status.color} icon={status.icon} style={{ borderRadius: 999, margin: 0 }}>
            {status.label}
          </Tag>
          {state.loading ? <Tag style={{ borderRadius: 999, margin: 0 }}>检测中</Tag> : null}
        </Space>
      </div>

      <div className="extension-install-guide__body">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space size={8} wrap>
            <Tag icon={<DownloadOutlined />} style={{ borderRadius: 999, padding: "3px 10px", margin: 0 }}>
              1 {hasPackageUrl ? "下载并解压扩展文件" : "安装扩展"}
            </Tag>
            <Tag icon={<ApiOutlined />} style={{ borderRadius: 999, padding: "3px 10px", margin: 0 }}>
              2 {hasPackageUrl ? "加载已解压扩展" : "打开 Temu 后台"}
            </Tag>
            <Tag icon={<CloudSyncOutlined />} style={{ borderRadius: 999, padding: "3px 10px", margin: 0 }}>
              3 等待心跳变绿
            </Tag>
          </Space>

          <Text type="secondary" style={{ lineHeight: 1.8 }}>
            {hasPackageUrl
              ? "点击下载扩展文件后，先解压到一个固定文件夹。然后在 Chrome 打开 chrome://extensions，开启开发者模式，点“加载已解压的扩展程序”，选择解压后包含 manifest.json 的文件夹。"
              : hasStoreUrl
                ? "点击安装后会跳到 Chrome Web Store。安装完成后，回到 Temu 卖家后台刷新一次页面，通常 30 秒内这里会显示已连接。"
                : "管理员还没有配置扩展文件或商店安装链接。先在系统设置里填入下载链接，再让用户从这里安装。"}
          </Text>

          {!state.cloudConfig ? (
            <Text type="secondary" style={{ lineHeight: 1.8 }}>
              当前也没有配置云端地址和 Token，所以只能展示安装指引，暂时不能自动判断是否已安装。
            </Text>
          ) : null}

          {state.error ? (
            <Text type="danger" style={{ lineHeight: 1.8 }}>{state.error}</Text>
          ) : null}

          <Space size={10} wrap>
            <Button type="primary" icon={<DownloadOutlined />} onClick={openPrimaryInstall} disabled={primaryInstallDisabled}>
              {primaryInstallLabel}
            </Button>
            {hasPackageUrl ? (
              <Button onClick={copyExtensionsUrl}>
                复制扩展管理页地址
              </Button>
            ) : null}
            {hasPackageUrl && hasStoreUrl ? (
              <Button icon={<ChromeOutlined />} onClick={openStoreInstall}>
                商店安装
              </Button>
            ) : null}
            <Button icon={<ApiOutlined />} onClick={openTemuSeller}>
              打开 Temu 后台
            </Button>
            <Button icon={<ReloadOutlined />} loading={state.loading} onClick={() => refresh(false)}>
              重新检测
            </Button>
            {!hasPackageUrl && !hasStoreUrl ? (
              <Button icon={<SettingOutlined />} onClick={() => navigate("/settings")}>
                去配置链接
              </Button>
            ) : null}
          </Space>
        </Space>

        <div style={{ display: "grid", gap: 10 }}>
          <div className="app-kv">
            <span className="app-kv__label">在线设备</span>
            <span className="app-kv__value">{onlineAgents.length}/{latestAgents.length}</span>
          </div>
          <div className="app-kv">
            <span className="app-kv__label">最近心跳</span>
            <span className="app-kv__value">{formatRelativeTime(newestAgent?.ts)}</span>
          </div>
          <div className="app-kv">
            <span className="app-kv__label">待上报队列</span>
            <span className="app-kv__value">{queueDepth}</span>
          </div>
          <div className="app-kv">
            <span className="app-kv__label">Hook 状态</span>
            <span className="app-kv__value">
              {newestAgent?.hook_xhr_alive === 1 ? "XHR 正常" : newestAgent?.hook_xhr_alive === 0 ? "XHR 异常" : "等待 Temu 页面"}
            </span>
          </div>
          {newestAgent?.page_url ? (
            <div className="app-kv">
              <span className="app-kv__label">最近页面</span>
              <span className="app-kv__value" title={newestAgent.page_url}>{newestAgent.page_url}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
