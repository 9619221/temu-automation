import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
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
  RocketOutlined,
  SyncOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/PageHeader";

const { Text } = Typography;

type ScrapeMethod = "scrapeProducts" | "scrapeAfterSales" | "scrapeSettlement";
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
  { key: "products", label: "商品信息", method: "scrapeProducts", storeKeys: ["temu_products"] },
  { key: "afterSales", label: "售后", method: "scrapeAfterSales", storeKeys: ["temu_raw_salesReturn", "temu_raw_returnOrders"] },
  { key: "settlement", label: "结算数据", method: "scrapeSettlement", storeKeys: ["temu_settlement"] },
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
  const successCount = selectedKeys.filter((key) => taskStates[key].status === "success").length;
  const runningCount = selectedKeys.filter((key) => taskStates[key].status === "running").length;

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
      appendLog("ERP 同步接口不可用", runId);
      message.warning("ERP 同步接口不可用");
      return;
    }

    appendLog("开始从云端增量同步 TEMU 销量到 ERP", runId);
    try {
      const response = await syncTemuSales({});
      if (!isCurrentRun(runId)) return;

      if (response?.ok) {
        const result = response.result || {};
        const detail = `店铺 ${result.shopCount ?? 0} 个，SKU ${result.skuCount ?? 0} 个，跳过 ${result.skuSkipped ?? 0} 条`;
        appendLog(`云端同步成功：${detail}`, runId);
        message.success(`云端同步成功：${detail}`);
        return;
      }

      const detail = response?.error || "未知错误";
      appendLog(`云端同步失败：${detail}`, runId);
      message.warning(`云端同步失败：${detail}`);
    } catch (error) {
      if (!isCurrentRun(runId)) return;
      const detail = getErrorMessage(error);
      appendLog(`云端同步失败：${detail}`, runId);
      message.warning(`云端同步失败：${detail}`);
    }
  }, [appendLog, isCurrentRun]);

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
    <div className="dashboard-shell temu-robots-shell">
      <PageHeader
        compact
        eyebrow="数据工作台"
        title="TEMU 机器人 · 销量数据(robot1)"
        subtitle="手动触发现有 TEMU 采集 IPC，展示进度与结果；采集完成后自动回灌 ERP，不做定时调度。"
        meta={[activeAccountId ? "已选择账号" : "等待账号", collecting ? "采集中" : "手动模式"]}
        actions={(
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

      <div className="robot-dashboard-grid">
        <section className="app-panel robot-control-panel">
          <div className="app-panel__title">
            <div>
              <div className="app-panel__title-main">
                <Space size={8}>
                  <DatabaseOutlined />
                  <span>采集面板</span>
                </Space>
              </div>
              <div className="app-panel__title-sub">选择要触发的采集模块，系统会按顺序执行并写回本地数据。</div>
            </div>
          </div>

          <div className="robot-task-selector">
            {ROBOT_TASKS.map((task) => {
              const selected = selectedKeys.includes(task.key);
              return (
                <div
                  key={task.key}
                  role="button"
                  tabIndex={collecting ? -1 : 0}
                  className={`robot-task-toggle${selected ? " is-selected" : ""}`}
                  aria-disabled={collecting}
                  onClick={() => { if (!collecting) handleToggleTask(task.key, !selected); }}
                  onKeyDown={(event) => {
                    if (collecting) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleToggleTask(task.key, !selected);
                    }
                  }}
                >
                  <Checkbox checked={selected} disabled={collecting} onClick={(event) => event.stopPropagation()} onChange={(event) => handleToggleTask(task.key, event.target.checked)} />
                  <span className="robot-task-toggle__label">{task.label}</span>
                  <span className="robot-task-toggle__meta">{task.storeKeys[0]}</span>
                </div>
              );
            })}
          </div>

          <div className="robot-progress-card">
            <div className="robot-progress-card__head">
              <Text strong>整体进度</Text>
              <Text type="secondary">已完成 {completedCount}/{selectedTotal}</Text>
            </div>
            <Progress
              percent={progressPercent}
              status={collecting ? "active" : failureCount > 0 ? "exception" : progressPercent === 100 && selectedTotal > 0 ? "success" : "normal"}
              strokeColor={failureCount > 0 ? "#ea4335" : "#1a73e8"}
              showInfo={false}
            />
          </div>

          <div className="robot-metric-grid">
            <div className="robot-metric">
              <span>已选</span>
              <strong>{selectedTotal}</strong>
            </div>
            <div className="robot-metric is-running">
              <span>运行中</span>
              <strong>{runningCount}</strong>
            </div>
            <div className="robot-metric is-success">
              <span>成功</span>
              <strong>{successCount}</strong>
            </div>
            <div className="robot-metric is-danger">
              <span>异常</span>
              <strong>{failureCount}</strong>
            </div>
          </div>
        </section>

        <section className="app-panel robot-log-panel">
          <div className="app-panel__title">
            <div>
              <div className="app-panel__title-main">执行日志</div>
              <div className="app-panel__title-sub">展示本次采集的关键事件与错误信息。</div>
            </div>
          </div>
          <div className="robot-log-stream">
            {logs.length > 0 ? logs.map((line, index) => (
              <div key={`${line}-${index}`} className="robot-log-line">{line}</div>
            )) : (
              <div className="robot-log-empty">等待开始采集。</div>
            )}
          </div>
        </section>
      </div>

      <section className="app-panel robot-results-panel">
        <div className="app-panel__title">
          <div>
            <div className="app-panel__title-main">采集结果</div>
            <div className="app-panel__title-sub">每个模块完成后可展开查看前 20 行数据预览。</div>
          </div>
        </div>

        <div className="robot-result-list">
          {ROBOT_TASKS.map((task) => {
            const state = taskStates[task.key];
            const statusMeta = STATUS_META[state.status];
            const previewRows = toPreviewRows(state.records);
            const previewColumns = buildPreviewColumns(state.records);

            return (
              <div
                key={task.key}
                className={`robot-task-row is-${state.status}`}
              >
                <div className="robot-task-row__head">
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
      </section>

      <BatchCollectSection />
      <ReviewsCloudSyncSection />
    </div>
  );
}

// ============ 批量店铺采集（机器人自动遍历 35 店）============

type BatchTaskKey = "products" | "afterSales" | "settlement";
const BATCH_TASKS: { key: BatchTaskKey; label: string }[] = [
  { key: "products", label: "商品信息" },
  { key: "afterSales", label: "售后数据" },
  { key: "settlement", label: "结算数据" },
];
// 结算任务在 worker 内部展开出的子项（不在勾选 UI 显示，仅用于结果汇总的中文名）
const BATCH_TASK_EXTRA_LABELS: Record<string, string> = {
  settleWait: "待结算",
  settleIn: "结算中",
  settleDone: "已到账",
  fundDetail: "账务费用",
};
function batchTaskLabel(key: string): string {
  return BATCH_TASKS.find((t) => t.key === key)?.label || BATCH_TASK_EXTRA_LABELS[key] || key;
}

interface BatchTaskStats {
  success: number;
  error: number;
  empty?: number;
  expired: number;
  noAccess: number;
  totalRecords: number;
}

interface BatchCollectResult {
  success: boolean;
  stats: {
    totalStores: number;
    totalAccounts: number;
    accountsUsed: number;
    tasks: Record<string, BatchTaskStats>;
  };
  totalItems: number;
  uploadedToCloud: number;
  collectedAt: string;
  uncoveredStores: string[];
}

interface MallItem {
  mall_id: string;
  mall_name: string;
  store_code: string;
  status?: string;
}

function BatchCollectSection() {
  const [selectedTasks, setSelectedTasks] = useState<BatchTaskKey[]>(["products", "afterSales", "settlement"]);
  const [collecting, setCollecting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [result, setResult] = useState<BatchCollectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [mallList, setMallList] = useState<MallItem[]>([]);
  const [selectedMallIds, setSelectedMallIds] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ current: number; total: number; currentMall: string } | null>(null);

  useEffect(() => {
    const api = (window as any).electronAPI;
    (async () => {
      try {
        const resp = await api?.erp?.reports?.mallDict?.();
        if (!resp?.ok || !Array.isArray(resp.data?.malls)) return;
        const malls: MallItem[] = resp.data.malls
          .filter((m: any) => m.status !== "test" && m.mall_id && m.store_code)
          .sort((a: any, b: any) => (a.store_code || "").localeCompare(b.store_code || ""));
        setMallList(malls);
        setSelectedMallIds(new Set(malls.map((m: MallItem) => m.mall_id)));

        // 自动按店铺名解析归属：店铺名带账号名（如「Lumen Global店铺」），按 name 子串匹配账号；
        // 写入映射表 → 采集时直接按这张表精准登对应账号，不再逐账号试探。
        const acctResp = await api?.automation?.listAccounts?.();
        if (!acctResp?.ok || !Array.isArray(acctResp.accounts)) return;
        const accts: { id: string; name: string }[] = acctResp.accounts.filter((a: any) => a.id && a.name);
        if (accts.length === 0) return;
        // 长名优先匹配，避免短名误匹配（如 "Lumen" 误匹配 "Lumen Global Studio"）
        const sortedAccts = [...accts].sort((a, b) => b.name.length - a.name.length);
        const mapping: Record<string, string[]> = {};
        let matched = 0;
        for (const m of malls) {
          const hay = String(m.mall_name || "").toLowerCase();
          if (!hay) continue;
          const acct = sortedAccts.find((a) => hay.includes(a.name.toLowerCase()));
          if (!acct) continue;
          if (!mapping[acct.id]) mapping[acct.id] = [];
          mapping[acct.id].push(m.mall_id);
          matched++;
        }
        if (matched > 0) {
          await api?.automation?.storeMappingSave?.(mapping);
          // 不打 message 提示，避免每次进入 TEMU 机器人页都弹通知
          console.log(`[batch-collect] 自动按店铺名建立映射：${Object.keys(mapping).length} 账号 / ${matched} 店`);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const handleToggle = (key: BatchTaskKey, checked: boolean) => {
    setSelectedTasks((prev) => checked ? [...prev, key] : prev.filter((k) => k !== key));
  };

  const handleToggleMall = useCallback((mallId: string, checked: boolean) => {
    setSelectedMallIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(mallId); else next.delete(mallId);
      return next;
    });
  }, []);

  const handleSelectAllMalls = useCallback((checked: boolean) => {
    setSelectedMallIds(checked ? new Set(mallList.map((m) => m.mall_id)) : new Set());
  }, [mallList]);

  const handleStart = useCallback(async () => {
    const batchCollect = window.electronAPI?.automation?.batchCollect;
    if (typeof batchCollect !== "function") {
      message.warning("当前版本不支持批量采集，请升级桌面端");
      return;
    }
    if (selectedTasks.length === 0) {
      message.warning("请至少选择一个采集类型");
      return;
    }
    if (mallList.length > 0 && selectedMallIds.size === 0) {
      message.warning("请至少选择一个店铺");
      return;
    }

    const selectedMalls = mallList.length > 0
      ? mallList.filter((m) => selectedMallIds.has(m.mall_id)).map((m) => ({ mall_id: m.mall_id, store_code: m.store_code }))
      : [];
    if (selectedMalls.length === 0) {
      message.warning("没有可采集的店铺");
      return;
    }

    setCollecting(true);
    setResult(null);
    setError(null);
    setStartedAt(new Date().toISOString());
    setProgress({ current: 0, total: selectedMalls.length, currentMall: `准备按店铺顺序采集 ${selectedMalls.length} 店...` });
    // 监听 main 推送的逐店进度
    const api = (window as any).electronAPI;
    const offProgress = api?.automation?.onBatchCollectProgress?.((payload: any) => {
      if (!payload) return;
      setProgress({
        current: payload.current || 0,
        total: payload.total || selectedMalls.length,
        currentMall: `正在采集第 ${payload.current}/${payload.total} 店：${payload.tag || ""}（账号 ${payload.accLabel || "-"}） · 已上报 ${payload.uploaded || 0} 项`,
      });
    });

    try {
      const resp = await batchCollect({
        tasks: selectedTasks,
        selectedMalls,
      });

      if (resp?.success) {
        setResult(resp);
        const tasks = resp.stats?.tasks || {};
        const taskSummary = Object.entries(tasks)
          .map(([k, s]: [string, any]) => `${batchTaskLabel(k)}: ${s.success}店/${s.totalRecords}条`)
          .join("，");
        const uncovered = resp.uncoveredStores?.length || 0;
        if (uncovered === 0) {
          message.success(`批量采集完成：${taskSummary}`);
        } else {
          message.warning(`采集完成，${uncovered} 个店铺未覆盖。${taskSummary}`);
        }
      } else {
        setError(resp?.error || "未知错误");
        if (resp?.stats) setResult(resp);
        message.warning(resp?.error || "批量采集失败");
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(detail);
      message.warning(`批量采集异常：${detail}`);
    }

    if (typeof offProgress === "function") offProgress();
    setCollecting(false);
    setStopping(false);
    setProgress(null);
  }, [selectedTasks, mallList, selectedMallIds]);

  const handleStop = useCallback(async () => {
    const stop = (window as any).electronAPI?.automation?.batchCollectStop;
    if (typeof stop !== "function") return;
    setStopping(true);
    try {
      await stop();
      message.info("已强制停止：当前采集进程和浏览器已关闭，已采数据已落库");
    } catch {
      message.warning("停止请求失败");
      setStopping(false);
    }
  }, []);

  return (
    <section className="app-panel" style={{ marginTop: 16 }}>
      <div className="app-panel__title">
        <div>
          <div className="app-panel__title-main">
            <Space size={8}>
              <RocketOutlined />
              <span>批量店铺采集 · 已选 {selectedMallIds.size} 店</span>
            </Space>
          </div>
          <div className="app-panel__title-sub">
            选择店铺和采集类型，机器人按顺序逐店采集。遇到验证码会等待 5 分钟供手动处理。
          </div>
        </div>
        {collecting ? (
          <Button
            danger
            icon={<CloseCircleOutlined />}
            loading={stopping}
            onClick={handleStop}
          >
            {stopping ? "正在停止..." : "停止采集"}
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<RocketOutlined />}
            disabled={selectedTasks.length === 0 || (mallList.length > 0 && selectedMallIds.size === 0)}
            onClick={handleStart}
          >
            一键批量采集
          </Button>
        )}
      </div>

      <div className="robot-task-selector" style={{ marginTop: 12 }}>
        {BATCH_TASKS.map((task) => {
          const selected = selectedTasks.includes(task.key);
          return (
            <div
              key={task.key}
              role="button"
              tabIndex={collecting ? -1 : 0}
              className={`robot-task-toggle${selected ? " is-selected" : ""}`}
              aria-disabled={collecting}
              onClick={() => { if (!collecting) handleToggle(task.key, !selected); }}
              onKeyDown={(e) => {
                if (collecting) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleToggle(task.key, !selected);
                }
              }}
            >
              <Checkbox checked={selected} disabled={collecting} onClick={(e) => e.stopPropagation()} onChange={(e) => handleToggle(task.key, e.target.checked)} />
              <span className="robot-task-toggle__label">{task.label}</span>
            </div>
          );
        })}
      </div>

      {mallList.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Checkbox
              indeterminate={selectedMallIds.size > 0 && selectedMallIds.size < mallList.length}
              checked={selectedMallIds.size === mallList.length}
              onChange={(e) => handleSelectAllMalls(e.target.checked)}
              disabled={collecting}
            />
            <Text strong style={{ fontSize: 13 }}>选择店铺 ({selectedMallIds.size}/{mallList.length})</Text>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "2px 8px",
            maxHeight: 180,
            overflowY: "auto",
            padding: "4px 0",
          }}>
            {mallList.map((mall) => (
              <Checkbox
                key={mall.mall_id}
                checked={selectedMallIds.has(mall.mall_id)}
                onChange={(e) => handleToggleMall(mall.mall_id, e.target.checked)}
                disabled={collecting}
                style={{ fontSize: 12 }}
              >
                <span style={{ fontSize: 12 }}>{mall.store_code}</span>
              </Checkbox>
            ))}
          </div>
        </div>
      )}

      {collecting && progress ? (
        <div style={{ marginTop: 12 }}>
          <Progress
            percent={99}
            status="active"
            strokeColor="#1a73e8"
            format={() => `${progress.total} 店`}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {progress.currentMall || `正在逐账号登录采集 ${progress.total} 个店铺，每个账号独立登录...`}
          </Text>
        </div>
      ) : null}

      {error ? (
        <Alert type="error" showIcon style={{ marginTop: 12 }} message="批量采集失败" description={error} />
      ) : null}

      {result ? (
        <>
          <div className="robot-metric-grid" style={{ marginTop: 12 }}>
            {Object.entries(result.stats?.tasks || {}).map(([taskKey, stats]: [string, any]) => (
              <div key={taskKey} className="robot-metric is-success">
                <span>{batchTaskLabel(taskKey)}</span>
                <strong>{stats.success}店 / {stats.totalRecords}条</strong>
              </div>
            ))}
            <div className="robot-metric">
              <span>云端上报</span>
              <strong>{result.uploadedToCloud} 条</strong>
            </div>
          </div>
          <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
            采集完成于 {new Date(result.collectedAt).toLocaleString()}
            {startedAt ? ` (耗时 ${Math.round((new Date(result.collectedAt).getTime() - new Date(startedAt).getTime()) / 1000)}秒)` : ""}
            {result.stats?.accountsUsed ? ` · 使用 ${result.stats.accountsUsed}/${result.stats.totalAccounts} 个账号` : ""}
          </Text>
          {result.uncoveredStores?.length > 0 ? (
            <Text type="warning" style={{ display: "block", marginTop: 4, fontSize: 12 }}>
              未覆盖店铺({result.uncoveredStores.length}): {result.uncoveredStores.join(", ")}
            </Text>
          ) : null}
        </>
      ) : null}
    </section>
  );
}


interface ReviewSyncResult {
  reviewUpserted?: number;
  reviewSkipped?: number;
  reviewCursor?: string;
  startedAt?: string;
  finishedAt?: string;
}

function ReviewsCloudSyncSection() {
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<ReviewSyncResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  const handleSync = useCallback(async () => {
    const syncFn = window.electronAPI?.erp?.syncTemuReviewsFromCloud;
    if (typeof syncFn !== "function") {
      message.warning("当前桌面端版本不支持评价云端同步，请升级");
      return;
    }
    setSyncing(true);
    setLastError(null);
    try {
      const resp = await syncFn({});
      if (resp?.ok) {
        setLastResult(resp.result || null);
        setLastRunAt(new Date().toISOString());
        const detail = `评价 ${resp.result?.reviewUpserted ?? 0} 条`;
        message.success(`同步完成：${detail}`);
      } else {
        setLastError(resp?.error || "未知错误");
        message.warning(`同步失败：${resp?.error || "未知错误"}`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setLastError(detail);
      message.warning(`同步失败：${detail}`);
    } finally {
      setSyncing(false);
    }
  }, []);

  return (
    <section className="app-panel" style={{ marginTop: 16 }}>
      <div className="app-panel__title">
        <div>
          <div className="app-panel__title-main">
            <Space size={8}>
              <SyncOutlined />
              <span>商品评价 · 云端同步</span>
            </Space>
          </div>
          <div className="app-panel__title-sub">
            数据由 Chrome 扩展捕获 TEMU 评价分页接口（/bg-luna-agent-seller/review/pageQuery）写入云端，本按钮触发增量同步到本地 ERP（erp_temu_reviews）。运营访问评价页时数据自动累积。
          </div>
        </div>
        <Button
          type="primary"
          icon={<SyncOutlined />}
          loading={syncing}
          disabled={syncing}
          onClick={handleSync}
        >
          从云端同步
        </Button>
      </div>

      {lastError ? (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 12 }}
          message="同步失败"
          description={lastError}
        />
      ) : null}

      {lastResult ? (
        <div className="robot-metric-grid" style={{ marginTop: 12 }}>
          <div className="robot-metric is-success">
            <span>评价写入</span>
            <strong>{lastResult.reviewUpserted ?? 0}</strong>
          </div>
          <div className="robot-metric">
            <span>跳过</span>
            <strong>{lastResult.reviewSkipped ?? 0}</strong>
          </div>
        </div>
      ) : null}

      {lastRunAt ? (
        <Text type="secondary" style={{ display: "block", marginTop: 12, fontSize: 12 }}>
          最近同步：{new Date(lastRunAt).toLocaleString()}
        </Text>
      ) : null}
    </section>
  );
}
