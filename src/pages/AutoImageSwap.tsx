import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { FolderOpenOutlined, PlayCircleOutlined } from "@ant-design/icons";
import {
  APP_SETTINGS_KEY,
  normalizeAppSettings,
  type AppSettings,
} from "../utils/appSettings";

const { TextArea } = Input;
const { Text } = Typography;

interface ResultRow {
  spuId: string;
  success: boolean;
  status: "pending" | "processing" | "done" | "error" | "missing" | "empty";
  files: number;
  message: string;
}

interface ProgressSnapshot {
  taskId: string;
  flowType: string;
  running: boolean;
  status: string;
  total: number;
  completed: number;
  current: string;
  message: string;
  results: ResultRow[];
  successCount: number;
  failCount: number;
  startedAt?: string;
  finishedAt?: string;
}

const STATUS_TAG: Record<ResultRow["status"], { color: string; text: string }> = {
  pending: { color: "default", text: "待处理" },
  processing: { color: "processing", text: "处理中" },
  done: { color: "success", text: "完成" },
  error: { color: "error", text: "失败" },
  missing: { color: "warning", text: "缺文件夹" },
  empty: { color: "warning", text: "无图片" },
};

function parseIdentifiers(text: string): string[] {
  if (!text) return [];
  const tokens = text
    .split(/[\s,;，；]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  return Array.from(new Set(tokens));
}

export default function AutoImageSwap() {
  const [rootDir, setRootDir] = useState("");
  const [listText, setListText] = useState("");
  const [running, setRunning] = useState(false);
  const [taskId, setTaskId] = useState<string>("");
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  // 启动时从 store 读取上次的根目录
  useEffect(() => {
    const store = window.electronAPI?.store;
    if (!store) {
      setBootstrapped(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const raw = await store.get(APP_SETTINGS_KEY);
        if (cancelled) return;
        const normalized: AppSettings = normalizeAppSettings(raw);
        setRootDir(normalized.autoImageSwapRootDir || "");
      } finally {
        if (!cancelled) setBootstrapped(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistRootDir = useCallback(async (next: string) => {
    const store = window.electronAPI?.store;
    if (!store) return;
    try {
      const raw = await store.get(APP_SETTINGS_KEY);
      const normalized = normalizeAppSettings(raw);
      await store.set(APP_SETTINGS_KEY, { ...normalized, autoImageSwapRootDir: next });
    } catch (e: any) {
      console.error("[auto-image-swap] persist root dir failed", e?.message || e);
    }
  }, []);

  const handlePickDir = useCallback(async () => {
    const api = window.electronAPI?.autoImageSwap;
    if (!api) {
      message.error("批量换图服务未就绪，请重启软件");
      return;
    }
    const picked = await api.pickDir(rootDir);
    if (picked) {
      setRootDir(picked);
      void persistRootDir(picked);
    }
  }, [rootDir, persistRootDir]);

  const handleRootDirBlur = useCallback(() => {
    void persistRootDir(rootDir.trim());
  }, [rootDir, persistRootDir]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      const api = window.electronAPI?.autoImageSwap;
      if (!api) return;
      pollTimerRef.current = window.setInterval(async () => {
        try {
          const snap = await api.getProgress(id);
          if (snap && typeof snap === "object") {
            setProgress(snap as ProgressSnapshot);
            if (!snap.running) {
              stopPolling();
              setRunning(false);
            }
          }
        } catch (e: any) {
          console.error("[auto-image-swap] poll error", e?.message || e);
        }
      }, 2000);
    },
    [stopPolling],
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  const identifiers = useMemo(() => parseIdentifiers(listText), [listText]);

  const handleRun = useCallback(async () => {
    const api = window.electronAPI?.autoImageSwap;
    if (!api) {
      message.error("批量换图服务未就绪，请重启软件");
      return;
    }
    const trimmedDir = rootDir.trim();
    if (!trimmedDir) {
      message.warning("请先选择图片根目录");
      return;
    }
    if (identifiers.length === 0) {
      message.warning("请填写至少一个 SPU/SKC 号");
      return;
    }
    setRunning(true);
    setProgress(null);
    const nextTaskId = `auto_image_swap_${Date.now()}`;
    setTaskId(nextTaskId);
    startPolling(nextTaskId);
    try {
      await api.run({ taskId: nextTaskId, rootDir: trimmedDir, identifiers });
      message.success("任务结束");
    } catch (e: any) {
      message.error("任务失败：" + (e?.message || String(e)));
    } finally {
      // 兜底：万一最后一次轮询还在路上，主动拉一次确保 UI 拿到终态
      try {
        const snap = await api.getProgress(nextTaskId);
        if (snap && typeof snap === "object") setProgress(snap as ProgressSnapshot);
      } catch {
        /* ignore */
      }
      stopPolling();
      setRunning(false);
    }
  }, [identifiers, rootDir, startPolling, stopPolling]);

  const rows = progress?.results || [];
  const summary = useMemo(() => {
    const total = progress?.total ?? identifiers.length;
    const success = progress?.successCount ?? 0;
    const fail = progress?.failCount ?? 0;
    const completed = progress?.completed ?? 0;
    return { total, success, fail, completed };
  }, [progress, identifiers.length]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="批量替换 Temu SPU 主图/轮播图" bordered={false}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="使用说明"
          description={
            <div>
              <div>1. 选择图片根目录；在根目录下为每个 SPU/SKC 创建同名子文件夹，把要替换的图片放进去。</div>
              <div>2. 子文件夹内所有图按文件名字典序排序，作为新的轮播图顺序（第一张即新主图）。</div>
              <div>3. 在下方贴 SPU/SKC 清单（换行、逗号、空格、分号都支持），点开始。</div>
              <div>4. 任务会自动复用已登录的 Temu 卖家后台 Session。运行中请勿手工操作浏览器。</div>
            </div>
          }
        />
        <Form layout="vertical" disabled={running || !bootstrapped}>
          <Form.Item label="图片根目录">
            <Space.Compact style={{ width: "100%" }}>
              <Input
                value={rootDir}
                onChange={(e) => setRootDir(e.target.value)}
                onBlur={handleRootDirBlur}
                placeholder="例如 D:\\temu-images\\swap-2026-05"
              />
              <Button icon={<FolderOpenOutlined />} onClick={handlePickDir}>
                浏览
              </Button>
            </Space.Compact>
            <Text type="secondary" style={{ fontSize: 12 }}>
              根目录下需有 &lt;SPU&gt;/ 或 &lt;SKC&gt;/ 子文件夹，里头放 .jpg / .png / .webp。
            </Text>
          </Form.Item>
          <Form.Item
            label={`SPU / SKC 号清单（已识别 ${identifiers.length} 个）`}
          >
            <TextArea
              value={listText}
              onChange={(e) => setListText(e.target.value)}
              rows={6}
              placeholder={"每行一个，或用逗号/空格分隔\n例如：\n123456789\n234567890\n345678901"}
            />
          </Form.Item>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={running}
            disabled={!rootDir.trim() || identifiers.length === 0}
            onClick={handleRun}
          >
            开始替换
          </Button>
        </Form>
      </Card>

      {(progress || running) && (
        <Card
          title={
            <Space>
              <span>执行进度</span>
              {taskId && <Text type="secondary" style={{ fontSize: 12 }}>{taskId}</Text>}
            </Space>
          }
          bordered={false}
        >
          <Space size={32} style={{ marginBottom: 16 }}>
            <Statistic title="总数" value={summary.total} />
            <Statistic title="已完成" value={summary.completed} />
            <Statistic title="成功" value={summary.success} valueStyle={{ color: "#3f8600" }} />
            <Statistic title="失败" value={summary.fail} valueStyle={{ color: "#cf1322" }} />
          </Space>
          {progress?.current && (
            <Alert type="info" showIcon style={{ marginBottom: 12 }} message={progress.current} />
          )}
          <Table
            size="small"
            rowKey="spuId"
            dataSource={rows}
            pagination={{ pageSize: 20 }}
            columns={[
              { title: "SPU / SKC", dataIndex: "spuId", width: 200 },
              {
                title: "状态",
                dataIndex: "status",
                width: 110,
                render: (v: ResultRow["status"]) => {
                  const tag = STATUS_TAG[v] || { color: "default", text: v };
                  return <Tag color={tag.color}>{tag.text}</Tag>;
                },
              },
              { title: "图片数", dataIndex: "files", width: 90 },
              { title: "信息", dataIndex: "message", ellipsis: true },
            ]}
          />
        </Card>
      )}
    </Space>
  );
}
