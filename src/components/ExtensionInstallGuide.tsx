import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Space, Tag, Typography, message } from "antd";
import {
  ApiOutlined,
  CheckCircleOutlined,
  ChromeOutlined,
  CloudSyncOutlined,
  ReloadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import {
  fetchAgentHeartbeats,
  loadCloudConfig,
  type AgentHeartbeat,
  type CloudConsoleConfig,
} from "../utils/cloudClient";
import { openExternalUrl } from "../utils/extensionInstall";

const { Text } = Typography;
const ONLINE_WINDOW_MS = 90_000;

type GuideVariant = "panel" | "banner";

interface ExtensionInstallGuideProps {
  variant?: GuideVariant;
}

interface ExtensionGuideState {
  loading: boolean;
  cloudConfig: CloudConsoleConfig | null;
  agents: AgentHeartbeat[];
  error: string;
  policyStatus: any | null;
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

function parseCollectorTargets(agent: AgentHeartbeat | null) {
  if (!agent?.collector_last_targets_json) return [];
  try {
    const parsed = JSON.parse(agent.collector_last_targets_json);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

export default function ExtensionInstallGuide({ variant = "panel" }: ExtensionInstallGuideProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<ExtensionGuideState>({
    loading: true,
    cloudConfig: null,
    agents: [],
    error: "",
    policyStatus: null,
  });
  const [policyApplying, setPolicyApplying] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
    }
    try {
      const policyPromise = window.electronAPI?.app?.getBrowserExtensionPolicy
        ? window.electronAPI.app.getBrowserExtensionPolicy().catch(() => null)
        : Promise.resolve(null);
      const [cloudConfig, policyStatus] = await Promise.all([
        loadCloudConfig(),
        policyPromise,
      ]);
      const agents = cloudConfig ? await fetchAgentHeartbeats(cloudConfig, { limit: 160 }) : [];
      setState({
        loading: false,
        cloudConfig,
        agents,
        error: "",
        policyStatus,
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
  const collectorTargets = parseCollectorTargets(newestAgent);
  const collectorTaskText = collectorTargets
    .map((target) => String(target.key || "").trim())
    .filter(Boolean)
    .join("、") || newestAgent?.collector_last_target_key || "";

  const status = !state.cloudConfig
    ? { label: "云端未配置", color: "warning" as const, icon: <WarningOutlined /> }
    : hasOnlineAgent
      ? { label: "采集助手已连接", color: "success" as const, icon: <CheckCircleOutlined /> }
      : hasAnyAgent
        ? { label: "采集助手离线", color: "warning" as const, icon: <WarningOutlined /> }
        : { label: "等待采集助手上线", color: "warning" as const, icon: <WarningOutlined /> };

  const openTemuSeller = async () => {
    try {
      await openExternalUrl("https://agentseller.temu.com/");
    } catch (error: any) {
      message.error(error?.message || "打开 Temu 卖家后台失败");
    }
  };

  const ensureExtensionPolicy = async () => {
    const api = window.electronAPI?.app?.ensureBrowserExtensionPolicy;
    if (!api) {
      message.warning("当前版本不支持自动写入扩展策略");
      return;
    }
    setPolicyApplying(true);
    try {
      const policyStatus = await api();
      setState((prev) => ({ ...prev, policyStatus }));
      if (policyStatus?.ok) {
        message.success("已写入 Chrome / Edge 扩展自动安装策略，重启浏览器后生效");
      } else {
        message.warning("扩展策略未完全写入，请查看日志或手动安装");
      }
    } catch (error: any) {
      message.error(error?.message || "写入扩展安装策略失败");
    } finally {
      setPolicyApplying(false);
    }
  };

  if (variant === "banner" && hasOnlineAgent) return null;

  if (variant === "banner") {
    return (
      <div className="extension-install-banner">
        <ChromeOutlined style={{ color: "#1a73e8", fontSize: 16 }} />
        <span style={{ fontWeight: 700, color: "var(--color-text)", fontSize: 13 }}>采集助手：</span>
        <Text type="secondary" style={{ fontSize: 13 }}>
          采集助手随本软件自动安装。若未连接，请重启 Chrome / Edge，再打开 Temu 卖家后台。
        </Text>
        <Tag color={status.color} icon={status.icon} style={{ borderRadius: 999, margin: 0 }}>
          {status.label}
        </Tag>
        <Space size={8} wrap style={{ marginLeft: "auto" }}>
          <Button size="small" icon={<ReloadOutlined />} loading={policyApplying} onClick={ensureExtensionPolicy}>
            自动安装扩展
          </Button>
          <Button size="small" icon={<ApiOutlined />} onClick={openTemuSeller}>
            打开 Temu 后台
          </Button>
          <Button size="small" type="link" onClick={() => navigate("/settings")} style={{ paddingInline: 0 }}>
            查看设置
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
        background: hasOnlineAgent ? "linear-gradient(135deg, #f5fffa, #ffffff)" : "linear-gradient(135deg, rgba(26, 115, 232, 0.08), #ffffff)",
      }}
    >
      <div className="app-panel__title">
        <div>
          <div className="app-panel__title-main">浏览器采集助手</div>
          <div className="app-panel__title-sub">
            采集助手已随本软件自动安装，在 Temu 卖家后台正常浏览页面，接口数据会自动进入云端队列。
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
            <Tag icon={<CheckCircleOutlined />} style={{ borderRadius: 999, padding: "3px 10px", margin: 0 }}>
              1 已随软件自动安装（无需手动操作）
            </Tag>
            <Tag icon={<ChromeOutlined />} style={{ borderRadius: 999, padding: "3px 10px", margin: 0 }}>
              2 重启 Chrome / Edge 让策略生效
            </Tag>
            <Tag icon={<CloudSyncOutlined />} style={{ borderRadius: 999, padding: "3px 10px", margin: 0 }}>
              3 打开 Temu 后台，等心跳变绿
            </Tag>
          </Space>

          <Text type="secondary" style={{ lineHeight: 1.8 }}>
            采集助手由本软件通过浏览器策略强制安装，首次安装后需完全退出并重启 Chrome / Edge
            才会生效（通常重启后 1-2 分钟内出现在浏览器扩展列表）。它在浏览器扩展页由“企业策略”
            管理、显示为不可手动删除，属正常现象。随后登录并停留在 Temu 卖家后台即可持续采集。
          </Text>

          {!state.cloudConfig ? (
            <Text type="secondary" style={{ lineHeight: 1.8 }}>
              当前没有配置云端地址和 Token，暂时无法自动判断采集助手是否已连接。请在系统设置里
              配置云端地址与 Token。
            </Text>
          ) : null}

          {state.error ? (
            <Text type="danger" style={{ lineHeight: 1.8 }}>{state.error}</Text>
          ) : null}

          <Space size={10} wrap>
            <Button icon={<ReloadOutlined />} loading={policyApplying} onClick={ensureExtensionPolicy}>
              自动安装扩展
            </Button>
            <Button type="primary" icon={<ApiOutlined />} onClick={openTemuSeller}>
              打开 Temu 后台
            </Button>
            <Button icon={<ReloadOutlined />} loading={state.loading} onClick={() => refresh(false)}>
              重新检测
            </Button>
          </Space>
        </Space>

        <div style={{ display: "grid", gap: 10 }}>
          <div className="app-kv">
            <span className="app-kv__label">安装策略</span>
            <span className="app-kv__value">
              {state.policyStatus?.ok ? "已写入" : state.policyStatus?.supported === false ? "不支持" : "待写入"}
            </span>
          </div>
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
          <div className="app-kv">
            <span className="app-kv__label">自动采集</span>
            <span className="app-kv__value">
              {newestAgent?.collector_enabled === 0 ? "已关闭" : collectorTaskText ? "运行中" : "等待任务"}
            </span>
          </div>
          {collectorTaskText ? (
            <div className="app-kv">
              <span className="app-kv__label">本轮任务</span>
              <span className="app-kv__value" title={collectorTaskText}>{collectorTaskText}</span>
            </div>
          ) : null}
          {newestAgent?.collector_last_target_url ? (
            <div className="app-kv">
              <span className="app-kv__label">采集页面</span>
              <span className="app-kv__value" title={newestAgent.collector_last_target_url}>{newestAgent.collector_last_target_url}</span>
            </div>
          ) : null}
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
