const automationApi = () => (window as any).electronAPI?.automation;

export interface ListingTaskState {
  running: boolean;
  paused: boolean;
  exporting: boolean;
  taskId: string;
  mode: "classic" | "workflow";
  progress: any;
  results: any[];
  products: any[];
}

type Listener = (state: ListingTaskState) => void;

const initial: ListingTaskState = {
  running: false,
  paused: false,
  exporting: false,
  taskId: "",
  mode: "workflow",
  progress: null,
  results: [],
  products: [],
};

let state: ListingTaskState = { ...initial };
let listeners: Listener[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
let onComplete: (() => void) | null = null;

function emit() {
  const snapshot = { ...state };
  listeners.forEach((fn) => fn(snapshot));
}

function patch(partial: Partial<ListingTaskState>) {
  state = { ...state, ...partial };
  emit();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function sendNotification(title: string, body: string) {
  try {
    new Notification(title, { body });
  } catch {}
}

function startPolling(taskId: string) {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const snapshot = await automationApi()?.getTaskProgress?.(taskId);
      if (!snapshot) return;
      patch({
        progress: snapshot,
        results: Array.isArray(snapshot.results) ? snapshot.results : state.results,
        paused: Boolean(snapshot.paused),
        running: Boolean(snapshot.running),
      });

      const finished =
        !snapshot.running &&
        ["completed", "failed", "interrupted"].includes(snapshot.status || "");
      if (!finished) return;

      stopPolling();
      patch({ running: false, paused: false });
      onComplete?.();

      const ok = Array.isArray(snapshot.results) ? snapshot.results.filter((r: any) => r.success).length : 0;
      const fail = Array.isArray(snapshot.results) ? snapshot.results.filter((r: any) => !r.success).length : 0;
      if (snapshot.status === "completed") {
        sendNotification("批量上品完成", `成功 ${ok} 个，失败 ${fail} 个`);
      } else {
        sendNotification("批量上品异常", "任务未正常完成");
      }
    } catch {}
  }, 2200);
}

const listingTaskStore = {
  getState(): ListingTaskState {
    return state;
  },

  subscribe(fn: Listener): () => void {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },

  setOnComplete(fn: () => void) {
    onComplete = fn;
  },

  setMode(mode: "classic" | "workflow") {
    patch({ mode });
  },

  setProducts(products: any[]) {
    patch({ products });
  },

  removeProduct(goodsId: string) {
    patch({ products: state.products.filter((p: any) => p.goods_id !== goodsId) });
  },

  isRunning(): boolean {
    return state.running;
  },

  async startClassic(csvPath: string, count: number) {
    patch({ exporting: false, running: true, results: [] });
    const response = await automationApi()?.autoPricing?.({ csvPath, startRow: 0, count });
    if (!response?.accepted) {
      patch({ running: false });
      return { ok: false, message: response?.message || "当前已有任务在运行" };
    }
    const taskId = response?.task?.taskId;
    if (taskId) {
      patch({ taskId, progress: response.task });
      startPolling(taskId);
    }
    return { ok: true };
  },

  async startWorkflow(csvPath: string, count: number) {
    const taskId = `workflow_pack_${Date.now()}`;
    patch({
      exporting: false,
      running: true,
      results: [],
      taskId,
      progress: {
        taskId, running: true, status: "running", flowType: "workflow",
        total: count, completed: 0, current: "准备中",
      },
    });
    startPolling(taskId);

    try {
      const response = await automationApi()?.generatePackImages?.({
        taskId, csvPath, startRow: 0, count,
        packCounts: [2, 3, 4],
        quantityCounts: [1, 2, 3, 4],
        workflowRandomSpecValueCount: 2,
        workflowQuantityPriceMultipliers: { 1: 4, 2: 3, 3: 2.5, 4: 2 },
        createDrafts: true,
      });

      if (response?.accepted === false) {
        stopPolling();
        patch({ running: false });
        return { ok: false, message: response?.message || "已有任务在运行" };
      }

      if (Array.isArray(response?.results)) patch({ results: response.results });
      stopPolling();
      patch({
        running: false,
        progress: {
          taskId, running: false, flowType: "workflow",
          status: response?.success === false ? "failed" : "completed",
          total: count,
          completed: Number(response?.successCount || 0) + Number(response?.failCount || 0),
        },
      });
      onComplete?.();

      if (response?.success) {
        sendNotification("新上品流程完成", `成功 ${response.successCount || 0} 个`);
        return { ok: true, message: `成功 ${response.successCount || 0} 个` };
      }
      sendNotification("新上品流程异常", response?.message || "未完成");
      return { ok: false, message: response?.message || "未完成" };
    } catch (err: any) {
      stopPolling();
      patch({ running: false, progress: { taskId, running: false, status: "failed" } });
      sendNotification("新上品流程失败", err?.message || "未知错误");
      return { ok: false, message: err?.message || "失败" };
    }
  },

  async togglePause() {
    if (!state.taskId) return;
    if (state.paused) {
      await automationApi()?.resumePricing?.(state.taskId);
      patch({ paused: false });
    } else {
      await automationApi()?.pausePricing?.(state.taskId);
      patch({ paused: true });
    }
  },

  reset() {
    stopPolling();
    patch({ ...initial, mode: state.mode, products: state.products });
  },
};

export default listingTaskStore;
