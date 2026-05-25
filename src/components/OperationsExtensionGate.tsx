import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Space, Tag, Typography, message } from "antd";
import {
  ApiOutlined,
  ChromeOutlined,
  CloudSyncOutlined,
  CopyOutlined,
  FolderOpenOutlined,
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
import { openExternalUrl } from "../utils/extensionInstall";

const { Text } = Typography;

const ONLINE_WINDOW_MS = 90_000;
const REFRESH_INTERVAL_MS = 15_000;
const OPERATIONS_EXTENSION_FREE_ROUTES = new Set(["/collect", "/settings"]);

interface OperationsExtensionGateProps {
  role?: string | null;
  routePath: string;
  children: JSX.Element;
}

interface ExtensionGateState {
  loading: boolean;
  cloudConfig: CloudConsoleConfig | null;
  agents: AgentHeartbeat[];
  error: string;
  lastCheckedAt: number | null;
}

function agentTimestamp(agent: AgentHeartbeat) {
  return Number(agent.ts || agent.received_at || agent.last_flush_at || agent.collector_updated_at || 0);
}

function latestAgents(agents: AgentHeartbeat[]) {
  const byDevice = new Map<string, AgentHeartbeat>();
  for (const agent of agents) {
    const key = agent.device_uuid || agent.device_id || "unknown";
    const current = byDevice.get(key);
    if (!current || agentTimestamp(agent) > agentTimestamp(current)) {
      byDevice.set(key, agent);
    }
  }
  return Array.from(byDevice.values()).sort((left, right) => agentTimestamp(right) - agentTimestamp(left));
}

function isOnline(agent: AgentHeartbeat) {
  const ts = agentTimestamp(agent);
  return Number.isFinite(ts) && ts > 0 && Date.now() - ts < ONLINE_WINDOW_MS;
}

function formatRelativeTime(ts?: number | null) {
  const time = Number(ts || 0);
  if (!Number.isFinite(time) || time <= 0) return "暂无心跳";
  const diff = Math.max(0, Date.now() - time);
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))} 秒前`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  return new Date(time).toLocaleString("zh-CN");
}

export default function OperationsExtensionGate({ role, routePath, children }: OperationsExtensionGateProps) {
  const navigate = useNavigate();
  const shouldGate = role === "operations" && !OPERATIONS_EXTENSION_FREE_ROUTES.has(routePath);
  const [extensionDir, setExtensionDir] = useState("");
  const [state, setState] = useState<ExtensionGateState>({
    loading: true,
    cloudConfig: null,
    agents: [],
    error: "",
    lastCheckedAt: null,
  });

  const refresh = useCallback(async (silent = false) => {
    if (!shouldGate) return;
    if (!silent) {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
    }
    try {
      const cloudConfig = await loadCloudConfig();
      const agents = cloudConfig ? await fetchAgentHeartbeats(cloudConfig, { limit: 160 }) : [];
      setState({
        loading: false,
        cloudConfig,
        agents,
        error: "",
        lastCheckedAt: Date.now(),
      });
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error?.message || "检测扩展连接失败",
        lastCheckedAt: Date.now(),
      }));
    }
  }, [shouldGate]);

  useEffect(() => {
    if (!shouldGate) return undefined;
    let cancelled = false;
    window.electronAPI?.app?.getExtensionDirectory?.()
      .then((dir: string | undefined) => {
        if (!cancelled) setExtensionDir(dir || "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shouldGate]);

  useEffect(() => {
    if (!shouldGate) return undefined;
    refresh(true).catch(() => {});
    const id = window.setInterval(() => {
      refresh(true).catch(() => {});
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh, shouldGate]);

  const devices = useMemo(() => latestAgents(state.agents), [state.agents]);
  const onlineAgents = devices.filter(isOnline);
  const newestAgent = devices[0] || null;
  const hasOnlineAgent = onlineAgents.length > 0;

  if (!shouldGate || hasOnlineAgent) return children;

  const openTemuSeller = async () => {
    try {
      await openExternalUrl("https://agentseller.temu.com/");
    } catch (error: any) {
      message.error(error?.message || "打开 Temu 后台失败");
    }
  };

  const openChromeExtensions = async () => {
    try {
      await window.electronAPI?.app?.openChromeExtensions?.();
    } catch (error: any) {
      message.error(error?.message || "打开 Chrome 扩展管理页失败");
    }
  };

  const openExtensionDirectory = async () => {
    try {
      const dir = await window.electronAPI?.app?.openExtensionDirectory?.();
      if (dir) setExtensionDir(dir);
    } catch (error: any) {
      message.error(error?.message || "打开扩展目录失败");
    }
  };

  const copyExtensionDirectory = async () => {
    if (!extensionDir) {
      message.warning("还没有获取到扩展目录");
      return;
    }
    try {
      await navigator.clipboard?.writeText(extensionDir);
      message.success("扩展目录已复制");
    } catch {
      message.error("复制失败");
    }
  };

  const status = !state.cloudConfig
    ? { color: "warning" as const, icon: <WarningOutlined />, text: "云端 Token 未配置" }
    : devices.length > 0
      ? { color: "warning" as const, icon: <WarningOutlined />, text: "扩展离线" }
      : { color: "warning" as const, icon: <WarningOutlined />, text: "等待扩展上线" };

  return (
    <div className="operations-extension-gate">
      <div className="app-panel operations-extension-gate__panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">先安装并连接 Temu 多店扩展</div>
            <div className="app-panel__title-sub">
              运营账号必须先让扩展上线，软件才会放行商品、店铺、采购和运营页面。
            </div>
          </div>
          <Space size={8} wrap>
            <Tag color={status.color} icon={status.icon} style={{ borderRadius: 999, margin: 0 }}>
              {status.text}
            </Tag>
            {state.loading ? <Tag style={{ borderRadius: 999, margin: 0 }}>检测中</Tag> : null}
          </Space>
        </div>

        <div className="operations-extension-gate__notice">
          扩展目录：{extensionDir || "未获取到目录，请点击“本机扩展目录”"}
        </div>

        <div className="operations-extension-gate__steps">
          <div className="operations-extension-gate__step">
            <FolderOpenOutlined />
            <span>1. 点击“本机扩展目录”，确认打开的是软件自带的 extension 文件夹。</span>
          </div>
          <div className="operations-extension-gate__step">
            <ChromeOutlined />
            <span>2. 点击“扩展管理”，打开右上角开发者模式，点“加载已解压的扩展程序”，选择上面的 extension 文件夹。</span>
          </div>
          <div className="operations-extension-gate__step">
            <CloudSyncOutlined />
            <span>3. 打开 Temu 卖家后台并保持登录，等待 10-30 秒后点“重新检测”，扩展在线后自动进入业务页面。</span>
          </div>
        </div>

        <div className="operations-extension-gate__meta">
          <span>在线设备 {onlineAgents.length}</span>
          <span>最近心跳 {formatRelativeTime(agentTimestamp(newestAgent || {}))}</span>
          <span>队列 {onlineAgents.reduce((sum, agent) => sum + Number(agent.queue_depth || 0), 0)}</span>
          {state.lastCheckedAt ? <span>检测时间 {new Date(state.lastCheckedAt).toLocaleTimeString("zh-CN")}</span> : null}
        </div>

        {!state.cloudConfig ? (
          <div className="operations-extension-gate__notice">
            当前软件还没有云端 Token，无法判断扩展是否连接。请先到设置里配置云端账号或 Token。
          </div>
        ) : null}
        {state.error ? (
          <Text type="danger" className="operations-extension-gate__error">{state.error}</Text>
        ) : null}

        <Space size={10} wrap className="operations-extension-gate__actions">
          <Button type="primary" icon={<FolderOpenOutlined />} onClick={openExtensionDirectory}>
            本机扩展目录
          </Button>
          <Button icon={<ChromeOutlined />} onClick={openChromeExtensions}>
            扩展管理
          </Button>
          <Button icon={<CopyOutlined />} onClick={copyExtensionDirectory}>
            复制目录
          </Button>
          <Button icon={<ApiOutlined />} onClick={openTemuSeller}>
            打开 Temu 后台
          </Button>
          <Button icon={<ReloadOutlined />} loading={state.loading} onClick={() => refresh(false)}>
            重新检测
          </Button>
          <Button icon={<SettingOutlined />} onClick={() => navigate("/settings")}>
            去设置
          </Button>
        </Space>
      </div>
    </div>
  );
}
