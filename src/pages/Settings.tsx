import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Form,
  InputNumber,
  Progress,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CheckCircleOutlined,
  CloudDownloadOutlined,
  ReloadOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";

const { Text } = Typography;
const appAPI = window.electronAPI?.app;
const store = window.electronAPI?.store;
const APP_SETTINGS_KEY = "temu_app_settings";

type UpdateStatus = {
  status?: "idle" | "dev" | "up-to-date" | "available" | "downloading" | "downloaded" | "error";
  message?: string;
  progressPercent?: number;
  releaseVersion?: string;
};

function getUpdateStatusLabel(updateStatus: UpdateStatus) {
  switch (updateStatus.status) {
    case "up-to-date":
      return "已最新";
    case "available":
      return "可更新";
    case "downloading":
      return "下载中";
    case "downloaded":
      return "可安装";
    case "error":
      return "更新失败";
    default:
      return "未检查";
  }
}

export default function Settings() {
  const [form] = Form.useForm();
  const [version, setVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: "idle", message: "" });
  const [saving, setSaving] = useState(false);
  const lowStockThreshold = Form.useWatch("lowStockThreshold", form) ?? 10;

  useEffect(() => {
    appAPI?.getVersion().then(setVersion).catch(() => {});
    appAPI?.getUpdateStatus?.().then((value: UpdateStatus) => setUpdateStatus(value || {})).catch(() => {});
    const unsubscribe = window.electronAPI?.onUpdateStatus?.((value: UpdateStatus) => {
      setUpdateStatus(value || {});
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    store?.get(APP_SETTINGS_KEY).then((data: any) => {
      if (data && typeof data === "object") {
        form.setFieldsValue(data);
      }
    }).catch(() => {});
  }, [form]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = form.getFieldsValue();
      await store?.set(APP_SETTINGS_KEY, values);
      message.success("设置已保存");
    } catch (error: any) {
      message.error(error?.message || "保存设置失败");
    } finally {
      setSaving(false);
    }
  };

  const handleCheckUpdate = async () => {
    try {
      const result = await appAPI?.checkForUpdates?.();
      if (result) {
        setUpdateStatus(result);
      }
    } catch (error: any) {
      message.error(error?.message || "检查更新失败");
    }
  };

  const handleDownloadUpdate = async () => {
    try {
      await appAPI?.downloadUpdate?.();
    } catch (error: any) {
      message.error(error?.message || "下载更新失败");
    }
  };

  const handleInstall = () => {
    appAPI?.quitAndInstallUpdate?.();
  };

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="系统设置"
        title="设置"
        subtitle="把运行参数、更新状态和库存告警放进同一页，避免页面又窄又长。"
        meta={[
          version || "开发模式",
          updateStatus.status === "available" ? `可更新到 ${updateStatus.releaseVersion || "新版本"}` : getUpdateStatusLabel(updateStatus),
          "设置仅保存在本地",
        ]}
      />

      <div className="app-two-column">
        <div className="app-stack">
          <div className="app-panel">
            <div className="app-panel__title">
              <div>
                <div className="app-panel__title-main">版本与更新</div>
                <div className="app-panel__title-sub">先看当前版本，再决定是否下载和安装新包。</div>
              </div>
            </div>

            <div className="app-form-grid" style={{ marginBottom: 14 }}>
              <StatCard
                compact
                title="当前版本"
                value={version || "开发模式"}
                color="brand"
                trend="支持桌面端自动更新"
              />
              <StatCard
                compact
                title="更新状态"
                value={getUpdateStatusLabel(updateStatus)}
                color="blue"
                trend={updateStatus.message || "可手动检查更新"}
              />
            </div>

            {updateStatus.status === "error" ? (
              <Alert
                style={{ marginBottom: 14 }}
                type="warning"
                showIcon
                message="更新过程中出现异常"
                description={updateStatus.message || "可以先重新检查更新，再决定是否继续下载。"}
              />
            ) : null}

            <div className="app-kv-list">
              <div className="app-kv">
                <span className="app-kv__label">当前版本</span>
                <span className="app-kv__value">
                  <Text strong>{version || "开发模式"}</Text>
                </span>
              </div>
              <div className="app-kv">
                <span className="app-kv__label">更新状态</span>
                <span className="app-kv__value">
                  {updateStatus.status === "up-to-date" ? <Tag icon={<CheckCircleOutlined />} color="success">已最新</Tag> : null}
                  {updateStatus.status === "available" ? <Tag color="blue">发现新版本 {updateStatus.releaseVersion}</Tag> : null}
                  {updateStatus.status === "downloading" ? <Tag icon={<SyncOutlined spin />} color="processing">下载中</Tag> : null}
                  {updateStatus.status === "downloaded" ? <Tag icon={<CloudDownloadOutlined />} color="success">已下载</Tag> : null}
                  {(updateStatus.status === "idle" || updateStatus.status === "dev" || !updateStatus.status) ? <Tag>未检查</Tag> : null}
                  {updateStatus.status === "error" ? <Tag color="error">失败</Tag> : null}
                </span>
              </div>
            </div>

            {updateStatus.status === "downloading" && typeof updateStatus.progressPercent === "number" ? (
              <div style={{ marginTop: 14 }}>
                <Progress percent={updateStatus.progressPercent} strokeColor="var(--color-brand)" size="small" />
              </div>
            ) : null}

            <Space wrap style={{ marginTop: 16 }}>
              <Button
                icon={<ReloadOutlined />}
                onClick={handleCheckUpdate}
                disabled={updateStatus.status === "downloading"}
              >
                检查更新
              </Button>
              {updateStatus.status === "available" ? (
                <Button type="primary" icon={<CloudDownloadOutlined />} onClick={handleDownloadUpdate}>
                  下载更新
                </Button>
              ) : null}
              {updateStatus.status === "downloaded" ? (
                <Button type="primary" icon={<CloudDownloadOutlined />} onClick={handleInstall}>
                  立即安装
                </Button>
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
              lowStockThreshold: 10,
              screenshotOnError: true,
            }}
          >
            <div className="app-panel">
              <div className="app-panel__title">
                <div>
                  <div className="app-panel__title-main">浏览器与执行</div>
                  <div className="app-panel__title-sub">常用参数尽量并排展示，不再一项一行往下堆。</div>
                </div>
              </div>

              <div className="app-form-grid">
                <Form.Item
                  name="operationDelay"
                  label="操作间隔（毫秒）"
                  help="越大越稳，但执行会更慢。"
                >
                  <InputNumber min={500} max={10000} step={100} style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item
                  name="maxRetries"
                  label="最大重试次数"
                  help="操作失败后的自动重试次数。"
                >
                  <InputNumber min={1} max={10} style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item
                  name="headless"
                  label="无头模式"
                  valuePropName="checked"
                  help="开启后浏览器在后台运行。"
                >
                  <Switch />
                </Form.Item>
                <Form.Item
                  name="screenshotOnError"
                  label="错误截图"
                  valuePropName="checked"
                  help="失败时自动截图，便于排查。"
                >
                  <Switch />
                </Form.Item>
              </div>
            </div>

            <div className="app-two-column" style={{ marginTop: 16 }}>
              <div className="app-panel">
                <div className="app-panel__title">
                  <div>
                    <div className="app-panel__title-main">账号设置</div>
                    <div className="app-panel__title-sub">登录态过期时，尽量用自动恢复减少中断。</div>
                  </div>
                </div>

                <Form.Item
                  name="autoLoginRetry"
                  label="自动重新登录"
                  valuePropName="checked"
                  help="登录态失效时自动尝试恢复。"
                  style={{ marginBottom: 0 }}
                >
                  <Switch />
                </Form.Item>
              </div>

              <div className="app-panel">
                <div className="app-panel__title">
                  <div>
                    <div className="app-panel__title-main">告警阈值</div>
                    <div className="app-panel__title-sub">库存预警会直接读取这里的阈值。</div>
                  </div>
                </div>

                <StatCard
                  compact
                  title="低库存阈值"
                  value={lowStockThreshold}
                  suffix="件"
                  color="purple"
                  trend="任务页会基于这个值生成预警"
                />

                <Form.Item
                  name="lowStockThreshold"
                  label="低库存阈值"
                  help="库存低于该数量时标记为风险。"
                  style={{ marginTop: 14, marginBottom: 0 }}
                >
                  <InputNumber min={1} max={1000} style={{ width: "100%" }} />
                </Form.Item>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <Button type="primary" onClick={handleSave} className="create-primary-button" loading={saving}>
                保存设置
              </Button>
            </div>
          </Form>
        </div>

        <div className="app-stack">
          <div className="app-panel">
            <div className="app-panel__title">
              <div>
                <div className="app-panel__title-main">当前摘要</div>
                <div className="app-panel__title-sub">把最常看的状态压缩成 3 个短卡片。</div>
              </div>
            </div>

            <div className="app-stack">
              <StatCard compact title="当前版本" value={version || "开发模式"} color="brand" trend="客户端版本号" />
              <StatCard compact title="更新状态" value={getUpdateStatusLabel(updateStatus)} color="blue" trend={updateStatus.message || "暂无新通知"} />
              <StatCard compact title="库存阈值" value={lowStockThreshold} suffix="件" color="purple" trend="用于低库存检测" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
