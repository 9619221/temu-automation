import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Empty,
  Progress,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { readActiveAccountId } from "../utils/multiStore";
import type { ColumnsType } from "antd/es/table";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  LoadingOutlined,
  SyncOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";

const { Text } = Typography;

type ScrapeMethod = "scrapeSales" | "scrapeProducts" | "scrapeGoodsData" | "scrapeAfterSales" | "scrapeActivity";
type RobotTaskStatus = "pending" | "running" | "success" | "error" | "unavailable";
type PreviewRow = Record<string, unknown>;

interface RobotTask {
  key: string;
  label: string;
  method: ScrapeMethod;
  storeKeys: readonly string[];
}

interface RobotTaskState {
  status: RobotTaskStatus;
  message?: string;
  duration?: number;
  count?: number;
  records: unknown[];
  usedStoreKey?: string;
}

const ROBOT_TASKS = [
  { key: "sales", label: "销量", method: "scrapeSales", storeKeys: ["temu_sales", "temu_raw_salesChart"] },
  { key: "products", label: "商品信息", method: "scrapeProducts", storeKeys: ["temu_products"] },
  { key: "quality", label: "质量分", method: "scrapeGoodsData", storeKeys: ["temu_raw_goodsData", "temu_raw_yunduQualityMetrics"] },
  { key: "afterSales", label: "售后", method: "scrapeAfterSales", storeKeys: ["temu_raw_salesReturn", "temu_raw_returnOrders"] },
  { key: "activity", label: "活动报价", method: "scrapeActivity", storeKeys: ["temu_raw_activity"] },
] as const satisfies readonly RobotTask[];

type RobotTaskKey = (typeof ROBOT_TASKS)[number]["key"];
type RobotTaskStateMap = Record<RobotTaskKey, RobotTaskState>;

const STATUS_META: Record<RobotTaskStatus, { label: string; color: "default" | "processing" | "success" | "error" | "warning"; icon: JSX.Element }> = {
  pending: { label: "待执行", color: "default", icon: <ClockCircleOutlined /> },
  running: { label: "采集中", color: "processing", icon: <LoadingOutlined spin /> },
  success: { label: "成功", color: "success", icon: <CheckCircleOutlined /> },
  error: { label: "失败", color: "error", icon: <CloseCircleOutlined /> },
  unavailable: { label: "不可用", color: "warning", icon: <WarningOutlined /> },
};

const createInitialStates = (): RobotTaskStateMap => (
  ROBOT_TASKS.reduce((states, task) => {
    states[task.key] = { status: "pending", records: [] };
    return states;
  }, {} as RobotTaskStateMap)
);

function getScrapeMethod(method: ScrapeMethod): (() => Promise<unknown>) | null {
  const automation = window.electronAPI?.automation;
  const scrape = automation?.[method];
  return typeof scrape === "function" ? scrape.bind(automation) : null;
}

function extractRecords(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const payload = raw as { list?: unknown; data?: unknown };
    if (Array.isArray(payload.list)) return payload.list;
    if (Array.isArray(payload.data)) return payload.data;
  }
  return [];
}

async function readStoreRecords(storeKeys: readonly string[]) {
  const store = window.electronAPI?.store;
  if (!store?.get) throw new Error("本地存储接口不可用");

  let fallback = { storeKey: storeKeys[0] || "", records: [] as unknown[] };
  for (const storeKey of storeKeys) {
    const raw = await store.get(storeKey);
    const records = extractRecords(raw);
    if (records.length > 0) return { storeKey, records };
    if (storeKey === storeKeys[0]) fallback = { storeKey, records };
  }
  return fallback;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "未知错误";
}

function normalizeProgressText(snapshot: unknown) {
  if (!snapshot) return "";
  if (typeof snapshot === "string") return snapshot;
  try {
    const text = JSON.stringify(snapshot);
    return text.length > 240 ? `${text.slice(0, 240)}...` : text;
  } catch {
    return "";
  }
}

async function readScrapeProgressText() {
  const getProgress = window.electronAPI?.automation?.getScrapeProgress;
  if (typeof getProgress !== "function") return "";
  try {
    return normalizeProgressText(await getProgress());
  } catch {
    return "";
  }
}

function formatCellValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function toPreviewRows(records: unknown[]): PreviewRow[] {
  return records.slice(0, 20).map((record) => {
    if (record && typeof record === "object" && !Array.isArray(record)) {
      return record as PreviewRow;
    }
    return { value: record };
  });
}

function buildPreviewColumns(records: unknown[]): ColumnsType<PreviewRow> {
  const rows = toPreviewRows(records);
  const first = rows[0];
  const keys = first ? Object.keys(first) : [];
  return keys.map((key) => ({
    title: key === "value" ? "值" : key,
    dataIndex: key,
    key,
    ellipsis: true,
    render: (value: unknown) => formatCellValue(value),
  }));
}

function getStatusLine(state: RobotTaskState) {
  if (state.status === "success") {
    return `${state.duration?.toFixed(1) || "0.0"} 秒 · ${state.count ?? 0} 条`;
  }
  if (state.status === "error" || state.status === "unavailable") return state.message || "-";
  if (state.status === "running") return "正在调用 TEMU 采集 IPC";
  return "等待手动触发";
}

export default function TemuRobots() {
  const [selectedKeys, setSelectedKeys] = useState<RobotTaskKey[]>(() => ROBOT_TASKS.map((task) => task.key));
  const [taskStates, setTaskStates] = useState<RobotTaskStateMap>(() => createInitialStates());
  const [logs, setLogs] = useState<string[]>([]);
  const [collecting, setCollecting] = useState(false);
  const [activeAccountId, setActiveAccountId] = useState<string | null | undefined>(undefined);
  const mountedRef = useRef(false);
  const runIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    readActiveAccountId((window as any).electronAPI?.store)
      .then((id) => { if (!cancelled) setActiveAccountId(id); })
      .catch(() => { if (!cancelled) setActiveAccountId(null); });
    return () => {
      cancelled = true;
      mountedRef.current = false;
      runIdRef.current += 1;
    };
  }, []);

  const noActiveAccount = activeAccountId === null;

  const isCurrentRun = useCallback((runId: number) => mountedRef.current && runIdRef.current === runId, []);

  const appendLog = useCallback((line: string, runId?: number) => {
    if (!mountedRef.current || (runId !== undefined && runIdRef.current !== runId)) return;
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setLogs((prev) => [...prev, `[${time}] ${line}`]);
  }, []);

  const updateTaskState = useCallback((key: RobotTaskKey, patch: Partial<RobotTaskState>, runId: number) => {
    if (!isCurrentRun(runId)) return;
    setTaskStates((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...patch,
      },
    }));
  }, [isCurrentRun]);

  const selectedTotal = selectedKeys.length;
  const completedCount = useMemo(() => (
    selectedKeys.reduce((total, key) => (
      ["success", "error", "unavailable"].includes(taskStates[key].status) ? total + 1 : total
    ), 0)
  ), [selectedKeys, taskStates]);
  const progressPercent = selectedTotal > 0 ? Math.round((completedCount / selectedTotal) * 100) : 0;
  const failureCount = selectedKeys.filter((key) => taskStates[key].status === "error" || taskStates[key].status === "unavailable").length;

  const handleToggleTask = (key: RobotTaskKey, checked: boolean) => {
    setSelectedKeys((prev) => (
      checked ? [...prev, key] : prev.filter((item) => item !== key)
    ));
  };

  const appendProgressSnapshot = async (runId: number) => {
    const progressText = await readScrapeProgressText();
    if (progressText && isCurrentRun(runId)) appendLog(`采集进度：${progressText}`, runId);
  };

  const syncTemuSalesToErp = useCallback(async (runId: number) => {
    const syncTemuSales = window.electronAPI?.erp?.syncTemuSales;
    if (typeof syncTemuSales !== "function") {
      appendLog("ERP 回灌接口不可用", runId);
      message.warning("ERP 回灌接口不可用");
      return;
    }

    let salesData: unknown;
    try {
      salesData = await window.electronAPI?.store?.get("temu_sales");
    } catch (error) {
      if (!isCurrentRun(runId)) return;
      appendLog(`未取到销量数据，跳过 ERP 回灌：${getErrorMessage(error)}`, runId);
      message.warning("未取到销量数据，跳过 ERP 回灌");
      return;
    }
    if (!isCurrentRun(runId)) return;

    if (!salesData || typeof salesData !== "object" || !Array.isArray((salesData as { items?: unknown }).items)) {
      appendLog("未取到销量数据，跳过 ERP 回灌", runId);
      message.warning("未取到销量数据，跳过 ERP 回灌");
      return;
    }

    appendLog("开始 ERP 回灌销量数据", runId);
    try {
      const response = await syncTemuSales({
        salesData,
        accountId: activeAccountId ?? undefined,
        shopName: undefined,
        statDate: undefined,
      });
      if (!isCurrentRun(runId)) return;

      if (response?.ok) {
        const result = response.result || {};
        const detail = `店铺 ${result.shopCount ?? 0} 个，SKU ${result.skuCount ?? 0} 个，跳过 ${result.skippedCount ?? 0} 条`;
        appendLog(`ERP 回灌成功：${detail}`, runId);
        message.success(`ERP 回灌成功：${detail}`);
        return;
      }

      const detail = response?.error || "未知错误";
      appendLog(`ERP 回灌失败：${detail}`, runId);
      message.warning(`ERP 回灌失败：${detail}`);
    } catch (error) {
      if (!isCurrentRun(runId)) return;
      const detail = getErrorMessage(error);
      appendLog(`ERP 回灌失败：${detail}`, runId);
      message.warning(`ERP 回灌失败：${detail}`);
    }
  }, [activeAccountId, appendLog, isCurrentRun]);

  const handleStart = async () => {
    if (collecting || selectedTotal === 0) return;
    if (noActiveAccount) {
      message.warning("未选择活动账号，请先到「账号管理」选择一个 TEMU 账号");
      return;
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setCollecting(true);
    setTaskStates(createInitialStates());
    setLogs([]);
    appendLog(`开始 robot1 手动采集，已选择 ${selectedTotal} 项`, runId);

    const selectedTasks = ROBOT_TASKS.filter((task) => selectedKeys.includes(task.key));
    let runSuccessCount = 0;
    let runFailureCount = 0;
    for (const task of selectedTasks) {
      if (!isCurrentRun(runId)) return;

      const scrape = getScrapeMethod(task.method);
      if (!scrape) {
        updateTaskState(task.key, { status: "unavailable", message: "采集接口不可用" }, runId);
        appendLog(`${task.label} 不可用：缺少 ${task.method}`, runId);
        runFailureCount += 1;
        continue;
      }

      const startedAt = Date.now();
      updateTaskState(task.key, { status: "running", message: undefined, records: [], count: undefined, duration: undefined }, runId);
      appendLog(`开始采集：${task.label}`, runId);
      await appendProgressSnapshot(runId);

      try {
        const result = await scrape();
        if (result && typeof result === "object" && "success" in result && (result as { success?: unknown }).success === false) {
          const resultError = (result as { error?: unknown; message?: unknown }).error ?? (result as { message?: unknown }).message;
          throw new Error(getErrorMessage(resultError));
        }

        const { storeKey, records } = await readStoreRecords(task.storeKeys);
        const duration = (Date.now() - startedAt) / 1000;
        updateTaskState(task.key, {
          status: "success",
          message: "采集完成",
          duration,
          count: records.length,
          records,
          usedStoreKey: storeKey,
        }, runId);
        appendLog(`完成采集：${task.label}，${records.length} 条，耗时 ${duration.toFixed(1)} 秒`, runId);
        runSuccessCount += 1;
      } catch (error) {
        const detail = getErrorMessage(error);
        const duration = (Date.now() - startedAt) / 1000;
        updateTaskState(task.key, {
          status: "error",
          message: detail,
          duration,
          records: [],
          count: 0,
        }, runId);
        appendLog(`采集失败：${task.label}，${detail}`, runId);
        message.error(`${task.label} 失败：${detail}`);
        runFailureCount += 1;
      }

      await appendProgressSnapshot(runId);
    }

    if (!isCurrentRun(runId)) return;
    appendLog(`robot1 手动采集结束：成功 ${runSuccessCount} 项，失败 ${runFailureCount} 项`, runId);
    if (runSuccessCount > 0) {
      await syncTemuSalesToErp(runId);
    }
    if (!isCurrentRun(runId)) return;
    setCollecting(false);
    if (runFailureCount > 0) {
      message.warning(`采集完成：成功 ${runSuccessCount} 项，失败 ${runFailureCount} 项`);
    } else {
      message.success(`采集完成：成功 ${runSuccessCount} 项，失败 ${runFailureCount} 项`);
    }
  };

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="数据工作台"
        title="TEMU 机器人 · 销量数据(robot1)"
        subtitle="手动触发现有 TEMU 采集 IPC，展示进度与结果；采集完成后自动回灌 ERP，不做定时调度。"
      />

      {noActiveAccount ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="未选择活动账号"
          description="当前没有选中的 TEMU 账号，采集结果不会按账号入库，面板将看不到数据。请先到「账号管理」选择一个账号后再采集。"
        />
      ) : null}

      <Card
        title={(
          <Space size={8}>
            <DatabaseOutlined />
            <span>robot1 采集面板</span>
          </Space>
        )}
        extra={(
          <Button
            type="primary"
            icon={<SyncOutlined />}
            loading={collecting}
            disabled={collecting || selectedTotal === 0 || noActiveAccount}
            onClick={handleStart}
          >
            开始采集
          </Button>
        )}
      >
        <Space size={[16, 8]} wrap style={{ marginBottom: 16 }}>
          {ROBOT_TASKS.map((task) => (
            <Checkbox
              key={task.key}
              checked={selectedKeys.includes(task.key)}
              disabled={collecting}
              onChange={(event) => handleToggleTask(task.key, event.target.checked)}
            >
              {task.label}
            </Checkbox>
          ))}
        </Space>

        <div style={{ marginBottom: 16 }}>
          <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }} wrap>
            <Text strong>整体进度</Text>
            <Text type="secondary">
              已完成 {completedCount}/{selectedTotal}
            </Text>
          </Space>
          <Progress
            percent={progressPercent}
            status={collecting ? "active" : failureCount > 0 ? "exception" : progressPercent === 100 && selectedTotal > 0 ? "success" : "normal"}
            showInfo={false}
          />
        </div>

        <div
          style={{
            marginBottom: 18,
            border: "1px solid #f0f0f0",
            borderRadius: 8,
            background: "#111827",
            color: "#e5e7eb",
            minHeight: 120,
            maxHeight: 220,
            overflow: "auto",
            padding: 12,
            fontFamily: "Consolas, monospace",
            fontSize: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {logs.length > 0 ? logs.join("\n") : "等待开始采集。"}
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {ROBOT_TASKS.map((task) => {
            const state = taskStates[task.key];
            const statusMeta = STATUS_META[state.status];
            const previewRows = toPreviewRows(state.records);
            const previewColumns = buildPreviewColumns(state.records);

            return (
              <div
                key={task.key}
                style={{
                  border: "1px solid #f0f0f0",
                  borderRadius: 8,
                  padding: 12,
                  background: state.status === "running" ? "#fff7e6" : "#fff",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <Space size={10}>
                    <Text strong>{task.label}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{task.storeKeys[0]}</Text>
                  </Space>
                  <Space size={8} wrap>
                    <Text type={state.status === "error" ? "danger" : "secondary"} style={{ fontSize: 12 }}>
                      {getStatusLine(state)}
                    </Text>
                    <Tag color={statusMeta.color} icon={statusMeta.icon} style={{ margin: 0 }}>
                      {statusMeta.label}
                    </Tag>
                  </Space>
                </div>

                {state.status === "success" ? (
                  <Collapse
                    ghost
                    style={{ marginTop: 8 }}
                    items={[
                      {
                        key: `${task.key}-data`,
                        label: (
                          <Space size={8}>
                            <span>查看数据</span>
                            <Tag style={{ margin: 0 }}>{state.usedStoreKey || task.storeKeys[0]}</Tag>
                            <Text type="secondary">前 20 行</Text>
                          </Space>
                        ),
                        children: previewRows.length > 0 ? (
                          <Table
                            size="small"
                            rowKey={(_, index) => `${task.key}-${index ?? 0}`}
                            columns={previewColumns}
                            dataSource={previewRows}
                            pagination={false}
                            scroll={{ x: "max-content" }}
                          />
                        ) : (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
                        ),
                      },
                    ]}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
