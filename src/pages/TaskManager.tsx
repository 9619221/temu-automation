import { useEffect, useMemo, useState } from "react";
import { Button, Table, Tag, Typography, message } from "antd";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import type { ColumnsType } from "antd/es/table";
import { SyncOutlined } from "@ant-design/icons";
import {
  COLLECTION_DIAGNOSTICS_KEY,
  normalizeCollectionDiagnostics,
  type CollectionTaskDiagnostic,
  type CollectionDiagnostics,
} from "../utils/collectionDiagnostics";
import { setStoreValueForActiveAccount } from "../utils/multiStore";
import {
  parseDashboardData,
  parseFluxData,
  parseOrdersData,
  parseProductsData,
  parseSalesData,
} from "../utils/parseRawApis";

const { Text } = Typography;
const automation = window.electronAPI?.automation;
const store = window.electronAPI?.store;

const TASK_MANAGER_STATE_KEY = "temu_task_manager_state";

type TaskStatus = "idle" | "running" | "success" | "error";
type TaskId = "sync_dashboard" | "sync_products" | "sync_orders" | "sync_analytics";
type CollectionTaskKey = "dashboard" | "products" | "orders" | "sales" | "flux";

interface TaskConfig {
  id: TaskId;
  name: string;
  description: string;
  interval: string;
  status: TaskStatus;
  lastRun?: string;
  lastMessage?: string;
  count?: number;
}

interface TaskManagerState {
  tasks: TaskConfig[];
}


const DEFAULT_TASKS: TaskConfig[] = [
  {
    id: "sync_dashboard",
    name: "同步店铺概览",
    description: "同步仪表盘概览数据，更新店铺概览页中的核心看板。",
    interval: "手动执行",
    status: "idle",
  },
  {
    id: "sync_products",
    name: "同步商品列表",
    description: "同步商品列表数据，刷新商品列表和商品详情页的基础商品信息。",
    interval: "手动执行",
    status: "idle",
  },
  {
    id: "sync_orders",
    name: "同步备货单",
    description: "同步备货单和库存相关数据，为商品列表和详情页补齐备货视角。",
    interval: "手动执行",
    status: "idle",
  },
  {
    id: "sync_analytics",
    name: "同步销售与流量",
    description: "顺序同步销售数据和流量分析，刷新商品经营相关页面。",
    interval: "手动执行",
    status: "idle",
  },
];

const defaultState: TaskManagerState = {
  tasks: DEFAULT_TASKS,
};

const TASK_KEY_MAP: Record<TaskId, CollectionTaskKey | "analytics"> = {
  sync_dashboard: "dashboard",
  sync_products: "products",
  sync_orders: "orders",
  sync_analytics: "analytics",
};

function mergeTaskState(savedTasks: unknown, diagnostics: CollectionDiagnostics): TaskConfig[] {
  const savedList = Array.isArray(savedTasks) ? (savedTasks as Partial<TaskConfig>[]) : [];
  const savedMap = new Map(savedList.map((task) => [task.id, task]));

  const nextTasks = DEFAULT_TASKS.map((task) => {
    const saved = savedMap.get(task.id) || {};
    return {
      ...task,
      ...saved,
      status: saved.status === "running" ? "idle" : (saved.status ?? task.status),
    };
  });

  const applyDiagnosticToTask = (
    taskId: Extract<TaskId, "sync_dashboard" | "sync_products" | "sync_orders">,
    diagnosticKey: CollectionTaskKey,
  ) => {
    const diagnostic = diagnostics.tasks[diagnosticKey];
    if (!diagnostic) return;
    const index = nextTasks.findIndex((task) => task.id === taskId);
    if (index < 0) return;
    nextTasks[index] = {
      ...nextTasks[index],
      status: diagnostic.status === "success" ? "success" : "error",
      lastRun: diagnostic.updatedAt || nextTasks[index].lastRun,
      lastMessage: diagnostic.message || nextTasks[index].lastMessage,
      count: diagnostic.count ?? nextTasks[index].count,
    };
  };

  applyDiagnosticToTask("sync_dashboard", "dashboard");
  applyDiagnosticToTask("sync_products", "products");
  applyDiagnosticToTask("sync_orders", "orders");

  const salesDiagnostic = diagnostics.tasks.sales;
  const fluxDiagnostic = diagnostics.tasks.flux;
  const analyticsIndex = nextTasks.findIndex((task) => task.id === "sync_analytics");
  if (analyticsIndex >= 0 && (salesDiagnostic || fluxDiagnostic)) {
    const latestRun = [salesDiagnostic?.updatedAt, fluxDiagnostic?.updatedAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .pop();
    const hasError = [salesDiagnostic, fluxDiagnostic].some((task) => task?.status === "error");
    const messageParts = [
      salesDiagnostic
        ? salesDiagnostic.status === "success"
          ? `销售${salesDiagnostic.count ?? 0}条`
          : `销售失败${salesDiagnostic.message ? `：${salesDiagnostic.message}` : ""}`
        : null,
      fluxDiagnostic
        ? fluxDiagnostic.status === "success"
          ? `流量${fluxDiagnostic.count ?? 0}条`
          : `流量失败${fluxDiagnostic.message ? `：${fluxDiagnostic.message}` : ""}`
        : null,
    ].filter(Boolean);

    nextTasks[analyticsIndex] = {
      ...nextTasks[analyticsIndex],
      status: hasError ? "error" : "success",
      lastRun: latestRun || nextTasks[analyticsIndex].lastRun,
      lastMessage: messageParts.join("；") || nextTasks[analyticsIndex].lastMessage,
      count: [salesDiagnostic?.count, fluxDiagnostic?.count].reduce<number>((sum, value) => (
        typeof value === "number" ? sum + value : sum
      ), 0),
    };
  }

  return nextTasks;
}

function unwrapScrapePayload(taskKey: CollectionTaskKey, rawResult: any) {
  if (!rawResult || typeof rawResult !== "object") {
    return rawResult;
  }

  const direct = rawResult[taskKey];
  if (direct !== undefined) {
    return direct;
  }

  const aliasMap: Partial<Record<CollectionTaskKey, string>> = {
    dashboard: "dashboard",
    products: "products",
    orders: "orders",
    sales: "sales",
    flux: "flux",
  };
  const aliasKey = aliasMap[taskKey];
  return aliasKey && rawResult[aliasKey] !== undefined ? rawResult[aliasKey] : rawResult;
}

function getStoreKey(taskKey: CollectionTaskKey) {
  switch (taskKey) {
    case "dashboard":
      return "temu_dashboard";
    case "products":
      return "temu_products";
    case "orders":
      return "temu_orders";
    case "sales":
      return "temu_sales";
    case "flux":
      return "temu_flux";
    default:
      return "";
  }
}

function getTaskCount(taskKey: CollectionTaskKey, rawData: any, storeData: any) {
  if (taskKey === "products" || taskKey === "orders") {
    return Array.isArray(storeData) ? storeData.length : 0;
  }
  if (taskKey === "sales") {
    return Array.isArray(storeData?.items) ? storeData.items.length : (rawData?.apis?.length || 0);
  }
  if (taskKey === "flux") {
    return rawData?.apis?.length
      || (Array.isArray(storeData?.overview) ? storeData.overview.length : 0)
      || (storeData?.global ? Object.keys(storeData.global).length : 0)
      || 0;
  }
  if (taskKey === "dashboard") {
    return Object.values(storeData || {}).filter((value) => value !== null && value !== undefined).length;
  }
  return rawData?.apis?.length || 0;
}

async function persistCollectionDiagnostic(taskKey: CollectionTaskKey, diagnostic: CollectionTaskDiagnostic) {
  if (!store) return;

  const current = normalizeCollectionDiagnostics(await store.get(COLLECTION_DIAGNOSTICS_KEY));
  const tasks = {
    ...current.tasks,
    [taskKey]: diagnostic,
  };
  await setStoreValueForActiveAccount(store, COLLECTION_DIAGNOSTICS_KEY, {
    syncedAt: diagnostic.updatedAt,
    tasks,
    summary: {
      totalTasks: Math.max(current.summary.totalTasks, Object.keys(tasks).length),
      successCount: Object.values(tasks).filter((task) => task.status === "success").length,
      errorCount: Object.values(tasks).filter((task) => task.status === "error").length,
    },
  });
}

export default function TaskManager() {
  const [tasks, setTasks] = useState<TaskConfig[]>(DEFAULT_TASKS);
  const [runningTaskId, setRunningTaskId] = useState<TaskId | null>(null);
  const [diagnostics, setDiagnostics] = useState<CollectionDiagnostics>(() => normalizeCollectionDiagnostics(null));

  useEffect(() => {
    let mounted = true;

    Promise.all([
      store?.get(TASK_MANAGER_STATE_KEY),
      store?.get(COLLECTION_DIAGNOSTICS_KEY),
    ]).then(([savedState, rawDiagnostics]) => {
      if (!mounted) return;

      const normalizedDiagnostics = normalizeCollectionDiagnostics(rawDiagnostics);
      setDiagnostics(normalizedDiagnostics);
      setTasks(mergeTaskState(savedState?.tasks, normalizedDiagnostics));
    }).catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!store) return;
    const state: TaskManagerState = { tasks };
    setStoreValueForActiveAccount(store, TASK_MANAGER_STATE_KEY, state).catch(() => {});
  }, [tasks]);

  const updateTask = (id: TaskId, patch: Partial<TaskConfig>) => {
    setTasks((prev) => prev.map((task) => (
      task.id === id ? { ...task, ...patch } : task
    )));
  };

  const persistCollectionTask = async (
    taskKey: CollectionTaskKey,
    run: () => Promise<any>,
  ) => {
    if (!automation || !store) {
      throw new Error("桌面端自动化接口未就绪，请在 Electron 客户端内运行。");
    }

    const startedAt = Date.now();
    const rawResult = await run();
    const rawData = unwrapScrapePayload(taskKey, rawResult);
    if (rawData === null || rawData === undefined) {
      throw new Error("未收到采集结果，请稍后重试。");
    }

    const syncedAt = new Date().toLocaleString("zh-CN");
    let storeData: any = rawData;

    if (taskKey === "dashboard") {
      storeData = parseDashboardData(rawData);
      await setStoreValueForActiveAccount(store, getStoreKey(taskKey), { ...storeData, syncedAt });
    } else if (taskKey === "products") {
      storeData = parseProductsData(rawData);
      await setStoreValueForActiveAccount(store, getStoreKey(taskKey), storeData);
    } else if (taskKey === "orders") {
      storeData = parseOrdersData(rawData);
      await setStoreValueForActiveAccount(store, getStoreKey(taskKey), storeData);
    } else if (taskKey === "sales") {
      storeData = parseSalesData(rawData);
      await setStoreValueForActiveAccount(store, getStoreKey(taskKey), { ...storeData, syncedAt });
    } else if (taskKey === "flux") {
      storeData = parseFluxData(rawData);
      await setStoreValueForActiveAccount(store, getStoreKey(taskKey), { ...storeData, syncedAt });
    }

    const count = getTaskCount(taskKey, rawData, storeData);
    const duration = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const taskMessage = count > 0 ? `已同步 ${count} 条数据` : "已同步并保存";
    const diagnostic: CollectionTaskDiagnostic = {
      status: "success",
      storeKey: getStoreKey(taskKey),
      updatedAt: syncedAt,
      message: taskMessage,
      count,
      duration,
    };

    await persistCollectionDiagnostic(taskKey, diagnostic);
    setDiagnostics((prev) => normalizeCollectionDiagnostics({
      ...prev,
      syncedAt,
      tasks: {
        ...prev.tasks,
        [taskKey]: diagnostic,
      },
      summary: {
        totalTasks: Math.max(prev.summary.totalTasks, Object.keys(prev.tasks).length + (prev.tasks[taskKey] ? 0 : 1)),
        successCount: Object.values({
          ...prev.tasks,
          [taskKey]: diagnostic,
        }).filter((task) => task.status === "success").length,
        errorCount: Object.values({
          ...prev.tasks,
          [taskKey]: diagnostic,
        }).filter((task) => task.status === "error").length,
      },
    }));

    return {
      syncedAt,
      count,
      message: taskMessage,
      duration,
    };
  };

  const markCollectionTaskError = async (taskKey: CollectionTaskKey, detail: string) => {
    const updatedAt = new Date().toLocaleString("zh-CN");
    const diagnostic: CollectionTaskDiagnostic = {
      status: "error",
      storeKey: getStoreKey(taskKey),
      updatedAt,
      message: detail,
    };

    await persistCollectionDiagnostic(taskKey, diagnostic);
    setDiagnostics((prev) => normalizeCollectionDiagnostics({
      ...prev,
      syncedAt: updatedAt,
      tasks: {
        ...prev.tasks,
        [taskKey]: diagnostic,
      },
      summary: {
        totalTasks: Math.max(prev.summary.totalTasks, Object.keys(prev.tasks).length + (prev.tasks[taskKey] ? 0 : 1)),
        successCount: Object.values({
          ...prev.tasks,
          [taskKey]: diagnostic,
        }).filter((task) => task.status === "success").length,
        errorCount: Object.values({
          ...prev.tasks,
          [taskKey]: diagnostic,
        }).filter((task) => task.status === "error").length,
      },
    }));
  };

  const runSyncTask = async (taskId: TaskId) => {
    if (!automation || !store) {
      message.error("桌面端自动化接口未就绪，请在 Electron 客户端内运行。");
      return;
    }

    setRunningTaskId(taskId);
    updateTask(taskId, { status: "running", lastMessage: "正在执行任务..." });

    try {
      if (taskId === "sync_dashboard") {
        const result = await persistCollectionTask("dashboard", () => automation.scrapeDashboard());
        updateTask(taskId, {
          status: "success",
          lastRun: result.syncedAt,
          lastMessage: result.message,
          count: result.count,
        });
        message.success("店铺概览数据已同步。");
        return;
      }

      if (taskId === "sync_products") {
        const result = await persistCollectionTask("products", () => automation.scrapeProducts());
        updateTask(taskId, {
          status: "success",
          lastRun: result.syncedAt,
          lastMessage: result.message,
          count: result.count,
        });
        message.success("商品列表数据已同步。");
        return;
      }

      if (taskId === "sync_orders") {
        const result = await persistCollectionTask("orders", () => automation.scrapeOrders());
        updateTask(taskId, {
          status: "success",
          lastRun: result.syncedAt,
          lastMessage: result.message,
          count: result.count,
        });
        message.success("备货单数据已同步。");
        return;
      }

      if (taskId === "sync_analytics") {
        const salesResult = await persistCollectionTask("sales", () => automation.scrapeSales());
        let fluxResult: Awaited<ReturnType<typeof persistCollectionTask>> | null = null;

        try {
          fluxResult = await persistCollectionTask("flux", () => automation.scrapeFlux());
        } catch (fluxError: any) {
          const detail = fluxError?.message || "流量同步失败";
          await markCollectionTaskError("flux", detail);
          updateTask(taskId, {
            status: "error",
            lastRun: salesResult.syncedAt,
            lastMessage: `销售已同步；流量失败：${detail}`,
            count: salesResult.count,
          });
          message.warning(`销售已同步，但流量同步失败：${detail}`);
          return;
        }

        const syncedAt = fluxResult?.syncedAt || salesResult.syncedAt;
        const count = (salesResult.count || 0) + (fluxResult?.count || 0);
        const taskMessage = `销售 ${salesResult.count || 0} 条，流量 ${fluxResult?.count || 0} 条`;
        updateTask(taskId, {
          status: "success",
          lastRun: syncedAt,
          lastMessage: taskMessage,
          count,
        });
        message.success("销售与流量数据已同步。");
      }
    } catch (error: any) {
      const detail = error?.message || "任务执行失败，请稍后重试。";
      const mappedKey = TASK_KEY_MAP[taskId];
      if (mappedKey && mappedKey !== "analytics") {
        await markCollectionTaskError(mappedKey, detail);
      }
      updateTask(taskId, {
        status: "error",
        lastMessage: detail,
      });
      message.error(detail);
    } finally {
      setRunningTaskId(null);
    }
  };

  const latestTaskRun = useMemo(() => {
    return tasks
      .map((task) => task.lastRun)
      .filter((value): value is string => Boolean(value))
      .sort()
      .pop() || null;
  }, [tasks]);

  const successTaskCount = useMemo(() => (
    tasks.filter((task) => task.status === "success").length
  ), [tasks]);

  const errorTaskCount = useMemo(() => (
    tasks.filter((task) => task.status === "error").length
  ), [tasks]);

  const taskColumns: ColumnsType<TaskConfig> = [
    {
      title: "任务名称",
      dataIndex: "name",
      key: "name",
      width: 110,
    },
    {
      title: "说明",
      dataIndex: "description",
      key: "description",
      onCell: () => ({ style: { minWidth: 200 } }),
      onHeaderCell: () => ({ style: { minWidth: 200 } }) as any,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 80,
      render: (status: TaskStatus) => {
        const map: Record<TaskStatus, { color: string; text: string }> = {
          idle: { color: "default", text: "待执行" },
          running: { color: "processing", text: "执行中" },
          success: { color: "success", text: "成功" },
          error: { color: "error", text: "失败" },
        };
        const current = map[status];
        return <Tag color={current.color}>{current.text}</Tag>;
      },
    },
    {
      title: "最近执行",
      dataIndex: "lastRun",
      key: "lastRun",
      width: 150,
      render: (value?: string) => value || <Text type="secondary">未执行</Text>,
    },
    {
      title: "数据量",
      dataIndex: "count",
      key: "count",
      width: 70,
      render: (value?: number) => typeof value === "number" ? value : <Text type="secondary">-</Text>,
    },
    {
      title: "最近结果",
      dataIndex: "lastMessage",
      key: "lastMessage",
      width: 160,
      ellipsis: true,
      render: (value?: string) => value || <Text type="secondary">暂无结果</Text>,
    },
    {
      title: "操作",
      key: "action",
      width: 120,
      render: (_, record) => (
        <Button
          type="primary"
          icon={<SyncOutlined />}
          loading={runningTaskId === record.id}
          disabled={Boolean(runningTaskId && runningTaskId !== record.id)}
          onClick={() => runSyncTask(record.id as TaskId)}
        >
          立即执行
        </Button>
      ),
    },
  ];

  return (
    <div className="dashboard-shell">
      <PageHeader
        compact
        eyebrow="数据"
        title="定时任务"
        subtitle="建议一次只执行一个同步任务，避免同时占用同一个浏览器会话"
        meta={[
          `${successTaskCount} 项成功`,
          errorTaskCount > 0 ? `${errorTaskCount} 项失败` : null,
          latestTaskRun ? `最近执行：${latestTaskRun}` : null,
        ].filter(Boolean) as string[]}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
        <StatCard compact title="任务成功数" value={successTaskCount} color="success" />
        <StatCard compact title="任务失败数" value={errorTaskCount} color={errorTaskCount > 0 ? "danger" : "neutral"} />
        <StatCard compact title="最近执行" value={latestTaskRun || "未执行"} color="blue" />
      </div>

      {diagnostics.syncedAt && (
        <div className="app-panel" style={{ marginBottom: 16 }}>
          <Text type="secondary">
            最近一次采集诊断时间：{diagnostics.syncedAt}，成功 {diagnostics.summary.successCount} 项，失败 {diagnostics.summary.errorCount} 项。
          </Text>
        </div>
      )}

      <div className="app-panel">
        <Table
          columns={taskColumns}
          dataSource={tasks}
          rowKey="id"
          pagination={false}
        />
      </div>
    </div>
  );
}
