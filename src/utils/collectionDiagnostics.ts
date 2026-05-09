export const COLLECTION_DIAGNOSTICS_KEY = "temu_collection_diagnostics";

export type CollectionTaskDiagnosticStatus = "success" | "error";

export interface CollectionTaskDiagnostic {
  status: CollectionTaskDiagnosticStatus;
  storeKey: string;
  updatedAt: string;
  message?: string;
  count?: number;
  duration?: number;
}

export interface CollectionDiagnostics {
  syncedAt: string | null;
  syncedAtIso?: string | null;
  fullSyncedAt?: string | null;
  fullSyncedAtIso?: string | null;
  tasks: Record<string, CollectionTaskDiagnostic>;
  summary: {
    totalTasks: number;
    successCount: number;
    errorCount: number;
  };
}

const EMPTY_DIAGNOSTICS: CollectionDiagnostics = {
  syncedAt: null,
  syncedAtIso: null,
  fullSyncedAt: null,
  fullSyncedAtIso: null,
  tasks: {},
  summary: {
    totalTasks: 0,
    successCount: 0,
    errorCount: 0,
  },
};

export function normalizeCollectionDiagnostics(raw: unknown): CollectionDiagnostics {
  if (!raw || typeof raw !== "object") {
    return EMPTY_DIAGNOSTICS;
  }

  const data = raw as Partial<CollectionDiagnostics>;
  const rawTasks = data.tasks && typeof data.tasks === "object" ? data.tasks : {};
  const tasks = Object.entries(rawTasks).reduce<Record<string, CollectionTaskDiagnostic>>((acc, [key, value]) => {
    if (!value || typeof value !== "object") {
      return acc;
    }

    const task = value as Partial<CollectionTaskDiagnostic>;
    if (task.status !== "success" && task.status !== "error") {
      return acc;
    }

    acc[key] = {
      status: task.status,
      storeKey: typeof task.storeKey === "string" ? task.storeKey : "",
      updatedAt: typeof task.updatedAt === "string" ? task.updatedAt : "",
      message: typeof task.message === "string" ? task.message : undefined,
      count: typeof task.count === "number" ? task.count : undefined,
      duration: typeof task.duration === "number" ? task.duration : undefined,
    };
    return acc;
  }, {});

  const summary = data.summary && typeof data.summary === "object" ? data.summary : undefined;

  return {
    syncedAt: typeof data.syncedAt === "string" ? data.syncedAt : null,
    syncedAtIso: typeof data.syncedAtIso === "string" ? data.syncedAtIso : null,
    fullSyncedAt: typeof data.fullSyncedAt === "string" ? data.fullSyncedAt : null,
    fullSyncedAtIso: typeof data.fullSyncedAtIso === "string" ? data.fullSyncedAtIso : null,
    tasks,
    summary: {
      totalTasks: typeof summary?.totalTasks === "number" ? summary.totalTasks : Object.keys(tasks).length,
      successCount: typeof summary?.successCount === "number"
        ? summary.successCount
        : Object.values(tasks).filter((task) => task.status === "success").length,
      errorCount: typeof summary?.errorCount === "number"
        ? summary.errorCount
        : Object.values(tasks).filter((task) => task.status === "error").length,
    },
  };
}

export function isCompleteCollectionDiagnostics(diagnostics: CollectionDiagnostics | null | undefined) {
  if (!diagnostics) return false;

  const totalTasks = Number(diagnostics.summary?.totalTasks) || 0;
  const successCount = Number(diagnostics.summary?.successCount) || 0;
  const errorCount = Number(diagnostics.summary?.errorCount) || 0;
  const taskCount = Object.keys(diagnostics.tasks || {}).length;

  return totalTasks > 0
    && taskCount >= totalTasks
    && successCount + errorCount >= totalTasks
    && successCount > 0;
}

export function getCollectionDataIssue(
  diagnostics: CollectionDiagnostics | null,
  taskKey: string,
  label: string,
  hasSourceData: boolean,
) {
  if (hasSourceData) {
    return null;
  }

  const task = diagnostics?.tasks?.[taskKey];
  if (!task) {
    return `${label} 尚未采集，请先执行一键采集。`;
  }

  if (task.status === "error") {
    return `${label} 上次采集失败${task.message ? `：${task.message}` : "，请重新采集。"}`;
  }

  return `${label} 已采集，但没有可展示的数据。`;
}
